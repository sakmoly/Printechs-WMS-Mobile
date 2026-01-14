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

// New grouped format interface
interface StockLocationGroup {
  bin_location: string;
  cartons: Array<{
    carton_id: string;
    qty: number;
  }>;
  total_qty: number;
}

export default function StockDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { itemCode, warehouse } = (route.params as any) || {};

  const [stockDetails, setStockDetails] = useState<StockLocationGroup[]>([]);
  const [expandedBinLocation, setExpandedBinLocation] = useState<string | null>(
    null
  );
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

      // Handle 404 (endpoint not found) gracefully
      if (response === null) {
        console.log(
          `ℹ️ Stock item endpoint not found (404) - this endpoint may not be implemented yet`
        );
        Alert.alert(
          "Stock Information",
          `Stock detail endpoint is not available.\n\nItem: ${itemCode}\nWarehouse: ${warehouse}\n\nThis endpoint may not be implemented on the backend yet.`
        );
        navigation.goBack();
        return;
      }

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
        // Check if it's the new grouped format (has bin_location, cartons, total_qty)
        const isGroupedFormat =
          stockData.length > 0 &&
          stockData[0].bin_location &&
          Array.isArray(stockData[0].cartons) &&
          stockData[0].total_qty !== undefined;

        if (isGroupedFormat) {
          // New grouped format
          setStockDetails(stockData as StockLocationGroup[]);
        } else {
          // Legacy format - convert to grouped format for compatibility
          const groupedData: StockLocationGroup[] = stockData.map(
            (item: StockLedger) => ({
              bin_location: item.bin_location || "No Bin",
              cartons: [], // Legacy format doesn't have cartons
              total_qty: item.qty || 0,
            })
          );
          setStockDetails(groupedData);
        }
      } else {
        Alert.alert("Error", "Stock detail not found");
        navigation.goBack();
      }
    } catch (error: any) {
      const errorMessage = error.message || error.toString() || "";
      const is404Error =
        errorMessage.includes("404") ||
        errorMessage.includes("not found") ||
        errorMessage.includes("Route GET /api/stock/item/");

      if (is404Error) {
        console.log(
          `ℹ️ Stock item endpoint not found (404) - this endpoint may not be implemented yet`
        );
        Alert.alert(
          "Stock Information",
          `Stock detail endpoint is not available.\n\nItem: ${itemCode}\nWarehouse: ${warehouse}\n\nThis endpoint may not be implemented on the backend yet.`
        );
      } else {
        console.error("❌ Error loading stock detail:", error);
        Alert.alert("Error", `Failed to load stock detail: ${error.message}`);
      }
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const loadTransactions = async () => {
    if (!itemCode || !warehouse) return;

    try {
      // TODO: Implement getStockTransactions API if needed
      // For now, show empty transactions list
      setTransactions([]);
      setShowTransactions(true);
      console.log("ℹ️ Stock transactions API not yet implemented");
    } catch (error: any) {
      console.error("❌ Error loading transactions:", error);
      Alert.alert("Error", `Failed to load transactions: ${error.message}`);
    }
  };

  const calculateTotals = () => {
    const totalQty = stockDetails.reduce(
      (sum, s) => sum + (s.total_qty || 0),
      0
    );
    const totalCartons = stockDetails.reduce(
      (sum, s) => sum + (s.cartons?.length || 0),
      0
    );
    return { totalQty, totalCartons };
  };

  const handleBinLocationPress = (binLocation: string) => {
    if (expandedBinLocation === binLocation) {
      setExpandedBinLocation(null);
    } else {
      setExpandedBinLocation(binLocation);
    }
  };

  const renderStockByBin = ({ item }: { item: StockLocationGroup }) => {
    const isExpanded = expandedBinLocation === item.bin_location;
    const hasCartons = item.cartons && item.cartons.length > 0;

    return (
      <TouchableOpacity
        style={styles.binCard}
        onPress={() => handleBinLocationPress(item.bin_location)}
        activeOpacity={0.7}
      >
        <View style={styles.binHeader}>
          <View style={styles.binLocationContainer}>
            <Text style={styles.binLocation}>{item.bin_location}</Text>
            {hasCartons && (
              <Text style={styles.cartonCount}>
                {item.cartons.length} carton
                {item.cartons.length !== 1 ? "s" : ""}
              </Text>
            )}
          </View>
          <Text style={styles.binQty}>{item.total_qty} units</Text>
        </View>

        {isExpanded && hasCartons && (
          <View style={styles.cartonsContainer}>
            <Text style={styles.cartonsTitle}>Cartons:</Text>
            {item.cartons.map((carton, index) => (
              <View key={index} style={styles.cartonItem}>
                <Text style={styles.cartonId}>{carton.carton_id}</Text>
                <Text style={styles.cartonQty}>{carton.qty} units</Text>
              </View>
            ))}
          </View>
        )}

        {!hasCartons && (
          <View style={styles.binDetails}>
            <Text style={styles.noCartonsText}>No cartons available</Text>
          </View>
        )}
      </TouchableOpacity>
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
          <Text style={styles.transactionRef}>Ref: {item.reference_doc}</Text>
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
            <Text style={styles.transactionRef}>By: {item.performed_by}</Text>
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

  const { totalQty, totalCartons } = calculateTotals();

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
            <Text style={styles.summaryLabel}>Bin Locations:</Text>
            <Text style={styles.summaryValue}>{stockDetails.length}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Cartons:</Text>
            <Text style={styles.summaryValue}>{totalCartons}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Stock by Bin ({stockDetails.length})
        </Text>
        <FlatList
          data={stockDetails}
          keyExtractor={(item, index) => `${item.bin_location}-${index}`}
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
                keyExtractor={(item, index) =>
                  item.transaction_id || `transaction-${index}`
                }
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
  binLocationContainer: {
    flex: 1,
  },
  binLocation: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  cartonCount: {
    fontSize: 12,
    color: "#666",
  },
  binQty: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#4CAF50",
  },
  cartonsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
  },
  cartonsTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  cartonItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: "#F5F5F5",
    borderRadius: 4,
    marginBottom: 4,
  },
  cartonId: {
    fontSize: 13,
    fontWeight: "500",
    color: "#333",
    flex: 1,
  },
  cartonQty: {
    fontSize: 13,
    color: "#666",
    marginLeft: 8,
  },
  noCartonsText: {
    fontSize: 13,
    color: "#999",
    fontStyle: "italic",
    marginTop: 8,
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
