import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { apiService } from "../services/api.service";
import { StockTransaction } from "../types";

export default function StockTransactionHistoryScreen() {
  const navigation = useNavigation();
  const [transactions, setTransactions] = useState<StockTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchItem, setSearchItem] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState<string | null>(null);

  // Load transactions from backend
  const loadTransactions = useCallback(async () => {
    console.log("🔄 StockTransactionHistoryScreen: Loading transactions...");
    setLoading(true);
    try {
      const filters: any = {};
      if (searchItem.trim()) filters.item_code = searchItem.trim();
      if (filterWarehouse) filters.warehouse = filterWarehouse;

      const response = await apiService.getStockTransactions(filters);

      // Handle different response formats
      let transactionsList: any[] = [];
      if (Array.isArray(response)) {
        transactionsList = response;
      } else if (response && typeof response === "object") {
        if (Array.isArray(response.data)) {
          transactionsList = response.data;
        } else if (Array.isArray(response.items)) {
          transactionsList = response.items;
        } else if (Array.isArray(response.transactions)) {
          transactionsList = response.transactions;
        }
      }

      console.log(
        `✅ StockTransactionHistoryScreen: Loaded ${transactionsList.length} transaction(s) from backend`
      );

      // Sort by date (newest first)
      transactionsList.sort((a, b) => {
        const dateA = new Date(a.transaction_date).getTime();
        const dateB = new Date(b.transaction_date).getTime();
        return dateB - dateA;
      });

      setTransactions(transactionsList);
    } catch (error: any) {
      console.error(
        "❌ StockTransactionHistoryScreen: Error loading transactions:",
        error
      );
      setTransactions([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchItem, filterWarehouse]);

  // Load on mount and when screen is focused
  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  useFocusEffect(
    useCallback(() => {
      loadTransactions();
    }, [loadTransactions])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadTransactions();
  };

  const getTransactionTypeColor = (type: string) => {
    switch (type) {
      case "Receiving":
      case "TransferIn":
        return "#4CAF50"; // Green for incoming
      case "Picking":
      case "MaterialRequest":
        return "#F44336"; // Red for outgoing
      case "Putaway":
        return "#2196F3"; // Blue for movement
      case "CycleCount":
        return "#FF9800"; // Orange for adjustment
      default:
        return "#666";
    }
  };

  const formatTransactionType = (type: string): string => {
    // Format transaction types for display (add spaces)
    return type
      .replace(/([A-Z])/g, " $1")
      .trim()
      .replace(/^./, (str) => str.toUpperCase());
  };

  const renderTransaction = ({ item }: { item: StockTransaction }) => {
    const isIncrease = item.qty_change > 0;
    const typeColor = getTransactionTypeColor(item.transaction_type);
    const displayType = formatTransactionType(item.transaction_type);

    return (
      <View style={styles.transactionCard}>
        <View style={styles.transactionHeader}>
          <View style={styles.transactionHeaderLeft}>
            <Text style={[styles.transactionType, { color: typeColor }]}>
              {displayType}
            </Text>
            <Text style={styles.transactionRef}>
              {item.reference_doc}
            </Text>
          </View>
          <Text
            style={[
              styles.transactionQty,
              { color: isIncrease ? "#4CAF50" : "#F44336" },
            ]}
          >
            {isIncrease ? "+" : ""}
            {item.qty_change}
          </Text>
        </View>

        <View style={styles.transactionDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Item:</Text>
            <Text style={styles.detailValue}>{item.item_code}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Warehouse:</Text>
            <Text style={styles.detailValue}>{item.warehouse}</Text>
          </View>
          {item.bin_location && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Bin:</Text>
              <Text style={styles.detailValue}>{item.bin_location}</Text>
            </View>
          )}
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Qty Change:</Text>
            <Text
              style={[
                styles.detailValue,
                { color: isIncrease ? "#4CAF50" : "#F44336" },
              ]}
            >
              {item.before_qty} → {item.after_qty}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Date:</Text>
            <Text style={styles.detailValue}>
              {new Date(item.transaction_date).toLocaleString()}
            </Text>
          </View>
          {item.performed_by && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Performed By:</Text>
              <Text style={styles.detailValue}>{item.performed_by}</Text>
            </View>
          )}
          {item.user_id && item.user_id !== item.performed_by && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>User ID:</Text>
              <Text style={styles.detailValue}>{item.user_id}</Text>
            </View>
          )}
          {item.wms_transaction_title && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>WMS Transaction:</Text>
              <Text style={styles.detailValue}>{item.wms_transaction_title}</Text>
            </View>
          )}
          {item.reference_doc_type && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Reference Type:</Text>
              <Text style={styles.detailValue}>{item.reference_doc_type}</Text>
            </View>
          )}
          {item.source_bin && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Source Bin:</Text>
              <Text style={styles.detailValue}>{item.source_bin}</Text>
            </View>
          )}
          {item.target_bin && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Target Bin:</Text>
              <Text style={styles.detailValue}>{item.target_bin}</Text>
            </View>
          )}
          {item.notes && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Notes:</Text>
              <Text style={styles.detailValue}>{item.notes}</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by item code..."
          value={searchItem}
          onChangeText={setSearchItem}
        />
      </View>

      <ScrollView style={styles.scrollView}>
        {loading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#4CAF50" />
            <Text style={styles.loadingText}>Loading Transactions...</Text>
          </View>
        ) : transactions.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No transactions found</Text>
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={handleRefresh}
            >
              <Text style={styles.refreshButtonText}>Refresh</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={transactions}
            keyExtractor={(item, index) =>
              String(item.transaction_id ?? item.id ?? `${item.item_code}-${index}`)
            }
            renderItem={renderTransaction}
            refreshing={refreshing}
            onRefresh={handleRefresh}
            scrollEnabled={false}
          />
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
  searchContainer: {
    padding: 12,
    backgroundColor: "#FFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  searchInput: {
    backgroundColor: "#F5F5F5",
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
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
    backgroundColor: "#4CAF50",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  refreshButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  transactionCard: {
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
  transactionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  transactionHeaderLeft: {
    flex: 1,
  },
  transactionType: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 4,
  },
  transactionRef: {
    fontSize: 12,
    color: "#666",
  },
  transactionQty: {
    fontSize: 18,
    fontWeight: "bold",
  },
  transactionDetails: {
    marginTop: 8,
  },
  detailRow: {
    flexDirection: "row",
    marginBottom: 6,
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
});

