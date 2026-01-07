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
import { CycleCount } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { getSettings } from "../services/settings.service";

// Removed mock data - data should come from backend API
// Mock data function removed
/*
const getMockCycleCountByTitle = (title: string): CycleCount | null => {
  const mockData: Record<string, CycleCount> = {
    "CC-0001": {
      title: "CC-0001",
      status: "In Progress",
      count_type: "Cycle",
      warehouse: "WH-MAIN",
      zone: "ZONE-A",
      count_date: "2025-01-27",
      total_items: 10,
      counted_items: 5,
      items_with_discrepancy: 2,
      freeze_stock: false,
      created_by: "SYSTEM",
      created_on: "2025-01-27T08:00:00.000Z",
      updated_on: "2025-01-27T10:30:00.000Z",
      items: [
        {
          id: 1,
          item_code: "ITEM-001",
          bin_location: "BIN-001",
          expected_qty: 50.0,
          actual_qty: 48.0,
          discrepancy: -2.0,
          status: "Counted",
          counted_by: "USER-001",
          counted_on: "2025-01-27T10:00:00.000Z",
          discrepancy_reason: "Found 2 damaged units",
        },
        {
          id: 2,
          item_code: "ITEM-002",
          bin_location: "BIN-002",
          expected_qty: 30.0,
          actual_qty: 32.0,
          discrepancy: 2.0,
          status: "Counted",
          counted_by: "USER-001",
          counted_on: "2025-01-27T10:15:00.000Z",
          discrepancy_reason: "Found 2 extra units",
        },
        {
          id: 3,
          item_code: "ITEM-003",
          bin_location: "BIN-003",
          expected_qty: 25.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 4,
          item_code: "ITEM-004",
          bin_location: "BIN-004",
          expected_qty: 40.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 5,
          item_code: "ITEM-005",
          bin_location: "BIN-005",
          expected_qty: 20.0,
          actual_qty: 20.0,
          discrepancy: 0.0,
          status: "Counted",
          counted_by: "USER-001",
          counted_on: "2025-01-27T09:45:00.000Z",
        },
        {
          id: 6,
          item_code: "ITEM-006",
          bin_location: "BIN-006",
          expected_qty: 35.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 7,
          item_code: "ITEM-007",
          bin_location: "BIN-007",
          expected_qty: 15.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 8,
          item_code: "ITEM-008",
          bin_location: "BIN-008",
          expected_qty: 28.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 9,
          item_code: "ITEM-009",
          bin_location: "BIN-009",
          expected_qty: 22.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 10,
          item_code: "ITEM-010",
          bin_location: "BIN-010",
          expected_qty: 18.0,
          actual_qty: undefined,
          status: "Pending",
        },
      ],
    },
    "CC-0002": {
      title: "CC-0002",
      status: "Scheduled",
      count_type: "Full",
      warehouse: "WH-MAIN",
      zone: "ZONE-B",
      count_date: "2025-01-28",
      total_items: 8,
      counted_items: 0,
      items_with_discrepancy: 0,
      freeze_stock: true,
      created_by: "SYSTEM",
      created_on: "2025-01-26T14:00:00.000Z",
      updated_on: "2025-01-26T14:00:00.000Z",
      items: [
        {
          id: 11,
          item_code: "ITEM-011",
          bin_location: "BIN-011",
          expected_qty: 60.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 12,
          item_code: "ITEM-012",
          bin_location: "BIN-012",
          expected_qty: 45.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 13,
          item_code: "ITEM-013",
          bin_location: "BIN-013",
          expected_qty: 30.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 14,
          item_code: "ITEM-014",
          bin_location: "BIN-014",
          expected_qty: 55.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 15,
          item_code: "ITEM-015",
          bin_location: "BIN-015",
          expected_qty: 25.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 16,
          item_code: "ITEM-016",
          bin_location: "BIN-016",
          expected_qty: 40.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 17,
          item_code: "ITEM-017",
          bin_location: "BIN-017",
          expected_qty: 35.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 18,
          item_code: "ITEM-018",
          bin_location: "BIN-018",
          expected_qty: 50.0,
          actual_qty: undefined,
          status: "Pending",
        },
      ],
    },
    "CC-0003": {
      title: "CC-0003",
      status: "Draft",
      count_type: "Spot",
      warehouse: "WH-MAIN",
      zone: null,
      count_date: "2025-01-29",
      total_items: 5,
      counted_items: 0,
      items_with_discrepancy: 0,
      freeze_stock: false,
      created_by: "USER-001",
      created_on: "2025-01-25T16:00:00.000Z",
      updated_on: "2025-01-25T16:00:00.000Z",
      items: [
        {
          id: 19,
          item_code: "ITEM-019",
          bin_location: "BIN-019",
          expected_qty: 12.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 20,
          item_code: "ITEM-020",
          bin_location: "BIN-020",
          expected_qty: 8.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 21,
          item_code: "ITEM-021",
          bin_location: "BIN-021",
          expected_qty: 15.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 22,
          item_code: "ITEM-022",
          bin_location: "BIN-022",
          expected_qty: 10.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 23,
          item_code: "ITEM-023",
          bin_location: "BIN-023",
          expected_qty: 20.0,
          actual_qty: undefined,
          status: "Pending",
        },
      ],
    },
  };

  return mockData[title] || null;
};
*/

