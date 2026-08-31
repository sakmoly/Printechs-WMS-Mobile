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
  Modal,
  Keyboard,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  useNavigation,
  useRoute,
  useFocusEffect,
} from "@react-navigation/native";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { apiService } from "../services/api.service";
import { getSettings } from "../services/settings.service";
import { getDatabase } from "../database/database";
import { generateUUID } from "../utils/uuid";
import { isDeviceOnline } from "../utils/network-check";
import {
  resolveItemFromBarcode,
  resolveItemFromOnlineScan,
} from "../services/item-master.service";
import {
  BarcodeInput,
  type BarcodeInputHandle,
} from "../components/BarcodeInput";
import {
  getExpectedQtyForCarton,
  listLocalStockForCarton,
  applyCycleCountStockSync,
} from "../services/stock-ledger-local.service";
import {
  countModeToApiValue,
  getCycleCountWarehouseContext,
  getCycleCountPushIdentity,
  isAdhocAddMode,
  unwrapFrappeMessage,
  type CycleCountMode,
} from "../services/cycle-count-erp.service";
import {
  startCycleCountSession,
  validateCycleCountBin,
} from "../services/cycle-count-session-start.service";

interface CountLine {
  line_id: string;
  item_code: string;
  item_name?: string;
  barcode: string;
  carton_id?: string | null; // ✅ NEW: Optional carton_id for carton-level inventory
  uom: string;
  expected_qty: number | null;
  counted_qty: number;
  variance_qty: number | null;
  is_unexpected_item: boolean;
  reason_code?: string;
  notes?: string;
  created_at?: string; // Timestamp when line was created
  updated_at?: string; // Timestamp when line was last updated
}

function normalizeCartonId(value: string): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-");
}

/** Carton labels (NEWCTN, WHMAIN001) vs numeric item barcodes (108226). */
function looksLikeCartonId(value: string): boolean {
  const v = normalizeCartonId(value);
  if (!v || v.length < 2) return false;
  if (/^\d+$/.test(v)) return false;
  if (/^(CTN|NEW|CARTON|WHMAIN|BOX)/.test(v)) return true;
  return /[A-Z]/.test(v) && /^[A-Z0-9-]+$/.test(v);
}

type SetupScanMethod = "local" | "blind" | "online";

function deriveSetupScanMethod(
  blind: boolean,
  online: boolean
): SetupScanMethod | null {
  if (blind) return "blind";
  if (online) return "online";
  return null;
}

