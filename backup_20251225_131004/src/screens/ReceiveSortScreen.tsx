import React, { useState, useEffect, useCallback, useMemo } from "react";
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
import { getSettings } from "../services/settings.service";
import { resolveItemFromBarcode } from "../services/item-master.service";
import { normalizeASN } from "../utils/asn";
import { ProgressIndicator } from "../components/ProgressIndicator";
import {
  saveWorkflowState,
  loadWorkflowState,
  clearWorkflowState,
} from "../services/workflow-state.service";

type WorkflowState = "SELECT_CARTON" | "SCAN_ITEM" | "SCAN_BOX";

export default function ReceiveSortScreen() {
  console.log("🔄 ReceiveSortScreen RENDERED - NEW UI VERSION 2.0");
  const navigation = useNavigation();
  const route = useRoute();
  const { activeASN, activeSession, refreshSettings } = useApp();
  const [workflowState, setWorkflowState] =
    useState<WorkflowState>("SELECT_CARTON");
  const [lockedCarton, setLockedCarton] = useState<string | null>(null);
  const [cartonItems, setCartonItems] = useState<any[]>([]);
  const [scannedItems, setScannedItems] = useState<any[]>([]);
  const [scannedQuantities, setScannedQuantities] = useState<
    Record<string, number>
  >({});
  const [currentItem, setCurrentItem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [availableCartons, setAvailableCartons] = useState<any[]>([]);

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
  const [showCreateBox, setShowCreateBox] = useState(false);
  const [selectedStoreForBox, setSelectedStoreForBox] = useState("SR-01");
  const [showAvailableBoxes, setShowAvailableBoxes] = useState(false);
  const [itemDetailsModal, setItemDetailsModal] = useState<{
    visible: boolean;
    itemCode: string;
    scannedQty: number;
    totalTOQty: number;
    remainingQty: number;
    allocations: Array<{
      store: string;
      allocatedQty: number;
      scannedQty: number;
      boxes: string[];
    }>;
  } | null>(null);
  const [lastScannedItem, setLastScannedItem] = useState<string | null>(null);
  const [showExpectedItemsModal, setShowExpectedItemsModal] = useState(false);
  const [showScannedItemsModal, setShowScannedItemsModal] = useState(false);
  const [expectedItemsSearchQuery, setExpectedItemsSearchQuery] = useState("");
  const [scannedItemsSearchQuery, setScannedItemsSearchQuery] = useState("");
  const [manualQtyItem, setManualQtyItem] = useState<string | null>(null);
  const [manualQtyValue, setManualQtyValue] = useState("");
  const [manualQtyBox, setManualQtyBox] = useState<string | null>(null);

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
        setWorkflowStateWithLog(savedState.workflow_state as WorkflowState);
        setLockedCartonWithLog(savedState.locked_carton);
        setCurrentItemWithLog(savedState.current_item);
        setScannedItemsWithLog(savedState.scanned_items || []);
        setScannedQuantitiesWithLog(savedState.scanned_quantities || {});

        // Load carton items if carton is locked
        if (savedState.locked_carton) {
          const items = await dataService.getCartonItems(
            normalizedASN,
            savedState.locked_carton
          );
          setCartonItemsWithLog(items);

          // Verify carton is still locked by current user (in case app was restarted)
          const settings = await getSettings();
          const cartonStatus = await dataService.getCartonStatus(
            normalizedASN,
            activeSession,
            savedState.locked_carton
          );

          if (cartonStatus && cartonStatus.status === "Receiving") {
            // Carton is Receiving - allow resuming work regardless of user_id
            // (user_id may have changed between sessions, but carton is still in progress)
            const isSameUser = cartonStatus.locked_by === settings.user_id;
            if (!isSameUser) {
              // Different user_id but carton is Receiving - allow resume in demo mode or if carton is in progress
              // This handles cases where user_id was regenerated
              console.log(
                "⚠️ Carton locked by different user_id, but Receiving - allowing resume",
                {
                  carton: savedState.locked_carton,
                  locked_by: cartonStatus.locked_by,
                  current_user: settings.user_id,
                }
              );
            }
            // Restore lock info and allow resuming
            setLockInfo({
              locked_by: cartonStatus.locked_by,
              locked_on: cartonStatus.locked_on,
            });
            // Carton restored successfully - user can continue work
          } else if (cartonStatus && cartonStatus.status === "Received") {
            // Carton already completed - clear the saved state
            logStateChange("CLEAR_STATE_CARTON_COMPLETED", {
              carton: savedState.locked_carton,
            });
            setLockedCartonWithLog(null);
            setWorkflowStateWithLog("SELECT_CARTON");
            setScannedItemsWithLog([]);
            setScannedQuantitiesWithLog({});
            setCurrentItemWithLog(null);
            setCartonItemsWithLog([]);
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
  }, [activeASN, activeSession, lockedCarton]);

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
    received: number;
  }>({ total: 0, unloaded: 0, inReceiving: 0, received: 0 });

  const loadAvailableCartons = async () => {
    if (!activeASN || !activeSession) return;
    const normalizedASN = normalizeASN(activeASN);
    const statuses = await dataService.getAllCartonStatuses(
      normalizedASN,
      activeSession
    );

    // Calculate status counts
    const statusCounts = {
      total: statuses.length,
      unloaded: statuses.filter((c) => c.status === "Unloaded").length,
      inReceiving: statuses.filter((c) => c.status === "Receiving").length,
      received: statuses.filter((c) => c.status === "Received").length,
    };
    setAllCartonsStatus(statusCounts);

    // Show cartons that are:
    // 1. Unloaded (available to start)
    // 2. Receiving and locked by current user (in-progress cartons to resume)
    // 3. Pending (can be scanned to start - will be unloaded automatically)
    const settings = await getSettings();
    const currentUserId = settings.user_id
      ? String(settings.user_id).trim()
      : "";

    const available = statuses.filter((c) => {
      if (c.status === "Unloaded") return true;
      if (c.status === "Pending") return true; // Show pending cartons - can be scanned to start
      if (c.status === "Receiving") {
        const lockedBy = c.locked_by ? String(c.locked_by).trim() : "";
        // Show if locked by current user OR if no lock (for demo mode compatibility)
        return (
          lockedBy === currentUserId || (!lockedBy && settings.demo_mode === 1)
        );
      }
      return false;
    });

    console.log("📦 Available cartons for ReceiveSort:", {
      total: statuses.length,
      available: available.length,
      unloaded: statusCounts.unloaded,
      pending: statuses.filter((c) => c.status === "Pending").length,
      inReceiving: statusCounts.inReceiving,
      inReceivingByUser: available.filter((c) => c.status === "Receiving")
        .length,
      currentUserId,
      allStatuses: statuses.map((c) => ({
        carton: c.carton_id,
        status: c.status,
        locked_by: c.locked_by,
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

  // Reset state when screen is focused (to handle navigation from Unload screen)
  // Also check for saved state when returning to screen after app restart
  useFocusEffect(
    React.useCallback(() => {
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
                  setScannedItemsWithLog(savedState.scanned_items || []);
                  setScannedQuantitiesWithLog(
                    savedState.scanned_quantities || {}
                  );
                  setCurrentItemWithLog(savedState.current_item);
                  setWorkflowStateWithLog(
                    savedState.workflow_state as WorkflowState
                  );
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
            // Restoring saved state for already-locked carton
            setScannedItemsWithLog(savedState.scanned_items || []);
            setScannedQuantitiesWithLog(savedState.scanned_quantities || {});
            setCurrentItemWithLog(savedState.current_item);
            setWorkflowStateWithLog(savedState.workflow_state as WorkflowState);
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
              is_same_user: status?.locked_by === settings.user_id,
            }
          );

          // If carton is already locked by current user, restore state instead of re-locking
          if (
            status &&
            status.status === "Receiving" &&
            status.locked_by === settings.user_id
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
              setScannedItemsWithLog(savedState.scanned_items || []);
              setScannedQuantitiesWithLog(savedState.scanned_quantities || {});
              setCurrentItemWithLog(savedState.current_item);
              setWorkflowStateWithLog(
                savedState.workflow_state as WorkflowState
              );
            } else {
              // No saved state, start fresh
              logStateChange("NO_SAVED_STATE_IN_CHECK_DATABASE", {
                carton: cartonIdFromParams,
              });
              setWorkflowStateWithLog("SCAN_ITEM");
            }

            await loadCartonItems();
            await loadLockInfo();
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

          // If carton is already Receiving (regardless of user), restore state immediately
          // This handles the case where user IDs don't match but carton is already locked
          if (dbStatus && dbStatus.status === "Receiving") {
            const isSameUser = dbStatus.locked_by === settings.user_id;
            console.log(
              `✅ Database check: Carton ${cartonIdFromParams} is Receiving, restoring state`,
              {
                locked_by: dbStatus.locked_by,
                current_user: settings.user_id,
                is_same_user: isSameUser,
              }
            );
            logStateChange("DATABASE_CHECK_RESTORE", {
              carton: cartonIdFromParams,
              dbStatus: {
                status: dbStatus.status,
                locked_by: dbStatus.locked_by,
                locked_on: dbStatus.locked_on,
              },
              is_same_user: isSameUser,
            });
            setLockedCartonWithLog(cartonIdFromParams);

            // Load saved workflow state to restore scanned items
            const savedState = await loadWorkflowState(
              normalizedASN,
              activeSession,
              "ReceiveSort"
            );
            if (savedState && savedState.locked_carton === cartonIdFromParams) {
              // Restoring saved state from database check
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
              setScannedItemsWithLog(savedState.scanned_items || []);
              setScannedQuantitiesWithLog(savedState.scanned_quantities || {});
              setCurrentItemWithLog(savedState.current_item);
              setWorkflowStateWithLog(
                savedState.workflow_state as WorkflowState
              );
            } else {
              // No saved state, start fresh
              logStateChange("NO_SAVED_STATE_START_FRESH", {
                carton: cartonIdFromParams,
              });
              setWorkflowStateWithLog("SCAN_ITEM");
            }

            await loadCartonItems();
            await loadLockInfo();
            navigation.setParams({ cartonId: undefined } as never);
            setSavedStateLoaded(true);
            return; // Exit, don't proceed with locking
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
                    status.locked_by === settings.user_id
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
                      setScannedItemsWithLog(savedState.scanned_items || []);
                      setScannedQuantitiesWithLog(
                        savedState.scanned_quantities || {}
                      );
                      setCurrentItemWithLog(savedState.current_item);
                      setWorkflowStateWithLog(
                        savedState.workflow_state as WorkflowState
                      );
                    } else {
                      // No saved state, start fresh
                      logStateChange("NO_SAVED_STATE_IN_AUTO_LOCK", {
                        carton: cartonId,
                      });
                      setWorkflowStateWithLog("SCAN_ITEM");
                    }

                    await loadCartonItems();
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
                    if (status.locked_by === settings.user_id) {
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
                        setScannedItemsWithLog(savedState.scanned_items || []);
                        setScannedQuantitiesWithLog(
                          savedState.scanned_quantities || {}
                        );
                        setCurrentItemWithLog(savedState.current_item);
                        setWorkflowStateWithLog(
                          savedState.workflow_state as WorkflowState
                        );
                      } else {
                        // No saved state, start fresh
                        logStateChange("NO_SAVED_STATE_IN_RESUME", {
                          carton: cartonId,
                        });
                        setWorkflowStateWithLog("SCAN_ITEM");
                      }

                      await loadCartonItems();
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
                      // Locked by different user - check if we can take over (if no work done)
                      // For now, show error but allow user to force unlock if needed
                      // settings already declared above, reuse it
                      Alert.alert(
                        "Carton Already in Use",
                        `Carton ${cartonId} is currently being processed by another user.\n\nLocked by: ${
                          status.locked_by || "Unknown"
                        }\nStatus: ${
                          status.status
                        }\n\nPlease select a different carton.`,
                        [
                          {
                            text: "OK",
                            style: "cancel",
                          },
                          // Only show "Force Unlock" in demo mode
                          ...(settings.demo_mode === 1
                            ? [
                                {
                                  text: "Force Unlock (Demo)",
                                  style: "destructive",
                                  onPress: async () => {
                                    console.log(
                                      `🔓 Force unlocking carton ${cartonId} in demo mode`
                                    );
                                    // Force unlock in demo mode
                                    await dataService.updateCartonStatus({
                                      asn_no: normalizedASN,
                                      inbound_session: activeSession,
                                      carton_id: cartonId,
                                      status: "Unloaded",
                                      locked_by: null,
                                      locked_on: null,
                                      updated_on: new Date().toISOString(),
                                    });
                                    // Retry locking by calling the lock logic again
                                    console.log(
                                      `🔄 Retrying lock for carton ${cartonId}`
                                    );
                                    const retrySettings = await getSettings();

                                    let lockResponse;
                                    try {
                                      lockResponse =
                                        await apiService.lockCarton({
                                          inbound_session: activeSession,
                                          asn_no: activeASN, // Use original format from desktop
                                          carton_id: cartonId,
                                          user_id: retrySettings.user_id!,
                                          device_id: retrySettings.device_id!,
                                        });
                                      console.log(
                                        `📋 Retry lock carton API response:`,
                                        lockResponse
                                      );
                                    } catch (error: any) {
                                      console.error(
                                        `❌ Retry lock carton API error:`,
                                        error
                                      );
                                      Alert.alert(
                                        "Error",
                                        `Failed to lock carton: ${
                                          error.message || "Unknown error"
                                        }\n\nPlease check API connection and authentication.`
                                      );
                                      setLoading(false);
                                      return;
                                    }

                                    // Handle nested response structure: { data: { locked: true } } or { locked: true }
                                    const isLocked =
                                      lockResponse?.data?.locked === true ||
                                      lockResponse?.locked === true ||
                                      lockResponse?.ok === true;
                                    if (!isLocked) {
                                      const errorMessage =
                                        lockResponse?.data?.message ||
                                        lockResponse?.message ||
                                        lockResponse?.error?.message ||
                                        "Failed to lock carton";
                                      Alert.alert(
                                        "Error",
                                        `Failed to lock carton: ${errorMessage}`
                                      );
                                      setLoading(false);
                                      return;
                                    }

                                    console.log(
                                      `✅ Carton ${cartonId} locked successfully (retry)`
                                    );

                                    // Update local status
                                    await dataService.updateCartonStatus({
                                      asn_no: normalizedASN,
                                      inbound_session: activeSession,
                                      carton_id: cartonId,
                                      status: "Receiving",
                                      locked_by: retrySettings.user_id,
                                      locked_on: new Date().toISOString(),
                                      updated_on: new Date().toISOString(),
                                    });

                                    // Sync status change to backend
                                    try {
                                      await apiService.updateCartonStatus({
                                        asn_no: activeASN, // Use original format from desktop
                                        inbound_session: activeSession,
                                        carton_id: cartonId,
                                        status: "Receiving", // Backend expects "Receiving"
                                        user_id: retrySettings.user_id,
                                        device_id: retrySettings.device_id,
                                      });
                                      console.log(
                                        `✅ Carton ${cartonId} status synced to backend: Receiving (retry lock)`
                                      );
                                    } catch (apiError: any) {
                                      console.warn(
                                        `⚠️ Failed to sync carton ${cartonId} status to backend:`,
                                        apiError.message
                                      );
                                      // Don't block user flow if API sync fails
                                    }

                                    logStateChange("FORCE_UNLOCK_TAKEOVER", {
                                      carton: cartonId,
                                    });
                                    setLockedCartonWithLog(cartonId);
                                    setWorkflowStateWithLog("SCAN_ITEM");
                                    setScannedItemsWithLog([]);
                                    setScannedQuantitiesWithLog({});
                                    setCartonItemsWithLog([]);

                                    // Clear saved workflow state
                                    await clearWorkflowState(
                                      normalizedASN,
                                      activeSession,
                                      "ReceiveSort"
                                    );
                                    // Cleared saved workflow state for new carton
                                    setLoading(false);
                                  },
                                },
                              ]
                            : []),
                        ]
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
                      `Carton ${cartonId} cannot be processed.\n\nCurrent status: ${status.status}\n\nOnly "Unloaded" or "Pending" cartons can be received.`
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
                  const isLocked =
                    lockResponse?.data?.locked === true ||
                    lockResponse?.locked === true ||
                    lockResponse?.ok === true;
                  if (!isLocked) {
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

                  console.log(
                    `✅ Carton ${cartonId} locked successfully (auto-lock)`
                  );

                  // Update local status
                  await dataService.updateCartonStatus({
                    asn_no: normalizedASN,
                    inbound_session: activeSession,
                    carton_id: cartonId,
                    status: "Receiving",
                    locked_by: settings.user_id,
                    locked_on: new Date().toISOString(),
                    updated_on: new Date().toISOString(),
                  });

                  // Sync status change to backend
                  try {
                    console.log(`📡 Syncing carton status to backend:`, {
                      carton: cartonId,
                      asn: activeASN,
                      session: activeSession,
                      status: "Receiving",
                    });
                    await apiService.updateCartonStatus({
                      asn_no: activeASN, // Use original format from desktop
                      inbound_session: activeSession,
                      carton_id: cartonId,
                      status: "Receiving", // Backend expects "Receiving"
                      user_id: settings.user_id,
                      device_id: settings.device_id,
                    });
                    console.log(
                      `✅ Carton ${cartonId} status synced to backend: Receiving`
                    );
                  } catch (apiError: any) {
                    console.warn(
                      `⚠️ Failed to sync carton ${cartonId} status to backend:`,
                      apiError.message
                    );
                    // 404 errors are expected if carton doesn't exist in backend yet
                    // The mobile app will continue working locally and sync later
                    if (apiError.message?.includes("404")) {
                      console.log(
                        `ℹ️ Carton ${cartonId} not found in backend (404). This is expected if the carton hasn't been created in the backend yet. Local status will be synced when the carton is created.`
                      );
                    }
                    // Don't block user flow if API sync fails
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
                    setScannedItemsWithLog(
                      savedStateBeforeLock.scanned_items || []
                    );
                    setScannedQuantitiesWithLog(
                      savedStateBeforeLock.scanned_quantities || {}
                    );
                    setCurrentItemWithLog(savedStateBeforeLock.current_item);
                    setWorkflowStateWithLog(
                      savedStateBeforeLock.workflow_state as WorkflowState
                    );
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

  const loadCartonItems = async () => {
    if (!activeASN || !lockedCarton) {
      console.warn("⚠️ loadCartonItems: Missing activeASN or lockedCarton", {
        activeASN,
        lockedCarton,
      });
      return;
    }
    const normalizedASN = normalizeASN(activeASN);
    // Clear previous items first
    logStateChange("LOAD_CARTON_ITEMS", { carton: lockedCarton });
    setCartonItemsWithLog([]);

    const items = await dataService.getCartonItems(normalizedASN, lockedCarton);
    console.log(
      `✅ Loaded ${items.length} items for ${lockedCarton}:`,
      items.map((i) => `${i.item_code} (${i.shipped_qty})`).join(", ")
    );

    if (items.length === 0) {
      console.error(
        `❌ No items found for carton ${lockedCarton} in ASN ${normalizedASN}`
      );
    }

    setCartonItems(items);
  };

  const loadAvailableBoxes = async () => {
    if (!activeASN) return;
    const boxes = await dataService.getBoxes(activeASN);
    // Filter out boxes with null/undefined/empty box_id to prevent React key errors
    const validBoxes = boxes.filter(
      (box) => box.box_id && box.box_id !== "" && box.box_id !== null
    );
    setAvailableBoxes(validBoxes);
  };

  const handleCartonScan = async (barcode: string) => {
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
          activeSession,
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
        // Check if locked by current user - allow them to continue
        if (status.locked_by === settings.user_id) {
          // Same user - restore their session
          logStateChange("HANDLE_CARTON_SCAN_SAME_USER", { carton: cartonId });
          setLockedCartonWithLog(cartonId);
          setWorkflowStateWithLog("SCAN_ITEM");
          await loadCartonItems();
          await loadLockInfo();
          await loadAvailableCartons();
          setLoading(false);
          Alert.alert("Info", `Resuming work on carton ${cartonId}`);
          return;
        } else {
          // Locked by different user - in demo mode, allow force unlock
          Alert.alert(
            "Carton Already in Use",
            `Carton ${cartonId} is currently being processed by another user.\n\nLocked by: ${
              status.locked_by || "Unknown"
            }\nStatus: ${status.status}\n\nPlease select a different carton.`,
            [
              {
                text: "OK",
                style: "cancel",
              },
              // Only show "Force Unlock" in demo mode
              ...(settings.demo_mode === 1
                ? [
                    {
                      text: "Force Unlock (Demo)",
                      style: "destructive",
                      onPress: async () => {
                        console.log(
                          `🔓 Force unlocking carton ${cartonId} in demo mode`
                        );
                        // Force unlock in demo mode
                        await dataService.updateCartonStatus({
                          asn_no: normalizedASN,
                          inbound_session: activeSession,
                          carton_id: cartonId,
                          status: "Unloaded",
                          locked_by: null,
                          locked_on: null,
                          updated_on: new Date().toISOString(),
                        });

                        // Sync status change to backend
                        try {
                          await apiService.updateCartonStatus({
                            asn_no: activeASN, // Use original format from desktop
                            inbound_session: activeSession,
                            carton_id: cartonId,
                            status: "Unloaded",
                            user_id: settings.user_id,
                            device_id: settings.device_id,
                          });
                          console.log(
                            `✅ Carton ${cartonId} status synced to backend: Unloaded (force unlock)`
                          );
                        } catch (apiError: any) {
                          console.warn(
                            `⚠️ Failed to sync carton ${cartonId} status to backend:`,
                            apiError.message
                          );
                          // Don't block user flow if API sync fails
                        }

                        // Retry locking
                        console.log(`🔄 Retrying lock for carton ${cartonId}`);
                        handleCartonScan(cartonId);
                      },
                    },
                  ]
                : []),
            ]
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
          `Carton ${cartonId} cannot be processed.\n\nCurrent status: ${status.status}\n\nOnly "Unloaded" or "Pending" cartons can be received.`
        );
        setLoading(false);
        await loadAvailableCartons(); // Refresh available cartons
        return;
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
      const isLocked =
        lockResponse?.data?.locked === true ||
        lockResponse?.locked === true ||
        lockResponse?.ok === true;

      if (!isLocked) {
        const errorMessage =
          lockResponse?.data?.message ||
          lockResponse?.message ||
          lockResponse?.error?.message ||
          lockResponse?.error ||
          JSON.stringify(lockResponse) ||
          "Failed to lock carton";
        console.error(`❌ Lock carton failed:`, {
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

      console.log(`✅ Carton ${cartonId} locked successfully`);

      // Update local status
      await dataService.updateCartonStatus({
        asn_no: normalizedASN,
        inbound_session: currentSession,
        carton_id: cartonId,
        status: "Receiving",
        locked_by: settings.user_id,
        locked_on: new Date().toISOString(),
        updated_on: new Date().toISOString(),
      });

      // Sync status change to backend
      try {
        console.log(`📡 Syncing carton status to backend:`, {
          carton: cartonId,
          asn: currentASN,
          session: currentSession,
          status: "Receiving",
        });
        await apiService.updateCartonStatus({
          asn_no: currentASN, // Use original format from desktop
          inbound_session: currentSession,
          carton_id: cartonId,
          status: "Receiving", // Backend expects "Receiving"
          user_id: settings.user_id,
          device_id: settings.device_id,
        });
        console.log(
          `✅ Carton ${cartonId} status synced to backend: Receiving`
        );
      } catch (apiError: any) {
        console.warn(
          `⚠️ Failed to sync carton ${cartonId} status to backend:`,
          apiError.message
        );
        // 404 errors are expected if carton doesn't exist in backend yet
        // The mobile app will continue working locally and sync later
        if (apiError.message?.includes("404")) {
          console.log(
            `ℹ️ Carton ${cartonId} not found in backend (404). This is expected if the carton hasn't been created in the backend yet. Local status will be synced when the carton is created.`
          );
        }
        // Don't block user flow if API sync fails
      }

      logStateChange("SELECT_CARTON_LOCK", { carton: cartonId });
      setLockedCartonWithLog(cartonId);

      // Load carton items FIRST before setting workflow state
      await loadCartonItems();

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
        setScannedItemsWithLog(savedStateBeforeLock.scanned_items || []);
        setScannedQuantitiesWithLog(
          savedStateBeforeLock.scanned_quantities || {}
        );

        // Only restore currentItem if it exists, otherwise start fresh
        const restoredCurrentItem = savedStateBeforeLock.current_item || null;
        setCurrentItemWithLog(restoredCurrentItem);

        // If workflow state is SCAN_BOX but there's no currentItem, go back to SCAN_ITEM
        const restoredWorkflowState =
          savedStateBeforeLock.workflow_state as WorkflowState;
        if (restoredWorkflowState === "SCAN_BOX" && !restoredCurrentItem) {
          console.log(
            "⚠️ Saved state has SCAN_BOX but no currentItem, resetting to SCAN_ITEM"
          );
          setWorkflowStateWithLog("SCAN_ITEM");
        } else {
          setWorkflowStateWithLog(restoredWorkflowState);
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
      }

      await loadLockInfo();
      await loadAvailableCartons(); // Refresh available cartons
      Alert.alert("Success", `Carton ${cartonId} locked`);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to lock carton");
    } finally {
      setLoading(false);
    }
  };

  const handleItemScan = async (barcode: string) => {
    if (!activeASN || !activeSession || !lockedCarton) return;

    // Resolve item_code from barcode or item code
    const item = await resolveItemFromBarcode(barcode);
    if (!item) {
      Alert.alert(
        "Item Not Found",
        `Item not found for: ${barcode}\n\nPlease scan the item barcode or item code.`
      );
      return;
    }

    // Check if item is expected in this carton
    const expectedItem = cartonItems.find(
      (ci) => ci.item_code === item.item_code
    );
    if (!expectedItem) {
      Alert.alert(
        "Error",
        `Item ${item.item_code} is not expected in this carton`
      );
      return;
    }

    // Check remaining quantity
    const scannedQty = scannedQuantities[item.item_code] || 0;
    const remainingQty = expectedItem.shipped_qty - scannedQty;

    if (remainingQty <= 0) {
      Alert.alert(
        "Quantity Exceeded",
        `All ${expectedItem.shipped_qty} units of ${item.item_code} have already been scanned.`
      );
      return;
    }

    logStateChange("ITEM_SCANNED", { item: item.item_code });
    setCurrentItemWithLog(item.item_code);
    setWorkflowStateWithLog("SCAN_BOX");
  };

  const handleBoxScan = async (barcode: string) => {
    if (!activeASN || !activeSession || !lockedCarton || !currentItem) return;

    const boxId = barcode.trim().toUpperCase();
    setLoading(true);

    try {
      // Check if user accidentally scanned an item code instead of a BOX
      const scannedItem = await resolveItemFromBarcode(barcode);
      if (scannedItem) {
        Alert.alert(
          "Wrong Scan Type",
          `You scanned an item code (${scannedItem.item_code}), but you need to scan a BOX barcode.\n\nPlease scan the destination BOX for item ${currentItem}.`
        );
        setLoading(false);
        return;
      }

      // Validate box exists and get store
      const boxes = await dataService.getBoxes(activeASN);
      const box = boxes.find((b) => b.box_id === boxId);
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

      // Validate allocation (hard validation - block if no allocation)
      // Exception: WAREHOUSE boxes don't require allocations (for putaway items)
      const boxStoreUpper = String(box.store).trim().toUpperCase();
      const isWarehouseBox = boxStoreUpper === "WAREHOUSE";

      if (!isWarehouseBox) {
        // For store boxes (SR-*), validate allocation
        const allocations = await dataService.getTransferOrderAllocations(
          activeASN,
          box.store
        );
        const allocation = allocations.find((a) => a.item_code === currentItem);
        if (!allocation || allocation.allocated_qty <= 0) {
          Alert.alert(
            "Error",
            `No allocation for ${currentItem} to ${box.store}.\n\nThis item cannot be sorted to this BOX.`
          );
          setLoading(false);
          return;
        }
      } else {
        // For WAREHOUSE boxes, allow putaway items (no allocation validation needed)
        console.log(
          `✅ Allowing putaway item ${currentItem} to WAREHOUSE box ${boxId} (no allocation required)`
        );
      }

      const settings = await getSettings();

      const normalizedASN = normalizeASN(activeASN);

      // Create RECEIVE_ITEM_SCAN event
      await addEvent({
        event_type: "RECEIVE_ITEM_SCAN",
        asn_no: normalizedASN,
        inbound_session: activeSession,
        carton_id: lockedCarton,
        item_code: currentItem,
        qty: 1,
        device_id: settings.device_id,
        user_id: settings.user_id,
      });

      // Create SORT_TO_BOX event
      await addEvent({
        event_type: "SORT_TO_BOX",
        asn_no: normalizedASN,
        inbound_session: activeSession,
        carton_id: lockedCarton,
        item_code: currentItem,
        box_id: boxId,
        store: box.store,
        device_id: settings.device_id,
        user_id: settings.user_id,
      });

      // Save scanned item to database permanently
      // Increment quantity if item already exists in same box, otherwise insert new record
      const { getDatabase } = await import("../database/database");
      const db = await getDatabase();
      try {
        // First, try to get existing record
        const existing = await db.getFirstAsync<{ scanned_qty: number }>(
          `SELECT scanned_qty FROM scanned_items 
           WHERE asn_no = ? AND inbound_session = ? AND carton_id = ? AND item_code = ? AND box_id = ?`,
          [normalizedASN, activeSession, lockedCarton, currentItem, boxId]
        );

        if (existing) {
          // Update existing record: increment scanned_qty
          const newQty = existing.scanned_qty + 1;
          await db.runAsync(
            `UPDATE scanned_items 
             SET scanned_qty = ?, scanned_on = ?, device_id = ?, user_id = ?
             WHERE asn_no = ? AND inbound_session = ? AND carton_id = ? AND item_code = ? AND box_id = ?`,
            [
              newQty,
              new Date().toISOString(),
              settings.device_id,
              settings.user_id,
              normalizedASN,
              activeSession,
              lockedCarton,
              currentItem,
              boxId,
            ]
          );
          console.log(
            `✅ Updated scanned item quantity in database: ${currentItem} -> ${boxId} (qty: ${existing.scanned_qty} + 1 = ${newQty})`
          );
        } else {
          // Insert new record
          await db.runAsync(
            `INSERT INTO scanned_items 
             (asn_no, inbound_session, carton_id, item_code, box_id, store, scanned_qty, scanned_on, device_id, user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              normalizedASN,
              activeSession,
              lockedCarton,
              currentItem,
              boxId,
              box.store,
              1, // scanned_qty
              new Date().toISOString(),
              settings.device_id,
              settings.user_id,
            ]
          );
          console.log(
            `✅ Saved scanned item to database: ${currentItem} -> ${boxId} (qty: 1)`
          );
        }
      } catch (error: any) {
        console.error("❌ Failed to save scanned item to database:", error);
        // Don't fail the operation if saving to scanned_items fails
      }

      // Update scanned items list and quantities
      const newScannedItems = [
        ...scannedItems,
        { item_code: currentItem, box_id: boxId },
      ];
      logStateChange("ITEM_SORTED_TO_BOX", {
        item: currentItem,
        box: boxId,
        previousScannedCount: scannedItems.length,
        newScannedCount: newScannedItems.length,
      });
      setScannedItemsWithLog(newScannedItems);

      // Increment scanned quantity for this item
      const currentScannedQty = scannedQuantities[currentItem] || 0;
      const newQuantities = {
        ...scannedQuantities,
        [currentItem]: currentScannedQty + 1,
      };
      logStateChange("UPDATE_SCANNED_QUANTITY", {
        item: currentItem,
        fromQty: currentScannedQty,
        toQty: currentScannedQty + 1,
      });
      setScannedQuantitiesWithLog(newQuantities);

      // Track last scanned item
      setLastScannedItem(currentItem);

      const sortedItem = currentItem;
      setCurrentItemWithLog(null);
      setWorkflowStateWithLog("SCAN_ITEM");
      await loadAvailableBoxes(); // Refresh boxes list
      Alert.alert("Success", `Item ${sortedItem} sorted to ${boxId}`);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to sort item");
    } finally {
      setLoading(false);
    }
  };

  // Get incomplete items (items that haven't been fully scanned)
  const incompleteItems = useMemo(() => {
    return cartonItems.filter((item) => {
      const scannedQty = scannedQuantities[item.item_code] || 0;
      return scannedQty < item.shipped_qty;
    });
  }, [cartonItems, scannedQuantities]);

  // Check if current item is fully scanned
  const isCurrentItemComplete = useMemo(() => {
    if (!currentItem) return false;
    const cartonItem = cartonItems.find(
      (item) => item.item_code === currentItem
    );
    if (!cartonItem) return false;
    const scannedQty = scannedQuantities[currentItem] || 0;
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
        const normalizedASN = normalizeASN(activeASN);

        // Get all allocations for the current item
        const allAllocations = await dataService.getTransferOrderAllocations(
          normalizedASN
        );
        const itemAllocations = allAllocations.filter(
          (a) => a.item_code === currentItem
        );

        // If no allocations, check if there are warehouse boxes (for putaway items)
        if (itemAllocations.length === 0) {
          const warehouseBoxes = availableBoxes.filter((box) => {
            // Exclude boxes with null/undefined/empty box_id
            if (!box.box_id || box.box_id === "" || box.box_id === null) {
              return false;
            }
            const boxStore = String(box.store).trim().toUpperCase();
            return boxStore === "WAREHOUSE" && box.status === "Open";
          });

          if (warehouseBoxes.length > 0) {
            // Show warehouse boxes for putaway items
            console.log(
              `📦 No allocations for ${currentItem}, showing ${warehouseBoxes.length} warehouse box(es) for putaway`
            );
            setFilteredAvailableBoxes(warehouseBoxes);
            return;
          } else {
            // No allocations and no warehouse boxes
            setFilteredAvailableBoxes([]);
            return;
          }
        }

        // Calculate scanned quantities per store for the current item
        const scannedByStore: Record<string, number> = {};
        scannedItems
          .filter((si) => si.item_code === currentItem)
          .forEach((si) => {
            scannedByStore[si.store] = (scannedByStore[si.store] || 0) + 1;
          });

        // Get stores with remaining allocations
        const storesWithRemainingAllocation = itemAllocations
          .filter((alloc) => {
            const scannedQty = scannedByStore[alloc.store] || 0;
            return scannedQty < alloc.allocated_qty;
          })
          .map((alloc) => alloc.store);

        // Filter boxes to only show boxes from stores with remaining allocations
        // Always include WAREHOUSE boxes (they don't have allocations, they're for putaway)
        // IMPORTANT: Filter out boxes with null/undefined box_id to prevent React key errors
        const filtered = availableBoxes.filter((box) => {
          // First, exclude boxes with null/undefined/empty box_id
          if (!box.box_id || box.box_id === "" || box.box_id === null) {
            return false;
          }

          const boxStore = String(box.store).trim().toUpperCase();
          const isWarehouse = boxStore === "WAREHOUSE";
          const hasRemainingAllocation = storesWithRemainingAllocation.includes(
            box.store
          );

          // Include warehouse boxes OR boxes from stores with remaining allocations
          return isWarehouse || hasRemainingAllocation;
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

        setFilteredAvailableBoxes(filtered);
      } catch (error) {
        console.error("Error filtering boxes by allocation:", error);
        // Fallback: filter out null box_ids even on error
        const fallbackBoxes = availableBoxes.filter(
          (box) => box.box_id && box.box_id !== "" && box.box_id !== null
        );
        setFilteredAvailableBoxes(fallbackBoxes);
      }
    };

    filterBoxesByAllocation();
  }, [
    currentItem,
    activeASN,
    availableBoxes,
    scannedItems,
    isCurrentItemComplete,
  ]);

  // Check if all items in the carton have been received
  const areAllItemsReceived = useMemo(() => {
    if (!lockedCarton || cartonItems.length === 0) return false;

    // Check if all items have been scanned with correct quantities
    for (const cartonItem of cartonItems) {
      const scannedQty = scannedQuantities[cartonItem.item_code] || 0;
      const expectedQty = cartonItem.shipped_qty || 0;

      if (scannedQty < expectedQty) {
        return false;
      }
    }

    return true;
  }, [lockedCarton, cartonItems, scannedQuantities]);

  const handleFinishCarton = async () => {
    if (!activeASN || !activeSession || !lockedCarton) return;

    // Validate all items are received before finishing
    if (!areAllItemsReceived) {
      Alert.alert(
        "Incomplete Carton",
        "Please receive all items in the carton before finishing. Check the Expected Items section to see what's remaining.",
        [{ text: "OK" }]
      );
      return;
    }

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
      const receiveLinesMap = new Map<string, { 
        item_code: string; 
        expected_qty: number; 
        received_qty: number;
      }>();

      // Build a map of expected quantities by item_code (from cartonItems)
      const expectedQtyByItem = new Map<string, number>();
      for (const cartonItem of cartonItems) {
        expectedQtyByItem.set(cartonItem.item_code, cartonItem.shipped_qty || 0);
      }

      // Group scanned items by item_code and aggregate quantities
      // Note: Backend expects carton_id, so we use lockedCarton for all items
      for (const scannedItem of scannedItemsFromDB) {
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

      // Convert map to array - use lockedCarton as carton_id (backend requirement)
      const receiveLines = Array.from(receiveLinesMap.values()).map(line => ({
        carton_id: lockedCarton, // Backend expects carton_id
        item_code: line.item_code,
        expected_qty: line.expected_qty,
        received_qty: line.received_qty,
        condition: "Good" as const,
        remarks: null as string | null,
      }));

      console.log(`📦 Building receive lines for carton ${lockedCarton}:`, {
        totalLines: receiveLines.length,
        lines: receiveLines.map(l => `${l.item_code}: ${l.received_qty}/${l.expected_qty}`),
      });

      // Call batch receive lines API
      try {
        await apiService.createReceiveLines({
          parent_title: activeSession,
          receive_lines: receiveLines,
        });
        console.log(`✅ Receive lines created for carton ${lockedCarton}`);
      } catch (receiveLinesError: any) {
        console.warn(
          `⚠️ Failed to create receive lines for carton ${lockedCarton}:`,
          receiveLinesError.message
        );
        // Don't block user flow if receive lines API fails - carton completion still proceeds
      }

      await apiService.completeCarton({
        inbound_session: activeSession,
        asn_no: normalizedASN,
        carton_id: lockedCarton,
        user_id: settings.user_id!,
        device_id: settings.device_id!,
      });

      // Update carton status to Received and clear lock info
      const statusUpdate = {
        asn_no: normalizedASN,
        inbound_session: activeSession,
        carton_id: lockedCarton,
        status: "Received" as const,
        locked_by: null, // Clear lock when carton is completed
        locked_on: null, // Clear lock timestamp
        updated_on: new Date().toISOString(),
      };

      console.log(`💾 Updating carton status:`, {
        carton: lockedCarton,
        asn: normalizedASN,
        session: activeSession,
        status: "Received",
        updateData: statusUpdate,
      });

      await dataService.updateCartonStatus(statusUpdate);

      // Sync status change to backend
      try {
        await apiService.updateCartonStatus({
          asn_no: activeASN, // Use original format from desktop
          inbound_session: activeSession,
          carton_id: lockedCarton,
          status: "Received",
          user_id: settings.user_id,
          device_id: settings.device_id,
        });
        console.log(
          `✅ Carton ${lockedCarton} status synced to backend: Received`
        );
      } catch (apiError: any) {
        console.warn(
          `⚠️ Failed to sync carton ${lockedCarton} status to backend:`,
          apiError.message
        );
        // Don't block user flow if API sync fails
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
          verifyStatus?.status === "Received" &&
          verifyStatus?.inbound_session === activeSession,
      });

      if (!verifyStatus || verifyStatus.status !== "Received") {
        console.error(
          `❌ ERROR: Status update failed! Expected 'Received', got:`,
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
          (s) => s.status === "Received"
        ).length;

        // Update session with new completed cartons count
        await dataService.updateInboundSessionStatus(
          activeSession,
          completedCartons === totalCartons ? "Completed" : "Active",
          completedCartons,
          totalCartons
        );

        // Sync session to backend
        const { syncSessionToBackend } = await import(
          "../services/session-sync.service"
        );
        try {
          await syncSessionToBackend(activeSession);
          console.log("✅ Session synced to backend after carton completion");
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

      Alert.alert("Success", `Carton ${lockedCarton} completed`, [
        {
          text: "OK",
          onPress: async () => {
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
            setCartonItemsWithLog([]); // Clear carton items when finishing

            // Clear saved workflow state since carton is completed
            if (activeASN && activeSession) {
              const normalizedASN = normalizeASN(activeASN);
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

            // Verify the status was updated correctly
            const normalizedASN = normalizeASN(activeASN);
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
          },
        },
      ]);
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

  const handleScan = (barcode: string) => {
    switch (workflowState) {
      case "SELECT_CARTON":
        handleCartonScan(barcode);
        break;
      case "SCAN_ITEM":
        handleItemScan(barcode);
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
      const response = await apiService.createBox({
        asn_no: activeASN,
        to_no: "TO-00012",
        store: selectedStoreForBox,
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
      };

      console.log("💾 Creating box in ReceiveSortScreen:", newBox);

      await dataService.saveBox(newBox);
      await loadAvailableBoxes();
      setShowCreateBox(false);
      Alert.alert("Success", `BOX ${boxId} created! You can now scan it.`);
    } catch (error: any) {
      console.error("❌ Failed to create box:", error);
      Alert.alert("Error", error.message || "Failed to create BOX");
    } finally {
      setLoading(false);
    }
  };

  const handleItemDetailsClick = async (itemCode: string) => {
    if (!activeASN) return;

    const scannedQty = scannedQuantities[itemCode] || 0;

    // Get all TO allocations for this ASN
    const allocations = await dataService.getTransferOrderAllocations(
      activeASN
    );

    // Find allocations for this item (may be multiple stores)
    const itemAllocations = allocations.filter((a) => a.item_code === itemCode);

    // Calculate total TO quantity across all stores
    const totalTOQty = itemAllocations.reduce(
      (sum, alloc) => sum + (alloc.allocated_qty || 0),
      0
    );

    // Calculate remaining
    const remainingQty = totalTOQty - scannedQty;

    // Get boxes to find store for each scanned item
    const boxes = await dataService.getBoxes(activeASN);
    const boxStoreMap = new Map(boxes.map((b) => [b.box_id, b.store]));

    // Get all BOXes this item was sorted into, grouped by store
    const itemScans = scannedItems.filter((si) => si.item_code === itemCode);
    const storeBoxMap = new Map<string, string[]>();

    itemScans.forEach((scan) => {
      const boxStore = boxStoreMap.get(scan.box_id || "") || "Unknown";
      if (!storeBoxMap.has(boxStore)) {
        storeBoxMap.set(boxStore, []);
      }
      const boxes = storeBoxMap.get(boxStore)!;
      if (!boxes.includes(scan.box_id || "")) {
        boxes.push(scan.box_id || "");
      }
    });

    // Build allocation details
    const allocationDetails = itemAllocations.map((alloc) => {
      // Count scanned items for this store
      const storeScanned = itemScans.filter((si) => {
        const boxStore = boxStoreMap.get(si.box_id || "");
        return boxStore === alloc.store;
      }).length;

      const storeBoxes = storeBoxMap.get(alloc.store) || [];

      return {
        store: alloc.store,
        allocatedQty: alloc.allocated_qty,
        scannedQty: storeScanned,
        boxes: storeBoxes,
      };
    });

    setItemDetailsModal({
      visible: true,
      itemCode,
      scannedQty,
      totalTOQty,
      remainingQty,
      allocations: allocationDetails,
    });
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

      // Validate allocation (except for WAREHOUSE boxes)
      const boxStoreUpper = String(box.store).trim().toUpperCase();
      const isWarehouseBox = boxStoreUpper === "WAREHOUSE";

      if (!isWarehouseBox) {
        const allocations = await dataService.getTransferOrderAllocations(
          activeASN,
          box.store
        );
        const allocation = allocations.find(
          (a) => a.item_code === manualQtyItem
        );
        if (!allocation || allocation.allocated_qty <= 0) {
          Alert.alert(
            "Error",
            `No allocation for ${manualQtyItem} to ${box.store}.\n\nThis item cannot be sorted to this BOX.`
          );
          setLoading(false);
          return;
        }
      }

      // Create events for the quantity (one event per unit, or batch event)
      // For now, we'll create multiple RECEIVE_ITEM_SCAN and SORT_TO_BOX events
      for (let i = 0; i < qty; i++) {
        await addEvent({
          event_type: "RECEIVE_ITEM_SCAN",
          asn_no: normalizedASN,
          inbound_session: activeSession,
          carton_id: lockedCarton,
          item_code: manualQtyItem,
          qty: 1,
          device_id: settings.device_id,
          user_id: settings.user_id,
        });

        await addEvent({
          event_type: "SORT_TO_BOX",
          asn_no: normalizedASN,
          inbound_session: activeSession,
          carton_id: lockedCarton,
          item_code: manualQtyItem,
          box_id: manualQtyBox,
          store: box.store,
          device_id: settings.device_id,
          user_id: settings.user_id,
        });
      }

      // Update scanned_items in database
      const { getDatabase } = await import("../database/database");
      const db = await getDatabase();

      // Check for existing record
      const existing = await db.getFirstAsync<{ scanned_qty: number }>(
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

      if (existing) {
        // Update existing record: increment scanned_qty
        const newQty = existing.scanned_qty + qty;
        await db.runAsync(
          `UPDATE scanned_items 
           SET scanned_qty = ?, scanned_on = ?, device_id = ?, user_id = ?
           WHERE asn_no = ? AND inbound_session = ? AND carton_id = ? AND item_code = ? AND box_id = ?`,
          [
            newQty,
            new Date().toISOString(),
            settings.device_id,
            settings.user_id,
            normalizedASN,
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
        // Insert new record
        await db.runAsync(
          `INSERT INTO scanned_items 
           (asn_no, inbound_session, carton_id, item_code, box_id, store, scanned_qty, scanned_on, device_id, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            normalizedASN,
            activeSession,
            lockedCarton,
            manualQtyItem,
            manualQtyBox,
            box.store,
            qty,
            new Date().toISOString(),
            settings.device_id,
            settings.user_id,
          ]
        );
        console.log(
          `✅ Saved scanned item to database: ${manualQtyItem} -> ${manualQtyBox} (qty: ${qty})`
        );
      }

      // Update scanned items list and quantities
      const newScannedItems = [
        ...scannedItems,
        ...Array(qty).fill({ item_code: manualQtyItem, box_id: manualQtyBox }),
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

      // Reset manual quantity input
      setManualQtyItem(null);
      setManualQtyValue("");
      setManualQtyBox(null);

      Alert.alert(
        "Success",
        `Added ${qty} units of ${manualQtyItem} to ${manualQtyBox}`
      );
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
      const scannedQty = scannedQuantities[item.item_code] || 0;
      const remainingQty = item.shipped_qty - scannedQty;
      const isComplete = remainingQty <= 0;
      const isEditing = manualQtyItem === item.item_code;

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
                  {availableBoxes
                    .filter(
                      (box) =>
                        box.box_id != null &&
                        box.box_id !== "" &&
                        box.status === "Open"
                    )
                    .map((box) => (
                      <TouchableOpacity
                        key={box.box_id}
                        style={[
                          styles.manualQtyBoxButton,
                          manualQtyBox === box.box_id &&
                            styles.manualQtyBoxButtonActive,
                        ]}
                        onPress={() => setManualQtyBox(box.box_id)}
                      >
                        <Text
                          style={[
                            styles.manualQtyBoxButtonText,
                            manualQtyBox === box.box_id &&
                              styles.manualQtyBoxButtonTextActive,
                          ]}
                        >
                          {box.box_id}
                        </Text>
                        <Text style={styles.manualQtyBoxStoreText}>
                          {box.store}
                        </Text>
                      </TouchableOpacity>
                    ))}
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
              !isComplete && (
                <TouchableOpacity
                  style={styles.manualQtyTriggerButton}
                  onPress={() => {
                    setManualQtyItem(item.item_code);
                    setManualQtyValue("");
                    setManualQtyBox(null);
                    loadAvailableBoxes(); // Refresh boxes list
                  }}
                >
                  <Text style={styles.manualQtyTriggerText}>
                    📝 Enter Quantity
                  </Text>
                </TouchableOpacity>
              )
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
      scannedQuantities,
      manualQtyItem,
      manualQtyValue,
      manualQtyBox,
      availableBoxes,
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
                {item.boxes.map((boxId, idx) => (
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
      // Get all BOXes this item was sorted into
      const itemBoxes = scannedItems
        .filter((si) => si.item_code === itemCode)
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

        <BarcodeScanner
          onScan={handleScan}
          placeholder={getScannerPlaceholder()}
          title={getScannerTitle()}
          scanType={
            workflowState === "SCAN_BOX"
              ? "box"
              : workflowState === "SCAN_ITEM"
              ? "item"
              : "carton"
          }
        />

        {workflowState === "SCAN_BOX" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>BOX Management</Text>
              <TouchableOpacity
                style={styles.createBoxButton}
                onPress={() => setShowCreateBox(!showCreateBox)}
              >
                <Text style={styles.createBoxButtonText}>
                  {showCreateBox ? "Cancel" : "+ Create BOX"}
                </Text>
              </TouchableOpacity>
            </View>

            {showCreateBox && (
              <View style={styles.createBoxSection}>
                <Text style={styles.createBoxLabel}>Select Store:</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.storeSelector}
                  contentContainerStyle={styles.storeSelectorContent}
                >
                  {["WAREHOUSE", "SR-01", "SR-02", "SR-03", "SR-04"].map(
                    (store) => (
                      <TouchableOpacity
                        key={store}
                        style={[
                          styles.storeButton,
                          selectedStoreForBox === store &&
                            styles.storeButtonActive,
                        ]}
                        onPress={() => setSelectedStoreForBox(store)}
                      >
                        <Text
                          style={[
                            styles.storeButtonText,
                            selectedStoreForBox === store &&
                              styles.storeButtonTextActive,
                          ]}
                        >
                          {store}
                        </Text>
                      </TouchableOpacity>
                    )
                  )}
                </ScrollView>
                <TouchableOpacity
                  style={[
                    styles.createBoxSubmitButton,
                    loading && styles.buttonDisabled,
                  ]}
                  onPress={handleQuickCreateBox}
                  disabled={loading}
                >
                  <Text style={styles.createBoxSubmitText}>
                    {loading ? "Creating..." : "Create BOX"}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

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
                ) : allCartonsStatus.inReceiving > 0 ? (
                  <>
                    <Text style={styles.noCartonsTitle}>
                      ⚠️ Cartons In Progress
                    </Text>
                    <Text style={styles.noCartonsText}>
                      You have {allCartonsStatus.inReceiving} carton(s)
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
              onPress={() => {
                console.log("Expected Items clicked");
                setShowExpectedItemsModal(true);
              }}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.sectionTitle,
                  { color: "#FF0000", fontSize: 20 },
                ]}
              >
                ✅ Expected Items (NEW UI)
              </Text>
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
                📋 Tap to view all items
              </Text>
              <TouchableOpacity
                style={styles.clickableSectionHeader}
                onPress={() => {
                  console.log("View All Items clicked");
                  setShowExpectedItemsModal(true);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.clickableSectionText}>
                  View All Items ({incompleteItems.length})
                </Text>
                <Text style={styles.clickableSectionArrow}>→</Text>
              </TouchableOpacity>
              {cartonItems.length === 0 ? (
                <Text style={styles.emptyText}>Loading items...</Text>
              ) : lastScannedItem ? (
                (() => {
                  const item = cartonItems.find(
                    (ci) => ci.item_code === lastScannedItem
                  );
                  if (!item)
                    return <Text style={styles.emptyText}>Item not found</Text>;
                  const scannedQty = scannedQuantities[item.item_code] || 0;
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
                (() => {
                  const firstItem = cartonItems[0];
                  if (!firstItem)
                    return <Text style={styles.emptyText}>No items</Text>;
                  const scannedQty =
                    scannedQuantities[firstItem.item_code] || 0;
                  const remainingQty = firstItem.shipped_qty - scannedQty;
                  return (
                    <View style={styles.lastItemCard}>
                      <Text style={styles.lastItemLabel}>First Item:</Text>
                      <Text style={styles.lastItemCode}>
                        {firstItem.item_code}
                      </Text>
                      <View style={styles.lastItemDetails}>
                        <Text style={styles.lastItemDetail}>
                          ASN: {firstItem.shipped_qty}
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
              ) : lastScannedItem && scannedQuantities[lastScannedItem] ? (
                (() => {
                  const itemBoxes = scannedItems
                    .filter((si) => si.item_code === lastScannedItem)
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
                          Qty: {scannedQuantities[lastScannedItem]}
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

            <TouchableOpacity
              style={[
                styles.button,
                (loading || !areAllItemsReceived) && styles.buttonDisabled,
              ]}
              onPress={handleFinishCarton}
              disabled={loading || !areAllItemsReceived}
            >
              <Text style={styles.buttonText}>
                {loading ? "Completing..." : "Finish Carton"}
              </Text>
              {!areAllItemsReceived && !loading && (
                <Text style={styles.buttonSubtext}>
                  Complete all items first
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
                      <Text style={styles.summaryLabel}>TO Qty (Total)</Text>
                      <Text
                        style={[styles.summaryValue, styles.summaryValueTO]}
                      >
                        {itemDetailsModal.totalTOQty}
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
                    {itemDetailsModal.allocations.map((alloc, index) => (
                      <View key={index} style={styles.allocationCard}>
                        <View style={styles.allocationHeader}>
                          <Text style={styles.allocationStore}>
                            {alloc.store}
                          </Text>
                          <View style={styles.allocationBadges}>
                            <View style={styles.allocationBadge}>
                              <Text style={styles.allocationBadgeText}>
                                Allocated: {alloc.allocatedQty}
                              </Text>
                            </View>
                            <View
                              style={[
                                styles.allocationBadge,
                                styles.allocationBadgeScanned,
                              ]}
                            >
                              <Text style={styles.allocationBadgeText}>
                                Scanned: {alloc.scannedQty}
                              </Text>
                            </View>
                          </View>
                        </View>

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
                    ))}
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
                Expected Items ({incompleteItems.length})
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
                // Filter out items that are completely scanned
                const scannedQty = scannedQuantities[item.item_code] || 0;
                const isComplete = scannedQty >= item.shipped_qty;
                if (isComplete) return false;

                // Apply search filter if query exists
                if (expectedItemsSearchQuery) {
                  return item.item_code
                    .toLowerCase()
                    .includes(expectedItemsSearchQuery.toLowerCase());
                }

                return true;
              })}
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
    minWidth: 80,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#ddd",
    backgroundColor: "#fff",
    alignItems: "center",
    marginRight: 8,
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
});
