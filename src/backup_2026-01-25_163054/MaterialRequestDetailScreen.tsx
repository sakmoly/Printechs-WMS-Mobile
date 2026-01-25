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
  Modal,
} from "react-native";
import {
  useNavigation,
  useRoute,
  useFocusEffect,
} from "@react-navigation/native";
import { apiService } from "../services/api.service";
import { MaterialRequest } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import { getDatabase } from "../database/database";
import { dataService } from "../services/data.service";
import { getSettings } from "../services/settings.service";
import { pickingSessionService, PickingSession } from "../services/picking-session.service";

export default function MaterialRequestDetailScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { materialRequestTitle } = (route.params as any) || {};

  const [materialRequest, setMaterialRequest] =
    useState<MaterialRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [stockModalVisible, setStockModalVisible] = useState(false);
  const [stockData, setStockData] = useState<
    Array<{
      location_id: string;
      qty: number;
      cartons?: Array<{ carton_id: string; qty: number }>;
    }>
  >([]);
  const [loadingStock, setLoadingStock] = useState(false);
  const [selectedItemCode, setSelectedItemCode] = useState<string>("");
  const [transferCarton, setTransferCarton] = useState<string | null>(null);
  const [hasSealedTC, setHasSealedTC] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [hasDispatchedTC, setHasDispatchedTC] = useState(false);
  const [hasTransferCarton, setHasTransferCarton] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pickingStatus, setPickingStatus] = useState<{
    all_items_fully_picked: boolean;
    total_items: number;
    fully_picked_items: number;
  } | null>(null);
  const [isCheckingPickingStatus, setIsCheckingPickingStatus] = useState(false);
  const [isCompletingPicking, setIsCompletingPicking] = useState(false);
  const [isCreatingTC, setIsCreatingTC] = useState(false);
  const [isSealingTC, setIsSealingTC] = useState(false);
  const [tcStatus, setTcStatus] = useState<string | null>(null);

  useEffect(() => {
    if (materialRequestTitle) {
      loadMaterialRequest();
    }
  }, [materialRequestTitle]);

  // Reload when screen is focused (e.g., returning from Packing screen)
  useFocusEffect(
    React.useCallback(() => {
      if (materialRequestTitle) {
        // Reload Material Request when screen comes into focus to get latest status
        loadMaterialRequest();
      }
    }, [materialRequestTitle])
  );

  // Poll picking status when status is "In Progress"
  useEffect(() => {
    if (
      materialRequest?.status === "In Progress" &&
      !isCheckingPickingStatus &&
      materialRequestTitle &&
      materialRequest
    ) {
      // Check immediately
      checkPickingStatus();

      const interval = setInterval(async () => {
        if (!isCheckingPickingStatus && materialRequest) {
          await checkPickingStatus();
        }
      }, 5000); // Poll every 5 seconds

      return () => clearInterval(interval);
    }
  }, [materialRequest?.status, materialRequestTitle, materialRequest]);

  // Check for Transfer Carton when status changes to "Picked"
  useEffect(() => {
    if (materialRequest?.status === "Picked" && materialRequestTitle) {
      console.log(`🔍 Status is "Picked" - checking for Transfer Carton...`);
      checkExistingTC().then(() => {
        console.log(`✅ checkExistingTC completed. hasTransferCarton: ${hasTransferCarton}, transferCarton: ${transferCarton}`);
      });
    }
  }, [materialRequest?.status, materialRequestTitle]);

  // Helper function to clear Material Request cache and related data
  const clearMaterialRequestCache = async (mrTitle: string) => {
    try {
      const { getDatabase } = await import("../database/database");
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
      console.log(`🔄 Loading Material Request: ${materialRequestTitle}`);
      const response = await apiService.getMaterialRequest(
        materialRequestTitle
      );
      console.log(`📦 API Response:`, response);

      // Handle different response formats
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
        console.log(`✅ Material Request loaded: ${mr.title}, status: ${mr.status}`);
        // Calculate picked quantities from event queue
        const mrWithPickedQty = await calculatePickedQuantities(mr);
        
        // ✅ Preserve "Submitted" status if it was set locally (don't overwrite with backend value)
        // ✅ For "Picked" status, always use backend value (don't preserve if backend says different)
        setMaterialRequest((prev) => {
          const newMR = mrWithPickedQty;
          // Only preserve "Submitted" status - not "Picked" (backend should be source of truth for "Picked")
          if (prev && prev.status === "Submitted") {
            console.log(`🔄 Preserving "Submitted" status from previous state (backend returned: ${newMR.status})`);
            return { ...newMR, status: prev.status };
          }
          // Always use the status from backend (especially for "Picked")
          console.log(`📊 Using status from backend: ${newMR.status}`);
          return newMR;
        });
        
          // Check for existing sealed TC
          await checkExistingTC();
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
        const { getDatabase } = await import("../database/database");
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
          // Calculate picked quantities from event queue
          const mrWithPickedQty = await calculatePickedQuantities(mrFromCache);
          
          // ✅ Preserve "Submitted" status if it was set locally
          setMaterialRequest((prev) => {
            const newMR = mrWithPickedQty;
            if (prev && prev.status === "Submitted") {
              console.log(`🔄 Preserving "Submitted" status from previous state (cache)`);
              return { ...newMR, status: "Submitted" };
            }
            return newMR;
          });
          
          // Check for existing sealed TC
          await checkExistingTC();
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

  // Calculate picked quantities from event queue
  const calculatePickedQuantities = async (mr: any): Promise<any> => {
    if (!mr || !mr.title) return mr;

    try {
      const db = await getDatabase();

      // Get all picked items from event queue for this Material Request
      // Count ALL picked items regardless of whether they're packed into a TC or not
      // Once an item is picked, it should always be counted as picked, even after packing
      const pickedEvents = await db.getAllAsync<{
        item_code: string;
        total_qty: number;
      }>(
        `SELECT 
          item_code,
          SUM(qty) as total_qty
        FROM event_queue
        WHERE material_request = ?
          AND event_type = 'PACK_BOX_TO_TC'
        GROUP BY item_code`,
        [mr.title]
      );

      // Check which items are in sealed transfer cartons
      // Items in sealed TCs should have status "Sealed"
      const sealedItems = await db.getAllAsync<{
        item_code: string;
      }>(
        `SELECT DISTINCT e.item_code
         FROM event_queue e
         JOIN tc_cache tc ON e.tc_id = tc.tc_id
         WHERE e.material_request = ?
           AND e.event_type = 'PACK_BOX_TO_TC'
           AND e.tc_id IS NOT NULL
           AND tc.status IN ('Sealed', 'SEALED', 'Dispatched', 'DISPATCHED')`,
        [mr.title]
      );

      console.log(
        `📊 Found ${pickedEvents.length} item(s) with picked quantities from events`
      );
      if (pickedEvents.length > 0) {
        console.log(
          `📊 Picked events details:`,
          pickedEvents.map((e) => ({
            item_code: e.item_code,
            total_qty: e.total_qty,
          }))
        );
      }

      // Create maps for quick lookup
      const pickedQtyMap = new Map<string, number>();
      pickedEvents.forEach((event) => {
        if (event.item_code) {
          pickedQtyMap.set(event.item_code, event.total_qty || 0);
        }
      });

      const sealedItemSet = new Set<string>();
      sealedItems.forEach((item) => {
        if (item.item_code) {
          sealedItemSet.add(item.item_code);
        }
      });

      // Update Material Request items with picked quantities and status
      const updatedItems = (mr.items || []).map((item: any) => {
        const pickedQty =
          pickedQtyMap.get(item.item_code) || item.picked_qty || 0;
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

        console.log(
          `📦 Item ${item.item_code}: Requested=${item.requested_qty}, Picked=${pickedQty}, Pending=${pendingQty}, Status=${itemStatus}`
        );
        return {
          ...item,
          picked_qty: pickedQty,
          pending_qty: pendingQty,
          status: itemStatus,
        };
      });

      // Calculate total picked quantity
      const totalPickedQty = updatedItems.reduce(
        (sum: number, item: any) => sum + (item.picked_qty || 0),
        0
      );

      console.log(
        `✅ Updated Material Request with picked quantities: Total = ${totalPickedQty}`
      );
      console.log(
        `📊 Item breakdown:`,
        updatedItems.map((item: any) => ({
          item_code: item.item_code,
          requested: item.requested_qty,
          picked: item.picked_qty,
        }))
      );

      return {
        ...mr,
        items: updatedItems,
        total_picked_qty: totalPickedQty,
      };
    } catch (error: any) {
      console.error("❌ Error calculating picked quantities:", error);
      // Return original MR if calculation fails
      return mr;
    }
  };

  // Check picking status - Calculate from Material Request items (fallback if API not available)
  const checkPickingStatus = async () => {
    if (!materialRequestTitle || isCheckingPickingStatus || !materialRequest) return;

    setIsCheckingPickingStatus(true);
    try {
      // Try backend API first
      try {
        const response = await apiService.getMaterialRequestPickingStatus(
          materialRequestTitle
        );

        if (response?.ok !== false && response?.data) {
          setPickingStatus({
            all_items_fully_picked: response.data.all_items_fully_picked || false,
            total_items: response.data.total_items || 0,
            fully_picked_items: response.data.fully_picked_items || 0,
          });
          return; // Success, exit early
        }
      } catch (apiError: any) {
        // If 404 or API not available, calculate from Material Request items
        if (apiError.message?.includes("404") || apiError.message?.includes("not found")) {
          console.log("ℹ️ Picking-status API not available, calculating from Material Request items");
        } else {
          throw apiError; // Re-throw if it's a different error
        }
      }

      // ✅ FALLBACK: Calculate picking status from Material Request items
      if (materialRequest.items && Array.isArray(materialRequest.items)) {
        const totalItems = materialRequest.items.length;
        const fullyPickedItems = materialRequest.items.filter((item: any) => {
          const requestedQty = item.requested_qty || 0;
          const pickedQty = item.picked_qty || 0;
          return pickedQty >= requestedQty && requestedQty > 0;
        }).length;

        const allItemsFullyPicked = fullyPickedItems === totalItems && totalItems > 0;

        setPickingStatus({
          all_items_fully_picked: allItemsFullyPicked,
          total_items: totalItems,
          fully_picked_items: fullyPickedItems,
        });
      }
    } catch (error: any) {
      // Only log if it's not a 404 (API not implemented)
      if (!error.message?.includes("404") && !error.message?.includes("not found")) {
        console.warn("⚠️ Failed to check picking status:", error.message);
      }
    } finally {
      setIsCheckingPickingStatus(false);
    }
  };

  // Start Picking - Update status to "In Progress"
  const handleStartPicking = async () => {
    if (!materialRequest) return;

    const status = materialRequest.status || "Unknown";
    if (status !== "Submitted" && status !== "Draft") {
      Alert.alert(
        "Cannot Start Picking",
        `Material Request ${materialRequest.title} is ${status}. Only 'Submitted' or 'Draft' Material Requests can start picking.`
      );
      return;
    }

    try {
      setIsSubmitting(true);
      const response = await apiService.updateMaterialRequestStatus(
        materialRequest.title,
        "In Progress"
      );

      if (response?.ok !== false) {
        // Reload Material Request to get updated status
        await loadMaterialRequest();
        
        // ❌ DO NOT use cached bin_location or carton_id - always require fresh scan
        // Clear session's bin_location and carton_id to force fresh scanning
        const session = await pickingSessionService.loadSession(materialRequest.title);
        if (session) {
          // Clear bin_location and carton_id from session to force fresh scans
          const clearedSession: PickingSession = {
            ...session,
            bin_location: null,
            carton_id: null,
            status: "In Progress",
            updated_at: new Date().toISOString(),
          };
          await pickingSessionService.saveSession(clearedSession);
        }
        
        // Always start from Bin scanning screen - require fresh Location ID scan
        (navigation as any).navigate("PickingScanBin", {
      materialRequestTitle: materialRequest.title,
    });
      } else {
        Alert.alert(
          "Error",
          response?.error?.message || "Failed to start picking"
        );
      }
    } catch (error: any) {
      console.error("❌ Failed to start picking:", error);
      Alert.alert("Error", error.message || "Failed to start picking");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Complete Picking - Update status to "Picked"
  const handleCompletePicking = async () => {
    if (!materialRequest) return;

    // Validate all items are fully picked (calculate from Material Request items)
    const totalItems = materialRequest.items?.length || 0;
    const fullyPickedItems = materialRequest.items?.filter((item: any) => {
      const requestedQty = item.requested_qty || 0;
      const pickedQty = item.picked_qty || 0;
      return pickedQty >= requestedQty && requestedQty > 0;
    }).length || 0;

    const allItemsFullyPicked = fullyPickedItems === totalItems && totalItems > 0;

    if (!allItemsFullyPicked) {
      const pendingItems = materialRequest.items?.filter((item: any) => {
        const requestedQty = item.requested_qty || 0;
        const pickedQty = item.picked_qty || 0;
        return pickedQty < requestedQty;
      }) || [];

      Alert.alert(
        "Cannot Complete Picking",
        `Not all items are fully picked.\n\n${pendingItems.length} item(s) still need to be picked.\n\nPlease complete picking all items before marking as complete.`
      );
      return;
    }

    try {
      setIsCompletingPicking(true);

      // Update status to "Picked"
      console.log(`🔄 Attempting to update Material Request status to "Picked": ${materialRequest.title}`);
      
      // Immediately update local state to "Picked" optimistically
      setMaterialRequest((prev) => {
        if (prev) {
          console.log(`✅ Optimistically updating local state to "Picked"`);
          return { ...prev, status: "Picked" };
        }
        return prev;
      });

        try {
        const response = await apiService.updateMaterialRequestStatus(
          materialRequest.title,
          "Picked"
        );
        console.log(`📝 Status update response:`, JSON.stringify(response, null, 2));

        // If we get here, the API call succeeded (makeRequest throws on error)
        // Update local state immediately to "Picked" (optimistic update)
        setMaterialRequest((prev) => {
          if (prev) {
            return { ...prev, status: "Picked" };
          }
          return prev;
        });

        // Add a delay before reloading to ensure backend has processed
        await new Promise((resolve) => setTimeout(resolve, 1500));
        
        // Reload from backend to get the latest status and data
        // This will now use backend status (we removed "Picked" from preservation logic)
        await loadMaterialRequest();
        
        // After reload, check for Transfer Carton again (in case status changed)
        await checkExistingTC();
        
        // Verify status was updated by checking the state after a brief moment
        await new Promise((resolve) => setTimeout(resolve, 200));
        const finalStatus = materialRequest?.status;
        console.log(`📊 Final status after reload: ${finalStatus}, hasTransferCarton: ${hasTransferCarton}`);
        
        if (finalStatus === "Picked") {
          Alert.alert("Success", "Material Request marked as Picked");
        } else {
          // Status might not have updated yet, but API call succeeded
          Alert.alert("Success", "Status update sent to backend. Please refresh if status doesn't update.");
        }
      } catch (apiError: any) {
        // API call failed
        console.error(`❌ Status update API call failed:`, apiError);
        
        // Reload to get the actual status from backend
        await loadMaterialRequest();
        
        // Check if status was actually updated on backend (maybe by another user or delayed update)
        const reloadedStatus = materialRequest?.status;
        if (reloadedStatus === "Picked") {
          // Status is "Picked" on backend - success!
          Alert.alert("Success", "Material Request status updated to Picked");
        } else {
          // Status update failed - show error
          const errorMessage = apiError?.message || "Failed to update status on backend";
          Alert.alert(
            "Update Failed", 
            `Could not update status on backend.\n\nError: ${errorMessage}\n\nCurrent status: ${reloadedStatus || "Unknown"}`
          );
        }
      }
    } catch (error: any) {
      console.error("❌ Failed to complete picking:", error);
      const errorMessage = error.message || "Failed to complete picking";
      
      // Check if it's a network error or API error
      if (errorMessage.includes("404") || errorMessage.includes("not found")) {
        Alert.alert(
          "API Not Found",
          `The status update endpoint may not be implemented yet.\n\nError: ${errorMessage}\n\nPlease check if the backend has implemented:\nPOST /api/material-requests/{title}/update-status`
        );
      } else if (errorMessage.includes("Network") || errorMessage.includes("timeout")) {
        Alert.alert(
          "Network Error",
          `Could not connect to the server.\n\nError: ${errorMessage}\n\nPlease check your network connection and API URL settings.`
        );
      } else {
        Alert.alert("Error", errorMessage);
      }
      
      // Don't update local state on error
    } finally {
      setIsCompletingPicking(false);
    }
  };

  // Create Transfer Carton - Called when status is "Picked"
  const handleCreateTransferCarton = async () => {
    if (!materialRequest) {
      Alert.alert("Error", "Material Request not available");
      return;
    }

    // Check if there are any picked items
    const hasPickedItems = materialRequest.items?.some(
      (item: any) => (item.picked_qty || 0) > 0
    );

    if (!hasPickedItems) {
      Alert.alert(
        "No Items Picked",
        "Please pick at least one item before submitting. Use 'Start Picking' to begin picking items."
      );
      return;
    }

    Alert.alert(
      "Confirm Submit",
      `Create Transfer Carton for Material Request ${materialRequest.title}?\n\nThis will create a Transfer Carton with all picked items.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit",
          onPress: async () => {
            setIsSubmitting(true);
            try {
              const settings = await getSettings();

              // Validate required fields
              if (!materialRequest.to_showroom || materialRequest.to_showroom.trim() === "") {
                throw new Error(
                  "Store is required. Please ensure Material Request has a valid 'to_showroom' value."
                );
              }

              if (!settings.user_id || settings.user_id.trim() === "") {
                throw new Error("User ID is required. Please check your settings.");
              }

              // Generate TC ID in format: TC-MR-{MR_NUMBER}-{timestamp}
              const tc_id = `TC-MR-${materialRequest.title.replace(
                "MR-",
                ""
              )}-${Date.now()}`;

              console.log("📦 Creating Transfer Carton for Material Request:", {
                tc_id,
                store: materialRequest.to_showroom,
                user_id: settings.user_id,
                material_request: materialRequest.title,
              });

              // ✅ NOTE: Stock should already be updated during picking (via pick-items API)
              // We're just creating an empty Transfer Carton container here
              // No source_bin validation needed - that was done during picking

              // ✅ STEP 1: Create Transfer Carton (just an empty container)
              const response = await apiService.createTransferCarton({
                tc_id,
                asn_no: null, // Backend validation requires null for Material Requests
                to_no: materialRequest.title, // Use Material Request number as transfer_order
                store: materialRequest.to_showroom,
                user_id: settings.user_id,
                created_by: settings.user_id,
                material_request: materialRequest.title,
              });

              if (response && (response.tc_id || response.data?.tc_id)) {
                const createdTCId = response.tc_id || response.data?.tc_id;
                console.log(`✅ Created Transfer Carton: ${createdTCId}`);

                // Save to local cache
                await dataService.saveTransferCarton({
                  tc_id: createdTCId,
                  asn_no: "", // Material Requests don't have ASN
                  to_no: materialRequest.title,
                  store: materialRequest.to_showroom,
                  status: "Created",
                  updated_on: new Date().toISOString(),
                });

                // ✅ STEP 2: Pack Items to Transfer Carton using /api/events/batch
                // This creates PACK_ITEM_TO_TC events for audit/tracking
                // Note: source_bin is required for packing events (for audit trail)
                const db = await getDatabase();
                
                // Get carton_id and source_bin from picking session (for packing events only)
                const pickingSession = await db.getFirstAsync<{
                  carton_id: string | null;
                  bin_location: string | null;
                }>(
                  `SELECT carton_id, bin_location FROM material_request_picking_sessions 
                   WHERE material_request_title = ? 
                   ORDER BY updated_at DESC LIMIT 1`,
                  [materialRequest.title]
                );
                
                const sessionCartonId = pickingSession?.carton_id || null;
                const sessionBinLocation = pickingSession?.bin_location || null;

                const packingEvents: any[] = [];

                if (materialRequest.items && Array.isArray(materialRequest.items)) {
                  for (const item of materialRequest.items) {
                    const pickedQty = item.picked_qty || 0;
                    if (pickedQty > 0) {
                      // ✅ CRITICAL: Get source_bin per item (priority order)
                      // Since we're using pick-items API directly (not events), source_bin might not be in event_queue
                      // We need to get it from multiple sources
                      let sourceBin = null;
                      
                      // 1. Try to get from event_queue (for backward compatibility with old workflow)
                      const itemSourceBin = await db.getFirstAsync<{
                        source_bin: string | null;
                      }>(
                        `SELECT source_bin FROM event_queue 
                         WHERE material_request = ? AND item_code = ? 
                         AND source_bin IS NOT NULL AND source_bin != ''
                         ORDER BY event_time DESC LIMIT 1`,
                        [materialRequest.title, item.item_code]
                      );
                      sourceBin = itemSourceBin?.source_bin || null;
                      
                      // 2. Fallback to picking session bin_location (should be saved when bin is scanned)
                      if (!sourceBin) {
                        sourceBin = sessionBinLocation;
                        if (sourceBin) {
                          console.log(`✅ Found source_bin from picking session: ${sourceBin}`);
                        }
                      }
                      
                      // 3. Fallback to any bin_location from any picking session for this MR
                      if (!sourceBin) {
                        const anySession = await db.getFirstAsync<{
                          bin_location: string | null;
                        }>(
                          `SELECT bin_location FROM material_request_picking_sessions 
                           WHERE material_request_title = ? 
                           AND bin_location IS NOT NULL AND bin_location != ''
                           ORDER BY updated_at DESC LIMIT 1`,
                          [materialRequest.title]
                        );
                        sourceBin = anySession?.bin_location || null;
                        if (sourceBin) {
                          console.log(`✅ Found source_bin from any picking session: ${sourceBin}`);
                        }
                      }
                      
                      // 4. Try to get from scanned_items table (if it exists and has source_bin)
                      if (!sourceBin) {
                        try {
                          const scannedItem = await db.getFirstAsync<{
                            source_bin: string | null;
                          }>(
                            `SELECT source_bin FROM scanned_items 
                             WHERE material_request = ? AND item_code = ? 
                             AND source_bin IS NOT NULL AND source_bin != ''
                             ORDER BY scan_time DESC LIMIT 1`,
                            [materialRequest.title, item.item_code]
                          );
                          sourceBin = scannedItem?.source_bin || null;
                          if (sourceBin) {
                            console.log(`✅ Found source_bin from scanned_items: ${sourceBin}`);
                          }
                        } catch (e) {
                          // scanned_items table might not exist - ignore
                        }
                      }

                      // ✅ CRITICAL: Always send packing event with tc_id (even if source_bin is missing)
                      // The tc_id is what links items to the Transfer Carton
                      // If source_bin is missing, we still send the event but log a warning
                      if (!sourceBin || sourceBin.trim() === "") {
                        console.warn(`⚠️ Missing source_bin for item ${item.item_code} - sending packing event without source_bin (TC will show items but no source location)`);
                        // Don't skip - still send the event so items appear in TC
                      }

                      // ✅ CRITICAL: Generate unique offline_uuid for each event
                      const offlineUuid = `pack-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                      // ✅ CRITICAL: Ensure tc_id is always included (required for items to appear in TC)
                      if (!createdTCId || createdTCId.trim() === "") {
                        console.error(`❌ CRITICAL: createdTCId is empty! Cannot create packing event for item ${item.item_code}`);
                        continue; // Skip this item if TC ID is missing
                      }

                      const packingEvent: any = {
                        offline_uuid: offlineUuid, // ✅ Required for idempotency
                        event_type: "PACK_ITEM_TO_TC",
                        tc_id: createdTCId, // ✅ CRITICAL - Links item to TC (this is what makes items appear!)
                        item_code: item.item_code,
                        qty: pickedQty,
                        material_request: materialRequest.title,
                        to_no: materialRequest.title,
                        store: materialRequest.to_showroom || "",
                        device_id: settings.device_id || "",
                        user_id: settings.user_id || "",
                        event_time: new Date().toISOString(),
                        synced: 0,
                      };

                      // Add optional fields if available
                      if (sourceBin && sourceBin.trim() !== "") {
                        packingEvent.source_bin = sourceBin;
                        packingEvent.location_id = sourceBin;
                      }
                      if (sessionCartonId && sessionCartonId.trim() !== "") {
                        packingEvent.carton_id = sessionCartonId;
                      }

                      // ✅ Verify tc_id is included before adding to array
                      if (packingEvent.tc_id) {
                        packingEvents.push(packingEvent);
                        console.log(`✅ Created packing event for item ${item.item_code}:`, {
                          tc_id: packingEvent.tc_id,
                          item_code: packingEvent.item_code,
                          qty: packingEvent.qty,
                          has_source_bin: !!packingEvent.source_bin,
                        });
                      } else {
                        console.error(`❌ CRITICAL: tc_id missing in packing event for item ${item.item_code}`);
                      }
                    }
                  }
                }

                // ✅ CRITICAL: Pack items to Transfer Carton using /api/events/batch
                // This is REQUIRED - without these events, items won't appear in TC contents
                if (packingEvents.length > 0) {
                  try {
                    console.log(
                      `📦 Packing ${packingEvents.length} item(s) to Transfer Carton ${createdTCId} via /api/events/batch...`
                    );
                    console.log(`📦 Packing events (with tc_id):`, 
                      JSON.stringify(packingEvents.map(e => ({
                        event_type: e.event_type,
                        tc_id: e.tc_id, // ✅ Verify tc_id is included
                        item_code: e.item_code,
                        qty: e.qty,
                        source_bin: e.source_bin,
                      })), null, 2)
                    );
                    
                    console.log(`📤 Sending ${packingEvents.length} packing event(s) to /api/events/batch...`);
                    console.log(`📤 Full packing events payload:`, JSON.stringify(packingEvents, null, 2));
                    
                    const batchResponse = await apiService.batchEvents(packingEvents, false);
                    
                    // ✅ CRITICAL: Verify response indicates success
                    console.log(`📥 Batch response received:`, JSON.stringify(batchResponse, null, 2));
                    
                    const ackedCount = batchResponse?.acked_count || batchResponse?.acked?.length || batchResponse?.total_count || 0;
                    const failedCount = batchResponse?.failed_count || batchResponse?.failed?.length || 0;
                    const insertedCount = batchResponse?.inserted_count || 0;
                    const eventsSaved = batchResponse?.events_saved_to_backend || false;
                    
                    console.log(
                      `✅ Packing events response summary:`,
                      {
                        total_sent: packingEvents.length,
                        acked: ackedCount,
                        failed: failedCount,
                        inserted: insertedCount,
                        events_saved: eventsSaved,
                        full_response: batchResponse,
                      }
                    );
                    
                    // ✅ CRITICAL: Verify events were saved to backend
                    if (eventsSaved && insertedCount > 0) {
                      console.log(
                        `✅ SUCCESS: ${insertedCount} packing event(s) saved to backend. Items should appear in Carton Contents.`
                      );
                    } else if (failedCount > 0) {
                      console.error(`❌ CRITICAL: ${failedCount} of ${packingEvents.length} packing event(s) failed!`);
                      console.error(`❌ Failed details:`, batchResponse?.failed_details_preview || batchResponse?.failed);
                      Alert.alert(
                        "Error",
                        `${failedCount} of ${packingEvents.length} packing event(s) failed.\n\n` +
                        `Items will NOT appear in Carton Contents until events are sent successfully.\n\n` +
                        `Please check the event queue and sync again.`
                      );
                    } else if (ackedCount === packingEvents.length) {
                      console.log(
                        `✅ SUCCESS: All ${packingEvents.length} packing event(s) acknowledged. Items should appear in Carton Contents.`
                      );
                    } else {
                      console.warn(
                        `⚠️ WARNING: Packing events sent but acknowledgment unclear:\n` +
                        `  Sent: ${packingEvents.length}\n` +
                        `  Acked: ${ackedCount}\n` +
                        `  Failed: ${failedCount}\n` +
                        `  Inserted: ${insertedCount}\n` +
                        `  Events Saved: ${eventsSaved}\n\n` +
                        `Please verify items appear in Carton Contents. If not, check backend logs.`
                      );
                      
                      // ✅ Verify events were actually saved by checking Transfer Carton contents
                      try {
                        console.log(`🔍 Verifying events were saved by checking Transfer Carton contents...`);
                        const tcDetails = await apiService.getTransferCarton(createdTCId);
                        if (tcDetails && tcDetails.items && Array.isArray(tcDetails.items)) {
                          const itemCount = tcDetails.items.length;
                          console.log(`✅ Transfer Carton has ${itemCount} item(s) in contents`);
                          if (itemCount === 0) {
                            console.error(`❌ CRITICAL: Transfer Carton is empty! Events may not have been saved to backend.`);
                            Alert.alert(
                              "Backend Issue Detected",
                              `Transfer Carton created, but items are not appearing in Carton Contents.\n\n` +
                              `This indicates a backend issue:\n` +
                              `1. Events may not have been saved to tabWmsScanEvent table\n` +
                              `2. Backend query for Carton Contents may not be finding events\n\n` +
                              `Please check:\n` +
                              `- Backend logs for /api/events/batch\n` +
                              `- Database table tabWmsScanEvent for events with tc_id = ${createdTCId}\n` +
                              `- Backend query for Carton Contents`
                            );
                          }
                        } else {
                          console.warn(`⚠️ Could not verify Transfer Carton contents - API may not return items`);
                        }
                      } catch (verifyError: any) {
                        console.warn(`⚠️ Could not verify Transfer Carton contents:`, verifyError.message);
                        // Don't block - this is just verification
                      }
                    }
                  } catch (packingError: any) {
                    console.error(
                      `❌ CRITICAL: Failed to pack items to Transfer Carton:`,
                      packingError
                    );
                    // Show error but don't block - TC is created, but items won't show until events are sent
                    Alert.alert(
                      "Warning",
                      `Transfer Carton created, but failed to pack items:\n\n${packingError.message}\n\n` +
                      `Items may not appear in Carton Contents until packing events are sent.\n\n` +
                      `Please check the event queue and sync again.`,
                      [
                        {
                          text: "OK",
                          onPress: () => {
                            // Optionally navigate to sync center or show instructions
                          },
                        },
                      ]
                    );
                  }
                } else {
                  // ✅ CRITICAL: This should never happen if items were picked
                  console.error(`❌ CRITICAL: No packing events generated! TC ${createdTCId} will be empty.`);
                  Alert.alert(
                    "Warning",
                    `Transfer Carton created, but no packing events were generated.\n\n` +
                    `This may happen if:\n` +
                    `1. No items have picked_qty > 0\n` +
                    `2. All items are missing source_bin\n\n` +
                    `The Transfer Carton will be empty until packing events are sent.`
                  );
                }

                // Update state
                setHasTransferCarton(true);
                setTransferCarton(createdTCId);
                setTcStatus("Created");

                // Reload Material Request to refresh data
                await loadMaterialRequest();

                Alert.alert(
                  "Success",
                  `Transfer Carton ${createdTCId} created successfully.\n\n${packingEvents.length} item(s) packed to Transfer Carton.`,
                  [
                    {
                      text: "OK",
                      onPress: () => {
                        // Navigate back to Material Request List
                        (navigation as any).navigate("MaterialRequestList");
                      },
                    },
                  ]
                );
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
              setIsCreatingTC(false);
            }
          },
        },
      ]
    );
  };

  // Seal Transfer Carton
  const handleSealTransferCarton = async () => {
    if (!transferCarton || !materialRequest) {
      Alert.alert("Error", "Transfer Carton not available");
      return;
    }

    try {
      setIsSealingTC(true);
      const settings = await getSettings();

      const response = await apiService.sealTransferCarton({
        tc_id: transferCarton,
        sealed_by: settings.user_id || "",
      });

      if (response?.ok !== false) {
        setTcStatus("Sealed");
        setHasSealedTC(true);
        await loadMaterialRequest();
        Alert.alert("Success", "Transfer Carton sealed successfully");
      } else {
        Alert.alert(
          "Error",
          response?.error?.message || "Failed to seal Transfer Carton"
        );
      }
    } catch (error: any) {
      console.error("❌ Failed to seal Transfer Carton:", error);
      Alert.alert("Error", error.message || "Failed to seal Transfer Carton");
    } finally {
      setIsSealingTC(false);
    }
  };

  // Check for existing Transfer Carton for this Material Request
  const checkExistingTC = async () => {
    if (!materialRequestTitle) return;

    try {
      const db = await getDatabase();
      
      // ✅ Step 1: Check backend API first (source of truth)
      let backendTC: any = null;
      try {
        const backendTCs = await apiService.getTransferCartons({
          material_request: materialRequestTitle,
        });
        
        // Handle different response formats
        let tcList: any[] = [];
        if (Array.isArray(backendTCs)) {
          tcList = backendTCs;
        } else if (backendTCs && typeof backendTCs === "object") {
          if (Array.isArray(backendTCs.data)) {
            tcList = backendTCs.data;
          } else if (Array.isArray(backendTCs.items)) {
            tcList = backendTCs.items;
          } else if (Array.isArray(backendTCs.transfer_cartons)) {
            tcList = backendTCs.transfer_cartons;
          }
        }
        
        if (tcList.length > 0) {
          backendTC = tcList[0]; // Use the first TC found
          console.log(`✅ Found Transfer Carton on backend: ${backendTC.tc_id}`);
        } else {
          console.log(`❌ No Transfer Carton found on backend for ${materialRequestTitle}`);
        }
      } catch (backendError: any) {
        console.warn(`⚠️ Could not check backend for Transfer Carton:`, backendError.message);
        // Continue with local cache check as fallback
      }
      
      // ✅ Step 2: Check local cache
      const mrNumber = materialRequestTitle.replace("MR-", "");
      const localTC = await db.getFirstAsync<{ tc_id: string; status: string }>(
        `SELECT tc_id, status FROM tc_cache 
         WHERE to_no = ? OR to_no LIKE ? OR tc_id LIKE ?
         LIMIT 1`,
        [materialRequestTitle, `%${materialRequestTitle}%`, `%MR-${mrNumber}%`]
      );

      // ✅ Step 3: Use backend data if available, otherwise use local cache
      // If backend says no TC exists, clear local cache
      if (backendTC && backendTC.tc_id) {
        const tcId = backendTC.tc_id;
        const tcStatus = backendTC.status || "Created";
        
        setTransferCarton(tcId);
        setHasTransferCarton(true);
        setTcStatus(tcStatus);
        
        // Update local cache with backend data
        await dataService.saveTransferCarton({
          tc_id: tcId,
          asn_no: backendTC.asn_no || "",
          to_no: materialRequestTitle,
          store: backendTC.store || "",
          status: tcStatus,
          updated_on: new Date().toISOString(),
        });
        
        // Check if sealed
        if (tcStatus === "Sealed" || tcStatus === "SEALED") {
        setHasSealedTC(true);
        } else {
          setHasSealedTC(false);
        }
        
        // Check if dispatched
        if (tcStatus === "Dispatched" || tcStatus === "DISPATCHED") {
          setHasDispatchedTC(true);
        } else {
          setHasDispatchedTC(false);
        }
      } else if (localTC && localTC.tc_id) {
        // Backend says no TC, but local cache has one - verify with backend
        try {
          const verifyTC = await apiService.getTransferCarton(localTC.tc_id);
          if (verifyTC && verifyTC.tc_id) {
            // TC exists on backend - use it
            const tcId = verifyTC.tc_id;
            const tcStatus = verifyTC.status || localTC.status || "Created";
            
            setTransferCarton(tcId);
            setHasTransferCarton(true);
            setTcStatus(tcStatus);
            
            if (tcStatus === "Sealed" || tcStatus === "SEALED") {
              setHasSealedTC(true);
            } else {
              setHasSealedTC(false);
            }
            
            if (tcStatus === "Dispatched" || tcStatus === "DISPATCHED") {
              setHasDispatchedTC(true);
            } else {
              setHasDispatchedTC(false);
            }
          } else {
            // TC doesn't exist on backend - clear local cache
            console.log(`🗑️ Transfer Carton ${localTC.tc_id} not found on backend - clearing local cache`);
            await db.runAsync(
              `DELETE FROM tc_cache WHERE tc_id = ?`,
              [localTC.tc_id]
            );
            setTransferCarton(null);
            setHasTransferCarton(false);
            setHasSealedTC(false);
            setHasDispatchedTC(false);
            setTcStatus(null);
          }
        } catch (verifyError: any) {
          // If 404, TC doesn't exist - clear local cache
          if (verifyError.message?.includes("404") || verifyError.message?.includes("not found")) {
            console.log(`🗑️ Transfer Carton ${localTC.tc_id} not found on backend (404) - clearing local cache`);
            await db.runAsync(
              `DELETE FROM tc_cache WHERE tc_id = ?`,
              [localTC.tc_id]
            );
            setTransferCarton(null);
            setHasTransferCarton(false);
            setHasSealedTC(false);
            setHasDispatchedTC(false);
            setTcStatus(null);
          } else {
            // Other error - use local cache as fallback
            console.warn(`⚠️ Could not verify TC with backend, using local cache:`, verifyError.message);
            const tcId = localTC.tc_id;
            setTransferCarton(tcId);
            setHasTransferCarton(true);
            
            if (localTC.status === "Sealed" || localTC.status === "SEALED") {
              setHasSealedTC(true);
            } else {
              setHasSealedTC(false);
            }
            
            if (localTC.status === "Dispatched" || localTC.status === "DISPATCHED") {
          setHasDispatchedTC(true);
            } else {
              setHasDispatchedTC(false);
            }
          }
        }
      } else {
        // No TC found on backend or in local cache - clear all state
        console.log(`❌ No Transfer Carton found for Material Request: ${materialRequestTitle}`);
        setTransferCarton(null);
        setHasSealedTC(false);
        setHasDispatchedTC(false);
        setHasTransferCarton(false);
        setTcStatus(null);
        console.log(`✅ Set hasTransferCarton to false, transferCarton to null`);
      }
    } catch (error: any) {
      console.error(`❌ Error checking for Transfer Carton:`, error);
      // On error, assume no TC exists
      setTransferCarton(null);
      setHasSealedTC(false);
      setHasDispatchedTC(false);
      setHasTransferCarton(false);
      setTcStatus(null);
      console.warn(`⚠️ Error checking existing TC:`, error.message);
      setTransferCarton(null);
      setHasSealedTC(false);
      setHasTransferCarton(false);
    }
  };

  // Dispatch Transfer Carton
  const dispatchTransferCarton = async () => {
    if (!transferCarton) {
      Alert.alert("Error", "No Transfer Carton to dispatch");
      return;
    }

    if (!hasSealedTC) {
      Alert.alert("Error", "Transfer Carton must be sealed before dispatch");
      return;
    }

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
              const dispatchedBy =
                settings.user_id || settings.user_code || undefined;

              console.log("🚚 Dispatching Transfer Carton:", {
                tc_id: transferCarton,
                dispatched_by: dispatchedBy,
                hasSealedTC,
                hasDispatchedTC,
              });

              // Call dispatch API
              await apiService.dispatchTransferCarton({
                tc_id: transferCarton,
                dispatched_by: dispatchedBy,
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

              // Reload Material Request to refresh data
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Draft":
        return "#9E9E9E";
      case "Submitted":
        return "#2196F3";
      case "In Progress":
        return "#FF9800";
      case "Completed":
        return "#4CAF50";
      case "Cancelled":
        return "#F44336";
      default:
        return "#9E9E9E";
    }
  };

  const handleViewStock = async (itemCode: string) => {
    if (!materialRequest) return;

    setSelectedItemCode(itemCode);
    setStockModalVisible(true);
    setLoadingStock(true);
    setStockData([]);

    try {
      console.log(
        `📦 Loading stock for item: ${itemCode} in warehouse: ${materialRequest.from_warehouse}`
      );

      // Fetch stock by item and warehouse
      const response = await apiService.getStockByItemAndWarehouse(
        itemCode,
        materialRequest.from_warehouse
      );

      // Handle 404 (endpoint not found) gracefully
      if (response === null) {
        console.log(
          `ℹ️ Stock item endpoint not found (404) for ${itemCode} - this endpoint may not be implemented yet`
        );
        // Continue with empty stock data - will show mock data if needed
        setStockData([]);
        return;
      }

      console.log(`📦 Stock API response for ${itemCode}:`, {
        responseType: typeof response,
        isArray: Array.isArray(response),
        responseKeys:
          response && typeof response === "object" ? Object.keys(response) : [],
        responsePreview: JSON.stringify(response).substring(0, 200),
      });

      // Handle different response formats
      let stockEntries: any[] = [];
      if (Array.isArray(response)) {
        stockEntries = response;
        console.log(`📦 Response is array with ${stockEntries.length} entries`);
      } else if (response && typeof response === "object") {
        if (Array.isArray(response.data)) {
          stockEntries = response.data;
          console.log(
            `📦 Found stock in response.data: ${stockEntries.length} entries`
          );
        } else if (Array.isArray(response.stock)) {
          stockEntries = response.stock;
          console.log(
            `📦 Found stock in response.stock: ${stockEntries.length} entries`
          );
        } else if (Array.isArray(response.locations)) {
          stockEntries = response.locations;
          console.log(
            `📦 Found stock in response.locations: ${stockEntries.length} entries`
          );
        } else if (Array.isArray(response.stock_ledger)) {
          stockEntries = response.stock_ledger;
          console.log(
            `📦 Found stock in response.stock_ledger: ${stockEntries.length} entries`
          );
        } else if (response.location_id || response.bin_location) {
          // Single location response
          stockEntries = [response];
          console.log(`📦 Response is single location object`);
        } else {
          console.warn(
            `⚠️ Unknown response format, keys:`,
            Object.keys(response)
          );
        }
      } else {
        console.warn(`⚠️ Unexpected response type:`, typeof response);
      }

      console.log(
        `📦 Raw stock entries (${stockEntries.length}):`,
        JSON.stringify(stockEntries, null, 2).substring(0, 1000)
      );
      
      // ✅ Enhanced logging: Show first entry's bin_location value in detail
      if (stockEntries.length > 0) {
        console.log(
          `🔍 DEBUG: First entry bin_location:`,
          JSON.stringify({
            raw_bin_location: stockEntries[0].bin_location,
            type: typeof stockEntries[0].bin_location,
            length: stockEntries[0].bin_location?.length,
            full_entry: stockEntries[0],
          }, null, 2)
        );
      }

      // Check format: grouped (has cartons array) vs flat (has carton_id directly)
      const isGroupedFormat = stockEntries.length > 0 && 
        stockEntries[0].bin_location && 
        Array.isArray(stockEntries[0].cartons) &&
        stockEntries[0].total_qty !== undefined;
      
      const isFlatFormatWithCartonId = stockEntries.length > 0 && 
        (stockEntries[0].carton_id || stockEntries[0].carton_ID || stockEntries[0].Carton_ID);

      console.log(`📦 Detected format: ${isGroupedFormat ? "Grouped (bin_location + cartons)" : isFlatFormatWithCartonId ? "Flat (location_id + carton_id)" : "Legacy (location_id + qty)"}`);

      let formattedStock: Array<{
        location_id: string;
        qty: number;
        cartons?: Array<{ carton_id: string; qty: number }>;
      }> = [];

      if (isGroupedFormat) {
        // New grouped format: { bin_location, cartons: [{ carton_id, qty }], total_qty }
        formattedStock = stockEntries
          .filter((entry) => {
            const hasLocation = entry && entry.bin_location;
            if (!hasLocation) {
              console.warn(`⚠️ Entry missing bin_location:`, entry);
            }
            return hasLocation;
          })
          .map((entry) => {
            const locationId = entry.bin_location || "Unknown";
            const totalQty = entry.total_qty || 0;
            const cartons = Array.isArray(entry.cartons) ? entry.cartons : [];

            console.log(
              `📦 Processing grouped entry:`,
              JSON.stringify({
                bin_location: entry.bin_location,
                locationId: locationId,
                total_qty: totalQty,
                cartons_count: cartons.length,
                entry_keys: Object.keys(entry),
              }, null, 2)
            );

            return {
              location_id: locationId,
              qty: totalQty,
              cartons: cartons,
            };
          })
          .filter((entry) => {
            const hasQty = entry.qty > 0;
            if (!hasQty) {
              console.warn(`⚠️ Entry has zero qty:`, entry);
            }
            return hasQty;
          })
          .sort((a, b) => b.qty - a.qty); // Sort by quantity descending
      } else if (isFlatFormatWithCartonId) {
        // ✅ NEW: Flat format with carton_id directly on each entry
        // Group entries by location_id and collect cartons
        const locationMap = new Map<string, {
          location_id: string;
          qty: number;
          cartons: Array<{ carton_id: string; qty: number }>;
        }>();

        stockEntries.forEach((entry) => {
          // Try multiple field names for location
          const locationId =
            entry.location_id ||
            entry.bin_location ||
            entry.Location_ID ||
            entry.Bin_Location ||
            (entry.zone && entry.aisle && entry.rack && entry.level && entry.bin
              ? `${entry.zone}-${entry.aisle}-${entry.rack}-${entry.level}-${entry.bin}`
              : null) ||
            "Unknown";

          // Try multiple field names for carton_id
          const cartonId =
            entry.carton_id ||
            entry.carton_ID ||
            entry.Carton_ID ||
            entry.cartonId ||
            null;

          // Try multiple field names for quantity
          const qty =
            entry.qty ||
            entry.quantity ||
            entry.available_qty ||
            entry.Available_Qty ||
            entry.stock_qty ||
            entry.stock_quantity ||
            entry.available_quantity ||
            entry.total_qty ||
            0;

          if (!locationId || locationId === "Unknown") {
            console.warn(`⚠️ Entry missing location:`, entry);
            return;
          }

          if (qty <= 0) {
            console.warn(`⚠️ Entry has zero qty:`, entry);
            return;
          }

          // Get or create location entry
          if (!locationMap.has(locationId)) {
            locationMap.set(locationId, {
              location_id: locationId,
              qty: 0,
              cartons: [],
            });
          }

          const locationEntry = locationMap.get(locationId)!;
          
          // Add carton if carton_id exists
          if (cartonId) {
            locationEntry.cartons.push({
              carton_id: cartonId,
              qty: qty,
            });
          }
          
          // Add to total qty
          locationEntry.qty += qty;

          console.log(
            `📦 Processing flat entry with carton_id: location=${locationId}, carton_id=${cartonId}, qty=${qty}`
          );
        });

        formattedStock = Array.from(locationMap.values())
          .sort((a, b) => b.qty - a.qty); // Sort by quantity descending
      } else {
        // Legacy format: { location_id, qty } - no carton_id
        formattedStock = stockEntries
          .filter((entry) => {
            const hasLocation =
              entry && (entry.location_id || entry.bin_location);
            if (!hasLocation) {
              console.warn(`⚠️ Entry missing location:`, entry);
            }
            return hasLocation;
          })
          .map((entry) => {
            // Try multiple field names for location
            const locationId =
              entry.location_id ||
              entry.bin_location ||
              entry.bin ||
              entry.location ||
              (entry.zone && entry.aisle && entry.rack && entry.level && entry.bin
                ? `${entry.zone}-${entry.aisle}-${entry.rack}-${entry.level}-${entry.bin}`
                : null) ||
              "Unknown";

            // Try multiple field names for quantity
            const qty =
              entry.qty ||
              entry.quantity ||
              entry.available_qty ||
              entry.stock_qty ||
              entry.stock_quantity ||
              entry.available_quantity ||
              entry.total_qty ||
              0;

            console.log(
              `📦 Processing legacy entry: location=${locationId}, qty=${qty}`
            );

            return {
              location_id: locationId,
              qty: qty,
            };
          })
          .filter((entry) => {
            const hasQty = entry.qty > 0;
            if (!hasQty) {
              console.warn(`⚠️ Entry has zero qty:`, entry);
            }
            return hasQty;
          })
          .sort((a, b) => b.qty - a.qty); // Sort by quantity descending
      }

      console.log(
        `📦 Formatted stock (${formattedStock.length} with qty > 0):`,
        JSON.stringify(formattedStock).substring(0, 500)
      );

      if (formattedStock.length === 0) {
        console.warn(`⚠️ No stock found for ${itemCode}`);
      }

      setStockData(formattedStock);
      console.log(
        `✅ Loaded ${formattedStock.length} stock locations for ${itemCode}`
      );
    } catch (error: any) {
      console.error("❌ Error loading stock:", error);

      // Show mock data on error for demo purposes
      setStockData([
        { location_id: "A1-R01-L1-B1", qty: 15 },
        { location_id: "B2-R02-L2-B3", qty: 10 },
        { location_id: "C3-R03-L3-B5", qty: 5 },
      ]);

      Alert.alert(
        "Stock Information",
        "Using sample data. Please check your connection if stock locations are not showing correctly."
      );
    } finally {
      setLoadingStock(false);
    }
  };

  const renderItem = ({
    item,
  }: {
    item: {
      item_code: string;
      requested_qty: number;
      picked_qty?: number;
      pending_qty?: number;
      status?: string;
      item_name?: string;
      description?: string;
    };
  }) => {
    const pickedQty = item.picked_qty || 0;
    const pendingQty =
      item.pending_qty !== undefined
        ? item.pending_qty
        : item.requested_qty - pickedQty;
    const remainingQty = pendingQty;
    const progress =
      item.requested_qty > 0 ? (pickedQty / item.requested_qty) * 100 : 0;
    const itemDescription = item.item_name || item.description || "";

    // Use item.status from API if available, otherwise calculate from picked_qty
    let itemStatus: "Pending" | "In Progress" | "Picked" = "Pending";
    if (item.status) {
      itemStatus = item.status as "Pending" | "In Progress" | "Picked";
    } else {
      // Calculate status based on picked_qty
      if (pickedQty === 0) {
        itemStatus = "Pending";
      } else if (pickedQty >= item.requested_qty) {
        itemStatus = "Picked";
      } else {
        itemStatus = "In Progress";
      }
    }

    return (
      <View style={styles.itemCard}>
        <View style={styles.itemHeader}>
          <View style={styles.itemHeaderTop}>
            <Text
              style={styles.itemCode}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {item.item_code}
            </Text>
            {itemDescription ? (
              <Text
                style={styles.itemDescription}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {itemDescription}
              </Text>
            ) : null}
          </View>
          <View style={styles.itemHeaderBottom}>
            <TouchableOpacity
              style={styles.viewStockButton}
              onPress={() => handleViewStock(item.item_code)}
            >
              <Text style={styles.viewStockButtonText}>📍 Locations</Text>
            </TouchableOpacity>
            <StatusBadge status={itemStatus} />
          </View>
        </View>
        <View style={styles.itemDetails}>
          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>Requested:</Text>
            <Text style={styles.qtyValue}>{item.requested_qty}</Text>
          </View>
          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>Picked:</Text>
            <Text style={[styles.qtyValue, { color: "#4CAF50" }]}>
              {pickedQty}
            </Text>
          </View>
          <View style={styles.qtyRow}>
            <Text style={styles.qtyLabel}>Pending:</Text>
            <Text
              style={[
                styles.qtyValue,
                { color: remainingQty > 0 ? "#FF9800" : "#4CAF50" },
              ]}
            >
              {pendingQty}
            </Text>
          </View>
          <View style={styles.progressBarContainer}>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${progress}%`,
                    backgroundColor: progress === 100 ? "#4CAF50" : "#2196F3",
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>{Math.round(progress)}%</Text>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
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
  const overallProgress =
    totalRequestedQty > 0 ? (totalPickedQty / totalRequestedQty) * 100 : 0;

  // Sort items: in-progress (pending > 0) first, completed (pending = 0) at bottom
  // Use item.status if available, otherwise calculate from pending_qty
  const sortedItems = [...(materialRequest.items || [])].sort((a, b) => {
    const aPicked = a.picked_qty || 0;
    const bPicked = b.picked_qty || 0;
    const aPending =
      a.pending_qty !== undefined ? a.pending_qty : a.requested_qty - aPicked;
    const bPending =
      b.pending_qty !== undefined ? b.pending_qty : b.requested_qty - bPicked;

    // Get status from item or calculate
    const aStatus =
      a.status ||
      (aPending === 0 ? "Picked" : aPicked === 0 ? "Pending" : "In Progress");
    const bStatus =
      b.status ||
      (bPending === 0 ? "Picked" : bPicked === 0 ? "Pending" : "In Progress");

    // In-progress items (pending > 0) come first
    if (aPending > 0 && bPending === 0) return -1;
    if (aPending === 0 && bPending > 0) return 1;

    // Within same status, sort by pending qty (higher first)
    return bPending - aPending;
  });

  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{materialRequest.title}</Text>
        <View style={styles.statusContainer}>
          <StatusBadge status={materialRequest.status || "Unknown"} />
          {/* Dispatch Button - Show when status is "Picked" and TC is sealed */}
          {materialRequest.status?.toLowerCase() === "picked" &&
            hasSealedTC &&
            !hasDispatchedTC && (
              <TouchableOpacity
                style={[
                  styles.dispatchButtonUnderStatus,
                  isDispatching && styles.buttonDisabled,
                ]}
                onPress={dispatchTransferCarton}
                disabled={isDispatching || hasDispatchedTC}
              >
                {isDispatching ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.dispatchButtonUnderStatusText}>
                    🚚 Dispatch
                  </Text>
                )}
              </TouchableOpacity>
            )}
        </View>
      </View>

      {/* Dynamic Workflow Button - Single button for entire workflow */}
      {(() => {
        const status = materialRequest.status || "";
        let buttonText = "";
        let buttonAction: (() => void) | null = null;
        let isDisabled = false;
        let isLoading = false;

        if (status === "Submitted" || status === "Draft") {
          buttonText = "Start Picking";
          buttonAction = handleStartPicking;
          isLoading = isSubmitting;
        } else if (status === "In Progress") {
          if (pickingStatus?.all_items_fully_picked) {
            buttonText = "Complete Picking";
            buttonAction = handleCompletePicking;
            isLoading = isCompletingPicking;
          } else {
            // ✅ Show "Resume Picking" button (enabled) - ALWAYS start from Bin scanning
            // ❌ DO NOT use cached bin_location or carton_id - always require fresh scan
            buttonText = "Resume Picking";
            buttonAction = async () => {
              // Clear session's bin_location and carton_id to force fresh scanning
              const session = await pickingSessionService.loadSession(materialRequest.title);
              if (session) {
                // Clear bin_location and carton_id from session to force fresh scans
                const clearedSession: PickingSession = {
                  ...session,
                  bin_location: null,
                  carton_id: null,
                  status: "In Progress",
                  updated_at: new Date().toISOString(),
                };
                await pickingSessionService.saveSession(clearedSession);
              }
              
              // Always start from Bin scanning screen - require fresh Location ID scan
              (navigation as any).navigate("PickingScanBin", {
                materialRequestTitle: materialRequest.title,
              });
            };
            // Button is enabled - user can click to resume picking
          }
        } else if (status === "Picked") {
          // When status is "Picked", check if Transfer Carton exists
          // If no TC exists, show "Create Transfer Carton" button
          console.log(`🔍 Button Logic - Status: ${status}, hasTransferCarton: ${hasTransferCarton}, transferCarton: ${transferCarton}, tcStatus: ${tcStatus}`);
          
          if (!hasTransferCarton && !transferCarton) {
            console.log(`✅ Showing "Create Transfer Carton" button`);
            buttonText = "Create Transfer Carton";
            buttonAction = handleCreateTransferCarton;
            isLoading = isCreatingTC;
          } else if (tcStatus === "Created" || tcStatus === "Open") {
            console.log(`✅ Showing "Seal Transfer Carton" button`);
            buttonText = "Seal Transfer Carton";
            buttonAction = handleSealTransferCarton;
            isLoading = isSealingTC;
          } else if (tcStatus === "Sealed" || tcStatus === "SEALED") {
            // Show Dispatch button when TC is sealed
            console.log(`✅ Showing "Dispatch" button`);
            buttonText = "🚚 Dispatch";
            buttonAction = dispatchTransferCarton;
            isLoading = isDispatching;
            isDisabled = hasDispatchedTC;
          } else {
            // Fallback: if status is "Picked" but TC state is unclear, still show "Create Transfer Carton"
            // This ensures the button always shows when status is "Picked"
            console.log(`⚠️ Status is "Picked" but TC state unclear (hasTransferCarton: ${hasTransferCarton}, transferCarton: ${transferCarton}, tcStatus: ${tcStatus}) - showing "Create Transfer Carton" as fallback`);
            buttonText = "Create Transfer Carton";
            buttonAction = handleCreateTransferCarton;
            isLoading = isCreatingTC;
          }
        } else {
          // If status is not recognized, log it
          console.log(`⚠️ Unknown status: ${status}`);
        }

        if (!buttonText) {
          console.log(`⚠️ No button text set - status: ${status}, hasTransferCarton: ${hasTransferCarton}, transferCarton: ${transferCarton}`);
          return null;
        }
        
        console.log(`✅ Rendering button: "${buttonText}" for status: ${status}`);

        return (
        <View style={styles.actionSection}>
          <TouchableOpacity
              style={[
                styles.submitButton,
                (isDisabled || isLoading) && styles.buttonDisabled,
              ]}
              onPress={buttonAction || undefined}
              disabled={isDisabled || isLoading}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={styles.submitButtonText}>{buttonText}</Text>
              )}
          </TouchableOpacity>
            {hasTransferCarton && transferCarton && (
              <Text style={styles.submitButtonSubtext}>
                Transfer Carton: {transferCarton}
              </Text>
            )}
            {status === "In Progress" && pickingStatus && (
              <Text style={styles.submitButtonSubtext}>
                Progress: {pickingStatus.fully_picked_items} of {pickingStatus.total_items} items fully picked
              </Text>
            )}
          </View>
        );
      })()}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Request Information</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>From Warehouse:</Text>
          <Text style={styles.infoValue}>{materialRequest.from_warehouse}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>To Showroom:</Text>
          <Text style={styles.infoValue}>{materialRequest.to_showroom}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Request Date:</Text>
          <Text style={styles.infoValue}>
            {materialRequest.request_date
              ? new Date(materialRequest.request_date).toLocaleDateString()
              : "N/A"}
          </Text>
        </View>
        {materialRequest.required_date && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Required Date:</Text>
            <Text style={styles.infoValue}>
              {new Date(materialRequest.required_date).toLocaleDateString()}
            </Text>
          </View>
        )}
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Requested By:</Text>
          <Text style={styles.infoValue}>
            {materialRequest.requested_by || "N/A"}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Progress Summary</Text>
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Items:</Text>
            <Text style={styles.summaryValue}>{totalItems}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Requested:</Text>
            <Text style={styles.summaryValue}>{totalRequestedQty}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Picked:</Text>
            <Text style={[styles.summaryValue, { color: "#4CAF50" }]}>
              {totalPickedQty}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Remaining:</Text>
            <Text style={[styles.summaryValue, { color: "#FF9800" }]}>
              {totalRequestedQty - totalPickedQty}
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

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Items ({totalItems})</Text>
        <FlatList
          data={sortedItems}
          keyExtractor={(item, index) => `${item.item_code}-${index}`}
          renderItem={renderItem}
          scrollEnabled={false}
        />
      </View>

      {/* Stock Locations Modal */}
      <Modal
        visible={stockModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setStockModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Stock Locations - {selectedItemCode}
              </Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setStockModalVisible(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {loadingStock ? (
              <View style={styles.modalLoadingContainer}>
                <ActivityIndicator size="large" color="#FF9800" />
                <Text style={styles.modalLoadingText}>
                  Loading stock locations...
                </Text>
              </View>
            ) : stockData.length === 0 ? (
              <View style={styles.modalEmptyContainer}>
                <Text style={styles.modalEmptyText}>
                  No stock available for this item
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.modalContent}>
                <View style={styles.stockListHeader}>
                  <Text style={[styles.stockListHeaderText, { flex: 1 }]}>
                    Bin Location
                  </Text>
                  <Text style={[styles.stockListHeaderText, { width: 80, textAlign: "right" }]}>
                    Total Qty
                  </Text>
                </View>
                <FlatList
                  data={stockData}
                  keyExtractor={(item, index) => `${item.location_id}-${index}`}
                  renderItem={({ item }) => {
                    const hasCartons = item.cartons && item.cartons.length > 0;
                    
                    return (
                      <View style={styles.stockListItem}>
                        <View style={styles.stockListLocationContainer}>
                          <Text 
                            style={styles.stockListLocation}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            {item.location_id}
                          </Text>
                          {hasCartons && item.cartons && item.cartons.length > 0 ? (
                            <View style={styles.cartonsList}>
                              {item.cartons.map((carton, cartonIdx) => (
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
                        <Text style={styles.stockListQty}>{item.qty}</Text>
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
    </ScrollView>
    <ScreenFooterFrame />
    </View>
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#FF9800",
    flex: 1,
  },
  statusContainer: {
    alignItems: "flex-end",
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
  buttonDisabled: {
    opacity: 0.5,
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
  infoRow: {
    flexDirection: "row",
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 14,
    color: "#666",
    width: 120,
  },
  infoValue: {
    fontSize: 14,
    color: "#000",
    flex: 1,
    fontWeight: "500",
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
    overflow: "visible",
  },
  itemHeader: {
    marginBottom: 8,
    width: "100%",
  },
  itemHeaderTop: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  itemHeaderBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  viewStockButton: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    minWidth: 75,
    maxWidth: 90,
  },
  viewStockButtonText: {
    color: "#FFF",
    fontSize: 10,
    fontWeight: "600",
    textAlign: "center",
  },
  itemCode: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginRight: 8,
  },
  itemDescription: {
    fontSize: 14,
    color: "#666",
    flex: 1,
    fontStyle: "italic",
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
  actionSection: {
    padding: 16,
    paddingBottom: 8,
  },
  startButton: {
    backgroundColor: "#FF9800",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  startButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  submitButton: {
    backgroundColor: "#4CAF50",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  submitButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  submitButtonSubtext: {
    color: "#666",
    fontSize: 12,
    marginTop: 8,
    textAlign: "center",
  },
  // Stock Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    width: "90%",
    maxHeight: "80%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
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
    flex: 1,
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 16,
    backgroundColor: "#F5F5F5",
  },
  modalCloseText: {
    fontSize: 20,
    color: "#666",
    fontWeight: "bold",
  },
  modalContent: {
    padding: 16,
  },
  modalLoadingContainer: {
    padding: 40,
    alignItems: "center",
  },
  modalLoadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
  },
  modalEmptyContainer: {
    padding: 40,
    alignItems: "center",
  },
  modalEmptyText: {
    fontSize: 14,
    color: "#666",
  },
  stockListHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: "#F5F5F5",
    borderRadius: 6,
    marginBottom: 6,
  },
  stockListHeaderText: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#333",
  },
  stockListItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  stockListLocationContainer: {
    flex: 1,
    marginRight: 8,
  },
  stockListLocation: {
    fontSize: 14,
    color: "#333",
    fontWeight: "500",
    marginBottom: 4,
  },
  cartonsList: {
    marginTop: 2,
    marginLeft: 4,
  },
  cartonIdUnderLocation: {
    fontSize: 12,
    color: "#2196F3",
    fontWeight: "400",
    marginBottom: 2,
  },
  stockListQty: {
    fontSize: 14,
    color: "#4CAF50",
    fontWeight: "bold",
    width: 80,
    textAlign: "right",
    marginTop: 2,
  },
});
