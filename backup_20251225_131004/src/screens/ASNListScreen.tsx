import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { dataService } from "../services/data.service";
import { TransferCarton } from "../types";
import { normalizeASN } from "../utils/asn";

interface ASNRecord {
  asn_no: string; // Normalized 4-digit format for display
  asn_no_db?: string; // Original database key for React key uniqueness
  status?: string;
  purchase_order?: string;
  supplier?: string;
  shipment_date?: string;
  expected_arrival_date?: string;
  total_shipped_qty?: number;
  total_carton_count?: number;
  airway_bill_no?: string;
  shipment_type?: string;
  transfer_order?: string;
  dock?: string;
  updated_on: string;
  total_cartons?: number;
  total_pieces?: number;
}

interface TCGroup {
  store: string;
  tcs: TransferCarton[];
}

interface TCSummary {
  tc_id: string;
  ctn_count: number;
  total_pieces: number;
  synced: boolean;
}

interface BoxRecord {
  box_id: string;
  store: string;
}

type ViewState = "ASN_LIST" | "TC_LIST" | "BOX_LIST";

export default function ASNListScreen() {
  const navigation = useNavigation();
  const [viewState, setViewState] = useState<ViewState>("ASN_LIST");
  const [asnList, setAsnList] = useState<ASNRecord[]>([]);
  const [selectedASN, setSelectedASN] = useState<string | null>(null);
  const [tcGroups, setTcGroups] = useState<TCGroup[]>([]);
  const [selectedTC, setSelectedTC] = useState<string | null>(null);
  const [boxList, setBoxList] = useState<BoxRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastTap, setLastTap] = useState<{ tcId: string; time: number } | null>(
    null
  );
  const [tcSummaries, setTcSummaries] = useState<Map<string, TCSummary>>(
    new Map()
  );

  // Load all ASNs
  const loadASNs = useCallback(async () => {
    console.log("🔄 ASNListScreen: Loading ASNs...");
    setLoading(true);
    try {
      const asns = await dataService.getAllASNs();
      console.log("✅ ASNListScreen: Loaded ASNs:", asns.length);
      setAsnList(asns);
    } catch (error: any) {
      console.error("❌ ASNListScreen: Error loading ASNs:", error);
      setAsnList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load Transfer Cartons for selected ASN, grouped by store
  const loadTCs = useCallback(async (asn: string) => {
    console.log("🔄 ASNListScreen: Loading TCs for ASN:", asn);
    setLoading(true);
    try {
      // Normalize ASN for database queries (database stores normalized format)
      const normalizedASN = normalizeASN(asn);
      const allTCs = await dataService.getTransferCartons(normalizedASN);
      console.log("✅ ASNListScreen: Loaded TCs:", allTCs.length);

      // Group TCs by store
      const grouped: Record<string, TransferCarton[]> = {};
      allTCs.forEach((tc) => {
        const store = tc.store || "UNKNOWN";
        if (!grouped[store]) {
          grouped[store] = [];
        }
        grouped[store].push(tc);
      });

      // Convert to array and sort stores
      const groups: TCGroup[] = Object.keys(grouped)
        .sort()
        .map((store) => ({
          store,
          tcs: grouped[store].sort((a, b) => a.tc_id.localeCompare(b.tc_id)),
        }));

      console.log("✅ ASNListScreen: Grouped TCs by store:", groups.length);
      setTcGroups(groups);
      // Use normalized ASN for display (already normalized above)
      setSelectedASN(normalizedASN);
      setViewState("TC_LIST");

      // Load summaries for all TCs
      const summaries = new Map<string, TCSummary>();
      for (const group of groups) {
        for (const tc of group.tcs) {
          try {
            const summary = await dataService.getTCSummary(tc.tc_id);
            summaries.set(tc.tc_id, {
              tc_id: tc.tc_id,
              ...summary,
            });
          } catch (error: any) {
            console.error(`Error loading summary for TC ${tc.tc_id}:`, error);
            summaries.set(tc.tc_id, {
              tc_id: tc.tc_id,
              ctn_count: 0,
              total_pieces: 0,
              synced: false,
            });
          }
        }
      }
      setTcSummaries(summaries);
    } catch (error: any) {
      console.error("❌ ASNListScreen: Error loading TCs:", error);
      setTcGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load boxes for selected TC
  const loadBoxes = useCallback(async (tcId: string) => {
    console.log("🔄 ASNListScreen: Loading boxes for TC:", tcId);
    setLoading(true);
    try {
      const boxes = await dataService.getBoxesForTC(tcId);
      console.log("✅ ASNListScreen: Loaded boxes:", boxes.length);
      setBoxList(boxes);
      setSelectedTC(tcId);
      setViewState("BOX_LIST");
    } catch (error: any) {
      console.error("❌ ASNListScreen: Error loading boxes:", error);
      setBoxList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load ASNs when screen is focused
  useFocusEffect(
    useCallback(() => {
      if (viewState === "ASN_LIST") {
        loadASNs();
      }
    }, [loadASNs, viewState])
  );

  // Handle ASN selection
  const handleASNSelect = (asn: string) => {
    loadTCs(asn);
  };

  // Handle TC selection (double tap)
  const handleTCSelect = (tcId: string) => {
    const now = Date.now();

    if (lastTap && lastTap.tcId === tcId && now - lastTap.time < 500) {
      // Double tap detected
      loadBoxes(tcId);
      setLastTap(null);
    } else {
      // First tap - set timer for potential double tap
      setLastTap({ tcId, time: now });

      // If no second tap within 500ms, clear the tap
      setTimeout(() => {
        setLastTap((prev) => {
          if (prev && prev.tcId === tcId && Date.now() - prev.time >= 500) {
            return null;
          }
          return prev;
        });
      }, 500);
    }
  };

  // Handle back to TC list
  const handleBackToTCs = () => {
    setViewState("TC_LIST");
    setSelectedTC(null);
    setBoxList([]);
  };

  // Handle back to ASN list
  const handleBackToASNs = () => {
    setViewState("ASN_LIST");
    setSelectedASN(null);
    setTcGroups([]);
    setSelectedTC(null);
    setBoxList([]);
  };

  // Get store display name
  const getStoreDisplayName = (store: string): string => {
    if (store === "WAREHOUSE") return "Warehouse";
    if (store.startsWith("SR-")) return `Showroom ${store}`;
    return store;
  };

  // Render ASN List
  const renderASNList = () => {
    return (
      <View style={styles.section}>
        <Text style={styles.title}>ASN List</Text>
        <Text style={styles.subtitle}>
          Select an ASN to view Transfer Cartons by Store
        </Text>
        {loading ? (
          <ActivityIndicator
            size="large"
            color="#007AFF"
            style={styles.loader}
          />
        ) : asnList.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No ASNs found</Text>
            <Text style={styles.emptySubtext}>
              ASNs will appear here after you start an inbound session.
            </Text>
          </View>
        ) : (
          <FlatList
            data={asnList}
            keyExtractor={(item) => item.asn_no_db || item.asn_no}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.asnCard}
                onPress={() => handleASNSelect(item.asn_no)}
              >
                <View style={styles.asnCardHeader}>
                  <Text style={styles.asnNumber}>{item.asn_no}</Text>
                  {item.status && (
                    <View
                      style={[
                        styles.statusBadge,
                        item.status === "Completed"
                          ? styles.statusBadgeCompleted
                          : item.status === "Receiving"
                          ? styles.statusBadgeReceiving
                          : item.status === "Approved"
                          ? styles.statusBadgeApproved
                          : styles.statusBadgeDraft,
                      ]}
                    >
                      <Text style={styles.statusText}>{item.status}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.asnDetailsRow}>
                  {item.supplier && (
                    <View style={styles.asnDetailItem}>
                      <Text style={styles.asnDetailLabel}>Supplier:</Text>
                      <Text style={styles.asnDetailValue}>{item.supplier}</Text>
                    </View>
                  )}
                  {item.purchase_order && (
                    <View style={styles.asnDetailItem}>
                      <Text style={styles.asnDetailLabel}>PO:</Text>
                      <Text style={styles.asnDetailValue}>
                        {item.purchase_order}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.asnDetailsRow}>
                  {item.expected_arrival_date && (
                    <View style={styles.asnDetailItem}>
                      <Text style={styles.asnDetailLabel}>Expected:</Text>
                      <Text style={styles.asnDetailValue}>
                        {new Date(
                          item.expected_arrival_date
                        ).toLocaleDateString()}
                      </Text>
                    </View>
                  )}
                  {item.shipment_type && (
                    <View style={styles.asnDetailItem}>
                      <Text style={styles.asnDetailLabel}>Type:</Text>
                      <Text style={styles.asnDetailValue}>
                        {item.shipment_type}
                      </Text>
                    </View>
                  )}
                </View>
                <View style={styles.asnDetailsRow}>
                  {item.total_cartons !== undefined && (
                    <View style={styles.asnDetailItem}>
                      <Text style={styles.asnDetailLabel}>Cartons:</Text>
                      <Text style={styles.asnDetailValue}>
                        {item.total_cartons}
                      </Text>
                    </View>
                  )}
                  {item.total_pieces !== undefined && (
                    <View style={styles.asnDetailItem}>
                      <Text style={styles.asnDetailLabel}>Total Pcs:</Text>
                      <Text style={styles.asnDetailValue}>
                        {item.total_pieces}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={styles.asnDate}>
                  Updated: {new Date(item.updated_on).toLocaleString()}
                </Text>
                <Text style={styles.tapHint}>
                  Tap to view Transfer Cartons →
                </Text>
              </TouchableOpacity>
            )}
            scrollEnabled={false}
          />
        )}
      </View>
    );
  };

  // Render TC List (grouped by store)
  const renderTCList = () => {
    return (
      <View style={styles.section}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Transfer Cartons for {selectedASN}</Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBackToASNs}
          >
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
        </View>
        {loading ? (
          <ActivityIndicator
            size="large"
            color="#007AFF"
            style={styles.loader}
          />
        ) : tcGroups.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No Transfer Cartons found</Text>
            <Text style={styles.emptySubtext}>
              This ASN has no Transfer Cartons recorded.
            </Text>
          </View>
        ) : (
          <>
            {tcGroups.map((group) => (
              <View key={group.store} style={styles.storeGroup}>
                <Text style={styles.storeTitle}>
                  {getStoreDisplayName(group.store)}
                </Text>
                <FlatList
                  data={group.tcs}
                  keyExtractor={(item) => item.tc_id}
                  renderItem={({ item }) => {
                    const summary = tcSummaries.get(item.tc_id) || {
                      tc_id: item.tc_id,
                      ctn_count: 0,
                      total_pieces: 0,
                      synced: false,
                    };
                    return (
                      <TouchableOpacity
                        style={styles.tcCard}
                        onPress={() => handleTCSelect(item.tc_id)}
                      >
                        <View style={styles.tcCardHeader}>
                          <Text style={styles.tcId}>{item.tc_id}</Text>
                          <View style={styles.tcStatusBadge}>
                            <Text style={styles.tcStatusText}>
                              {item.status}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.tcDetailsRow}>
                          <View style={styles.tcDetailItem}>
                            <Text style={styles.tcDetailLabel}>CTNs:</Text>
                            <Text style={styles.tcDetailValue}>
                              {summary.ctn_count}
                            </Text>
                          </View>
                          <View style={styles.tcDetailItem}>
                            <Text style={styles.tcDetailLabel}>Total Pcs:</Text>
                            <Text style={styles.tcDetailValue}>
                              {summary.total_pieces}
                            </Text>
                          </View>
                          <View
                            style={[
                              styles.syncBadge,
                              summary.synced
                                ? styles.syncBadgeSynced
                                : styles.syncBadgePending,
                            ]}
                          >
                            <Text
                              style={[
                                styles.syncBadgeText,
                                summary.synced
                                  ? styles.syncBadgeTextSynced
                                  : styles.syncBadgeTextPending,
                              ]}
                            >
                              {summary.synced ? "Synced" : "Pending"}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.tcDetail}>
                          Updated:{" "}
                          {new Date(item.updated_on).toLocaleDateString()}
                        </Text>
                        <Text style={styles.tapHint}>
                          Double tap to view boxes/cartons
                        </Text>
                      </TouchableOpacity>
                    );
                  }}
                  scrollEnabled={false}
                />
              </View>
            ))}
          </>
        )}
      </View>
    );
  };

  // Render Box List
  const renderBoxList = () => {
    return (
      <View style={styles.section}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Boxes/Cartons in {selectedTC}</Text>
          <TouchableOpacity style={styles.backButton} onPress={handleBackToTCs}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
        </View>
        {loading ? (
          <ActivityIndicator
            size="large"
            color="#007AFF"
            style={styles.loader}
          />
        ) : boxList.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No boxes found</Text>
            <Text style={styles.emptySubtext}>
              This Transfer Carton has no boxes/cartons packed.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.summaryText}>
              Total Boxes/Cartons: {boxList.length}
            </Text>
            <FlatList
              data={boxList}
              keyExtractor={(item) => item.box_id}
              renderItem={({ item }) => (
                <View style={styles.boxCard}>
                  <View style={styles.boxCardHeader}>
                    <Text style={styles.boxId}>{item.box_id}</Text>
                    <View style={styles.storeBadge}>
                      <Text style={styles.storeBadgeText}>
                        {getStoreDisplayName(item.store)}
                      </Text>
                    </View>
                  </View>
                </View>
              )}
              scrollEnabled={false}
            />
          </>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        {viewState === "ASN_LIST"
          ? renderASNList()
          : viewState === "TC_LIST"
          ? renderTCList()
          : renderBoxList()}
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
  section: {
    backgroundColor: "#fff",
    marginTop: 12,
    padding: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#E0E0E0",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
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
  loader: {
    marginVertical: 20,
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
  },
  asnCard: {
    backgroundColor: "#F9F9F9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: "#007AFF",
  },
  asnCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  asnNumber: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  asnDetailsRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 4,
    flexWrap: "wrap",
  },
  asnDetailItem: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 16,
    marginBottom: 4,
  },
  asnDetailLabel: {
    fontSize: 12,
    color: "#666",
    marginRight: 4,
    fontWeight: "600",
  },
  asnDetailValue: {
    fontSize: 13,
    color: "#333",
    fontWeight: "600",
  },
  asnDate: {
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
  storeGroup: {
    marginBottom: 20,
  },
  storeTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#007AFF",
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: "#007AFF",
  },
  tcCard: {
    backgroundColor: "#F9F9F9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: "#9C27B0",
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
  tcStatusBadge: {
    backgroundColor: "#9C27B0",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tcStatusText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  tcDetail: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  summaryText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  boxCard: {
    backgroundColor: "#F9F9F9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: "#4CAF50",
  },
  boxCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  boxId: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  storeBadge: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  storeBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  tcDetailsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 4,
  },
  tcDetailItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  tcDetailLabel: {
    fontSize: 12,
    color: "#666",
    marginRight: 4,
    fontWeight: "600",
  },
  tcDetailValue: {
    fontSize: 14,
    color: "#333",
    fontWeight: "600",
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
    fontSize: 11,
    fontWeight: "600",
  },
  syncBadgeTextSynced: {
    color: "#fff",
  },
  syncBadgeTextPending: {
    color: "#fff",
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeCompleted: {
    backgroundColor: "#4CAF50",
  },
  statusBadgeReceiving: {
    backgroundColor: "#2196F3",
  },
  statusBadgeApproved: {
    backgroundColor: "#9C27B0",
  },
  statusBadgeDraft: {
    backgroundColor: "#FF9800",
  },
  statusText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
});