export default function CycleCountDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { cycleCountTitle } = (route.params as any) || {};
  
  const [cycleCount, setCycleCount] = useState<CycleCount | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (cycleCountTitle) {
      loadCycleCount();
    }
  }, [cycleCountTitle]);

  const loadCycleCount = async () => {
    if (!cycleCountTitle) return;
    
    setLoading(true);
    try {
      const response = await apiService.getCycleCount(cycleCountTitle);
      
      // Handle different response formats
      let cc: any = null;
      if (response && typeof response === "object") {
        if (response.data) {
          cc = response.data;
        } else if (response.cycle_count) {
          cc = response.cycle_count;
        } else {
          cc = response;
        }
      }

      if (cc) {
        // API returns 'lines' but mobile app uses 'items' - map lines to items for compatibility
        if (cc.lines && !cc.items) {
          cc.items = cc.lines;
        }
        setCycleCount(cc);
      } else {
        // No data from API
        console.warn(`⚠️ CycleCountDetailScreen: No data found for ${cycleCountTitle}`);
        Alert.alert("Error", "Cycle Count not found. Please ensure backend has this Cycle Count task.");
        navigation.goBack();
      }
    } catch (error: any) {
      console.error("❌ Error loading Cycle Count:", error);
      Alert.alert("Error", `Failed to load Cycle Count: ${error.message}\n\nPlease ensure backend is available and has this Cycle Count task.`);
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const handleStartCounting = async () => {
    if (!cycleCount) return;
    
    if (cycleCount.status !== "In Progress" && cycleCount.status !== "Scheduled") {
      Alert.alert(
        "Cannot Start Counting",
        `Cycle Count ${cycleCount.title} is ${cycleCount.status}. Only 'Scheduled' or 'In Progress' Cycle Counts can be counted.`
      );
      return;
    }

    // If status is "Scheduled", start the task first
    if (cycleCount.status === "Scheduled") {
      try {
        const settings = await getSettings();
        await apiService.startCycleCount(cycleCount.title, {
          started_by: settings.user_id || settings.user_code || "USER-AUTO",
        });
        // Reload to get updated status
        await loadCycleCount();
      } catch (error: any) {
        Alert.alert("Error", `Failed to start Cycle Count: ${error.message}`);
        return;
      }
    }

    // Navigate to Counting screen
    (navigation as any).navigate("CycleCountCounting", {
      cycleCountTitle: cycleCount.title,
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Draft":
        return "#9E9E9E";
      case "Scheduled":
        return "#2196F3";
      case "In Progress":
        return "#9C27B0";
      case "Completed":
        return "#2196F3";
      case "Approved":
        return "#4CAF50";
      case "Cancelled":
        return "#F44336";
      default:
        return "#9E9E9E";
    }
  };

  const renderItem = ({ item, index }: { item: any; index: number }) => {
    const expectedQty = item.expected_qty || 0;
    const actualQty = item.actual_qty;
    const discrepancy = actualQty !== undefined ? actualQty - expectedQty : null;
    const isCounted = actualQty !== undefined;
    const itemStatus = item.status || (isCounted ? "Counted" : "Pending");

    return (
      <View style={styles.itemCard}>
        <View style={styles.itemHeader}>
          <View style={styles.itemHeaderLeft}>
            <Text style={styles.itemIndex}>#{index + 1}</Text>
            <Text style={styles.itemCode}>{item.item_code}</Text>
          </View>
          <StatusBadge
            status={itemStatus}
            color={isCounted ? "#4CAF50" : "#9E9E9E"}
          />
        </View>
        <View style={styles.itemDetails}>
          {item.bin_location && (
            <View style={styles.qtyRow}>
              <Text style={styles.qtyLabel}>Bin Location:</Text>
              <Text style={styles.qtyValue}>{item.bin_location}</Text>
            </View>
          )}
          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>Expected:</Text>
            <Text style={styles.qtyValue}>{expectedQty}</Text>
          </View>
          {isCounted ? (
            <>
              <View style={styles.qtyRow}>
                <Text style={styles.qtyLabel}>Actual:</Text>
                <Text style={[styles.qtyValue, { color: "#2196F3" }]}>
                  {actualQty}
                </Text>
              </View>
              <View style={styles.qtyRow}>
                <Text style={styles.qtyLabel}>Discrepancy:</Text>
                <Text
                  style={[
                    styles.qtyValue,
                    {
                      color:
                        discrepancy === 0
                          ? "#4CAF50"
                          : discrepancy! > 0
                          ? "#FF9800"
                          : "#F44336",
                    },
                  ]}
                >
                  {discrepancy! > 0 ? "+" : ""}
                  {discrepancy}
                </Text>
              </View>
              {item.counted_by && (
                <View style={styles.qtyRow}>
                  <Text style={styles.qtyLabel}>Counted by:</Text>
                  <Text style={styles.qtyValue}>{item.counted_by}</Text>
                </View>
              )}
              {item.counted_on && (
                <View style={styles.qtyRow}>
                  <Text style={styles.qtyLabel}>Counted on:</Text>
                  <Text style={styles.qtyValue}>
                    {new Date(item.counted_on).toLocaleString()}
                  </Text>
                </View>
              )}
              {item.reviewed_by && (
                <View style={styles.qtyRow}>
                  <Text style={styles.qtyLabel}>Reviewed by:</Text>
                  <Text style={styles.qtyValue}>{item.reviewed_by}</Text>
                </View>
              )}
              {item.reviewed_on && (
                <View style={styles.qtyRow}>
                  <Text style={styles.qtyLabel}>Reviewed on:</Text>
                  <Text style={styles.qtyValue}>
                    {new Date(item.reviewed_on).toLocaleString()}
                  </Text>
                </View>
              )}
              {item.approved_by && (
                <View style={styles.qtyRow}>
                  <Text style={styles.qtyLabel}>Approved by:</Text>
                  <Text style={styles.qtyValue}>{item.approved_by}</Text>
                </View>
              )}
              {item.approved_on && (
                <View style={styles.qtyRow}>
                  <Text style={styles.qtyLabel}>Approved on:</Text>
                  <Text style={styles.qtyValue}>
                    {new Date(item.approved_on).toLocaleString()}
                  </Text>
                </View>
              )}
              {item.discrepancy_reason && (
                <View style={styles.qtyRow}>
                  <Text style={styles.qtyLabel}>Discrepancy Reason:</Text>
                  <Text style={styles.qtyValue}>{item.discrepancy_reason}</Text>
                </View>
              )}
            </>
          ) : (
            <Text style={styles.pendingText}>Not counted yet</Text>
          )}
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#9C27B0" />
        <Text style={styles.loadingText}>Loading Cycle Count...</Text>
      </View>
    );
  }

  if (!cycleCount) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Cycle Count not found</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const totalItems = cycleCount.total_items || cycleCount.items?.length || 0;
  const countedItems = cycleCount.counted_items !== undefined 
    ? cycleCount.counted_items 
    : cycleCount.items?.filter((i) => i.actual_qty !== undefined).length || 0;
  const progress = totalItems > 0 ? (countedItems / totalItems) * 100 : 0;
  const discrepancies = cycleCount.items_with_discrepancy !== undefined
    ? cycleCount.items_with_discrepancy
    : cycleCount.items?.filter((i) => {
        if (i.actual_qty === undefined) return false;
        const discrepancy = i.actual_qty - (i.expected_qty || 0);
        return discrepancy !== 0;
      }).length || 0;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{cycleCount.title}</Text>
        <StatusBadge
          status={cycleCount.status}
          color={getStatusColor(cycleCount.status)}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Cycle Count Information</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Warehouse:</Text>
          <Text style={styles.infoValue}>{cycleCount.warehouse}</Text>
        </View>
        {cycleCount.zone && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Zone:</Text>
            <Text style={styles.infoValue}>{cycleCount.zone}</Text>
          </View>
        )}
        {cycleCount.count_type && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Count Type:</Text>
            <Text style={styles.infoValue}>{cycleCount.count_type}</Text>
          </View>
        )}
        {cycleCount.count_date && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Count Date:</Text>
            <Text style={styles.infoValue}>
              {new Date(cycleCount.count_date).toLocaleDateString()}
            </Text>
          </View>
        )}
        {cycleCount.scheduled_start_time && cycleCount.scheduled_end_time && (
          <>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Scheduled Start:</Text>
              <Text style={styles.infoValue}>{cycleCount.scheduled_start_time}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Scheduled End:</Text>
              <Text style={styles.infoValue}>{cycleCount.scheduled_end_time}</Text>
            </View>
          </>
        )}
        {cycleCount.freeze_stock !== undefined && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Freeze Stock:</Text>
            <Text style={styles.infoValue}>
              {cycleCount.freeze_stock ? "Yes" : "No"}
            </Text>
          </View>
        )}
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Created By:</Text>
          <Text style={styles.infoValue}>{cycleCount.created_by || "N/A"}</Text>
        </View>
        {cycleCount.assigned_to && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Assigned To:</Text>
            <Text style={styles.infoValue}>{cycleCount.assigned_to}</Text>
          </View>
        )}
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Created On:</Text>
          <Text style={styles.infoValue}>
            {cycleCount.created_on
              ? new Date(cycleCount.created_on).toLocaleDateString()
              : "N/A"}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Progress Summary</Text>
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Items:</Text>
            <Text style={styles.summaryValue}>{totalItems}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Counted:</Text>
            <Text style={[styles.summaryValue, { color: "#4CAF50" }]}>
              {countedItems}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Remaining:</Text>
            <Text style={[styles.summaryValue, { color: "#FF9800" }]}>
              {totalItems - countedItems}
            </Text>
          </View>
          {discrepancies > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Discrepancies:</Text>
              <Text style={[styles.summaryValue, { color: "#FF9800" }]}>
                {discrepancies} item(s)
              </Text>
            </View>
          )}
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${progress}%`,
                    backgroundColor: progress === 100 ? "#4CAF50" : "#9C27B0",
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>{Math.round(progress)}% Complete</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Items ({totalItems})</Text>
        <FlatList
          data={cycleCount.items || []}
          keyExtractor={(item, index) => `${item.item_code}-${index}`}
          renderItem={renderItem}
          scrollEnabled={false}
        />
      </View>

      {(cycleCount.status === "In Progress" || cycleCount.status === "Scheduled") && (
        <View style={styles.actionSection}>
          <TouchableOpacity
            style={styles.startButton}
            onPress={handleStartCounting}
          >
            <Text style={styles.startButtonText}>Start Counting</Text>
          </TouchableOpacity>
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
    backgroundColor: "#9C27B0",
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
    color: "#9C27B0",
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
  itemHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  itemIndex: {
    fontSize: 12,
    color: "#666",
    marginRight: 8,
    fontWeight: "bold",
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
  pendingText: {
    fontSize: 14,
    color: "#999",
    fontStyle: "italic",
  },
  actionSection: {
    padding: 16,
    paddingBottom: 32,
  },
  startButton: {
    backgroundColor: "#9C27B0",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  startButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
});

