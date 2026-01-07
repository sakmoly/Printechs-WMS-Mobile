import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
  FlatList,
  Modal,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useApp } from "../context/AppContext";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { apiService } from "../services/api.service";
import { getSettings, saveSettings } from "../services/settings.service";
import { getDatabase } from "../database/database";
import { dataService } from "../services/data.service";
import { normalizeASN } from "../utils/asn";
import { ProgressIndicator } from "../components/ProgressIndicator";

export default function StartInboundScreen() {
  const navigation = useNavigation();
  const { setActiveASN, setActiveSession } = useApp();
  const [asnNo, setAsnNo] = useState("");
  const [dock, setDock] = useState("DOCK-01");
  const [transferOrder, setTransferOrder] = useState("");
  const [transferOrders, setTransferOrders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingTO, setLoadingTO] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [existingSessions, setExistingSessions] = useState<Array<{
    inbound_session: string;
    status: string;
    started_on: string | null;
    completed_cartons: number;
    total_cartons: number;
    updated_on: string;
  }>>([]);
  const [showSessionList, setShowSessionList] = useState(false);

  // Update session ID when ASN changes
  useEffect(() => {
    const updateSessionId = async () => {
      if (asnNo.trim()) {
        try {
          const settings = await getSettings();
          const userId = settings.user_id || "USER-AUTO";
          const deviceId = settings.device_id || "DEV-AUTO";
          const normalizedASN = normalizeASN(asnNo);
          const generatedId = dataService.generateSessionId(normalizedASN, deviceId, userId);
          setSessionId(generatedId);
        } catch (error) {
          console.error("Error generating session ID:", error);
        }
      } else {
        setSessionId("");
      }
    };
    updateSessionId();
  }, [asnNo]);

  const handleASNScan = async (barcode: string) => {
    const scannedASN = barcode.trim().toUpperCase();
    // Preserve the original scanned format for display
    setAsnNo(scannedASN);
    
    // Use scanned ASN format directly (no normalization)
    // Backend expects exact format from database (e.g., ASN-0001, ASN-0002)
    if (scannedASN) {
      await loadTransferOrders(scannedASN);
      // For session lookup, still normalize for backward compatibility with existing sessions
      const normalizedASN = normalizeASN(scannedASN);
      await checkExistingSessions(normalizedASN);
    }
  };

  // Check for existing sessions when ASN is set
  const checkExistingSessions = async (asn: string) => {
    try {
      const settings = await getSettings();
      const userId = settings.user_id || "USER-AUTO";
      const deviceId = settings.device_id || "DEV-AUTO";

      // Check for existing sessions
      const sessions = await dataService.getSessionsByCombination(asn, deviceId, userId);
      
      if (sessions.length > 0) {
        setExistingSessions(sessions);
        console.log(`📋 Found ${sessions.length} existing session(s) for ASN ${asn}`);
      } else {
        setExistingSessions([]);
      }
    } catch (error: any) {
      console.error("Error checking existing sessions:", error);
      setExistingSessions([]);
    }
  };

  const loadTransferOrders = async (asn: string) => {
    setLoadingTO(true);
    try {
      const settings = await getSettings();

      // Use demo data if:
      // 1. Demo mode is explicitly enabled (demo_mode === 1)
      // 2. No API URL is configured (auto-fallback to demo mode)
      const useDemoData = settings.demo_mode === 1 || !settings.api_url;

      if (useDemoData) {
        // Use demo transfer order
        setTransferOrder("TO-00012");
        setTransferOrders(["TO-00012"]);

        // Check if allocations already exist (from seeder) - don't override them
        const normalizedASN = normalizeASN(asn);
        const existingAllocations =
          await dataService.getTransferOrderAllocations(normalizedASN);

        // Only create allocations if they don't exist
        if (existingAllocations.length === 0) {
          // Cache demo transfer order allocations
          // Different items and quantities per store to show variety
          const db = await getDatabase();

          // Different items and quantities per store for variety
          const demoAllocations = [
            { store: "SR-01", item_code: "ITEM-0001", allocated_qty: 2 },
            { store: "SR-01", item_code: "ITEM-0002", allocated_qty: 1 },
            { store: "SR-01", item_code: "ITEM-0004", allocated_qty: 1 },
            { store: "SR-02", item_code: "ITEM-0001", allocated_qty: 1 },
            { store: "SR-02", item_code: "ITEM-0003", allocated_qty: 2 },
            { store: "SR-02", item_code: "ITEM-0006", allocated_qty: 1 },
            { store: "SR-03", item_code: "ITEM-0002", allocated_qty: 2 },
            { store: "SR-03", item_code: "ITEM-0004", allocated_qty: 1 },
            { store: "SR-03", item_code: "ITEM-0005", allocated_qty: 1 },
          ];

          for (const alloc of demoAllocations) {
            await db.runAsync(
              "INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES (?, ?, ?, ?, ?)",
              [
                "TO-00012",
                normalizedASN,
                alloc.store,
                alloc.item_code,
                alloc.allocated_qty,
              ]
            );
          }
        }
      } else {
        // Try to fetch from API (only if API URL is configured)
        // Use ASN format directly (no normalization) - backend expects exact format from database
        // ASN is already in the format from backend (e.g., ASN-0001, ASN-0002)
        const asnToQuery = asn; // Use ASN format as-is (preserving exact format from backend)
        console.log(
          `📋 Using ASN format "${asnToQuery}" for API call (preserving exact format)`
        );

        try {
          const toData = await apiService.getTransferOrderByASN(asnToQuery);
          if (toData && toData.to_no) {
            setTransferOrder(toData.to_no);
            setTransferOrders([toData.to_no]);

            // Cache transfer order allocations
            if (toData.allocations) {
              const db = await getDatabase();
              for (const alloc of toData.allocations) {
                await db.runAsync(
                  "INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES (?, ?, ?, ?, ?)",
                  [
                    toData.to_no,
                    asn,
                    alloc.store,
                    alloc.item_code,
                    alloc.allocated_qty,
                  ]
                );
              }
            }
          } else {
            // No transfer order found - this is OK, user can still proceed
            console.log(
              `ℹ️ No transfer order found for ASN ${asnToQuery}. User can still proceed without transfer order.`
            );
            setTransferOrder("");
            setTransferOrders([]);
          }
        } catch (apiError: any) {
          // If API call fails (404 = no transfer order), that's OK
          // User can still proceed without transfer order
          if (
            apiError.message?.includes("404") ||
            apiError.message?.includes("ASN_NOT_FOUND") ||
            apiError.message?.includes("TRANSFER_ORDER_NOT_FOUND")
          ) {
            console.log(
              `ℹ️ No transfer order found for ASN ${asnToQuery} (this is OK - user can proceed without transfer order)`
            );
            setTransferOrder("");
            setTransferOrders([]);
          } else {
            // For other errors (network, 500, etc.), show warning but still allow proceeding
            console.warn(
              "⚠️ Failed to fetch transfer order (non-404 error):",
              apiError.message
            );
            setTransferOrder("");
            setTransferOrders([]);
          }
        }
      }
    } catch (error: any) {
      console.error("Failed to load transfer orders:", error);
      // Don't fall back to demo data - allow proceeding without transfer order
      setTransferOrder("");
      setTransferOrders([]);
    } finally {
      setLoadingTO(false);
    }
  };

  // Handle selecting an existing session
  const handleSelectExistingSession = async (session: {
    inbound_session: string;
    status: string;
    started_on: string | null;
    asn_no?: string; // Add asn_no field to session type
  }) => {
    // Get the ASN from the session or from asnNo state
    // Sessions store normalized ASN, so we need to get the original format
    const sessionASN = session.asn_no || asnNo.trim().toUpperCase();
    if (!sessionASN) {
      Alert.alert("Error", "ASN number is required");
      return;
    }

    // The session ASN is normalized, so try to get original format from database
    const normalizedASN = normalizeASN(sessionASN);
    
    // Try to get original ASN format from database (from desktop sync)
    let displayASN = sessionASN; // Default to session ASN
    try {
      const originalASN = await dataService.getOriginalASNFormat(normalizedASN);
      if (originalASN && originalASN !== normalizedASN) {
        displayASN = originalASN;
        console.log(`📋 Using original ASN format from desktop: ${displayASN} (session: ${sessionASN}, normalized: ${normalizedASN})`);
      } else {
        // If no original format found, try using scanned ASN if available
        const scannedASN = asnNo.trim().toUpperCase();
        if (scannedASN && scannedASN !== normalizedASN) {
          displayASN = scannedASN;
          console.log(`📋 Using scanned ASN format: ${displayASN} (normalized: ${normalizedASN})`);
        } else {
          // Fallback to normalized ASN if no original or scanned format available
          displayASN = normalizedASN;
          console.log(`📋 Using normalized ASN format: ${displayASN}`);
        }
      }
    } catch (error: any) {
      // Fallback: use scanned ASN if available, otherwise use session ASN
      const scannedASN = asnNo.trim().toUpperCase();
      displayASN = scannedASN || sessionASN;
      console.warn(`⚠️ Could not get original ASN format, using: ${displayASN}`);
    }
    
    // Set active ASN (preserved format) and session
    setActiveASN(displayASN);
    setActiveSession(session.inbound_session);

    // Persist to settings (use preserved format)
    await saveSettings({
      active_asn: displayASN,
      active_session: session.inbound_session,
    });

    // Navigate to Unload screen
    (navigation as any).replace("Unload");
  };

  // Create new session with generated session ID
  const createNewSession = async (
    scannedASN: string, // Original scanned format (e.g., ASN-00001)
    userId: string,
    deviceId: string,
    generatedSessionId: string
  ) => {
    setLoading(true);
    try {
      const settings = await getSettings();

      // Use the generated session ID
      const inboundSessionId = generatedSessionId;

      // Normalize ASN only for database operations (lookups, storage)
      const normalizedASN = normalizeASN(scannedASN);

      // Note: We no longer call /api/inbound/start to avoid duplicate sessions
      // The /api/inbound/update endpoint handles both create and update operations
      // This ensures we use our generated session ID consistently

      // Cache ASN data
      const db = await getDatabase();
      await db.runAsync(
        "INSERT OR REPLACE INTO asn_cache (asn_no, payload_json, updated_on) VALUES (?, ?, ?)",
        [
          normalizedASN,
          JSON.stringify({
            asn_no: normalizedASN,
            transfer_order: transferOrder,
            dock,
          }),
          new Date().toISOString(),
        ]
      );

      // Initialize carton statuses - get cartons from ASN carton map (synced from desktop)
      let cartonMap = await db.getAllAsync<{ carton_id: string }>(
        "SELECT DISTINCT carton_id FROM asn_carton_map WHERE asn_no = ? ORDER BY carton_id",
        [normalizedASN]
      );

      console.log(
        `📦 Found ${cartonMap.length} cartons in asn_carton_map for ASN: ${normalizedASN}`,
        cartonMap.map((c) => c.carton_id)
      );

      // Only use cartons from asn_carton_map (synced from desktop)
      // Do NOT create demo cartons or use fallback - use only real data from desktop
      let cartons: string[] = [];
      if (cartonMap.length > 0) {
        cartons = cartonMap.map((c) => c.carton_id);
        console.log(`✅ Using ${cartons.length} carton(s) from desktop sync:`, cartons);
      } else {
        // No cartons found - this means ASN data hasn't been synced from desktop yet
        console.warn(
          `⚠️ No cartons found in asn_carton_map for ASN ${normalizedASN}. ` +
          `Please sync ASN data from desktop first using Sync Center.`
        );
        Alert.alert(
          "No Cartons Found",
          `No cartons found for ASN ${scannedASN}.\n\n` +
          `Please sync ASN data from desktop using Sync Center before starting a session.`
        );
        setLoading(false);
        return;
      }

      // Initialize carton statuses
      console.log(
        `📦 Initializing ${cartons.length} carton statuses for new session...`
      );

      for (const carton_id of cartons) {
        await dataService.updateCartonStatus({
          asn_no: normalizedASN,
          inbound_session: inboundSessionId,
          carton_id,
          status: "Pending",
          updated_on: new Date().toISOString(),
        });
      }

      // In demo mode, ensure BOXes exist for this ASN
      if (settings.demo_mode) {
        const existingBoxes = await db.getAllAsync<{ box_id: string }>(
          "SELECT DISTINCT box_id FROM box_cache WHERE asn_no = ?",
          [normalizedASN]
        );

        if (existingBoxes.length === 0) {
          const demoBoxes = [
            { box_id: "BOX-SR01-001", store: "SR-01", status: "Open" },
            { box_id: "BOX-SR02-001", store: "SR-02", status: "Open" },
            { box_id: "BOX-SR03-001", store: "SR-03", status: "Open" },
          ];

          for (const box of demoBoxes) {
            await db.runAsync(
              "INSERT OR REPLACE INTO box_cache (box_id, asn_no, to_no, store, status, updated_on) VALUES (?, ?, ?, ?, ?, ?)",
              [
                box.box_id,
                normalizedASN,
                transferOrder || "TO-00012",
                box.store,
                box.status,
                new Date().toISOString(),
              ]
            );
          }
        }
      }

      // Save session to local database
      await dataService.saveInboundSession({
        inbound_session: inboundSessionId,
        asn_no: normalizedASN,
        transfer_order: transferOrder,
        dock: dock,
        status: "Active",
        total_cartons: cartons.length,
        completed_cartons: 0,
        started_by: userId,
        started_on: new Date().toISOString(),
        synced: 0,
      });

      // Sync session to backend using /api/inbound/update
      try {
        await apiService.updateInboundSession({
          inbound_session: inboundSessionId,
          asn_no: normalizedASN,
          status: "Active",
          transfer_order: transferOrder,
          dock: dock,
          total_cartons: cartons.length,
          completed_cartons: 0,
          user_id: userId,
          device_id: deviceId,
        });
        console.log("✅ Session synced to backend");
      } catch (syncError: any) {
        console.warn("⚠️ Failed to sync session to backend:", syncError.message);
      }

      // Use the scanned ASN format (preserve exact format from barcode)
      // If ASN exists in database, prefer the original format from desktop
      let displayASN = scannedASN; // Default to scanned format
      try {
        const originalASN = await dataService.getOriginalASNFormat(normalizedASN);
        if (originalASN && originalASN !== normalizedASN) {
          displayASN = originalASN;
          console.log(`📋 Using original ASN format from desktop: ${displayASN} (scanned: ${scannedASN}, normalized: ${normalizedASN})`);
        } else {
          // Use scanned format if no original found in database
          displayASN = scannedASN;
          console.log(`📋 Using scanned ASN format: ${displayASN} (normalized: ${normalizedASN})`);
        }
      } catch (error: any) {
        // Fallback to scanned format if database lookup fails
        displayASN = scannedASN;
        console.warn(`⚠️ Could not get original ASN format, using scanned: ${scannedASN}`);
      }

      setActiveASN(displayASN);
      setActiveSession(inboundSessionId);

      // Persist active ASN (preserved format) and session to settings
      await saveSettings({
        active_asn: displayASN,
        active_session: inboundSessionId,
      });

      // Auto-navigate to Unload screen
      (navigation as any).replace("Unload");
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to start inbound session");
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    if (!asnNo.trim()) {
      Alert.alert("Error", "Please scan or enter ASN number");
      return;
    }

    const settings = await getSettings();
    const userId = settings.user_id || "USER-AUTO";
    const deviceId = settings.device_id || "DEV-AUTO";
    // Preserve original scanned format, but normalize for session ID generation
    const scannedASN = asnNo.trim().toUpperCase();
    const normalizedASN = normalizeASN(scannedASN);
    const generatedSessionId = dataService.generateSessionId(normalizedASN, deviceId, userId);

    // Check if session already exists locally
    const existingSession = await dataService.getInboundSession(generatedSessionId);
    
    if (existingSession && existingSession.status !== "Completed") {
      // Session exists and is not completed - show options
      Alert.alert(
        "Session Already Exists",
        `A session with ID ${generatedSessionId} already exists.\n\nStatus: ${existingSession.status}\nStarted: ${existingSession.started_on ? new Date(existingSession.started_on).toLocaleString() : "Unknown"}\n\nDo you want to resume this session or create a new one?`,
        [
          {
            text: "Resume Existing",
            onPress: () => {
              handleSelectExistingSession(existingSession);
            },
          },
          {
            text: "Create New",
            style: "destructive",
            onPress: async () => {
              // Create new session (will overwrite existing)
              await createNewSession(scannedASN, userId, deviceId, generatedSessionId);
            },
          },
        ]
      );
      return;
    }

    // If there are other existing sessions, show list
    if (existingSessions.length > 0) {
      setShowSessionList(true);
      return;
    }

    // No existing session, create new one
    await createNewSession(scannedASN, userId, deviceId, generatedSessionId);
  };

  const renderSessionItem = ({ item }: { item: typeof existingSessions[0] }) => (
    <TouchableOpacity
      style={styles.sessionItem}
      onPress={() => handleSelectExistingSession(item)}
    >
      <View style={styles.sessionItemContent}>
        <Text style={styles.sessionIdText}>{item.inbound_session}</Text>
        <Text style={styles.sessionStatusText}>Status: {item.status}</Text>
        <Text style={styles.sessionDateText}>
          Started: {item.started_on ? new Date(item.started_on).toLocaleString() : "Unknown"}
        </Text>
        <Text style={styles.sessionProgressText}>
          Progress: {item.completed_cartons}/{item.total_cartons} cartons
        </Text>
      </View>
      <Text style={styles.sessionTapHint}>Tap to resume</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container}>
      <ProgressIndicator
        currentStep={1}
        totalSteps={6}
        stepName="Start Inbound"
      />
      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Scan ASN Barcode</Text>
        <BarcodeScanner
          onScan={handleASNScan}
          placeholder="Enter ASN number"
          title="ASN Barcode"
        />

        <View style={styles.inputGroup}>
          <Text style={styles.label}>ASN Number</Text>
          <Text style={styles.value}>{asnNo || "Not scanned"}</Text>
        </View>

        {sessionId && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Session ID</Text>
            <Text style={styles.sessionIdDisplay}>{sessionId}</Text>
            <Text style={styles.hintText}>
              Generated from: ASN + Device ID + User ID
            </Text>
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Dock</Text>
          <TextInput
            style={styles.input}
            value={dock}
            onChangeText={setDock}
            placeholder="DOCK-01"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Transfer Order</Text>
          {loadingTO ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          ) : transferOrder ? (
            <Text style={styles.value}>{transferOrder}</Text>
          ) : asnNo ? (
            <View>
              <Text style={styles.value}>No Transfer Order found</Text>
              <Text style={styles.hintText}>
                You can still proceed without a transfer order
              </Text>
            </View>
          ) : (
            <Text style={styles.value}>Scan ASN to load Transfer Order</Text>
          )}
        </View>

        {existingSessions.length > 0 && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>
              Existing Sessions ({existingSessions.length})
            </Text>
            <TouchableOpacity
              style={styles.viewSessionsButton}
              onPress={() => setShowSessionList(true)}
            >
              <Text style={styles.viewSessionsButtonText}>
                View Existing Sessions
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleStart}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? "Starting..." : "Start Inbound Session"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Existing Sessions Modal */}
      <Modal
        visible={showSessionList}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowSessionList(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Existing Sessions</Text>
              <TouchableOpacity
                onPress={() => setShowSessionList(false)}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={existingSessions}
              renderItem={renderSessionItem}
              keyExtractor={(item) => item.inbound_session}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No existing sessions found</Text>
              }
            />
            <TouchableOpacity
              style={styles.createNewButton}
              onPress={async () => {
                setShowSessionList(false);
                const settings = await getSettings();
                const userId = settings.user_id || "USER-AUTO";
                const deviceId = settings.device_id || "DEV-AUTO";
                const scannedASN = asnNo.trim().toUpperCase();
                const normalizedASN = normalizeASN(scannedASN);
                const generatedSessionId = dataService.generateSessionId(normalizedASN, deviceId, userId);
                await createNewSession(scannedASN, userId, deviceId, generatedSessionId);
              }}
            >
              <Text style={styles.createNewButtonText}>Create New Session</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  content: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 16,
    color: "#333",
  },
  inputGroup: {
    marginBottom: 12,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    color: "#333",
  },
  value: {
    fontSize: 16,
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  sessionIdDisplay: {
    fontSize: 14,
    padding: 12,
    backgroundColor: "#e3f2fd",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2196F3",
    fontWeight: "600",
    color: "#1976D2",
  },
  input: {
    fontSize: 16,
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 18,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 12,
    marginBottom: 16,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  loadingText: {
    marginLeft: 8,
    fontSize: 16,
    color: "#666",
  },
  hintText: {
    fontSize: 12,
    color: "#999",
    marginTop: 4,
    fontStyle: "italic",
  },
  viewSessionsButton: {
    backgroundColor: "#FF9800",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  viewSessionsButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 12,
    width: "90%",
    maxHeight: "80%",
    padding: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    fontSize: 24,
    color: "#666",
  },
  sessionItem: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  sessionItemContent: {
    marginBottom: 8,
  },
  sessionIdText: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1976D2",
    marginBottom: 4,
  },
  sessionStatusText: {
    fontSize: 14,
    color: "#666",
    marginBottom: 2,
  },
  sessionDateText: {
    fontSize: 12,
    color: "#999",
    marginBottom: 2,
  },
  sessionProgressText: {
    fontSize: 12,
    color: "#999",
  },
  sessionTapHint: {
    fontSize: 12,
    color: "#007AFF",
    fontStyle: "italic",
    textAlign: "right",
  },
  emptyText: {
    textAlign: "center",
    color: "#999",
    padding: 20,
  },
  createNewButton: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  createNewButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});
