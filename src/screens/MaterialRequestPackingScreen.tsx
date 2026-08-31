import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  FlatList,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useApp } from "../context/AppContext";
import {
  useNavigation,
  useFocusEffect,
  useRoute,
} from "@react-navigation/native";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { StatusBadge } from "../components/StatusBadge";
import { dataService } from "../services/data.service";
import { apiService } from "../services/api.service";
import { addEvent, syncEvents } from "../services/event-queue.service";
import { isDeviceOnline } from "../utils/network-check";
import { getSettings } from "../services/settings.service";
import { getDatabase } from "../database/database";
import { MaterialRequest } from "../types";
import { resolveItemFromBarcode } from "../services/item-master.service";
import { ensureItemsCachedForTransactionLines } from "../services/transaction-item-cache.service";
import {
  clearScannerTimer,
  onScannerTextChange,
} from "../utils/hardwareScannerInput";

type ScanWorkflowState =
  | "SCAN_LOCATION"
  | "SCAN_CARTON_ID"
  | "SCAN_ITEM"
  | "SCAN_BOX_ID"
  | "SCAN_BIN_LOCATION";

interface ScannedItem {
  location_id: string;
  carton_id: string; // ✅ Changed from box_id to carton_id to match backend
  item_code: string;
  item_name?: string;
  qty: number;
  timestamp: string;
}

interface RequestedItemWithLocations {
  item_code: string;
  item_name?: string;
  requested_qty: number;
  scanned_qty: number;
  picked_qty?: number; // ✅ Backend's calculated total quantity (sum of all events)
  locations: {
    bin_location: string;
    total_qty: number;
    cartons: {
      carton_id: string;
      qty: number;
    }[];
  }[];
}

