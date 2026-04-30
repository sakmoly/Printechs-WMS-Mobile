import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { apiService } from "../services/api.service";
import { TransferIn } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { getDatabase } from "../database/database";

export default function TransferInDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { transferInTitle } = (route.params as any) || {};
  
  const [transferIn, setTransferIn] = useState<TransferIn | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (transferInTitle) {
      loadTransferIn();
    }
  }, [transferInTitle]);

  const loadTransferIn = async () => {
    if (!transferInTitle) return;
    
    setLoading(true);
    try {
      const response = await apiService.getTransferIn(transferInTitle);
      
      // Handle different response formats
      let ti: any = null;
      if (response && typeof response === "object") {
        if (response.data) {
          ti = response.data;
        } else if (response.transfer_in) {
          ti = response.transfer_in;
        } else {
          ti = response;
        }
      }

      if (ti) {
        setTransferIn(ti);
      } else {
        Alert.alert("Error", "Transfer In not found");
        navigation.goBack();
      }
    } catch (error: any) {
      console.error("❌ Error loading Transfer In:", error);
      Alert.alert("Error", `Failed to load Transfer In: ${error.message}`);
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const handleStartReceiving = async () => {
    if (!transferIn) return;

    const totalRequiredQty =
      transferIn.total_qty ||
      transferIn.items?.reduce((sum, i) => sum + (i.qty || 0), 0) ||
      0;
    const totalReceivedQty =
      transferIn.items?.reduce((sum, i) => sum + (i.received_qty || 0), 0) ||
      0;
    const isReceivedButIncomplete =
      transferIn.status === "Received" && totalReceivedQty < totalRequiredQty;
    
    // ✅ Allow receiving for: Submitted, In Transit, or Receiving (resume partial receive)
    // After backend fix, status will be "Receiving" when partial receive started
    if (
      transferIn.status !== "Submitted" &&
      transferIn.status !== "In Transit" &&
      transferIn.status !== "Receiving" &&
      !isReceivedButIncomplete
    ) {
      Alert.alert(
        "Cannot Start Receiving",
        `Transfer In ${transferIn.title} is ${transferIn.status}. Only 'Submitted', 'In Transit', 'Receiving', or incomplete 'Received' Transfer Ins can be received.`
      );
      return;
    }

    try {
      // ✅ Check if there's an existing receiving session
      const { transferInReceivingSessionService } = await import("../services/transfer-in-receiving-session.service");
      const { getSettings } = await import("../services/settings.service");
      
      let session = await transferInReceivingSessionService.loadSession(transferIn.title);
      const settings = await getSettings();
      const restoreCartonId = async (): Promise<string | null> => {
        const fromItems = transferIn.items?.find((item: any) => item.carton_id)?.carton_id;
        if (fromItems) return String(fromItems);

        try {
          const db = await getDatabase();
          const local = await db.getFirstAsync<{ carton_id?: string; box_id?: string }>(
            `SELECT carton_id, box_id
             FROM scanned_items
             WHERE asn_no = ?
               AND (carton_id IS NOT NULL OR box_id IS NOT NULL)
             ORDER BY scanned_on DESC
             LIMIT 1`,
            [transferIn.title]
          );
          if (local?.carton_id || local?.box_id) {
            return local.carton_id || local.box_id || null;
          }

          const localBox = await db.getFirstAsync<{ box_id?: string }>(
            `SELECT box_id
             FROM box_cache
             WHERE asn_no = ?
               AND box_id IS NOT NULL
               AND box_id != ''
             ORDER BY updated_on DESC
             LIMIT 1`,
            [transferIn.title]
          );
          return localBox?.box_id || null;
        } catch (error: any) {
          console.warn("⚠️ Could not restore Transfer In carton from local scans:", error.message);
          return null;
        }
      };
      const restoredCartonId = session?.active_carton_id || await restoreCartonId();
      
      // Generate transaction number
      const transactionNo = `TXN-${transferIn.title}-${Date.now()}`;
      
      if (!session) {
        // ✅ Create new session
        const sessionId = `TI-REC-${Date.now()}`;
        session = {
          session_id: sessionId,
          transfer_in_no: transferIn.title,
          transaction_no: transactionNo,
          active_carton_id: restoredCartonId,
          status: "Draft",
          started_by: settings.user_id || settings.user_code || "USER",
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          scanned_total: 0,
        };
        await transferInReceivingSessionService.saveSession(session);
      } else if (session.status === "Completed") {
        // ✅ If session is completed, create a new session
        const sessionId = `TI-REC-${Date.now()}`;
        session = {
          session_id: sessionId,
          transfer_in_no: transferIn.title,
          transaction_no: transactionNo,
          active_carton_id: restoredCartonId,
          status: "In Progress",
          started_by: settings.user_id || settings.user_code || "USER",
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          scanned_total: 0,
        };
        await transferInReceivingSessionService.saveSession(session);
      } else {
        // ✅ Resume existing session - update status to "In Progress" if it's "Draft"
        if (session.status === "Draft") {
          session.status = "In Progress";
          session.updated_at = new Date().toISOString();
          await transferInReceivingSessionService.saveSession(session);
        }
        if (!session.active_carton_id && restoredCartonId) {
          session.active_carton_id = restoredCartonId;
          session.updated_at = new Date().toISOString();
          await transferInReceivingSessionService.saveSession(session);
        }
        console.log(`✅ Resuming receiving session: ${session.session_id}, carton: ${session.active_carton_id || 'none'}`);
      }

      // ✅ Always navigate to carton scan screen first
      // This allows user to:
      // - Generate a new carton ID
      // - Scan a carton ID
      // - Change carton if needed
      // The carton screen will restore existing carton ID if available
      (navigation as any).navigate("TransferInReceivingScanCarton", {
        transferInNo: transferIn.title,
        sessionId: session.session_id,
        transactionNo: session.transaction_no || transactionNo,
        activeCartonId: session.active_carton_id || restoredCartonId || null,
      });
    } catch (error: any) {
      console.error("❌ Error starting receiving:", error);
      Alert.alert("Error", `Failed to start receiving: ${error.message}`);
    }
  };

  const handleCreatePutawayTask = async () => {
    if (!transferIn) return;

    if (transferIn.status !== "Received") {
      Alert.alert(
        "Transfer In Not Received",
        `Transfer In ${transferIn.title} is ${transferIn.status}.\n\nPutaway tasks are automatically created when all items are received and the Transfer In status is "Received".\n\nPlease complete receiving all items first.`
      );
      return;
    }

    // Check if all items are received
    const allItemsReceived = transferIn.items?.every((i) => (i.received_qty || 0) >= (i.qty || 0)) || false;
    if (!allItemsReceived) {
      Alert.alert(
        "Items Not Fully Received",
        `Not all items have been received for ${transferIn.title}.\n\nPutaway tasks are automatically created when all items are received.\n\nPlease complete receiving all items first.`
      );
      return;
    }

    // Putaway Tasks are now auto-created by the backend when all items are received
    // This function now just provides information and navigation
    
    // All items received - Putaway Task should already be created automatically
    Alert.alert(
      "Putaway Task Auto-Created",
      `All items for ${transferIn.title} have been received.\n\n✅ Putaway Task has been created automatically by the backend.\n\nYou can now go to Putaway Tasks to perform putaway.`,
      [
        {
          text: "OK",
          onPress: () => {
            // Optionally navigate to Putaway screen
            // (navigation as any).navigate("PutAway");
          },
        },
        {
          text: "Go to Putaway Tasks",
          onPress: () => {
            (navigation as any).navigate("PutAway");
          },
        },
      ]
    );
  };

  const getItemStatusLabel = (status?: string, receivedQty: number = 0, qty: number = 0): string => {
    // Use backend status if available, otherwise calculate from received_qty
    if (status) {
      return status;
    }
    // Fallback: calculate status from received_qty
    if (receivedQty === 0) return "Pending";
    if (receivedQty >= qty) return "Received";
    return "Picking";
  };

  const renderItem = ({ item }: { item: { item_code: string; qty: number; received_qty?: number; carton_id?: string; status?: "Pending" | "Picking" | "Received" } }) => {
    const receivedQty = item.received_qty || 0;
    const remainingQty = item.qty - receivedQty;
    const progress = item.qty > 0 ? (receivedQty / item.qty) * 100 : 0;
    const itemStatus = getItemStatusLabel(item.status, receivedQty, item.qty);

    return (
      <View style={styles.itemCard}>
        <View style={styles.itemHeader}>
          <Text style={styles.itemCode}>{item.item_code}</Text>
          <StatusBadge
            status={itemStatus}
          />
        </View>
        <View style={styles.itemDetails}>
          {item.carton_id && (
            <View style={styles.qtyRow}>
              <Text style={styles.qtyLabel}>Carton ID:</Text>
              <Text style={styles.qtyValue}>{item.carton_id}</Text>
            </View>
          )}
          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>Quantity:</Text>
            <Text style={styles.qtyValue}>{item.qty}</Text>
          </View>
          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>Received:</Text>
            <Text style={[styles.qtyValue, { color: "#4CAF50" }]}>
              {receivedQty}
            </Text>
          </View>
          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>Remaining:</Text>
            <Text style={[styles.qtyValue, { color: remainingQty > 0 ? "#FF9800" : "#4CAF50" }]}>
              {remainingQty}
            </Text>
          </View>
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${progress}%`, backgroundColor: progress === 100 ? "#4CAF50" : "#2196F3" },
                ]}
              />
            </View>
            <Text style={styles.progressText}>{Math.round(progress)}%</Text>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading Transfer In...</Text>
      </View>
    );
  }

  if (!transferIn) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Transfer In not found</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const totalItems = transferIn.items?.length || 0;
  const totalQty = transferIn.total_qty || transferIn.items?.reduce((sum, i) => sum + (i.qty || 0), 0) || 0;
  const receivedQty = transferIn.items?.reduce((sum, i) => sum + (i.received_qty || 0), 0) || 0;
  const overallProgress = totalQty > 0 ? (receivedQty / totalQty) * 100 : 0;
  const isReceivedButIncomplete = transferIn.status === "Received" && receivedQty < totalQty;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{transferIn.title}</Text>
        <StatusBadge
          status={transferIn.status}
        />
      </View>

      {(transferIn.status === "Submitted" || transferIn.status === "In Transit" || transferIn.status === "Receiving") && (
        <View style={styles.actionSection}>
          <TouchableOpacity
            style={styles.startButton}
            onPress={handleStartReceiving}
          >
            <Text style={styles.startButtonText}>Start Receiving</Text>
          </TouchableOpacity>
        </View>
      )}

      {isReceivedButIncomplete && (
        <View style={styles.actionSection}>
          <TouchableOpacity
            style={styles.warningButton}
            onPress={handleStartReceiving}
          >
            <Text style={styles.startButtonText}>Continue Receiving / Repair Qty</Text>
          </TouchableOpacity>
          <Text style={styles.hintText}>
            This Transfer In is marked Received, but received quantity is still incomplete. Continue receiving to sync the missing quantity before putaway.
          </Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Transfer Information</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>From Showroom:</Text>
          <Text style={styles.infoValue}>{transferIn.from_showroom}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>To Warehouse:</Text>
          <Text style={styles.infoValue}>{transferIn.to_warehouse}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Transfer Date:</Text>
          <Text style={styles.infoValue}>
            {transferIn.transfer_date
              ? new Date(transferIn.transfer_date).toLocaleDateString()
              : "N/A"}
          </Text>
        </View>
        {transferIn.expected_arrival_date && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Expected Arrival:</Text>
            <Text style={styles.infoValue}>
              {new Date(transferIn.expected_arrival_date).toLocaleDateString()}
            </Text>
          </View>
        )}
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Prepared By:</Text>
          <Text style={styles.infoValue}>{transferIn.prepared_by || "N/A"}</Text>
        </View>
        {transferIn.received_by && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Received By:</Text>
            <Text style={styles.infoValue}>{transferIn.received_by}</Text>
          </View>
        )}
        {transferIn.received_on && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Received On:</Text>
            <Text style={styles.infoValue}>
              {new Date(transferIn.received_on).toLocaleString()}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Progress Summary</Text>
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Items:</Text>
            <Text style={styles.summaryValue}>{totalItems}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Quantity:</Text>
            <Text style={styles.summaryValue}>{totalQty}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Received:</Text>
            <Text style={[styles.summaryValue, { color: "#4CAF50" }]}>
              {receivedQty}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Remaining:</Text>
            <Text style={[styles.summaryValue, { color: "#FF9800" }]}>
              {totalQty - receivedQty}
            </Text>
          </View>
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${overallProgress}%`,
                    backgroundColor: overallProgress === 100 ? "#4CAF50" : "#2196F3",
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>{Math.round(overallProgress)}% Complete</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Items ({totalItems})</Text>
        <FlatList
          data={transferIn.items || []}
          keyExtractor={(item, index) => `${item.item_code}-${index}`}
          renderItem={renderItem}
          scrollEnabled={false}
        />
      </View>

      {transferIn.status === "Received" && !isReceivedButIncomplete && (
        <View style={styles.actionSection}>
          <TouchableOpacity
            style={styles.startButton}
            onPress={handleCreatePutawayTask}
          >
            <Text style={styles.startButtonText}>
              View Putaway Task
            </Text>
          </TouchableOpacity>
          <Text style={styles.hintText}>
            Putaway tasks are automatically created when all items are received. Click to view or navigate to Putaway Tasks.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: "#666",
    marginBottom: 20,
  },
  backButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  header: {
    backgroundColor: "#FFF",
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#2196F3",
  },
  section: {
    backgroundColor: "#FFF",
    margin: 12,
    padding: 16,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: "row",
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 14,
    color: "#666",
    width: 120,
  },
  infoValue: {
    fontSize: 14,
    color: "#000",
    flex: 1,
    fontWeight: "500",
  },
  summaryCard: {
    backgroundColor: "#F9F9F9",
    padding: 12,
    borderRadius: 8,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  summaryLabel: {
    fontSize: 14,
    color: "#666",
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#000",
  },
  progressBarContainer: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: "#E0E0E0",
    borderRadius: 4,
    overflow: "hidden",
    marginRight: 12,
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
  },
  progressText: {
    fontSize: 12,
    color: "#666",
    fontWeight: "600",
  },
  itemCard: {
    backgroundColor: "#F9F9F9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  itemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  itemCode: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  itemDetails: {
    marginTop: 8,
  },
  qtyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  qtyLabel: {
    fontSize: 14,
    color: "#666",
  },
  qtyValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#000",
  },
  actionSection: {
    padding: 16,
    paddingBottom: 16,
  },
  startButton: {
    backgroundColor: "#2196F3",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  warningButton: {
    backgroundColor: "#FF9800",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  startButtonDisabled: {
    backgroundColor: "#CCCCCC",
    opacity: 0.6,
  },
  startButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  hintText: {
    fontSize: 12,
    color: "#666",
    marginTop: 8,
    textAlign: "center",
    fontStyle: "italic",
  },
});
