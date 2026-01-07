import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  Alert,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Vibration,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { apiService } from "../services/api.service";
import { getSettings } from "../services/settings.service";
import { getDatabase } from "../database/database";
import { generateUUID } from "../utils/uuid";
import { syncCycleCountSession } from "../services/cycle-count-sync.service";
import { isDeviceOnline } from "../utils/network-check";

interface CountLine {
  line_id: string;
  item_code: string;
  item_name?: string;
  barcode: string;
  uom: string;
  expected_qty: number | null;
  counted_qty: number;
  variance_qty: number | null;
  is_unexpected_item: boolean;
  reason_code?: string;
  notes?: string;
}

export default function CycleCountBinCountingScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { sessionId, binCode, binInfo, isBlindCount } = (route.params as any) || {};
  
  const [showScanner, setShowScanner] = useState(false);
  const [countLines, setCountLines] = useState<CountLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [manualBarcode, setManualBarcode] = useState("");
  const [taskTitle, setTaskTitle] = useState<string | null>(null);
  const lastScanTime = useRef<number>(0);
  const barcodeInputRef = useRef<TextInput>(null);
  const SCAN_DEBOUNCE_MS = 300;

  useFocusEffect(
    useCallback(() => {
      console.log(`🔄 useFocusEffect: Screen focused, sessionId: ${sessionId}`);
      // Load session first to get current state
      loadSession().then(() => {
        // Then load expected items (which will check database and skip if needed)
        loadExpectedItems();
      });
      // Auto-focus barcode input when screen gains focus
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 100);

      // Sync when screen loses focus (user navigates away)
      return () => {
        if (sessionId) {
          console.log(`🔄 Screen losing focus, syncing session ${sessionId}...`);
          // Use a timeout to ensure sync happens after navigation starts
          setTimeout(async () => {
            try {
              const success = await syncCycleCountSession(sessionId);
              if (success) {
                console.log(`✅ Successfully synced session ${sessionId} on navigation`);
              } else {
                console.warn(`⚠️ Sync returned false for session ${sessionId}`);
              }
            } catch (error: any) {
              console.error(`❌ Failed to sync session ${sessionId} on navigation:`, error);
              console.error(`❌ Error details:`, error.message, error.stack);
            }
          }, 100); // Small delay to ensure navigation doesn't block sync
        }
      };
    }, [sessionId])
  );

  // Auto-focus on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  const loadSession = async () => {
    if (!sessionId) {
      console.log("⚠️ loadSession: sessionId is missing");
      return;
    }
    
    try {
      console.log(`🔄 loadSession: Loading count lines for session ${sessionId}`);
      const db = await getDatabase();
      const lines = await db.getAllAsync<CountLine>(
        "SELECT * FROM cycle_count_lines WHERE session_id = ? ORDER BY updated_at DESC, created_at DESC",
        [sessionId]
      );
      console.log(`✅ loadSession: Loaded ${lines.length} count lines`);
      console.log(`📊 loadSession: Lines summary:`, lines.map(l => ({
        item_code: l.item_code,
        counted_qty: l.counted_qty,
        expected_qty: l.expected_qty
      })));
      setCountLines(lines);
    } catch (error: any) {
      console.error("❌ loadSession: Error loading session:", error);
    }
  };

  const loadExpectedItems = async () => {
    if (!binCode || isBlindCount || !sessionId) {
      console.log(`⏭️ loadExpectedItems: Skipping (binCode: ${binCode}, isBlindCount: ${isBlindCount}, sessionId: ${sessionId})`);
      return;
    }
    
    console.log(`🔄 loadExpectedItems: Starting for bin ${binCode}, session ${sessionId}`);
    setLoading(true);
    try {
      const db = await getDatabase();
      
      // CRITICAL: Check database directly, not state (state might be stale)
      const existingLinesInDb = await db.getAllAsync<{ item_code: string; counted_qty: number }>(
        "SELECT item_code, counted_qty FROM cycle_count_lines WHERE session_id = ?",
        [sessionId]
      );
      
      console.log(`📋 loadExpectedItems: Found ${existingLinesInDb.length} existing lines in database`);
      console.log(`📋 loadExpectedItems: Existing lines:`, existingLinesInDb.map(l => ({
        item_code: l.item_code,
        counted_qty: l.counted_qty
      })));
      
      // If session already has lines (especially with counted_qty > 0), don't load expected items
      // This prevents overwriting scanned data
      if (existingLinesInDb.length > 0) {
        const hasScannedItems = existingLinesInDb.some(l => l.counted_qty > 0);
        if (hasScannedItems) {
          console.log(`✅ loadExpectedItems: Session has scanned items, skipping expected items load to preserve data`);
          return;
        }
        console.log(`⚠️ loadExpectedItems: Session has lines but no scanned items, will only add missing expected items`);
      }
      
      // Load expected items from stock ledger for this bin
      let expectedItems = await db.getAllAsync<{
        item_code: string;
        qty: number;
      }>(
        "SELECT item_code, qty FROM stock_ledger_cache WHERE bin_location = ?",
        [binCode]
      );

      console.log(`📦 loadExpectedItems: Found ${expectedItems.length} expected items in stock ledger`);

      // If no items found, log warning (data should come from backend sync)
      if (expectedItems.length === 0) {
        console.warn(
          `⚠️ loadExpectedItems: No expected items found for bin ${binCode}. Please sync stock ledger data from backend.`
        );
        return;
      }

      // Get existing item codes from DATABASE (not state)
      const existingItemCodes = new Set(existingLinesInDb.map(l => l.item_code));
      console.log(`📋 loadExpectedItems: Existing item codes:`, Array.from(existingItemCodes));
      
      // Only create lines for items that don't exist in the database
      const newLines: CountLine[] = expectedItems
        .filter(item => {
          const exists = existingItemCodes.has(item.item_code);
          if (exists) {
            console.log(`⏭️ loadExpectedItems: Skipping ${item.item_code} - already exists in database`);
          }
          return !exists;
        })
        .map(item => ({
          line_id: generateUUID(),
          item_code: item.item_code,
          barcode: "",
          uom: "EA",
          expected_qty: item.qty,
          counted_qty: 0,
          variance_qty: null,
          is_unexpected_item: false,
        }));

      console.log(`➕ loadExpectedItems: Will add ${newLines.length} new expected items`);

      if (newLines.length > 0) {
        // Save new lines to database
        for (const line of newLines) {
          console.log(`💾 loadExpectedItems: Inserting line for ${line.item_code}, expected: ${line.expected_qty}`);
          await db.runAsync(
            `INSERT INTO cycle_count_lines (
              line_id, session_id, item_code, barcode, uom, expected_qty, counted_qty, is_unexpected_item, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              line.line_id,
              sessionId,
              line.item_code,
              line.barcode,
              line.uom,
              line.expected_qty,
              line.counted_qty,
              line.is_unexpected_item ? 1 : 0,
              new Date().toISOString(),
              new Date().toISOString(),
            ]
          );
        }
        console.log(`✅ loadExpectedItems: Added ${newLines.length} expected items, reloading session`);
        await loadSession();
      } else {
        console.log(`✅ loadExpectedItems: No new items to add`);
      }
    } catch (error: any) {
      console.error("❌ loadExpectedItems: Error loading expected items:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleItemScan = async (barcode: string) => {
    const now = Date.now();
    if (now - lastScanTime.current < SCAN_DEBOUNCE_MS) {
      return; // Debounce rapid scans
    }
    lastScanTime.current = now;

    setShowScanner(false);
    
    try {
      const db = await getDatabase();
      
      // Resolve barcode to item
      let barcodeMap = await db.getFirstAsync<{
        item_code: string;
        uom: string;
        pack_size: number;
        barcode_type: string;
      }>(
        "SELECT item_code, uom, pack_size, barcode_type FROM item_barcode_map WHERE barcode = ?",
        [barcode]
      );

      // Barcode mapping should come from backend sync (item_barcode_map table)
      // If not found, will try item master below

      if (!barcodeMap) {
        // Try to resolve from item master
        const itemMaster = await db.getFirstAsync<{
          item_code: string;
          barcode: string;
        }>(
          "SELECT item_code, barcode FROM item_master WHERE barcode = ?",
          [barcode]
        );

        if (!itemMaster) {
          Alert.alert("Item Not Found", `Barcode "${barcode}" not found in system`);
          // Refocus input even on error
          setTimeout(() => {
            barcodeInputRef.current?.focus();
          }, 100);
          return;
        }

        // Create barcode map entry
        await db.runAsync(
          "INSERT OR REPLACE INTO item_barcode_map (barcode, item_code, uom, pack_size, barcode_type, updated_on) VALUES (?, ?, ?, ?, ?, ?)",
          [barcode, itemMaster.item_code, "EA", 1, "Unit", new Date().toISOString()]
        );

        // Use item master data
        const increment = 1;
        await addOrIncrementItem(itemMaster.item_code, barcode, "EA", increment);
      } else {
        // Use barcode map data
        const increment = barcodeMap.pack_size || 1;
        await addOrIncrementItem(barcodeMap.item_code, barcode, barcodeMap.uom, increment);
      }

      // Vibrate on success
      Vibration.vibrate(50);
      
      // Clear input and refocus for next scan
      setManualBarcode("");
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 50);
    } catch (error: any) {
      console.error("Error processing scan:", error);
      Alert.alert("Error", `Failed to process scan: ${error.message}`);
      Vibration.vibrate([100, 50, 100]); // Error pattern
      
      // Refocus even on error
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 100);
    }
  };

  const addOrIncrementItem = async (
    itemCode: string,
    barcode: string,
    uom: string,
    increment: number
  ) => {
    try {
      if (!sessionId) {
        console.error("❌ addOrIncrementItem: sessionId is missing!");
        Alert.alert("Error", "Session ID is missing. Please restart the counting session.");
        return;
      }

      console.log(`💾 Saving item: ${itemCode}, barcode: ${barcode}, increment: ${increment}, sessionId: ${sessionId}`);
      const db = await getDatabase();
      
      // Verify session exists
      const session = await db.getFirstAsync<{ session_id: string }>(
        "SELECT session_id FROM cycle_count_sessions WHERE session_id = ?",
        [sessionId]
      );
      
      if (!session) {
        console.error(`❌ Session ${sessionId} not found in database!`);
        Alert.alert("Error", "Session not found. Please restart the counting session.");
        return;
      }

      // Check if item already exists in count lines
      const existingLine = await db.getFirstAsync<CountLine>(
        "SELECT * FROM cycle_count_lines WHERE session_id = ? AND item_code = ?",
        [sessionId, itemCode]
      );

      const now = new Date().toISOString();

      if (existingLine) {
        // Increment existing line
        const newQty = existingLine.counted_qty + increment;
        console.log(`📝 Updating existing line ${existingLine.line_id}: ${existingLine.counted_qty} + ${increment} = ${newQty}`);
        const result = await db.runAsync(
          "UPDATE cycle_count_lines SET counted_qty = ?, updated_at = ? WHERE line_id = ?",
          [newQty, now, existingLine.line_id]
        );
        console.log(`✅ Updated line:`, result);
      } else {
        // Add new line
        const lineId = generateUUID();
        const expectedQty = isBlindCount ? null : await getExpectedQty(itemCode);
        
        console.log(`➕ Inserting new line ${lineId} for item ${itemCode}, expected: ${expectedQty}, counted: ${increment}`);
        const result = await db.runAsync(
          `INSERT INTO cycle_count_lines (
            line_id, session_id, item_code, barcode, uom, expected_qty, counted_qty, is_unexpected_item, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            lineId,
            sessionId,
            itemCode,
            barcode,
            uom,
            expectedQty,
            increment,
            false,
            now,
            now,
          ]
        );
        console.log(`✅ Inserted new line:`, result);
      }

      // Automatically update session status to 'Draft' when items are scanned
      console.log(`💾 Updating session ${sessionId} status to Draft`);
      const sessionResult = await db.runAsync(
        "UPDATE cycle_count_sessions SET status = 'Draft', updated_at = ? WHERE session_id = ?",
        [now, sessionId]
      );
      console.log(`✅ Updated session status:`, sessionResult);

      // Reload session to refresh UI
      await loadSession();
      console.log(`✅ Item saved successfully: ${itemCode}`);

      // Real-time sync: If device is online, sync only the current item immediately (non-blocking)
      isDeviceOnline().then(async (online) => {
        if (online) {
          console.log(`🔄 Device is online - syncing item ${itemCode} for session ${sessionId} immediately...`);
          try {
            const syncSuccess = await syncCycleCountSession(sessionId, itemCode);
            if (syncSuccess) {
              console.log(`✅ Real-time sync successful for item ${itemCode} in session ${sessionId}`);
            } else {
              console.warn(`⚠️ Real-time sync returned false for item ${itemCode} (will retry later)`);
            }
          } catch (syncError: any) {
            console.warn(`⚠️ Real-time sync failed for item ${itemCode}:`, syncError.message);
            // Don't show error to user - sync will retry later
          }
        } else {
          console.log(`ℹ️ Device is offline - item ${itemCode} will sync when online`);
        }
      }).catch((error) => {
        console.warn(`⚠️ Error checking network status:`, error);
        // Continue without sync - will retry later
      });
    } catch (error: any) {
      console.error("❌ Error in addOrIncrementItem:", error);
      console.error("❌ Error stack:", error.stack);
      Alert.alert("Save Error", `Failed to save item: ${error.message || error.toString()}`);
      // Don't re-throw - let the UI continue working
    }
  };

  const getExpectedQty = async (itemCode: string): Promise<number | null> => {
    try {
      const db = await getDatabase();
      let stock = await db.getFirstAsync<{ qty: number }>(
        "SELECT qty FROM stock_ledger_cache WHERE item_code = ? AND bin_location = ?",
        [itemCode, binCode]
      );

      // If not found, use mock data
      if (!stock) {
        const mockStockData: Record<string, Record<string, number>> = {
          "BIN-A1-01": {
            "SKU-HAT-301-BLU-OS": 25,
            "SKU-HAT-301-GRN-OS": 30,
            "SKU-HAT-301-RED-OS": 20,
          },
          "BIN-A1-02": {
            "SKU-JACKET-201-BLK-L": 15,
            "SKU-JACKET-201-BLK-M": 18,
            "SKU-JACKET-201-BLK-XL": 12,
          },
          "BIN-B2-01": {
            "SKU-JEANS-001-BLK-32": 40,
          },
        };

        const binStock = mockStockData[binCode.toUpperCase()];
        if (binStock && binStock[itemCode]) {
          stock = { qty: binStock[itemCode] };
          // Save to cache
          await db.runAsync(
            `INSERT OR REPLACE INTO stock_ledger_cache (
              item_code, warehouse, bin_location, qty, reserved_qty, updated_on
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              itemCode,
              "WH-MAIN",
              binCode,
              stock.qty,
              0,
              new Date().toISOString(),
            ]
          );
        }
      }

      return stock?.qty || null;
    } catch {
      return null;
    }
  };

  const handleEditQty = (lineId: string, currentQty: number) => {
    setEditingLineId(lineId);
    setEditQty(currentQty.toString());
  };

  const handleSaveQty = async (lineId: string) => {
    const qty = parseFloat(editQty);
    if (isNaN(qty) || qty < 0) {
      Alert.alert("Invalid Quantity", "Please enter a valid quantity (0 or greater)");
      return;
    }

    try {
      const db = await getDatabase();
      
      // Get the item_code for this line before updating
      const line = await db.getFirstAsync<{ item_code: string }>(
        "SELECT item_code FROM cycle_count_lines WHERE line_id = ?",
        [lineId]
      );
      
      if (!line) {
        Alert.alert("Error", "Line not found");
        return;
      }
      
      const itemCode = line.item_code;
      const now = new Date().toISOString();
      await db.runAsync(
        "UPDATE cycle_count_lines SET counted_qty = ?, updated_at = ? WHERE line_id = ?",
        [qty, now, lineId]
      );
      
      // Automatically update session status to 'Draft' when quantity is edited
      await db.runAsync(
        "UPDATE cycle_count_sessions SET status = 'Draft', updated_at = ? WHERE session_id = ?",
        [now, sessionId]
      );
      
      setEditingLineId(null);
      setEditQty("");
      await loadSession();

      // Real-time sync: If device is online, sync only the edited item immediately (non-blocking)
      isDeviceOnline().then(async (online) => {
        if (online) {
          console.log(`🔄 Device is online - syncing item ${itemCode} for session ${sessionId} after quantity edit...`);
          try {
            const syncSuccess = await syncCycleCountSession(sessionId, itemCode);
            if (syncSuccess) {
              console.log(`✅ Real-time sync successful for item ${itemCode} in session ${sessionId} after edit`);
            } else {
              console.warn(`⚠️ Real-time sync returned false for item ${itemCode} (will retry later)`);
            }
          } catch (syncError: any) {
            console.warn(`⚠️ Real-time sync failed for item ${itemCode}:`, syncError.message);
            // Don't show error to user - sync will retry later
          }
        } else {
          console.log(`ℹ️ Device is offline - item ${itemCode} will sync when online`);
        }
      }).catch((error) => {
        console.warn(`⚠️ Error checking network status:`, error);
        // Continue without sync - will retry later
      });
    } catch (error: any) {
      Alert.alert("Error", `Failed to update quantity: ${error.message}`);
    }
  };

  const handleMarkBinCompleted = async () => {
    Alert.alert(
      "Mark Bin Completed",
      "This will mark all unscanned expected items as zero. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark Completed",
          onPress: async () => {
            try {
              const db = await getDatabase();
              
              // Set all expected items with 0 counted_qty to 0 (if not blind count)
              if (!isBlindCount) {
                await db.runAsync(
                  `UPDATE cycle_count_lines 
                   SET counted_qty = 0, updated_at = ? 
                   WHERE session_id = ? AND expected_qty IS NOT NULL AND counted_qty = 0`,
                  [new Date().toISOString(), sessionId]
                );
              }

              // Update session status
              await db.runAsync(
                "UPDATE cycle_count_sessions SET status = 'Completed', completed_at = ?, updated_at = ? WHERE session_id = ?",
                [new Date().toISOString(), new Date().toISOString(), sessionId]
              );

              Alert.alert(
                "Success", 
                "Bin marked as completed",
                [
                  {
                    text: "OK",
                    onPress: () => {
                      // Navigate back to dashboard
                      navigation.goBack();
                    }
                  }
                ]
              );
              await loadSession();
            } catch (error: any) {
              Alert.alert("Error", `Failed to mark bin completed: ${error.message}`);
            }
          },
        },
      ]
    );
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const db = await getDatabase();
      await db.runAsync(
        "UPDATE cycle_count_sessions SET status = 'Draft', updated_at = ? WHERE session_id = ?",
        [new Date().toISOString(), sessionId]
      );
      Alert.alert("Success", "Draft saved successfully");
    } catch (error: any) {
      Alert.alert("Error", `Failed to save draft: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitBinCount = async () => {
    // For now, submit directly without review screen
    // TODO: Navigate to Review screen when implemented
    Alert.alert(
      "Submit Bin Count",
      "This will submit the bin count. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit",
          onPress: async () => {
            setSaving(true);
            try {
              const db = await getDatabase();
              await db.runAsync(
                "UPDATE cycle_count_sessions SET status = 'Submitted', updated_at = ? WHERE session_id = ?",
                [new Date().toISOString(), sessionId]
              );
              Alert.alert("Success", "Bin count submitted successfully");
              navigation.goBack();
            } catch (error: any) {
              Alert.alert("Error", `Failed to submit: ${error.message}`);
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  const getItemName = (itemCode: string): string => {
    const itemNames: Record<string, string> = {
      "SKU-HAT-301-BLU-OS": "Hat Blue One Size",
      "SKU-HAT-301-GRN-OS": "Hat Green One Size",
      "SKU-HAT-301-RED-OS": "Hat Red One Size",
      "SKU-JACKET-201-BLK-L": "Jacket Black Large",
      "SKU-JACKET-201-BLK-M": "Jacket Black Medium",
      "SKU-JACKET-201-BLK-XL": "Jacket Black XL",
      "SKU-JEANS-001-BLK-32": "Jeans Black Size 32",
    };
    return itemNames[itemCode] || itemCode;
  };

  const renderCountLine = ({ item }: { item: CountLine }) => {
    const isEditing = editingLineId === item.line_id;
    const variance = typeof item.expected_qty === 'number'
      ? item.counted_qty - item.expected_qty 
      : null;

    return (
      <View style={styles.countLineCard}>
        <View style={styles.countLineHeader}>
          <View style={styles.countLineLeft}>
            <Text style={styles.itemCode}>{item.item_code}</Text>
            <Text style={styles.itemName}>{getItemName(item.item_code)}</Text>
            {item.barcode && (
              <Text style={styles.barcodeText}>Barcode: {item.barcode}</Text>
            )}
          </View>
          {!isBlindCount && (
            <View style={[
              styles.expectedBadge,
              variance === 0 && styles.expectedBadgeGreen
            ]}>
              <Text style={[
                styles.expectedBadgeText,
                variance === 0 && styles.expectedBadgeTextGreen
              ]}>
                Exp: {item.expected_qty ?? 0}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.countLineBody}>
          {isEditing ? (
            <View style={styles.editQtyRow}>
              <TextInput
                style={styles.editQtyInput}
                value={editQty}
                onChangeText={setEditQty}
                keyboardType="numeric"
                autoFocus
              />
              <TouchableOpacity
                style={styles.saveQtyButton}
                onPress={() => handleSaveQty(item.line_id)}
              >
                <Text style={styles.saveQtyButtonText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.cancelQtyButton}
                onPress={() => {
                  setEditingLineId(null);
                  setEditQty("");
                }}
              >
                <Text style={styles.cancelQtyButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.qtyRow}>
              <View style={styles.qtySection}>
                <Text style={styles.qtyLabel}>Counted</Text>
                <Text style={styles.qtyValue}>{item.counted_qty}</Text>
                <Text style={styles.uomText}>{item.uom}</Text>
              </View>
              
              {!isBlindCount && variance !== null && (
                <View style={styles.varianceSection}>
                  <Text style={styles.varianceLabel}>Variance</Text>
                  <Text
                    style={[
                      styles.varianceValue,
                      {
                        color:
                          variance === 0
                            ? "#4CAF50"
                            : variance > 0
                            ? "#FF9800"
                            : "#F44336",
                      },
                    ]}
                  >
                    {variance > 0 ? "+" : ""}
                    {variance}
                  </Text>
                </View>
              )}

              <TouchableOpacity
                style={styles.editButton}
                onPress={() => handleEditQty(item.line_id, item.counted_qty)}
              >
                <Text style={styles.editButtonText}>Edit</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Action Buttons - Top */}
          <View style={styles.topActionContainer}>
            <TouchableOpacity
              style={styles.topActionButton}
              onPress={handleMarkBinCompleted}
              disabled={saving}
            >
              <Text style={styles.topActionButtonText}>Mark Bin</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.topActionButton, styles.topActionButtonGreen]}
              onPress={handleSubmitBinCount}
              disabled={saving || countLines.length === 0}
            >
              <Text style={styles.topActionButtonText}>Submit Bin</Text>
            </TouchableOpacity>
          </View>

          {/* Bin Header Card */}
          <View style={styles.binHeaderCard}>
            <Text style={styles.headerTitle}>Bin: {binCode}</Text>
            {taskTitle && (
              <Text style={styles.taskTitleText}>Task: {taskTitle}</Text>
            )}
            <View style={styles.headerBadges}>
              {isBlindCount && (
                <View style={styles.blindBadge}>
                  <Text style={styles.blindBadgeText}>Blind Count</Text>
                </View>
              )}
              <Text style={styles.headerSubtext}>
                {countLines.length} item(s) scanned
              </Text>
            </View>
          </View>

          {/* Scan Card */}
          <View style={styles.scanCard}>
            <TouchableOpacity
              style={styles.scanButton}
              onPress={() => setShowScanner(true)}
            >
              <Text style={styles.scanButtonText}>Scan Item Barcode</Text>
              <Text style={styles.scanButtonSubtext}>
                Scan repeatedly to increment quantity
              </Text>
            </TouchableOpacity>

            {/* Manual Barcode Input */}
            <View style={styles.manualInputSection}>
              <Text style={styles.manualInputLabel}>Scan Item Barcode</Text>
              <View style={styles.manualInputRow}>
              <TextInput
                ref={barcodeInputRef}
                style={styles.manualInput}
                value={manualBarcode}
                onChangeText={setManualBarcode}
                placeholder="Scan or enter barcode"
                autoCapitalize="characters"
                autoFocus={true}
                blurOnSubmit={false}
                showSoftInputOnFocus={false}
                keyboardType="default"
                onSubmitEditing={() => {
                  if (manualBarcode.trim()) {
                    handleItemScan(manualBarcode.trim());
                    setManualBarcode("");
                    // Refocus immediately after submit
                    setTimeout(() => {
                      barcodeInputRef.current?.focus();
                    }, 50);
                  }
                }}
                returnKeyType="done"
                onBlur={() => {
                  // Auto-refocus when input loses focus (unless editing quantity)
                  if (!editingLineId) {
                    setTimeout(() => {
                      barcodeInputRef.current?.focus();
                    }, 100);
                  }
                }}
              />
                <TouchableOpacity
                  style={styles.submitBarcodeButton}
                  onPress={() => {
                    if (manualBarcode.trim()) {
                      handleItemScan(manualBarcode.trim());
                      setManualBarcode("");
                      // Refocus after submit
                      setTimeout(() => {
                        barcodeInputRef.current?.focus();
                      }, 50);
                    }
                  }}
                  disabled={!manualBarcode.trim()}
                >
                  <Text style={styles.submitBarcodeButtonText}>Submit</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Scanned Items List */}
          {countLines.length > 0 && (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>Scanned Items</Text>
              <FlatList
                data={countLines}
                keyExtractor={(item) => item.line_id}
                renderItem={renderCountLine}
                scrollEnabled={false}
                style={styles.list}
              />
            </View>
          )}

        </ScrollView>

        {/* Scanner Modal */}
        {showScanner && (
          <BarcodeScanner
            onScan={handleItemScan}
            onClose={() => {
              setShowScanner(false);
              // Refocus input when scanner closes
              setTimeout(() => {
                barcodeInputRef.current?.focus();
              }, 200);
            }}
            title="Scan Item Barcode"
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 0,
    paddingBottom: 12,
  },
  binHeaderCard: {
    backgroundColor: "#9C27B0",
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    borderRadius: 0,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#FFF",
    marginBottom: 6,
  },
  headerBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  blindBadge: {
    backgroundColor: "#FF9800",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  blindBadgeText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "600",
  },
  taskTitleText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFF",
    marginTop: 4,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    alignSelf: "flex-start",
  },
  headerSubtext: {
    fontSize: 14,
    color: "#E1BEE7",
  },
  scanCard: {
    backgroundColor: "#2196F3",
    marginHorizontal: 12,
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: "hidden",
  },
  scanButton: {
    paddingVertical: 8,
    alignItems: "center",
  },
  scanButtonText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#FFF",
    marginBottom: 4,
  },
  scanButtonSubtext: {
    fontSize: 14,
    color: "#E3F2FD",
  },
  manualInputSection: {
    backgroundColor: "#FFF",
    padding: 12,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.3)",
  },
  manualInputLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  manualInputRow: {
    flexDirection: "row",
    gap: 8,
  },
  manualInput: {
    flex: 1,
    backgroundColor: "#F5F5F5",
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  submitBarcodeButton: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    justifyContent: "center",
  },
  submitBarcodeButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  listSection: {
    flex: 1,
    padding: 16,
    paddingTop: 0,
  },
  listTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 12,
  },
  list: {
    flex: 1,
  },
  emptyList: {
    padding: 40,
    alignItems: "center",
  },
  emptyListText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  countLineCard: {
    backgroundColor: "#FFF",
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  countLineHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  countLineLeft: {
    flex: 1,
  },
  itemCode: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  itemName: {
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },
  barcodeText: {
    fontSize: 12,
    color: "#999",
  },
  expectedBadge: {
    backgroundColor: "#E1BEE7",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  expectedBadgeGreen: {
    backgroundColor: "#4CAF50",
  },
  expectedBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9C27B0",
  },
  expectedBadgeTextGreen: {
    color: "#FFF",
  },
  countLineBody: {
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
    paddingTop: 12,
  },
  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  qtySection: {
    flex: 1,
  },
  qtyLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  qtyValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#9C27B0",
  },
  uomText: {
    fontSize: 12,
    color: "#999",
  },
  varianceSection: {
    flex: 1,
    alignItems: "center",
  },
  varianceLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  varianceValue: {
    fontSize: 20,
    fontWeight: "bold",
  },
  editButton: {
    backgroundColor: "#9C27B0",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  editButtonText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
  },
  editQtyRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  editQtyInput: {
    flex: 1,
    backgroundColor: "#F5F5F5",
    borderWidth: 2,
    borderColor: "#9C27B0",
    borderRadius: 8,
    padding: 12,
    fontSize: 18,
    fontWeight: "600",
  },
  saveQtyButton: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveQtyButtonText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
  },
  cancelQtyButton: {
    backgroundColor: "#CCC",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  cancelQtyButtonText: {
    color: "#666",
    fontSize: 14,
    fontWeight: "600",
  },
  topActionContainer: {
    flexDirection: "row",
    gap: 8,
    marginHorizontal: 12,
    marginTop: 0,
    marginBottom: 8,
  },
  topActionButton: {
    flex: 1,
    backgroundColor: "#9C27B0",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  topActionButtonGreen: {
    backgroundColor: "#4CAF50",
  },
  topActionButtonText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "600",
  },
  actionContainer: {
    marginTop: 6,
    marginHorizontal: 12,
    marginBottom: 12,
  },
  saveDraftButton: {
    backgroundColor: "#FFF",
    borderWidth: 2,
    borderColor: "#9C27B0",
    marginBottom: 6,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  markCompletedButton: {
    backgroundColor: "#9C27B0",
    borderWidth: 2,
    borderColor: "#9C27B0",
    marginBottom: 8,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  submitButton: {
    backgroundColor: "#4CAF50",
    borderWidth: 2,
    borderColor: "#4CAF50",
    marginTop: 0,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: "center",
  },
  actionButtonText: {
    color: "#9C27B0",
    fontSize: 16,
    fontWeight: "600",
  },
  primaryActionButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  submitButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
});


