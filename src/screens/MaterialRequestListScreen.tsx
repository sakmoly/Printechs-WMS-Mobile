import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
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
import { MaterialRequest } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import { formatDateOnly } from "../utils/date";

// Helper function to get status sort order
const getStatusSortOrder = (status: string | undefined): number => {
  const statusLower = (status || "").toLowerCase();
  if (statusLower === "in progress" || statusLower === "inprogress") {
    return 1; // In Progress first
  } else if (statusLower === "submitted") {
    return 2; // Submitted second
  } else if (statusLower === "picked") {
    return 3; // Picked next
  } else if (isFinalStatus(status)) {
    return 5; // Final statuses last
  } else {
    return 4; // All other statuses last
  }
};

const isFinalStatus = (status: string | undefined): boolean => {
  const normalized = (status || "").trim().toLowerCase();
  return normalized === "dispatched" || normalized === "transferred";
};

const isPickedStatus = (status: string | undefined): boolean => {
  return (status || "").trim().toLowerCase() === "picked";
};

const normalizeMaterialRequestStatus = (status: string | undefined): string => {
  return (status || "").trim().toLowerCase() === "dispatched"
    ? "Transferred"
    : status || "Draft";
};

type MaterialRequestFilter = "active" | "picked" | "final" | "all";

// Calculate picked quantities from event queue
const calculatePickedQuantities = async (mr: any): Promise<any> => {
  if (!mr || !mr.title) return mr;

  try {
    const db = await getDatabase();

    // Get all picked items from event queue for this Material Request
    // Backend processes PACK_BOX_TO_TC events with material_request or transfer_order field
    // Count ALL picked items regardless of whether they're packed into a TC or not
    const pickedEvents = await db.getAllAsync<{
      item_code: string;
      total_qty: number;
    }>(
      `SELECT 
        item_code,
        SUM(qty) as total_qty
      FROM event_queue
      WHERE material_request = ?
        AND event_type = 'PACK_BOX_TO_TC'
      GROUP BY item_code`,
      [mr.title]
    );

    // Check which items are in sealed transfer cartons
    // Items in sealed TCs should have status "Sealed"
    const sealedItems = await db.getAllAsync<{
      item_code: string;
    }>(
      `SELECT DISTINCT e.item_code
       FROM event_queue e
       JOIN tc_cache tc ON e.tc_id = tc.tc_id
       WHERE e.material_request = ?
         AND e.event_type = 'PACK_BOX_TO_TC'
         AND e.tc_id IS NOT NULL
         AND tc.status IN ('Sealed', 'SEALED', 'Dispatched', 'DISPATCHED')`,
      [mr.title]
    );

    // Create maps for quick lookup
    const pickedQtyMap = new Map<string, number>();
    pickedEvents.forEach((event) => {
      if (event.item_code) {
        pickedQtyMap.set(event.item_code, event.total_qty || 0);
      }
    });

    const sealedItemSet = new Set<string>();
    sealedItems.forEach((item) => {
      if (item.item_code) {
        sealedItemSet.add(item.item_code);
      }
    });

    // Update Material Request items with picked quantities and status
    const updatedItems = (mr.items || []).map((item: any) => {
      const pickedQty =
        pickedQtyMap.get(item.item_code) || item.picked_qty || 0;
      const pendingQty = item.requested_qty - pickedQty;

      // Determine item status:
      // 1. If API provides status "Sealed", respect it (backend has marked it as sealed)
      // 2. If item is in a sealed TC (from local DB), mark as "Sealed"
      // 3. Otherwise, calculate based on picked quantity
      let itemStatus: "Pending" | "In Progress" | "Picked" | "Sealed" =
        item.status || "Pending";

      // If API says it's sealed, respect that
      if (item.status === "Sealed" || item.status === "SEALED") {
        itemStatus = "Sealed";
      } else if (sealedItemSet.has(item.item_code)) {
        // Item is in a sealed TC (from local DB check)
        itemStatus = "Sealed";
      } else if (!item.status) {
        // Calculate status if not provided by API
        if (pickedQty === 0) {
          itemStatus = "Pending";
        } else if (pickedQty >= item.requested_qty) {
          itemStatus = "Picked";
        } else {
          itemStatus = "In Progress";
        }
      }

      return {
        ...item,
        picked_qty: pickedQty,
        pending_qty: pendingQty,
        status: itemStatus,
      };
    });

    // Calculate total picked quantity
    const totalPickedQty = updatedItems.reduce(
      (sum: number, item: any) => sum + (item.picked_qty || 0),
      0
    );

    console.log(
      `📊 MR ${mr.title}: Total Picked = ${totalPickedQty} (from ${pickedEvents.length} item groups)`
    );

    return {
      ...mr,
      items: updatedItems,
      total_picked_qty: totalPickedQty,
    };
  } catch (error: any) {
    console.error("❌ Error calculating picked quantities:", error);
    // Return original MR if calculation fails
    return mr;
  }
};

