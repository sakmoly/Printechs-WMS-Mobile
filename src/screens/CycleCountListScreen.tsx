import React, { useState, useEffect, useCallback } from "react";
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
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { apiService } from "../services/api.service";
import { getDatabase } from "../database/database";
import { CycleCount } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { getSettings } from "../services/settings.service";
import { ensureItemsCachedForCodes } from "../services/transaction-item-cache.service";

// Removed mock data - data should come from backend API

export default function CycleCountListScreen() {
  const navigation = useNavigation();
  const [cycleCounts, setCycleCounts] = useState<CycleCount[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Load Cycle Counts from backend and cache locally
  const loadCycleCounts = useCallback(async () => {
    console.log("🔄 CycleCountListScreen: Loading Cycle Counts...");
    setLoading(true);
    try {
      // Fetch from backend - show all tasks (no filter) to see all available Cycle Counts
      // Users can filter by status if needed, but by default show all
      const response = await apiService.getCycleCounts();
      
      console.log(`📥 CycleCountListScreen: Raw API response:`, {
        isArray: Array.isArray(response),
        hasData: !!response?.data,
        hasItems: !!response?.items,
        hasCycleCounts: !!response?.cycle_counts,
        responseKeys: response && typeof response === "object" ? Object.keys(response) : [],
        responseType: typeof response,
      });
      
      // Handle different response formats
      let ccList: any[] = [];
      if (Array.isArray(response)) {
        ccList = response;
        console.log(`📦 CycleCountListScreen: Response is direct array with ${ccList.length} items`);
      } else if (response && typeof response === "object") {
        if (Array.isArray(response.data)) {
          ccList = response.data;
          console.log(`📦 CycleCountListScreen: Found ${ccList.length} items in response.data`);
        } else if (Array.isArray(response.items)) {
          ccList = response.items;
          console.log(`📦 CycleCountListScreen: Found ${ccList.length} items in response.items`);
        } else if (Array.isArray(response.cycle_counts)) {
          ccList = response.cycle_counts;
          console.log(`📦 CycleCountListScreen: Found ${ccList.length} items in response.cycle_counts`);
        } else {
          console.warn(`⚠️ CycleCountListScreen: Unexpected response format:`, JSON.stringify(response).substring(0, 200));
        }
      }

      console.log(`✅ CycleCountListScreen: Loaded ${ccList.length} Cycle Count(s) from backend`);

      // If no data from API, log warning (data should come from backend)
      if (ccList.length === 0) {
        console.warn(`⚠️ CycleCountListScreen: No Cycle Count tasks found in backend. Please ensure backend has Cycle Count data.`);
      }

      // API returns 'lines' but mobile app uses 'items' - map lines to items for compatibility
      for (const cc of ccList) {
        if (cc.lines && !cc.items) {
          cc.items = cc.lines;
        }
      }

      // Cache in local database
      const db = await getDatabase();
      for (const cc of ccList) {
        try {
          await db.runAsync(
            `INSERT OR REPLACE INTO cycle_count_cache (
              title, warehouse, zone, status, items_json,
              counted_items_json, created_by, created_on, updated_on
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              cc.title,
              cc.warehouse,
              cc.zone || null,
              cc.status || "Draft",
              JSON.stringify(cc.items || []),
              JSON.stringify(cc.items?.filter((i: any) => i.actual_qty !== undefined) || []),
              cc.created_by,
              cc.created_on || new Date().toISOString(),
              cc.updated_on || new Date().toISOString(),
            ]
          );
        } catch (error: any) {
          console.warn(`⚠️ Failed to cache Cycle Count ${cc.title}:`, error.message);
        }
      }

      const allCcItemCodes = ccList.flatMap((cc) =>
        (cc.items || cc.lines || []).map((i: { item_code?: string }) =>
          String(i.item_code || "").trim()
        )
      );
      void ensureItemsCachedForCodes(allCcItemCodes, "Cycle Count list sync").catch(
        () => {}
      );

      setCycleCounts(ccList);
      setErrorMessage(null); // Clear any previous errors
    } catch (error: any) {
      console.error("❌ CycleCountListScreen: Error loading Cycle Counts:", error);
      
      // Check if it's a database table error
      const errorMessageStr = error.message || "";
      const errorDetails = error.details || {};
      const isDatabaseError = 
        errorMessageStr.includes("doesn't exist") ||
        errorMessageStr.includes("DATABASE_ERROR") ||
        errorMessageStr.includes("Table") ||
        errorDetails.message?.includes("doesn't exist") ||
        errorDetails.message?.includes("Table");
      
      if (isDatabaseError) {
        // Check if it's specifically the cycle count task table
        const isCycleCountTableError = 
          errorMessageStr.includes("tabcyclecounttask") ||
          errorMessageStr.includes("cyclecounttask") ||
          errorDetails.message?.includes("tabcyclecounttask") ||
          errorDetails.message?.includes("cyclecounttask");
        
        if (isCycleCountTableError) {
          // This is expected if backend table doesn't exist - show friendly message
          setErrorMessage(
            "Cycle Count Tasks table not found in backend database.\n\n" +
            "This feature requires the backend database table 'tabcyclecounttask' to be created.\n\n" +
            "The app will use cached data if available."
          );
          // Don't log as error - this is expected if table doesn't exist
          console.log(
            "ℹ️ Backend database table 'tabcyclecounttask' doesn't exist. " +
            "Please ensure the backend database schema is set up correctly."
          );
        } else {
          setErrorMessage(
            "Backend database table not found. Please ensure the backend database schema is set up correctly.\n\n" +
            "The app will use cached data if available."
          );
        }
      } else {
        setErrorMessage(
          "Failed to load Cycle Counts from backend. Using cached data if available."
        );
      }
      
      // Fallback to local cache
      try {
        const db = await getDatabase();
        const cached = await db.getAllAsync<any>(
          "SELECT * FROM cycle_count_cache ORDER BY updated_on DESC"
        );
        const parsed = cached.map((row) => ({
          ...row,
          items: row.items_json ? JSON.parse(row.items_json) : [],
          counted_items: row.counted_items_json ? JSON.parse(row.counted_items_json) : [],
        }));
        
        // API returns 'lines' but mobile app uses 'items' - ensure items exist
        for (const cc of parsed) {
          if (cc.lines && !cc.items) {
            cc.items = cc.lines;
          }
        }
        
        // If cache is empty, show empty state
        if (parsed.length === 0) {
          console.warn(`⚠️ CycleCountListScreen: No Cycle Count tasks found in cache or backend.`);
          setCycleCounts([]);
          setErrorMessage("No Cycle Count tasks found. Please sync data from backend.");
        } else {
          setCycleCounts(parsed);
          console.log(`📦 CycleCountListScreen: Loaded ${parsed.length} Cycle Count(s) from cache`);
          // If we have cached data, clear the error message
          setErrorMessage(null);
        }
      } catch (cacheError: any) {
        console.error("❌ CycleCountListScreen: Error loading from cache:", cacheError);
        setCycleCounts([]);
        setErrorMessage("Failed to load Cycle Count tasks. Please check backend connection and sync data.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Load on mount and when screen is focused
  useEffect(() => {
    loadCycleCounts();
  }, [loadCycleCounts]);

  useFocusEffect(
    useCallback(() => {
      loadCycleCounts();
    }, [loadCycleCounts])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadCycleCounts();
  };

  const handleCycleCountPress = (cc: CycleCount) => {
    (navigation as any).navigate("CycleCountDetail", { cycleCountTitle: cc.title });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Draft":
        return "#9E9E9E"; // Gray
      case "Scheduled":
        return "#2196F3"; // Blue
      case "In Progress":
        return "#9C27B0"; // Purple
      case "Completed":
        return "#2196F3"; // Blue
      case "Approved":
        return "#4CAF50"; // Green
      case "Cancelled":
        return "#F44336"; // Red
      default:
        return "#9E9E9E";
    }
  };

  const renderCycleCount = ({ item }: { item: CycleCount }) => {
    const totalItems = item.items?.length || 0;
    const countedItems = item.items?.filter((i) => i.actual_qty !== undefined).length || 0;
    const progress = totalItems > 0 ? (countedItems / totalItems) * 100 : 0;
    const discrepancies = item.items?.filter((i) => {
      const discrepancy = (i.actual_qty || 0) - (i.expected_qty || 0);
      return discrepancy !== 0;
    }).length || 0;

    return (
      <TouchableOpacity
        style={styles.ccCard}
        onPress={() => handleCycleCountPress(item)}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.ccTitle}>{item.title}</Text>
          <StatusBadge
            status={item.status}
            color={getStatusColor(item.status)}
          />
        </View>

        <View style={styles.cardDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Warehouse:</Text>
            <Text style={styles.detailValue}>{item.warehouse}</Text>
          </View>
          {item.zone && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Zone:</Text>
              <Text style={styles.detailValue}>{item.zone}</Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Items:</Text>
            <Text style={styles.detailValue}>
              {countedItems} / {totalItems} counted
            </Text>
          </View>
          {discrepancies > 0 && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Discrepancies:</Text>
              <Text style={[styles.detailValue, { color: "#FF9800" }]}>
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
            <Text style={styles.progressText}>{Math.round(progress)}%</Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.footerText}>
            Created by: {item.created_by || "N/A"}
          </Text>
          <Text style={styles.footerText}>
            {item.updated_on
              ? new Date(item.updated_on).toLocaleString()
              : ""}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView}>
        {loading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#9C27B0" />
            <Text style={styles.loadingText}>Loading Cycle Counts...</Text>
          </View>
        ) : (
          <>
            {errorMessage && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}
            {cycleCounts.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No Cycle Counts found</Text>
                <TouchableOpacity
                  style={styles.refreshButton}
                  onPress={handleRefresh}
                >
                  <Text style={styles.refreshButtonText}>Refresh</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                data={cycleCounts}
                keyExtractor={(item) => item.title}
                renderItem={renderCycleCount}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                scrollEnabled={false}
              />
            )}
          </>
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
  refreshButton: {
    backgroundColor: "#9C27B0",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  refreshButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  ccCard: {
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
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  ccTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#9C27B0",
  },
  cardDetails: {
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 14,
    color: "#666",
    width: 100,
  },
  detailValue: {
    fontSize: 14,
    color: "#000",
    flex: 1,
    fontWeight: "500",
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
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
    paddingTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 12,
    color: "#999",
  },
  errorContainer: {
    backgroundColor: "#FFF3CD",
    borderLeftWidth: 4,
    borderLeftColor: "#FFC107",
    padding: 12,
    margin: 12,
    borderRadius: 4,
  },
  errorText: {
    fontSize: 14,
    color: "#856404",
    lineHeight: 20,
  },
});

