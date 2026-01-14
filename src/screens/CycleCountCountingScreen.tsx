import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { apiService } from "../services/api.service";
import { getSettings } from "../services/settings.service";
import { CycleCount } from "../types";

// Removed mock data - data should come from backend API

export default function CycleCountCountingScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { cycleCountTitle, cartonId } = (route.params as any) || {};

  const [cycleCount, setCycleCount] = useState<CycleCount | null>(null);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [actualQty, setActualQty] = useState("");
  const [actualBinLocation, setActualBinLocation] = useState("");
  const [showBinScanner, setShowBinScanner] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (cycleCountTitle) {
      loadCycleCount();
    }
  }, [cycleCountTitle]);

  useFocusEffect(
    useCallback(() => {
      // Reset actualQty and bin location when screen is focused
      setActualQty("");
      setActualBinLocation("");
    }, [])
  );

  const loadCycleCount = async () => {
    if (!cycleCountTitle) return;

    setLoading(true);
    try {
      // ✅ NEW: Filter by carton_id and/or counted_by to show only relevant items
      // This ensures each mobile session sees only items for the current carton/user
      const settings = await getSettings();
      const currentUser = settings.user_id || settings.user_code || null;
      
      // Build filter object - only include filters that are available
      const filters: { carton_id?: string; counted_by?: string } = {};
      if (cartonId) {
        filters.carton_id = cartonId;
      }
      if (currentUser) {
        filters.counted_by = currentUser;
      }
      
      console.log(`🔍 Loading cycle count ${cycleCountTitle} with filters:`, filters);
      const response = await apiService.getCycleCount(
        cycleCountTitle,
        Object.keys(filters).length > 0 ? filters : undefined
      );

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

      // API returns 'lines' but mobile app uses 'items' - map lines to items for compatibility
      if (cc && cc.lines && !cc.items) {
        cc.items = cc.lines;
      }

      if (cc) {
        setCycleCount(cc);
        // Find first uncounted item
        const firstUncountedIndex = cc.items?.findIndex(
          (item: any) => item.actual_qty === undefined
        );
        if (firstUncountedIndex !== -1) {
          setCurrentItemIndex(firstUncountedIndex);
          // Reset bin location when item changes
          setActualBinLocation("");
        } else {
          setCurrentItemIndex(0);
          setActualBinLocation("");
        }
      } else {
        // No data from API
        console.warn(`⚠️ CycleCountCountingScreen: No data found for ${cycleCountTitle}`);
        Alert.alert("Error", "Cycle Count not found. Please ensure backend has this Cycle Count task.");
        navigation.goBack();
      }
    } catch (error: any) {
      console.error("❌ Error loading Cycle Count:", error);
      // API error - show error message
      console.error(`❌ CycleCountCountingScreen: API error for ${cycleCountTitle}:`, error);
      Alert.alert("Error", `Failed to load Cycle Count: ${error.message}\n\nPlease ensure backend is available and has this Cycle Count task.`);
      navigation.goBack();
    } finally {
      setLoading(false);
    }
  };

  const getCurrentItem = () => {
    if (!cycleCount || !cycleCount.items) return null;
    return cycleCount.items[currentItemIndex];
  };

  const handleRecordCount = async () => {
    const item = getCurrentItem();
    if (!item || !cycleCount) return;

    const qty = parseFloat(actualQty);
    if (isNaN(qty) || qty < 0) {
      Alert.alert("Invalid Quantity", "Please enter a valid quantity (0 or greater)");
      return;
    }

    setSaving(true);
    try {
      const settings = await getSettings();
      const expectedQty = item.expected_qty || 0;
      const discrepancy = qty - expectedQty;

      // Record the count via API using update-line endpoint
      await apiService.updateCycleCountLine(cycleCount.title, {
        line_id: item.id,
        actual_qty: qty,
        counted_by: settings.user_id || settings.user_code || "USER-AUTO",
        discrepancy_reason: discrepancy !== 0 ? `Discrepancy: ${discrepancy > 0 ? "+" : ""}${discrepancy}` : undefined,
        // Include bin location if provided
        ...(actualBinLocation && { actual_bin_location: actualBinLocation.trim() }),
      });

      // Reload cycle count to get updated data
      await loadCycleCount();

      // Move to next uncounted item
      const nextUncountedIndex = cycleCount.items?.findIndex(
        (item: any, index: number) => index > currentItemIndex && item.actual_qty === undefined
      );

      if (nextUncountedIndex !== -1) {
        setCurrentItemIndex(nextUncountedIndex);
        setActualQty("");
        setActualBinLocation("");
      } else {
        // All items counted
        Alert.alert(
          "Counting Complete",
          `All items have been counted for ${cycleCount.title}.\n\nDiscrepancy: ${discrepancy > 0 ? "+" : ""}${discrepancy} for this item.`,
          [
            {
              text: "Review Details",
              onPress: () => {
                navigation.goBack();
              },
            },
            {
              text: "Continue",
              style: "cancel",
              onPress: () => {
                // Go to first item to review
                setCurrentItemIndex(0);
                setActualQty("");
                setActualBinLocation("");
              },
            },
          ]
        );
      }
    } catch (error: any) {
      console.error("❌ Error recording count:", error);
      Alert.alert("Error", `Failed to record count: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePrevious = () => {
    if (currentItemIndex > 0) {
      setCurrentItemIndex(currentItemIndex - 1);
      const item = cycleCount?.items?.[currentItemIndex - 1];
      setActualQty(item?.actual_qty?.toString() || "");
      setActualBinLocation(item?.actual_bin_location || "");
    }
  };

  const handleNext = () => {
    if (cycleCount && cycleCount.items && currentItemIndex < cycleCount.items.length - 1) {
      setCurrentItemIndex(currentItemIndex + 1);
      const item = cycleCount.items[currentItemIndex + 1];
      setActualQty(item?.actual_qty?.toString() || "");
      setActualBinLocation(item?.actual_bin_location || "");
    }
  };

  const handleBinLocationScan = (barcode: string) => {
    setActualBinLocation(barcode.trim());
    setShowBinScanner(false);
  };

  const handleSkip = () => {
    // Move to next uncounted item
    if (!cycleCount || !cycleCount.items) return;

    const nextUncountedIndex = cycleCount.items.findIndex(
      (item: any, index: number) => index > currentItemIndex && item.actual_qty === undefined
    );

    if (nextUncountedIndex !== -1) {
      setCurrentItemIndex(nextUncountedIndex);
      setActualQty("");
    } else {
      Alert.alert("No More Items", "All remaining items have been counted.");
    }
  };

  const handleSubmitTask = async () => {
    if (!cycleCount) return;

    // Check if all items are counted
    const allCounted = cycleCount.items?.every((item: any) => item.actual_qty !== undefined);
    if (!allCounted) {
      Alert.alert(
        "Not All Items Counted",
        "Please count all items before submitting the Cycle Count task."
      );
      return;
    }

    setSaving(true);
    try {
      await apiService.submitCycleCount(cycleCount.title);
      
      Alert.alert(
        "Task Submitted",
        `Cycle Count ${cycleCount.title} has been submitted successfully.\n\nThe task status will be updated to "Review" if there are discrepancies, or "Completed" if all counts match.`,
        [
          {
            text: "OK",
            onPress: () => {
              navigation.goBack();
            },
          },
        ]
      );
    } catch (error: any) {
      console.error("❌ Error submitting Cycle Count:", error);
      Alert.alert("Error", `Failed to submit Cycle Count: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#9C27B0" />
        <Text style={styles.loadingText}>Loading Cycle Count...</Text>
      </View>
    );
  }

  if (!cycleCount || !cycleCount.items || cycleCount.items.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Cycle Count not found or has no items</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentItem = getCurrentItem();
  if (!currentItem) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No item to count</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const expectedQty = currentItem.expected_qty || 0;
  const isCounted = currentItem.actual_qty !== undefined;
  const totalItems = cycleCount.items.length;
  const countedItems = cycleCount.items.filter((i) => i.actual_qty !== undefined).length;
  const progress = (countedItems / totalItems) * 100;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{cycleCount.title}</Text>
          <Text style={styles.headerSubtitle}>
            Item {currentItemIndex + 1} of {totalItems}
          </Text>
        </View>

        {/* Progress Bar */}
        <View style={styles.progressSection}>
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
          <Text style={styles.progressText}>
            {countedItems} / {totalItems} counted ({Math.round(progress)}%)
          </Text>
        </View>

        {/* Current Item Card */}
        <View style={styles.itemCard}>
          <View style={styles.itemHeader}>
            <Text style={styles.itemCode}>{currentItem.item_code}</Text>
            {isCounted && (
              <View style={styles.countedBadge}>
                <Text style={styles.countedBadgeText}>✓ Counted</Text>
              </View>
            )}
          </View>

          {/* Expected Bin Location */}
          {currentItem.bin_location && (
            <View style={styles.expectedSection}>
              <Text style={styles.expectedLabel}>Expected Bin Location</Text>
              <Text style={styles.expectedValue}>{currentItem.bin_location}</Text>
            </View>
          )}

          <View style={styles.expectedSection}>
            <Text style={styles.expectedLabel}>Expected Quantity</Text>
            <Text style={styles.expectedValue}>{expectedQty}</Text>
          </View>

          {/* Bin Location Input */}
          <View style={styles.inputSection}>
            <View style={styles.inputHeader}>
              <Text style={styles.inputLabel}>Bin Location</Text>
              <TouchableOpacity
                style={styles.scanButton}
                onPress={() => setShowBinScanner(true)}
              >
                <Text style={styles.scanButtonText}>📷 Scan</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              value={actualBinLocation}
              onChangeText={setActualBinLocation}
              placeholder="Scan or enter bin location"
              autoCapitalize="characters"
              editable={!saving}
            />
            {actualBinLocation && currentItem.bin_location && (
              <View style={styles.validationSection}>
                {actualBinLocation.toUpperCase() === currentItem.bin_location.toUpperCase() ? (
                  <Text style={styles.validationTextSuccess}>✓ Location matches</Text>
                ) : (
                  <Text style={styles.validationTextWarning}>
                    ⚠ Location mismatch: Expected {currentItem.bin_location}
                  </Text>
                )}
              </View>
            )}
          </View>

          {isCounted && (
            <View style={styles.previousCountSection}>
              <Text style={styles.previousCountLabel}>Previous Count:</Text>
              <Text style={styles.previousCountValue}>
                {currentItem.actual_qty} (Discrepancy:{" "}
                {currentItem.actual_qty! - expectedQty > 0 ? "+" : ""}
                {currentItem.actual_qty! - expectedQty})
              </Text>
            </View>
          )}

          <View style={styles.inputSection}>
            <Text style={styles.inputLabel}>Actual Quantity</Text>
            <TextInput
              style={styles.input}
              value={actualQty}
              onChangeText={setActualQty}
              placeholder="Enter actual quantity"
              keyboardType="numeric"
              autoFocus={!isCounted}
              editable={!saving}
            />
          </View>

          {actualQty && !isNaN(parseFloat(actualQty)) && (
            <View style={styles.discrepancySection}>
              <Text style={styles.discrepancyLabel}>Discrepancy</Text>
              <Text
                style={[
                  styles.discrepancyValue,
                  {
                    color:
                      parseFloat(actualQty) - expectedQty === 0
                        ? "#4CAF50"
                        : parseFloat(actualQty) - expectedQty > 0
                        ? "#FF9800"
                        : "#F44336",
                  },
                ]}
              >
                {parseFloat(actualQty) - expectedQty > 0 ? "+" : ""}
                {parseFloat(actualQty) - expectedQty}
              </Text>
            </View>
          )}
        </View>

        {/* Navigation Buttons */}
        <View style={styles.navigationSection}>
          <TouchableOpacity
            style={[styles.navButton, currentItemIndex === 0 && styles.navButtonDisabled]}
            onPress={handlePrevious}
            disabled={currentItemIndex === 0 || saving}
          >
            <Text style={styles.navButtonText}>← Previous</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navButton, styles.navButtonPrimary]}
            onPress={handleRecordCount}
            disabled={!actualQty || saving || isNaN(parseFloat(actualQty))}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.navButtonTextPrimary}>
                {isCounted ? "Update Count" : "Record Count"}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.navButton,
              currentItemIndex >= totalItems - 1 && styles.navButtonDisabled,
            ]}
            onPress={handleNext}
            disabled={currentItemIndex >= totalItems - 1 || saving}
          >
            <Text style={styles.navButtonText}>Next →</Text>
          </TouchableOpacity>
        </View>

        {/* Skip Button */}
        {!isCounted && (
          <TouchableOpacity
            style={styles.skipButton}
            onPress={handleSkip}
            disabled={saving}
          >
            <Text style={styles.skipButtonText}>Skip to Next Uncounted</Text>
          </TouchableOpacity>
        )}

        {/* Submit Task Button - Show when all items are counted */}
        {countedItems === totalItems && totalItems > 0 && (
          <TouchableOpacity
            style={styles.submitButton}
            onPress={handleSubmitTask}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.submitButtonText}>Submit Cycle Count Task</Text>
            )}
          </TouchableOpacity>
        )}

        {/* Back Button */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          disabled={saving}
        >
          <Text style={styles.backButtonText}>Back to Details</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Bin Location Scanner Modal */}
      {showBinScanner && (
        <BarcodeScanner
          onScan={handleBinLocationScan}
          onClose={() => setShowBinScanner(false)}
          title="Scan Bin Location"
        />
      )}
    </KeyboardAvoidingView>
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
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
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
  header: {
    backgroundColor: "#FFF",
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#9C27B0",
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: "#666",
  },
  progressSection: {
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  progressBar: {
    height: 12,
    backgroundColor: "#E0E0E0",
    borderRadius: 6,
    overflow: "hidden",
    marginBottom: 8,
  },
  progressFill: {
    height: "100%",
    borderRadius: 6,
  },
  progressText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    fontWeight: "600",
  },
  itemCard: {
    backgroundColor: "#FFF",
    padding: 24,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  itemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  itemCode: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#333",
  },
  countedBadge: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  countedBadgeText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "bold",
  },
  expectedSection: {
    backgroundColor: "#F5F5F5",
    padding: 20,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 24,
  },
  expectedLabel: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
  },
  expectedValue: {
    fontSize: 48,
    fontWeight: "bold",
    color: "#9C27B0",
  },
  previousCountSection: {
    backgroundColor: "#FFF3E0",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  previousCountLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  previousCountValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FF9800",
  },
  inputSection: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  inputHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  scanButton: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  scanButtonText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
  },
  validationSection: {
    marginTop: 8,
    padding: 8,
    borderRadius: 6,
    backgroundColor: "#F5F5F5",
  },
  validationTextSuccess: {
    color: "#4CAF50",
    fontSize: 14,
    fontWeight: "600",
  },
  validationTextWarning: {
    color: "#FF9800",
    fontSize: 14,
    fontWeight: "600",
  },
  input: {
    backgroundColor: "#F5F5F5",
    borderWidth: 2,
    borderColor: "#9C27B0",
    borderRadius: 8,
    padding: 16,
    fontSize: 32,
    fontWeight: "bold",
    textAlign: "center",
    color: "#333",
  },
  discrepancySection: {
    backgroundColor: "#F5F5F5",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  discrepancyLabel: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
  },
  discrepancyValue: {
    fontSize: 32,
    fontWeight: "bold",
  },
  navigationSection: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 12,
  },
  navButton: {
    flex: 1,
    backgroundColor: "#FFF",
    borderWidth: 2,
    borderColor: "#9C27B0",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  navButtonPrimary: {
    backgroundColor: "#9C27B0",
    borderColor: "#9C27B0",
  },
  navButtonDisabled: {
    opacity: 0.5,
  },
  navButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#9C27B0",
  },
  navButtonTextPrimary: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFF",
  },
  skipButton: {
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#999",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 16,
  },
  skipButtonText: {
    fontSize: 14,
    color: "#666",
  },
  submitButton: {
    backgroundColor: "#4CAF50",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 16,
  },
  submitButtonText: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "600",
  },
  backButton: {
    backgroundColor: "#9C27B0",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  backButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
});

