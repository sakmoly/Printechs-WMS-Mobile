import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { dataService } from "../services/data.service";
import { apiService } from "../services/api.service";
import { StatusBadge } from "../components/StatusBadge";

export default function RemainingItemsScreen() {
  const navigation = useNavigation();
  const [asnNo, setAsnNo] = useState("");
  const [loading, setLoading] = useState(false);
  const [remainingItems, setRemainingItems] = useState<any[]>([]);
  const [showScanner, setShowScanner] = useState(false);
  const [source, setSource] = useState<"local" | "api" | "both">("local");

  const loadRemainingItems = useCallback(async (asn: string) => {
    if (!asn || !asn.trim()) {
      Alert.alert("Error", "Please enter an ASN number");
      return;
    }

    setLoading(true);
    setRemainingItems([]);

    try {
      let items: any[] = [];
      let sourceUsed = "";

      if (source === "local" || source === "both") {
        try {
          const localItems = await dataService.getRemainingItems(asn.trim());
          items = localItems;
          sourceUsed = "Local Database";
          console.warn(`✅ Loaded ${localItems.length} remaining items from local DB for ${asn}`);
        } catch (localError: any) {
          console.error("❌ Error loading from local DB:", localError.message);
          if (source === "local") {
            throw localError;
          }
        }
      }

      if (source === "api" || source === "both") {
        try {
          const apiResponse = await apiService.getRemainingItems(asn.trim());
          let apiItems: any[] = [];
          
          if (Array.isArray(apiResponse)) {
            apiItems = apiResponse;
          } else if (apiResponse?.data && Array.isArray(apiResponse.data)) {
            apiItems = apiResponse.data;
          } else if (apiResponse?.items && Array.isArray(apiResponse.items)) {
            apiItems = apiResponse.items;
          } else if (apiResponse?.remaining_items && Array.isArray(apiResponse.remaining_items)) {
            apiItems = apiResponse.remaining_items;
          }

          if (source === "api") {
            items = apiItems;
            sourceUsed = "Backend API";
          } else if (source === "both") {
            // Merge both sources, prefer API data
            const apiItemMap = new Map(apiItems.map((item: any) => [item.item_code, item]));
            items.forEach((item) => {
              if (apiItemMap.has(item.item_code)) {
                // API has this item, use API data
                const apiItem = apiItemMap.get(item.item_code);
                Object.assign(item, apiItem);
              }
            });
            // Add items from API that aren't in local
            apiItems.forEach((apiItem: any) => {
              if (!items.find((i) => i.item_code === apiItem.item_code)) {
                items.push(apiItem);
              }
            });
            sourceUsed = "Local DB + Backend API";
          }
          console.warn(`✅ Loaded ${apiItems.length} remaining items from API for ${asn}`);
        } catch (apiError: any) {
          console.error("❌ Error loading from API:", apiError.message);
          if (source === "api") {
            Alert.alert(
              "API Error",
              `Failed to load from API: ${apiError.message}\n\nFalling back to local database.`,
              [
                {
                  text: "Use Local DB",
                  onPress: async () => {
                    setSource("local");
                    await loadRemainingItems(asn);
                  },
                },
                { text: "Cancel" },
              ]
            );
            return;
          }
        }
      }

      setRemainingItems(items);

      if (items.length === 0) {
        Alert.alert(
          "No Remaining Items",
          `No remaining items found for ${asn}.\n\nThis means:\n• All items are allocated to Transfer Orders, OR\n• No items were shipped in this ASN, OR\n• All items have been put away.`
        );
      } else {
        console.warn(`✅ Found ${items.length} remaining items for ${asn} (Source: ${sourceUsed})`);
      }
    } catch (error: any) {
      console.error("❌ Error loading remaining items:", error);
      Alert.alert("Error", `Failed to load remaining items: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [source]);

  const handleASNScan = (barcode: string) => {
    const scannedASN = barcode.trim().toUpperCase();
    setAsnNo(scannedASN);
    setShowScanner(false);
    loadRemainingItems(scannedASN);
  };

  const handleSearch = () => {
    if (!asnNo.trim()) {
      Alert.alert("Error", "Please enter an ASN number");
      return;
    }
    loadRemainingItems(asnNo.trim());
  };

  const totalRemainingQty = remainingItems.reduce(
    (sum, item) => sum + (item.remaining_qty || 0),
    0
  );
  const totalShippedQty = remainingItems.reduce(
    (sum, item) => sum + (item.shipped_qty || 0),
    0
  );
  const totalAllocatedQty = remainingItems.reduce(
    (sum, item) => sum + (item.allocated_qty || 0),
    0
  );

  return (
    <View style={styles.container}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollViewContent}
        showsVerticalScrollIndicator={true}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Remaining Items Viewer</Text>
          <Text style={styles.headerSubtitle}>
            View items that need Putaway (not allocated to TO)
          </Text>
        </View>

        <View style={styles.inputSection}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Enter ASN (e.g., ASN-AAA)"
            value={asnNo}
            onChangeText={setAsnNo}
            autoCapitalize="characters"
            placeholderTextColor="#999"
          />
          <TouchableOpacity
            style={styles.scanButton}
            onPress={() => setShowScanner(true)}
          >
            <Text style={styles.scanButtonText}>📷 Scan</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sourceSelector}>
          <Text style={styles.sourceLabel}>Data Source:</Text>
          <View style={styles.sourceButtons}>
            <TouchableOpacity
              style={[
                styles.sourceButton,
                source === "local" && styles.sourceButtonActive,
              ]}
              onPress={() => setSource("local")}
            >
              <Text
                style={[
                  styles.sourceButtonText,
                  source === "local" && styles.sourceButtonTextActive,
                ]}
              >
                Local DB
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.sourceButton,
                source === "api" && styles.sourceButtonActive,
              ]}
              onPress={() => setSource("api")}
            >
              <Text
                style={[
                  styles.sourceButtonText,
                  source === "api" && styles.sourceButtonTextActive,
                ]}
              >
                API
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.sourceButton,
                source === "both" && styles.sourceButtonActive,
              ]}
              onPress={() => setSource("both")}
            >
              <Text
                style={[
                  styles.sourceButtonText,
                  source === "both" && styles.sourceButtonTextActive,
                ]}
              >
                Both
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.searchButton, loading && styles.searchButtonDisabled]}
          onPress={handleSearch}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.searchButtonText}>🔍 Search</Text>
          )}
        </TouchableOpacity>
      </View>

      {showScanner && (
        <View style={styles.scannerContainer}>
          <BarcodeScanner
            onScan={handleASNScan}
            onCancel={() => setShowScanner(false)}
          />
        </View>
      )}

      {remainingItems.length > 0 && (
        <View style={styles.summarySection}>
          <Text style={styles.summaryTitle}>Summary</Text>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Total Items</Text>
              <Text style={styles.summaryValue}>{remainingItems.length}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Shipped Qty</Text>
              <Text style={styles.summaryValue}>{totalShippedQty}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Allocated Qty</Text>
              <Text style={styles.summaryValue}>{totalAllocatedQty}</Text>
            </View>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryLabel}>Remaining Qty</Text>
              <Text style={[styles.summaryValue, { color: "#FF9800", fontWeight: "bold" }]}>
                {totalRemainingQty}
              </Text>
            </View>
          </View>
        </View>
      )}

        <View style={styles.itemsList}>
          {loading && remainingItems.length === 0 && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.loadingText}>Loading remaining items...</Text>
            </View>
          )}

          {!loading && remainingItems.length === 0 && asnNo && (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No remaining items found</Text>
              <Text style={styles.emptySubtext}>
                All items are allocated to Transfer Orders or have been put away.
              </Text>
            </View>
          )}

          {remainingItems.map((item, index) => (
            <View key={`${item.item_code}-${index}`} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemCode}>{item.item_code}</Text>
                <StatusBadge
                  status={item.box_id ? "In Box" : "Needs TC"}
                  color={item.box_id ? "#4CAF50" : "#FF9800"}
                />
              </View>

              <View style={styles.itemDetails}>
                <View style={styles.itemDetailRow}>
                  <Text style={styles.itemDetailLabel}>Shipped Qty:</Text>
                  <Text style={styles.itemDetailValue}>{item.shipped_qty || 0}</Text>
                </View>
                <View style={styles.itemDetailRow}>
                  <Text style={styles.itemDetailLabel}>Allocated Qty:</Text>
                  <Text style={styles.itemDetailValue}>{item.allocated_qty || 0}</Text>
                </View>
                <View style={styles.itemDetailRow}>
                  <Text style={[styles.itemDetailLabel, { fontWeight: "bold" }]}>
                    Remaining Qty:
                  </Text>
                  <Text style={[styles.itemDetailValue, { color: "#FF9800", fontWeight: "bold" }]}>
                    {item.remaining_qty || 0}
                  </Text>
                </View>
                {item.scanned_to_stores !== undefined && (
                  <View style={styles.itemDetailRow}>
                    <Text style={styles.itemDetailLabel}>Scanned to Stores:</Text>
                    <Text style={styles.itemDetailValue}>{item.scanned_to_stores || 0}</Text>
                  </View>
                )}
                {item.box_id && (
                  <View style={styles.itemDetailRow}>
                    <Text style={styles.itemDetailLabel}>Box ID:</Text>
                    <Text style={[styles.itemDetailValue, { color: "#2196F3" }]}>
                      {item.box_id}
                    </Text>
                  </View>
                )}
                {item.asn_no && (
                  <View style={styles.itemDetailRow}>
                    <Text style={styles.itemDetailLabel}>ASN:</Text>
                    <Text style={styles.itemDetailValue}>{item.asn_no}</Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>
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
  scrollViewContent: {
    paddingBottom: 20,
  },
  header: {
    backgroundColor: "#007AFF",
    padding: 20,
    paddingTop: 50,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#E3F2FD",
  },
  inputSection: {
    backgroundColor: "#fff",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  inputRow: {
    flexDirection: "row",
    marginBottom: 12,
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#F9F9F9",
  },
  scanButton: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    justifyContent: "center",
  },
  scanButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  sourceSelector: {
    marginBottom: 12,
  },
  sourceLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  sourceButtons: {
    flexDirection: "row",
    gap: 8,
  },
  sourceButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    backgroundColor: "#F9F9F9",
    alignItems: "center",
  },
  sourceButtonActive: {
    backgroundColor: "#007AFF",
    borderColor: "#007AFF",
  },
  sourceButtonText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "600",
  },
  sourceButtonTextActive: {
    color: "#fff",
  },
  searchButton: {
    backgroundColor: "#007AFF",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  searchButtonDisabled: {
    backgroundColor: "#B0BEC5",
  },
  searchButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  scannerContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    backgroundColor: "#000",
  },
  summarySection: {
    backgroundColor: "#fff",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 12,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  summaryItem: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: "#F5F5F5",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  summaryLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
  },
  itemsList: {
    padding: 16,
    gap: 12,
  },
  loadingContainer: {
    padding: 40,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
  },
  emptyContainer: {
    padding: 40,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#666",
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
  },
  itemCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  itemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  itemCode: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
  },
  itemDetails: {
    gap: 8,
  },
  itemDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  itemDetailLabel: {
    fontSize: 14,
    color: "#666",
  },
  itemDetailValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
});