export default function MaterialRequestListScreen() {
  const navigation = useNavigation();
  const [materialRequests, setMaterialRequests] = useState<MaterialRequest[]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] =
    useState<MaterialRequestFilter>("active");
  const [searchQuery, setSearchQuery] = useState("");

  const visibleMaterialRequests = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const filteredBySearch = normalizedSearch
      ? materialRequests.filter((mr) =>
          String(mr.title || "").toLowerCase().includes(normalizedSearch)
        )
      : materialRequests;

    if (statusFilter === "all") return filteredBySearch;
    if (statusFilter === "picked") {
      return filteredBySearch.filter((mr) => isPickedStatus(mr.status));
    }
    if (statusFilter === "final") {
      return filteredBySearch.filter((mr) => isFinalStatus(mr.status));
    }
    return filteredBySearch.filter(
      (mr) => !isFinalStatus(mr.status) && !isPickedStatus(mr.status)
    );
  }, [materialRequests, searchQuery, statusFilter]);

  // Load Material Requests from backend and cache locally
  const loadMaterialRequests = useCallback(async () => {
    console.log("🔄 MaterialRequestListScreen: Loading Material Requests...");
    setLoading(true);

    try {
      // Fetch from backend
      console.log("📡 Calling apiService.getMaterialRequests()...");
      // Note: Backend should return Material Requests with at least one of these date fields:
      // - request_date (preferred)
      // - created_on or created_at
      // - updated_on or updated_at
      // The date should be in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss) or a format that JavaScript Date() can parse
      const response = await apiService.getMaterialRequests();
      console.log("📦 API Response received:", {
        isArray: Array.isArray(response),
        type: typeof response,
        hasData: !!(response && typeof response === "object" && response.data),
        responseKeys:
          response && typeof response === "object" ? Object.keys(response) : [],
      });

      // Handle different response formats
      let mrList: any[] = [];
      if (Array.isArray(response)) {
        mrList = response;
        console.log(`✅ Response is array with ${mrList.length} items`);
      } else if (response && typeof response === "object") {
        if (Array.isArray(response.data)) {
          mrList = response.data;
          console.log(`✅ Response.data is array with ${mrList.length} items`);
        } else if (Array.isArray(response.items)) {
          mrList = response.items;
          console.log(`✅ Response.items is array with ${mrList.length} items`);
        } else if (Array.isArray(response.material_requests)) {
          mrList = response.material_requests;
          console.log(
            `✅ Response.material_requests is array with ${mrList.length} items`
          );
        } else {
          console.warn(
            "⚠️ Response is object but no array found in data/items/material_requests"
          );
        }
      } else {
        console.warn("⚠️ Response is not array or object:", typeof response);
      }

      console.log(
        `✅ MaterialRequestListScreen: Loaded ${mrList.length} Material Request(s) from backend`
      );

      // No date filtering - show all Material Requests
      mrList = mrList.map((mr) => ({
        ...mr,
        status: normalizeMaterialRequestStatus(mr.status),
      }));

      // Cache in local database
      const db = await getDatabase();
      for (const mr of mrList) {
        try {
          await db.runAsync(
            `INSERT OR REPLACE INTO material_request_cache (
              title, from_warehouse, to_showroom, request_date, status,
              items_json, requested_by, created_on, updated_on
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              mr.title,
              mr.from_warehouse,
              mr.to_showroom,
              mr.request_date,
              mr.status || "Draft",
              JSON.stringify(mr.items || []),
              mr.requested_by,
              mr.created_on || new Date().toISOString(),
              mr.updated_on || new Date().toISOString(),
            ]
          );
        } catch (error: any) {
          console.warn(
            `⚠️ Failed to cache Material Request ${mr.title}:`,
            error.message
          );
        }
      }

      // Calculate picked quantities from event queue for each Material Request
      const mrListWithPickedQty = await Promise.all(
        mrList.map(async (mr) => {
          return await calculatePickedQuantities(mr);
        })
      );

      // Sort by status: In Progress -> Submitted -> Picked -> final statuses -> Others
      const sortedMaterialRequests = [...mrListWithPickedQty].sort((a, b) => {
        const orderA = getStatusSortOrder(a.status);
        const orderB = getStatusSortOrder(b.status);

        // If same priority, sort by updated_on (most recent first)
        if (orderA === orderB) {
          const dateA = new Date(a.updated_on || a.created_on || 0).getTime();
          const dateB = new Date(b.updated_on || b.created_on || 0).getTime();
          return dateB - dateA; // Most recent first
        }

        return orderA - orderB;
      });

      console.log(
        `📊 Setting Material Requests state with ${sortedMaterialRequests.length} item(s) (sorted by status)`
      );
      setMaterialRequests(sortedMaterialRequests);
      console.log(
        `✅ MaterialRequestListScreen: State updated with ${sortedMaterialRequests.length} Material Request(s)`
      );
    } catch (error: any) {
      // Check if this is a backend database error (500)
      const isBackendError =
        error.message?.includes("500") ||
        error.message?.includes("DATABASE_ERROR") ||
        error.response?.status === 500;

      if (isBackendError) {
        // Log as warning instead of error since we have cache fallback
        console.warn(
          "⚠️ Backend database error detected. Falling back to local cache..."
        );
      } else {
        // Check if it's a server unavailable error
        const isServerUnavailable = 
          error.message?.includes("SERVER_UNAVAILABLE") ||
          error.message?.includes("Server is not accessible") ||
          error.message?.includes("Network request failed");
        
        if (isServerUnavailable) {
          // Log as warning for server unavailable (expected scenario)
          console.warn(
            "⚠️ MaterialRequestListScreen: Server not accessible, using cached data",
            error.message
          );
        } else {
          // For other errors, log as error
          console.error(
            "❌ MaterialRequestListScreen: Error loading Material Requests:",
            error
          );
        }
      }

      // Fallback to local cache
      try {
        const db = await getDatabase();
        const cached = await db.getAllAsync<any>(
          "SELECT * FROM material_request_cache ORDER BY updated_on DESC"
        );
        const parsed = cached.map((row) => ({
          ...row,
          status: normalizeMaterialRequestStatus(row.status),
          items: row.items_json ? JSON.parse(row.items_json) : [],
        }));

        // No date filtering - show all cached Material Requests
        if (parsed.length > 0) {
          console.log(
            `📦 MaterialRequestListScreen: Loaded ${parsed.length} Material Request(s) from cache`
          );
          if (isBackendError) {
            console.warn(
              "ℹ️ Showing cached Material Requests. Backend database may need Material Request table setup."
            );
          }
          // Calculate picked quantities from event queue for cached Material Requests
          const parsedWithPickedQty = await Promise.all(
            parsed.map(async (mr) => {
              return await calculatePickedQuantities(mr);
            })
          );

          // Sort by status: In Progress -> Submitted -> Picked -> final statuses -> Others
          const sortedCachedMaterialRequests = [...parsedWithPickedQty].sort(
            (a, b) => {
              const orderA = getStatusSortOrder(a.status);
              const orderB = getStatusSortOrder(b.status);

              // If same priority, sort by updated_on (most recent first)
              if (orderA === orderB) {
                const dateA = new Date(
                  a.updated_on || a.created_on || 0
                ).getTime();
                const dateB = new Date(
                  b.updated_on || b.created_on || 0
                ).getTime();
                return dateB - dateA; // Most recent first
              }

              return orderA - orderB;
            }
          );

          setMaterialRequests(sortedCachedMaterialRequests);
        } else {
          console.warn("⚠️ No cached Material Requests found.");
          // No mock data - Material Requests should come from backend only
          console.log("ℹ️ No Material Requests found in cache or backend");
          setMaterialRequests([]);
        }
      } catch (cacheError: any) {
        console.error(
          "❌ MaterialRequestListScreen: Error loading from cache:",
          cacheError
        );
        setMaterialRequests([]);

        // Only show alert if we have no cached data AND backend failed
        if (isBackendError) {
          // Don't show alert immediately - let the empty state handle it
          // Alert.alert(
          //   "Backend Setup Required",
          //   "The Material Request feature requires backend database setup. Please contact your administrator to set up the Material Request table in the backend database.\n\nYou can continue using other features of the app.",
          //   [{ text: "OK" }]
          // );
        } else {
          // Check if it's a server unavailable error
          const isServerUnavailable = 
            error.message?.includes("SERVER_UNAVAILABLE") ||
            error.message?.includes("Server is not accessible") ||
            error.message?.includes("Network request failed");
          
          if (isServerUnavailable) {
            Alert.alert(
              "🔌 Server Not Accessible",
              "Unable to connect to the server. Please check:\n\n• Your internet connection\n• Server is running\n• Server address is correct\n\nYou can continue working offline with cached data.",
              [{ text: "OK" }]
            );
          } else {
            Alert.alert(
              "Connection Issue",
              "Unable to load Material Requests. Please check your connection and try again.",
              [{ text: "OK" }]
            );
          }
        }
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Load on mount and when screen is focused
  useEffect(() => {
    loadMaterialRequests();
  }, [loadMaterialRequests]);

  useFocusEffect(
    useCallback(() => {
      loadMaterialRequests();
    }, [loadMaterialRequests])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadMaterialRequests();
  };

  const handleMaterialRequestPress = (mr: MaterialRequest) => {
    (navigation as any).navigate("MaterialRequestDetail", {
      materialRequestTitle: mr.title,
    });
  };

  const filterOptions: {
    key: MaterialRequestFilter;
    label: string;
    count: number;
  }[] = [
    {
      key: "active",
      label: "Active",
      count: materialRequests.filter(
        (mr) => !isFinalStatus(mr.status) && !isPickedStatus(mr.status)
      ).length,
    },
    {
      key: "picked",
      label: "Picked",
      count: materialRequests.filter((mr) => isPickedStatus(mr.status)).length,
    },
    {
      key: "final",
      label: "Transferred",
      count: materialRequests.filter((mr) => isFinalStatus(mr.status)).length,
    },
    {
      key: "all",
      label: "All",
      count: materialRequests.length,
    },
  ];

  const getFilterChipFlex = (key: MaterialRequestFilter) => {
    if (key === "final") return 1.2;
    if (key === "all") return 0.55;
    return 1;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Draft":
        return "#9E9E9E"; // Gray
      case "Submitted":
        return "#2196F3"; // Blue
      case "In Progress":
        return "#FF9800"; // Orange
      case "Completed":
        return "#4CAF50"; // Green
      case "Cancelled":
        return "#F44336"; // Red
      default:
        return "#9E9E9E";
    }
  };

  const renderMaterialRequest = ({ item }: { item: MaterialRequest }) => {
    const totalItems = item.items?.length || 0;
    const totalRequestedQty =
      item.items?.reduce((sum, i) => sum + (i.requested_qty || 0), 0) || 0;
    const shouldTreatAsPicked = (lineStatus?: string) => {
      const normalized = (lineStatus || "").trim().toLowerCase();
      return (
        normalized === "picked" ||
        normalized === "sealed" ||
        isPickedStatus(item.status) ||
        isFinalStatus(item.status)
      );
    };
    const totalPickedQty =
      item.items?.reduce((sum, i) => {
        const pickedQty = Number(i.picked_qty || 0);
        if (pickedQty > 0) return sum + pickedQty;
        return sum + (shouldTreatAsPicked(i.status) ? i.requested_qty || 0 : 0);
      }, 0) || 0;
    const progress =
      totalRequestedQty > 0 ? (totalPickedQty / totalRequestedQty) * 100 : 0;

    return (
      <TouchableOpacity
        style={styles.mrCard}
        onPress={() => handleMaterialRequestPress(item)}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.mrTitle}>{item.title}</Text>
          <StatusBadge status={item.status || "Unknown"} />
        </View>

        <View style={styles.cardDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>From:</Text>
            <Text style={styles.detailValue}>{item.from_warehouse}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>To:</Text>
            <Text style={styles.detailValue}>{item.to_showroom}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Date:</Text>
            <Text style={styles.detailValue}>
              {formatDateOnly(item.request_date)}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Items:</Text>
            <Text style={styles.detailValue}>
              {totalItems} item(s) • {totalRequestedQty} qty requested
            </Text>
          </View>
          {item.status === "In Progress" && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Picked:</Text>
              <Text style={styles.detailValue}>
                {totalPickedQty} / {totalRequestedQty} qty (
                {Math.round(progress)}%)
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
                    backgroundColor: progress === 100 ? "#4CAF50" : "#2196F3",
                  },
                ]}
              />
            </View>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.footerText}>
            Requested by: {item.requested_by || "N/A"}
          </Text>
          <Text style={styles.footerText}>
            {item.updated_on ? new Date(item.updated_on).toLocaleString() : ""}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.filterContainer}>
          <Text style={styles.filterTitle}>Filter</Text>
          <View style={styles.filterOptions}>
            {filterOptions.map((option) => {
              const selected = statusFilter === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[
                    styles.filterChip,
                    { flex: getFilterChipFlex(option.key) },
                    selected && styles.filterChipSelected,
                  ]}
                  onPress={() => setStatusFilter(option.key)}
                >
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                    style={[
                      styles.filterChipText,
                      selected && styles.filterChipTextSelected,
                    ]}
                  >
                    {option.label} ({option.count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Scan or enter Material Request No"
            placeholderTextColor="#888"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            selectTextOnFocus
          />
        </View>
        {loading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#FF9800" />
            <Text style={styles.loadingText}>Loading Material Requests...</Text>
          </View>
        ) : visibleMaterialRequests.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No Material Requests found</Text>
            <Text style={styles.emptySubtext}>
              {loading
                ? "Loading..."
                : statusFilter === "active"
                  ? "No active Material Requests found. Picked and Transferred requests have their own filters."
                  : statusFilter === "picked"
                    ? "No Picked Material Requests found."
                  : "No Material Requests found for the selected filter."}
            </Text>
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={handleRefresh}
            >
              <Text style={styles.refreshButtonText}>Refresh</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={visibleMaterialRequests}
            keyExtractor={(item) => item.title}
            renderItem={renderMaterialRequest}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            scrollEnabled={false}
          />
        )}
      </ScrollView>
      <ScreenFooterFrame />
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
  filterContainer: {
    backgroundColor: "#FFF",
    margin: 12,
    marginBottom: 4,
    padding: 10,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  searchInput: {
    height: 42,
    backgroundColor: "#F7F8FA",
    borderWidth: 1,
    borderColor: "#DADDE3",
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: "600",
    color: "#222",
    marginTop: 10,
  },
  filterTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#333",
    marginBottom: 8,
  },
  filterOptions: {
    flexDirection: "row",
    gap: 4,
    flexWrap: "nowrap",
    alignItems: "center",
  },
  filterChip: {
    height: 36,
    minWidth: 0,
    paddingHorizontal: 2,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#F5F5F5",
    borderWidth: 1,
    borderColor: "#E0E0E0",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 1,
  },
  filterChipSelected: {
    backgroundColor: "#FF9800",
    borderColor: "#FF9800",
  },
  filterChipText: {
    fontSize: 10.5,
    fontWeight: "600",
    color: "#555",
    textAlign: "center",
    includeFontPadding: false,
  },
  filterChipTextSelected: {
    color: "#FFF",
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
    fontSize: 18,
    color: "#333",
    fontWeight: "600",
    marginBottom: 12,
    textAlign: "center",
  },
  emptySubtext: {
    fontSize: 14,
    color: "#999",
    marginBottom: 20,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  refreshButton: {
    backgroundColor: "#FF9800",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  refreshButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  mrCard: {
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
  mrTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#FF9800",
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
    width: 80,
  },
  detailValue: {
    fontSize: 14,
    color: "#000",
    flex: 1,
    fontWeight: "500",
  },
  progressBarContainer: {
    marginTop: 12,
  },
  progressBar: {
    height: 8,
    backgroundColor: "#E0E0E0",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
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
});
