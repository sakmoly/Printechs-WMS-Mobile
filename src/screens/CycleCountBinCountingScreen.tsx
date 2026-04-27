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
import { syncCycleCountSession } from "../services/cycle-count-sync.service";
import { isDeviceOnline } from "../utils/network-check";
import { resolveItemFromBarcode } from "../services/item-master.service";
import {
  BarcodeInput,
  type BarcodeInputHandle,
} from "../components/BarcodeInput";

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

export default function CycleCountBinCountingScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const routeParams = (route.params as any) || {};
  const {
    sessionId,
    binCode,
    binInfo,
    isBlindCount,
    cartonId: initialCartonId,
  } = routeParams;

  // ✅ DEBUG: Log route params to verify carton ID is passed
  useEffect(() => {
    console.log(`📦 CycleCountBinCountingScreen: Route params received:`, {
      sessionId,
      binCode,
      cartonId: initialCartonId,
      isBlindCount,
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
  const [cartonId, setCartonId] = useState<string | null>(null); // ✅ NEW: Carton ID will be scanned in this screen
  const [cartonIdInput, setCartonIdInput] = useState(""); // ✅ NEW: Input field for carton ID
  const [showCartonScanner, setShowCartonScanner] = useState(false); // ✅ NEW: Scanner modal for carton ID
  const cartonIdInputRef = useRef<BarcodeInputHandle>(null); // ✅ NEW: Ref for carton ID input
  const skipCartonRestoreRef = useRef<boolean>(false); // ✅ NEW: Flag to skip carton ID restoration when user explicitly clears it

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

  useFocusEffect(
    useCallback(() => {
      console.log(
        `🔄 useFocusEffect: Screen focused, sessionId: ${sessionId}, current cartonId: ${
          cartonId || "null"
        }`
      );

      // ✅ FIX: Async function inside callback (useFocusEffect doesn't support async callbacks)
      const loadData = async () => {
        // ✅ FIX: Restore cartonId from database if not set in route params
        // This ensures cartonId is restored when returning to the screen after saving draft
        // BUT skip restoration if user explicitly cleared it (clicked "Change Carton")
        let restoredCartonId = cartonId;
        if (!cartonId && sessionId && !skipCartonRestoreRef.current) {
          try {
            const db = await getDatabase();
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
              // Wait a bit for state to update
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          } catch (error: any) {
            console.warn(
              `⚠️ Could not restore cartonId from database:`,
              error.message
            );
          }
        } else if (skipCartonRestoreRef.current) {
          console.log(
            `📦 Skipping carton ID restoration - user explicitly cleared it`
          );
          // Reset the flag after skipping restoration
          skipCartonRestoreRef.current = false;
        }

        // ✅ NEW: Load taskTitle (server_session_id) from session FIRST
        // This is needed for loadExpectedItems to check backend task lines
        let loadedTaskTitle: string | null = null;
        if (sessionId) {
          try {
            const db = await getDatabase();
            const session = await db.getFirstAsync<{
              server_session_id: string | null;
            }>(
              "SELECT server_session_id FROM cycle_count_sessions WHERE session_id = ?",
              [sessionId]
            );
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

        // ✅ NEW: Start the task if carton ID is already set (restored from previous session)
        // This ensures the task is started before scanning items, even if user returns to this screen
        // Only starts if task is in "Draft" status - if already "In Progress", skips starting
        if (cartonIdToUse && loadedTaskTitle) {
          // Use the helper function to ensure task is started (only if in Draft status)
          await ensureTaskStarted(loadedTaskTitle);
        }

        // Then load expected items (which will use taskTitle to check backend task lines)
        // Pass taskTitle directly to loadExpectedItems to ensure it has the value
        await loadExpectedItems(loadedTaskTitle);
      };

      // Call the async function
      loadData();
      // ✅ NEW: Auto-focus carton ID input if not set, otherwise focus item barcode input
      setTimeout(() => {
        if (!cartonId) {
          cartonIdInputRef.current?.focus();
        } else {
          barcodeInputRef.current?.focus();
        }
      }, 100);

      // Sync when screen loses focus (user navigates away)
      return () => {
        if (sessionId) {
          console.log(
            `🔄 Screen losing focus, syncing session ${sessionId}...`
          );
          // Use a timeout to ensure sync happens after navigation starts
          setTimeout(async () => {
            try {
              const success = await syncCycleCountSession(sessionId);
              if (success) {
                console.log(
                  `✅ Successfully synced session ${sessionId} on navigation`
                );
              } else {
                console.warn(`⚠️ Sync returned false for session ${sessionId}`);
              }
            } catch (error: any) {
              console.error(
                `❌ Failed to sync session ${sessionId} on navigation:`,
                error
              );
              console.error(`❌ Error details:`, error.message, error.stack);
            }
          }, 100); // Small delay to ensure navigation doesn't block sync
        }
      };
    }, [sessionId, cartonId]) // ✅ FIX: Include cartonId in dependencies so it reloads when carton changes
  );

  // Auto-focus on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  // ✅ NEW: Load session with specific cartonId (can be passed as parameter)
  // ✅ Helper function to start task only if it's in "Draft" status
  const ensureTaskStarted = async (taskTitleToStart: string) => {
    if (!taskTitleToStart) {
      console.log(
        `ℹ️ No task title provided - task will be started when backend task is created`
      );
      return;
    }

    try {
      const online = await isDeviceOnline();
      if (!online) {
        console.log(
          `ℹ️ Device is offline - task ${taskTitleToStart} will be started when synced`
        );
        return;
      }

      // ✅ Check task status first before attempting to start
      try {
        const taskResponse = await apiService.getCycleCount(taskTitleToStart);
        const taskStatus =
          taskResponse?.status ||
          taskResponse?.data?.status ||
          taskResponse?.task?.status ||
          null;

        console.log(
          `📋 Task ${taskTitleToStart} current status: ${
            taskStatus || "unknown"
          }`
        );

        // ✅ Only start if task is in "Draft" status
        // If already "In Progress", "Started", "Submitted", etc., skip starting
        if (
          taskStatus &&
          (taskStatus.toLowerCase() === "draft" ||
            taskStatus.toLowerCase() === "pending")
        ) {
          console.log(
            `📤 Starting cycle count task ${taskTitleToStart} (status: ${taskStatus})...`
          );
          const settings = await getSettings();
          await apiService.startCycleCount(taskTitleToStart, {
            started_by: settings.user_id || settings.user_code || "USER-AUTO",
          });
          console.log(
            `✅ Successfully started task ${taskTitleToStart} - status changed to Started/In Progress`
          );
        } else if (taskStatus) {
          // Task is already started or in progress - no action needed
          console.log(
            `ℹ️ Task ${taskTitleToStart} is already in "${taskStatus}" status - no need to start again`
          );
        } else {
          // Status not found in response - try to start anyway (might be a new task)
          console.log(
            `⚠️ Could not determine task status - attempting to start anyway...`
          );
          const settings = await getSettings();
          await apiService.startCycleCount(taskTitleToStart, {
            started_by: settings.user_id || settings.user_code || "USER-AUTO",
          });
          console.log(`✅ Successfully started task ${taskTitleToStart}`);
        }
      } catch (getStatusError: any) {
        // If getCycleCount fails, the task might not exist yet - try to start anyway
        // This will fail gracefully if task doesn't exist
        console.warn(
          `⚠️ Could not check task status: ${getStatusError.message} - attempting to start anyway...`
        );
        try {
          const settings = await getSettings();
          await apiService.startCycleCount(taskTitleToStart, {
            started_by: settings.user_id || settings.user_code || "USER-AUTO",
          });
          console.log(`✅ Successfully started task ${taskTitleToStart}`);
        } catch (startError: any) {
          // Handle "already started" error gracefully
          const errorMessage =
            startError.message || startError.toString() || "";
          if (
            errorMessage.includes("INVALID_STATUS") ||
            errorMessage.includes("Cannot start") ||
            errorMessage.includes("status: In Progress") ||
            errorMessage.includes("status: Started")
          ) {
            console.log(
              `ℹ️ Task ${taskTitleToStart} is already started/in progress - no action needed`
            );
          } else {
            throw startError; // Re-throw other errors
          }
        }
      }
    } catch (error: any) {
      const errorMessage = error.message || error.toString() || "";
      if (
        errorMessage.includes("INVALID_STATUS") ||
        errorMessage.includes("Cannot start") ||
        errorMessage.includes("status: In Progress") ||
        errorMessage.includes("status: Started")
      ) {
        console.log(
          `ℹ️ Task ${taskTitleToStart} is already started/in progress - no action needed`
        );
      } else {
        console.warn(
          `⚠️ Failed to start task ${taskTitleToStart}:`,
          error.message
        );
        console.warn(`⚠️ Task will be started during sync or when submitting`);
      }
    }
  };

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

      // ✅ FIX: Show ALL items (both scanned and expected) in the UI
      // Expected items with counted_qty = 0 should be displayed with their expected_qty
      // Note: expected_qty is preserved even when carton_id is set (backend stock ledger is bin-level)
      const allLines = lines
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

  const loadExpectedItems = async (taskTitleParam?: string | null) => {
    // Use provided taskTitle or fall back to state
    const effectiveTaskTitle =
      taskTitleParam !== undefined ? taskTitleParam : taskTitle;

    // ✅ NEW: Only load expected items AFTER carton ID is scanned
    // Items should be filtered by carton_id
    if (!binCode || isBlindCount || !sessionId || !cartonId) {
      if (!cartonId) {
        console.log(
          `⏭️ loadExpectedItems: Skipping - carton ID not scanned yet. Items will be loaded after carton ID is scanned.`
        );
      } else {
        console.log(
          `⏭️ loadExpectedItems: Skipping (binCode: ${binCode}, isBlindCount: ${isBlindCount}, sessionId: ${sessionId})`
        );
      }
      return;
    }

    console.log(
      `🔄 loadExpectedItems: Loading items for carton ${cartonId} in bin ${binCode}, session ${sessionId}`
    );
    setLoading(true);
    try {
      const db = await getDatabase();

      // CRITICAL: Check database directly, not state (state might be stale)
      const existingLinesInDb = await db.getAllAsync<{
        item_code: string;
        counted_qty: number;
      }>(
        "SELECT item_code, counted_qty FROM cycle_count_lines WHERE session_id = ?",
        [sessionId]
      );

      console.log(
        `📋 loadExpectedItems: Found ${existingLinesInDb.length} existing lines in database`
      );
      console.log(
        `📋 loadExpectedItems: Existing lines:`,
        existingLinesInDb.map((l) => ({
          item_code: l.item_code,
          counted_qty: l.counted_qty,
        }))
      );

      // If session already has lines (especially with counted_qty > 0), don't load expected items
      // This prevents overwriting scanned data
      if (existingLinesInDb.length > 0) {
        const hasScannedItems = existingLinesInDb.some(
          (l) => l.counted_qty > 0
        );
        if (hasScannedItems) {
          console.log(
            `✅ loadExpectedItems: Session has scanned items, skipping expected items load to preserve data`
          );
          return;
        }
        console.log(
          `⚠️ loadExpectedItems: Session has lines but no scanned items, will only add missing expected items`
        );
      }

      // ✅ NEW: Priority 1: Try to load expected items from backend task lines first
      // This allows scanning the same bin/carton again and getting expected items from previous task
      let expectedItems: { item_code: string; qty: number }[] = [];
      let loadedFromBackend = false;

      // First, try to load from current task title if available
      if (effectiveTaskTitle) {
        try {
          console.log(
            `🔍 loadExpectedItems: Fetching task lines from backend for task ${effectiveTaskTitle}...`
          );
          const taskResponse = await apiService.getCycleCount(
            effectiveTaskTitle
          );
          const taskData = taskResponse?.data || taskResponse;
          const taskLines = taskData?.lines || taskData?.items || [];

          if (taskLines && taskLines.length > 0) {
            console.log(
              `✅ loadExpectedItems: Found ${taskLines.length} task lines from backend task ${effectiveTaskTitle}`
            );
            // ✅ NEW: Filter task lines by carton_id to only show items in this carton
            const cartonFilteredLines = taskLines.filter((line: any) => {
              const lineCartonId = (line.carton_id || "").trim();
              const currentCartonId = (cartonId || "").trim();
              return (
                !lineCartonId ||
                lineCartonId === currentCartonId ||
                lineCartonId === ""
              );
            });

            expectedItems = cartonFilteredLines
              .filter(
                (line: any) =>
                  line.item_code &&
                  (line.expected_qty || line.expected_qty === 0)
              )
              .map((line: any) => ({
                item_code: line.item_code,
                qty: line.expected_qty || 0,
              }));
            loadedFromBackend = true;
            console.log(
              `✅ loadExpectedItems: Loaded ${expectedItems.length} expected items from backend task lines (filtered by carton ${cartonId})`
            );
          } else {
            console.log(
              `ℹ️ loadExpectedItems: Backend task ${effectiveTaskTitle} has no task lines, will try to find other tasks for this bin`
            );
          }
        } catch (backendError: any) {
          console.warn(
            `⚠️ loadExpectedItems: Failed to fetch task lines from backend task ${effectiveTaskTitle}:`,
            backendError.message
          );
          console.log(
            `ℹ️ loadExpectedItems: Will try to find other tasks for this bin`
          );
        }
      } else {
        console.log(
          `ℹ️ loadExpectedItems: No taskTitle available, will search for backend tasks for bin ${binCode}`
        );
      }

      // ✅ NEW: If current task has no lines, check for other backend tasks for this bin
      // This allows loading expected items from a previous task for the same bin
      if (!loadedFromBackend && binCode) {
        try {
          const online = await isDeviceOnline();
          if (online) {
            console.log(
              `🔍 loadExpectedItems: Searching for backend tasks for bin ${binCode}...`
            );
            const tasksResponse = await apiService.getCycleCounts({
              status: "Draft,In Progress,Review,Completed,Submitted",
            });
            const tasksArray = Array.isArray(tasksResponse)
              ? tasksResponse
              : tasksResponse?.data || tasksResponse?.cycle_counts || [];

            // Normalize bin codes for comparison
            const normalizeBinCode = (
              code: string | null | undefined
            ): string => {
              if (!code) return "";
              return String(code)
                .trim()
                .toUpperCase()
                .replace(/\s+/g, "")
                .replace(/--+/g, "-");
            };

            const binCodeNormalized = normalizeBinCode(binCode);

            // Find tasks for this bin (can be multiple - use the most recent or active one)
            const matchingTasks = tasksArray.filter((t: any) => {
              const taskBinCode = normalizeBinCode(
                t.bin_code || t.bin_location || t.bin_id
              );
              return taskBinCode && taskBinCode === binCodeNormalized;
            });

            if (matchingTasks.length > 0) {
              // Sort by updated_on or created_on (most recent first)
              matchingTasks.sort((a: any, b: any) => {
                const dateA = new Date(
                  a.updated_on || a.created_on || 0
                ).getTime();
                const dateB = new Date(
                  b.updated_on || b.created_on || 0
                ).getTime();
                return dateB - dateA;
              });

              // Try each task until we find one with task lines
              for (const task of matchingTasks) {
                if (!task.title) continue;

                try {
                  console.log(
                    `🔍 loadExpectedItems: Fetching task lines from backend task ${task.title} for bin ${binCode}...`
                  );
                  const taskResponse = await apiService.getCycleCount(
                    task.title
                  );
                  const taskData = taskResponse?.data || taskResponse;
                  const taskLines = taskData?.lines || taskData?.items || [];

                  if (taskLines && taskLines.length > 0) {
                    console.log(
                      `✅ loadExpectedItems: Found ${taskLines.length} task lines from previous backend task ${task.title}`
                    );
                    expectedItems = taskLines
                      .filter(
                        (line: any) =>
                          line.item_code &&
                          (line.expected_qty || line.expected_qty === 0)
                      )
                      .map((line: any) => ({
                        item_code: line.item_code,
                        qty: line.expected_qty || 0,
                      }));
                    loadedFromBackend = true;

                    // Save this task title to session for future use
                    await db.runAsync(
                      "UPDATE cycle_count_sessions SET server_session_id = ?, updated_at = ? WHERE session_id = ?",
                      [task.title, new Date().toISOString(), sessionId]
                    );
                    setTaskTitle(task.title);

                    console.log(
                      `✅ loadExpectedItems: Loaded ${expectedItems.length} expected items from previous backend task ${task.title}`
                    );
                    break; // Found task lines, stop searching
                  }
                } catch (taskError: any) {
                  console.warn(
                    `⚠️ loadExpectedItems: Failed to fetch task lines from task ${task.title}:`,
                    taskError.message
                  );
                  continue; // Try next task
                }
              }

              if (!loadedFromBackend) {
                console.log(
                  `ℹ️ loadExpectedItems: Found ${matchingTasks.length} backend task(s) for bin ${binCode} but none have task lines`
                );
              }
            } else {
              console.log(
                `ℹ️ loadExpectedItems: No backend tasks found for bin ${binCode}`
              );
            }
          } else {
            console.log(
              `ℹ️ loadExpectedItems: Device is offline, cannot search backend tasks`
            );
          }
        } catch (searchError: any) {
          console.warn(
            `⚠️ loadExpectedItems: Failed to search backend tasks for bin ${binCode}:`,
            searchError.message
          );
        }
      }

      // ✅ Priority 2: Fetch from backend stock ledger API
      // Note: Skip stock ledger for carton-level counting because:
      // - Stock ledger is bin-level (tracks items already in the bin)
      // - New cartons don't have items in stock ledger yet
      // - Showing bin-level expected items for a new carton is misleading
      // Only load stock ledger for bin-level counting (no carton_id)
      if (!loadedFromBackend || expectedItems.length === 0) {
        if (cartonId) {
          // Carton-level counting: Skip stock ledger (new carton doesn't have items in stock ledger yet)
          console.log(
            `⏭️ loadExpectedItems: Skipping stock ledger for carton ${cartonId} - new cartons don't have items in stock ledger yet`
          );
          console.log(
            `ℹ️ loadExpectedItems: For new cartons, expected items will only come from already scanned items in this session`
          );
        } else {
          // Bin-level counting: Load stock ledger (bin already has items)
          try {
            const online = await isDeviceOnline();
            if (online) {
              console.log(
                `📦 loadExpectedItems: Fetching bin-level items from backend stock ledger for bin ${binCode}...`
              );

              try {
                // Query bin-level items (backend stock ledger is bin-level)
                const stockResponse = await apiService.getStockLedgerByLocation(
                  {
                    bin_location: binCode,
                  }
                );

                const stockItems =
                  stockResponse?.data ||
                  stockResponse?.items ||
                  stockResponse ||
                  [];
                console.log(
                  `📦 loadExpectedItems: Backend Stock Ledger API Response:`,
                  {
                    responseType: Array.isArray(stockItems)
                      ? "array"
                      : typeof stockItems,
                    isArray: Array.isArray(stockItems),
                    itemCount: Array.isArray(stockItems)
                      ? stockItems.length
                      : 0,
                    rawResponse: JSON.stringify(stockResponse).substring(
                      0,
                      500
                    ), // First 500 chars for debugging
                    firstItem:
                      Array.isArray(stockItems) && stockItems.length > 0
                        ? stockItems[0]
                        : null,
                  }
                );

                if (
                  stockItems &&
                  Array.isArray(stockItems) &&
                  stockItems.length > 0
                ) {
                  console.log(
                    `✅ loadExpectedItems: Found ${stockItems.length} items from backend stock ledger for bin ${binCode}`
                  );
                  expectedItems = stockItems.map((item: any) => ({
                    item_code: item.item_code,
                    qty: item.qty || item.expected_qty || 0,
                  }));
                  loadedFromBackend = true;
                  console.log(
                    `✅ loadExpectedItems: Processed ${expectedItems.length} expected items:`,
                    expectedItems.map((i) => `${i.item_code}: ${i.qty}`)
                  );
                } else {
                  console.warn(
                    `⚠️ loadExpectedItems: Backend returned empty array or invalid format`
                  );
                  console.warn(
                    `⚠️ loadExpectedItems: Raw response:`,
                    JSON.stringify(stockResponse)
                  );
                }
              } catch (stockError: any) {
                console.error(
                  `❌ loadExpectedItems: Failed to fetch from backend stock ledger:`,
                  stockError.message
                );
                console.error(
                  `❌ loadExpectedItems: Error details:`,
                  stockError
                );
              }
            } else {
              console.log(
                `ℹ️ loadExpectedItems: Device is offline, cannot fetch from backend stock ledger`
              );
            }
          } catch (stockError: any) {
            console.error(
              `❌ loadExpectedItems: Error fetching from backend stock ledger:`,
              stockError.message
            );
            console.error(`❌ loadExpectedItems: Error details:`, stockError);
          }
        }
      }

      // ✅ Priority 3: Fallback to stock ledger cache if backend API fails (bin-level only, no carton_id support)
      // Note: stock_ledger_cache doesn't have carton_id column, so we can only use it for bin-level items
      // For carton-level counting, we must use backend API which supports carton_id filtering
      if (!loadedFromBackend || expectedItems.length === 0) {
        if (cartonId) {
          // Carton-level counting: stock_ledger_cache doesn't support carton_id, so skip it
          console.log(
            `⏭️ loadExpectedItems: Skipping stock_ledger_cache - carton-level counting requires backend API (carton_id: ${cartonId})`
          );
          console.log(
            `ℹ️ loadExpectedItems: For carton-level items, backend stock ledger API must be available with carton_id filter`
          );
        } else {
          // Bin-level counting: use stock_ledger_cache
          console.log(
            `📦 loadExpectedItems: Loading expected items from stock ledger cache for bin ${binCode}...`
          );
          const stockLedgerItems = await db.getAllAsync<{
            item_code: string;
            qty: number;
          }>(
            "SELECT item_code, qty FROM stock_ledger_cache WHERE bin_location = ?",
            [binCode]
          );

          if (stockLedgerItems && stockLedgerItems.length > 0) {
            expectedItems = stockLedgerItems.map((item) => ({
              item_code: item.item_code,
              qty: item.qty,
            }));
            console.log(
              `✅ loadExpectedItems: Found ${expectedItems.length} expected items in stock ledger cache for bin ${binCode}`
            );
          } else {
            console.warn(
              `⚠️ loadExpectedItems: No expected items found in stock ledger cache for bin ${binCode}.`
            );
          }
        }
      }

      // If no items found from both sources, log warning
      if (expectedItems.length === 0) {
        console.warn(
          `⚠️ loadExpectedItems: No expected items found for bin ${binCode} from backend task or stock ledger cache.`
        );
        if (taskTitle) {
          console.warn(
            `⚠️ Backend task ${taskTitle} may not have task lines yet. Items will be created as you scan them.`
          );
        } else {
          console.warn(
            `⚠️ Please sync stock ledger data from backend or ensure backend task has task lines.`
          );
        }
        return;
      }

      // Get existing item codes from DATABASE (not state)
      const existingItemCodes = new Set(
        existingLinesInDb.map((l) => l.item_code)
      );
      console.log(
        `📋 loadExpectedItems: Existing item codes:`,
        Array.from(existingItemCodes)
      );

      // Only create lines for items that don't exist in the database
      const newLines: CountLine[] = expectedItems
        .filter((item) => {
          const exists = existingItemCodes.has(item.item_code);
          if (exists) {
            console.log(
              `⏭️ loadExpectedItems: Skipping ${item.item_code} - already exists in database`
            );
          }
          return !exists;
        })
        .map((item) => ({
          line_id: generateUUID(),
          item_code: item.item_code,
          barcode: "",
          carton_id: cartonId || null, // ✅ NEW: Include carton_id when loading expected items
          uom: "EA",
          expected_qty: item.qty,
          counted_qty: 0,
          variance_qty: null,
          is_unexpected_item: false,
        }));

      console.log(
        `➕ loadExpectedItems: Will add ${newLines.length} new expected items`
      );

      if (newLines.length > 0) {
        // Save new lines to database
        for (const line of newLines) {
          console.log(
            `💾 loadExpectedItems: Inserting line for ${line.item_code}, expected: ${line.expected_qty}`
          );
          await db.runAsync(
            `INSERT INTO cycle_count_lines (
              line_id, session_id, item_code, barcode, carton_id, uom, expected_qty, counted_qty, is_unexpected_item, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              line.line_id,
              sessionId,
              line.item_code,
              line.barcode,
              line.carton_id || null, // ✅ NEW: Include carton_id (can be null for bin-level mode)
              line.uom,
              line.expected_qty,
              line.counted_qty,
              line.is_unexpected_item ? 1 : 0,
              new Date().toISOString(),
              new Date().toISOString(),
            ]
          );
        }
        console.log(
          `✅ loadExpectedItems: Added ${newLines.length} expected items, reloading session`
        );
        await loadSession();
      } else {
        console.log(`✅ loadExpectedItems: No new items to add`);
      }
    } catch (error: any) {
      console.error(
        "❌ loadExpectedItems: Error loading expected items:",
        error
      );
    } finally {
      setLoading(false);
    }
  };

  // ✅ NEW: Handle carton ID scan/input
  const handleCartonIdScan = async (
    scannedCartonId: string
  ): Promise<boolean> => {
    const trimmedCartonId = scannedCartonId.trim().toUpperCase();
    if (!trimmedCartonId) {
      return false;
    }
    console.log(`📦 Carton ID scanned: ${trimmedCartonId}`);
    setCartonId(trimmedCartonId);
    setCartonIdInput("");
    setShowCartonScanner(false);

    // ✅ NEW: Start the task immediately after carton ID validation (before scanning items)
    // This ensures the task status is "Started/In Progress" before any items are counted
    // Only starts if task is in "Draft" status - if already "In Progress", skips starting
    if (taskTitle) {
      await ensureTaskStarted(taskTitle);
    } else {
      console.log(
        `ℹ️ No task title found - task will be started when backend task is created`
      );
    }

    // ✅ NEW: Load expected items for this carton after carton ID is set
    if (sessionId && binCode && !isBlindCount) {
      console.log(`🔄 Loading expected items for carton ${trimmedCartonId}...`);
      // Load session first to get items for this carton
      await loadSessionWithCartonId(trimmedCartonId);
      // Then load expected items from backend/stock ledger
      await loadExpectedItems(taskTitle);
    }

    // Focus item barcode input after carton ID is set
    setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 100);
    return true;
  };

  const handleChangeCartonId = () => {
    // ✅ Clear the current carton ID to show the carton ID input card
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

    try {
      const db = await getDatabase();

      // ✅ Priority 1: Search local database first (item_master, item_barcode_map)
      // ✅ Priority 2: If not found locally, search from backend API
      console.log(`🔍 Searching for item: barcode="${barcode}"`);
      const item = await resolveItemFromBarcode(barcode);

      if (!item) {
        Alert.alert(
          "Item Not Found",
          `Barcode "${barcode}" not found in system`
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
        [barcode, item.item_code]
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
              barcode,
              itemCode,
              uom,
              increment,
              "Unit",
              new Date().toISOString(),
            ]
          );
          console.log(
            `💾 Created barcode map entry: barcode="${barcode}", item_code="${itemCode}"`
          );
        } catch (cacheError: any) {
          console.warn(
            `⚠️ Failed to create barcode map entry:`,
            cacheError.message
          );
        }
      }

      console.log(
        `✅ Item resolved: item_code="${itemCode}", barcode="${barcode}", uom="${uom}", increment=${increment}`
      );
      await addOrIncrementItem(itemCode, barcode, uom, increment);

      // Vibrate on success
      Vibration.vibrate(50);

      return true;
    } catch (error: any) {
      console.error("Error processing scan:", error);
      Alert.alert("Error", `Failed to process scan: ${error.message}`);
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
        console.log(
          `📝 Updating existing line ${existingLine.line_id}: ${
            existingLine.counted_qty
          } + ${increment} = ${newQty}, carton_id: ${
            cartonId || "null"
          } (existing: ${existingLine.carton_id || "null"})`
        );

        // Update existing line quantity and ensure carton_id is set (in case it was null before)
        const updateQuery = cartonId
          ? "UPDATE cycle_count_lines SET counted_qty = ?, carton_id = ?, updated_at = ? WHERE line_id = ?"
          : "UPDATE cycle_count_lines SET counted_qty = ?, updated_at = ? WHERE line_id = ?";
        const updateParams = cartonId
          ? [newQty, cartonId, now, existingLine.line_id]
          : [newQty, now, existingLine.line_id];

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

      // Real-time sync: If device is online, sync only the current item immediately (non-blocking)
      isDeviceOnline()
        .then(async (online) => {
          if (online) {
            console.log(
              `🔄 Device is online - syncing item ${itemCode} for session ${sessionId} immediately...`
            );
            try {
              const syncSuccess = await syncCycleCountSession(
                sessionId,
                itemCode
              );
              if (syncSuccess) {
                console.log(
                  `✅ Real-time sync successful for item ${itemCode} in session ${sessionId}`
                );
              } else {
                console.warn(
                  `⚠️ Real-time sync returned false for item ${itemCode} (will retry later)`
                );
              }
            } catch (syncError: any) {
              console.warn(
                `⚠️ Real-time sync failed for item ${itemCode}:`,
                syncError.message
              );
              // Don't show error to user - sync will retry later
            }
          } else {
            console.log(
              `ℹ️ Device is offline - item ${itemCode} will sync when online`
            );
          }
        })
        .catch((error) => {
          console.warn(`⚠️ Error checking network status:`, error);
          // Continue without sync - will retry later
        });
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

  const getExpectedQty = async (itemCode: string): Promise<number | null> => {
    // ✅ FIX: Show expected qty even when carton_id is set
    // Backend stock ledger is bin-level, so expected_qty applies regardless of carton_id
    // carton_id is only for tracking which carton was counted, not for filtering expected quantities

    try {
      const db = await getDatabase();

      // Priority 1: Check if we already have expected_qty in cycle_count_lines for this item
      if (sessionId) {
        const existingLine = await db.getFirstAsync<{
          expected_qty: number | null;
        }>(
          "SELECT expected_qty FROM cycle_count_lines WHERE session_id = ? AND item_code = ? LIMIT 1",
          [sessionId, itemCode]
        );

        if (
          existingLine &&
          existingLine.expected_qty !== null &&
          existingLine.expected_qty !== undefined
        ) {
          console.log(
            `✅ getExpectedQty: Found expected_qty from cycle_count_lines for ${itemCode}: ${existingLine.expected_qty}`
          );
          return existingLine.expected_qty;
        }
      }

      // Priority 2: Fallback to stock_ledger_cache
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

      // Real-time sync: If device is online, sync only the edited item immediately (non-blocking)
      isDeviceOnline()
        .then(async (online) => {
          if (online) {
            console.log(
              `🔄 Device is online - syncing item ${itemCode} for session ${sessionId} after quantity edit...`
            );
            try {
              const syncSuccess = await syncCycleCountSession(
                sessionId,
                itemCode
              );
              if (syncSuccess) {
                console.log(
                  `✅ Real-time sync successful for item ${itemCode} in session ${sessionId} after edit`
                );
              } else {
                console.warn(
                  `⚠️ Real-time sync returned false for item ${itemCode} (will retry later)`
                );
              }
            } catch (syncError: any) {
              console.warn(
                `⚠️ Real-time sync failed for item ${itemCode}:`,
                syncError.message
              );
              // Don't show error to user - sync will retry later
            }
          } else {
            console.log(
              `ℹ️ Device is offline - item ${itemCode} will sync when online`
            );
          }
        })
        .catch((error) => {
          console.warn(`⚠️ Error checking network status:`, error);
          // Continue without sync - will retry later
        });
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

              // First, sync all counts to backend
              console.log(
                `🔄 Syncing counts before submission for session ${sessionId}...`
              );
              const syncSuccess = await syncCycleCountSession(sessionId);
              if (!syncSuccess) {
                console.warn(
                  `⚠️ Sync returned false, but continuing with submission`
                );
              }

              // Update local status to Submitted
              await db.runAsync(
                "UPDATE cycle_count_sessions SET status = 'Submitted', updated_at = ? WHERE session_id = ?",
                [new Date().toISOString(), sessionId]
              );

              // ✅ Submit the task to backend (only if taskTitle exists)
              if (taskTitle) {
                try {
                  console.log(
                    `📤 Submitting cycle count task ${taskTitle} to backend...`
                  );

                  // ✅ Try to submit the task
                  try {
                    await apiService.submitCycleCount(taskTitle);
                    console.log(
                      `✅ Successfully submitted task ${taskTitle} to backend`
                    );
                  } catch (submitError: any) {
                    // ✅ Handle case where task is in "Draft" status - need to start it first
                    const errorMessage =
                      submitError.message || submitError.toString() || "";
                    const isInvalidStatus =
                      errorMessage.includes("INVALID_STATUS") ||
                      errorMessage.includes("Cannot submit") ||
                      errorMessage.includes("status: Draft");

                    if (isInvalidStatus) {
                      console.log(
                        `ℹ️ Task ${taskTitle} is in Draft status. Starting task first...`
                      );
                      try {
                        // Get settings for started_by
                        const settings = await getSettings();
                        // Start the task first
                        await apiService.startCycleCount(taskTitle, {
                          started_by:
                            settings.user_id ||
                            settings.user_code ||
                            "USER-AUTO",
                        });
                        console.log(
                          `✅ Successfully started task ${taskTitle}`
                        );

                        // Wait a moment for backend to process status change
                        await new Promise((resolve) =>
                          setTimeout(resolve, 500)
                        );

                        // Retry submission after starting
                        console.log(
                          `📤 Retrying submission of task ${taskTitle}...`
                        );
                        await apiService.submitCycleCount(taskTitle);
                        console.log(
                          `✅ Successfully submitted task ${taskTitle} to backend (after starting)`
                        );
                      } catch (startError: any) {
                        // If starting fails, log and rethrow
                        console.error(
                          `❌ Failed to start task ${taskTitle}:`,
                          startError.message
                        );
                        throw startError; // Re-throw to be caught by outer catch
                      }
                    } else {
                      // Other submission errors - rethrow
                      throw submitError;
                    }
                  }

                  // ✅ Complete the task after submission (automatic)
                  try {
                    console.log(
                      `📤 Completing cycle count task ${taskTitle} via API...`
                    );
                    await apiService.completeCycleCount(taskTitle);
                    console.log(
                      `✅ Successfully completed task ${taskTitle} via API`
                    );
                  } catch (completeError: any) {
                    // Log error but don't block - task is already submitted
                    console.warn(
                      `⚠️ Failed to complete task via API:`,
                      completeError.message
                    );
                    console.warn(
                      `⚠️ Task is submitted but not completed - may need manual completion in desktop app`
                    );
                  }
                } catch (submitError: any) {
                  // If submission fails even after starting, log but don't block - counts are already synced
                  console.error(
                    `❌ Failed to submit task to backend:`,
                    submitError.message
                  );
                  // Still show success to user since counts are synced
                  Alert.alert(
                    "Warning",
                    `Bin count has been synced, but task submission failed: ${submitError.message}. The task may need to be submitted manually in the desktop app.`
                  );
                }
              } else {
                console.warn(
                  `⚠️ No task title found - skipping submit and complete API calls`
                );
                console.warn(
                  `⚠️ Task will be submitted when backend task is found and synced`
                );
              }

              Alert.alert(
                "Success",
                "Bin count submitted and completed successfully",
                [
                  {
                    text: "OK",
                    onPress: () => {
                      // Navigate to Cycle Count Dashboard
                      (navigation as any).navigate("CycleCountDashboard");
                    },
                  },
                ]
              );
            } catch (error: any) {
              console.error("❌ Error submitting bin count:", error);
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
    const variance =
      typeof item.expected_qty === "number"
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
          {!isBlindCount &&
            item.expected_qty !== null &&
            item.expected_qty !== undefined && (
              <View
                style={[
                  styles.expectedBadge,
                  variance === 0 && styles.expectedBadgeGreen,
                ]}
              >
                <Text
                  style={[
                    styles.expectedBadgeText,
                    variance === 0 && styles.expectedBadgeTextGreen,
                  ]}
                >
                  Exp: {item.expected_qty}
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
                <Text
                  style={[
                    styles.qtyValue,
                    item.counted_qty === 0 && styles.qtyValueZero,
                  ]}
                >
                  {item.counted_qty}
                </Text>
                <Text style={styles.uomText}>{item.uom}</Text>
              </View>

              {!isBlindCount &&
                variance !== null &&
                item.expected_qty !== null &&
                item.expected_qty !== undefined && (
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
            {/* ✅ Hide/Disable Mark Bin button during carton scanning if carton ID is required but not set */}
            <TouchableOpacity
              style={[
                styles.topActionButton,
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

          {/* ✅ NEW: Carton ID Scanning Section - Show if carton ID is not set */}
          {!cartonId && (
            <View style={styles.cartonIdCard}>
              <Text style={styles.cartonIdCardTitle}>📦 Scan Carton ID</Text>
              <Text style={styles.cartonIdCardSubtitle}>
                One bin can have multiple cartons. Please scan the carton ID
                first.
              </Text>
              <View style={styles.cartonIdInputRow}>
                <BarcodeInput
                  ref={cartonIdInputRef}
                  autoFocus
                  placeholder="Scan or enter carton ID"
                  onChangeText={(t) => setCartonIdInput(t.toUpperCase())}
                  onBarcodeScanned={(raw) =>
                    handleCartonIdScan(raw.trim().toUpperCase())
                  }
                  containerStyle={{ flex: 1 }}
                  inputStyle={styles.cartonIdInput}
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
                    onPress={() => {
                      const t =
                        cartonIdInput.trim() ||
                        cartonIdInputRef.current?.getLastText?.()?.trim() ||
                        "";
                      if (t) void handleCartonIdScan(t);
                    }}
                  >
                    <Text style={styles.cartonIdSubmitButtonText}>✓</Text>
                  </TouchableOpacity>
                )}
              </View>
              {/* ✅ NEW: Generate Carton ID Button */}
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

          {/* Scan Card - Only show if carton ID is set */}
          {cartonId && (
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

              {/* Manual barcode: wedge + keyboard toggle (see BarcodeInput) */}
              <View style={styles.manualInputSection}>
                <Text style={styles.manualInputLabel}>Scan Item Barcode</Text>
                <BarcodeInput
                  ref={barcodeInputRef}
                  autoFocus={!editingLineId}
                  debounceMs={180}
                  placeholder="Scan or enter barcode"
                  onBarcodeScanned={handleItemScan}
                  onError={(message, err) =>
                    console.warn("BarcodeInput:", message, err)
                  }
                  disabled={!!editingLineId}
                  inputStyle={styles.manualInput}
                />
              </View>
            </View>
          )}

          {/* Expected/Scanned Items List - Only show after carton ID is scanned */}
          {cartonId && countLines.length > 0 && (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>
                {isBlindCount ? "Scanned Items" : "Expected Items"}
              </Text>
              <Text style={styles.listSubtitle}>Carton: {cartonId}</Text>
              <FlatList
                data={countLines}
                keyExtractor={(item) => item.line_id}
                renderItem={renderCountLine}
                scrollEnabled={false}
                style={styles.list}
              />
            </View>
          )}
          {cartonId && countLines.length === 0 && (
            <View style={styles.listSection}>
              <Text style={styles.listTitle}>Expected Items</Text>
              <Text style={styles.listSubtitle}>Carton: {cartonId}</Text>
              <View style={styles.emptyList}>
                <Text style={styles.emptyListText}>
                  No items found for this carton
                </Text>
              </View>
            </View>
          )}
        </ScrollView>

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
                    void handleCartonIdScan(barcode);
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
  cartonIdText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#FFF",
    backgroundColor: "rgba(33, 150, 243, 0.3)", // Blue background
    paddingHorizontal: 8,
    paddingVertical: 4,
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
  qtyValueZero: {
    color: "#999",
    opacity: 0.6,
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
  cartonIdContainer: {
    flexDirection: "column",
    marginTop: 6,
    gap: 6,
  },
  changeCartonButton: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    alignSelf: "flex-start",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  changeCartonButtonText: {
    fontSize: 11,
    color: "#FFF",
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
});
