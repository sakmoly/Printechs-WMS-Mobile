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
import { getDatabase } from "../database/database";
import { StockLedger } from "../types";

export default function StockLedgerListScreen() {
  const navigation = useNavigation();
  const [stockLedger, setStockLedger] = useState<StockLedger[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterWarehouse, setFilterWarehouse] = useState<string | null>(null);

  // Load Stock Ledger from backend and cache locally
  const loadStockLedger = useCallback(async () => {
    console.log("🔄 StockLedgerListScreen: Loading Stock Ledger...");
    setLoading(true);
    try {
      // Fetch from backend with filters
      const filters: any = {};
      if (filterWarehouse) filters.warehouse = filterWarehouse;
      if (searchQuery.trim()) filters.item_code = searchQuery.trim();

      const response = await apiService.getStockLedger(filters);

      console.log(`📦 Stock Ledger API response:`, {
        responseType: typeof response,
        isArray: Array.isArray(response),
        responseKeys: response && typeof response === "object" ? Object.keys(response) : [],
        responsePreview: JSON.stringify(response).substring(0, 500),
      });

      // Handle different response formats
      let stockList: any[] = [];
      if (Array.isArray(response)) {
        stockList = response;
        console.log(`📦 Response is array with ${stockList.length} entries`);
      } else if (response && typeof response === "object") {
        if (Array.isArray(response.data)) {
          stockList = response.data;
          console.log(`📦 Found stock in response.data: ${stockList.length} entries`);
        } else if (Array.isArray(response.items)) {
          stockList = response.items;
          console.log(`📦 Found stock in response.items: ${stockList.length} entries`);
        } else if (Array.isArray(response.stock_ledger)) {
          stockList = response.stock_ledger;
          console.log(`📦 Found stock in response.stock_ledger: ${stockList.length} entries`);
        } else if (Array.isArray(response.stock)) {
          stockList = response.stock;
          console.log(`📦 Found stock in response.stock: ${stockList.length} entries`);
        } else {
          console.warn(`⚠️ Unknown response format, keys:`, Object.keys(response));
        }
      } else {
        console.warn(`⚠️ Unexpected response type:`, typeof response);
      }

      // Log sample entries to see data structure
      if (stockList.length > 0) {
        console.log(`📦 Sample stock entry:`, stockList[0]);
        console.log(`📦 Stock entry fields:`, Object.keys(stockList[0]));
      }

      console.log(
        `✅ StockLedgerListScreen: Loaded ${stockList.length} stock entry(ies) from backend`
      );

      // Cache in local database
      const db = await getDatabase();
      for (const stock of stockList) {
        try {
          // Try multiple field names for quantities
          // Handle both number and string types
          const qty = 
            (typeof stock.qty === 'number' ? stock.qty : parseFloat(stock.qty)) ||
            (typeof stock.quantity === 'number' ? stock.quantity : parseFloat(stock.quantity)) ||
            (typeof stock.stock_qty === 'number' ? stock.stock_qty : parseFloat(stock.stock_qty)) ||
            (typeof stock.stock_quantity === 'number' ? stock.stock_quantity : parseFloat(stock.stock_quantity)) ||
            0;
          
          const reservedQty = 
            (typeof stock.reserved_qty === 'number' ? stock.reserved_qty : parseFloat(stock.reserved_qty)) ||
            (typeof stock.reserved_quantity === 'number' ? stock.reserved_quantity : parseFloat(stock.reserved_quantity)) ||
            0;
          
          const availableQty = 
            (typeof stock.available_qty === 'number' ? stock.available_qty : parseFloat(stock.available_qty)) ||
            (typeof stock.available_quantity === 'number' ? stock.available_quantity : parseFloat(stock.available_quantity)) ||
            (qty - reservedQty) ||
            0;

          console.log(`📦 Caching stock entry:`, {
            item_code: stock.item_code,
            warehouse: stock.warehouse,
            qty,
            reserved_qty: reservedQty,
            available_qty: availableQty,
            rawStock: stock,
          });

          await db.runAsync(
            `INSERT OR REPLACE INTO stock_ledger_cache (
              item_code, warehouse, bin_location, qty, reserved_qty,
              available_qty, last_transaction_date, updated_on
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              stock.item_code,
              stock.warehouse,
              stock.bin_location || stock.location_id || null,
              qty,
              reservedQty,
              availableQty,
              stock.last_transaction_date || null,
              stock.updated_on || new Date().toISOString(),
            ]
          );
        } catch (error: any) {
          console.warn(
            `⚠️ Failed to cache stock entry ${stock.item_code}:`,
            error.message
          );
        }
      }

      setStockLedger(stockList);
    } catch (error: any) {
      console.error("❌ StockLedgerListScreen: Error loading Stock Ledger:", error);

      // Fallback to local cache
      try {
        const db = await getDatabase();
        let query = "SELECT * FROM stock_ledger_cache WHERE 1=1";
        const params: any[] = [];

        if (filterWarehouse) {
          query += " AND warehouse = ?";
          params.push(filterWarehouse);
        }
        if (searchQuery.trim()) {
          query += " AND (item_code LIKE ? OR item_code = ?)";
          const searchTerm = `%${searchQuery.trim()}%`;
          params.push(searchTerm, searchQuery.trim());
        }

        query += " ORDER BY updated_on DESC";

        const cached = await db.getAllAsync<any>(query, params);
        setStockLedger(cached);
        console.log(
          `📦 StockLedgerListScreen: Loaded ${cached.length} stock entry(ies) from cache`
        );
      } catch (cacheError: any) {
        console.error(
          "❌ StockLedgerListScreen: Error loading from cache:",
          cacheError
        );
        setStockLedger([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterWarehouse, searchQuery]);

  // Load on mount and when screen is focused
  useEffect(() => {
    loadStockLedger();
  }, [loadStockLedger]);

  useFocusEffect(
    useCallback(() => {
      loadStockLedger();
    }, [loadStockLedger])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    loadStockLedger();
  };

  const handleStockPress = (stock: StockLedger) => {
    (navigation as any).navigate("StockDetail", {
      itemCode: stock.item_code,
      warehouse: stock.warehouse,
    });
  };

  const filteredStock = stockLedger.filter((stock) => {
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toUpperCase();
      return (
        stock.item_code.toUpperCase().includes(query) ||
        stock.warehouse.toUpperCase().includes(query) ||
        (stock.bin_location &&
          stock.bin_location.toUpperCase().includes(query))
      );
    }
    return true;
  });

  const renderStockItem = ({ item }: { item: StockLedger }) => {
    // Ensure quantities are numbers, not strings
    const qty = typeof item.qty === 'number' ? item.qty : parseFloat(String(item.qty)) || 0;
    const reservedQty = typeof item.reserved_qty === 'number' ? item.reserved_qty : parseFloat(String(item.reserved_qty)) || 0;
    const availableQty = typeof item.available_qty === 'number' ? item.available_qty : parseFloat(String(item.available_qty)) || (qty - reservedQty);

    return (
      <TouchableOpacity
        style={styles.stockCard}
        onPress={() => handleStockPress(item)}
      >
        <View style={styles.stockHeader}>
          <Text style={styles.itemCode}>{item.item_code}</Text>
          <View style={styles.qtyBadge}>
            <Text style={styles.qtyText}>{qty}</Text>
          </View>
        </View>

        <View style={styles.stockDetails}>
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
          <View style={styles.qtyRow}>
            <View style={styles.qtyItem}>
              <Text style={styles.qtyLabel}>Total</Text>
              <Text style={styles.qtyValue}>{qty}</Text>
            </View>
            <View style={styles.qtyItem}>
              <Text style={styles.qtyLabel}>Reserved</Text>
              <Text style={[styles.qtyValue, { color: "#FF9800" }]}>
                {reservedQty}
              </Text>
            </View>
            <View style={styles.qtyItem}>
              <Text style={styles.qtyLabel}>Available</Text>
              <Text style={[styles.qtyValue, { color: "#4CAF50" }]}>
                {availableQty}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by item code, warehouse, or bin..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <ScrollView style={styles.scrollView}>
        {loading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#4CAF50" />
            <Text style={styles.loadingText}>Loading Stock Ledger...</Text>
          </View>
        ) : filteredStock.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No stock entries found</Text>
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={handleRefresh}
            >
              <Text style={styles.refreshButtonText}>Refresh</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={filteredStock}
            keyExtractor={(item, index) =>
              `${item.item_code}-${item.warehouse}-${item.bin_location || ""}-${index}`
            }
            renderItem={renderStockItem}
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
  stockCard: {
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
  stockHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  itemCode: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#4CAF50",
    flex: 1,
  },
  qtyBadge: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  qtyText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  stockDetails: {
    marginTop: 8,
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
  qtyRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
  },
  qtyItem: {
    alignItems: "center",
  },
  qtyLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  qtyValue: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#000",
  },
});

