import React, { useState, useEffect, useRef, useCallback } from "react";
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
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { PickingTheme } from "../theme/picking-theme";
// Camera not needed - using handheld scanner device
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import { apiService } from "../services/api.service";
import { getSettings } from "../services/settings.service";
import { pickingSessionService, PickingSession } from "../services/picking-session.service";
import { isDeviceOnline } from "../utils/network-check";
import {
  BarcodeInput,
  type BarcodeInputHandle,
} from "../components/BarcodeInput";

interface RequestedItem {
  line_id: string;
  item_code: string;
  item_name?: string;
  barcode?: string;
  barcodes?: string[]; // Multiple barcodes for same item
  requested_qty: number;
  picked_qty: number;
  remaining_qty: number;
  has_scanned?: boolean; // True if item has been scanned at least once
  editable?: boolean; // Enable edit after first scan (deprecated, use has_scanned)
  last_scan_time?: string;
  last_carton?: string | null;
  uom?: string; // Unit of measure
}

interface ItemLocation {
  item_code: string;
  warehouse: string;
  bin_location: string; // Location ID (e.g., "A1-R01-L3-B1")
  cartons?: {
    carton_id: string;
    qty: number;
  }[] | null;
  total_qty: number; // Total quantity at this location
  available_qty: number; // Available quantity (qty - reserved_qty)
  reserved_qty?: number; // Reserved quantity
  // Legacy fields for backward compatibility
  bin_id?: string;
  bin_code?: string;
  zone?: string;
  aisle?: string;
  rack?: string;
  warehouse_id?: string;
}

