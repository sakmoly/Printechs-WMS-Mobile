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
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { apiService } from "../services/api.service";
import { getDatabase } from "../database/database";
import { TransferIn } from "../types";
import { StatusBadge } from "../components/StatusBadge";

type TransferInFilter = "active" | "receiving" | "received" | "all";

const normalizeStatus = (status: string | undefined): string =>
  (status || "").trim().toLowerCase();

const isReceivingStatus = (status: string | undefined): boolean =>
  normalizeStatus(status) === "receiving" || normalizeStatus(status) === "in transit";

const isReceivedStatus = (status: string | undefined): boolean => {
  const normalized = normalizeStatus(status);
  return normalized === "received" || normalized === "completed";
};

export default function TransferInListScreen() {
  const navigation = useNavigation();
  const [transferIns, setTransferIns] = useState<TransferIn[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TransferInFilter>("active");
  const [searchQuery, setSearchQuery] = useState("");

  const visibleTransferIns = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const filteredBySearch = normalizedSearch
      ? transferIns.filter((ti) =>
          String(ti.title || "").toLowerCase().includes(normalizedSearch)
        )
      : transferIns;

    if (statusFilter === "all") return filteredBySearch;
    if (statusFilter === "receiving") {
      return filteredBySearch.filter((ti) => isReceivingStatus(ti.status));
    }
    if (statusFilter === "received") {
      return filteredBySearch.filter((ti) => isReceivedStatus(ti.status));
    }
    return filteredBySearch.filter(
      (ti) =>
        !isReceivingStatus(ti.status) &&
        !isReceivedStatus(ti.status) &&
        normalizeStatus(ti.status) !== "cancelled"
    );
  }, [searchQuery, statusFilter, transferIns]);

  // Load Transfer Ins from backend and cache locally
  const loadTransferIns = useCallback(async () => {
    console.log("🔄 TransferInListScreen: Loading Transfer Ins...");
    setLoading(true);
    try {
      const response = await apiService.getTransferIns();
      
      // Handle different response formats
      let transferInsList: any[] = [];
      if (Array.isArray(response)) {
        transferInsList = response;
      } else if (response && typeof response === "object") {
        if (Array.isArray(response.data)) {
          transferInsList = response.data;
        } else if (Array.isArray(response.items)) {
          transferInsList = response.items;
        } else if (Array.isArray(response.transfer_ins)) {
          transferInsList = response.transfer_ins;
        }
      }

      console.log(`✅ TransferInListScreen: Loaded ${transferInsList.length} Transfer In(s) from backend`);

      // Sort Transfer Ins: SUBMITTED at top, RECEIVED at bottom, ordered by Transfer In No (title)
      transferInsList.sort((a, b) => {
        const statusA = (a.status || "").toUpperCase();
        const statusB = (b.status || "").toUpperCase();
        const titleA = (a.title || "").toUpperCase();
        const titleB = (b.title || "").toUpperCase();
        
        // SUBMITTED status gets priority (appears first)
        if (statusA === "SUBMITTED" && statusB !== "SUBMITTED") return -1;
        if (statusA !== "SUBMITTED" && statusB === "SUBMITTED") return 1;
        
        // RECEIVED status gets lowest priority (appears last)
        if (statusA === "RECEIVED" && statusB !== "RECEIVED") return 1;
        if (statusA !== "RECEIVED" && statusB === "RECEIVED") return -1;
        
        // Within same status group, sort by Transfer In No (title) ascending
        if (titleA < titleB) return -1;
        if (titleA > titleB) return 1;
        return 0;
      });

      // Cache in local database
      const db = await getDatabase();
      for (const ti of transferInsList) {
        try {
          await db.runAsync(
            `INSERT OR REPLACE INTO transfer_in_cache (
              title, from_showroom, to_warehouse, transfer_date, status,
              items_json, prepared_by, created_on, updated_on
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              ti.title,
              ti.from_showroom,
              ti.to_warehouse,
              ti.transfer_date,
              ti.status || "Draft",
              JSON.stringify(ti.items || []),
              ti.prepared_by,
              ti.created_on || new Date().toISOString(),
              ti.updated_on || new Date().toISOString(),
            ]
          );
        } catch (error: any) {
          console.warn(`⚠️ Failed to cache Transfer In ${ti.title}:`, error.message);
        }
      }

      setTransferIns(transferInsList);
      setErrorMessage(null); // Clear any previous errors
    } catch (error: any) {
      console.error("❌ TransferInListScreen: Error loading Transfer Ins:", error);
      
      // Check if it's a database table error
      const errorMessageStr = error.message || "";
      const isDatabaseError = 
        errorMessageStr.includes("doesn't exist") ||
        errorMessageStr.includes("DATABASE_ERROR") ||
        errorMessageStr.includes("Table");
      
      if (isDatabaseError) {
        setErrorMessage(
          "Backend database table not found. Please ensure the backend database schema is set up correctly.\n\n" +
          "The app will use cached data if available."
        );
      } else {
        setErrorMessage(
          "Failed to load Transfer Ins from backend. Using cached data if available."
        );
      }
      
      // Fallback to local cache
      try {
        const db = await getDatabase();
        const cached = await db.getAllAsync<any>(
          "SELECT * FROM transfer_in_cache ORDER BY updated_on DESC"
        );
        const parsed = cached.map((row) => ({
          ...row,
          items: row.items_json ? JSON.parse(row.items_json) : [],
        }));
        
        // Sort cached Transfer Ins: SUBMITTED at top, RECEIVED at bottom, ordered by Transfer In No (title)
        parsed.sort((a, b) => {
          const statusA = (a.status || "").toUpperCase();
          const statusB = (b.status || "").toUpperCase();
          const titleA = (a.title || "").toUpperCase();
          const titleB = (b.title || "").toUpperCase();
          
          // SUBMITTED status gets priority (appears first)
          if (statusA === "SUBMITTED" && statusB !== "SUBMITTED") return -1;
          if (statusA !== "SUBMITTED" && statusB === "SUBMITTED") return 1;
          
          // RECEIVED status gets lowest priority (appears last)
          if (statusA === "RECEIVED" && statusB !== "RECEIVED") return 1;
          if (statusA !== "RECEIVED" && statusB === "RECEIVED") return -1;
          
          // Within same status group, sort by Transfer In No (title) ascending
          if (titleA < titleB) return -1;
          if (titleA > titleB) return 1;
          return 0;
        });
        
        setTransferIns(parsed);
        console.log(`📦 TransferInListScreen: Loaded ${parsed.length} Transfer In(s) from cache`);
        
        // If we have cached data, clear the error message
        if (parsed.length > 0) {
          setErrorMessage(null);
        }
      } catch (cacheError: any) {
        console.error("❌ TransferInListScreen: Error loading from cache:", cacheError);
        setTransferIns([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Load on mount and when screen is focused
  useEffect(() => {
    loadTransferIns();
  }, [loadTransferIns]);

  useFocusEffect(
    useCallback(() => {
      loadTransferIns();
    }, [loadTransferIns])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadTransferIns();
  };

  const handleTransferInPress = (transferIn: TransferIn) => {
    (navigation as any).navigate("TransferInDetail", { transferInTitle: transferIn.title });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Draft":
        return "#9E9E9E"; // Gray
      case "Submitted":
        return "#2196F3"; // Blue
      case "In Transit":
        return "#FF9800"; // Orange
      case "Received":
        return "#9C27B0"; // Purple
      case "Completed":
        return "#4CAF50"; // Green
      case "Cancelled":
        return "#F44336"; // Red
      default:
        return "#9E9E9E";
    }
  };

  const renderTransferIn = ({ item }: { item: TransferIn }) => {
    const totalItems = item.items?.length || 0;
    const totalQty = item.items?.reduce((sum, i) => sum + (i.qty || 0), 0) || 0;
    const receivedQty = item.items?.reduce((sum, i) => sum + (i.received_qty || 0), 0) || 0;

    return (
      <TouchableOpacity
        style={styles.transferInCard}
        onPress={() => handleTransferInPress(item)}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.transferInTitle}>{item.title}</Text>
          <StatusBadge
            status={item.status}
            color={getStatusColor(item.status)}
          />
        </View>

        <View style={styles.cardDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>From:</Text>
            <Text style={styles.detailValue}>{item.from_showroom}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>To:</Text>
            <Text style={styles.detailValue}>{item.to_warehouse}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Date:</Text>
            <Text style={styles.detailValue}>
              {item.transfer_date
                ? new Date(item.transfer_date).toLocaleDateString()
                : "N/A"}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Items:</Text>
            <Text style={styles.detailValue}>
              {totalItems} item(s) • {totalQty} qty
            </Text>
          </View>
          {(item.status === "Submitted" || item.status === "In Transit" || item.status === "Receiving") && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Received:</Text>
              <Text style={styles.detailValue}>
                {receivedQty} / {totalQty} qty
              </Text>
            </View>
          )}
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.footerText}>
            Prepared by: {item.prepared_by || "N/A"}
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

  const filterOptions: {
    key: TransferInFilter;
    label: string;
    count: number;
  }[] = [
    {
      key: "active",
      label: "Active",
      count: transferIns.filter(
        (ti) =>
          !isReceivingStatus(ti.status) &&
          !isReceivedStatus(ti.status) &&
          normalizeStatus(ti.status) !== "cancelled"
      ).length,
    },
    {
      key: "receiving",
      label: "Receiving",
      count: transferIns.filter((ti) => isReceivingStatus(ti.status)).length,
    },
    {
      key: "received",
      label: "Received",
      count: transferIns.filter((ti) => isReceivedStatus(ti.status)).length,
    },
    {
      key: "all",
      label: "All",
      count: transferIns.length,
    },
  ];

  const getFilterChipFlex = (key: TransferInFilter) => {
    if (key === "receiving") return 1.2;
    if (key === "all") return 0.55;
    return 1;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Transfer In</Text>
      </View>
      <ScrollView style={styles.scrollView}>
        <View style={styles.filterContainer}>
          <Text style={styles.filterTitle}>Filter</Text>
          <View style={styles.filterOptionsRow}>
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
            placeholder="Scan or enter Transfer In No"
            placeholderTextColor="#888"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            selectTextOnFocus
          />
        </View>
        {loading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Loading Transfer Ins...</Text>
          </View>
        ) : (
          <>
            {errorMessage && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}
            {visibleTransferIns.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No Transfer Ins found</Text>
                <TouchableOpacity
                  style={styles.refreshButton}
                  onPress={handleRefresh}
                >
                  <Text style={styles.refreshButtonText}>Refresh</Text>
                </TouchableOpacity>
              </View>
            ) : (
          <FlatList
            data={visibleTransferIns}
            keyExtractor={(item) => item.title}
            renderItem={renderTransferIn}
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
  filterTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#333",
    marginBottom: 8,
  },
  filterOptionsRow: {
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
    backgroundColor: "#2196F3",
    borderColor: "#2196F3",
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
  refreshButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  refreshButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  transferInCard: {
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
  transferInTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#2196F3",
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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#2196F3",
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#F5F5F5",
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  filterButtonActive: {
    backgroundColor: "#2196F3",
    borderColor: "#2196F3",
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  activeFiltersContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#E3F2FD",
    margin: 12,
    borderRadius: 8,
  },
  activeFiltersText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1976D2",
    marginRight: 8,
  },
  filterTag: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2196F3",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 4,
  },
  filterTagText: {
    fontSize: 12,
    color: "#FFF",
    marginRight: 6,
  },
  filterTagClose: {
    fontSize: 16,
    color: "#FFF",
    fontWeight: "bold",
  },
  clearFiltersButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#2196F3",
  },
  clearFiltersText: {
    fontSize: 12,
    color: "#2196F3",
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  modalClose: {
    fontSize: 24,
    color: "#666",
  },
  modalBody: {
    padding: 16,
  },
  filterSection: {
    marginBottom: 24,
  },
  filterLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  filterOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterOption: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#F5F5F5",
    borderWidth: 1,
    borderColor: "#E0E0E0",
    marginRight: 8,
    marginBottom: 8,
  },
  filterOptionActive: {
    backgroundColor: "#2196F3",
    borderColor: "#2196F3",
  },
  filterOptionText: {
    fontSize: 14,
    color: "#333",
  },
  filterOptionTextActive: {
    color: "#FFF",
    fontWeight: "600",
  },
  modalFooter: {
    flexDirection: "row",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
    gap: 12,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  modalButtonSecondary: {
    backgroundColor: "#F5F5F5",
  },
  modalButtonPrimary: {
    backgroundColor: "#2196F3",
  },
  modalButtonTextSecondary: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  modalButtonTextPrimary: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFF",
  },
});
