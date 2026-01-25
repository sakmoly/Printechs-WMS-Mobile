import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { PickingTheme } from "../theme/picking-theme";
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import { apiService } from "../services/api.service";
import { getSettings } from "../services/settings.service";
import { relocationSessionService, RelocationMode, RelocationPolicy } from "../services/relocation-session.service";
import { addEvent } from "../services/event-queue.service";
import { getDatabase } from "../database/database";
import { getSettings as getAppSettings } from "../services/settings.service";

interface RelocationItem {
  item_code: string;
  item_name?: string;
  barcode?: string;
  available_qty: number; // Source carton qty
  move_qty: number; // Quantity to move
  remaining_qty: number; // available_qty - move_qty
}

export default function RelocationExecuteScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const routeParams = (route.params as any) || {};
  const { sessionId, mode, fromBin, fromCarton, toBin, toCarton } = routeParams;

  // ✅ Get relocation data from route params (primary) or load from local session (fallback/resume)
  const [relocationData, setRelocationData] = useState({
    mode: mode as RelocationMode | null,
    fromBin: fromBin || null,
    fromCarton: fromCarton || null,
    toBin: toBin || null,
    toCarton: toCarton || null,
    warehouseId: null as string | null,
  });

  // Load relocation data from local session if route params are missing (resume scenario)
  useEffect(() => {
    const loadRelocationData = async () => {
      // If we have route params, use them (primary source)
      if (mode && fromBin && fromCarton && toBin) {
        const settings = await getSettings();
        setRelocationData({
          mode: mode as RelocationMode,
          fromBin,
          fromCarton,
          toBin,
          toCarton: toCarton || fromCarton, // Default to_carton to from_carton for FULL_CARTON
          warehouseId: (settings as any).warehouse || (settings as any).warehouse_id || "DEFAULT",
        });
        return;
      }

      // Fallback: Load from local session if route params incomplete (resume)
      try {
        const session = await relocationSessionService.loadSession();
        if (session) {
          const settings = await getSettings();
          setRelocationData({
            mode: session.mode,
            fromBin: session.from_bin,
            fromCarton: session.from_carton,
            toBin: session.to_bin,
            toCarton: session.to_carton || session.from_carton,
            warehouseId: (settings as any).warehouse || (settings as any).warehouse_id || session.warehouse || "DEFAULT",
          });
        }
      } catch (error: any) {
        console.error("❌ Error loading relocation data from session:", error);
      }
    };
    
    loadRelocationData();
  }, [mode, fromBin, fromCarton, toBin, toCarton]);

  const [policy, setPolicy] = useState<RelocationPolicy>("BLIND");
  const [cartonContents, setCartonContents] = useState<RelocationItem[]>([]);
  const [scannedItems, setScannedItems] = useState<RelocationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [editModal, setEditModal] = useState<{
    visible: boolean;
    item: RelocationItem | null;
    newQty: string;
  }>({ visible: false, item: null, newQty: "" });

  const barcodeInputRef = useRef<TextInput>(null);
  const lastScanTimeRef = useRef<number>(0);
  const SCAN_DEBOUNCE_MS = 700;

  useEffect(() => {
    loadCartonContents();
  }, [relocationData.fromCarton, fromCarton]);

  useEffect(() => {
    // Auto-focus barcode input for PARTIAL_ITEMS and CARTON_TO_CARTON modes
    const currentMode = relocationData.mode || mode;
    if (currentMode === "PARTIAL_ITEMS" || currentMode === "CARTON_TO_CARTON") {
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 100);
    }
  }, [mode]);

  const loadCartonContents = async () => {
    const cartonToLoad = relocationData.fromCarton || fromCarton;
    if (!cartonToLoad) return;

    setLoading(true);
    try {
      let items: RelocationItem[] = [];

      // Try to get carton contents from backend first
      try {
        const cartonToLoad = relocationData.fromCarton || fromCarton;
        const contents = await apiService.getCartonContents(cartonToLoad);
        
        // ✅ Handle different API response structures
        // API may return: { items: [...] } or { ok: true, data: { items: [...] } }
        let itemsArray: any[] = [];
        if (contents.items && Array.isArray(contents.items)) {
          itemsArray = contents.items;
        } else if (contents.data && contents.data.items && Array.isArray(contents.data.items)) {
          itemsArray = contents.data.items;
        } else if (Array.isArray(contents)) {
          itemsArray = contents;
        }
        
        console.log(`📦 Carton contents API response:`, {
          hasItems: !!contents.items,
          hasDataItems: !!(contents.data && contents.data.items),
          itemsCount: itemsArray.length,
          cartonId: cartonToLoad,
        });
        
        if (itemsArray.length > 0) {
          items = itemsArray.map((item: any) => ({
            item_code: item.item_code,
            item_name: item.item_name,
            barcode: item.barcode,
            available_qty: item.qty || item.available_qty || 0,
            move_qty: 0,
            remaining_qty: item.qty || item.available_qty || 0,
          }));
          console.log(`✅ Loaded ${items.length} items from carton contents API:`, items.map(i => i.item_code));
        } else {
          console.warn(`⚠️ Carton contents API returned empty items array for carton ${cartonToLoad}`);
        }
      } catch (error: any) {
        // Backend API failed - try loading from local stock ledger
        console.warn("⚠️ Backend get-carton-contents failed, trying local stock ledger:", error.message);
      }

      // If backend didn't return items, try loading from local stock ledger
      if (items.length === 0) {
        try {
          const settings = await getAppSettings();
          const db = await getDatabase();
          const binToUse = relocationData.fromBin || fromBin;
          const cartonToUse = relocationData.fromCarton || fromCarton;
          if (db && binToUse) {
            // Try to get stock ledger from backend API first (supports carton_id filter)
            try {
              const stockLedger = await apiService.getStockLedgerByLocation({
                bin_location: binToUse,
                carton_id: cartonToUse,
                warehouse: (settings as any).warehouse || "DEFAULT",
              });

              // Parse response (could be array or object with items/data)
              let ledgerItems: any[] = [];
              if (Array.isArray(stockLedger)) {
                ledgerItems = stockLedger;
              } else if (stockLedger?.items) {
                ledgerItems = stockLedger.items;
              } else if (stockLedger?.data) {
                ledgerItems = Array.isArray(stockLedger.data) ? stockLedger.data : [];
              }

              if (ledgerItems.length > 0) {
                // Deduplicate items by item_code (sum quantities if duplicates exist)
                const itemMap = new Map<string, { qty: number; item: any }>();
                for (const stock of ledgerItems) {
                  const itemCode = stock.item_code;
                  const qty = stock.qty || stock.available_qty || 0;
                  if (itemMap.has(itemCode)) {
                    // Sum quantities for duplicate item codes
                    const existing = itemMap.get(itemCode)!;
                    existing.qty += qty;
                    // Keep the first item data
                  } else {
                    itemMap.set(itemCode, { qty, item: stock });
                  }
                }

                // Get item master data for names and barcodes
                const itemCodes = Array.from(itemMap.keys());
                const placeholders = itemCodes.map(() => "?").join(",");
                const itemMaster = await db.getAllAsync<{
                  item_code: string;
                  barcode: string;
                  item_name: string;
                }>(
                  `SELECT item_code, barcode, item_name 
                   FROM item_master 
                   WHERE item_code IN (${placeholders})`,
                  itemCodes
                );

                const masterMap = new Map(
                  itemMaster.map((item) => [item.item_code, item])
                );

                items = Array.from(itemMap.entries()).map(([itemCode, { qty, item }]) => {
                  const master = masterMap.get(itemCode);
                  return {
                    item_code: itemCode,
                    item_name: master?.item_name,
                    barcode: master?.barcode,
                    available_qty: qty,
                    move_qty: 0,
                    remaining_qty: qty,
                  };
                });

                console.log(`✅ Loaded ${items.length} unique items from backend stock ledger for carton ${cartonToUse}`);
              }
            } catch (apiError: any) {
              console.warn("⚠️ Backend stock ledger API failed, trying local cache:", apiError.message);
              
              // Fallback: Query local stock ledger cache (if it has carton_id column)
              // Note: stock_ledger_cache may not have carton_id, so this might not work
              // But we'll try anyway
              try {
                const stockItems = await db.getAllAsync<{
                  item_code: string;
                  qty: number;
                }>(
                  `SELECT item_code, qty 
                   FROM stock_ledger_cache 
                   WHERE bin_location = ? AND warehouse = ? AND qty > 0`,
                  [binToUse, (settings as any).warehouse || "DEFAULT"]
                );

                if (stockItems && stockItems.length > 0) {
                  // Deduplicate items by item_code (sum quantities if duplicates exist)
                  const itemMap = new Map<string, { qty: number; item: any }>();
                  for (const stock of stockItems) {
                    const itemCode = stock.item_code;
                    const qty = stock.qty || 0;
                    if (itemMap.has(itemCode)) {
                      // Sum quantities for duplicate item codes
                      const existing = itemMap.get(itemCode)!;
                      existing.qty += qty;
                    } else {
                      itemMap.set(itemCode, { qty, item: stock });
                    }
                  }

                  // Get item master data for names and barcodes
                  const itemCodes = Array.from(itemMap.keys());
                  const placeholders = itemCodes.map(() => "?").join(",");
                  const itemMaster = await db.getAllAsync<{
                    item_code: string;
                    barcode: string;
                    item_name: string;
                  }>(
                    `SELECT item_code, barcode, item_name 
                     FROM item_master 
                     WHERE item_code IN (${placeholders})`,
                    itemCodes
                  );

                  const masterMap = new Map(
                    itemMaster.map((item) => [item.item_code, item])
                  );

                  items = Array.from(itemMap.entries()).map(([itemCode, { qty, item }]) => {
                    const master = masterMap.get(itemCode);
                    return {
                      item_code: itemCode,
                      item_name: master?.item_name,
                      barcode: master?.barcode,
                      available_qty: qty,
                      move_qty: 0,
                      remaining_qty: qty,
                    };
                  });

                  console.log(`✅ Loaded ${items.length} unique items from local stock ledger cache for bin ${binToUse}`);
                }
              } catch (dbError: any) {
                console.warn("⚠️ Failed to load from local stock ledger cache:", dbError.message);
              }
            }
          }
        } catch (error: any) {
          console.warn("⚠️ Failed to load from stock ledger:", error.message);
        }
      }

      // For CARTON_TO_CARTON mode, automatically set move_qty = available_qty (blind mode)
      const currentMode = relocationData.mode || mode;
      if (currentMode === "CARTON_TO_CARTON" && items.length > 0) {
        items = items.map((item) => ({
          ...item,
          move_qty: item.available_qty, // Auto-select all items
          remaining_qty: 0,
        }));
        console.log(`✅ CARTON_TO_CARTON mode: Auto-loaded all ${items.length} items with full quantities`);
      }

      setCartonContents(items);
      setScannedItems(items);
    } catch (error: any) {
      console.error("❌ Error loading carton contents:", error);
      Alert.alert("Error", `Failed to load carton contents: ${error.message}`);
      setCartonContents([]);
      setScannedItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleItemScan = async (barcode: string) => {
    if (!barcode || !barcode.trim()) return;
    if (mode !== "PARTIAL_ITEMS" && mode !== "CARTON_TO_CARTON") return;

    // Debounce: prevent duplicate processing
    const now = Date.now();
    if (now - lastScanTimeRef.current < SCAN_DEBOUNCE_MS) {
      console.log("⏭️ Debounced duplicate scan");
      return;
    }
    lastScanTimeRef.current = now;

    const normalizedBarcode = barcode.trim().toUpperCase();

    // Find matching item in carton contents
    const matchingItem = scannedItems.find(
      (item) =>
        item.barcode === normalizedBarcode ||
        item.item_code === normalizedBarcode
    );

    if (!matchingItem) {
      Alert.alert(
        "Item Not Found",
        `Item "${normalizedBarcode}" not found in source carton.\n\nPlease scan an item that exists in carton ${fromCarton}.`
      );
      setBarcodeInput("");
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 100);
      return;
    }

    // Increment move_qty (but don't exceed available_qty)
    const newMoveQty = Math.min(matchingItem.move_qty + 1, matchingItem.available_qty);
    const updatedItems = scannedItems.map((item) =>
      item.item_code === matchingItem.item_code
        ? {
            ...item,
            move_qty: newMoveQty,
            remaining_qty: item.available_qty - newMoveQty,
          }
        : item
    );

    setScannedItems(updatedItems);

    // Save to session
    await relocationSessionService.updateSession({
      scanned_lines: updatedItems,
    });

    // Clear input and refocus
    setBarcodeInput("");
    setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 100);
  };

  const handleEditQty = (item: RelocationItem) => {
    setEditModal({
      visible: true,
      item,
      newQty: item.move_qty.toString(),
    });
  };

  const handleSaveEditQty = async () => {
    if (!editModal.item) return;

    const newQty = parseInt(editModal.newQty) || 0;
    const maxQty = editModal.item.available_qty;

    if (newQty < 0) {
      Alert.alert("Error", "Quantity cannot be negative");
      return;
    }

    if (newQty > maxQty) {
      Alert.alert("Error", `Quantity cannot exceed available quantity (${maxQty})`);
      return;
    }

    const updatedItems = scannedItems.map((item) =>
      item.item_code === editModal.item!.item_code
        ? {
            ...item,
            move_qty: newQty,
            remaining_qty: item.available_qty - newQty,
          }
        : item
    );

    setScannedItems(updatedItems);
    setEditModal({ visible: false, item: null, newQty: "" });

    // Save to session
    await relocationSessionService.updateSession({
      scanned_lines: updatedItems,
    });
  };

  const handleComplete = async () => {
    // Validation: Check if FULL_CARTON mode is being used for carton-to-carton merge
    if (mode === "FULL_CARTON" && fromCarton && toCarton && fromCarton !== toCarton) {
      Alert.alert(
        "Invalid Mode",
        "FULL_CARTON mode is for moving a carton from one bin to another (same carton ID).\n\n" +
        "You are trying to move items from one carton to a different carton, which requires CARTON_TO_CARTON mode.\n\n" +
        "Please start a new relocation session and select 'Carton → Carton' mode.",
        [{ text: "OK" }]
      );
      return;
    }

    // Validation: FULL_CARTON must keep same carton ID
    if (mode === "FULL_CARTON" && fromCarton && toCarton && fromCarton !== toCarton) {
      // This should have been caught above, but double-check
      return;
    }

    // Validation
    if (mode === "FULL_CARTON" && policy === "VERIFIED") {
      // Check if all items are verified (all move_qty = available_qty)
      const allVerified = scannedItems.every(
        (item) => item.move_qty === item.available_qty
      );
      if (!allVerified && scannedItems.length > 0) {
        Alert.alert(
          "Verification Incomplete",
          "Please verify all items before completing. Scan all items to match expected quantities."
        );
        return;
      }
    }

    if (mode === "PARTIAL_ITEMS" || mode === "CARTON_TO_CARTON") {
      const hasItemsToMove = scannedItems.some((item) => item.move_qty > 0);
      if (!hasItemsToMove) {
        Alert.alert("Error", "Please scan at least one item to move");
        return;
      }
    }

    setCompleting(true);
    try {
      const settings = await getSettings();

      // Prepare lines for commit
      const lines = scannedItems
        .filter((item) => item.move_qty > 0)
        .map((item) => ({
          item_code: item.item_code,
          qty: item.move_qty,
        }));

      // ✅ NEW APPROACH: Call complete endpoint with ALL relocation data
      // Session is created atomically when Complete is clicked (not before)
      let commitSuccess = false;
      let createdSessionId: string | null = null;
      
      try {
        const userId = settings.user_id || settings.user_code || "USER";
        const deviceId = settings.device_id || undefined;
        const warehouseId = relocationData.warehouseId || (settings as any).warehouse || (settings as any).warehouse_id || "DEFAULT";

        if (relocationData.mode === "FULL_CARTON") {
          // ✅ Call new complete-full endpoint with ALL data
          const response = await apiService.completeRelocationFull({
            mode: "FULL_CARTON",
            warehouse_id: warehouseId,
            from_bin: relocationData.fromBin!,
            from_carton: relocationData.fromCarton!,
            to_bin: relocationData.toBin!,
            to_carton: relocationData.toCarton || relocationData.fromCarton!,
            policy: policy,
            user_id: userId,
            device_id: deviceId,
            lines: lines, // Optional, for verified mode
          });
          
          // Session ID is now created and returned in response
          createdSessionId = response.session_id || response.data?.session_id || null;
          commitSuccess = true;
          
          console.log(`✅ Relocation completed: session_id=${createdSessionId}, mode=FULL_CARTON`);
        } else if (relocationData.mode === "PARTIAL_ITEMS" || relocationData.mode === "CARTON_TO_CARTON") {
          // ✅ Call new complete-partial endpoint with ALL data
          const response = await apiService.completeRelocationPartial({
            mode: relocationData.mode,
            warehouse_id: warehouseId,
            from_bin: relocationData.fromBin!,
            from_carton: relocationData.fromCarton!,
            to_bin: relocationData.toBin!,
            to_carton: relocationData.toCarton || relocationData.fromCarton!,
            lines: lines, // Required for partial moves
            user_id: userId,
            device_id: deviceId,
          });
          
          // Session ID is now created and returned in response
          createdSessionId = response.session_id || response.data?.session_id || null;
          commitSuccess = true;
          
          console.log(`✅ Relocation completed: session_id=${createdSessionId}, mode=${relocationData.mode}`);
        } else {
          throw new Error(`Invalid relocation mode: ${relocationData.mode}`);
        }
      } catch (error: any) {
        // ❌ Complete failed - show error and stop
        console.error(`❌ Backend complete-relocation API failed:`, error.message || error);
        
        // Extract error message from response
        let errorMessage = error.message || "Unknown error";
        try {
          const errorData = error.data || error.response?.data;
          if (errorData?.message) {
            errorMessage = String(errorData.message);
          } else if (errorData?.error?.message) {
            errorMessage = String(errorData.error.message);
          }
        } catch {}
        
        Alert.alert(
          "Relocation Failed",
          `Failed to complete relocation: ${errorMessage}\n\nPlease check the inputs and try again.`,
          [{ text: "OK" }]
        );
        setCompleting(false);
        return; // Stop - don't create events or mark as completed
      }

      // ✅ Only create events if commit succeeded (for offline sync backup)
      // Note: If backend commit API succeeds, history is already created by backend
      // Events are only needed as backup for offline scenarios
      if (commitSuccess) {
        console.log(`✅ Commit succeeded, creating RELOCATION_MOVE events for backup/offline sync`);
        // ✅ Create RELOCATION_MOVE events for offline sync backup (optional)
        // Note: Backend already created history, events are just for offline backup
        for (const line of lines) {
          await addEvent({
            event_type: "RELOCATION_MOVE",
            from_bin: relocationData.fromBin || fromBin,
            from_carton: relocationData.fromCarton || fromCarton,
            to_bin: relocationData.toBin || toBin,
            to_carton: relocationData.toCarton || toCarton || relocationData.fromCarton || fromCarton,
            item_code: line.item_code,
            qty: line.qty,
            device_id: settings.device_id ?? undefined,
            user_id: settings.user_id || settings.user_code || "USER",
          });
        }

        // ✅ Only mark as completed if commit succeeded
        // Note: Session is now created on backend with status "COMPLETED"
        // We can still update local session for tracking, then clear it
        await relocationSessionService.updateSession({
          status: "Completed",
        });

        // Clear local session only after successful completion
        await relocationSessionService.deleteSession();
        
        console.log(`✅ Relocation history created with session_id: ${createdSessionId}`);
      } else {
        // ❌ Commit failed - keep session in "In Progress" so user can retry
        console.warn(`⚠️ Commit failed - session remains in "In Progress" state`);
        // Don't mark as completed, don't delete session
        setCompleting(false);
        return; // Exit early - don't show success message
      }

      // ✅ Only show success message if commit succeeded
      const displayFromBin = relocationData.fromBin || fromBin;
      const displayToBin = relocationData.toBin || toBin;
      Alert.alert(
        "Relocation Completed",
        `Successfully moved items from ${displayFromBin} to ${displayToBin}${createdSessionId ? `\n\nSession ID: ${createdSessionId}` : ""}`,
        [
          {
            text: "OK",
            onPress: () => {
              (navigation as any).navigate("RelocationHome");
            },
          },
        ]
      );
    } catch (error: any) {
      setCompleting(false);
      console.error("❌ Error completing relocation:", error);
      Alert.alert("Error", `Failed to complete relocation: ${error.message}`);
    }
  };

  const canComplete = () => {
    if (mode === "FULL_CARTON") {
      if (policy === "BLIND") {
        return true; // Can complete immediately
      } else {
        // VERIFIED: all items must be verified
        return scannedItems.every((item) => item.move_qty === item.available_qty);
      }
    } else {
      // PARTIAL_ITEMS or CARTON_TO_CARTON
      return scannedItems.some((item) => item.move_qty > 0);
    }
  };

  return (
    <View style={styles.container}>
      {/* Purple Header */}
      <View style={styles.headerSection}>
        <Text style={styles.headerTitle}>Relocation / Bin Transfer</Text>
        <Text style={styles.headerSubtitle}>Execute Relocation</Text>
        <View style={styles.headerInfo}>
          <Text style={styles.headerInfoText}>From: {fromBin} / {fromCarton}</Text>
          <Text style={styles.headerInfoText}>To: {toBin} / {toCarton || fromCarton}</Text>
          <Text style={styles.headerInfoText}>Session: {sessionId}</Text>
        </View>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Policy Toggle (FULL_CARTON only) */}
        {mode === "FULL_CARTON" && (
          <View style={styles.policyCard}>
            <Text style={styles.policyTitle}>Move Policy</Text>
            <View style={styles.policyButtons}>
              <TouchableOpacity
                style={[
                  styles.policyButton,
                  policy === "BLIND" && styles.policyButtonActive,
                ]}
                onPress={() => setPolicy("BLIND")}
              >
                <Text
                  style={[
                    styles.policyButtonText,
                    policy === "BLIND" && styles.policyButtonTextActive,
                  ]}
                >
                  Blind Move (No Scan)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.policyButton,
                  policy === "VERIFIED" && styles.policyButtonActive,
                ]}
                onPress={() => setPolicy("VERIFIED")}
              >
                <Text
                  style={[
                    styles.policyButtonText,
                    policy === "VERIFIED" && styles.policyButtonTextActive,
                  ]}
                >
                  Verify Items (Scan)
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Item Scan Card (PARTIAL_ITEMS and CARTON_TO_CARTON) */}
        {(mode === "PARTIAL_ITEMS" || mode === "CARTON_TO_CARTON") && (
          <View style={styles.scanCard}>
            <Text style={styles.scanCardIcon}>📱</Text>
            <View style={styles.scanCardContent}>
              <Text style={styles.scanCardTitle}>Scan Item Barcode</Text>
              <Text style={styles.scanCardSubtitle}>
                Scan items to move from source carton
              </Text>
            </View>
            <View style={styles.scanInputContainer}>
              <TextInput
                ref={barcodeInputRef}
                style={styles.scanInput}
                value={barcodeInput}
                onChangeText={setBarcodeInput}
                placeholder="Scan barcode"
                autoCapitalize="characters"
                autoFocus={true}
                showSoftInputOnFocus={false}
              />
              <TouchableOpacity
                style={[styles.validateButton, !barcodeInput.trim() && styles.validateButtonDisabled]}
                onPress={() => {
                  if (barcodeInput.trim()) {
                    handleItemScan(barcodeInput);
                  }
                }}
                disabled={!barcodeInput.trim()}
              >
                <Text style={styles.validateButtonText}>Validate</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Items List */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={PickingTheme.colors.headerOrange} />
            <Text style={styles.loadingText}>Loading carton contents...</Text>
          </View>
        ) : (
          <View style={styles.itemsSection}>
            <Text style={styles.itemsTitle}>
              {mode === "FULL_CARTON" && policy === "VERIFIED"
                ? "Verify Items"
                : "Items to Move"}
            </Text>
            {scannedItems.length === 0 ? (
              <Text style={styles.emptyText}>No items found in carton</Text>
            ) : (
              <FlatList
                data={scannedItems}
                keyExtractor={(item, index) => `${item.item_code}-${item.barcode || index}-${index}`}
                renderItem={({ item }) => (
                  <View style={styles.itemCard}>
                    <View style={styles.itemHeader}>
                      <Text style={styles.itemCode}>{item.item_code}</Text>
                      {item.item_name && (
                        <Text style={styles.itemName}>{item.item_name}</Text>
                      )}
                    </View>
                    <View style={styles.itemDetails}>
                      <View style={styles.itemDetailRow}>
                        <Text style={styles.itemDetailLabel}>Available:</Text>
                        <Text style={styles.itemDetailValue}>{item.available_qty}</Text>
                      </View>
                      <View style={styles.itemDetailRow}>
                        <Text style={styles.itemDetailLabel}>Move Qty:</Text>
                        <Text style={styles.itemDetailValue}>{item.move_qty}</Text>
                      </View>
                      <View style={styles.itemDetailRow}>
                        <Text style={styles.itemDetailLabel}>Remaining:</Text>
                        <Text style={styles.itemDetailValue}>{item.remaining_qty}</Text>
                      </View>
                    </View>
                    {(mode === "PARTIAL_ITEMS" || mode === "CARTON_TO_CARTON" || (mode === "FULL_CARTON" && policy === "VERIFIED")) && (
                      <TouchableOpacity
                        style={styles.editButton}
                        onPress={() => handleEditQty(item)}
                      >
                        <Text style={styles.editButtonText}>Edit</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                scrollEnabled={false}
              />
            )}
          </View>
        )}

        {/* Complete Button */}
        {!loading && (
          <TouchableOpacity
            style={[styles.completeButton, !canComplete() && styles.completeButtonDisabled]}
            onPress={handleComplete}
            disabled={!canComplete() || completing}
          >
            {completing ? (
              <ActivityIndicator size="small" color={PickingTheme.colors.textWhite} />
            ) : (
              <Text style={styles.completeButtonText}>Complete Relocation</Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Edit Quantity Modal */}
      <Modal
        visible={editModal.visible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setEditModal({ visible: false, item: null, newQty: "" })}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Move Quantity</Text>
            {editModal.item && (
              <>
                <Text style={styles.modalItemCode}>{editModal.item.item_code}</Text>
                <Text style={styles.modalItemName}>{editModal.item.item_name || ""}</Text>
                <Text style={styles.modalLabel}>
                  Available: {editModal.item.available_qty}
                </Text>
                <TextInput
                  style={styles.modalInput}
                  value={editModal.newQty}
                  onChangeText={(text) =>
                    setEditModal({ ...editModal, newQty: text })
                  }
                  placeholder="Enter quantity"
                  keyboardType="numeric"
                  autoFocus={true}
                />
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonCancel]}
                    onPress={() => setEditModal({ visible: false, item: null, newQty: "" })}
                  >
                    <Text style={styles.modalButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonSave]}
                    onPress={handleSaveEditQty}
                  >
                    <Text style={styles.modalButtonText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <ScreenFooterFrame />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PickingTheme.colors.backgroundLight,
  },
  headerSection: {
    backgroundColor: PickingTheme.colors.headerPurple,
    padding: PickingTheme.spacing.lg,
    paddingTop: 40,
  },
  headerTitle: {
    ...PickingTheme.typography.h1,
    color: PickingTheme.colors.textWhite,
    marginBottom: 4,
  },
  headerSubtitle: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textLight,
    marginBottom: PickingTheme.spacing.sm,
  },
  headerInfo: {
    marginTop: PickingTheme.spacing.sm,
  },
  headerInfoText: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textWhite,
    opacity: 0.9,
    marginBottom: 2,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: PickingTheme.spacing.md,
  },
  policyCard: {
    backgroundColor: PickingTheme.colors.backgroundCard,
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    marginBottom: PickingTheme.spacing.md,
    ...PickingTheme.shadows.card,
  },
  policyTitle: {
    ...PickingTheme.typography.h3,
    color: PickingTheme.colors.textPrimary,
    marginBottom: PickingTheme.spacing.sm,
  },
  policyButtons: {
    flexDirection: "row",
    gap: PickingTheme.spacing.sm,
  },
  policyButton: {
    flex: 1,
    padding: PickingTheme.spacing.md,
    borderRadius: PickingTheme.borderRadius.medium,
    backgroundColor: PickingTheme.colors.backgroundLight,
    borderWidth: 2,
    borderColor: PickingTheme.colors.borderLight,
    alignItems: "center",
  },
  policyButtonActive: {
    backgroundColor: PickingTheme.colors.buttonBlue,
    borderColor: PickingTheme.colors.buttonBlue,
  },
  policyButtonText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textPrimary,
    fontWeight: "600",
  },
  policyButtonTextActive: {
    color: PickingTheme.colors.textWhite,
  },
  scanCard: {
    backgroundColor: PickingTheme.colors.buttonBlue,
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    marginBottom: PickingTheme.spacing.md,
    ...PickingTheme.shadows.card,
  },
  scanCardIcon: {
    fontSize: 32,
    marginBottom: PickingTheme.spacing.sm,
  },
  scanCardContent: {
    marginBottom: PickingTheme.spacing.sm,
  },
  scanCardTitle: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.textWhite,
    marginBottom: 4,
  },
  scanCardSubtitle: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textWhite,
    opacity: 0.9,
  },
  scanInputContainer: {
    flexDirection: "row",
    gap: PickingTheme.spacing.sm,
    marginTop: PickingTheme.spacing.sm,
  },
  scanInput: {
    flex: 1,
    backgroundColor: PickingTheme.colors.backgroundLight,
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    ...PickingTheme.typography.body,
    fontSize: 16,
    borderWidth: 2,
    borderColor: PickingTheme.colors.borderLight,
  },
  validateButton: {
    backgroundColor: PickingTheme.colors.buttonGreen,
    borderRadius: PickingTheme.borderRadius.medium,
    paddingHorizontal: PickingTheme.spacing.lg,
    paddingVertical: PickingTheme.spacing.md,
    justifyContent: "center",
    alignItems: "center",
    minWidth: 100,
    ...PickingTheme.shadows.button,
  },
  validateButtonDisabled: {
    backgroundColor: PickingTheme.colors.borderLight,
    opacity: 0.5,
  },
  validateButtonText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
    fontSize: 16,
  },
  loadingContainer: {
    alignItems: "center",
    marginTop: PickingTheme.spacing.xl,
  },
  loadingText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textSecondary,
    marginTop: PickingTheme.spacing.sm,
  },
  itemsSection: {
    marginBottom: PickingTheme.spacing.md,
  },
  itemsTitle: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.textPrimary,
    marginBottom: PickingTheme.spacing.md,
  },
  emptyText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textSecondary,
    textAlign: "center",
    padding: PickingTheme.spacing.lg,
  },
  itemCard: {
    backgroundColor: PickingTheme.colors.backgroundCard,
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    marginBottom: PickingTheme.spacing.sm,
    ...PickingTheme.shadows.card,
  },
  itemHeader: {
    marginBottom: PickingTheme.spacing.sm,
  },
  itemCode: {
    ...PickingTheme.typography.h3,
    color: PickingTheme.colors.textPrimary,
    fontWeight: "bold",
  },
  itemName: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textSecondary,
    marginTop: 2,
  },
  itemDetails: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: PickingTheme.spacing.sm,
  },
  itemDetailRow: {
    alignItems: "center",
  },
  itemDetailLabel: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textSecondary,
  },
  itemDetailValue: {
    ...PickingTheme.typography.h3,
    color: PickingTheme.colors.textPrimary,
    fontWeight: "600",
  },
  editButton: {
    backgroundColor: PickingTheme.colors.buttonBlue,
    borderRadius: PickingTheme.borderRadius.small,
    padding: PickingTheme.spacing.sm,
    alignItems: "center",
  },
  editButtonText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
  },
  completeButton: {
    backgroundColor: PickingTheme.colors.buttonGreen,
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    alignItems: "center",
    marginTop: PickingTheme.spacing.lg,
    ...PickingTheme.shadows.button,
  },
  completeButtonDisabled: {
    backgroundColor: PickingTheme.colors.borderLight,
    opacity: 0.5,
  },
  completeButtonText: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: PickingTheme.colors.backgroundCard,
    borderRadius: PickingTheme.borderRadius.large,
    padding: PickingTheme.spacing.lg,
    width: "80%",
    ...PickingTheme.shadows.button,
  },
  modalTitle: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.textPrimary,
    marginBottom: PickingTheme.spacing.md,
  },
  modalItemCode: {
    ...PickingTheme.typography.h3,
    color: PickingTheme.colors.textPrimary,
    fontWeight: "bold",
    marginBottom: 4,
  },
  modalItemName: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textSecondary,
    marginBottom: PickingTheme.spacing.md,
  },
  modalLabel: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textSecondary,
    marginBottom: PickingTheme.spacing.sm,
  },
  modalInput: {
    backgroundColor: PickingTheme.colors.backgroundLight,
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    ...PickingTheme.typography.body,
    fontSize: 18,
    borderWidth: 2,
    borderColor: PickingTheme.colors.borderLight,
    marginBottom: PickingTheme.spacing.md,
  },
  modalButtons: {
    flexDirection: "row",
    gap: PickingTheme.spacing.sm,
  },
  modalButton: {
    flex: 1,
    padding: PickingTheme.spacing.md,
    borderRadius: PickingTheme.borderRadius.medium,
    alignItems: "center",
  },
  modalButtonCancel: {
    backgroundColor: PickingTheme.colors.borderLight,
  },
  modalButtonSave: {
    backgroundColor: PickingTheme.colors.buttonGreen,
  },
  modalButtonText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
  },
});
