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
import { StockLedger, StockTransaction } from "../types";

export default function StockDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { itemCode, warehouse } = (route.params as any) || {};

  const [stockDetails, setStockDetails] = useState<StockLedger[]>([]);
  const [transactions, setTransactions] = useState<StockTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);

  useEffect(() => {
    if (itemCode && warehouse) {
      loadStockDetail();
    }
  }, [itemCode, warehouse]);

  const loadStockDetail = async () => {
    if (!itemCode || !warehouse) return;

    setLoading(true);
    try {
      // Fetch stock by item and warehouse
      const response = await apiService.getStockByItemAndWarehouse(
        itemCode,
        warehouse
      );

      // Handle different response formats
      let stockData: any = null;
      if (response && typeof response === "object") {
        if (response.data) {
          stockData = response.data;
        } else if (response.stock) {
          stockData = response.stock;
        } else {
          stockData = response;
        }
      }

      // If single object, convert to array
      if (stockData && !Array.isArray(stockData)) {
        stockData = [stockData];
      }

      if (stockData && Array.isArray(stockData)) {
        setStockDetails(stockData);
      } else {
        Alert.alert("Error", "Stock detail not found");
        navigation.goBack();
      }
    } catch (error: any) {
      console.error("❌ Error loading stock detail:", error);
      Alert.alert("Error", `Failed to load stock detail: ${error.message}`);
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const loadTransactions = async () => {
    if (!itemCode || !warehouse) return;

    try {
      const response = await apiService.getStockTransactions({
        item_code: itemCode,
        warehouse: warehouse,
      });

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

      setTransactions(transactionsList);
      setShowTransactions(true);
    } catch (error: any) {
      console.error("❌ Error loading transactions:", error);
      Alert.alert("Error", `Failed to load transactions: ${error.message}`);
    }
  };

  const calculateTotals = () => {
    const totalQty = stockDetails.reduce((sum, s) => sum + (s.qty || 0), 0);
    const totalReserved = stockDetails.reduce(
      (sum, s) => sum + (s.reserved_qty || 0),
      0
    );
    const totalAvailable = stockDetails.reduce(
      (sum, s) => sum + (s.available_qty || 0),
      0
    );
    return { totalQty, totalReserved, totalAvailable };
  };

  const renderStockByBin = ({ item }: { item: StockLedger }) => {
    return (
      <View style={styles.binCard}>
        <View style={styles.binHeader}>
          <Text style={styles.binLocation}>
            {item.bin_location || "No Bin"}
          </Text>
          <Text style={styles.binQty}>{item.qty} units</Text>
        </View>
        <View style={styles.binDetails}>
          <View style={styles.binQtyRow}>
            <View style={styles.binQtyItem}>
              <Text style={styles.binQtyLabel}>Total</Text>
              <Text style={styles.binQtyValue}>{item.qty}</Text>
            </View>
            <View style={styles.binQtyItem}>
              <Text style={styles.binQtyLabel}>Reserved</Text>
              <Text style={[styles.binQtyValue, { color: "#FF9800" }]}>
                {item.reserved_qty}
              </Text>
            </View>
            <View style={styles.binQtyItem}>
              <Text style={styles.binQtyLabel}>Available</Text>
              <Text style={[styles.binQtyValue, { color: "#4CAF50" }]}>
                {item.available_qty}
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  const formatTransactionType = (type: string): string => {
    return type
      .replace(/([A-Z])/g, " $1")
      .trim()
      .replace(/^./, (str) => str.toUpperCase());
  };

  const renderTransaction = ({ item }: { item: StockTransaction }) => {
    const isIncrease = item.qty_change > 0;
    const displayType = formatTransactionType(item.transaction_type);
    return (
      <View style={styles.transactionCard}>
        <View style={styles.transactionHeader}>
          <Text style={styles.transactionType}>{displayType}</Text>
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
          <Text style={styles.transactionRef}>
            Ref: {item.reference_doc}
          </Text>
          {item.wms_transaction_title && (
            <Text style={styles.transactionRef}>
              WMS: {item.wms_transaction_title}
            </Text>
          )}
          <Text style={styles.transactionDate}>
            {new Date(item.transaction_date).toLocaleString()}
          </Text>
          <Text style={styles.transactionQtyChange}>
            {item.before_qty} → {item.after_qty}
          </Text>
          {item.performed_by && (
            <Text style={styles.transactionRef}>
              By: {item.performed_by}
            </Text>
          )}
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading Stock Detail...</Text>
      </View>
    );
  }

  if (stockDetails.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Stock detail not found</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const { totalQty, totalReserved, totalAvailable } = calculateTotals();

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.itemCode}>{itemCode}</Text>
        <Text style={styles.warehouse}>{warehouse}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Summary</Text>
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Quantity:</Text>
            <Text style={styles.summaryValue}>{totalQty}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Reserved:</Text>
            <Text style={[styles.summaryValue, { color: "#FF9800" }]}>
              {totalReserved}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Available:</Text>
            <Text style={[styles.summaryValue, { color: "#4CAF50" }]}>
              {totalAvailable}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Bins:</Text>
            <Text style={styles.summaryValue}>{stockDetails.length}</Text>
          </View>
          {stockDetails[0]?.last_transaction_date && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Last Transaction:</Text>
              <Text style={styles.summaryValue}>
                {new Date(stockDetails[0].last_transaction_date).toLocaleDateString()}
              </Text>
            </View>
          )}
          {stockDetails[0]?.last_transaction_type && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Last Transaction Type:</Text>
              <Text style={styles.summaryValue}>
                {stockDetails[0].last_transaction_type}
              </Text>
            </View>
          )}
          {stockDetails[0]?.last_transaction_ref && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Last Transaction Ref:</Text>
              <Text style={styles.summaryValue}>
                {stockDetails[0].last_transaction_ref}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Stock by Bin ({stockDetails.length})
        </Text>
        <FlatList
          data={stockDetails}
          keyExtractor={(item, index) =>
            `${item.bin_location || "no-bin"}-${index}`
          }
          renderItem={renderStockByBin}
          scrollEnabled={false}
        />
      </View>

      <View style={styles.section}>
        <TouchableOpacity
          style={styles.transactionButton}
          onPress={loadTransactions}
        >
          <Text style={styles.transactionButtonText}>
            {showTransactions
              ? "Hide Transaction History"
              : "View Transaction History"}
          </Text>
        </TouchableOpacity>

        {showTransactions && (
          <>
            <Text style={styles.sectionTitle}>
              Transactions ({transactions.length})
            </Text>
            {transactions.length === 0 ? (
              <Text style={styles.emptyText}>No transactions found</Text>
            ) : (
              <FlatList
                data={transactions}
                keyExtractor={(item) => item.transaction_id}
                renderItem={renderTransaction}
                scrollEnabled={false}
              />
            )}
          </>
        )}
      </View>
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
    backgroundColor: "#4CAF50",
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
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  itemCode: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#4CAF50",
    marginBottom: 4,
  },
  warehouse: {
    fontSize: 16,
    color: "#666",
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
  binCard: {
    backgroundColor: "#F9F9F9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  binHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  binLocation: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  binQty: {
    fontSize: 14,
    color: "#666",
  },
  binDetails: {
    marginTop: 8,
  },
  binQtyRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
  },
  binQtyItem: {
    alignItems: "center",
  },
  binQtyLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  binQtyValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#000",
  },
  transactionButton: {
    backgroundColor: "#4CAF50",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  transactionButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  transactionCard: {
    backgroundColor: "#F9F9F9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  transactionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  transactionType: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#333",
  },
  transactionQty: {
    fontSize: 16,
    fontWeight: "bold",
  },
  transactionDetails: {
    marginTop: 4,
  },
  transactionRef: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  transactionDate: {
    fontSize: 12,
    color: "#999",
    marginBottom: 4,
  },
  transactionQtyChange: {
    fontSize: 12,
    color: "#666",
    fontStyle: "italic",
  },
});

