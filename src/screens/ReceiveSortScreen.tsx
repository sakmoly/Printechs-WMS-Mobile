import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  FlatList,
  Modal,
  Dimensions,
  TextInput,
  Switch,
} from "react-native";
import {
  useNavigation,
  useRoute,
  useFocusEffect,
} from "@react-navigation/native";
import { useApp } from "../context/AppContext";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { StatusBadge } from "../components/StatusBadge";
import { addEvent } from "../services/event-queue.service";
import { dataService } from "../services/data.service";
import { apiService } from "../services/api.service";
import {
  pushReceivingCartonStatusServerThenLocal,
  pushReceivedCartonStatusServerThenLocal,
} from "../services/carton-status-sync.service";
import { getSettings } from "../services/settings.service";
import { getDatabase } from "../database/database";
import { resolveItemFromBarcode } from "../services/item-master.service";
import { normalizeASN } from "../utils/asn";
import { getServerUnloadLineForCarton } from "../utils/inbound-unload-server-check";
import {
  fetchBackendCartonLockFromASN,
  isOtherScannerLock,
  parseAsnPayloadForCartonLock,
} from "../utils/inbound-carton-lock-from-asn";
import { parseAsnPayloadForReceiveSortServerBlock } from "../utils/asn-carton-receive-server-gate";
import {
  storeCodesMatchForTO,
  compactStoreCodeKey,
  parseBoxIdStoreSlug,
} from "../utils/box-id";
import {
  itemCodesMatchForAllocation,
  storeFieldFromAllocationRow,
  itemCodeFromAllocationRow,
} from "../utils/allocation-row-fields";
import {
  qtyKeyForScannedState,
  scannedQtyLookup,
} from "../utils/scanned-qty-lookup";
import { canonicalStoreForToLine } from "../utils/to-store-master";
import { normalizeItemMasterBarcode } from "../utils/itemMasterBarcode";
import { ProgressIndicator } from "../components/ProgressIndicator";
import {
  saveWorkflowState,
  loadWorkflowState,
  clearWorkflowState,
} from "../services/workflow-state.service";
import { resendReceiveLinesToBackend } from "../services/receive-lines-resend.service";
import { settingsMatchUnloadedActor } from "../utils/unload-actor-match";
import {
  createdByFromApiBox,
  createdByFromSettings,
} from "../utils/box-created-by";
import { isDeviceOnline } from "../utils/network-check";

const RECEIVED_WITH_SHORTAGE_STATUS = "Received with Shortage";
const SHOW_SCAN_DETAILS_CARD = false;

const isCompletedCartonStatus = (status?: string | null) => {
  const normalized = String(status || "").trim().toUpperCase();
  return normalized === "RECEIVED" || normalized === "RECEIVED WITH SHORTAGE";
};

/**
 * Some backends return HTTP 200 with { locked: false, message: "... by <user>" }
 * when the carton is already active for that same user (resume / duplicate lock).
 * Local DB may still show Unloaded — do not treat that as "another user" blocking.
 * Match either user_id or user_code — ERP often uses one in lock text and the other on unload lines.
 */
function cartonLockResponseMeansCurrentUserAlreadyHolds(
  lockResponse: unknown,
  identity:
    | { user_id?: string | null; user_code?: string | null }
    | string
    | null
    | undefined
): boolean {
  const lr: any = lockResponse;
  if (!lr || typeof lr !== "object") return false;

  let ids: string[];
  if (identity && typeof identity === "object" && !Array.isArray(identity)) {
    ids = [
      String(identity.user_id ?? "").trim(),
      String(identity.user_code ?? "").trim(),
    ].filter(Boolean);
  } else {
    const s = String(identity ?? "").trim();
    ids = s ? [s] : [];
  }
  if (!ids.length) return false;

  const message = String(
    lr?.data?.message ?? lr?.message ?? lr?.error?.message ?? lr?.error ?? ""
  );

  const fromFields = String(
    lr?.data?.locked_by ??
      lr?.locked_by ??
      lr?.data?.existing_user ??
      lr?.existing_user ??
      lr?.data?.locked_user ??
      ""
  ).trim();

  const processedBy = message.match(
    /(?:being\s+)?processed\s+by\s+(\S+)/i
  );
  const fromMessage = processedBy ? processedBy[1].replace(/[.,;]+$/, "") : "";

  const holder = fromFields || fromMessage;
  if (!holder) return false;
  const h = holder.toLowerCase();
  return ids.some((id) => id.toLowerCase() === h);
}

async function requireOnlineForReceiving(): Promise<boolean> {
  const online = await isDeviceOnline();
  if (online) return true;
  Alert.alert(
    "Network Required",
    "Receiving requires a live server connection.\n\nPlease connect WiFi/mobile data, make sure the backend is reachable, then try again.",
  );
  return false;
}

function normalizeLockOwner(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function settingsMatchCartonLockOwner(
  settings: { user_id?: string | null; user_code?: string | null },
  lockedBy: unknown
): boolean {
  const owner = normalizeLockOwner(lockedBy);
  if (!owner) return false;

  return [settings.user_id, settings.user_code]
    .map(normalizeLockOwner)
    .filter(Boolean)
    .includes(owner);
}

type WorkflowState = "SELECT_CARTON" | "SCAN_ITEM" | "SCAN_BOX";

export default function ReceiveSortScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { activeASN, activeSession, refreshSettings } = useApp();
  const [workflowState, setWorkflowState] =
    useState<WorkflowState>("SELECT_CARTON");
  const [lockedCarton, setLockedCarton] = useState<string | null>(null);
  const [scannerFocusSignal, setScannerFocusSignal] = useState(0);
  const refocusScanner = useCallback((delayMs = 160) => {
    const refocus = () => setScannerFocusSignal((signal) => signal + 1);
    if (delayMs <= 0) {
      refocus();
      return;
    }
    setTimeout(refocus, delayMs);
  }, []);
  const [cartonItems, setCartonItems] = useState<any[]>([]);
  /** True while `loadCartonItems` is reading local `asn_carton_map` (per-device DB). */
  const [cartonLinesLoading, setCartonLinesLoading] = useState(false);
  const [cartonLinesLoadError, setCartonLinesLoadError] = useState<
    string | null
  >(null);
  const cartonLoadSeqRef = useRef(0);
  const [scannedItems, setScannedItems] = useState<any[]>([]);
  const [scannedQuantities, setScannedQuantities] = useState<
    Record<string, number>
  >({});
  const [totalScannedQuantities, setTotalScannedQuantities] = useState<
    Record<string, number>
  >({});
  // ✅ Backend received_qty per item (from getASN or getReceiveLines) – use after backend update
  const [backendReceivedByItem, setBackendReceivedByItem] = useState<
    Record<string, number> | null
  >(null);
  const [currentItem, setCurrentItem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendReceiveLinesLoading, setResendReceiveLinesLoading] = useState(false);
  const [availableCartons, setAvailableCartons] = useState<any[]>([]);
  const [warehousesAndStores, setWarehousesAndStores] = useState<any[]>([]);

  // Logging helper function - only log errors
  const logStateChange = (action: string, details: any) => {
    // Only log if it's an error or critical state change
    const errorKeywords = [
      "ERROR",
      "FAILED",
      "FAIL",
      "EXCEPTION",
      "INVALID",
      "MISSING",
    ];
    const isError = errorKeywords.some((keyword) =>
      action.toUpperCase().includes(keyword)
    );

    if (isError) {
      const timestamp = new Date().toISOString();
      console.error(`❌ [${timestamp}] ERROR: ${action}`, {
        ...details,
        currentState: {
          workflowState,
          lockedCarton,
          scannedItemsCount: scannedItems.length,
          scannedQuantitiesKeys: Object.keys(scannedQuantities),
          currentItem,
          cartonItemsCount: cartonItems.length,
        },
      });
    }
    // Silently skip non-error logs
  };

  // Wrapper functions to log state changes
  const setWorkflowStateWithLog = (newState: WorkflowState) => {
    logStateChange("SET_WORKFLOW_STATE", {
      from: workflowState,
      to: newState,
    });
    setWorkflowState(newState);
  };

  const setLockedCartonWithLog = (carton: string | null) => {
    logStateChange("SET_LOCKED_CARTON", {
      from: lockedCarton,
      to: carton,
    });
    setLockedCarton(carton);
  };

  const setScannedItemsWithLog = (items: any[]) => {
    logStateChange("SET_SCANNED_ITEMS", {
      fromCount: scannedItems.length,
      toCount: items.length,
      fromItems: scannedItems.map((i) => ({
        item: i.item_code,
        box: i.box_id,
      })),
      toItems: items.map((i) => ({ item: i.item_code, box: i.box_id })),
    });
    setScannedItems(items);
  };

  const setScannedQuantitiesWithLog = (quantities: Record<string, number>) => {
    logStateChange("SET_SCANNED_QUANTITIES", {
      fromKeys: Object.keys(scannedQuantities),
      toKeys: Object.keys(quantities),
      fromValues: scannedQuantities,
      toValues: quantities,
    });
    setScannedQuantities(quantities);
  };

  const setCurrentItemWithLog = (item: string | null) => {
    logStateChange("SET_CURRENT_ITEM", {
      from: currentItem,
      to: item,
    });
    setCurrentItem(item);
  };

  const setCartonItemsWithLog = (items: any[]) => {
    logStateChange("SET_CARTON_ITEMS", {
      fromCount: cartonItems.length,
      toCount: items.length,
    });
    setCartonItems(items);
  };
  const [lockInfo, setLockInfo] = useState<{
    locked_by?: string;
    locked_on?: string;
  } | null>(null);
  const [availableBoxes, setAvailableBoxes] = useState<any[]>([]);
  const [filteredAvailableBoxes, setFilteredAvailableBoxes] = useState<any[]>(
    []
  );
  /** When on, carton lists only show rows whose `created_by` matches Settings (user_id / user_code). */
  const [onlyMySortBoxes, setOnlyMySortBoxes] = useState(true);
  const [sortBoxUser, setSortBoxUser] = useState<{
    user_id?: string;
    user_code?: string;
  }>({});
  const onlyMySortBoxesRef = useRef(true);
  useEffect(() => {
    onlyMySortBoxesRef.current = onlyMySortBoxes;
  }, [onlyMySortBoxes]);
  // Track item quantities in each box for the current item being edited
  const [boxItemQuantities, setBoxItemQuantities] = useState<
    Record<string, number>
  >({});
  const [showCreateBox, setShowCreateBox] = useState(false);
  const [selectedStoreForBox, setSelectedStoreForBox] = useState("SR-01");
  const [availableStoresForBox, setAvailableStoresForBox] = useState<string[]>(
    []
  );
  const [showAvailableBoxes, setShowAvailableBoxes] = useState(false);
  const [itemDetailsModal, setItemDetailsModal] = useState<{
    visible: boolean;
    itemCode: string;
    scannedQty: number;
    totalTOQty: number;
    putawayQty?: number; // Putaway quantity for this item
    remainingQty: number;
    asnQty?: number; // ASN quantity for this item
    allocations: {
      store: string;
      allocatedQty: number;
      scannedQty: number;
      boxes: string[];
    }[];
  } | null>(null);
  const [lastScannedItem, setLastScannedItem] = useState<string | null>(null);
  const [lastScannedBox, setLastScannedBox] = useState<string | null>(null);
  const [quickScanDetailsCollapsed, setQuickScanDetailsCollapsed] =
    useState(false);
  const [transferOrderAllocations, setTransferOrderAllocations] = useState<
    any[]
  >([]);
  /** Inline feedback after scans (success/errors that would otherwise be silent). */
  const [scanFeedback, setScanFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const scanFeedbackClearRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const showScanFeedback = useCallback((kind: "ok" | "err", text: string) => {
    if (scanFeedbackClearRef.current) {
      clearTimeout(scanFeedbackClearRef.current);
      scanFeedbackClearRef.current = null;
    }
    setScanFeedback({ kind, text });
    scanFeedbackClearRef.current = setTimeout(() => {
      setScanFeedback(null);
      scanFeedbackClearRef.current = null;
    }, 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (scanFeedbackClearRef.current) {
        clearTimeout(scanFeedbackClearRef.current);
      }
    };
  }, []);
  const [showExpectedItemsModal, setShowExpectedItemsModal] = useState(false);
  const [showScannedItemsModal, setShowScannedItemsModal] = useState(false);
  const [showDistributionDetailsModal, setShowDistributionDetailsModal] =
    useState(false);
  const [distributionDetailsLoading, setDistributionDetailsLoading] =
    useState(false);
  const [liveDistributionDetails, setLiveDistributionDetails] =
    useState<any | null>(null);
  const [expectedItemsSearchQuery, setExpectedItemsSearchQuery] = useState("");
  const [scannedItemsSearchQuery, setScannedItemsSearchQuery] = useState("");
  const [manualQtyItem, setManualQtyItem] = useState<string | null>(null);
  const [manualQtyValue, setManualQtyValue] = useState("");
  const [manualQtyBox, setManualQtyBox] = useState<string | null>(null);
  const [toBreakdownModal, setToBreakdownModal] = useState<{
    visible: boolean;
    itemCode: string;
    breakdown: {
      store: string;
      toQty: number;
      scannedQty: number;
      remainingQty: number;
      scannedByCarton?: Map<string, number>; // Add carton breakdown per store
    }[];
    scannedByCarton: Map<string, number>;
    totalScanned?: number; // Total scanned from database (for comparison)
    unmatchedScanned?: number; // Scanned items that don't match any TO allocation
    unmatchedItems?: {
      box_id: string | null;
      store: string | null;
      carton_id: string | null;
      scanned_qty: number;
    }[]; // Details of unmatched items
  } | null>(null);
  const [editQtyModal, setEditQtyModal] = useState<{
    visible: boolean;
    itemCode: string;
    store: string;
    allocatedQty: number;
    currentScannedQty: number;
    isPutaway?: boolean; // Flag to indicate if editing Putaway quantity
  } | null>(null);
  const [editQtyValue, setEditQtyValue] = useState("");
  const [showCreateCTNModal, setShowCreateCTNModal] = useState(false);
  const [toStoresForCTN, setToStoresForCTN] = useState<string[]>([]);
  const [remainingItemsQty, setRemainingItemsQty] = useState(0);
  const [creatingCTNForStore, setCreatingCTNForStore] = useState<string | null>(
    null
  );
  const [showCTNIdPrompt, setShowCTNIdPrompt] = useState(false);
  const ctnIdPromptInputRef = React.useRef<TextInput>(null);
  const [ctnIdPromptValue, setCtnIdPromptValue] = useState("");
  const [pendingItemScan, setPendingItemScan] = useState<string | null>(null);
  const [pendingBoxScan, setPendingBoxScan] = useState<string | null>(null);
  const [isProcessingScan, setIsProcessingScan] = useState(false); // Guard against duplicate processing

  useEffect(() => {
    if (workflowState === "SCAN_ITEM" || workflowState === "SCAN_BOX") {
      refocusScanner();
    }
  }, [workflowState, currentItem, lockedCarton, refocusScanner]);

  // Load warehouses and stores from master table for allocation validation
  useEffect(() => {
    const loadWarehousesAndStores = async () => {
      try {
        const response = await apiService.getWarehousesAndStores();

        // Handle different response formats
        let storesList: any[] = [];
        if (Array.isArray(response)) {
          storesList = response;
        } else if (response && typeof response === "object") {
          if (Array.isArray(response.data)) {
            storesList = response.data;
          } else if (Array.isArray(response.stores)) {
            storesList = response.stores;
          } else if (Array.isArray(response.items)) {
            storesList = response.items;
          }
        }

        console.log(
          `📦 Loaded ${storesList.length} warehouses/stores for allocation validation`
        );
        setWarehousesAndStores(storesList);
      } catch (error: any) {
        console.warn("⚠️ Could not fetch warehouses/stores:", error);
        try {
          const db = await getDatabase();
          if (db) {
            const cached = await db.getAllAsync<{
              code: string;
              name: string;
              warehouse_type: string;
            }>(
              "SELECT code, name, warehouse_type FROM warehouse_store_cache ORDER BY code"
            );
            setWarehousesAndStores(cached || []);
          } else {
            setWarehousesAndStores([]);
          }
        } catch {
          setWarehousesAndStores([]);
        }
      }
    };

    loadWarehousesAndStores();
  }, []);

  // Restore activeASN from settings if lost (e.g., after completing a carton)
  useEffect(() => {
    const restoreActiveASN = async () => {
      if (!activeASN || !activeSession) {
        await refreshSettings();
        const settings = await getSettings();
        if (!settings.active_asn || !settings.active_session) {
          console.error(
            "❌ ERROR: Failed to restore activeASN and session from settings"
          );
        }
      }
    };
    restoreActiveASN();
  }, [activeASN, activeSession, refreshSettings]);

  // Load available cartons
  useEffect(() => {
    loadAvailableCartons();
  }, [activeASN, activeSession]);

  // Track if we've loaded saved state to prevent multiple loads
  const [savedStateLoaded, setSavedStateLoaded] = React.useState(false);

  // Load saved workflow state on mount (only if no cartonId in route params AND no carton is currently locked)
  useEffect(() => {
    if (activeASN && activeSession && !savedStateLoaded) {
      const params = route.params as { cartonId?: string } | undefined;
      const cartonIdFromParams = params?.cartonId
        ? params.cartonId.trim().toUpperCase()
        : undefined;

      // Only load saved state if:
      // 1. No cartonId in route params (not navigating from Unload screen)
      // 2. No carton is currently locked (to avoid overwriting a freshly locked carton)
      // 3. We haven't already loaded saved state
      if (!cartonIdFromParams && !lockedCarton) {
        loadSavedState();
        setSavedStateLoaded(true);
      } else {
        if (cartonIdFromParams) {
          // Don't mark as loaded yet - let the useEffect that processes cartonId handle it
          // This allows saved state to be checked if carton is already locked
        } else if (lockedCarton) {
          setSavedStateLoaded(true); // Mark as loaded to prevent loading later
        }
      }
    }
  }, [activeASN, activeSession, route.params, lockedCarton, savedStateLoaded]);

  /** Source of truth for on-screen scan counts — never replace with stale workflow file alone. */
  const refreshScannedStateFromDb = useCallback(async () => {
    if (!activeASN || !activeSession) return;
    try {
      const db = await getDatabase();
      const na = normalizeASN(activeASN);
      const scannedItemsFromDB = await db.getAllAsync<{
        item_code: string;
        box_id: string | null;
        store: string | null;
        scanned_qty: number;
        carton_id: string | null;
      }>(
        `SELECT item_code, box_id, store, scanned_qty, carton_id 
         FROM scanned_items 
         WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ?`,
        [activeASN, na, activeSession]
      );

      const lock = lockedCarton?.trim() ?? "";
      const rowsForUi =
        lock.length > 0
          ? scannedItemsFromDB.filter(
              (row) =>
                String(row.carton_id ?? "").trim() !== "" &&
                String(row.carton_id).trim().toUpperCase() === lock.toUpperCase()
            )
          : scannedItemsFromDB;

      // List + per-item totals for the current supplier carton only (same BOX across cartons must not mix counts)
      setScannedItemsWithLog(rowsForUi);

      const scannedQtyMap = new Map<string, number>();
      rowsForUi.forEach((row) => {
        const code = qtyKeyForScannedState(row.item_code);
        if (!code) return;
        const current = scannedQtyMap.get(code) || 0;
        scannedQtyMap.set(code, current + (row.scanned_qty || 0));
      });
      const newScannedQuantities: Record<string, number> = {};
      scannedQtyMap.forEach((qty, code) => {
        newScannedQuantities[code] = qty;
      });
      setScannedQuantitiesWithLog(newScannedQuantities);

      // Session-wide totals (all supplier cartons) — used where a global view is needed
      const totalScannedItemsFromDB = await db.getAllAsync<{
        item_code: string;
        scanned_qty: number;
      }>(
        `SELECT item_code, SUM(scanned_qty) as scanned_qty 
         FROM scanned_items 
         WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ?
         GROUP BY item_code`,
        [activeASN, na, activeSession]
      );
      const quantitiesMap: Record<string, number> = {};
      totalScannedItemsFromDB.forEach((row) => {
        const code = qtyKeyForScannedState(row.item_code);
        if (!code) return;
        quantitiesMap[code] = row.scanned_qty || 0;
      });
      setTotalScannedQuantities(quantitiesMap);
    } catch (e: any) {
      console.warn("refreshScannedStateFromDb failed:", e?.message);
    }
  }, [activeASN, activeSession, lockedCarton]);

  const loadSavedState = useCallback(async () => {
    if (!activeASN || !activeSession) return;
    const normalizedASN = normalizeASN(activeASN);
    const savedState = await loadWorkflowState(
      normalizedASN,
      activeSession,
      "ReceiveSort"
    );

    if (savedState) {
      // Only restore if we don't already have a locked carton (to avoid overwriting)
      // Double-check here as well in case state changed between useEffect and this function
      if (!lockedCarton) {
        logStateChange("LOAD_SAVED_STATE", {
          savedState: {
            locked_carton: savedState.locked_carton,
            workflow_state: savedState.workflow_state,
            scanned_items_count: savedState.scanned_items?.length || 0,
            scanned_quantities_keys: Object.keys(
              savedState.scanned_quantities || {}
            ),
            current_item: savedState.current_item,
          },
        });
        setLockedCartonWithLog(savedState.locked_carton);
        setCurrentItemWithLog(savedState.current_item);
        await refreshScannedStateFromDb();
        const restoredScanned = savedState.scanned_items || [];
        const lastFromSaved =
          restoredScanned.length > 0
            ? String(
                restoredScanned[restoredScanned.length - 1]?.item_code ?? ""
              ).trim()
            : "";
        setLastScannedItem(lastFromSaved || null);
        // Always start with SCAN_ITEM if there's no currentItem
        // This ensures the flow is: Scan Item → Scan Box → Scan Item → Scan Box
        if (!savedState.current_item) {
          setWorkflowStateWithLog("SCAN_ITEM");
        } else {
          setWorkflowStateWithLog(savedState.workflow_state as WorkflowState);
        }

        // Load carton items if carton is locked
        if (savedState.locked_carton) {
          let items = await dataService.getCartonItems(
            activeASN, // Use original format (cartons are stored with original format)
            savedState.locked_carton
          );
          if (items.length === 0) {
            const hydrated = await dataService.hydrateCartonLinesFromAsnApi(
              activeASN,
              savedState.locked_carton
            );
            if (hydrated.ok) {
              items = await dataService.getCartonItems(
                activeASN,
                savedState.locked_carton
              );
            }
          }
          setCartonItemsWithLog(items);

          // Verify carton is still locked by current user (in case app was restarted)
          const settings = await getSettings();
          const cartonStatus = await dataService.getCartonStatus(
            normalizedASN,
            activeSession,
            savedState.locked_carton
          );

          if (cartonStatus && cartonStatus.status === "Receiving") {
            const isSameUser = settingsMatchCartonLockOwner(
              settings,
              cartonStatus.locked_by
            );
            if (!isSameUser) {
              console.log(
                "⚠️ Carton locked by another user/device; not restoring ReceiveSort state",
                {
                  carton: savedState.locked_carton,
                  locked_by: cartonStatus.locked_by,
                  current_user: settings.user_id,
                  current_user_code: settings.user_code,
                }
              );
              setLockedCartonWithLog(null);
              setWorkflowStateWithLog("SELECT_CARTON");
              setScannedItemsWithLog([]);
              setScannedQuantitiesWithLog({});
              setCurrentItemWithLog(null);
              cartonLoadSeqRef.current += 1;
              setCartonLinesLoading(false);
              setCartonLinesLoadError(null);
              setCartonItemsWithLog([]);
              setLastScannedItem(null);
              await clearWorkflowState(
                normalizedASN,
                activeSession,
                "ReceiveSort"
              );
              Alert.alert(
                "Carton Already Locked",
                `Carton ${savedState.locked_carton} is locked by ${
                  cartonStatus.locked_by || "another user"
                }.\n\nYou cannot continue this carton from this device.`
              );
              return;
            }
            setLockInfo({
              locked_by: cartonStatus.locked_by,
              locked_on: cartonStatus.locked_on,
            });
          } else if (cartonStatus && isCompletedCartonStatus(cartonStatus.status)) {
            // Carton already completed - clear the saved state
            logStateChange("CLEAR_STATE_CARTON_COMPLETED", {
              carton: savedState.locked_carton,
            });
            setLockedCartonWithLog(null);
            setWorkflowStateWithLog("SELECT_CARTON");
            setScannedItemsWithLog([]);
            setScannedQuantitiesWithLog({});
            setCurrentItemWithLog(null);
            cartonLoadSeqRef.current += 1;
            setCartonLinesLoading(false);
            setCartonLinesLoadError(null);
            setCartonItemsWithLog([]);
            setLastScannedItem(null);
            await clearWorkflowState(
              normalizedASN,
              activeSession,
              "ReceiveSort"
            );
          }
        }
      } else {
        // Skipping saved state restore - carton already locked
      }
    }
  }, [activeASN, activeSession, lockedCarton, refreshScannedStateFromDb]);

  // Save workflow state whenever it changes (with debounce to avoid too many saves)
  useEffect(() => {
    if (!activeASN || !activeSession) return;

    const timeoutId = setTimeout(() => {
      saveCurrentState();
    }, 500); // Debounce: save 500ms after last change

    return () => clearTimeout(timeoutId);
  }, [
    workflowState,
    lockedCarton,
    currentItem,
    scannedItems,
    scannedQuantities,
    activeASN,
    activeSession,
  ]);

  const [allCartonsStatus, setAllCartonsStatus] = useState<{
    total: number;
    unloaded: number;
    inReceiving: number;
    inReceivingByCurrentUser: number;
    received: number;
  }>({
    total: 0,
    unloaded: 0,
    inReceiving: 0,
    inReceivingByCurrentUser: 0,
    received: 0,
  });

  const loadAvailableCartons = async () => {
    if (!activeASN || !activeSession) return;

    // Pass original ASN format (not normalized) to getAllCartonStatuses
    // getAllCartonStatuses will handle normalization internally
    const statuses = await dataService.getAllCartonStatuses(
      activeASN, // Use original format
      activeSession
    );

    // CRITICAL: Filter cartons to only include those that actually belong to this ASN
    // This prevents cartons from other ASNs (e.g., "ASN-0001" vs "ASN-00001") from appearing
    // We validate by checking if the carton exists in asn_carton_map for this specific ASN
    const db = await getDatabase();

    // Get all valid carton IDs for this ASN from asn_carton_map (source of truth)
    // Try original format first, then normalized for backward compatibility
    let validCartonIds = await db.getAllAsync<{ carton_id: string }>(
      "SELECT DISTINCT carton_id FROM asn_carton_map WHERE asn_no = ?",
      [activeASN] // Use original format first
    );

    // If no results and ASN was normalized, try with normalized format
    const normalizedASN = normalizeASN(activeASN);
    if (validCartonIds.length === 0 && activeASN !== normalizedASN) {
      validCartonIds = await db.getAllAsync<{ carton_id: string }>(
        "SELECT DISTINCT carton_id FROM asn_carton_map WHERE asn_no = ?",
        [normalizedASN]
      );
    }

    const validCartonIdSet = new Set(
      validCartonIds.map((c) => c.carton_id.toUpperCase())
    );

    // Filter statuses to only include cartons that belong to this ASN
    const validStatuses = statuses.filter((status) =>
      validCartonIdSet.has(status.carton_id.toUpperCase())
    );

    const settings = await getSettings();

    const isReceivingByCurrentUser = (c: any) =>
      c.status === "Receiving" &&
      settingsMatchCartonLockOwner(settings, c.locked_by);

    // Calculate status counts from valid statuses only
    const statusCounts = {
      total: validStatuses.length,
      unloaded: validStatuses.filter((c) => c.status === "Unloaded").length,
      inReceiving: validStatuses.filter((c) => c.status === "Receiving").length,
      inReceivingByCurrentUser: validStatuses.filter(isReceivingByCurrentUser)
        .length,
      received: validStatuses.filter((c) => isCompletedCartonStatus(c.status)).length,
    };
    setAllCartonsStatus(statusCounts);

    // Show cartons that are:
    // 1. Unloaded (available to start)
    // 2. Receiving and locked by current user (in-progress cartons to resume)
    // 3. Pending (can be scanned to start - will be unloaded automatically)
    const available = validStatuses.filter((c) => {
      if (c.status === "Unloaded") {
        const unloadedBy = String(c.unloaded_by || "").trim();
        return (
          unloadedBy.length > 0 &&
          settingsMatchUnloadedActor(settings, unloadedBy)
        );
      }
      if (c.status === "Pending") return true; // Show pending cartons - can be scanned to start
      if (c.status === "Receiving") {
        return isReceivingByCurrentUser(c);
      }
      return false;
    });

    console.log("📦 Available cartons for ReceiveSort:", {
      total: statuses.length,
      available: available.length,
      unloaded: statusCounts.unloaded,
      pending: statuses.filter((c) => c.status === "Pending").length,
      inReceiving: statusCounts.inReceiving,
      inReceivingByUser: statusCounts.inReceivingByCurrentUser,
      currentUserId: settings.user_id,
      currentUserCode: settings.user_code,
      allStatuses: statuses.map((c) => ({
        carton: c.carton_id,
        status: c.status,
        locked_by: c.locked_by,
        unloaded_by: c.unloaded_by,
      })),
    });

    setAvailableCartons(available);
  };

  const saveCurrentState = async () => {
    if (!activeASN || !activeSession) return;
    const normalizedASN = normalizeASN(activeASN);

    await saveWorkflowState({
      asn_no: normalizedASN,
      inbound_session: activeSession,
      screen_name: "ReceiveSort",
      workflow_state: workflowState,
      locked_carton: lockedCarton,
      current_item: currentItem,
      scanned_items: scannedItems,
      scanned_quantities: scannedQuantities,
    });
  };

  /**
   * Fetch updated received_qty from backend (getASN or getReceiveLines).
   * Call after finish carton and on screen focus so summary shows backend qty.
   */
  const refreshASNReceivedQtyFromBackend = useCallback(async () => {
    if (!activeASN || !activeSession) return;
    try {
      const asnRes = await apiService.getASN(activeASN);
      const details =
        asnRes?.details ??
        asnRes?.data?.details ??
        (Array.isArray(asnRes) ? asnRes : null);
      const byItem: Record<string, number> = {};
      if (details && Array.isArray(details)) {
        for (const row of details as any[]) {
          const code = row.item_code ?? row.itemCode;
          const recv = row.received_qty ?? row.recvd_qty ?? row.receivedQty ?? 0;
          if (code) {
            byItem[code] = (byItem[code] ?? 0) + Number(recv);
          }
        }
      }
      if (Object.keys(byItem).length === 0) {
        const linesRes = await apiService.getReceiveLines(activeSession);
        const lines =
          linesRes?.receive_lines ??
          linesRes?.data?.receive_lines ??
          (Array.isArray(linesRes) ? linesRes : []);
        if (Array.isArray(lines)) {
          for (const row of lines as any[]) {
            const code = row.item_code ?? row.itemCode;
            const recv = row.received_qty ?? row.recvd_qty ?? row.receivedQty ?? 0;
            if (code) {
              byItem[code] = (byItem[code] ?? 0) + Number(recv);
            }
          }
        }
      }
      if (Object.keys(byItem).length === 0 && asnRes) {
        const cartons = asnRes.cartons ?? asnRes.data?.cartons ?? [];
        if (Array.isArray(cartons)) {
          for (const carton of cartons) {
            const items = carton.items ?? carton.details ?? [];
            for (const item of items) {
              const code = item.item_code ?? item.itemCode;
              const recv = item.received_qty ?? item.recvd_qty ?? item.receivedQty ?? 0;
              if (code) {
                byItem[code] = (byItem[code] ?? 0) + Number(recv);
              }
            }
          }
        }
      }
      if (Object.keys(byItem).length > 0) {
        setBackendReceivedByItem(byItem);
        console.log(
          "✅ Refreshed ASN received qty from backend:",
          Object.keys(byItem).length,
          "items"
        );
      } else {
        setBackendReceivedByItem(null);
      }
    } catch (e: any) {
      console.warn("⚠️ Refresh ASN received qty from backend failed:", e?.message);
      setBackendReceivedByItem(null);
    }
  }, [activeASN, activeSession]);

  /** Resend all receive lines from local DB to backend (e.g. when user taps Sync). */
  const handleResendReceiveLines = useCallback(async () => {
    if (!activeASN || !activeSession) return;
    setResendReceiveLinesLoading(true);
    try {
      const result = await resendReceiveLinesToBackend(activeASN, activeSession);
      await refreshASNReceivedQtyFromBackend();
      if (result.linesSent > 0) {
        Alert.alert(
          "Sync receive data",
          `Resent ${result.linesSent} receive line(s) from ${result.cartonsSent} carton(s) to the backend.`
        );
      } else {
        Alert.alert(
          "Sync receive data",
          "No scanned items to resend. Scan and finish cartons first, or data is already in sync."
        );
      }
    } catch (e: any) {
      console.warn("Resend receive lines failed:", e?.message);
      Alert.alert("Sync failed", e?.message || "Failed to resend receive data.");
    } finally {
      setResendReceiveLinesLoading(false);
    }
  }, [activeASN, activeSession, refreshASNReceivedQtyFromBackend]);

  // Reset state when screen is focused (to handle navigation from Unload screen)
  // Also check for saved state when returning to screen after app restart
  useFocusEffect(
    React.useCallback(() => {
      void getSettings().then((s) =>
        setSortBoxUser({
          user_id: s.user_id ? String(s.user_id).trim() : undefined,
          user_code: s.user_code ? String(s.user_code).trim() : undefined,
        })
      );
      // ✅ Get updated received qty from backend when screen gains focus
      if (activeASN && activeSession) {
        refreshASNReceivedQtyFromBackend();
      }
      // When screen is focused, check if we have a cartonId in params
      const params = route.params as { cartonId?: string } | undefined;
      const cartonIdFromParams = params?.cartonId
        ? params.cartonId.trim().toUpperCase()
        : undefined;

      console.log("🔍 ReceiveSort useFocusEffect:", {
        cartonIdFromParams,
        activeASN,
        activeSession,
        lockedCarton,
        workflowState,
        savedStateLoaded,
      });

      // If we have a cartonId in params
      if (cartonIdFromParams) {
        if (lockedCarton && lockedCarton !== cartonIdFromParams) {
          // Different carton selected - clear previous carton state
          logStateChange("CLEAR_STATE_NEW_CARTON_IN_FOCUS", {
            previousCarton: lockedCarton,
            newCarton: cartonIdFromParams,
          });
          setLockedCartonWithLog(null);
          setWorkflowStateWithLog("SELECT_CARTON");
          setScannedItemsWithLog([]);
          setScannedQuantitiesWithLog({});
          setCurrentItemWithLog(null);
          cartonLoadSeqRef.current += 1;
          setCartonLinesLoading(false);
          setCartonLinesLoadError(null);
          setCartonItemsWithLog([]);
          setSavedStateLoaded(false); // Allow saved state to be reloaded

          // Clear saved workflow state
          if (activeASN && activeSession) {
            const normalizedASN = normalizeASN(activeASN);
            clearWorkflowState(normalizedASN, activeSession, "ReceiveSort");
          }
        } else if (lockedCarton === cartonIdFromParams) {
          // Same carton already locked - restore saved state if component was remounted
          if (activeASN && activeSession) {
            const normalizedASN = normalizeASN(activeASN);
            loadWorkflowState(normalizedASN, activeSession, "ReceiveSort").then(
              (savedState) => {
                if (
                  savedState &&
                  savedState.locked_carton === cartonIdFromParams
                ) {
                  // Restoring saved state in useFocusEffect
                  logStateChange("RESTORE_STATE_IN_FOCUS_EFFECT", {
                    carton: cartonIdFromParams,
                    savedState: {
                      workflow_state: savedState.workflow_state,
                      scanned_items_count:
                        savedState.scanned_items?.length || 0,
                      scanned_quantities_keys: Object.keys(
                        savedState.scanned_quantities || {}
                      ),
                    },
                  });
                  setCurrentItemWithLog(savedState.current_item);
                  setWorkflowStateWithLog(
                    savedState.workflow_state as WorkflowState
                  );
                  void refreshScannedStateFromDb();
                }
              }
            );
          }
        }
        // If lockedCarton is null and we have a cartonId - let the useEffect handle locking and restoration
      } else {
        // No cartonId in params - user navigated directly to this screen
        // Check if we should load saved state (user returning after app restart)
        if (activeASN && activeSession && !lockedCarton && !savedStateLoaded) {
          // Small delay to ensure state is stable
          const timer = setTimeout(() => {
            loadSavedState();
            setSavedStateLoaded(true);
          }, 100);
          return () => clearTimeout(timer);
        }
      }
    }, [
      route.params,
      activeASN,
      activeSession,
      lockedCarton,
      workflowState,
      savedStateLoaded,
      loadSavedState,
      refreshASNReceivedQtyFromBackend,
      refreshScannedStateFromDb,
    ])
  );

  // Auto-lock carton if passed from Unload screen
  useEffect(() => {
    const params = route.params as { cartonId?: string } | undefined;
    // Extract cartonId immediately to avoid closure issues
    const cartonIdFromParams = params?.cartonId
      ? params.cartonId.trim().toUpperCase()
      : undefined;

    // Process carton from route params - don't require workflowState to be SELECT_CARTON
    // This allows processing even if there's saved state with a different workflowState
    if (cartonIdFromParams && activeASN && activeSession) {
      // If a different carton is already locked, clear it first
      if (lockedCarton && lockedCarton !== cartonIdFromParams) {
        logStateChange("CLEAR_STATE_DIFFERENT_CARTON_IN_USE_EFFECT", {
          previousCarton: lockedCarton,
          newCarton: cartonIdFromParams,
        });
        setLockedCartonWithLog(null);
        setWorkflowStateWithLog("SELECT_CARTON");
        setScannedItemsWithLog([]);
        setScannedQuantitiesWithLog({});
        setCurrentItemWithLog(null);
        cartonLoadSeqRef.current += 1;
        setCartonLinesLoading(false);
        setCartonLinesLoadError(null);
        setCartonItemsWithLog([]);
        // Wait a bit for state to clear, then continue - trigger the useEffect again
        setTimeout(() => {
          // Force re-trigger by updating route params
          navigation.setParams({ cartonId: cartonIdFromParams } as never);
        }, 200);
        return;
      }

      // If the same carton is already locked locally, restore saved state and don't re-lock it
      if (lockedCarton === cartonIdFromParams) {
        console.log(
          `✅ Carton ${cartonIdFromParams} is already locked locally, restoring saved state`
        );
        // Load saved workflow state to ensure scanned items are restored
        (async () => {
          const normalizedASN = normalizeASN(activeASN);
          const savedState = await loadWorkflowState(
            normalizedASN,
            activeSession,
            "ReceiveSort"
          );
          if (savedState && savedState.locked_carton === cartonIdFromParams) {
            // Restoring saved state for already-locked carton (counts from DB, not workflow file)
            setCurrentItemWithLog(savedState.current_item);
            // Always start with SCAN_ITEM if there's no currentItem
            // This ensures the flow is: Scan Item → Scan Box → Scan Item → Scan Box
            if (!savedState.current_item) {
              setWorkflowStateWithLog("SCAN_ITEM");
            } else {
              setWorkflowStateWithLog(
                savedState.workflow_state as WorkflowState
              );
            }
            await refreshScannedStateFromDb();
          }
        })();
        // Clear route params to prevent re-processing
        navigation.setParams({ cartonId: undefined } as never);
        return;
      }

      // Check database first to see if carton is already locked by current user
      // This handles the case where component state was reset but carton is still locked in DB
      const checkDatabaseAndRestore = async () => {
        try {
          const normalizedASN = normalizeASN(activeASN);
          const settings = await getSettings();
          const status = await dataService.getCartonStatus(
            normalizedASN,
            activeSession,
            cartonIdFromParams
          );

          console.log(
            `🔍 checkDatabaseAndRestore: Checking carton ${cartonIdFromParams}`,
            {
              status: status?.status,
              locked_by: status?.locked_by,
              current_user: settings.user_id,
              current_user_code: settings.user_code,
              is_same_user: settingsMatchCartonLockOwner(
                settings,
                status?.locked_by
              ),
            }
          );

          // If carton is already locked by current user, restore state instead of re-locking
          if (
            status &&
            status.status === "Receiving" &&
            settingsMatchCartonLockOwner(settings, status.locked_by)
          ) {
            console.log(
              `✅ Carton ${cartonIdFromParams} already locked by current user in DB, restoring state`
            );
            logStateChange("CHECK_DATABASE_RESTORE", {
              carton: cartonIdFromParams,
              status: status.status,
              locked_by: status.locked_by,
            });
            setLockedCartonWithLog(cartonIdFromParams);

            // Load saved workflow state to restore scanned items
            const savedState = await loadWorkflowState(
              normalizedASN,
              activeSession,
              "ReceiveSort"
            );
            if (savedState && savedState.locked_carton === cartonIdFromParams) {
              // Restoring saved workflow state
              logStateChange("RESTORE_FROM_CHECK_DATABASE", {
                carton: cartonIdFromParams,
                savedState: {
                  workflow_state: savedState.workflow_state,
                  scanned_items_count: savedState.scanned_items?.length || 0,
                  scanned_quantities_keys: Object.keys(
                    savedState.scanned_quantities || {}
                  ),
                  scanned_items: savedState.scanned_items?.map((i) => ({
                    item: i.item_code,
                    box: i.box_id,
                  })),
                },
              });
              setCurrentItemWithLog(savedState.current_item);
              // Always start with SCAN_ITEM if there's no currentItem
              // This ensures the flow is: Scan Item → Scan Box → Scan Item → Scan Box
              if (!savedState.current_item) {
                setWorkflowStateWithLog("SCAN_ITEM");
              } else {
                setWorkflowStateWithLog(
                  savedState.workflow_state as WorkflowState
                );
              }
              // Counts from SQLite — never restore scanned_quantities from workflow file
              // (file is debounced and can race async restore and wipe post-scan state).
              await refreshScannedStateFromDb();
              const restoredSi = savedState.scanned_items || [];
              const lastFromSaved =
                restoredSi.length > 0
                  ? String(
                      restoredSi[restoredSi.length - 1]?.item_code ?? ""
                    ).trim()
                  : "";
              setLastScannedItem(lastFromSaved || null);
            } else {
              // No saved state, start fresh
              logStateChange("NO_SAVED_STATE_IN_CHECK_DATABASE", {
                carton: cartonIdFromParams,
              });
              setWorkflowStateWithLog("SCAN_ITEM");
            }

            // Pass cartonId directly to avoid race condition with state update
            if (cartonIdFromParams) {
              await loadCartonItems(cartonIdFromParams);
              await loadLockInfo();
            }
            // Clear route params to prevent re-processing
            navigation.setParams({ cartonId: undefined } as never);
            setSavedStateLoaded(true); // Mark as loaded
            return true; // Indicate we restored instead of locking
          }
        } catch (error) {
          console.error("Error checking database for carton status:", error);
        }
        return false; // Need to lock
      };

      // Check database first - if carton is already locked, restore and exit
      // Use IIFE to handle async properly
      (async () => {
        try {
          // FIRST: Always check database status BEFORE doing anything else
          // This prevents clearing state if carton is already locked by current user
          const normalizedASN = normalizeASN(activeASN);
          const settings = await getSettings();
          const dbStatus = await dataService.getCartonStatus(
            normalizedASN,
            activeSession,
            cartonIdFromParams
          );

          // Receiving: only auto-restore when this user holds the lock (never hijack another session).
          if (dbStatus && dbStatus.status === "Receiving") {
            const lockBy = String(dbStatus.locked_by || "").trim();
            const me = String(settings.user_id || "").trim();
            const isSameUser =
              lockBy &&
              me &&
              (lockBy === me || lockBy.toUpperCase() === me.toUpperCase());

            if (!isSameUser) {
              if (settings.demo_mode !== 1 && settings.api_url) {
                try {
                  const asnRes = await apiService.getASN(activeASN.trim());
                  const recv = parseAsnPayloadForReceiveSortServerBlock(
                    asnRes,
                    cartonIdFromParams
                  );
                  if (recv.blocked) {
                    await dataService.updateCartonStatus({
                      asn_no: normalizedASN,
                      inbound_session: activeSession,
                      carton_id: cartonIdFromParams,
                      status: "Received",
                      locked_by: "",
                      locked_on: "",
                      updated_on: new Date().toISOString(),
                    });
                    navigation.setParams({ cartonId: undefined } as never);
                    Alert.alert(
                      "Carton already completed",
                      recv.reason ??
                        "Server shows this carton as already received."
                    );
                    return;
                  }
                  const backendLock = parseAsnPayloadForCartonLock(
                    asnRes,
                    cartonIdFromParams
                  );
                  if (
                    backendLock &&
                    isOtherScannerLock(
                      backendLock,
                      settings.user_id || "",
                      settings.device_id || ""
                    )
                  ) {
                    navigation.setParams({ cartonId: undefined } as never);
                    Alert.alert(
                      "Carton in use",
                      `Another device is receiving this carton (per server).\n\nUser: ${
                        backendLock.locked_by || "?"
                      }\n\nYou cannot open this session here.`
                    );
                    return;
                  }
                } catch (e: any) {
                  navigation.setParams({ cartonId: undefined } as never);
                  Alert.alert(
                    "Could not verify with server",
                    `${e?.message || "Unknown error"}\n\nCheck your connection.`
                  );
                  return;
                }
              }
              navigation.setParams({ cartonId: undefined } as never);
              Alert.alert(
                "Carton in use",
                `Carton ${cartonIdFromParams} is in receiving${
                  lockBy ? ` (locked by ${lockBy})` : ""
                }.\n\nUse Unload when it is free, or continue only on the device that holds the lock.`
              );
              return;
            }

            console.log(
              `✅ Database check: Carton ${cartonIdFromParams} is Receiving for current user, restoring state`,
              {
                locked_by: dbStatus.locked_by,
                current_user: settings.user_id,
              }
            );
            logStateChange("DATABASE_CHECK_RESTORE", {
              carton: cartonIdFromParams,
              dbStatus: {
                status: dbStatus.status,
                locked_by: dbStatus.locked_by,
                locked_on: dbStatus.locked_on,
              },
              is_same_user: true,
            });
            setLockedCartonWithLog(cartonIdFromParams);

            const savedState = await loadWorkflowState(
              normalizedASN,
              activeSession,
              "ReceiveSort"
            );
            if (savedState && savedState.locked_carton === cartonIdFromParams) {
              logStateChange("RESTORE_FROM_DATABASE_CHECK", {
                carton: cartonIdFromParams,
                savedState: {
                  workflow_state: savedState.workflow_state,
                  scanned_items_count: savedState.scanned_items?.length || 0,
                  scanned_quantities_keys: Object.keys(
                    savedState.scanned_quantities || {}
                  ),
                  scanned_items: savedState.scanned_items?.map((i) => ({
                    item: i.item_code,
                    box: i.box_id,
                  })),
                },
              });
              setCurrentItemWithLog(savedState.current_item);
              setWorkflowStateWithLog(
                savedState.workflow_state as WorkflowState
              );
              await refreshScannedStateFromDb();
              const restoredSiDb = savedState.scanned_items || [];
              const lastFromSavedDb =
                restoredSiDb.length > 0
                  ? String(
                      restoredSiDb[restoredSiDb.length - 1]?.item_code ?? ""
                    ).trim()
                  : "";
              setLastScannedItem(lastFromSavedDb || null);
            } else {
              logStateChange("NO_SAVED_STATE_START_FRESH", {
                carton: cartonIdFromParams,
              });
              setWorkflowStateWithLog("SCAN_ITEM");
            }

            if (cartonIdFromParams) {
              await loadCartonItems(cartonIdFromParams);
              await loadLockInfo();
            }
            navigation.setParams({ cartonId: undefined } as never);
            setSavedStateLoaded(true);
            return;
          }

          // Carton is not Receiving - proceed with normal flow to lock it

          // Only proceed with locking if carton is not locked by current user
          if (
            !dbStatus ||
            dbStatus.status !== "Receiving" ||
            dbStatus.locked_by !== settings.user_id
          ) {
            // Store cartonId in a const to avoid closure issues
            const cartonIdToLock = cartonIdFromParams;
            // Auto-locking carton
            // Small delay to ensure database is updated
            const timer = setTimeout(() => {
              // Automatically trigger carton lock
              const autoLockCarton = async () => {
                // Use the stored cartonId (not from params which might change)
                const cartonId = cartonIdToLock;
                const normalizedASN = normalizeASN(activeASN);
                setLoading(true);

                try {
                  // Check if carton is already locked by current user (before attempting lock)
                  const settings = await getSettings();
                  let status = await dataService.getCartonStatus(
                    normalizedASN,
                    activeSession,
                    cartonId
                  );

                  // If carton is already locked by current user, restore state instead of re-locking
                  if (
                    status &&
                    status.status === "Receiving" &&
                    settingsMatchCartonLockOwner(settings, status.locked_by)
                  ) {
                    logStateChange("RESTORE_IN_AUTO_LOCK_CHECK", {
                      carton: cartonId,
                    });
                    setLockedCartonWithLog(cartonId);

                    // Load saved workflow state to restore scanned items and workflow state
                    const savedState = await loadWorkflowState(
                      normalizedASN,
                      activeSession,
                      "ReceiveSort"
                    );
                    if (savedState && savedState.locked_carton === cartonId) {
                      console.log("📂 Restoring saved workflow state:", {
                        workflow_state: savedState.workflow_state,
                        scanned_items_count:
                          savedState.scanned_items?.length || 0,
                        scanned_quantities: Object.keys(
                          savedState.scanned_quantities || {}
                        ).length,
                      });
                      logStateChange("RESTORE_IN_AUTO_LOCK", {
                        carton: cartonId,
                        savedState: {
                          workflow_state: savedState.workflow_state,
                          scanned_items_count:
                            savedState.scanned_items?.length || 0,
                          scanned_items: savedState.scanned_items?.map((i) => ({
                            item: i.item_code,
                            box: i.box_id,
                          })),
                        },
                      });
                      setCurrentItemWithLog(savedState.current_item);
                      setWorkflowStateWithLog(
                        savedState.workflow_state as WorkflowState
                      );
                      await refreshScannedStateFromDb();
                      const restoredSiAl = savedState.scanned_items || [];
                      const lastAl =
                        restoredSiAl.length > 0
                          ? String(
                              restoredSiAl[restoredSiAl.length - 1]
                                ?.item_code ?? ""
                            ).trim()
                          : "";
                      setLastScannedItem(lastAl || null);
                    } else {
                      // No saved state, start fresh
                      logStateChange("NO_SAVED_STATE_IN_AUTO_LOCK", {
                        carton: cartonId,
                      });
                      setWorkflowStateWithLog("SCAN_ITEM");
                    }

                    // Pass cartonId directly to avoid race condition with state update
                    await loadCartonItems(cartonId);
                    await loadLockInfo();
                    // Clear route params to prevent re-processing
                    navigation.setParams({ cartonId: undefined } as never);
                    setSavedStateLoaded(true); // Mark as loaded
                    setLoading(false);
                    return;
                  }

                  // Check if carton is unloaded (normalize ASN for lookup)
                  // Try multiple times with slight delay in case of race condition
                  // If not found, wait a bit and try again (for race conditions)
                  if (!status) {
                    await new Promise((resolve) => setTimeout(resolve, 200));
                    status = await dataService.getCartonStatus(
                      normalizedASN,
                      activeSession,
                      cartonId
                    );
                  }

                  if (!status) {
                    Alert.alert(
                      "Error",
                      `Carton ${cartonId} status not found. Please ensure the carton has been unloaded first.\n\nASN: ${normalizedASN}\nSession: ${activeSession}`
                    );
                    setLoading(false);
                    return;
                  }

                  const statusLower = status.status.toLowerCase();

                  // Handle different statuses with appropriate messages
                  if (statusLower === "received") {
                    Alert.alert(
                      "Carton Already Completed",
                      `Carton ${cartonId} has already been received and completed.\n\nStatus: ${status.status}\n\nYou cannot process a completed carton again.`
                    );
                    setLoading(false);
                    return;
                  }

                  if (statusLower === "receiving") {
                    // Check if locked by current user - allow them to continue
                    // settings already declared above, reuse it
                    if (settingsMatchCartonLockOwner(settings, status.locked_by)) {
                      // Same user - restore their session
                      console.log(
                        `✅ Resuming work on carton ${cartonId} (locked by current user)`
                      );
                      logStateChange("RESUME_WORK_IN_AUTO_LOCK", {
                        carton: cartonId,
                      });
                      setLockedCartonWithLog(cartonId);

                      // Load saved workflow state to restore scanned items
                      const savedState = await loadWorkflowState(
                        normalizedASN,
                        activeSession,
                        "ReceiveSort"
                      );
                      if (savedState && savedState.locked_carton === cartonId) {
                        console.log(
                          "📂 Restoring saved workflow state in auto-lock:",
                          {
                            workflow_state: savedState.workflow_state,
                            scanned_items_count:
                              savedState.scanned_items?.length || 0,
                          }
                        );
                        logStateChange("RESTORE_IN_RESUME_WORK", {
                          carton: cartonId,
                          savedState: {
                            workflow_state: savedState.workflow_state,
                            scanned_items_count:
                              savedState.scanned_items?.length || 0,
                            scanned_items: savedState.scanned_items?.map(
                              (i) => ({ item: i.item_code, box: i.box_id })
                            ),
                          },
                        });
                        setCurrentItemWithLog(savedState.current_item);
                        setWorkflowStateWithLog(
                          savedState.workflow_state as WorkflowState
                        );
                        await refreshScannedStateFromDb();
                        const restoredSiRw = savedState.scanned_items || [];
                        const lastRw =
                          restoredSiRw.length > 0
                            ? String(
                                restoredSiRw[restoredSiRw.length - 1]
                                  ?.item_code ?? ""
                              ).trim()
                            : "";
                        setLastScannedItem(lastRw || null);
                      } else {
                        // No saved state, start fresh
                        logStateChange("NO_SAVED_STATE_IN_RESUME", {
                          carton: cartonId,
                        });
                        setWorkflowStateWithLog("SCAN_ITEM");
                      }

                      await loadCartonItems(cartonIdFromParams);
                      await loadLockInfo();
                      // Clear route params to prevent re-processing
                      navigation.setParams({ cartonId: undefined } as never);
                      setSavedStateLoaded(true); // Mark as loaded
                      setLoading(false);
                      Alert.alert(
                        "Info",
                        `Resuming work on carton ${cartonId}`
                      );
                      return;
                    } else {
                      // Locked by a different owner: never allow resume/takeover from this device.
                      Alert.alert(
                        "Carton Already in Use",
                        `Carton ${cartonId} is currently being processed by another user.\n\nLocked by: ${
                          status.locked_by || "Unknown"
                        }\nStatus: ${
                          status.status
                        }\n\nPlease select a different carton.`,
                        [{ text: "OK", style: "cancel" as const }]
                      );
                      setLoading(false);
                      return;
                    }
                  }

                  // Handle Pending status - automatically unload it first
                  if (statusLower === "pending") {
                    console.log(
                      `📦 Carton ${cartonId} is Pending, auto-unloading...`
                    );
                    const pendingSettings = await getSettings();
                    // Create unload event
                    await addEvent({
                      event_type: "UNLOAD_SCAN",
                      asn_no: normalizedASN,
                      inbound_session: activeSession,
                      carton_id: cartonId,
                      device_id: pendingSettings.device_id || "",
                      user_id: pendingSettings.user_id || "",
                    });

                    // Update status to Unloaded
                    await dataService.updateCartonStatus({
                      asn_no: normalizedASN,
                      inbound_session: activeSession,
                      carton_id: cartonId,
                      status: "Unloaded",
                      updated_on: new Date().toISOString(),
                    });

                    // Sync status change to backend
                    try {
                      await apiService.updateCartonStatus({
                        asn_no: activeASN, // Use original format from desktop
                        inbound_session: activeSession,
                        carton_id: cartonId,
                        status: "Unloaded",
                        user_id: pendingSettings.user_id,
                        device_id: pendingSettings.device_id,
                      });
                      console.log(
                        `✅ Carton ${cartonId} status synced to backend: Unloaded`
                      );
                    } catch (apiError: any) {
                      console.warn(
                        `⚠️ Failed to sync carton ${cartonId} status to backend:`,
                        apiError.message
                      );
                      // Don't block user flow if API sync fails
                    }

                    // Reload status
                    status = await dataService.getCartonStatus(
                      normalizedASN,
                      activeSession,
                      cartonId
                    );
                    console.log(
                      `✅ Carton ${cartonId} auto-unloaded, new status:`,
                      status?.status
                    );
                  }

                  if (statusLower !== "unloaded" && statusLower !== "pending") {
                    Alert.alert(
                      "Carton Not Available",
                      `Carton ${cartonId} cannot be processed.\n\nCurrent status: ${status?.status ?? "unknown"}\n\nOnly "Unloaded" or "Pending" cartons can be received.`
                    );
                    setLoading(false);
                    return;
                  }

                  // Lock carton (settings already declared above)
                  console.log(
                    `🔒 Attempting to lock carton ${cartonId} (auto-lock)...`,
                    {
                      inbound_session: activeSession,
                      asn_no: normalizedASN,
                      carton_id: cartonId,
                      user_id: settings.user_id,
                      device_id: settings.device_id,
                    }
                  );

                  let lockResponse;
                  try {
                    lockResponse = await apiService.lockCarton({
                      inbound_session: activeSession,
                      asn_no: activeASN, // Use original format from desktop
                      carton_id: cartonId,
                      user_id: settings.user_id!,
                      device_id: settings.device_id!,
                    });
                    console.log(
                      `📋 Auto-lock carton API response:`,
                      lockResponse
                    );
                  } catch (error: any) {
                    console.error(`❌ Auto-lock carton API error:`, error);
                    const errorMessage =
                      error.message || "Failed to lock carton";
                    Alert.alert(
                      "Error",
                      `Failed to lock carton: ${errorMessage}\n\nPlease check:\n1. API connection\n2. Authentication token\n3. Backend logs`
                    );
                    setLoading(false);
                    return;
                  }

                  // Handle nested response structure: { data: { locked: true } } or { locked: true }
                  let isLocked =
                    lockResponse?.data?.locked === true ||
                    lockResponse?.locked === true ||
                    lockResponse?.ok === true;
                  let sameUserResume =
                    !isLocked &&
                    cartonLockResponseMeansCurrentUserAlreadyHolds(
                      lockResponse,
                      settings
                    );
                  let lockOk = isLocked || sameUserResume;

                  if (!lockOk) {
                    const stReclaim = await dataService.getCartonStatus(
                      normalizedASN,
                      activeSession,
                      cartonId
                    );
                    const canReclaim =
                      String(stReclaim?.status || "").toLowerCase() ===
                        "unloaded" &&
                      settingsMatchUnloadedActor(
                        settings,
                        stReclaim?.unloaded_by
                      ) &&
                      settings.user_id;
                    if (canReclaim) {
                      console.log(
                        `ℹ️ Auto-lock denied — local unload actor is you; syncing Receiving then retrying lock once`
                      );
                      const reclaimSync =
                        await pushReceivingCartonStatusServerThenLocal({
                          asnNoOriginal: activeASN,
                          inboundSession: activeSession,
                          cartonId,
                          userId: settings.user_id!,
                          deviceId: settings.device_id,
                          lockedOnIso: new Date().toISOString(),
                        });
                      if (reclaimSync.ok) {
                        try {
                          lockResponse = await apiService.lockCarton({
                            inbound_session: activeSession,
                            asn_no: activeASN,
                            carton_id: cartonId,
                            user_id: settings.user_id!,
                            device_id: settings.device_id!,
                          });
                          console.log(
                            `📋 Auto-lock carton API response (after reclaim):`,
                            lockResponse
                          );
                        } catch (reErr: any) {
                          console.error(
                            `❌ Auto-lock retry after reclaim failed:`,
                            reErr
                          );
                          Alert.alert(
                            "Error",
                            `Failed to lock carton: ${
                              reErr.message || "Unknown error"
                            }`
                          );
                          setLoading(false);
                          return;
                        }
                        isLocked =
                          lockResponse?.data?.locked === true ||
                          lockResponse?.locked === true ||
                          lockResponse?.ok === true;
                        sameUserResume =
                          !isLocked &&
                          cartonLockResponseMeansCurrentUserAlreadyHolds(
                            lockResponse,
                            settings
                          );
                        lockOk = isLocked || sameUserResume;
                      }
                    }
                  }

                  if (!lockOk) {
                    const errorMessage =
                      lockResponse?.data?.message ||
                      lockResponse?.message ||
                      lockResponse?.error?.message ||
                      lockResponse?.error ||
                      JSON.stringify(lockResponse) ||
                      "Failed to lock carton";
                    console.error(`❌ Auto-lock carton failed:`, {
                      response: lockResponse,
                      errorMessage,
                    });
                    Alert.alert(
                      "Error",
                      `Failed to lock carton: ${errorMessage}\n\nResponse: ${JSON.stringify(
                        lockResponse
                      ).substring(0, 200)}`
                    );
                    setLoading(false);
                    return;
                  }
                  if (sameUserResume) {
                    console.log(
                      `ℹ️ Auto-lock: server reports carton already in use by you — syncing and continuing`
                    );
                  }

                  console.log(
                    `✅ Carton ${cartonId} locked successfully (auto-lock)`
                  );

                  const lockedOnAuto = new Date().toISOString();
                  const syncAuto =
                    await pushReceivingCartonStatusServerThenLocal({
                      asnNoOriginal: activeASN,
                      inboundSession: activeSession,
                      cartonId,
                      userId: settings.user_id!,
                      deviceId: settings.device_id,
                      lockedOnIso: lockedOnAuto,
                    });
                  if (!syncAuto.ok) {
                    setLoading(false);
                    Alert.alert(
                      syncAuto.kind === "network"
                        ? "Server connection lost"
                        : "Cannot update carton",
                      syncAuto.message
                    );
                    return;
                  }

                  logStateChange("LOCK_CARTON_SUCCESS", { carton: cartonId });
                  setLockedCartonWithLog(cartonId);

                  // Check if there's saved state for this carton before clearing
                  const savedStateBeforeLock = await loadWorkflowState(
                    normalizedASN,
                    activeSession,
                    "ReceiveSort"
                  );
                  if (
                    savedStateBeforeLock &&
                    savedStateBeforeLock.locked_carton === cartonId
                  ) {
                    // Restore saved state instead of clearing
                    console.log(
                      "📂 Found saved state for carton, restoring instead of clearing:",
                      {
                        scanned_items_count:
                          savedStateBeforeLock.scanned_items?.length || 0,
                      }
                    );
                    logStateChange("RESTORE_AFTER_LOCK", {
                      carton: cartonId,
                      savedState: {
                        scanned_items_count:
                          savedStateBeforeLock.scanned_items?.length || 0,
                        scanned_items: savedStateBeforeLock.scanned_items?.map(
                          (i) => ({ item: i.item_code, box: i.box_id })
                        ),
                      },
                    });
                    setCurrentItemWithLog(savedStateBeforeLock.current_item);
                    setWorkflowStateWithLog(
                      savedStateBeforeLock.workflow_state as WorkflowState
                    );
                    await refreshScannedStateFromDb();
                    const restoredSiLock = savedStateBeforeLock.scanned_items || [];
                    const lastLock =
                      restoredSiLock.length > 0
                        ? String(
                            restoredSiLock[restoredSiLock.length - 1]
                              ?.item_code ?? ""
                          ).trim()
                        : "";
                    setLastScannedItem(lastLock || null);
                  } else {
                    // No saved state, start fresh
                    logStateChange("NO_SAVED_STATE_AFTER_LOCK", {
                      carton: cartonId,
                    });
                    setWorkflowStateWithLog("SCAN_ITEM");
                    setScannedItemsWithLog([]);
                    setScannedQuantitiesWithLog({});
                  }
                  setCartonItemsWithLog([]); // Clear previous carton items (will be reloaded)

                  // Don't clear saved workflow state - keep it for resume
                  // The saved state will be restored above if it exists, or we start fresh
                  // Only clear if we're starting completely fresh (no saved state found)
                  if (activeASN && activeSession) {
                    const normalizedASNForClear = normalizeASN(activeASN);
                    const savedStateCheck = await loadWorkflowState(
                      normalizedASNForClear,
                      activeSession,
                      "ReceiveSort"
                    );
                    if (
                      !savedStateCheck ||
                      savedStateCheck.locked_carton !== cartonId
                    ) {
                      // Only clear if there's no saved state for this carton
                      await clearWorkflowState(
                        normalizedASNForClear,
                        activeSession,
                        "ReceiveSort"
                      );
                      // Cleared saved workflow state (no saved state for this carton)
                    } else {
                      console.log(
                        `✅ Keeping saved workflow state for carton: ${cartonId}`
                      );
                    }
                  }
                } catch (error: any) {
                  Alert.alert(
                    "Error",
                    error.message || "Failed to lock carton"
                  );
                } finally {
                  setLoading(false);
                }
              };
              autoLockCarton();
            }, 100);
          }
        } catch (error) {
          console.error("Error processing carton lock:", error);
        }
      })();
    }
  }, [
    route.params,
    activeASN,
    activeSession,
    lockedCarton,
    workflowState,
    navigation,
    refreshScannedStateFromDb,
  ]);

  // Clear route params after processing to prevent re-processing
  useEffect(() => {
    if (lockedCarton && route.params) {
      const params = route.params as { cartonId?: string } | undefined;
      if (params?.cartonId) {
        // Clear the route params to prevent re-processing
        // Mark saved state as loaded to prevent it from loading after params are cleared
        setSavedStateLoaded(true);
        navigation.setParams({ cartonId: undefined } as never);
      }
    }
  }, [lockedCarton, route.params, navigation]);

  useEffect(() => {
    if (lockedCarton && activeASN && activeSession) {
      loadCartonItems();
      loadLockInfo();
    }
  }, [lockedCarton, activeASN, activeSession]);

  // Load available BOXes when in SCAN_BOX state
  useEffect(() => {
    if (workflowState === "SCAN_BOX" && activeASN) {
      loadAvailableBoxes();
    }
  }, [workflowState, activeASN]);

  const loadLockInfo = async () => {
    if (!lockedCarton || !activeASN || !activeSession) return;
    const normalizedASN = normalizeASN(activeASN);
    const status = await dataService.getCartonStatus(
      normalizedASN,
      activeSession,
      lockedCarton
    );
    if (status) {
      setLockInfo({
        locked_by: status.locked_by,
        locked_on: status.locked_on,
      });
    }
  };

  // Load stores from Transfer Order allocations
  const loadTransferOrderStores = useCallback(async () => {
    if (!activeASN) {
      setAvailableStoresForBox([]);
      return;
    }
    try {
      const allocations = await dataService.getTransferOrderAllocations(
        activeASN
      );
      let uniqueStores: string[] = [];

      if (allocations.length > 0) {
        uniqueStores = Array.from(
          new Set(allocations.map((a) => a.store).filter((s) => s))
        ).sort();
        console.log(
          `✅ ReceiveSortScreen: Found ${allocations.length} allocations in local DB for ASN ${activeASN}`
        );
      } else {
        console.log(
          `ℹ️ ReceiveSortScreen: No allocations found in local DB for ASN ${activeASN}, fetching from API...`
        );
        try {
          const toResponse = await apiService.getLiveTransferOrderByASN(activeASN, {
            inbound_session: activeSession || undefined,
            include_completed: true,
          });
          const toData =
            toResponse?.data || toResponse?.transfer_order || toResponse;

          if (toData && (toData.to_no || toData.transfer_order)) {
          const apiAllocations =
            toData.allocations ||
            toData.items ||
            toData.allocation ||
            toData.line_items ||
            toData.lines ||
            (Array.isArray(toData) ? toData : []);
          if (apiAllocations.length > 0) {
            // Save allocations to local database for future queries
            // Use original ASN format (matches how cartons are stored)
            const db = await getDatabase();
            let masterRows: { code: string }[] = [];
            try {
              masterRows = await dataService.getWarehouseStoreMasterRows();
            } catch {
              masterRows = [];
            }
            for (const allocation of apiAllocations) {
              const rawStore = storeFieldFromAllocationRow(allocation);
              const lineItem = itemCodeFromAllocationRow(allocation);
              if (rawStore && lineItem) {
                const resolved = canonicalStoreForToLine(rawStore, masterRows);
                if (resolved.unknownInMaster && rawStore) {
                  console.warn(
                    `⚠️ ReceiveSort TO store "${rawStore}" not in warehouse master (item ${lineItem}). ` +
                      (resolved.suggestions.length
                        ? `Similar: ${resolved.suggestions.join(", ")}`
                        : "Run master sync for Warehouses & Stores.")
                  );
                }
                await db.runAsync(
                  `INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES (?, ?, ?, ?, ?)`,
                  [
                    toData.to_no || toData.transfer_order,
                    activeASN,
                    resolved.storeToPersist || rawStore,
                    lineItem,
                    allocation.allocated_qty || allocation.qty || 0,
                  ]
                );
              }
            }
            uniqueStores = Array.from(
              new Set(
                (apiAllocations as any[])
                  .map((a: any) => {
                    const raw = storeFieldFromAllocationRow(a);
                    if (!raw) return null;
                    const r = canonicalStoreForToLine(raw, masterRows);
                    return r.storeToPersist || raw;
                  })
                  .filter((s): s is string => Boolean(s))
              )
            ).sort();
            console.log(
              `✅ ReceiveSortScreen: Fetched and saved ${apiAllocations.length} TO allocations from API.`
            );
          }
        }
        } catch (toError: any) {
          // Handle 404 errors gracefully - ASN can be received without Transfer Order
          const errorMessage = toError?.message || toError?.toString() || "";
          const is404Error = 
            errorMessage.includes("404") ||
            errorMessage.includes("No transfer order found") ||
            errorMessage.includes("not found") ||
            errorMessage.includes("TRANSFER_ORDER_NOT_FOUND");
          
          if (is404Error) {
            // 404 is expected - ASN can be received without Transfer Order
            console.log(
              `ℹ️ ReceiveSortScreen: No transfer order found for ASN ${activeASN} (this is OK - ASN can be received without Transfer Order)`
            );
          } else {
            // Other errors (network, 500, etc.) - log as warning
            console.warn("⚠️ ReceiveSortScreen: Could not fetch transfer order from API:", errorMessage);
          }
          // Continue - no transfer order is OK
        }
      }

      // Only show stores that are in the Transfer Order allocations
      // Don't force include WAREHOUSE - it should only appear if it's in the TO
      setAvailableStoresForBox(uniqueStores.length > 0 ? uniqueStores : []);
      if (uniqueStores.length > 0 && !selectedStoreForBox) {
        setSelectedStoreForBox(uniqueStores[0]); // Auto-select first store
      } else if (uniqueStores.length === 0) {
        // No stores found - clear selection
        setSelectedStoreForBox("");
      }
      console.log(
        `📦 ReceiveSortScreen: Available stores set to:`,
        uniqueStores.length > 0 ? uniqueStores : "(no stores)"
      );
    } catch (error: any) {
      // Handle 404 errors gracefully - ASN can be received without Transfer Order
      const errorMessage = error?.message || error?.toString() || "";
      const is404Error = 
        errorMessage.includes("404") ||
        errorMessage.includes("No transfer order found") ||
        errorMessage.includes("not found") ||
        errorMessage.includes("TRANSFER_ORDER_NOT_FOUND");
      
      if (is404Error) {
        // 404 is expected - ASN can be received without Transfer Order
        console.log(
          `ℹ️ ReceiveSortScreen: No transfer order found for ASN ${activeASN} (this is OK - ASN can be received without Transfer Order)`
        );
      } else {
        // Other errors (network, 500, etc.) - log as warning
        console.warn(
          "⚠️ ReceiveSortScreen: Error loading transfer order stores:",
          errorMessage
        );
      }
      setAvailableStoresForBox([]); // No fallback - only show stores from TO
      setSelectedStoreForBox("");
    }
  }, [activeASN, activeSession, selectedStoreForBox]);

  // Load stores from Transfer Order allocations (effect must be after loadTransferOrderStores definition)
  useEffect(() => {
    loadTransferOrderStores();
  }, [activeASN, loadTransferOrderStores]);

  const loadCartonItems = async (cartonId?: string | null) => {
    // Use provided cartonId or fall back to lockedCarton state
    const targetCartonId = cartonId || lockedCarton;

    if (!activeASN || !targetCartonId) {
      console.warn("⚠️ loadCartonItems: Missing activeASN or cartonId", {
        activeASN,
        lockedCarton,
        providedCartonId: cartonId,
        targetCartonId,
      });
      return;
    }
    const seq = ++cartonLoadSeqRef.current;
    setCartonLinesLoadError(null);
    setCartonLinesLoading(true);
    // Clear previous items first
    logStateChange("LOAD_CARTON_ITEMS", { carton: targetCartonId });
    setCartonItemsWithLog([]);

    try {
      // Use original ASN format (cartons are stored with original format from desktop/API)
      let items = await dataService.getCartonItems(
        activeASN,
        targetCartonId
      );
      if (seq !== cartonLoadSeqRef.current) {
        return;
      }
      if (items.length === 0) {
        const hydrated = await dataService.hydrateCartonLinesFromAsnApi(
          activeASN,
          targetCartonId
        );
        if (seq !== cartonLoadSeqRef.current) {
          return;
        }
        if (hydrated.ok) {
          items = await dataService.getCartonItems(activeASN, targetCartonId);
          if (items.length > 0) {
            console.log(
              `✅ Carton lines restored from server for ${targetCartonId}`
            );
          }
        }
      }
      if (seq !== cartonLoadSeqRef.current) {
        return;
      }
      const itemsList = items
        .map((i) => `${i.item_code} (${i.shipped_qty})`)
        .join(", ");
      console.log(
        `✅ Loaded ${items.length} items for ${targetCartonId}:`,
        itemsList
      );

      if (items.length === 0) {
        console.error(
          `❌ No items found for carton ${targetCartonId} in ASN ${activeASN}`
        );
      }

      setCartonItemsWithLog(items);
    } catch (e: any) {
      if (seq !== cartonLoadSeqRef.current) {
        return;
      }
      console.error("loadCartonItems failed:", e?.message || e);
      setCartonLinesLoadError(
        e?.message || "Could not load carton lines from this device."
      );
      setCartonItemsWithLog([]);
    } finally {
      if (seq === cartonLoadSeqRef.current) {
        setCartonLinesLoading(false);
      }
    }
  };

  const loadAvailableBoxes = async () => {
    if (!activeASN) return;
    const boxes = await dataService.getBoxes(activeASN);
    // Filter out boxes with null/undefined/empty box_id to prevent React key errors
    // Also filter out CLOSED boxes - only show Open boxes
    const validBoxes = boxes
      .filter(
        (box) =>
          box.box_id &&
          box.box_id !== "" &&
          box.box_id !== null &&
          box.status !== "Closed" &&
          box.status !== "CLOSED" &&
          box.status !== "closed"
      )
      .map((box) => ({
        ...box,
        created_by:
          String((box as any).created_by || "").trim() ||
          createdByFromApiBox(box as unknown as Record<string, unknown>) ||
          null,
      }));
    setAvailableBoxes(validBoxes);
    console.log(
      `📦 Loaded ${validBoxes.length} available box(es) (excluded closed boxes)`
    );
  };

  // Load item quantities for each box when editing an item
  const loadBoxItemQuantities = async (itemCode: string) => {
    if (!activeASN || !activeSession || !itemCode) {
      setBoxItemQuantities({});
      return;
    }

    try {
      const db = await getDatabase();
      const normalizedASN = normalizeASN(activeASN);

      // Quantities per box for this item — same supplier carton attribution as main Receive UI
      const cartonFilter = lockedCarton
        ? "AND UPPER(TRIM(IFNULL(carton_id,''))) = UPPER(TRIM(?))"
        : "AND (carton_id IS NULL OR TRIM(COALESCE(carton_id, '')) = '')";
      const cartonParams = lockedCarton
        ? [activeASN, normalizedASN, activeSession, String(lockedCarton).trim(), itemCode]
        : [activeASN, normalizedASN, activeSession, itemCode];

      let quantities = await db.getAllAsync<{
        box_id: string;
        scanned_qty: number;
      }>(
        `SELECT box_id, SUM(scanned_qty) as scanned_qty 
         FROM scanned_items 
         WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ? ${cartonFilter} AND item_code = ?
         GROUP BY box_id`,
        cartonParams
      );

      // Convert to map: box_id -> quantity
      const quantityMap: Record<string, number> = {};
      quantities.forEach((q) => {
        if (q.box_id) {
          quantityMap[q.box_id] =
            (quantityMap[q.box_id] || 0) + (q.scanned_qty || 0);
        }
      });

      setBoxItemQuantities(quantityMap);
      console.warn(`📦 Loaded box quantities for ${itemCode}:`, quantityMap);
    } catch (error: any) {
      console.warn(`⚠️ Error loading box quantities:`, error.message);
      setBoxItemQuantities({});
    }
  };

  const boxItemsPayloadItems = (response: any): any[] => {
    const payload = response?.data || response;
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.box_items)) return payload.box_items;
    if (Array.isArray(payload?.boxItems)) return payload.boxItems;
    if (Array.isArray(payload?.contents)) return payload.contents;
    if (Array.isArray(payload?.lines)) return payload.lines;
    return [];
  };

  const refreshLockedCartonScannedQtyFromBackend = useCallback(async (): Promise<boolean> => {
    if (!activeASN || !lockedCarton) return true;

    const settings = await getSettings();
    if (!settings.api_url || settings.demo_mode === 1) return true;

    if (!(await isDeviceOnline())) {
      Alert.alert(
        "Network Required",
        "Cannot refresh latest scanned quantities.\n\nPlease connect WiFi/mobile data, make sure the backend is reachable, then try again."
      );
      return false;
    }

    const cartonKey = String(lockedCarton).trim().toUpperCase();
    const boxesById = new Map<string, any>();
    const localBoxes = await dataService.getBoxes(activeASN);
    localBoxes.forEach((box) => {
      const boxId = String(box?.box_id || "").trim();
      if (boxId) boxesById.set(boxId, box);
    });
    availableBoxes.forEach((box) => {
      const boxId = String(box?.box_id || "").trim();
      if (boxId) boxesById.set(boxId, box);
    });

    const stores = Array.from(
      new Set(
        [
          ...localBoxes.map((box) => box.store),
          ...availableBoxes.map((box) => box.store),
          ...(await dataService.getTransferOrderAllocations(activeASN)).map(
            (allocation) => allocation.store
          ),
        ]
          .map((store) => String(store || "").trim())
          .filter(Boolean)
      )
    );

    let refreshFailed = false;

    for (const store of stores) {
      try {
        const response = await apiService.getBoxes({ asn: activeASN, store });
        const rows = Array.isArray(response)
          ? response
          : Array.isArray(response?.data)
            ? response.data
            : Array.isArray(response?.data?.boxes)
              ? response.data.boxes
              : Array.isArray(response?.boxes)
                ? response.boxes
                : Array.isArray(response?.items)
                  ? response.items
                  : [];
        rows.forEach((row: any) => {
          const boxId = String(row?.box_id || row?.name || "").trim();
          if (boxId) boxesById.set(boxId, { ...row, box_id: boxId, store });
        });
      } catch (error: any) {
        refreshFailed = true;
        console.warn(
          `⚠️ Could not load backend boxes for ${store}:`,
          error?.message || error
        );
      }
    }

    const backendQtyByItem: Record<string, number> = {};
    for (const box of Array.from(boxesById.values())) {
      const boxId = String(box?.box_id || "").trim();
      if (!boxId) continue;
      try {
        const response = await apiService.getBoxItems(boxId, {
          asn: activeASN,
          store: box.store || undefined,
        });
        for (const row of boxItemsPayloadItems(response)) {
          const rowCarton = String(
            row?.carton_id ||
              row?.source_carton ||
              row?.source_carton_id ||
              row?.supplier_carton_id ||
              ""
          )
            .trim()
            .toUpperCase();
          if (rowCarton !== cartonKey) continue;

          const itemCode = qtyKeyForScannedState(
            row?.item_code || row?.itemCode
          );
          if (!itemCode) continue;
          const qty = Number(row?.scanned_qty ?? row?.qty ?? row?.quantity ?? 0);
          backendQtyByItem[itemCode] =
            (backendQtyByItem[itemCode] || 0) + (Number.isFinite(qty) ? qty : 0);
        }
      } catch (error: any) {
        refreshFailed = true;
        console.warn(
          `⚠️ Could not load backend items for BOX ${boxId}:`,
          error?.message || error
        );
      }
    }

    if (refreshFailed) {
      Alert.alert(
        "Network Required",
        "Could not refresh latest scanned quantities from the backend.\n\nPlease connect WiFi/mobile data, make sure the backend is reachable, then try again."
      );
      return false;
    }

    if (Object.keys(backendQtyByItem).length === 0) return true;

    setScannedQuantitiesWithLog({
      ...scannedQuantities,
      ...backendQtyByItem,
    });

    return true;
  }, [activeASN, availableBoxes, lockedCarton, scannedQuantities]);

  // Helper function to get color for each store
  const getStoreColor = (store: string): string => {
    if (!store) return "#E0E0E0"; // Default gray

    const storeUpper = store.toUpperCase().trim();

    // Warehouse colors (blue shades)
    if (storeUpper === "WAREHOUSE" || storeUpper.startsWith("WH-")) {
      return "#2196F3"; // Blue
    }

    // Store colors - assign different colors based on store code
    // Use a hash function to consistently assign colors
    const colors = [
      "#4CAF50", // Green - STORE-001, SR-01
      "#FF9800", // Orange - STORE-002, SR-02
      "#9C27B0", // Purple - STORE-003, SR-03
      "#F44336", // Red - STORE-004, SR-04
      "#00BCD4", // Cyan - STORE-005, SR-05
      "#FFEB3B", // Yellow - STORE-006, SR-06
      "#795548", // Brown - STORE-007, SR-07
      "#607D8B", // Blue Grey - STORE-008, SR-08
      "#E91E63", // Pink - STORE-009, SR-09
      "#3F51B5", // Indigo - STORE-010, SR-10
    ];

    // Extract store number from store code (e.g., "STORE-001" -> 1, "SR-01" -> 1)
    const match = storeUpper.match(/(?:STORE-|SR-)(\d+)/);
    if (match) {
      const storeNum = parseInt(match[1], 10);
      return colors[(storeNum - 1) % colors.length];
    }

    // Fallback: hash the store name to get a consistent color
    let hash = 0;
    for (let i = 0; i < storeUpper.length; i++) {
      hash = storeUpper.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const handleCartonScan = async (barcode: string) => {
    if (!(await requireOnlineForReceiving())) return;

    // Ensure we have activeASN - restore from settings if lost
    let currentASN = activeASN;
    let currentSession = activeSession;

    if (!currentASN || !currentSession) {
      console.warn(
        "⚠️ activeASN or activeSession missing, restoring from settings..."
      );
      const settings = await getSettings();
      if (settings.active_asn && settings.active_session) {
        currentASN = settings.active_asn;
        currentSession = settings.active_session;
        console.log("✅ Restored from settings:", {
          asn: currentASN,
          session: currentSession,
        });
      } else {
        Alert.alert(
          "Error",
          "No active inbound session. Please start a new inbound session."
        );
        return;
      }
    }

    const cartonId = barcode.trim().toUpperCase();
    const normalizedASN = normalizeASN(currentASN);
    setLoading(true);

    try {
      // First, validate that carton belongs to the ASN (check asn_carton_map)
      const isValidCarton = await dataService.isCartonInASN(
        normalizedASN,
        cartonId
      );
      if (!isValidCarton) {
        Alert.alert(
          "Invalid Carton",
          `Carton ${cartonId} does not belong to ASN ${normalizedASN}.\n\nPlease scan a carton from the current shipment.`
        );
        setLoading(false);
        return;
      }

      // Get settings early for API calls
      const settings = await getSettings();

      /** One GET /api/asn per scan (non-demo): block if server shows carton fully received, and reuse for lock parse. */
      let asnResForReceiveGate: unknown = null;
      if (settings.demo_mode !== 1 && settings.api_url) {
        try {
          asnResForReceiveGate = await apiService.getASN(currentASN.trim());
          const recvGate = parseAsnPayloadForReceiveSortServerBlock(
            asnResForReceiveGate,
            cartonId
          );
          if (recvGate.blocked) {
            await dataService.updateCartonStatus({
              asn_no: normalizedASN,
              inbound_session: currentSession,
              carton_id: cartonId,
              status: "Received",
              locked_by: "",
              locked_on: "",
              updated_on: new Date().toISOString(),
            });
            setLoading(false);
            await loadAvailableCartons();
            Alert.alert(
              "Carton already completed",
              recvGate.reason ??
                "This carton was already received on the server (another operator or desktop). Your list has been updated."
            );
            return;
          }
        } catch (e: any) {
          setLoading(false);
          Alert.alert(
            "Could not verify with server",
            `${e?.message || "Unknown error"}\n\nCheck your connection and try again before receiving this carton.`
          );
          return;
        }
      }

      // Check if carton status exists (normalize ASN for lookup)
      let status = await dataService.getCartonStatus(
        normalizedASN,
        currentSession,
        cartonId
      );

      // If status doesn't exist but carton is in ASN, initialize it as Unloaded
      if (!status) {
        console.log(
          `⚠️ Carton ${cartonId} status not found, but carton exists in ASN. Initializing as Unloaded...`
        );
        await dataService.updateCartonStatus({
          asn_no: normalizedASN,
          inbound_session: currentSession,
          carton_id: cartonId,
          status: "Unloaded",
          updated_on: new Date().toISOString(),
        });

        // Sync status change to backend
        try {
          await apiService.updateCartonStatus({
            asn_no: currentASN, // Use original format from desktop
            inbound_session: currentSession,
            carton_id: cartonId,
            status: "Unloaded",
            user_id: settings.user_id,
            device_id: settings.device_id,
          });
          console.log(
            `✅ Carton ${cartonId} status synced to backend: Unloaded (initialized)`
          );
        } catch (apiError: any) {
          console.warn(
            `⚠️ Failed to sync carton ${cartonId} status to backend:`,
            apiError.message
          );
          // Don't block user flow if API sync fails
        }

        // Reload status
        status = await dataService.getCartonStatus(
          normalizedASN,
          currentSession,
          cartonId
        );

        if (!status) {
          Alert.alert(
            "Error",
            `Failed to initialize carton ${cartonId} status. Please try again.`
          );
          setLoading(false);
          return;
        }
      }

      const statusLower = status.status.toLowerCase();

      // Handle different statuses with appropriate messages
      if (statusLower === "received") {
        Alert.alert(
          "Carton Already Completed",
          `Carton ${cartonId} has already been received and completed.\n\nStatus: ${status.status}\n\nYou cannot process a completed carton again.`
        );
        setLoading(false);
        await loadAvailableCartons(); // Refresh available cartons
        return;
      }

      if (statusLower === "receiving") {
        if (settings.demo_mode !== 1 && settings.api_url && asnResForReceiveGate) {
          const recvAgain = parseAsnPayloadForReceiveSortServerBlock(
            asnResForReceiveGate,
            cartonId
          );
          if (recvAgain.blocked) {
            await dataService.updateCartonStatus({
              asn_no: normalizedASN,
              inbound_session: currentSession,
              carton_id: cartonId,
              status: "Received",
              locked_by: "",
              locked_on: "",
              updated_on: new Date().toISOString(),
            });
            setLoading(false);
            await loadAvailableCartons();
            Alert.alert(
              "Carton already completed",
              recvAgain.reason ??
                "Server shows this carton as fully received while your device still had it in progress. Your list has been updated."
            );
            return;
          }
        }
        // Check if locked by current user - allow them to continue
        if (settingsMatchCartonLockOwner(settings, status.locked_by)) {
          // Same user - restore their session
          logStateChange("HANDLE_CARTON_SCAN_SAME_USER", { carton: cartonId });
          setLockedCartonWithLog(cartonId);
          setWorkflowStateWithLog("SCAN_ITEM");
          await loadCartonItems(cartonId);
          await loadLockInfo();
          await loadAvailableCartons();
          setLoading(false);
          Alert.alert("Info", `Resuming work on carton ${cartonId}`);
          return;
        } else {
          // Locked by a different owner: never allow resume/takeover from this device.
          Alert.alert(
            "Carton Already in Use",
            `Carton ${cartonId} is currently being processed by another user.\n\nLocked by: ${
              status.locked_by || "Unknown"
            }\nStatus: ${status.status}\n\nPlease select a different carton.`,
            [{ text: "OK", style: "cancel" as const }]
          );
          setLoading(false);
          await loadAvailableCartons(); // Refresh available cartons
          return;
        }
      }

      // Handle Pending status - automatically unload it first
      if (statusLower === "pending") {
        console.log(`📦 Carton ${cartonId} is Pending, auto-unloading...`);
        const pendingSettings = await getSettings();

        if (pendingSettings.demo_mode !== 1 && pendingSettings.api_url) {
          try {
            const { line } = await getServerUnloadLineForCarton(
              currentSession,
              cartonId
            );
            if (line) {
              const scannedBy =
                line.scanned_by != null && String(line.scanned_by).trim() !== ""
                  ? String(line.scanned_by).trim()
                  : "";
              const scannedOnRaw =
                line.scanned_on || line.created_at || line.modified || "";
              const scannedOn =
                typeof scannedOnRaw === "string" && scannedOnRaw.length > 10
                  ? scannedOnRaw.slice(0, 19)
                  : "";
              await dataService.updateCartonStatus({
                asn_no: normalizedASN,
                inbound_session: currentSession,
                carton_id: cartonId,
                status: "Unloaded",
                updated_on: new Date().toISOString(),
              });
              setLoading(false);
              await loadAvailableCartons();
              Alert.alert(
                scannedBy ? `Already unloaded by ${scannedBy}` : "Already unloaded",
                scannedOn
                  ? `Recorded at ${scannedOn}.\n\nYour list has been updated.`
                  : "Your list has been updated."
              );
              return;
            }
          } catch (e: any) {
            setLoading(false);
            Alert.alert(
              "Could not verify with server",
              `${e?.message || "Unknown error"}\n\nCheck your connection and try again.`
            );
            return;
          }
        }

        // Create unload event
        await addEvent({
          event_type: "UNLOAD_SCAN",
          asn_no: normalizedASN,
          inbound_session: currentSession,
          carton_id: cartonId,
          device_id: pendingSettings.device_id || "",
          user_id: pendingSettings.user_id || "",
        });

        // Update status to Unloaded
        await dataService.updateCartonStatus({
          asn_no: normalizedASN,
          inbound_session: currentSession,
          carton_id: cartonId,
          status: "Unloaded",
          updated_on: new Date().toISOString(),
        });

        // Sync status change to backend
        try {
          await apiService.updateCartonStatus({
            asn_no: currentASN, // Use original format from desktop
            inbound_session: currentSession,
            carton_id: cartonId,
            status: "Unloaded",
            user_id: pendingSettings.user_id,
            device_id: pendingSettings.device_id,
          });
          console.log(
            `✅ Carton ${cartonId} status synced to backend: Unloaded`
          );
        } catch (apiError: any) {
          console.warn(
            `⚠️ Failed to sync carton ${cartonId} status to backend:`,
            apiError.message
          );
          // Don't block user flow if API sync fails
        }

        // Reload status
        status = await dataService.getCartonStatus(
          normalizedASN,
          currentSession,
          cartonId
        );
        console.log(
          `✅ Carton ${cartonId} auto-unloaded, new status:`,
          status?.status
        );
      }

      if (statusLower !== "unloaded" && statusLower !== "pending") {
        Alert.alert(
          "Carton Not Available",
          `Carton ${cartonId} cannot be processed.\n\nCurrent status: ${status?.status ?? "unknown"}\n\nOnly "Unloaded" or "Pending" cartons can be received.`
        );
        setLoading(false);
        await loadAvailableCartons(); // Refresh available cartons
        return;
      }

      // Backend: carton may already be in Receiving on another handset (GET ASN is authoritative)
      if (settings.demo_mode !== 1 && settings.api_url) {
        try {
          const backendLock = asnResForReceiveGate
            ? parseAsnPayloadForCartonLock(asnResForReceiveGate, cartonId)
            : await fetchBackendCartonLockFromASN(currentASN, cartonId);
          if (
            backendLock &&
            isOtherScannerLock(
              backendLock,
              settings.user_id || "",
              settings.device_id || ""
            )
          ) {
            const whoUser =
              backendLock.locked_by?.trim() || "(unknown user)";
            const whoDev =
              backendLock.device_id?.trim() || "(unknown device)";
            await dataService.updateCartonStatus({
              asn_no: normalizedASN,
              inbound_session: currentSession,
              carton_id: cartonId,
              status: "Receiving",
              locked_by: backendLock.locked_by || undefined,
              locked_on: new Date().toISOString(),
              updated_on: new Date().toISOString(),
            });
            setLoading(false);
            await loadAvailableCartons();
            Alert.alert(
              "Carton already in use",
              `This carton is already being received on another device (per server).\n\nUser: ${whoUser}\nDevice: ${whoDev}\n\nWait for them to finish or ask them to release the carton.`
            );
            return;
          }
        } catch (e: any) {
          setLoading(false);
          Alert.alert(
            "Could not verify lock on server",
            `${e?.message || "Unknown error"}\n\nCheck your connection and try again.`
          );
          return;
        }
      }

      // Lock carton
      console.log(`🔒 Attempting to lock carton ${cartonId}...`, {
        inbound_session: currentSession,
        asn_no: normalizedASN,
        carton_id: cartonId,
        user_id: settings.user_id,
        device_id: settings.device_id,
      });

      let lockResponse;
      try {
        lockResponse = await apiService.lockCarton({
          inbound_session: currentSession,
          asn_no: currentASN, // Use original format from desktop
          carton_id: cartonId,
          user_id: settings.user_id!,
          device_id: settings.device_id!,
        });

        console.log(`📋 Lock carton API response:`, lockResponse);
      } catch (error: any) {
        console.error(`❌ Lock carton API error:`, error);
        const errorMessage = error.message || "Failed to lock carton";
        Alert.alert(
          "Error",
          `Failed to lock carton: ${errorMessage}\n\nPlease check:\n1. API connection\n2. Authentication token\n3. Backend logs`
        );
        setLoading(false);
        return;
      }

      // Check response format - handle nested { data: { locked: true } }, { locked: true }, or { ok: true } formats
      let isLocked =
        lockResponse?.data?.locked === true ||
        lockResponse?.locked === true ||
        lockResponse?.ok === true;

      let sameUserResume =
        !isLocked &&
        cartonLockResponseMeansCurrentUserAlreadyHolds(
          lockResponse,
          settings
        );
      let lockOk = isLocked || sameUserResume;

      if (!lockOk) {
        const stReclaim = await dataService.getCartonStatus(
          normalizedASN,
          currentSession,
          cartonId
        );
        const canReclaim =
          String(stReclaim?.status || "").toLowerCase() === "unloaded" &&
          settingsMatchUnloadedActor(settings, stReclaim?.unloaded_by) &&
          settings.user_id;
        if (canReclaim) {
          console.log(
            `ℹ️ Lock denied — local unload actor is you; syncing Receiving then retrying lock once`
          );
          const reclaimSync = await pushReceivingCartonStatusServerThenLocal({
            asnNoOriginal: currentASN,
            inboundSession: currentSession,
            cartonId,
            userId: settings.user_id!,
            deviceId: settings.device_id,
            lockedOnIso: new Date().toISOString(),
          });
          if (reclaimSync.ok) {
            try {
              lockResponse = await apiService.lockCarton({
                inbound_session: currentSession,
                asn_no: currentASN,
                carton_id: cartonId,
                user_id: settings.user_id!,
                device_id: settings.device_id!,
              });
              console.log(
                `📋 Lock carton API response (after reclaim):`,
                lockResponse
              );
            } catch (reErr: any) {
              console.error(`❌ Lock retry after reclaim failed:`, reErr);
              Alert.alert(
                "Error",
                `Failed to lock carton: ${reErr.message || "Unknown error"}`
              );
              setLoading(false);
              return;
            }
            isLocked =
              lockResponse?.data?.locked === true ||
              lockResponse?.locked === true ||
              lockResponse?.ok === true;
            sameUserResume =
              !isLocked &&
              cartonLockResponseMeansCurrentUserAlreadyHolds(
                lockResponse,
                settings
              );
            lockOk = isLocked || sameUserResume;
          }
        }
      }

      if (!lockOk) {
        const lr: any = lockResponse;
        const errorMessage =
          lr?.data?.message ||
          lr?.message ||
          lr?.error?.message ||
          lr?.error ||
          JSON.stringify(lockResponse) ||
          "Failed to lock carton";
        const holderUser = String(
          lr?.data?.locked_by ??
            lr?.locked_by ??
            lr?.data?.existing_user ??
            lr?.existing_user ??
            lr?.data?.locked_user ??
            ""
        ).trim();
        const holderDevice = String(
          lr?.data?.device_id ??
            lr?.device_id ??
            lr?.data?.locked_device_id ??
            lr?.locked_device_id ??
            ""
        ).trim();
        const holderLine =
          holderUser || holderDevice
            ? `\n\nAlready scanning:\nUser: ${holderUser || "(unknown)"}\nDevice: ${holderDevice || "(unknown)"}`
            : "";
        console.error(`❌ Lock carton failed:`, {
          response: lockResponse,
          errorMessage,
        });
        const debugTail = __DEV__
          ? `\n\n${JSON.stringify(lockResponse).substring(0, 200)}`
          : "";
        Alert.alert(
          "Cannot lock carton",
          `Failed to lock carton: ${errorMessage}${holderLine}${debugTail}`
        );
        setLoading(false);
        return;
      }
      if (sameUserResume) {
        console.log(
          `ℹ️ Lock carton: server says already in use by you — treating as success and syncing local state`
        );
      }

      console.log(`✅ Carton ${cartonId} locked successfully`);

      const lockedOnSelect = new Date().toISOString();
      const syncSelect = await pushReceivingCartonStatusServerThenLocal({
        asnNoOriginal: currentASN,
        inboundSession: currentSession,
        cartonId,
        userId: settings.user_id!,
        deviceId: settings.device_id,
        lockedOnIso: lockedOnSelect,
      });
      if (!syncSelect.ok) {
        setLoading(false);
        Alert.alert(
          syncSelect.kind === "network"
            ? "Server connection lost"
            : "Cannot update carton",
          syncSelect.message
        );
        return;
      }

      logStateChange("SELECT_CARTON_LOCK", { carton: cartonId });
      setLockedCartonWithLog(cartonId);

      // Load carton items FIRST before setting workflow state
      await loadCartonItems(cartonId);

      // Check if there's saved state for this carton before clearing
      const savedStateBeforeLock = await loadWorkflowState(
        normalizedASN,
        currentSession,
        "ReceiveSort"
      );
      if (
        savedStateBeforeLock &&
        savedStateBeforeLock.locked_carton === cartonId
      ) {
        // Restore saved state, but validate it makes sense
        console.log("📂 Found saved state in handleCartonSelect, restoring:", {
          scanned_items_count: savedStateBeforeLock.scanned_items?.length || 0,
          workflow_state: savedStateBeforeLock.workflow_state,
          current_item: savedStateBeforeLock.current_item,
        });
        logStateChange("RESTORE_IN_HANDLE_CARTON_SELECT", {
          carton: cartonId,
          savedState: {
            scanned_items_count:
              savedStateBeforeLock.scanned_items?.length || 0,
            scanned_items: savedStateBeforeLock.scanned_items?.map((i) => ({
              item: i.item_code,
              box: i.box_id,
            })),
            workflow_state: savedStateBeforeLock.workflow_state,
            current_item: savedStateBeforeLock.current_item,
          },
        });
        await refreshScannedStateFromDb();
        const restoredSi = savedStateBeforeLock.scanned_items || [];
        const lastFromLockRestore =
          restoredSi.length > 0
            ? String(
                restoredSi[restoredSi.length - 1]?.item_code ?? ""
              ).trim()
            : "";
        setLastScannedItem(lastFromLockRestore || null);

        // Only restore currentItem if it exists, otherwise start fresh
        const restoredCurrentItem = savedStateBeforeLock.current_item || null;
        setCurrentItemWithLog(restoredCurrentItem);

        // If workflow state is SCAN_BOX but there's no currentItem, go back to SCAN_ITEM
        const restoredWorkflowState =
          savedStateBeforeLock.workflow_state as WorkflowState;
        // Always start with SCAN_ITEM if there's no currentItem
        // This ensures the flow is: Scan Item → Scan Box → Scan Item → Scan Box
        if (!restoredCurrentItem) {
          console.log(
            "⚠️ No currentItem in saved state, resetting to SCAN_ITEM to start item scan flow"
          );
          setWorkflowStateWithLog("SCAN_ITEM");
        } else if (restoredWorkflowState === "SCAN_BOX") {
          // If we have a currentItem and state is SCAN_BOX, keep it
          setWorkflowStateWithLog(restoredWorkflowState);
        } else {
          // Otherwise, default to SCAN_ITEM
          setWorkflowStateWithLog("SCAN_ITEM");
        }
      } else {
        // No saved state, start fresh - always start with SCAN_ITEM
        logStateChange("NO_SAVED_STATE_IN_HANDLE_CARTON_SELECT", {
          carton: cartonId,
        });
        setWorkflowStateWithLog("SCAN_ITEM");
        setScannedItemsWithLog([]);
        setScannedQuantitiesWithLog({});
        setCurrentItemWithLog(null);
        setLastScannedItem(null);
      }

      await loadLockInfo();
      await loadAvailableCartons(); // Refresh available cartons
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to lock carton");
    } finally {
      setLoading(false);
    }
  };

  const handleItemScan = async (barcode: string) => {
    if (!activeASN || !activeSession) return;
    if (!(await requireOnlineForReceiving())) return;

    const scannedValue = barcode.trim();

    console.log(`🔍 handleItemScan: Scanned item code: "${scannedValue}"`);

    if (!lockedCarton) {
      Alert.alert(
        "Carton Required",
        "Please scan or select a supplier carton before scanning items."
      );
      return;
    }

    await processItemScan(scannedValue, lockedCarton);
  };

  const handleCTNIdPromptSubmit = async (providedBoxId?: string) => {
    // Guard against duplicate submission
    if (isProcessingScan) {
      console.warn(
        `⚠️ handleCTNIdPromptSubmit: Already processing a scan, ignoring duplicate submission`
      );
      showScanFeedback(
        "err",
        "Still saving the last scan — wait a moment, then confirm the BOX again."
      );
      return;
    }

    // Use provided value if available (from barcode scanner), otherwise use state
    const boxId = (providedBoxId || ctnIdPromptValue).trim();

    if (!boxId) {
      Alert.alert(
        "BOX ID Required",
        "Please enter a valid BOX ID.\n\n" +
          "Use a box that exists in Box Management for this ASN:\n" +
          '• "BOX-…" or "PAW-…" (generated), or\n' +
          "• A custom distribution box id you created for this ASN (Open).\n\n" +
          "Do not use the vendor carton barcode as the destination BOX."
      );
      return;
    }

    // Update state with the value we're using (in case it was provided directly)
    if (providedBoxId && providedBoxId !== ctnIdPromptValue) {
      setCtnIdPromptValue(providedBoxId);
    }

    let normalizedBoxId = boxId.trim().toUpperCase();

    const isPrefixedBoxId =
      normalizedBoxId.startsWith("BOX-") ||
      normalizedBoxId.startsWith("PAW-");

    if (!activeASN || !activeSession) {
      Alert.alert(
        "Error",
        "Missing active ASN or session. Please restart the receiving process."
      );
      return;
    }

    try {
      const db = await getDatabase();
      const na = normalizeASN(activeASN);
      const scannedUp = normalizedBoxId.trim().toUpperCase();

      // User often scans the supplier carton (e.g. CNWH63179) here — that is not a destination BOX
      if (
        lockedCarton &&
        scannedUp === String(lockedCarton).trim().toUpperCase()
      ) {
        Alert.alert(
          "Wrong scan — supplier carton",
          `You scanned the carton you are receiving from ("${normalizedBoxId}").\n\n` +
            `Use a destination BOX only — never the vendor carton barcode.\n\n` +
            `Reprint or use a distribution label: BOX-…, PAW-…, or a custom id created in Box Management for this ASN (Open).`
        );
        return;
      }

      const supplierCartonHit = await db.getFirstAsync<{ one: number }>(
        `SELECT 1 AS one FROM asn_carton_map WHERE (asn_no = ? OR asn_no = ?) AND UPPER(TRIM(carton_id)) = ? LIMIT 1`,
        [activeASN, na, scannedUp]
      );

      const boxes = await dataService.getBoxes(activeASN);

      // Try exact match first (with trimmed values)
      let box = boxes.find((b) => {
        const bBoxId = String(b.box_id || "").trim();
        const normalized = normalizedBoxId.trim();
        return bBoxId === normalized;
      });

      if (!box) {
        // Try case-insensitive match (with trimmed values)
        const boxCaseInsensitive = boxes.find((b) => {
          const bBoxId = String(b.box_id || "")
            .trim()
            .toUpperCase();
          const normalized = normalizedBoxId.trim().toUpperCase();
          return bBoxId === normalized;
        });
        if (boxCaseInsensitive) {
          box = boxCaseInsensitive;
          normalizedBoxId = String(boxCaseInsensitive.box_id || "").trim();
        } else if (isPrefixedBoxId) {
          // Partial match only for long BOX-/PAW- ids (avoid matching wrong open box for short custom ids)
          const boxPartial = boxes.find((b) => {
            const bBoxId = String(b.box_id || "")
              .trim()
              .toUpperCase();
            const normalized = normalizedBoxId.trim().toUpperCase();
            return bBoxId.includes(normalized) || normalized.includes(bBoxId);
          });
          if (boxPartial) {
            box = boxPartial;
            normalizedBoxId = String(boxPartial.box_id || "").trim();
          }
        }
      }

      // Never use a vendor / ASN carton_id as the destination BOX, even if someone duplicated it in Box Management
      if (supplierCartonHit) {
        Alert.alert(
          "Vendor carton barcode — not allowed",
          `"${normalizedBoxId}" matches a supplier carton ID on this shipment.\n\n` +
            `Destination scans must use a distribution BOX only — never reuse the vendor carton barcode.\n\n` +
            `Reprint or scan a BOX-…, PAW-…, or another custom id created only in Box Management (Open) for this ASN.`
        );
        return;
      }

      if (!box) {
        const openBoxesForHint = boxes.filter(
          (b) =>
            b.status === "Open" ||
            b.status === "OPEN" ||
            b.status === "open"
        );
        const openHint = openBoxesForHint
          .slice(0, 5)
          .map((b) => b.box_id)
          .join(", ");
        if (isPrefixedBoxId) {
          Alert.alert(
            "BOX Not Found",
            `BOX "${boxId}" not found.\n\n` +
              `Please enter a valid BOX ID that exists in Box Management.\n\n` +
              `Make sure the BOX is created and has status "Open".\n\n` +
              (openHint
                ? `Open boxes (sample): ${openHint}${
                    openBoxesForHint.length > 5 ? "…" : ""
                  }`
                : "No open boxes found for this ASN yet — create one in Box Management.")
          );
        } else {
          Alert.alert(
            "Invalid BOX ID",
            `"${normalizedBoxId}" is not registered as an Open box for this ASN.\n\n` +
              `Custom ids (not starting with BOX- or PAW-) are accepted only when that id exists in Box Management for this shipment with status Open.\n\n` +
              (openHint
                ? `Open boxes (sample): ${openHint}${
                    openBoxesForHint.length > 5 ? "…" : ""
                  }`
                : "No open boxes found for this ASN yet — create or sync the box in Box Management.")
          );
        }
        return;
      }

      const boxStatus = String(box.status || "").trim();
      const isOpen =
        boxStatus === "Open" ||
        boxStatus === "OPEN" ||
        boxStatus === "open";
      if (!isOpen) {
        Alert.alert(
          "BOX Not Active",
          `BOX "${normalizedBoxId}" is not active.\n\n` +
            `Current status: "${boxStatus}"\n\n` +
            `Please use an active (Open) BOX.`
        );
        return;
      }
    } catch (error: any) {
      Alert.alert("Error", `Failed to validate BOX ID: ${error.message}`);
      return;
    }

    setShowCTNIdPrompt(false);
    setCtnIdPromptValue("");

    // Handle item scan - use BOX ID directly
    if (pendingItemScan) {
      const itemBarcode = pendingItemScan;
      setPendingItemScan(null);
      try {
        await processItemScanWithBox(itemBarcode, normalizedBoxId);
      } catch (error: any) {
        // Only show alert if it's not a TO validation error (that's already shown in processItemScanWithBox)
        if (
          !error.message ||
          !error.message.includes("Transfer Order Quantity Exceeded")
        ) {
          Alert.alert("Error", `Failed to process item scan: ${error.message}`);
        }
      }
    } else if (pendingBoxScan) {
      // Handle box scan - when box is scanned first, we still need CTN ID
      // But since we changed to BOX ID workflow, this path might not be used
      // Keeping it for backward compatibility
      Alert.alert(
        "Workflow Changed",
        "The workflow has changed. Please scan the item first, then enter the BOX ID.\n\n" +
          "Flow: Scan Item → Enter BOX ID → Process"
      );
      setPendingBoxScan(null);
      setShowCTNIdPrompt(false);
      setCtnIdPromptValue("");
      setLoading(false);
    } else {
      console.warn(
        `⚠️ handleCTNIdPromptSubmit: No pendingItemScan or pendingBoxScan! pendingItemScan="${pendingItemScan}", pendingBoxScan="${pendingBoxScan}"`
      );
      Alert.alert(
        "Nothing to submit",
        "Scan an item barcode first, then scan or enter the destination BOX when prompted."
      );
    }
  };

  const handleCTNIdPromptCancel = () => {
    setShowCTNIdPrompt(false);
    setCtnIdPromptValue("");
    setPendingItemScan(null);
    setPendingBoxScan(null);
    setLoading(false);
  };

  const handleBoxScanWithCTN = async (
    boxId: string,
    targetCartonId: string
  ) => {
    if (!activeASN || !activeSession) return;

    setLoading(true);
    try {
      // Validate carton_id exists in ASN
      const normalizedASN = normalizeASN(activeASN);
      const db = await getDatabase();

      // Check if carton exists in asn_carton_map
      const cartonExists = await db.getFirstAsync<{ carton_id: string }>(
        `SELECT carton_id FROM asn_carton_map 
         WHERE asn_no = ? AND carton_id = ?`,
        [normalizedASN, targetCartonId]
      );

      if (!cartonExists) {
        // Also try with original ASN format
        const cartonExistsOriginal = await db.getFirstAsync<{
          carton_id: string;
        }>(
          `SELECT carton_id FROM asn_carton_map 
           WHERE asn_no = ? AND carton_id = ?`,
          [activeASN, targetCartonId]
        );

        if (!cartonExistsOriginal) {
          Alert.alert(
            "Invalid Carton ID",
            `Carton "${targetCartonId}" does not exist in ASN "${activeASN}".\n\nPlease enter a valid carton ID.`
          );
          setLoading(false);
          return;
        }
      }

      // Validate box exists and is active
      const boxes = await dataService.getBoxes(activeASN);
      const box = boxes.find((b) => b.box_id === boxId);
      if (!box) {
        Alert.alert("BOX Not Found", `BOX "${boxId}" not found.`);
        setLoading(false);
        return;
      }

      if (
        box.status !== "Open" &&
        box.status !== "OPEN" &&
        box.status !== "open"
      ) {
        Alert.alert(
          "BOX Not Active",
          `BOX "${boxId}" is not active. Current status: ${box.status}`
        );
        setLoading(false);
        return;
      }

      // Use currentItem if available
      const targetItemCode = currentItem;
      if (!targetItemCode) {
        Alert.alert(
          "Item Required",
          "Please scan an item first, then scan the BOX barcode."
        );
        setLoading(false);
        return;
      }

      // Continue with box scan processing using targetCartonId and targetItemCode
      // (This would be the same logic as the rest of handleBoxScan)
      // db and normalizedASN are already declared above
      const settings = await getSettings();

      // Create events and save to database (similar to handleBoxScan)
      await addEvent({
        event_type: "SORT_TO_BOX",
        asn_no: normalizedASN,
        inbound_session: activeSession,
        carton_id: targetCartonId,
        item_code: targetItemCode,
        box_id: boxId,
        store: box.store,
        device_id: settings.device_id,
        user_id: settings.user_id,
      });

      // Save to scanned_items
      const existing = await db.getFirstAsync<{ scanned_qty: number }>(
        `SELECT scanned_qty FROM scanned_items 
         WHERE asn_no = ? AND inbound_session = ? AND carton_id = ? AND item_code = ? AND box_id = ?`,
        [normalizedASN, activeSession, targetCartonId, targetItemCode, boxId]
      );

      if (existing) {
        const newQty = existing.scanned_qty + 1;
        await db.runAsync(
          `UPDATE scanned_items 
           SET scanned_qty = ?, scanned_on = ?, device_id = ?, user_id = ?
           WHERE asn_no = ? AND inbound_session = ? AND carton_id = ? AND item_code = ? AND box_id = ?`,
          [
            newQty,
            new Date().toISOString(),
            settings.device_id ?? "",
            settings.user_id ?? "",
            normalizedASN,
            activeSession,
            targetCartonId,
            targetItemCode,
            boxId,
          ]
        );
      } else {
        await db.runAsync(
          `INSERT INTO scanned_items 
           (asn_no, inbound_session, carton_id, item_code, box_id, store, scanned_qty, scanned_on, device_id, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            normalizedASN,
            activeSession,
            targetCartonId,
            targetItemCode,
            boxId,
            box.store,
            1,
            new Date().toISOString(),
            settings.device_id ?? "",
            settings.user_id ?? "",
          ]
        );
      }

      // Update state
      if (targetCartonId !== lockedCarton) {
        setLockedCartonWithLog(targetCartonId);
      }

      setLastScannedItem(targetItemCode);
      await loadAvailableBoxes();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to process box scan");
    } finally {
      setLoading(false);
    }
  };

  // Process item scan with BOX ID (new workflow - BOX ID instead of CTN ID)
  const processItemScanWithBox = async (barcode: string, boxId: string) => {
    if (!activeASN || !activeSession) return;

    // Guard against duplicate processing
    if (isProcessingScan) {
      console.warn(
        `⚠️ processItemScanWithBox: Already processing a scan, ignoring duplicate: "${barcode}" to BOX ${boxId}`
      );
      showScanFeedback(
        "err",
        "Still saving the last scan — wait a moment, then try again."
      );
      return;
    }

    const scannedValue = barcode.trim();
    setIsProcessingScan(true);
    setLoading(true);

    try {
      console.warn(
        `🔍 Processing item scan: "${scannedValue}" to BOX ${boxId} in ASN ${activeASN}`
      );

      const normalizedASN = normalizeASN(activeASN);
      const db = await getDatabase();

      // Validate BOX exists and is active
      const boxes = await dataService.getBoxes(activeASN);
      let box = boxes.find((b) => b.box_id === boxId);
      if (!box) {
        box = boxes.find(
          (b) =>
            String(b.box_id || "").trim().toUpperCase() ===
            String(boxId || "").trim().toUpperCase()
        );
      }

      if (!box) {
        Alert.alert("BOX Not Found", `BOX "${boxId}" not found.`);
        setLoading(false);
        return;
      }

      const canonicalBoxId = String(box.box_id || "").trim();

      if (
        box.status !== "Open" &&
        box.status !== "OPEN" &&
        box.status !== "open"
      ) {
        Alert.alert(
          "BOX Not Active",
          `BOX "${canonicalBoxId}" is not active. Current status: ${box.status}`
        );
        setLoading(false);
        return;
      }

      // Resolve item from barcode. If item master is not synced, currentItem is
      // already the validated ASN item_code, so allow it to proceed.
      const resolvedItem = await resolveItemFromBarcode(scannedValue);
      const itemCode = String(resolvedItem?.item_code ?? scannedValue).trim();
      if (!itemCode) {
        Alert.alert("Item Not Found", `Item "${scannedValue}" not found.`);
        setLoading(false);
        return;
      }
      const settings = await getSettings();

      // Shipped qty on this carton line (used for carton cap + TO messaging)
      let shippedOnLockedCartonLine = 0;
      // Cap scans by this carton's shipped line — count only rows attributed to THIS supplier carton
      // (same basis as refreshScannedStateFromDb / Expected Items; do NOT add NULL carton_id or other cartons)
      if (lockedCarton) {
        const lockCtn = String(lockedCarton).trim();
        const cartonLine = await db.getFirstAsync<{ shipped_qty: number }>(
          `SELECT COALESCE(SUM(shipped_qty), 0) AS shipped_qty
           FROM asn_carton_map
           WHERE UPPER(TRIM(carton_id)) = UPPER(TRIM(?))
             AND (UPPER(TRIM(asn_no)) = UPPER(TRIM(?)) OR UPPER(TRIM(asn_no)) = UPPER(TRIM(?)))
             AND UPPER(TRIM(item_code)) = UPPER(TRIM(?))`,
          [lockCtn, activeASN, normalizedASN, String(itemCode).trim()]
        );
        const shippedCap = cartonLine?.shipped_qty ?? 0;
        shippedOnLockedCartonLine = shippedCap;
        if (shippedCap <= 0) {
          Alert.alert(
            "Item Not on Carton",
            `Item ${itemCode} is not expected on carton ${lockedCarton} for this ASN (no shipped quantity on file).`
          );
          setLoading(false);
          return;
        }
        const cartonScannedRow = await db.getFirstAsync<{ total_qty: number }>(
          `SELECT COALESCE(SUM(scanned_qty), 0) AS total_qty
           FROM scanned_items
           WHERE (asn_no = ? OR asn_no = ?)
             AND inbound_session = ?
             AND UPPER(TRIM(item_code)) = UPPER(TRIM(?))
             AND UPPER(TRIM(IFNULL(carton_id,''))) = UPPER(TRIM(?))`,
          [
            activeASN,
            normalizedASN,
            activeSession,
            String(itemCode).trim(),
            lockCtn,
          ]
        );
        const currentOnCarton = cartonScannedRow?.total_qty ?? 0;
        if (currentOnCarton + 1 > shippedCap) {
          Alert.alert(
            "Carton Quantity Exceeded",
            `Cannot scan more of ${itemCode} for carton ${lockedCarton}.\n\n` +
              `Shipped on this carton: ${shippedCap}\n` +
              `Already scanned (counted for this carton): ${currentOnCarton}\n\n` +
              `Transfer Order limits apply per store, but you cannot sort more units than this carton line.`
          );
          showScanFeedback(
            "err",
            `Carton limit: ${itemCode} — max ${shippedCap} on ${lockedCarton}.`
          );
          setLoading(false);
          return;
        }
      }

      // Validate quantity against TO allocation before saving
      const allocations = await dataService.getTransferOrderAllocations(
        activeASN
      );

      const normToStore = (s: string | null | undefined) =>
        String(s ?? "").trim().toUpperCase();

      const isPutawayBoxRecord = (b: { box_id?: string; purpose?: string }) => {
        const id = String(b?.box_id || "").trim().toUpperCase();
        const pur = String((b as any)?.purpose || "").trim().toUpperCase();
        return id.startsWith("PAW-") || pur === "PUTAWAY";
      };

      // Do not block scanning when TO lines are fulfilled globally across cartons.
      // Same item_code often appears in multiple cartons; later cartons may still need
      // sorting (e.g. overflow to Putaway). Per-scan TO / store-box checks below are enough.

      const isPutawayBox = isPutawayBoxRecord(box);

      const findAllocForItemAndStore = (storeVal: string | null | undefined) =>
        allocations.find(
          (alloc) =>
            itemCodesMatchForAllocation(alloc.item_code, itemCode) &&
            storeCodesMatchForTO(alloc.store, storeVal)
        );

      let itemAllocation = findAllocForItemAndStore(box.store);
      if (!itemAllocation && !isPutawayBox) {
        const slug = parseBoxIdStoreSlug(canonicalBoxId);
        if (slug) {
          itemAllocation = findAllocForItemAndStore(slug);
          if (itemAllocation) {
            console.warn(
              `📌 TO match: used BOX id slug "${slug}" (box.store="${box.store}" did not match a TO line for this item).`
            );
          }
        }
      }

      // Persist store string aligned with TO line when matched (Putaway keeps BOX.store)
      const storeForToPersistence = isPutawayBox
        ? String(box.store || "").trim()
        : itemAllocation && String(itemAllocation.store || "").trim()
          ? String(itemAllocation.store).trim()
          : String(box.store || "").trim();

      console.log(
        `🔍 TO Validation check: Item=${itemCode}, Store=${
          box.store
        } (normalized=${normToStore(
          box.store
        )}), Allocation found=${!!itemAllocation}, Allocated Qty=${
          itemAllocation?.allocated_qty || 0
        }`
      );

      // ✅ PERMANENT FIX: Only allow scanning items that have TO allocation
      // Block items that are not in TO allocation (unless it's a Putaway box)
      if (!isPutawayBox && !itemAllocation) {
        console.error(
          `❌ TO Validation FAILED: Item=${itemCode} has no TO allocation for ${box.store}`
        );
        const storeKeys = Array.from(
          new Set(
            allocations
              .filter((a) => itemCodesMatchForAllocation(a.item_code, itemCode))
              .map((a) => `${a.store} → ${normToStore(a.store)}`)
          )
        );
        const hintStores =
          storeKeys.length > 0
            ? `\n\nTransfer Order has this item for store(s):\n${storeKeys
                .slice(0, 6)
                .join("\n")}${storeKeys.length > 6 ? "\n…" : ""}`
            : "";
        Alert.alert(
          "Item Not in Transfer Order",
          `Item ${itemCode} is not allocated to ${box.store} in the Transfer Order lines on this device.${hintStores}\n\n` +
            `Often this is a store code mismatch (spacing/case) between the BOX and the synced TO, or the TO was not synced yet (tap "Sync receive data").\n\n` +
            `Store codes must match Warehouses & Stores on the ERP (e.g. 004-Alras), not shorthand like "004-RAS".\n\n` +
            `Only items with TO allocation can be scanned to store boxes.\n\n` +
            `Items without TO allocation should be scanned to Putaway boxes (PAW-* or any box with purpose Putaway in Box Management).`
        );
        setLoading(false);
        return;
      }

      const allocatedCap =
        itemAllocation != null
          ? Math.max(0, Math.floor(Number(itemAllocation.allocated_qty) || 0))
          : 0;

      if (itemAllocation && allocatedCap > 0) {
        // Get all boxes for this store
        const storeKeyForBoxes = itemAllocation
          ? String(itemAllocation.store || "").trim()
          : String(box.store || "").trim();
        const storeBoxIds = boxes
          .filter((b) => storeCodesMatchForTO(b.store, storeKeyForBoxes))
          .map((b) => b.box_id);

        // Sum scanned qty for this item + TO store using same store matching as allocations
        // (SQL UPPER(TRIM(store)) = ? misses e.g. "004-ALRAS" vs "004ALRAS" from BOX id slug / cache)
        const scannedRowsForTo = await db.getAllAsync<{
          scanned_qty: number;
          store: string | null;
        }>(
          `SELECT scanned_qty, store FROM scanned_items
           WHERE (asn_no = ? OR asn_no = ?)
             AND inbound_session = ?
             AND UPPER(TRIM(item_code)) = UPPER(TRIM(?))`,
          [
            activeASN,
            normalizedASN,
            activeSession,
            String(itemCode).trim(),
          ]
        );
        let currentScannedQtyForStore = 0;
        for (const r of scannedRowsForTo) {
          if (storeCodesMatchForTO(r.store, storeForToPersistence)) {
            currentScannedQtyForStore += Number(r.scanned_qty) || 0;
          }
        }

        console.log(
          `🔍 TO Validation: Item=${itemCode}, Store=${box.store}, Allocated=${allocatedCap}, Current Scanned=${currentScannedQtyForStore}, After scan=${
            currentScannedQtyForStore + 1
          }`
        );

        // Check if adding 1 more would exceed TO allocation
        // Use strict check: current + 1 > allocated (not >=)
        const wouldExceed = currentScannedQtyForStore + 1 > allocatedCap;

        if (wouldExceed) {
          console.error(
            `❌ TO Validation FAILED: Item=${itemCode}, Store=${
              box.store
            }, Allocated=${allocatedCap}, Current=${currentScannedQtyForStore}, After scan=${
              currentScannedQtyForStore + 1
            }`
          );
          const cartonHint =
            lockedCarton && shippedOnLockedCartonLine > allocatedCap
              ? `\n\nThis carton line shows ${shippedOnLockedCartonLine} units, but the Transfer Order only allocates ${allocatedCap} to this store for ${itemCode}. Put the remaining units into a Putaway box (PAW-* or purpose Putaway), or increase the TO in ERP and tap "Sync receive data".`
              : "";
          Alert.alert(
            "Transfer Order Quantity Exceeded",
            `Cannot scan item ${itemCode} to ${box.store}.\n\n` +
              `Allocated quantity: ${allocatedCap}\n` +
              `Currently scanned (this store, all boxes): ${currentScannedQtyForStore}\n` +
              `After scanning: ${currentScannedQtyForStore + 1}\n\n` +
              `Scanned quantity cannot exceed the TO line for this store.${cartonHint}`
          );
          showScanFeedback(
            "err",
            `TO limit for ${itemCode} at this store: ${allocatedCap} (already ${currentScannedQtyForStore}).`
          );
          setLoading(false);
          return;
        }

        console.log(
          `✅ TO Validation passed: Item=${itemCode}, Store=${
            box.store
          }, Allocated=${allocatedCap}, Current=${currentScannedQtyForStore}, After scan=${
            currentScannedQtyForStore + 1
          }`
        );
      } else if (itemAllocation && allocatedCap === 0) {
        console.warn(
          `⚠️ TO Validation: Item=${itemCode} has allocation with 0 quantity for ${box.store} - allowing scan`
        );
      }
      // Note: Non-TO items are already blocked above (unless Putaway box)

      // ✅ PUTAWAY BOX VALIDATION: Restrict Putaway scanning to (ASN - TO) quantity
      if (isPutawayBox) {
        console.log(
          `🔍 Putaway BOX Validation: Item=${itemCode}, BOX=${canonicalBoxId}`
        );

        // 1. Get total ASN quantity for this item across all supplier cartons.
        // Do not use DISTINCT here: the same item can appear in multiple cartons with qty 1.
        const asnQtyResult = await db.getFirstAsync<{
          total_qty: number;
        }>(
          `SELECT COALESCE(SUM(shipped_qty), 0) as total_qty
           FROM asn_carton_map
           WHERE (UPPER(TRIM(asn_no)) = UPPER(TRIM(?)) OR UPPER(TRIM(asn_no)) = UPPER(TRIM(?)))
             AND UPPER(TRIM(item_code)) = UPPER(TRIM(?))
             AND UPPER(TRIM(item_code)) <> 'PLACEHOLDER'`,
          [activeASN, normalizedASN, itemCode]
        );
        const asnQty = asnQtyResult?.total_qty || 0;
        console.log(`📦 ASN Quantity for ${itemCode}: ${asnQty}`);

        // 2. Get total TO allocated quantity for this item (sum across all stores)
        const totalTOQty = allocations
          .filter((alloc) =>
            itemCodesMatchForAllocation(alloc.item_code, itemCode)
          )
          .reduce((sum, alloc) => sum + (alloc.allocated_qty || 0), 0);
        console.log(
          `📋 Total TO Allocated Quantity for ${itemCode}: ${totalTOQty}`
        );

        // 3. Calculate max allowed for Putaway.
        // If the item has no TO allocation, the full ASN quantity can go to Putaway.
        // If TO allocation exists, only ASN - TO is allowed; never allow a negative quantity.
        const maxAllowedPutaway =
          totalTOQty > 0 ? Math.max(asnQty - totalTOQty, 0) : asnQty;
        console.log(
          `📊 Max Allowed Putaway for ${itemCode}: ${maxAllowedPutaway} (ASN: ${asnQty}, TO: ${totalTOQty})`
        );

        // 4. Get current Putaway scanned quantity (all Putaway boxes for this item)
        const putawayBoxes = boxes
          .filter((b) => isPutawayBoxRecord(b))
          .map((b) => String(b.box_id || "").trim())
          .filter(Boolean);
        let currentPutawayScanned = 0;
        if (putawayBoxes.length > 0) {
          const placeholders = putawayBoxes.map(() => "?").join(",");
          const putawayScannedResult = await db.getFirstAsync<{
            total_qty: number;
          }>(
            `SELECT COALESCE(SUM(scanned_qty), 0) as total_qty
             FROM scanned_items
             WHERE (asn_no = ? OR asn_no = ?)
               AND inbound_session = ?
               AND item_code = ?
               AND box_id IN (${placeholders})`,
            [activeASN, normalizedASN, activeSession, itemCode, ...putawayBoxes]
          );
          currentPutawayScanned = putawayScannedResult?.total_qty || 0;
        }
        console.log(
          `📦 Current Putaway Scanned for ${itemCode}: ${currentPutawayScanned}`
        );

        // 5. Validate that current Putaway + 1 <= max allowed
        const wouldExceedPutaway =
          currentPutawayScanned + 1 > maxAllowedPutaway;

        if (wouldExceedPutaway) {
          console.error(
            `❌ Putaway Validation FAILED: Item=${itemCode}, ASN=${asnQty}, TO=${totalTOQty}, Max Allowed=${maxAllowedPutaway}, Current Putaway=${currentPutawayScanned}, After scan=${
              currentPutawayScanned + 1
            }`
          );
          Alert.alert(
            "Putaway Quantity Exceeded",
            `Cannot scan item ${itemCode} to Putaway BOX ${canonicalBoxId}.\n\n` +
              `ASN Quantity: ${asnQty}\n` +
              `Transfer Order Allocated: ${totalTOQty}\n` +
              `Max Allowed for Putaway: ${maxAllowedPutaway}${
                totalTOQty > 0 ? " (ASN - TO)" : " (full ASN qty; no TO)"
              }\n` +
              `Currently scanned to Putaway: ${currentPutawayScanned}\n` +
              `After scanning: ${currentPutawayScanned + 1}\n\n` +
              `Please ensure Putaway scanned quantity does not exceed the allowed Putaway quantity.`
          );
          setLoading(false);
          setIsProcessingScan(false);
          return;
        }

        console.log(
          `✅ Putaway Validation passed: Item=${itemCode}, Max Allowed=${maxAllowedPutaway}, Current=${currentPutawayScanned}, After scan=${
            currentPutawayScanned + 1
          }`
        );
      }

      // Save to scanned_items — single UPSERT on UNIQUE(asn_no, inbound_session, carton_id, item_code, box_id)
      // so we never "miss" the prior row (case/format drift) and hit a duplicate INSERT that leaves qty stuck at 1.
      const persistCartonId = lockedCarton
        ? String(lockedCarton).trim()
        : "";
      const cartonForUnique =
        persistCartonId.length > 0 ? persistCartonId : null;
      const scannedOnIso = new Date().toISOString();
      const itemForRow = String(itemCode).trim();
      try {
        if (
          !activeASN ||
          !canonicalBoxId ||
          !lockedCarton ||
          !itemForRow ||
          !settings.user_id
        ) {
          Alert.alert(
            isPutawayBox ? "Putaway Not Allowed" : "Sort Not Allowed",
            "Missing scan context. Please scan the supplier carton, then scan the item, then scan the destination BOX."
          );
          setLoading(false);
          setIsProcessingScan(false);
          return;
        }
        if (!(await requireOnlineForReceiving())) {
          setLoading(false);
          setIsProcessingScan(false);
          return;
        }
        await apiService.scanSortBox({
          purpose: isPutawayBox ? "PUTAWAY" : "STORE",
          asn_no: activeASN,
          box_id: canonicalBoxId,
          carton_id: lockedCarton ?? undefined,
          item_code: itemForRow,
          qty: 1,
          user_id: settings.user_id ?? "",
          device_id: settings.device_id ?? "",
        });
      } catch (error: any) {
        const payload = error?.data || error?.response?.data || {};
        const msg =
          payload?.message ||
          error?.message ||
          "Backend rejected this sort scan.";
        Alert.alert(isPutawayBox ? "Putaway Not Allowed" : "Sort Not Allowed", msg);
        showScanFeedback("err", msg);
        setLoading(false);
        setIsProcessingScan(false);
        return;
      }
      await db.runAsync(
        `INSERT INTO scanned_items 
           (asn_no, inbound_session, carton_id, item_code, box_id, store, scanned_qty, scanned_on, device_id, user_id)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(asn_no, inbound_session, carton_id, item_code, box_id) DO UPDATE SET
           scanned_qty = scanned_items.scanned_qty + 1,
           scanned_on = excluded.scanned_on,
           device_id = excluded.device_id,
           user_id = excluded.user_id,
           carton_id = CASE WHEN excluded.carton_id IS NOT NULL AND TRIM(COALESCE(excluded.carton_id, '')) <> ''
             THEN excluded.carton_id ELSE scanned_items.carton_id END,
           store = CASE WHEN excluded.store IS NOT NULL AND TRIM(COALESCE(excluded.store, '')) <> ''
             THEN excluded.store ELSE scanned_items.store END`,
        [
          normalizedASN,
          activeSession,
          cartonForUnique,
          itemForRow,
          canonicalBoxId,
          storeForToPersistence,
          scannedOnIso,
          settings.device_id ?? "",
          settings.user_id ?? "",
        ]
      );

      // Update state
      setLastScannedItem(itemCode);
      setLastScannedBox(canonicalBoxId);
      setCurrentItemWithLog(itemCode);

      // Clear currentItem to allow scanning next item
      setCurrentItemWithLog(null);

      // Reload after backend-controlled sort. Do not queue SORT_TO_BOX here:
      // /api/sort-box/scan already wrote the server event transactionally.
      try {
        await loadAvailableBoxes().catch((err) =>
          console.warn("Error loading boxes:", err)
        );

        await refreshScannedStateFromDb();

        showScanFeedback(
          "ok",
          `Sorted 1 × ${itemCode} → ${canonicalBoxId}`
        );
        setWorkflowStateWithLog("SCAN_ITEM");
      } catch (reloadErr: any) {
        console.warn(`⚠️ Post-scan reload failed:`, reloadErr?.message);
        Alert.alert(
          "Scan may be saved",
          `Quantities could not be refreshed: ${reloadErr?.message || "Unknown error"}\n\nIf counts look wrong, use Sync receive data or reopen this screen.`
        );
        showScanFeedback(
          "err",
          "Saved sort but could not refresh counts — try Sync receive data."
        );
      }
    } catch (error: any) {
      console.error("❌ Error processing item scan with BOX:", error);
      Alert.alert("Error", error.message || "Failed to process item scan");
    } finally {
      setLoading(false);
      setIsProcessingScan(false); // Clear processing flag
    }
  };

  const processItemScan = async (barcode: string, targetCartonId: string) => {
    if (!activeASN || !activeSession) return;

    const scannedValue = barcode.trim();
    setLoading(true);

    try {
      console.warn(
        `🔍 Scanning item: "${scannedValue}" for carton ${targetCartonId} in ASN ${activeASN}`
      );

      // Load carton items for the target carton
      const normalizedASN = normalizeASN(activeASN);
      const db = await getDatabase();

      // Get carton items for the target carton
      // Note: asn_carton_map doesn't have barcode column, only item_code and shipped_qty
      let targetCartonItems = await db.getAllAsync<{
        item_code: string;
        shipped_qty: number;
      }>(
        `SELECT item_code, COALESCE(SUM(shipped_qty), 0) AS shipped_qty
         FROM asn_carton_map 
         WHERE (UPPER(TRIM(asn_no)) = UPPER(TRIM(?)) OR UPPER(TRIM(asn_no)) = UPPER(TRIM(?)))
           AND UPPER(TRIM(carton_id)) = UPPER(TRIM(?))
           AND UPPER(TRIM(item_code)) <> 'PLACEHOLDER'
         GROUP BY item_code`,
        [activeASN, normalizedASN, targetCartonId]
      );

      if (!targetCartonItems || targetCartonItems.length === 0) {
        const hydrated = await dataService.hydrateCartonLinesFromAsnApi(
          activeASN,
          targetCartonId
        );
        if (hydrated.ok) {
          targetCartonItems = await db.getAllAsync<{
            item_code: string;
            shipped_qty: number;
          }>(
            `SELECT item_code, COALESCE(SUM(shipped_qty), 0) AS shipped_qty
             FROM asn_carton_map 
             WHERE (UPPER(TRIM(asn_no)) = UPPER(TRIM(?)) OR UPPER(TRIM(asn_no)) = UPPER(TRIM(?)))
               AND UPPER(TRIM(carton_id)) = UPPER(TRIM(?))
               AND UPPER(TRIM(item_code)) <> 'PLACEHOLDER'
             GROUP BY item_code`,
            [activeASN, normalizedASN, targetCartonId]
          );
          if (targetCartonItems.length > 0) {
            setCartonItemsWithLog(targetCartonItems as any[]);
          }
        }
      }

      if (!targetCartonItems || targetCartonItems.length === 0) {
        Alert.alert(
          "Error",
          `No expected item lines found for carton ${targetCartonId}.\n\nTap "Sync receive data" and try again. If it is still empty, backend /api/asn must return carton line items for this carton.`
        );
        setLoading(false);
        return;
      }

      // Step 1: Use resolveItemFromBarcode to properly resolve barcode to item_code
      // This function handles both backend API and local database lookups
      let resolvedItem: {
        item_code: string;
        barcode: string;
        item_name: string | null;
      } | null = null;

      try {
        const resolved = await resolveItemFromBarcode(scannedValue);
        resolvedItem = resolved
          ? {
              item_code: resolved.item_code,
              barcode: resolved.barcode ?? resolved.item_code,
              item_name: resolved.item_name ?? null,
            }
          : null;
        if (resolvedItem) {
          console.warn(
            `✅ Resolved via resolveItemFromBarcode: item_code="${resolvedItem.item_code}", barcode="${resolvedItem.barcode}"`
          );
        } else {
          console.warn(
            `⚠️ resolveItemFromBarcode returned null for "${scannedValue}" - will try direct database lookup`
          );
        }
      } catch (error: any) {
        console.warn(`⚠️ Error in resolveItemFromBarcode:`, error.message);
      }

      // Step 2: If resolveItemFromBarcode didn't find it, try direct database lookup as fallback
      if (!resolvedItem) {
        try {
          // Try to find by barcode first (most common case)
          const itemByBarcode = await db.getFirstAsync<{
            item_code: string;
            barcode: string;
            item_name: string | null;
          }>(
            "SELECT item_code, barcode, item_name FROM item_master WHERE barcode = ? OR UPPER(barcode) = ? OR TRIM(barcode) = ?",
            [scannedValue, scannedValue.toUpperCase(), scannedValue.trim()]
          );

          if (itemByBarcode) {
            resolvedItem = {
              item_code: itemByBarcode.item_code,
              barcode: itemByBarcode.barcode || itemByBarcode.item_code,
              item_name: itemByBarcode.item_name || null,
            };
            console.warn(
              `✅ Found in item_master by barcode: item_code="${resolvedItem.item_code}", barcode="${resolvedItem.barcode}"`
            );
          } else {
            // Try to find by item_code (in case scanned value is already an item_code)
            const itemByCode = await db.getFirstAsync<{
              item_code: string;
              barcode: string;
              item_name: string | null;
            }>(
              "SELECT item_code, barcode, item_name FROM item_master WHERE item_code = ? OR UPPER(item_code) = ? OR TRIM(item_code) = ?",
              [scannedValue, scannedValue.toUpperCase(), scannedValue.trim()]
            );

            if (itemByCode) {
              resolvedItem = {
                item_code: itemByCode.item_code,
                barcode: itemByCode.barcode || itemByCode.item_code,
                item_name: itemByCode.item_name || null,
              };
              console.warn(
                `✅ Found in item_master by item_code: item_code="${resolvedItem.item_code}", barcode="${resolvedItem.barcode}"`
              );
            }
          }
        } catch (error: any) {
          console.warn(`⚠️ Error in direct database lookup:`, error.message);
        }
      }

      // Step 3: If still not found, use scanned value as item_code (fallback)
      // This handles cases where item_master is not synced but scanned value matches carton item_code
      if (!resolvedItem) {
        resolvedItem = {
          item_code: scannedValue,
          barcode: scannedValue,
          item_name: null,
        };
        console.warn(
          `⚠️ Not found in item_master, using scanned value as item_code: "${scannedValue}"`
        );
      }

      const item = resolvedItem;
      console.warn(
        `📦 Final resolved item for matching: item_code="${item.item_code}", barcode="${item.barcode}"`
      );

      // Step 4: Match resolved item_code with carton items
      // Try multiple matching strategies to handle both barcode and item code scanning
      console.warn(`🔍 Matching resolved item against carton items:`, {
        resolvedItemCode: item.item_code,
        resolvedBarcode: item.barcode,
        originalScannedValue: scannedValue,
        cartonItemsCount: targetCartonItems.length,
        cartonItems: targetCartonItems.map((ci) => ({
          item_code: ci.item_code,
          shipped_qty: ci.shipped_qty,
        })),
      });

      let expectedItem: any = null;

      // Strategy 1: Match by item_code (exact match, case-insensitive)
      // This handles when user scans item code directly (e.g., "SKU-HAT-301-GRN-OS")
      for (const ci of targetCartonItems) {
        const cartonItemCode = String(ci.item_code || "")
          .trim()
          .toUpperCase();
        const resolvedItemCodeUpper = String(item.item_code || "")
          .trim()
          .toUpperCase();

        if (
          cartonItemCode &&
          resolvedItemCodeUpper &&
          cartonItemCode === resolvedItemCodeUpper
        ) {
          console.warn(
            `✅ Strategy 1 - Exact item_code match: carton "${ci.item_code}" === resolved "${item.item_code}"`
          );
          expectedItem = ci;
          break;
        }
      }

      // Strategy 2: Match by barcode - lookup barcode from item_master for carton items
      // This handles when user scans barcode and we need to match it to carton items
      // Note: asn_carton_map doesn't store barcode, so we look it up from item_master
      if (!expectedItem && item.barcode) {
        for (const ci of targetCartonItems) {
          if (!ci.item_code) continue;

          // Get barcode for carton item from item_master
          const cartonItemDetails = await db.getFirstAsync<{
            barcode: string;
            item_code: string;
          }>(
            "SELECT item_code, barcode FROM item_master WHERE (item_code = ? OR UPPER(item_code) = ? OR TRIM(item_code) = ?) AND barcode IS NOT NULL AND barcode != ''",
            [ci.item_code, ci.item_code.toUpperCase(), ci.item_code.trim()]
          );

          if (cartonItemDetails?.barcode) {
            const cartonBarcode = String(cartonItemDetails.barcode).trim();
            const resolvedBarcode = String(item.barcode || "").trim();

            // Exact barcode match (case-sensitive for barcodes, but try both)
            if (
              cartonBarcode &&
              resolvedBarcode &&
              (cartonBarcode === resolvedBarcode ||
                cartonBarcode.toUpperCase() === resolvedBarcode.toUpperCase())
            ) {
              console.warn(
                `✅ Strategy 2 - Barcode match: carton item "${ci.item_code}" barcode "${cartonBarcode}" === resolved barcode "${resolvedBarcode}"`
              );
              expectedItem = ci;
              break;
            }
          }
        }
      }

      // Strategy 3: Match original scanned value directly to carton item_codes
      // This handles cases where item_master lookup failed but scanned value matches carton item_code
      if (!expectedItem) {
        const scannedValueUpper = scannedValue.toUpperCase().trim();

        for (const ci of targetCartonItems) {
          const cartonItemCode = String(ci.item_code || "")
            .trim()
            .toUpperCase();

          // Direct match: scanned value matches carton item_code
          if (
            cartonItemCode &&
            scannedValueUpper &&
            cartonItemCode === scannedValueUpper
          ) {
            console.warn(
              `✅ Strategy 3 - Direct scanned value match: "${scannedValue}" === carton item_code "${ci.item_code}"`
            );
            expectedItem = ci;
            break;
          }

          // Partial match: scanned value contains carton item_code or vice versa
          if (
            cartonItemCode &&
            scannedValueUpper &&
            (cartonItemCode.includes(scannedValueUpper) ||
              scannedValueUpper.includes(cartonItemCode))
          ) {
            console.warn(
              `✅ Strategy 3 - Partial match: "${scannedValue}" partially matches carton item_code "${ci.item_code}"`
            );
            expectedItem = ci;
            break;
          }
        }
      }

      // Strategy 4: Cross-match - check if scanned barcode matches any carton item's barcode from item_master
      // This is the KEY strategy for barcode scanning: even if barcode didn't resolve to item_code,
      // we can look up what item_code the barcode belongs to by checking the carton item's barcode
      if (!expectedItem) {
        console.warn(
          `🔍 Strategy 4 - Cross-match: Checking if scanned barcode "${scannedValue}" matches any carton item's barcode...`
        );

        for (const ci of targetCartonItems) {
          if (!ci.item_code) continue;

          // Get barcode for carton item from item_master
          const cartonItemDetails = await db.getFirstAsync<{
            barcode: string;
            item_code: string;
          }>(
            "SELECT item_code, barcode FROM item_master WHERE (item_code = ? OR UPPER(item_code) = ? OR TRIM(item_code) = ?) AND barcode IS NOT NULL AND barcode != ''",
            [ci.item_code, ci.item_code.toUpperCase(), ci.item_code.trim()]
          );

          if (cartonItemDetails?.barcode) {
            const cartonBarcode = String(cartonItemDetails.barcode).trim();
            const scannedBarcode = scannedValue.trim();

            console.warn(
              `🔍 Strategy 4 - Comparing: scanned "${scannedBarcode}" vs carton item "${ci.item_code}" barcode "${cartonBarcode}"`
            );

            // Exact match (case-insensitive, handle whitespace)
            if (
              cartonBarcode &&
              scannedBarcode &&
              (cartonBarcode === scannedBarcode ||
                cartonBarcode.toUpperCase() === scannedBarcode.toUpperCase() ||
                cartonBarcode.trim() === scannedBarcode.trim())
            ) {
              console.warn(
                `✅ Strategy 4 - Barcode match: scanned barcode "${scannedBarcode}" matches carton item "${ci.item_code}" barcode "${cartonBarcode}"`
              );
              expectedItem = ci;
              break;
            }
          } else {
            console.warn(
              `⚠️ Strategy 4 - Carton item "${ci.item_code}" has no barcode in item_master. Query result:`,
              cartonItemDetails
            );

            // Debug: Check if item exists in item_master at all
            const itemExists = await db.getFirstAsync<{ item_code: string }>(
              "SELECT item_code FROM item_master WHERE item_code = ? OR UPPER(item_code) = ?",
              [ci.item_code, ci.item_code.toUpperCase()]
            );
            if (itemExists) {
              console.warn(
                `⚠️ Strategy 4 - Item "${ci.item_code}" exists in item_master but has no barcode field`
              );
            } else {
              console.warn(
                `⚠️ Strategy 4 - Item "${ci.item_code}" does not exist in item_master at all`
              );
            }
          }
        }

        if (!expectedItem) {
          console.warn(
            `⚠️ Strategy 4 - No barcode match found for scanned value "${scannedValue}"`
          );

          // Strategy 4b: Reverse lookup - find all items with this barcode and check if any match carton items
          console.warn(
            `🔍 Strategy 4b - Reverse lookup: Finding all items with barcode "${scannedValue}"...`
          );
          try {
            const allItemsWithBarcode = await db.getAllAsync<{
              item_code: string;
              barcode: string;
            }>(
              `SELECT item_code, barcode 
             FROM item_master 
             WHERE (barcode = ? OR UPPER(barcode) = ? OR TRIM(barcode) = ?) 
             AND barcode IS NOT NULL AND barcode != ''`,
              [scannedValue, scannedValue.toUpperCase(), scannedValue.trim()]
            );

            console.warn(
              `🔍 Strategy 4b - Found ${allItemsWithBarcode.length} item(s) with barcode "${scannedValue}":`,
              allItemsWithBarcode.map((i) => i.item_code)
            );

            // Check if any of these items match carton items
            for (const itemWithBarcode of allItemsWithBarcode) {
              for (const ci of targetCartonItems) {
                const cartonItemCode = String(ci.item_code || "")
                  .trim()
                  .toUpperCase();
                const foundItemCode = String(itemWithBarcode.item_code || "")
                  .trim()
                  .toUpperCase();

                if (
                  cartonItemCode &&
                  foundItemCode &&
                  cartonItemCode === foundItemCode
                ) {
                  console.warn(
                    `✅ Strategy 4b - Reverse match: Barcode "${scannedValue}" belongs to item "${itemWithBarcode.item_code}" which matches carton item "${ci.item_code}"`
                  );
                  expectedItem = ci;
                  break;
                }
              }
              if (expectedItem) break;
            }

            if (!expectedItem && allItemsWithBarcode.length > 0) {
              console.warn(
                `⚠️ Strategy 4b - Barcode "${scannedValue}" found in item_master but doesn't match any carton items. Items with this barcode:`,
                allItemsWithBarcode.map((i) => i.item_code)
              );
            }
          } catch (error: any) {
            console.warn(
              `⚠️ Strategy 4b - Error during reverse lookup:`,
              error.message
            );
          }

          // Strategy 4c: If still not found, try fetching from backend API directly
          if (!expectedItem) {
            console.warn(
              `🔍 Strategy 4c - Backend lookup: Fetching item master from backend to find barcode "${scannedValue}"...`
            );
            try {
              const settings = await getSettings();
              if (settings.api_url && settings.demo_mode !== 1) {
                const { fetchAllItemMasterRowsForLookup } = await import(
                  "../services/item-master-sync.service"
                );
                const itemsList = await fetchAllItemMasterRowsForLookup();

                // Find item with matching barcode
                const foundBackendItem = itemsList.find((item: any) => {
                  const itemBarcode = String(item.barcode || "").trim();
                  return (
                    itemBarcode === scannedValue ||
                    itemBarcode.toUpperCase() === scannedValue.toUpperCase()
                  );
                });

                if (foundBackendItem) {
                  const backendItemCode = String(
                    foundBackendItem.item_code || ""
                  ).trim();
                  console.warn(
                    `✅ Strategy 4c - Found in backend: barcode "${scannedValue}" → item_code "${backendItemCode}"`
                  );

                  // Check if this item_code matches any carton item
                  for (const ci of targetCartonItems) {
                    const cartonItemCode = String(ci.item_code || "")
                      .trim()
                      .toUpperCase();
                    const backendItemCodeUpper = backendItemCode.toUpperCase();

                    if (
                      cartonItemCode &&
                      backendItemCodeUpper &&
                      cartonItemCode === backendItemCodeUpper
                    ) {
                      console.warn(
                        `✅ Strategy 4c - Backend match: Barcode "${scannedValue}" from backend matches carton item "${ci.item_code}"`
                      );
                      expectedItem = ci;

                      // Cache this item in local database for future use
                      try {
                        const cachedBarcode = normalizeItemMasterBarcode(
                          foundBackendItem.barcode,
                          backendItemCode
                        );
                        await db.runAsync(
                          `INSERT OR REPLACE INTO item_master (item_code, barcode, item_name, updated_on) VALUES (?, ?, ?, ?)`,
                          [
                            foundBackendItem.item_code,
                            cachedBarcode,
                            foundBackendItem.item_name || null,
                            new Date().toISOString(),
                          ]
                        );
                        console.warn(
                          `💾 Cached item from backend: item_code="${foundBackendItem.item_code}", barcode="${cachedBarcode}"`
                        );
                      } catch (cacheError: any) {
                        console.warn(
                          `⚠️ Failed to cache item from backend:`,
                          cacheError.message
                        );
                      }
                      break;
                    }
                  }
                } else {
                  console.warn(
                    `⚠️ Strategy 4c - Barcode "${scannedValue}" not found in backend item master`
                  );
                }
              }
            } catch (error: any) {
              console.warn(
                `⚠️ Strategy 4c - Error during backend lookup:`,
                error.message
              );
            }
          }
        }
      }

      if (!expectedItem) {
        const cartonItemCodes = targetCartonItems
          .map((ci) => ci.item_code)
          .filter(Boolean)
          .join(", ");

        // Try to get barcodes for carton items from item_master for better error message
        let cartonItemDetails = "";
        try {
          for (const ci of targetCartonItems) {
            if (ci.item_code) {
              const itemDetails = await db.getFirstAsync<{
                barcode: string;
                item_name: string;
              }>(
                "SELECT barcode, item_name FROM item_master WHERE item_code = ? OR UPPER(item_code) = ?",
                [ci.item_code, ci.item_code.toUpperCase()]
              );
              if (itemDetails) {
                cartonItemDetails += `\n• ${ci.item_code}${
                  itemDetails.item_name ? ` (${itemDetails.item_name})` : ""
                }${
                  itemDetails.barcode
                    ? ` - Barcode: ${itemDetails.barcode}`
                    : ""
                }`;
              } else {
                cartonItemDetails += `\n• ${ci.item_code}`;
              }
            }
          }
        } catch (error: any) {
          console.warn(
            `⚠️ Error fetching item details for error message:`,
            error.message
          );
          cartonItemDetails = cartonItemCodes || "No items found";
        }

        const cartonBarcodesList = targetCartonItems
          .map((ci) => (ci as { barcode?: string; item_code: string }).barcode || (ci as { item_code: string }).item_code)
          .filter(Boolean)
          .join(", ");
        console.error(
          `❌ Item not found in carton after all matching strategies:`,
          {
            scannedItemCode: item.item_code,
            scannedBarcode: item.barcode,
            originalScannedValue: scannedValue,
            cartonItemCodes,
            cartonBarcodes: cartonBarcodesList,
            carton: targetCartonId,
            asn: activeASN,
          }
        );

        const errorMessage =
          `Item "${
            item.item_code || item.barcode || scannedValue
          }" is not expected in this carton.\n\n` +
          `Scanned: ${scannedValue}\n` +
          `Resolved to: ${item.item_code}${
            item.barcode && item.barcode !== item.item_code
              ? ` (Barcode: ${item.barcode})`
              : ""
          }\n\n` +
          `Expected items in carton ${targetCartonId}:${
            cartonItemDetails || "\n" + (cartonItemCodes || "No items found")
          }\n\n` +
          `Please scan the correct item barcode or item code for this carton.`;

        Alert.alert("Error", errorMessage);
        setLoading(false);
        return;
      }

      // Use the expected item's item_code for consistency (in case there was a partial match)
      const matchedItemCode = expectedItem.item_code;
      console.log(
        `✅ Item matched: scanned "${
          item.item_code || item.barcode
        }" → expected "${matchedItemCode}"`
      );

      // Check ASN quantity validation - get accurate scanned quantity from database
      // Use targetCartonId instead of lockedCarton
      // Get current scanned quantity from database (more accurate than state)
      const currentScannedQtyResult = await db.getFirstAsync<{
        total_qty: number;
      }>(
        `SELECT COALESCE(SUM(scanned_qty), 0) as total_qty 
       FROM scanned_items 
       WHERE (UPPER(TRIM(asn_no)) = UPPER(TRIM(?)) OR UPPER(TRIM(asn_no)) = UPPER(TRIM(?)))
         AND inbound_session = ?
         AND UPPER(TRIM(carton_id)) = UPPER(TRIM(?))
         AND UPPER(TRIM(item_code)) = UPPER(TRIM(?))`,
        [activeASN, normalizedASN, activeSession, targetCartonId, matchedItemCode]
      );

      const currentScannedQty = currentScannedQtyResult?.total_qty || 0;
      const asnQty = expectedItem.shipped_qty || 0;
      const remainingQty = asnQty - currentScannedQty;

      if (remainingQty <= 0) {
        Alert.alert(
          "ASN Quantity Exceeded",
          `Cannot scan more items.\n\n` +
            `ASN Quantity: ${asnQty}\n` +
            `Already Scanned: ${currentScannedQty}\n\n` +
            `All ${asnQty} units of ${matchedItemCode} have already been scanned for carton ${targetCartonId}.`
        );
        setLoading(false);
        return;
      }

      logStateChange("ITEM_SCANNED", {
        item: matchedItemCode,
        carton: targetCartonId,
      });
      setCurrentItemWithLog(matchedItemCode);
      // Set lockedCarton to targetCartonId so handleBoxScan can work properly
      if (targetCartonId !== lockedCarton) {
        setLockedCartonWithLog(targetCartonId);
      }
      setWorkflowStateWithLog("SCAN_BOX");
      setLoading(false);
    } catch (error: any) {
      console.error("❌ Error processing item scan:", error);
      Alert.alert("Error", error.message || "Failed to process item scan");
      setLoading(false);
    }
  };

  const handleBoxScan = async (barcode: string) => {
    if (!activeASN || !activeSession) {
      console.warn("⚠️ handleBoxScan: Missing required state", {
        activeASN,
        activeSession,
      });
      return;
    }
    if (!(await requireOnlineForReceiving())) return;

    const boxId = barcode.trim().toUpperCase();
    setLoading(true);

    try {
      if (typeof getDatabase !== "function") {
        throw new Error(
          "getDatabase is not a function. Please restart the app."
        );
      }

      const scannedItem = await resolveItemFromBarcode(barcode);
      if (scannedItem) {
        Alert.alert(
          "Wrong Scan Type",
          `You scanned an item code (${scannedItem.item_code}), but you need to scan a BOX barcode.\n\nPlease scan a valid BOX barcode.`
        );
        setLoading(false);
        return;
      }

      // Validate box exists and is active from Box Management
      const boxes = await dataService.getBoxes(activeASN);
      let box = boxes.find((b) => b.box_id === boxId);
      if (!box) {
        box = boxes.find(
          (b) =>
            String(b.box_id || "").trim().toUpperCase() === boxId
        );
      }
      if (!box) {
        // Reload boxes list
        await loadAvailableBoxes();
        Alert.alert(
          "BOX Not Found",
          `BOX "${boxId}" not found.\n\nPlease scan a valid BOX barcode or create a new BOX.`
        );
        setLoading(false);
        return;
      }

      const canonicalBoxId = String(box.box_id || "").trim();

      if (
        box.status !== "Open" &&
        box.status !== "OPEN" &&
        box.status !== "open"
      ) {
        Alert.alert(
          "BOX Not Active",
          `BOX "${canonicalBoxId}" is not active.\n\nCurrent status: ${box.status}\n\nPlease use an active (Open) BOX.`
        );
        setLoading(false);
        return;
      }

      if (!currentItem || !lockedCarton) {
        Alert.alert(
          "Scan Item First",
          "Please scan an item first, then scan the destination BOX."
        );
        setLoading(false);
        return;
      }

      await processItemScanWithBox(currentItem, canonicalBoxId);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to sort item");
    } finally {
      setLoading(false);
    }
  };

  // Lines where sorted qty ≠ shipped (under- or over-scan). Same basis as Finish Carton.
  const incompleteItems = useMemo(() => {
    return cartonItems.filter((item) => {
      const scannedRaw = scannedQtyLookup(
        scannedQuantities,
        item.item_code
      );
      const sc = Number(scannedRaw);
      const sh = Number(item.shipped_qty);
      const scannedNum = Number.isFinite(sc) ? sc : 0;
      const shippedNum = Number.isFinite(sh) ? sh : 0;
      return scannedNum !== shippedNum;
    });
  }, [cartonItems, scannedQuantities]);

  const shortageItems = useMemo(() => {
    return cartonItems
      .map((item) => {
        const scannedRaw = scannedQtyLookup(scannedQuantities, item.item_code);
        const scannedQty = Number.isFinite(Number(scannedRaw))
          ? Number(scannedRaw)
          : 0;
        const shippedQty = Number.isFinite(Number(item.shipped_qty))
          ? Number(item.shipped_qty)
          : 0;
        return {
          item_code: item.item_code,
          shipped_qty: shippedQty,
          scanned_qty: scannedQty,
          short_qty: Math.max(shippedQty - scannedQty, 0),
        };
      })
      .filter((item) => item.short_qty > 0);
  }, [cartonItems, scannedQuantities]);

  const overageItems = useMemo(() => {
    return cartonItems
      .map((item) => {
        const scannedRaw = scannedQtyLookup(scannedQuantities, item.item_code);
        const scannedQty = Number.isFinite(Number(scannedRaw))
          ? Number(scannedRaw)
          : 0;
        const shippedQty = Number.isFinite(Number(item.shipped_qty))
          ? Number(item.shipped_qty)
          : 0;
        return {
          item_code: item.item_code,
          shipped_qty: shippedQty,
          scanned_qty: scannedQty,
          over_qty: Math.max(scannedQty - shippedQty, 0),
        };
      })
      .filter((item) => item.over_qty > 0);
  }, [cartonItems, scannedQuantities]);

  const areAllItemsReceived = useMemo(() => {
    if (!lockedCarton || cartonItems.length === 0) return false;
    return incompleteItems.length === 0;
  }, [lockedCarton, cartonItems.length, incompleteItems]);

  const canFinishCarton = useMemo(() => {
    if (!lockedCarton || cartonItems.length === 0) return false;
    return overageItems.length === 0;
  }, [lockedCarton, cartonItems.length, overageItems.length]);

  const boxesFilteredForCreator = useMemo(() => {
    if (!onlyMySortBoxes) return availableBoxes;
    if (!sortBoxUser.user_id && !sortBoxUser.user_code) return availableBoxes;
    return availableBoxes.filter((box) =>
      settingsMatchUnloadedActor(
        sortBoxUser,
        createdByFromApiBox(box as unknown as Record<string, unknown>) ||
          (box as any).created_by
      )
    );
  }, [availableBoxes, onlyMySortBoxes, sortBoxUser]);

  // Check if current item is fully scanned
  const isCurrentItemComplete = useMemo(() => {
    if (!currentItem) return false;
    const cartonItem = cartonItems.find(
      (item) => item.item_code === currentItem
    );
    if (!cartonItem) return false;
    const scannedQty = scannedQtyLookup(scannedQuantities, currentItem);
    return scannedQty >= cartonItem.shipped_qty;
  }, [currentItem, cartonItems, scannedQuantities]);

  // Filter boxes to only show boxes from stores where current item has remaining allocations
  useEffect(() => {
    const filterBoxesByAllocation = async () => {
      // If no current item or item is complete, show empty list
      if (
        !currentItem ||
        !activeASN ||
        isCurrentItemComplete ||
        availableBoxes.length === 0
      ) {
        setFilteredAvailableBoxes([]);
        return;
      }

      try {
        const settingsForBox = await getSettings();
        const boxIdentity = {
          user_id: settingsForBox.user_id
            ? String(settingsForBox.user_id).trim()
            : undefined,
          user_code: settingsForBox.user_code
            ? String(settingsForBox.user_code).trim()
            : undefined,
        };
        const applyMyBoxesOnly = (list: any[]) => {
          if (!onlyMySortBoxesRef.current) return list;
          if (!boxIdentity.user_id && !boxIdentity.user_code) return list;
          return list.filter((box) =>
            settingsMatchUnloadedActor(
              boxIdentity,
              createdByFromApiBox(box as unknown as Record<string, unknown>) ||
                (box as any).created_by
            )
          );
        };
        // Get all allocations for the current item
        // Use original ASN format (allocations are stored with original format)
        const allAllocations = await dataService.getTransferOrderAllocations(
          activeASN
        );
        const itemAllocations = allAllocations.filter((a) =>
          String(a.item_code).trim().toUpperCase() ===
          String(currentItem).trim().toUpperCase()
        );

        // If no allocations, check if there are Putaway boxes (PAW-*) or warehouse boxes (for putaway items)
        if (itemAllocations.length === 0) {
          // PRIORITY 1: Putaway boxes (PAW-*) - these are specifically for putaway items
          const putawayBoxes = availableBoxes.filter((box) => {
            // Exclude boxes with null/undefined/empty box_id
            if (!box.box_id || box.box_id === "" || box.box_id === null) {
              return false;
            }
            // Exclude closed boxes
            if (
              box.status === "Closed" ||
              box.status === "CLOSED" ||
              box.status === "closed"
            ) {
              return false;
            }
            // Check if it's a Putaway box (by purpose or box_id prefix)
            const isPutawayBox =
              box.purpose === "PUTAWAY" || box.box_id.startsWith("PAW-");
            const boxStore = String(box.store).trim().toUpperCase();
            const isWarehouseStore =
              boxStore === "WAREHOUSE" || boxStore.startsWith("WH-");
            return isPutawayBox && isWarehouseStore && box.status === "Open";
          });

          if (putawayBoxes.length > 0) {
            // Show Putaway boxes first (priority)
            console.log(
              `📦 No allocations for ${currentItem}, showing ${putawayBoxes.length} Putaway box(es) (PAW-*)`
            );
            setFilteredAvailableBoxes(applyMyBoxesOnly(putawayBoxes));
            return;
          }

          // PRIORITY 2: Regular warehouse boxes (BOX-WHMAIN-*) - only if no Putaway boxes exist
          const warehouseBoxes = availableBoxes.filter((box) => {
            // Exclude boxes with null/undefined/empty box_id
            if (!box.box_id || box.box_id === "" || box.box_id === null) {
              return false;
            }
            // Exclude closed boxes
            if (
              box.status === "Closed" ||
              box.status === "CLOSED" ||
              box.status === "closed"
            ) {
              return false;
            }
            // Exclude Putaway boxes (already checked above)
            const isPutawayBox =
              box.purpose === "PUTAWAY" || box.box_id.startsWith("PAW-");
            if (isPutawayBox) {
              return false; // Skip Putaway boxes here
            }
            const boxStore = String(box.store).trim().toUpperCase();
            return (
              (boxStore === "WAREHOUSE" || boxStore.startsWith("WH-")) &&
              box.status === "Open"
            );
          });

          if (warehouseBoxes.length > 0) {
            // Show regular warehouse boxes as fallback (only if no Putaway boxes)
            console.log(
              `📦 No allocations for ${currentItem}, showing ${warehouseBoxes.length} regular warehouse box(es) (no Putaway boxes available)`
            );
            setFilteredAvailableBoxes(applyMyBoxesOnly(warehouseBoxes));
            return;
          } else {
            // No allocations and no warehouse/Putaway boxes
            setFilteredAvailableBoxes(applyMyBoxesOnly([]));
            return;
          }
        }

        // Calculate scanned quantities per store for the current item (compact store key
        // so TO "004-Alras" and scanned_items.store "004ALRAS" share one bucket)
        const scannedByStore: Record<string, number> = {};
        scannedItems
          .filter(
            (si) =>
              String(si.item_code).trim().toUpperCase() ===
              String(currentItem).trim().toUpperCase()
          )
          .forEach((si) => {
            const k = compactStoreCodeKey(si.store);
            scannedByStore[k] = (scannedByStore[k] || 0) + 1;
          });

        // Get stores with remaining allocations
        const storesWithRemainingAllocation = itemAllocations
          .filter((alloc) => {
            const scannedQty =
              scannedByStore[compactStoreCodeKey(alloc.store)] || 0;
            return scannedQty < alloc.allocated_qty;
          })
          .map((alloc) => alloc.store);

        // Filter boxes to only show boxes from stores with remaining allocations
        // For warehouse stores: Prioritize Putaway boxes (PAW-*) over regular warehouse boxes (BOX-WHMAIN-*)
        // IMPORTANT: Filter out boxes with null/undefined box_id to prevent React key errors
        const filtered = availableBoxes.filter((box) => {
          // First, exclude boxes with null/undefined/empty box_id
          if (!box.box_id || box.box_id === "" || box.box_id === null) {
            return false;
          }
          // Exclude closed boxes
          if (
            box.status === "Closed" ||
            box.status === "CLOSED" ||
            box.status === "closed"
          ) {
            return false;
          }

          const boxStore = String(box.store).trim().toUpperCase();
          const isWarehouse =
            boxStore === "WAREHOUSE" || boxStore.startsWith("WH-");
          const hasRemainingAllocation = storesWithRemainingAllocation.some(
            (allocStore) => storeCodesMatchForTO(allocStore, box.store)
          );

          // Include boxes from stores with remaining allocations
          if (hasRemainingAllocation) {
            return true;
          }

          // For warehouse stores: Only include Putaway boxes (PAW-*), not regular warehouse boxes
          // This prevents conflicts where items go to BOX-WHMAIN instead of PAW-*
          if (isWarehouse) {
            const isPutawayBox =
              box.purpose === "PUTAWAY" || box.box_id.startsWith("PAW-");
            return isPutawayBox; // Only show Putaway boxes for warehouse stores
          }

          return false;
        });

        console.log("📦 Filtered boxes for ReceiveSort:", {
          totalBoxes: availableBoxes.length,
          filteredCount: filtered.length,
          warehouseBoxes: filtered.filter(
            (b) => String(b.store).trim().toUpperCase() === "WAREHOUSE"
          ).length,
          storeBoxes: filtered.filter(
            (b) => String(b.store).trim().toUpperCase() !== "WAREHOUSE"
          ).length,
          storesWithAllocation: storesWithRemainingAllocation,
        });

        setFilteredAvailableBoxes(applyMyBoxesOnly(filtered));
      } catch (error) {
        console.error("Error filtering boxes by allocation:", error);
        // Fallback: filter out null box_ids even on error
        const fallbackBoxes = availableBoxes.filter(
          (box) =>
            box.box_id &&
            box.box_id !== "" &&
            box.box_id !== null &&
            box.status !== "Closed" &&
            box.status !== "CLOSED" &&
            box.status !== "closed"
        );
        const settingsForBox = await getSettings();
        const boxIdentity = {
          user_id: settingsForBox.user_id
            ? String(settingsForBox.user_id).trim()
            : undefined,
          user_code: settingsForBox.user_code
            ? String(settingsForBox.user_code).trim()
            : undefined,
        };
        const applyMyBoxesOnly = (list: any[]) => {
          if (!onlyMySortBoxesRef.current) return list;
          if (!boxIdentity.user_id && !boxIdentity.user_code) return list;
          return list.filter((box) =>
            settingsMatchUnloadedActor(
              boxIdentity,
              createdByFromApiBox(box as unknown as Record<string, unknown>) ||
                (box as any).created_by
            )
          );
        };
        setFilteredAvailableBoxes(applyMyBoxesOnly(fallbackBoxes));
      }
    };

    filterBoxesByAllocation();
  }, [
    currentItem,
    activeASN,
    availableBoxes,
    scannedItems,
    isCurrentItemComplete,
    onlyMySortBoxes,
  ]);

  // Check if all items in the carton have been received
  // Track TO allocations by item for completion check
  const [toAllocationsByItem, setToAllocationsByItem] = useState<
    Map<string, number>
  >(new Map());

  // Load TO allocations when ASN or carton changes
  useEffect(() => {
    const loadTOAllocations = async () => {
      if (!activeASN || !lockedCarton) {
        setToAllocationsByItem(new Map());
        setTransferOrderAllocations([]);
        return;
      }

      try {
        let allocations = await dataService.getTransferOrderAllocations(
          activeASN
        );
        try {
          const liveResponse = await apiService.getLiveTransferOrderByASN(
            activeASN,
            {
              inbound_session: activeSession || undefined,
              include_completed: true,
            }
          );
          const liveData = liveResponse?.data || liveResponse;
          const liveItems = Array.isArray(liveData?.items) ? liveData.items : [];
          if (liveItems.length > 0) {
            allocations = liveItems.map((item: any) => ({
              to_no: liveData?.to_no || item?.to_no || null,
              asn_no: activeASN,
              store: item?.store,
              item_code: item?.item_code,
              allocated_qty:
                Number(item?.allocated_qty ?? item?.to_qty ?? item?.qty) || 0,
            }));
          }
        } catch (liveError: any) {
          console.warn(
            `⚠️ Live TO allocation fetch failed, using local cache:`,
            liveError?.message || liveError
          );
        }
        setTransferOrderAllocations(allocations);

        // Group allocations by item_code and sum allocated quantities
        const allocationsMap = new Map<string, number>();
        for (const alloc of allocations) {
          const currentQty = allocationsMap.get(alloc.item_code) || 0;
          allocationsMap.set(
            alloc.item_code,
            currentQty + (alloc.allocated_qty || 0)
          );
        }

        setToAllocationsByItem(allocationsMap);
        console.warn(
          `📊 Loaded TO allocations for ${allocationsMap.size} items`
        );
      } catch (error: any) {
        console.warn(`⚠️ Error loading TO allocations:`, error.message);
        setToAllocationsByItem(new Map());
      setTransferOrderAllocations([]);
      }
    };

    loadTOAllocations();
  }, [activeASN, activeSession, lockedCarton]);

  // Ensure workflow state is SCAN_ITEM when carton is locked but no currentItem
  // This fixes the issue where saved state might have SCAN_BOX but no currentItem
  useEffect(() => {
    if (lockedCarton && !currentItem && workflowState !== "SCAN_ITEM") {
      console.log(
        `🔄 Fixing workflow state: Carton ${lockedCarton} is locked but no currentItem, setting to SCAN_ITEM`
      );
      setWorkflowStateWithLog("SCAN_ITEM");
    }
  }, [lockedCarton, currentItem, workflowState]);

  useEffect(() => {
    if (
      lockedCarton &&
      (workflowState === "SCAN_ITEM" || workflowState === "SCAN_BOX") &&
      !showCTNIdPrompt
    ) {
      refocusScanner();
    }
  }, [lockedCarton, workflowState, currentItem, showCTNIdPrompt, refocusScanner]);

  useFocusEffect(
    useCallback(() => {
      if (
        lockedCarton &&
        (workflowState === "SCAN_ITEM" || workflowState === "SCAN_BOX") &&
        !showCTNIdPrompt
      ) {
        refocusScanner();
      }
    }, [lockedCarton, workflowState, showCTNIdPrompt, refocusScanner])
  );

  // When supplier carton (lock) changes, resync from DB — same rules as refreshScannedStateFromDb (per-carton UI)
  useEffect(() => {
    void refreshScannedStateFromDb();

    // Also reload total scanned quantities across all cartons/boxes
    const reloadTotalScannedQuantities = async () => {
      if (!activeASN || !activeSession) {
        return;
      }

      try {
        const db = await getDatabase();
        const normalizedASN = normalizeASN(activeASN);

        // Get total scanned quantities from database (sum scanned_qty by item_code across ALL cartons/boxes)
        // Try both ASN formats to ensure we get all items
        let scannedItemsFromDB = await db.getAllAsync<{
          item_code: string;
          scanned_qty: number;
        }>(
          `SELECT item_code, SUM(scanned_qty) as scanned_qty 
             FROM scanned_items 
           WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ?
             GROUP BY item_code`,
          [activeASN, normalizedASN, activeSession]
        );

        // Convert to map
        const quantitiesMap: Record<string, number> = {};
        scannedItemsFromDB.forEach((item) => {
          quantitiesMap[item.item_code] = item.scanned_qty || 0;
        });

        // Update state if values changed
        const currentTotal = Object.values(totalScannedQuantities).reduce(
          (sum, qty) => sum + (qty || 0),
          0
        );
        const dbTotal = Object.values(quantitiesMap).reduce(
          (sum, qty) => sum + (qty || 0),
          0
        );

        if (currentTotal !== dbTotal) {
          console.warn(
            `🔄 Reloading TOTAL scanned quantities from database (all cartons/boxes):`,
            {
              currentTotal,
              dbTotal,
              quantitiesMap,
            }
          );
          setTotalScannedQuantities(quantitiesMap);
        }
      } catch (error: any) {
        console.warn(
          `⚠️ Error reloading total scanned quantities:`,
          error.message
        );
      }
    };

    reloadTotalScannedQuantities();
  }, [activeASN, activeSession, lockedCarton, refreshScannedStateFromDb]);

  // Calculate summary totals for display
  // Use database values for accuracy (handles manual quantity entry correctly)
  const [summaryTotals, setSummaryTotals] = useState({
    totalASNQty: 0,
    totalScannedQty: 0,
    totalTOAllocatedQty: 0,
    totalRemainingForPutaway: 0,
    toAllocatedScanned: 0,
    toAllocatedRemaining: 0,
  });

  /** Same basis as the orange TO card line: ASN remaining minus TO scan still owed (not-in-TO putaway). */
  const putawayItemsNotInTO = useMemo(() => {
    const {
      totalRemainingForPutaway,
      toAllocatedRemaining,
      totalTOAllocatedQty,
    } = summaryTotals;
    if (totalTOAllocatedQty > 0) {
      return Math.max(0, totalRemainingForPutaway - toAllocatedRemaining);
    }
    return totalRemainingForPutaway;
  }, [summaryTotals]);

  // Calculate summary totals from database (async)
  useEffect(() => {
    const calculateSummaryTotals = async () => {
      if (!activeASN || !activeSession || !lockedCarton) {
        setSummaryTotals({
          totalASNQty: 0,
          totalScannedQty: 0,
          totalTOAllocatedQty: 0,
          totalRemainingForPutaway: 0,
          toAllocatedScanned: 0,
          toAllocatedRemaining: 0,
        });
        return;
      }

      try {
        const db = await getDatabase();
        const normalizedASN = normalizeASN(activeASN);

        // ✅ PERMANENT FIX: Calculate ASN Qty from ALL cartons in the ASN (not just current carton)
        // Get all carton items for this ASN from asn_carton_map
        const allASNItems = await db.getAllAsync<{
          item_code: string;
          shipped_qty: number;
        }>(
          `SELECT item_code, SUM(shipped_qty) as shipped_qty
           FROM asn_carton_map
           WHERE (asn_no = ? OR asn_no = ?)
           GROUP BY item_code`,
          [activeASN, normalizedASN]
        );
        
        // Calculate total ASN Qty across ALL cartons
        const totalASNQty = allASNItems.reduce(
          (sum, item) => sum + (item.shipped_qty || 0),
          0
        );

        // ✅ PERMANENT FIX: Get scanned quantities from ALL cartons (not just current carton)
        // Count ALL scanned items for this ASN/session, excluding Putaway boxes
        // Putaway items shouldn't count towards "Scanned" - they're remaining items
        let scannedItemsFromDB = await db.getAllAsync<{
          item_code: string;
          scanned_qty: number;
        }>(
          `SELECT item_code, SUM(scanned_qty) as scanned_qty 
           FROM scanned_items 
           WHERE (asn_no = ? OR asn_no = ?)
             AND inbound_session = ?
             AND (box_id NOT LIKE 'PAW-%' OR box_id IS NULL)
           GROUP BY item_code`,
          [activeASN, normalizedASN, activeSession]
        );

        // Calculate total scanned qty (only store boxes, not Putaway)
        let totalScannedQty = scannedItemsFromDB.reduce(
          (sum, item) => sum + (item.scanned_qty || 0),
          0
        );
        // ✅ Use backend received qty when available (after backend update / refresh)
        if (backendReceivedByItem && Object.keys(backendReceivedByItem).length > 0) {
          totalScannedQty = Object.values(backendReceivedByItem).reduce(
            (sum, qty) => sum + (qty || 0),
            0
          );
        }
        
        // ✅ Remaining = ASN Qty - Scanned (store boxes only)
        // Putaway items are part of "remaining", not "scanned"
        const totalRemainingForPutaway = totalASNQty - totalScannedQty;

        // Get TO allocations
        const allocations = await dataService.getTransferOrderAllocations(
          activeASN
        );
        const totalTOAllocatedQty = allocations.reduce(
          (sum, alloc) => sum + (alloc.allocated_qty || 0),
          0
        );

        // Get boxes to find store for each scanned item
        const boxes = await dataService.getBoxes(activeASN);
        const boxStoreMap = new Map(boxes.map((b) => [b.box_id, b.store]));

        // ✅ PERMANENT FIX: Calculate TO allocated scanned across ALL cartons (not just current)
        // Get all scanned items with store info, excluding Putaway boxes
        // TO items must be scanned to store boxes, not Putaway boxes
        let scannedItemsWithStore = await db.getAllAsync<{
          item_code: string;
          box_id: string | null;
          store: string | null;
          scanned_qty: number;
        }>(
          `SELECT item_code, box_id, store, scanned_qty 
           FROM scanned_items 
           WHERE (asn_no = ? OR asn_no = ?)
             AND inbound_session = ?
             AND (box_id NOT LIKE 'PAW-%' OR box_id IS NULL)`,
          [activeASN, normalizedASN, activeSession]
        );

        const itemKeyNorm = (c: string | null | undefined) =>
          String(c ?? "").trim().toUpperCase();

        // item_code (normalized) -> set of compact store keys for TO lines
        const itemAllocatedStores = new Map<string, Set<string>>();
        allocations.forEach((alloc) => {
          const ik = itemKeyNorm(alloc.item_code);
          if (!ik) return;
          if (!itemAllocatedStores.has(ik)) {
            itemAllocatedStores.set(ik, new Set());
          }
          itemAllocatedStores
            .get(ik)!
            .add(compactStoreCodeKey(alloc.store));
        });

        // Sum scanned quantities for items that are allocated to TO
        let toAllocatedScanned = 0;
        // ✅ When backend received qty is available, use it for TO allocated scanned
        if (backendReceivedByItem && Object.keys(backendReceivedByItem).length > 0) {
          allocations.forEach((alloc) => {
            const ik = itemKeyNorm(alloc.item_code);
            const recv =
              backendReceivedByItem[alloc.item_code] ??
              backendReceivedByItem[ik] ??
              0;
            toAllocatedScanned += Math.min(recv, alloc.allocated_qty || 0);
          });
        } else {
          scannedItemsWithStore.forEach((item) => {
            const itemCode = item.item_code;
            const ik = itemKeyNorm(itemCode);
            const allocatedStores = itemAllocatedStores.get(ik);

            if (allocatedStores && allocatedStores.size > 0) {
              const boxStore = item.box_id ? boxStoreMap.get(item.box_id) : null;
              const itemStoreRaw = item.store || boxStore || "";
              const itemStoreCompact = compactStoreCodeKey(itemStoreRaw);

              if (itemStoreCompact && allocatedStores.has(itemStoreCompact)) {
                const allocation = allocations.find(
                  (a) =>
                    itemCodesMatchForAllocation(a.item_code, itemCode) &&
                    storeCodesMatchForTO(a.store, itemStoreRaw)
                );
                if (allocation) {
                  toAllocatedScanned += Math.min(
                    item.scanned_qty || 0,
                    allocation.allocated_qty || 0
                  );
                }
              }
            }
          });
        }

        const toAllocatedRemaining = totalTOAllocatedQty - toAllocatedScanned;

        setSummaryTotals({
          totalASNQty,
          totalScannedQty,
          totalTOAllocatedQty,
          totalRemainingForPutaway,
          toAllocatedScanned,
          toAllocatedRemaining,
        });
      } catch (error: any) {
        console.warn(`⚠️ Error calculating summary totals:`, error.message);
        // Fallback to state-based calculation
        const totalASNQty = cartonItems.reduce(
          (sum, item) => sum + (item.shipped_qty || 0),
          0
        );
        const totalScannedQty = Object.values(scannedQuantities).reduce(
          (sum, qty) => sum + (qty || 0),
          0
        );
        const totalTOAllocatedQty = Array.from(
          toAllocationsByItem.values()
        ).reduce((sum, qty) => sum + qty, 0);
        const totalRemainingForPutaway = totalASNQty - totalScannedQty;
        const toAllocatedScanned = Array.from(
          toAllocationsByItem.entries()
        ).reduce((sum, [itemCode, allocatedQty]) => {
          const scannedQty = scannedQuantities[itemCode] || 0;
          return sum + Math.min(scannedQty, allocatedQty);
        }, 0);
        const toAllocatedRemaining = totalTOAllocatedQty - toAllocatedScanned;

        setSummaryTotals({
          totalASNQty,
          totalScannedQty,
          totalTOAllocatedQty,
          totalRemainingForPutaway,
          toAllocatedScanned,
          toAllocatedRemaining,
        });
      }
    };

    calculateSummaryTotals();
  }, [
    activeASN,
    activeSession,
    lockedCarton,
    cartonItems,
    scannedQuantities,
    toAllocationsByItem,
    backendReceivedByItem,
  ]);

  // Load TO stores and calculate remaining items for Create CTN modal
  const loadTOStoresForCTN = async () => {
    if (!activeASN) {
      setToStoresForCTN([]);
      setRemainingItemsQty(0);
      return;
    }

    try {
      // Get TO allocations
      const allocations = await dataService.getTransferOrderAllocations(
        activeASN
      );

      // Get unique stores from TO (filter out warehouses)
      const uniqueStores = Array.from(
        new Set(allocations.map((a) => a.store).filter((s) => s))
      ).filter((storeCode: string) => {
        const storeCodeUpper = String(storeCode).toUpperCase().trim();
        // Filter out warehouses
        if (
          storeCodeUpper === "WAREHOUSE" ||
          storeCodeUpper.startsWith("WH-")
        ) {
          return false;
        }
        // Check warehouse_type from master data
        if (warehousesAndStores.length > 0) {
          const storeInfo = warehousesAndStores.find(
            (ws: any) =>
              String(ws.code || "")
                .toUpperCase()
                .trim() === storeCodeUpper
          );
          if (storeInfo?.warehouse_type === "Warehouse") {
            return false;
          }
        }
        return true;
      });

      setToStoresForCTN(uniqueStores.sort());

      // Calculate remaining items: Total Shipped - Total TO Allocated
      const totalShipped = cartonItems.reduce(
        (sum, item) => sum + (item.shipped_qty || 0),
        0
      );
      const totalTOAllocated = allocations.reduce(
        (sum, alloc) => sum + (alloc.allocated_qty || 0),
        0
      );
      const remaining = Math.max(0, totalShipped - totalTOAllocated);

      setRemainingItemsQty(remaining);

      console.log(`📦 TO Stores for CTN: ${uniqueStores.length} stores`);
      console.log(
        `📦 Remaining items (Total Shipped ${totalShipped} - TO Allocated ${totalTOAllocated}): ${remaining}`
      );
    } catch (error: any) {
      console.warn(`⚠️ Error loading TO stores for CTN:`, error.message);
      setToStoresForCTN([]);
      setRemainingItemsQty(0);
    }
  };

  // Create CTN (Box) for a specific store
  const handleCreateCTNForStore = async (store: string) => {
    if (!activeASN || !activeSession) {
      Alert.alert("Error", "No active ASN or session");
      return;
    }

    setCreatingCTNForStore(store);
    setLoading(true);

    try {
      const settings = await getSettings();
      // Get TO number from allocations
      const allocations = await dataService.getTransferOrderAllocations(
        activeASN
      );
      const toNo = allocations.length > 0 ? allocations[0].to_no : null;

      const response = await apiService.createBox({
        asn_no: activeASN,
        to_no: toNo || undefined,
        store: store,
        purpose: "STORE",
        user_id: settings.user_id,
      });

      const boxId =
        response.box_id ||
        response.data?.box_id ||
        response.id ||
        response.data?.id;

      if (!boxId) {
        Alert.alert("Error", "Server did not return a box ID");
        setLoading(false);
        setCreatingCTNForStore(null);
        return;
      }

      try {
        await dataService.saveBox({
          box_id: boxId,
          asn_no: String(activeASN),
          to_no: toNo ?? "",
          store: String(store).trim(),
          status: "Open",
          purpose: "STORE",
          updated_on: new Date().toISOString(),
          created_by: createdByFromSettings(settings) || null,
        });
      } catch (localErr: unknown) {
        console.warn(
          "Could not save Distribution CTN to local box_cache:",
          localErr
        );
      }

      setShowCreateCTNModal(false);
      loadAvailableBoxes();
    } catch (error: any) {
      Alert.alert(
        "Error",
        error.message || "Failed to create Distribution CTN"
      );
    } finally {
      setLoading(false);
      setCreatingCTNForStore(null);
    }
  };

  // Create Putaway BOX for remaining items
  const handleCreatePutawayBOX = async () => {
    if (!activeASN || !activeSession) {
      Alert.alert("Error", "No active ASN or session");
      return;
    }

    if (remainingItemsQty <= 0) {
      Alert.alert("Info", "No remaining items for Putaway");
      return;
    }

    setLoading(true);

    try {
      const db = await getDatabase();
      if (!db) {
        Alert.alert("Error", "Database not available");
        setLoading(false);
        return;
      }

      const settings = await getSettings();
      const normalizedASN = normalizeASN(activeASN);

      // Generate Putaway BOX ID
      const timestamp = Date.now();
      const putawayBoxId = `PAW-${activeASN.replace(
        /[^A-Z0-9]/g,
        ""
      )}-${timestamp}`;

      // Determine warehouse store code
      const warehouseStores = await db.getAllAsync<{ code: string }>(
        `SELECT code FROM warehouse_store_cache WHERE warehouse_type = 'Warehouse' LIMIT 1`
      );
      const warehouseStore =
        warehouseStores.length > 0 ? warehouseStores[0].code : "WH-MAIN";

      // Create Putaway BOX (no TO for putaway)
      const putawayBox = {
        box_id: putawayBoxId,
        asn_no: activeASN,
        to_no: "",
        store: warehouseStore,
        status: "Open",
        purpose: "PUTAWAY" as const,
        updated_on: new Date().toISOString(),
        created_by: createdByFromSettings(settings) || null,
      };

      await dataService.saveBox(putawayBox);

      setShowCreateCTNModal(false);
      loadAvailableBoxes();
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to create Putaway BOX");
    } finally {
      setLoading(false);
    }
  };

  const handleFinishCarton = async () => {
    if (!activeASN || !activeSession || !lockedCarton) return;
    if (!(await requireOnlineForReceiving())) return;

    if (overageItems.length > 0) {
      Alert.alert(
        "Over Quantity Found",
        overageItems
          .map(
            (item) =>
              `${item.item_code}: shipped ${item.shipped_qty}, scanned ${item.scanned_qty}, over ${item.over_qty}`
          )
          .join("\n") +
          "\n\nOver quantity cannot be finished from mobile. Please correct the scan quantity or raise an overage approval.",
        [{ text: "OK" }]
      );
      return;
    }

    // NEW WORKFLOW: Check for remaining items (not allocated to TO) and force BOX creation for Putaway
    const settings = await getSettings();
    const normalizedASN = normalizeASN(activeASN);

    // Get remaining items that need putaway
    const remainingItems = await dataService.getRemainingItems(activeASN);
    const itemsNeedingPutaway = remainingItems.filter(
      (item) => (item.remaining_qty || 0) > 0
    );

    // Check if there are items in this carton that need putaway (not allocated to TO)
    const scannedItemsFromDB = await dataService.getScannedItems(
      normalizedASN,
      activeSession,
      lockedCarton
    );

    // Get TO allocations to identify which items are NOT in TO
    const allAllocations = await dataService.getTransferOrderAllocations(
      activeASN
    );
    const allocatedItemCodes = new Set(allAllocations.map((a) => a.item_code));

    // Get boxes to check if items are already in Putaway boxes
    const boxes = await dataService.getBoxes(activeASN);
    const putawayBoxIds = new Set(
      boxes
        .filter(
          (b) =>
            b.purpose === "PUTAWAY" || (b.box_id && b.box_id.startsWith("PAW-"))
        )
        .map((b) => b.box_id)
    );

    // Also check event_queue for SORT_TO_BOX events to Putaway boxes (items might be sorted but box_id not yet updated)
    const db = await getDatabase();
    const putawayEvents = await db.getAllAsync<{
      item_code: string;
      box_id: string;
    }>(
      `SELECT DISTINCT item_code, box_id 
       FROM event_queue 
       WHERE asn_no = ? AND inbound_session = ? AND carton_id = ? 
       AND event_type = 'SORT_TO_BOX' 
       AND (box_id LIKE 'PAW-%' OR box_id IN (SELECT box_id FROM box_cache WHERE purpose = 'PUTAWAY'))`,
      [normalizedASN, activeSession, lockedCarton]
    );
    // Create a set of item codes that have been sorted to Putaway boxes
    const itemsSortedToPutaway = new Set(putawayEvents.map((e) => e.item_code));

    // Find items in this carton that are NOT allocated to any TO AND not already in a Putaway box
    type ScannedItemRow = { item_code: string; box_id: string | null; store: string | null; carton_id?: string | null; scanned_qty: number };
    const unallocatedItemsInCarton = (scannedItemsFromDB as ScannedItemRow[]).filter((item: ScannedItemRow) => {
      const itemCode = item.item_code;
      const isAllocated = allocatedItemCodes.has(itemCode);

      // Check if item is already in a Putaway box (check box_id in scanned_items)
      const isInPutawayBox =
        item.box_id &&
        (putawayBoxIds.has(item.box_id) || item.box_id.startsWith("PAW-"));

      // Also check if item has been sorted to a Putaway box (via events)
      const isSortedToPutaway = itemsSortedToPutaway.has(itemCode);

      // If already in Putaway box or sorted to Putaway box, exclude it
      if (isInPutawayBox || isSortedToPutaway) {
        return false;
      }

      // Only include items that are NOT allocated to TO
      // Items scanned to warehouse stores without TO allocation need Putaway
      // If item is allocated to TO, it should NOT be included (even if scanned to warehouse)
      if (isAllocated) {
        return false; // Item is allocated to TO, exclude it
      }

      // Item is not allocated to TO - check if it needs Putaway
      const isWarehouse =
        item.store &&
        (item.store.toUpperCase() === "WAREHOUSE" ||
          item.store.toUpperCase().startsWith("WH-"));

      // Include only if: not allocated to TO AND (scanned to warehouse OR no store specified)
      return isWarehouse || !item.store;
    });

    if (unallocatedItemsInCarton.length > 0) {
      // Force user to create BOX for Putaway
      const totalUnallocatedQty = unallocatedItemsInCarton.reduce(
        (sum, item) => sum + (item.scanned_qty || 0),
        0
      );

      Alert.alert(
        "Create Putaway Box Required",
        `You have ${totalUnallocatedQty} item(s) that are not allocated to any Transfer Order.\n\nThese items need to go to Putaway.\n\nPlease create a BOX for Putaway before finishing this carton.`,
        [
          { text: "Cancel", style: "cancel" as const },
          {
            text: "Create Putaway Box",
            onPress: async () => {
              // Navigate to Box Management to create Putaway box
              // Or create it automatically
              try {
                const db = await getDatabase();
                if (!db) {
                  Alert.alert("Error", "Database not available");
                  return;
                }

                // Generate BOX ID for Putaway (will also be used as TC ID)
                // Format: PAW-{ASN}-{TIMESTAMP} (different abbreviation from normal BOX-{STORE}-{TIMESTAMP})
                const timestamp = Date.now();
                const putawayBoxId = `PAW-${activeASN.replace(
                  /[^A-Z0-9]/g,
                  ""
                )}-${timestamp}`;

                // Determine warehouse store code
                const warehouseStores = await db.getAllAsync<{ code: string }>(
                  `SELECT code FROM warehouse_store_cache WHERE warehouse_type = 'Warehouse' LIMIT 1`
                );
                const warehouseStore =
                  warehouseStores.length > 0
                    ? warehouseStores[0].code
                    : "WH-MAIN";

                // Create BOX for Putaway (no TO for putaway items)
                const putawayBox = {
                  box_id: putawayBoxId,
                  asn_no: activeASN,
                  to_no: "",
                  store: warehouseStore,
                  status: "Open",
                  purpose: "PUTAWAY" as const,
                  updated_on: new Date().toISOString(),
                };

                await dataService.saveBox(putawayBox);

                // Move unallocated items to Putaway box
                for (const item of unallocatedItemsInCarton as ScannedItemRow[]) {
                  // Use the actual carton_id from the item record (not lockedCarton)
                  // This ensures the correct carton is associated with the SORT_TO_BOX event
                  const itemCartonId = item.carton_id || lockedCarton;

                  // Update scanned_items to point to Putaway box
                  await db.runAsync(
                    `UPDATE scanned_items 
                     SET box_id = ?, store = ? 
                     WHERE asn_no = ? AND inbound_session = ? AND carton_id = ? AND item_code = ? AND (box_id IS NULL OR box_id = '')`,
                    [
                      putawayBoxId,
                      warehouseStore,
                      normalizedASN,
                      activeSession,
                      itemCartonId,
                      item.item_code,
                    ]
                  );

                  // Create SORT_TO_BOX event for putaway box
                  // Use the actual carton_id from the item to ensure backend shows correct carton
                  await addEvent({
                    event_type: "SORT_TO_BOX",
                    asn_no: normalizedASN,
                    inbound_session: activeSession,
                    carton_id: itemCartonId, // Use item's actual carton_id
                    item_code: item.item_code,
                    box_id: putawayBoxId,
                    store: warehouseStore,
                    qty: item.scanned_qty || 0,
                    device_id: settings.device_id,
                    user_id: settings.user_id,
                  });
                }

                Alert.alert(
                  "Putaway Box Created",
                  `Putaway Box ${putawayBoxId} created successfully.\n\n${unallocatedItemsInCarton.length} item(s) moved to Putaway box.\n\nYou can now finish the carton.`,
                  [
                    {
                      text: "OK",
                      onPress: () => {
                        // Continue with carton finishing
                        handleFinishCartonInternal(
                          shortageItems.length > 0 ? "SHORTAGE" : "NORMAL"
                        );
                      },
                    },
                  ]
                );
              } catch (error: any) {
                console.error("❌ Error creating Putaway box:", error);
                Alert.alert(
                  "Error",
                  `Failed to create Putaway box: ${error.message}`
                );
                setLoading(false);
              }
            },
          },
        ]
      );
      return;
    }

    if (shortageItems.length > 0) {
      Alert.alert(
        "Finish With Shortage?",
        `This carton has short quantity:\n\n${shortageItems
          .map(
            (item) =>
              `${item.item_code}: shipped ${item.shipped_qty}, scanned ${item.scanned_qty}, short ${item.short_qty}`
          )
          .join("\n")}\n\nThis will close the carton as "${RECEIVED_WITH_SHORTAGE_STATUS}" and send the shortage to the backend receive lines.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Finish With Shortage",
            style: "destructive",
            onPress: () => handleFinishCartonInternal("SHORTAGE"),
          },
        ]
      );
      return;
    }

    // No remaining items - proceed normally
    handleFinishCartonInternal("NORMAL");
  };

  const handleFinishCartonInternal = async (
    finishMode: "NORMAL" | "SHORTAGE" = "NORMAL"
  ) => {
    if (!activeASN || !activeSession || !lockedCarton) return;

    setLoading(true);
    try {
      const settings = await getSettings();
      const normalizedASN = normalizeASN(activeASN);

      // Get scanned items from database to build receive lines
      const scannedItemsFromDB = await dataService.getScannedItems(
        normalizedASN,
        activeSession,
        lockedCarton
      );

      // Build receive lines from scanned items
      // Group by item_code (backend expects carton_id, not box_id)
      // All items for this carton will use the lockedCarton as carton_id
      const receiveLinesMap = new Map<
        string,
        {
          item_code: string;
          expected_qty: number;
          received_qty: number;
        }
      >();

      // Build a map of expected quantities by item_code (from cartonItems)
      const expectedQtyByItem = new Map<string, number>();
      for (const cartonItem of cartonItems) {
        expectedQtyByItem.set(
          cartonItem.item_code,
          cartonItem.shipped_qty || 0
        );
      }

      // Group scanned items by item_code and aggregate quantities
      for (const scannedItem of scannedItemsFromDB as { item_code: string; scanned_qty?: number }[]) {
        const itemCode = scannedItem.item_code;
        const qty = scannedItem.scanned_qty || 0;

        if (!itemCode) {
          console.warn(`⚠️ Skipping scanned item with missing item_code`);
          continue;
        }

        const expectedQty = expectedQtyByItem.get(itemCode) || 0;

        if (receiveLinesMap.has(itemCode)) {
          const line = receiveLinesMap.get(itemCode)!;
          line.received_qty += qty;
        } else {
          receiveLinesMap.set(itemCode, {
            item_code: itemCode,
            expected_qty: expectedQty,
            received_qty: qty,
          });
        }
      }

      // Include every carton item (full state). Items not in scanned list get received_qty 0
      // so backend gets correct Recvd Qty for all items (e.g. 108228, 108230) and can UPSERT.
      for (const cartonItem of cartonItems) {
        const itemCode = cartonItem.item_code;
        if (!itemCode) continue;
        if (receiveLinesMap.has(itemCode)) continue;
        const expectedQty = expectedQtyByItem.get(itemCode) ?? 0;
        receiveLinesMap.set(itemCode, {
          item_code: itemCode,
          expected_qty: expectedQty,
          received_qty: 0,
        });
      }

      // Convert map to array - use lockedCarton as carton_id (backend requirement)
      // According to PDF section 12.5, parent_title should be inside each receive_line object
      const receiveLines = Array.from(receiveLinesMap.values()).map((line) => ({
        parent_title: activeSession, // Session ID - must be inside each receive_line per PDF spec
        carton_id: lockedCarton, // Backend expects carton_id
        item_code: line.item_code,
        expected_qty: line.expected_qty,
        received_qty: line.received_qty,
        condition:
          finishMode === "SHORTAGE" && line.received_qty < line.expected_qty
            ? "Short"
            : ("Good" as const),
        remarks:
          finishMode === "SHORTAGE" && line.received_qty < line.expected_qty
            ? `Short received from mobile. Expected ${line.expected_qty}, received ${line.received_qty}, shortage ${line.expected_qty - line.received_qty}.`
            : (null as string | null),
      }));

      console.log(`📦 Building receive lines for carton ${lockedCarton}:`, {
        totalLines: receiveLines.length,
        lines: receiveLines.map(
          (l) => `${l.item_code}: ${l.received_qty}/${l.expected_qty}`
        ),
      });

      // Call batch receive lines API only if there are scanned items
      // ✅ CRITICAL: Backend expects parent_title (inbound_session) at TOP level to associate
      // receive_lines with the correct ASN/session. Backend must UPSERT by (session, carton_id, item_code)
      // and SET received_qty (not ADD) so resend/sync does not double-count.
      if (receiveLines.length > 0) {
        try {
          await apiService.createReceiveLines({
            parent_title: activeSession, // ✅ REQUIRED: Session ID so backend applies to correct ASN
            receive_lines: receiveLines,
          });
          console.log(`✅ Receive lines created for carton ${lockedCarton} (parent_title=${activeSession})`);
          // ✅ Get updated received qty from backend so summary matches desktop
          await refreshASNReceivedQtyFromBackend();
        } catch (receiveLinesError: any) {
          console.warn(
            `⚠️ Failed to create receive lines for carton ${lockedCarton}:`,
            receiveLinesError.message
          );
          setLoading(false);
          Alert.alert(
            "Receive Lines Not Updated",
            `The server did not accept receive lines for carton ${lockedCarton}.\n\nMobile will not mark this carton as Received until the backend is updated.\n\n${receiveLinesError?.message || "Unknown error"}`
          );
          return;
        }
      } else {
        console.warn(
          `⚠️ No scanned items found for carton ${lockedCarton}. Skipping receive lines creation.`
        );
        Alert.alert(
          "No Items Scanned",
          `No items were scanned for carton ${lockedCarton}.\n\nMobile will not mark this carton as Received because no receive lines can be sent to the backend.`,
          [{ text: "OK" }]
        );
        setLoading(false);
        return;
      }

      if (finishMode === "NORMAL") {
        await apiService.completeCarton({
          inbound_session: activeSession,
          asn_no: normalizedASN,
          carton_id: lockedCarton,
          user_id: settings.user_id!,
          device_id: settings.device_id!,
        });
      }

      const completedStatus =
        finishMode === "SHORTAGE" ? RECEIVED_WITH_SHORTAGE_STATUS : "Received";

      console.log(`💾 Updating carton status to ${completedStatus} (server first, then local):`, {
        carton: lockedCarton,
        asn: normalizedASN,
        session: activeSession,
        status: completedStatus,
      });

      const pushReceived = await pushReceivedCartonStatusServerThenLocal({
        asnNoOriginal: activeASN,
        inboundSession: activeSession,
        cartonId: lockedCarton,
        userId: settings.user_id!,
        deviceId: settings.device_id,
        status: completedStatus,
      });
      if (!pushReceived.ok) {
        setLoading(false);
        Alert.alert(
          pushReceived.kind === "network"
            ? "Server connection lost"
            : "Cannot update carton status",
          pushReceived.message
        );
        return;
      }

      // Immediately verify the update was saved
      const verifyStatus = await dataService.getCartonStatus(
        normalizedASN,
        activeSession,
        lockedCarton
      );
      console.log(`✅ Carton ${lockedCarton} status updated. Verification:`, {
        status: verifyStatus?.status,
        session: verifyStatus?.inbound_session,
        locked_by: verifyStatus?.locked_by,
        updated_on: verifyStatus?.updated_on,
        match:
          verifyStatus?.status === completedStatus &&
          verifyStatus?.inbound_session === activeSession,
      });

      if (!verifyStatus || verifyStatus.status !== completedStatus) {
        console.error(
          `❌ ERROR: Status update failed! Expected '${completedStatus}', got:`,
          verifyStatus
        );
        Alert.alert(
          "Warning",
          `Status update may have failed. Please check the carton status manually.`
        );
      }

      // Update session status - increment completed cartons
      try {
        const allStatuses = await dataService.getAllCartonStatuses(
          normalizedASN,
          activeSession
        );
        const totalCartons = allStatuses.length;
        const completedCartons = allStatuses.filter(
          (s) => isCompletedCartonStatus(s.status)
        ).length;

        // Update session with new completed cartons count
        const allCartonsCompleted = completedCartons === totalCartons;
        await dataService.updateInboundSessionStatus(
          activeSession,
          allCartonsCompleted ? "Completed" : "Active",
          completedCartons,
          totalCartons
        );

        console.log(`📊 Updated session status:`, {
          inbound_session: activeSession,
          completed_cartons: completedCartons,
          total_cartons: totalCartons,
          status: allCartonsCompleted ? "Completed" : "Active",
        });

        // Note: Putaway task creation for remaining items is now handled after successful sync
        // This ensures all data is synced to backend before creating tasks
        // See: src/services/event-queue.service.ts - checkAndCreatePutawayTasksAfterSync()

        // Sync session to backend - add small delay to ensure database write completes
        await new Promise((resolve) => setTimeout(resolve, 100));

        const { syncSessionToBackend } = await import(
          "../services/session-sync.service"
        );
        try {
          await syncSessionToBackend(activeSession);
          console.log("✅ Session synced to backend after carton completion", {
            completed_cartons: completedCartons,
            total_cartons: totalCartons,
          });
        } catch (syncError: any) {
          console.warn(
            "⚠️ Failed to sync session to backend:",
            syncError.message
          );
          // Don't block user flow if sync fails
        }
      } catch (sessionError: any) {
        console.warn(
          "⚠️ Failed to update session status:",
          sessionError.message
        );
        // Don't block user flow if session update fails
      }

      const finishedCarton = lockedCarton;
      logStateChange("FINISH_CARTON", {
        carton: finishedCarton,
        scannedItemsCount: scannedItems.length,
        scannedQuantitiesKeys: Object.keys(scannedQuantities),
      });
      setLockedCartonWithLog(null);
      setWorkflowStateWithLog("SELECT_CARTON");
      setScannedItemsWithLog([]);
      setScannedQuantitiesWithLog({});
      setCurrentItemWithLog(null);
      cartonLoadSeqRef.current += 1;
      setCartonLinesLoading(false);
      setCartonLinesLoadError(null);
      setCartonItemsWithLog([]); // Clear carton items when finishing
      setLastScannedItem(null);

      if (activeASN && activeSession) {
        await clearWorkflowState(
          normalizedASN,
          activeSession,
          "ReceiveSort"
        );
        console.log(
          `🧹 Cleared saved workflow state after completing carton: ${finishedCarton}`
        );
      }

      await loadAvailableCartons();

      const updatedStatus = await dataService.getCartonStatus(
        normalizedASN,
        activeSession,
        finishedCarton
      );
      console.log(
        `✅ Verified carton ${finishedCarton} status after completion:`,
        {
          status: updatedStatus?.status,
          locked_by: updatedStatus?.locked_by,
          updated_on: updatedStatus?.updated_on,
        }
      );

      // State will be saved automatically via useEffect
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to complete carton");
    } finally {
      setLoading(false);
    }
  };

  const getScannerTitle = () => {
    switch (workflowState) {
      case "SELECT_CARTON":
        return "Scan Supplier Carton";
      case "SCAN_ITEM":
        return "Scan Item from Carton";
      case "SCAN_BOX":
        return "Scan Destination BOX";
      default:
        return "Scan";
    }
  };

  const getScannerPlaceholder = () => {
    switch (workflowState) {
      case "SELECT_CARTON":
        return "Scan carton barcode";
      case "SCAN_ITEM":
        return "Scan item barcode";
      case "SCAN_BOX":
        return "Scan BOX barcode";
      default:
        return "Scan barcode";
    }
  };

  const handleScan = async (barcode: string) => {
    switch (workflowState) {
      case "SELECT_CARTON":
        handleCartonScan(barcode);
        break;
      case "SCAN_ITEM":
        // In SCAN_ITEM mode, we expect an item barcode
        // If user scans a BOX ID, show error - they need to scan item first
        const scannedValue = barcode.trim().toUpperCase();

        if (
          lockedCarton &&
          scannedValue === String(lockedCarton).trim().toUpperCase()
        ) {
          Alert.alert(
            "Wrong scan",
            "You scanned this carton's barcode. Scan an item barcode or item code from the carton contents, not the supplier carton id."
          );
          return;
        }

        // Check if user mistakenly scanned a BOX ID instead of item code
        const isBoxBarcode =
          scannedValue.startsWith("BOX-") ||
          scannedValue.startsWith("PAW-") ||
          scannedValue.startsWith("TC-");

        // Check if user mistakenly scanned a Carton ID instead of item code
        const isCartonId = scannedValue.startsWith("CTN-");

        if (isBoxBarcode) {
          // User scanned a BOX ID when expecting item code
          Alert.alert(
            "Wrong Scan Type",
            `You scanned a BOX ID ("${scannedValue}"), but an item code is required.\n\n` +
              `Please scan the item barcode/item code first, then scan the BOX barcode.\n\n` +
              `Flow: Scan Item → Enter CTN → Scan Box`
          );
          return;
        } else if (isCartonId) {
          // User scanned a Carton ID when expecting item code
          Alert.alert(
            "Wrong Scan Type",
            `You scanned a Carton ID ("${scannedValue}"), but an item code is required.\n\n` +
              `Please scan the item barcode/item code first.\n\n` +
              `The system will prompt you for the Carton ID after you scan the item.`
          );
          return;
        } else {
          // It's an item barcode - handle as item scan
          handleItemScan(barcode);
        }
        break;
      case "SCAN_BOX":
        handleBoxScan(barcode);
        break;
    }
  };

  const handleQuickCreateBox = async () => {
    if (!activeASN) {
      Alert.alert("Error", "No active ASN");
      return;
    }

    setLoading(true);
    try {
      const settings = await getSettings();
      const response = await apiService.createBox({
        asn_no: activeASN,
        to_no: "TO-00012",
        store: selectedStoreForBox,
        purpose: "STORE", // Per PDF section 12.6
        user_id: settings.user_id, // Per PDF section 12.6
      });

      console.log("📦 createBox API response:", response);

      // Handle nested response structure: { data: { box_id: "..." } } or { box_id: "..." }
      const boxId =
        response.box_id ||
        response.data?.box_id ||
        response.id ||
        response.data?.id;

      if (!boxId) {
        console.error("❌ No box_id in API response:", response);
        Alert.alert(
          "Error",
          "Server did not return a box ID. Please check backend logs."
        );
        setLoading(false);
        return;
      }

      // Normalize store value to ensure consistency
      const normalizedStore = String(selectedStoreForBox).trim().toUpperCase();

      const newBox: any = {
        box_id: boxId,
        asn_no: activeASN,
        to_no: "TO-00012",
        store: normalizedStore, // Use normalized store value
        status: "Open",
        purpose: "STORE", // Explicitly set purpose
        updated_on: new Date().toISOString(),
        created_by: createdByFromSettings(settings) || null,
      };

      console.log("💾 Creating box in ReceiveSortScreen:", newBox);

      await dataService.saveBox(newBox);
      await loadAvailableBoxes();
      setShowCreateBox(false);
    } catch (error: any) {
      console.error("❌ Failed to create box:", error);
      Alert.alert("Error", error.message || "Failed to create BOX");
    } finally {
      setLoading(false);
    }
  };

  const handleItemDetailsClick = async (itemCode: string) => {
    if (!activeASN || !activeSession) return;

    const db = await getDatabase();
    const normalizedASN = normalizeASN(activeASN);

    // Scanned qty for modal — same supplier carton scope as Expected Items list
    const scannedQtyCartonFilter = lockedCarton
      ? "AND UPPER(TRIM(IFNULL(carton_id,''))) = UPPER(TRIM(?))"
      : "AND (carton_id IS NULL OR TRIM(COALESCE(carton_id, '')) = '')";
    const scannedQtyCartonParams = lockedCarton
      ? [activeASN, normalizedASN, activeSession, String(lockedCarton).trim(), itemCode]
      : [activeASN, normalizedASN, activeSession, itemCode];

    const scannedQtyResult = await db.getFirstAsync<{ total_qty: number }>(
      `SELECT COALESCE(SUM(scanned_qty), 0) as total_qty 
       FROM scanned_items 
       WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ? ${scannedQtyCartonFilter} AND item_code = ?`,
      scannedQtyCartonParams
    );
    const scannedQty = scannedQtyResult?.total_qty || 0;

    // Get all TO allocations for this ASN
    const allocations = await dataService.getTransferOrderAllocations(
      activeASN
    );

    // Find allocations for this item (may be multiple stores)
    const itemAllocations = allocations.filter((a) =>
      itemCodesMatchForAllocation(a.item_code, itemCode)
    );

    // Calculate total TO quantity across all stores
    const totalTOQty = itemAllocations.reduce(
      (sum, alloc) => sum + (alloc.allocated_qty || 0),
      0
    );

    // Get ASN quantity for this item (from carton items)
    const cartonItem = cartonItems.find((ci) => ci.item_code === itemCode);
    const asnQty = cartonItem?.shipped_qty || 0;

    // Get all boxes for this ASN to show boxes for each store
    const boxes = await dataService.getBoxes(activeASN);
    const boxStoreMap = new Map(boxes.map((b) => [b.box_id, b.store]));

    const cartonFilter = lockedCarton
      ? "AND UPPER(TRIM(IFNULL(carton_id,''))) = UPPER(TRIM(?))"
      : "AND (carton_id IS NULL OR TRIM(COALESCE(carton_id, '')) = '')";
    const cartonParams = lockedCarton
      ? [activeASN, normalizedASN, activeSession, String(lockedCarton).trim(), itemCode]
      : [activeASN, normalizedASN, activeSession, itemCode];

    const scannedQtyByStore = await db.getAllAsync<{
      store: string;
      scanned_qty: number;
      box_id: string;
    }>(
      `SELECT store, scanned_qty, box_id 
       FROM scanned_items 
       WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ? ${cartonFilter} AND item_code = ?`,
      cartonParams
    );

    // Separate Putaway boxes from regular boxes
    const putawayBoxIds = new Set(
      boxes
        .filter(
          (b) =>
            b.purpose === "PUTAWAY" || (b.box_id && b.box_id.startsWith("PAW-"))
        )
        .map((b) => b.box_id)
    );

    // Calculate Putaway Qty: sum of scanned quantities in Putaway boxes
    const putawayQty = scannedQtyByStore.reduce((sum, row) => {
      if (row.box_id && putawayBoxIds.has(row.box_id)) {
        return sum + (row.scanned_qty || 0);
      }
      return sum;
    }, 0);

    // Calculate remaining: ASN Qty - Total Scanned (includes both TO and Putaway)
    // This ensures remaining won't be negative when Putaway items are included
    const remainingQty = asnQty - scannedQty;

    // Build store-to-boxes map using compact store keys so "002 Unaizah 2" and "002-UNAIZAH-2" share one bucket
    const storeBoxMap = new Map<string, string[]>();
    const boxListForStore = (storeLabel: string) => {
      const k = compactStoreCodeKey(storeLabel);
      if (!k) return null;
      if (!storeBoxMap.has(k)) {
        storeBoxMap.set(k, []);
      }
      return storeBoxMap.get(k)!;
    };

    boxes.forEach((box) => {
      if (box.store && box.box_id) {
        const list = boxListForStore(box.store);
        if (list && !list.includes(box.box_id)) list.push(box.box_id);
      }
    });

    scannedQtyByStore.forEach((row) => {
      if (row.store && row.box_id) {
        const list = boxListForStore(row.store);
        if (list && !list.includes(row.box_id)) list.push(row.box_id);
      }
    });

    const scannedQtyMap = new Map<string, number>();
    scannedQtyByStore.forEach((row) => {
      const k = compactStoreCodeKey(row.store || "");
      if (!k) return;
      scannedQtyMap.set(k, (scannedQtyMap.get(k) || 0) + (row.scanned_qty || 0));
    });

    // Build allocation details - separate TO allocations from Putaway
    // Note: putawayBoxIds is already declared above and can be reused here
    const allocationDetails = itemAllocations
      .map((alloc) => {
        const storeKey = compactStoreCodeKey(alloc.store);

        // Separate boxes into TO boxes and Putaway boxes
        const allStoreBoxes = storeBoxMap.get(storeKey) || [];
        const toBoxes = allStoreBoxes.filter(
          (boxId) => !putawayBoxIds.has(boxId)
        );
        const putawayBoxes = allStoreBoxes.filter((boxId) =>
          putawayBoxIds.has(boxId)
        );

        // Get scanned quantities: separate TO-allocated vs Putaway
        // TO-allocated: items in non-Putaway boxes
        // Putaway: items in Putaway boxes
        let toScanned = 0;
        let putawayScanned = 0;

        scannedQtyByStore.forEach((row) => {
          const rk = compactStoreCodeKey(row.store || "");
          if (rk === storeKey && row.box_id) {
            if (putawayBoxIds.has(row.box_id)) {
              putawayScanned += row.scanned_qty || 0;
            } else {
              toScanned += row.scanned_qty || 0;
            }
          }
        });

        const au = alloc.store.trim().toUpperCase();
        const isWarehouse =
          au === "WAREHOUSE" || au.startsWith("WH-");

        if (isWarehouse && (putawayScanned > 0 || putawayBoxes.length > 0)) {
          // Create two separate entries: TO Allocation and Putaway
          const result: any[] = [];

          // TO Allocation entry (if there are TO-allocated items or boxes)
          if (toScanned > 0 || toBoxes.length > 0 || alloc.allocated_qty > 0) {
            result.push({
              store: `${alloc.store} - TO`,
              allocatedQty: alloc.allocated_qty,
              scannedQty: toScanned,
              boxes: toBoxes,
            });
          }

          // Putaway entry
          result.push({
            store: `${alloc.store} - Putaway`,
            allocatedQty: 0, // No TO allocation for Putaway
            scannedQty: putawayScanned,
            boxes: putawayBoxes,
          });

          return result;
        } else {
          // Regular store (not warehouse) - show all boxes together
          const storeScanned = scannedQtyMap.get(storeKey) || 0;
          return {
            store: alloc.store,
            allocatedQty: alloc.allocated_qty,
            scannedQty: storeScanned,
            boxes: allStoreBoxes,
          };
        }
      })
      .flat(); // Flatten array in case warehouse stores return multiple entries

    // Also add warehouse/Putaway allocation if there are scanned items to warehouse but no TO allocation
    // Check if there are scanned items to warehouse stores (WH-MAIN, WAREHOUSE, etc.)
    const warehouseStores = new Set<string>();
    scannedQtyByStore.forEach((row) => {
      const storeUpper = (row.store || "").trim().toUpperCase();
      if (storeUpper === "WAREHOUSE" || storeUpper.startsWith("WH-")) {
        warehouseStores.add(storeUpper);
      }
    });

    // For each warehouse store with scanned items, add an allocation entry if not already present
    warehouseStores.forEach((warehouseStore) => {
      // Check if this warehouse store already has an allocation entry
      const hasAllocation = itemAllocations.some((alloc) =>
        storeCodesMatchForTO(alloc.store, warehouseStore)
      );

      if (!hasAllocation) {
        // Separate Putaway vs regular items
        let putawayScanned = 0;
        let regularScanned = 0;
        const putawayBoxes: string[] = [];
        const regularBoxes: string[] = [];

        scannedQtyByStore.forEach((row) => {
          const rowStoreUpper = (row.store || "").trim().toUpperCase();
          if (rowStoreUpper === warehouseStore && row.box_id) {
            if (putawayBoxIds.has(row.box_id)) {
              putawayScanned += row.scanned_qty || 0;
              if (!putawayBoxes.includes(row.box_id)) {
                putawayBoxes.push(row.box_id);
              }
            } else {
              regularScanned += row.scanned_qty || 0;
              if (!regularBoxes.includes(row.box_id)) {
                regularBoxes.push(row.box_id);
              }
            }
          }
        });

        // Get all boxes for this warehouse store
        const allWarehouseBoxes = storeBoxMap.get(warehouseStore) || [];
        allWarehouseBoxes.forEach((boxId) => {
          if (putawayBoxIds.has(boxId) && !putawayBoxes.includes(boxId)) {
            putawayBoxes.push(boxId);
          } else if (
            !putawayBoxIds.has(boxId) &&
            !regularBoxes.includes(boxId)
          ) {
            regularBoxes.push(boxId);
          }
        });

        // Find the actual store name (not normalized) from boxes or scanned items
        const actualStoreName =
          boxes.find(
            (b) => b.store && b.store.trim().toUpperCase() === warehouseStore
          )?.store ||
          scannedQtyByStore.find(
            (r) => r.store && r.store.trim().toUpperCase() === warehouseStore
          )?.store ||
          warehouseStore;

        // Only add Putaway entry if there are Putaway items/boxes
        if (putawayScanned > 0 || putawayBoxes.length > 0) {
          allocationDetails.push({
            store: `${actualStoreName} - Putaway`,
            allocatedQty: 0, // No TO allocation for Putaway
            scannedQty: putawayScanned,
            boxes: putawayBoxes,
          });
        }

        // Only add regular warehouse entry if there are regular items/boxes
        if (regularScanned > 0 || regularBoxes.length > 0) {
          allocationDetails.push({
            store: `${actualStoreName} - TO`,
            allocatedQty: 0, // No TO allocation
            scannedQty: regularScanned,
            boxes: regularBoxes,
          });
        }
      }
    });

    setItemDetailsModal({
      visible: true,
      itemCode,
      scannedQty,
      totalTOQty,
      putawayQty, // Add Putaway Qty to modal data
      remainingQty,
      asnQty, // Add ASN Qty to modal data
      allocations: allocationDetails,
    });
  };

  // Handle TO breakdown button click
  const handleTOBreakdownClick = async (itemCode: string) => {
    if (!activeASN || !activeSession) return;

    // Close modal first to ensure fresh data is loaded
    setToBreakdownModal(null);

    // Small delay to ensure modal closes before reopening with fresh data
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      const db = await getDatabase();
      const normalizedASN = normalizeASN(activeASN);

      console.log(
        `🔄 TO Breakdown: Reloading fresh data for ${itemCode}, ASN: ${activeASN}, normalized: ${normalizedASN}`
      );

      // Get all TO allocations for this ASN
      const allocations = await dataService.getTransferOrderAllocations(
        activeASN
      );

      // Find allocations for this item (ERP / SQLite may differ in case or type)
      const itemAllocations = allocations.filter((a) =>
        itemCodesMatchForAllocation(a.item_code, itemCode)
      );

      // Get boxes to find store for each scanned item
      const boxes = await dataService.getBoxes(activeASN);
      const boxStoreMap = new Map(boxes.map((b) => [b.box_id, b.store]));

      // Get scanned quantities from database (more accurate than scannedItems array)
      // Since we now support BOX ID workflow (carton_id = null), we need to query by item_code
      // regardless of carton_id, then group by store from box_id
      let scannedItemsFromDB: {
        box_id: string | null;
        store: string | null;
        scanned_qty: number;
      }[] = [];

      // Query for scanned items - handle both old workflow (with carton_id) and new workflow (carton_id = null)
      // Since we now support BOX ID workflow where carton_id is NULL, we need to query ALL scanned items
      // for this item_code regardless of carton_id, then group by store from box_id AND by carton_id

      // Query all scanned items for this item_code (regardless of carton_id), including carton_id for grouping
      // Try both ASN formats to ensure we get all items
      scannedItemsFromDB = await db.getAllAsync<{
        box_id: string | null;
        store: string | null;
        carton_id: string | null;
        scanned_qty: number;
      }>(
        `SELECT box_id, store, carton_id, scanned_qty 
           FROM scanned_items 
         WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ? 
           AND UPPER(TRIM(item_code)) = UPPER(TRIM(?))`,
        [activeASN, normalizedASN, activeSession, itemCode]
      );

      console.log(
        `📊 TO Breakdown: Found ${scannedItemsFromDB.length} scanned item record(s) for item ${itemCode} (including items with carton_id = NULL from BOX ID workflow)`
      );
      type ScannedItemWithCarton = { box_id: string | null; store: string | null; carton_id?: string | null; scanned_qty: number };
      const scannedWithCarton = scannedItemsFromDB as ScannedItemWithCarton[];
      console.log(
        `📊 TO Breakdown: Scanned items details:`,
        scannedWithCarton.map((si) => ({
          box_id: si.box_id,
          store: si.store,
          carton_id: si.carton_id,
          scanned_qty: si.scanned_qty,
        }))
      );

      // Calculate total scanned by carton
      const scannedByCarton = new Map<string, number>();
      scannedWithCarton.forEach((si) => {
        const cartonId = si.carton_id || "No Carton";
        const current = scannedByCarton.get(cartonId) || 0;
        scannedByCarton.set(cartonId, current + (si.scanned_qty || 0));
      });

      console.log(`📦 Scanned by Carton:`, Object.fromEntries(scannedByCarton));
      console.log(`📦 Box Store Map:`, Object.fromEntries(boxStoreMap));

      // Calculate total scanned across ALL scanned items (for comparison with Expected Items)
      const totalScannedFromDB = scannedWithCarton.reduce(
        (sum, si) => sum + (si.scanned_qty || 0),
        0
      );
      console.warn(
        `📊 TO Breakdown: Total scanned from DB for ${itemCode} = ${totalScannedFromDB} (across all stores/cartons)`
      );

      // Build breakdown by store (with carton breakdown info)
      const breakdown: {
        store: string;
        toQty: number;
        scannedQty: number;
        remainingQty: number;
        scannedByCarton?: Map<string, number>; // Add carton breakdown per store
      }[] = [];

      if (itemAllocations.length > 0) {
        // Has TO allocations - show breakdown by store
        itemAllocations.forEach((alloc) => {
          // Filter scanned items for this store
          const storeScannedItems = scannedWithCarton.filter((si) => {
            // Get store from box_id if available, otherwise use store from scanned_items
            const boxStore = si.box_id ? boxStoreMap.get(si.box_id) : null;
            const itemStore = si.store || boxStore;
            const matches = storeCodesMatchForTO(alloc.store, itemStore || "");
            if (!matches && si.scanned_qty > 0) {
              console.warn(
                `⚠️ TO Breakdown: Store mismatch for ${itemCode} - alloc.store="${alloc.store}", itemStore="${si.store}", boxStore="${boxStore}", box_id="${si.box_id}", scanned_qty=${si.scanned_qty}`
              );
            }

            return matches;
          });

          console.warn(
            `📊 TO Breakdown: Store ${alloc.store} - Found ${
              storeScannedItems.length
            } scanned item record(s) for item ${itemCode}, total scanned=${storeScannedItems.reduce(
              (sum, si) => sum + (si.scanned_qty || 0),
              0
            )}`
          );

          // Sum scanned quantities for this store
          const storeScanned = storeScannedItems.reduce(
            (sum, si) => sum + (si.scanned_qty || 0),
            0
          );

          // Calculate scanned by carton for this store
          const scannedByCartonForStore = new Map<string, number>();
          storeScannedItems.forEach((si) => {
            const cartonId = si.carton_id || "No Carton";
            const current = scannedByCartonForStore.get(cartonId) || 0;
            scannedByCartonForStore.set(
              cartonId,
              current + (si.scanned_qty || 0)
            );
          });

          breakdown.push({
            store: alloc.store,
            toQty: alloc.allocated_qty || 0,
            scannedQty: storeScanned,
            remainingQty: (alloc.allocated_qty || 0) - storeScanned,
            scannedByCarton: scannedByCartonForStore,
          });
        });

      } else {
        // No TO - show warehouse name
        // Get warehouse from available warehouses/stores or use default
        const warehouse =
          warehousesAndStores.find(
            (w) => w.type === "Warehouse" || w.location_type === "Warehouse"
          )?.name ||
          warehousesAndStores.find((w) =>
            w.name?.toUpperCase().includes("WAREHOUSE")
          )?.name ||
          "WAREHOUSE";

        // Sum total scanned quantity from database
        const totalScanned = scannedItemsFromDB.reduce(
          (sum, si) => sum + (si.scanned_qty || 0),
          0
        );

        // Calculate scanned by carton for warehouse
        const scannedByCartonForWarehouse = new Map<string, number>();
        (scannedItemsFromDB as { carton_id?: string | null; scanned_qty?: number }[]).forEach((si) => {
          const cartonId = si.carton_id || "No Carton";
          const current = scannedByCartonForWarehouse.get(cartonId) || 0;
          scannedByCartonForWarehouse.set(
            cartonId,
            current + (si.scanned_qty || 0)
          );
        });

        breakdown.push({
          store: warehouse,
          toQty: 0, // No TO allocation
          scannedQty: totalScanned,
          remainingQty: 0,
          scannedByCarton: scannedByCartonForWarehouse,
        });
      }

      type UnmatchedRow = {
        box_id: string | null;
        store: string | null;
        carton_id: string | null;
        scanned_qty: number;
      };

      const unmatchedFromTo =
        itemAllocations.length > 0
          ? (() => {
              const totalInBreakdown = breakdown.reduce(
                (sum, b) => sum + b.scannedQty,
                0
              );
              const unmatched = totalScannedFromDB - totalInBreakdown;
              if (unmatched <= 0) {
                return {
                  unmatchedScanned: 0,
                  unmatchedItems: undefined as UnmatchedRow[] | undefined,
                };
              }
              console.warn(
                `⚠️ TO Breakdown: Found ${unmatched} scanned unit(s) for ${itemCode} not attributed to a TO store line (total=${totalScannedFromDB}, in breakdown=${totalInBreakdown}).`
              );
              const items: UnmatchedRow[] = scannedWithCarton
                .filter((si) => {
                  const boxStore = si.box_id ? boxStoreMap.get(si.box_id) : null;
                  const itemStore = si.store || boxStore;
                  return !itemAllocations.some((alloc) =>
                    storeCodesMatchForTO(alloc.store, itemStore || "")
                  );
                })
                .map((si) => ({
                  box_id: si.box_id,
                  store: si.store,
                  carton_id: si.carton_id ?? null,
                  scanned_qty: si.scanned_qty || 0,
                }));
              if (items.length > 0) {
                console.warn(`⚠️ Unmatched scanned rows:`, items);
              }
              return {
                unmatchedScanned: unmatched,
                unmatchedItems: items.length > 0 ? items : undefined,
              };
            })()
          : { unmatchedScanned: 0, unmatchedItems: undefined };

      setToBreakdownModal({
        visible: true,
        itemCode,
        breakdown,
        scannedByCarton:
          itemAllocations.length > 0 ? scannedByCarton : new Map(),
        totalScanned: totalScannedFromDB,
        unmatchedScanned: unmatchedFromTo.unmatchedScanned,
        unmatchedItems: unmatchedFromTo.unmatchedItems,
      });
    } catch (error: any) {
      console.error("❌ Error loading TO breakdown:", error);
      Alert.alert("Error", `Failed to load TO breakdown: ${error.message}`);
    }
  };

  // Handle edit scanned quantity for a specific store
  const handleEditScannedQty = (
    itemCode: string,
    store: string,
    allocatedQty: number,
    currentScannedQty: number
  ) => {
    console.warn(`✏️ Edit button clicked for ${itemCode} in ${store}:`, {
      itemCode,
      store,
      allocatedQty,
      currentScannedQty,
    });

    // Extract actual store name from display format (remove " - TO" or " - Putaway" suffix)
    // Display format: "WH-MAIN - TO" or "WH-MAIN - Putaway"
    // Actual store: "WH-MAIN"
    const actualStore = store.replace(/\s*-\s*(TO|Putaway)$/i, "").trim();

    // Detect if this is for Putaway (not TO)
    const isPutaway = /putaway$/i.test(store);

    console.warn(
      `📦 Extracted actual store: "${actualStore}" from display store: "${store}", isPutaway: ${isPutaway}`
    );

    // Close the item details modal first to avoid modal conflicts
    setItemDetailsModal(null);

    // Small delay to ensure the first modal closes before opening the edit modal
    setTimeout(() => {
      setEditQtyModal({
        visible: true,
        itemCode,
        store: actualStore, // Use actual store name, not display format
        allocatedQty,
        currentScannedQty,
        isPutaway: isPutaway, // Store flag to indicate if this is for Putaway
      });
      setEditQtyValue(currentScannedQty.toString());
      console.warn(
        `✅ Edit modal state set, visible should be true, store: ${actualStore}, isPutaway: ${isPutaway}`
      );
    }, 100);
  };

  // Handle save edited quantity
  const handleSaveEditedQty = async () => {
    if (!editQtyModal || !activeASN || !activeSession) return;

    const newQty = parseInt(editQtyValue, 10);
    if (isNaN(newQty) || newQty < 0) {
      Alert.alert("Error", "Please enter a valid quantity (0 or greater)");
      return;
    }

    // Validate against ASN quantity first (hard limit)
    const cartonItem = cartonItems.find(
      (ci) => ci.item_code === editQtyModal.itemCode
    );
    const asnQty = cartonItem?.shipped_qty || 0;

    if (asnQty > 0 && newQty > asnQty) {
      Alert.alert(
        "ASN Quantity Exceeded",
        `Cannot set scanned quantity to ${newQty}.\n\n` +
          `ASN Quantity: ${asnQty}\n\n` +
          `Please enter a quantity of ${asnQty} or less.\n\n` +
          `Note: You can reduce the quantity if it was over-scanned.`
      );
      return;
    }

    // Allow reducing over-scanned quantities, but warn if setting above allocated
    if (newQty > editQtyModal.allocatedQty && editQtyModal.allocatedQty > 0) {
      Alert.alert(
        "Quantity Exceeded",
        `Cannot set scanned quantity to ${newQty}.\n\n` +
          `Allocated quantity for ${editQtyModal.store}: ${editQtyModal.allocatedQty}\n\n` +
          `Please enter a quantity of ${editQtyModal.allocatedQty} or less.\n\n` +
          `Note: You can reduce the quantity if it was over-scanned.`
      );
      return;
    }

    setLoading(true);
    try {
      const settings = await getSettings();
      const normalizedASN = normalizeASN(activeASN);
      const db = await getDatabase();
      const boxes = await dataService.getBoxes(activeASN);

      // Get boxes for this store, prioritizing Putaway boxes if editing Putaway quantity
      let storeBoxes = boxes.filter((b) => {
        const boxStore = String(b.store).trim().toUpperCase();
        const modalStore = String(editQtyModal.store).trim().toUpperCase();
        return (
          boxStore === modalStore ||
          (modalStore === "WAREHOUSE" &&
            (boxStore === "WAREHOUSE" || boxStore.startsWith("WH-")))
        );
      });

      // If editing Putaway quantity, prioritize Putaway boxes (PAW-*)
      if (editQtyModal.isPutaway) {
        const putawayBoxes = storeBoxes.filter(
          (b) => b.purpose === "PUTAWAY" || b.box_id?.startsWith("PAW-")
        );
        if (putawayBoxes.length > 0) {
          storeBoxes = putawayBoxes; // Use only Putaway boxes
          console.warn(
            `📦 Editing Putaway quantity - using ${putawayBoxes.length} Putaway box(es):`,
            putawayBoxes.map((b) => b.box_id)
          );
        } else {
          console.warn(
            `⚠️ Editing Putaway quantity but no Putaway boxes found for ${editQtyModal.store}`
          );
        }
      } else {
        // If editing TO quantity, exclude Putaway boxes (use regular warehouse boxes)
        const regularBoxes = storeBoxes.filter(
          (b) => b.purpose !== "PUTAWAY" && !b.box_id?.startsWith("PAW-")
        );
        if (regularBoxes.length > 0) {
          storeBoxes = regularBoxes; // Use only regular boxes (not Putaway)
          console.warn(
            `📦 Editing TO quantity - using ${regularBoxes.length} regular box(es):`,
            regularBoxes.map((b) => b.box_id)
          );
        }
      }

      const isBoxOpen = (b: (typeof storeBoxes)[0]) =>
        b.status === "Open" ||
        b.status === "OPEN" ||
        b.status === "open";
      const openStoreBoxes = storeBoxes.filter(isBoxOpen);

      if (storeBoxes.length === 0 && newQty > 0) {
        const boxType = editQtyModal.isPutaway ? "Putaway" : "regular";
        Alert.alert(
          "Error",
          `No ${boxType} boxes found for ${editQtyModal.store}`
        );
        setLoading(false);
        return;
      }

      // Current scanned qty for edit — same supplier carton attribution when a carton is locked
      const cartonFilter = lockedCarton
        ? "AND UPPER(TRIM(IFNULL(carton_id,''))) = UPPER(TRIM(?))"
        : "AND (carton_id IS NULL OR TRIM(COALESCE(carton_id, '')) = '')";
      const cartonParams = lockedCarton
        ? [
            activeASN,
            normalizedASN,
            activeSession,
            String(lockedCarton).trim(),
            editQtyModal.itemCode,
            editQtyModal.store,
          ]
        : [
            activeASN,
            normalizedASN,
            activeSession,
            editQtyModal.itemCode,
            editQtyModal.store,
          ];

      const currentScannedQtyResult = await db.getFirstAsync<{
        total_qty: number;
      }>(
        `SELECT COALESCE(SUM(scanned_qty), 0) as total_qty 
             FROM scanned_items 
         WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ? ${cartonFilter}
               AND item_code = ? AND store = ?`,
        cartonParams
      );

      console.warn(
        `📦 Editing quantity - counting ALL items for store ${editQtyModal.store}, item ${editQtyModal.itemCode}, lockedCarton=${lockedCarton}`
      );

      const currentQty = currentScannedQtyResult?.total_qty || 0;
      const qtyDifference = newQty - currentQty;

      console.warn(
        `✏️ Edit Qty: Current=${currentQty}, New=${newQty}, Difference=${qtyDifference}`
      );
      console.warn(
        `✏️ Edit Qty Details: activeASN=${activeASN}, normalizedASN=${normalizedASN}, lockedCarton=${lockedCarton}, store=${editQtyModal.store}, itemCode=${editQtyModal.itemCode}`
      );

      // Verify the query found the right records
      if (currentQty !== editQtyModal.currentScannedQty) {
        console.warn(
          `⚠️ WARNING: Current qty from DB (${currentQty}) doesn't match modal's currentScannedQty (${editQtyModal.currentScannedQty})`
        );
      }

      if (qtyDifference === 0) {
        Alert.alert("No Change", "Scanned quantity is already the same.");
        setEditQtyModal(null);
        setEditQtyValue("");
        setLoading(false);
        return;
      }

      const resolveTargetBoxForAdd = async (): Promise<
        (typeof storeBoxes)[0] | null
      > => {
        if (openStoreBoxes.length === 0) return null;
        const openIdsUpper = openStoreBoxes.map((b) =>
          String(b.box_id || "").trim().toUpperCase()
        );
        const ph = openIdsUpper.map(() => "?").join(",");
        const tailParams = [
          editQtyModal.itemCode,
          editQtyModal.store,
          ...openIdsUpper,
        ];
        let hit: { box_id: string } | null = null;
        if (lockedCarton) {
          hit = await db.getFirstAsync<{ box_id: string }>(
            `SELECT box_id FROM scanned_items
             WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ?
               AND carton_id = ? AND item_code = ? AND store = ?
               AND UPPER(TRIM(box_id)) IN (${ph})
             ORDER BY scanned_on DESC LIMIT 1`,
            [
              activeASN,
              normalizedASN,
              activeSession,
              lockedCarton,
              ...tailParams,
            ]
          );
        } else {
          hit = await db.getFirstAsync<{ box_id: string }>(
            `SELECT box_id FROM scanned_items
             WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ?
               AND (carton_id IS NULL OR TRIM(carton_id) = '')
               AND item_code = ? AND store = ?
               AND UPPER(TRIM(box_id)) IN (${ph})
             ORDER BY scanned_on DESC LIMIT 1`,
            [activeASN, normalizedASN, activeSession, ...tailParams]
          );
        }
        if (hit?.box_id) {
          const found = openStoreBoxes.find(
            (b) =>
              String(b.box_id || "").trim().toUpperCase() ===
              String(hit.box_id || "").trim().toUpperCase()
          );
          if (found) return found;
        }
        const sorted = [...openStoreBoxes].sort((a, b) =>
          String(b.updated_on || "").localeCompare(String(a.updated_on || ""))
        );
        return sorted[0] ?? null;
      };

      const timestamp = new Date().toISOString();

      if (qtyDifference > 0) {
        // Need to add items — never target closed/dispatched boxes (was storeBoxes[0])
        const targetBox = await resolveTargetBoxForAdd();
        if (!targetBox) {
          Alert.alert(
            "No Open Box",
            `Cannot add quantity for ${editQtyModal.store}: there is no open ${
              editQtyModal.isPutaway ? "Putaway" : "store"
            } box.\n\nCreate a new open box in Box Management, then try again.`
          );
          setLoading(false);
          return;
        }

        const targetCartonFilter = lockedCarton
          ? "AND UPPER(TRIM(IFNULL(carton_id,''))) = UPPER(TRIM(?))"
          : "AND (carton_id IS NULL OR TRIM(COALESCE(carton_id, '')) = '')";
        const targetCartonParams = lockedCarton
          ? [
              activeASN,
              normalizedASN,
              activeSession,
              String(lockedCarton).trim(),
              editQtyModal.itemCode,
              targetBox.box_id,
              editQtyModal.store,
            ]
          : [
              activeASN,
              normalizedASN,
              activeSession,
              editQtyModal.itemCode,
              targetBox.box_id,
              editQtyModal.store,
            ];
        const currentTargetBoxQtyRow = await db.getFirstAsync<{
          total_qty: number;
        }>(
          `SELECT COALESCE(SUM(scanned_qty), 0) as total_qty
           FROM scanned_items
           WHERE (asn_no = ? OR asn_no = ?)
             AND inbound_session = ?
             ${targetCartonFilter}
             AND item_code = ?
             AND box_id = ?
             AND store = ?`,
          targetCartonParams,
        );
        try {
          if (!(await requireOnlineForReceiving())) {
            setLoading(false);
            return;
          }
          await apiService.adjustSortBox({
            purpose: editQtyModal.isPutaway ? "PUTAWAY" : "STORE",
            asn_no: activeASN,
            box_id: targetBox.box_id,
            carton_id: lockedCarton ?? undefined,
            item_code: editQtyModal.itemCode,
            new_qty: (currentTargetBoxQtyRow?.total_qty || 0) + qtyDifference,
            user_id: settings.user_id ?? "",
            device_id: settings.device_id ?? "",
          });
        } catch (error: any) {
          const payload = error?.data || error?.response?.data || {};
          const msg =
            payload?.message ||
            error?.message ||
            "Backend rejected this quantity update.";
          Alert.alert("Quantity Update Not Allowed", msg);
          setLoading(false);
          return;
        }

        // Update or insert in database
        // Handle both carton_id = null (BOX ID workflow) and carton_id = lockedCarton (old workflow)
        // Check both ASN formats to find existing records
        const cartonFilter = lockedCarton
          ? "AND carton_id = ?"
          : "AND carton_id IS NULL";
        const cartonParams = lockedCarton
          ? [
              activeASN,
              normalizedASN,
              activeSession,
              lockedCarton,
              editQtyModal.itemCode,
              targetBox.box_id,
              editQtyModal.store,
            ]
          : [
              activeASN,
              normalizedASN,
              activeSession,
              editQtyModal.itemCode,
              targetBox.box_id,
              editQtyModal.store,
            ];

        const existing = await db.getFirstAsync<{
          scanned_qty: number;
          asn_no: string;
        }>(
          `SELECT scanned_qty, asn_no FROM scanned_items 
           WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ? ${cartonFilter} AND item_code = ? AND box_id = ? AND store = ?
           LIMIT 1`,
          cartonParams
        );

        if (existing) {
          // Update existing record with the full new quantity
          // Use the ASN format that was found in the database
          const existingASN = existing.asn_no;
          const updateParams = lockedCarton
            ? [
                qtyDifference,
                timestamp,
                settings.device_id ?? "",
                settings.user_id ?? "",
                existingASN,
                activeSession,
                lockedCarton,
                editQtyModal.itemCode,
                targetBox.box_id,
                editQtyModal.store,
              ]
            :               [
                qtyDifference,
                timestamp,
                settings.device_id ?? "",
                settings.user_id ?? "",
                existingASN,
                activeSession,
                editQtyModal.itemCode,
                targetBox.box_id,
                editQtyModal.store,
              ];

          await db.runAsync(
            `UPDATE scanned_items 
             SET scanned_qty = scanned_qty + ?, scanned_on = ?, device_id = ?, user_id = ?
             WHERE asn_no = ? AND inbound_session = ? ${cartonFilter} AND item_code = ? AND box_id = ? AND store = ?`,
            updateParams
          );
          console.log(
            `✅ Updated existing record: ASN=${existingASN}, box_id=${targetBox.box_id}, qtyDifference=${qtyDifference}`
          );
        } else {
          // Insert new record with the full quantity
          // Use normalizedASN for new records to maintain consistency
          await db.runAsync(
            `INSERT INTO scanned_items (asn_no, inbound_session, carton_id, item_code, box_id, store, scanned_qty, scanned_on, device_id, user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              normalizedASN,
              activeSession,
              lockedCarton ?? "",
              editQtyModal.itemCode,
              targetBox.box_id,
              editQtyModal.store,
              qtyDifference,
              timestamp,
              settings.device_id ?? "",
              settings.user_id ?? "",
            ]
          );
          console.log(
            `✅ Inserted new record: ASN=${normalizedASN}, box_id=${targetBox.box_id}, qty=${qtyDifference}`
          );
        }
      } else {
        // Need to remove items (qtyDifference is negative)
        const itemsToRemove = Math.abs(qtyDifference);

        console.log(
          `🗑️ Removing ${itemsToRemove} items. Current=${currentQty}, Target=${newQty}`
        );

        const deleteCartonFilter = lockedCarton
          ? "AND UPPER(TRIM(IFNULL(carton_id,''))) = UPPER(TRIM(?))"
          : "AND (carton_id IS NULL OR TRIM(COALESCE(carton_id, '')) = '')";
        const deleteCartonParams = lockedCarton
          ? [
              activeASN,
              normalizedASN,
              activeSession,
              String(lockedCarton).trim(),
              editQtyModal.itemCode,
              editQtyModal.store,
            ]
          : [
              activeASN,
              normalizedASN,
              activeSession,
              editQtyModal.itemCode,
              editQtyModal.store,
            ];

        const itemsToDelete = await db.getAllAsync<{
          box_id: string;
          scanned_qty: number;
          asn_no: string;
          carton_id: string | null;
        }>(
          `SELECT box_id, scanned_qty, asn_no, carton_id 
           FROM scanned_items 
           WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ? ${deleteCartonFilter} AND item_code = ? AND store = ?
           ORDER BY scanned_on ASC`,
          deleteCartonParams
        );

        console.log(
          `🗑️ Found ${itemsToDelete.length} record(s) to process for removal:`,
          itemsToDelete.map((i) => ({
            box_id: i.box_id,
            qty: i.scanned_qty,
            asn: i.asn_no,
          }))
        );

        if (!(await requireOnlineForReceiving())) {
          setLoading(false);
          return;
        }

        let remainingToRemove = itemsToRemove;
        let totalRemoved = 0;
        for (const item of itemsToDelete) {
          if (remainingToRemove <= 0) break;

          if (item.scanned_qty > remainingToRemove) {
            const nextQty = item.scanned_qty - remainingToRemove;
            try {
              await apiService.adjustSortBox({
                purpose: editQtyModal.isPutaway ? "PUTAWAY" : "STORE",
                asn_no: activeASN,
                box_id: item.box_id,
                carton_id: item.carton_id || lockedCarton || undefined,
                item_code: editQtyModal.itemCode,
                new_qty: nextQty,
                user_id: settings.user_id ?? "",
                device_id: settings.device_id ?? "",
              });
            } catch (error: any) {
              const payload = error?.data || error?.response?.data || {};
              const msg =
                payload?.message ||
                error?.message ||
                "Backend rejected this quantity update.";
              Alert.alert("Quantity Update Not Allowed", msg);
              setLoading(false);
              return;
            }
            // Reduce quantity in this record
            // Use the ASN format and carton_id found in the database record
            const itemCartonFilter = item.carton_id
              ? "AND carton_id = ?"
              : "AND carton_id IS NULL";
            const itemCartonParams = item.carton_id
              ? [
                  remainingToRemove,
                  timestamp,
                  settings.device_id ?? "",
                  settings.user_id ?? "",
                  item.asn_no,
                  activeSession,
                  item.carton_id,
                  editQtyModal.itemCode,
                  item.box_id,
                  editQtyModal.store,
                ]
              : [
                  remainingToRemove,
                  timestamp,
                  settings.device_id ?? "",
                  settings.user_id ?? "",
                  item.asn_no,
                  activeSession,
                  editQtyModal.itemCode,
                  item.box_id,
                  editQtyModal.store,
                ];

            await db.runAsync(
              `UPDATE scanned_items 
               SET scanned_qty = scanned_qty - ?, scanned_on = ?, device_id = ?, user_id = ?
               WHERE asn_no = ? AND inbound_session = ? ${itemCartonFilter} AND item_code = ? AND box_id = ? AND store = ?`,
              itemCartonParams
            );
            console.log(
              `✅ Reduced quantity in record: ASN=${item.asn_no}, box_id=${
                item.box_id
              }, carton_id=${
                item.carton_id || "NULL"
              }, reduced=${remainingToRemove}, new_qty=${
                item.scanned_qty - remainingToRemove
              }`
            );
            totalRemoved += remainingToRemove;
            remainingToRemove = 0;
          } else {
            try {
              await apiService.adjustSortBox({
                purpose: editQtyModal.isPutaway ? "PUTAWAY" : "STORE",
                asn_no: activeASN,
                box_id: item.box_id,
                carton_id: item.carton_id || lockedCarton || undefined,
                item_code: editQtyModal.itemCode,
                new_qty: 0,
                user_id: settings.user_id ?? "",
                device_id: settings.device_id ?? "",
              });
            } catch (error: any) {
              const payload = error?.data || error?.response?.data || {};
              const msg =
                payload?.message ||
                error?.message ||
                "Backend rejected this quantity update.";
              Alert.alert("Quantity Update Not Allowed", msg);
              setLoading(false);
              return;
            }
            // Delete this entire record
            // Use the ASN format and carton_id found in the database record
            const itemCartonFilter = item.carton_id
              ? "AND carton_id = ?"
              : "AND carton_id IS NULL";
            const itemDeleteParams = item.carton_id
              ? [
                  item.asn_no,
                  activeSession,
                  item.carton_id,
                  editQtyModal.itemCode,
                  item.box_id,
                  editQtyModal.store,
                ]
              : [
                  item.asn_no,
                  activeSession,
                  editQtyModal.itemCode,
                  item.box_id,
                  editQtyModal.store,
                ];

            await db.runAsync(
              `DELETE FROM scanned_items 
               WHERE asn_no = ? AND inbound_session = ? ${itemCartonFilter} AND item_code = ? AND box_id = ? AND store = ?`,
              itemDeleteParams
            );
            console.log(
              `✅ Deleted record: ASN=${item.asn_no}, box_id=${
                item.box_id
              }, carton_id=${item.carton_id || "NULL"}, qty=${item.scanned_qty}`
            );
            totalRemoved += item.scanned_qty;
            remainingToRemove -= item.scanned_qty;
          }
        }

        if (remainingToRemove > 0) {
          console.error(
            `❌ ERROR: Could not remove all items. Remaining to remove: ${remainingToRemove}, Total removed: ${totalRemoved}`
          );
          Alert.alert(
            "Warning",
            `Could not remove all items. Remaining: ${remainingToRemove}`
          );
        } else {
          console.log(`✅ Successfully removed ${totalRemoved} items`);
        }
      }

      // Verify the save worked by querying the database again
      console.log(
        `🔍 Verifying save - querying database for updated quantity...`
      );
      const verifyCartonFilter = lockedCarton
        ? "AND UPPER(TRIM(IFNULL(carton_id,''))) = UPPER(TRIM(?))"
        : "AND (carton_id IS NULL OR TRIM(COALESCE(carton_id, '')) = '')";
      const verifyCartonParams = lockedCarton
        ? [
            activeASN,
            normalizedASN,
            activeSession,
            String(lockedCarton).trim(),
            editQtyModal.itemCode,
            editQtyModal.store,
          ]
        : [
            activeASN,
            normalizedASN,
            activeSession,
            editQtyModal.itemCode,
            editQtyModal.store,
          ];

      const verifyResult = await db.getFirstAsync<{ total_qty: number }>(
        `SELECT COALESCE(SUM(scanned_qty), 0) as total_qty 
         FROM scanned_items 
         WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ? ${verifyCartonFilter}
           AND item_code = ? AND store = ?`,
        verifyCartonParams
      );
      const verifiedQty = verifyResult?.total_qty || 0;
      console.warn(
        `✅ Save verification: Expected=${newQty}, Actual in DB=${verifiedQty}, Match=${
          verifiedQty === newQty
        }`
      );

      if (verifiedQty !== newQty) {
        console.error(
          `❌ SAVE FAILED: Database shows ${verifiedQty} but expected ${newQty}`
        );
        Alert.alert(
          "Warning",
          `Quantity may not have been saved correctly. Expected: ${newQty}, Found in DB: ${verifiedQty}`
        );
      }

      // Reload scanned items and quantities from database
      const scannedItemsFromDB = await dataService.getScannedItems(
        normalizedASN,
        activeSession,
        lockedCarton ?? undefined
      );

      // Update scanned items state
      setScannedItemsWithLog(scannedItemsFromDB);

      // Recalculate scanned quantities by item_code
      const scannedQtyMap = new Map<string, number>();
      (scannedItemsFromDB as { item_code: string; scanned_qty?: number }[]).forEach((item) => {
        const current = scannedQtyMap.get(item.item_code) || 0;
        scannedQtyMap.set(item.item_code, current + (item.scanned_qty || 0));
      });
      const newScannedQuantities: { [key: string]: number } = {};
      scannedQtyMap.forEach((qty, itemCode) => {
        newScannedQuantities[itemCode] = qty;
      });
      setScannedQuantitiesWithLog(newScannedQuantities);

      // Also reload total scanned quantities to update Expected Items modal and TO Breakdown
      try {
        const db = await getDatabase();
        const normalizedASN = normalizeASN(activeASN);
        let scannedItemsFromDB = await db.getAllAsync<{
          item_code: string;
          scanned_qty: number;
        }>(
          `SELECT item_code, SUM(scanned_qty) as scanned_qty 
           FROM scanned_items 
           WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ?
           GROUP BY item_code`,
          [activeASN, normalizedASN, activeSession]
        );
        const quantitiesMap: Record<string, number> = {};
        scannedItemsFromDB.forEach((item) => {
          quantitiesMap[item.item_code] = item.scanned_qty || 0;
        });
        setTotalScannedQuantities(quantitiesMap);
        console.log(`✅ Reloaded total scanned quantities:`, quantitiesMap);
      } catch (error: any) {
        console.warn(
          `⚠️ Error reloading total scanned quantities:`,
          error.message
        );
      }

      await loadAvailableCartons();
      await loadTransferOrderStores();

      // Close TO Breakdown modal if open to force refresh when reopened
      if (
        toBreakdownModal?.visible &&
        toBreakdownModal.itemCode === editQtyModal.itemCode
      ) {
        setToBreakdownModal(null);
        console.log(
          `🔄 Closed TO Breakdown modal to force refresh on next open`
        );
      }

      const savedEditItemCode = editQtyModal.itemCode;
      setEditQtyModal(null);
      setEditQtyValue("");

      // Refresh item details modal if it's open
      if (itemDetailsModal?.visible) {
        await handleItemDetailsClick(savedEditItemCode);
      }
    } catch (error: any) {
      console.error("❌ Error updating scanned quantity:", error);
      Alert.alert("Error", `Failed to update quantity: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Handle manual quantity entry
  const handleManualQuantitySubmit = async () => {
    if (
      !activeASN ||
      !activeSession ||
      !lockedCarton ||
      !manualQtyItem ||
      !manualQtyBox
    ) {
      Alert.alert("Error", "Missing required information");
      return;
    }

    const qty = parseInt(manualQtyValue, 10);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert("Error", "Please enter a valid quantity (greater than 0)");
      return;
    }

    // Check remaining quantity
    const cartonItem = cartonItems.find((ci) => ci.item_code === manualQtyItem);
    if (!cartonItem) {
      Alert.alert("Error", "Item not found in carton");
      return;
    }

    const scannedQty = scannedQuantities[manualQtyItem] || 0;
    const remainingQty = cartonItem.shipped_qty - scannedQty;

    if (qty > remainingQty) {
      Alert.alert(
        "Quantity Exceeded",
        `Cannot add ${qty} units. Only ${remainingQty} remaining for ${manualQtyItem}.`
      );
      return;
    }

    setLoading(true);
    try {
      const settings = await getSettings();
      const normalizedASN = normalizeASN(activeASN);

      // Validate box exists
      const boxes = await dataService.getBoxes(activeASN);
      const box = boxes.find((b) => b.box_id === manualQtyBox);
      if (!box) {
        Alert.alert("Error", `BOX "${manualQtyBox}" not found`);
        setLoading(false);
        return;
      }

      if (
        box.status !== "Open" &&
        box.status !== "OPEN" &&
        box.status !== "open"
      ) {
        Alert.alert(
          "BOX Not Active",
          `BOX "${manualQtyBox}" is not open (status: ${box.status}).\n\nUse an open box or create a new one in Box Management.`
        );
        setLoading(false);
        return;
      }

      // Validate allocation (except for Warehouse boxes)
      // Check warehouse_type from master data instead of hardcoded "WAREHOUSE" string
      const boxStoreInfo = warehousesAndStores.find((ws: any) =>
        storeCodesMatchForTO(ws.code, box.store)
      );
      const isWarehouseBox =
        boxStoreInfo?.warehouse_type === "Warehouse" ||
        String(box.store).trim().toUpperCase() === "WAREHOUSE"; // Fallback for legacy support

      if (!isWarehouseBox) {
        const allocations = await dataService.getTransferOrderAllocations(
          activeASN,
          box.store
        );
        const allocation = allocations.find(
          (a) =>
            String(a.item_code).trim().toUpperCase() ===
            String(manualQtyItem).trim().toUpperCase()
        );
        if (!allocation || allocation.allocated_qty <= 0) {
          Alert.alert(
            "Error",
            `No allocation for ${manualQtyItem} to ${box.store}.\n\nThis item cannot be sorted to this BOX.`
          );
          setLoading(false);
          return;
        }

        // Check if adding this quantity would exceed allocated quantity for this store
        const itemScansForStore = scannedItems.filter((si) => {
          const siBox = boxes.find((b) => b.box_id === si.box_id);
          return (
            String(si.item_code).trim().toUpperCase() ===
              String(manualQtyItem).trim().toUpperCase() &&
            storeCodesMatchForTO(siBox?.store, box.store)
          );
        });
        const currentScannedQtyForStore = itemScansForStore.length;
        const newTotalScannedQty = currentScannedQtyForStore + qty;

        if (newTotalScannedQty > allocation.allocated_qty) {
          const remaining =
            allocation.allocated_qty - currentScannedQtyForStore;
          Alert.alert(
            "Quantity Exceeded",
            `Cannot add ${qty} units for ${manualQtyItem} to ${box.store}.\n\n` +
              `Allocated: ${allocation.allocated_qty}\n` +
              `Already Scanned: ${currentScannedQtyForStore}\n` +
              `Remaining: ${remaining}\n\n` +
              `Please enter a quantity of ${remaining} or less, or use the TO Breakdown button to edit quantities.`
          );
          setLoading(false);
          return;
        }
      }

      // Create events for the quantity - use batch approach for better performance
      // Create a single event with total quantity instead of multiple individual events
      // This is much faster than creating qty * 2 individual events
      try {
        if (!(await requireOnlineForReceiving())) {
          setLoading(false);
          return;
        }
        await apiService.scanSortBox({
          purpose: isWarehouseBox ? "PUTAWAY" : "STORE",
          asn_no: activeASN,
          box_id: manualQtyBox,
          carton_id: lockedCarton ?? undefined,
          item_code: manualQtyItem,
          qty,
          user_id: settings.user_id ?? "",
          device_id: settings.device_id ?? "",
        });
      } catch (error: any) {
        const payload = error?.data || error?.response?.data || {};
        const msg =
          payload?.message ||
          error?.message ||
          "Backend rejected this quantity scan.";
        Alert.alert(
          isWarehouseBox ? "Putaway Not Allowed" : "Sort Not Allowed",
          msg,
        );
        setLoading(false);
        return;
      }

      await addEvent({
        event_type: "RECEIVE_ITEM_SCAN",
        asn_no: normalizedASN,
        inbound_session: activeSession,
        carton_id: lockedCarton,
        item_code: manualQtyItem,
        qty: qty, // Use total quantity instead of creating multiple events
        device_id: settings.device_id,
        user_id: settings.user_id,
      });

      // Update scanned_items in database
      // Use original ASN format (scanned_items are stored with original format)
      const db = await getDatabase();

      // Check for existing record - try original ASN format first
      let existing = await db.getFirstAsync<{ scanned_qty: number }>(
        `SELECT scanned_qty FROM scanned_items 
         WHERE asn_no = ? AND inbound_session = ? AND carton_id = ? AND item_code = ? AND box_id = ?`,
        [
          activeASN, // Use original format first
          activeSession,
          lockedCarton,
          manualQtyItem,
          manualQtyBox,
        ]
      );

      // If no results and ASN was normalized, try with normalized format (for backward compatibility)
      if (!existing && normalizedASN !== activeASN) {
        existing = await db.getFirstAsync<{ scanned_qty: number }>(
          `SELECT scanned_qty FROM scanned_items 
           WHERE asn_no = ? AND inbound_session = ? AND carton_id = ? AND item_code = ? AND box_id = ?`,
          [
            normalizedASN,
            activeSession,
            lockedCarton,
            manualQtyItem,
            manualQtyBox,
          ]
        );
      }

      if (existing) {
        // Update existing record: increment scanned_qty
        const newQty = existing.scanned_qty + qty;
        // Try original format first
        await db.runAsync(
          `UPDATE scanned_items 
           SET scanned_qty = ?, scanned_on = ?, device_id = ?, user_id = ?
           WHERE asn_no = ? AND inbound_session = ? AND carton_id = ? AND item_code = ? AND box_id = ?`,
          [
            newQty,
            new Date().toISOString(),
            settings.device_id ?? "",
            settings.user_id ?? "",
            activeASN, // Use original format
            activeSession,
            lockedCarton,
            manualQtyItem,
            manualQtyBox,
          ]
        );
        console.log(
          `✅ Updated scanned item quantity: ${manualQtyItem} -> ${manualQtyBox} (qty: ${existing.scanned_qty} + ${qty} = ${newQty})`
        );
      } else {
        // Insert new record - use original ASN format
        await db.runAsync(
          `INSERT INTO scanned_items 
           (asn_no, inbound_session, carton_id, item_code, box_id, store, scanned_qty, scanned_on, device_id, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            activeASN, // Use original format
            activeSession,
            lockedCarton ?? "",
            manualQtyItem,
            manualQtyBox,
            box.store,
            qty,
            new Date().toISOString(),
            settings.device_id ?? "",
            settings.user_id ?? "",
          ]
        );
        console.log(
          `✅ Saved scanned item to database: ${manualQtyItem} -> ${manualQtyBox} (qty: ${qty})`
        );
      }

      // Update scanned items list and quantities (optimize by creating array once)
      const newScannedItems = [
        ...scannedItems,
        ...Array(qty)
          .fill(null)
          .map(() => ({ item_code: manualQtyItem, box_id: manualQtyBox })),
      ];
      setScannedItemsWithLog(newScannedItems);

      // Update scanned quantity
      const currentScannedQty = scannedQuantities[manualQtyItem] || 0;
      const newQuantities = {
        ...scannedQuantities,
        [manualQtyItem]: currentScannedQty + qty,
      };
      setScannedQuantitiesWithLog(newQuantities);

      // Track last scanned item
      setLastScannedItem(manualQtyItem);
      setLastScannedBox(manualQtyBox);

      // Reload total scanned quantities to update Expected Items modal
      const reloadTotalScannedQuantities = async () => {
        if (!activeASN || !activeSession) return;
        try {
          const db = await getDatabase();
          const normalizedASN = normalizeASN(activeASN);
          let scannedItemsFromDB = await db.getAllAsync<{
            item_code: string;
            scanned_qty: number;
          }>(
            `SELECT item_code, SUM(scanned_qty) as scanned_qty 
             FROM scanned_items 
             WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ?
             GROUP BY item_code`,
            [activeASN, normalizedASN, activeSession]
          );
          const quantitiesMap: Record<string, number> = {};
          scannedItemsFromDB.forEach((item) => {
            quantitiesMap[item.item_code] = item.scanned_qty || 0;
          });
          setTotalScannedQuantities(quantitiesMap);
        } catch (error: any) {
          console.warn(
            `⚠️ Error reloading total scanned quantities:`,
            error.message
          );
        }
      };
      await reloadTotalScannedQuantities();

      // Reset manual quantity input
      setManualQtyItem(null);
      setManualQtyValue("");
      setManualQtyBox(null);
    } catch (error: any) {
      console.error("❌ Failed to add manual quantity:", error);
      Alert.alert("Error", error.message || "Failed to add quantity");
    } finally {
      setLoading(false);
    }
  };

  // Memoized render functions for performance
  const renderExpectedItem = useCallback(
    ({ item }: { item: any }) => {
      // cartonItems are for lockedCarton only — compare to this carton's scanned qty, not session-wide total
      const scannedQty = scannedQtyLookup(scannedQuantities, item.item_code) || 0;
      const remainingQty = item.shipped_qty - scannedQty;
      const isComplete = remainingQty <= 0;
      const isEditing = manualQtyItem === item.item_code;

      // Get carton scanned quantity for display (from scannedQuantities which is for locked carton)
      const cartonScannedQty = lockedCarton
        ? scannedQtyLookup(scannedQuantities, item.item_code) || 0
        : 0;

      // Debug logging
      if (isEditing) {
        console.log(
          `🔍 Manual Qty Modal - Item: ${
            item.item_code
          }, lockedCarton: ${lockedCarton}, cartonScannedQty: ${cartonScannedQty}, scannedQuantities[${
            item.item_code
          }]: ${scannedQuantities[item.item_code]}, scannedQuantities keys:`,
          Object.keys(scannedQuantities)
        );
      }

      return (
        <View style={[styles.itemRow, isComplete && styles.itemRowComplete]}>
          <View style={styles.itemInfo}>
            <Text style={styles.itemCode}>{item.item_code}</Text>
            <View style={styles.qtyContainer}>
              <View style={styles.qtyRow}>
                <Text style={styles.qtyLabel}>ASN Qty:</Text>
                <Text style={styles.qtyValue}> {item.shipped_qty}</Text>
              </View>
              <View style={styles.qtyRow}>
                <Text style={styles.qtyLabel}>Scanned:</Text>
                <Text
                  style={[
                    styles.qtyValue,
                    scannedQty > 0 && styles.qtyValueScanned,
                  ]}
                >
                  {" "}
                  {scannedQty}
                </Text>
              </View>
              <View style={styles.qtyRow}>
                <Text style={styles.qtyLabel}>Remaining:</Text>
                <Text
                  style={[
                    styles.qtyValue,
                    remainingQty === 0 && styles.qtyValueComplete,
                    remainingQty > 0 &&
                      remainingQty <= item.shipped_qty * 0.2 &&
                      styles.qtyValueLow,
                  ]}
                >
                  {" "}
                  {remainingQty}
                </Text>
              </View>
            </View>

            {/* Manual Quantity Input Section */}
            {isEditing ? (
              <View style={styles.manualQtyContainer}>
                {/* Display total scanned quantity for the carton */}
                <View style={styles.manualQtyInfoRow}>
                  {lockedCarton ? (
                    <>
                      <Text style={styles.manualQtyInfoLabel}>
                        Total Scanned (CTN {lockedCarton}):
                      </Text>
                      <Text
                        style={[
                          styles.manualQtyInfoValue,
                          {
                            color: "#2196F3",
                            fontWeight: "bold",
                            fontSize: 18,
                          },
                        ]}
                      >
                        {cartonScannedQty}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.manualQtyInfoLabel}>
                      Note: No carton locked
                    </Text>
                  )}
                </View>
                <Text style={styles.manualQtyLabel}>Enter Quantity:</Text>
                <TextInput
                  style={styles.manualQtyInput}
                  value={manualQtyValue}
                  onChangeText={setManualQtyValue}
                  placeholder={`Max: ${remainingQty}`}
                  keyboardType="numeric"
                  autoFocus
                />
                <Text style={styles.manualQtyLabel}>Select BOX:</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.manualQtyBoxSelector}
                  contentContainerStyle={styles.manualQtyBoxSelectorContent}
                >
                  {boxesFilteredForCreator
                    .filter(
                      (box) =>
                        box.box_id != null &&
                        box.box_id !== "" &&
                        box.status === "Open" &&
                        box.status !== "Closed" &&
                        box.status !== "CLOSED" &&
                        box.status !== "closed"
                    )
                    .sort((a, b) => {
                      // Sort by quantity: boxes with less quantity (or 0) appear first
                      // This makes it easier to see which boxes still need items
                      const qtyA = boxItemQuantities[a.box_id] || 0;
                      const qtyB = boxItemQuantities[b.box_id] || 0;
                      return qtyA - qtyB; // Ascending order: 0, 1, 2, ... (unfilled first)
                    })
                    .map((box) => {
                      const storeColor = getStoreColor(box.store || "");
                      const itemQty = boxItemQuantities[box.box_id] || 0;
                      const isSelected = manualQtyBox === box.box_id;

                      return (
                        <TouchableOpacity
                          key={box.box_id}
                          style={[
                            styles.manualQtyBoxButton,
                            {
                              borderColor: storeColor,
                              borderWidth: 2,
                              backgroundColor: isSelected
                                ? storeColor
                                : "#FFFFFF",
                            },
                            isSelected && styles.manualQtyBoxButtonActive,
                          ]}
                          onPress={() => setManualQtyBox(box.box_id)}
                        >
                          <Text
                            style={[
                              styles.manualQtyBoxButtonText,
                              {
                                color: isSelected ? "#FFFFFF" : "#333",
                                fontWeight: "bold",
                              },
                              isSelected && styles.manualQtyBoxButtonTextActive,
                            ]}
                          >
                            {box.box_id}
                          </Text>
                          <Text
                            style={[
                              styles.manualQtyBoxStoreText,
                              {
                                color: isSelected ? "#FFFFFF" : storeColor,
                                fontWeight: "600",
                              },
                            ]}
                          >
                            {box.store}
                          </Text>
                          {itemQty > 0 && (
                            <View
                              style={[
                                styles.boxItemQtyBadge,
                                { backgroundColor: storeColor },
                              ]}
                            >
                              <Text style={styles.boxItemQtyText}>
                                Qty: {itemQty}
                              </Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                </ScrollView>
                <View style={styles.manualQtyActions}>
                  <TouchableOpacity
                    style={[
                      styles.manualQtyButton,
                      styles.manualQtyButtonCancel,
                    ]}
                    onPress={() => {
                      setManualQtyItem(null);
                      setManualQtyValue("");
                      setManualQtyBox(null);
                    }}
                  >
                    <Text
                      style={[
                        styles.manualQtyButtonText,
                        styles.manualQtyButtonCancelText,
                      ]}
                    >
                      Cancel
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.manualQtyButton,
                      styles.manualQtyButtonSubmit,
                      (!manualQtyValue || !manualQtyBox || loading) &&
                        styles.manualQtyButtonDisabled,
                    ]}
                    onPress={handleManualQuantitySubmit}
                    disabled={!manualQtyValue || !manualQtyBox || loading}
                  >
                    <Text
                      style={[
                        styles.manualQtyButtonText,
                        styles.manualQtyButtonSubmitText,
                      ]}
                    >
                      {loading ? "Adding..." : "Add Quantity"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.itemActionButtons}>
                {!isComplete && (
                  <TouchableOpacity
                    style={styles.manualQtyTriggerButton}
                    onPress={async () => {
                      setManualQtyItem(item.item_code);
                      setManualQtyValue("");
                      setManualQtyBox(null);
                      await loadAvailableBoxes(); // Refresh boxes list
                      await loadBoxItemQuantities(item.item_code); // Load quantities for this item
                    }}
                  >
                    <Text style={styles.manualQtyTriggerText}>
                      📝 Enter Quantity
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.toBreakdownButton}
                  onPress={() => handleTOBreakdownClick(item.item_code)}
                >
                  <Text style={styles.toBreakdownButtonText}>
                    📊 TO Breakdown
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          {isComplete && (
            <View style={styles.completeBadge}>
              <Text style={styles.completeText}>✓</Text>
            </View>
          )}
        </View>
      );
    },
    [
      lockedCarton,
      scannedQuantities,
      manualQtyItem,
      manualQtyValue,
      manualQtyBox,
      availableBoxes,
      boxItemQuantities,
      loading,
    ]
  );

  const renderScannedItem = useCallback(
    ({ item }: { item: any }) => (
      <TouchableOpacity
        style={styles.scannedItemRow}
        onPress={() => handleItemDetailsClick(item.item_code)}
        activeOpacity={0.7}
      >
        <View style={styles.scannedItemInfo}>
          <View style={styles.scannedItemHeader}>
            <Text style={styles.itemCode}>{item.item_code}</Text>
            <View style={styles.scannedQtyBadge}>
              <Text style={styles.scannedQtyText}>{item.scanned_qty}</Text>
            </View>
          </View>
          {item.boxes.length > 0 && (
            <View style={styles.boxesList}>
              <Text style={styles.boxesLabel}>BOXes:</Text>
              <View style={styles.boxesChips}>
                {item.boxes.map((boxId: string, idx: number) => (
                  <View key={idx} style={styles.boxChip}>
                    <Text style={styles.boxChipText}>{boxId}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
        <Text style={styles.tapForDetails}>ℹ️</Text>
      </TouchableOpacity>
    ),
    [handleItemDetailsClick]
  );

  // Memoized scanned items data transformation
  const scannedItemsData = useMemo(() => {
    return Object.keys(scannedQuantities).map((itemCode) => {
      // Get all BOXes this item was sorted into (rows already scoped to current supplier carton when locked)
      const itemBoxes = scannedItems
        .filter((si) => itemCodesMatchForAllocation(si.item_code, itemCode))
        .map((si) => si.box_id)
        .filter((boxId) => boxId && boxId !== "" && boxId !== null) // Filter out null/empty box_ids
        .filter((boxId, index, self) => self.indexOf(boxId) === index); // Unique BOXes

      return {
        item_code: itemCode,
        scanned_qty: scannedQuantities[itemCode],
        boxes: itemBoxes,
      };
    });
  }, [scannedQuantities, scannedItems]);

  const lastScannedDetails = useMemo(() => {
    if (!lastScannedItem) return null;

    const cartonItem = cartonItems.find((item) =>
      itemCodesMatchForAllocation(item.item_code, lastScannedItem)
    );
    const itemCode = cartonItem?.item_code || lastScannedItem;
    const asnQty = Number(cartonItem?.shipped_qty || 0);
    const scannedQty = scannedQtyLookup(scannedQuantities, itemCode) || 0;
    const remainingQty = cartonItem ? asnQty - scannedQty : 0;

    const itemRows = scannedItems.filter((row) =>
      itemCodesMatchForAllocation(row.item_code, itemCode)
    );
    const uniqueBoxes = itemRows
      .map((row) => String(row.box_id || "").trim())
      .filter(Boolean)
      .filter((boxId, index, list) => list.indexOf(boxId) === index);
    const lastBox =
      lastScannedBox ||
      (uniqueBoxes.length > 0 ? uniqueBoxes[uniqueBoxes.length - 1] : null);
    const lastBoxInfo = lastBox
      ? availableBoxes.find(
          (box) =>
            String(box.box_id || "").trim().toUpperCase() ===
            String(lastBox).trim().toUpperCase()
        )
      : null;
    const lastBoxRow = lastBox
      ? itemRows.find(
          (row) =>
            String(row.box_id || "").trim().toUpperCase() ===
            String(lastBox).trim().toUpperCase()
        )
      : null;

    const toRows = transferOrderAllocations
      .filter((alloc) => itemCodesMatchForAllocation(alloc.item_code, itemCode))
      .map((alloc) => {
        const storeScannedQty = itemRows.reduce((sum, row) => {
          const rowBox = row.box_id
            ? availableBoxes.find(
                (box) =>
                  String(box.box_id || "").trim().toUpperCase() ===
                  String(row.box_id).trim().toUpperCase()
              )
            : null;
          const rowStore = row.store || rowBox?.store || "";
          if (!storeCodesMatchForTO(alloc.store, rowStore)) return sum;
          return sum + (Number(row.scanned_qty) || 0);
        }, 0);
        const toQty = Number(alloc.allocated_qty) || 0;
        return {
          store: String(alloc.store || "TO Store").trim(),
          toQty,
          scannedQty: storeScannedQty,
          remainingQty: toQty - storeScannedQty,
        };
      });

    return {
      itemCode,
      asnQty,
      scannedQty,
      remainingQty,
      lastBox,
      lastStore: lastBoxRow?.store || lastBoxInfo?.store || null,
      toRows,
      isComplete: cartonItem ? remainingQty <= 0 : scannedQty > 0,
    };
  }, [
    availableBoxes,
    cartonItems,
    lastScannedBox,
    lastScannedItem,
    scannedItems,
    scannedQuantities,
    transferOrderAllocations,
  ]);

  const currentDistributionDetails = useMemo(() => {
    if (!currentItem || workflowState !== "SCAN_BOX") return null;

    const itemCode = String(currentItem).trim();
    const itemRows = scannedItems.filter((row) =>
      itemCodesMatchForAllocation(row.item_code, itemCode)
    );
    const allocations = transferOrderAllocations.filter((alloc) =>
      itemCodesMatchForAllocation(alloc.item_code, itemCode)
    );
    const isOpenBox = (box: any) =>
      String(box?.status || "").trim().toUpperCase() === "OPEN";

    const rows = allocations.map((alloc) => {
      const scannedQty = itemRows.reduce((sum, row) => {
        const rowBox = row.box_id
          ? availableBoxes.find(
              (box) =>
                String(box.box_id || "").trim().toUpperCase() ===
                String(row.box_id).trim().toUpperCase()
            )
          : null;
        const rowStore = row.store || rowBox?.store || "";
        if (!storeCodesMatchForTO(alloc.store, rowStore)) return sum;
        return sum + (Number(row.scanned_qty) || 0);
      }, 0);
      const openBoxes = availableBoxes
        .filter(
          (box) =>
            box?.box_id &&
            isOpenBox(box) &&
            storeCodesMatchForTO(box.store, alloc.store)
        )
        .map((box) => String(box.box_id).trim())
        .filter(Boolean);
      const toQty = Number(alloc.allocated_qty) || 0;

      return {
        store: String(alloc.store || "TO Store").trim(),
        toQty,
        scannedQty,
        remainingQty: toQty - scannedQty,
        openBoxes,
      };
    });

    return { itemCode, rows };
  }, [
    availableBoxes,
    currentItem,
    scannedItems,
    transferOrderAllocations,
    workflowState,
  ]);

  const canOpenDistributionDetails = Boolean(
    activeASN && currentItem && workflowState === "SCAN_BOX"
  );

  const closeDistributionDetailsModal = useCallback(() => {
    setShowDistributionDetailsModal(false);
    refocusScanner();
  }, [refocusScanner]);

  const handleOpenDistributionDetails = useCallback(async () => {
    if (!activeASN || !currentItem || workflowState !== "SCAN_BOX") {
      return;
    }

    setDistributionDetailsLoading(true);
    try {
      const response = await apiService.getReceiveSortDistributionDetails({
        asn_no: activeASN,
        inbound_session: activeSession || undefined,
        item_code: currentItem,
        carton_id: lockedCarton,
      });
      const payload = response?.data || response;
      const stores = Array.isArray(payload?.stores) ? payload.stores : [];
      const readRemainingQty = (store: any) =>
        Number(
          store?.remaining_qty ??
            store?.remainingQty ??
            store?.remaining ??
            store?.balance_qty ??
            store?.balance ??
            0
        );
      const openStores = stores.filter(
        (store: any) => readRemainingQty(store) > 0
      );
      const fullyDistributed =
        payload?.fully_distributed === true ||
        (stores.length > 0 && openStores.length === 0);

      if (fullyDistributed) {
        setLiveDistributionDetails(null);
        setShowDistributionDetailsModal(false);
        Alert.alert(
          "Item Fully Distributed",
          `Item ${payload?.item_code || currentItem} has no remaining distribution quantity.`,
          [{ text: "OK", onPress: () => refocusScanner() }]
        );
        return;
      }

      setLiveDistributionDetails({
        itemCode: payload?.item_code || currentItem,
        itemName: payload?.item_name || null,
        toNo: payload?.to_no || null,
        serverTime: payload?.server_time || null,
        stores: openStores.map((store: any) => ({
          store: String(store?.store || "").trim(),
          toQty: Number(store?.to_qty) || 0,
          scannedQty: Number(store?.scanned_qty) || 0,
          remainingQty: readRemainingQty(store),
          openBoxes: Array.isArray(store?.open_boxes) ? store.open_boxes : [],
        })),
      });
      setShowDistributionDetailsModal(true);
    } catch (error: any) {
      Alert.alert(
        "Distribution Details",
        error?.message || "Failed to load live distribution details from backend.",
        [{ text: "OK", onPress: () => refocusScanner() }]
      );
    } finally {
      setDistributionDetailsLoading(false);
    }
  }, [
    activeASN,
    activeSession,
    currentItem,
    lockedCarton,
    refocusScanner,
    workflowState,
  ]);

  if (!activeASN || !activeSession) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No active inbound session</Text>
      </View>
    );
  }

  // Allow proceeding to next step if there's an active session
  const canProceed = !!activeASN && !!activeSession;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <ProgressIndicator
        currentStep={3}
        totalSteps={6}
        stepName="Receive + Sort"
      />
      <View style={styles.content}>
        <View style={styles.stateIndicator}>
          <Text style={styles.stateText}>
            {workflowState === "SELECT_CARTON" && "Step 1: Select Carton"}
            {workflowState === "SCAN_ITEM" && "Step 2: Scan Items"}
            {workflowState === "SCAN_BOX" && "Step 3: Scan Destination BOX"}
          </Text>
          {lockedCarton && (
            <View style={styles.cartonBadge}>
              <Text style={styles.cartonText}>Carton: {lockedCarton}</Text>
              {lockInfo && lockInfo.locked_by && (
                <View style={styles.lockInfoBadge}>
                  <Text style={styles.lockInfoText}>
                    🔒 Locked by: {lockInfo.locked_by}
                  </Text>
                  {lockInfo.locked_on && (
                    <Text style={styles.lockInfoTime}>
                      {new Date(lockInfo.locked_on).toLocaleString()}
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.resendReceiveDataButton, resendReceiveLinesLoading && styles.resendReceiveDataButtonDisabled]}
          onPress={handleResendReceiveLines}
          disabled={resendReceiveLinesLoading}
        >
          <Text style={styles.resendReceiveDataButtonText}>
            {resendReceiveLinesLoading ? "Syncing..." : "🔄 Sync receive data"}
          </Text>
        </TouchableOpacity>

        <BarcodeScanner
          onScan={(barcode) => {
            // When modal is open, route scans directly to the modal input
            // This allows BOX IDs to be scanned directly into the modal
            if (showCTNIdPrompt) {
              // Guard against duplicate processing
              if (isProcessingScan) {
                console.warn(
                  `⚠️ BarcodeScanner onScan: Already processing a scan, ignoring duplicate: "${barcode}"`
                );
                showScanFeedback(
                  "err",
                  "Still processing the last scan — wait a second."
                );
                return;
              }

              // Clear any pending auto-submit from onChangeText
              if ((global as any).ctnIdAutoSubmitTimeout) {
                clearTimeout((global as any).ctnIdAutoSubmitTimeout);
                (global as any).ctnIdAutoSubmitTimeout = null;
              }

              // Update the closure variable and state
              (global as any).currentCtnIdPromptValue = barcode;
              setCtnIdPromptValue(barcode);

              // Auto-submit after a delay to ensure state is updated and scanner has finished
              // Pass the barcode directly to avoid race condition with state update
              // Use longer delay (800ms) to ensure scanner has completely finished sending
              (global as any).ctnIdAutoSubmitTimeout = setTimeout(() => {
                const normalized = barcode.trim().toUpperCase();
                if (
                  lockedCarton &&
                  normalized === String(lockedCarton).trim().toUpperCase()
                ) {
                  (global as any).ctnIdAutoSubmitTimeout = null;
                  showScanFeedback(
                    "err",
                    "That is the supplier carton id — scan your open destination BOX id from Box Management."
                  );
                  return;
                }
                const isPrefixedLong =
                  (normalized.startsWith("BOX-") ||
                    normalized.startsWith("PAW-")) &&
                  normalized.length >= 20;
                const isCustomOpenBoxId =
                  normalized.length >= 6 &&
                  normalized.length <= 48 &&
                  /^[A-Z0-9._-]+$/.test(normalized) &&
                  !normalized.startsWith("CTN-") &&
                  !normalized.startsWith("TC-");
                if (isPrefixedLong || isCustomOpenBoxId) {
                  (global as any).ctnIdAutoSubmitTimeout = null;
                  handleCTNIdPromptSubmit(barcode);
                } else {
                  (global as any).ctnIdAutoSubmitTimeout = null;
                }
              }, 800);
            } else {
              // Modal not open, use normal scan handler
              handleScan(barcode);
            }
          }}
          placeholder={getScannerPlaceholder()}
          title={getScannerTitle()}
          focusSignal={scannerFocusSignal}
          scanType={
            workflowState === "SCAN_BOX"
              ? "box"
              : workflowState === "SCAN_ITEM"
              ? "item"
              : "carton"
          }
        />

        {lockedCarton && (
          <TouchableOpacity
            style={[
              styles.distributionDetailsInlineButton,
              (!canOpenDistributionDetails || distributionDetailsLoading) &&
                styles.distributionDetailsInlineButtonDisabled,
            ]}
            onPress={handleOpenDistributionDetails}
            activeOpacity={0.85}
            disabled={!canOpenDistributionDetails || distributionDetailsLoading}
          >
            <Text style={styles.distributionDetailsInlineButtonText}>
              {distributionDetailsLoading
                ? "Loading Distribution..."
                : "Distribution Details"}
            </Text>
          </TouchableOpacity>
        )}

        {SHOW_SCAN_DETAILS_CARD && lockedCarton && (
          <View
            style={[
              styles.quickScanDetailsCard,
              lastScannedDetails?.isComplete &&
                styles.quickScanDetailsCardComplete,
            ]}
          >
            <View style={styles.quickScanDetailsHeader}>
              <TouchableOpacity
                style={styles.quickScanDetailsTitleBlock}
                onPress={() =>
                  setQuickScanDetailsCollapsed((collapsed) => !collapsed)
                }
                activeOpacity={0.8}
              >
                <Text style={styles.quickScanDetailsLabel}>Scan Details</Text>
                <Text style={styles.quickScanDetailsItemCode}>
                  {lastScannedDetails?.itemCode || "Ready for item scan"}
                </Text>
                {quickScanDetailsCollapsed && lastScannedDetails && (
                  <Text style={styles.quickScanCollapsedHint}>
                    Scanned {lastScannedDetails.scannedQty} · Rem{" "}
                    {lastScannedDetails.remainingQty}
                  </Text>
                )}
              </TouchableOpacity>
              <View style={styles.quickScanHeaderActions}>
                <TouchableOpacity
                  style={[
                    styles.quickScanHeaderBreakdownButton,
                    (!canOpenDistributionDetails || distributionDetailsLoading) &&
                      styles.quickScanHeaderBreakdownButtonDisabled,
                  ]}
                  onPress={handleOpenDistributionDetails}
                  activeOpacity={0.85}
                  disabled={!canOpenDistributionDetails || distributionDetailsLoading}
                >
                  <Text style={styles.quickScanHeaderBreakdownButtonText}>
                    {distributionDetailsLoading ? "Loading" : "Distribution"}
                  </Text>
                </TouchableOpacity>
                <View
                  style={[
                    styles.quickScanStatusBadge,
                    !lastScannedDetails || quickScanDetailsCollapsed
                      ? styles.quickScanStatusBadgeOpen
                      : lastScannedDetails.remainingQty === 0
                      ? styles.quickScanStatusBadgeComplete
                      : lastScannedDetails.remainingQty < 0
                        ? styles.quickScanStatusBadgeOver
                        : styles.quickScanStatusBadgeOpen,
                  ]}
                >
                  <Text style={styles.quickScanStatusText}>
                    {quickScanDetailsCollapsed
                      ? "Expand"
                      : !lastScannedDetails
                        ? "Open"
                        : lastScannedDetails.remainingQty === 0
                      ? "Sorted"
                      : lastScannedDetails.remainingQty < 0
                        ? "Over"
                        : "Open"}
                  </Text>
                </View>
              </View>
            </View>

            {!quickScanDetailsCollapsed && !lastScannedDetails && (
              <>
                <Text style={styles.quickScanPlaceholderText}>
                  Scan an item and destination BOX. The latest item, remaining
                  quantity, BOX, store, and TO progress will appear here.
                </Text>
              </>
            )}

            {!quickScanDetailsCollapsed && lastScannedDetails && (
              <>
                <View style={styles.quickScanQtyRow}>
                  <View style={styles.quickScanQtyChip}>
                    <Text style={styles.quickScanQtyLabel}>ASN Qty</Text>
                    <Text style={styles.quickScanQtyValue}>
                      {lastScannedDetails.asnQty}
                    </Text>
                  </View>
                  <View style={styles.quickScanQtyChip}>
                    <Text style={styles.quickScanQtyLabel}>Scanned</Text>
                    <Text
                      style={[
                        styles.quickScanQtyValue,
                        styles.quickScanQtyValueScanned,
                      ]}
                    >
                      {lastScannedDetails.scannedQty}
                    </Text>
                  </View>
                  <View style={styles.quickScanQtyChip}>
                    <Text style={styles.quickScanQtyLabel}>Remaining</Text>
                    <Text
                      style={[
                        styles.quickScanQtyValue,
                        lastScannedDetails.remainingQty === 0
                          ? styles.quickScanQtyValueComplete
                          : lastScannedDetails.remainingQty < 0
                            ? styles.quickScanQtyValueOver
                            : styles.quickScanQtyValueRemaining,
                      ]}
                    >
                      {lastScannedDetails.remainingQty}
                    </Text>
                  </View>
                </View>

                {(lastScannedDetails.lastBox || lastScannedDetails.lastStore) && (
                  <Text style={styles.quickScanBoxLine}>
                    Last BOX: {lastScannedDetails.lastBox || "-"}
                    {lastScannedDetails.lastStore
                      ? ` · Store: ${lastScannedDetails.lastStore}`
                      : ""}
                  </Text>
                )}

                {lastScannedDetails.toRows.length > 0 ? (
                  <View style={styles.quickScanToSection}>
                    <Text style={styles.quickScanToTitle}>TO Progress</Text>
                    {lastScannedDetails.toRows.slice(0, 3).map((row, index) => (
                      <View
                        key={`${row.store}-${index}`}
                        style={styles.quickScanToRow}
                      >
                        <Text style={styles.quickScanToStore} numberOfLines={1}>
                          {row.store}
                        </Text>
                        <View style={styles.quickScanToQtyRow}>
                          <Text style={styles.quickScanToQty}>TO {row.toQty}</Text>
                          <Text
                            style={[
                              styles.quickScanToQty,
                              styles.quickScanToQtyScanned,
                            ]}
                          >
                            Scanned {row.scannedQty}
                          </Text>
                          <Text
                            style={[
                              styles.quickScanToQty,
                              row.remainingQty === 0
                                ? styles.quickScanToQtyComplete
                                : row.remainingQty < 0
                                  ? styles.quickScanToQtyOver
                                  : styles.quickScanToQtyRemaining,
                            ]}
                          >
                            Rem {row.remainingQty}
                          </Text>
                        </View>
                      </View>
                    ))}
                    {lastScannedDetails.toRows.length > 3 && (
                      <Text style={styles.quickScanMoreText}>
                        +{lastScannedDetails.toRows.length - 3} more store lines
                        in TO Breakdown
                      </Text>
                    )}
                  </View>
                ) : (
                  <Text style={styles.quickScanNoToText}>
                    No TO allocation found for this item. Check TO Breakdown for
                    full details.
                  </Text>
                )}
              </>
            )}
          </View>
        )}

        {scanFeedback && (
          <View
            style={{
              marginHorizontal: 12,
              marginTop: 8,
              marginBottom: 4,
              padding: 12,
              borderRadius: 8,
              backgroundColor:
                scanFeedback.kind === "ok" ? "#E8F5E9" : "#FFEBEE",
              borderWidth: 1,
              borderColor:
                scanFeedback.kind === "ok" ? "#66BB6A" : "#EF5350",
            }}
          >
            <Text
              style={{
                color: scanFeedback.kind === "ok" ? "#1B5E20" : "#B71C1C",
                fontWeight: "600",
                fontSize: 15,
              }}
            >
              {scanFeedback.kind === "ok" ? "✓ " : "⚠ "}
              {scanFeedback.text}
            </Text>
          </View>
        )}

        {workflowState === "SCAN_BOX" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>BOX Management</Text>
            </View>

            {isCurrentItemComplete ? (
              <View style={styles.boxesListContainer}>
                <View style={styles.noBoxesContainer}>
                  <Text style={styles.noBoxesText}>
                    ✅ Item {currentItem} is already fully scanned.{"\n"}
                    Please scan the next item to continue.
                  </Text>
                </View>
              </View>
            ) : (
              <>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: 4,
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ flex: 1, fontSize: 14, color: "#333" }}>
                    Show only My Carton
                  </Text>
                  <Switch
                    value={onlyMySortBoxes}
                    onValueChange={setOnlyMySortBoxes}
                  />
                </View>
                <TouchableOpacity
                  style={styles.toggleBoxesButton}
                  onPress={() => setShowAvailableBoxes(!showAvailableBoxes)}
                >
                  <Text style={styles.toggleBoxesButtonText}>
                    {showAvailableBoxes ? "▼ Hide" : "▶ Show"} Available BOXes
                    {filteredAvailableBoxes.length > 0 &&
                      ` (${filteredAvailableBoxes.length})`}
                  </Text>
                </TouchableOpacity>

                {showAvailableBoxes && (
                  <View style={styles.boxesListContainer}>
                    {filteredAvailableBoxes.length === 0 ? (
                      <View style={styles.noBoxesContainer}>
                        <Text style={styles.noBoxesText}>
                          {availableBoxes.length === 0
                            ? "No BOXes created yet.\nCreate a BOX to sort items into it."
                            : `No BOXes available for ${currentItem}.\nAll allocations for this item are fulfilled.`}
                        </Text>
                      </View>
                    ) : (
                      <FlatList
                        data={filteredAvailableBoxes.filter(
                          (box) => box.box_id != null && box.box_id !== ""
                        )}
                        keyExtractor={(item, index) =>
                          item.box_id || `box-${index}-${Date.now()}`
                        }
                        renderItem={({ item }) => (
                          <TouchableOpacity
                            style={styles.boxItem}
                            onPress={() => handleBoxScan(item.box_id)}
                          >
                            <View style={styles.boxItemHeader}>
                              <Text style={styles.boxItemId}>
                                {item.box_id}
                              </Text>
                              <StatusBadge status={item.status} />
                            </View>
                            <Text style={styles.boxItemStore}>
                              Store: {item.store}
                            </Text>
                            {(item as any).created_by ? (
                              <Text
                                style={[
                                  styles.boxItemStore,
                                  { fontSize: 12, opacity: 0.85 },
                                ]}
                              >
                                Created by: {(item as any).created_by}
                              </Text>
                            ) : null}
                            <Text style={styles.tapToSelect}>Tap to use →</Text>
                          </TouchableOpacity>
                        )}
                        scrollEnabled={false}
                      />
                    )}
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {!lockedCarton && workflowState === "SELECT_CARTON" && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Available Cartons</Text>
            {availableCartons.length === 0 ? (
              <View style={styles.noCartonsContainer}>
                {allCartonsStatus.received === allCartonsStatus.total &&
                allCartonsStatus.total > 0 ? (
                  <>
                    <Text style={[styles.noCartonsTitle, { color: "#4CAF50" }]}>
                      ✅ All Cartons Completed
                    </Text>
                    <Text style={styles.noCartonsText}>
                      All {allCartonsStatus.total} cartons have been
                      successfully received and sorted.
                    </Text>
                    <Text style={styles.noCartonsSubtext}>
                      You can proceed to the next step: BOX Management.
                    </Text>
                  </>
                ) : allCartonsStatus.inReceivingByCurrentUser > 0 ? (
                  <>
                    <Text style={styles.noCartonsTitle}>
                      ⚠️ Cartons In Progress
                    </Text>
                    <Text style={styles.noCartonsText}>
                      You have {allCartonsStatus.inReceivingByCurrentUser} carton(s)
                      currently being processed.
                    </Text>
                    <Text style={styles.noCartonsSubtext}>
                      If this is your carton, try scanning the carton barcode
                      directly above to resume work, or check the Unload screen.
                    </Text>
                    <TouchableOpacity
                      style={styles.goToUnloadButton}
                      onPress={() => navigation.navigate("Unload" as never)}
                    >
                      <Text style={styles.goToUnloadButtonText}>
                        Check Carton Status →
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={styles.noCartonsTitle}>
                      ⚠️ No Unloaded Cartons
                    </Text>
                    <Text style={styles.noCartonsText}>
                      You need to unload cartons first before receiving and
                      sorting them.
                    </Text>
                    <Text style={styles.noCartonsSubtext}>
                      Go to Step 2: Unload to scan supplier cartons.
                    </Text>
                    <TouchableOpacity
                      style={styles.goToUnloadButton}
                      onPress={() => navigation.navigate("Unload" as never)}
                    >
                      <Text style={styles.goToUnloadButtonText}>
                        Go to Unload Screen →
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            ) : (
              <FlatList
                data={availableCartons}
                keyExtractor={(item) => item.carton_id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.cartonSelectItem}
                    onPress={() => handleCartonScan(item.carton_id)}
                  >
                    <View style={styles.cartonSelectHeader}>
                      <Text style={styles.cartonSelectId}>
                        {item.carton_id}
                      </Text>
                      <StatusBadge status={item.status} />
                    </View>
                    {item.status === "Receiving" && item.locked_by && (
                      <View style={styles.cartonLockInfo}>
                        <Text style={styles.cartonLockText}>
                          🔒 Locked by: {item.locked_by}
                        </Text>
                        {item.locked_on && (
                          <Text style={styles.cartonLockTime}>
                            {new Date(item.locked_on).toLocaleString()}
                          </Text>
                        )}
                      </View>
                    )}
                    {item.status === "Unloaded" && (
                      <Text style={styles.tapToSelect}>Tap to select →</Text>
                    )}
                  </TouchableOpacity>
                )}
                scrollEnabled={false}
              />
            )}
          </View>
        )}

        {lockedCarton && (
          <>
            <TouchableOpacity
              style={[
                styles.section,
                {
                  borderWidth: 3,
                  borderColor: "#FF0000",
                  backgroundColor: "#FFF9E6",
                },
              ]}
              onPress={async () => {
                console.log("Expected Items clicked");
                if (!(await refreshLockedCartonScannedQtyFromBackend())) return;
                setShowExpectedItemsModal(true);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.expectedItemsHeaderRow}>
                <Text
                  style={[
                    styles.sectionTitle,
                    { color: "#FF0000", fontSize: 20 },
                  ]}
                >
                  ✅ Expected Items (NEW UI)
                </Text>
                <TouchableOpacity
                  style={styles.createDistributionCTNButton}
                  onPress={() => {
                    navigation.navigate("BoxManagement" as never);
                  }}
                >
                  <Text style={styles.createDistributionCTNButtonText}>
                    📦 Create Distribution CTN
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.cartonBadgeInline}>
                <Text style={styles.cartonTextInline}>
                  Carton: {lockedCarton}
                </Text>
              </View>
              <Text
                style={{
                  fontSize: 12,
                  color: "#FF0000",
                  marginBottom: 4,
                  fontWeight: "bold",
                }}
              >
                📋 Tap for lines where sorted qty must match shipped qty
              </Text>
              <TouchableOpacity
                style={styles.clickableSectionHeader}
                onPress={async () => {
                  console.log("View All Items clicked");
                  if (!(await refreshLockedCartonScannedQtyFromBackend())) return;
                  setShowExpectedItemsModal(true);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.clickableSectionText}>
                  {cartonItems.length === 0
                    ? "Carton lines"
                    : incompleteItems.length === 0
                      ? `All ${cartonItems.length} line${
                          cartonItems.length !== 1 ? "s" : ""
                        } match shipped qty — ready to finish`
                      : `${incompleteItems.length} line${
                          incompleteItems.length !== 1 ? "s" : ""
                        } need qty = shipped · ${cartonItems.length} on carton`}
                </Text>
                <Text style={styles.clickableSectionArrow}>→</Text>
              </TouchableOpacity>
              {cartonLinesLoading ? (
                <Text style={styles.emptyText}>Loading items...</Text>
              ) : cartonLinesLoadError ? (
                <Text style={styles.emptyText}>{cartonLinesLoadError}</Text>
              ) : cartonItems.length === 0 ? (
                <Text style={styles.emptyText}>
                  No expected lines for this carton. The app already tried loading
                  them from the server when possible. If you are offline, or the
                  server has no line data, open ASN list or Sync Center and
                  refresh this ASN on this device, then return here.
                </Text>
              ) : lastScannedItem ? (
                (() => {
                  const item = cartonItems.find((ci) =>
                    itemCodesMatchForAllocation(ci.item_code, lastScannedItem)
                  );
                  if (!item)
                    return <Text style={styles.emptyText}>Item not found</Text>;
                  const scannedQty = scannedQtyLookup(
                    scannedQuantities,
                    item.item_code
                  );
                  const remainingQty = item.shipped_qty - scannedQty;
                  const isComplete = remainingQty <= 0;
                  return (
                    <View
                      style={[
                        styles.lastItemCard,
                        isComplete && styles.lastItemCardComplete,
                      ]}
                    >
                      <Text style={styles.lastItemLabel}>Last Scanned:</Text>
                      <Text style={styles.lastItemCode}>{item.item_code}</Text>
                      <View style={styles.lastItemDetails}>
                        <Text style={styles.lastItemDetail}>
                          ASN: {item.shipped_qty}
                        </Text>
                        <Text style={styles.lastItemDetail}>
                          Scanned: {scannedQty}
                        </Text>
                        <Text style={styles.lastItemDetail}>
                          Remaining: {remainingQty}
                        </Text>
                      </View>
                    </View>
                  );
                })()
              ) : (
                <Text style={styles.emptyText}>
                  Your last sorted item appears here after each scan to a BOX.
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.section,
                {
                  borderWidth: 3,
                  borderColor: "#00FF00",
                  backgroundColor: "#E6F9FF",
                },
              ]}
              onPress={() => {
                console.log("Scanned Items clicked");
                setShowScannedItemsModal(true);
              }}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.sectionTitle,
                  { color: "#00AA00", fontSize: 20 },
                ]}
              >
                ✅ Scanned Items (NEW UI)
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: "#00AA00",
                  marginBottom: 4,
                  fontWeight: "bold",
                }}
              >
                📋 Tap to view all scanned items
              </Text>
              <TouchableOpacity
                style={styles.clickableSectionHeader}
                onPress={() => {
                  console.log("View All Scanned clicked");
                  setShowScannedItemsModal(true);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.clickableSectionText}>
                  View All Scanned ({Object.keys(scannedQuantities).length})
                </Text>
                <Text style={styles.clickableSectionArrow}>→</Text>
              </TouchableOpacity>
              {Object.keys(scannedQuantities).length === 0 ? (
                <Text style={styles.emptyText}>No items scanned yet</Text>
              ) : lastScannedItem &&
                scannedQtyLookup(scannedQuantities, lastScannedItem) > 0 ? (
                (() => {
                  const itemBoxes = scannedItems
                    .filter((si) =>
                      itemCodesMatchForAllocation(
                        si.item_code,
                        lastScannedItem
                      )
                    )
                    .map((si) => si.box_id)
                    .filter((boxId) => boxId && boxId !== "" && boxId !== null) // Filter out null/empty box_ids
                    .filter(
                      (boxId, index, self) => self.indexOf(boxId) === index
                    );
                  return (
                    <View style={styles.lastItemCard}>
                      <Text style={styles.lastItemLabel}>Last Scanned:</Text>
                      <Text style={styles.lastItemCode}>{lastScannedItem}</Text>
                      <View style={styles.lastItemDetails}>
                        <Text style={styles.lastItemDetail}>
                          Qty:{" "}
                          {scannedQtyLookup(scannedQuantities, lastScannedItem)}
                        </Text>
                        {itemBoxes.length > 0 && (
                          <Text style={styles.lastItemDetail}>
                            BOXes: {itemBoxes.slice(0, 3).join(", ")}
                            {itemBoxes.length > 3 ? "..." : ""}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })()
              ) : (
                <Text style={styles.emptyText}>Tap to view scanned items</Text>
              )}
            </TouchableOpacity>

            {/* Summary: TO Allocated vs Remaining (Putaway) */}
            <View
              style={[
                styles.section,
                {
                  backgroundColor: "#F0F8FF",
                  borderWidth: 2,
                  borderColor: "#2196F3",
                },
              ]}
            >
              <Text
                style={[
                  styles.sectionTitle,
                  { color: "#1976D2", marginBottom: 12 },
                ]}
              >
                📊 Summary
              </Text>
              <View style={styles.summaryGrid}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>ASN Qty</Text>
                  <Text
                    style={[
                      styles.summaryValue,
                      { fontSize: 18, fontWeight: "bold" },
                    ]}
                  >
                    {summaryTotals.totalASNQty}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Scanned</Text>
                  <Text
                    style={[
                      styles.summaryValue,
                      { fontSize: 18, fontWeight: "bold", color: "#2196F3" },
                    ]}
                  >
                    {summaryTotals.totalScannedQty}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Remaining</Text>
                  <Text
                    style={[
                      styles.summaryValue,
                      {
                        fontSize: 18,
                        fontWeight: "bold",
                        color:
                          summaryTotals.totalRemainingForPutaway > 0
                            ? "#FF9800"
                            : "#4CAF50",
                      },
                    ]}
                  >
                    {summaryTotals.totalRemainingForPutaway}
                  </Text>
                </View>
              </View>
              {summaryTotals.totalTOAllocatedQty > 0 && (
                <View
                  style={{
                    marginTop: 12,
                    padding: 10,
                    backgroundColor: "#E3F2FD",
                    borderRadius: 8,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      color: "#1976D2",
                      fontWeight: "600",
                      marginBottom: 4,
                    }}
                  >
                    TO Allocation Status:
                  </Text>
                  <Text style={{ fontSize: 11, color: "#424242" }}>
                    • TO Allocated: {summaryTotals.totalTOAllocatedQty} |
                    Scanned: {summaryTotals.toAllocatedScanned} | Remaining:{" "}
                    {summaryTotals.toAllocatedRemaining}
                  </Text>
                  {summaryTotals.totalRemainingForPutaway > 0 &&
                    summaryTotals.totalRemainingForPutaway !==
                      summaryTotals.toAllocatedRemaining && (
                      <Text
                        style={{
                          fontSize: 11,
                          color: "#FF9800",
                          marginTop: 4,
                          fontWeight: "600",
                        }}
                      >
                        •{" "}
                        {summaryTotals.totalRemainingForPutaway -
                          summaryTotals.toAllocatedRemaining}{" "}
                        items will go to Putaway (not in TO)
                      </Text>
                    )}
                </View>
              )}
              {/* ✅ PERMANENT FIX: Show message when ALL TO items are scanned (across all cartons) */}
              {summaryTotals.toAllocatedRemaining === 0 &&
                summaryTotals.totalTOAllocatedQty > 0 &&
                summaryTotals.totalRemainingForPutaway > 0 && (
                  <View
                    style={{
                      marginTop: 8,
                      padding: 8,
                      backgroundColor: "#FFF3E0",
                      borderRadius: 6,
                      borderLeftWidth: 3,
                      borderLeftColor: "#FF9800",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        color: "#E65100",
                        fontWeight: "600",
                      }}
                    >
                      ℹ️ All TO-allocated items scanned. Remaining{" "}
                      {summaryTotals.totalRemainingForPutaway} items will be
                      moved to Putaway.
                    </Text>
                  </View>
                )}
            </View>

            <TouchableOpacity
              style={[
                styles.button,
                (loading || !canFinishCarton) && styles.buttonDisabled,
              ]}
              onPress={handleFinishCarton}
              disabled={loading || !canFinishCarton}
            >
              <Text style={styles.buttonText}>
                {loading
                  ? "Completing..."
                  : shortageItems.length > 0
                    ? "Finish With Shortage"
                    : "Finish Carton"}
              </Text>
              {overageItems.length > 0 && !loading && (
                <Text style={styles.buttonSubtext}>
                  Over quantity found. Correct scanned qty or raise overage
                  approval before finishing.
                </Text>
              )}
              {shortageItems.length > 0 && overageItems.length === 0 && !loading && (
                <Text style={styles.buttonSubtext}>
                  {shortageItems.length} line
                  {shortageItems.length !== 1 ? "s" : ""} short. Finish will
                  record a shortage discrepancy.
                </Text>
              )}
              {!areAllItemsReceived && shortageItems.length === 0 && overageItems.length === 0 && !loading && (
                <Text style={styles.buttonSubtext}>
                  Finish when every line has sorted qty equal to shipped qty on
                  this carton (not more, not less).
                </Text>
              )}
              {areAllItemsReceived && putawayItemsNotInTO > 0 && !loading && (
                  <Text
                    style={[
                      styles.buttonSubtext,
                      { color: "#FF9800", fontWeight: "600" },
                    ]}
                  >
                    {putawayItemsNotInTO} items will go to Putaway
                    {summaryTotals.totalTOAllocatedQty > 0
                      ? " (not in TO)"
                      : ""}
                  </Text>
                )}
            </TouchableOpacity>
          </>
        )}

        {!lockedCarton && (
          <TouchableOpacity
            style={[
              styles.nextButton,
              !canProceed && styles.nextButtonDisabled,
            ]}
            onPress={() => navigation.navigate("BoxManagement" as never)}
            disabled={!canProceed}
          >
            <Text style={styles.nextButtonText}>Next →</Text>
            <Text style={styles.nextButtonSubtext}>BOX Management</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Item Details Modal */}
      <Modal
        visible={itemDetailsModal?.visible || false}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setItemDetailsModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Item Details</Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setItemDetailsModal(null)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {itemDetailsModal && (
              <ScrollView
                style={styles.modalContent}
                showsVerticalScrollIndicator={true}
              >
                {/* Item Summary Card */}
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryItemCode}>
                    {itemDetailsModal.itemCode}
                  </Text>
                  <View style={styles.summaryGrid}>
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryLabel}>Total Scanned</Text>
                      <Text
                        style={[
                          styles.summaryValue,
                          styles.summaryValueScanned,
                        ]}
                      >
                        {itemDetailsModal.scannedQty}
                      </Text>
                    </View>
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryLabel}>TO Qty</Text>
                      <Text
                        style={[styles.summaryValue, styles.summaryValueTO]}
                      >
                        {itemDetailsModal.totalTOQty}
                      </Text>
                    </View>
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryLabel}>Putaway Qty</Text>
                      <Text style={[styles.summaryValue, { color: "#FF9800" }]}>
                        {itemDetailsModal.putawayQty || 0}
                      </Text>
                    </View>
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryLabel}>
                        Total (TO + Putaway)
                      </Text>
                      <Text
                        style={[
                          styles.summaryValue,
                          { color: "#2196F3", fontWeight: "bold" },
                        ]}
                      >
                        {(itemDetailsModal.totalTOQty || 0) +
                          (itemDetailsModal.putawayQty || 0)}
                      </Text>
                    </View>
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryLabel}>ASN Qty</Text>
                      <Text style={[styles.summaryValue, { color: "#424242" }]}>
                        {itemDetailsModal.asnQty ||
                          (() => {
                            const cartonItem = cartonItems.find(
                              (ci) => ci.item_code === itemDetailsModal.itemCode
                            );
                            return cartonItem?.shipped_qty || 0;
                          })()}
                      </Text>
                    </View>
                    <View style={styles.summaryItem}>
                      <Text style={styles.summaryLabel}>Remaining</Text>
                      <Text
                        style={[
                          styles.summaryValue,
                          itemDetailsModal.remainingQty === 0
                            ? styles.summaryValueComplete
                            : itemDetailsModal.remainingQty > 0
                            ? styles.summaryValueRemaining
                            : styles.summaryValueWarning,
                        ]}
                      >
                        {itemDetailsModal.remainingQty}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Allocations by Store */}
                {itemDetailsModal.allocations.length > 0 ? (
                  <View style={styles.allocationsSection}>
                    <Text style={styles.allocationsTitle}>
                      Allocations by Store
                    </Text>
                    {itemDetailsModal.allocations.map((alloc, index) => {
                      // Check if this is a Putaway section
                      const isPutaway = alloc.store.includes("- Putaway");

                      return (
                        <View key={index} style={styles.allocationCard}>
                          <View style={styles.allocationHeader}>
                            <Text style={styles.allocationStore}>
                              {alloc.store}
                            </Text>
                            <View style={styles.allocationBadges}>
                              {/* Only show Allocated badge for non-Putaway sections */}
                              {!isPutaway && (
                                <View style={styles.allocationBadge}>
                                  <Text style={styles.allocationBadgeText}>
                                    Allocated: {alloc.allocatedQty}
                                  </Text>
                                </View>
                              )}
                              <View
                                style={[
                                  styles.allocationBadge,
                                  !isPutaway &&
                                  alloc.scannedQty > alloc.allocatedQty
                                    ? { backgroundColor: "#FF6B6B" }
                                    : styles.allocationBadgeScanned,
                                ]}
                              >
                                <Text style={styles.allocationBadgeText}>
                                  Scanned: {alloc.scannedQty}
                                  {!isPutaway &&
                                    alloc.scannedQty > alloc.allocatedQty &&
                                    " ⚠️"}
                                </Text>
                              </View>
                            </View>
                          </View>

                          {/* Only show warning for non-Putaway sections */}
                          {!isPutaway &&
                            alloc.scannedQty > alloc.allocatedQty && (
                              <View style={styles.warningBanner}>
                                <Text style={styles.warningText}>
                                  ⚠️ Scanned quantity exceeds allocated by{" "}
                                  {alloc.scannedQty - alloc.allocatedQty}
                                </Text>
                              </View>
                            )}

                          <TouchableOpacity
                            style={styles.editButton}
                            onPress={() => {
                              console.warn(
                                `🔘 Edit button pressed for ${itemDetailsModal.itemCode} in ${alloc.store}`
                              );
                              // For Putaway, use 0 as allocatedQty since there's no TO allocation
                              handleEditScannedQty(
                                itemDetailsModal.itemCode,
                                alloc.store,
                                isPutaway ? 0 : alloc.allocatedQty,
                                alloc.scannedQty
                              );
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.editButtonText}>
                              ✏️ Edit Scanned Qty
                            </Text>
                          </TouchableOpacity>

                          {alloc.boxes.length > 0 && (
                            <View style={styles.boxesSection}>
                              <Text style={styles.boxesLabelModal}>
                                BOXes ({alloc.boxes.length}):
                              </Text>
                              <View style={styles.boxesGrid}>
                                {alloc.boxes.map((boxId, boxIndex) => (
                                  <View
                                    key={boxIndex}
                                    style={styles.boxChipModal}
                                  >
                                    <Text style={styles.boxChipTextModal}>
                                      {boxId}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <View style={styles.noAllocationCard}>
                    <Text style={styles.noAllocationText}>
                      ⚠️ No TO allocation found for this item.
                    </Text>
                  </View>
                )}
              </ScrollView>
            )}

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCloseButtonLarge}
                onPress={() => setItemDetailsModal(null)}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Scanned Quantity Modal */}
      <Modal
        visible={editQtyModal?.visible || false}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setEditQtyModal(null);
          setEditQtyValue("");
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.editModalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Scanned Quantity</Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => {
                  setEditQtyModal(null);
                  setEditQtyValue("");
                }}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {editQtyModal && (
              <ScrollView
                style={styles.editModalContent}
                contentContainerStyle={styles.editModalContentContainer}
                showsVerticalScrollIndicator={true}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.editQtyInfoCard}>
                  <Text style={styles.editQtyLabel}>Item Code:</Text>
                  <Text style={styles.editQtyValue}>
                    {editQtyModal.itemCode}
                  </Text>
                </View>
                <View style={styles.editQtyInfoCard}>
                  <Text style={styles.editQtyLabel}>Store:</Text>
                  <Text style={styles.editQtyValue}>{editQtyModal.store}</Text>
                </View>
                <View style={styles.editQtyInfoCard}>
                  <Text style={styles.editQtyLabel}>Allocated Quantity:</Text>
                  <Text style={styles.editQtyValue}>
                    {editQtyModal.allocatedQty}
                  </Text>
                </View>
                <View style={styles.editQtyInfoCard}>
                  <Text style={styles.editQtyLabel}>Current Scanned:</Text>
                  <Text style={styles.editQtyValue}>
                    {editQtyModal.currentScannedQty}
                  </Text>
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.inputLabel}>New Scanned Quantity:</Text>
                  <TextInput
                    style={styles.quantityInput}
                    value={editQtyValue}
                    onChangeText={setEditQtyValue}
                    keyboardType="numeric"
                    placeholder="Enter quantity"
                    maxLength={10}
                    editable={true}
                    selectTextOnFocus={true}
                    autoFocus={false}
                  />
                  <Text style={styles.inputHint}>
                    Maximum: {editQtyModal.allocatedQty}
                  </Text>
                </View>
              </ScrollView>
            )}

            <View style={styles.editModalFooter}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={() => {
                  setEditQtyModal(null);
                  setEditQtyValue("");
                }}
              >
                <Text style={[styles.modalButtonText, { color: "#000" }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSave]}
                onPress={handleSaveEditedQty}
                disabled={loading}
              >
                <Text style={styles.modalButtonText}>
                  {loading ? "Saving..." : "Save"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Expected Items Modal */}
      <Modal
        visible={showExpectedItemsModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setShowExpectedItemsModal(false);
          setExpectedItemsSearchQuery("");
          setManualQtyItem(null);
          setManualQtyValue("");
          setManualQtyBox(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {cartonItems.length === 0
                  ? "Carton lines"
                  : incompleteItems.length === 0
                    ? `All lines match shipped (${cartonItems.length})`
                    : `Lines to fix (${incompleteItems.length} of ${cartonItems.length})`}
              </Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => {
                  setShowExpectedItemsModal(false);
                  setExpectedItemsSearchQuery("");
                  setManualQtyItem(null);
                  setManualQtyValue("");
                  setManualQtyBox(null);
                }}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search by item code..."
                value={expectedItemsSearchQuery}
                onChangeText={setExpectedItemsSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <FlatList
              data={cartonItems.filter((item) => {
                if (expectedItemsSearchQuery) {
                  return item.item_code
                    .toLowerCase()
                    .includes(expectedItemsSearchQuery.toLowerCase());
                }

                return true;
              })}
              extraData={{
                scannedQuantities,
                lockedCarton,
                incompleteItems,
              }}
              keyExtractor={(item) =>
                `${item.item_code}-${item.carton_id}-${lockedCarton}`
              }
              renderItem={renderExpectedItem}
              style={styles.modalContent}
              contentContainerStyle={styles.modalContentContainer}
              ListEmptyComponent={
                <View style={styles.emptyModalContainer}>
                  <Text style={styles.emptyModalText}>
                    {expectedItemsSearchQuery
                      ? "No items found matching your search"
                      : cartonLinesLoading
                        ? "Loading carton lines..."
                        : cartonLinesLoadError
                          ? cartonLinesLoadError
                          : cartonItems.length === 0
                            ? "No carton lines after local load and server fetch. Check network, carton id, then refresh this ASN in ASN list or Sync Center."
                            : "No items available"}
                  </Text>
                </View>
              }
            />

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCloseButtonLarge}
                onPress={() => {
                  setShowExpectedItemsModal(false);
                  setExpectedItemsSearchQuery("");
                  setManualQtyItem(null);
                  setManualQtyValue("");
                  setManualQtyBox(null);
                }}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Scanned Items Modal */}
      <Modal
        visible={showScannedItemsModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setShowScannedItemsModal(false);
          setScannedItemsSearchQuery("");
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Scanned Items ({scannedItemsData.length})
              </Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => {
                  setShowScannedItemsModal(false);
                  setScannedItemsSearchQuery("");
                }}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search by item code..."
                value={scannedItemsSearchQuery}
                onChangeText={setScannedItemsSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            <FlatList
              data={scannedItemsData.filter(
                (item) =>
                  !scannedItemsSearchQuery ||
                  item.item_code
                    .toLowerCase()
                    .includes(scannedItemsSearchQuery.toLowerCase())
              )}
              keyExtractor={(item) => item.item_code}
              renderItem={renderScannedItem}
              style={styles.modalContent}
              contentContainerStyle={styles.modalContentContainer}
              ListEmptyComponent={
                <View style={styles.emptyModalContainer}>
                  <Text style={styles.emptyModalText}>
                    {scannedItemsSearchQuery
                      ? "No items found matching your search"
                      : "No items scanned yet"}
                  </Text>
                </View>
              }
            />

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCloseButtonLarge}
                onPress={() => {
                  setShowScannedItemsModal(false);
                  setScannedItemsSearchQuery("");
                }}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Current Item Distribution Details Modal */}
      <Modal
        visible={showDistributionDetailsModal}
        transparent={true}
        animationType="slide"
        onRequestClose={closeDistributionDetailsModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Distribution Details
                {liveDistributionDetails?.itemCode
                  ? ` - ${liveDistributionDetails.itemCode}`
                  : ""}
              </Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={closeDistributionDetailsModal}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              {liveDistributionDetails &&
              liveDistributionDetails.stores.length > 0 ? (
                <View style={styles.distributionSection}>
                  <Text style={styles.distributionHint}>
                    Scan an open BOX for the store line that still has remaining
                    quantity.
                  </Text>
                  {liveDistributionDetails.toNo && (
                    <Text style={styles.distributionHint}>
                      TO: {liveDistributionDetails.toNo}
                    </Text>
                  )}
                  {liveDistributionDetails.stores
                    .filter((row: any) => Number(row?.remainingQty || 0) > 0)
                    .map((row: any, index: number) => (
                    <View key={`${row.store}-${index}`} style={styles.distributionCard}>
                      <View style={styles.distributionHeader}>
                        <Text style={styles.distributionStore}>{row.store}</Text>
                        <Text
                          style={[
                            styles.distributionRemainingBadge,
                            row.remainingQty === 0
                              ? styles.distributionRemainingDone
                              : row.remainingQty < 0
                                ? styles.distributionRemainingOver
                                : styles.distributionRemainingOpen,
                          ]}
                        >
                          Rem {row.remainingQty}
                        </Text>
                      </View>
                      <View style={styles.distributionQtyRow}>
                        <Text style={styles.distributionQtyText}>
                          TO {row.toQty}
                        </Text>
                        <Text
                          style={[
                            styles.distributionQtyText,
                            styles.distributionScannedText,
                          ]}
                        >
                          Scanned {row.scannedQty}
                        </Text>
                      </View>
                      <Text style={styles.distributionBoxLabel}>
                        Open BOXes
                      </Text>
                      {row.openBoxes.length > 0 ? (
                        <View style={styles.distributionBoxesRow}>
                          {row.openBoxes.slice(0, 4).map((box: any) => {
                            const boxId =
                              typeof box === "string" ? box : box?.box_id;
                            return (
                            <View
                              key={`${row.store}-${boxId}`}
                              style={styles.distributionBoxChip}
                            >
                              <Text style={styles.distributionBoxChipText}>
                                {boxId}
                              </Text>
                            </View>
                            );
                          })}
                          {row.openBoxes.length > 4 && (
                            <Text style={styles.distributionMoreBoxes}>
                              +{row.openBoxes.length - 4} more
                            </Text>
                          )}
                        </View>
                      ) : (
                        <Text style={styles.distributionNoBoxText}>
                          No open BOX found for this store.
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.emptyModalContainer}>
                  <Text style={styles.emptyModalText}>
                    Scan an item first to view distribution details.
                  </Text>
                </View>
              )}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCloseButtonLarge}
                onPress={closeDistributionDetailsModal}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* TO Breakdown Modal */}
      <Modal
        visible={toBreakdownModal?.visible || false}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setToBreakdownModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                TO Breakdown - {toBreakdownModal?.itemCode}
              </Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setToBreakdownModal(null)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              {toBreakdownModal && (
                <>
                  {toBreakdownModal.breakdown.length > 0 ? (
                    <View style={styles.breakdownSection}>
                      {toBreakdownModal.breakdown.map((item, index) => (
                        <View key={index} style={styles.breakdownCard}>
                          <View style={styles.breakdownHeader}>
                            <Text style={styles.breakdownStore}>
                              {item.store}
                            </Text>
                            {item.toQty === 0 && (
                              <Text style={styles.breakdownNoTO}>No TO</Text>
                            )}
                          </View>
                          <View style={styles.breakdownDetails}>
                            {item.toQty > 0 ? (
                              <>
                                <View style={styles.breakdownRow}>
                                  <Text style={styles.breakdownLabel}>
                                    TO Qty:
                                  </Text>
                                  <Text style={styles.breakdownValue}>
                                    {item.toQty}
                                  </Text>
                                </View>
                                <View style={styles.breakdownRow}>
                                  <Text style={styles.breakdownLabel}>
                                    Scanned:
                                  </Text>
                                  <Text
                                    style={[
                                      styles.breakdownValue,
                                      { color: "#2196F3" },
                                    ]}
                                  >
                                    {item.scannedQty}
                                  </Text>
                                </View>
                                {/* Show scanned by carton if available */}
                                {item.scannedByCarton &&
                                  item.scannedByCarton.size > 0 && (
                                    <View
                                      style={{
                                        marginTop: 8,
                                        paddingTop: 8,
                                        borderTopWidth: 1,
                                        borderTopColor: "#E0E0E0",
                                      }}
                                    >
                                      <Text
                                        style={[
                                          styles.breakdownLabel,
                                          { marginBottom: 4, fontSize: 12 },
                                        ]}
                                      >
                                        By Carton:
                                      </Text>
                                      {Array.from(
                                        item.scannedByCarton.entries()
                                      ).map(([cartonId, qty], idx) => (
                                        <View
                                          key={idx}
                                          style={{
                                            flexDirection: "row",
                                            justifyContent: "space-between",
                                            marginVertical: 2,
                                          }}
                                        >
                                          <Text
                                            style={[
                                              styles.breakdownLabel,
                                              { fontSize: 11, color: "#666" },
                                            ]}
                                          >
                                            {cartonId}:
                                          </Text>
                                          <Text
                                            style={[
                                              styles.breakdownValue,
                                              {
                                                fontSize: 11,
                                                color: "#2196F3",
                                              },
                                            ]}
                                          >
                                            {qty}
                                          </Text>
                                        </View>
                                      ))}
                                    </View>
                                  )}
                                <View style={styles.breakdownRow}>
                                  <Text style={styles.breakdownLabel}>
                                    Remaining:
                                  </Text>
                                  <Text
                                    style={[
                                      styles.breakdownValue,
                                      {
                                        color:
                                          item.remainingQty === 0
                                            ? "#4CAF50"
                                            : item.remainingQty > 0
                                            ? "#FF9800"
                                            : "#F44336",
                                        fontWeight:
                                          item.remainingQty < 0
                                            ? "bold"
                                            : "normal",
                                      },
                                    ]}
                                  >
                                    {item.remainingQty}
                                  </Text>
                                </View>
                                {item.remainingQty < 0 && (
                                  <View style={styles.breakdownWarning}>
                                    <Text style={styles.breakdownWarningText}>
                                      ⚠️ Over-scanned by{" "}
                                      {Math.abs(item.remainingQty)} units
                                    </Text>
                                  </View>
                                )}
                                <TouchableOpacity
                                  style={styles.breakdownEditButton}
                                  onPress={() => {
                                    if (toBreakdownModal?.itemCode) {
                                      handleEditScannedQty(
                                        toBreakdownModal.itemCode,
                                        item.store,
                                        item.toQty,
                                        item.scannedQty
                                      );
                                    }
                                  }}
                                >
                                  <Text style={styles.breakdownEditButtonText}>
                                    ✏️ Edit Scanned Qty
                                  </Text>
                                </TouchableOpacity>
                              </>
                            ) : (
                              <>
                                <View style={styles.breakdownRow}>
                                  <Text style={styles.breakdownLabel}>
                                    Scanned:
                                  </Text>
                                  <Text
                                    style={[
                                      styles.breakdownValue,
                                      { color: "#2196F3" },
                                    ]}
                                  >
                                    {item.scannedQty}
                                  </Text>
                                </View>
                                {/* Show scanned by carton if available */}
                                {item.scannedByCarton &&
                                  item.scannedByCarton.size > 0 && (
                                    <View
                                      style={{
                                        marginTop: 8,
                                        paddingTop: 8,
                                        borderTopWidth: 1,
                                        borderTopColor: "#E0E0E0",
                                      }}
                                    >
                                      <Text
                                        style={[
                                          styles.breakdownLabel,
                                          { marginBottom: 4, fontSize: 12 },
                                        ]}
                                      >
                                        By Carton:
                                      </Text>
                                      {Array.from(
                                        item.scannedByCarton.entries()
                                      ).map(([cartonId, qty], idx) => (
                                        <View
                                          key={idx}
                                          style={{
                                            flexDirection: "row",
                                            justifyContent: "space-between",
                                            marginVertical: 2,
                                          }}
                                        >
                                          <Text
                                            style={[
                                              styles.breakdownLabel,
                                              { fontSize: 11, color: "#666" },
                                            ]}
                                          >
                                            {cartonId}:
                                          </Text>
                                          <Text
                                            style={[
                                              styles.breakdownValue,
                                              {
                                                fontSize: 11,
                                                color: "#2196F3",
                                              },
                                            ]}
                                          >
                                            {qty}
                                          </Text>
                                        </View>
                                      ))}
                                    </View>
                                  )}
                              </>
                            )}
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <View style={styles.emptyModalContainer}>
                      <Text style={styles.emptyModalText}>
                        No TO allocation found for this item
                      </Text>
                    </View>
                  )}
                </>
              )}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCloseButtonLarge}
                onPress={() => setToBreakdownModal(null)}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* CTN ID Prompt Modal */}
      <Modal
        visible={showCTNIdPrompt}
        transparent={true}
        animationType="slide"
        onRequestClose={handleCTNIdPromptCancel}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.editModalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Enter BOX ID</Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={handleCTNIdPromptCancel}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.editModalContent}>
              <Text style={styles.inputLabel}>
                {pendingItemScan
                  ? "Scan the destination BOX (open box from Box Management). Do not scan the supplier carton barcode:"
                  : pendingBoxScan
                  ? "Please scan or enter the BOX ID for this BOX:"
                  : "Please scan or enter the BOX ID:"}
              </Text>
              <TextInput
                ref={ctnIdPromptInputRef}
                style={styles.quantityInput}
                value={ctnIdPromptValue}
                onChangeText={(text) => {
                  console.warn("========== TextInput onChangeText ==========");
                  console.warn("text:", text);
                  console.warn("text length:", text.length);
                  // Store the current value in a closure variable for immediate access
                  // This avoids React state timing issues when onSubmitEditing fires
                  (global as any).currentCtnIdPromptValue = text;
                  setCtnIdPromptValue(text);
                  // Auto-submit when BOX ID format is detected (for barcode scanners)
                  // This handles cases where scanner doesn't send Enter key
                  // Use a longer delay to ensure full barcode is received (scanners may send in chunks)
                  const normalized = text.trim().toUpperCase();
                  console.warn("normalized:", normalized);

                  // Clear any existing timeout to debounce rapid changes
                  // This ensures we wait for the scanner to finish sending all characters
                  if ((global as any).ctnIdAutoSubmitTimeout) {
                    clearTimeout((global as any).ctnIdAutoSubmitTimeout);
                    (global as any).ctnIdAutoSubmitTimeout = null;
                  }

                  if (
                    (normalized.startsWith("BOX-") ||
                      normalized.startsWith("PAW-")) &&
                    normalized.length >= 20
                  ) {
                    // BOX ID format detected (regular or Putaway), auto-submit after delay
                    // Use longer delay (800ms) to ensure scanner has finished sending all characters
                    // This simulates pressing Enter key automatically after scan completes
                    (global as any).ctnIdAutoSubmitTimeout = setTimeout(() => {
                      // Use the text parameter from closure to ensure we have the complete value
                      // Don't use ctnIdPromptValue from state as it might be stale
                      const finalText = text.trim();
                      const finalNormalized = finalText.toUpperCase();

                      // Double-check: value must be complete BOX ID format (regular or Putaway)
                      if (
                        (finalNormalized.startsWith("BOX-") ||
                          finalNormalized.startsWith("PAW-")) &&
                        finalNormalized.length >= 20
                      ) {
                        // Pass the text directly to avoid state timing issues
                        handleCTNIdPromptSubmit(finalText);
                      }
                      (global as any).ctnIdAutoSubmitTimeout = null;
                    }, 800);
                  } else if (
                    normalized.length >= 6 &&
                    normalized.length <= 48 &&
                    /^[A-Z0-9._-]+$/.test(normalized) &&
                    !normalized.startsWith("CTN-") &&
                    !normalized.startsWith("TC-") &&
                    !(
                      lockedCarton &&
                      normalized === String(lockedCarton).trim().toUpperCase()
                    )
                  ) {
                    // Custom open box ids (e.g. store-style ids) — not supplier carton on this lock
                    (global as any).ctnIdAutoSubmitTimeout = setTimeout(() => {
                      const finalText = text.trim();
                      const fn = finalText.toUpperCase();
                      if (
                        fn.length >= 6 &&
                        fn.length <= 48 &&
                        /^[A-Z0-9._-]+$/.test(fn) &&
                        !fn.startsWith("CTN-") &&
                        !fn.startsWith("TC-") &&
                        !(
                          lockedCarton &&
                          fn === String(lockedCarton).trim().toUpperCase()
                        )
                      ) {
                        handleCTNIdPromptSubmit(finalText);
                      }
                      (global as any).ctnIdAutoSubmitTimeout = null;
                    }, 700);
                  }
                }}
                placeholder="BOX-…, PAW-…, or custom Open box (not carton CN…)"
                autoFocus={true}
                autoCapitalize="characters"
                onSubmitEditing={() => {
                  // Clear any pending auto-submit timeout to prevent duplicate submission
                  if ((global as any).ctnIdAutoSubmitTimeout) {
                    clearTimeout((global as any).ctnIdAutoSubmitTimeout);
                    (global as any).ctnIdAutoSubmitTimeout = null;
                  }

                  // Get the current value from closure variable to avoid state timing issues
                  const currentValue =
                    (global as any).currentCtnIdPromptValue ||
                    ctnIdPromptValue ||
                    "";
                  // Pass the value directly to avoid state timing issues
                  if (currentValue) {
                    handleCTNIdPromptSubmit(currentValue);
                  } else {
                    Alert.alert(
                      "BOX ID Required",
                      "Please enter a valid BOX ID."
                    );
                  }
                }}
                returnKeyType="done"
                blurOnSubmit={false}
              />
              {pendingItemScan && (
                <Text style={styles.inputHint}>
                  Scanned item: {pendingItemScan}
                </Text>
              )}
              {pendingBoxScan && (
                <Text style={styles.inputHint}>
                  Scanned BOX: {pendingBoxScan}
                </Text>
              )}
            </View>

            <View style={styles.editModalFooter}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonCancel]}
                onPress={handleCTNIdPromptCancel}
              >
                <Text style={[styles.modalButtonText, { color: "#000" }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalButtonSave]}
                onPress={() => {
                  // Clear any pending auto-submit timeout to prevent duplicate submission
                  if ((global as any).ctnIdAutoSubmitTimeout) {
                    clearTimeout((global as any).ctnIdAutoSubmitTimeout);
                    (global as any).ctnIdAutoSubmitTimeout = null;
                  }

                  // Get the current value from closure variable to avoid state timing issues
                  const currentValue =
                    (global as any).currentCtnIdPromptValue ||
                    ctnIdPromptValue ||
                    "";
                  // Pass the value directly to avoid state timing issues
                  if (currentValue) {
                    handleCTNIdPromptSubmit(currentValue);
                  } else {
                    Alert.alert(
                      "BOX ID Required",
                      "Please enter a valid BOX ID."
                    );
                  }
                }}
              >
                <Text style={styles.modalButtonText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create Distribution CTN Modal */}
      <Modal
        visible={showCreateCTNModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowCreateCTNModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Distribution CTN</Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setShowCreateCTNModal(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalContent}>
              {/* TO Stores Section */}
              {toStoresForCTN.length > 0 ? (
                <View style={styles.createCTNSection}>
                  <Text style={styles.createCTNSectionTitle}>
                    📦 Create CTN for TO Stores
                  </Text>
                  <Text style={styles.createCTNSectionSubtitle}>
                    Select a store from Transfer Order to create a Distribution
                    CTN
                  </Text>
                  {toStoresForCTN.map((store) => (
                    <TouchableOpacity
                      key={store}
                      style={[
                        styles.createCTNStoreButton,
                        creatingCTNForStore === store &&
                          styles.createCTNStoreButtonCreating,
                        loading &&
                          creatingCTNForStore !== store &&
                          styles.createCTNStoreButtonDisabled,
                      ]}
                      onPress={() => handleCreateCTNForStore(store)}
                      disabled={loading && creatingCTNForStore !== store}
                    >
                      <Text style={styles.createCTNStoreButtonText}>
                        {creatingCTNForStore === store
                          ? "Creating..."
                          : `+ Create CTN for ${store}`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <View style={styles.createCTNSection}>
                  <Text style={styles.createCTNSectionTitle}>📦 TO Stores</Text>
                  <Text style={styles.emptyText}>
                    No stores found in Transfer Order. Please check the TO
                    allocations.
                  </Text>
                </View>
              )}

              {/* Remaining Items / Putaway Section */}
              {remainingItemsQty > 0 && (
                <View
                  style={[
                    styles.createCTNSection,
                    {
                      backgroundColor: "#FFF3E0",
                      borderLeftWidth: 4,
                      borderLeftColor: "#FF9800",
                    },
                  ]}
                >
                  <Text
                    style={[styles.createCTNSectionTitle, { color: "#E65100" }]}
                  >
                    📦 Remaining Items for Putaway
                  </Text>
                  <View style={styles.remainingItemsInfo}>
                    <Text style={styles.remainingItemsLabel}>
                      Total Shipped (ASN Qty):
                    </Text>
                    <Text style={styles.remainingItemsValue}>
                      {summaryTotals.totalASNQty ||
                        cartonItems.reduce(
                          (sum, item) => sum + (item.shipped_qty || 0),
                          0
                        )}
                    </Text>
                  </View>
                  <View style={styles.remainingItemsInfo}>
                    <Text style={styles.remainingItemsLabel}>
                      Total TO Allocated:
                    </Text>
                    <Text style={styles.remainingItemsValue}>
                      {summaryTotals.totalTOAllocatedQty}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.remainingItemsInfo,
                      {
                        marginTop: 8,
                        paddingTop: 8,
                        borderTopWidth: 1,
                        borderTopColor: "#FFE0B2",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.remainingItemsLabel,
                        { fontWeight: "bold", fontSize: 16 },
                      ]}
                    >
                      Remaining (Putaway):
                    </Text>
                    <Text
                      style={[
                        styles.remainingItemsValue,
                        { fontWeight: "bold", fontSize: 16, color: "#E65100" },
                      ]}
                    >
                      {remainingItemsQty} items
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.createCTNSectionSubtitle,
                      { marginTop: 8, fontStyle: "italic" },
                    ]}
                  >
                    Formula: Total Shipped - Total TO Allocated = Remaining
                    Items
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.createPutawayButton,
                      loading && styles.createPutawayButtonDisabled,
                    ]}
                    onPress={handleCreatePutawayBOX}
                    disabled={loading}
                  >
                    <Text style={styles.createPutawayButtonText}>
                      {loading
                        ? "Creating..."
                        : `+ Create Putaway BOX (${remainingItemsQty} items)`}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {remainingItemsQty === 0 && toStoresForCTN.length > 0 && (
                <View style={styles.createCTNSection}>
                  <Text style={styles.emptyText}>
                    ✅ All items are allocated to Transfer Order. No Putaway
                    needed.
                  </Text>
                </View>
              )}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCloseButtonLarge}
                onPress={() => setShowCreateCTNModal(false)}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingBottom: 32,
  },
  stateIndicator: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  resendReceiveDataButton: {
    backgroundColor: "#34C759",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    alignItems: "center",
  },
  resendReceiveDataButtonDisabled: {
    opacity: 0.6,
  },
  resendReceiveDataButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  stateText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 8,
  },
  cartonBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    padding: 8,
    borderRadius: 4,
  },
  cartonText: {
    color: "#fff",
    fontWeight: "600",
  },
  lockInfoBadge: {
    marginTop: 8,
    padding: 8,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 4,
  },
  lockInfoText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  lockInfoTime: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: 11,
    marginTop: 2,
  },
  section: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 16,
    color: "#1976D2",
    borderBottomWidth: 2,
    borderBottomColor: "#E3F2FD",
    paddingBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  cartonIndicator: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1976D2",
    backgroundColor: "#E3F2FD",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  cartonBadgeInline: {
    marginTop: 8,
    marginBottom: 8,
    alignSelf: "flex-start",
  },
  cartonTextInline: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1976D2",
    backgroundColor: "#E3F2FD",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
    marginBottom: 10,
    borderRadius: 8,
    backgroundColor: "#FAFAFA",
    borderLeftWidth: 4,
    borderLeftColor: "#2196F3",
  },
  itemRowComplete: {
    backgroundColor: "#E8F5E9",
    borderLeftColor: "#4CAF50",
    opacity: 0.9,
  },
  itemInfo: {
    flex: 1,
  },
  itemCode: {
    fontSize: 17,
    fontWeight: "bold",
    color: "#1976D2",
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  qtyContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F5F5",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  qtyLabel: {
    fontSize: 12,
    color: "#666",
    fontWeight: "600",
    marginRight: 4,
  },
  qtyValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#333",
  },
  qtyValueScanned: {
    color: "#2196F3",
  },
  qtyValueComplete: {
    color: "#4CAF50",
  },
  qtyValueLow: {
    color: "#FF9800",
  },
  completeBadge: {
    backgroundColor: "#4CAF50",
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
    shadowColor: "#4CAF50",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  completeText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  scannedItemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 14,
    marginBottom: 10,
    borderRadius: 8,
    backgroundColor: "#F1F8F4",
    borderWidth: 1,
    borderColor: "#C8E6C9",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  scannedItemInfo: {
    flex: 1,
  },
  scannedItemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  scannedQtyBadge: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 40,
    alignItems: "center",
  },
  scannedQtyText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
  },
  boxesList: {
    marginTop: 4,
  },
  boxesLabel: {
    fontSize: 11,
    color: "#666",
    marginBottom: 4,
    fontWeight: "600",
  },
  boxesChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  boxChip: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  boxChipText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  tapForDetails: {
    fontSize: 20,
    marginLeft: 8,
  },
  boxId: {
    fontSize: 14,
    color: "#4CAF50",
    fontWeight: "600",
  },
  emptyText: {
    color: "#999",
    fontStyle: "italic",
    padding: 20,
    textAlign: "center",
    fontSize: 14,
  },
  button: {
    backgroundColor: "#4CAF50",
    padding: 18,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 24,
    marginBottom: 20,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  buttonSubtext: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: 12,
    marginTop: 4,
    textAlign: "center",
  },
  nextButton: {
    backgroundColor: "#4CAF50",
    padding: 20,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 24,
    marginBottom: 16,
  },
  nextButtonDisabled: {
    backgroundColor: "#ccc",
    opacity: 0.6,
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
  cartonSelectItem: {
    padding: 16,
    backgroundColor: "#E8F5E9",
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#4CAF50",
  },
  cartonSelectHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  cartonSelectId: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#4CAF50",
  },
  cartonLockInfo: {
    marginTop: 8,
    padding: 8,
    backgroundColor: "#FFF3E0",
    borderRadius: 4,
  },
  cartonLockText: {
    fontSize: 12,
    color: "#E65100",
    fontWeight: "600",
  },
  cartonLockTime: {
    fontSize: 11,
    color: "#FF6F00",
    marginTop: 2,
  },
  tapToSelect: {
    fontSize: 12,
    color: "#4CAF50",
    fontStyle: "italic",
    marginTop: 4,
  },
  errorText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#F44336",
    textAlign: "center",
    marginTop: 100,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  createBoxButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  createBoxButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  createBoxSection: {
    backgroundColor: "#f9f9f9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  createBoxLabel: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    color: "#333",
  },
  storeSelector: {
    marginBottom: 12,
  },
  storeSelectorContent: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 16,
  },
  storeButton: {
    minWidth: 100,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#ddd",
    backgroundColor: "#fff",
    alignItems: "center",
  },
  storeButtonActive: {
    borderColor: "#007AFF",
    backgroundColor: "#E3F2FD",
  },
  storeButtonText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "600",
  },
  storeButtonTextActive: {
    color: "#007AFF",
  },
  createBoxSubmitButton: {
    backgroundColor: "#4CAF50",
    padding: 12,
    borderRadius: 6,
    alignItems: "center",
  },
  createBoxSubmitText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  noBoxesContainer: {
    padding: 16,
    backgroundColor: "#FFF3E0",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FFB74D",
  },
  noBoxesText: {
    color: "#E65100",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  boxItem: {
    padding: 12,
    backgroundColor: "#E8F5E9",
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#4CAF50",
  },
  boxItemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  boxItemId: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#4CAF50",
  },
  boxItemStore: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  toggleBoxesButton: {
    backgroundColor: "#f0f0f0",
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  toggleBoxesButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#007AFF",
    textAlign: "center",
  },
  boxesListContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
  },
  noCartonsContainer: {
    padding: 20,
    backgroundColor: "#FFF3E0",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FFB74D",
    alignItems: "center",
  },
  noCartonsTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#E65100",
    marginBottom: 8,
  },
  noCartonsText: {
    fontSize: 14,
    color: "#E65100",
    textAlign: "center",
    marginBottom: 8,
    lineHeight: 20,
  },
  noCartonsSubtext: {
    fontSize: 12,
    color: "#FF6F00",
    textAlign: "center",
    marginBottom: 16,
    fontStyle: "italic",
  },
  goToUnloadButton: {
    backgroundColor: "#FF9800",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  goToUnloadButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  modalContainer: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: Dimensions.get("window").height * 0.85,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    backgroundColor: "#1976D2",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#fff",
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCloseText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  modalContent: {
    padding: 16,
    maxHeight: Dimensions.get("window").height * 0.6,
  },
  summaryCard: {
    backgroundColor: "#F5F5F5",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: "#1976D2",
  },
  summaryItemCode: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#1976D2",
    marginBottom: 16,
    textAlign: "center",
  },
  summaryGrid: {
    flexDirection: "row",
    justifyContent: "space-around",
    flexWrap: "wrap",
    gap: 12,
  },
  summaryItem: {
    flex: 1,
    minWidth: 100,
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  summaryLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 8,
    fontWeight: "600",
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  summaryValueScanned: {
    color: "#2196F3",
  },
  summaryValueTO: {
    color: "#FF9800",
  },
  summaryValueRemaining: {
    color: "#4CAF50",
  },
  summaryValueComplete: {
    color: "#4CAF50",
  },
  summaryValueWarning: {
    color: "#F44336",
  },
  allocationsSection: {
    marginTop: 8,
  },
  allocationsTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: "#E3F2FD",
  },
  allocationCard: {
    backgroundColor: "#FAFAFA",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  allocationHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  allocationStore: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1976D2",
  },
  allocationBadges: {
    flexDirection: "row",
    gap: 8,
  },
  allocationBadge: {
    backgroundColor: "#FF9800",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  allocationBadgeScanned: {
    backgroundColor: "#2196F3",
  },
  allocationBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  boxesSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
  },
  boxesLabelModal: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    marginBottom: 8,
  },
  boxesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  boxChipModal: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  boxChipTextModal: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  noAllocationCard: {
    backgroundColor: "#FFF3E0",
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#FFB74D",
  },
  noAllocationText: {
    fontSize: 16,
    color: "#E65100",
    fontWeight: "600",
  },
  modalFooter: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
  },
  modalCloseButtonLarge: {
    backgroundColor: "#1976D2",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  modalCloseButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  clickableSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#E3F2FD",
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#2196F3",
  },
  clickableSectionText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1976D2",
  },
  clickableSectionArrow: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1976D2",
  },
  quickScanDetailsCard: {
    marginTop: 8,
    marginBottom: 16,
    padding: 12,
    backgroundColor: "#F8FBFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#90CAF9",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  quickScanDetailsCardComplete: {
    backgroundColor: "#F1F8E9",
    borderColor: "#81C784",
  },
  quickScanDetailsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
    gap: 8,
  },
  quickScanDetailsTitleBlock: {
    flex: 1,
  },
  quickScanHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  quickScanHeaderBreakdownButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#FFF3E0",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FF9800",
  },
  quickScanHeaderBreakdownButtonDisabled: {
    opacity: 0.45,
    backgroundColor: "#F5F5F5",
    borderColor: "#D0D0D0",
  },
  quickScanHeaderBreakdownButtonText: {
    color: "#E65100",
    fontSize: 12,
    fontWeight: "800",
  },
  quickScanDetailsLabel: {
    fontSize: 11,
    color: "#607D8B",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  quickScanDetailsItemCode: {
    marginTop: 2,
    fontSize: 22,
    fontWeight: "bold",
    color: "#1565C0",
  },
  quickScanCollapsedHint: {
    marginTop: 2,
    fontSize: 12,
    color: "#546E7A",
    fontWeight: "600",
  },
  quickScanPlaceholderText: {
    fontSize: 13,
    color: "#546E7A",
    lineHeight: 18,
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: "#E3F2FD",
  },
  quickScanStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  quickScanStatusBadgeComplete: {
    backgroundColor: "#43A047",
  },
  quickScanStatusBadgeOpen: {
    backgroundColor: "#FB8C00",
  },
  quickScanStatusBadgeOver: {
    backgroundColor: "#E53935",
  },
  quickScanStatusText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "bold",
  },
  quickScanQtyRow: {
    flexDirection: "row",
    gap: 8,
  },
  quickScanQtyChip: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "#E3F2FD",
  },
  quickScanQtyLabel: {
    fontSize: 11,
    color: "#757575",
    fontWeight: "600",
    marginBottom: 2,
  },
  quickScanQtyValue: {
    fontSize: 18,
    color: "#263238",
    fontWeight: "bold",
  },
  quickScanQtyValueScanned: {
    color: "#1976D2",
  },
  quickScanQtyValueComplete: {
    color: "#2E7D32",
  },
  quickScanQtyValueRemaining: {
    color: "#EF6C00",
  },
  quickScanQtyValueOver: {
    color: "#C62828",
  },
  quickScanBoxLine: {
    marginTop: 8,
    fontSize: 12,
    color: "#37474F",
    fontWeight: "600",
  },
  quickScanToSection: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#DCEAF7",
  },
  quickScanToTitle: {
    fontSize: 12,
    color: "#1565C0",
    fontWeight: "bold",
    marginBottom: 6,
  },
  quickScanToRow: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E3F2FD",
    marginBottom: 6,
  },
  quickScanToStore: {
    fontSize: 13,
    color: "#263238",
    fontWeight: "700",
    marginBottom: 6,
  },
  quickScanToQtyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  quickScanToQty: {
    flex: 1,
    fontSize: 12,
    color: "#455A64",
    fontWeight: "700",
  },
  quickScanToQtyScanned: {
    color: "#1976D2",
    textAlign: "center",
  },
  quickScanToQtyComplete: {
    color: "#2E7D32",
    textAlign: "right",
  },
  quickScanToQtyRemaining: {
    color: "#EF6C00",
    textAlign: "right",
  },
  quickScanToQtyOver: {
    color: "#C62828",
    textAlign: "right",
  },
  quickScanMoreText: {
    marginTop: 4,
    fontSize: 11,
    color: "#607D8B",
    fontWeight: "600",
  },
  quickScanNoToText: {
    marginTop: 8,
    fontSize: 12,
    color: "#E65100",
    fontWeight: "600",
  },
  distributionDetailsInlineButton: {
    marginTop: 8,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: "#FFF3E0",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#FF9800",
    alignItems: "center",
  },
  distributionDetailsInlineButtonDisabled: {
    opacity: 0.45,
    backgroundColor: "#F5F5F5",
    borderColor: "#D0D0D0",
  },
  distributionDetailsInlineButtonText: {
    color: "#E65100",
    fontSize: 14,
    fontWeight: "800",
  },
  distributionSection: {
    padding: 16,
  },
  distributionHint: {
    fontSize: 13,
    color: "#546E7A",
    lineHeight: 18,
    marginBottom: 12,
    fontWeight: "600",
  },
  distributionCard: {
    backgroundColor: "#F8FBFF",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#BBDEFB",
  },
  distributionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  distributionStore: {
    flex: 1,
    fontSize: 16,
    fontWeight: "bold",
    color: "#1565C0",
  },
  distributionRemainingBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "bold",
  },
  distributionRemainingOpen: {
    backgroundColor: "#FB8C00",
  },
  distributionRemainingDone: {
    backgroundColor: "#43A047",
  },
  distributionRemainingOver: {
    backgroundColor: "#E53935",
  },
  distributionQtyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  distributionQtyText: {
    fontSize: 13,
    color: "#455A64",
    fontWeight: "700",
  },
  distributionScannedText: {
    color: "#1976D2",
  },
  distributionBoxLabel: {
    fontSize: 12,
    color: "#607D8B",
    fontWeight: "700",
    marginBottom: 6,
  },
  distributionBoxesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  distributionBoxChip: {
    backgroundColor: "#E3F2FD",
    borderColor: "#90CAF9",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  distributionBoxChipText: {
    fontSize: 11,
    color: "#0D47A1",
    fontWeight: "700",
  },
  distributionMoreBoxes: {
    fontSize: 11,
    color: "#607D8B",
    fontWeight: "700",
    alignSelf: "center",
  },
  distributionNoBoxText: {
    fontSize: 12,
    color: "#C62828",
    fontWeight: "600",
  },
  lastItemCard: {
    backgroundColor: "#F5F5F5",
    borderRadius: 8,
    padding: 16,
    borderWidth: 2,
    borderColor: "#2196F3",
    marginTop: 8,
  },
  lastItemCardComplete: {
    backgroundColor: "#E8F5E9",
    borderColor: "#4CAF50",
  },
  lastItemLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
    fontWeight: "600",
  },
  lastItemCode: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1976D2",
    marginBottom: 8,
  },
  lastItemDetails: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  lastItemDetail: {
    fontSize: 14,
    color: "#333",
    backgroundColor: "#fff",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  searchContainer: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  searchInput: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  modalContentContainer: {
    padding: 16,
  },
  emptyModalContainer: {
    padding: 40,
    alignItems: "center",
  },
  emptyModalText: {
    fontSize: 16,
    color: "#999",
    textAlign: "center",
  },
  manualQtyContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: "#F0F8FF",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2196F3",
  },
  manualQtyInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#F5F5F5",
    borderRadius: 6,
  },
  manualQtyInfoLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  manualQtyInfoValue: {
    fontSize: 16,
    fontWeight: "bold",
  },
  manualQtyLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1976D2",
    marginBottom: 6,
    marginTop: 8,
  },
  manualQtyInput: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#2196F3",
    borderRadius: 6,
    padding: 10,
    fontSize: 16,
    marginBottom: 8,
  },
  manualQtyBoxSelector: {
    marginBottom: 12,
  },
  manualQtyBoxSelectorContent: {
    paddingRight: 16,
  },
  manualQtyBoxButton: {
    minWidth: 100,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 8,
    alignItems: "center",
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#ddd",
    backgroundColor: "#fff",
  },
  manualQtyBoxButtonActive: {
    borderColor: "#2196F3",
    backgroundColor: "#E3F2FD",
  },
  manualQtyBoxButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
  },
  manualQtyBoxButtonTextActive: {
    color: "#1976D2",
    fontWeight: "bold",
  },
  manualQtyBoxStoreText: {
    fontSize: 10,
    color: "#999",
    marginTop: 2,
  },
  boxItemQtyBadge: {
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    minWidth: 50,
    alignItems: "center",
  },
  boxItemQtyText: {
    fontSize: 9,
    color: "#FFFFFF",
    fontWeight: "bold",
  },
  manualQtyActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  manualQtyButton: {
    flex: 1,
    padding: 10,
    borderRadius: 6,
    alignItems: "center",
  },
  manualQtyButtonCancel: {
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#ddd",
  },
  manualQtyButtonSubmit: {
    backgroundColor: "#4CAF50",
  },
  manualQtyButtonDisabled: {
    opacity: 0.5,
  },
  manualQtyButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  manualQtyButtonCancelText: {
    color: "#666",
  },
  manualQtyButtonSubmitText: {
    color: "#fff",
  },
  manualQtyTriggerButton: {
    marginTop: 8,
    padding: 8,
    backgroundColor: "#E3F2FD",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#2196F3",
    alignItems: "center",
  },
  manualQtyTriggerText: {
    color: "#1976D2",
    fontSize: 12,
    fontWeight: "600",
  },
  itemActionButtons: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  toBreakdownButton: {
    flex: 1,
    marginTop: 8,
    padding: 8,
    backgroundColor: "#FFF3E0",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#FF9800",
    alignItems: "center",
  },
  toBreakdownButtonText: {
    color: "#E65100",
    fontSize: 12,
    fontWeight: "600",
  },
  breakdownSection: {
    padding: 16,
  },
  breakdownCard: {
    backgroundColor: "#F9F9F9",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  breakdownHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  breakdownStore: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
  },
  breakdownNoTO: {
    fontSize: 12,
    color: "#999",
    fontStyle: "italic",
  },
  breakdownDetails: {
    gap: 8,
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  breakdownLabel: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
  },
  breakdownValue: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#000",
  },
  breakdownWarning: {
    marginTop: 8,
    padding: 8,
    backgroundColor: "#FFEBEE",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#F44336",
  },
  breakdownWarningText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#D32F2F",
    textAlign: "center",
  },
  breakdownEditButton: {
    marginTop: 12,
    padding: 10,
    backgroundColor: "#007AFF",
    borderRadius: 6,
    alignItems: "center",
  },
  breakdownEditButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  expectedItemsHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    flexWrap: "wrap",
    gap: 8,
  },
  createDistributionCTNButton: {
    backgroundColor: "#4CAF50",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#2E7D32",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  createDistributionCTNButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "bold",
    textAlign: "center",
  },
  createCTNSection: {
    marginBottom: 20,
    padding: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  createCTNSectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1976D2",
    marginBottom: 8,
  },
  createCTNSectionSubtitle: {
    fontSize: 12,
    color: "#666",
    marginBottom: 16,
  },
  createCTNStoreButton: {
    backgroundColor: "#2196F3",
    padding: 14,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: "center",
  },
  createCTNStoreButtonCreating: {
    backgroundColor: "#FF9800",
  },
  createCTNStoreButtonDisabled: {
    backgroundColor: "#CCCCCC",
    opacity: 0.6,
  },
  createCTNStoreButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "bold",
  },
  remainingItemsInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  remainingItemsLabel: {
    fontSize: 14,
    color: "#424242",
  },
  remainingItemsValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1976D2",
  },
  createPutawayButton: {
    backgroundColor: "#FF9800",
    padding: 14,
    borderRadius: 8,
    marginTop: 12,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#F57C00",
  },
  createPutawayButtonDisabled: {
    backgroundColor: "#CCCCCC",
    opacity: 0.6,
    borderColor: "#999",
  },
  createPutawayButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "bold",
  },
  warningBanner: {
    backgroundColor: "#FFF3CD",
    borderLeftWidth: 4,
    borderLeftColor: "#FFC107",
    padding: 12,
    marginTop: 8,
    borderRadius: 4,
  },
  warningText: {
    color: "#856404",
    fontSize: 13,
    fontWeight: "600",
  },
  editButton: {
    backgroundColor: "#007AFF",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 8,
    alignItems: "center",
  },
  editButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  editQtyInfoCard: {
    backgroundColor: "#F5F5F5",
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  editQtyLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  editQtyValue: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#000",
  },
  inputContainer: {
    marginVertical: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
    marginBottom: 8,
  },
  inputHint: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  quantityInput: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#2196F3",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: "#000",
    minHeight: 48,
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: "center",
    marginHorizontal: 8,
  },
  modalButtonCancel: {
    backgroundColor: "#E0E0E0",
  },
  modalButtonSave: {
    backgroundColor: "#007AFF",
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  editModalContainer: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: Dimensions.get("window").height * 0.9,
    flexDirection: "column",
    flex: 1,
  },
  editModalContent: {
    flex: 1,
    padding: 16,
  },
  editModalContentContainer: {
    paddingBottom: 20,
  },
  editModalFooter: {
    flexDirection: "row",
    padding: 16,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
    backgroundColor: "#fff",
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
});
