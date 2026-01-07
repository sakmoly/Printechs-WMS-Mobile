import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useApp } from "../context/AppContext";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { StatusBadge } from "../components/StatusBadge";
import { ProgressIndicator } from "../components/ProgressIndicator";
import { dataService } from "../services/data.service";
import { apiService } from "../services/api.service";
import { addEvent } from "../services/event-queue.service";
import { getSettings } from "../services/settings.service";
import { normalizeASN } from "../utils/asn";
import { TransferCarton } from "../types";
import { getDatabase } from "../database/database";

// Put Away workflow states
type PutAwayWorkflowState =
  | "PUTAWAY_LIST" // Step 10: List of sealed TCs ready for put away
  | "SCAN_TC_FOR_PUTAWAY" // Step 11: Scan or select TC for put away
  | "SCAN_LOCATION" // Step 12: Scan Location
  | "COMPLETE_PUTAWAY" // Step 13: Complete Put Away
  | "PUTAWAY_TRANSACTIONS"; // View Put Away transactions

// Put Away transaction interface
interface PutAwayTransaction {
  offline_uuid: string;
  tc_id: string;
  rack: string;
  synced: number;
  event_time: string;
  asn_no?: string;
}

export default function PutAwayScreen() {
  console.log("🔄 PutAwayScreen: Component rendered");
  const navigation = useNavigation();
  const { activeASN, activeSession, settings } = useApp();
  const [loading, setLoading] = useState(false);

  // Workflow state
  const [workflowState, setWorkflowState] =
    useState<PutAwayWorkflowState>("PUTAWAY_LIST");

  // Put Away state
  const [sealedTCs, setSealedTCs] = useState<TransferCarton[]>([]);
  const [selectedTC, setSelectedTC] = useState<string | null>(null);
  const [selectedTCObj, setSelectedTCObj] = useState<TransferCarton | null>(
    null
  );
  const [lastTap, setLastTap] = useState<{ tcId: string; time: number } | null>(
    null
  );
  const [transactions, setTransactions] = useState<PutAwayTransaction[]>([]);

  // Load sealed TCs for put away list
  const loadSealedTCs = useCallback(async () => {
    console.log("🔄 PutAwayScreen: Loading sealed TCs...", { activeASN });
    setLoading(true);
    try {
      const db = await getDatabase();
      if (!db) {
        console.error("❌ PutAwayScreen: Database not initialized");
        setSealedTCs([]);
        setLoading(false);
        return;
      }

      if (activeASN) {
        // Load TCs for active ASN
        const normalizedASN = normalizeASN(activeASN);
        console.log("📦 PutAwayScreen: Loading TCs for ASN:", normalizedASN);
        const allTCs = await dataService.getTransferCartons(
          normalizedASN,
          "WAREHOUSE"
        );
        console.log("📦 PutAwayScreen: All TCs:", allTCs);
        // Only show Sealed TCs (exclude Completed)
        const sealed = allTCs.filter((tc) => tc.status === "Sealed");
        console.log(
          "✅ PutAwayScreen: Sealed TCs (excluding Completed):",
          sealed
        );
        setSealedTCs(sealed);
      } else {
        // Load all warehouse sealed TCs if no active ASN (exclude Completed)
        console.log("📦 PutAwayScreen: Loading all warehouse sealed TCs");
        const allTCs = await db.getAllAsync<TransferCarton>(
          'SELECT * FROM tc_cache WHERE store = "WAREHOUSE" AND status = "Sealed" ORDER BY updated_on DESC'
        );
        console.log(
          "✅ PutAwayScreen: All sealed TCs (excluding Completed):",
          allTCs
        );
        setSealedTCs(allTCs);
      }
    } catch (error: any) {
      console.error("❌ PutAwayScreen: Error loading sealed TCs:", error);
      setSealedTCs([]);
    } finally {
      setLoading(false);
    }
  }, [activeASN]);

  // Load Put Away transactions
  const loadTransactions = useCallback(async () => {
    console.log("🔄 PutAwayScreen: Loading transactions...");
    setLoading(true);
    try {
      const db = await getDatabase();
      if (!db) {
        console.error("❌ PutAwayScreen: Database not initialized");
        setTransactions([]);
        setLoading(false);
        return;
      }

      // Query PUTAWAY_TO_RACK events (these have the location/rack info)
      const putAwayEvents = await db.getAllAsync<PutAwayTransaction>(
        `SELECT 
          offline_uuid,
          tc_id,
          rack,
          synced,
          event_time,
          asn_no
        FROM event_queue 
        WHERE event_type IN ('PUTAWAY_TO_RACK', 'PUTAWAY_DISPATCH')
        ORDER BY event_time DESC`
      );

      console.log(
        "✅ PutAwayScreen: Loaded transactions:",
        putAwayEvents.length
      );
      setTransactions(putAwayEvents);
    } catch (error: any) {
      console.error("❌ PutAwayScreen: Error loading transactions:", error);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load sealed TCs when screen is focused
  useFocusEffect(
    useCallback(() => {
      if (workflowState === "PUTAWAY_LIST") {
        loadSealedTCs();
      } else if (workflowState === "PUTAWAY_TRANSACTIONS") {
        loadTransactions();
      }
    }, [loadSealedTCs, loadTransactions, workflowState])
  );

  // Also load on initial mount
  useEffect(() => {
    if (workflowState === "PUTAWAY_LIST") {
      loadSealedTCs();
    }
  }, [loadSealedTCs, workflowState]);

  // Step 11: Handle TC selection (double tap or scan)
  const handleTCSelection = (tcId: string) => {
    const now = Date.now();
    const tc = sealedTCs.find((t) => t.tc_id === tcId);

    if (!tc) {
      Alert.alert("Error", `Transfer Carton ${tcId} not found`);
      return;
    }

    if (lastTap && lastTap.tcId === tcId && now - lastTap.time < 500) {
      // Double tap detected
      setSelectedTC(tcId);
      setSelectedTCObj(tc);
      setWorkflowState("SCAN_LOCATION");
      setLastTap(null);
    } else {
      // First tap - set timer for potential double tap
      setLastTap({ tcId, time: now });

      // If no second tap within 500ms, treat as single tap (select)
      setTimeout(() => {
        setLastTap((prev) => {
          if (prev && prev.tcId === tcId && Date.now() - prev.time >= 500) {
            // Single tap - select TC
            setSelectedTC(tcId);
            setSelectedTCObj(tc);
            setWorkflowState("SCAN_LOCATION");
            return null;
          }
          return prev;
        });
      }, 500);
    }
  };

  // Step 11: Scan TC
  const handleTCScan = async (barcode: string) => {
    const tcId = barcode.trim().toUpperCase();
    const tc = sealedTCs.find((t) => t.tc_id === tcId);

    if (!tc) {
      Alert.alert(
        "Error",
        `Transfer Carton ${tcId} not found in sealed list. Please ensure it is sealed and belongs to warehouse.`
      );
      return;
    }

    setSelectedTC(tcId);
    setSelectedTCObj(tc);
    setWorkflowState("SCAN_LOCATION");
  };

  // Step 12: Scan Location
  const handleLocationScan = async (locationId: string) => {
    if (!selectedTC || !selectedTCObj) {
      Alert.alert("Error", "No Transfer Carton selected");
      return;
    }

    const locationIdUpper = locationId.trim().toUpperCase();
    setLoading(true);

    try {
      const settings = await getSettings();
      // Use ASN from the selected TC, fallback to active ASN or settings
      const asn = selectedTCObj.asn_no || activeASN || settings?.active_asn;
      // Use active session or settings session, or empty string if not available
      const session = activeSession || settings?.active_session || "";

      if (!asn) {
        Alert.alert(
          "Error",
          "Unable to determine ASN for this Transfer Carton"
        );
        setLoading(false);
        return;
      }

      const normalizedASN = normalizeASN(asn);

      // Validate rack exists or create it
      let rack = await dataService.getWarehouseRack(locationIdUpper);
      if (!rack) {
        rack = {
          rack_id: locationIdUpper,
          location_code: locationIdUpper,
          current_qty: 0,
          updated_on: new Date().toISOString(),
        };
        await dataService.saveWarehouseRack(rack);
      }

      // Record putaway event
      await addEvent({
        event_type: "PUTAWAY_TO_RACK",
        asn_no: normalizedASN,
        inbound_session: session,
        tc_id: selectedTC,
        rack: locationIdUpper,
        device_id: settings.device_id,
        user_id: settings.user_id,
      });

      setWorkflowState("COMPLETE_PUTAWAY");
      Alert.alert(
        "Success",
        `Transfer Carton ${selectedTC} placed at location ${locationIdUpper}`
      );
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to scan location");
    } finally {
      setLoading(false);
    }
  };

  // Step 13: Complete Put Away
  const handleCompletePutAway = async () => {
    if (!selectedTC || !selectedTCObj) {
      Alert.alert("Error", "No Transfer Carton selected");
      return;
    }

    setLoading(true);
    try {
      // Record putaway dispatch event
      const settings = await getSettings();
      // Use ASN from the selected TC, fallback to active ASN or settings
      const asn = selectedTCObj.asn_no || activeASN || settings?.active_asn;
      // Use active session or settings session, or empty string if not available
      const session = activeSession || settings?.active_session || "";

      if (asn) {
        const normalizedASN = normalizeASN(asn);
        await addEvent({
          event_type: "PUTAWAY_DISPATCH",
          asn_no: normalizedASN,
          inbound_session: session,
          tc_id: selectedTC,
          store: "WAREHOUSE",
          device_id: settings.device_id,
          user_id: settings.user_id,
        });
      }

      // Update TC status to "Completed"
      await dataService.updateTransferCartonStatus(selectedTC, "Completed");
      console.log(`✅ PutAwayScreen: TC ${selectedTC} marked as Completed`);

      Alert.alert(
        "Success",
        `Put Away completed for Transfer Carton ${selectedTC}`
      );

      // Reset and reload list (Completed TCs will be filtered out)
      setSelectedTC(null);
      setSelectedTCObj(null);
      await loadSealedTCs();
      setWorkflowState("PUTAWAY_LIST");
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to complete put away");
    } finally {
      setLoading(false);
    }
  };

  // Render UI based on workflow state
  const renderWorkflowStep = () => {
    console.log("🔄 PutAwayScreen: Rendering workflow step:", workflowState);
    switch (workflowState) {
      case "PUTAWAY_LIST":
        console.log(
          "📋 PutAwayScreen: Rendering PUTAWAY_LIST, sealedTCs:",
          sealedTCs.length
        );
        return (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>Put Away List</Text>
            <Text style={styles.infoText}>
              Sealed Transfer Cartons ready for put away
            </Text>
            {sealedTCs.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  No sealed Transfer Cartons available
                </Text>
                <Text style={styles.emptySubtext}>
                  Transfer Cartons must be sealed and belong to WAREHOUSE to
                  appear here.
                </Text>
                <Text style={styles.emptySubtext}>
                  {activeASN ? `Current ASN: ${activeASN}` : "No active ASN"}
                </Text>
                <Text style={styles.emptySubtext}>
                  To create a Transfer Carton for put away:
                </Text>
                <Text style={styles.emptySubtext}>1. Go to Packing screen</Text>
                <Text style={styles.emptySubtext}>
                  2. Select WAREHOUSE store
                </Text>
                <Text style={styles.emptySubtext}>
                  3. Create and seal a Transfer Carton
                </Text>
              </View>
            ) : (
              <>
                <FlatList
                  data={sealedTCs}
                  keyExtractor={(item) => item.tc_id}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.tcCard}
                      onPress={() => handleTCSelection(item.tc_id)}
                    >
                      <View style={styles.tcCardHeader}>
                        <Text style={styles.tcId}>{item.tc_id}</Text>
                        <StatusBadge status={item.status} />
                      </View>
                      <Text style={styles.tcDetail}>ASN: {item.asn_no}</Text>
                      <Text style={styles.tcDetail}>
                        Store: {item.store} | Updated:{" "}
                        {new Date(item.updated_on).toLocaleDateString()}
                      </Text>
                      <Text style={styles.tapHint}>
                        Double tap or scan to select
                      </Text>
                    </TouchableOpacity>
                  )}
                  scrollEnabled={false}
                />
                <View style={styles.scanSection}>
                  <Text style={styles.scanSectionTitle}>
                    Or Scan Transfer Carton
                  </Text>
                  <BarcodeScanner
                    onScan={handleTCScan}
                    placeholder="Scan Transfer Carton barcode"
                    title="Transfer Carton"
                  />
                </View>
              </>
            )}
            <TouchableOpacity
              style={styles.transactionButton}
              onPress={() => {
                setWorkflowState("PUTAWAY_TRANSACTIONS");
                loadTransactions();
              }}
            >
              <Text style={styles.transactionButtonText}>
                View Put Away Transactions
              </Text>
            </TouchableOpacity>
          </View>
        );

      case "PUTAWAY_TRANSACTIONS":
        return (
          <View style={styles.section}>
            <View style={styles.transactionHeader}>
              <Text style={styles.stepTitle}>Put Away Transactions</Text>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => setWorkflowState("PUTAWAY_LIST")}
              >
                <Text style={styles.backButtonText}>← Back</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.infoText}>
              List of all Put Away transactions with sync status
            </Text>
            {loading ? (
              <ActivityIndicator
                size="large"
                color="#007AFF"
                style={styles.loader}
              />
            ) : transactions.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  No Put Away transactions found
                </Text>
                <Text style={styles.emptySubtext}>
                  Transactions will appear here after you complete put away
                  operations.
                </Text>
              </View>
            ) : (
              <FlatList
                data={transactions}
                keyExtractor={(item) => item.offline_uuid}
                renderItem={({ item }) => (
                  <View style={styles.transactionCard}>
                    <View style={styles.transactionCardHeader}>
                      <Text style={styles.transactionTCId}>
                        {item.tc_id || "N/A"}
                      </Text>
                      <View
                        style={[
                          styles.syncBadge,
                          item.synced === 1
                            ? styles.syncBadgeSynced
                            : styles.syncBadgePending,
                        ]}
                      >
                        <Text
                          style={[
                            styles.syncBadgeText,
                            item.synced === 1
                              ? styles.syncBadgeTextSynced
                              : styles.syncBadgeTextPending,
                          ]}
                        >
                          {item.synced === 1 ? "Synced" : "Pending"}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.transactionDetails}>
                      <View style={styles.transactionDetailRow}>
                        <Text style={styles.transactionLabel}>Location:</Text>
                        <Text style={styles.transactionValue}>
                          {item.rack || "N/A"}
                        </Text>
                      </View>
                      {item.asn_no && (
                        <View style={styles.transactionDetailRow}>
                          <Text style={styles.transactionLabel}>ASN:</Text>
                          <Text style={styles.transactionValue}>
                            {item.asn_no}
                          </Text>
                        </View>
                      )}
                      <View style={styles.transactionDetailRow}>
                        <Text style={styles.transactionLabel}>Date:</Text>
                        <Text style={styles.transactionValue}>
                          {new Date(item.event_time).toLocaleString()}
                        </Text>
                      </View>
                    </View>
                  </View>
                )}
                scrollEnabled={false}
              />
            )}
          </View>
        );

      case "SCAN_TC_FOR_PUTAWAY":
        return (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>
              Step 11: Select Transfer Carton
            </Text>
            <BarcodeScanner
              onScan={handleTCScan}
              placeholder="Scan Transfer Carton barcode"
              title="Transfer Carton"
            />
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={() => setWorkflowState("PUTAWAY_LIST")}
            >
              <Text style={styles.secondaryButtonText}>Back to List</Text>
            </TouchableOpacity>
          </View>
        );

      case "SCAN_LOCATION":
        return (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>Step 12: Scan Location</Text>
            {selectedTC && (
              <View style={styles.selectedCard}>
                <Text style={styles.selectedLabel}>Selected TC:</Text>
                <Text style={styles.selectedValue}>{selectedTC}</Text>
              </View>
            )}
            <BarcodeScanner
              onScan={handleLocationScan}
              placeholder="Scan warehouse location/rack barcode"
              title="Location"
            />
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={() => {
                setSelectedTC(null);
                setSelectedTCObj(null);
                setWorkflowState("PUTAWAY_LIST");
              }}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        );

      case "COMPLETE_PUTAWAY":
        return (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>Step 13: Complete Put Away</Text>
            {selectedTC && (
              <View style={styles.selectedCard}>
                <Text style={styles.selectedLabel}>Transfer Carton:</Text>
                <Text style={styles.selectedValue}>{selectedTC}</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.button}
              onPress={handleCompletePutAway}
              disabled={loading}
            >
              <Text style={styles.buttonText}>Complete Put Away</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={() => {
                setSelectedTC(null);
                setSelectedTCObj(null);
                setWorkflowState("PUTAWAY_LIST");
              }}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Put Away</Text>
          <Text style={styles.subtitle}>
            Place sealed Transfer Cartons at warehouse locations
          </Text>
          {activeASN && (
            <View style={styles.asnBadge}>
              <Text style={styles.asnText}>ASN: {activeASN}</Text>
            </View>
          )}
        </View>

        {loading && workflowState === "PUTAWAY_LIST" ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Loading Transfer Cartons...</Text>
          </View>
        ) : (
          renderWorkflowStep() || (
            <View style={styles.section}>
              <Text style={styles.stepTitle}>Put Away</Text>
              <Text style={styles.infoText}>Initializing...</Text>
            </View>
          )
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    backgroundColor: "#fff",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
  },
  asnBadge: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#E3F2FD",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  asnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1976D2",
  },
  section: {
    backgroundColor: "#fff",
    marginTop: 12,
    padding: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#E0E0E0",
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  infoText: {
    fontSize: 14,
    color: "#666",
    marginBottom: 12,
  },
  emptyContainer: {
    padding: 20,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 18,
    color: "#666",
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 12,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 4,
  },
  loader: {
    marginVertical: 20,
  },
  tcCard: {
    backgroundColor: "#F9F9F9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: "#2196F3",
  },
  tcCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  tcId: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  tcDetail: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  tapHint: {
    fontSize: 10,
    color: "#999",
    marginTop: 4,
    fontStyle: "italic",
  },
  scanSection: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
  },
  scanSectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  selectedCard: {
    backgroundColor: "#E3F2FD",
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  selectedLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  selectedValue: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1976D2",
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 12,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: "#E0E0E0",
    marginTop: 8,
  },
  secondaryButtonText: {
    color: "#333",
  },
  loadingContainer: {
    padding: 20,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
  },
  transactionButton: {
    backgroundColor: "#4CAF50",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  transactionButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  transactionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  backButton: {
    padding: 8,
    paddingHorizontal: 12,
  },
  backButtonText: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "600",
  },
  transactionCard: {
    backgroundColor: "#F9F9F9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: "#2196F3",
  },
  transactionCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  transactionTCId: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  syncBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  syncBadgeSynced: {
    backgroundColor: "#4CAF50",
  },
  syncBadgePending: {
    backgroundColor: "#FF9800",
  },
  syncBadgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  syncBadgeTextSynced: {
    color: "#fff",
  },
  syncBadgeTextPending: {
    color: "#fff",
  },
  transactionDetails: {
    marginTop: 4,
  },
  transactionDetailRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  transactionLabel: {
    fontSize: 12,
    color: "#666",
    fontWeight: "600",
    width: 80,
  },
  transactionValue: {
    fontSize: 12,
    color: "#333",
    flex: 1,
  },
});
