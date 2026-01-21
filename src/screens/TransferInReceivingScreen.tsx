import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
  Modal,
} from "react-native";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { apiService } from "../services/api.service";
import { getSettings } from "../services/settings.service";
import { StatusBadge } from "../components/StatusBadge";
import { addEvent } from "../services/event-queue.service";

interface TransferInItem {
  item_code: string;
  qty: number;
  received_qty: number;
  carton_id: string | null;
}

interface TransferIn {
  title: string;
  status: string;
  items: TransferInItem[];
}

export default function TransferInReceivingScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { transferInTitle } = (route.params as any) || {};

  const [transferIn, setTransferIn] = useState<TransferIn | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanValue, setScanValue] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [showQuantityModal, setShowQuantityModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<TransferInItem | null>(null);
  const [quantityInput, setQuantityInput] = useState("");

  // Load Transfer In details
  const loadTransferIn = useCallback(async () => {
    if (!transferInTitle) return;

    setLoading(true);
    try {
      const response = await apiService.getTransferIn(transferInTitle);

      // Handle different response formats
      let ti: any = null;
      if (response && typeof response === "object") {
        if (response.data) {
          ti = response.data;
        } else if (response.transfer_in) {
          ti = response.transfer_in;
        } else {
          ti = response;
        }
      }

      if (ti) {
        setTransferIn(ti);
      } else {
        Alert.alert("Error", "Transfer In not found");
        navigation.goBack();
      }
    } catch (error: any) {
      console.error("❌ Error loading Transfer In:", error);
      Alert.alert("Error", `Failed to load Transfer In: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [transferInTitle, navigation]);

  useEffect(() => {
    loadTransferIn();
  }, [loadTransferIn]);

  useFocusEffect(
    useCallback(() => {
      loadTransferIn();
    }, [loadTransferIn])
  );

  // Determine if scan result is carton ID or item code
  const isCartonId = (scanResult: string): boolean => {
    // Carton IDs typically start with CTN-, CARTON-, or similar prefixes
    // Mock data uses CTN-TI-001, CTN-TI-002, etc.
    const upper = scanResult.toUpperCase().trim();
    return (
      upper.startsWith("CTN-") ||
      upper.startsWith("CARTON-") ||
      upper.startsWith("C-")
    );
  };

  // Handle scan - unified receiving logic
  const handleScan = async (barcode: string) => {
    const scanResult = barcode.trim();
    if (!scanResult) return;

    setScanValue(scanResult);

    if (isCartonId(scanResult)) {
      // Scenario A: Receive by Carton ID (Cartonized Items)
      await receiveByCarton(scanResult);
    } else {
      // Scenario B: Receive Loose Item (No Carton ID)
      await receiveByItem(scanResult);
    }
  };

  // Receive by Carton ID
  const receiveByCarton = async (cartonId: string) => {
    if (!transferIn) return;

    // Find items with this carton_id
    const itemsInCarton = transferIn.items.filter(
      (item) => item.carton_id && item.carton_id.toUpperCase() === cartonId.toUpperCase()
    );

    if (itemsInCarton.length === 0) {
      Alert.alert(
        "Carton Not Found",
        `Carton ${cartonId} not found in Transfer In ${transferIn.title}.\n\nPlease ensure you're scanning the correct carton.`
      );
      return;
    }

    // Show confirmation dialog
    const itemsList = itemsInCarton
      .map((item) => `${item.item_code} (${item.qty} units)`)
      .join("\n");

    Alert.alert(
      "Confirm Receipt",
      `Carton: ${cartonId}\n\nItems in Carton:\n${itemsList}\n\nConfirm receipt?`,
      [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => setScanValue(""),
        },
        {
          text: "Confirm Receipt",
          onPress: async () => {
            await processCartonReceipt(cartonId);
          },
        },
      ]
    );
  };

  // Process carton receipt
  const processCartonReceipt = async (cartonId: string) => {
    if (!transferIn) return;

    setReceiving(true);
    try {
      const settings = await getSettings();
      const receivedBy = settings.user_id || settings.user_code || "USER-UNKNOWN";

      // Find items in carton to create events for each
      const itemsInCarton = transferIn.items.filter(
        (item) => item.carton_id && item.carton_id.toUpperCase() === cartonId.toUpperCase()
      );

      // Create TRANSFER_IN_RECEIVE events for each item in the carton
      for (const item of itemsInCarton) {
        await addEvent({
          event_type: "TRANSFER_IN_RECEIVE",
          transfer_in: transferIn.title,
          carton_id: cartonId,
          item_code: item.item_code,
          qty: item.qty, // Full quantity for cartonized items
          device_id: settings.device_id ?? undefined,
          user_id: receivedBy,
        });
      }

      console.log(
        `✅ Created ${itemsInCarton.length} TRANSFER_IN_RECEIVE event(s) for carton ${cartonId}`
      );

      // Try to sync immediately (will queue if offline)
      try {
        const { syncEvents } = await import("../services/event-queue.service");
        await syncEvents();
      } catch (syncError: any) {
        console.warn("⚠️ Could not sync events immediately:", syncError.message);
        // Events are queued and will sync later
      }

      // Also call API directly for immediate backend update (if online)
      // ✅ FIX: Send individual item updates with carton_id for each item
      // This ensures backend can properly associate carton_id with each item
      let apiSuccess = false;
      try {
        // Option 1: Send one API call per item (more granular, ensures carton_id is captured per item)
        for (const item of itemsInCarton) {
          await apiService.receiveTransferInLine(transferIn.title, {
            carton_id: cartonId,
            item_code: item.item_code,
            received_qty: item.qty, // Full quantity for cartonized items
            received_by: receivedBy,
          });
        }
        apiSuccess = true;
        console.log(`✅ Sent ${itemsInCarton.length} receive-line API call(s) with carton_id for carton ${cartonId}`);
      } catch (apiError: any) {
        // If API call fails, events are still queued and will sync later
        // 404 errors are expected if backend endpoint is not implemented yet
        const is404 = apiError.message?.includes("404") || apiError.message?.includes("not found");
        if (is404) {
          console.log(
            "ℹ️ Transfer In receive-line endpoint not implemented yet (404). Events are queued and will sync when endpoint is available."
          );
        } else {
          console.warn(
            "⚠️ Direct API call failed, but events are queued:",
            apiError.message
          );
        }
      }

      // Update local state to reflect received quantities (for immediate UI update)
      // ✅ FIX: Also update carton_id in local state to ensure it's preserved
      if (transferIn && itemsInCarton.length > 0) {
        const updatedItems = transferIn.items.map((item) => {
          const itemInCarton = itemsInCarton.find(
            (i) => i.item_code === item.item_code
          );
          if (itemInCarton) {
            return {
              ...item,
              received_qty: item.qty, // Mark as fully received
              carton_id: cartonId, // ✅ FIX: Update carton_id in local state
            };
          }
          return item;
        });

        setTransferIn({
          ...transferIn,
          items: updatedItems,
        });
      }

      // Check if all items are now received (based on updated local state)
      const allItemsReceived = transferIn && transferIn.items?.every((i) => {
        const itemInCarton = itemsInCarton.find(c => c.item_code === i.item_code);
        if (itemInCarton) {
          return true; // This item was just received
        }
        return (i.received_qty || 0) >= (i.qty || 0); // Already fully received
      });
      
      // Putaway Tasks are auto-created by backend when all items are received
      // No manual API call needed

      // Show success message with option to go to Putaway Tasks
      if (allItemsReceived) {
        Alert.alert(
          "All Items Received",
          `All items for Transfer In ${transferIn.title} have been received.\n\n✅ Putaway Task will be created automatically by the backend.\n\nYou can now go to Putaway Tasks to perform putaway.`,
          [
            {
              text: "Stay Here",
              style: "cancel",
              onPress: () => {
                setScanValue("");
                loadTransferIn(); // Reload to get latest data
              },
            },
            {
              text: "Go to Box Management",
              onPress: () => {
                setScanValue("");
                loadTransferIn(); // Reload to get latest data
                // ✅ NEW: Navigate to Box Management to create Transfer In boxes with TI- naming series
                (navigation as any).navigate("BoxManagement", { 
                  transferIn: transferIn.title,
                  sourceType: "TransferIn" 
                });
              },
            },
          ]
        );
      } else {
        Alert.alert(
          "Success",
          `Received items from carton ${cartonId}\n\nAll items in this carton have been marked as received.\n\n${apiSuccess ? "Data synced to backend." : "Events have been queued for syncing."}`,
          [
            {
              text: "OK",
              onPress: () => {
                setScanValue("");
                loadTransferIn(); // Reload to get latest data
              },
            },
          ]
        );
      }
    } catch (error: any) {
      console.error("❌ Error receiving carton:", error);
      const errorMessage =
        error.message || error.error?.message || "Failed to receive items";
      Alert.alert("Error", errorMessage);
    } finally {
      setReceiving(false);
    }
  };

  // Receive Loose Item
  const receiveByItem = async (itemCode: string) => {
    if (!transferIn) return;

    // Find item in Transfer In
    const item = transferIn.items.find(
      (i) => i.item_code.toUpperCase() === itemCode.toUpperCase()
    );

    if (!item) {
      Alert.alert(
        "Item Not Found",
        `Item ${itemCode} not found in Transfer In ${transferIn.title}.\n\nPlease ensure you're scanning the correct item.`
      );
      return;
    }

    // Check if item has carton_id (should be received by carton instead)
    if (item.carton_id) {
      Alert.alert(
        "Item Has Carton ID",
        `Item ${itemCode} has carton ID: ${item.carton_id}\n\nPlease scan the carton instead of the item barcode.`
      );
      return;
    }

    // Check remaining quantity
    const remainingQty = item.qty - item.received_qty;
    if (remainingQty <= 0) {
      Alert.alert(
        "Already Received",
        `Item ${itemCode} has already been fully received.\n\nExpected: ${item.qty}\nReceived: ${item.received_qty}`
      );
      return;
    }

    // Automatically process receipt with quantity 1 (no confirmation modal needed)
    await processLooseItemReceiptDirect(item, 1);
  };

  // Process loose item receipt directly (without modal) - used for barcode scan
  const processLooseItemReceiptDirect = async (item: TransferInItem, receivedQty: number) => {
    if (!transferIn) return;

    const remainingQty = item.qty - item.received_qty;
    if (receivedQty > remainingQty) {
      Alert.alert(
        "Quantity Exceeds Remaining",
        `Cannot receive ${receivedQty} units.\n\nMaximum remaining: ${remainingQty} units`
      );
      return;
    }

    setReceiving(true);

    try {
      const settings = await getSettings();
      const receivedBy = settings.user_id || settings.user_code || "USER-UNKNOWN";

      // Create TRANSFER_IN_RECEIVE event for loose item
      await addEvent({
        event_type: "TRANSFER_IN_RECEIVE",
        transfer_in: transferIn.title,
        item_code: item.item_code,
        qty: receivedQty, // Incremental quantity for loose items
        device_id: settings.device_id ?? undefined,
        user_id: receivedBy,
      });

      console.log(
        `✅ Created TRANSFER_IN_RECEIVE event for item ${item.item_code} (qty: ${receivedQty})`
      );

      // Try to sync immediately (will queue if offline)
      try {
        const { syncEvents } = await import("../services/event-queue.service");
        await syncEvents();
      } catch (syncError: any) {
        console.warn("⚠️ Could not sync events immediately:", syncError.message);
        // Events are queued and will sync later
      }

      // Also call API directly for immediate backend update (if online)
      let apiSuccess = false;
      try {
        await apiService.receiveTransferInLine(transferIn.title, {
          item_code: item.item_code,
          received_qty: receivedQty,
          received_by: receivedBy,
        });
        apiSuccess = true;
      } catch (apiError: any) {
        // If API call fails, events are still queued and will sync later
        // 404 errors are expected if backend endpoint is not implemented yet
        const is404 = apiError.message?.includes("404") || apiError.message?.includes("not found");
        if (is404) {
          console.log(
            "ℹ️ Transfer In receive-line endpoint not implemented yet (404). Events are queued and will sync when endpoint is available."
          );
        } else {
          console.warn(
            "⚠️ Direct API call failed, but events are queued:",
            apiError.message
          );
        }
      }

      // Update local state to reflect received quantities (for immediate UI update)
      if (transferIn) {
        const updatedItems = transferIn.items.map((i) => {
          if (i.item_code === item.item_code) {
            return {
              ...i,
              received_qty: (i.received_qty || 0) + receivedQty,
            };
          }
          return i;
        });

        setTransferIn({
          ...transferIn,
          items: updatedItems,
        });
      }

      // Check if all items are now received (based on updated local state)
      const allItemsReceived = transferIn && transferIn.items?.every((i) => {
        if (i.item_code === item.item_code) {
          return ((i.received_qty || 0) + receivedQty) >= (i.qty || 0); // Just received this quantity
        }
        return (i.received_qty || 0) >= (i.qty || 0); // Already fully received
      });
      
      // Putaway Tasks are auto-created by backend when all items are received
      // No manual API call needed

      // Show success message with option to go to Putaway Tasks
      if (allItemsReceived) {
        Alert.alert(
          "All Items Received",
          `All items for Transfer In ${transferIn.title} have been received.\n\n✅ Putaway Task will be created automatically by the backend.\n\nYou can now go to Putaway Tasks to perform putaway.`,
          [
            {
              text: "Stay Here",
              style: "cancel",
              onPress: () => {
                setScanValue("");
                loadTransferIn(); // Reload to get latest data
              },
            },
            {
              text: "Go to Box Management",
              onPress: () => {
                setScanValue("");
                loadTransferIn(); // Reload to get latest data
                // ✅ NEW: Navigate to Box Management to create Transfer In boxes with TI- naming series
                (navigation as any).navigate("BoxManagement", { 
                  transferIn: transferIn.title,
                  sourceType: "TransferIn" 
                });
              },
            },
          ]
        );
      } else {
        // Silent success for barcode scan - just reload data
        setScanValue("");
        loadTransferIn(); // Reload to get latest data
      }
    } catch (error: any) {
      console.error("❌ Error receiving item:", error);
      const errorMessage =
        error.message || error.error?.message || "Failed to receive item";
      Alert.alert("Error", errorMessage);
    } finally {
      setReceiving(false);
    }
  };

  // Process loose item receipt (with modal) - kept for backward compatibility
  const processLooseItemReceipt = async () => {
    if (!transferIn || !selectedItem) return;

    const receivedQty = parseFloat(quantityInput);
    if (isNaN(receivedQty) || receivedQty <= 0) {
      Alert.alert("Invalid Quantity", "Please enter a valid quantity greater than 0.");
      return;
    }

    const remainingQty = selectedItem.qty - selectedItem.received_qty;
    if (receivedQty > remainingQty) {
      Alert.alert(
        "Quantity Exceeds Remaining",
        `Cannot receive ${receivedQty} units.\n\nMaximum remaining: ${remainingQty} units`
      );
      return;
    }

    setReceiving(true);
    setShowQuantityModal(false);

    try {
      const settings = await getSettings();
      const receivedBy = settings.user_id || settings.user_code || "USER-UNKNOWN";

      // Create TRANSFER_IN_RECEIVE event for loose item
      await addEvent({
        event_type: "TRANSFER_IN_RECEIVE",
        transfer_in: transferIn.title,
        item_code: selectedItem.item_code,
        qty: receivedQty, // Incremental quantity for loose items
        device_id: settings.device_id ?? undefined,
        user_id: receivedBy,
      });

      console.log(
        `✅ Created TRANSFER_IN_RECEIVE event for item ${selectedItem.item_code} (qty: ${receivedQty})`
      );

      // Try to sync immediately (will queue if offline)
      try {
        const { syncEvents } = await import("../services/event-queue.service");
        await syncEvents();
      } catch (syncError: any) {
        console.warn("⚠️ Could not sync events immediately:", syncError.message);
        // Events are queued and will sync later
      }

      // Also call API directly for immediate backend update (if online)
      let apiSuccess = false;
      try {
        await apiService.receiveTransferInLine(transferIn.title, {
          item_code: selectedItem.item_code,
          received_qty: receivedQty,
          received_by: receivedBy,
        });
        apiSuccess = true;
      } catch (apiError: any) {
        // If API call fails, events are still queued and will sync later
        // 404 errors are expected if backend endpoint is not implemented yet
        const is404 = apiError.message?.includes("404") || apiError.message?.includes("not found");
        if (is404) {
          console.log(
            "ℹ️ Transfer In receive-line endpoint not implemented yet (404). Events are queued and will sync when endpoint is available."
          );
        } else {
          console.warn(
            "⚠️ Direct API call failed, but events are queued:",
            apiError.message
          );
        }
      }

      // Update local state to reflect received quantities (for immediate UI update)
      if (transferIn && selectedItem) {
        const updatedItems = transferIn.items.map((item) => {
          if (item.item_code === selectedItem.item_code) {
            return {
              ...item,
              received_qty: (item.received_qty || 0) + receivedQty, // Incremental
            };
          }
          return item;
        });

        setTransferIn({
          ...transferIn,
          items: updatedItems,
        });
      }

      // Check if all items are now received (based on updated local state)
      const allItemsReceived = transferIn && transferIn.items?.every((i) => {
        if (i.item_code === selectedItem.item_code) {
          return ((i.received_qty || 0) + receivedQty) >= (i.qty || 0); // Just received this quantity
        }
        return (i.received_qty || 0) >= (i.qty || 0); // Already fully received
      });
      
      // Putaway Tasks are auto-created by backend when all items are received
      // No manual API call needed

      // Show success message with option to go to Putaway Tasks
      if (allItemsReceived) {
        Alert.alert(
          "All Items Received",
          `All items for Transfer In ${transferIn.title} have been received.\n\n✅ Putaway Task will be created automatically by the backend.\n\nYou can now go to Putaway Tasks to perform putaway.`,
          [
            {
              text: "Stay Here",
              style: "cancel",
              onPress: () => {
                setScanValue("");
                setSelectedItem(null);
                setQuantityInput("");
                loadTransferIn(); // Reload to get latest data
              },
            },
            {
              text: "Go to Putaway Tasks",
              onPress: () => {
                setScanValue("");
                setSelectedItem(null);
                setQuantityInput("");
                loadTransferIn(); // Reload to get latest data
                (navigation as any).navigate("PutAway");
              },
            },
          ]
        );
      } else {
        Alert.alert(
          "Success",
          `Received ${receivedQty} units of ${selectedItem.item_code}\n\nReceived quantity is incremental and has been added to existing received quantity.\n\n${apiSuccess ? "Data synced to backend." : "Events have been queued for syncing."}`,
          [
            {
              text: "OK",
              onPress: () => {
                setScanValue("");
                setSelectedItem(null);
                setQuantityInput("");
                loadTransferIn(); // Reload to get latest data
              },
            },
          ]
        );
      }
    } catch (error: any) {
      console.error("❌ Error receiving item:", error);
      const errorMessage =
        error.message || error.error?.message || "Failed to receive item";
      Alert.alert("Error", errorMessage);
    } finally {
      setReceiving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading Transfer In...</Text>
      </View>
    );
  }

  if (!transferIn) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Transfer In not found</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const totalItems = transferIn.items?.length || 0;
  const totalQty =
    transferIn.items?.reduce((sum, i) => sum + (i.qty || 0), 0) || 0;
  const receivedQty =
    transferIn.items?.reduce((sum, i) => sum + (i.received_qty || 0), 0) || 0;
  const overallProgress = totalQty > 0 ? (receivedQty / totalQty) * 100 : 0;
  const allItemsReceived = transferIn.items?.every((i) => i.received_qty >= i.qty) || false;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Receiving: {transferIn.title}</Text>
        <StatusBadge status={transferIn.status} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Progress Summary</Text>
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Items:</Text>
            <Text style={styles.summaryValue}>{totalItems}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Quantity:</Text>
            <Text style={styles.summaryValue}>{totalQty}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Received:</Text>
            <Text style={[styles.summaryValue, { color: "#4CAF50" }]}>
              {receivedQty}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Remaining:</Text>
            <Text style={[styles.summaryValue, { color: "#FF9800" }]}>
              {totalQty - receivedQty}
            </Text>
          </View>
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${overallProgress}%`,
                    backgroundColor:
                      overallProgress === 100 ? "#4CAF50" : "#2196F3",
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {Math.round(overallProgress)}% Complete
            </Text>
          </View>
        </View>
      </View>

      {!allItemsReceived && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Scan Carton or Item</Text>
          <BarcodeScanner
            onScan={handleScan}
            placeholder="Scan carton ID or item barcode"
            title="Barcode Scanner"
            value={scanValue}
            onChangeText={setScanValue}
          />
          <Text style={styles.hintText}>
            • Scan carton ID (CTN-*) to receive all items in carton
            {"\n"}• Scan item barcode to receive loose items (enter quantity)
          </Text>
        </View>
      )}

      {allItemsReceived && (
        <View style={styles.completedSection}>
          <Text style={styles.completedText}>
            ✅ All items have been received!
          </Text>
          <Text style={styles.completedSubtext}>
            Transfer In status has been updated to "Received" and Putaway Task
            has been created automatically.
          </Text>
          <TouchableOpacity
            style={styles.putawayButton}
            onPress={() => {
              // ✅ NEW: Navigate to Box Management to create Transfer In boxes with TI- naming series
              (navigation as any).navigate("BoxManagement", { 
                transferIn: transferIn.title,
                sourceType: "TransferIn" 
              });
            }}
          >
            <Text style={styles.putawayButtonText}>Go to Box Management</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Items Status</Text>
        {transferIn.items?.map((item, index) => {
          const remainingQty = item.qty - item.received_qty;
          const progress = item.qty > 0 ? (item.received_qty / item.qty) * 100 : 0;
          const isComplete = remainingQty <= 0;

          return (
            <View key={`${item.item_code}-${index}`} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemCode}>{item.item_code}</Text>
                <StatusBadge
                  status={isComplete ? "Received" : "Pending"}
                  color={isComplete ? "#4CAF50" : "#FF9800"}
                />
              </View>
              <View style={styles.itemDetails}>
                {item.carton_id && (
                  <View style={styles.qtyRow}>
                    <Text style={styles.qtyLabel}>Carton ID:</Text>
                    <Text style={styles.qtyValue}>{item.carton_id}</Text>
                  </View>
                )}
                <View style={styles.qtyRow}>
                  <Text style={styles.qtyLabel}>Expected:</Text>
                  <Text style={styles.qtyValue}>{item.qty}</Text>
                </View>
                <View style={styles.qtyRow}>
                  <Text style={styles.qtyLabel}>Received:</Text>
                  <Text style={[styles.qtyValue, { color: "#4CAF50" }]}>
                    {item.received_qty}
                  </Text>
                </View>
                <View style={styles.qtyRow}>
                  <Text style={styles.qtyLabel}>Remaining:</Text>
                  <Text
                    style={[
                      styles.qtyValue,
                      { color: remainingQty > 0 ? "#FF9800" : "#4CAF50" },
                    ]}
                  >
                    {remainingQty}
                  </Text>
                </View>
                <View style={styles.progressBarContainer}>
                  <View style={styles.progressBar}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${progress}%`,
                          backgroundColor:
                            progress === 100 ? "#4CAF50" : "#2196F3",
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.progressText}>{Math.round(progress)}%</Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>

      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
      >
        <Text style={styles.backButtonText}>Back to Details</Text>
      </TouchableOpacity>

      {/* Quantity Input Modal for Loose Items */}
      <Modal
        visible={showQuantityModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setShowQuantityModal(false);
          setSelectedItem(null);
          setQuantityInput("");
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Enter Received Quantity</Text>
            {selectedItem && (
              <>
                <Text style={styles.modalItemCode}>Item: {selectedItem.item_code}</Text>
                <TextInput
                  style={styles.quantityInput}
                  placeholder="Enter quantity"
                  value={quantityInput}
                  onChangeText={setQuantityInput}
                  keyboardType="numeric"
                  autoFocus={true}
                />
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonCancel]}
                    onPress={() => {
                      setShowQuantityModal(false);
                      setSelectedItem(null);
                      setQuantityInput("");
                    }}
                  >
                    <Text style={styles.modalButtonTextCancel}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonConfirm]}
                    onPress={processLooseItemReceipt}
                    disabled={receiving}
                  >
                    <Text style={styles.modalButtonTextConfirm}>
                      {receiving ? "Receiving..." : "Confirm Receipt"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
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
  header: {
    backgroundColor: "#FFF",
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#2196F3",
    flex: 1,
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
  hintText: {
    fontSize: 12,
    color: "#666",
    marginTop: 8,
    fontStyle: "italic",
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
  itemCard: {
    backgroundColor: "#F9F9F9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  itemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  itemCode: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  itemDetails: {
    marginTop: 8,
  },
  qtyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  qtyLabel: {
    fontSize: 14,
    color: "#666",
  },
  qtyValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#000",
  },
  completedSection: {
    backgroundColor: "#E8F5E9",
    margin: 12,
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  completedText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#4CAF50",
    marginBottom: 8,
  },
  completedSubtext: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 16,
  },
  putawayButton: {
    backgroundColor: "#4CAF50",
    padding: 14,
    borderRadius: 8,
    marginTop: 12,
    alignItems: "center",
    minWidth: 200,
  },
  putawayButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  backButton: {
    backgroundColor: "#2196F3",
    margin: 16,
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  backButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 24,
    width: "90%",
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 16,
  },
  modalItemCode: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2196F3",
    marginBottom: 12,
  },
  modalInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  modalInfoLabel: {
    fontSize: 14,
    color: "#666",
  },
  modalInfoValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#000",
  },
  quantityInput: {
    borderWidth: 1,
    borderColor: "#E0E0E0",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginTop: 16,
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
  },
  modalButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  modalButtonCancel: {
    backgroundColor: "#F5F5F5",
  },
  modalButtonConfirm: {
    backgroundColor: "#2196F3",
  },
  modalButtonTextCancel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  modalButtonTextConfirm: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFF",
  },
});

