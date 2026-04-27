import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import { PickingTheme } from "../theme/picking-theme";
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import { apiService } from "../services/api.service";
import { getSettings } from "../services/settings.service";
import { transferInReceivingSessionService, TransferInReceivingSession } from "../services/transfer-in-receiving-session.service";
import { isDeviceOnline } from "../utils/network-check";
import { addEvent, syncEvents } from "../services/event-queue.service";
import { useScanGuard } from "../utils/useScanGuard";
import { dataService } from "../services/data.service";
import { getDatabase } from "../database/database";
import { resolveItemFromBarcode } from "../services/item-master.service";
import {
  BarcodeInput,
  type BarcodeInputHandle,
} from "../components/BarcodeInput";

interface ExpectedItem {
  line_id: string;
  item_code: string;
  item_name?: string;
  barcode?: string;
  barcodes?: string[]; // Multiple barcodes for same item
  expected_qty: number;
  received_qty: number;
  remaining_qty: number;
  has_scanned?: boolean; // True if item has been scanned at least once
  editable?: boolean; // Enable edit after first scan
  last_scan_time?: string;
  last_carton?: string;
  uom?: string; // Unit of measure
  status?: "Pending" | "Picking" | "Received"; // Item-level status from backend
}

export default function TransferInReceivingScanItemsScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const routeParams = (route.params as any) || {};
  const { transferInNo, sessionId, transactionNo, cartonId: initialCartonId, boxId: initialBoxId } = routeParams;

  const [transferIn, setTransferIn] = useState<any>(null);
  const [expectedItems, setExpectedItems] = useState<ExpectedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [barcodeDraft, setBarcodeDraft] = useState("");
  const [cartonId, setCartonId] = useState<string | null>(initialCartonId || null);
  const [boxId, setBoxId] = useState<string | null>(initialBoxId || null); // Box ID created when carton was generated
  const [editModal, setEditModal] = useState<{
    visible: boolean;
    item: ExpectedItem | null;
    newQty: string;
  }>({ visible: false, item: null, newQty: "" });
  const [totalScanned, setTotalScanned] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [lastModifiedItemId, setLastModifiedItemId] = useState<string | null>(null); // Track last scanned/edited item
  
  // ✅ NEW: State for BOX-based workflow (similar to ASN ReceiveSortScreen)
  const [currentItem, setCurrentItem] = useState<string | null>(null); // Current item being sorted to BOX
  const [availableBoxes, setAvailableBoxes] = useState<any[]>([]); // Available boxes for Transfer In
  const [showCreateBox, setShowCreateBox] = useState(false); // Show create box modal
  const [selectedStoreForBox, setSelectedStoreForBox] = useState<string>("WH-MAIN"); // Store for new box
  const [showAvailableBoxes, setShowAvailableBoxes] = useState(false); // Show available boxes modal
  const [boxItemQuantities, setBoxItemQuantities] = useState<Record<string, number>>({}); // Item quantities in each box
  const [pendingItemForBox, setPendingItemForBox] = useState<string | null>(null); // Item waiting for BOX selection
  const [boxSelectionModal, setBoxSelectionModal] = useState<{ visible: boolean; itemCode: string }>({ visible: false, itemCode: "" }); // Modal to select/create BOX
  
  // ✅ CRITICAL: Status management - UI status independent of backend status
  const [backendStatus, setBackendStatus] = useState<string>(""); // Raw backend status value
  const [isCompleted, setIsCompleted] = useState<boolean>(false); // ONLY true after user presses Complete (and backend confirms)
  const [uiStatus, setUiStatus] = useState<string>("Receiving"); // What we display to user
  
  // Derive UI status from isCompleted only
  useEffect(() => {
    setUiStatus(isCompleted ? "Received" : "Receiving");
  }, [isCompleted]);

  const barcodeInputRef = useRef<BarcodeInputHandle>(null);
  const lastScanTimeRef = useRef<number>(0);
  const SCAN_DEBOUNCE_MS = 700;
  const scanGuard = useScanGuard(350); // ✅ Prevent duplicate scan triggers

  // ✅ Restore carton ID from session when screen opens or route params change
  useFocusEffect(
    useCallback(() => {
      const restoreCartonId = async () => {
        const params = (route.params as any) || {};
        
        // Priority 1: Use cartonId from route params (if provided)
        if (params.cartonId !== undefined && params.cartonId !== null) {
          setCartonId(params.cartonId);
          // Save to session
          await transferInReceivingSessionService.updateActiveCarton(transferInNo, params.cartonId);
          return;
        }
        
        // Priority 2: Restore from session if no cartonId in params
        if (!cartonId) {
          const session = await transferInReceivingSessionService.loadSession(transferInNo);
          if (session && session.active_carton_id && session.status !== "Completed") {
            console.log(`✅ Restored carton ID from session: ${session.active_carton_id}`);
            setCartonId(session.active_carton_id);
          }
        }
      };
      
      restoreCartonId();
    }, [route.params, transferInNo, cartonId])
  );

  // Load Transfer In and items
  useEffect(() => {
    if (!transferInNo) return;
    
    // ✅ Allow loading even without cartonId initially (will be restored from session)
    // Only redirect if cartonId is still null after session restore attempt
    const checkCartonAndLoad = async () => {
      if (!cartonId) {
        // Try to restore from session one more time
        const session = await transferInReceivingSessionService.loadSession(transferInNo);
        if (session && session.active_carton_id && session.status !== "Completed") {
          setCartonId(session.active_carton_id);
          // Load after setting carton ID
          setTimeout(() => loadTransferIn(), 100);
          return;
        }
        
        // No carton ID found - redirect to carton scan screen
        console.log(`⚠️ No cartonId found - redirecting to TransferInReceivingScanCarton`);
        (navigation as any).navigate("TransferInReceivingScanCarton", {
          transferInNo,
          sessionId,
          transactionNo,
        });
        return;
      }
      
      // CartonId is present - proceed with loading
      loadTransferIn();
    };
    
    checkCartonAndLoad();
  }, [transferInNo, cartonId]);

  // ✅ Reload when screen is focused (user can go back and return)
  useFocusEffect(
    useCallback(() => {
      if (transferInNo && cartonId) {
        // Reload data when returning to screen
        loadTransferIn();
        // ✅ NEW: Load available boxes for Transfer In
        loadAvailableBoxes();
      }
    }, [transferInNo, cartonId])
  );

  // ✅ NEW: Load boxes when Transfer In is loaded
  useEffect(() => {
    if (transferInNo) {
      loadAvailableBoxes();
    }
  }, [transferInNo]);

  // ✅ PERMANENT FIX: Auto-focus barcode input whenever screen is focused
  useFocusEffect(
    useCallback(() => {
      const focusInput = () => {
        if (cartonId && cartonId.trim() !== "" && !isCompleted) {
          setTimeout(() => {
            barcodeInputRef.current?.focus();
          }, 200);
        }
      };
      
      focusInput();
      
      // Also focus when cartonId changes
      return () => {
        // Cleanup if needed
      };
    }, [cartonId, isCompleted])
  );
  
  // ✅ PERMANENT FIX: Focus input when cartonId becomes available
  useEffect(() => {
    if (cartonId && cartonId.trim() !== "" && !isCompleted) {
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 300);
    }
  }, [cartonId, isCompleted]);

  // Check for dirty state (offline queue)
  useEffect(() => {
    checkDirtyState();
  }, []);

  const loadTransferIn = async () => {
    try {
      setLoading(true);
      const response = await apiService.getTransferIn(transferInNo);

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
        // ✅ CRITICAL: Store backend status but DO NOT use it directly for UI
        // Backend may show "Received" because qty matched, but UI must stay "Receiving" until Complete clicked
        setBackendStatus(ti.status || "");
        
        // ✅ Check if backend confirms user clicked Complete
        // Uses helper function that checks ONLY explicit completion flags
        // Does NOT use backend status text or received_qty == required_qty
        const backendCompleted = backendSaysCompleted(ti);
        
        // ✅ CRITICAL: Only trust backend completion flags
        // Do NOT use session status - it might be stale or incorrectly set from previous tests
        // Session status is only set when user clicks Complete, but we need backend confirmation
        const session = await transferInReceivingSessionService.loadSession(transferInNo);
        
        // ✅ Set isCompleted ONLY if backend has explicit completed flag
        // NEVER set completed based on:
        // - backend status text (e.g., status === "Received") ❌
        // - received_qty >= expected_qty ❌
        // - session status alone ❌ (session might be stale)
        // - Any other derived/computed value ❌
        // 
        // ONLY use backend completion flags:
        // - completed_at ✅
        // - is_completed === 1 ✅
        // - completed_by ✅
        // - TRANSFER_IN_COMPLETE event ✅
        const completed = backendCompleted; // ONLY backend flags, ignore session status
        
        // ✅ DEBUG: Log status determination
        console.log(`🔍 Status Check: backend_status="${ti.status}", backendCompleted=${backendCompleted}, finalCompleted=${completed}`);
        console.log(`   Backend fields: completed_at=${ti.completed_at || 'null'}, is_completed=${ti.is_completed || 'null'}, completed_by=${ti.completed_by || 'null'}`);
        console.log(`   Session: status=${session?.status || 'null'}, active_carton_id=${session?.active_carton_id || 'null'}`);
        console.log(`   ✅ isCompleted=${completed} - set ONLY from explicit backend flags`);
        console.log(`   ❌ NOT using: backend status text, received_qty, session status`);
        
        // ✅ CRITICAL: Warn if backend status says "Received" but no completion flag
        if (ti.status === "Received" && !completed) {
          console.warn(`⚠️ WARNING: Backend status="Received" but NO completion flags found!`);
          console.warn(`   Backend is incorrectly setting status based on qty match.`);
          console.warn(`   Mobile app will IGNORE backend status and show "Receiving" until Complete is clicked.`);
          console.warn(`   Edit button and scanning will remain ENABLED.`);
        }
        
        // ✅ Calculate quantities for safety check and logging
        const totalReceived = (ti.items || ti.lines || []).reduce((sum: number, item: any) => sum + (item.received_qty || 0), 0);
        const totalExpected = (ti.items || ti.lines || []).reduce((sum: number, item: any) => sum + (item.qty || item.expected_qty || 0), 0);
        console.log(`   📊 Quantities: total_received=${totalReceived}, total_expected=${totalExpected}, items_count=${(ti.items || ti.lines || []).length}`);
        
        // ✅ CRITICAL: Safety check - if received=0 but completed=true, force completed=false
        // This prevents the bug where UI shows "Received" with 0 received qty
        if (totalReceived === 0 && completed) {
          console.error(`❌ CONTRADICTION DETECTED: isCompleted=true but total_received=0!`);
          console.error(`   This should never happen - forcing isCompleted=false to allow scanning.`);
          setIsCompleted(false);
        } else {
          setIsCompleted(completed);
        }
        
        // Store transferIn data (without overriding status - we use uiStatus for display)
        setTransferIn({
          ...ti,
          _backend_status: ti.status, // Keep original for reference
        });
        
        // Log status logic for debugging
        if (ti.status === "Received" && !completed) {
          console.warn(`⚠️ Backend shows "Received" but no completed flag found. UI will show "Receiving" until Complete is clicked.`);
          console.warn(`   Backend status: ${ti.status}, completed_at: ${ti.completed_at}, is_completed: ${ti.is_completed}, session status: ${session?.status}`);
        }

        // Convert items to ExpectedItem format
        const items: ExpectedItem[] = (ti.items || ti.lines || []).map((item: any) => ({
          line_id: item.line_id || item.item_code,
          item_code: item.item_code,
          item_name: item.item_name,
          barcode: item.barcode,
          barcodes: item.barcodes || (item.barcode ? [item.barcode] : []),
          expected_qty: item.qty || item.expected_qty || item.requested_qty || 0,
          received_qty: item.received_qty || 0,
          remaining_qty: (item.qty || item.expected_qty || item.requested_qty || 0) - (item.received_qty || 0),
          has_scanned: (item.received_qty || 0) > 0,
          editable: true, // ✅ Always enabled - user can edit even if backend shows "Received"
          uom: item.uom || "pcs",
          status: item.status, // Include status from backend (Pending, Picking, Received)
        }));

        setExpectedItems(items);
        updateTotalScanned(items);
        
        // Log status override for debugging
        if (ti.status === "Received" && !isCompleted) {
          console.warn(`⚠️ Backend shows "Received" but Complete not clicked. Overriding to "Receiving" in UI.`);
        }
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
  };

  const updateTotalScanned = (items: ExpectedItem[]) => {
    const total = items.reduce((sum, item) => sum + item.received_qty, 0);
    setTotalScanned(total);
    
    // Update session scanned total
    if (transferInNo) {
      transferInReceivingSessionService.updateScannedTotal(transferInNo, total);
    }
  };

  const checkDirtyState = async () => {
    const session = await transferInReceivingSessionService.loadSession(transferInNo);
    if (session?.is_dirty) {
      setIsDirty(true);
    }
  };

  // ✅ Helper: Check if backend confirms user clicked Complete
  // Returns true ONLY if explicit completion flags exist
  // Does NOT use backend status text or received_qty == required_qty
  const backendSaysCompleted = (data: any): boolean => {
    // ✅ CRITICAL: Only check explicit completion flags
    // Preferred: Check for completion timestamp or flag
    if (data?.completed_at) {
      console.log(`✅ Found completed_at: ${data.completed_at}`);
      return true;
    }
    if (data?.is_completed === 1 || data?.is_completed === true) {
      console.log(`✅ Found is_completed: ${data.is_completed}`);
      return true;
    }
    if (data?.completed_by) {
      console.log(`✅ Found completed_by: ${data.completed_by}`);
      return true; // If completed_by exists, it's completed
    }
    if (data?.is_completed_receiving === 1 || data?.is_completed_receiving === true) {
      console.log(`✅ Found is_completed_receiving: ${data.is_completed_receiving}`);
      return true;
    }
    if (data?.completed_receiving_at) {
      console.log(`✅ Found completed_receiving_at: ${data.completed_receiving_at}`);
      return true;
    }

    // If backend has events list / flags
    if (Array.isArray(data?.events)) {
      const hasCompleteEvent = data.events.some((e: any) => e?.event_type === "TRANSFER_IN_COMPLETE");
      if (hasCompleteEvent) {
        console.log(`✅ Found TRANSFER_IN_COMPLETE event in events array`);
        return true;
      }
    }

    // ✅ IMPORTANT: Do NOT assume completed based on status text
    // Do NOT check: data.status === "Received" ❌
    // Do NOT check: received_qty >= expected_qty ❌
    // Do NOT check: any other derived/computed value ❌
    console.log(`❌ No completion flags found - isCompleted = false`);
    return false;
  };

  const findMatchingItem = (barcode: string): ExpectedItem | null => {
    return (
      expectedItems.find(
        (item) =>
          item.barcode === barcode ||
          item.barcodes?.includes(barcode) ||
          item.item_code === barcode
      ) || null
    );
  };

  // ✅ NEW: Load available boxes for Transfer In (similar to ASN)
  const loadAvailableBoxes = async () => {
    if (!transferInNo) return;
    try {
      const db = await getDatabase();
      if (!db) return;
      
      // ✅ Get boxes for Transfer In - filter by box_id prefix (TI-PUT-) since transfer_in column may not exist
      // Also check if transfer_in column exists and matches
      let boxes: any[] = [];
      try {
        // Try to get boxes with transfer_in column first
        boxes = await db.getAllAsync<any>(
          `SELECT * FROM box_cache 
           WHERE (transfer_in = ? OR box_id LIKE ?) 
           AND status != 'Closed' AND status != 'CLOSED' AND status != 'closed'`,
          [transferInNo, `TI-PUT-${transferInNo.replace(/[^A-Z0-9]/g, "")}%`]
        );
      } catch (error: any) {
        // If query fails (column doesn't exist), filter by box_id prefix only
        console.warn(`⚠️ Error querying boxes with transfer_in, trying box_id prefix only:`, error.message);
        const allBoxes = await db.getAllAsync<any>(
          `SELECT * FROM box_cache WHERE status != 'Closed' AND status != 'CLOSED' AND status != 'closed'`
        );
        const transferInShort = transferInNo.replace(/^INSLIP-/, "").replace(/[^A-Z0-9]/g, "");
        boxes = allBoxes.filter((box) => 
          box.box_id && 
          (box.box_id.startsWith(`TI-PUT-${transferInShort}`) || box.box_id.startsWith("TI-PUT-"))
        );
      }
      
      // Filter out boxes with null/undefined/empty box_id and ensure they're Open
      const validBoxes = boxes.filter(
        (box) =>
          box.box_id &&
          box.box_id !== "" &&
          box.box_id !== null &&
          (box.status === "Open" ||
            box.status === "OPEN" ||
            box.status === "open")
      );
      
      setAvailableBoxes(validBoxes);
      console.log(`📦 Loaded ${validBoxes.length} available box(es) for Transfer In ${transferInNo}`);
    } catch (error: any) {
      console.error("❌ Error loading boxes:", error);
      setAvailableBoxes([]);
    }
  };

  // ✅ NEW: Create BOX for Transfer In with TI- naming (similar to ASN box creation)
  const createTransferInBox = async (store: string = "WH-MAIN"): Promise<string | null> => {
    if (!transferInNo) {
      Alert.alert("Error", "Transfer In number is missing");
      return null;
    }

    setLoading(true);
    try {
      const settings = await getSettings();
      
      // Generate TI- naming series for Transfer In boxes
      const timestamp = Date.now();
      const transferInShort = transferInNo.replace(/^INSLIP-/, ""); // Remove INSLIP- prefix if present
      const boxId = `TI-PUT-${transferInShort.replace(/[^A-Z0-9]/g, "")}-${timestamp}`;
      
      const requestData: any = {
        box_id: boxId, // Send TI- format box_id to backend
        transfer_in: transferInNo,
        store: store,
        purpose: "PUTAWAY", // Transfer In boxes are for putaway
        to_no: "Putaway",
        transfer_order: "Putaway",
        user_id: settings.user_id,
      };

      const response = await apiService.createBox(requestData);
      console.log("📦 Transfer In Box API Response:", JSON.stringify(response, null, 2));

      // Extract box_id from response (prefer TI- format)
      const backendBoxId =
        response?.box_id ||
        response?.data?.box_id ||
        response?.box?.box_id ||
        response?.id ||
        boxId; // Fallback to generated ID

      // Ensure it's TI- format
      const finalBoxId = backendBoxId.startsWith("TI-") ? backendBoxId : boxId;

      // Save to local database
      // ✅ NOTE: saveBox expects Box interface with asn_no, so we'll store Transfer In in asn_no field
      // This is a workaround until schema is updated to support transfer_in column
      const newBox: any = {
        box_id: finalBoxId,
        asn_no: transferInNo, // Store Transfer In number in asn_no field (workaround)
        to_no: "Putaway",
        store: store,
        status: "Open",
        purpose: "PUTAWAY",
        updated_on: new Date().toISOString(),
        created_by:
          String(settings.user_id || "").trim() ||
          String(settings.user_code || "").trim() ||
          null,
      };

      await dataService.saveBox(newBox);
      await loadAvailableBoxes();
      
      console.log(`✅ Transfer In Box ${finalBoxId} created successfully`);
      return finalBoxId;
    } catch (error: any) {
      console.error("❌ Error creating Transfer In box:", error);
      Alert.alert("Error", error.message || "Failed to create BOX");
      return null;
    } finally {
      setLoading(false);
    }
  };

  // ✅ NEW: Close BOX for Transfer In (similar to ASN box closing)
  const closeTransferInBox = async (boxId: string): Promise<boolean> => {
    setLoading(true);
    try {
      const settings = await getSettings();
      const closedBy = settings.user_id || undefined;

      const response = await apiService.closeBox({
        box_id: boxId,
        closed_by: closedBy,
      });

      if (response?.ok === true || response?.success === true) {
        console.log(`✅ Transfer In Box ${boxId} closed successfully`);
        
        // Update local database
        const db = await getDatabase();
        if (db) {
          await db.runAsync(
            `UPDATE box_cache SET status = 'Closed', updated_on = ? WHERE box_id = ?`,
            [new Date().toISOString(), boxId]
          );
        }
        
        await loadAvailableBoxes();
        return true;
      } else {
        const errorMessage = response?.error?.message || "Failed to close box";
        Alert.alert("Error", errorMessage);
        return false;
      }
    } catch (error: any) {
      console.error("❌ Error closing Transfer In box:", error);
      Alert.alert("Error", error.message || "Failed to close BOX");
      return false;
    } finally {
      setLoading(false);
    }
  };

  // ✅ NEW: Sort item to BOX (similar to ASN SORT_TO_BOX workflow)
  const sortItemToBox = async (itemCode: string, boxId: string) => {
    if (!transferInNo || !cartonId) {
      Alert.alert("Error", "Transfer In and Carton ID are required");
      return;
    }

    setLoading(true);
    try {
      const settings = await getSettings();
      const db = await getDatabase();
      if (!db) {
        Alert.alert("Error", "Database not available");
        return;
      }

      // ✅ PERMANENT FIX: Use cartonId as boxId if boxId is not provided
      // For Transfer In, box_id = carton_id (CTN-TI-*)
      const finalBoxId = boxId || cartonId;
      if (!finalBoxId) {
        Alert.alert("Error", "Carton ID is required. Please go back and scan/generate a carton ID first.");
        setLoading(false);
        return;
      }

      // Validate BOX exists and is active
      // ✅ Get box directly from database (box_cache may not have transfer_in column)
      let box: any = null;
      try {
        box = await db.getFirstAsync<any>(
          `SELECT * FROM box_cache WHERE box_id = ?`,
          [finalBoxId]
        );
      } catch (error: any) {
        console.warn(`⚠️ Error loading box:`, error.message);
      }
      
      // If not found, try loading all boxes and filtering by box_id
      if (!box) {
        const allBoxes = await db.getAllAsync<any>(
          `SELECT * FROM box_cache WHERE box_id LIKE ?`,
          [`${finalBoxId}%`]
        );
        box = allBoxes.find((b) => b.box_id === finalBoxId);
      }
      
      // ✅ PERMANENT FIX: Auto-create BOX if it doesn't exist
      if (!box) {
        console.log(`⚠️ BOX "${finalBoxId}" not found in local database. Attempting to create...`);
        
        try {
          // Try to create BOX via backend API
          const boxResponse = await apiService.createBox({
            box_id: finalBoxId, // Use carton ID as box_id
            asn_no: transferInNo, // Use Transfer In as ASN
            store: "WH-MAIN", // Default warehouse store
            purpose: "PUTAWAY",
            user_id: settings.user_id || settings.user_code || "USER",
            carton_id: cartonId,
            to_no: "Putaway", // Set Transfer Order to "Putaway" for Transfer In putaway boxes
          });
          
          // Extract box_id from response
          const createdBoxId = 
            boxResponse?.box_id ||
            boxResponse?.data?.box_id ||
            boxResponse?.data?.box?.box_id ||
            finalBoxId;
          
          // Save to local database
          const newBox = {
            box_id: createdBoxId,
            asn_no: transferInNo,
            store: "WH-MAIN",
            status: "Open",
            purpose: "PUTAWAY",
            updated_on: new Date().toISOString(),
          };
          
          await dataService.saveBox(newBox);
          box = newBox;
          setBoxId(createdBoxId); // Update state
          
          console.log(`✅ Auto-created BOX "${createdBoxId}" for Transfer In ${transferInNo}`);
        } catch (createError: any) {
          console.error(`❌ Failed to auto-create BOX:`, createError);
          
          // If backend creation fails, create locally only (for offline mode)
          const localBox = {
            box_id: finalBoxId,
            asn_no: transferInNo,
            store: "WH-MAIN",
            status: "Open",
            purpose: "PUTAWAY",
            updated_on: new Date().toISOString(),
          };
          
          try {
            await dataService.saveBox(localBox);
            box = localBox;
            setBoxId(finalBoxId);
            console.log(`✅ Created local BOX "${finalBoxId}" (backend creation failed, will sync later)`);
          } catch (localError: any) {
            console.error(`❌ Failed to create local BOX:`, localError);
            Alert.alert(
              "BOX Not Found",
              `BOX "${finalBoxId}" not found and could not be created.\n\n` +
              `Error: ${createError.message || localError.message}\n\n` +
              `Please go back and generate a carton ID first, or contact support.`
            );
            setLoading(false);
            return;
          }
        }
      }
      
      // Update boxId state if it was null
      if (!boxId && finalBoxId) {
        setBoxId(finalBoxId);
      }

      if (box.status !== "Open" && box.status !== "OPEN" && box.status !== "open") {
        Alert.alert("BOX Not Active", `BOX "${finalBoxId}" is not active. Current status: ${box.status}`);
        setLoading(false);
        return;
      }

      // Resolve item from barcode (in case barcode was scanned instead of item_code)
      const resolvedItem = await resolveItemFromBarcode(itemCode);
      const finalItemCode = resolvedItem?.item_code || itemCode;

      // Find matching item in Transfer In
      const matchingItem = expectedItems.find(
        (item) => item.item_code === finalItemCode
      );

      if (!matchingItem) {
        Alert.alert("Item Not Found", `Item "${finalItemCode}" is not in this Transfer In.`);
        return;
      }

      // Check remaining quantity
      const remaining = matchingItem.remaining_qty;
      if (remaining <= 0) {
        Alert.alert(
          "Over-Receive Blocked",
          `Item ${finalItemCode} has already been fully received.\n\nRequired: ${matchingItem.expected_qty}\nReceived: ${matchingItem.received_qty}\nRemaining: ${remaining}`
        );
        return;
      }

      // Create SORT_TO_BOX event (similar to ASN)
      await addEvent({
        event_type: "SORT_TO_BOX",
        transfer_in: transferInNo,
        carton_id: cartonId,
        item_code: finalItemCode,
        box_id: finalBoxId, // ✅ Use finalBoxId (cartonId if boxId is null)
        store: box.store || "WH-MAIN",
        qty: 1,
        device_id: settings.device_id ?? undefined,
        user_id: settings.user_id || settings.user_code || "USER",
      });

      // Save to scanned_items (similar to ASN)
      // ✅ NOTE: scanned_items table uses asn_no field, so we'll use it for Transfer In as well
      // Store Transfer In number in asn_no field (workaround until schema is updated)
      const existing = await db.getFirstAsync<{ scanned_qty: number }>(
        `SELECT scanned_qty FROM scanned_items 
         WHERE asn_no = ? AND carton_id = ? AND item_code = ? AND box_id = ?`,
        [transferInNo, cartonId, finalItemCode, finalBoxId]
      );

      if (existing) {
        const newQty = existing.scanned_qty + 1;
        await db.runAsync(
          `UPDATE scanned_items 
           SET scanned_qty = ?, scanned_on = ?, device_id = ?, user_id = ?
           WHERE asn_no = ? AND carton_id = ? AND item_code = ? AND box_id = ?`,
          [
            newQty,
            new Date().toISOString(),
            settings.device_id,
            settings.user_id,
            transferInNo,
            cartonId,
            finalItemCode,
            finalBoxId,
          ]
        );
      } else {
        await db.runAsync(
          `INSERT INTO scanned_items 
           (asn_no, inbound_session, carton_id, item_code, box_id, store, scanned_qty, scanned_on, device_id, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            transferInNo, // Store Transfer In number in asn_no field
            sessionId || `TI-REC-${Date.now()}`, // Use sessionId as inbound_session
            cartonId,
            finalItemCode,
            finalBoxId, // ✅ Use finalBoxId (cartonId if boxId is null)
            box.store || "WH-MAIN",
            1,
            new Date().toISOString(),
            settings.device_id,
            settings.user_id,
          ]
        );
      }

      // ✅ CRITICAL: Get warehouse/store from Transfer In details for events
      // For Transfer In, warehouse = to_warehouse from Transfer In
      const transferInWarehouse = transferIn?.to_warehouse || transferIn?.warehouse || "WH-MAIN";
      
      // ✅ CRITICAL: Get box_id (carton_id) for Transfer In events
      // For Transfer In, box_id = carton_id (CTN-TI-* format)
      const eventBoxId = boxId || cartonId;
      
      // Also create TRANSFER_IN_RECEIVE event for backend processing
      await addEvent({
        event_type: "TRANSFER_IN_RECEIVE",
        transfer_in: transferInNo,
        carton_id: cartonId,
        box_id: eventBoxId, // ✅ CRITICAL: Include box_id (carton_id for Transfer In)
        item_code: finalItemCode,
        qty: 1,
        store: transferInWarehouse, // ✅ CRITICAL: Include store (to_warehouse for Transfer In)
        device_id: settings.device_id ?? undefined,
        user_id: settings.user_id || settings.user_code || "USER",
      });

      // Update UI optimistically
      const updatedItems = expectedItems.map((item) =>
        item.line_id === matchingItem.line_id
          ? {
              ...item,
              received_qty: item.received_qty + 1,
              remaining_qty: item.expected_qty - (item.received_qty + 1),
              editable: true,
              has_scanned: true,
              last_scan_time: new Date().toISOString(),
              last_carton: cartonId,
            }
          : item
      );
      setLastModifiedItemId(matchingItem.line_id);
      setExpectedItems(updatedItems);
      updateTotalScanned(updatedItems);

      // Sync events
      try {
        await syncEvents();
      } catch (syncError: any) {
        console.warn(`⚠️ Event sync failed (will retry later):`, syncError.message);
      }

      // ✅ PERMANENT FIX: Always refocus input after successful scan
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 100);

      // Reload Transfer In after delay
      setTimeout(async () => {
        try {
          await loadTransferIn();
          // ✅ PERMANENT FIX: Refocus input after reload completes
          setTimeout(() => {
            barcodeInputRef.current?.focus();
          }, 300);
        } catch (reloadError: any) {
          console.warn(`⚠️ Failed to reload Transfer In:`, reloadError.message);
          // ✅ PERMANENT FIX: Refocus input even if reload fails
          setTimeout(() => {
            barcodeInputRef.current?.focus();
          }, 300);
        }
      }, 2000);

      Alert.alert("Success", `Item ${finalItemCode} sorted to BOX ${boxId}`);
      setCurrentItem(null);
      setBoxSelectionModal({ visible: false, itemCode: "" });
    } catch (error: any) {
      console.error("❌ Error sorting item to BOX:", error);
      Alert.alert("Error", error.message || "Failed to sort item to BOX");
    } finally {
      setLoading(false);
    }
  };

  // ✅ NEW: Handle item scan - prompt for BOX (similar to ASN workflow)
  const handleItemScan = async (barcode: string): Promise<boolean> => {
    if (!barcode || !barcode.trim()) return false;

    // ✅ Block scanning if already completed
    if (isCompleted) {
      Alert.alert("Already Completed", "This Transfer In has already been completed. Scanning is disabled.");
      return false;
    }

    // ✅ FIX: Use scan guard to prevent duplicate triggers
    const guard = scanGuard(barcode);
    if (!guard.allow) {
      console.log("⏭️ Scan guard blocked duplicate scan");
      return true;
    }

    // ✅ CRITICAL: Validate cartonId FIRST
    if (!cartonId || cartonId.trim() === "") {
      Alert.alert(
        "Carton ID Required",
        "Carton ID is required for receiving items.\n\nPlease scan a carton ID first.",
        [
          {
            text: "Scan Carton ID",
            onPress: () => {
              (navigation as any).navigate("TransferInReceivingScanCarton", {
                transferInNo,
                sessionId,
                transactionNo,
              });
            },
          },
          { text: "Cancel", style: "cancel" },
        ]
      );
      return false;
    }

    // Additional debounce
    const now = Date.now();
    if (now - lastScanTimeRef.current < SCAN_DEBOUNCE_MS) {
      console.log("⏭️ Debounced duplicate scan");
      return true;
    }
    lastScanTimeRef.current = now;

    const normalizedBarcode = barcode.trim().toUpperCase();
    setScanning(true);

    try {
      // Resolve item from barcode
      const resolvedItem = await resolveItemFromBarcode(normalizedBarcode);
      const itemCode = resolvedItem?.item_code || normalizedBarcode;

      // Find matching item in Transfer In
      const matchingItem = findMatchingItem(itemCode);
      
      if (!matchingItem) {
        Alert.alert("Item Not Found", `Item "${itemCode}" is not in this Transfer In.`, [
          {
            text: "OK",
            onPress: () => {
              // ✅ PERMANENT FIX: Refocus input after alert dismisses
              setTimeout(() => {
                barcodeInputRef.current?.focus();
              }, 200);
            },
          },
        ]);
        setScanning(false);
        setTimeout(() => barcodeInputRef.current?.focus(), 250);
        return false;
      }

      // Check remaining quantity
      const remaining = matchingItem.remaining_qty;
      if (remaining <= 0) {
        Alert.alert(
          "Over-Receive Blocked",
          `Item ${matchingItem.item_code} has already been fully received.\n\nRequired: ${matchingItem.expected_qty}\nReceived: ${matchingItem.received_qty}\nRemaining: ${remaining}`,
          [
            {
              text: "OK",
              onPress: () => {
                // ✅ PERMANENT FIX: Refocus input after alert dismisses
                setTimeout(() => {
                  barcodeInputRef.current?.focus();
                }, 200);
              },
            },
          ]
        );
        setScanning(false);
        setTimeout(() => barcodeInputRef.current?.focus(), 250);
        return false;
      }

      // ✅ NEW: Use box_id if it was created during carton generation, otherwise show BOX selection modal
      if (boxId) {
        // Box was already created when user clicked "Generate Carton ID"
        // Use it directly to sort the item
        console.log(`📦 Using pre-created box: ${boxId}`);
        await sortItemToBox(matchingItem.item_code, boxId);
        setScanning(false);
        // ✅ PERMANENT FIX: Refocus input after scan completes
        setTimeout(() => {
          barcodeInputRef.current?.focus();
        }, 150);
      } else {
        // No box_id available - show BOX selection modal (user can select existing or create new)
        setCurrentItem(matchingItem.item_code);
        setPendingItemForBox(matchingItem.item_code);
        setBoxSelectionModal({ visible: true, itemCode: matchingItem.item_code });
        
        // Load available boxes
        await loadAvailableBoxes();
        
        setScanning(false);
        // Note: Focus will be restored when modal closes (in handleBoxSelected)
      }
      return true;
    } catch (error: any) {
      console.error("❌ Error scanning item:", error);
      Alert.alert("Error", `Failed to scan item: ${error.message}`, [
        {
          text: "OK",
          onPress: () => {
            // ✅ PERMANENT FIX: Refocus input after alert dismisses
            setTimeout(() => {
              barcodeInputRef.current?.focus();
            }, 200);
          },
        },
      ]);
      setScanning(false);
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 100);
      return false;
    }
  };

  // ✅ NEW: Handle BOX selection from modal
  const handleBoxSelected = async (boxId: string) => {
    if (!pendingItemForBox) {
      Alert.alert("Error", "No item selected for BOX");
      return;
    }

    await sortItemToBox(pendingItemForBox, boxId);
    setPendingItemForBox(null);
    setBoxSelectionModal({ visible: false, itemCode: "" });
    
    // ✅ PERMANENT FIX: Refocus input for next scan (increased timeout for reliability)
    setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 250);
  };

  // ✅ NEW: Handle create new BOX from modal
  const handleCreateNewBox = async () => {
    const newBoxId = await createTransferInBox(selectedStoreForBox);
    if (newBoxId && pendingItemForBox) {
      await sortItemToBox(pendingItemForBox, newBoxId);
      setPendingItemForBox(null);
      setBoxSelectionModal({ visible: false, itemCode: "" });
      
      // Refocus input for next scan
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 100);
    }
  };

  const handleEditQty = (item: ExpectedItem) => {
    // ✅ Always allow editing, even if backend status is "Received"
    // User should be able to correct quantities until Complete is clicked
    const currentQty = item.received_qty || 0;
    console.log(`📝 Opening edit modal for item ${item.item_code}, current qty: ${currentQty}`);
    setEditModal({ 
      visible: true, 
      item, 
      newQty: currentQty > 0 ? currentQty.toString() : "" 
    });
  };

  const handleSaveEditQty = async () => {
    if (!editModal.item) return;

    const qtyString = editModal.newQty.trim();
    if (qtyString === "") {
      Alert.alert("Invalid Quantity", "Please enter a quantity.");
      return;
    }

    const newQty = parseFloat(qtyString);
    if (isNaN(newQty) || newQty < 0) {
      Alert.alert("Invalid Quantity", "Please enter a valid quantity.");
      return;
    }

    // ✅ PREVENT OVER-RECEIVE: Check if new qty exceeds required qty
    const expectedQty = editModal.item.expected_qty;
    if (newQty > expectedQty) {
      Alert.alert(
        "Over-Receive Blocked",
        `Cannot set received qty to ${newQty}.\n\nRequired qty: ${expectedQty}\nReceived qty cannot exceed required qty.`
      );
      return;
    }

    const oldQty = editModal.item.received_qty;
    const qtyDifference = newQty - oldQty;

    if (qtyDifference === 0) {
      setEditModal({ visible: false, item: null, newQty: "" });
      // ✅ PERMANENT FIX: Refocus input after modal closes
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 200);
      return;
    }

    try {
      setLoading(true);
      
      // ✅ CRITICAL: Validate cartonId FIRST (required for receiving)
      if (!cartonId || cartonId.trim() === "") {
        Alert.alert(
          "Carton ID Required",
          "Carton ID is required for updating quantity.\n\nPlease scan a carton ID first.",
          [
            {
              text: "Scan Carton ID",
              onPress: () => {
                (navigation as any).navigate("TransferInReceivingScanCarton", {
                  transferInNo,
                  sessionId,
                  transactionNo,
                });
              },
            },
            { text: "Cancel", style: "cancel" },
          ]
        );
        setLoading(false);
        return;
      }

      // ✅ CRITICAL FIX: When editing quantity, REPLACE the value, don't add to it
      // The receive-line API is additive, so we need to calculate the exact difference needed
      // If user wants 2 and current is 4, we need to send -2 to get to 2
      // But if backend doesn't support negative, we'll use events which should handle replacement
      
      // ✅ FIX: Use EVENTS as single source of truth - remove direct API calls
      // This prevents double quantity updates and ensures consistent state
      const settings = await getSettings();
      
      try {
        // ✅ ONLY create event - backend will process from events
        // Do NOT call receiveTransferInLine API - it causes double counting
        // Events handle both increases and decreases correctly
        // ✅ CRITICAL: Get warehouse/store from Transfer In details for events
        const transferInWarehouse = transferIn?.to_warehouse || transferIn?.warehouse || "WH-MAIN";
        const eventBoxId = boxId || cartonId;
        
        await addEvent({
          event_type: "TRANSFER_IN_RECEIVE",
          transfer_in: transferInNo, // ✅ Required for backend processing
          carton_id: cartonId, // ✅ Carton ID tracked in event
          box_id: eventBoxId, // ✅ CRITICAL: Include box_id (carton_id for Transfer In)
          item_code: editModal.item.item_code,
          qty: qtyDifference, // Difference needed: positive for increase, negative for decrease
          store: transferInWarehouse, // ✅ CRITICAL: Include store (to_warehouse for Transfer In)
          device_id: settings.device_id ?? undefined,
          user_id: settings.user_id || settings.user_code || "USER",
        });
        console.log(`📦 Event created for quantity REPLACEMENT: transfer_in=${transferInNo}, item_code=${editModal.item.item_code}, old_qty=${oldQty}, new_qty=${newQty}, qty_difference=${qtyDifference}, carton_id=${cartonId || 'N/A'}`);
        
        // ✅ CRITICAL: Sync events immediately to ensure backend gets the update
        try {
          const syncResult = await syncEvents();
          console.log(`✅ Events synced: ${syncResult.synced} synced, ${syncResult.failed} failed`);
          
          if (syncResult.failed > 0) {
            console.warn(`⚠️ ${syncResult.failed} event(s) failed to sync - will retry later`);
          }
        } catch (syncError: any) {
          console.warn(`⚠️ Event sync failed (will retry later):`, syncError.message);
          // Don't block - events will sync later automatically
        }
        
        // ✅ CRITICAL: Update UI optimistically with the NEW quantity (REPLACE, not add)
        // This ensures UI shows the correct value immediately, even if backend hasn't processed yet
        const updatedItems = expectedItems.map((item) =>
          item.line_id === editModal.item!.line_id
            ? {
                ...item,
                received_qty: newQty, // ✅ REPLACE with new quantity (not add to existing)
                remaining_qty: item.expected_qty - newQty,
              }
            : item
        );
        // ✅ Bring last edited item to the top
        setLastModifiedItemId(editModal.item!.line_id);
        setExpectedItems(updatedItems);
        updateTotalScanned(updatedItems);
        
        // Mark session as dirty if offline
        const online = await isDeviceOnline();
        if (!online) {
          const session = await transferInReceivingSessionService.loadSession(transferInNo);
          if (session) {
            await transferInReceivingSessionService.saveSession({ ...session, is_dirty: true });
            setIsDirty(true);
          }
        }
        
        // ✅ Reload Transfer In after a delay to sync with backend
        // This ensures we get the latest data from backend (not cached)
        const itemCodeForReload = editModal.item.item_code;
        setTimeout(async () => {
          try {
            await loadTransferIn();
            console.log(`✅ Reloaded Transfer In after quantity REPLACEMENT (item: ${itemCodeForReload}, old: ${oldQty}, new: ${newQty})`);
          } catch (reloadError: any) {
            console.warn(`⚠️ Failed to reload Transfer In:`, reloadError.message);
            // Don't show error to user - UI is already updated optimistically
          }
        }, 2000); // 2 second delay to allow backend to process event and update received_qty

        // Show success message (store item_code before clearing modal)
        const itemCode = editModal.item.item_code;
        // ✅ Reuse 'online' variable declared earlier (line 528)
        setEditModal({ visible: false, item: null, newQty: "" });
        setLoading(false);
        
        // ✅ PERMANENT FIX: Refocus input after edit completes
        setTimeout(() => {
          barcodeInputRef.current?.focus();
        }, 300);
        
        const successMessage = online 
          ? `Quantity updated to ${newQty} for ${itemCode}.\n\nThe change has been sent to the backend.`
          : `Quantity updated to ${newQty} for ${itemCode}.\n\nThe change will be synced to backend when online.`;
        
        Alert.alert("Success", successMessage, [{ text: "OK" }]);
      } catch (error: any) {
        console.error("❌ Error updating quantity:", error);
        setLoading(false);
        Alert.alert("Error", `Failed to update quantity: ${error.message}`);
      }
    } catch (error: any) {
      // Outer try catch - handles errors from validation or settings retrieval
      console.error("❌ Error in handleSaveEditQty:", error);
      setLoading(false);
      Alert.alert("Error", `Failed to update quantity: ${error.message}`);
    }
  };

  // ✅ NEW: Close all open boxes for this carton before completing
  const closeAllBoxesForCarton = async (): Promise<boolean> => {
    if (!transferInNo || !cartonId) return true; // No boxes to close

    try {
      const db = await getDatabase();
      if (!db) return true;

      // Get all open boxes for this Transfer In and carton
      // ✅ NOTE: scanned_items uses asn_no field, so we use it for Transfer In
      const openBoxes = await db.getAllAsync<{ box_id: string }>(
        `SELECT DISTINCT box_id FROM scanned_items 
         WHERE asn_no = ? AND carton_id = ? AND box_id IS NOT NULL AND box_id != ''`,
        [transferInNo, cartonId]
      );

      if (openBoxes.length === 0) {
        console.log(`ℹ️ No boxes to close for carton ${cartonId}`);
        return true;
      }

      // Get unique box IDs
      const boxIds = [...new Set(openBoxes.map((b) => b.box_id))];

      // Close each box
      let allClosed = true;
      for (const boxId of boxIds) {
        const closed = await closeTransferInBox(boxId);
        if (!closed) {
          allClosed = false;
          console.warn(`⚠️ Failed to close box ${boxId}`);
        }
      }

      return allClosed;
    } catch (error: any) {
      console.error("❌ Error closing boxes:", error);
      return false;
    }
  };

  const handleCompleteReceiving = async () => {
    // ✅ Check if already completed
    if (isCompleted) {
      Alert.alert("Already Completed", "This Transfer In has already been completed.");
      return;
    }

    // Check if all items are fully received
    const allReceived = expectedItems.every(
      (item) => item.received_qty >= item.expected_qty
    );

    if (!allReceived) {
      Alert.alert(
        "Incomplete Receiving",
        "Not all items are fully received. Please complete receiving all items before finishing."
      );
      return;
    }

    Alert.alert(
      "Complete Receiving",
      "Are you sure you want to complete receiving?\n\n" +
      "This will:\n" +
      "1. Close all open boxes for this carton\n" +
      "2. Finalize the Transfer In and mark it as Received\n" +
      "3. Make boxes available for Putaway",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Complete",
          onPress: async () => {
            try {
              setLoading(true);
              
              // ✅ STEP 1: Sync pending events first
              try {
                const syncResult = await syncEvents();
                console.log(`✅ Synced ${syncResult.synced} event(s) before completing`);
                if (syncResult.failed > 0) {
                  console.warn(`⚠️ ${syncResult.failed} event(s) failed to sync - continuing with completion`);
                }
              } catch (syncError: any) {
                console.warn(`⚠️ Event sync failed before completion:`, syncError.message);
                // Continue - events will sync later
              }
              
              // ✅ NEW STEP 2: Close all open boxes for this carton (similar to ASN)
              const boxesClosed = await closeAllBoxesForCarton();
              if (!boxesClosed) {
                Alert.alert(
                  "Warning",
                  "Some boxes could not be closed. Please check and close them manually before completing.",
                  [{ text: "OK" }]
                );
                setLoading(false);
                return;
              }
              
              // ✅ STEP 3: Call backend complete endpoint
              let completed = false;
              try {
                if (apiService.completeTransferInReceiving) {
                  const completeResponse = await apiService.completeTransferInReceiving(transferInNo);
                  if (completeResponse?.ok || completeResponse?.success) {
                    completed = true;
                    console.log(`✅ Transfer In ${transferInNo} completed via complete-receiving endpoint`);
                  }
                } else {
                  throw new Error("completeTransferInReceiving method not available");
                }
              } catch (completeError: any) {
                if (completeError?.message?.includes("404") || completeError?.message?.includes("not found") || completeError?.message?.includes("not available")) {
                  console.warn(`⚠️ complete-receiving endpoint not available, trying update-status`);
                  try {
                    const statusResponse = await apiService.updateTransferInStatus(transferInNo, "Received");
                    if (statusResponse === null) {
                      console.warn(`⚠️ update-status endpoint also not available (404) - marking as completed locally`);
                      completed = true;
                    } else {
                      completed = true;
                      console.log(`✅ Transfer In ${transferInNo} status updated to "Received" via update-status endpoint`);
                    }
                  } catch (statusError: any) {
                    console.error(`❌ Error calling update-status endpoint:`, statusError.message);
                    throw statusError;
                  }
                } else {
                  throw completeError;
                }
              }
              
              // ✅ STEP 4: Mark completed locally
              if (completed) {
                setIsCompleted(true);
                console.log(`✅ Transfer In ${transferInNo} marked as completed - UI status will show "Received"`);
              }
              
              // ✅ STEP 5: Update session
              const session = await transferInReceivingSessionService.loadSession(transferInNo);
              if (session) {
                await transferInReceivingSessionService.saveSession({
                  ...session,
                  status: "Completed",
                  active_carton_id: cartonId || session.active_carton_id,
                  updated_at: new Date().toISOString(),
                });
                console.log(`✅ Marked receiving session as completed: ${session.session_id}`);
              }

              // ✅ STEP 6: Reload data
              await loadTransferIn();
              await loadAvailableBoxes();

              Alert.alert(
                "Success",
                "Receiving completed successfully!\n\n" +
                "All boxes have been closed and are now available for Putaway.",
                [
                  {
                    text: "Go to Putaway",
                    onPress: () => {
                      (navigation as any).navigate("PutAway");
                    },
                  },
                  {
                    text: "OK",
                    style: "cancel",
                    onPress: () => {
                      (navigation as any).navigate("Home");
                    },
                  },
                ]
              );
            } catch (error: any) {
              console.error("❌ Error completing receiving:", error);
              Alert.alert("Error", `Failed to complete receiving: ${error.message}`);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleChangeCarton = () => {
    Alert.alert(
      "Change Carton ID",
      "Do you want to change the carton ID?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Change",
          onPress: () => {
            // Clear current item scan input
            setBarcodeDraft("");
            // Navigate back to carton scan
            (navigation as any).navigate("TransferInReceivingScanCarton", {
              transferInNo,
              sessionId,
              transactionNo,
            });
          },
        },
      ]
    );
  };

  const getStatusBadge = (item: ExpectedItem) => {
    if (item.received_qty === 0) {
      return { text: "PENDING", color: PickingTheme.colors.statusPending };
    } else if (item.received_qty >= item.expected_qty) {
      return { text: "DONE", color: PickingTheme.colors.statusDone };
    } else {
      return { text: "PARTIAL", color: PickingTheme.colors.statusPartial };
    }
  };

  const renderExpectedItem = ({ item }: { item: ExpectedItem }) => {
    const status = getStatusBadge(item);
    const isDone = item.received_qty >= item.expected_qty;
    
    return (
      <View style={[styles.itemCard, isDone && styles.itemCardDone]}>
        {/* Row 1: Item Code + Req Badge */}
        <View style={styles.itemHeaderRow}>
          <Text style={styles.itemCodeBold}>{item.item_code}</Text>
          <View style={[styles.reqBadge, isDone && styles.reqBadgeDone]}>
            <Text style={styles.reqBadgeText}>Req: {item.expected_qty}</Text>
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
        
        {/* Bottom Stats Row: Received + Remaining + Edit Button */}
        <View style={styles.statsRow}>
          {/* Left: Received Qty */}
          <View style={styles.qtySection}>
            <Text style={styles.qtyLabel}>Received</Text>
            <Text style={[styles.qtyValueLarge, item.received_qty === 0 && styles.qtyValueZero]}>
              {item.received_qty}
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
          
          {/* Right: Edit Button */}
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.editButton, isCompleted && styles.editButtonDisabled]}
              onPress={() => {
                console.log(`🔍 Edit button pressed: isCompleted=${isCompleted}, item=${item.item_code}`);
                handleEditQty(item);
              }}
              disabled={isCompleted} // ✅ Disable Edit button ONLY when completed
            >
              <Text style={[styles.editButtonText, isCompleted && styles.editButtonTextDisabled]}>
                {isCompleted ? "Completed" : "Edit"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const allItemsReceived = expectedItems.every(
    (item) => item.received_qty >= item.expected_qty
  );

  if (loading && !transferIn) {
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
            <Text style={styles.headerTitle}>Transfer In Receiving</Text>
            <Text style={styles.tiNumberText}>TI: {transferInNo}</Text>
            {/* ✅ Display UI status: Shows "Receiving" until Complete is clicked */}
            <Text style={[styles.tiNumberText, { marginTop: 2, fontSize: 10 }]}>
              Status: {uiStatus}
            </Text>
          </View>
          <Text style={styles.scannedText}>
            {totalScanned} scanned
          </Text>
        </View>
        <View style={styles.headerInfoRow}>
          {transactionNo && (
            <View style={styles.taskBadge}>
              <Text style={styles.taskText}>Txn: {transactionNo}</Text>
            </View>
          )}
          <TouchableOpacity 
            style={styles.cartonBadge}
            onPress={handleChangeCarton}
          >
            <Text style={styles.cartonText}>Carton: {cartonId || "N/A"}</Text>
            <Text style={styles.changeTextSmall}>Tap to change</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.headerActionsRow}>
          {isDirty && (
            <TouchableOpacity 
              style={styles.syncButton} 
              onPress={async () => {
                try {
                  setLoading(true);
                  const { syncEvents } = await import("../services/event-queue.service");
                  await syncEvents();
                  
                  const session = await transferInReceivingSessionService.loadSession(transferInNo);
                  if (session) {
                    await transferInReceivingSessionService.saveSession({
                      ...session,
                      is_dirty: false,
                      updated_at: new Date().toISOString(),
                    });
                    setIsDirty(false);
                  }
                  
                  await loadTransferIn();
                  Alert.alert("Success", "Synced successfully.");
                } catch (error: any) {
                  Alert.alert("Error", `Failed to sync: ${error.message}`);
                } finally {
                  setLoading(false);
                }
              }}
            >
              <Text style={styles.syncButtonText}>🔄 Sync</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              styles.completeButtonSmall,
              !allItemsReceived && styles.completeButtonSmallDisabled,
            ]}
            onPress={handleCompleteReceiving}
            disabled={!allItemsReceived || loading || isCompleted}
          >
            <Text style={styles.completeButtonSmallText}>Complete</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Scan Item Card - Fixed at Top */}
      <View style={styles.scanCard}>
        <Text style={styles.scanCardTitle}>Scan Item Barcode</Text>
        <Text style={styles.scanCardSubtitle}>
          {isCompleted 
            ? "Receiving completed - scanning disabled" 
            : "Scan repeatedly to increment quantity"}
        </Text>
        <View style={styles.scanInputRow}>
          <BarcodeInput
            ref={barcodeInputRef}
            autoFocus={!!cartonId && cartonId.trim() !== "" && !isCompleted}
            disabled={
              !cartonId || cartonId.trim() === "" || isCompleted
            }
            placeholder={
              !cartonId || cartonId.trim() === ""
                ? "⚠️ Carton ID required - Tap Carton above to scan"
                : "Scan or enter barcode"
            }
            onChangeText={setBarcodeDraft}
            onBarcodeScanned={async (raw) => {
              const cleaned = raw.trim();
              if (!cleaned) return false;
              if (!cartonId || cartonId.trim() === "") {
                Alert.alert(
                  "Carton ID Required",
                  "Please scan a carton ID first before scanning items.",
                  [
                    {
                      text: "Scan Carton ID",
                      onPress: () => {
                        (navigation as any).navigate(
                          "TransferInReceivingScanCarton",
                          {
                            transferInNo,
                            sessionId,
                            transactionNo,
                          }
                        );
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
              (!cartonId || cartonId.trim() === "") &&
                styles.scanInputDisabled,
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
            disabled={
              scanning || !cartonId || isCompleted || !barcodeDraft.trim()
            }
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
        {/* Expected Items List */}
        <View style={styles.itemsSection}>
          <Text style={styles.itemsSectionTitle}>Expected Items</Text>
          {expectedItems.length === 0 ? (
            <View style={styles.emptyListContainer}>
              <Text style={styles.emptyListText}>No items to display</Text>
            </View>
          ) : (
            // ✅ Sort items: last scanned/edited item at the top
            [...expectedItems]
              .sort((a, b) => {
                // If lastModifiedItemId is set, bring that item to the top
                if (lastModifiedItemId) {
                  if (a.line_id === lastModifiedItemId) return -1;
                  if (b.line_id === lastModifiedItemId) return 1;
                }
                // Otherwise maintain original order
                return 0;
              })
              .map((item, index) => (
                <View key={item.line_id || `item-${index}`}>
                  {renderExpectedItem({ item })}
                </View>
              ))
          )}
        </View>
      </ScrollView>

      {/* Footer Frame */}
      <ScreenFooterFrame />

      {/* Edit Quantity Modal */}
      <Modal
        visible={editModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setEditModal({ visible: false, item: null, newQty: "" });
          // ✅ PERMANENT FIX: Refocus input when modal is closed
          setTimeout(() => {
            barcodeInputRef.current?.focus();
          }, 200);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Edit Quantity: {editModal.item?.item_code}
            </Text>
            <Text style={styles.modalSubtitle}>
              Expected: {editModal.item?.expected_qty}
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
                onPress={() => {
                  setEditModal({ visible: false, item: null, newQty: "" });
                  // ✅ PERMANENT FIX: Refocus input when modal is cancelled
                  setTimeout(() => {
                    barcodeInputRef.current?.focus();
                  }, 200);
                }}
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

      {/* ✅ NEW: BOX Selection Modal (similar to ASN) */}
      <Modal
        visible={boxSelectionModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setBoxSelectionModal({ visible: false, itemCode: "" });
          setPendingItemForBox(null);
          setCurrentItem(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              Select BOX for Item: {boxSelectionModal.itemCode}
            </Text>
            <Text style={styles.modalSubtitle}>
              Scan or select a BOX to sort this item
            </Text>
            
            <ScrollView style={{ maxHeight: 400 }}>
              {/* Available Boxes List */}
              {availableBoxes.length > 0 ? (
                <>
                  <Text style={[styles.modalSubtitle, { marginTop: 10, marginBottom: 10 }]}>
                    Available Boxes ({availableBoxes.length}):
                  </Text>
                  {availableBoxes.map((box) => (
                    <TouchableOpacity
                      key={box.box_id}
                      style={[
                        styles.boxOption,
                        { marginBottom: 8, padding: 12, backgroundColor: "#f5f5f5", borderRadius: 8 }
                      ]}
                      onPress={() => handleBoxSelected(box.box_id)}
                    >
                      <Text style={{ fontWeight: "bold", fontSize: 16 }}>{box.box_id}</Text>
                      <Text style={{ fontSize: 12, color: "#666" }}>
                        Store: {box.store || "WH-MAIN"} | Status: {box.status || "Open"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </>
              ) : (
                <Text style={[styles.modalSubtitle, { marginTop: 10, marginBottom: 10, color: "#666" }]}>
                  No boxes available. Create a new box below.
                </Text>
              )}
            </ScrollView>

            {/* Create New Box Button */}
            <TouchableOpacity
              style={[styles.modalSaveButton, { marginTop: 15, backgroundColor: PickingTheme.colors.buttonBlue }]}
              onPress={handleCreateNewBox}
              disabled={loading}
            >
              <Text style={styles.modalSaveText}>
                {loading ? "Creating..." : "+ Create New BOX (TI-PUT-...)"}
              </Text>
            </TouchableOpacity>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setBoxSelectionModal({ visible: false, itemCode: "" });
                  setPendingItemForBox(null);
                  setCurrentItem(null);
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
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
  tiNumberText: {
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
    marginTop: 4,
  },
  taskBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: PickingTheme.borderRadius.small,
    paddingHorizontal: PickingTheme.spacing.sm,
    paddingVertical: 4,
  },
  taskText: {
    ...PickingTheme.typography.caption,
    fontSize: 11,
    color: PickingTheme.colors.textWhite,
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
    paddingBottom: 10,
  },
  itemsSection: {
    padding: PickingTheme.spacing.md,
  },
  itemsSectionTitle: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.textPrimary,
    marginBottom: PickingTheme.spacing.md,
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
    opacity: 0.6,
  },
  editButtonText: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
  },
  editButtonTextDisabled: {
    color: PickingTheme.colors.textSecondary,
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
  boxOption: {
    // Style for box selection option in modal
    padding: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    marginBottom: 8,
  },
});
