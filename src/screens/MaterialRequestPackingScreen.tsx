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
} from "react-native";
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
import { addEvent } from "../services/event-queue.service";
import { getSettings } from "../services/settings.service";
import { getDatabase } from "../database/database";
import { MaterialRequest } from "../types";
import { resolveItemFromBarcode } from "../services/item-master.service";

type ScanWorkflowState = "SCAN_LOCATION" | "SCAN_ITEM";

interface ScannedItem {
  location_id: string;
  item_code: string;
  item_name?: string;
  qty: number;
  timestamp: string;
}

export default function MaterialRequestPackingScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { materialRequestTitle } = (route.params as any) || {};
  const { activeASN, activeSession } = useApp();
  const [materialRequest, setMaterialRequest] =
    useState<MaterialRequest | null>(null);
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [transferCarton, setTransferCarton] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<any[]>([]);
  const [packedBoxes, setPackedBoxes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSealing, setIsSealing] = useState(false);
  const [hasSealedTC, setHasSealedTC] = useState(false);
  const [isDispatching, setIsDispatching] = useState(false);
  const [hasDispatchedTC, setHasDispatchedTC] = useState(false);

  // Scanning state
  const [scanWorkflow, setScanWorkflow] =
    useState<ScanWorkflowState>("SCAN_LOCATION");
  const [currentLocation, setCurrentLocation] = useState<string>("");
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const lastScannedRef = useRef<{ barcode: string; timestamp: number } | null>(
    null
  );

  // Edit quantity modal state
  const [editQtyModal, setEditQtyModal] = useState<{
    visible: boolean;
    index: number;
    item: ScannedItem | null;
    currentQty: number;
  } | null>(null);
  const [editQtyValue, setEditQtyValue] = useState("");
  const lastTapTimeRef = useRef<number>(0);

  // TC Items modal state
  const [tcItemsModal, setTcItemsModal] = useState<{
    visible: boolean;
    items: Array<{
      item_code: string;
      item_name?: string;
      requested_qty: number;
      scanned_qty: number;
    }>;
  } | null>(null);
  const lastTCTapTimeRef = useRef<number>(0);

  // Load Material Request details and restore scanned items
  useEffect(() => {
    if (materialRequestTitle) {
      loadMaterialRequest();
      loadScannedItems();
    }
  }, [materialRequestTitle]);

  // Load scanned items from event queue when screen is focused
  useFocusEffect(
    React.useCallback(() => {
      if (materialRequestTitle) {
        loadScannedItems();
      }
    }, [materialRequestTitle])
  );

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
        console.log(`✅ Material Request loaded: ${mr.title}`);
        // Calculate picked quantities to get accurate status for each item
        const mrWithPickedQty = await calculatePickedQuantities(mr);
        setMaterialRequest(mrWithPickedQty);
        setSelectedStore(mr.to_showroom || "");
        // Check for existing Transfer Carton
        await checkExistingTC(mr.to_showroom);
      } else {
        // Fallback to cache
        console.log(`⚠️ Material Request not found in API, checking cache...`);
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
          console.error(
            `❌ Material Request not found: ${materialRequestTitle}`
          );
          Alert.alert(
            "Error",
            `Material Request ${materialRequestTitle} not found`
          );
          navigation.goBack();
        }
      }
    } catch (error: any) {
      console.error("❌ Error loading Material Request:", error);

      // Fallback to cache on error
      try {
        console.log(
          `⚠️ API error, checking cache for: ${materialRequestTitle}`
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

  // Calculate picked quantities from event queue (same logic as Detail screen)
  const calculatePickedQuantities = async (mr: any): Promise<any> => {
    if (!mr || !mr.title) return mr;

    try {
      const db = await getDatabase();

      // Get all picked items from event queue for this Material Request
      // Count ALL picked items regardless of whether they're packed into a TC or not
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

      // Create sets for quick lookup
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

        return {
          ...item,
          picked_qty: pickedQty,
          pending_qty: pendingQty,
          status: itemStatus,
        };
      });

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
          AND event_type = 'PACK_BOX_TO_TC'
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
      // 2. Packed into the current TC (if one exists)
      // 3. Packed into other unsealed TCs (for reference, but should be rare)
      // Exclude items that are in a sealed/dispatched Transfer Carton
      const events = await db.getAllAsync<{
        item_code: string;
        qty: number;
        rack: string | null;
        bin: string | null;
        event_time: string;
        tc_id: string | null;
      }>(
        `SELECT 
          e.item_code, 
          SUM(e.qty) as qty,
          e.rack,
          e.bin,
          MAX(e.event_time) as event_time,
          e.tc_id
        FROM event_queue e
        LEFT JOIN tc_cache tc ON e.tc_id = tc.tc_id
        WHERE e.material_request = ? 
          AND e.event_type = 'PACK_BOX_TO_TC'
          AND (
            e.tc_id IS NULL 
            OR e.tc_id = ? 
            OR (tc.status IS NULL OR tc.status NOT IN ('Sealed', 'SEALED', 'Dispatched', 'DISPATCHED'))
          )
        GROUP BY e.item_code, e.rack, e.bin, e.tc_id
        ORDER BY e.event_time DESC`,
        [materialRequestTitle, transferCarton || null]
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

        // Convert events to ScannedItem format
        const restoredItems: ScannedItem[] = events.map((event) => {
          // Use rack/bin as location_id, or create a default location
          const locationId = event.rack || event.bin || "UNKNOWN";

          return {
            location_id: locationId,
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
          `✅ Restored ${finalItems.length} scanned item(s) to state`
        );
      } else {
        console.log(
          `ℹ️ No scanned items found in event queue for ${materialRequestTitle}`
        );
        // Don't clear existing items if we're just refreshing
        // Only clear if we're loading for the first time
        if (scannedItems.length === 0) {
          setScannedItems([]);
        }
      }
    } catch (error: any) {
      console.error("❌ Error loading scanned items:", error);
      // Don't show alert - this is a background operation
    }
  };

  // Check for existing Transfer Carton for this Material Request
  const checkExistingTC = async (store: string) => {
    if (!materialRequestTitle || !store) return;

    try {
      const db = await getDatabase();
      // Check event_queue for existing TC for this Material Request
      const existingEvents = await db.getAllAsync<{ tc_id: string }>(
        `SELECT DISTINCT tc_id FROM event_queue 
         WHERE material_request = ? AND tc_id IS NOT NULL
         LIMIT 1`,
        [materialRequestTitle]
      );

      if (existingEvents.length > 0 && existingEvents[0].tc_id) {
        const tcId = existingEvents[0].tc_id;
        console.log(`📦 Found existing Transfer Carton: ${tcId}`);
        setTransferCarton(tcId);

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
      } else {
        // Try to find from backend
        try {
          const backendTCs = await apiService.getTransferCartons({
            store,
          });
          const mrTC = Array.isArray(backendTCs)
            ? backendTCs.find(
                (tc: any) =>
                  tc.material_request === materialRequestTitle ||
                  (tc.tc_id && tc.tc_id.includes(materialRequestTitle))
              )
            : null;

          if (mrTC && mrTC.tc_id) {
            console.log(`📦 Found Transfer Carton from backend: ${mrTC.tc_id}`);
            setTransferCarton(mrTC.tc_id);
            if (mrTC.status === "Sealed" || mrTC.status === "SEALED") {
              setHasSealedTC(true);
            }
            if (mrTC.status === "Dispatched" || mrTC.status === "DISPATCHED") {
              setHasDispatchedTC(true);
            }
          }
        } catch (error: any) {
          console.log(
            `ℹ️ Could not fetch Transfer Cartons from backend: ${error.message}`
          );
        }
      }
    } catch (error: any) {
      console.warn(`⚠️ Error checking existing TC:`, error.message);
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
          AND event_type = 'PACK_BOX_TO_TC'
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

        // ✅ Update all existing events that don't have tc_id to include the new TC ID
        let updatedEventCount = 0;
        try {
          const db = await getDatabase();
          const updateResult = await db.runAsync(
            `UPDATE event_queue 
             SET tc_id = ?
             WHERE material_request = ? 
               AND event_type = 'PACK_BOX_TO_TC'
               AND tc_id IS NULL`,
            [createdTCId, materialRequestTitle]
          );
          updatedEventCount = updateResult.changes || 0;
          console.log(
            `✅ Updated ${updatedEventCount} existing event(s) with tc_id: ${createdTCId}`
          );
        } catch (updateError: any) {
          console.warn(
            `⚠️ Failed to update existing events with tc_id:`,
            updateError.message
          );
          // Don't block TC creation if event update fails
        }

        // Note: All unpacked items are automatically associated with the new TC
        // via the UPDATE query above, so no need to ask the user to pack them
        // Show success message with count of items automatically packed
        const itemsPackedMessage =
          updatedEventCount > 0
            ? `\n\n${updatedEventCount} item(s) automatically packed into this Transfer Carton.`
            : "";
        Alert.alert(
          "Success",
          `Transfer Carton ${createdTCId} created successfully.${itemsPackedMessage}`
        );

        // Reload scanned items to reflect the new TC association
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
             AND event_type = 'PACK_BOX_TO_TC'
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

      // Create PACK_BOX_TO_TC event
      await addEvent({
        event_type: "PACK_BOX_TO_TC",
        material_request: materialRequestTitle,
        box_id: boxId,
        tc_id: transferCarton,
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
           AND event_type = 'PACK_BOX_TO_TC'`,
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
                dispatched_by:
                  settings.user_id || settings.user_code || undefined,
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
        status,
        {
          picked_by: settings.user_id,
          picked_on: new Date().toISOString(),
        }
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
          console.warn(
            `⚠️ Error checking stock for ${mrItem.item_code}:`,
            itemError.message
          );
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
      setScanWorkflow("SCAN_ITEM");
      Alert.alert(
        "Location Set",
        `Location: ${location}\n\nValid items at this location: ${validItems.join(
          ", "
        )}\n\nNow scan item barcode or item code.`
      );
    } catch (error: any) {
      console.error("❌ Error validating location:", error);
      Alert.alert(
        "Validation Error",
        `Failed to validate location: ${error.message}\n\nPlease try again or contact support.`
      );
    }
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

      // Check if already scanned
      const existingIndex = scannedItems.findIndex(
        (si) => si.location_id === currentLocation && si.item_code === itemCode
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

        // Save to event queue for persistence
        // Backend requires event_type to be "PACK_BOX_TO_TC" or "SORT_TO_BOX" for Material Request picking
        try {
          const settings = await getSettings();
          await addEvent({
            event_type: "PACK_BOX_TO_TC", // Backend only processes SORT_TO_BOX or PACK_BOX_TO_TC for MR picking
            material_request: materialRequestTitle,
            to_no: materialRequestTitle, // transfer_order field for Material Request
            item_code: itemCode,
            qty: 1,
            rack: currentLocation,
            bin: currentLocation,
            source_bin: currentLocation, // Direct source_bin field for backend
            location_id: currentLocation, // Alternative location field
            store: selectedStore || materialRequest?.to_showroom || "",
            device_id: settings.device_id,
            user_id: settings.user_id,
            tc_id: transferCarton || undefined, // ✅ Include tc_id if Transfer Carton exists
          });
          console.log(
            `✅ Saved pick event for ${itemCode} to event queue (PACK_BOX_TO_TC)${
              transferCarton ? ` with tc_id: ${transferCarton}` : ""
            }`
          );
        } catch (eventError: any) {
          console.warn(`⚠️ Failed to save pick event:`, eventError.message);
          // Don't block the user - item is still scanned in state
        }

        Alert.alert(
          "Item Updated",
          `${itemCode} (${itemName})\n\n` +
            `Requested: ${requestedQty}\n` +
            `Scanned: ${newTotalScanned}\n` +
            `Remaining: ${remainingQty}`
        );
      } else {
        // Add new scanned item
        const newItem: ScannedItem = {
          location_id: currentLocation,
          item_code: itemCode,
          item_name: itemName,
          qty: 1,
          timestamp: new Date().toISOString(),
        };
        setScannedItems([...scannedItems, newItem]);

        // Save to event queue for persistence
        // Backend requires event_type to be "PACK_BOX_TO_TC" or "SORT_TO_BOX" for Material Request picking
        try {
          const settings = await getSettings();
          await addEvent({
            event_type: "PACK_BOX_TO_TC", // Backend only processes SORT_TO_BOX or PACK_BOX_TO_TC for MR picking
            material_request: materialRequestTitle,
            to_no: materialRequestTitle, // transfer_order field for Material Request
            item_code: itemCode,
            qty: 1,
            rack: currentLocation,
            bin: currentLocation,
            source_bin: currentLocation, // Direct source_bin field for backend
            location_id: currentLocation, // Alternative location field
            store: selectedStore || materialRequest?.to_showroom || "",
            device_id: settings.device_id,
            user_id: settings.user_id,
          });
          console.log(
            `✅ Saved pick event for ${itemCode} to event queue (PACK_BOX_TO_TC)`
          );
        } catch (eventError: any) {
          console.warn(`⚠️ Failed to save pick event:`, eventError.message);
          // Don't block the user - item is still scanned in state
        }

        Alert.alert(
          "Item Scanned",
          `${itemCode} (${itemName})\n` +
            `Location: ${currentLocation}\n\n` +
            `Requested: ${requestedQty}\n` +
            `Scanned: ${newTotalScanned}\n` +
            `Remaining: ${remainingQty}`
        );
      }

      // Check if all requested items are scanned
      if (newTotalScanned >= requestedQty) {
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

  // Edit scanned item quantity
  const handleEditQty = (index: number) => {
    const item = scannedItems[index];
    if (!item) return;

    setEditQtyModal({
      visible: true,
      index,
      item,
      currentQty: item.qty,
    });
    setEditQtyValue(String(item.qty));
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

    if (newQty === editQtyModal.currentQty) {
      setEditQtyModal(null);
      setEditQtyValue("");
      return;
    }

    const item = editQtyModal.item;
    const index = editQtyModal.index;

    try {
      const updated = [...scannedItems];
      updated[index] = {
        ...updated[index],
        qty: newQty,
        timestamp: new Date().toISOString(),
      };
      setScannedItems(updated);

      const db = await getDatabase();
      const settings = await getSettings();

      await db.runAsync(
        `DELETE FROM event_queue 
         WHERE material_request = ? 
           AND item_code = ? 
           AND (rack = ? OR bin = ? OR source_bin = ?)
           AND tc_id IS NULL
           AND event_type = 'PACK_BOX_TO_TC'`,
        [
          materialRequestTitle,
          item.item_code,
          item.location_id,
          item.location_id,
        ]
      );

      for (let i = 0; i < newQty; i++) {
        await addEvent({
          event_type: "PACK_BOX_TO_TC", // Backend only processes SORT_TO_BOX or PACK_BOX_TO_TC for MR picking
          material_request: materialRequestTitle,
          to_no: materialRequestTitle, // transfer_order field for Material Request
          item_code: item.item_code,
          qty: 1,
          rack: item.location_id,
          bin: item.location_id,
          source_bin: item.location_id, // Direct source_bin field for backend
          location_id: item.location_id, // Alternative location field
          store: selectedStore || materialRequest?.to_showroom || "",
          device_id: settings.device_id,
          user_id: settings.user_id,
          tc_id: transferCarton || undefined, // ✅ Include tc_id if Transfer Carton exists
        });
      }

      console.log(
        `✅ Updated quantity for ${item.item_code} from ${editQtyModal.currentQty} to ${newQty}`
      );
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
           AND e.event_type = 'PACK_BOX_TO_TC'
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
                   AND event_type = 'PACK_BOX_TO_TC'
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
                   AND event_type = 'PACK_BOX_TO_TC'
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

  return (
    <ScrollView style={styles.container}>
      {/* Material Request Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{materialRequest.title}</Text>
          <StatusBadge status={materialRequest.status || "Unknown"} />
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>From:</Text>
          <Text style={styles.infoValue}>{materialRequest.from_warehouse}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>To:</Text>
          <Text style={styles.infoValue}>{materialRequest.to_showroom}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Items:</Text>
          <Text style={styles.infoValue}>
            {totalItems} items • {totalRequestedQty} qty requested •{" "}
            {totalPickedQty} qty picked
          </Text>
        </View>
      </View>

      {/* Scanning Section - Always show (can scan before or after creating TC) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Scan Items</Text>

        {/* Current Location */}
        {currentLocation && (
          <View style={styles.locationCard}>
            <View style={styles.locationInfo}>
              <Text style={styles.locationLabel}>Current Location:</Text>
              <Text
                style={styles.locationValue}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {currentLocation}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.clearLocationButton}
              onPress={() => {
                setCurrentLocation("");
                setScanWorkflow("SCAN_LOCATION");
              }}
            >
              <Text style={styles.clearLocationText}>Change Location</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Scanner */}
        <View style={styles.scannerWrapper}>
          {scanWorkflow === "SCAN_LOCATION" ? (
            <BarcodeScanner
              onScan={handleLocationScan}
              placeholder="Scan Location ID"
              title="Scan Location"
            />
          ) : (
            <BarcodeScanner
              onScan={handleItemScan}
              placeholder="Scan Item Barcode or Item Code"
              title="Scan Item"
              scanType="item"
            />
          )}
        </View>

        {/* Scanned Items List */}
        {scannedItems.length > 0 && (
          <View style={styles.scannedItemsContainer}>
            <View style={styles.scannedItemsHeader}>
              <Text style={styles.scannedItemsTitle}>
                Scanned Items ({scannedItems.length})
              </Text>
              <TouchableOpacity
                style={styles.clearButton}
                onPress={clearScannedItems}
              >
                <Text style={styles.clearButtonText}>Clear All</Text>
              </TouchableOpacity>
            </View>

            {/* Last Scanned Item - Full Card at Top */}
            <>
              {(() => {
                // Get the most recently scanned item (last in array, sorted by timestamp)
                const sortedByTimestamp = [...scannedItems].sort(
                  (a, b) =>
                    new Date(b.timestamp).getTime() -
                    new Date(a.timestamp).getTime()
                );
                const lastItem =
                  sortedByTimestamp[0] || scannedItems[scannedItems.length - 1];
                const mrItem = materialRequest?.items?.find(
                  (i: any) => i.item_code === lastItem.item_code
                );
                const requestedQty = mrItem?.requested_qty || 0;
                const totalScanned = scannedItems
                  .filter((si) => si.item_code === lastItem.item_code)
                  .reduce((sum, si) => sum + si.qty, 0);
                const remainingQty = requestedQty - totalScanned;
                const lastItemIndex = scannedItems.length - 1;

                return (
                  <View style={styles.lastScannedItemCard}>
                    <View style={styles.lastScannedHeader}>
                      <Text style={styles.lastScannedLabel}>
                        Last Scanned Item
                      </Text>
                    </View>
                    <View style={styles.scannedItemCard}>
                      <View style={styles.scannedItemHeader}>
                        <TouchableOpacity
                          style={styles.editButton}
                          onPress={() => handleEditQty(lastItemIndex)}
                        >
                          <Text style={styles.editButtonText}>✏️</Text>
                        </TouchableOpacity>
                        <View style={styles.scannedItemInfo}>
                          <Text style={styles.scannedItemCode}>
                            {lastItem.item_code}
                          </Text>
                          {lastItem.item_name && (
                            <Text style={styles.scannedItemName}>
                              {lastItem.item_name}
                            </Text>
                          )}
                        </View>
                        <TouchableOpacity
                          style={styles.removeButton}
                          onPress={() => removeScannedItem(lastItemIndex)}
                        >
                          <Text style={styles.removeButtonText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={styles.scannedItemDetails}>
                        <Text style={styles.scannedItemDetail}>
                          Location: {lastItem.location_id}
                        </Text>
                        <Text style={styles.scannedItemDetail}>
                          Qty: {lastItem.qty}
                        </Text>
                      </View>
                      <View style={styles.scannedItemQtyInfo}>
                        <View style={styles.qtyInfoRow}>
                          <Text style={styles.qtyInfoLabel}>Requested:</Text>
                          <Text style={styles.qtyInfoValue}>
                            {requestedQty}
                          </Text>
                        </View>
                        <View style={styles.qtyInfoRow}>
                          <Text style={styles.qtyInfoLabel}>Scanned:</Text>
                          <Text
                            style={[styles.qtyInfoValue, { color: "#4CAF50" }]}
                          >
                            {totalScanned}
                          </Text>
                        </View>
                        <View style={styles.qtyInfoRow}>
                          <Text style={styles.qtyInfoLabel}>Remaining:</Text>
                          <Text
                            style={[
                              styles.qtyInfoValue,
                              {
                                color: remainingQty > 0 ? "#FF9800" : "#4CAF50",
                              },
                            ]}
                          >
                            {remainingQty}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })()}

              {/* Other Scanned Items - Exclude the last item since it's shown above */}
              {scannedItems.length > 1 && (
                <FlatList
                  data={[...scannedItems].slice(0, -1).reverse()}
                  keyExtractor={(item, index) =>
                    `${item.location_id}-${item.item_code}-${item.timestamp}-${index}`
                  }
                  renderItem={({ item, index }) => {
                    // Calculate original index for removal
                    // We're showing items in reverse order (excluding the last one)
                    // Original array: [item0, item1, ..., itemN-2, itemN-1] (last)
                    // We show: [itemN-2, itemN-3, ..., item1, item0] (reversed, excluding last)
                    const reversedIndex = scannedItems.length - 2 - index;
                    // Calculate totals for this item code across all locations
                    const mrItem = materialRequest?.items?.find(
                      (i: any) => i.item_code === item.item_code
                    );
                    const requestedQty = mrItem?.requested_qty || 0;

                    // Sum all scanned quantities for this item code
                    const totalScanned = scannedItems
                      .filter((si) => si.item_code === item.item_code)
                      .reduce((sum, si) => sum + si.qty, 0);

                    const remainingQty = requestedQty - totalScanned;

                    return (
                      <View style={styles.scannedItemCard}>
                        <View style={styles.scannedItemHeader}>
                          <TouchableOpacity
                            style={styles.editButton}
                            onPress={() => handleEditQty(reversedIndex)}
                          >
                            <Text style={styles.editButtonText}>✏️</Text>
                          </TouchableOpacity>
                          <View style={styles.scannedItemInfo}>
                            <Text style={styles.scannedItemCode}>
                              {item.item_code}
                            </Text>
                            {item.item_name && (
                              <Text style={styles.scannedItemName}>
                                {item.item_name}
                              </Text>
                            )}
                          </View>
                          <TouchableOpacity
                            style={styles.removeButton}
                            onPress={() => removeScannedItem(reversedIndex)}
                          >
                            <Text style={styles.removeButtonText}>✕</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.scannedItemDetails}>
                          <Text style={styles.scannedItemDetail}>
                            Location: {item.location_id}
                          </Text>
                          <Text style={styles.scannedItemDetail}>
                            Qty: {item.qty}
                          </Text>
                        </View>
                        <View style={styles.scannedItemQtyInfo}>
                          <View style={styles.qtyInfoRow}>
                            <Text style={styles.qtyInfoLabel}>Requested:</Text>
                            <Text style={styles.qtyInfoValue}>
                              {requestedQty}
                            </Text>
                          </View>
                          <View style={styles.qtyInfoRow}>
                            <Text style={styles.qtyInfoLabel}>Scanned:</Text>
                            <Text
                              style={[
                                styles.qtyInfoValue,
                                { color: "#4CAF50" },
                              ]}
                            >
                              {totalScanned}
                            </Text>
                          </View>
                          <View style={styles.qtyInfoRow}>
                            <Text style={styles.qtyInfoLabel}>Remaining:</Text>
                            <Text
                              style={[
                                styles.qtyInfoValue,
                                {
                                  color:
                                    remainingQty > 0 ? "#FF9800" : "#4CAF50",
                                },
                              ]}
                            >
                              {remainingQty}
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  }}
                  scrollEnabled={false}
                  ListHeaderComponent={
                    <Text style={styles.otherItemsHeader}>
                      Other Scanned Items
                    </Text>
                  }
                />
              )}
            </>
          </View>
        )}
      </View>

      {/* Transfer Carton Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Transfer Carton</Text>
        {transferCarton ? (
          <>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => {
                const now = Date.now();
                if (now - lastTCTapTimeRef.current < 500) {
                  // Double tap detected - show items modal
                  handleShowTCItems();
                  lastTCTapTimeRef.current = 0;
                } else {
                  lastTCTapTimeRef.current = now;
                }
              }}
              style={styles.tcCard}
            >
              {/* Transfer Carton ID and Status on same line */}
              <View style={styles.tcHeader}>
                <View style={styles.tcIdContainer}>
                  <Text style={styles.tcLabel}>Transfer Carton ID:</Text>
                </View>
                <StatusBadge status={hasSealedTC ? "Sealed" : "Created"} />
              </View>

              {/* Transfer Carton ID value - Full width below label */}
              <View style={styles.tcIdValueContainer}>
                <Text
                  style={styles.tcId}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {transferCarton}
                </Text>
              </View>
            </TouchableOpacity>

            {!hasSealedTC && (
              <TouchableOpacity
                style={[styles.sealButton, isSealing && styles.buttonDisabled]}
                onPress={sealTransferCarton}
                disabled={isSealing || hasSealedTC}
              >
                {isSealing ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.sealButtonText}>
                    Seal Transfer Carton
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </>
        ) : (
          <View style={styles.tcCard}>
            <Text style={styles.tcPlaceholder}>No Transfer Carton created</Text>
            <TouchableOpacity
              style={[
                styles.createButton,
                (isCreating || !canCreateTransferCarton) &&
                  styles.buttonDisabled,
              ]}
              onPress={createTransferCarton}
              disabled={isCreating || !canCreateTransferCarton}
            >
              {isCreating ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={styles.createButtonText}>
                  Create Transfer Carton
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Boxes Section */}
      {transferCarton && !hasSealedTC && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Available Boxes ({boxes.length})
          </Text>
          {boxes.length === 0 ? (
            <View style={styles.emptyBoxesContainer}>
              <Text style={styles.emptyBoxesText}>
                No closed boxes available for packing
              </Text>
            </View>
          ) : (
            <FlatList
              data={boxes}
              keyExtractor={(item) => item.box_id}
              renderItem={({ item }) => {
                const isPacked = packedBoxes.includes(item.box_id);
                return (
                  <TouchableOpacity
                    style={[styles.boxCard, isPacked && styles.boxCardPacked]}
                    onPress={() => !isPacked && packBox(item.box_id)}
                    disabled={isPacked}
                  >
                    <View style={styles.boxHeader}>
                      <Text style={styles.boxId}>{item.box_id}</Text>
                      {isPacked && <StatusBadge status="Packed" />}
                    </View>
                    <View style={styles.boxDetails}>
                      <Text style={styles.boxDetailText}>
                        Store: {item.store || materialRequest.from_warehouse}
                      </Text>
                      <Text style={styles.boxDetailText}>
                        Status: {item.status}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              scrollEnabled={false}
            />
          )}
        </View>
      )}

      {/* Packed Boxes Summary */}
      {transferCarton && packedBoxes.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Packed Boxes ({packedBoxes.length})
          </Text>
          <View style={styles.packedBoxesList}>
            {packedBoxes.map((boxId) => (
              <View key={boxId} style={styles.packedBoxItem}>
                <Text style={styles.packedBoxText}>{boxId}</Text>
              </View>
            ))}
          </View>
        </View>
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
                  style={styles.modalCloseButton}
                  onPress={() => {
                    setEditQtyModal(null);
                    setEditQtyValue("");
                  }}
                >
                  <Text style={styles.modalCloseButtonText}>✕</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.modalBody}>
                <Text style={styles.modalItemCode}>
                  {editQtyModal.item?.item_code}
                </Text>
                {editQtyModal.item?.item_name && (
                  <Text style={styles.modalItemName}>
                    {editQtyModal.item.item_name}
                  </Text>
                )}
                <Text style={styles.modalLocation}>
                  Location: {editQtyModal.item?.location_id}
                </Text>

                <View style={styles.modalQtyInfo}>
                  <Text style={styles.modalQtyLabel}>Current Quantity:</Text>
                  <Text style={styles.modalQtyValue}>
                    {editQtyModal.currentQty}
                  </Text>
                </View>

                <View style={styles.modalInputContainer}>
                  <Text style={styles.modalInputLabel}>New Quantity:</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={editQtyValue}
                    onChangeText={setEditQtyValue}
                    keyboardType="numeric"
                    placeholder="Enter quantity"
                    autoFocus={true}
                    selectTextOnFocus={true}
                  />
                </View>

                {materialRequest &&
                  editQtyModal.item &&
                  (() => {
                    const mrItem = materialRequest.items?.find(
                      (i: any) => i.item_code === editQtyModal.item?.item_code
                    );
                    const requestedQty = mrItem?.requested_qty || 0;
                    const currentTotalScanned = scannedItems
                      .filter(
                        (si) => si.item_code === editQtyModal.item?.item_code
                      )
                      .reduce((sum, si) => sum + si.qty, 0);
                    const newTotalScanned =
                      currentTotalScanned -
                      editQtyModal.currentQty +
                      (parseInt(editQtyValue) || 0);
                    const remainingQty = requestedQty - newTotalScanned;

                    return (
                      <View style={styles.modalQtySummary}>
                        <View style={styles.modalQtyRow}>
                          <Text style={styles.modalQtySummaryLabel}>
                            Requested:
                          </Text>
                          <Text style={styles.modalQtySummaryValue}>
                            {requestedQty}
                          </Text>
                        </View>
                        <View style={styles.modalQtyRow}>
                          <Text style={styles.modalQtySummaryLabel}>
                            After Edit:
                          </Text>
                          <Text
                            style={[
                              styles.modalQtySummaryValue,
                              { color: "#4CAF50" },
                            ]}
                          >
                            {newTotalScanned}
                          </Text>
                        </View>
                        <View style={styles.modalQtyRow}>
                          <Text style={styles.modalQtySummaryLabel}>
                            Remaining:
                          </Text>
                          <Text
                            style={[
                              styles.modalQtySummaryValue,
                              {
                                color: remainingQty > 0 ? "#FF9800" : "#4CAF50",
                              },
                            ]}
                          >
                            {remainingQty}
                          </Text>
                        </View>
                      </View>
                    );
                  })()}
              </View>

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonCancel]}
                  onPress={() => {
                    setEditQtyModal(null);
                    setEditQtyValue("");
                  }}
                >
                  <Text style={styles.modalButtonCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonSave]}
                  onPress={handleSaveEditedQty}
                >
                  <Text style={styles.modalButtonSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Transfer Carton Items Modal */}
      {tcItemsModal && tcItemsModal.visible && (
        <Modal
          visible={tcItemsModal.visible}
          transparent={true}
          animationType="slide"
          onRequestClose={() => {
            setTcItemsModal(null);
          }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Transfer Carton Items</Text>
                <TouchableOpacity
                  style={styles.modalCloseButton}
                  onPress={() => {
                    setTcItemsModal(null);
                  }}
                >
                  <Text style={styles.modalCloseButtonText}>✕</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.modalBody}>
                <Text style={styles.modalSubtitle}>
                  TC ID: {transferCarton}
                </Text>
                <Text style={styles.modalInfoText}>
                  Review items before sealing the carton
                </Text>

                {tcItemsModal.items.length === 0 ? (
                  <View style={styles.modalEmptyContainer}>
                    <Text style={styles.modalEmptyText}>
                      No items found in this Transfer Carton
                    </Text>
                  </View>
                ) : (
                  <FlatList
                    data={tcItemsModal.items}
                    keyExtractor={(item) => item.item_code}
                    ListHeaderComponent={
                      <View style={styles.tcItemHeaderRow}>
                        <Text style={styles.tcItemHeaderTextLeft}>Item</Text>
                        <Text style={styles.tcItemHeaderTextRight}>Req</Text>
                        <Text style={styles.tcItemHeaderTextRight}>Scnd</Text>
                      </View>
                    }
                    renderItem={({ item }) => (
                      <View style={styles.tcItemRow}>
                        <Text
                          style={styles.tcItemCode}
                          numberOfLines={1}
                          ellipsizeMode="tail"
                        >
                          {item.item_code}
                        </Text>
                        <Text style={styles.tcItemQtyValue}>
                          {item.requested_qty}
                        </Text>
                        <Text
                          style={[
                            styles.tcItemQtyValue,
                            {
                              color:
                                item.scanned_qty >= item.requested_qty
                                  ? "#4CAF50"
                                  : "#FF9800",
                              fontWeight: "600",
                            },
                          ]}
                        >
                          {item.scanned_qty}
                        </Text>
                      </View>
                    )}
                    style={styles.tcItemsList}
                    contentContainerStyle={styles.tcItemsListContent}
                  />
                )}
              </View>

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonCancel]}
                  onPress={() => {
                    setTcItemsModal(null);
                  }}
                >
                  <Text style={styles.modalButtonCancelText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
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
  modalEmptyText: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
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
});
