import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useApp } from "../context/AppContext";
import {
  getUnsyncedEvents,
  syncEvents,
  clearErrorMessages,
} from "../services/event-queue.service";
import { dataService } from "../services/data.service";
import {
  syncMasterDataFromDesktop,
  type MasterSyncProgress,
} from "../services/master-data-sync.service";
import { syncAllUnsyncedSessions } from "../services/session-sync.service";
import { resendReceiveLinesToBackend } from "../services/receive-lines-resend.service";
import { normalizeASN } from "../utils/asn";
import { ScanEvent } from "../types";

export default function SyncCenterScreen() {
  const { refreshPendingEvents, activeASN, activeSession } = useApp();
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncingMasters, setSyncingMasters] = useState(false);
  const [syncStatusLine, setSyncStatusLine] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const formatMasterProgress = (p: MasterSyncProgress) =>
    `${p.phase} (${p.step}/${p.totalSteps})${p.detail ? ` — ${p.detail}` : ""}`;

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    const unsynced = await getUnsyncedEvents();
    setEvents(unsynced);
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncStatusLine("");
    try {
      // First sync master data from desktop
      setSyncingMasters(true);
      setSyncStatusLine("Master data: starting…");
      try {
        const masterResult = await syncMasterDataFromDesktop({
          onProgress: (p) => {
            setSyncStatusLine(`Master data: ${formatMasterProgress(p)}`);
          },
        });
        setSyncingMasters(false);

        const masterSummary = `
Items: ${masterResult.items.synced} synced, ${masterResult.items.failed} failed
ASNs: ${masterResult.asns.synced} synced, ${masterResult.asns.failed} failed
Transfer Orders: ${masterResult.transferOrders.synced} synced, ${masterResult.transferOrders.failed} failed
Boxes: ${masterResult.boxes.synced} synced, ${masterResult.boxes.failed} failed
Transfer Cartons: ${masterResult.transferCartons.synced} synced, ${masterResult.transferCartons.failed} failed
Warehouse Racks: ${masterResult.warehouseRacks.synced} synced, ${masterResult.warehouseRacks.failed} failed
Warehouses: ${masterResult.warehouses.synced} synced, ${masterResult.warehouses.failed} failed
Locations: ${masterResult.locations.synced} synced, ${masterResult.locations.failed} failed
Bin Master: ${masterResult.binMaster.synced} synced, ${masterResult.binMaster.failed} failed
Stock Ledger: ${masterResult.stockLedger.synced} synced, ${masterResult.stockLedger.failed} failed
Item Barcode Map: ${masterResult.itemBarcodeMap.synced} synced, ${masterResult.itemBarcodeMap.failed} failed
        `.trim();

        console.log("Master data sync result:", masterSummary);
      } catch (error: any) {
        setSyncingMasters(false);
        console.error("Master data sync error:", error);
        setSyncStatusLine("Master data: error (continuing with sessions & events)…");
        // Continue with event sync even if master sync fails
      }

      // Small delay between master data and session sync
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Sync sessions to backend
      setSyncStatusLine("Sessions: uploading…");
      try {
        const sessionResult = await syncAllUnsyncedSessions();
        console.log(
          `Session sync: ${sessionResult.synced} synced, ${sessionResult.failed} failed`
        );
      } catch (error: any) {
        console.error("Session sync error:", error);
        // Continue with event sync even if session sync fails
      }

      // Small delay between session sync and event sync
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then sync events to desktop
      setSyncStatusLine("Events: uploading…");
      const result = await syncEvents();
      await loadEvents();
      await refreshPendingEvents();

      // Resend receive lines for active inbound session so backend Recvd Qty stays in sync
      let receiveResendMsg = "";
      if (activeASN && activeSession) {
        setSyncStatusLine("Receive data: syncing with backend…");
        try {
          const resend = await resendReceiveLinesToBackend(activeASN, activeSession);
          if (resend.linesSent > 0) {
            receiveResendMsg = `\nReceive data: ${resend.linesSent} line(s) from ${resend.cartonsSent} carton(s) resent.`;
          }
        } catch (e: any) {
          console.warn("Resend receive lines during sync failed:", e?.message);
          receiveResendMsg = "\nReceive data resend failed (see console).";
        }
      }

      setSyncStatusLine("");
      Alert.alert(
        "Sync Complete",
        `Events synced: ${result.synced}\nEvents failed: ${result.failed}\n\nMaster data and sessions have been synced.${receiveResendMsg}`
      );
    } catch (error: any) {
      setSyncStatusLine("");
      Alert.alert("Sync Error", error.message || "Failed to sync events");
    } finally {
      setSyncing(false);
      setSyncingMasters(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadEvents();
    setRefreshing(false);
  };

  const handleVerifyData = async () => {
    if (!activeASN) {
      Alert.alert("Error", "No active ASN to verify");
      return;
    }

    try {
      const normalizedASN = normalizeASN(activeASN);
      const verification = await dataService.getDataVerification(
        normalizedASN,
        activeSession || undefined
      );

      const scannedItems = await dataService.getScannedItems(
        normalizedASN,
        activeSession || undefined
      );
      const summary = (await dataService.getScannedItemsSummary(
        normalizedASN,
        activeSession || undefined
      )) as Array<{
        carton_id: string;
        item_code: string;
        box_id: string;
        total_qty: number;
      }>;

      const message = `
📊 Data Verification for ${normalizedASN}

📦 Events: ${verification.events}
✅ Scanned Items: ${verification.scannedItems}
📋 Carton Statuses: ${verification.cartonStatuses}
📦 Boxes: ${verification.boxes}
🚚 Transfer Cartons: ${verification.transferCartons}

📊 Scanned Items Summary:
${
  summary.length > 0
    ? summary
        .map(
          (s) =>
            `  • ${s.carton_id}: ${s.item_code} → ${s.box_id} (${s.total_qty} qty)`
        )
        .join("\n")
    : "  No items scanned yet"
}

✅ All data is saved to database tables!
      `.trim();

      Alert.alert("Data Verification", message);
    } catch (error: any) {
      Alert.alert(
        "Verification Error",
        error.message || "Failed to verify data"
      );
    }
  };

  const getEventTypeColor = (eventType: string) => {
    switch (eventType) {
      case "UNLOAD_SCAN":
        return "#4CAF50";
      case "RECEIVE_ITEM_SCAN":
        return "#2196F3";
      case "SORT_TO_BOX":
        return "#FF9800";
      case "PACK_BOX_TO_TC":
        return "#9C27B0";
      case "TC_DISPATCH":
        return "#F44336";
      default:
        return "#757575";
    }
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Sync Center</Text>
          <Text style={styles.headerSubtitle}>
            {events.length} unsynced event{events.length !== 1 ? "s" : ""}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.syncButton,
            (syncing || syncingMasters) && styles.syncButtonDisabled,
          ]}
          onPress={handleSync}
          disabled={syncing || syncingMasters}
        >
          {syncing || syncingMasters ? (
            <View style={styles.syncButtonLoading}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.syncButtonText}>
                {syncingMasters
                  ? "Syncing Master Data..."
                  : "Syncing Events..."}
              </Text>
            </View>
          ) : (
            <Text style={styles.syncButtonText}>Sync Now</Text>
          )}
        </TouchableOpacity>

        {syncStatusLine ? (
          <Text style={styles.syncStatusText}>{syncStatusLine}</Text>
        ) : null}

        {activeASN && (
          <TouchableOpacity
            style={styles.verifyButton}
            onPress={handleVerifyData}
          >
            <Text style={styles.verifyButtonText}>
              📊 Verify All Saved Data
            </Text>
          </TouchableOpacity>
        )}

        {__DEV__ && (
          <TouchableOpacity
            style={[styles.verifyButton, { backgroundColor: "#9C27B0", marginTop: 10 }]}
            onPress={async () => {
              try {
                Alert.alert(
                  "🧪 Run Inbound Workflow Test",
                  "This will test all API endpoints in the inbound workflow. Check console for detailed results.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Run Test",
                      onPress: async () => {
                        try {
                          const { runInboundWorkflowTest } = await import("../utils/test-inbound-workflow");
                          await runInboundWorkflowTest();
                          Alert.alert(
                            "✅ Test Completed",
                            "Check console logs for detailed test results."
                          );
                        } catch (error: any) {
                          Alert.alert("❌ Test Error", error.message);
                        }
                      },
                    },
                  ]
                );
              } catch (error: any) {
                Alert.alert("Error", error.message);
              }
            }}
          >
            <Text style={styles.verifyButtonText}>
              🧪 Test Inbound Workflow APIs
            </Text>
          </TouchableOpacity>
        )}

        {events.some((e) => e.error_msg) && (
          <TouchableOpacity
            style={styles.clearErrorsButton}
            onPress={async () => {
              await clearErrorMessages();
              await loadEvents();
              Alert.alert(
                "Success",
                "Error messages cleared. Try syncing again."
              );
            }}
          >
            <Text style={styles.clearErrorsButtonText}>
              🗑️ Clear Error Messages & Retry
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.eventsSection}>
          <Text style={styles.sectionTitle}>Unsynced Events</Text>
          {events.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>All events synced! ✓</Text>
            </View>
          ) : (
            <FlatList
              data={events}
              keyExtractor={(item) => item.offline_uuid}
              renderItem={({ item }) => (
                <View style={styles.eventItem}>
                  <View
                    style={[
                      styles.eventTypeBadge,
                      { backgroundColor: getEventTypeColor(item.event_type) },
                    ]}
                  >
                    <Text style={styles.eventTypeText}>{item.event_type}</Text>
                  </View>
                  <View style={styles.eventDetails}>
                    {item.asn_no && (
                      <Text style={styles.eventDetail}>ASN: {item.asn_no}</Text>
                    )}
                    {item.carton_id && (
                      <Text style={styles.eventDetail}>
                        Carton: {item.carton_id}
                      </Text>
                    )}
                    {item.item_code && (
                      <Text style={styles.eventDetail}>
                        Item: {item.item_code}
                      </Text>
                    )}
                    {item.box_id && (
                      <Text style={styles.eventDetail}>BOX: {item.box_id}</Text>
                    )}
                    {item.tc_id && (
                      <Text style={styles.eventDetail}>TC: {item.tc_id}</Text>
                    )}
                    <Text style={styles.eventTime}>
                      {new Date(item.event_time).toLocaleString()}
                    </Text>
                    {item.error_msg && (
                      <Text style={styles.errorText}>
                        Error: {item.error_msg}
                      </Text>
                    )}
                  </View>
                </View>
              )}
              scrollEnabled={false}
            />
          )}
        </View>
      </View>
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
  header: {
    backgroundColor: "#007AFF",
    padding: 20,
    borderRadius: 8,
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: "#fff",
    opacity: 0.9,
  },
  syncButton: {
    backgroundColor: "#4CAF50",
    padding: 18,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 16,
  },
  syncButtonDisabled: {
    opacity: 0.5,
  },
  syncButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  syncButtonLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  syncStatusText: {
    fontSize: 14,
    color: "#333",
    marginBottom: 14,
    lineHeight: 20,
  },
  verifyButton: {
    backgroundColor: "#2196F3",
    padding: 18,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 16,
  },
  verifyButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  clearErrorsButton: {
    backgroundColor: "#FF9800",
    padding: 18,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 16,
  },
  clearErrorsButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  eventsSection: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 16,
    color: "#333",
  },
  emptyContainer: {
    padding: 32,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    color: "#4CAF50",
    fontWeight: "600",
  },
  eventItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  eventTypeBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignSelf: "flex-start",
    marginBottom: 8,
  },
  eventTypeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  eventDetails: {
    marginTop: 8,
  },
  eventDetail: {
    fontSize: 14,
    color: "#333",
    marginBottom: 4,
  },
  eventTime: {
    fontSize: 12,
    color: "#999",
    marginTop: 8,
  },
  errorText: {
    fontSize: 12,
    color: "#F44336",
    marginTop: 4,
    fontStyle: "italic",
  },
});