export default function CycleCountBinCountingScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const routeParams = (route.params as any) || {};
  const {
    sessionId,
    countType: routeCountType,
    binCode,
    binInfo,
    isBlindCount,
    scanOnline: initialScanOnline = false,
    openingStock = false,
    cartonId: initialCartonId,
    countMode: routeCountMode = "Reconciliation",
    skipCartonRestore: skipCartonRestoreParam = false,
    forceNewSession: forceNewSessionParam = false,
  } = routeParams;
  const [sessionCountType, setSessionCountType] = useState<string>(
    routeCountType || ""
  );
  const [countMode, setCountMode] = useState<CycleCountMode>(
    (routeCountMode as CycleCountMode) || "Reconciliation"
  );
  const [erpBatch, setErpBatch] = useState<string | null>(null);
  const [erpLockedCartonId, setErpLockedCartonId] = useState<string | null>(
    null
  );
  const [syncingStock, setSyncingStock] = useState(false);
  const shouldLoadExpectedItems =
    String(sessionCountType || routeCountType || "")
      .toLowerCase() === "directed" && !Boolean(openingStock);

  // ✅ DEBUG: Log route params to verify carton ID is passed
  useEffect(() => {
    console.log(`📦 CycleCountBinCountingScreen: Route params received:`, {
      sessionId,
      binCode,
      cartonId: initialCartonId,
      isBlindCount,
      scanOnline: initialScanOnline,
      openingStock,
      shouldLoadExpectedItems,
      allParams: routeParams,
    });
  }, [route.params]);

  const [showScanner, setShowScanner] = useState(false);
  const [countLines, setCountLines] = useState<CountLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [taskTitle, setTaskTitle] = useState<string | null>(null);
  const [scanOnlineEnabled, setScanOnlineEnabled] = useState(Boolean(initialScanOnline));
  const [cartonId, setCartonId] = useState<string | null>(null); // ✅ NEW: Carton ID will be scanned in this screen
  const [cartonIdInput, setCartonIdInput] = useState(""); // ✅ NEW: Input field for carton ID
  const cartonIdInputRef = useRef<BarcodeInputHandle>(null); // ✅ NEW: Ref for carton ID input
  const binSetupInputRef = useRef<BarcodeInputHandle>(null);
  const skipCartonRestoreRef = useRef<boolean>(Boolean(skipCartonRestoreParam));
  const [binSetupLoading, setBinSetupLoading] = useState(false);
  const [setupScanMethod, setSetupScanMethod] = useState<SetupScanMethod | null>(
    () => deriveSetupScanMethod(Boolean(isBlindCount), Boolean(initialScanOnline))
  );
  const setupBlindCount = setupScanMethod === "blind";
  const setupScanOnline = setupScanMethod === "online";
  const binScanReady = setupScanMethod !== null;
  const needsBinSetup = !binCode?.trim();

  useEffect(() => {
    if (!needsBinSetup || !setupScanMethod) return;
    const timer = setTimeout(() => binSetupInputRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, [needsBinSetup, setupScanMethod]);

  useEffect(() => {
    if (skipCartonRestoreParam) {
      skipCartonRestoreRef.current = true;
      setCartonId(null);
      setErpLockedCartonId(null);
    }
  }, [skipCartonRestoreParam]);

  useEffect(() => {
    if (routeParams?.scanOnline !== undefined) {
      setScanOnlineEnabled(Boolean(routeParams.scanOnline));
    }
  }, [route.params]);

  // ✅ IMPORTANT: Update cartonId when route params change (e.g., when screen is focused)
  useEffect(() => {
    const currentCartonId = routeParams?.cartonId;
    console.log(`📦 useEffect: Checking cartonId from route params:`, {
      routeParamsCartonId: currentCartonId,
      currentStateCartonId: cartonId,
      routeParamsFull: routeParams,
    });
    if (currentCartonId !== undefined && currentCartonId !== cartonId) {
      console.log(
        `📦 Updating cartonId from route params: ${currentCartonId} (was: ${cartonId})`
      );
      setCartonId(currentCartonId || null);
    } else if (currentCartonId === undefined || currentCartonId === null) {
      console.log(
        `📦 Carton ID is null/undefined in route params - keeping current state: ${cartonId}`
      );
    }
  }, [route.params]);

  // ✅ DEBUG: Log carton ID state changes and reload items when cartonId changes
  useEffect(() => {
    console.log(
      `📦 CycleCountBinCountingScreen: Carton ID state changed to:`,
      cartonId
    );
    // Reload items when cartonId changes (e.g., when user changes carton)
    if (sessionId) {
      console.log(`🔄 Reloading items for cartonId: ${cartonId || "null"}`);
      loadSessionWithCartonId(cartonId);
    }
  }, [cartonId, sessionId]);

  const barcodeInputRef = useRef<BarcodeInputHandle | null>(null);
  const listRef = useRef<FlatList<CountLine> | null>(null);
  const editingLineIdRef = useRef<string | null>(null);

  useEffect(() => {
    editingLineIdRef.current = editingLineId;
  }, [editingLineId]);

  const focusActiveBarcodeInput = useCallback(
    (delayMs = 0) => {
      const focus = () => {
        if (editingLineIdRef.current) {
          return;
        }
        if (!cartonId) {
          cartonIdInputRef.current?.focus();
        } else {
          barcodeInputRef.current?.focus();
        }
      };
      if (delayMs <= 0) {
        focus();
        return undefined;
      }
      return setTimeout(focus, delayMs);
    },
    [cartonId]
  );

  const isCartonLocked = Boolean(erpLockedCartonId);

  const alertCartonChangeBlocked = () => {
    Alert.alert(
      "Carton Locked",
      `This count was already pushed to ERP for carton ${erpLockedCartonId}. ` +
        "You cannot switch cartons on this task. Add more items to the same carton and push again, " +
        "or start a new count session for a different carton."
    );
  };

  useFocusEffect(
    useCallback(() => {
      console.log(
        `🔄 useFocusEffect: Screen focused, sessionId: ${sessionId}, current cartonId: ${
          cartonId || "null"
        }`
      );

      // ✅ FIX: Async function inside callback (useFocusEffect doesn't support async callbacks)
      const loadData = async () => {
        // After ERP push, always restore the locked carton (cannot be cleared)
        let restoredCartonId = cartonId;
        if (sessionId && !skipCartonRestoreRef.current) {
          try {
            const db = await getDatabase();
            const sessionLock = await db.getFirstAsync<{
              erp_locked_carton_id: string | null;
              erp_batch: string | null;
            }>(
              "SELECT erp_locked_carton_id, erp_batch FROM cycle_count_sessions WHERE session_id = ?",
              [sessionId]
            );
            let lockedCarton = sessionLock?.erp_locked_carton_id?.trim() || null;
            if (!lockedCarton && sessionLock?.erp_batch) {
              const pushedLine = await db.getFirstAsync<{ carton_id: string | null }>(
                "SELECT carton_id FROM cycle_count_lines WHERE session_id = ? AND carton_id IS NOT NULL AND carton_id != '' ORDER BY updated_at DESC LIMIT 1",
                [sessionId]
              );
              lockedCarton = pushedLine?.carton_id?.trim() || null;
              if (lockedCarton) {
                await db.runAsync(
                  "UPDATE cycle_count_sessions SET erp_locked_carton_id = ? WHERE session_id = ?",
                  [lockedCarton, sessionId]
                );
              }
            }
            if (lockedCarton) {
              setErpLockedCartonId(lockedCarton);
              restoredCartonId = lockedCarton;
              setCartonId(lockedCarton);
              await new Promise((resolve) => setTimeout(resolve, 100));
            } else if (!cartonId) {
              const mostRecentLine = await db.getFirstAsync<{
                carton_id: string | null;
              }>(
                "SELECT carton_id FROM cycle_count_lines WHERE session_id = ? AND carton_id IS NOT NULL AND carton_id != '' ORDER BY updated_at DESC LIMIT 1",
                [sessionId]
              );
              if (mostRecentLine?.carton_id) {
                console.log(
                  `📦 Restored cartonId from database: ${mostRecentLine.carton_id}`
                );
                restoredCartonId = mostRecentLine.carton_id;
                setCartonId(mostRecentLine.carton_id);
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
            }
          } catch (error: any) {
            console.warn(
              `⚠️ Could not restore cartonId from database:`,
              error.message
            );
          }
        } else if (skipCartonRestoreRef.current) {
          console.log(`📦 Fresh count — waiting for carton scan (skip restore)`);
          restoredCartonId = null;
        }

        // ✅ NEW: Load taskTitle (server_session_id) from session FIRST
        // This is needed for loadExpectedItems to check backend task lines
        let loadedTaskTitle: string | null = null;
        if (sessionId) {
          try {
            const db = await getDatabase();
            const session = await db.getFirstAsync<{
              server_session_id: string | null;
              count_type: string | null;
              count_mode: string | null;
              erp_batch: string | null;
              erp_locked_carton_id: string | null;
            }>(
              "SELECT server_session_id, count_type, count_mode, erp_batch, erp_locked_carton_id FROM cycle_count_sessions WHERE session_id = ?",
              [sessionId]
            );
            if (session?.count_type) {
              setSessionCountType(session.count_type);
            } else if (routeCountType) {
              setSessionCountType(routeCountType);
            }
            if (session?.count_mode) {
              setCountMode(session.count_mode as CycleCountMode);
            } else if (routeCountMode) {
              setCountMode(routeCountMode as CycleCountMode);
            }
            if (session?.erp_batch) {
              setErpBatch(session.erp_batch);
            }
            if (session?.erp_locked_carton_id) {
              setErpLockedCartonId(session.erp_locked_carton_id);
            }
            if (session?.server_session_id) {
              console.log(
                `📋 Loaded taskTitle from session: ${session.server_session_id}`
              );
              loadedTaskTitle = session.server_session_id;
              setTaskTitle(session.server_session_id);
            } else {
              console.log(
                `ℹ️ No taskTitle (server_session_id) found in session ${sessionId}`
              );
              setTaskTitle(null);
            }
          } catch (error: any) {
            console.warn(
              `⚠️ Could not load taskTitle from session:`,
              error.message
            );
            setTaskTitle(null);
          }
        }

        // Load session with the correct cartonId (will filter by carton_id if set)
        // Use restoredCartonId if cartonId state hasn't updated yet
        const cartonIdToUse = cartonId || restoredCartonId;
        await loadSessionWithCartonId(cartonIdToUse);

        await loadExpectedItems(loadedTaskTitle);
      };

      loadData();
      focusActiveBarcodeInput(100);
    }, [sessionId, cartonId, focusActiveBarcodeInput])
  );

  // Auto-focus the active field on mount/state changes. When no carton is selected,
  // keep focus on Carton ID so handheld scanner input always lands there.
  useEffect(() => {
    const timers = [80, 300, 700].map((delay) =>
      focusActiveBarcodeInput(delay)
    );
    const focusInterval = setInterval(() => {
      if (!editingLineId) {
        focusActiveBarcodeInput();
      }
    }, 1500);

    return () => {
      timers.forEach((timer) => {
        if (timer) clearTimeout(timer);
      });
      clearInterval(focusInterval);
    };
  }, [cartonId, editingLineId, focusActiveBarcodeInput]);

  // ✅ NEW: Load session with specific cartonId (can be passed as parameter)
  const loadSessionWithCartonId = async (cartonIdToFilter?: string | null) => {
    if (!sessionId) {
      console.log("⚠️ loadSessionWithCartonId: sessionId is missing");
      return;
    }

    const effectiveCartonId =
      cartonIdToFilter !== undefined ? cartonIdToFilter : cartonId;

    try {
      console.log(
        `🔄 loadSessionWithCartonId: Loading count lines for session ${sessionId}, carton_id: ${
          effectiveCartonId || "null"
        }`
      );
      const db = await getDatabase();

      // ✅ FIX: Filter by carton_id if set, to show only items for current carton
      let lines: CountLine[];
      if (effectiveCartonId) {
        // Carton-level counting: only show items for this carton
        lines = await db.getAllAsync<CountLine>(
          "SELECT * FROM cycle_count_lines WHERE session_id = ? AND carton_id = ? ORDER BY updated_at DESC, created_at DESC",
          [sessionId, effectiveCartonId]
        );
        console.log(
          `📦 loadSessionWithCartonId: Filtered by carton_id ${effectiveCartonId}, found ${lines.length} lines`
        );
      } else {
        // Bin-level counting: show all items without carton_id
        lines = await db.getAllAsync<CountLine>(
          "SELECT * FROM cycle_count_lines WHERE session_id = ? AND (carton_id IS NULL OR carton_id = '') ORDER BY updated_at DESC, created_at DESC",
          [sessionId]
        );
        console.log(
          `📦 loadSessionWithCartonId: Bin-level counting, found ${lines.length} lines`
        );
      }

      console.log(`✅ loadSession: Loaded ${lines.length} count lines`);

      const itemCodes = Array.from(
        new Set(lines.map((line) => line.item_code).filter(Boolean))
      );
      const itemNameByCode = new Map<string, string>();
      if (itemCodes.length > 0) {
        const placeholders = itemCodes.map(() => "?").join(",");
        const itemMasters = await db.getAllAsync<{
          item_code: string;
          item_name: string | null;
        }>(
          `SELECT item_code, item_name FROM item_master WHERE item_code IN (${placeholders})`,
          itemCodes
        );
        itemMasters.forEach((item) => {
          if (item.item_name) {
            itemNameByCode.set(item.item_code, item.item_name);
          }
        });
      }

      const linesWithNames = lines.map((line) => ({
        ...line,
        item_name: line.item_name || itemNameByCode.get(line.item_code) || undefined,
      }));

      // ✅ FIX: Show ALL items (both scanned and expected) in the UI
      // Expected items with counted_qty = 0 should be displayed with their expected_qty
      // Note: expected_qty is preserved even when carton_id is set (backend stock ledger is bin-level)
      const allLines = linesWithNames
        // Sort: Most recently scanned/updated items first (by updated_at DESC)
        .sort((a, b) => {
          // Sort by updated_at descending (most recent first)
          const aUpdated = a.updated_at ? new Date(a.updated_at).getTime() : 0;
          const bUpdated = b.updated_at ? new Date(b.updated_at).getTime() : 0;
          if (bUpdated !== aUpdated) {
            return bUpdated - aUpdated; // Most recent first
          }
          // If updated_at is the same, sort by created_at descending
          const aCreated = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bCreated = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bCreated - aCreated; // Most recent first
        });

      const scannedCount = allLines.filter((l) => l.counted_qty > 0).length;
      const expectedCount = allLines.filter(
        (l) => l.expected_qty !== null && l.counted_qty === 0
      ).length;

      console.log(
        `📊 loadSession: Lines summary - Total: ${allLines.length}, Scanned (counted_qty > 0): ${scannedCount}, Expected (not scanned yet): ${expectedCount}`
      );
      console.log(
        `📊 loadSession: All lines:`,
        allLines.map((l) => ({
          item_code: l.item_code,
          counted_qty: l.counted_qty,
          expected_qty: l.expected_qty,
          carton_id: l.carton_id || "null",
        }))
      );

      setCountLines(allLines); // Show all items (scanned and expected) in UI
    } catch (error: any) {
      console.error(
        "❌ loadSessionWithCartonId: Error loading session:",
        error
      );
    }
  };

  // Wrapper function that uses current cartonId state
  const loadSession = async () => {
    await loadSessionWithCartonId();
  };

  const loadExpectedItems = async (_taskTitleParam?: string | null) => {
    if (!binCode || isBlindCount || !sessionId || !cartonId) {
      return;
    }

    if (isAdhocAddMode(countMode)) {
      console.log(
        `⏭️ loadExpectedItems: Adhoc Add mode — expected qty resolved per scan (new carton → 0)`
      );
      return;
    }

    console.log(
      `🔄 loadExpectedItems: Reconciliation — loading local carton stock for ${cartonId} @ ${binCode}`
    );
    setLoading(true);
    try {
      const db = await getDatabase();
      const existingLinesInDb = await db.getAllAsync<{
        item_code: string;
        counted_qty: number;
      }>(
        "SELECT item_code, counted_qty FROM cycle_count_lines WHERE session_id = ? AND carton_id = ?",
        [sessionId, cartonId]
      );

      if (existingLinesInDb.some((l) => l.counted_qty > 0)) {
        console.log(
          `✅ loadExpectedItems: Session has scanned items — preserving counts`
        );
        return;
      }

      const warehouseCode = getWarehouseCode();
      let expectedItems = await listLocalStockForCarton(
        warehouseCode,
        binCode,
        cartonId
      );

      if (expectedItems.length === 0 && scanOnlineEnabled) {
        try {
          const stockResponse = await apiService.getStockLedgerByLocation({
            bin_location: binCode,
            warehouse: warehouseCode || undefined,
            carton_id: cartonId,
          });
          const stockItems =
            stockResponse?.data || stockResponse?.items || stockResponse || [];
          const stockArray = Array.isArray(stockItems) ? stockItems : [stockItems];
          expectedItems = stockArray
            .filter((entry: any) => {
              const entryCarton = String(
                entry?.carton_id || entry?.carton || ""
              ).trim();
              return entryCarton === String(cartonId).trim();
            })
            .map((entry: any) => ({
              item_code: String(entry.item_code || "").trim(),
              qty: Number(
                entry.qty ?? entry.actual_qty ?? entry.current_qty ?? 0
              ),
            }))
            .filter((item) => item.item_code);
        } catch (error: any) {
          console.warn(
            `⚠️ loadExpectedItems: online carton stock lookup failed:`,
            error.message
          );
        }
      }

      if (expectedItems.length === 0) {
        console.log(
          `ℹ️ loadExpectedItems: No local stock rows for carton ${cartonId}`
        );
        return;
      }

      const existingItemCodes = new Set(
        existingLinesInDb.map((l) => l.item_code)
      );
      const now = new Date().toISOString();

      for (const item of expectedItems) {
        if (existingItemCodes.has(item.item_code)) continue;
        await db.runAsync(
          `INSERT INTO cycle_count_lines (
            line_id, session_id, item_code, barcode, carton_id, uom, expected_qty, counted_qty, is_unexpected_item, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            generateUUID(),
            sessionId,
            item.item_code,
            "",
            cartonId,
            "EA",
            item.qty,
            0,
            0,
            now,
            now,
          ]
        );
      }

      await loadSession();
    } catch (error: any) {
      console.error("❌ loadExpectedItems:", error);
    } finally {
      setLoading(false);
    }
  };

  // ✅ NEW: Handle carton ID scan/input — any ID is allowed (WMS new carton, ERP may not know it yet)
  const handleCartonIdScan = async (
    scannedCartonId: string
  ): Promise<boolean> => {
    const trimmedCartonId = normalizeCartonId(scannedCartonId);
    if (!trimmedCartonId) {
      return false;
    }
    if (
      erpLockedCartonId &&
      normalizeCartonId(erpLockedCartonId) !== trimmedCartonId
    ) {
      alertCartonChangeBlocked();
      return false;
    }
    console.log(`📦 Carton ID scanned/created: ${trimmedCartonId}`);
    skipCartonRestoreRef.current = false;
    setCartonId(trimmedCartonId);
    setCartonIdInput("");

    if (sessionId && binCode && !isBlindCount) {
      await loadSessionWithCartonId(trimmedCartonId);
      await loadExpectedItems(taskTitle);
    } else if (sessionId) {
      await loadSessionWithCartonId(trimmedCartonId);
    }

    const warehouseCode = getWarehouseCode();
    const existingStock = await listLocalStockForCarton(
      warehouseCode,
      binCode,
      trimmedCartonId
    );
    if (existingStock.length === 0) {
      console.log(
        `ℹ️ New WMS carton ${trimmedCartonId} — no local stock rows (expected qty 0 per item)`
      );
    }

    setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 100);
    return true;
  };

  const promptUseAsCartonId = (value: string) => {
    const normalized = normalizeCartonId(value);
    if (
      erpLockedCartonId &&
      normalizeCartonId(erpLockedCartonId) !== normalized
    ) {
      alertCartonChangeBlocked();
      return;
    }
    Alert.alert(
      "Use as Carton ID?",
      `"${normalized}" is not an item barcode.\n\nUse it as a carton ID for this bin? New or WMS-only cartons start with expected qty 0 per item until stock is synced.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Use as Carton",
          onPress: () => {
            void handleCartonIdScan(normalized);
          },
        },
      ]
    );
  };

  const handleCreateNewCarton = () => {
    if (isCartonLocked) {
      alertCartonChangeBlocked();
      return;
    }
    skipCartonRestoreRef.current = true;
    setCartonId(null);
    setCartonIdInput("");
    setTimeout(() => {
      cartonIdInputRef.current?.focus();
    }, 150);
  };

  const handleChangeCartonId = () => {
    if (isCartonLocked) {
      alertCartonChangeBlocked();
      return;
    }
    // Clear the current carton ID to show the carton ID input card
    // This allows the user to type, scan, or generate a new carton ID
    // Set flag to prevent useFocusEffect from restoring carton ID from database
    skipCartonRestoreRef.current = true;
    setCartonId(null);
    setCartonIdInput("");
    // The carton ID input card will automatically appear (rendered when !cartonId)
    // After a short delay, focus the input field for better UX
    setTimeout(() => {
      cartonIdInputRef.current?.focus();
    }, 200);
  };

  const handleScanModeChange = (online: boolean) => {
    if (scanOnlineEnabled === online) return;
    setScanOnlineEnabled(online);
  };

  // ✅ NEW: Generate carton ID locally
  const handleGenerateCartonId = () => {
    if (!binCode) {
      Alert.alert("Error", "Bin code is required to generate carton ID");
      return;
    }

    // Generate carton ID format: CTN-{BIN_CODE}-{TIMESTAMP}
    // Example: CTN-A1-R01-L1-B1-20250109-001
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0].replace(/-/g, ""); // YYYYMMDD
    const timeStr = now
      .toTimeString()
      .split(" ")[0]
      .replace(/:/g, "")
      .substring(0, 6); // HHMMSS (first 6 chars)
    const randomSuffix = Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0");

    // Clean bin code (remove special chars, keep alphanumeric and dashes)
    const cleanBinCode = binCode.replace(/[^A-Z0-9-]/gi, "-").toUpperCase();

    const generatedCartonId = `CTN-${cleanBinCode}-${dateStr}-${timeStr}-${randomSuffix}`;

    console.log(
      `🔧 Generated carton ID: ${generatedCartonId} for bin ${binCode}`
    );

    // Set the generated carton ID (same as scanning)
    void handleCartonIdScan(generatedCartonId);

    Alert.alert(
      "Carton ID Generated",
      `Generated Carton ID:\n${generatedCartonId}\n\nThis will be sent to backend when items are synced.`,
      [{ text: "OK" }]
    );
  };

  const handleItemScan = async (barcode: string): Promise<boolean> => {
    // ✅ NEW: Require carton ID before scanning items
    if (!cartonId || cartonId.trim() === "") {
      Alert.alert(
        "Carton ID Required",
        "Please scan or enter a Carton ID before scanning items.\n\nOne bin can have multiple cartons.",
        [
          {
            text: "OK",
            onPress: () => {
              setTimeout(() => {
                cartonIdInputRef.current?.focus();
              }, 100);
            },
          },
        ]
      );
      return false;
    }

    setShowScanner(false);

    const scannedBarcode = barcode.trim();
    if (!scannedBarcode) {
      return false;
    }

    if (looksLikeCartonId(scannedBarcode)) {
      promptUseAsCartonId(scannedBarcode);
      return false;
    }

    try {
      const db = await getDatabase();

      console.log(
        `🔍 Searching for item: barcode="${scannedBarcode}", scanOnline=${scanOnlineEnabled ? "true" : "false"}`
      );
      const item = scanOnlineEnabled
        ? await resolveItemFromOnlineScan(scannedBarcode)
        : await resolveItemFromBarcode(scannedBarcode);

      if (!item) {
        if (looksLikeCartonId(scannedBarcode)) {
          promptUseAsCartonId(scannedBarcode);
          return false;
        }
        Alert.alert(
          "Item Not Found",
          scanOnlineEnabled
            ? `Barcode "${scannedBarcode}" was not returned by backend online lookup.\n\nIf this is a new carton ID, tap Change Carton and enter it there — or scan a valid item barcode.`
            : `Barcode "${scannedBarcode}" not found in system`
        );
        // Refocus input even on error
        setTimeout(() => {
          barcodeInputRef.current?.focus();
        }, 100);
        return false;
      }

      // Item found - get additional details from barcode_map if available
      const barcodeMap = await db.getFirstAsync<{
        item_code: string;
        uom: string;
        pack_size: number;
        barcode_type: string;
      }>(
        "SELECT item_code, uom, pack_size, barcode_type FROM item_barcode_map WHERE barcode = ? OR item_code = ?",
        [scannedBarcode, item.item_code]
      );

      // Use barcode_map data if available (has pack_size and UOM), otherwise use defaults
      const itemCode = item.item_code;
      const uom = barcodeMap?.uom || "EA";
      const increment = barcodeMap?.pack_size || 1;

      // Create or update barcode map entry if it doesn't exist
      if (!barcodeMap) {
        try {
          await db.runAsync(
            "INSERT OR REPLACE INTO item_barcode_map (barcode, item_code, uom, pack_size, barcode_type, updated_on) VALUES (?, ?, ?, ?, ?, ?)",
            [
              scannedBarcode,
              itemCode,
              uom,
              increment,
              "Unit",
              new Date().toISOString(),
            ]
          );
          console.log(
            `💾 Created barcode map entry: barcode="${scannedBarcode}", item_code="${itemCode}"`
          );
        } catch (cacheError: any) {
          console.warn(
            `⚠️ Failed to create barcode map entry:`,
            cacheError.message
          );
        }
      }

      console.log(
        `✅ Item resolved: item_code="${itemCode}", barcode="${scannedBarcode}", uom="${uom}", increment=${increment}`
      );
      await addOrIncrementItem(itemCode, scannedBarcode, uom, increment);

      // Vibrate on success
      Vibration.vibrate(50);

      return true;
    } catch (error: any) {
      console.error("Error processing scan:", error);
      const message = error.message || "Failed to process scan";
      if (looksLikeCartonId(scannedBarcode)) {
        promptUseAsCartonId(scannedBarcode);
        return false;
      }
      Alert.alert(
        scanOnlineEnabled ? "Online Lookup Failed" : "Error",
        message
      );
      Vibration.vibrate([100, 50, 100]); // Error pattern

      // Refocus even on error
      setTimeout(() => {
        barcodeInputRef.current?.focus();
      }, 100);
      return false;
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
        Alert.alert(
          "Error",
          "Session ID is missing. Please restart the counting session."
        );
        return;
      }

      console.log(
        `💾 Saving item: ${itemCode}, barcode: ${barcode}, increment: ${increment}, sessionId: ${sessionId}`
      );
      const db = await getDatabase();

      // Verify session exists
      const session = await db.getFirstAsync<{ session_id: string }>(
        "SELECT session_id FROM cycle_count_sessions WHERE session_id = ?",
        [sessionId]
      );

      if (!session) {
        console.error(`❌ Session ${sessionId} not found in database!`);
        Alert.alert(
          "Error",
          "Session not found. Please restart the counting session."
        );
        return;
      }

      // Check if item already exists in count lines with the same carton_id
      // If carton_id is provided, match by both item_code AND carton_id
      // If carton_id is null, only match by item_code (for bin-level counting)
      const existingLine = await db.getFirstAsync<CountLine>(
        cartonId
          ? "SELECT * FROM cycle_count_lines WHERE session_id = ? AND item_code = ? AND carton_id = ?"
          : "SELECT * FROM cycle_count_lines WHERE session_id = ? AND item_code = ? AND (carton_id IS NULL OR carton_id = '')",
        cartonId ? [sessionId, itemCode, cartonId] : [sessionId, itemCode]
      );

      const now = new Date().toISOString();

      if (existingLine) {
        // Increment existing line (carton_id already matches due to query filter)
        const newQty = existingLine.counted_qty + increment;
        const expectedQty =
          existingLine.expected_qty !== null &&
          existingLine.expected_qty !== undefined
            ? existingLine.expected_qty
            : isBlindCount
            ? null
            : await getExpectedQty(itemCode);
        console.log(
          `📝 Updating existing line ${existingLine.line_id}: ${
            existingLine.counted_qty
          } + ${increment} = ${newQty}, carton_id: ${
            cartonId || "null"
          } (existing: ${existingLine.carton_id || "null"})`
        );

        // Update existing line quantity and ensure carton_id is set (in case it was null before)
        const updateQuery = cartonId
          ? "UPDATE cycle_count_lines SET counted_qty = ?, expected_qty = COALESCE(expected_qty, ?), carton_id = ?, updated_at = ? WHERE line_id = ?"
          : "UPDATE cycle_count_lines SET counted_qty = ?, expected_qty = COALESCE(expected_qty, ?), updated_at = ? WHERE line_id = ?";
        const updateParams = cartonId
          ? [newQty, expectedQty, cartonId, now, existingLine.line_id]
          : [newQty, expectedQty, now, existingLine.line_id];

        const result = await db.runAsync(updateQuery, updateParams);
        console.log(
          `✅ Updated line ${existingLine.line_id} with qty ${newQty}${
            cartonId ? ` and carton_id ${cartonId}` : ""
          }`
        );
      } else {
        // Add new line
        const lineId = generateUUID();
        const expectedQty = isBlindCount
          ? null
          : await getExpectedQty(itemCode);

        console.log(
          `➕ Inserting new line ${lineId} for item ${itemCode}, expected: ${expectedQty}, counted: ${increment}, carton_id: ${
            cartonId || "null"
          }`
        );
        const result = await db.runAsync(
          `INSERT INTO cycle_count_lines (
            line_id, session_id, item_code, barcode, carton_id, uom, expected_qty, counted_qty, is_unexpected_item, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            lineId,
            sessionId,
            itemCode,
            barcode,
            cartonId || null, // ✅ NEW: Use carton_id from route params (scanned during bin scan)
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
      focusActiveBarcodeInput(100);
      focusActiveBarcodeInput(400);
    } catch (error: any) {
      console.error("❌ Error in addOrIncrementItem:", error);
      console.error("❌ Error stack:", error.stack);
      Alert.alert(
        "Save Error",
        `Failed to save item: ${error.message || error.toString()}`
      );
      // Don't re-throw - let the UI continue working
    }
  };

  const getWarehouseCode = () =>
    String(binInfo?.warehouse_id || binInfo?.warehouse || "").trim();

  const getExpectedQty = async (itemCode: string): Promise<number | null> => {
    if (isBlindCount) return null;
    if (!binCode) return 0;

    const qty = await getExpectedQtyForCarton(
      {
        warehouse: getWarehouseCode(),
        item_code: itemCode,
        bin_location: binCode,
        carton_id: cartonId,
      },
      { fetchOnline: scanOnlineEnabled }
    );
    return qty;
  };

  const handleEditQty = (lineId: string, currentQty: number) => {
    barcodeInputRef.current?.blur();
    cartonIdInputRef.current?.blur();
    Keyboard.dismiss();
    setEditingLineId(lineId);
    setEditQty(currentQty.toString());
    setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 150);
  };

  const handleClearLineQty = (lineId: string, itemCode: string, currentQty: number) => {
    if (currentQty <= 0) return;
    Alert.alert(
      "Clear Count",
      `Reset counted qty for ${itemCode} to 0?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            try {
              const db = await getDatabase();
              const now = new Date().toISOString();
              await db.runAsync(
                "UPDATE cycle_count_lines SET counted_qty = 0, updated_at = ? WHERE line_id = ?",
                [now, lineId]
              );
              await db.runAsync(
                "UPDATE cycle_count_sessions SET status = 'Draft', updated_at = ? WHERE session_id = ?",
                [now, sessionId]
              );
              setEditingLineId(null);
              setEditQty("");
              await loadSession();
              focusActiveBarcodeInput(100);
            } catch (error: any) {
              Alert.alert("Error", error.message || "Could not clear count");
            }
          },
        },
      ]
    );
  };

  const handleSaveQty = async (lineId: string) => {
    const qty = parseFloat(editQty);
    if (isNaN(qty) || qty < 0) {
      Alert.alert(
        "Invalid Quantity",
        "Please enter a valid quantity (0 or greater)"
      );
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
      focusActiveBarcodeInput(100);
      focusActiveBarcodeInput(400);
    } catch (error: any) {
      Alert.alert("Error", `Failed to update quantity: ${error.message}`);
    }
  };

  const handleMarkBinCompleted = async () => {
    // ✅ Check if carton ID is required but not set
    if (!cartonId && cartonIdInput.trim()) {
      Alert.alert(
        "Carton ID Required",
        "Please complete the carton ID scan first before marking bin as completed.",
        [{ text: "OK" }]
      );
      // Focus carton ID input
      setTimeout(() => {
        cartonIdInputRef.current?.focus();
      }, 100);
      return;
    }

    Alert.alert(
      "Mark Bin Completed",
      "This will mark all unscanned expected items as zero and complete the bin count. Continue?",
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

              Alert.alert("Success", "Bin marked as completed", [
                {
                  text: "OK",
                  onPress: () => {
                    // Navigate back to dashboard
                    navigation.goBack();
                  },
                },
              ]);
              await loadSession();
            } catch (error: any) {
              Alert.alert(
                "Error",
                `Failed to mark bin completed: ${error.message}`
              );
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

  const handlePushToErp = async () => {
    if (!cartonId) {
      Alert.alert("Carton Required", "Scan a carton ID before pushing to ERP.");
      return;
    }

    const linesToPush = countLines.filter((l) => Number(l.counted_qty || 0) > 0);
    if (linesToPush.length === 0) {
      Alert.alert("No Counts", "Scan at least one item with a counted quantity.");
      return;
    }

    const pushMessage = erpLockedCartonId
      ? `Update ERP with ${linesToPush.length} line(s) for carton ${cartonId}?`
      : `Send ${linesToPush.length} line(s) to ERP for carton ${cartonId} (${countModeToApiValue(countMode)})?\n\nAfter the first push, this carton will be locked for this task.`;

    Alert.alert(
      "Push to ERP",
      pushMessage,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Push",
          onPress: async () => {
            setSaving(true);
            try {
              const online = await isDeviceOnline();
              if (!online) {
                Alert.alert("Offline", "Connect to the network to push counts to ERP.");
                return;
              }

              const wh = await getCycleCountWarehouseContext(getWarehouseCode());
              const postingDate = new Date().toISOString().split("T")[0];
              const { counted_by: countedBy, device_id: deviceId } =
                await getCycleCountPushIdentity();

              const db = await getDatabase();
              const persistedLines = await db.getAllAsync<{
                item_code: string;
                carton_id: string | null;
                counted_qty: number;
              }>(
                `SELECT item_code, carton_id, counted_qty FROM cycle_count_lines
                 WHERE session_id = ? AND carton_id = ? AND counted_qty > 0`,
                [sessionId, cartonId]
              );
              const linesForErp =
                persistedLines.length > 0
                  ? persistedLines
                  : linesToPush.map((line) => ({
                      item_code: line.item_code,
                      carton_id: cartonId,
                      counted_qty: Number(line.counted_qty),
                    }));

              const response = await apiService.syncCycleCountTaskCaptureOnly({
                task: {
                  external_ref: sessionId,
                  count_mode: countModeToApiValue(countMode),
                  company: wh.company,
                  warehouse: wh.warehouse_name,
                  warehouse_code: wh.warehouse_code,
                  bin_location: binCode,
                  posting_date: postingDate,
                  status: "Completed",
                  counted_by: countedBy,
                  device_id: deviceId,
                },
                lines: linesForErp.map((line) => ({
                  item_code: line.item_code,
                  bin_location: binCode,
                  carton_id: cartonId || line.carton_id || "",
                  counted_qty: Number(line.counted_qty),
                })),
              });

              const result = unwrapFrappeMessage(response);
              console.log(
                "📥 ERP push audit:",
                JSON.stringify({
                  api_version: result?.api_version,
                  device_id: result?.device_id,
                  counted_by: result?.counted_by,
                  audit_debug: result?.audit_debug,
                })
              );
              const batch = result?.batch;
              if (!result?.ok) {
                throw new Error(result?.message || "ERP push failed");
              }

              const now = new Date().toISOString();
              await db.runAsync(
                `UPDATE cycle_count_sessions
                 SET status = 'Submitted', erp_batch = ?, erp_locked_carton_id = ?, updated_at = ?
                 WHERE session_id = ?`,
                [batch || null, cartonId, now, sessionId]
              );
              if (batch) setErpBatch(batch);
              setErpLockedCartonId(cartonId);

              Alert.alert(
                "Pushed to ERP",
                batch
                  ? `Batch ${batch} created. Ask finance to post in ERP, then tap Sync Stock from Server.`
                  : "Count pushed to ERP successfully."
              );
            } catch (error: any) {
              console.error("Push to ERP failed:", error);
              Alert.alert("Push Failed", error.message || "Could not push to ERP");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  const handleSyncStockFromServer = async () => {
    if (!erpBatch) {
      Alert.alert(
        "No Batch",
        "Push the count to ERP first to receive a batch number."
      );
      return;
    }

    setSyncingStock(true);
    try {
      const online = await isDeviceOnline();
      if (!online) {
        Alert.alert("Offline", "Connect to the network to sync stock from ERP.");
        return;
      }

      const response = await apiService.getCycleCountStockSync(erpBatch);
      const result = unwrapFrappeMessage(response);

      if (!result?.ok) {
        Alert.alert("Sync Failed", result?.message || "Could not sync stock");
        return;
      }

      if (!result.ready) {
        Alert.alert(
          "Not Posted Yet",
          result.message ||
            "Batch is not posted on ERP yet. Wait for finance to post, then try again."
        );
        return;
      }

      const { cleared, updated } = await applyCycleCountStockSync(result);
      if (cartonId && !isBlindCount) {
        await loadExpectedItems();
      }
      await loadSession();

      Alert.alert(
        "Stock Synced",
        `Applied ${cleared} cleared carton(s) and ${updated} balance row(s) from batch ${erpBatch}.`
      );
    } catch (error: any) {
      console.error("Stock sync failed:", error);
      Alert.alert("Sync Failed", error.message || "Could not sync stock");
    } finally {
      setSyncingStock(false);
    }
  };

  /** @deprecated use handlePushToErp */
  const handleSubmitBinCount = handlePushToErp;

  const renderCountLine = ({ item }: { item: CountLine }) => {
    const isEditing = editingLineId === item.line_id;
    const hasExpected =
      !isBlindCount &&
      item.expected_qty !== null &&
      item.expected_qty !== undefined;
    const expectedQty = hasExpected ? Number(item.expected_qty) : null;
    const balanceQty =
      expectedQty !== null ? item.counted_qty - expectedQty : null;
    const isAdhoc = isAdhocAddMode(countMode);
    const expectedLabel = isAdhoc ? "Previous (carton)" : "Expected";
    const balanceLabel =
      isAdhoc && balanceQty !== null && balanceQty > 0
        ? "Additional"
        : "Balance";
    const balanceColor =
      balanceQty === null
        ? "#666"
        : balanceQty === 0
        ? "#4CAF50"
        : balanceQty > 0
        ? "#FF9800"
        : "#F44336";

    return (
      <View style={styles.countLineCard}>
        <View style={styles.countLineHeader}>
          <View style={styles.countLineLeft}>
            <Text style={styles.itemCode}>{item.item_code}</Text>
            <Text style={styles.itemName}>{item.item_name || item.item_code}</Text>
            {item.barcode && (
              <Text style={styles.barcodeText}>Barcode: {item.barcode}</Text>
            )}
          </View>
        </View>

        <View style={styles.countLineBody}>
          <View style={styles.qtySummaryRow}>
            <View style={[styles.qtySummaryBox, styles.expectedQtyBox]}>
              <Text style={styles.qtySummaryLabel}>{expectedLabel}</Text>
              <Text style={[styles.qtySummaryValue, styles.expectedQtyValue]}>
                {expectedQty !== null ? expectedQty : "-"}
              </Text>
            </View>

            <View style={[styles.qtySummaryBox, styles.countedQtyBox]}>
              <Text style={styles.qtySummaryLabel}>Counted</Text>
              {isEditing ? (
                <Text
                  style={[
                    styles.qtySummaryValue,
                    styles.countedQtyValue,
                    item.counted_qty === 0 && styles.qtyValueZero,
                  ]}
                >
                  {item.counted_qty}
                </Text>
              ) : (
                <TouchableOpacity
                  onPress={() => handleEditQty(item.line_id, item.counted_qty)}
                  accessibilityLabel={`Edit counted quantity for ${item.item_code}`}
                >
                  <Text
                    style={[
                      styles.qtySummaryValue,
                      styles.countedQtyValue,
                      styles.countedQtyEditable,
                      item.counted_qty === 0 && styles.qtyValueZero,
                    ]}
                  >
                    {item.counted_qty}
                  </Text>
                  <Text style={styles.tapToEditHint}>Tap to edit</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={[styles.qtySummaryBox, styles.balanceQtyBox]}>
              <Text style={styles.qtySummaryLabel}>{balanceLabel}</Text>
              <Text style={[styles.qtySummaryValue, { color: balanceColor }]}>
                {balanceQty !== null
                  ? balanceQty > 0
                    ? `+${balanceQty}`
                    : balanceQty
                  : "-"}
              </Text>
            </View>
          </View>

          {balanceQty !== null && (
            <Text style={[styles.qtyHintText, { color: balanceColor }]}>
              {balanceQty === 0
                ? "Count matched"
                : balanceQty > 0
                ? isAdhoc
                  ? `Additional ${balanceQty}`
                  : `Over by ${balanceQty}`
                : `Short by ${Math.abs(balanceQty)}`}
            </Text>
          )}

          {isEditing ? (
            <View style={styles.editQtyRow}>
              <TextInput
                style={styles.editQtyInput}
                value={editQty}
                onChangeText={setEditQty}
                keyboardType="decimal-pad"
                showSoftInputOnFocus
                selectTextOnFocus
                autoFocus
                placeholder="Enter quantity"
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
            <>
              <View style={styles.qtyActionRow}>
                <View style={styles.qtySection}>
                  <Text style={styles.qtyLabel}>UOM</Text>
                  <Text style={styles.uomText}>{item.uom}</Text>
                </View>
                <Text
                  style={[
                    styles.qtyStatusText,
                    { color: balanceColor },
                  ]}
                >
                  {expectedQty !== null
                    ? balanceQty === 0
                      ? "Complete"
                      : balanceQty && balanceQty > 0
                      ? "In Progress"
                      : "Over Count"
                    : "Counted"}
                </Text>

                <TouchableOpacity
                  style={styles.editButton}
                  onPress={() => handleEditQty(item.line_id, item.counted_qty)}
                >
                  <Text style={styles.editButtonText}>Edit</Text>
                </TouchableOpacity>
                {item.counted_qty > 0 ? (
                  <TouchableOpacity
                    style={styles.clearLineButton}
                    onPress={() =>
                      handleClearLineQty(
                        item.line_id,
                        item.item_code,
                        item.counted_qty
                      )
                    }
                  >
                    <Text style={styles.clearLineButtonText}>Clear</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          )}
        </View>
      </View>
    );
  };

  const scannedItemCount = countLines.filter(
    (line) => Number(line.counted_qty || 0) > 0
  ).length;
  const totalScannedQty = countLines.reduce(
    (sum, line) => sum + (Number(line.counted_qty) || 0),
    0
  );

  const renderListEmpty = () => (
    <View style={styles.emptyListCompact}>
      <Text style={styles.emptyListText}>
        {isBlindCount ? "No items scanned yet." : "No items for this carton."}
      </Text>
    </View>
  );

  const completeBinSetup = async (rawBin: string) => {
    const scannedBin = rawBin.trim().toUpperCase();
    if (!scannedBin) return;

    if (!setupScanMethod) {
      Alert.alert(
        "Select Scan Method",
        "Choose Local, Blind Count, or Scan Online before scanning the bin."
      );
      return;
    }

    setBinSetupLoading(true);
    try {
      const validatedBin = await validateCycleCountBin(scannedBin, setupScanOnline);
      if (!validatedBin) return;

      const result = await startCycleCountSession({
        binInfo: validatedBin,
        countType: routeCountType || "Directed",
        countMode,
        isBlindCount: setupBlindCount,
        preCreatedSessionId: routeParams.preCreatedSessionId,
        preCreatedTaskTitle: routeParams.preCreatedTaskTitle,
        forceNewSession: Boolean(forceNewSessionParam),
      });

      setScanOnlineEnabled(setupScanOnline);
      setSessionCountType(routeCountType || "Directed");
      skipCartonRestoreRef.current = true;
      setCartonId(null);
      setErpLockedCartonId(null);

      (navigation as any).replace("CycleCountBinCounting", {
        sessionId: result.sessionId,
        binCode: result.binInfo.bin_code,
        binInfo: result.binInfo,
        countType: routeCountType || "Directed",
        countMode,
        isBlindCount: setupBlindCount,
        scanOnline: setupScanOnline,
        openingStock,
        skipCartonRestore: true,
      });
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to start count for this bin");
    } finally {
      setBinSetupLoading(false);
    }
  };

  if (needsBinSetup) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView
          style={styles.binSetupContainer}
          contentContainerStyle={styles.binSetupScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.binSetupHeader}>
            <Text style={styles.binSetupTitle}>
              {routeCountType === "Adhoc" ? "Ad-hoc Count" : "Directed Count"}
            </Text>
            <Text style={styles.binSetupSubtitle}>
              Choose scan method, then scan bin code
            </Text>
          </View>

          <View style={styles.binSetupSection}>
            <Text style={styles.binSetupFieldLabel}>Scan Method</Text>
            <Text style={styles.binSetupFieldHint}>
              Required — pick one before scanning the bin
            </Text>
            <View style={styles.binSetupScanMethodRow}>
              <TouchableOpacity
                style={[
                  styles.binSetupScanMethodButton,
                  setupScanMethod === "local" && styles.binSetupModeButtonActive,
                ]}
                onPress={() => setSetupScanMethod("local")}
              >
                <Text
                  style={[
                    styles.binSetupScanMethodText,
                    setupScanMethod === "local" && styles.binSetupModeTextActive,
                  ]}
                >
                  Local
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.binSetupScanMethodButton,
                  setupScanMethod === "blind" && styles.binSetupModeButtonActive,
                ]}
                onPress={() => setSetupScanMethod("blind")}
              >
                <Text
                  style={[
                    styles.binSetupScanMethodText,
                    setupScanMethod === "blind" && styles.binSetupModeTextActive,
                  ]}
                >
                  Blind Count
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.binSetupScanMethodButton,
                  setupScanMethod === "online" && styles.binSetupModeButtonActive,
                ]}
                onPress={() => setSetupScanMethod("online")}
              >
                <Text
                  style={[
                    styles.binSetupScanMethodText,
                    setupScanMethod === "online" && styles.binSetupModeTextActive,
                  ]}
                >
                  Scan Online
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View
            style={[
              styles.binSetupCard,
              !binScanReady && styles.binSetupCardDisabled,
            ]}
          >
            <Text style={styles.binSetupFieldLabel}>Bin Code</Text>
            {!binScanReady ? (
              <Text style={styles.binSetupBlockedHint}>
                Select a scan method above to enable bin scanning
              </Text>
            ) : null}
            <BarcodeInput
              ref={binSetupInputRef}
              autoFocus={binScanReady}
              placeholder={
                binScanReady
                  ? "Scan or enter bin code"
                  : "Select scan method first"
              }
              showSoftInputOnFocus={binScanReady}
              onBarcodeScanned={completeBinSetup}
              disabled={binSetupLoading || !binScanReady}
              containerStyle={styles.binSetupInputWrap}
              inputStyle={[
                styles.binSetupInput,
                !binScanReady && styles.binSetupInputDisabled,
              ]}
              submitButtonStyle={[
                styles.binSetupSubmitButton,
                !binScanReady && styles.binSetupSubmitButtonDisabled,
              ]}
              submitTextStyle={styles.binSetupSubmitButtonText}
              submitLabel="Submit"
            />
            {binSetupLoading ? (
              <View style={styles.binSetupLoading}>
                <ActivityIndicator size="small" color="#9C27B0" />
                <Text style={styles.binSetupLoadingText}>Validating bin…</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.binSetupSection}>
            <Text style={styles.binSetupFieldLabel}>Count Mode</Text>
            <View style={styles.binSetupModeRow}>
              <TouchableOpacity
                style={[
                  styles.binSetupModeButton,
                  countMode === "Reconciliation" && styles.binSetupModeButtonActive,
                ]}
                onPress={() => setCountMode("Reconciliation")}
              >
                <Text
                  style={[
                    styles.binSetupModeText,
                    countMode === "Reconciliation" && styles.binSetupModeTextActive,
                  ]}
                >
                  Reconciliation
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.binSetupModeButton,
                  countMode === "Adhoc Add" && styles.binSetupModeButtonActive,
                ]}
                onPress={() => setCountMode("Adhoc Add")}
              >
                <Text
                  style={[
                    styles.binSetupModeText,
                    countMode === "Adhoc Add" && styles.binSetupModeTextActive,
                  ]}
                >
                  Adhoc Add
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
      >
        <View style={styles.screenBody}>
          <View style={styles.binHeaderCard}>
            <View style={styles.headerTopRow}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                Bin: {binCode}
              </Text>
              <View style={styles.headerTopBadges}>
                <View style={styles.modeBadge}>
                  <Text style={styles.modeBadgeText}>{countMode}</Text>
                </View>
                {shouldLoadExpectedItems && !isBlindCount ? (
                  <View style={styles.directedBadge}>
                    <Text style={styles.directedBadgeText}>Directed</Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.headerStatsCenter}>
              <Text style={styles.headerStatsValue}>
                {scannedItemCount} item{scannedItemCount === 1 ? "" : "s"}
              </Text>
              <Text style={styles.headerStatsDivider}>|</Text>
              <Text style={styles.headerStatsValue}>
                Total Qty: {totalScannedQty}
              </Text>
            </View>

            {!isBlindCount ? (
              <View style={styles.scanModeSwitchRow}>
                <TouchableOpacity
                  style={[
                    styles.scanModeSwitchBtn,
                    !scanOnlineEnabled && styles.scanModeSwitchBtnActive,
                  ]}
                  onPress={() => handleScanModeChange(false)}
                >
                  <Text
                    style={[
                      styles.scanModeSwitchText,
                      !scanOnlineEnabled && styles.scanModeSwitchTextActive,
                    ]}
                  >
                    Local
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.scanModeSwitchBtn,
                    scanOnlineEnabled && styles.scanModeSwitchBtnActive,
                  ]}
                  onPress={() => handleScanModeChange(true)}
                >
                  <Text
                    style={[
                      styles.scanModeSwitchText,
                      scanOnlineEnabled && styles.scanModeSwitchTextActive,
                    ]}
                  >
                    Online
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={styles.headerContentRow}>
              <View style={styles.headerLeftColumn}>
                {cartonId ? (
                  <View style={styles.headerMetaRow}>
                    <Text style={styles.cartonIdText} numberOfLines={1}>
                      CTN: {cartonId}
                      {isCartonLocked ? " (locked)" : ""}
                    </Text>
                    {!isCartonLocked ? (
                      <TouchableOpacity
                        style={styles.changeCartonButton}
                        onPress={handleChangeCartonId}
                      >
                        <Text style={styles.changeCartonButtonText}>
                          Change Carton
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.headerSubtext}>Scan carton to start</Text>
                )}
              </View>

              <View style={styles.headerRightColumn}>
                {isBlindCount ? (
                  <View style={styles.blindBadge}>
                    <Text style={styles.blindBadgeText}>Blind</Text>
                  </View>
                ) : null}
                {erpBatch ? (
                  <Text style={styles.batchText} numberOfLines={2}>
                    {erpBatch}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.headerActionsRow}>
              <TouchableOpacity
                style={[
                  styles.headerActionButton,
                  styles.headerActionButtonMark,
                  saving === true ||
                  (!cartonId && cartonIdInput.trim().length > 0)
                    ? { opacity: 0.5 }
                    : {},
                ]}
                onPress={handleMarkBinCompleted}
                disabled={
                  Boolean(saving) ||
                  (!cartonId && cartonIdInput.trim().length > 0)
                }
              >
                <Text style={styles.headerActionButtonText}>Mark Bin</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.headerActionButton,
                  styles.headerActionButtonPush,
                ]}
                onPress={handlePushToErp}
                disabled={saving || countLines.length === 0 || !cartonId}
              >
                <Text style={styles.headerActionButtonText}>Push to ERP</Text>
              </TouchableOpacity>

              {erpBatch ? (
                <TouchableOpacity
                  style={[
                    styles.headerActionButton,
                    styles.headerActionButtonSync,
                  ]}
                  onPress={handleSyncStockFromServer}
                  disabled={syncingStock}
                >
                  <Text style={styles.headerActionButtonText}>
                    {syncingStock ? "Sync…" : "Sync Stock"}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {!cartonId && !isCartonLocked ? (
            <View style={styles.flexFill}>
              <View style={styles.cartonIdCard}>
                <Text style={styles.cartonIdCardTitle}>Scan or Create Carton</Text>
                <Text style={styles.cartonIdCardSubtitle}>
                  Scan the carton in this bin before counting items
                </Text>
                <BarcodeInput
                  ref={cartonIdInputRef}
                  autoFocus
                  placeholder="Carton ID (e.g. NEWCTN)"
                  showSoftInputOnFocus
                  showKeyboardButton
                  keyboardToggle
                  keyboardButtonLabel="⌨"
                  showClearButton
                  actionsPosition="top"
                  compactActions
                  onChangeText={(t) => setCartonIdInput(normalizeCartonId(t))}
                  onBarcodeScanned={(raw) =>
                    handleCartonIdScan(normalizeCartonId(raw))
                  }
                  containerStyle={styles.cartonIdInputRow}
                  inputStyle={styles.cartonIdInput}
                  submitButtonStyle={[
                    styles.cartonScanActionButton,
                    styles.cartonIdSubmitButton,
                  ]}
                  keyboardButtonStyle={styles.cartonScanActionButton}
                  clearButtonStyle={[
                    styles.cartonScanActionButton,
                    styles.cartonScanClearButton,
                  ]}
                  clearButtonTextStyle={styles.cartonScanClearButtonText}
                  submitTextStyle={styles.cartonIdSubmitButtonText}
                  keyboardButtonTextStyle={styles.cartonScanKeyboardButtonText}
                  submitLabel="Use"
                />
                <View style={styles.cartonIdActionRow}>
                  <TouchableOpacity
                    style={styles.createCartonButton}
                    onPress={handleCreateNewCarton}
                  >
                    <Text style={styles.createCartonButtonText}>New Carton</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.generateCartonButton}
                    onPress={handleGenerateCartonId}
                  >
                    <Text style={styles.generateCartonButtonText}>Generate</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : null}

          {cartonId ? (
            <>
              <View style={styles.scanCard}>
                <View style={styles.manualInputSection}>
                  <BarcodeInput
                    ref={barcodeInputRef}
                    autoFocus={!editingLineId}
                    debounceMs={180}
                    placeholder="Scan or enter barcode"
                    onBarcodeScanned={handleItemScan}
                    showSoftInputOnFocus={false}
                    showKeyboardButton
                    keyboardToggle
                    keyboardButtonLabel="⌨"
                    showClearButton
                    actionsPosition="top"
                    compactActions
                    onError={(message, err) =>
                      console.warn("BarcodeInput:", message, err)
                    }
                    disabled={!!editingLineId}
                    containerStyle={styles.manualBarcodeInputRow}
                    inputStyle={styles.manualInput}
                    submitButtonStyle={[
                      styles.manualScanActionButton,
                      styles.manualScanSubmitButton,
                    ]}
                    keyboardButtonStyle={styles.manualScanActionButton}
                    clearButtonStyle={[
                      styles.manualScanActionButton,
                      styles.manualScanClearButton,
                    ]}
                    clearButtonTextStyle={styles.manualClearButtonText}
                    submitTextStyle={styles.manualSubmitButtonText}
                    keyboardButtonTextStyle={styles.manualKeyboardButtonText}
                    submitLabel="Submit"
                  />
                </View>
              </View>

              <FlatList
                ref={listRef}
                data={countLines}
                keyExtractor={(item) => item.line_id}
                renderItem={renderCountLine}
                style={styles.flexFill}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
                ListEmptyComponent={renderListEmpty}
              />
            </>
          ) : null}
        </View>

        {/* Scanner Modal */}
        {showScanner && (
          <Modal
            visible={showScanner}
            transparent={true}
            animationType="slide"
            onRequestClose={() => {
              setShowScanner(false);
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
                      setShowScanner(false);
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
                    setShowScanner(false);
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
  screenBody: {
    flex: 1,
  },
  flexFill: {
    flex: 1,
  },
  cartonScrollContent: {
    padding: 12,
    paddingBottom: 24,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 16,
    flexGrow: 1,
  },
  binHeaderCard: {
    backgroundColor: "#9C27B0",
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 4,
    borderRadius: 0,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 4,
  },
  headerTopBadges: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 4,
    maxWidth: "55%",
  },
  headerStatsCenter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    marginBottom: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 8,
    gap: 10,
  },
  headerStatsValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFF",
  },
  headerStatsDivider: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.6)",
    fontWeight: "600",
  },
  scanModeSwitchRow: {
    flexDirection: "row",
    alignSelf: "stretch",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 8,
    padding: 3,
    marginBottom: 6,
    gap: 4,
  },
  scanModeSwitchBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: "center",
    borderRadius: 6,
  },
  scanModeSwitchBtnActive: {
    backgroundColor: "rgba(255, 255, 255, 0.28)",
  },
  scanModeSwitchText: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.65)",
  },
  scanModeSwitchTextActive: {
    color: "#FFF",
  },
  headerContentRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 4,
  },
  headerLeftColumn: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  headerRightColumn: {
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "flex-start",
    gap: 4,
    maxWidth: "42%",
  },
  headerMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  headerActionsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 6,
    marginTop: 2,
  },
  headerActionButton: {
    flex: 1,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.35)",
    paddingHorizontal: 4,
  },
  headerActionButtonMark: {
    backgroundColor: "rgba(255, 255, 255, 0.22)",
  },
  headerActionButtonPush: {
    backgroundColor: "#4CAF50",
    borderColor: "#43A047",
  },
  headerActionButtonSync: {
    backgroundColor: "#2196F3",
    borderColor: "#1E88E5",
  },
  headerActionButtonText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "bold",
    color: "#FFF",
    minWidth: 0,
  },
  blindBadge: {
    backgroundColor: "#FF9800",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  blindBadgeText: {
    color: "#FFF",
    fontSize: 10,
    fontWeight: "600",
  },
  directedBadge: {
    backgroundColor: "#4F46E5",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  directedBadgeText: {
    color: "#FFF",
    fontSize: 10,
    fontWeight: "600",
  },
  modeBadge: {
    backgroundColor: "#7B1FA2",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  modeBadgeText: {
    color: "#FFF",
    fontSize: 10,
    fontWeight: "600",
  },
  batchText: {
    fontSize: 9,
    color: "#E1BEE7",
    fontWeight: "600",
    textAlign: "right",
  },
  expectedHintText: {
    fontSize: 12,
    color: "#64748B",
    lineHeight: 18,
    marginBottom: 8,
  },
  onlineScanBadge: {
    backgroundColor: "#0F766E",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  onlineScanBadgeText: {
    color: "#FFF",
    fontSize: 10,
    fontWeight: "600",
  },
  taskTitleText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#FFF",
    marginTop: 2,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: "flex-start",
  },
  cartonIdText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#FFF",
    backgroundColor: "rgba(33, 150, 243, 0.35)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    alignSelf: "flex-start",
  },
  headerSubtext: {
    fontSize: 12,
    color: "#E1BEE7",
    fontStyle: "italic",
  },
  scanCard: {
    backgroundColor: "#2196F3",
    marginHorizontal: 10,
    marginBottom: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: "hidden",
  },
  scanOnlineToggle: {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.35)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  scanOnlineToggleCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#FFF",
    marginRight: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  scanOnlineToggleCircleActive: {
    backgroundColor: "#0F766E",
    borderColor: "#0F766E",
  },
  scanOnlineToggleCheck: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  scanOnlineToggleTextWrap: {
    flex: 1,
  },
  scanOnlineToggleLabel: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "bold",
  },
  scanOnlineToggleDescription: {
    color: "#E3F2FD",
    fontSize: 12,
    marginTop: 2,
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
    padding: 8,
    borderRadius: 8,
  },
  manualInputLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#333",
    marginBottom: 4,
  },
  manualInputHint: {
    fontSize: 13,
    color: "#666",
    marginBottom: 12,
    lineHeight: 18,
  },
  manualInputHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  manualInputRow: {
    flexDirection: "row",
    gap: 8,
  },
  manualBarcodeInputRow: {
    alignSelf: "stretch",
    width: "100%",
  },
  manualBarcodeActions: {
    flexDirection: "row",
    gap: 6,
    justifyContent: "flex-end",
  },
  manualInput: {
    alignSelf: "stretch",
    width: "100%",
    backgroundColor: "#F5F5F5",
    borderWidth: 2,
    borderColor: "#BBDEFB",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 20,
    fontWeight: "600",
    minHeight: 52,
  },
  manualScanActionButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 38,
    maxHeight: 38,
    paddingHorizontal: 4,
    backgroundColor: "#E3F2FD",
    borderColor: "#BBDEFB",
  },
  manualScanSubmitButton: {
    backgroundColor: "#4CAF50",
    borderColor: "#43A047",
  },
  manualScanClearButton: {
    backgroundColor: "#FFEBEE",
    borderColor: "#FFCDD2",
  },
  keyboardToggleButton: {
    minWidth: 42,
    minHeight: 28,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "#E0F2FE",
    borderColor: "#7DD3FC",
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  keyboardToggleButtonText: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#0369A1",
  },
  manualSubmitButton: {
    minWidth: 58,
    minHeight: 34,
    paddingHorizontal: 8,
  },
  manualKeyboardButton: {
    minWidth: 48,
    minHeight: 34,
    paddingHorizontal: 8,
    backgroundColor: "#E3F2FD",
    borderColor: "#BBDEFB",
  },
  manualKeyboardButtonText: {
    color: "#1565C0",
    fontSize: 13,
    fontWeight: "700",
  },
  manualClearButton: {
    minWidth: 40,
    minHeight: 34,
    paddingHorizontal: 6,
  },
  manualClearButtonText: {
    fontSize: 14,
    lineHeight: 16,
  },
  manualSubmitButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFF",
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
  emptyList: {
    padding: 40,
    alignItems: "center",
  },
  emptyListCompact: {
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  emptyListText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  countLineCard: {
    backgroundColor: "#FFF",
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  countLineHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  countLineLeft: {
    flex: 1,
  },
  itemCode: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 2,
  },
  itemName: {
    fontSize: 14,
    color: "#0F766E",
    fontWeight: "700",
    marginBottom: 2,
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
    paddingTop: 8,
  },
  qtyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  qtySummaryRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 6,
  },
  qtySummaryBox: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderWidth: 1,
  },
  expectedQtyBox: {
    backgroundColor: "#EEF2FF",
    borderColor: "#C7D2FE",
  },
  countedQtyBox: {
    backgroundColor: "#F3E8FF",
    borderColor: "#E9D5FF",
  },
  balanceQtyBox: {
    backgroundColor: "#F8FAFC",
    borderColor: "#E2E8F0",
  },
  qtySummaryLabel: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "700",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  qtySummaryValue: {
    fontSize: 18,
    fontWeight: "bold",
  },
  expectedQtyValue: {
    color: "#4F46E5",
  },
  countedQtyValue: {
    color: "#9C27B0",
  },
  countedQtyEditable: {
    textDecorationLine: "underline",
  },
  tapToEditHint: {
    fontSize: 10,
    color: "#9C27B0",
    marginTop: 2,
    fontWeight: "600",
  },
  qtyHintText: {
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
  },
  qtyActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
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
  qtyValueZero: {
    color: "#999",
    opacity: 0.6,
  },
  uomText: {
    fontSize: 12,
    color: "#999",
  },
  qtyStatusText: {
    fontSize: 13,
    fontWeight: "700",
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
  clearLineButton: {
    backgroundColor: "#FFEBEE",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FFCDD2",
  },
  clearLineButtonText: {
    color: "#C62828",
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
  topActionButtonBlue: {
    backgroundColor: "#2196F3",
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
  cartonIdContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: 2,
    gap: 6,
  },
  changeCartonButton: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.35)",
    flexShrink: 0,
  },
  changeCartonButtonText: {
    fontSize: 11,
    color: "#FFF",
    fontWeight: "700",
  },
  cartonIdCard: {
    backgroundColor: "#0F766E",
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
    alignSelf: "stretch",
    width: "100%",
  },
  cartonIdInput: {
    alignSelf: "stretch",
    width: "100%",
    backgroundColor: "#FFF",
    borderWidth: 2,
    borderColor: "#CCFBF1",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 56,
    fontSize: 17,
    fontWeight: "600",
  },
  cartonScanActionButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 38,
    maxHeight: 38,
    paddingHorizontal: 4,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    borderColor: "rgba(255, 255, 255, 0.6)",
    borderRadius: 10,
  },
  cartonScanClearButton: {
    backgroundColor: "#FEE2E2",
    borderColor: "#FECACA",
  },
  cartonScanClearButtonText: {
    color: "#B91C1C",
    fontSize: 14,
    fontWeight: "700",
  },
  cartonScanKeyboardButtonText: {
    color: "#0F766E",
    fontSize: 12,
    fontWeight: "700",
  },
  cartonIdActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    alignItems: "stretch",
  },
  cartonIdSubmitButton: {
    backgroundColor: "#F97316",
    borderColor: "#EA580C",
  },
  cartonIdSubmitButtonText: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "bold",
  },
  createCartonButton: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.28)",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.5)",
    justifyContent: "center",
  },
  createCartonButtonText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "700",
  },
  generateCartonButton: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.35)",
    justifyContent: "center",
  },
  generateCartonButtonText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "600",
  },
  // Modal styles for BarcodeScanner
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 20,
    width: "90%",
    maxWidth: 500,
    maxHeight: "80%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
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
    fontSize: 20,
    color: "#666",
    fontWeight: "bold",
  },
  binSetupContainer: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  binSetupScrollContent: {
    paddingBottom: 24,
  },
  binSetupHeader: {
    backgroundColor: "#9C27B0",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
  },
  binSetupTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#FFF",
    marginBottom: 4,
  },
  binSetupSubtitle: {
    fontSize: 15,
    color: "#E1BEE7",
  },
  binSetupCard: {
    backgroundColor: "#FFF",
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  binSetupSection: {
    marginHorizontal: 16,
    marginTop: 12,
  },
  binSetupFieldLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  binSetupFieldHint: {
    fontSize: 13,
    color: "#666",
    marginTop: -4,
    marginBottom: 8,
  },
  binSetupScanMethodRow: {
    flexDirection: "row",
    gap: 8,
  },
  binSetupScanMethodButton: {
    flex: 1,
    backgroundColor: "#FFF",
    borderWidth: 2,
    borderColor: "#DDD",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: "center",
  },
  binSetupScanMethodText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#333",
    textAlign: "center",
  },
  binSetupCardDisabled: {
    opacity: 0.72,
  },
  binSetupBlockedHint: {
    fontSize: 13,
    color: "#9C27B0",
    fontWeight: "600",
    marginBottom: 8,
  },
  binSetupInputWrap: {
    alignSelf: "stretch",
    width: "100%",
  },
  binSetupInput: {
    flex: 1,
    backgroundColor: "#FFF",
    borderWidth: 2,
    borderColor: "#9C27B0",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: "600",
    minHeight: 56,
  },
  binSetupInputDisabled: {
    borderColor: "#CCC",
    backgroundColor: "#F5F5F5",
    color: "#999",
  },
  binSetupSubmitButton: {
    backgroundColor: "#9C27B0",
    borderColor: "#9C27B0",
    minWidth: 80,
    minHeight: 56,
  },
  binSetupSubmitButtonDisabled: {
    backgroundColor: "#CCC",
    borderColor: "#CCC",
  },
  binSetupSubmitButtonText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "700",
  },
  binSetupLoading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 10,
  },
  binSetupLoadingText: {
    fontSize: 13,
    color: "#666",
  },
  binSetupModeRow: {
    flexDirection: "row",
    gap: 8,
  },
  binSetupModeButton: {
    flex: 1,
    backgroundColor: "#FFF",
    borderWidth: 2,
    borderColor: "#DDD",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  binSetupModeButtonActive: {
    borderColor: "#9C27B0",
    backgroundColor: "#F3E5F5",
  },
  binSetupModeText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#333",
  },
  binSetupModeTextActive: {
    color: "#7B1FA2",
  },
});