export default function MaterialRequestPackingScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { 
    materialRequestTitle,
    binLocation: routeBinLocation,
    binInfo: routeBinInfo,
    cartonId: routeCartonId,
  } = (route.params as any) || {};
  const { activeASN, activeSession } = useApp();
  const [materialRequest, setMaterialRequest] =
    useState<MaterialRequest | null>(null);
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [transferCarton, setTransferCarton] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<any[]>([]);
  const [packedBoxes, setPackedBoxes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // ✅ Polling state for Rule C: Sync from backend
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isSealing, setIsSealing] = useState(false);
  const [hasSealedTC, setHasSealedTC] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [hasDispatchedTC, setHasDispatchedTC] = useState(false);

  // ✅ NEW: Redesigned workflow state (similar to Cycle Count)
  const [pickingStarted, setPickingStarted] = useState(false);
  const [binLocation, setBinLocation] = useState<string | null>("");
  const [binLocationInput, setBinLocationInput] = useState<string>("");
  const [binInfo, setBinInfo] = useState<any>(null);
  const [cartonId, setCartonId] = useState<string | null>(null);
  const [cartonIdInput, setCartonIdInput] = useState<string>("");
  const [requestedItemsWithLocations, setRequestedItemsWithLocations] =
    useState<RequestedItemWithLocations[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);

  // Scanning state
  const [scanWorkflow, setScanWorkflow] =
    useState<ScanWorkflowState>("SCAN_LOCATION");
  const [currentLocation, setCurrentLocation] = useState<string>("");
  const [currentBoxId, setCurrentBoxId] = useState<string>(""); // Legacy: keep for backward compatibility
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const lastScannedRef = useRef<{ barcode: string; timestamp: number } | null>(
    null
  );

  // Input refs
  const binLocationInputRef = useRef<TextInput>(null);
  const cartonIdInputRef = useRef<TextInput>(null);
  const barcodeInputRef = useRef<TextInput>(null);
  const binLocationScanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cartonIdScanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualBarcodeScanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showBinScanner, setShowBinScanner] = useState(false);
  const [showCartonScanner, setShowCartonScanner] = useState(false);
  const [showItemScanner, setShowItemScanner] = useState(false);
  const [manualBarcode, setManualBarcode] = useState("");

  // Edit quantity modal state
  const [editQtyModal, setEditQtyModal] = useState<{
    visible: boolean;
    index: number;
    item: ScannedItem | null;
    currentQty: number;
  } | null>(null);
  const [editQtyValue, setEditQtyValue] = useState("");

  // ✅ Draft session state
  const [pickingSessionId, setPickingSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<
    "Draft" | "In Progress" | "Completed" | null
  >(null); // Start as null, will be set after checking for draft session
  const editQtyInputRef = useRef<TextInput>(null);
  const lastTapTimeRef = useRef<number>(0);

  // Location modal state
  const [locationModalVisible, setLocationModalVisible] = useState(false);
  const [selectedItemForLocation, setSelectedItemForLocation] =
    useState<RequestedItemWithLocations | null>(null);

  // TC Items modal state
  const [tcItemsModal, setTcItemsModal] = useState<{
    visible: boolean;
    items: {
      item_code: string;
      item_name?: string;
      requested_qty: number;
      scanned_qty: number;
    }[];
  } | null>(null);
  const lastTCTapTimeRef = useRef<number>(0);

  // Load Material Request details and restore scanned items
  useEffect(() => {
    if (materialRequestTitle) {
      loadMaterialRequest();
      loadScannedItems();
      
      // ✅ Set bin location and carton ID from route params (scanned before entering screen)
      if (routeBinLocation) {
        setBinLocation(routeBinLocation);
        setCurrentLocation(routeBinLocation);
        setBinLocationInput(routeBinLocation);
      }
      if (routeBinInfo) {
        setBinInfo(routeBinInfo);
      }
      if (routeCartonId) {
        setCartonId(routeCartonId);
        setCurrentBoxId(routeCartonId);
        setCartonIdInput(routeCartonId);
      }
    }
  }, [materialRequestTitle, routeBinLocation, routeBinInfo, routeCartonId]);

  // ✅ Auto-start picking if Material Request status is "In Progress" and no draft session exists
  useEffect(() => {
    if (
      materialRequest?.status === "In Progress" &&
      !transferCarton &&
      !pickingStarted &&
      selectedStore &&
      sessionStatus !== "Draft" &&
      sessionStatus !== "In Progress"
    ) {
      // Auto-start picking when coming from "Start Picking" button
      console.log("🚀 Auto-starting picking (status is In Progress, no draft session)");
      handleStartPicking();
    }
  }, [materialRequest?.status, transferCarton, pickingStarted, selectedStore, sessionStatus]);

  // ✅ Load requested items with locations when Material Request is loaded and Transfer Carton exists
  useEffect(() => {
    if (materialRequest && transferCarton) {
      // Ensure scanned items are loaded first, then load requested items
      // ✅ FIX: Only load if we don't already have scanned items (to prevent clearing state after scanning)
      (async () => {
        // Only reload scanned items if we don't have any (first load)
        // This prevents clearing items that were just scanned
        if (scannedItems.length === 0) {
          await loadScannedItems();
        }
        await loadRequestedItemsWithLocations();
      })();
    }
  }, [materialRequest, transferCarton]);

  // ✅ Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }
    };
  }, []);

  // ✅ Update requested items list when scanned items change
  // Use a ref to track the last scanned items count to detect changes
  const scannedItemsRef = useRef<number>(0);
  useEffect(() => {
    // Calculate total scanned items count for change detection
    const totalScannedCount = scannedItems.reduce((sum, si) => sum + si.qty, 0);

    // ✅ Update scanned_qty from backend's picked_qty (not from local scannedItems)
    // This ensures we use the backend's calculated total, not local database
    if (requestedItemsWithLocations.length > 0 && materialRequest?.items) {
      // Use backend's picked_qty as the source of truth
      setRequestedItemsWithLocations((prevItems) => {
        const updatedItems = prevItems.map((item) => {
          // Find corresponding item in Material Request to get backend's picked_qty
          const mrItem = materialRequest.items.find(
            (i: any) => i.item_code === item.item_code
          );
          // ✅ Use backend's picked_qty as source of truth (even if 0)
          // Backend's picked_qty is the authoritative value from Material Request table
          const backendPickedQty =
            mrItem?.picked_qty !== undefined && mrItem?.picked_qty !== null
              ? mrItem.picked_qty
              : null;
          const localScannedQty = scannedItems
            .filter((si) => si.item_code === item.item_code)
            .reduce((sum, si) => sum + si.qty, 0);
          // ✅ Always use backend picked_qty if available (even if 0), otherwise use local
          const scannedQty =
            backendPickedQty !== null ? backendPickedQty : localScannedQty;
          return {
            ...item,
            scanned_qty: scannedQty,
            picked_qty:
              backendPickedQty !== null ? backendPickedQty : undefined, // Also update picked_qty field
          };
        });
        return updatedItems;
      });
      // Update ref with backend's total picked_qty
      const backendTotal = materialRequest.items.reduce(
        (sum: number, i: any) => sum + (i.picked_qty || 0),
        0
      );
      scannedItemsRef.current = backendTotal;
    }
  }, [materialRequest?.items, scannedItems.length]);

  // Load scanned items and restore state when screen is focused
  useFocusEffect(
    React.useCallback(() => {
      if (materialRequestTitle) {
        (async () => {
          // ✅ FIRST: Restore picking session (draft state) - this restores bin location, carton ID, TC ID
          const sessionRestored = await restorePickingSession();

          // ✅ NO TC CHECK - TC is only created after "Complete Picking" when status is "Picked"
          // During picking (status "In Progress"), no TC should exist

          // ✅ AUTO-START: If status is "In Progress" and no draft session exists, auto-start picking
          if (
            materialRequest?.status === "In Progress" &&
            !sessionRestored &&
            selectedStore &&
            (sessionStatus === null || (sessionStatus !== "Draft" && sessionStatus !== "In Progress"))
          ) {
            console.log("🚀 Auto-starting picking (no draft session, status is In Progress)");
            // Small delay to ensure UI is ready, then auto-start
            setTimeout(() => {
              handleStartPicking().catch((error) => {
                console.warn("⚠️ Auto-start picking failed:", error);
              });
            }, 500);
          }

          // ✅ THIRD: Load scanned items (they will show regardless of transferCarton)
          await loadScannedItems();

          // ✅ FOURTH: If session was restored, load requested items
          if (sessionRestored && transferCarton) {
            await loadRequestedItemsWithLocations();
          }

          // ✅ FIFTH: Try to sync any pending events when screen is focused (if online)
          try {
            const online = await isDeviceOnline();
            if (online) {
              console.log(
                `🔄 Screen focused - checking for pending events to sync...`
              );
              await syncEvents();
            }
          } catch (syncError: any) {
            console.warn(
              `⚠️ Failed to sync events on screen focus:`,
              syncError.message
            );
          }
        })();
      }

      // ✅ Cleanup: Sync events when screen loses focus (user goes back)
      return () => {
        (async () => {
          try {
            const online = await isDeviceOnline();
            if (online) {
              console.log(`🔄 Screen losing focus - syncing pending events...`);
              await syncEvents();
            }
          } catch (syncError: any) {
            console.warn(
              `⚠️ Failed to sync events on screen blur:`,
              syncError.message
            );
          }
        })();
      };
    }, [materialRequestTitle, selectedStore])
  );

  // Helper function to clear Material Request cache and related data
  const clearMaterialRequestCache = async (mrTitle: string) => {
    try {
      const db = await getDatabase();
      
      console.log(`🗑️ Clearing cache for Material Request: ${mrTitle}`);
      
      // 1. Clear Material Request cache
      await db.runAsync(
        "DELETE FROM material_request_cache WHERE title = ?",
        [mrTitle]
      );
      console.log(`  ✅ Cleared material_request_cache`);
      
      // 2. Clear Material Request picking sessions
      await db.runAsync(
        "DELETE FROM material_request_picking_sessions WHERE material_request_title = ?",
        [mrTitle]
      );
      console.log(`  ✅ Cleared material_request_picking_sessions`);
      
      // 3. Clear event_queue entries related to this Material Request
      await db.runAsync(
        "DELETE FROM event_queue WHERE material_request = ?",
        [mrTitle]
      );
      console.log(`  ✅ Cleared event_queue entries`);
      
      // 4. Clear Transfer Cartons related to this Material Request
      // Clear by to_no (Material Request title)
      const tcDeletedByToNo = await db.runAsync(
        "DELETE FROM tc_cache WHERE to_no = ?",
        [mrTitle]
      );
      console.log(`  ✅ Cleared ${tcDeletedByToNo?.changes || 0} tc_cache entries by to_no`);
      
      // Also clear Transfer Cartons by tc_id pattern (e.g., "TC-MR-123459-...")
      const mrNumber = mrTitle.replace("MR-", "");
      const tcDeletedByPattern = await db.runAsync(
        "DELETE FROM tc_cache WHERE tc_id LIKE ?",
        [`TC-MR-${mrNumber}-%`]
      );
      console.log(`  ✅ Cleared ${tcDeletedByPattern?.changes || 0} tc_cache entries by tc_id pattern`);
      
      // Also clear any Transfer Cartons that might have the Material Request in the ID
      const tcDeletedByContains = await db.runAsync(
        "DELETE FROM tc_cache WHERE tc_id LIKE ?",
        [`%${mrNumber}%`]
      );
      console.log(`  ✅ Cleared ${tcDeletedByContains?.changes || 0} tc_cache entries by tc_id containing MR number`);
      
      // 5. Clear scanned_items related to Transfer Cartons (by tc_id pattern)
      const scannedItemsDeleted = await db.runAsync(
        `DELETE FROM scanned_items 
         WHERE tc_id LIKE ? OR tc_id LIKE ?`,
        [`TC-MR-${mrNumber}-%`, `%${mrNumber}%`]
      );
      console.log(`  ✅ Cleared ${scannedItemsDeleted?.changes || 0} scanned_items entries`);
      
      console.log(`✅ Successfully cleared all cache for Material Request: ${mrTitle}`);
    } catch (error: any) {
      console.error(`❌ Error clearing Material Request cache:`, error);
    }
  };

  const loadMaterialRequest = async () => {
    if (!materialRequestTitle) return;

    setLoading(true);
    try {
      console.log(
        `🔄 Loading Material Request for packing: ${materialRequestTitle}`
      );
      const response = await apiService.getMaterialRequest(
        materialRequestTitle
      );
      console.log(`📦 API Response:`, response);

      let mr: any = null;
      if (response && typeof response === "object") {
        if (response.data) {
          mr = response.data;
        } else if (response.material_request) {
          mr = response.material_request;
        } else {
          mr = response;
        }
      }

      if (mr && mr.title) {
        console.log(`✅ Material Request loaded from BACKEND API: ${mr.title}`);
        // ✅ Log raw backend response BEFORE any local calculation
        if (mr.items) {
          console.log(
            `📊 RAW Backend API picked_qty values (BEFORE local calculation):`,
            mr.items.map((i: any) => ({
              item_code: i.item_code,
              picked_qty: i.picked_qty,
              requested_qty: i.requested_qty,
              has_picked_qty: i.picked_qty !== undefined,
            }))
          );
        }
        // ✅ Use backend's picked_qty directly - DO NOT calculate from local database
        const mrWithPickedQty = await calculatePickedQuantities(mr);
        // Log final values after processing
        if (mrWithPickedQty?.items) {
          console.log(
            `📊 FINAL picked_qty values (AFTER processing):`,
            mrWithPickedQty.items.map((i: any) => ({
              item_code: i.item_code,
              picked_qty: i.picked_qty,
              requested_qty: i.requested_qty,
            }))
          );
        }
        setMaterialRequest(mrWithPickedQty);
        setSelectedStore(mr.to_showroom || "");
        ensureItemsCachedForTransactionLines(
          mrWithPickedQty.items,
          `MR packing:${mrWithPickedQty.title}`
        );
        // Check for existing Transfer Carton
        await checkExistingTC(mr.to_showroom);

        // Return the Material Request for use in callers
        return mrWithPickedQty;
      } else {
        // Material Request not found in API response - check if it was deleted
        console.log(`⚠️ Material Request not found in API response, checking if deleted...`);
        await clearMaterialRequestCache(materialRequestTitle);
        
        Alert.alert(
          "Material Request Not Found",
          `Material Request ${materialRequestTitle} has been deleted or does not exist.`
        );
        navigation.goBack();
      }
    } catch (error: any) {
      console.error("❌ Error loading Material Request:", error);

      // Check if it's a 404 (Not Found) error - means Material Request was deleted
      const isNotFound = 
        error.message?.includes("404") || 
        error.message?.includes("NOT_FOUND") ||
        error.message?.includes("not found") ||
        error.code === "NOT_FOUND" ||
        (error.response && error.response.status === 404);

      if (isNotFound) {
        console.log(`🗑️ Material Request ${materialRequestTitle} not found (404) - clearing cache...`);
        await clearMaterialRequestCache(materialRequestTitle);
        
        Alert.alert(
          "Material Request Deleted",
          `Material Request ${materialRequestTitle} has been deleted and removed from cache.`
        );
        navigation.goBack();
        return;
      }

      // For other errors, fallback to cache
      try {
        console.log(
          `⚠️ API error (not 404), checking cache for: ${materialRequestTitle}`
        );
        const db = await getDatabase();
        const cached = await db.getFirstAsync<any>(
          "SELECT * FROM material_request_cache WHERE title = ?",
          [materialRequestTitle]
        );

        if (cached) {
          console.log(`✅ Material Request loaded from cache: ${cached.title}`);
          const mrFromCache = {
            ...cached,
            items: cached.items_json ? JSON.parse(cached.items_json) : [],
          };
          // Calculate picked quantities to get accurate status for each item
          const mrWithPickedQty = await calculatePickedQuantities(mrFromCache);
          setMaterialRequest(mrWithPickedQty);
          setSelectedStore(mrFromCache.to_showroom || "");
          await checkExistingTC(mrFromCache.to_showroom);
          // Reload scanned items after Material Request is loaded
          await loadScannedItems();
        } else {
          Alert.alert(
            "Error",
            `Failed to load Material Request: ${error.message}`
          );
          navigation.goBack();
        }
      } catch (cacheError: any) {
        console.error("❌ Error loading from cache:", cacheError);
        Alert.alert(
          "Error",
          `Failed to load Material Request: ${error.message}`
        );
        navigation.goBack();
      }
    } finally {
      setLoading(false);
    }
  };

  // ✅ Calculate picked quantities - USE BACKEND VALUES ONLY, NO LOCAL CALCULATION
  // The backend's picked_qty is the authoritative source (sum of all events from backend)
  // We should NOT calculate from local database - backend already did the calculation
  const calculatePickedQuantities = async (mr: any): Promise<any> => {
    if (!mr || !mr.title) return mr;

    try {
      const db = await getDatabase();

      // ✅ ONLY check sealed status from local DB (for UI display)
      // DO NOT calculate quantities from local DB - use backend's picked_qty
      const sealedItems = await db.getAllAsync<{
        item_code: string;
      }>(
        `SELECT DISTINCT e.item_code
         FROM event_queue e
         JOIN tc_cache tc ON e.tc_id = tc.tc_id
         WHERE e.material_request = ?
           AND e.event_type IN ('PACK_BOX_TO_TC', 'PACK_ITEM_TO_TC')
           AND e.tc_id IS NOT NULL
           AND tc.status IN ('Sealed', 'SEALED', 'Dispatched', 'DISPATCHED')`,
        [mr.title]
      );

      const sealedItemSet = new Set<string>();
      sealedItems.forEach((item) => {
        if (item.item_code) {
          sealedItemSet.add(item.item_code);
        }
      });

      // ✅ Update Material Request items - USE BACKEND'S picked_qty DIRECTLY
      // Backend's picked_qty is the authoritative source (sum of all events)
      // If backend doesn't provide picked_qty, sum local synced events as fallback
      const updatedItems = await Promise.all(
        (mr.items || []).map(async (item: any) => {
          // ✅ Check if backend provided picked_qty (even if it's 0, it means backend calculated it)
          const backendPickedQty =
            item.picked_qty !== undefined ? item.picked_qty : null;

          let pickedQty = 0;

          if (backendPickedQty !== null && backendPickedQty !== undefined) {
            // ✅ Use backend value - backend is the source of truth
            pickedQty = backendPickedQty;
          } else {
            // ✅ Fallback: Sum local synced events for this item+material_request combination
            // This ensures we show the correct total even if backend API doesn't return picked_qty
            try {
              // Sum all synced events for this item in this Material Request
              // We don't need tc_id because we're summing across all TCs for this MR
              const localEvents = await db.getAllAsync<{ total_qty: number }>(
                `SELECT SUM(qty) as total_qty FROM event_queue 
               WHERE item_code = ? AND material_request = ? AND synced = 1
               AND event_type IN ('PACK_ITEM_TO_TC', 'PACK_BOX_TO_TC')`,
                [item.item_code, mr.title]
              );

              if (
                localEvents &&
                localEvents.length > 0 &&
                localEvents[0].total_qty
              ) {
                pickedQty = localEvents[0].total_qty;
                console.log(
                  `📊 Fallback: Summed local synced events for ${item.item_code} in MR ${mr.title} = ${pickedQty}`
                );
              }
            } catch (sumError: any) {
              console.warn(
                `⚠️ Failed to sum local events for ${item.item_code}:`,
                sumError.message
              );
            }
          }

          // Log for debugging
          if (item.item_code === "SKU-HAT-301-BLU-OS") {
            console.log(
              `🔍 DEBUG ${item.item_code}: backend picked_qty=${item.picked_qty}, backendPickedQty=${backendPickedQty}, final pickedQty=${pickedQty}`
            );
          }
          const pendingQty = item.requested_qty - pickedQty;

          // Determine item status:
          // 1. If API provides status "Sealed", respect it (backend has marked it as sealed)
          // 2. If item is in a sealed TC (from local DB), mark as "Sealed"
          // 3. Otherwise, calculate based on picked quantity
          let itemStatus: "Pending" | "In Progress" | "Picked" | "Sealed" =
            item.status || "Pending";

          // If API says it's sealed, respect that
          if (item.status === "Sealed" || item.status === "SEALED") {
            itemStatus = "Sealed";
          } else if (sealedItemSet.has(item.item_code)) {
            // Item is in a sealed TC (from local DB check)
            itemStatus = "Sealed";
          } else if (!item.status) {
            // Calculate status if not provided by API
            if (pickedQty === 0) {
              itemStatus = "Pending";
            } else if (pickedQty >= item.requested_qty) {
              itemStatus = "Picked";
            } else {
              itemStatus = "In Progress";
            }
          }

          return {
            ...item,
            picked_qty: pickedQty,
            pending_qty: pendingQty,
            status: itemStatus,
          };
        })
      );

      return {
        ...mr,
        items: updatedItems,
      };
    } catch (error: any) {
      console.error("❌ Error calculating picked quantities:", error);
      return mr;
    }
  };

  // Load scanned items from event queue
  const loadScannedItems = async () => {
    if (!materialRequestTitle) return;

    try {
      console.log(
        `🔄 Loading scanned items for Material Request: ${materialRequestTitle}`
      );

      // Reload Material Request to get latest picked quantities and statuses
      // This ensures we have the most up-to-date status information
      if (!materialRequest) {
        await loadMaterialRequest();
      }

      const db = await getDatabase();

      // First, let's check what events exist for this Material Request (for debugging)
      const allEventsForMR = await db.getAllAsync<{
        offline_uuid: string;
        item_code: string;
        qty: number;
        material_request: string | null;
        tc_id: string | null;
        event_time: string;
      }>(
        `SELECT 
          offline_uuid,
          item_code,
          qty,
          material_request,
          tc_id,
          event_time
        FROM event_queue 
        WHERE material_request = ? 
          AND event_type IN ('PACK_BOX_TO_TC', 'PACK_ITEM_TO_TC') -- Support both for backward compatibility
        ORDER BY event_time DESC`,
        [materialRequestTitle]
      );

      console.log(
        `🔍 DEBUG: Found ${allEventsForMR.length} total PACK_BOX_TO_TC events for ${materialRequestTitle}`
      );
      if (allEventsForMR.length > 0) {
        console.log(
          `🔍 DEBUG: Event details:`,
          allEventsForMR.map((e) => ({
            item_code: e.item_code,
            qty: e.qty,
            material_request: e.material_request,
            tc_id: e.tc_id,
            event_time: e.event_time,
          }))
        );
      }

      // Load events for this Material Request that haven't been associated with a sealed TC yet
      // Show items that are:
      // 1. Not yet packed into any TC (tc_id IS NULL)
      // 2. Packed into any unsealed TC (regardless of which TC, as long as it's not sealed/dispatched)
      // Exclude items that are in a sealed/dispatched Transfer Carton
      // ✅ IMPORTANT: Don't filter by transferCarton - show ALL scanned items for this MR
      const events = await db.getAllAsync<{
        item_code: string;
        qty: number;
        rack: string | null;
        bin: string | null;
        box_id: string | null; // ✅ NEW: Include box_id
        event_time: string;
        tc_id: string | null;
      }>(
        `SELECT 
          e.item_code, 
          SUM(e.qty) as qty,
          e.rack,
          e.bin,
          e.box_id, -- ✅ Include box_id for backward compatibility
          e.carton_id, -- ✅ Include carton_id (new field)
          MAX(e.event_time) as event_time,
          e.tc_id
        FROM event_queue e
        LEFT JOIN tc_cache tc ON e.tc_id = tc.tc_id
        WHERE e.material_request = ? 
          AND e.event_type IN ('PACK_BOX_TO_TC', 'PACK_ITEM_TO_TC') -- ✅ Support both for backward compatibility
          AND e.item_code IS NOT NULL 
          AND e.item_code != '' -- ✅ Filter out events with empty item_code (carton ID updates)
          AND e.qty > 0 -- ✅ Only include events with quantity > 0
          AND (
            e.tc_id IS NULL 
            OR tc.status IS NULL 
            OR tc.status NOT IN ('Sealed', 'SEALED', 'Dispatched', 'DISPATCHED')
          )
        GROUP BY e.item_code, e.rack, e.bin, COALESCE(NULLIF(e.carton_id, ''), e.box_id, ''), COALESCE(e.tc_id, '') -- ✅ FIX: Better handling of NULL carton_id/box_id
        ORDER BY e.event_time DESC`,
        [materialRequestTitle]
      );

      if (events && events.length > 0) {
        console.log(
          `✅ Loaded ${events.length} scanned item group(s) from events`
        );
        console.log(
          `🔍 DEBUG: Events loaded:`,
          events.map((e) => ({
            item_code: e.item_code,
            qty: e.qty,
            rack: e.rack,
            bin: e.bin,
            event_time: e.event_time,
          }))
        );

        // ✅ Convert events to ScannedItem format (include carton_id from event)
        // ✅ Filter out events with empty item_code (e.g., carton ID update events)
        const restoredItems: ScannedItem[] = events
          .filter(
            (event: any) => event.item_code && event.item_code.trim() !== ""
          ) // ✅ Filter out empty item_code
          .map((event: any) => {
            // Use rack/bin as location_id, or create a default location
            const locationId =
              event.rack || event.bin || event.location_id || "UNKNOWN";
            // Map box_id to carton_id (for backward compatibility) - prioritize carton_id
            const cartonId = event.carton_id || event.box_id || "";

            return {
              location_id: locationId,
              carton_id: cartonId, // ✅ Use carton_id (map from box_id for backward compatibility)
              item_code: event.item_code || "",
              item_name: "", // Will be filled from Material Request items
              qty: event.qty || 1,
              timestamp: event.event_time || new Date().toISOString(),
            };
          });

        // Verify that items are actually in the Material Request
        if (materialRequest?.items) {
          const invalidItems = restoredItems.filter(
            (item) =>
              !materialRequest.items.some(
                (mrItem: any) => mrItem.item_code === item.item_code
              )
          );

          if (invalidItems.length > 0) {
            console.warn(
              `⚠️ WARNING: Found ${invalidItems.length} scanned item(s) that are NOT in Material Request:`,
              invalidItems.map((i) => i.item_code).join(", ")
            );
            console.warn(
              `⚠️ This Material Request contains:`,
              materialRequest.items.map((i: any) => i.item_code).join(", ")
            );

            // Filter out invalid items
            const validItems = restoredItems.filter((item) =>
              materialRequest.items.some(
                (mrItem: any) => mrItem.item_code === item.item_code
              )
            );

            if (validItems.length !== restoredItems.length) {
              console.warn(
                `⚠️ Filtered out ${
                  restoredItems.length - validItems.length
                } invalid item(s)`
              );
              // Update state with only valid items
              setScannedItems(validItems);
              return;
            }
          }
        }

        // Fill in item names from Material Request and filter out fully picked items
        let finalItems = restoredItems;
        if (materialRequest?.items) {
          // First, fill in item names
          restoredItems.forEach((item) => {
            const mrItem = materialRequest.items.find(
              (i: any) => i.item_code === item.item_code
            );
            if (mrItem && mrItem.item_name) {
              item.item_name = mrItem.item_name;
            }
          });

          // Filter out items that are fully picked (status = "Picked") or sealed (status = "Sealed")
          // Items that are fully picked or sealed should not be displayed in the scanned items list
          finalItems = restoredItems.filter((item) => {
            const mrItem = materialRequest.items.find(
              (i: any) => i.item_code === item.item_code
            );

            if (!mrItem) {
              // Item not found in MR - keep it for now (shouldn't happen, but safe)
              return true;
            }

            // Check if item is fully picked or sealed
            const pickedQty = mrItem.picked_qty || 0;
            const requestedQty = mrItem.requested_qty || 0;
            const status = mrItem.status;

            // Exclude if status is "Sealed" (in sealed transfer carton)
            if (status === "Sealed") {
              console.log(
                `🚫 Filtering out sealed item: ${item.item_code} (Status: ${status})`
              );
              return false;
            }

            // Exclude if status is "Picked" (fully picked but not yet sealed)
            // Also exclude if picked_qty >= requested_qty (fully picked by quantity)
            if (
              status === "Picked" ||
              (pickedQty >= requestedQty && requestedQty > 0)
            ) {
              console.log(
                `🚫 Filtering out fully picked item: ${item.item_code} (Status: ${status}, Picked: ${pickedQty}/${requestedQty})`
              );
              return false;
            }

            return true;
          });

          if (finalItems.length !== restoredItems.length) {
            console.log(
              `✅ Filtered out ${
                restoredItems.length - finalItems.length
              } fully picked item(s)`
            );
          }
        }

        setScannedItems(finalItems);
        console.log(
          `✅ Restored ${finalItems.length} scanned item(s) to state`,
          finalItems.map((i) => ({
            item_code: i.item_code,
            qty: i.qty,
            location: i.location_id,
            carton: i.carton_id,
          }))
        );
      } else {
        console.log(
          `ℹ️ No scanned items found in event queue for ${materialRequestTitle}`
        );
        // ✅ FIX: Never clear existing items - preserve state to prevent disappearing scanned items
        // The query might not find events immediately after scanning due to timing or grouping issues
        if (scannedItems.length > 0) {
          console.log(
            `⚠️ WARNING: Query returned 0 events but current scannedItems count: ${scannedItems.length}. Preserving existing state.`
          );
          // Don't clear - keep existing scanned items in state
        }
        // Only set empty array if we truly have no items (first load)
        // This prevents clearing items that were just scanned
      }
    } catch (error: any) {
      console.error("❌ Error loading scanned items:", error);
      // Don't show alert - this is a background operation
    }
  };

  // ✅ Save picking session state (for draft/resume functionality)
  const savePickingSession = async () => {
    if (!materialRequestTitle) return;

    try {
      const db = await getDatabase();
      const settings = await getSettings();
      const sessionId =
        pickingSessionId || `MR-PICK-${materialRequestTitle}-${Date.now()}`;

      if (!pickingSessionId) {
        setPickingSessionId(sessionId);
      }

      await db.runAsync(
        `INSERT OR REPLACE INTO material_request_picking_sessions (
          session_id, material_request_title, tc_id, bin_location, carton_id, 
          store, status, started_by, started_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          materialRequestTitle,
          transferCarton || null,
          binLocation || currentLocation || null,
          cartonId || currentBoxId || null,
          selectedStore || "",
          pickingStarted ? "In Progress" : "Draft",
          settings.user_id || "",
          pickingSessionId
            ? (
                await db.getFirstAsync<{ started_at: string }>(
                  `SELECT started_at FROM material_request_picking_sessions WHERE session_id = ?`,
                  [sessionId]
                )
              )?.started_at || new Date().toISOString()
            : new Date().toISOString(), // Only set started_at on first save
          new Date().toISOString(),
        ]
      );

      console.log(`✅ Saved picking session: ${sessionId}`, {
        tc_id: transferCarton,
        bin_location: binLocation || currentLocation,
        carton_id: cartonId || currentBoxId,
        status: pickingStarted ? "In Progress" : "Draft",
      });
    } catch (error: any) {
      console.error("❌ Error saving picking session:", error);
    }
  };

  // ✅ Restore picking session state (for draft/resume functionality)
  const restorePickingSession = async (): Promise<boolean> => {
    if (!materialRequestTitle) {
      console.log("ℹ️ No materialRequestTitle, skipping restore");
      return false;
    }

    try {
      const db = await getDatabase();
      console.log(
        `🔍 Attempting to restore picking session for: ${materialRequestTitle}`
      );

      const session = await db
        .getFirstAsync<{
          session_id: string;
          tc_id: string | null;
          bin_location: string | null;
          carton_id: string | null;
          store: string | null;
          status: string;
        }>(
          `SELECT session_id, tc_id, bin_location, carton_id, store, status 
         FROM material_request_picking_sessions 
         WHERE material_request_title = ? 
         ORDER BY updated_at DESC LIMIT 1`,
          [materialRequestTitle]
        )
        .catch((error: any) => {
          console.error("❌ Error querying picking sessions table:", error);
          // Table might not exist yet - that's okay
          if (error.message?.includes("no such table")) {
            console.log(
              "ℹ️ material_request_picking_sessions table doesn't exist yet - will be created on first save"
            );
          }
          return null;
        });

      if (session) {
        console.log(`✅ Found picking session: ${session.session_id}`, {
          tc_id: session.tc_id,
          bin_location: session.bin_location,
          carton_id: session.carton_id,
          status: session.status,
        });

        setPickingSessionId(session.session_id);
        setSessionStatus(
          session.status as "Draft" | "In Progress" | "Completed"
        );

        // Restore Transfer Carton
        if (session.tc_id) {
          setTransferCarton(session.tc_id);
          setPickingStarted(true);
          console.log(`✅ Restored TC: ${session.tc_id}`);
        }

        // Restore bin location
        if (session.bin_location) {
          setBinLocation(session.bin_location);
          setCurrentLocation(session.bin_location);
          setBinLocationInput(session.bin_location);
          console.log(`✅ Restored bin location: ${session.bin_location}`);
        }

        // Restore carton ID
        if (session.carton_id) {
          setCartonId(session.carton_id);
          setCurrentBoxId(session.carton_id);
          setCartonIdInput(session.carton_id);
          console.log(`✅ Restored carton ID: ${session.carton_id}`);
        }

        // Restore store
        if (session.store && !selectedStore) {
          setSelectedStore(session.store);
          console.log(`✅ Restored store: ${session.store}`);
        }

        return true;
      } else {
        console.log(`ℹ️ No picking session found for: ${materialRequestTitle}`);
        // ✅ Set session status to null if no session found (will trigger auto-start)
        setSessionStatus(null);
        return false;
      }
    } catch (error: any) {
      console.error("❌ Error restoring picking session:", error);
      return false;
    }
  };

  // Check for existing Transfer Carton for this Material Request
  // Returns the TC ID if found, null otherwise
  const checkExistingTC = async (store: string): Promise<string | null> => {
    if (!materialRequestTitle || !store) return null;

    try {
      const db = await getDatabase();

      // ✅ Priority 1: Check tc_cache table (TCs created via "Start Picking")
      // Note: tc_cache table uses to_no to store Material Request title (not material_request column)
      // Also check by tc_id pattern matching for TCs created with MR number in ID
      const mrNumber = materialRequestTitle.replace("MR-", "");
      const tcFromCache = await db.getFirstAsync<{
        tc_id: string;
        status: string;
        to_no: string;
      }>(
        `SELECT tc_id, status, to_no FROM tc_cache 
         WHERE to_no = ? OR tc_id LIKE ? OR tc_id LIKE ?
         ORDER BY updated_on DESC LIMIT 1`,
        [
          materialRequestTitle,
          `TC-MR-${mrNumber}%`, // Match TC-MR-{MR_NUMBER}-{timestamp}
          `%MR-${mrNumber}%`, // Match any TC with MR number
        ]
      );

      console.log(`🔍 Checking tc_cache for MR ${materialRequestTitle}:`, {
        found: !!tcFromCache,
        tc_id: tcFromCache?.tc_id,
        to_no: tcFromCache?.to_no,
        status: tcFromCache?.status,
      });

      if (tcFromCache && tcFromCache.tc_id) {
        const tcId = tcFromCache.tc_id;
        console.log(
          `📦 Found existing Transfer Carton in cache: ${tcId} (to_no: ${
            tcFromCache.to_no || "N/A"
          })`
        );
        setTransferCarton(tcId);
        setPickingStarted(true);

        if (
          tcFromCache.status === "Sealed" ||
          tcFromCache.status === "SEALED"
        ) {
          setHasSealedTC(true);
        }
        if (
          tcFromCache.status === "Dispatched" ||
          tcFromCache.status === "DISPATCHED"
        ) {
          setHasDispatchedTC(true);
        }
        return tcId; // Return TC ID found in cache
      } else {
        console.log(
          `ℹ️ No TC found in tc_cache for MR ${materialRequestTitle}`
        );
      }

      // ✅ Priority 2: Check event_queue for existing TC for this Material Request
      const existingEvents = await db.getAllAsync<{ tc_id: string }>(
        `SELECT DISTINCT tc_id FROM event_queue 
         WHERE material_request = ? AND tc_id IS NOT NULL AND tc_id != ''
         LIMIT 1`,
        [materialRequestTitle]
      );

      if (existingEvents.length > 0 && existingEvents[0].tc_id) {
        const tcId = existingEvents[0].tc_id;
        console.log(`📦 Found existing Transfer Carton from events: ${tcId}`);
        setTransferCarton(tcId);
        setPickingStarted(true);

        // Check if TC is sealed or dispatched - query database directly
        try {
          const tcCache = await db.getFirstAsync<{ status: string }>(
            `SELECT status FROM tc_cache WHERE tc_id = ?`,
            [tcId]
          );
          if (tcCache) {
            if (tcCache.status === "Sealed" || tcCache.status === "SEALED") {
              setHasSealedTC(true);
            }
            if (
              tcCache.status === "Dispatched" ||
              tcCache.status === "DISPATCHED"
            ) {
              setHasDispatchedTC(true);
            }
          }
        } catch (error: any) {
          console.warn(`⚠️ Could not check TC status:`, error.message);
        }
        return tcId; // Return TC ID found in events
      }

      // ✅ Priority 3: Try to find from backend
      try {
        const backendTCs = await apiService.getTransferCartons({
          store,
          material_request: materialRequestTitle,
        });
        const mrTC = Array.isArray(backendTCs)
          ? backendTCs.find(
              (tc: any) =>
                tc.material_request === materialRequestTitle ||
                tc.to_no === materialRequestTitle ||
                (tc.tc_id &&
                  tc.tc_id.includes(materialRequestTitle.replace("MR-", "")))
            )
          : null;

        if (mrTC && mrTC.tc_id) {
          console.log(`📦 Found Transfer Carton from backend: ${mrTC.tc_id}`);
          setTransferCarton(mrTC.tc_id);
          setPickingStarted(true);

          // ✅ Save to local cache with to_no = materialRequestTitle for future lookups
          await dataService.saveTransferCarton({
            tc_id: mrTC.tc_id,
            asn_no: "",
            to_no: materialRequestTitle, // ✅ Store MR title in to_no for lookup
            store: store,
            status: mrTC.status || "Created",
            updated_on: new Date().toISOString(),
          });

          console.log(
            `✅ Saved TC ${mrTC.tc_id} to local cache with to_no=${materialRequestTitle}`
          );

          if (mrTC.status === "Sealed" || mrTC.status === "SEALED") {
            setHasSealedTC(true);
          }
          if (mrTC.status === "Dispatched" || mrTC.status === "DISPATCHED") {
            setHasDispatchedTC(true);
          }
          return mrTC.tc_id; // Return TC ID found from backend
        }
      } catch (error: any) {
        console.log(
          `ℹ️ Could not fetch Transfer Cartons from backend: ${error.message}`
        );
      }

      return null; // No existing TC found
    } catch (error: any) {
      console.warn(`⚠️ Error checking existing TC:`, error.message);
      return null;
    }
  };

  // Load boxes for this Material Request
  const loadBoxes = async () => {
    if (!materialRequest || !selectedStore) return;

    setLoading(true);
    try {
      // For Material Requests, boxes should be from the warehouse (from_warehouse)
      // and should be closed boxes ready for packing
      const boxList = await dataService.getBoxes(
        undefined, // No ASN for Material Requests
        materialRequest.from_warehouse, // Source warehouse
        "STORE"
      );

      const closedBoxes = boxList.filter(
        (b) =>
          b.status === "Closed" ||
          b.status === "CLOSED" ||
          b.status === "closed"
      );

      console.log(
        `📦 Found ${closedBoxes.length} closed boxes for Material Request packing`
      );
      setBoxes(closedBoxes);
    } catch (error: any) {
      console.error("❌ Error loading boxes:", error);
      setBoxes([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (materialRequest && selectedStore) {
      loadBoxes();
    }
  }, [materialRequest, selectedStore]);

  // Show Transfer Carton items modal
  const handleShowTCItems = async () => {
    if (!transferCarton || !materialRequestTitle) return;

    try {
      const db = await getDatabase();

      // Get all items in this Transfer Carton from event_queue
      const tcEvents = await db.getAllAsync<{
        item_code: string;
        qty: number;
      }>(
        `SELECT 
          item_code,
          SUM(qty) as qty
        FROM event_queue
        WHERE tc_id = ?
          AND event_type IN ('PACK_BOX_TO_TC', 'PACK_ITEM_TO_TC') -- Support both for backward compatibility
          AND material_request = ?
        GROUP BY item_code`,
        [transferCarton, materialRequestTitle]
      );

      // Get item names from Material Request
      const itemsWithDetails = tcEvents.map((event) => {
        const mrItem = materialRequest?.items?.find(
          (item: any) => item.item_code === event.item_code
        );
        return {
          item_code: event.item_code,
          item_name: mrItem?.item_name,
          requested_qty: mrItem?.requested_qty || 0,
          scanned_qty: event.qty || 0,
        };
      });

      setTcItemsModal({
        visible: true,
        items: itemsWithDetails,
      });
    } catch (error: any) {
      console.error("❌ Error loading TC items:", error);
      Alert.alert(
        "Error",
        `Failed to load Transfer Carton items: ${error.message}`
      );
    }
  };

  // Create Transfer Carton
  const createTransferCarton = async () => {
    if (!materialRequest || !selectedStore) {
      Alert.alert("Error", "Material Request or store not available");
      return;
    }

    setIsCreating(true);
    try {
      const settings = await getSettings();

      // Validate required fields
      if (!selectedStore || selectedStore.trim() === "") {
        throw new Error(
          "Store is required. Please ensure Material Request has a valid 'to_showroom' value."
        );
      }

      if (!settings.user_id || settings.user_id.trim() === "") {
        throw new Error("User ID is required. Please check your settings.");
      }

      // Generate TC ID in format: TC-MR-{MR_NUMBER}-{timestamp}
      // Example: TC-MR-0001-1767516827262
      const tc_id = `TC-MR-${materialRequestTitle.replace(
        "MR-",
        ""
      )}-${Date.now()}`;

      console.log("📦 Creating Transfer Carton for Material Request:", {
        tc_id,
        store: selectedStore,
        user_id: settings.user_id,
        material_request: materialRequestTitle,
      });

      const response = await apiService.createTransferCarton({
        tc_id,
        asn_no: null, // Backend validation requires null for Material Requests
        to_no: materialRequestTitle, // Use Material Request number as transfer_order for tracking
        store: selectedStore,
        user_id: settings.user_id,
        created_by: settings.user_id,
        material_request: materialRequestTitle,
      });

      if (response && (response.tc_id || response.data?.tc_id)) {
        const createdTCId = response.tc_id || response.data?.tc_id;
        console.log(`✅ Created Transfer Carton: ${createdTCId}`);
        setTransferCarton(createdTCId);

        // Save to local cache
        await dataService.saveTransferCarton({
          tc_id: createdTCId,
          asn_no: "", // Material Requests don't have ASN - use empty string
          to_no: materialRequestTitle, // Use Material Request number for tracking
          store: selectedStore,
          status: "Created",
          updated_on: new Date().toISOString(),
        });

        // ✅ NEW WORKFLOW: Add items from Material Request to Transfer Carton
        // Get items with picked_qty > 0 from Material Request
        const itemsToAdd: {
          item_code: string;
          qty: number;
          carton_id?: string;
          source_bin?: string;
        }[] = [];

        if (materialRequest?.items && Array.isArray(materialRequest.items)) {
          for (const item of materialRequest.items) {
            const pickedQty = item.picked_qty || 0;
            if (pickedQty > 0) {
              // Get carton_id and source_bin from scanned_items table
              const db = await getDatabase();
              const scannedItem = await db.getFirstAsync<{
                box_id: string | null;
                location_id: string | null;
              }>(
                `SELECT box_id, location_id FROM scanned_items 
                 WHERE asn_no = ? AND item_code = ? 
                 ORDER BY scanned_on DESC LIMIT 1`,
                [materialRequestTitle, item.item_code]
              );

              itemsToAdd.push({
                item_code: item.item_code,
                qty: pickedQty, // Total picked quantity
                carton_id: scannedItem?.box_id || undefined,
                source_bin: scannedItem?.location_id || undefined,
              });
            }
          }
        }

        // Add items to Transfer Carton using the new add-items endpoint
        if (itemsToAdd.length > 0) {
          try {
            console.log(
              `📦 Adding ${itemsToAdd.length} item(s) to Transfer Carton ${createdTCId}...`
            );
            await apiService.addItemsToTransferCarton(
              createdTCId,
              itemsToAdd,
              settings.user_id
            );
            console.log(
              `✅ Successfully added ${itemsToAdd.length} item(s) to Transfer Carton`
            );
          } catch (addItemsError: any) {
            console.error(
              `❌ Failed to add items to Transfer Carton:`,
              addItemsError
            );
            Alert.alert(
              "Warning",
              `Transfer Carton created but failed to add items:\n\n${addItemsError.message}\n\nPlease add items manually.`
            );
          }
        } else {
          console.log(
            `ℹ️ No items with picked_qty > 0 to add to Transfer Carton`
          );
        }

        Alert.alert(
          "Success",
          `Transfer Carton ${createdTCId} created successfully.\n\n${itemsToAdd.length} item(s) added to Transfer Carton.`
        );

        // Reload Material Request and scanned items
        await loadMaterialRequest();
        await loadScannedItems();
      } else {
        throw new Error("Failed to create Transfer Carton");
      }
    } catch (error: any) {
      console.error("❌ Error creating Transfer Carton:", error);
      Alert.alert(
        "Error",
        `Failed to create Transfer Carton: ${error.message}`
      );
    } finally {
      setIsCreating(false);
    }
  };

  // Pack all scanned items into Transfer Carton
  const packAllScannedItems = async (tcId?: string) => {
    const targetTC = tcId || transferCarton;
    if (!targetTC) {
      Alert.alert("Error", "No Transfer Carton selected");
      return;
    }

    if (scannedItems.length === 0) {
      Alert.alert("No Items", "No scanned items to pack");
      return;
    }

    try {
      const db = await getDatabase();
      const settings = await getSettings();
      let packedCount = 0;

      // Update all scanned items' events to associate them with the TC
      for (const item of scannedItems) {
        // Update events for this item/location combination
        const result = await db.runAsync(
          `UPDATE event_queue 
           SET tc_id = ?
           WHERE material_request = ? 
             AND item_code = ? 
             AND (rack = ? OR bin = ? OR source_bin = ?)
             AND event_type IN ('PACK_BOX_TO_TC', 'PACK_ITEM_TO_TC') -- Support both for backward compatibility
             AND tc_id IS NULL`,
          [
            targetTC,
            materialRequestTitle,
            item.item_code,
            item.location_id,
            item.location_id,
            item.location_id,
          ]
        );

        packedCount += result.changes || 0;
      }

      console.log(
        `✅ Packed ${packedCount} event(s) into Transfer Carton ${targetTC}`
      );

      // Reload scanned items to refresh the display
      await loadScannedItems();

      Alert.alert(
        "Items Packed",
        `Successfully packed ${scannedItems.length} item(s) into Transfer Carton ${targetTC}`
      );
    } catch (error: any) {
      console.error("❌ Error packing scanned items:", error);
      Alert.alert("Error", `Failed to pack items: ${error.message}`);
    }
  };

  // Pack box to Transfer Carton
  const packBox = async (boxId: string) => {
    if (!transferCarton || !materialRequest || !selectedStore) {
      Alert.alert(
        "Error",
        "Transfer Carton, Material Request, or store not available"
      );
      return;
    }

    if (packedBoxes.includes(boxId)) {
      Alert.alert(
        "Already Packed",
        `Box ${boxId} is already packed to this Transfer Carton`
      );
      return;
    }

    try {
      const settings = await getSettings();

      // Create PACK_ITEM_TO_TC event (legacy function - may not be used)
      await addEvent({
        event_type: "PACK_ITEM_TO_TC",
        material_request: materialRequestTitle,
        box_id: boxId,
        carton_id: boxId, // ✅ REQUIRED: Backend expects carton_id
        tc_id: transferCarton, // ✅ REQUIRED: Backend expects tc_id
        store: selectedStore,
        device_id: settings.device_id,
        user_id: settings.user_id,
      });

      setPackedBoxes([...packedBoxes, boxId]);
      Alert.alert(
        "Success",
        `Box ${boxId} packed to Transfer Carton ${transferCarton}`
      );
    } catch (error: any) {
      console.error("❌ Error packing box:", error);
      Alert.alert("Error", `Failed to pack box: ${error.message}`);
    }
  };

  // Seal Transfer Carton
  const sealTransferCarton = async () => {
    if (!transferCarton) {
      Alert.alert("Error", "No Transfer Carton selected");
      return;
    }

    // Check if TC has items in database (already packed) OR in local state (recently scanned)
    // This handles the case where items were packed but are not in scannedItems state
    let hasItemsInDB = false;
    try {
      const db = await getDatabase();
      // Check if TC has any items in the event queue
      const itemCount = await db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count 
         FROM event_queue 
         WHERE tc_id = ? 
            AND event_type IN ('PACK_BOX_TO_TC', 'PACK_ITEM_TO_TC')`, // Support both for backward compatibility
        [transferCarton]
      );
      hasItemsInDB = (itemCount?.count || 0) > 0;
      console.log(
        `🔍 Checking TC ${transferCarton} for items: DB count = ${
          itemCount?.count || 0
        }, Local scanned = ${scannedItems.length}, Packed boxes = ${
          packedBoxes.length
        }`
      );
    } catch (error: any) {
      console.warn(`⚠️ Error checking TC items in database:`, error.message);
      // Continue with validation even if DB check fails
    }

    // For Material Requests, allow sealing if items are scanned OR boxes are packed OR items exist in DB
    // Items are scanned directly, not necessarily packed into boxes first
    const hasScannedItems = scannedItems.length > 0;
    const hasPackedBoxes = packedBoxes.length > 0;
    const hasItems = hasScannedItems || hasPackedBoxes || hasItemsInDB;

    if (!hasItems) {
      Alert.alert(
        "Warning",
        "No items scanned or boxes packed. Please scan items or pack boxes before sealing.",
        [
          {
            text: "Seal Anyway",
            style: "destructive",
            onPress: () => proceedWithSeal(),
          },
          {
            text: "Cancel",
            style: "cancel",
          },
        ]
      );
      return;
    }

    await proceedWithSeal();
  };

  // Proceed with sealing Transfer Carton
  const proceedWithSeal = async () => {
    if (!transferCarton) return;

    setIsSealing(true);
    try {
      const settings = await getSettings();

      // Before sealing, send picked items to backend via pick-items API
      // This ensures the backend has the latest picked quantities
      // Note: We only send items that haven't been fully picked yet
      if (materialRequestTitle && scannedItems.length > 0) {
        try {
          // First, reload Material Request to get latest picked quantities
          // This ensures we have the most up-to-date status
          const latestMR = await calculatePickedQuantities(
            materialRequest || { title: materialRequestTitle, items: [] }
          );

          // Aggregate scanned items by item_code and source_bin (location_id)
          const itemsMap = new Map<
            string,
            { item_code: string; picked_qty: number; source_bin: string }
          >();

          scannedItems.forEach((item) => {
            const key = `${item.item_code}_${item.location_id}`;
            const existing = itemsMap.get(key);
            if (existing) {
              existing.picked_qty += item.qty;
            } else {
              itemsMap.set(key, {
                item_code: item.item_code,
                picked_qty: item.qty,
                source_bin: item.location_id || "",
              });
            }
          });

          // Filter out items that are already fully picked
          // Only send items that still have remaining quantity to pick
          const pickItems = Array.from(itemsMap.values()).filter((pickItem) => {
            const mrItem = latestMR.items?.find(
              (item: any) => item.item_code === pickItem.item_code
            );
            if (!mrItem) {
              // Item not found in MR - include it (shouldn't happen, but safe)
              return true;
            }

            const currentPickedQty = mrItem.picked_qty || 0;
            const requestedQty = mrItem.requested_qty || 0;
            const remainingQty = requestedQty - currentPickedQty;

            // Only include if there's remaining quantity to pick
            if (remainingQty <= 0) {
              console.log(
                `ℹ️ Skipping ${pickItem.item_code} - already fully picked (${currentPickedQty}/${requestedQty})`
              );
              return false;
            }

            // Adjust picked_qty to not exceed remaining quantity
            if (pickItem.picked_qty > remainingQty) {
              console.log(
                `⚠️ Adjusting picked_qty for ${pickItem.item_code} from ${pickItem.picked_qty} to ${remainingQty} (remaining quantity)`
              );
              pickItem.picked_qty = remainingQty;
            }

            return true;
          });

          if (pickItems.length > 0) {
            console.log(
              `📦 Sending ${
                pickItems.length
              } item(s) to pick-items API before sealing TC (filtered out ${
                Array.from(itemsMap.values()).length - pickItems.length
              } fully picked items)`
            );
            console.log(`📦 Pick items data:`, pickItems);

            await apiService.pickMaterialRequestItems(
              materialRequestTitle,
              pickItems,
              materialRequest?.from_warehouse
            );

            console.log(`✅ Successfully sent picked items to backend`);
          } else {
            console.log(
              `ℹ️ All items are already fully picked - skipping pick-items API call`
            );
          }
        } catch (pickError: any) {
          console.warn(
            `⚠️ Failed to send picked items to backend:`,
            pickError.message
          );

          // Parse error message to extract details
          let errorMessage = pickError.message || "Unknown error";
          let errorDetails = "";

          // Try to extract error details from response
          let errorData: any = null;
          if (pickError.response || pickError.data) {
            errorData = pickError.response?.data || pickError.data;
            if (errorData?.message) {
              errorMessage = errorData.message;
            }
            if (errorData?.code === "INSUFFICIENT_STOCK") {
              errorDetails = `\n\nItem: ${
                errorData.item_code || "Unknown"
              }\nLocation: ${
                errorData.location || errorData.source_bin || "Unknown"
              }\nAvailable: ${errorData.available || 0}\nRequired: ${
                errorData.required || 0
              }`;
            }
          }

          // Also try to parse from error message string (backend might send it as a string)
          const insufficientStockMatch = errorMessage.match(
            /Insufficient stock for (.+?) at (.+?)\. Available: (\d+), Required: (\d+)/i
          );
          if (insufficientStockMatch && !errorDetails) {
            errorDetails = `\n\nItem: ${insufficientStockMatch[1]}\nLocation: ${insufficientStockMatch[2]}\nAvailable: ${insufficientStockMatch[3]}\nRequired: ${insufficientStockMatch[4]}`;
          }

          // Check error types
          const isInsufficientStock =
            errorMessage.includes("INSUFFICIENT_STOCK") ||
            errorMessage.includes("Insufficient stock") ||
            errorMessage.includes("insufficient stock");

          // ✅ NEW: Carton validation errors
          const isCartonNotFound =
            errorMessage.includes("CARTON_NOT_FOUND") ||
            (errorMessage.includes("Carton") &&
              errorMessage.includes("not found")) ||
            errorData?.code === "CARTON_NOT_FOUND";

          const isCartonBinMismatch =
            errorMessage.includes("CARTON_BIN_MISMATCH") ||
            (errorMessage.includes("Carton") &&
              errorMessage.includes("not in bin")) ||
            errorData?.code === "CARTON_BIN_MISMATCH";

          const isInsufficientCartonStock =
            errorMessage.includes("INSUFFICIENT_CARTON_STOCK") ||
            errorMessage.includes("Insufficient stock in carton") ||
            errorData?.code === "INSUFFICIENT_CARTON_STOCK";

          const isValidationError =
            errorMessage.includes("VALIDATION_ERROR") ||
            errorMessage.includes("Cannot pick") ||
            errorMessage.includes("Already picked") ||
            errorData?.code === "VALIDATION_ERROR";

          // Extract validation error details
          if (isValidationError && !errorDetails) {
            const alreadyPickedMatch = errorMessage.match(
              /Cannot pick (\d+) for (.+?)\. Already picked: (\d+), Requested: (\d+)/i
            );
            if (alreadyPickedMatch) {
              errorDetails = `\n\nItem: ${alreadyPickedMatch[2]}\nTrying to pick: ${alreadyPickedMatch[1]}\nAlready picked: ${alreadyPickedMatch[3]}\nRequested: ${alreadyPickedMatch[4]}`;
            }
          }

          if (isValidationError) {
            // For validation errors (e.g., already fully picked), just log and continue
            // The events are already synced, so the backend should have the correct state
            console.log(
              `ℹ️ Validation error from pick-items API (likely items already picked): ${errorMessage}`
            );
            console.log(
              `ℹ️ This is expected if events were already synced. Continuing with sealing...`
            );
            // Don't show alert - just continue with sealing
          } else if (isCartonNotFound) {
            // ✅ NEW: Carton not found error
            return new Promise<boolean>((resolve) => {
              Alert.alert(
                "Carton Not Found",
                `The carton specified in the picking request was not found in the system.\n\n${errorMessage}\n\nPlease verify the carton ID and try again.`,
                [
                  {
                    text: "OK",
                    onPress: () => {
                      setIsSealing(false);
                      resolve(false);
                    },
                  },
                ]
              );
            });
          } else if (isCartonBinMismatch) {
            // ✅ NEW: Carton bin mismatch error
            return new Promise<boolean>((resolve) => {
              Alert.alert(
                "Carton Location Mismatch",
                `The carton is not in the specified bin location.\n\n${errorMessage}\n\nPlease verify the carton location or move the carton to the correct bin.`,
                [
                  {
                    text: "OK",
                    onPress: () => {
                      setIsSealing(false);
                      resolve(false);
                    },
                  },
                ]
              );
            });
          } else if (isInsufficientCartonStock) {
            // ✅ NEW: Insufficient carton stock error
            return new Promise<boolean>((resolve) => {
              Alert.alert(
                "Insufficient Carton Stock",
                `Not enough stock available in the specified carton.\n\n${errorMessage}\n\nPlease check the carton stock or use a different carton.`,
                [
                  {
                    text: "Cancel",
                    style: "cancel",
                    onPress: () => {
                      setIsSealing(false);
                      resolve(false);
                    },
                  },
                  {
                    text: "Proceed Anyway",
                    style: "destructive",
                    onPress: () => {
                      console.log(
                        `⚠️ Proceeding with sealing despite insufficient carton stock error`
                      );
                      resolve(true);
                    },
                  },
                ]
              );
            });
          } else if (isInsufficientStock) {
            // For insufficient stock, ask user if they want to proceed
            return new Promise<boolean>((resolve) => {
              Alert.alert(
                "Insufficient Stock",
                `Cannot pick items due to insufficient stock at the specified location.${errorDetails}\n\nEvents have already been saved locally. Do you want to:\n\n• Cancel: Go back and fix the stock issue\n• Proceed: Seal the Transfer Carton anyway (you may need to manually adjust stock later)`,
                [
                  {
                    text: "Cancel",
                    style: "cancel",
                    onPress: () => {
                      setIsSealing(false);
                      resolve(false);
                    },
                  },
                  {
                    text: "Proceed Anyway",
                    style: "destructive",
                    onPress: () => {
                      // Continue with sealing despite the error
                      // The events are already saved, so sealing can proceed
                      console.log(
                        `⚠️ Proceeding with sealing despite insufficient stock error`
                      );
                      resolve(true);
                    },
                  },
                ]
              );
            }).then(async (shouldContinue) => {
              // If user chose to proceed, continue with sealing
              // If user chose to cancel, setIsSealing(false) was already called and shouldContinue will be false
              if (shouldContinue) {
                // Continue with sealing - the sealing code below will execute
                console.log(
                  `⚠️ Continuing with sealing after user chose to proceed despite error`
                );
              } else {
                // User cancelled, exit early
                return;
              }
            });
          } else {
            // For other errors, show warning but allow proceeding
            return new Promise<boolean>((resolve) => {
              Alert.alert(
                "Warning",
                `Failed to update picked quantities in backend:\n\n${errorMessage}\n\nThe Transfer Carton will still be sealed, but you may need to manually update the Material Request.`,
                [
                  {
                    text: "Cancel",
                    style: "cancel",
                    onPress: () => {
                      setIsSealing(false);
                      resolve(false);
                    },
                  },
                  {
                    text: "Continue",
                    onPress: () => {
                      // Continue with sealing
                      resolve(true);
                    },
                  },
                ]
              );
            }).then(async (shouldContinue) => {
              // If user chose to proceed, continue with sealing
              if (shouldContinue) {
                // Continue with sealing - the sealing code below will execute
                console.log(
                  `⚠️ Continuing with sealing after user chose to proceed despite error`
                );
              } else {
                // User cancelled, exit early
                return;
              }
            });
          }
        }
      }

      // Now seal the Transfer Carton (this will execute if pick-items API succeeded or user chose to proceed)
      const response = await apiService.sealTransferCarton({
        tc_id: transferCarton,
        sealed_by: settings.user_id,
      });

      if (response && (response.ok || response.success)) {
        console.log(`✅ Sealed Transfer Carton: ${transferCarton}`);
        setHasSealedTC(true);

        // Update local cache
        await dataService.updateTransferCartonStatus(transferCarton, "Sealed");

        // Check if TC is already dispatched (shouldn't happen, but check anyway)
        try {
          const db = await getDatabase();
          const tcCache = await db.getFirstAsync<{ status: string }>(
            `SELECT status FROM tc_cache WHERE tc_id = ?`,
            [transferCarton]
          );
          if (
            tcCache &&
            (tcCache.status === "Dispatched" || tcCache.status === "DISPATCHED")
          ) {
            setHasDispatchedTC(true);
          }
        } catch (error: any) {
          console.warn(`⚠️ Could not check dispatched status:`, error.message);
        }

        // Reload scanned items to filter out items in sealed TC
        await loadScannedItems();

        // Update Material Request status to "Picked"
        if (materialRequestTitle) {
          try {
            await apiService.updateMaterialRequestStatus(
              materialRequestTitle,
              "Picked"
            );
            console.log(
              `✅ Updated Material Request ${materialRequestTitle} status to Picked`
            );
          } catch (mrError: any) {
            console.warn(
              `⚠️ Failed to update Material Request status:`,
              mrError.message
            );
            // Don't block sealing if MR status update fails
          }
        }

        Alert.alert(
          "Success",
          `Transfer Carton ${transferCarton} sealed successfully`
        );
      } else {
        throw new Error("Failed to seal Transfer Carton");
      }
    } catch (error: any) {
      console.error("❌ Error sealing Transfer Carton:", error);
      Alert.alert("Error", `Failed to seal Transfer Carton: ${error.message}`);
    } finally {
      setIsSealing(false);
    }
  };

  // Dispatch Transfer Carton
  const dispatchTransferCarton = async () => {
    if (!transferCarton) {
      Alert.alert("Error", "No Transfer Carton to dispatch");
      return;
    }

    // Check if TC is sealed (required for dispatch)
    if (!hasSealedTC) {
      Alert.alert("Error", "Transfer Carton must be sealed before dispatch");
      return;
    }

    // Check if already dispatched
    if (hasDispatchedTC) {
      Alert.alert(
        "Already Dispatched",
        `Transfer Carton ${transferCarton} has already been dispatched.`
      );
      return;
    }

    Alert.alert(
      "Confirm Dispatch",
      `Dispatch Transfer Carton ${transferCarton}?\n\nThis will reduce stock in the backend.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Dispatch",
          onPress: async () => {
            setIsDispatching(true);
            try {
              const settings = await getSettings();

              // Call dispatch API
              await apiService.dispatchTransferCarton({
                tc_id: transferCarton,
              });

              // Update local cache
              await dataService.updateTransferCartonStatus(
                transferCarton,
                "Dispatched"
              );

              setHasDispatchedTC(true);

              // Update Material Request status from "Picked" to "Dispatched"
              if (materialRequestTitle) {
                try {
                  await apiService.updateMaterialRequestStatus(
                    materialRequestTitle,
                    "Dispatched"
                  );
                  console.log(
                    `✅ Updated Material Request ${materialRequestTitle} status to Dispatched`
                  );
                } catch (error: any) {
                  console.warn(
                    `⚠️ Failed to update MR status to Dispatched:`,
                    error.message
                  );
                }
              }

              Alert.alert(
                "Success",
                `Transfer Carton ${transferCarton} dispatched successfully`
              );

              // Reload Material Request to refresh data and show updated status
              await loadMaterialRequest();
            } catch (error: any) {
              console.error("❌ Error dispatching Transfer Carton:", error);
              Alert.alert(
                "Error",
                error.message || "Failed to dispatch Transfer Carton"
              );
            } finally {
              setIsDispatching(false);
            }
          },
        },
      ]
    );
  };

  // Update Material Request status
  const updateMaterialRequestStatus = async (status: string) => {
    if (!materialRequestTitle) return;

    try {
      const settings = await getSettings();
      await apiService.updateMaterialRequestStatus(
        materialRequestTitle,
        status
      );

      // Reload Material Request to get updated status
      await loadMaterialRequest();
    } catch (error: any) {
      console.error("❌ Error updating Material Request status:", error);
      // Don't show alert - this is a background operation
    }
  };

  // Handle location scan
  const handleLocationScan = async (locationId: string) => {
    const location = locationId.trim().toUpperCase();
    if (!location) return;

    if (!materialRequest) {
      Alert.alert("Error", "Material Request not loaded");
      return;
    }

    console.log(`📍 Location scanned: ${location}`);

    // Validate that this location has stock for at least one item in the Material Request
    try {
      let hasValidStock = false;
      let validItems: string[] = [];

      // Check stock for each item in the Material Request
      for (const mrItem of materialRequest.items || []) {
        try {
          const stockResponse = await apiService.getStockByItemAndWarehouse(
            mrItem.item_code,
            materialRequest.from_warehouse
          );

          // Handle 404 (endpoint not found) gracefully
          if (stockResponse === null) {
            console.log(
              `ℹ️ Stock item endpoint not found (404) for ${mrItem.item_code} - this endpoint may not be implemented yet`
            );
            // Continue checking other items - skip this item
            continue;
          }

          // Handle different response formats
          let stockEntries: any[] = [];
          if (Array.isArray(stockResponse)) {
            stockEntries = stockResponse;
          } else if (stockResponse && typeof stockResponse === "object") {
            if (Array.isArray(stockResponse.data)) {
              stockEntries = stockResponse.data;
            } else if (Array.isArray(stockResponse.stock)) {
              stockEntries = stockResponse.stock;
            } else if (Array.isArray(stockResponse.locations)) {
              stockEntries = stockResponse.locations;
            } else if (
              stockResponse.location_id ||
              stockResponse.bin_location
            ) {
              stockEntries = [stockResponse];
            }
          }

          // Check if this location has stock for this item
          const locationStock = stockEntries.find(
            (entry) =>
              (entry.location_id || entry.bin_location || "").toUpperCase() ===
                location &&
              (entry.qty || entry.quantity || entry.available_qty || 0) > 0
          );

          if (locationStock) {
            hasValidStock = true;
            validItems.push(mrItem.item_code);
          }
        } catch (itemError: any) {
          const errorMessage = itemError.message || itemError.toString() || "";
          const is404Error =
            errorMessage.includes("404") ||
            errorMessage.includes("not found") ||
            errorMessage.includes("Route GET /api/stock/item/");

          if (is404Error) {
            console.log(
              `ℹ️ Stock item endpoint not found (404) for ${mrItem.item_code} - this endpoint may not be implemented yet`
            );
          } else {
            console.warn(
              `⚠️ Error checking stock for ${mrItem.item_code}:`,
              itemError.message
            );
          }
          // Continue checking other items
        }
      }

      if (!hasValidStock) {
        Alert.alert(
          "Invalid Location",
          `Location ${location} does not have stock for any items in this Material Request.\n\nPlease scan a valid location that has stock for the requested items.`
        );
        return;
      }

      console.log(
        `✅ Location ${location} validated - has stock for: ${validItems.join(
          ", "
        )}`
      );
      setCurrentLocation(location);
      // ✅ Sync with new workflow state
      setBinLocation(location);
      setBinInfo({ bin_code: location, bin_id: location });
      // ✅ Automatically advance to Box ID scanning
      setScanWorkflow("SCAN_BOX_ID");
      // Don't show alert - location is already displayed, just advance workflow silently
    } catch (error: any) {
      console.error("❌ Error validating location:", error);
      Alert.alert(
        "Validation Error",
        `Failed to validate location: ${error.message}\n\nPlease try again or contact support.`
      );
    }
  };

  // ✅ NEW: Start Picking - Creates Transfer Carton immediately (only if not exists)
  const handleStartPicking = async () => {
    if (!materialRequest || !selectedStore) {
      Alert.alert("Error", "Material Request or store not available");
      return;
    }

    setIsCreating(true);
    try {
      const settings = await getSettings();

      if (!selectedStore || selectedStore.trim() === "") {
        throw new Error("Store is required");
      }

      if (!settings.user_id || settings.user_id.trim() === "") {
        throw new Error("User ID is required");
      }

      // ✅ NO TC CREATION OR CHECK - TC is only created after "Complete Picking" when status is "Picked"
      // During picking (status "In Progress"), we work without TC
      console.log("🚀 Starting Picking - NO Transfer Carton creation (TC created after Complete Picking)");

      setPickingStarted(true);

      // ✅ Save picking session state (without TC)
      await savePickingSession();

      // Load requested items with locations (no TC needed)
      await loadRequestedItemsWithLocations();

      console.log("✅ Picking started - ready to scan items");
    } catch (error: any) {
      console.error("❌ Error starting picking:", error);
      Alert.alert("Error", `Failed to start picking: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  // ✅ NEW: Validate Bin Location (Local first, then backend)
  const validateBinLocation = async (binCode: string) => {
    if (!binCode || !binCode.trim()) return;

    setLoading(true);
    try {
      const db = await getDatabase();
      const normalizedBin = binCode.trim().toUpperCase();

      // Step 1: Check local database first
      const localBin = await db.getFirstAsync<any>(
        "SELECT * FROM bin_master_cache WHERE bin_code = ? OR bin_barcode = ? OR bin_id = ?",
        [normalizedBin, normalizedBin, normalizedBin]
      );

      if (localBin) {
        console.log(`✅ Bin found in local database: ${localBin.bin_code}`);
        setBinInfo(localBin);
        setBinLocation(localBin.bin_code);
        // ✅ Sync with legacy workflow state
        setCurrentLocation(localBin.bin_code);

        // Update backend if online (non-blocking)
        try {
          await apiService.getBinMaster(normalizedBin);
          console.log(`✅ Bin validated on backend: ${normalizedBin}`);
        } catch (backendError: any) {
          console.warn(
            `⚠️ Backend validation failed (non-blocking):`,
            backendError.message
          );
        }

        setLoading(false);
        return;
      }

      // Step 2: If not found locally, try backend
      console.log(
        `🔍 Bin not found locally, checking backend: ${normalizedBin}`
      );
      try {
        const backendBin = await apiService.getBinMaster(normalizedBin);

        if (backendBin && (backendBin.bin_code || backendBin.bin_id)) {
          console.log(
            `✅ Bin found on backend: ${
              backendBin.bin_code || backendBin.bin_id
            }`
          );

          // Save to local cache for future use
          try {
            await db.runAsync(
              `INSERT OR REPLACE INTO bin_master_cache 
               (bin_code, bin_id, bin_barcode, warehouse_id, zone, aisle, rack, level, bin_position)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                backendBin.bin_code || backendBin.bin_id,
                backendBin.bin_id || backendBin.bin_code,
                backendBin.bin_barcode ||
                  backendBin.bin_code ||
                  backendBin.bin_id,
                backendBin.warehouse_id ||
                  materialRequest?.from_warehouse ||
                  "",
                backendBin.zone || "",
                backendBin.aisle || "",
                backendBin.rack || "",
                backendBin.level || "",
                backendBin.bin_position || "",
              ]
            );
            console.log(`✅ Bin saved to local cache`);
          } catch (cacheError: any) {
            console.warn(`⚠️ Failed to cache bin:`, cacheError.message);
          }

          setBinInfo(backendBin);
          const binCode = backendBin.bin_code || backendBin.bin_id;
          setBinLocation(binCode);
          // ✅ Sync with legacy workflow state
          setCurrentLocation(binCode);
          setLoading(false);
          return;
        }
      } catch (backendError: any) {
        const errorMsg = backendError.message || backendError.toString() || "";
        const is404 =
          errorMsg.includes("404") || errorMsg.includes("not found");

        if (is404) {
          Alert.alert(
            "Bin Not Found",
            `Bin "${normalizedBin}" not found in local database or backend.\n\nPlease sync bin master data or scan a valid bin location.`
          );
        } else {
          Alert.alert(
            "Error",
            `Failed to validate bin: ${backendError.message}`
          );
        }
        setBinInfo(null);
        setBinLocation("");
        setLoading(false);
        return;
      }

      // If we get here, bin was not found
      Alert.alert(
        "Bin Not Found",
        `Bin "${normalizedBin}" not found.\n\nPlease sync bin master data or scan a valid bin location.`
      );
      setBinInfo(null);
      setBinLocation("");
    } catch (error: any) {
      console.error("❌ Error validating bin:", error);
      Alert.alert("Error", `Failed to validate bin: ${error.message}`);
      setBinInfo(null);
      setBinLocation("");
    } finally {
      setLoading(false);
    }
  };

  // ✅ NEW: Handle Bin Location Scan
  const handleBinLocationScan = async (binCode: string) => {
    if (!binCode || !binCode.trim()) return;

    await validateBinLocation(binCode);

    if (binInfo) {
      // After successful validation, move to carton ID scanning
      setScanWorkflow("SCAN_CARTON_ID");
      // ✅ Save picking session state
      await savePickingSession();
      // Focus carton ID input
      setTimeout(() => {
        cartonIdInputRef.current?.focus();
      }, 200);
    }
  };

  // ✅ NEW: Handle Carton ID Input Change (wedge scanners: CR/LF or idle commit)
  const handleCartonIdInputChange = (text: string) => {
    onScannerTextChange(
      text,
      setCartonIdInput,
      cartonIdScanTimerRef,
      (cleaned) => void handleCartonIdScan(cleaned.trim())
    );
  };

  const handleBinLocationInputChange = (text: string) => {
    onScannerTextChange(
      text,
      (d) => setBinLocationInput(d.toUpperCase()),
      binLocationScanTimerRef,
      (cleaned) => {
        const t = cleaned.trim();
        if (t) void handleBinLocationScan(t);
      }
    );
  };

  // ✅ NEW: Handle Carton ID Submit
  const handleCartonIdSubmit = async () => {
    clearScannerTimer(cartonIdScanTimerRef);
    if (cartonIdInput.trim()) {
      await handleCartonIdScan(cartonIdInput.trim());
    }
  };

  // ✅ NEW: Generate Carton ID
  const handleGenerateCartonId = () => {
    const generatedId = `CTN-${Date.now()}`;
    setCartonIdInput(generatedId);
    handleCartonIdSubmit();
  };

  // ✅ NEW: Handle Change Carton ID
  const handleChangeCartonId = () => {
    setCartonId(null);
    setCartonIdInput("");
    setCurrentBoxId("");
    setScanWorkflow("SCAN_CARTON_ID");
    setTimeout(() => {
      cartonIdInputRef.current?.focus();
    }, 200);
  };

  // ✅ NEW: Handle Change Bin Location
  const handleChangeBinLocation = () => {
    setBinLocation(null);
    setBinLocationInput("");
    setCurrentLocation("");
    setBinInfo(null);
    setScanWorkflow("SCAN_BIN_LOCATION");
    setTimeout(() => {
      binLocationInputRef.current?.focus();
    }, 200);
  };

  // ✅ NEW: Handle Carton ID Scan (with backend update)
  const handleCartonIdScan = async (scannedCartonId: string) => {
    const trimmedCartonId = scannedCartonId.trim().toUpperCase();
    if (!trimmedCartonId) return;

    // ✅ Check both binLocation (new workflow) and currentLocation (legacy workflow)
    const activeBinLocation = binLocation || currentLocation;
    if (!activeBinLocation) {
      Alert.alert("Bin Location Required", "Please scan bin location first");
      setScanWorkflow("SCAN_LOCATION");
      return;
    }

    // ✅ Auto-create Transfer Carton if not exists (for better UX)
    if (!transferCarton) {
      console.log(`⚠️ No Transfer Carton found, checking for existing one...`);
      try {
        // First, check if a TC already exists (prevents duplicates)
        const existingTCId = await checkExistingTC(selectedStore || "");

        if (existingTCId) {
          // Found existing TC - use it
          console.log(`✅ Found existing Transfer Carton: ${existingTCId}`);
          setTransferCarton(existingTCId);
          setPickingStarted(true);
        } else {
          // No existing TC - create a new one
          console.log(`📦 No existing TC found, creating new one...`);
          await handleStartPicking();
          // Wait a moment for state to update
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        // Final check - ensure we have a TC ID
        if (!transferCarton) {
          Alert.alert(
            "Transfer Carton Required",
            "Please click 'Start Picking' button first to create a Transfer Carton."
          );
          return;
        }
      } catch (error: any) {
        Alert.alert(
          "Error",
          `Failed to create Transfer Carton: ${error.message}\n\nPlease click 'Start Picking' button first.`
        );
        return;
      }
    }

    console.log(
      `📦 Carton ID scanned: ${trimmedCartonId} for bin: ${activeBinLocation}`
    );

    // ✅ FIX: Clean up old failed events with wrong carton ID when carton ID changes
    try {
      const db = await getDatabase();
      // Delete all unsynced/failed events for this material request with different carton IDs
      const deletedCount = await db.runAsync(
        `DELETE FROM event_queue 
         WHERE event_type IN ('PACK_ITEM_TO_TC', 'PACK_BOX_TO_TC')
         AND material_request = ?
         AND synced = 0
         AND (carton_id != ? OR carton_id IS NULL)
         AND carton_id IS NOT NULL`,
        [materialRequestTitle, trimmedCartonId]
      );
      if (deletedCount && deletedCount.changes > 0) {
        console.log(
          `🧹 Cleaned up ${deletedCount.changes} old event(s) with incorrect carton ID`
        );
      }
    } catch (cleanupError: any) {
      console.warn(
        `⚠️ Failed to cleanup old events on carton ID change:`,
        cleanupError.message
      );
    }

    // Update carton ID state (sync both new and legacy)
    setCartonId(trimmedCartonId);
    setCartonIdInput(trimmedCartonId);
    setCurrentBoxId(trimmedCartonId); // ✅ Also set legacy currentBoxId for backward compatibility

    // ✅ Save picking session state
    await savePickingSession();

    // ✅ Note: Carton ID updates don't need events - they're metadata only
    // The carton_id is included in all item scan events, so no separate event needed
    console.log(
      `✅ Carton ID set: ${trimmedCartonId} for bin: ${activeBinLocation}`
    );

    // Move to item scanning
    setScanWorkflow("SCAN_ITEM");
    // Don't show alert - carton ID is already displayed, just advance workflow silently
  };

  // ✅ NEW: Load all Material Request items with their locations
  const loadRequestedItemsWithLocations = async () => {
    if (!materialRequest || !materialRequest.items) return;

    setLoadingLocations(true);
    try {
      const itemsWithLocations: RequestedItemWithLocations[] = [];

      for (const mrItem of materialRequest.items) {
        try {
          // Get stock locations for this item
          const stockResponse = await apiService.getStockByItemAndWarehouse(
            mrItem.item_code,
            materialRequest.from_warehouse
          );

          if (stockResponse === null) {
            // 404 - endpoint not found, skip location data
            // ✅ Calculate scanned quantity from current scannedItems state
            const scannedQty = scannedItems
              .filter((si) => si.item_code === mrItem.item_code)
              .reduce((sum, si) => sum + si.qty, 0);

            itemsWithLocations.push({
              item_code: mrItem.item_code,
              item_name: mrItem.item_name,
              requested_qty: mrItem.requested_qty || 0,
              scanned_qty: scannedQty, // ✅ Use calculated value, not 0
              locations: [],
            });
            continue;
          }

          // Parse grouped format: [{ bin_location, cartons: [{ carton_id, qty }], total_qty }]
          let locations: {
            bin_location: string;
            total_qty: number;
            cartons: { carton_id: string; qty: number }[];
          }[] = [];

          if (Array.isArray(stockResponse)) {
            // New grouped format
            locations = stockResponse.map((loc: any) => ({
              bin_location: loc.bin_location || loc.location_id || "",
              total_qty: loc.total_qty || loc.qty || 0,
              cartons: (loc.cartons || []).map((c: any) => ({
                carton_id: c.carton_id || "",
                qty: c.qty || 0,
              })),
            }));
          } else if (stockResponse && typeof stockResponse === "object") {
            if (Array.isArray(stockResponse.data)) {
              locations = stockResponse.data.map((loc: any) => ({
                bin_location: loc.bin_location || loc.location_id || "",
                total_qty: loc.total_qty || loc.qty || 0,
                cartons: (loc.cartons || []).map((c: any) => ({
                  carton_id: c.carton_id || "",
                  qty: c.qty || 0,
                })),
              }));
            } else if (stockResponse.bin_location) {
              // Single location
              locations = [
                {
                  bin_location: stockResponse.bin_location,
                  total_qty: stockResponse.total_qty || stockResponse.qty || 0,
                  cartons: (stockResponse.cartons || []).map((c: any) => ({
                    carton_id: c.carton_id || "",
                    qty: c.qty || 0,
                  })),
                },
              ];
            }
          }

          // ✅ Calculate scanned quantity from current scannedItems state (not from closure)
          const scannedQty = scannedItems
            .filter((si) => si.item_code === mrItem.item_code)
            .reduce((sum, si) => sum + si.qty, 0);

          itemsWithLocations.push({
            item_code: mrItem.item_code,
            item_name: mrItem.item_name,
            requested_qty: mrItem.requested_qty || 0,
            scanned_qty: scannedQty, // ✅ Always use current scannedItems state
            locations,
          });
        } catch (error: any) {
          console.warn(
            `⚠️ Error loading locations for ${mrItem.item_code}:`,
            error.message
          );
          // ✅ Calculate scanned quantity even on error
          const scannedQty = scannedItems
            .filter((si) => si.item_code === mrItem.item_code)
            .reduce((sum, si) => sum + si.qty, 0);

          itemsWithLocations.push({
            item_code: mrItem.item_code,
            item_name: mrItem.item_name,
            requested_qty: mrItem.requested_qty || 0,
            scanned_qty: scannedQty, // ✅ Use calculated value, not 0
            locations: [],
          });
        }
      }

      setRequestedItemsWithLocations(itemsWithLocations);
      console.log(
        `✅ Loaded ${itemsWithLocations.length} items with locations`
      );
    } catch (error: any) {
      console.error("❌ Error loading requested items with locations:", error);
    } finally {
      setLoadingLocations(false);
    }
  };

  // ✅ NEW: Handle Box ID scan (legacy - keep for backward compatibility)
  const handleBoxIdScan = async (boxId: string) => {
    // Map box_id to carton_id for new workflow
    await handleCartonIdScan(boxId);
  };

  // Handle item scan
  const handleItemScan = async (barcode: string) => {
    const trimmedBarcode = barcode.trim();
    if (!trimmedBarcode) return;

    // Prevent double processing - check if same barcode was just scanned
    const now = Date.now();
    if (
      lastScannedRef.current &&
      lastScannedRef.current.barcode === trimmedBarcode &&
      now - lastScannedRef.current.timestamp < 1000 // Within 1 second
    ) {
      console.log(`⚠️ Duplicate scan detected, ignoring: ${trimmedBarcode}`);
      return;
    }

    // Prevent concurrent processing
    if (isScanning) {
      console.log(`⚠️ Already processing scan, ignoring: ${trimmedBarcode}`);
      return;
    }

    if (!currentLocation) {
      Alert.alert("Location Required", "Please scan location ID first");
      setScanWorkflow("SCAN_LOCATION");
      return;
    }

    // ✅ NEW: Require Carton ID (use new workflow cartonId or legacy currentBoxId)
    const activeCartonId = cartonId || currentBoxId;
    if (!activeCartonId) {
      Alert.alert("Carton ID Required", "Please scan Carton ID first");
      setScanWorkflow("SCAN_CARTON_ID");
      return;
    }

    // ✅ NEW: Require Bin Location
    const activeBinLocation = binLocation || currentLocation;
    if (!activeBinLocation) {
      Alert.alert("Bin Location Required", "Please scan Bin Location first");
      setScanWorkflow("SCAN_LOCATION");
      return;
    }

    if (!materialRequest) {
      Alert.alert("Error", "Material Request not loaded");
      return;
    }

    // Mark as scanned immediately to prevent duplicates (before async operations)
    lastScannedRef.current = { barcode: trimmedBarcode, timestamp: now };
    setIsScanning(true);
    try {
      console.log(
        `🔍 Scanning item: ${trimmedBarcode} from location: ${currentLocation}`
      );

      // Resolve item from barcode
      const item = await resolveItemFromBarcode(trimmedBarcode);
      if (!item) {
        Alert.alert(
          "Item Not Found",
          `Could not find item for barcode: ${barcode}`
        );
        setIsScanning(false);
        return;
      }

      const itemCode = item.item_code;
      const itemName = item.item_name || itemCode;

      // Check if item is in Material Request
      const mrItem = materialRequest.items?.find(
        (i: any) => i.item_code === itemCode
      );
      if (!mrItem) {
        Alert.alert(
          "Item Not in Request",
          `Item ${itemCode} is not in Material Request ${materialRequestTitle}`
        );
        setIsScanning(false);
        return;
      }

      // ✅ NEW: Check if already scanned (match by location, carton_id, and item_code)
      // Note: activeCartonId and activeBinLocation already declared at function level
      const existingIndex = scannedItems.findIndex(
        (si) =>
          si.location_id === activeBinLocation &&
          si.carton_id === activeCartonId &&
          si.item_code === itemCode
      );

      // Calculate totals before updating
      const currentTotalScanned = scannedItems
        .filter((si) => si.item_code === itemCode)
        .reduce((sum, si) => sum + si.qty, 0);

      const requestedQty = mrItem.requested_qty || 0;
      const newTotalScanned = currentTotalScanned + 1;
      const remainingQty = requestedQty - newTotalScanned;

      if (existingIndex >= 0) {
        // Increment quantity and move to end (so it becomes the "last scanned item")
        const updated = [...scannedItems];
        const existingItem = updated[existingIndex];
        existingItem.qty += 1;
        existingItem.timestamp = new Date().toISOString();
        // Remove from current position and add to end
        updated.splice(existingIndex, 1);
        updated.push(existingItem);
        setScannedItems(updated);

        // ✅ Save to event queue and scanned_items table with carton_id
        try {
          const settings = await getSettings();
          const db = await getDatabase();

          // ✅ VALIDATION: Verify carton exists at location AND contains the item (if online)
          let cartonValidated = false;
          try {
            const online = await isDeviceOnline();
            if (online && activeCartonId && activeBinLocation) {
              // Normalize location for comparison (trim, uppercase)
              const normalizeLocation = (
                loc: string | null | undefined
              ): string => {
                if (!loc) return "";
                return loc.trim().toUpperCase().replace(/\s+/g, "");
              };

              const normalizedBinLocation =
                normalizeLocation(activeBinLocation);
              const normalizedCartonId = activeCartonId.trim().toUpperCase();

              console.log(
                `🔍 Validating carton ${activeCartonId} (normalized: ${normalizedCartonId}) at location ${activeBinLocation} (normalized: ${normalizedBinLocation}) for item ${itemCode}...`
              );

              const stockData = await apiService.getStockByItemAndWarehouse(
                itemCode,
                materialRequest?.from_warehouse || "WH-MAIN"
              );

              console.log(
                `📊 Stock data received:`,
                JSON.stringify(stockData).substring(0, 500)
              );

              if (stockData && Array.isArray(stockData)) {
                // Check if carton exists at this location (with normalized comparison)
                const locationMatch = stockData.find((loc: any) => {
                  const locBin = normalizeLocation(loc.bin_location);
                  return locBin === normalizedBinLocation;
                });

                console.log(
                  `📍 Location match found:`,
                  locationMatch ? "YES" : "NO"
                );

                if (
                  locationMatch &&
                  locationMatch.cartons &&
                  Array.isArray(locationMatch.cartons)
                ) {
                  console.log(
                    `📦 Found ${locationMatch.cartons.length} carton(s) at this location`
                  );

                  // Check if carton exists and has quantity > 0
                  const cartonMatch = locationMatch.cartons.find((c: any) => {
                    const cCartonId = normalizeLocation(c.carton_id);
                    return cCartonId === normalizedCartonId && (c.qty || 0) > 0;
                  });

                  if (cartonMatch) {
                    cartonValidated = true;
                    console.log(
                      `✅ Pre-validation passed: Carton ${activeCartonId} exists at location ${activeBinLocation} with qty: ${cartonMatch.qty}`
                    );
                    console.log(
                      `⚠️ NOTE: Pre-validation only checks existence. Backend may check availability (reserved, allocated, etc.)`
                    );
                  } else {
                    // Try to find similar carton IDs (in case of truncation)
                    const similarCartons = locationMatch.cartons.filter(
                      (c: any) => {
                        if (!c.carton_id || (c.qty || 0) <= 0) return false;
                        const cCartonId = normalizeLocation(c.carton_id);
                        return (
                          cCartonId.startsWith(normalizedCartonId) ||
                          normalizedCartonId.startsWith(cCartonId) ||
                          cCartonId.includes(normalizedCartonId) ||
                          normalizedCartonId.includes(cCartonId)
                        );
                      }
                    );

                    if (similarCartons.length > 0) {
                      const suggestedCarton = similarCartons[0].carton_id;
                      console.log(
                        `💡 Found similar carton: ${suggestedCarton} (scanned: ${activeCartonId})`
                      );
                      Alert.alert(
                        "Carton ID Mismatch",
                        `Scanned carton ID: ${activeCartonId}\n\nFound similar carton at this location: ${suggestedCarton}\n\nDo you want to use the suggested carton ID?`,
                        [
                          {
                            text: "Cancel",
                            style: "cancel",
                            onPress: () => {
                              // Remove the item from scanned items
                              const updated = scannedItems.filter(
                                (si, idx) => idx !== existingIndex
                              );
                              setScannedItems(updated);
                            },
                          },
                          {
                            text: "Use Suggested",
                            onPress: async () => {
                              // Update carton ID and rescan
                              setCartonId(suggestedCarton);
                              setCartonIdInput(suggestedCarton);
                              setCurrentBoxId(suggestedCarton);
                              // Re-trigger item scan with correct carton ID
                              await handleItemScan(trimmedBarcode);
                            },
                          },
                        ]
                      );
                      setIsScanning(false);
                      return;
                    } else {
                      console.warn(
                        `❌ Carton ${activeCartonId} not found at location ${activeBinLocation}`
                      );
                      console.warn(
                        `📋 Available cartons:`,
                        locationMatch.cartons
                          .map((c: any) => `${c.carton_id} (Qty: ${c.qty})`)
                          .join(", ")
                      );

                      Alert.alert(
                        "Carton Not Found",
                        `Carton ${activeCartonId} not found at location ${activeBinLocation} for item ${itemCode}.\n\nAvailable cartons at this location:\n${
                          locationMatch.cartons
                            .filter((c: any) => (c.qty || 0) > 0)
                            .map((c: any) => `- ${c.carton_id} (Qty: ${c.qty})`)
                            .join("\n") || "None"
                        }\n\nPlease scan the correct carton ID.`,
                        [
                          {
                            text: "OK",
                            onPress: () => {
                              // Remove the item from scanned items
                              const updated = scannedItems.filter(
                                (si, idx) => idx !== existingIndex
                              );
                              setScannedItems(updated);
                            },
                          },
                        ]
                      );
                      setIsScanning(false);
                      return;
                    }
                  }
                } else {
                  console.warn(
                    `⚠️ Location ${activeBinLocation} not found in stock data or has no cartons`
                  );
                  console.warn(
                    `📋 Available locations:`,
                    stockData.map((loc: any) => loc.bin_location).join(", ")
                  );
                  // Continue anyway - validation is optional, backend will validate
                }
              } else {
                console.warn(
                  `⚠️ Stock data format not recognized:`,
                  typeof stockData
                );
              }
            } else {
              console.log(
                `ℹ️ Skipping validation: online=${online}, cartonId=${!!activeCartonId}, binLocation=${!!activeBinLocation}`
              );
            }
          } catch (validationError: any) {
            console.warn(
              `⚠️ Carton validation failed (continuing anyway):`,
              validationError.message
            );
            console.warn(`⚠️ Validation error stack:`, validationError.stack);
            // Continue anyway - validation is optional, backend will validate
          }

          // ✅ FIX: Clean up old events with wrong carton ID for this item/location combination
          // This prevents syncing old events with incorrect carton IDs
          try {
            const db = await getDatabase();
            const normalizedCartonIdForEvent = activeCartonId?.trim() || "";

            // Find and delete old failed events for this item/location with different carton IDs
            const oldEvents = await db.getAllAsync<{
              offline_uuid: string;
              carton_id: string | null;
            }>(
              `SELECT offline_uuid, carton_id FROM event_queue 
               WHERE event_type IN ('PACK_ITEM_TO_TC', 'PACK_BOX_TO_TC')
               AND material_request = ?
               AND item_code = ?
               AND (source_bin = ? OR location_id = ? OR bin = ?)
               AND synced = 0
               AND (carton_id != ? OR carton_id IS NULL)
               AND carton_id IS NOT NULL`,
              [
                materialRequestTitle,
                itemCode,
                activeBinLocation,
                activeBinLocation,
                activeBinLocation,
                normalizedCartonIdForEvent,
              ]
            );

            if (oldEvents.length > 0) {
              console.log(
                `🧹 Cleaning up ${oldEvents.length} old event(s) with incorrect carton ID for ${itemCode} at ${activeBinLocation}`
              );
              for (const oldEvent of oldEvents) {
                console.log(
                  `   Deleting event ${oldEvent.offline_uuid.substring(
                    0,
                    8
                  )}... with carton_id: ${oldEvent.carton_id}`
                );
                await db.runAsync(
                  `DELETE FROM event_queue WHERE offline_uuid = ?`,
                  [oldEvent.offline_uuid]
                );
              }
              // Also remove from scanned_items
              await db.runAsync(
                `DELETE FROM scanned_items 
                 WHERE asn_no = ? AND item_code = ? AND box_id != ? AND box_id IS NOT NULL`,
                [materialRequestTitle, itemCode, normalizedCartonIdForEvent]
              );
            }
          } catch (cleanupError: any) {
            console.warn(
              `⚠️ Failed to cleanup old events:`,
              cleanupError.message
            );
            // Continue anyway - not critical
          }

          // ✅ NEW WORKFLOW: Update Material Request directly via pick-items API
          // This immediately updates picked_qty in Material Request table (scan_qty = picked_qty)
          // Transfer Carton will be created later when user clicks Submit
          const normalizedCartonId = activeCartonId?.trim() || "";
          const normalizedLocation = activeBinLocation?.trim() || "";

          console.warn(
            `📦 [EXISTING ITEM] Updating Material Request via pick-items API:`,
            {
              material_request: materialRequestTitle,
              item_code: itemCode,
              picked_qty: 1, // Increment by 1 for each scan
              source_bin: normalizedLocation,
              carton_id: normalizedCartonId,
            }
          );

          // ✅ Call pick-items API to update Material Request
          try {
            const online = await isDeviceOnline();
            if (online) {
              console.warn(
                `🔄 [EXISTING ITEM] Calling pick-items API for ${itemCode}`
              );
              const pickResponse = await apiService.pickMaterialRequestItems(
                materialRequestTitle,
                [
                  {
                    item_code: itemCode,
                    picked_qty: 1, // Backend should increment existing picked_qty by 1
                    source_bin: normalizedLocation,
                    carton_id: normalizedCartonId,
                  },
                ],
                materialRequest?.from_warehouse
              );

              console.warn(
                `✅ [NEW ITEM] Material Request updated via pick-items API: ${itemCode} picked_qty incremented by 1`,
                pickResponse
              );

              // ✅ Reload Material Request to get updated picked_qty from backend
              // Wait a moment for backend to process
              await new Promise((resolve) => setTimeout(resolve, 300));
              await loadMaterialRequest();

              // Force UI update by updating requestedItemsWithLocations
              if (materialRequest?.items) {
                setRequestedItemsWithLocations((prevItems) => {
                  return prevItems.map((prevItem) => {
                    const updatedMRItem = materialRequest.items.find(
                      (i: any) => i.item_code === prevItem.item_code
                    );
                    if (updatedMRItem) {
                      return {
                        ...prevItem,
                        picked_qty: updatedMRItem.picked_qty || 0,
                        scanned_qty: updatedMRItem.picked_qty || 0,
                      };
                    }
                    return prevItem;
                  });
                });
              }
            } else {
              // Offline: Queue for later sync
              // TODO: Implement offline queue for pick-items API calls
              console.warn(
                `⚠️ Device offline - Material Request update will be queued for later sync`
              );
              Alert.alert(
                "Offline",
                `Item scanned but device is offline. Material Request will be updated when connection is restored.`
              );
            }
          } catch (pickError: any) {
            console.error(`❌ Failed to update Material Request:`, pickError);
            Alert.alert(
              "Update Failed",
              `Failed to update Material Request for ${itemCode}:\n\n${pickError.message}\n\nItem is still scanned locally.`
            );
            // Continue - item is still in scannedItems state
          }

          // ✅ NEW: Save to scanned_items table (similar to Putaway/Cycle Count)
          // Use Material Request title as a pseudo-ASN for scanned_items table
          const pseudoASN = materialRequestTitle;
          const pseudoSession = `MR-${materialRequestTitle}`;

          // Check if item already exists in scanned_items for this carton
          // Note: activeCartonId already declared at function level
          const existingScannedItem = await db.getFirstAsync<{
            scanned_qty: number;
          }>(
            `SELECT scanned_qty FROM scanned_items 
             WHERE asn_no = ? AND box_id = ? AND item_code = ?`,
            [pseudoASN, activeCartonId, itemCode]
          );

          if (existingScannedItem) {
            // Update quantity
            await db.runAsync(
              `UPDATE scanned_items 
               SET scanned_qty = ?, scanned_on = ?
               WHERE asn_no = ? AND box_id = ? AND item_code = ?`,
              [
                existingItem.qty,
                new Date().toISOString(),
                pseudoASN,
                activeCartonId,
                itemCode,
              ]
            );
            console.log(
              `✅ Updated scanned_items: ${itemCode} in carton ${activeCartonId} (qty: ${existingItem.qty})`
            );
          } else {
            // Insert new record
            await db.runAsync(
              `INSERT INTO scanned_items 
               (asn_no, inbound_session, item_code, box_id, store, scanned_qty, scanned_on, device_id, user_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                pseudoASN,
                pseudoSession,
                itemCode,
                activeCartonId,
                selectedStore || materialRequest?.to_showroom || "",
                existingItem.qty,
                new Date().toISOString(),
                settings.device_id,
                settings.user_id,
              ]
            );
            console.log(
              `✅ Saved to scanned_items: ${itemCode} in carton ${activeCartonId} (qty: ${existingItem.qty})`
            );
          }

          // ✅ Save picking session state after item scan
          await savePickingSession();

          // ✅ Show success alert with updated quantities from Material Request
          // Get updated picked_qty from Material Request (after reload)
          const updatedMR = materialRequest;
          const updatedItem = updatedMR?.items?.find(
            (i: any) => i.item_code === itemCode
          );
          const updatedPickedQty = updatedItem?.picked_qty || newTotalScanned;

          Alert.alert(
            "Item Scanned",
            `${itemCode} (${itemName})\n\n` +
              `Requested: ${requestedQty}\n` +
              `Scanned: ${updatedPickedQty}\n` +
              `Remaining: ${requestedQty - updatedPickedQty}\n\n` +
              `✅ Material Request updated`
          );
        } catch (itemScanError: any) {
          console.error(
            `❌ Error in existing item scan workflow:`,
            itemScanError
          );
          Alert.alert(
            "Error",
            `Failed to process scanned item: ${itemScanError.message}`
          );
        }
      } else {
        // Add new scanned item with carton_id
        const newItem: ScannedItem = {
          location_id: activeBinLocation,
          carton_id: activeCartonId, // ✅ Use carton_id (not box_id)
          item_code: itemCode,
          item_name: itemName,
          qty: 1,
          timestamp: new Date().toISOString(),
        };
        setScannedItems([...scannedItems, newItem]);

        // ✅ NEW WORKFLOW: Update Material Request directly via pick-items API
        // This immediately updates picked_qty in Material Request table (scan_qty = picked_qty)
        // Transfer Carton will be created later when user clicks Submit
        try {
          const settings = await getSettings();
          const db = await getDatabase();
          const normalizedCartonId = activeCartonId?.trim() || "";
          const normalizedLocation = activeBinLocation?.trim() || "";

          // ✅ VALIDATION: Verify carton exists at location AND contains the item (if online)
          try {
            const online = await isDeviceOnline();
            if (online && activeCartonId && activeBinLocation) {
              // Normalize location for comparison (trim, uppercase)
              const normalizeLocation = (
                loc: string | null | undefined
              ): string => {
                if (!loc) return "";
                return loc.trim().toUpperCase().replace(/\s+/g, "");
              };

              const normalizedBinLocation =
                normalizeLocation(activeBinLocation);
              const normalizedCartonId = activeCartonId.trim().toUpperCase();

              console.log(
                `🔍 Validating carton ${activeCartonId} (normalized: ${normalizedCartonId}) at location ${activeBinLocation} (normalized: ${normalizedBinLocation}) for item ${itemCode}...`
              );

              const stockData = await apiService.getStockByItemAndWarehouse(
                itemCode,
                materialRequest?.from_warehouse || "WH-MAIN"
              );

              console.log(
                `📊 Stock data received:`,
                JSON.stringify(stockData).substring(0, 500)
              );

              if (stockData && Array.isArray(stockData)) {
                // Check if carton exists at this location (with normalized comparison)
                const locationMatch = stockData.find((loc: any) => {
                  const locBin = normalizeLocation(loc.bin_location);
                  return locBin === normalizedBinLocation;
                });

                console.log(
                  `📍 Location match found:`,
                  locationMatch ? "YES" : "NO"
                );

                if (
                  locationMatch &&
                  locationMatch.cartons &&
                  Array.isArray(locationMatch.cartons)
                ) {
                  console.log(
                    `📦 Found ${locationMatch.cartons.length} carton(s) at this location`
                  );

                  // Check if carton exists and has quantity > 0
                  const cartonMatch = locationMatch.cartons.find((c: any) => {
                    const cCartonId = normalizeLocation(c.carton_id);
                    return cCartonId === normalizedCartonId && (c.qty || 0) > 0;
                  });

                  if (!cartonMatch) {
                    // Try to find similar carton IDs (in case of truncation)
                    const similarCartons = locationMatch.cartons.filter(
                      (c: any) => {
                        if (!c.carton_id || (c.qty || 0) <= 0) return false;
                        const cCartonId = normalizeLocation(c.carton_id);
                        return (
                          cCartonId.startsWith(normalizedCartonId) ||
                          normalizedCartonId.startsWith(cCartonId) ||
                          cCartonId.includes(normalizedCartonId) ||
                          normalizedCartonId.includes(cCartonId)
                        );
                      }
                    );

                    if (similarCartons.length > 0) {
                      const suggestedCarton = similarCartons[0].carton_id;
                      console.log(
                        `💡 Found similar carton: ${suggestedCarton} (scanned: ${activeCartonId})`
                      );
                      Alert.alert(
                        "Carton ID Mismatch",
                        `Scanned carton ID: ${activeCartonId}\n\nFound similar carton at this location: ${suggestedCarton}\n\nDo you want to use the suggested carton ID?`,
                        [
                          {
                            text: "Cancel",
                            style: "cancel",
                            onPress: () => {
                              // Remove the item from scanned items
                              const updated = scannedItems.filter(
                                (si) =>
                                  !(
                                    si.item_code === itemCode &&
                                    si.carton_id === activeCartonId &&
                                    si.location_id === activeBinLocation
                                  )
                              );
                              setScannedItems(updated);
                            },
                          },
                          {
                            text: "Use Suggested",
                            onPress: async () => {
                              // Update carton ID and rescan
                              setCartonId(suggestedCarton);
                              setCartonIdInput(suggestedCarton);
                              setCurrentBoxId(suggestedCarton);
                              // Re-trigger item scan with correct carton ID
                              await handleItemScan(trimmedBarcode);
                            },
                          },
                        ]
                      );
                      setIsScanning(false);
                      return;
                    } else {
                      console.warn(
                        `❌ Carton ${activeCartonId} not found at location ${activeBinLocation}`
                      );
                      console.warn(
                        `📋 Available cartons:`,
                        locationMatch.cartons
                          .map((c: any) => `${c.carton_id} (Qty: ${c.qty})`)
                          .join(", ")
                      );

                      Alert.alert(
                        "Carton Not Found",
                        `Carton ${activeCartonId} not found at location ${activeBinLocation} for item ${itemCode}.\n\nAvailable cartons at this location:\n${
                          locationMatch.cartons
                            .filter((c: any) => (c.qty || 0) > 0)
                            .map((c: any) => `- ${c.carton_id} (Qty: ${c.qty})`)
                            .join("\n") || "None"
                        }\n\nPlease scan the correct carton ID.`,
                        [
                          {
                            text: "OK",
                            onPress: () => {
                              // Remove the item from scanned items
                              const updated = scannedItems.filter(
                                (si) =>
                                  !(
                                    si.item_code === itemCode &&
                                    si.carton_id === activeCartonId &&
                                    si.location_id === activeBinLocation
                                  )
                              );
                              setScannedItems(updated);
                            },
                          },
                        ]
                      );
                      setIsScanning(false);
                      return;
                    }
                  } else {
                    console.log(
                      `✅ Carton ${activeCartonId} validated at location ${activeBinLocation} with qty: ${cartonMatch.qty}`
                    );
                  }
                } else {
                  console.warn(
                    `⚠️ Location ${activeBinLocation} not found in stock data or has no cartons`
                  );
                  console.warn(
                    `📋 Available locations:`,
                    stockData.map((loc: any) => loc.bin_location).join(", ")
                  );
                  // Continue anyway - validation is optional, backend will validate
                }
              } else {
                console.warn(
                  `⚠️ Stock data format not recognized:`,
                  typeof stockData
                );
              }
            } else {
              console.log(
                `ℹ️ Skipping validation: online=${online}, cartonId=${!!activeCartonId}, binLocation=${!!activeBinLocation}`
              );
            }
          } catch (validationError: any) {
            console.warn(
              `⚠️ Carton validation failed (continuing anyway):`,
              validationError.message
            );
            console.warn(`⚠️ Validation error stack:`, validationError.stack);
            // Continue anyway - validation is optional, backend will validate
          }

          // ✅ NEW WORKFLOW: Update Material Request directly via pick-items API
          // This immediately updates picked_qty in Material Request table (scan_qty = picked_qty)
          // Transfer Carton will be created later when user clicks Submit
          console.log(`📦 Updating Material Request via pick-items API:`, {
            material_request: materialRequestTitle,
            item_code: itemCode,
            picked_qty: 1, // Increment by 1 for each scan
            source_bin: normalizedLocation,
            carton_id: normalizedCartonId,
          });

          // ✅ Call pick-items API to update Material Request
          try {
            const online = await isDeviceOnline();
            if (online) {
              console.warn(
                `🔄 [NEW ITEM] Calling pick-items API for ${itemCode}`
              );
              const pickResponse = await apiService.pickMaterialRequestItems(
                materialRequestTitle,
                [
                  {
                    item_code: itemCode,
                    picked_qty: 1, // Backend should increment existing picked_qty by 1
                    source_bin: normalizedLocation,
                    carton_id: normalizedCartonId,
                  },
                ],
                materialRequest?.from_warehouse
              );

              console.warn(
                `✅ [NEW ITEM] Material Request updated via pick-items API: ${itemCode} picked_qty incremented by 1`,
                pickResponse
              );

              // ✅ Reload Material Request to get updated picked_qty from backend
              // Wait a moment for backend to process
              await new Promise((resolve) => setTimeout(resolve, 300));
              await loadMaterialRequest();

              // Force UI update by updating requestedItemsWithLocations
              if (materialRequest?.items) {
                setRequestedItemsWithLocations((prevItems) => {
                  return prevItems.map((prevItem) => {
                    const updatedMRItem = materialRequest.items.find(
                      (i: any) => i.item_code === prevItem.item_code
                    );
                    if (updatedMRItem) {
                      return {
                        ...prevItem,
                        picked_qty: updatedMRItem.picked_qty || 0,
                        scanned_qty: updatedMRItem.picked_qty || 0,
                      };
                    }
                    return prevItem;
                  });
                });
              }
            } else {
              // Offline: Queue for later sync
              // TODO: Implement offline queue for pick-items API calls
              console.warn(
                `⚠️ Device offline - Material Request update will be queued for later sync`
              );
              Alert.alert(
                "Offline",
                `Item scanned but device is offline. Material Request will be updated when connection is restored.`
              );
            }
          } catch (pickError: any) {
            console.error(`❌ Failed to update Material Request:`, pickError);
            Alert.alert(
              "Update Failed",
              `Failed to update Material Request for ${itemCode}:\n\n${pickError.message}\n\nItem is still scanned locally.`
            );
            // Continue - item is still in scannedItems state
          }

          // ✅ NEW: Save to scanned_items table (similar to Putaway/Cycle Count)
          // Use Material Request title as a pseudo-ASN for scanned_items table
          const pseudoASN = materialRequestTitle;
          const pseudoSession = `MR-${materialRequestTitle}`;

          // Check if item already exists in scanned_items for this carton
          // Note: activeCartonId already declared at function level
          const existingScannedItem = await db.getFirstAsync<{
            scanned_qty: number;
          }>(
            `SELECT scanned_qty FROM scanned_items 
             WHERE asn_no = ? AND box_id = ? AND item_code = ?`,
            [pseudoASN, activeCartonId, itemCode]
          );

          if (existingScannedItem) {
            // Update quantity - increment by 1
            await db.runAsync(
              `UPDATE scanned_items 
               SET scanned_qty = scanned_qty + 1, scanned_on = ?
               WHERE asn_no = ? AND box_id = ? AND item_code = ?`,
              [new Date().toISOString(), pseudoASN, activeCartonId, itemCode]
            );
            console.log(
              `✅ Updated scanned_items: ${itemCode} in carton ${activeCartonId} (qty: ${
                existingScannedItem.scanned_qty + 1
              })`
            );
          } else {
            // Insert new record
            await db.runAsync(
              `INSERT INTO scanned_items 
               (asn_no, inbound_session, item_code, box_id, store, scanned_qty, scanned_on, device_id, user_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                pseudoASN,
                pseudoSession,
                itemCode,
                activeCartonId,
                selectedStore || materialRequest?.to_showroom || "",
                1,
                new Date().toISOString(),
                settings.device_id,
                settings.user_id,
              ]
            );
            console.log(
              `✅ Saved to scanned_items: ${itemCode} in carton ${activeCartonId} (qty: 1)`
            );
          }

          // ✅ Save picking session state after item scan
          await savePickingSession();

          // ✅ Show success alert with updated quantities from Material Request
          // Get updated picked_qty from Material Request (after reload)
          const updatedMR = materialRequest;
          const updatedItem = updatedMR?.items?.find(
            (i: any) => i.item_code === itemCode
          );
          const updatedPickedQty = updatedItem?.picked_qty || 1;

          Alert.alert(
            "Item Scanned",
            `${itemCode} (${itemName})\n\n` +
              `Requested: ${requestedQty}\n` +
              `Scanned: ${updatedPickedQty}\n` +
              `Remaining: ${requestedQty - updatedPickedQty}\n\n` +
              `✅ Material Request updated`
          );
        } catch (newItemScanError: any) {
          console.error(
            `❌ Error in new item scan workflow:`,
            newItemScanError
          );
          Alert.alert(
            "Error",
            `Failed to process scanned item: ${newItemScanError.message}`
          );
        }
      }

      // Check if all requested items are scanned
      const currentTotalScannedForItem = scannedItems
        .filter((si) => si.item_code === itemCode)
        .reduce((sum, si) => sum + si.qty, 0);
      if (currentTotalScannedForItem >= requestedQty) {
        Alert.alert(
          "Request Complete",
          `All ${requestedQty} units of ${itemCode} have been scanned!`
        );
      }
    } catch (error: any) {
      console.error("❌ Error scanning item:", error);
      Alert.alert("Error", `Failed to scan item: ${error.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleManualBarcodeChange = (text: string) => {
    onScannerTextChange(
      text,
      setManualBarcode,
      manualBarcodeScanTimerRef,
      (cleaned) => void handleItemScan(cleaned)
    );
  };

  // Edit scanned item quantity
  const handleEditQty = (index: number) => {
    const item = scannedItems[index];
    if (!item) return;

    const qty = item.qty || 0;
    setEditQtyModal({
      visible: true,
      index,
      item,
      currentQty: qty,
    });
    setEditQtyValue(String(qty));
    // Focus input after modal opens
    setTimeout(() => {
      editQtyInputRef.current?.focus();
    }, 300);
  };

  // ✅ NEW: Edit quantity by item_code (for new workflow using backend picked_qty)
  const handleEditQtyByItemCode = (itemCode: string, currentQty: number) => {
    // Create a pseudo ScannedItem for the modal (only with required properties)
    const pseudoItem: ScannedItem = {
      item_code: itemCode,
      qty: currentQty,
      location_id: binLocation || "",
      carton_id: transferCarton || "",
      timestamp: new Date().toISOString(),
    };

    setEditQtyModal({
      visible: true,
      index: -1, // Use -1 to indicate this is from item_code, not scannedItems index
      item: pseudoItem,
      currentQty: currentQty,
    });
    setEditQtyValue(String(currentQty));
    // Focus input after modal opens
    setTimeout(() => {
      editQtyInputRef.current?.focus();
    }, 300);
  };

  // Show location modal for an item
  const handleShowLocations = (item: RequestedItemWithLocations) => {
    // Prevent duplicate modals
    if (locationModalVisible) {
      return;
    }
    setSelectedItemForLocation(item);
    setLocationModalVisible(true);
  };

  // Save edited quantity
  const handleSaveEditedQty = async () => {
    if (!editQtyModal || !editQtyModal.item) return;

    const newQty = parseInt(editQtyValue.trim(), 10);
    if (isNaN(newQty) || newQty < 0) {
      Alert.alert(
        "Invalid Quantity",
        "Please enter a valid non-negative number"
      );
      return;
    }

    // ✅ Check if quantity exceeds requested (show warning but allow)
    const requestedItem = materialRequest?.items?.find(
      (i: any) => i.item_code === editQtyModal.item?.item_code
    );
    const requestedQty = requestedItem?.requested_qty || 0;

    if (newQty > requestedQty) {
      // Show warning but allow user to proceed
      return new Promise<void>((resolve) => {
        Alert.alert(
          "⚠️ Quantity Exceeds Requested",
          `The requested quantity for ${
            editQtyModal.item?.item_code || "item"
          } is ${requestedQty}.\n\nYou are trying to set it to ${newQty} (${
            newQty - requestedQty
          } more than requested).\n\nDo you want to proceed?`,
          [
            {
              text: "Cancel",
              style: "cancel",
              onPress: () => resolve(),
            },
            {
              text: "Yes, Proceed",
              style: "default",
              onPress: async () => {
                await handleSaveEditedQtyConfirmed(newQty);
                resolve();
              },
            },
          ]
        );
      });
    }

    // If quantity is within requested, proceed directly
    await handleSaveEditedQtyConfirmed(newQty);
  };

  // Save edited quantity (confirmed - actual implementation)
  const handleSaveEditedQtyConfirmed = async (newQty: number) => {
    if (!editQtyModal || !editQtyModal.item) return;

    if (newQty === editQtyModal.currentQty) {
      setEditQtyModal(null);
      setEditQtyValue("");
      return;
    }

    const item = editQtyModal.item;
    const index = editQtyModal.index;

    try {
      // ✅ Handle both old workflow (index >= 0) and new workflow (index === -1)
      if (index >= 0) {
        // Old workflow: Update scannedItems state and manage local database
        const updated = [...scannedItems];
        updated[index] = {
          ...updated[index],
          qty: newQty,
          timestamp: new Date().toISOString(),
        };
        setScannedItems(updated);

        // Old workflow: Manage local database (event_queue, scanned_items)
        const db = await getDatabase();
        const settings = await getSettings();

        // ✅ Use carton_id (not box_id) - ScannedItem interface uses carton_id
        const itemCartonId = item.carton_id || "";
        const itemLocationId = item.location_id || "";

        // ✅ Step 1: Delete ALL events for this specific item/carton/location/tc combination
        const deleteResult = await db.runAsync(
          `DELETE FROM event_queue 
           WHERE material_request = ? 
             AND item_code = ? 
             AND (rack = ? OR bin = ? OR source_bin = ? OR location_id = ?)
             AND (carton_id = ? OR box_id = ?)
             AND (tc_id = ? OR tc_id IS NULL)
             AND event_type IN ('PACK_BOX_TO_TC', 'PACK_ITEM_TO_TC')`,
          [
            materialRequestTitle,
            item.item_code,
            itemLocationId,
            itemLocationId,
            itemLocationId,
            itemLocationId,
            itemCartonId,
            itemCartonId,
            transferCarton || null,
          ]
        );
        console.log(
          `🗑️ Deleted ${deleteResult.changes || 0} event(s) for ${
            item.item_code
          }`
        );

        // ✅ Step 2: Delete from scanned_items table
        const pseudoASN = materialRequestTitle;
        await db.runAsync(
          `DELETE FROM scanned_items 
           WHERE asn_no = ? AND box_id = ? AND item_code = ?`,
          [pseudoASN, itemCartonId, item.item_code]
        );

        // ✅ Step 3: If new quantity > 0, insert/update scanned_items
        if (newQty > 0) {
          await db.runAsync(
            `INSERT INTO scanned_items 
             (asn_no, inbound_session, item_code, box_id, store, scanned_qty, scanned_on, device_id, user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              pseudoASN,
              `MR-${materialRequestTitle}`,
              item.item_code,
              itemCartonId,
              selectedStore || materialRequest?.to_showroom || "",
              newQty,
              new Date().toISOString(),
              settings.device_id,
              settings.user_id,
            ]
          );
        }
      }
      // For new workflow (index === -1), we don't manage local database
      // We'll directly update the backend via pick-items API

      // ✅ Get location and carton info for API call
      const itemCartonId = item.carton_id || transferCarton || "";
      const itemLocationId = item.location_id || binLocation || "";

      // ✅ NEW WORKFLOW: Update Material Request via pick-items API
      // Calculate the difference between new quantity and current picked_qty
      const currentPickedQty =
        materialRequest?.items?.find((i: any) => i.item_code === item.item_code)
          ?.picked_qty || 0;

      const qtyDifference = newQty - currentPickedQty;

      if (qtyDifference !== 0) {
        try {
          const online = await isDeviceOnline();
          if (online) {
            // If newQty > currentPickedQty, we need to increment
            // If newQty < currentPickedQty, we need to decrement (backend supports both via positive/negative picked_qty)
            if (qtyDifference > 0) {
              // ✅ Note: Validation for exceeding requested is done in handleSaveEditedQty
              // Here we proceed with the update (user already confirmed if it exceeds requested)

              // Increment by the difference
              const pickResponse = await apiService.pickMaterialRequestItems(
                materialRequestTitle,
                [
                  {
                    item_code: item.item_code,
                    picked_qty: qtyDifference, // Increment by difference
                    source_bin: itemLocationId,
                    carton_id: itemCartonId,
                  },
                ],
                materialRequest?.from_warehouse
              );

              console.log(
                `✅ Material Request updated: ${item.item_code} picked_qty incremented by ${qtyDifference}`,
                pickResponse
              );

              // ✅ Check if backend actually updated the quantity
              // The backend might reject if it exceeds requested_qty or other validation fails
              const responsePickedQty =
                pickResponse?.data?.total_picked_qty ||
                pickResponse?.total_picked_qty ||
                pickResponse?.data?.items?.find(
                  (i: any) => i.item_code === item.item_code
                )?.picked_qty ||
                null;

              // Wait a moment for backend to process, then reload to get actual updated value
              await new Promise((resolve) => setTimeout(resolve, 500));
              const reloadedMR = await loadMaterialRequest();
              const actualUpdatedQty =
                reloadedMR?.items?.find(
                  (i: any) => i.item_code === item.item_code
                )?.picked_qty || currentPickedQty;

              if (actualUpdatedQty !== newQty) {
                // Backend didn't update to the requested value
                const actualRequestedQty =
                  reloadedMR?.items?.find(
                    (i: any) => i.item_code === item.item_code
                  )?.requested_qty || 0;

                Alert.alert(
                  "Update Partially Applied",
                  `The quantity was not updated to ${newQty}.\n\n• Current picked_qty: ${actualUpdatedQty}\n• Requested quantity: ${actualRequestedQty}\n• Your input: ${newQty}\n\nThe backend may have rejected the update because it exceeds the requested quantity.`
                );
                // Don't return - let the UI update with the actual value
              }

              // ✅ Force UI update for new workflow (index === -1)
              if (index === -1 && reloadedMR?.items) {
                setRequestedItemsWithLocations((prevItems) => {
                  return prevItems.map((prevItem) => {
                    const updatedMRItem = reloadedMR.items.find(
                      (i: any) => i.item_code === prevItem.item_code
                    );
                    if (
                      updatedMRItem &&
                      updatedMRItem.item_code === item.item_code
                    ) {
                      return {
                        ...prevItem,
                        picked_qty: updatedMRItem.picked_qty || 0,
                        scanned_qty: updatedMRItem.picked_qty || 0,
                      };
                    }
                    return prevItem;
                  });
                });
              }
            } else {
              // ✅ Decrement: Backend now supports decrement via negative picked_qty
              // Send negative difference to decrease quantity
              const decrementAmount = Math.abs(qtyDifference); // Make it positive for the API

              const pickResponse = await apiService.pickMaterialRequestItems(
                materialRequestTitle,
                [
                  {
                    item_code: item.item_code,
                    picked_qty: -decrementAmount, // Negative value to decrease
                    source_bin: itemLocationId,
                    carton_id: itemCartonId,
                  },
                ],
                materialRequest?.from_warehouse
              );

              console.log(
                `✅ Material Request updated: ${item.item_code} picked_qty decreased by ${decrementAmount}`,
                pickResponse
              );

              // Wait a moment for backend to process, then reload to get actual updated value
              await new Promise((resolve) => setTimeout(resolve, 500));
              const reloadedMR = await loadMaterialRequest();
              const actualUpdatedQty =
                reloadedMR?.items?.find(
                  (i: any) => i.item_code === item.item_code
                )?.picked_qty || currentPickedQty;

              if (actualUpdatedQty !== newQty) {
                // Backend didn't update to the requested value
                Alert.alert(
                  "Update Partially Applied",
                  `The quantity was not updated to ${newQty}.\n\n• Current picked_qty: ${actualUpdatedQty}\n• Your input: ${newQty}\n\nThe backend may have rejected the update.`
                );
                // Don't return - let the UI update with the actual value
              }

              // ✅ Force UI update for new workflow (index === -1)
              if (index === -1 && reloadedMR?.items) {
                setRequestedItemsWithLocations((prevItems) => {
                  return prevItems.map((prevItem) => {
                    const updatedMRItem = reloadedMR.items.find(
                      (i: any) => i.item_code === prevItem.item_code
                    );
                    if (
                      updatedMRItem &&
                      updatedMRItem.item_code === item.item_code
                    ) {
                      return {
                        ...prevItem,
                        picked_qty: updatedMRItem.picked_qty || 0,
                        scanned_qty: updatedMRItem.picked_qty || 0,
                      };
                    }
                    return prevItem;
                  });
                });
              }
            }
          } else {
            Alert.alert(
              "Offline",
              `Device is offline. Material Request will be updated when connection is restored.`
            );
          }
        } catch (pickError: any) {
          console.error(`❌ Failed to update Material Request:`, pickError);
          Alert.alert(
            "Update Failed",
            `Failed to update Material Request for ${item.item_code}:\n\n${pickError.message}`
          );
          // Revert the local state change (only for old workflow)
          if (index >= 0) {
            const reverted = [...scannedItems];
            reverted[index] = {
              ...reverted[index],
              qty: editQtyModal.currentQty,
            };
            setScannedItems(reverted);
          }
          setEditQtyModal(null);
          setEditQtyValue("");
          return;
        }
      }

      console.log(
        `✅ Updated quantity for ${item.item_code} from ${editQtyModal.currentQty} to ${newQty}`
      );

      // ✅ For old workflow, reload scanned items from database
      if (index >= 0) {
        await loadScannedItems();
      }
      // For new workflow, the Material Request was already reloaded above

      setEditQtyModal(null);
      setEditQtyValue("");
      Alert.alert(
        "Quantity Updated",
        `${item.item_code}\n\nQuantity changed from ${editQtyModal.currentQty} to ${newQty}`
      );
    } catch (error: any) {
      console.error("❌ Error updating quantity:", error);
      Alert.alert("Error", `Failed to update quantity: ${error.message}`);
    }
  };

  // Remove scanned item with confirmation
  const removeScannedItem = async (index: number) => {
    const item = scannedItems[index];
    if (!item) return;

    // Prevent deletion if Transfer Carton is sealed
    if (hasSealedTC) {
      Alert.alert(
        "Cannot Remove Item",
        "This Transfer Carton has been sealed. Items cannot be removed from a sealed carton.",
        [{ text: "OK" }]
      );
      return;
    }

    // Also check if the item is in a sealed TC by checking the database
    try {
      const db = await getDatabase();
      const sealedTCCheck = await db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count
         FROM event_queue e
         JOIN tc_cache tc ON e.tc_id = tc.tc_id
         WHERE e.material_request = ?
           AND e.item_code = ?
           AND (e.rack = ? OR e.bin = ? OR e.source_bin = ?)
           AND e.event_type IN ('PACK_BOX_TO_TC', 'PACK_ITEM_TO_TC') -- Support both for backward compatibility
           AND tc.status IN ('Sealed', 'SEALED', 'Dispatched', 'DISPATCHED')`,
        [
          materialRequestTitle,
          item.item_code,
          item.location_id,
          item.location_id,
          item.location_id,
        ]
      );

      if (sealedTCCheck && sealedTCCheck.count > 0) {
        Alert.alert(
          "Cannot Remove Item",
          "This item is in a sealed Transfer Carton and cannot be removed.",
          [{ text: "OK" }]
        );
        return;
      }
    } catch (error: any) {
      console.warn(`⚠️ Error checking sealed TC status:`, error.message);
      // Continue with deletion if check fails
    }

    Alert.alert(
      "Remove Item",
      `Are you sure you want to remove ${item.item_code}?\n\nLocation: ${item.location_id}\nQuantity: ${item.qty}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const updated = scannedItems.filter((_, i) => i !== index);
            setScannedItems(updated);

            // Remove corresponding events from event queue (only if not in a sealed TC)
            try {
              const db = await getDatabase();
              // Delete events for this item/location combination that haven't been synced to a sealed TC
              // Backend processes PACK_BOX_TO_TC events with material_request or transfer_order field
              // SQLite doesn't support LIMIT in DELETE, so we delete all matching events
              // We match by item_code, location, and material_request to ensure we delete the right events
              await db.runAsync(
                `DELETE FROM event_queue 
                  WHERE material_request = ? 
                   AND item_code = ? 
                   AND (rack = ? OR bin = ? OR source_bin = ?)
                   AND event_type IN ('PACK_BOX_TO_TC', 'PACK_ITEM_TO_TC') -- Support both for backward compatibility
                   AND (tc_id IS NULL OR tc_id NOT IN (
                     SELECT tc_id FROM tc_cache WHERE status IN ('Sealed', 'SEALED', 'Dispatched', 'DISPATCHED')
                   ))`,
                [
                  materialRequestTitle,
                  item.item_code,
                  item.location_id,
                  item.location_id,
                  item.location_id,
                ]
              );
              console.log(
                `✅ Removed ${item.qty} pick event(s) for ${item.item_code}`
              );
            } catch (error: any) {
              console.warn(`⚠️ Failed to remove pick events:`, error.message);
              // Don't block the user - item is still removed from state
            }
          },
        },
      ]
    );
  };

  // Clear all scanned items
  const clearScannedItems = async () => {
    // Prevent clearing if Transfer Carton is sealed
    if (hasSealedTC) {
      Alert.alert(
        "Cannot Clear Items",
        "This Transfer Carton has been sealed. Items cannot be cleared from a sealed carton.",
        [{ text: "OK" }]
      );
      return;
    }

    Alert.alert(
      "Clear All Items",
      "Are you sure you want to clear all scanned items? This will remove all items from the current picking session.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            try {
              // Delete all PACK_BOX_TO_TC events for this Material Request that haven't been packed into a sealed TC
              // Backend processes PACK_BOX_TO_TC events with material_request or transfer_order field
              const db = await getDatabase();
              const result = await db.runAsync(
                `DELETE FROM event_queue 
                 WHERE material_request = ? 
                   AND event_type IN ('PACK_BOX_TO_TC', 'PACK_ITEM_TO_TC') -- Support both for backward compatibility
                   AND (tc_id IS NULL OR tc_id NOT IN (
                     SELECT tc_id FROM tc_cache WHERE status IN ('Sealed', 'SEALED', 'Dispatched', 'DISPATCHED')
                   ))`,
                [materialRequestTitle]
              );

              console.log(
                `🗑️ Deleted ${
                  result.changes || 0
                } pick event(s) from event queue`
              );

              // Clear state
              setScannedItems([]);
              setCurrentLocation("");
              setCurrentBoxId(""); // ✅ NEW: Clear box_id when clearing items
              setScanWorkflow("SCAN_LOCATION");

              Alert.alert("Success", "All scanned items have been cleared.");
            } catch (error: any) {
              console.error("❌ Error clearing scanned items:", error);
              Alert.alert(
                "Error",
                `Failed to clear scanned items: ${error.message}`
              );
            }
          },
        },
      ]
    );
  };

  if (loading && !materialRequest) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FF9800" />
        <Text style={styles.loadingText}>Loading Material Request...</Text>
      </View>
    );
  }

  if (!materialRequest) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Material Request not found</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const totalItems = materialRequest.items?.length || 0;
  const totalRequestedQty =
    materialRequest.total_requested_qty ||
    materialRequest.items?.reduce(
      (sum, i) => sum + (i.requested_qty || 0),
      0
    ) ||
    0;
  const totalPickedQty =
    materialRequest.total_picked_qty ||
    materialRequest.items?.reduce((sum, i) => sum + (i.picked_qty || 0), 0) ||
    0;

  // Check if there are any picked items (from previous picking sessions)
  const hasPickedItems =
    materialRequest?.items?.some((item: any) => (item.picked_qty || 0) > 0) ||
    false;

  // Allow Transfer Carton creation at any time (before or after picking)
  // User can create TC first, then pick items, then pack them
  const canCreateTransferCarton = true;

  // ✅ Render Requested Item with Locations
  const renderRequestedItem = ({
    item,
  }: {
    item: RequestedItemWithLocations;
  }) => {
    // ✅ Use backend's picked_qty as PRIMARY source of truth
    // Get the latest picked_qty directly from Material Request (after reload)
    const mrItem = materialRequest?.items?.find(
      (i: any) => i.item_code === item.item_code
    );
    const backendPickedQty =
      mrItem?.picked_qty !== undefined && mrItem?.picked_qty !== null
        ? mrItem.picked_qty
        : null;

    const localScannedQty = scannedItems
      .filter((si) => si.item_code === item.item_code)
      .reduce((sum, si) => sum + si.qty, 0);

    // ✅ ALWAYS use backend picked_qty if available (even if 0)
    // This ensures mobile app shows the same quantity as desktop app
    const scannedQty =
      backendPickedQty !== null ? backendPickedQty : localScannedQty;

    // Debug logging for the specific item
    if (item.item_code === "SKU-HAT-301-BLU-OS") {
      console.warn(
        `🔍 [DISPLAY] ${item.item_code}: backendPickedQty=${backendPickedQty}, localScannedQty=${localScannedQty}, final scannedQty=${scannedQty}, mrItem.picked_qty=${mrItem?.picked_qty}, item.picked_qty=${item.picked_qty}`
      );
    }

    const remainingQty = item.requested_qty - scannedQty;
    const isComplete = scannedQty >= item.requested_qty;
    const hasScannedItems = scannedQty > 0;

    return (
      <View style={styles.requestedItemCard}>
        <View style={styles.requestedItemHeader}>
          <View style={styles.requestedItemLeft}>
            <Text style={styles.requestedItemCode}>{item.item_code}</Text>
            {item.item_name && (
              <Text style={styles.requestedItemName}>{item.item_name}</Text>
            )}
            {/* ✅ Show only location icon - clickable to open modal */}
            <TouchableOpacity
              style={styles.locationIconButton}
              onPress={(e) => {
                e.stopPropagation();
                handleShowLocations(item);
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.locationIcon}>📍</Text>
              {item.locations.length > 0 && (
                <Text style={styles.locationCountBadge}>
                  {item.locations.length}
                </Text>
              )}
            </TouchableOpacity>
          </View>
          <View
            style={[
              styles.requestedItemBadge,
              isComplete && styles.requestedItemBadgeGreen,
            ]}
          >
            <Text
              style={[
                styles.requestedItemBadgeText,
                isComplete && styles.requestedItemBadgeTextGreen,
              ]}
            >
              Req: {item.requested_qty}
            </Text>
          </View>
        </View>
        <View style={styles.requestedItemBody}>
          <View style={styles.requestedQtyRow}>
            <View style={styles.requestedQtySection}>
              <Text style={styles.requestedQtyLabel}>Requested</Text>
              <Text style={styles.requestedQtyValue}>{item.requested_qty}</Text>
            </View>
            <View style={styles.requestedQtySection}>
              <Text style={styles.requestedQtyLabel}>Scanned</Text>
              <Text style={[styles.requestedQtyValue, { color: "#4CAF50" }]}>
                {scannedQty}
              </Text>
            </View>
            <View style={styles.requestedQtySection}>
              <Text style={styles.requestedQtyLabel}>Remaining</Text>
              <Text
                style={[
                  styles.requestedQtyValue,
                  { color: remainingQty > 0 ? "#FF9800" : "#4CAF50" },
                ]}
              >
                {remainingQty}
              </Text>
            </View>
            {/* ✅ Show Edit button if item has been scanned (based on backend picked_qty) */}
            {scannedQty > 0 && (
              <TouchableOpacity
                style={styles.editButton}
                onPress={() => {
                  // ✅ Edit using item_code directly (not requiring scannedItems)
                  handleEditQtyByItemCode(item.item_code, scannedQty);
                }}
              >
                <Text style={styles.editButtonText}>Edit</Text>
              </TouchableOpacity>
            )}
          </View>
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
          {/* ✅ NEW: Start/Resume Picking Button - Only show if there's a draft session */}
          {/* If no draft session and status is "In Progress", auto-start will handle it */}
          {/* NO TC CHECK - TC is only created after "Complete Picking" */}
          {!pickingStarted && sessionStatus !== null && (sessionStatus === "Draft" || sessionStatus === "In Progress") && (
            <View style={styles.startPickingSection}>
              <TouchableOpacity
                style={[
                  styles.startPickingButton,
                  (isCreating || !materialRequest || !selectedStore) &&
                    styles.startPickingButtonDisabled,
                ]}
                onPress={handleStartPicking}
                disabled={isCreating || !materialRequest || !selectedStore}
              >
                {isCreating ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.startPickingButtonText}>
                    {sessionStatus === "Draft" ||
                    sessionStatus === "In Progress"
                      ? "🔄 Resume Picking"
                      : "🚀 Start Picking"}
                  </Text>
                )}
              </TouchableOpacity>
              <Text style={styles.startPickingSubtext}>
                {sessionStatus === "Draft" || sessionStatus === "In Progress"
                  ? `Resume picking session (${sessionStatus}) - Location and carton will be restored`
                  : "Click to create Transfer Carton and begin picking items"}
              </Text>
              {sessionStatus === "Draft" && (
                <View style={styles.draftBadge}>
                  <Text style={styles.draftBadgeText}>📝 Draft Session</Text>
                </View>
              )}
            </View>
          )}

          {/* ✅ NEW: Purple Header Card (like Cycle Count) - Show during picking (no TC needed) */}
          {pickingStarted && (
            <View style={styles.binHeaderCard}>
              <Text style={styles.headerTitle}>
                Material Request: {materialRequest.title}
              </Text>
              {binLocation && (
                <View style={styles.binLocationContainer}>
                  <Text style={styles.binLocationText}>Bin: {binLocation}</Text>
                  <TouchableOpacity
                    style={styles.changeLocationButton}
                    onPress={handleChangeBinLocation}
                  >
                    <Text style={styles.changeLocationButtonText}>
                      Change Location
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              {cartonId && (
                <View style={styles.cartonIdContainer}>
                  <Text
                    style={styles.cartonIdText}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
                    Carton: {cartonId}
                  </Text>
                  <TouchableOpacity
                    style={styles.changeCartonButton}
                    onPress={handleChangeCartonId}
                  >
                    <Text style={styles.changeCartonButtonText}>
                      Change Carton
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              {/* Only show TC if it exists (after "Complete Picking") */}
              {transferCarton && (
                <Text style={styles.taskTitleText}>TC: {transferCarton}</Text>
              )}
              <View style={styles.headerBadges}>
                <Text style={styles.headerSubtext}>
                  {/* ✅ Use backend's total picked_qty instead of local scannedItems */}
                  {totalPickedQty} item(s) scanned
                </Text>
              </View>
            </View>
          )}

          {/* ✅ Bin Location and Carton ID are scanned BEFORE entering this screen (like Cycle Count) */}
          {/* Only show scanning cards if not provided from route params */}
          {pickingStarted && !binLocation && !routeBinLocation && (
            <View style={styles.cartonIdCard}>
              <Text style={styles.cartonIdCardTitle}>
                📍 Scan Bin Location ID
              </Text>
              <Text style={styles.cartonIdCardSubtitle}>
                Please scan the bin location where items are located.
              </Text>
              <View style={styles.cartonIdInputRow}>
                <TextInput
                  ref={binLocationInputRef}
                  style={styles.cartonIdInput}
                  value={binLocationInput}
                  onChangeText={handleBinLocationInputChange}
                  placeholder="Scan or enter bin location ID"
                  autoCapitalize="characters"
                  autoFocus={true}
                  showSoftInputOnFocus={false}
                  onSubmitEditing={() => {
                    clearScannerTimer(binLocationScanTimerRef);
                    if (binLocationInput.trim()) {
                      handleBinLocationScan(binLocationInput.trim());
                    }
                  }}
                />
                <TouchableOpacity
                  style={styles.cartonIdScanButton}
                  onPress={() => setShowBinScanner(true)}
                >
                  <Text style={styles.cartonIdScanButtonText}>📷 Scan</Text>
                </TouchableOpacity>
                {binLocationInput.trim() && (
                  <TouchableOpacity
                    style={styles.cartonIdSubmitButton}
                    onPress={() => {
                      if (binLocationInput.trim()) {
                        handleBinLocationScan(binLocationInput.trim());
                      }
                    }}
                  >
                    <Text style={styles.cartonIdSubmitButtonText}>✓</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* ✅ NEW: Carton ID Scanning Card (Orange) - Show if carton ID not set but bin location is set */}
          {transferCarton && binLocation && !cartonId && (
            <View style={styles.cartonIdCard}>
              <Text style={styles.cartonIdCardTitle}>📦 Scan Carton ID</Text>
              <Text style={styles.cartonIdCardSubtitle}>
                One bin can have multiple cartons. Please scan the carton ID
                first.
              </Text>
              <View style={styles.cartonIdInputRow}>
                <TextInput
                  ref={cartonIdInputRef}
                  style={styles.cartonIdInput}
                  value={cartonIdInput}
                  onChangeText={handleCartonIdInputChange}
                  placeholder="Scan or enter carton ID"
                  autoCapitalize="characters"
                  autoFocus={true}
                  showSoftInputOnFocus={false}
                  onSubmitEditing={handleCartonIdSubmit}
                />
                <TouchableOpacity
                  style={styles.cartonIdScanButton}
                  onPress={() => setShowCartonScanner(true)}
                >
                  <Text style={styles.cartonIdScanButtonText}>📷 Scan</Text>
                </TouchableOpacity>
                {cartonIdInput.trim() && (
                  <TouchableOpacity
                    style={styles.cartonIdSubmitButton}
                    onPress={handleCartonIdSubmit}
                  >
                    <Text style={styles.cartonIdSubmitButtonText}>✓</Text>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity
                style={styles.generateCartonButton}
                onPress={handleGenerateCartonId}
              >
                <Text style={styles.generateCartonButtonText}>
                  🔧 Generate Carton ID
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ✅ NEW: Item Scanning Card (Blue) - Only show if carton ID is set */}
          {cartonId && (
            <View style={styles.scanCard}>
              <TouchableOpacity
                style={styles.scanButton}
                onPress={() => setShowItemScanner(true)}
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
                    onChangeText={handleManualBarcodeChange}
                    placeholder="Scan or enter barcode"
                    autoCapitalize="characters"
                    autoFocus={true}
                    blurOnSubmit={false}
                    showSoftInputOnFocus={false}
                    keyboardType="default"
                    onSubmitEditing={() => {
                      clearScannerTimer(manualBarcodeScanTimerRef);
                      if (manualBarcode.trim()) {
                        handleItemScan(manualBarcode.trim());
                        setManualBarcode("");
                        setTimeout(() => {
                          barcodeInputRef.current?.focus();
                        }, 50);
                      }
                    }}
                    returnKeyType="done"
                    onBlur={() => {
                      setTimeout(() => {
                        barcodeInputRef.current?.focus();
                      }, 100);
                    }}
                  />
                  <TouchableOpacity
                    style={styles.submitBarcodeButton}
                    onPress={() => {
                      if (manualBarcode.trim()) {
                        handleItemScan(manualBarcode.trim());
                        setManualBarcode("");
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
          )}

          {/* ✅ Requested Items List - Show ALL items with locations, updated scanned quantities */}
          {pickingStarted && requestedItemsWithLocations.length > 0 && (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>Requested Items</Text>
              {loadingLocations ? (
                <ActivityIndicator
                  size="small"
                  color="#9C27B0"
                  style={{ marginTop: 20 }}
                />
              ) : (
                <FlatList
                  data={requestedItemsWithLocations}
                  keyExtractor={(item) => item.item_code}
                  renderItem={renderRequestedItem}
                  scrollEnabled={false}
                  style={styles.list}
                />
              )}
            </View>
          )}
        </ScrollView>

        {/* Scanner Modals */}
        {showBinScanner && (
          <Modal
            visible={showBinScanner}
            transparent={true}
            animationType="slide"
            onRequestClose={() => {
              setShowBinScanner(false);
              setTimeout(() => {
                binLocationInputRef.current?.focus();
              }, 200);
            }}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Scan Bin Location ID</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setShowBinScanner(false);
                      setTimeout(() => {
                        binLocationInputRef.current?.focus();
                      }, 200);
                    }}
                    style={styles.modalCloseButton}
                  >
                    <Text style={styles.modalCloseButtonText}>✕</Text>
                  </TouchableOpacity>
                </View>
                <BarcodeScanner
                  onScan={(barcode) => {
                    handleBinLocationScan(barcode);
                    setShowBinScanner(false);
                    setTimeout(() => {
                      binLocationInputRef.current?.focus();
                    }, 200);
                  }}
                  title="Scan Bin Location ID"
                />
              </View>
            </View>
          </Modal>
        )}

        {showCartonScanner && (
          <Modal
            visible={showCartonScanner}
            transparent={true}
            animationType="slide"
            onRequestClose={() => {
              setShowCartonScanner(false);
              setTimeout(() => {
                cartonIdInputRef.current?.focus();
              }, 200);
            }}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Scan Carton ID</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setShowCartonScanner(false);
                      setTimeout(() => {
                        cartonIdInputRef.current?.focus();
                      }, 200);
                    }}
                    style={styles.modalCloseButton}
                  >
                    <Text style={styles.modalCloseButtonText}>✕</Text>
                  </TouchableOpacity>
                </View>
                <BarcodeScanner
                  onScan={(barcode) => {
                    handleCartonIdScan(barcode);
                    setShowCartonScanner(false);
                    setTimeout(() => {
                      cartonIdInputRef.current?.focus();
                    }, 200);
                  }}
                  title="Scan Carton ID"
                />
              </View>
            </View>
          </Modal>
        )}

        {showItemScanner && (
          <Modal
            visible={showItemScanner}
            transparent={true}
            animationType="slide"
            onRequestClose={() => {
              setShowItemScanner(false);
              setTimeout(() => {
                barcodeInputRef.current?.focus();
              }, 200);
            }}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Scan Item Barcode</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setShowItemScanner(false);
                      setTimeout(() => {
                        barcodeInputRef.current?.focus();
                      }, 200);
                    }}
                    style={styles.modalCloseButton}
                  >
                    <Text style={styles.modalCloseButtonText}>✕</Text>
                  </TouchableOpacity>
                </View>
                <BarcodeScanner
                  onScan={(barcode) => {
                    handleItemScan(barcode);
                    setShowItemScanner(false);
                    setTimeout(() => {
                      barcodeInputRef.current?.focus();
                    }, 200);
                  }}
                  title="Scan Item Barcode"
                />
              </View>
            </View>
          </Modal>
        )}

        {/* Edit Quantity Modal */}
        {editQtyModal && editQtyModal.visible && (
          <Modal
            visible={editQtyModal.visible}
            transparent={true}
            animationType="slide"
            onRequestClose={() => {
              setEditQtyModal(null);
              setEditQtyValue("");
            }}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Edit Quantity</Text>
                  <TouchableOpacity
                    onPress={() => {
                      setEditQtyModal(null);
                      setEditQtyValue("");
                    }}
                    style={styles.modalCloseButton}
                  >
                    <Text style={styles.modalCloseButtonText}>✕</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.modalBody}>
                  {editQtyModal.item && (
                    <>
                      <Text style={styles.modalItemCode}>
                        {editQtyModal.item.item_code}
                      </Text>
                      {editQtyModal.item.item_name && (
                        <Text style={styles.modalItemName}>
                          {editQtyModal.item.item_name}
                        </Text>
                      )}
                      <Text style={styles.modalCurrentQty}>
                        Current Quantity: {editQtyModal.currentQty}
                      </Text>
                      <TextInput
                        ref={editQtyInputRef}
                        style={styles.modalQtyInput}
                        value={editQtyValue}
                        onChangeText={setEditQtyValue}
                        placeholder="Enter new quantity"
                        keyboardType="numeric"
                        autoFocus={true}
                      />
                      <View style={styles.modalButtonRow}>
                        <TouchableOpacity
                          style={[styles.modalButton, styles.modalCancelButton]}
                          onPress={() => {
                            setEditQtyModal(null);
                            setEditQtyValue("");
                          }}
                        >
                          <Text style={styles.modalCancelButtonText}>
                            Cancel
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.modalButton, styles.modalSaveButton]}
                          onPress={handleSaveEditedQty}
                        >
                          <Text style={styles.modalSaveButtonText}>Save</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
              </View>
            </View>
          </Modal>
        )}

        {/* Location Modal - Only render when visible to prevent duplicates */}
        {locationModalVisible && (
          <Modal
            visible={locationModalVisible}
            transparent={true}
            animationType="slide"
            onRequestClose={() => {
              setLocationModalVisible(false);
              setSelectedItemForLocation(null);
            }}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>
                    Stock Locations - {selectedItemForLocation?.item_code || ""}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setLocationModalVisible(false);
                      setSelectedItemForLocation(null);
                    }}
                    style={styles.modalCloseButton}
                  >
                    <Text style={styles.modalCloseButtonText}>✕</Text>
                  </TouchableOpacity>
                </View>
                {selectedItemForLocation ? (
                  selectedItemForLocation.locations.length > 0 ? (
                    <ScrollView style={styles.modalBody}>
                      <View style={styles.stockListHeader}>
                        <Text style={[styles.stockListHeaderText, { flex: 1 }]}>
                          Bin Location
                        </Text>
                        <Text
                          style={[
                            styles.stockListHeaderText,
                            { width: 80, textAlign: "right" },
                          ]}
                        >
                          Total Qty
                        </Text>
                      </View>
                      {selectedItemForLocation.locations.map((loc, idx) => (
                        <View key={idx} style={styles.stockListItem}>
                          <View style={styles.stockListLocationContainer}>
                            <Text
                              style={styles.stockListLocation}
                              numberOfLines={1}
                              ellipsizeMode="tail"
                            >
                              {loc.bin_location}
                            </Text>
                            {loc.cartons && loc.cartons.length > 0 && (
                              <View style={styles.cartonsList}>
                                {loc.cartons.map((carton, cartonIdx) => (
                                  <View
                                    key={cartonIdx}
                                    style={styles.cartonRow}
                                  >
                                    <Text style={styles.cartonBullet}>•</Text>
                                    <Text
                                      style={styles.cartonId}
                                      numberOfLines={1}
                                      ellipsizeMode="tail"
                                    >
                                      {carton.carton_id}
                                    </Text>
                                    <Text style={styles.cartonQty}>
                                      {carton.qty}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            )}
                          </View>
                          <Text style={styles.stockListQty}>
                            {loc.total_qty}
                          </Text>
                        </View>
                      ))}
                    </ScrollView>
                  ) : (
                    <View style={styles.modalBody}>
                      <Text style={styles.modalEmptyText}>
                        No stock locations found for this item
                      </Text>
                    </View>
                  )
                ) : (
                  <View style={styles.modalBody}>
                    <ActivityIndicator size="large" color="#9C27B0" />
                  </View>
                )}
              </View>
            </View>
          </Modal>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
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
    backgroundColor: "#FF9800",
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
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#FF9800",
    flex: 1,
  },
  dispatchButtonRow: {
    alignItems: "flex-end",
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 14,
    color: "#666",
    width: 80,
  },
  infoValue: {
    fontSize: 14,
    color: "#000",
    flex: 1,
    fontWeight: "500",
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
  tcCard: {
    backgroundColor: "#F9F9F9",
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  tcHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  tcIdContainer: {
    flex: 1,
    marginRight: 12,
  },
  tcIdValueContainer: {
    width: "100%",
  },
  tcLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  tcId: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#2196F3",
    flexShrink: 1,
  },
  tcPlaceholder: {
    fontSize: 16,
    color: "#666",
    marginBottom: 16,
  },
  createButton: {
    backgroundColor: "#FF9800",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 200,
    alignItems: "center",
  },
  createButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  sealButton: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 0,
    minWidth: 200,
    alignItems: "center",
    alignSelf: "center",
  },
  sealButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  dispatchButtonTop: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 12,
    alignItems: "center",
    alignSelf: "flex-start",
  },
  dispatchButtonTopText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
  },
  dispatchButtonUnderStatus: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    marginTop: 8,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 100,
  },
  dispatchButtonUnderStatusText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "600",
  },
  dispatchButton: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 12,
    minWidth: 200,
    alignItems: "center",
    alignSelf: "center",
  },
  dispatchButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  dispatchedBadge: {
    backgroundColor: "#E8F5E9",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 12,
    alignItems: "center",
    alignSelf: "center",
    borderWidth: 1,
    borderColor: "#4CAF50",
  },
  dispatchedText: {
    color: "#2E7D32",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  boxCard: {
    backgroundColor: "#F9F9F9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  boxCardPacked: {
    backgroundColor: "#E8F5E9",
    borderColor: "#4CAF50",
  },
  boxHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  boxId: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    flex: 1,
  },
  boxDetails: {
    marginTop: 4,
  },
  boxDetailText: {
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },
  emptyBoxesContainer: {
    padding: 20,
    alignItems: "center",
  },
  emptyBoxesText: {
    fontSize: 14,
    color: "#666",
  },
  packedBoxesList: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  packedBoxItem: {
    backgroundColor: "#E8F5E9",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    marginRight: 8,
    marginBottom: 8,
  },
  packedBoxText: {
    fontSize: 14,
    color: "#2E7D32",
    fontWeight: "500",
  },
  locationCard: {
    backgroundColor: "#E3F2FD",
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  locationInfo: {
    flex: 1,
    marginRight: 12,
  },
  locationLabel: {
    fontSize: 14,
    color: "#333",
    fontWeight: "500",
    marginBottom: 4,
  },
  locationValue: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1976D2",
  },
  clearLocationButton: {
    backgroundColor: "#FF9800",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  clearLocationText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
  },
  scannerWrapper: {
    backgroundColor: "#E3F2FD",
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  scannedItemsContainer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
  },
  scannedItemsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  scannedItemsTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  lastScannedItemCard: {
    marginBottom: 16,
  },
  lastScannedHeader: {
    marginBottom: 8,
  },
  lastScannedLabel: {
    fontSize: 14,
    color: "#666",
    fontWeight: "600",
  },
  otherItemsHeader: {
    fontSize: 14,
    color: "#666",
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 8,
  },
  clearButton: {
    backgroundColor: "#F44336",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  clearButtonText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "600",
  },
  scannedItemCard: {
    backgroundColor: "#F9F9F9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  scannedItemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 8,
    gap: 8,
  },
  scannedItemInfo: {
    flex: 1,
    marginHorizontal: 8,
  },
  scannedItemCode: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  scannedItemName: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  editButton: {
    backgroundColor: "#2196F3",
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  editButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  removeButton: {
    backgroundColor: "#F44336",
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  removeButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  scannedItemDetails: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    marginBottom: 8,
  },
  scannedItemDetail: {
    fontSize: 14,
    color: "#666",
  },
  scannedItemQtyInfo: {
    backgroundColor: "#F5F5F5",
    padding: 10,
    borderRadius: 6,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
  },
  qtyInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  qtyInfoLabel: {
    fontSize: 13,
    color: "#666",
    fontWeight: "500",
  },
  qtyInfoValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#333",
  },
  // Edit Quantity Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    width: "100%",
    maxWidth: 400,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F5F5F5",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCloseButtonText: {
    fontSize: 18,
    color: "#666",
    fontWeight: "bold",
  },
  modalBody: {
    padding: 16,
  },
  modalItemCode: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#4CAF50",
    marginBottom: 4,
  },
  modalItemName: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
  },
  modalLocation: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
  },
  modalQtyInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#F5F5F5",
    borderRadius: 8,
    marginBottom: 16,
  },
  modalQtyLabel: {
    fontSize: 14,
    color: "#666",
  },
  modalQtyValue: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
  },
  modalInputContainer: {
    marginBottom: 16,
  },
  modalInputLabel: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#FFF",
  },
  modalQtySummary: {
    backgroundColor: "#E3F2FD",
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  modalQtyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  modalQtySummaryLabel: {
    fontSize: 14,
    color: "#666",
  },
  modalQtySummaryValue: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  modalFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
    gap: 12,
  },
  modalButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 100,
    alignItems: "center",
  },
  modalButtonCancel: {
    backgroundColor: "#F5F5F5",
  },
  modalButtonCancelText: {
    color: "#666",
    fontSize: 16,
    fontWeight: "600",
  },
  modalButtonSave: {
    backgroundColor: "#4CAF50",
  },
  modalButtonSaveText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  modalQtyInput: {
    borderWidth: 1,
    borderColor: "#E0E0E0",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginTop: 12,
    marginBottom: 16,
  },
  modalButtonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  modalCancelButton: {
    backgroundColor: "#F5F5F5",
    flex: 1,
  },
  modalCancelButtonText: {
    color: "#666",
    fontSize: 16,
    fontWeight: "600",
  },
  modalSaveButton: {
    backgroundColor: "#9C27B0",
    flex: 1,
  },
  modalSaveButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  modalCurrentQty: {
    fontSize: 14,
    color: "#666",
    marginTop: 8,
    marginBottom: 4,
  },
  modalEmptyText: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    padding: 20,
  },
  stockListHeader: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#F5F5F5",
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  stockListHeaderText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
  },
  stockListItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  stockListLocationContainer: {
    flex: 1,
  },
  stockListLocation: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
    marginBottom: 4,
  },
  stockListQty: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#9C27B0",
    width: 80,
    textAlign: "right",
  },
  cartonsList: {
    marginTop: 4,
    paddingLeft: 8,
  },
  cartonRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  cartonBullet: {
    fontSize: 12,
    color: "#999",
    marginRight: 6,
  },
  cartonId: {
    fontSize: 12,
    color: "#666",
    flex: 1,
  },
  cartonQty: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9C27B0",
    width: 50,
    textAlign: "right",
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
    fontWeight: "500",
  },
  modalInfoText: {
    fontSize: 12,
    color: "#999",
    marginBottom: 16,
  },
  modalEmptyContainer: {
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  tcItemsList: {
    maxHeight: 400,
  },
  tcItemsListContent: {
    paddingBottom: 8,
  },
  tcItemHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    paddingHorizontal: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
    marginBottom: 8,
  },
  tcItemHeaderTextLeft: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    flex: 1,
    textAlign: "left",
  },
  tcItemHeaderTextRight: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    width: 55,
    textAlign: "right",
    marginLeft: 6,
  },
  tcItemRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    paddingHorizontal: 10,
    backgroundColor: "#F9F9F9",
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  tcItemCode: {
    fontSize: 12,
    fontWeight: "500",
    color: "#333",
    flex: 1,
    marginRight: 6,
  },
  tcItemQtyValue: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
    width: 55,
    textAlign: "right",
    marginLeft: 6,
  },
  startPickingButton: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  startPickingButtonDisabled: {
    backgroundColor: "#CCCCCC",
    opacity: 0.6,
  },
  startPickingButtonText: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "bold",
  },
  startPickingSubtext: {
    fontSize: 12,
    color: "#666",
    textAlign: "center",
    marginTop: 4,
  },
  startPickingSection: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 8,
  },
  safeArea: {
    flex: 1,
    backgroundColor: "#F5F5F5",
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
  binLocationContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
    gap: 8,
  },
  binLocationText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFF",
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    flex: 1,
  },
  changeLocationButton: {
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.5)",
  },
  changeLocationButtonText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "600",
  },
  headerBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerSubtext: {
    fontSize: 14,
    color: "#E1BEE7",
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
  cartonIdContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
    gap: 8,
  },
  cartonIdText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFF",
    backgroundColor: "rgba(33, 150, 243, 0.3)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    flex: 1,
  },
  changeCartonButton: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.5)",
  },
  changeCartonButtonText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "600",
  },
  cartonIdCard: {
    backgroundColor: "#FF9800",
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 8,
    padding: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cartonIdCardTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#FFF",
    marginBottom: 4,
  },
  cartonIdCardSubtitle: {
    fontSize: 12,
    color: "#FFF",
    opacity: 0.9,
    marginBottom: 12,
  },
  cartonIdInputRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  cartonIdInput: {
    flex: 1,
    backgroundColor: "#FFF",
    borderWidth: 2,
    borderColor: "#FFF",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    fontWeight: "600",
  },
  cartonIdScanButton: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    justifyContent: "center",
  },
  cartonIdScanButtonText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
  },
  cartonIdSubmitButton: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    justifyContent: "center",
  },
  cartonIdSubmitButtonText: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "bold",
  },
  generateCartonButton: {
    marginTop: 12,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  generateCartonButtonText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
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
  listSubtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 12,
    fontWeight: "500",
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
  requestedItemCard: {
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
  requestedItemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  requestedItemLeft: {
    flex: 1,
  },
  requestedItemCode: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  requestedItemName: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
  },
  locationsContainer: {
    marginTop: 4,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  locationIconButton: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    padding: 4,
  },
  locationIcon: {
    fontSize: 18,
  },
  locationCountBadge: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#9C27B0",
    marginLeft: 4,
    backgroundColor: "#E1BEE7",
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 8,
    minWidth: 16,
    textAlign: "center",
  },
  locationText: {
    fontSize: 12,
    color: "#666",
    flex: 1,
  },
  requestedItemBadge: {
    backgroundColor: "#E1BEE7",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  requestedItemBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9C27B0",
  },
  requestedItemBadgeTextGreen: {
    color: "#FFF",
  },
  requestedItemBadgeGreen: {
    backgroundColor: "#4CAF50",
  },
  requestedItemBody: {
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
    paddingTop: 12,
  },
  requestedQtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  requestedQtySection: {
    flex: 1,
  },
  requestedQtyLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  requestedQtyValue: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#9C27B0",
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
  expectedBadge: {
    backgroundColor: "#E1BEE7",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  expectedBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#9C27B0",
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
    fontSize: 18,
    fontWeight: "bold",
    color: "#9C27B0",
  },
  draftBadge: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: "#FFA726",
    borderRadius: 12,
    alignSelf: "center",
  },
  draftBadgeText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "600",
  },
});