export default function PickingScanItemsScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const routeParams = (route.params as any) || {};
  const { materialRequestTitle, sessionId, binLocation: initialBinLocation, binInfo: initialBinInfo, cartonId: initialCartonId } = routeParams;

  const [materialRequest, setMaterialRequest] = useState<any>(null);
  const [requestedItems, setRequestedItems] = useState<RequestedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  /** Mirrors BarcodeInput text for manual Submit enable state */
  const [barcodeDraft, setBarcodeDraft] = useState("");
  // Camera not needed - handheld scanner inputs directly into text field
  const [binLocation, setBinLocation] = useState<string | null>(initialBinLocation || null);
  const [binInfo, setBinInfo] = useState<any>(initialBinInfo || null);
  const [cartonId, setCartonId] = useState<string | null>(initialCartonId || null);
  const [editModal, setEditModal] = useState<{
    visible: boolean;
    item: RequestedItem | null;
    newQty: string;
  }>({ visible: false, item: null, newQty: "" });
  const [locationModal, setLocationModal] = useState<{
    visible: boolean;
    item: RequestedItem | null;
    locations: ItemLocation[];
    loading: boolean;
  }>({ visible: false, item: null, locations: [], loading: false });
  const [totalScanned, setTotalScanned] = useState(0);
  const [isDirty, setIsDirty] = useState(false);

  const barcodeInputRef = useRef<BarcodeInputHandle>(null);
  const lastScanTimeRef = useRef<number>(0);
  const SCAN_DEBOUNCE_MS = 700;

  // Update bin and carton when route params change (e.g., after returning from scan screens)
  useFocusEffect(
    useCallback(() => {
      const params = (route.params as any) || {};
      if (params.binLocation !== undefined) {
        setBinLocation(params.binLocation);
      }
      if (params.binInfo !== undefined) {
        setBinInfo(params.binInfo);
      }
      if (params.cartonId !== undefined) {
        setCartonId(params.cartonId);
      }
    }, [route.params])
  );

  // Load Material Request and items
  useEffect(() => {
    if (!materialRequestTitle) return;
    
    // ✅ Validate that binLocation and cartonId are provided
    // If not, redirect to appropriate scanning screen (don't use cached values)
    if (!binLocation) {
      console.log(`⚠️ No binLocation provided - redirecting to PickingScanBin`);
      (navigation as any).navigate("PickingScanBin", {
        materialRequestTitle,
      });
      return;
    }
    
    if (!cartonId) {
      console.log(`⚠️ No cartonId provided - redirecting to PickingScanCarton`);
      (navigation as any).navigate("PickingScanCarton", {
        materialRequestTitle,
        sessionId,
        binLocation,
        binInfo,
      });
      return;
    }
    
    // Both binLocation and cartonId are present - proceed with loading
    loadMaterialRequest();
  }, [materialRequestTitle, binLocation, cartonId]);

  // Auto-focus barcode input
  useFocusEffect(
    useCallback(() => {
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 100);
    }, [])
  );

  // Check for dirty state (offline queue)
  useEffect(() => {
    checkDirtyState();
  }, []);

  const loadMaterialRequest = async () => {
    try {
      setLoading(true);
      const response = await apiService.getMaterialRequest(materialRequestTitle);
      setMaterialRequest(response);

      // Convert items to RequestedItem format
      const items: RequestedItem[] = (response.items || []).map((item: any) => ({
        line_id: item.line_id || item.item_code,
        item_code: item.item_code,
        item_name: item.item_name,
        barcode: item.barcode,
        barcodes: item.barcodes || (item.barcode ? [item.barcode] : []),
        requested_qty: item.requested_qty || 0,
        picked_qty: item.picked_qty || 0,
        remaining_qty: (item.requested_qty || 0) - (item.picked_qty || 0),
        has_scanned: (item.picked_qty || 0) > 0,
        editable: (item.picked_qty || 0) > 0,
        uom: item.uom || "pcs",
      }));

      setRequestedItems(items);
      updateTotalScanned(items);
    } catch (error: any) {
      console.error("❌ Error loading Material Request:", error);
      Alert.alert("Error", `Failed to load Material Request: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const updateTotalScanned = (items: RequestedItem[]) => {
    const total = items.reduce((sum, item) => sum + item.picked_qty, 0);
    setTotalScanned(total);
  };

  const checkDirtyState = async () => {
    const session = await pickingSessionService.loadSession(materialRequestTitle);
    if (session?.is_dirty) {
      setIsDirty(true);
    }
  };

  const findMatchingItem = (barcode: string): RequestedItem | null => {
    return (
      requestedItems.find(
        (item) =>
          item.barcode === barcode ||
          item.barcodes?.includes(barcode) ||
          item.item_code === barcode
      ) || null
    );
  };

  const handleItemScan = async (barcode: string): Promise<boolean> => {
    if (!barcode || !barcode.trim()) return false;

    // ✅ CRITICAL: Validate binLocation FIRST (before any processing)
    if (!binLocation || binLocation.trim() === "") {
      Alert.alert(
        "Bin Location Required",
        "Bin location is required for picking items.\n\nPlease scan a bin location first.",
        [
          {
            text: "Scan Bin Location",
            onPress: () => {
              (navigation as any).navigate("PickingScanBin", {
                materialRequestTitle,
                sessionId,
              });
            },
          },
          { text: "Cancel", style: "cancel" },
        ]
      );
      return false;
    }

    // Debounce: prevent duplicate processing
    const now = Date.now();
    if (now - lastScanTimeRef.current < SCAN_DEBOUNCE_MS) {
      console.log("⏭️ Debounced duplicate scan");
      return true;
    }
    lastScanTimeRef.current = now;

    const normalizedBarcode = barcode.trim().toUpperCase();
    setScanning(true);

    try {
      // Find matching item
      const matchingItem = findMatchingItem(normalizedBarcode);

      if (!matchingItem) {
        Alert.alert("Item Not Found", `Item "${normalizedBarcode}" is not in this Material Request.`);
        setTimeout(() => barcodeInputRef.current?.focus(), 100);
        return false;
      }

      // Check if already fully picked
      if (matchingItem.picked_qty >= matchingItem.requested_qty) {
        Alert.alert(
          "Already Fully Picked",
          `Item ${matchingItem.item_code} is already fully picked (${matchingItem.picked_qty}/${matchingItem.requested_qty}).`
        );
        setTimeout(() => barcodeInputRef.current?.focus(), 100);
        return false;
      }

      // ✅ CRITICAL: Validate that item exists at the current bin location and carton ID
      try {
        const warehouseId = materialRequest?.from_warehouse || binInfo?.warehouse_id || "WH-MAIN";
        const itemLocations = await apiService.getItemLocations(warehouseId, matchingItem.item_code);
        
        // Handle different response formats
        let locationEntries: any[] = [];
        if (Array.isArray(itemLocations)) {
          locationEntries = itemLocations;
        } else if (itemLocations && typeof itemLocations === "object") {
          if (Array.isArray(itemLocations.data)) {
            locationEntries = itemLocations.data;
          } else if (Array.isArray(itemLocations.locations)) {
            locationEntries = itemLocations.locations;
          } else if (Array.isArray(itemLocations.stock)) {
            locationEntries = itemLocations.stock;
          }
        }

        // Check if item exists at the current bin location
        const normalizedBinLocation = (binLocation || "").trim().toUpperCase();
        let foundAtLocation = false;
        let foundCarton = false;
        let matchingLocation: any = null;

        for (const entry of locationEntries) {
          // Get location ID from entry
          const entryLocationId = (
            entry.location_id ||
            entry.Location_ID ||
            entry.bin_location ||
            entry.Bin_Location ||
            entry.location ||
            entry.Location ||
            (entry.zone && entry.aisle && entry.rack && entry.level && entry.bin
              ? `${entry.zone}-${entry.aisle}-${entry.rack}-${entry.level}-${entry.bin}`
              : null) ||
            ""
          ).trim().toUpperCase();

          if (entryLocationId === normalizedBinLocation) {
            foundAtLocation = true;
            matchingLocation = entry;
            
            // If carton ID is provided, validate it matches
            if (cartonId && cartonId.trim() !== "") {
              const normalizedCartonId = cartonId.trim().toUpperCase();
              const entryCartonId = (
                entry.carton_id ||
                entry.carton_ID ||
                entry.Carton_ID ||
                entry.cartonId ||
                ""
              ).trim().toUpperCase();

              if (entryCartonId === normalizedCartonId) {
                foundCarton = true;
                break;
              }
            } else {
              // No carton ID required - location match is enough
              foundCarton = true;
              break;
            }
          }
        }

        // Also check grouped format (with cartons array)
        if (!foundCarton && matchingLocation && matchingLocation.cartons && Array.isArray(matchingLocation.cartons)) {
          if (cartonId && cartonId.trim() !== "") {
            const normalizedCartonId = cartonId.trim().toUpperCase();
            foundCarton = matchingLocation.cartons.some((carton: any) => {
              const cartonIdFromEntry = (carton.carton_id || carton.carton_ID || carton.Carton_ID || "").trim().toUpperCase();
              return cartonIdFromEntry === normalizedCartonId;
            });
          } else {
            foundCarton = true; // No carton ID required
          }
        }

        if (!foundAtLocation) {
          Alert.alert(
            "Invalid Location",
            `Item "${matchingItem.item_code}" is not available at location "${binLocation}".\n\nPlease scan the correct bin location or check the item locations.`,
            [
              {
                text: "View Locations",
                onPress: () => handleShowLocations(matchingItem),
              },
              { text: "OK", style: "cancel" },
            ]
          );
          setTimeout(() => barcodeInputRef.current?.focus(), 100);
          return false;
        }

        if (cartonId && cartonId.trim() !== "" && !foundCarton) {
          Alert.alert(
            "Invalid Carton ID",
            `Carton ID "${cartonId}" does not match location "${binLocation}" for item "${matchingItem.item_code}".\n\nPlease scan the correct carton ID or change the carton.`,
            [
              {
                text: "Change Carton",
                onPress: () => {
                  (navigation as any).navigate("PickingScanCarton", {
                    materialRequestTitle,
                    sessionId,
                    binLocation,
                    binInfo,
                  });
                },
              },
              { text: "OK", style: "cancel" },
            ]
          );
          setTimeout(() => barcodeInputRef.current?.focus(), 100);
          return false;
        }

        console.log(`✅ Validation passed: Item ${matchingItem.item_code} exists at ${binLocation}${cartonId ? ` with carton ${cartonId}` : ""}`);
      } catch (validationError: any) {
        // If validation fails (e.g., API error), log warning but allow scan to proceed
        // This prevents blocking picking if API is unavailable
        console.warn(`⚠️ Could not validate item location: ${validationError.message}`);
        // Don't block - allow scan to proceed if validation API is unavailable
      }

      // Optimistically update UI
      const updatedItems = requestedItems.map((item) =>
        item.line_id === matchingItem.line_id
          ? {
              ...item,
              picked_qty: item.picked_qty + 1,
              remaining_qty: item.requested_qty - (item.picked_qty + 1),
              editable: true,
              last_scan_time: new Date().toISOString(),
              last_carton: cartonId ?? undefined,
            }
          : item
      );
      setRequestedItems(updatedItems);
      updateTotalScanned(updatedItems);

      // Update backend
      const online = await isDeviceOnline();
      if (online) {
        try {
          // ✅ ALIGNED: Per WMS_MOBILE_END_TO_END_ALIGNMENT_GUIDE.md Section 6
          // Payload: { user_id, items: [{ item_code, qty, bin_location, carton_id }] }
          const settings = await getSettings();
          await apiService.pickMaterialRequestItems(
            materialRequestTitle,
            [
              {
                item_code: matchingItem.item_code,
                picked_qty: 1, // ✅ CORRECT: picked_qty (not qty)
                source_bin: binLocation, // ✅ CORRECT: source_bin (not bin_location)
                carton_id: cartonId || undefined,
              },
            ],
            materialRequest?.from_warehouse || undefined,
            settings.user_id || settings.user_code || undefined // ✅ user_id for created_by
          );
          console.log(`✅ Item scanned and stock updated: ${normalizedBarcode} from bin ${binLocation}`);
          
          // Reload Material Request to get updated picked_qty from backend
          await loadMaterialRequest();
        } catch (error: any) {
          // Rollback UI on error
          setRequestedItems(requestedItems);
          updateTotalScanned(requestedItems);
          throw error;
        }
      } else {
        // Queue for offline sync
        await pickingSessionService.addToQueue(materialRequestTitle, {
          type: "SCAN_ITEM",
          payload: {
            session_id: sessionId,
            barcode: normalizedBarcode,
            carton_id: cartonId,
          },
        });
        const session = await pickingSessionService.loadSession(materialRequestTitle);
        if (session) {
          await pickingSessionService.saveSession({ ...session, is_dirty: true });
          setIsDirty(true);
        }
      }

      // Refocus input for next scan
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 100);
      return true;
    } catch (error: any) {
      console.error("❌ Error scanning item:", error);
      Alert.alert("Error", `Failed to scan item: ${error.message}`);
      return false;
    } finally {
      setScanning(false);
    }
  };

  const handleEditQty = (item: RequestedItem) => {
    // Allow editing even if item hasn't been scanned yet
    // Show blank input instead of "0" for better UX
    const currentQty = item.picked_qty || 0;
    setEditModal({ 
      visible: true, 
      item, 
      newQty: currentQty > 0 ? currentQty.toString() : "" // Empty string instead of "0"
    });
  };

  const handleSaveEditQty = async () => {
    if (!editModal.item) return;

    // Handle empty input - treat as 0
    const qtyString = editModal.newQty.trim();
    if (qtyString === "") {
      Alert.alert("Invalid Quantity", "Please enter a quantity.");
      return;
    }

    const newQty = parseInt(qtyString, 10);
    if (isNaN(newQty) || newQty < 0) {
      Alert.alert("Invalid Quantity", "Please enter a valid quantity.");
      return;
    }

    const oldQty = editModal.item.picked_qty;
    const qtyDifference = newQty - oldQty;

    if (qtyDifference === 0) {
      setEditModal({ visible: false, item: null, newQty: "" });
      return;
    }

    try {
      setLoading(true);
      
      // ✅ CRITICAL: Validate binLocation FIRST (required for stock reduction)
      if (!binLocation || binLocation.trim() === "") {
        Alert.alert(
          "Bin Location Required",
          "Bin location is required for updating quantity.\n\nPlease scan a bin location first.",
          [
            {
              text: "Scan Bin Location",
              onPress: () => {
                (navigation as any).navigate("PickingScanBin", {
                  materialRequestTitle,
                  sessionId,
                });
              },
            },
            { text: "Cancel", style: "cancel" },
          ]
        );
        setLoading(false);
        return;
      }

      // ✅ CRITICAL: Validate that item exists at the current bin location and carton ID
      try {
        const warehouseId = materialRequest?.from_warehouse || binInfo?.warehouse_id || "WH-MAIN";
        const itemLocations = await apiService.getItemLocations(warehouseId, editModal.item.item_code);
        
        // Handle different response formats
        let locationEntries: any[] = [];
        if (Array.isArray(itemLocations)) {
          locationEntries = itemLocations;
        } else if (itemLocations && typeof itemLocations === "object") {
          if (Array.isArray(itemLocations.data)) {
            locationEntries = itemLocations.data;
          } else if (Array.isArray(itemLocations.locations)) {
            locationEntries = itemLocations.locations;
          } else if (Array.isArray(itemLocations.stock)) {
            locationEntries = itemLocations.stock;
          }
        }

        // Check if item exists at the current bin location
        const normalizedBinLocation = (binLocation || "").trim().toUpperCase();
        let foundAtLocation = false;
        let foundCarton = false;
        let matchingLocation: any = null;

        for (const entry of locationEntries) {
          // Get location ID from entry
          const entryLocationId = (
            entry.location_id ||
            entry.Location_ID ||
            entry.bin_location ||
            entry.Bin_Location ||
            entry.location ||
            entry.Location ||
            (entry.zone && entry.aisle && entry.rack && entry.level && entry.bin
              ? `${entry.zone}-${entry.aisle}-${entry.rack}-${entry.level}-${entry.bin}`
              : null) ||
            ""
          ).trim().toUpperCase();

          if (entryLocationId === normalizedBinLocation) {
            foundAtLocation = true;
            matchingLocation = entry;
            
            // If carton ID is provided, validate it matches
            if (cartonId && cartonId.trim() !== "") {
              const normalizedCartonId = cartonId.trim().toUpperCase();
              const entryCartonId = (
                entry.carton_id ||
                entry.carton_ID ||
                entry.Carton_ID ||
                entry.cartonId ||
                ""
              ).trim().toUpperCase();

              if (entryCartonId === normalizedCartonId) {
                foundCarton = true;
                break;
              }
            } else {
              // No carton ID required - location match is enough
              foundCarton = true;
              break;
            }
          }
        }

        // Also check grouped format (with cartons array)
        if (!foundCarton && matchingLocation && matchingLocation.cartons && Array.isArray(matchingLocation.cartons)) {
          if (cartonId && cartonId.trim() !== "") {
            const normalizedCartonId = cartonId.trim().toUpperCase();
            foundCarton = matchingLocation.cartons.some((carton: any) => {
              const cartonIdFromEntry = (carton.carton_id || carton.carton_ID || carton.Carton_ID || "").trim().toUpperCase();
              return cartonIdFromEntry === normalizedCartonId;
            });
          } else {
            foundCarton = true; // No carton ID required
          }
        }

        if (!foundAtLocation) {
          Alert.alert(
            "Invalid Location",
            `Item "${editModal.item.item_code}" is not available at location "${binLocation}".\n\nPlease scan the correct bin location or check the item locations.`,
            [
              {
                text: "View Locations",
                onPress: () => handleShowLocations(editModal.item!),
              },
              { text: "OK", style: "cancel" },
            ]
          );
          setLoading(false);
          return;
        }

        if (cartonId && cartonId.trim() !== "" && !foundCarton) {
          Alert.alert(
            "Invalid Carton ID",
            `Carton ID "${cartonId}" does not match location "${binLocation}" for item "${editModal.item.item_code}".\n\nPlease scan the correct carton ID or change the carton.`,
            [
              {
                text: "Change Carton",
                onPress: () => {
                  (navigation as any).navigate("PickingScanCarton", {
                    materialRequestTitle,
                    sessionId,
                    binLocation,
                    binInfo,
                  });
                },
              },
              { text: "OK", style: "cancel" },
            ]
          );
          setLoading(false);
          return;
        }

        console.log(`✅ Validation passed: Item ${editModal.item.item_code} exists at ${binLocation}${cartonId ? ` with carton ${cartonId}` : ""}`);
      } catch (validationError: any) {
        // If validation fails (e.g., API error), log warning but allow edit to proceed
        // This prevents blocking picking if API is unavailable
        console.warn(`⚠️ Could not validate item location: ${validationError.message}`);
        // Don't block - allow edit to proceed if validation API is unavailable
      }

      // ✅ ALIGNED: Per WMS_MOBILE_END_TO_END_ALIGNMENT_GUIDE.md Section 6
      const online = await isDeviceOnline();
      if (online) {
        try {
          // Use pickMaterialRequestItems with the quantity difference
          const settings = await getSettings();
          await apiService.pickMaterialRequestItems(
            materialRequestTitle,
            [
              {
                item_code: editModal.item.item_code,
                picked_qty: qtyDifference, // ✅ CORRECT: picked_qty (not qty)
                source_bin: binLocation, // ✅ CORRECT: source_bin (not bin_location)
                carton_id: cartonId || undefined,
              },
            ],
            materialRequest?.from_warehouse || undefined,
            settings.user_id || settings.user_code || undefined // ✅ user_id for created_by
          );
          
          // Reload Material Request to get updated picked_qty from backend
          await loadMaterialRequest();
        } catch (error: any) {
          console.error("❌ Error updating quantity:", error);
          Alert.alert("Error", `Failed to update quantity: ${error.message}`);
          return;
        }
      } else {
        // Queue for offline sync
        await pickingSessionService.addToQueue(materialRequestTitle, {
          type: "SCAN_ITEM",
          payload: {
            session_id: sessionId,
            item_code: editModal.item.item_code,
            qty: qtyDifference,
            carton_id: cartonId,
          },
        });
        const session = await pickingSessionService.loadSession(materialRequestTitle);
        if (session) {
          await pickingSessionService.saveSession({ ...session, is_dirty: true });
          setIsDirty(true);
        }
        
        // Update UI optimistically for offline
        const updatedItems = requestedItems.map((item) =>
          item.line_id === editModal.item!.line_id
            ? {
                ...item,
                picked_qty: newQty,
                remaining_qty: item.requested_qty - newQty,
              }
            : item
        );
        setRequestedItems(updatedItems);
        updateTotalScanned(updatedItems);
      }

      setEditModal({ visible: false, item: null, newQty: "" });
      Alert.alert("Success", `Quantity updated to ${newQty}`);
    } catch (error: any) {
      console.error("❌ Error updating quantity:", error);
      Alert.alert("Error", `Failed to update quantity: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCompletePicking = async () => {
    // Check if all items are fully picked
    const allPicked = requestedItems.every(
      (item) => item.picked_qty >= item.requested_qty
    );

    if (!allPicked) {
      Alert.alert(
        "Incomplete Picking",
        "Not all items are fully picked. Please complete picking all items before finishing."
      );
      return;
    }

    Alert.alert(
      "Complete Picking",
      "Are you sure you want to complete picking? This will finalize the Material Request.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Complete",
          onPress: async () => {
            try {
              setLoading(true);
              // ✅ Pass materialRequestTitle to ensure correct fallback
              await apiService.completePicking(sessionId, materialRequestTitle);
              
              // Update session
              const session = await pickingSessionService.loadSession(materialRequestTitle);
              if (session) {
                await pickingSessionService.saveSession({
                  ...session,
                  status: "Completed",
                  updated_at: new Date().toISOString(),
                });
              }

              Alert.alert("Success", "Picking completed successfully!", [
                {
                  text: "OK",
                  onPress: () => {
                    // Navigate to Home page
                    (navigation as any).navigate("Home");
                  },
                },
              ]);
            } catch (error: any) {
              console.error("❌ Error completing picking:", error);
              Alert.alert("Error", `Failed to complete picking: ${error.message}`);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleSync = async () => {
    try {
      setLoading(true);
      const queue = await pickingSessionService.getQueue(materialRequestTitle);
      
      if (queue.length === 0) {
        Alert.alert("Sync", "No pending items to sync.");
        return;
      }

      // Replay queue FIFO
      for (const event of queue) {
        try {
          if (event.type === "SCAN_ITEM") {
            await apiService.scanItem(
              event.payload.session_id,
              event.payload.barcode || event.payload.item_code,
              event.payload.carton_id
            );
          } else if (event.type === "SCAN_CARTON") {
            await apiService.scanCarton(
              event.payload.session_id,
              event.payload.carton_id
            );
          }
        } catch (error: any) {
          console.warn(`⚠️ Failed to sync event:`, error);
          // Continue with next event
        }
      }

      // Clear queue
      await pickingSessionService.clearQueue(materialRequestTitle);
      
      // Update session
      const session = await pickingSessionService.loadSession(materialRequestTitle);
      if (session) {
        await pickingSessionService.saveSession({
          ...session,
          is_dirty: false,
          updated_at: new Date().toISOString(),
        });
        setIsDirty(false);
      }

      // Reload Material Request
      await loadMaterialRequest();

      Alert.alert("Success", `Synced ${queue.length} item(s) successfully.`);
    } catch (error: any) {
      console.error("❌ Error syncing:", error);
      Alert.alert("Error", `Failed to sync: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (item: RequestedItem) => {
    if (item.picked_qty === 0) {
      return { text: "PENDING", color: PickingTheme.colors.statusPending };
    } else if (item.picked_qty >= item.requested_qty) {
      return { text: "DONE", color: PickingTheme.colors.statusDone };
    } else {
      return { text: "PARTIAL", color: PickingTheme.colors.statusPartial };
    }
  };

  const handleShowLocations = async (item: RequestedItem) => {
    // Show modal immediately
    setLocationModal({ visible: true, item, locations: [], loading: true });
    
    try {
      // Get warehouse from Material Request or bin info
      const warehouseId = materialRequest?.from_warehouse || binInfo?.warehouse_id || "WH-MAIN";
      
      console.log(`📍 Loading locations for item: ${item.item_code}, warehouse: ${warehouseId}`);
      
      const locations = await apiService.getItemLocations(warehouseId, item.item_code);
      
      console.log(`📍 API response:`, JSON.stringify(locations, null, 2));
      
      // Handle different response formats
      let locationEntries: any[] = [];
      
      // ✅ DEBUG: Log first entry structure to see backend field names
      if (Array.isArray(locations) && locations.length > 0) {
        console.log(`🔍 DEBUG: First entry from backend:`, JSON.stringify(locations[0], null, 2));
        console.log(`🔍 DEBUG: First entry keys:`, Object.keys(locations[0]));
      }
      if (Array.isArray(locations)) {
        locationEntries = locations;
      } else if (locations && typeof locations === "object") {
        if (Array.isArray(locations.data)) {
          locationEntries = locations.data;
        } else if (Array.isArray(locations.locations)) {
          locationEntries = locations.locations;
        } else if (Array.isArray(locations.stock)) {
          locationEntries = locations.stock;
        }
      }
      
      // Check if it's flat format with carton_id directly on entries
      const isFlatFormatWithCartonId = locationEntries.length > 0 && 
        (locationEntries[0].carton_id || locationEntries[0].carton_ID || locationEntries[0].Carton_ID);
      
      let locationList: ItemLocation[] = [];
      
      if (isFlatFormatWithCartonId) {
        // ✅ Process flat format: group entries by location and collect cartons
        // Backend sends each carton as a separate row with Location ID, Carton ID, and Available Qty
        const locationMap = new Map<string, ItemLocation>();
        
        locationEntries.forEach((entry: any) => {
          // ✅ Use Location ID directly from backend (priority order)
          const locationId =
            entry.location_id ||
            entry.Location_ID ||
            entry.bin_location ||
            entry.Bin_Location ||
            entry.location ||
            entry.Location ||
            // Fallback: construct from components if Location ID not provided
            (entry.zone && entry.aisle && entry.rack && entry.level && entry.bin
              ? `${entry.zone}-${entry.aisle}-${entry.rack}-${entry.level}-${entry.bin}`
              : null) ||
            "Unknown";
          
          // Get carton ID
          const cartonId =
            entry.carton_id ||
            entry.carton_ID ||
            entry.Carton_ID ||
            entry.cartonId ||
            null;
          
          // Get quantities - use Available Qty from backend (as shown in backend image)
          // Backend sends "Available Qty" per carton row
          const availableQty = 
            entry.available_qty !== undefined ? entry.available_qty :
            entry.Available_Qty !== undefined ? entry.Available_Qty :
            entry.qty !== undefined ? entry.qty :
            entry.quantity !== undefined ? entry.quantity :
            0;
          
          if (!locationMap.has(locationId)) {
            locationMap.set(locationId, {
              item_code: item.item_code,
              warehouse: warehouseId,
              bin_location: locationId,
              cartons: [],
              total_qty: 0, // Will be sum of all carton quantities
              available_qty: 0, // Will be sum of all carton quantities
              reserved_qty: 0,
              zone: entry.zone || entry.Zone,
              aisle: entry.aisle || entry.Aisle,
              rack: entry.rack || entry.Rack,
              bin_id: entry.bin || entry.Bin,
              bin_code: entry.bin || entry.Bin,
            });
          }
          
          const locationEntry = locationMap.get(locationId)!;
          
          // ✅ Add carton if carton_id exists (each backend row = one carton)
          if (cartonId && availableQty > 0) {
            locationEntry.cartons = locationEntry.cartons || [];
            locationEntry.cartons.push({
              carton_id: cartonId,
              qty: availableQty, // Use available qty for this carton
            });
            
            // ✅ Sum quantities from cartons (this is the total for this location)
            locationEntry.total_qty += availableQty;
            locationEntry.available_qty += availableQty;
          }
        });
        
        locationList = Array.from(locationMap.values());
      } else {
        // Grouped format or legacy format - use as is
        locationList = locationEntries.map((entry: any) => ({
          item_code: item.item_code,
          warehouse: warehouseId,
          bin_location: entry.bin_location || entry.location_id || entry.bin_code || entry.bin_id || "Unknown",
          cartons: entry.cartons || null,
          total_qty: entry.total_qty || entry.qty || entry.available_qty || 0,
          available_qty: entry.available_qty || entry.qty || 0,
          reserved_qty: entry.reserved_qty || 0,
          zone: entry.zone,
          aisle: entry.aisle,
          rack: entry.rack,
        }));
      }
      
      console.log(`📍 Processed ${locationList.length} locations for ${item.item_code}`);
      
      setLocationModal({ visible: true, item, locations: locationList, loading: false });
    } catch (error: any) {
      console.error("❌ Error loading item locations:", error);
      // Show error but still display modal with empty state
      setLocationModal({ visible: true, item, locations: [], loading: false });
      // Only show alert if it's not a 404 (API not available)
      if (!error?.message?.includes("404") && !error?.message?.includes("not found")) {
        Alert.alert("Error", `Failed to load locations: ${error.message}`);
      }
    }
  };

  const renderRequestedItem = ({ item }: { item: RequestedItem }) => {
    const status = getStatusBadge(item);
    const isDone = item.picked_qty >= item.requested_qty;
    
    return (
      <View style={[styles.itemCard, isDone && styles.itemCardDone]}>
        {/* Row 1: Item Code + Req Badge */}
        <View style={styles.itemHeaderRow}>
          <Text style={styles.itemCodeBold}>{item.item_code}</Text>
          <View style={[styles.reqBadge, isDone && styles.reqBadgeDone]}>
            <Text style={styles.reqBadgeText}>Req: {item.requested_qty}</Text>
          </View>
        </View>
        
        {/* Row 2: Item Name */}
        {item.item_name && (
          <Text style={styles.itemNameSubtext}>{item.item_name}</Text>
        )}
        
        {/* Row 3: Barcode */}
        {item.barcode && (
          <Text style={styles.barcodeText}>Barcode: {item.barcode}</Text>
        )}
        
        {/* Divider */}
        <View style={styles.divider} />
        
        {/* Bottom Stats Row: Picked + Remaining + Buttons */}
        <View style={styles.statsRow}>
          {/* Left: Picked Qty */}
          <View style={styles.qtySection}>
            <Text style={styles.qtyLabel}>Picked</Text>
            <Text style={[styles.qtyValueLarge, item.picked_qty === 0 && styles.qtyValueZero]}>
              {item.picked_qty}
            </Text>
            <Text style={styles.uomText}>{item.uom || "pcs"}</Text>
          </View>
          
          {/* Middle: Remaining Qty */}
          <View style={styles.remainingSection}>
            <Text style={styles.remainingLabel}>Remaining</Text>
            <Text style={[
              styles.remainingValueLarge,
              {
                color: item.remaining_qty === 0
                  ? PickingTheme.colors.statusDone
                  : item.remaining_qty < 0
                  ? PickingTheme.colors.statusPending
                  : PickingTheme.colors.textPrimary,
              },
            ]}>
              {item.remaining_qty}
            </Text>
          </View>
          
          {/* Right: Location + Edit Buttons */}
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.locationButton}
              onPress={() => handleShowLocations(item)}
            >
              <Text style={styles.locationButtonText}>📍</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => handleEditQty(item)}
            >
              <Text style={styles.editButtonText}>
                Edit
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const taskId = `PK-${binLocation?.replace(/-/g, "") || "UNKNOWN"}-${sessionId?.slice(-8) || "XXXX"}`;
  const allItemsPicked = requestedItems.every(
    (item) => item.picked_qty >= item.requested_qty
  );

  if (loading && !materialRequest) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={PickingTheme.colors.headerPurple} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header - Compact */}
      <View style={styles.headerSection}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle}>Material Request Picking</Text>
            <Text style={styles.mrNumberText}>MR: {materialRequestTitle}</Text>
          </View>
          <Text style={styles.scannedText}>
            {totalScanned} scanned
          </Text>
        </View>
        <View style={styles.headerInfoRow}>
          <TouchableOpacity 
            style={styles.binButton}
            onPress={() => {
              Alert.alert(
                "Change Bin Location",
                "Do you want to change the bin location?",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Change",
                    onPress: () => {
                      (navigation as any).navigate("PickingScanBin", {
                        materialRequestTitle,
                        sessionId,
                      });
                    },
                  },
                ]
              );
            }}
          >
            <Text style={styles.binText}>Bin: {binLocation || "N/A"}</Text>
            <Text style={styles.changeText}>Tap to change</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.cartonBadge}
            onPress={() => {
              Alert.alert(
                "Change Carton ID",
                "Do you want to change the carton ID?",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Change",
                    onPress: () => {
                      (navigation as any).navigate("PickingScanCarton", {
                        materialRequestTitle,
                        sessionId,
                        binLocation,
                        binInfo,
                      });
                    },
                  },
                ]
              );
            }}
          >
            <Text style={styles.cartonText}>Carton: {cartonId || "N/A"}</Text>
            <Text style={styles.changeTextSmall}>Tap to change</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.headerActionsRow}>
          {isDirty && (
            <TouchableOpacity style={styles.syncButton} onPress={handleSync}>
              <Text style={styles.syncButtonText}>🔄 Sync</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              styles.completeButtonSmall,
              !allItemsPicked && styles.completeButtonSmallDisabled,
            ]}
            onPress={handleCompletePicking}
            disabled={!allItemsPicked || loading}
          >
            <Text style={styles.completeButtonSmallText}>Complete</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Scan Item Card - Fixed at Top */}
      <View style={styles.scanCard}>
        <Text style={styles.scanCardTitle}>Scan Item Barcode</Text>
        <Text style={styles.scanCardSubtitle}>
          Scan repeatedly to increment quantity
        </Text>
        <View style={styles.scanInputRow}>
          <BarcodeInput
            ref={barcodeInputRef}
            autoFocus={!!binLocation && binLocation.trim() !== ""}
            disabled={!binLocation || binLocation.trim() === ""}
            placeholder={
              !binLocation || binLocation.trim() === ""
                ? "⚠️ Bin location required - Tap Bin above to scan"
                : "Scan or enter barcode"
            }
            onChangeText={setBarcodeDraft}
            onBarcodeScanned={async (raw) => {
              const cleaned = raw.trim();
              if (!cleaned) return false;
              if (!binLocation || binLocation.trim() === "") {
                Alert.alert(
                  "Bin Location Required",
                  "Please scan a bin location first before scanning items.",
                  [
                    {
                      text: "Scan Bin Location",
                      onPress: () => {
                        (navigation as any).navigate("PickingScanBin", {
                          materialRequestTitle,
                          sessionId,
                        });
                      },
                    },
                    { text: "Cancel", style: "cancel" },
                  ]
                );
                return false;
              }
              return handleItemScan(cleaned);
            }}
            containerStyle={{ flex: 1 }}
            inputStyle={[
              styles.scanInput,
              (!binLocation || binLocation.trim() === "") && styles.scanInputDisabled,
            ]}
          />
          <TouchableOpacity
            style={styles.submitButton}
            onPress={() => {
              const b =
                barcodeDraft.trim() ||
                barcodeInputRef.current?.getLastText?.()?.trim() ||
                "";
              if (b) void handleItemScan(b);
            }}
            disabled={scanning || !barcodeDraft.trim()}
          >
            <Text style={styles.submitButtonText}>Submit</Text>
          </TouchableOpacity>
        </View>
        {scanning && (
          <ActivityIndicator
            size="small"
            color={PickingTheme.colors.buttonBlue}
            style={styles.scanningIndicator}
          />
        )}
      </View>

      {/* Scrollable Items List */}
      <ScrollView 
        style={styles.scrollContent}
        contentContainerStyle={styles.scrollContentContainer}
        showsVerticalScrollIndicator={true}
      >
        {/* Requested Items List */}
        <View style={styles.itemsSection}>
          <Text style={styles.itemsSectionTitle}>Requested Items</Text>
          {requestedItems.length === 0 ? (
            <View style={styles.emptyListContainer}>
              <Text style={styles.emptyListText}>No items to display</Text>
            </View>
          ) : (
            requestedItems.map((item, index) => (
              <View key={item.line_id || `item-${index}`}>
                {renderRequestedItem({ item })}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Footer Frame - Reusable component for visual separation */}
      <ScreenFooterFrame />

      {/* Edit Quantity Modal */}
      <Modal
        visible={editModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditModal({ visible: false, item: null, newQty: "" })}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Edit Quantity: {editModal.item?.item_code}
            </Text>
            <Text style={styles.modalSubtitle}>
              Requested: {editModal.item?.requested_qty}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={editModal.newQty}
              onChangeText={(text) =>
                setEditModal({ ...editModal, newQty: text })
              }
              placeholder="Enter quantity"
              keyboardType="numeric"
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setEditModal({ visible: false, item: null, newQty: "" })}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveButton}
                onPress={handleSaveEditQty}
              >
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>


      {/* Location Modal */}
      <Modal
        visible={locationModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setLocationModal({ visible: false, item: null, locations: [], loading: false })}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.locationModalContent}>
            <View style={styles.locationModalHeader}>
              <View style={styles.locationModalTitleContainer}>
                <Text style={styles.locationModalTitle}>
                  Item Locations: {locationModal.item?.item_code}
                </Text>
                {locationModal.locations.length > 0 && (
                  <Text style={styles.locationModalTotal}>
                    Total: {locationModal.locations.reduce((sum, loc) => {
                      // Use total_qty if available, otherwise sum carton quantities
                      if (loc.total_qty !== undefined && loc.total_qty > 0) {
                        return sum + loc.total_qty;
                      } else if (loc.available_qty !== undefined && loc.available_qty > 0) {
                        return sum + loc.available_qty;
                      } else if (loc.cartons && Array.isArray(loc.cartons)) {
                        return sum + loc.cartons.reduce((cartonSum, carton) => cartonSum + (carton.qty || 0), 0);
                      }
                      return sum;
                    }, 0)} pcs
                  </Text>
                )}
              </View>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setLocationModal({ visible: false, item: null, locations: [], loading: false })}
              >
                <Text style={styles.modalCloseButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
            
            {locationModal.loading ? (
              <View style={styles.locationModalLoading}>
                <ActivityIndicator size="large" color={PickingTheme.colors.headerPurple} />
                <Text style={styles.locationModalLoadingText}>Loading locations...</Text>
              </View>
            ) : locationModal.locations.length === 0 ? (
              <View style={styles.locationModalEmpty}>
                <Text style={styles.locationModalEmptyText}>No locations found</Text>
                <Text style={styles.locationModalEmptySubtext}>
                  This item may not be in stock or location data is not available.
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.locationModalList}>
                <View style={styles.locationListHeader}>
                  <Text style={[styles.locationListHeaderText, { flex: 1 }]}>
                    Bin Location
                  </Text>
                  <Text style={[styles.locationListHeaderText, { width: 80, textAlign: "right" }]}>
                    Total Qty
                  </Text>
                </View>
                <FlatList
                  data={locationModal.locations}
                  keyExtractor={(item, index) => `${item.bin_location || item.bin_code || item.bin_id || `location-${index}`}`}
                  renderItem={({ item: location }) => {
                    const hasCartons = location.cartons && Array.isArray(location.cartons) && location.cartons.length > 0;
                    
                    // Calculate total qty: use total_qty if set, otherwise sum carton quantities, otherwise use available_qty
                    let totalQty = 0;
                    if (location.total_qty !== undefined && location.total_qty > 0) {
                      totalQty = location.total_qty;
                    } else if (hasCartons && location.cartons) {
                      totalQty = location.cartons.reduce((sum, carton) => sum + (carton.qty || 0), 0);
                    } else if (location.available_qty !== undefined && location.available_qty > 0) {
                      totalQty = location.available_qty;
                    }
                    
                    return (
                      <View style={styles.locationListItem}>
                        <View style={styles.locationListLocationContainer}>
                          <Text 
                            style={styles.locationListLocation}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            {location.bin_location || location.bin_code || location.bin_id || "Unknown Location"}
                          </Text>
                          {hasCartons && location.cartons ? (
                            <View style={styles.cartonsListUnderLocation}>
                              {location.cartons.map((carton, cartonIdx) => (
                                <Text 
                                  key={cartonIdx}
                                  style={styles.cartonIdUnderLocation}
                                  numberOfLines={1}
                                  ellipsizeMode="tail"
                                >
                                  {carton.carton_id}
                                </Text>
                              ))}
                            </View>
                          ) : (
                            <Text style={styles.cartonIdUnderLocation}>N/A</Text>
                          )}
                        </View>
                        <Text style={styles.locationListQty}>{totalQty}</Text>
                      </View>
                    );
                  }}
                  scrollEnabled={false}
                />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PickingTheme.colors.backgroundLight,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: PickingTheme.spacing.md,
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textSecondary,
  },
  headerSection: {
    backgroundColor: PickingTheme.colors.headerPurple,
    padding: PickingTheme.spacing.md,
    paddingTop: 12,
    paddingBottom: 10,
  },
  headerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  headerTitleRow: {
    flex: 1,
  },
  headerTitle: {
    ...PickingTheme.typography.h2,
    fontSize: 16,
    color: PickingTheme.colors.textWhite,
  },
  mrNumberText: {
    ...PickingTheme.typography.caption,
    fontSize: 11,
    color: PickingTheme.colors.textWhite,
    opacity: 0.9,
    marginTop: 2,
  },
  headerInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: PickingTheme.spacing.sm,
    flexWrap: "wrap",
  },
  binButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  binText: {
    ...PickingTheme.typography.caption,
    fontSize: 12,
    color: PickingTheme.colors.textWhite,
  },
  changeText: {
    ...PickingTheme.typography.caption,
    fontSize: 9,
    color: PickingTheme.colors.textWhite,
    opacity: 0.7,
    marginLeft: 4,
  },
  cartonBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: PickingTheme.borderRadius.small,
    paddingHorizontal: PickingTheme.spacing.sm,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  cartonText: {
    ...PickingTheme.typography.caption,
    fontSize: 11,
    color: PickingTheme.colors.textWhite,
  },
  changeTextSmall: {
    ...PickingTheme.typography.caption,
    fontSize: 8,
    color: PickingTheme.colors.textWhite,
    opacity: 0.7,
  },
  changeCartonButton: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: PickingTheme.borderRadius.small,
    padding: PickingTheme.spacing.sm,
  },
  changeCartonText: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textWhite,
  },
  taskBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: PickingTheme.borderRadius.small,
    padding: PickingTheme.spacing.sm,
    marginBottom: 4,
    alignSelf: "flex-start",
  },
  taskText: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textWhite,
  },
  scannedText: {
    ...PickingTheme.typography.caption,
    fontSize: 12,
    color: PickingTheme.colors.textWhite,
    opacity: 0.9,
  },
  headerActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: PickingTheme.spacing.sm,
    marginTop: 4,
  },
  syncButton: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: PickingTheme.borderRadius.small,
    paddingHorizontal: PickingTheme.spacing.sm,
    paddingVertical: 4,
  },
  syncButtonText: {
    ...PickingTheme.typography.caption,
    fontSize: 10,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
  },
  completeButtonSmall: {
    backgroundColor: PickingTheme.colors.statusDone,
    borderRadius: PickingTheme.borderRadius.small,
    paddingHorizontal: PickingTheme.spacing.md,
    paddingVertical: 6,
  },
  completeButtonSmallDisabled: {
    backgroundColor: "rgba(255,255,255,0.2)",
    opacity: 0.5,
  },
  completeButtonSmallText: {
    ...PickingTheme.typography.caption,
    fontSize: 11,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
  },
  scanCard: {
    backgroundColor: PickingTheme.colors.buttonBlue,
    padding: PickingTheme.spacing.md,
    paddingVertical: PickingTheme.spacing.sm + 4,
    borderRadius: 0,
    borderBottomWidth: 2,
    borderBottomColor: "rgba(255,255,255,0.2)",
  },
  scanCardTitle: {
    ...PickingTheme.typography.h3,
    fontSize: 14,
    color: PickingTheme.colors.textWhite,
    marginBottom: 2,
    fontWeight: "600",
  },
  scanCardSubtitle: {
    ...PickingTheme.typography.caption,
    fontSize: 10,
    color: PickingTheme.colors.textWhite,
    opacity: 0.9,
    marginBottom: PickingTheme.spacing.sm,
  },
  scanInputRow: {
    flexDirection: "row",
    gap: PickingTheme.spacing.sm,
  },
  scanInput: {
    flex: 1,
    backgroundColor: PickingTheme.colors.backgroundWhite,
    borderRadius: PickingTheme.borderRadius.small,
    padding: PickingTheme.spacing.md,
    ...PickingTheme.typography.body,
  },
  scanInputDisabled: {
    backgroundColor: PickingTheme.colors.backgroundLight,
    borderColor: PickingTheme.colors.statusWarning || "#FF9800",
    borderWidth: 2,
    opacity: 0.6,
  },
  submitButton: {
    backgroundColor: PickingTheme.colors.statusDone,
    paddingHorizontal: PickingTheme.spacing.lg,
    paddingVertical: PickingTheme.spacing.md,
    borderRadius: PickingTheme.borderRadius.small,
    justifyContent: "center",
  },
  submitButtonText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
  },
  scanningIndicator: {
    marginTop: PickingTheme.spacing.sm,
  },
  scrollContent: {
    flex: 1,
  },
  scrollContentContainer: {
    paddingBottom: 10, // Small padding at bottom
  },
  itemsSection: {
    padding: PickingTheme.spacing.md,
  },
  itemsSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: PickingTheme.spacing.md,
  },
  itemsSectionTitle: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.textPrimary,
  },
  cartonInfoText: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textSecondary,
    fontStyle: "italic",
  },
  itemsList: {
    paddingBottom: PickingTheme.spacing.xl,
  },
  emptyListContainer: {
    padding: PickingTheme.spacing.xl,
    alignItems: "center",
  },
  emptyListText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textSecondary,
    textAlign: "center",
  },
  itemCard: {
    backgroundColor: PickingTheme.colors.backgroundCard,
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    marginBottom: PickingTheme.spacing.md,
    ...PickingTheme.shadows.card,
  },
  itemCardDone: {
    borderWidth: 2,
    borderColor: PickingTheme.colors.statusDone,
  },
  itemHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: PickingTheme.spacing.xs,
  },
  itemCodeBold: {
    ...PickingTheme.typography.h3,
    fontWeight: "bold",
    color: PickingTheme.colors.textPrimary,
    flex: 1,
  },
  reqBadge: {
    backgroundColor: PickingTheme.colors.statusPending,
    paddingHorizontal: PickingTheme.spacing.sm,
    paddingVertical: 4,
    borderRadius: PickingTheme.borderRadius.small,
  },
  reqBadgeDone: {
    backgroundColor: PickingTheme.colors.statusDone,
  },
  reqBadgeText: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
  },
  itemNameSubtext: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textSecondary,
    marginBottom: PickingTheme.spacing.xs,
  },
  barcodeText: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textSecondary,
    marginBottom: PickingTheme.spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: PickingTheme.colors.borderLight,
    marginVertical: PickingTheme.spacing.sm,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  qtySection: {
    flex: 1,
    alignItems: "flex-start",
  },
  qtyLabel: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textSecondary,
    marginBottom: 2,
  },
  qtyValueLarge: {
    fontSize: 24,
    fontWeight: "bold",
    color: PickingTheme.colors.statusDone,
  },
  qtyValueZero: {
    color: PickingTheme.colors.textSecondary,
    opacity: 0.5,
  },
  uomText: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textSecondary,
    fontSize: 12,
  },
  remainingSection: {
    flex: 1,
    alignItems: "center",
  },
  remainingLabel: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textSecondary,
    marginBottom: 2,
  },
  remainingValueLarge: {
    fontSize: 24,
    fontWeight: "bold",
  },
  actionButtons: {
    flexDirection: "row",
    gap: PickingTheme.spacing.sm,
    alignItems: "center",
  },
  locationButton: {
    backgroundColor: PickingTheme.colors.buttonBlue,
    width: 40,
    height: 40,
    borderRadius: PickingTheme.borderRadius.small,
    justifyContent: "center",
    alignItems: "center",
  },
  locationButtonText: {
    fontSize: 20,
  },
  editButton: {
    backgroundColor: PickingTheme.colors.buttonBlue,
    paddingHorizontal: PickingTheme.spacing.md,
    paddingVertical: PickingTheme.spacing.sm,
    borderRadius: PickingTheme.borderRadius.small,
    minWidth: 60,
    alignItems: "center",
  },
  editButtonDisabled: {
    backgroundColor: PickingTheme.colors.borderLight,
    opacity: 0.5,
  },
  editButtonText: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
  },
  editButtonTextDisabled: {
    color: PickingTheme.colors.textSecondary,
  },
  footer: {
    flexDirection: "row",
    padding: PickingTheme.spacing.md,
    gap: PickingTheme.spacing.md,
    backgroundColor: PickingTheme.colors.backgroundWhite,
    borderTopWidth: 1,
    borderTopColor: PickingTheme.colors.borderLight,
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
  pauseButton: {
    flex: 1,
    backgroundColor: PickingTheme.colors.textSecondary,
    padding: PickingTheme.spacing.md,
    borderRadius: PickingTheme.borderRadius.medium,
    alignItems: "center",
  },
  pauseButtonText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
  },
  completeButton: {
    flex: 1,
    backgroundColor: PickingTheme.colors.statusDone,
    padding: PickingTheme.spacing.md,
    borderRadius: PickingTheme.borderRadius.medium,
    alignItems: "center",
  },
  completeButtonDisabled: {
    backgroundColor: PickingTheme.colors.borderLight,
    opacity: 0.5,
  },
  completeButtonText: {
    ...PickingTheme.typography.body,
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
    backgroundColor: PickingTheme.colors.backgroundWhite,
    borderRadius: PickingTheme.borderRadius.large,
    padding: PickingTheme.spacing.lg,
    width: "80%",
    ...PickingTheme.shadows.button,
  },
  modalTitle: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.textPrimary,
    marginBottom: PickingTheme.spacing.sm,
  },
  modalSubtitle: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textSecondary,
    marginBottom: PickingTheme.spacing.md,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: PickingTheme.colors.borderLight,
    borderRadius: PickingTheme.borderRadius.small,
    padding: PickingTheme.spacing.md,
    ...PickingTheme.typography.body,
    marginBottom: PickingTheme.spacing.lg,
  },
  modalButtons: {
    flexDirection: "row",
    gap: PickingTheme.spacing.md,
  },
  modalCancelButton: {
    flex: 1,
    backgroundColor: PickingTheme.colors.textSecondary,
    padding: PickingTheme.spacing.md,
    borderRadius: PickingTheme.borderRadius.medium,
    alignItems: "center",
  },
  modalCancelText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
  },
  modalSaveButton: {
    flex: 1,
    backgroundColor: PickingTheme.colors.statusDone,
    padding: PickingTheme.spacing.md,
    borderRadius: PickingTheme.borderRadius.medium,
    alignItems: "center",
  },
  modalSaveText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
  },
  modalCloseButton: {
    padding: PickingTheme.spacing.sm,
    marginLeft: PickingTheme.spacing.sm,
  },
  modalCloseButtonText: {
    fontSize: 22,
    color: PickingTheme.colors.textSecondary,
    fontWeight: "600",
  },
  locationModalContent: {
    backgroundColor: PickingTheme.colors.backgroundWhite,
    borderRadius: PickingTheme.borderRadius.large,
    padding: PickingTheme.spacing.lg,
    width: "90%",
    maxHeight: "80%",
    ...PickingTheme.shadows.button,
  },
  locationModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: PickingTheme.spacing.md,
    paddingBottom: PickingTheme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: PickingTheme.colors.borderLight,
  },
  locationModalTitleContainer: {
    flex: 1,
  },
  locationModalTitle: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.textPrimary,
    marginBottom: 4,
  },
  locationModalTotal: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.statusDone,
    fontWeight: "600",
    fontSize: 14,
  },
  locationModalLoading: {
    padding: PickingTheme.spacing.xl,
    alignItems: "center",
  },
  locationModalLoadingText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textSecondary,
    marginTop: PickingTheme.spacing.md,
  },
  locationModalEmpty: {
    padding: PickingTheme.spacing.xl,
    alignItems: "center",
  },
  locationModalEmptyText: {
    ...PickingTheme.typography.h3,
    color: PickingTheme.colors.textPrimary,
    marginBottom: PickingTheme.spacing.sm,
  },
  locationModalEmptySubtext: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textSecondary,
    textAlign: "center",
  },
  locationModalList: {
    maxHeight: 400,
  },
  locationListHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: "#F5F5F5",
    borderRadius: 6,
    marginBottom: 6,
  },
  locationListHeaderText: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#333",
  },
  locationListItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  locationListLocationContainer: {
    flex: 1,
    marginRight: 8,
  },
  locationListLocation: {
    fontSize: 14,
    color: "#333",
    fontWeight: "500",
    marginBottom: 4,
  },
  cartonsListUnderLocation: {
    marginTop: 2,
    marginLeft: 4,
  },
  cartonIdUnderLocation: {
    fontSize: 12,
    color: "#2196F3",
    fontWeight: "400",
    marginBottom: 2,
  },
  locationListQty: {
    fontSize: 14,
    color: "#4CAF50",
    fontWeight: "bold",
    width: 80,
    textAlign: "right",
    marginTop: 2,
  },
  locationDetailText: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textSecondary,
  },
});
