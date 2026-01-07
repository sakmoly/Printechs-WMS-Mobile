import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  FlatList,
  TextInput,
} from "react-native";
import { useApp } from "../context/AppContext";
import { useNavigation } from "@react-navigation/native";
import { StatusBadge } from "../components/StatusBadge";
import { ProgressIndicator } from "../components/ProgressIndicator";
import { BarcodeDisplay } from "../components/BarcodeDisplay";
import { dataService } from "../services/data.service";
import { apiService } from "../services/api.service";
import { Share } from "react-native";

export default function BoxManagementScreen() {
  const navigation = useNavigation();
  const { activeASN } = useApp();
  const [boxes, setBoxes] = useState<any[]>([]);
  const [selectedStore, setSelectedStore] = useState("SR-01");
  const [loading, setLoading] = useState(false);
  const [expandedBox, setExpandedBox] = useState<string | null>(null);
  const [filteredBoxes, setFilteredBoxes] = useState<any[]>([]);

  useEffect(() => {
    loadBoxes();
  }, [activeASN]);

  // Clear expanded box when store selection changes
  useEffect(() => {
    setExpandedBox(null);
  }, [selectedStore]);

  const loadBoxes = async () => {
    if (!activeASN) return;
    // Load store boxes and warehouse boxes (exclude Put Away boxes)
    const boxList = await dataService.getBoxes(activeASN);
    console.log(
      "📦 All boxes loaded:",
      boxList.map((b) => ({
        box_id: b.box_id,
        store: b.store,
        purpose: b.purpose,
      }))
    );

    // Filter out Put Away boxes - show all store boxes (SR-*) and warehouse boxes
    // Also ensure boxes have a valid store property
    const storeBoxes = boxList.filter((box) => {
      if (!box.store) {
        console.log("⚠️ Box missing store:", box.box_id);
        return false;
      }
      const storeUpper = String(box.store).trim().toUpperCase();
      const isStore = storeUpper.startsWith("SR-");
      const isWarehouse = storeUpper === "WAREHOUSE";
      const isNotPutAway = box.purpose !== "PUTAWAY";

      const shouldInclude = isNotPutAway && (isStore || isWarehouse);
      if (!shouldInclude) {
        console.log("⚠️ Box filtered out:", {
          box_id: box.box_id,
          store: box.store,
          storeUpper,
          isStore,
          isWarehouse,
          purpose: box.purpose,
          isNotPutAway,
        });
      }

      return shouldInclude;
    });

    console.log(
      "✅ Filtered boxes:",
      storeBoxes.map((b) => ({
        box_id: b.box_id,
        store: b.store,
        purpose: b.purpose,
      }))
    );

    setBoxes(storeBoxes);
  };

  const handleCreateBox = async () => {
    if (!activeASN) {
      Alert.alert("Error", "No active ASN");
      return;
    }

    setLoading(true);
    try {
      // Normalize store value to ensure consistency
      const normalizedStore = String(selectedStore).trim().toUpperCase();

      console.log("📦 Creating box for store:", normalizedStore);

      const response = await apiService.createBox({
        asn_no: activeASN,
        to_no: "TO-00012",
        store: normalizedStore,
      });

      console.log("📦 API Response:", JSON.stringify(response, null, 2));

      // Handle different response formats from backend
      // Backend might return: { box_id: "..." } or { data: { box_id: "..." } } or { box: { box_id: "..." } }
      const boxId =
        response?.box_id ||
        response?.data?.box_id ||
        response?.box?.box_id ||
        response?.id ||
        null;

      if (!boxId) {
        console.error("❌ No box_id in API response:", response);
        // Generate a temporary box ID if backend doesn't return one
        const tempBoxId = `BOX-${normalizedStore}-${Date.now()}`;
        console.warn(`⚠️ Using temporary box ID: ${tempBoxId}`);
        
        const newBox: any = {
          box_id: tempBoxId,
          asn_no: activeASN,
          to_no: "TO-00012",
          store: normalizedStore,
          status: "Open",
          purpose: "STORE",
          updated_on: new Date().toISOString(),
        };

        await dataService.saveBox(newBox);
        await loadBoxes();
        Alert.alert(
          "Success",
          `BOX ${tempBoxId} created for ${selectedStore}\n\nNote: Backend did not return box_id. Using temporary ID.`
        );
        return;
      }

      const newBox: any = {
        box_id: boxId,
        asn_no: activeASN,
        to_no: "TO-00012",
        store: normalizedStore, // Use normalized store value
        status: "Open",
        purpose: "STORE", // Explicitly set purpose for warehouse and store boxes
        updated_on: new Date().toISOString(),
      };

      console.log("💾 Saving box:", newBox);
      await dataService.saveBox(newBox);
      console.log("✅ Box saved, reloading...");
      await loadBoxes();
      Alert.alert(
        "Success",
        `BOX ${boxId} created for ${selectedStore}`
      );
    } catch (error: any) {
      console.error("❌ Error creating box:", error);
      Alert.alert("Error", error.message || "Failed to create BOX");
    } finally {
      setLoading(false);
    }
  };

  const handleCloseBox = async (boxId: string) => {
    setLoading(true);
    try {
      await apiService.closeBox({ box_id: boxId });
      await dataService.updateBoxStatus(boxId, "Closed");
      await loadBoxes();
      Alert.alert("Success", `BOX ${boxId} closed`);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to close BOX");
    } finally {
      setLoading(false);
    }
  };

  const handleReopenBox = async (boxId: string) => {
    setLoading(true);
    try {
      await apiService.reopenBox({ box_id: boxId });
      await dataService.updateBoxStatus(boxId, "Open");
      await loadBoxes();
      Alert.alert("Success", `BOX ${boxId} reopened`);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to reopen BOX");
    } finally {
      setLoading(false);
    }
  };

  const handleShareBox = async (boxId: string) => {
    try {
      await Share.share({
        message: `BOX ID: ${boxId}\nStore: ${selectedStore}\nASN: ${
          activeASN || "N/A"
        }\n\nScan this barcode during Receive + Sort to sort items into this BOX.`,
        title: "BOX Barcode",
      });
    } catch (error) {
      Alert.alert("Error", "Failed to share BOX barcode");
    }
  };

  const handlePrintBox = async (boxId: string) => {
    // In production, this would integrate with a printer SDK
    // For now, we'll use Share functionality
    try {
      await Share.share({
        message: `BOX Barcode for Printing:\n\n${boxId}\n\nStore: ${selectedStore}\nASN: ${
          activeASN || "N/A"
        }\n\nUse this barcode during Receive + Sort.`,
        title: "Print BOX Barcode",
      });
    } catch (error) {
      Alert.alert("Error", "Failed to prepare BOX barcode for printing");
    }
  };

  // Constant list of all available stores
  // Always show all stores regardless of whether boxes exist for them
  const stores = ["WAREHOUSE", "SR-01", "SR-02", "SR-03", "SR-04"];

  // Ensure selectedStore is valid when stores change
  useEffect(() => {
    if (stores.length > 0) {
      // Normalize selectedStore for comparison
      const normalizedSelected = String(selectedStore).trim().toUpperCase();
      const normalizedStores = stores.map((s) =>
        String(s).trim().toUpperCase()
      );

      if (!normalizedStores.includes(normalizedSelected)) {
        setSelectedStore(stores[0]);
      } else {
        // Ensure selectedStore matches the exact format from stores array
        const exactMatch = stores.find(
          (s) => String(s).trim().toUpperCase() === normalizedSelected
        );
        if (exactMatch && exactMatch !== selectedStore) {
          setSelectedStore(exactMatch);
        }
      }
    }
  }, [stores, selectedStore]);

  // Filter boxes to only show boxes for the selected store
  useEffect(() => {
    if (!selectedStore) {
      setFilteredBoxes([]);
      return;
    }

    const filtered = boxes.filter((b) => {
      // First, exclude boxes with null/undefined/empty box_id
      if (!b.box_id || b.box_id === "" || b.box_id === null) {
        return false;
      }
      // Ensure box has a store property
      if (!b.store) {
        return false;
      }
      // Normalize store values for comparison (trim whitespace, handle case)
      const boxStore = String(b.store).trim().toUpperCase();
      const selected = String(selectedStore).trim().toUpperCase();
      return boxStore === selected;
    });

    console.log(`🔄 Updating filtered boxes for ${selectedStore}:`, {
      totalBoxes: boxes.length,
      filteredCount: filtered.length,
      filtered: filtered.map((b) => b.box_id),
    });

    setFilteredBoxes(filtered);
  }, [boxes, selectedStore]);

  // Refresh boxes when screen comes into focus to ensure newly created boxes appear
  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      loadBoxes();
    });
    return unsubscribe;
  }, [navigation, activeASN]);

  // Group boxes by store for summary view
  const boxesByStore = stores.reduce((acc, store) => {
    acc[store] = boxes.filter((b) => b.store === store);
    return acc;
  }, {} as Record<string, any[]>);

  // Check if Next button should be enabled:
  // - At least one box exists for the selected store
  // - At least one box for the selected store is Closed
  const hasClosedBox = filteredBoxes.some((box) => box.status === "Closed");
  const canProceed = filteredBoxes.length > 0 && hasClosedBox;

  return (
    <ScrollView style={styles.container}>
      <ProgressIndicator
        currentStep={4}
        totalSteps={6}
        stepName="BOX Management"
      />
      <View style={styles.content}>
        <View style={styles.createSection}>
          <Text style={styles.sectionTitle}>Create New BOX</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.storeSelector}
            contentContainerStyle={styles.storeSelectorContent}
          >
            {stores.map((store) => (
              <TouchableOpacity
                key={store}
                style={[
                  styles.storeButton,
                  selectedStore === store && styles.storeButtonActive,
                ]}
                onPress={() => setSelectedStore(store)}
              >
                <Text
                  style={[
                    styles.storeButtonText,
                    selectedStore === store && styles.storeButtonTextActive,
                  ]}
                >
                  {store}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleCreateBox}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? "Creating..." : "Create BOX"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Summary View - Selected Store Only */}
        <View style={styles.summarySection}>
          <Text style={styles.sectionTitle}>
            {selectedStore === "WAREHOUSE"
              ? "Warehouse Boxes Summary"
              : "Showroom Boxes Summary"}
          </Text>
          <View style={styles.summaryGrid}>
            {(() => {
              const storeBoxes = boxesByStore[selectedStore] || [];
              const openCount = storeBoxes.filter(
                (b) => b.status === "Open"
              ).length;
              const closedCount = storeBoxes.filter(
                (b) => b.status === "Closed"
              ).length;
              const totalCount = storeBoxes.length;

              return (
                <TouchableOpacity
                  key={selectedStore}
                  style={[styles.summaryCard, styles.summaryCardActive]}
                  onPress={() => {}} // No action needed since only one store is shown
                  disabled={true}
                >
                  <Text style={styles.summaryStoreName}>{selectedStore}</Text>
                  <Text style={styles.summaryCount}>Total: {totalCount}</Text>
                  <View style={styles.summaryStatusRow}>
                    <Text style={styles.summaryStatusOpen}>
                      Open: {openCount}
                    </Text>
                    <Text style={styles.summaryStatusClosed}>
                      Closed: {closedCount}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })()}
          </View>
        </View>

        <View style={styles.listSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>BOXes for {selectedStore}</Text>
            <Text style={styles.boxCount}>
              {filteredBoxes.length}{" "}
              {filteredBoxes.length === 1 ? "box" : "boxes"}
            </Text>
          </View>
          {filteredBoxes.length === 0 ? (
            <Text style={styles.emptyText}>
              No BOXes found for {selectedStore}
            </Text>
          ) : (
            <FlatList
              data={filteredBoxes}
              key={`boxes-list-${selectedStore}-${filteredBoxes.length}`}
              extraData={`${selectedStore}-${filteredBoxes.length}`}
              keyExtractor={(item) => `${item.box_id}-${item.store}`}
              removeClippedSubviews={false}
              renderItem={({ item }) => (
                <View style={styles.boxItem}>
                  <TouchableOpacity
                    onPress={() =>
                      setExpandedBox(
                        expandedBox === item.box_id ? null : item.box_id
                      )
                    }
                    activeOpacity={0.7}
                  >
                    <View style={styles.boxHeader}>
                      <View style={styles.boxHeaderLeft}>
                        <Text style={styles.boxId}>{item.box_id}</Text>
                        <StatusBadge status={item.status} />
                      </View>
                      <Text style={styles.expandIcon}>
                        {expandedBox === item.box_id ? "▼" : "▶"}
                      </Text>
                    </View>
                    <View style={styles.boxStoreContainer}>
                      <Text style={styles.boxStoreLabel}>Store:</Text>
                      <Text style={styles.boxStoreValue}>{item.store}</Text>
                    </View>
                  </TouchableOpacity>

                  {expandedBox === item.box_id && (
                    <View style={styles.boxDetails}>
                      <Text style={styles.barcodeTitle}>BOX Barcode</Text>
                      <Text style={styles.barcodeHint}>
                        Scan this barcode during Receive + Sort to sort items
                        into this BOX
                      </Text>
                      <BarcodeDisplay
                        value={item.box_id}
                        format="CODE128"
                        width={280}
                        height={80}
                      />

                      <View style={styles.boxActionButtons}>
                        <TouchableOpacity
                          style={[styles.actionButton, styles.shareButton]}
                          onPress={() => handleShareBox(item.box_id)}
                        >
                          <Text style={styles.actionButtonText}>Share</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionButton, styles.printButton]}
                          onPress={() => handlePrintBox(item.box_id)}
                        >
                          <Text style={styles.actionButtonText}>Print</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  <View style={styles.boxActions}>
                    {item.status === "Open" ? (
                      <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => handleCloseBox(item.box_id)}
                      >
                        <Text style={styles.actionButtonText}>Close</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[
                          styles.actionButton,
                          styles.actionButtonSecondary,
                        ]}
                        onPress={() => handleReopenBox(item.box_id)}
                      >
                        <Text style={styles.actionButtonText}>Reopen</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}
              scrollEnabled={false}
            />
          )}
        </View>

        <TouchableOpacity
          style={[styles.nextButton, !canProceed && styles.nextButtonDisabled]}
          onPress={() => navigation.navigate("Packing" as never)}
          disabled={!canProceed}
        >
          <Text style={styles.nextButtonText}>Next →</Text>
          <Text style={styles.nextButtonSubtext}>Packing</Text>
        </TouchableOpacity>
        {!canProceed && (
          <View style={styles.hintContainer}>
            <Text style={styles.hintText}>
              {filteredBoxes.length === 0
                ? `No boxes created for ${selectedStore}. Create and close a box to proceed.`
                : `Please close at least one box for ${selectedStore} to proceed.`}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  content: {
    padding: 16,
  },
  createSection: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  listSection: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 16,
    color: "#333",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  storeSelector: {
    marginBottom: 16,
  },
  storeSelectorContent: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 16,
  },
  storeButton: {
    minWidth: 100,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#ddd",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  storeButtonActive: {
    borderColor: "#007AFF",
    backgroundColor: "#E3F2FD",
  },
  storeButtonText: {
    fontSize: 16,
    color: "#666",
    fontWeight: "600",
  },
  storeButtonTextActive: {
    color: "#007AFF",
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 18,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  boxItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  boxHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  boxHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  boxId: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
  },
  expandIcon: {
    fontSize: 16,
    color: "#666",
    marginLeft: 8,
  },
  boxDetails: {
    marginTop: 12,
    padding: 12,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  barcodeTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 4,
    textAlign: "center",
  },
  barcodeHint: {
    fontSize: 12,
    color: "#666",
    textAlign: "center",
    marginBottom: 12,
    fontStyle: "italic",
  },
  boxActionButtons: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  shareButton: {
    flex: 1,
    backgroundColor: "#2196F3",
  },
  printButton: {
    flex: 1,
    backgroundColor: "#FF9800",
  },
  boxStoreContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#F5F5F5",
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  boxStoreLabel: {
    fontSize: 14,
    color: "#666",
    fontWeight: "600",
    marginRight: 6,
  },
  boxStoreValue: {
    fontSize: 15,
    color: "#007AFF",
    fontWeight: "bold",
  },
  boxActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    backgroundColor: "#F44336",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  actionButtonSecondary: {
    backgroundColor: "#4CAF50",
  },
  actionButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  emptyText: {
    color: "#999",
    fontStyle: "italic",
    textAlign: "center",
    padding: 24,
  },
  nextButton: {
    backgroundColor: "#4CAF50",
    padding: 20,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 24,
    marginBottom: 16,
  },
  nextButtonText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
  },
  nextButtonSubtext: {
    color: "rgba(255, 255, 255, 0.9)",
    fontSize: 14,
    marginTop: 4,
  },
  nextButtonDisabled: {
    backgroundColor: "#ccc",
    opacity: 0.6,
  },
  hintContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: "#FFF3E0",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FFB74D",
  },
  hintText: {
    color: "#E65100",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  summarySection: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  summaryGrid: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
  },
  summaryCard: {
    flex: 1,
    minWidth: "30%",
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#ddd",
    backgroundColor: "#f9f9f9",
  },
  summaryCardActive: {
    borderColor: "#007AFF",
    backgroundColor: "#E3F2FD",
  },
  summaryStoreName: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 10,
    textAlign: "center",
  },
  summaryCount: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#007AFF",
    textAlign: "center",
    marginBottom: 10,
  },
  summaryStatusRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 6,
    gap: 8,
  },
  summaryStatusOpen: {
    fontSize: 13,
    color: "#2196F3",
    fontWeight: "bold",
    backgroundColor: "#E3F2FD",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  summaryStatusClosed: {
    fontSize: 13,
    color: "#4CAF50",
    fontWeight: "bold",
    backgroundColor: "#E8F5E9",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  boxCount: {
    fontSize: 14,
    color: "#007AFF",
    fontWeight: "bold",
    backgroundColor: "#E3F2FD",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
});
