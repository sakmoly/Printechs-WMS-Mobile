import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  FlatList,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { apiService } from "../services/api.service";
import { getDatabase } from "../database/database";
import { getSettings } from "../services/settings.service";
import { generateUUID } from "../utils/uuid";

export default function CycleCountDashboardScreen() {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(false);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [showWarehousePicker, setShowWarehousePicker] = useState(false);
  const [warehouses, setWarehouses] = useState<{ code: string; name: string; warehouse_type: string }[]>([]);
  const [taskForm, setTaskForm] = useState({
    bin_code: "",
    warehouse_id: "",
    count_type: "Adhoc",
    opening_stock: false, // ✅ NEW: Opening Stock flag (default: false - unchecked)
  });
  const [showPreviewModal, setShowPreviewModal] = useState(false); // ✅ NEW: Preview modal state
  const [previewItems, setPreviewItems] = useState<{ item_code: string; item_name?: string; qty: number; carton_id?: string | null }[]>([]); // ✅ NEW: Preview items state
  const [pendingTaskData, setPendingTaskData] = useState<any>(null); // ✅ NEW: Store task data while showing preview
  const [stats, setStats] = useState({
    pendingBins: 0,
    completedToday: 0,
    variancesPendingApproval: 0,
    draftSessions: 0,
    pushedSessions: 0,
  });

  const loadWarehouses = useCallback(async () => {
    try {
      const db = await getDatabase();
      const warehousesList = await db.getAllAsync<{ code: string; name: string; warehouse_type: string }>(
        "SELECT code, name, warehouse_type FROM warehouse_store_cache ORDER BY warehouse_type, code"
      );
      
      console.log(`📦 Loaded ${warehousesList.length} warehouses/stores from cache`);
      setWarehouses(warehousesList);
      
      // Set default to first "Warehouse" type warehouse, or first warehouse if no warehouses found
      if (warehousesList.length > 0) {
        const warehouseType = warehousesList.find(w => w.warehouse_type === "Warehouse");
        const defaultWarehouse = warehouseType || warehousesList[0];
        setTaskForm(prev => ({ ...prev, warehouse_id: defaultWarehouse.code }));
        console.log(`✅ Default warehouse set to: ${defaultWarehouse.code} (type: ${defaultWarehouse.warehouse_type})`);
      }
    } catch (error: any) {
      console.error("Error loading warehouses:", error);
      // Fallback to default
      setTaskForm(prev => ({ ...prev, warehouse_id: "DEFAULT-WH" }));
    }
  }, []);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDatabase();
      
      // Count draft sessions
      const draftSessions = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM cycle_count_sessions WHERE status = 'Draft'"
      );
      
      // Count completed today
      const today = new Date().toISOString().split("T")[0];
      const completedToday = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM cycle_count_sessions WHERE status = 'Completed' AND DATE(completed_at) = ?",
        [today]
      );

      const pushedSessions = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM cycle_count_sessions WHERE status IN ('Submitted', 'Completed')"
      );

      setStats({
        pendingBins: 0, // TODO: Get from API
        completedToday: completedToday?.count || 0,
        variancesPendingApproval: 0, // TODO: Get from API
        draftSessions: draftSessions?.count || 0,
        pushedSessions: pushedSessions?.count || 0,
      });
    } catch (error: any) {
      console.error("Error loading stats:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStats();
      loadWarehouses();
    }, [loadStats, loadWarehouses])
  );

  const handleStartDirectedCount = () => {
    (navigation as any).navigate("CycleCountBinCounting", {
      countType: "Directed",
      countMode: "Reconciliation",
      isBlindCount: false,
      scanOnline: false,
      openingStock: false,
      forceNewSession: true,
      skipCartonRestore: true,
    });
  };

  const handleStartAdhocCount = () => {
    (navigation as any).navigate("CycleCountBinCounting", {
      countType: "Adhoc",
      countMode: "Reconciliation",
      isBlindCount: false,
      scanOnline: false,
      openingStock: false,
      forceNewSession: true,
      skipCartonRestore: true,
    });
  };

  const handleViewDrafts = () => {
    (navigation as any).navigate("CycleCountDrafts");
  };

  const handleViewHistory = () => {
    (navigation as any).navigate("CycleCountHistory");
  };

  const handleViewVariances = () => {
    // TODO: Navigate to Variances List when implemented
    Alert.alert(
      "Coming Soon",
      "Variances approval will be available soon."
    );
    // (navigation as any).navigate("CycleCountVariances");
  };

  const handleCreateTask = () => {
    // Reset form and set default warehouse (prefer "Warehouse" type)
    const defaultWarehouse = warehouses.find(w => w.warehouse_type === "Warehouse") || warehouses[0];
    setTaskForm({
      bin_code: "",
      warehouse_id: defaultWarehouse?.code || "DEFAULT-WH",
      count_type: "Adhoc",
      opening_stock: false, // ✅ NEW: Reset opening_stock to false (default - unchecked)
    });
    setPreviewItems([]); // ✅ NEW: Reset preview items
    setShowCreateTaskModal(true);
  };

  const handleCreateTaskSubmit = async () => {
    if (!taskForm.bin_code.trim()) {
      Alert.alert("Error", "Please enter a bin code");
      return;
    }

    setCreatingTask(true);
    try {
      const settings = await getSettings();
      const db = await getDatabase();
      
      // Create task on backend
      // Backend requires: title, count_type, warehouse, count_date, created_by, and lines (non-empty)
      const binCodeUpper = taskForm.bin_code.trim().toUpperCase();
      const countDate = new Date().toISOString().split("T")[0]; // Format: YYYY-MM-DD
      const createdBy = settings.user_id || settings.user_code || "MOBILE-USER";
      
      // Generate title if not provided by backend (format: CC-{BIN_CODE}-{TIMESTAMP})
      const timestamp = Date.now().toString(36).toUpperCase();
      const generatedTitle = `CC-${binCodeUpper.replace(/[^A-Z0-9]/g, "-")}-${timestamp}`;
      
      // Load expected items from stock ledger for this bin to create initial lines
      // Backend requires at least one line in the lines array
      // Backend requires expected_qty to be non-null, so we use 0 when there's no stock value
      let initialLines: {
        item_code: string;
        bin_location: string;
        expected_qty: number; // Always a number (never null) - use 0 when no stock data
        actual_qty?: number;
        counted_qty?: number;
      }[] = [];
      
      const shouldLoadExpectedForTask =
        String(taskForm.count_type || "").toLowerCase() === "directed" &&
        taskForm.opening_stock !== true;

      // Only directed non-opening-stock counts should preload expected/bin stock.
      if (shouldLoadExpectedForTask) {
        // ✅ NEW: Priority 1: Fetch expected items from BACKEND stock ledger (real-time data)
        // This allows users to see expected items immediately before creating task
        try {
          const { isDeviceOnline } = await import("../utils/network-check");
          const online = await isDeviceOnline();
          
          if (online) {
            console.log(`🔍 Fetching stock ledger from backend for bin ${binCodeUpper}...`);
            try {
              const stockResponse = await apiService.getStockLedgerByLocation({
                bin_location: binCodeUpper,
                // Carton ID is scanned in the counting screen, not during task creation
                warehouse: taskForm.warehouse_id || undefined,
              });
              
              const stockItems = stockResponse?.data || stockResponse?.items || stockResponse || [];
              
              if (stockItems && stockItems.length > 0) {
                console.log(`✅ Found ${stockItems.length} items from backend stock ledger for bin ${binCodeUpper}`);
                
                // Format items for preview
                const formattedItems = stockItems.map((item: any) => ({
                  item_code: item.item_code,
                  item_name: item.item_name || null,
                  qty: item.qty || item.expected_qty || 0,
                  carton_id: item.carton_id || null, // Carton ID from backend response, if any
                }));
                
                // ✅ NEW: Show preview modal before creating task
                setPreviewItems(formattedItems);
                setPendingTaskData({
                  binCodeUpper,
                  countDate,
                  createdBy,
                  generatedTitle,
                  openingStock: taskForm.opening_stock === true,
                });
                setShowPreviewModal(true);
                setCreatingTask(false);
                return; // Wait for user confirmation
              } else {
                console.log(`ℹ️ No items found in backend stock ledger for bin ${binCodeUpper}`);
                // Fall through to local cache fallback
              }
            } catch (backendError: any) {
              console.warn(`⚠️ Failed to fetch from backend stock ledger:`, backendError.message);
              console.log(`ℹ️ Falling back to local cache...`);
              // Fall through to local cache fallback
            }
          } else {
            console.log(`ℹ️ Device is offline, using local cache...`);
            // Fall through to local cache fallback
          }
          
          // ✅ Fallback: Priority 2: Load expected items from LOCAL stock ledger cache
          try {
            const expectedItems = await db.getAllAsync<{
              item_code: string;
              qty: number | null;
            }>(
              "SELECT item_code, qty FROM stock_ledger_cache WHERE bin_location = ?",
              [binCodeUpper]
            );
            
            console.log(`📦 Found ${expectedItems.length} expected items from local cache for bin ${binCodeUpper}`);
            
            if (expectedItems.length > 0) {
              // Show preview from local cache
              const formattedItems = expectedItems.map((item) => ({
                item_code: item.item_code,
                qty: item.qty || 0,
              }));
              
              setPreviewItems(formattedItems);
              setPendingTaskData({
                binCodeUpper,
                countDate,
                createdBy,
                generatedTitle,
                openingStock: taskForm.opening_stock === true,
              });
              setShowPreviewModal(true);
              setCreatingTask(false);
              return; // Wait for user confirmation
            }
          } catch (cacheError: any) {
            console.warn(`⚠️ Could not load expected items from local cache: ${cacheError.message}`);
            // Continue with empty lines - will create placeholder line below
          }
        } catch (error: any) {
          console.warn(`⚠️ Error fetching expected items: ${error.message}`);
          // Continue with empty lines - will create placeholder line below
        }
      } else {
        console.log(
          `⏭️ Skipping expected item preload. count_type=${taskForm.count_type}, opening_stock=${taskForm.opening_stock}`
        );
      }
      
      // ✅ If no preview was shown (items were empty or blind count), proceed with task creation
      // This handles the case where no preview items were found or blind count is enabled
      await proceedWithTaskCreationInternal(binCodeUpper, countDate, createdBy, generatedTitle, initialLines);
    } catch (error: any) {
      console.error("❌ Error in handleCreateTaskSubmit:", error);
      Alert.alert(
        "Error",
        `Failed to create task: ${error.message || error.toString()}`
      );
      setCreatingTask(false);
    }
  };

  // ✅ NEW: Extract task creation logic into separate function for reuse
  const proceedWithTaskCreationInternal = async (
    binCodeUpper: string,
    countDate: string,
    createdBy: string,
    generatedTitle: string,
    initialLines: {
      item_code: string;
      bin_location: string;
      expected_qty: number;
      actual_qty?: number;
      counted_qty?: number;
      carton_id?: string | null;
    }[]
  ) => {
    setCreatingTask(true);
    try {
      const settings = await getSettings();
      const db = await getDatabase();
      
      // If no expected items found, we need at least one line for backend
      // Blind Count is controlled in the scan bin screen, so we always create placeholder lines here
      if (initialLines.length === 0) {
        const isAdhoc = (taskForm.count_type || "Adhoc").toLowerCase().includes("adhoc");
        
        if (isAdhoc) {
          // Ad-hoc count: No expected items is normal - users count items on-the-fly
          console.log(`ℹ️  Ad-hoc count for bin ${binCodeUpper}: No expected items found. This is normal for ad-hoc counts - items can be counted manually.`);
          // Create a minimal line to satisfy backend requirement
          initialLines = [{
            item_code: "", // Will be filled when items are scanned
            bin_location: binCodeUpper,
            expected_qty: 0, // Backend requires non-null, use 0 when no stock data
            actual_qty: 0,
            counted_qty: 0,
          }];
        } else {
          // Directed count: Expected items should exist - show warning but still create task
          console.warn(`⚠️ Directed count: No expected items found for bin ${binCodeUpper}. Task will be created but may need manual line addition.`);
          Alert.alert(
            "Warning",
            `No expected items found for bin ${binCodeUpper}. The task will be created, but you may need to add items manually when counting.`,
            [{ text: "Continue", style: "default" }]
          );
          // Create a minimal line to satisfy backend requirement
          initialLines = [{
            item_code: "", // Will be filled when items are scanned
            bin_location: binCodeUpper,
            expected_qty: 0, // Backend requires non-null, use 0 when no stock data
            actual_qty: 0,
            counted_qty: 0,
          }];
        }
      }
      
      // ✅ NEW: Get opening_stock value from form
      // Opening Stock indicates this is an initial/baseline count for the bin/location
      // It's independent of blind_count (blind_count controls UI visibility, opening_stock is a backend flag)
      const isOpeningStock = taskForm.opening_stock !== undefined ? taskForm.opening_stock : true; // Default to true if not set

      const taskData = {
        title: generatedTitle, // Backend may override this, but we provide a default
        bin_code: binCodeUpper,
        bin_id: binCodeUpper,
        warehouse: taskForm.warehouse_id || "DEFAULT-WH", // Backend expects 'warehouse' not 'warehouse_id'
        warehouse_id: taskForm.warehouse_id || "DEFAULT-WH", // Also send warehouse_id for compatibility
        count_type: taskForm.count_type || "Adhoc",
        count_date: countDate, // Required: YYYY-MM-DD format
        is_blind_count: false, // Blind Count is controlled in the scan bin screen, not in task creation
        opening_stock: isOpeningStock, // ✅ NEW: From form (user-controlled)
        is_opening_stock: isOpeningStock, // ✅ NEW: Send both field names for backend compatibility
        created_by: createdBy,
        lines: initialLines, // Required: At least one line (from expected items or placeholder)
      };

      console.log("📤 Creating cycle count task with data:", JSON.stringify(taskData, null, 2));
      console.log("📤 Required fields check:");
      console.log(`   - title: ${taskData.title ? '✓' : '✗'}`);
      console.log(`   - count_type: ${taskData.count_type ? '✓' : '✗'}`);
      console.log(`   - warehouse: ${taskData.warehouse ? '✓' : '✗'}`);
      console.log(`   - count_date: ${taskData.count_date ? '✓' : '✗'}`);
      console.log(`   - created_by: ${taskData.created_by ? '✓' : '✗'}`);
      console.log(`   - is_blind_count: ${taskData.is_blind_count ? '✓ (true)' : '✓ (false)'}`);
      console.log(`   - opening_stock: ${taskData.opening_stock ? '✓ (true)' : '✓ (false)'} - Independent of blind_count`);
      console.log(`   - lines: ${Array.isArray(taskData.lines) ? `✓ (${taskData.lines.length} items)` : '✗'}`);
      
      const response = await apiService.createCycleCount(taskData);
      
      console.log("✅ Task created:", response);
      
      // Extract task title from response
      const taskTitle = response?.title || response?.data?.title || response?.task_title;
      
      if (!taskTitle) {
        throw new Error("Backend did not return task title");
      }

      // Create local session immediately so it shows in drafts
      const sessionId = generateUUID();
      const now = new Date().toISOString();
      
      console.log(`💾 Creating local session ${sessionId} for task ${taskTitle}`);
      
      await db.runAsync(
        `INSERT INTO cycle_count_sessions (
          session_id, count_type, warehouse_id, bin_id, bin_code,
          started_by, started_at, status, is_blind_count, device_id, synced, 
          server_session_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          taskForm.count_type || "Adhoc",
          taskForm.warehouse_id || "DEFAULT-WH",
          binCodeUpper, // bin_id
          binCodeUpper, // bin_code
          createdBy,
          now,
          "Draft", // Status is Draft so it shows in drafts
          0, // Blind Count is controlled in the scan bin screen, not in task creation
          settings.device_id || "",
          0, // Not synced yet (task was just created)
          taskTitle, // server_session_id = task title
          now,
          now,
        ]
      );
      
      console.log(`✅ Created local session ${sessionId} with server_session_id ${taskTitle}`);

      Alert.alert(
        "Success",
        `Task ${taskTitle} created successfully!`,
        [
          {
            text: "OK",
            onPress: () => {
              setShowCreateTaskModal(false);
              setShowPreviewModal(false); // ✅ Close preview modal if open
              (navigation as any).navigate("CycleCountBinCounting", {
                sessionId,
                countType: taskForm.count_type || "Adhoc",
                countMode: "Reconciliation",
                binCode: binCodeUpper,
                binInfo: {
                  bin_code: binCodeUpper,
                  bin_id: binCodeUpper,
                  warehouse_id: taskForm.warehouse_id || "",
                },
                isBlindCount: false,
                scanOnline: false,
                openingStock: isOpeningStock,
                preCreatedTaskTitle: taskTitle,
              });
            },
          },
        ]
      );
    } catch (error: any) {
      console.error("❌ Error creating task:", error);
      Alert.alert(
        "Error",
        `Failed to create task: ${error.message || error.toString()}`
      );
    } finally {
      setCreatingTask(false);
    }
  };

  // ✅ NEW: Handler for preview confirmation
  const handlePreviewConfirm = async () => {
    if (!pendingTaskData) return;
    
    setShowPreviewModal(false);
    setCreatingTask(true);
    
    try {
      // Convert preview items to initial lines format
      const initialLines = previewItems.map((item, index) => ({
        item_code: item.item_code,
        bin_location: pendingTaskData.binCodeUpper,
        expected_qty: item.qty || 0,
        actual_qty: 0,
        counted_qty: 0,
        carton_id: item.carton_id || null, // Carton ID from backend response, if any
      }));
      
      // Proceed with task creation using preview items
      await proceedWithTaskCreationInternal(
        pendingTaskData.binCodeUpper,
        pendingTaskData.countDate,
        pendingTaskData.createdBy,
        pendingTaskData.generatedTitle,
        initialLines
      );
    } catch (error: any) {
      console.error("❌ Error confirming preview:", error);
      Alert.alert(
        "Error",
        `Failed to create task: ${error.message || error.toString()}`
      );
      setCreatingTask(false);
    }
  };

  // ✅ NEW: Handler for preview cancellation
  const handlePreviewCancel = () => {
    setShowPreviewModal(false);
    setPreviewItems([]);
    setPendingTaskData(null);
    setCreatingTask(false);
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Cycle Count</Text>
        <Text style={styles.headerSubtitle}>Bin-Based Fast Scanning</Text>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionsSection}>
        <TouchableOpacity
          style={[styles.actionButton, styles.primaryButton]}
          onPress={handleStartDirectedCount}
        >
          <Text style={styles.actionButtonIcon}>📋</Text>
          <Text style={styles.actionButtonText}>Start Directed Count</Text>
          <Text style={styles.actionButtonSubtext}>
            Count assigned bins from plan
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.secondaryButton]}
          onPress={handleStartAdhocCount}
        >
          <Text style={styles.actionButtonIcon}>🔍</Text>
          <Text style={styles.actionButtonText}>Start Ad-hoc Count</Text>
          <Text style={styles.actionButtonSubtext}>
            Scan any bin to count
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.infoButton]}
          onPress={handleViewDrafts}
        >
          <Text style={styles.actionButtonIcon}>📝</Text>
          <Text style={styles.actionButtonText}>My Drafts</Text>
          <Text style={styles.actionButtonSubtext}>
            {stats.draftSessions} draft session(s)
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.historyButton]}
          onPress={handleViewHistory}
        >
          <Text style={styles.actionButtonIcon}>📤</Text>
          <Text style={styles.actionButtonText}>Pushed / History</Text>
          <Text style={styles.actionButtonSubtext}>
            {stats.pushedSessions} pushed session(s) — re-push or sync stock
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.createButton]}
          onPress={handleCreateTask}
        >
          <Text style={styles.actionButtonIcon}>➕</Text>
          <Text style={styles.actionButtonText}>Create Task</Text>
          <Text style={styles.actionButtonSubtext}>
            Create new cycle count task
          </Text>
        </TouchableOpacity>
      </View>

      {/* Summary Cards */}
      <View style={styles.summarySection}>
        <Text style={styles.sectionTitle}>Summary</Text>

        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{stats.pendingBins}</Text>
            <Text style={styles.summaryLabel}>Pending Bins</Text>
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{stats.completedToday}</Text>
            <Text style={styles.summaryLabel}>Completed Today</Text>
          </View>

          <TouchableOpacity
            style={styles.summaryCard}
            onPress={handleViewVariances}
          >
            <Text style={[styles.summaryValue, styles.varianceValue]}>
              {stats.variancesPendingApproval}
            </Text>
            <Text style={styles.summaryLabel}>Variances Pending</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Sync Status */}
      <View style={styles.syncSection}>
        <Text style={styles.sectionTitle}>Sync Status</Text>
        <View style={styles.syncCard}>
          <Text style={styles.syncText}>🟢 Online</Text>
          <Text style={styles.syncSubtext}>All data synced</Text>
        </View>
      </View>

      {/* Removed Mock Data Info - data should come from backend sync */}

      {/* Create Task Modal */}
      <Modal
        visible={showCreateTaskModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCreateTaskModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create Cycle Count Task</Text>

            <Text style={styles.modalLabel}>Bin Code *</Text>
            <TextInput
              style={styles.modalInput}
              value={taskForm.bin_code}
              onChangeText={(text) =>
                setTaskForm({ ...taskForm, bin_code: text.toUpperCase() })
              }
              placeholder="Enter bin code (e.g., A1-R01-L1-B1)"
              autoCapitalize="characters"
              autoFocus={true}
            />

            <Text style={styles.modalLabel}>Warehouse ID</Text>
            <TouchableOpacity
              style={styles.modalInput}
              onPress={() => setShowWarehousePicker(true)}
            >
              <Text style={[styles.modalInputText, !taskForm.warehouse_id && styles.modalInputPlaceholder]}>
                {taskForm.warehouse_id || "Select warehouse..."}
              </Text>
              <Text style={styles.modalInputArrow}>▼</Text>
            </TouchableOpacity>
            
            {/* Warehouse Picker Modal */}
            <Modal
              visible={showWarehousePicker}
              animationType="slide"
              transparent={true}
              onRequestClose={() => setShowWarehousePicker(false)}
            >
              <View style={styles.pickerOverlay}>
                <View style={styles.pickerContent}>
                  <View style={styles.pickerHeader}>
                    <Text style={styles.pickerTitle}>Select Warehouse</Text>
                    <TouchableOpacity
                      onPress={() => setShowWarehousePicker(false)}
                      style={styles.pickerCloseButton}
                    >
                      <Text style={styles.pickerCloseText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <FlatList
                    data={warehouses}
                    keyExtractor={(item) => item.code}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={[
                          styles.pickerItem,
                          taskForm.warehouse_id === item.code && styles.pickerItemSelected,
                        ]}
                        onPress={() => {
                          setTaskForm({ ...taskForm, warehouse_id: item.code });
                          setShowWarehousePicker(false);
                        }}
                      >
                        <Text
                          style={[
                            styles.pickerItemText,
                            taskForm.warehouse_id === item.code && styles.pickerItemTextSelected,
                          ]}
                        >
                          {item.code}
                        </Text>
                        <Text
                          style={[
                            styles.pickerItemSubtext,
                            taskForm.warehouse_id === item.code && styles.pickerItemSubtextSelected,
                          ]}
                        >
                          {item.name || item.code} ({item.warehouse_type})
                        </Text>
                      </TouchableOpacity>
                    )}
                    ListEmptyComponent={
                      <View style={styles.pickerEmpty}>
                        <Text style={styles.pickerEmptyText}>
                          No warehouses found. Please sync master data.
                        </Text>
                      </View>
                    }
                  />
                </View>
              </View>
            </Modal>

            <Text style={styles.modalLabel}>Count Type</Text>
            <View style={styles.modalRow}>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  taskForm.count_type === "Directed" && styles.modalButtonActive,
                ]}
                onPress={() =>
                  setTaskForm({ ...taskForm, count_type: "Directed" })
                }
              >
                <Text
                  style={[
                    styles.modalButtonText,
                    taskForm.count_type === "Directed" &&
                      styles.modalButtonTextActive,
                  ]}
                >
                  Directed
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  taskForm.count_type === "Adhoc" && styles.modalButtonActive,
                ]}
                onPress={() =>
                  setTaskForm({ ...taskForm, count_type: "Adhoc" })
                }
              >
                <Text
                  style={[
                    styles.modalButtonText,
                    taskForm.count_type === "Adhoc" &&
                      styles.modalButtonTextActive,
                  ]}
                >
                  Ad-hoc
                </Text>
              </TouchableOpacity>
            </View>

            {/* ✅ NEW: Opening Stock Toggle */}
            <View style={styles.modalRow}>
              <TouchableOpacity
                style={[
                  styles.modalCheckbox,
                  taskForm.opening_stock && styles.modalCheckboxActive,
                ]}
                onPress={() =>
                  setTaskForm({
                    ...taskForm,
                    opening_stock: !taskForm.opening_stock,
                  })
                }
              >
                <Text style={styles.modalCheckboxText}>
                  {taskForm.opening_stock ? "✓" : ""}
                </Text>
              </TouchableOpacity>
              <Text
                style={styles.modalCheckboxLabel}
                onPress={() =>
                  setTaskForm({
                    ...taskForm,
                    opening_stock: !taskForm.opening_stock,
                  })
                }
              >
                Opening Stock (initial/baseline count)
              </Text>
            </View>


            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalActionButton, styles.modalCancelButton]}
                onPress={() => setShowCreateTaskModal(false)}
                disabled={creatingTask}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalActionButton, styles.modalSubmitButton]}
                onPress={handleCreateTaskSubmit}
                disabled={creatingTask}
              >
                {creatingTask ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.modalSubmitButtonText}>Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ✅ NEW: Preview Modal - Shows expected items before creating task */}
      <Modal
        visible={showPreviewModal}
        transparent={true}
        animationType="slide"
        onRequestClose={handlePreviewCancel}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Expected Items Preview</Text>
            <View style={styles.previewSummary}>
              <Text style={styles.previewSummaryText}>
                Found {previewItems.length} expected item(s) for bin{" "}
                <Text style={styles.previewSummaryHighlight}>
                  {pendingTaskData?.binCodeUpper || taskForm.bin_code}
                </Text>
              </Text>
              <Text style={styles.previewInfoText}>
                {previewItems.length > 0
                  ? "Items will be available for counting once the task is created."
                  : "No expected items found. You can still create the task and count items manually."}
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalActionButton, styles.modalCancelButton]}
                onPress={handlePreviewCancel}
                disabled={creatingTask}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalActionButton, styles.modalSubmitButton]}
                onPress={handlePreviewConfirm}
                disabled={creatingTask}
              >
                {creatingTask ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.modalSubmitButtonText}>Create Task</Text>
                )}
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
    backgroundColor: "#F5F5F5",
  },
  header: {
    backgroundColor: "#9C27B0",
    padding: 24,
    paddingTop: 40,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#FFF",
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: "#E1BEE7",
  },
  actionsSection: {
    padding: 16,
    gap: 12,
  },
  actionButton: {
    backgroundColor: "#FFF",
    padding: 20,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  primaryButton: {
    borderLeftWidth: 4,
    borderLeftColor: "#9C27B0",
  },
  secondaryButton: {
    borderLeftWidth: 4,
    borderLeftColor: "#2196F3",
  },
  infoButton: {
    borderLeftWidth: 4,
    borderLeftColor: "#FF9800",
  },
  historyButton: {
    borderLeftWidth: 4,
    borderLeftColor: "#4CAF50",
  },
  createButton: {
    borderLeftWidth: 4,
    borderLeftColor: "#4CAF50",
  },
  actionButtonIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  actionButtonText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  actionButtonSubtext: {
    fontSize: 14,
    color: "#666",
  },
  summarySection: {
    padding: 16,
    paddingTop: 0,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 12,
  },
  summaryGrid: {
    flexDirection: "row",
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  summaryValue: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#9C27B0",
    marginBottom: 4,
  },
  varianceValue: {
    color: "#FF9800",
  },
  summaryLabel: {
    fontSize: 12,
    color: "#666",
    textAlign: "center",
  },
  syncSection: {
    padding: 16,
    paddingTop: 0,
  },
  syncCard: {
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  syncText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#4CAF50",
    marginBottom: 4,
  },
  syncSubtext: {
    fontSize: 14,
    color: "#666",
  },
  infoSection: {
    padding: 16,
    paddingTop: 0,
  },
  infoCard: {
    backgroundColor: "#E3F2FD",
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#2196F3",
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1976D2",
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: "#333",
    marginBottom: 4,
  },
  infoSubtext: {
    fontSize: 12,
    color: "#666",
    marginTop: 8,
    fontStyle: "italic",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 24,
    width: "90%",
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 20,
  },
  modalLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
    marginTop: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#DDD",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#FFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalInputText: {
    fontSize: 16,
    color: "#333",
    flex: 1,
  },
  modalInputPlaceholder: {
    color: "#999",
  },
  modalInputArrow: {
    fontSize: 12,
    color: "#666",
    marginLeft: 8,
  },
  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    gap: 12,
  },
  modalButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#DDD",
    alignItems: "center",
    backgroundColor: "#FFF",
  },
  modalButtonActive: {
    backgroundColor: "#9C27B0",
    borderColor: "#9C27B0",
  },
  modalButtonText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "600",
  },
  modalButtonTextActive: {
    color: "#FFF",
  },
  modalCheckbox: {
    width: 24,
    height: 24,
    borderWidth: 2,
    borderColor: "#DDD",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF",
  },
  modalCheckboxActive: {
    backgroundColor: "#9C27B0",
    borderColor: "#9C27B0",
  },
  modalCheckboxText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  modalCheckboxLabel: {
    fontSize: 14,
    color: "#333",
    flex: 1,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
  },
  modalActionButton: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  modalCancelButton: {
    backgroundColor: "#F5F5F5",
  },
  modalCancelButtonText: {
    color: "#666",
    fontSize: 16,
    fontWeight: "600",
  },
  modalSubmitButton: {
    backgroundColor: "#9C27B0",
  },
  modalSubmitButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  pickerContent: {
    backgroundColor: "#FFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "70%",
    paddingBottom: 20,
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#EEE",
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
  },
  pickerCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F5F5F5",
    alignItems: "center",
    justifyContent: "center",
  },
  pickerCloseText: {
    fontSize: 18,
    color: "#666",
  },
  pickerItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F5F5F5",
  },
  pickerItemSelected: {
    backgroundColor: "#E1BEE7",
  },
  pickerItemText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 4,
  },
  pickerItemTextSelected: {
    color: "#9C27B0",
  },
  pickerItemSubtext: {
    fontSize: 14,
    color: "#666",
  },
  pickerItemSubtextSelected: {
    color: "#7B1FA2",
  },
  pickerEmpty: {
    padding: 32,
    alignItems: "center",
  },
  pickerEmptyText: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
  },
  // ✅ NEW: Preview Modal Styles
  modalSubtitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
  },
  modalHint: {
    fontSize: 12,
    color: "#999",
    marginTop: 4,
    marginBottom: 12,
    fontStyle: "italic",
  },
  previewSummary: {
    padding: 20,
    backgroundColor: "#F9F9F9",
    borderRadius: 12,
    marginVertical: 16,
    alignItems: "center",
  },
  previewSummaryText: {
    fontSize: 16,
    color: "#333",
    textAlign: "center",
    marginBottom: 12,
    lineHeight: 24,
  },
  previewSummaryHighlight: {
    fontWeight: "600",
    color: "#9C27B0",
  },
  previewInfoText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
    fontStyle: "italic",
  },
});

