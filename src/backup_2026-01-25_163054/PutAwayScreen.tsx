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
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useApp } from "../context/AppContext";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { StatusBadge } from "../components/StatusBadge";
import { ProgressIndicator } from "../components/ProgressIndicator";
import { dataService } from "../services/data.service";
import { apiService } from "../services/api.service";
import { addEvent, syncEvents, markEventSynced } from "../services/event-queue.service";
import { getSettings } from "../services/settings.service";
import { normalizeASN } from "../utils/asn";
import { TransferCarton } from "../types";
import { getDatabase } from "../database/database";

// Put Away workflow states
type PutAwayWorkflowState =
  | "PUTAWAY_LIST" // Step 10: List of sealed TCs ready for put away
  | "SCAN_TC_FOR_PUTAWAY" // Step 11: Scan or select TC for put away
  | "SCAN_CARTON_OR_ITEM" // Step 11b: For Transfer In - scan carton_id or item_code
  | "SCAN_LOCATION" // Step 12: Scan Location
  | "COMPLETE_PUTAWAY" // Step 13: Complete Put Away
  | "PUTAWAY_TRANSACTIONS"; // View Put Away transactions

// Put Away transaction interface
interface PutAwayTransaction {
  offline_uuid: string;
  tc_id: string;
  rack: string;
  synced: number;
  event_time: string;
  asn_no?: string;
}

export default function PutAwayScreen() {
  console.log("🔄 PutAwayScreen: Component rendered");
  const navigation = useNavigation();
  const { activeASN, activeSession, settings } = useApp();
  const [loading, setLoading] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false); // Track if putaway completion is in progress
  const [completedTCs, setCompletedTCs] = useState<Set<string>>(new Set()); // Track completed TCs
  const [locationScannedSuccessfully, setLocationScannedSuccessfully] = useState<Map<string, boolean>>(new Map()); // Track if location was successfully scanned for each TC

  // Workflow state
  const [workflowState, setWorkflowState] =
    useState<PutAwayWorkflowState>("PUTAWAY_LIST");

  // Put Away state
  const [sealedTCs, setSealedTCs] = useState<TransferCarton[]>([]);
  const [remainingItems, setRemainingItems] = useState<any[]>([]); // Items without TC that need putaway
  const [selectedTC, setSelectedTC] = useState<string | null>(null);
  const [selectedTCObj, setSelectedTCObj] = useState<TransferCarton | null>(
    null
  );
  const [putawayTask, setPutawayTask] = useState<string | null>(null); // Store putaway task from API response (deprecated - will be created on Complete)
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null); // Store location_id from scan (validated)
  // ✅ NEW: Temporary location input (before validation/submit)
  const [scannedLocationInput, setScannedLocationInput] = useState<string>(""); // Store scanned location in text input (not validated yet)
  // Keep selectedRack and selectedBin for backward compatibility and display purposes
  const [selectedRack, setSelectedRack] = useState<string | null>(null); // Store rack/location from scan (for display)
  const [selectedBin, setSelectedBin] = useState<string | null>(null); // Store bin from location scan (for display)
  
  // ✅ NEW: Validation state for validation-only workflow
  const [validatedData, setValidatedData] = useState<{
    carton_id: string | null;
    box_id: string | null;
    location_id: string | null;
    location: {
      location_id: string;
      zone: string | null;
      aisle: string | null;
      rack: string;
      level: string | null;
      bin: string;
    };
  } | null>(null);
  const [isReadyForCompletion, setIsReadyForCompletion] = useState(false); // Enable Complete button when both carton and location are validated
  const [lastTap, setLastTap] = useState<{ tcId: string; time: number } | null>(
    null
  );
  const [transactions, setTransactions] = useState<PutAwayTransaction[]>([]);
  // Transfer In putaway state
  const [selectedCartonOrItem, setSelectedCartonOrItem] = useState<string | null>(null); // For Transfer In: carton_id or item_code
  const [selectedItemCode, setSelectedItemCode] = useState<string | null>(null); // For Transfer In: item_code if loose item
  const [errorModal, setErrorModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
  } | null>(null);
  
  // ✅ Ref for Location ID TextInput to enable auto-focus
  const locationInputRef = useRef<TextInput>(null);
  
  // Source type filter for putaway tasks (ASN, TransferIn, or All)
  const [putawaySourceType, setPutawaySourceType] = useState<"ASN" | "TransferIn">("ASN");

  // Load sealed TCs for put away list
  const loadSealedTCs = useCallback(async () => {
    console.warn("🔄 PutAwayScreen: Loading warehouse TCs for putaway...", { activeASN });
    setLoading(true);
    try {
      const db = await getDatabase();
      if (!db) {
        console.error("❌ PutAwayScreen: Database not initialized");
        setSealedTCs([]);
        setLoading(false);
        return;
      }

      // Load all TCs with "Sealed" or "Dispatched" status (both need putaway)
      // Explicitly exclude "Completed" status to ensure completed putaways don't show
      // We'll filter by warehouse_type after loading
      const allTCs = await db.getAllAsync<TransferCarton>(
        `SELECT * FROM tc_cache 
         WHERE status IN ("Sealed", "Dispatched") 
           AND UPPER(status) != "COMPLETED" 
         ORDER BY updated_on DESC`
      );
      
      console.warn(`📦 PutAwayScreen: Found ${allTCs.length} TCs with Sealed/Dispatched status`);
      console.warn(`📦 PutAwayScreen: TC details:`, allTCs.map(tc => ({ 
        tc_id: tc.tc_id, 
        asn_no: tc.asn_no, 
        store: tc.store, 
        status: tc.status 
      })));
      
      // NEW: Also load Putaway BOXes (boxes with purpose="PUTAWAY" or box_id starts with "PAW-")
      // ✅ FIX: Also include ALL CLOSED/SEALED boxes (ASN boxes may not have purpose='PUTAWAY')
      // These boxes have BOX ID = TC ID (same identifier)
      // Include closed Putaway boxes - they should appear if they have an "Open" putaway task
      // ✅ CRITICAL: Also check tc_cache status since updateTransferCartonStatus updates tc_cache
      // For Putaway boxes, box_id = tc_id, so we need to check both tables
      const putawayBoxes = await db.getAllAsync<{
        box_id: string;
        asn_no: string;
        store: string;
        status: string;
        purpose?: string;
        updated_on: string;
        tc_status?: string; // Status from tc_cache
      }>(
        `SELECT 
          b.box_id, 
          b.asn_no, 
          b.store, 
          COALESCE(t.status, b.status) as status, 
          b.purpose, 
          b.updated_on,
          t.status as tc_status
         FROM box_cache b
         LEFT JOIN tc_cache t ON b.box_id = t.tc_id
         WHERE b.status IN ('Closed', 'CLOSED', 'closed', 'Sealed', 'SEALED', 'sealed')
           AND COALESCE(t.status, b.status) != 'Completed'
           AND UPPER(COALESCE(t.status, b.status)) != 'COMPLETED'
           AND COALESCE(t.status, b.status) != 'Closed'
           AND UPPER(COALESCE(t.status, b.status)) != 'CLOSED'
         ORDER BY b.updated_on DESC`
      );
      
      console.warn(`📦 PutAwayScreen: Found ${putawayBoxes.length} CLOSED/SEALED boxes from box_cache`);
      console.warn(`📦 PutAwayScreen: Box details:`, putawayBoxes.map(box => ({ 
        box_id: box.box_id, 
        asn_no: box.asn_no, 
        store: box.store, 
        status: box.status,
        purpose: box.purpose || '(null)'
      })));
      
      // Convert Putaway boxes to TransferCarton format (BOX ID = TC ID)
      // Include both Closed and Sealed Putaway boxes - they should appear if they have an "Open" putaway task
      // ✅ Use status from tc_cache if available (more up-to-date), otherwise use box_cache status
      const putawayTCs: TransferCarton[] = putawayBoxes
        .filter(box => {
          // Status is already filtered by SQL query (excludes Completed and Closed from tc_cache)
          // But double-check here for safety
          // Note: box.status can be "Closed" (box is closed, ready for putaway), but tc_status should not be "Closed" (task is closed)
          const boxStatus = (box.status || "").toUpperCase();
          const tcStatus = (box.tc_status || "").toUpperCase();
          const isCompleted = boxStatus === "COMPLETED" || tcStatus === "COMPLETED";
          const isTaskClosed = tcStatus === "CLOSED"; // Task status is closed (not box status)
          
          if (isCompleted || isTaskClosed) {
            console.warn(`⚠️ PutAwayScreen: Skipped box ${box.box_id} - status is ${box.status}, tc_status is ${box.tc_status || 'N/A'}`);
            return false;
          }
          // Include closed or sealed Putaway boxes (will be filtered by putaway task status later)
          // Box can be "Closed" (ready for putaway), but task should be "Open"
          return boxStatus === "CLOSED" || boxStatus === "SEALED";
        })
        .map(box => ({
          tc_id: box.box_id, // BOX ID = TC ID
          asn_no: box.asn_no,
          to_no: null,
          store: box.store,
          // Use status from query (which prioritizes tc_cache status via COALESCE)
          status: box.status === "Sealed" || box.status === "SEALED" ? "Sealed" : "Closed",
          updated_on: box.updated_on,
        }));
      
      // ✅ FIX: Load backend tasks FIRST before filtering
      // This ensures we can check for backend tasks when filtering TCs with PUTAWAY_TO_RACK events
      // PRIORITY: Load putaway tasks from backend API
      // Backend creates putaway tasks when boxes are closed (ASN) or Transfer In items are received
      const backendPutawayTasks: TransferCarton[] = [];
      const backendTaskIds = new Set<string>(); // Track IDs for quick lookup
      const normalizeId = (id: string | null | undefined): string => {
        if (!id) return "";
        return String(id).trim().toUpperCase();
      };
      
      try {
        const settings = await getSettings();
        if (settings.api_url && settings.demo_mode !== 1) {
          // Load ASN putaway tasks (if filter allows)
          // ✅ For "ASN" tab, fetch ASN tasks
          if (putawaySourceType === "ASN") {
            // Get open putaway tasks from backend for ASN only
            let putawayTasksResponse: any = null;
            try {
              putawayTasksResponse = await apiService.getPutawayTasks({
                status: "Draft,Open,In Progress", // ✅ Include Open status for ASN putaway tasks (same as Transfer In)
                source_type: "ASN",
                asn_no: activeASN || undefined,
              });
            } catch (tasksError: any) {
              // Check if error is about source_type (expected - backend may not support it)
              const errorMessage = tasksError.message || "";
              const errorDetails = tasksError.details || "";
              const errorCode = tasksError.code || "";
              const fullError = `${errorMessage} ${errorDetails} ${errorCode}`.toLowerCase();
              
              // Check if this is a network error (server unreachable, connection failed, etc.)
              const isNetworkError = 
                errorMessage.includes("Network request failed") ||
                errorMessage.includes("Network error") ||
                errorMessage.includes("Failed to connect") ||
                errorMessage.includes("ECONNREFUSED") ||
                errorMessage.includes("ENOTFOUND") ||
                errorMessage.includes("timeout") ||
                tasksError.name === "TypeError" && errorMessage.includes("fetch");
              
              if (isNetworkError) {
                // Network error - backend is not reachable, app will work in offline mode
                console.warn(`ℹ️ PutAwayScreen: Backend server not reachable - working in offline mode with local data`);
                console.warn(`   Network error: ${errorMessage}`);
                console.warn(`   This is normal if the backend server is not running or network is unavailable.`);
                // Continue with local database fallback - no need to retry
              } else if (
                  fullError.includes("source_type") || 
                  fullError.includes("unknown column") ||
                  fullError.includes("pt.source_type") ||
                  fullError.includes("er_bad_field_error") ||
                  (errorCode === "DATABASE_ERROR" && fullError.includes("source_type"))
              ) {
                // Backend doesn't support source_type column - fetch all tasks and filter client-side
                console.warn(`ℹ️ PutAwayScreen: Backend doesn't support source_type column - fetching all tasks and filtering client-side`);
                try {
                  // Try with minimal filters first (just status)
                  putawayTasksResponse = await apiService.getPutawayTasks({
                    status: "Draft,Open,In Progress", // ✅ Include Open status for ASN putaway tasks (same as Transfer In)
                  });
                  
                  // Parse response
                  let allTasksList: any[] = [];
                  if (Array.isArray(putawayTasksResponse)) {
                    allTasksList = putawayTasksResponse;
                  } else if (putawayTasksResponse?.data && Array.isArray(putawayTasksResponse.data)) {
                    allTasksList = putawayTasksResponse.data;
                  } else if (putawayTasksResponse?.tasks && Array.isArray(putawayTasksResponse.tasks)) {
                    allTasksList = putawayTasksResponse.tasks;
                  }
                  
                  // Filter client-side for ASN tasks (check for asn_no or advance_shipping_notice, and NOT transfer_in)
                  // ✅ CRITICAL: Explicitly exclude Completed and Closed tasks
                  const asnTasksList = allTasksList.filter((t: any) => {
                    const taskStatus = (t.status || "").toUpperCase();
                    const isCompleted = taskStatus === "COMPLETED";
                    const isClosed = taskStatus === "CLOSED";
                    
                    // ✅ Filter out completed and closed tasks
                    if (isCompleted || isClosed) {
                      return false;
                    }
                    
                    // ✅ Include only Draft, Open, or In Progress status (same as Transfer In)
                    const isDraftOpenOrInProgress = taskStatus === "DRAFT" || taskStatus === "OPEN" || taskStatus === "IN PROGRESS" || taskStatus === "INPROGRESS";
                    if (!isDraftOpenOrInProgress) {
                      return false;
                    }
                    
                    // ASN tasks have asn_no or advance_shipping_notice (not transfer_in)
                    const hasASN = (t.asn_no || t.advance_shipping_notice) && !t.transfer_in;
                    // Or explicitly marked as ASN source type
                    const isASNSource = t.source_type === "ASN";
                    return hasASN || isASNSource;
                  });
                  
                  // Update response to filtered list
                  if (Array.isArray(putawayTasksResponse)) {
                    putawayTasksResponse = asnTasksList;
                  } else if (putawayTasksResponse?.data) {
                    putawayTasksResponse.data = asnTasksList;
                  } else if (putawayTasksResponse?.tasks) {
                    putawayTasksResponse.tasks = asnTasksList;
                  } else {
                    putawayTasksResponse = asnTasksList;
                  }
                  
                  console.warn(`ℹ️ PutAwayScreen: Filtered ${asnTasksList.length} ASN tasks from ${allTasksList.length} total tasks`);
                } catch (retryError: any) {
                  const retryErrorMessage = retryError.message || "";
                  const retryErrorDetails = retryError.details || {};
                  const retryFullError = `${retryErrorMessage} ${JSON.stringify(retryErrorDetails)}`.toLowerCase();
                  
                  const isRetryNetworkError = 
                    retryErrorMessage.includes("Network request failed") ||
                    retryErrorMessage.includes("Network error");
                  
                  // Check if this is a whereClause error (backend query construction issue)
                  const isWhereClauseError = 
                    retryErrorMessage.includes("whereClause") ||
                    retryErrorMessage.includes("where clause") ||
                    retryFullError.includes("whereclause");
                  
                  if (isRetryNetworkError) {
                    console.warn(`ℹ️ PutAwayScreen: Backend server not reachable - working in offline mode`);
                  } else if (isWhereClauseError) {
                    // Backend has a query construction issue - try with no filters at all
                    console.warn(`ℹ️ PutAwayScreen: Backend query construction issue - trying with no filters`);
                    try {
                      const allTasksNoFilters = await apiService.getPutawayTasks({});
                      let allTasksListNoFilters: any[] = [];
                      if (Array.isArray(allTasksNoFilters)) {
                        allTasksListNoFilters = allTasksNoFilters;
                      } else if (allTasksNoFilters?.data && Array.isArray(allTasksNoFilters.data)) {
                        allTasksListNoFilters = allTasksNoFilters.data;
                      } else if (allTasksNoFilters?.tasks && Array.isArray(allTasksNoFilters.tasks)) {
                        allTasksListNoFilters = allTasksNoFilters.tasks;
                      }
                      
                      // Filter by status and ASN client-side
                      // ✅ CRITICAL: Explicitly exclude Completed and Closed tasks
                      const filteredTasks = allTasksListNoFilters.filter((t: any) => {
                        const taskStatus = (t.status || "").toUpperCase();
                        const isCompleted = taskStatus === "COMPLETED";
                        const isClosed = taskStatus === "CLOSED";
                        
                        // ✅ Filter out completed and closed tasks
                        if (isCompleted || isClosed) {
                          return false;
                        }
                        
                        // ✅ Include Open status for ASN putaway tasks (same as Transfer In)
                        const isDraftOpenOrInProgress = taskStatus === "DRAFT" || taskStatus === "OPEN" || taskStatus === "IN PROGRESS" || taskStatus === "INPROGRESS";
                        const hasASN = (t.asn_no || t.advance_shipping_notice) && !t.transfer_in;
                        
                        if (activeASN && hasASN) {
                          const taskASN = t.asn_no || t.advance_shipping_notice;
                          const matchesASN = taskASN && (
                            taskASN.toUpperCase().trim() === activeASN.toUpperCase().trim() ||
                            taskASN.toUpperCase().trim().includes(activeASN.toUpperCase().trim())
                          );
                          return isDraftOrInProgress && hasASN && matchesASN;
                        }
                        
                        return isDraftOrInProgress && hasASN;
                      });
                      
                      putawayTasksResponse = filteredTasks;
                      console.warn(`ℹ️ PutAwayScreen: Filtered ${filteredTasks.length} ASN tasks from ${allTasksListNoFilters.length} total tasks (no backend filters)`);
                    } catch (finalError: any) {
                      console.warn(`⚠️ Error fetching putaway tasks even without filters:`, finalError.message);
                    }
                  } else {
                    console.warn(`⚠️ Error fetching putaway tasks from backend:`, retryError.message);
                  }
                }
              } else if (tasksError.message?.includes("404") || tasksError.message?.includes("not found")) {
                console.warn(`⚠️ Putaway tasks API endpoint not available (404) - backend may not be implemented yet`);
              } else {
                console.warn(`⚠️ Error fetching putaway tasks from backend:`, tasksError.message);
              }
            }
          
            // Parse response
            let tasksList: any[] = [];
            if (Array.isArray(putawayTasksResponse)) {
              tasksList = putawayTasksResponse;
            } else if (putawayTasksResponse?.data && Array.isArray(putawayTasksResponse.data)) {
              tasksList = putawayTasksResponse.data;
            } else if (putawayTasksResponse?.tasks && Array.isArray(putawayTasksResponse.tasks)) {
              tasksList = putawayTasksResponse.tasks;
            }
            
            // ✅ Process ASN tasks (Transfer In tasks are processed separately)
            // ✅ Process ASN tasks only (Transfer In tasks are processed separately)
            // Convert backend putaway tasks to TransferCarton format
            for (const task of tasksList) {
              // ✅ Filter to only process ASN tasks
              const hasASN = (task.asn_no || task.advance_shipping_notice) && !task.transfer_in;
              const isASNSource = task.source_type === "ASN";
              if (!hasASN && !isASNSource) {
                // This is not an ASN task, skip it (will be processed in Transfer In loop)
                continue;
              }
              const taskId = task.putaway_task || task.task_title || task.id || task.task_id;
              let boxId = task.box_id;
              let tcId = task.tc_id;
              const asnNo = task.asn_no || task.advance_shipping_notice;
              
              // ✅ FIX: If box_id/tc_id not in task header, try to get from task lines
              if ((!boxId && !tcId) && task.lines && Array.isArray(task.lines) && task.lines.length > 0) {
                // Get box_id or carton_id from first line (all lines should have same box/carton)
                const firstLine = task.lines[0];
                boxId = firstLine.box_id || firstLine.carton_id || null;
                tcId = firstLine.tc_id || null;
                if (boxId || tcId) {
                  console.warn(`✅ PutAwayScreen: Found box_id/tc_id from task lines for task ${taskId}: box_id=${boxId}, tc_id=${tcId}`);
                }
              }
              
              // ✅ FIX: If still no box_id/tc_id, check if task has lines with carton_id that can be used
              // Some backends return carton_id in lines but not box_id/tc_id in header
              if ((!boxId && !tcId) && task.lines && Array.isArray(task.lines)) {
                // Try to find any line with carton_id or box_id
                for (const line of task.lines) {
                  if (line.carton_id && !boxId && !tcId) {
                    // Use carton_id as box_id for putaway
                    boxId = line.carton_id;
                    console.warn(`✅ PutAwayScreen: Using carton_id from line as box_id for task ${taskId}: ${boxId}`);
                    break;
                  }
                  if (line.box_id && !boxId) {
                    boxId = line.box_id;
                    console.warn(`✅ PutAwayScreen: Found box_id from line for task ${taskId}: ${boxId}`);
                    break;
                  }
                }
              }
              
              // ✅ FIX: Allow tasks without box_id/tc_id to be displayed
              // Use task ID as identifier if no box_id/tc_id is available
              // This ensures tasks are shown even if they don't have a box/TC assigned yet
              if (!boxId && !tcId) {
                console.warn(`⚠️ PutAwayScreen: Task ${taskId} (ASN: ${asnNo}) has no box_id or tc_id - will use task ID as identifier`);
                console.warn(`   Task structure:`, {
                  has_box_id: !!task.box_id,
                  has_tc_id: !!task.tc_id,
                  has_lines: !!(task.lines && Array.isArray(task.lines)),
                  lines_count: task.lines && Array.isArray(task.lines) ? task.lines.length : 0,
                  first_line_keys: task.lines && Array.isArray(task.lines) && task.lines.length > 0 ? Object.keys(task.lines[0]) : [],
                });
                // Continue processing - we'll use taskId as the identifier
              }
              
              // Process task (with or without box_id/tc_id)
              {
                // Check task status - include Draft, Open, and In Progress tasks
                // ✅ CRITICAL: Explicitly exclude Completed and Closed tasks (same as Transfer In)
                const taskStatus = (task.status || "").toUpperCase();
                const isCompleted = taskStatus === "COMPLETED";
                const isClosed = taskStatus === "CLOSED";
                
                // ✅ Filter out completed and closed tasks
                if (isCompleted || isClosed) {
                  console.warn(`⚠️ PutAwayScreen: Skipped ASN putaway task ${taskId} - status is "${task.status}"`);
                  continue;
                }
                
                const isDraft = taskStatus === "DRAFT";
                const isOpen = taskStatus === "OPEN";
                const isInProgress = taskStatus === "IN PROGRESS" || taskStatus === "INPROGRESS";
                
                // Only include Draft, Open, or In Progress tasks
                if (!isDraft && !isOpen && !isInProgress) {
                  console.warn(`⚠️ PutAwayScreen: Skipped ASN putaway task ${taskId} - status is "${task.status}" (expected "Draft", "Open", or "In Progress")`);
                  continue;
                }
                
                const tcObj: TransferCarton = {
                  tc_id: tcId || boxId || taskId, // Use tc_id if available, otherwise box_id, otherwise taskId
                  asn_no: asnNo,
                  to_no: null,
                  store: task.store || null,
                  status: "Closed", // Box status is Closed, but putaway task is Open
                  updated_on: task.updated_on || task.created_on || new Date().toISOString(),
                };
                
                // Store putaway_task for later use
                (tcObj as any).putaway_task = taskId;
                (tcObj as any).box_id = boxId;
                (tcObj as any).putaway_task_status = task.status; // Store task status
                // ✅ Mark if this is a task-only entry (no box_id/tc_id)
                (tcObj as any).is_task_only = !boxId && !tcId;
                
                // Store header-level location_id from backend (NEW: API now returns location_id at header level)
                if (task.location_id) {
                  (tcObj as any).location_id = task.location_id;
                  console.warn(`✅ PutAwayScreen: Task ${taskId} has header-level location_id: ${task.location_id}`);
                }
                
                backendPutawayTasks.push(tcObj);
                // Track both box_id and tc_id for matching
                const normalizedBoxId = normalizeId(boxId);
                const normalizedTCId = normalizeId(tcId);
                if (normalizedBoxId) backendTaskIds.add(normalizedBoxId);
                if (normalizedTCId) backendTaskIds.add(normalizedTCId);
                console.warn(`✅ PutAwayScreen: Added backend putaway task ${taskId} (box_id: ${boxId}, tc_id: ${tcId}, task_status: ${task.status}, location_id: ${task.location_id || 'N/A'})`);
              }
            }
            
            // ✅ FIX: If no tasks found with ASN filter and activeASN is set, try fetching all tasks
            // This handles cases where ASN format doesn't match exactly
            if (backendPutawayTasks.length === 0 && activeASN) {
              console.warn(`⚠️ PutAwayScreen: No tasks found with ASN filter, trying to fetch all tasks and filter client-side`);
              try {
                const allTasksResponse = await apiService.getPutawayTasks({
                  status: "Draft,Open,In Progress",
                });
                
                let allTasksList: any[] = [];
                if (Array.isArray(allTasksResponse)) {
                  allTasksList = allTasksResponse;
                } else if (allTasksResponse?.data && Array.isArray(allTasksResponse.data)) {
                  allTasksList = allTasksResponse.data;
                } else if (allTasksResponse?.tasks && Array.isArray(allTasksResponse.tasks)) {
                  allTasksList = allTasksResponse.tasks;
                }
                
                // Filter for tasks matching the active ASN
                const activeASNUpper = activeASN.toUpperCase().trim();
                const matchingTasks = allTasksList.filter((t: any) => {
                  const taskStatus = (t.status || "").toUpperCase();
                  if (taskStatus === "COMPLETED" || taskStatus === "CLOSED") return false;
                  if (taskStatus !== "DRAFT" && taskStatus !== "OPEN" && taskStatus !== "IN PROGRESS" && taskStatus !== "INPROGRESS") return false;
                  
                  const taskASN = (t.asn_no || t.advance_shipping_notice || "").toUpperCase().trim();
                  const normalizedTaskASN = taskASN.replace(/[^A-Z0-9]/g, "");
                  const normalizedActiveASN = activeASNUpper.replace(/[^A-Z0-9]/g, "");
                  
                  return taskASN === activeASNUpper || 
                         taskASN.includes(activeASNUpper) || 
                         activeASNUpper.includes(taskASN) ||
                         normalizedTaskASN === normalizedActiveASN ||
                         normalizedTaskASN.includes(normalizedActiveASN) ||
                         normalizedActiveASN.includes(normalizedTaskASN);
                });
                
                console.warn(`✅ PutAwayScreen: Found ${matchingTasks.length} matching task(s) from all tasks (ASN: ${activeASN})`);
                
                // Process matching tasks
                for (const task of matchingTasks) {
                  const taskId = task.putaway_task || task.task_title || task.id || task.task_id;
                  let boxId = task.box_id;
                  let tcId = task.tc_id;
                  
                  // Check task lines for box_id/tc_id
                  if ((!boxId && !tcId) && task.lines && Array.isArray(task.lines) && task.lines.length > 0) {
                    const firstLine = task.lines[0];
                    boxId = firstLine.box_id || firstLine.carton_id || null;
                    tcId = firstLine.tc_id || null;
                  }
                  
                  if (!boxId && !tcId && task.lines && Array.isArray(task.lines)) {
                    for (const line of task.lines) {
                      if (line.carton_id && !boxId && !tcId) {
                        boxId = line.carton_id;
                        break;
                      }
                      if (line.box_id && !boxId) {
                        boxId = line.box_id;
                        break;
                      }
                    }
                  }
                  
                  const taskStatus = (task.status || "").toUpperCase();
                  const isCompleted = taskStatus === "COMPLETED";
                  const isClosed = taskStatus === "CLOSED";
                  if (isCompleted || isClosed) continue;
                  
                  const isDraft = taskStatus === "DRAFT";
                  const isOpen = taskStatus === "OPEN";
                  const isInProgress = taskStatus === "IN PROGRESS" || taskStatus === "INPROGRESS";
                  if (!isDraft && !isOpen && !isInProgress) continue;
                  
                  const tcObj: TransferCarton = {
                    tc_id: tcId || boxId || taskId,
                    asn_no: task.asn_no || task.advance_shipping_notice,
                    to_no: null,
                    store: task.store || null,
                    status: "Closed",
                    updated_on: task.updated_on || task.created_on || new Date().toISOString(),
                  };
                  
                  (tcObj as any).putaway_task = taskId;
                  (tcObj as any).box_id = boxId;
                  (tcObj as any).putaway_task_status = task.status;
                  (tcObj as any).is_task_only = !boxId && !tcId;
                  
                  if (task.location_id) {
                    (tcObj as any).location_id = task.location_id;
                  }
                  
                  backendPutawayTasks.push(tcObj);
                  const normalizedBoxId = normalizeId(boxId);
                  const normalizedTCId = normalizeId(tcId);
                  if (normalizedBoxId) backendTaskIds.add(normalizedBoxId);
                  if (normalizedTCId) backendTaskIds.add(normalizedTCId);
                  
                  console.warn(`✅ PutAwayScreen: Added task ${taskId} from fallback fetch (box_id: ${boxId || 'N/A'}, tc_id: ${tcId || 'N/A'})`);
                }
              } catch (fallbackError: any) {
                console.warn(`⚠️ PutAwayScreen: Fallback fetch failed: ${fallbackError.message}`);
              }
            }
            
            console.warn(`✅ PutAwayScreen: Found ${backendPutawayTasks.length} ASN putaway task(s) from backend`);
          }
        }
      } catch (backendError: any) {
        console.warn(`⚠️ Error loading putaway tasks from backend (early load):`, backendError.message);
        // Continue with local database fallback
      }
      
      // Get list of TCs that have already been assigned a location (have PUTAWAY_TO_RACK events)
      // These should NOT appear in the list as they've already been scanned
      // BUT: If they have a backend putaway task, show them anyway (backend task is source of truth)
      const alreadyAssignedTCs = await db.getAllAsync<{ tc_id: string }>(
        `SELECT DISTINCT tc_id 
         FROM event_queue 
         WHERE event_type = 'PUTAWAY_TO_RACK' 
           AND tc_id IS NOT NULL 
           AND tc_id != ''`
      );
      const assignedTCSet = new Set(alreadyAssignedTCs.map(t => t.tc_id.toUpperCase()));
      console.warn(`📦 PutAwayScreen: Found ${assignedTCSet.size} TCs already assigned to locations (will be excluded unless they have backend task)`);
      
      // Filter by warehouse_type and optionally by ASN
      // Also deduplicate TCs by tc_id to prevent duplicates
      // Exclude TCs that have already been assigned a location (unless they have backend task)
      const warehouseTCs: TransferCarton[] = [];
      const seenTCIds = new Set<string>();
      
      for (const tc of allTCs) {
        // Skip if already seen (deduplication)
        if (seenTCIds.has(tc.tc_id)) {
          console.warn(`⚠️ PutAwayScreen: Skipped duplicate TC ${tc.tc_id}`);
          continue;
        }
        
        // Skip if status is Completed or Closed (shouldn't happen due to query, but double-check)
        // Make case-insensitive check to catch all variations (Completed, COMPLETED, completed, Closed, CLOSED, closed)
        const tcStatusUpper = tc.status ? tc.status.toUpperCase() : "";
        if (tcStatusUpper === "COMPLETED" || tcStatusUpper === "CLOSED") {
          console.warn(`⚠️ PutAwayScreen: Skipped TC ${tc.tc_id} (status: ${tc.status})`);
          continue;
        }
        
        // Skip if TC has already been assigned a location
        // BUT: If it has a backend putaway task, show it anyway (backend task is source of truth)
        // ✅ FIX: Check backend tasks loaded earlier (not just local TC property)
        const normalizedTCId = normalizeId(tc.tc_id);
        const hasBackendTaskInSet = backendTaskIds.has(normalizedTCId);
        const matchingBackendTask = backendPutawayTasks.find(task => {
          const taskBoxId = normalizeId((task as any).box_id);
          const taskTCId = normalizeId(task.tc_id);
          return taskBoxId === normalizedTCId || taskTCId === normalizedTCId;
        });
        const hasBackendTask = (tc as any).putaway_task || hasBackendTaskInSet || !!matchingBackendTask;
        
        // If backend task exists, copy it to local TC
        if (matchingBackendTask && !(tc as any).putaway_task) {
          (tc as any).putaway_task = (matchingBackendTask as any).putaway_task;
          (tc as any).putaway_task_status = (matchingBackendTask as any).putaway_task_status;
          if ((matchingBackendTask as any).location_id) {
            (tc as any).location_id = (matchingBackendTask as any).location_id;
          }
          console.warn(`✅ PutAwayScreen: Found backend task for TC ${tc.tc_id} - ${(matchingBackendTask as any).putaway_task}`);
        }
        
        const taskStatus = (tc as any).putaway_task_status;
        const taskStatusUpper = taskStatus ? taskStatus.toUpperCase() : "";
        const isTaskCompleted = taskStatusUpper === "COMPLETED";
        const isTaskClosed = taskStatusUpper === "CLOSED";
        
        if (assignedTCSet.has(tc.tc_id.toUpperCase()) && !hasBackendTask) {
          console.warn(`⚠️ PutAwayScreen: Skipped TC ${tc.tc_id} - already assigned to a location (no backend task). If this TC should appear, check if a backend putaway task exists.`);
          continue;
        }
        
        if (hasBackendTask && (isTaskCompleted || isTaskClosed)) {
          console.warn(`⚠️ PutAwayScreen: Skipped TC ${tc.tc_id} - putaway task is ${taskStatus}`);
          continue;
        }
        
        if (hasBackendTask && !isTaskCompleted) {
          console.warn(`ℹ️ PutAwayScreen: Including TC ${tc.tc_id} - has backend putaway task (status: ${taskStatus}) even though local event exists`);
        }
        
        // If activeASN is set, only include TCs for that ASN
        if (activeASN && tc.asn_no && tc.asn_no.toUpperCase().trim() !== activeASN.toUpperCase().trim()) {
          console.warn(`⚠️ PutAwayScreen: Skipped TC ${tc.tc_id} - ASN mismatch (TC ASN: ${tc.asn_no}, Active ASN: ${activeASN})`);
          continue; // Skip TCs that don't match active ASN
        }
        
        const isWarehouse = await dataService.isWarehouse(tc.store || "");
        if (isWarehouse) {
          warehouseTCs.push(tc);
          seenTCIds.add(tc.tc_id);
          console.warn(`✅ PutAwayScreen: Added warehouse TC ${tc.tc_id} (Store: ${tc.store}, Status: ${tc.status}, ASN: ${tc.asn_no})`);
        } else {
          console.warn(`⚠️ PutAwayScreen: Skipped non-warehouse TC ${tc.tc_id} (Store: ${tc.store}, Status: ${tc.status})`);
        }
      }
      
      // Also check for warehouse boxes that are closed but not yet packed into a TC
      // Closed warehouse boxes should appear if they have an "Open" putaway task in backend
      // Use isWarehouse function (not hardcoded values) to check if store is warehouse
      const allClosedBoxes = await db.getAllAsync<{
        box_id: string;
        asn_no: string;
        store: string;
        status: string;
        updated_on: string;
        purpose: string | null;
      }>(
        `SELECT box_id, asn_no, store, status, updated_on, purpose
         FROM box_cache 
         WHERE status = 'Closed'
           AND (purpose IS NULL OR purpose != 'PUTAWAY')
         ORDER BY updated_on DESC`
      );
      
      console.warn(`📦 PutAwayScreen: Found ${allClosedBoxes.length} closed boxes (checking warehouse status)`);
      
      // Filter to only warehouse boxes using isWarehouse function (not hardcoded)
      const warehouseBoxes: typeof allClosedBoxes = [];
      for (const box of allClosedBoxes) {
        // If activeASN is set, only include boxes for that ASN
        if (activeASN && box.asn_no && box.asn_no.toUpperCase().trim() !== activeASN.toUpperCase().trim()) {
          continue;
        }
        
        // Skip if box has already been assigned a location
        // Note: We can't check for backend task here since we're loading from box_cache
        // Backend tasks will be merged later, so we'll include boxes here and let backend tasks take priority
        if (assignedTCSet.has(box.box_id.toUpperCase())) {
          console.warn(`ℹ️ PutAwayScreen: Box ${box.box_id} has local event, but will check for backend task later`);
          // Don't skip here - let backend tasks override if they exist
        }
        
        // Check if store is warehouse using isWarehouse function (MANDATORY - no hardcoded values)
        const isWarehouse = await dataService.isWarehouse(box.store || "");
        if (isWarehouse) {
          // Check if this box is packed into a TC
          const packedIntoTC = await db.getFirstAsync<{ tc_id: string }>(
            `SELECT tc_id 
             FROM event_queue 
             WHERE event_type = 'PACK_BOX_TO_TC' 
               AND box_id = ?
             LIMIT 1`,
            [box.box_id]
          );
          
          if (!packedIntoTC) {
            // Closed warehouse box not packed into TC - should appear if it has an "Open" putaway task
            // Create a TC-like object for the box so it can be scanned
            const boxAsTC = {
              tc_id: box.box_id, // Use box_id as tc_id for warehouse boxes
              asn_no: box.asn_no,
              store: box.store,
              status: "Closed", // Box is closed, but putaway task should be "Open"
            };
            
            // Check if already in warehouseTCs (avoid duplicates)
            const exists = warehouseTCs.find(t => t.tc_id === box.box_id);
            if (!exists) {
              warehouseTCs.push(boxAsTC);
              seenTCIds.add(box.box_id);
              console.warn(`✅ PutAwayScreen: Added closed warehouse box ${box.box_id} (Store: ${box.store}, ASN: ${box.asn_no}) - will check for Open putaway task`);
            }
          } else {
            // Box is packed into a TC - check if TC is sealed/dispatched
            const tc = await db.getFirstAsync<{ status: string }>(
              `SELECT status FROM tc_cache WHERE tc_id = ?`,
              [packedIntoTC.tc_id]
            );
            
            // Skip if TC status is Completed or Closed (case-insensitive check)
            const tcStatusUpper = tc && tc.status ? tc.status.toUpperCase() : "";
            if (tcStatusUpper === "COMPLETED" || tcStatusUpper === "CLOSED") {
              console.warn(`⚠️ PutAwayScreen: Skipped box ${box.box_id} - packed into ${tc.status} TC ${packedIntoTC.tc_id}`);
              continue;
            }
            
            if (tc && (tc.status === "Sealed" || tc.status === "Dispatched")) {
              // Box is packed into a sealed/dispatched TC - the TC should appear in PutawayScreen
              // But skip if TC has already been assigned a location
              if (!assignedTCSet.has(packedIntoTC.tc_id.toUpperCase())) {
                const tcExists = warehouseTCs.find(t => t.tc_id === packedIntoTC.tc_id);
                if (!tcExists) {
                  console.warn(`⚠️ PutAwayScreen: Box ${box.box_id} is packed into TC ${packedIntoTC.tc_id} (status: ${tc.status}), but TC not found in list`);
                }
              } else {
                console.warn(`⚠️ PutAwayScreen: Box ${box.box_id} is packed into TC ${packedIntoTC.tc_id} (status: ${tc.status}), but TC already assigned to location`);
              }
            } else {
              console.warn(`⚠️ PutAwayScreen: Box ${box.box_id} is packed into TC ${packedIntoTC.tc_id} (status: ${tc?.status || 'unknown'}) - TC not sealed yet, should appear in PackingScreen`);
            }
          }
        }
      }
      
      console.warn(`📦 PutAwayScreen: Added ${warehouseBoxes.length} closed warehouse boxes to putaway list`);
      
      // ✅ NEW: Fetch completed tasks BEFORE filtering boxes
      // This ensures we filter out boxes even if their tasks weren't in the "Open" tasks list
      // Fetch for ALL ASNs, not just activeASN, to catch all completed boxes
      let completedTaskBoxIds = new Set<string>();
      try {
        const settings = await getSettings();
        if (settings.api_url && settings.demo_mode !== 1) {
          try {
            // Fetch completed and closed tasks - don't filter by ASN to catch all completed/closed boxes
            // Note: Backend may return both in separate calls, so we'll try both
            let completedTasksList: any[] = [];
            try {
              const completedTasksResponse = await apiService.getPutawayTasks({
                status: "Completed",
                // Don't filter by asn_no - get all completed tasks to catch all boxes
              });
              
              if (Array.isArray(completedTasksResponse)) {
                completedTasksList = completedTasksResponse;
              } else if (completedTasksResponse?.data && Array.isArray(completedTasksResponse.data)) {
                completedTasksList = completedTasksResponse.data;
              } else if (completedTasksResponse?.tasks && Array.isArray(completedTasksResponse.tasks)) {
                completedTasksList = completedTasksResponse.tasks;
              }
            } catch (completedError: any) {
              console.warn(`⚠️ Could not fetch completed tasks: ${completedError.message}`);
            }
            
            // Also fetch closed tasks
            try {
              const closedTasksResponse = await apiService.getPutawayTasks({
                status: "Closed",
                // Don't filter by asn_no - get all closed tasks to catch all boxes
              });
              
              let closedTasksList: any[] = [];
              if (Array.isArray(closedTasksResponse)) {
                closedTasksList = closedTasksResponse;
              } else if (closedTasksResponse?.data && Array.isArray(closedTasksResponse.data)) {
                closedTasksList = closedTasksResponse.data;
              } else if (closedTasksResponse?.tasks && Array.isArray(closedTasksResponse.tasks)) {
                closedTasksList = closedTasksResponse.tasks;
              }
              
              // Merge closed tasks into completed tasks list
              completedTasksList = [...completedTasksList, ...closedTasksList];
            } catch (closedError: any) {
              console.warn(`⚠️ Could not fetch closed tasks: ${closedError.message}`);
            }
            
            // If backend doesn't support status filter, fetch all and filter client-side
            if (completedTasksList.length === 0) {
              try {
                const allTasksResponse = await apiService.getPutawayTasks({});
                let allTasksList: any[] = [];
                if (Array.isArray(allTasksResponse)) {
                  allTasksList = allTasksResponse;
                } else if (allTasksResponse?.data && Array.isArray(allTasksResponse.data)) {
                  allTasksList = allTasksResponse.data;
                } else if (allTasksResponse?.tasks && Array.isArray(allTasksResponse.tasks)) {
                  allTasksList = allTasksResponse.tasks;
                }
                
                // Filter for completed or closed tasks
                completedTasksList = allTasksList.filter((t: any) => {
                  const taskStatus = (t.status || "").toUpperCase();
                  return taskStatus === "COMPLETED" || taskStatus === "CLOSED";
                });
              } catch (allTasksError: any) {
                console.warn(`⚠️ Could not fetch all tasks: ${allTasksError.message}`);
              }
            }
            
            // Extract box IDs and TC IDs from completed tasks (includes both completed and closed)
            // Also check task lines for carton_id (boxes are often in task lines, not task header)
            // Also track boxes that have location_id assigned (definitely completed)
            const completedBoxesWithLocation = new Set<string>();
            for (const task of completedTasksList) {
              const boxId = task.box_id || task.carton_id;
              const tcId = task.tc_id;
              const normalizedBoxId = boxId ? normalizeId(boxId) : null;
              const normalizedTCId = tcId ? normalizeId(tcId) : null;
              
              // Check task header for location_id
              const hasLocationInHeader = !!task.location_id;
              
              // Check task lines for carton_id and location_id
              if (task.lines && Array.isArray(task.lines)) {
                for (const line of task.lines) {
                  const lineCartonId = line.carton_id || line.box_id;
                  const lineLocationId = line.location_id;
                  if (lineCartonId) {
                    const normalizedLineCartonId = normalizeId(lineCartonId);
                    completedTaskBoxIds.add(normalizedLineCartonId);
                    if (lineLocationId || hasLocationInHeader) {
                      completedBoxesWithLocation.add(normalizedLineCartonId);
                    }
                  }
                }
              }
              
              // If task has location_id in header, it's definitely completed
              if (hasLocationInHeader) {
                if (normalizedBoxId) {
                  completedTaskBoxIds.add(normalizedBoxId);
                  completedBoxesWithLocation.add(normalizedBoxId);
                }
                if (normalizedTCId) {
                  completedTaskBoxIds.add(normalizedTCId);
                  completedBoxesWithLocation.add(normalizedTCId);
                }
              } else {
                // Even without location_id, if status is Completed, exclude it
                if (normalizedBoxId) completedTaskBoxIds.add(normalizedBoxId);
                if (normalizedTCId) completedTaskBoxIds.add(normalizedTCId);
              }
            }
            
            console.warn(`📦 PutAwayScreen: Found ${completedTaskBoxIds.size} completed boxes (${completedBoxesWithLocation.size} with location_id)`);
            
            console.warn(`📦 PutAwayScreen: Found ${completedTaskBoxIds.size} completed putaway task(s) (all ASNs)`);
          } catch (error: any) {
            // Silently fail - if we can't fetch completed tasks, continue without them
            console.warn(`⚠️ PutAwayScreen: Could not fetch completed tasks: ${error.message}`);
          }
        }
      } catch (error: any) {
        // Continue without completed tasks check
        console.warn(`⚠️ PutAwayScreen: Error fetching completed tasks: ${error.message}`);
      }
      
      // Add Putaway boxes (filtered by ASN if needed)
      // Exclude Putaway boxes that have already been assigned a location
      for (const putawayTC of putawayTCs) {
        // Skip if already seen (deduplication)
        if (seenTCIds.has(putawayTC.tc_id)) {
          console.warn(`⚠️ PutAwayScreen: Skipped duplicate Putaway box ${putawayTC.tc_id}`);
          continue;
        }
        
        // Skip if Putaway box has already been assigned a location
        // BUT: If it has a backend putaway task, show it anyway (backend task is source of truth)
        // ✅ FIX: Check backend tasks loaded earlier (not just local TC property)
        const normalizedPutawayTCId = normalizeId(putawayTC.tc_id);
        const hasBackendTaskInSet = backendTaskIds.has(normalizedPutawayTCId);
        const matchingBackendTaskForPutaway = backendPutawayTasks.find(task => {
          const taskBoxId = normalizeId((task as any).box_id);
          const taskTCId = normalizeId(task.tc_id);
          return taskBoxId === normalizedPutawayTCId || taskTCId === normalizedPutawayTCId;
        });
        const hasBackendTask = (putawayTC as any).putaway_task || hasBackendTaskInSet || !!matchingBackendTaskForPutaway;
        
        // If backend task exists, copy it to local TC
        if (matchingBackendTaskForPutaway && !(putawayTC as any).putaway_task) {
          (putawayTC as any).putaway_task = (matchingBackendTaskForPutaway as any).putaway_task;
          (putawayTC as any).putaway_task_status = (matchingBackendTaskForPutaway as any).putaway_task_status;
          if ((matchingBackendTaskForPutaway as any).location_id) {
            (putawayTC as any).location_id = (matchingBackendTaskForPutaway as any).location_id;
          }
          console.warn(`✅ PutAwayScreen: Found backend task for Putaway box ${putawayTC.tc_id} - ${(matchingBackendTaskForPutaway as any).putaway_task}`);
        }
        
        const taskStatus = (putawayTC as any).putaway_task_status;
        const taskStatusUpper = taskStatus ? taskStatus.toUpperCase() : "";
        const isTaskCompleted = taskStatusUpper === "COMPLETED";
        const isTaskClosed = taskStatusUpper === "CLOSED";
        const boxStatus = (putawayTC.status || "").toUpperCase();
        const isBoxClosed = boxStatus === "CLOSED";
        const hasLocationAssigned = !!(putawayTC as any).location_id || assignedTCSet.has(putawayTC.tc_id.toUpperCase());
        
        // ✅ FILTER OUT COMPLETED/CLOSED PUTAWAY BOXES:
        // 1. Check if box ID is in completed/closed tasks set (from backend API)
        const normalizedBoxIdForCheck = normalizeId(putawayTC.tc_id);
        if (completedTaskBoxIds.has(normalizedBoxIdForCheck)) {
          console.warn(`⚠️ PutAwayScreen: Skipped Putaway box ${putawayTC.tc_id} - has completed/closed putaway task (from backend API)`);
          continue;
        }
        
        // 2. Box has location assigned (completed putaway) → filter out
        // Check this before checking backend task status
        if (hasLocationAssigned) {
          console.warn(`⚠️ PutAwayScreen: Skipped Putaway box ${putawayTC.tc_id} - already assigned to location (completed putaway)`);
          continue;
        }
        
        // 3. Backend task is COMPLETED or CLOSED → filter out
        if (hasBackendTask && (isTaskCompleted || isTaskClosed)) {
          console.warn(`⚠️ PutAwayScreen: Skipped Putaway box ${putawayTC.tc_id} - putaway task is ${taskStatus}`);
          continue;
        }
        
        // 4. ✅ NEW: Check if this box has PUTAWAY_TO_RACK events (completed putaway)
        // This catches cases where events exist but weren't in assignedTCSet
        const db = await getDatabase();
        if (db) {
          const putawayEvents = await db.getAllAsync<{ tc_id: string }>(
            `SELECT DISTINCT tc_id 
             FROM event_queue 
             WHERE event_type = 'PUTAWAY_TO_RACK' 
               AND tc_id = ? 
               AND tc_id IS NOT NULL 
               AND tc_id != ''`,
            [putawayTC.tc_id]
          );
          
          if (putawayEvents && putawayEvents.length > 0) {
            console.warn(`⚠️ PutAwayScreen: Skipped Putaway box ${putawayTC.tc_id} - has PUTAWAY_TO_RACK events (already completed)`);
            continue;
          }
        }
        
        // 5. ✅ NEW: Query backend directly for this box's task to check status and location_id
        // This catches cases where the box has a completed task but wasn't in the bulk fetch
        if (!hasBackendTask && !hasLocationAssigned && !completedTaskBoxIds.has(normalizedBoxIdForCheck)) {
          try {
            const settings = await getSettings();
            if (settings.api_url && settings.demo_mode !== 1) {
              // Try to find this box in any putaway task by querying with box_id/carton_id
              // First try to get tasks for this ASN
              const boxTasksResponse = await apiService.getPutawayTasks({
                asn_no: putawayTC.asn_no || activeASN || undefined,
              });
              
              let allBoxTasks: any[] = [];
              if (Array.isArray(boxTasksResponse)) {
                allBoxTasks = boxTasksResponse;
              } else if (boxTasksResponse?.data && Array.isArray(boxTasksResponse.data)) {
                allBoxTasks = boxTasksResponse.data;
              } else if (boxTasksResponse?.tasks && Array.isArray(boxTasksResponse.tasks)) {
                allBoxTasks = boxTasksResponse.tasks;
              }
              
              // Find task for this specific box by checking box_id, tc_id, or carton_id in task lines
              const boxTask = allBoxTasks.find((task: any) => {
                const taskBoxId = normalizeId(task.box_id || task.carton_id);
                const taskTCId = normalizeId(task.tc_id);
                if (taskBoxId === normalizedBoxIdForCheck || taskTCId === normalizedBoxIdForCheck) {
                  return true;
                }
                // Also check task lines for carton_id
                if (task.lines && Array.isArray(task.lines)) {
                  return task.lines.some((line: any) => {
                    const lineCartonId = normalizeId(line.carton_id);
                    return lineCartonId === normalizedBoxIdForCheck;
                  });
                }
                return false;
              });
              
              if (boxTask) {
                const boxTaskStatus = (boxTask.status || "").toUpperCase();
                const hasLocationInTask = !!boxTask.location_id;
                // Check if any task line has location_id for this specific carton
                let hasLocationInLines = false;
                if (boxTask.lines && Array.isArray(boxTask.lines)) {
                  const matchingLine = boxTask.lines.find((line: any) => {
                    const lineCartonId = normalizeId(line.carton_id || line.box_id);
                    return lineCartonId === normalizedBoxIdForCheck;
                  });
                  hasLocationInLines = !!matchingLine?.location_id;
                }
                
                if (boxTaskStatus === "COMPLETED" || boxTaskStatus === "CLOSED" || hasLocationInTask || hasLocationInLines) {
                  console.warn(`⚠️ PutAwayScreen: Skipped Putaway box ${putawayTC.tc_id} - found completed/closed task with location via direct query: ${boxTask.putaway_task || boxTask.task_title} (status: ${boxTask.status}, hasLocation: ${hasLocationInTask || hasLocationInLines})`);
                  
                  // ✅ Update local database to reflect completed status
                  try {
                    await dataService.updateTransferCartonStatus(putawayTC.tc_id, "Completed");
                    await dataService.updateBoxStatus(putawayTC.tc_id, "Completed");
                    console.warn(`✅ PutAwayScreen: Updated local database status to Completed for box ${putawayTC.tc_id}`);
                  } catch (updateError: any) {
                    console.warn(`⚠️ PutAwayScreen: Could not update local database status: ${updateError.message}`);
                  }
                  
                  continue;
                }
                // If task exists and is not completed, store it for later use
                (putawayTC as any).putaway_task = boxTask.putaway_task || boxTask.task_title;
                (putawayTC as any).putaway_task_status = boxTask.status;
                if (boxTask.location_id) {
                  (putawayTC as any).location_id = boxTask.location_id;
                }
              }
            }
          } catch (error: any) {
            // Silently fail - continue without this check
            console.warn(`⚠️ PutAwayScreen: Could not query backend for box ${putawayTC.tc_id} task status: ${error.message}`);
          }
        }
        
        // 6. ✅ NEW: Check if box has synced PUTAWAY_TO_RACK events
        // Check putaway_transactions table (if it exists) or check if events were synced
        // This catches boxes that were completed and synced (events removed from event_queue)
        if (!hasBackendTask && !hasLocationAssigned) {
          try {
            const db = await getDatabase();
            if (db) {
              // Check if there are any synced putaway transactions for this box
              // Some implementations might store completed putaways in a separate table
              const syncedTransactions = await db.getAllAsync<{ tc_id: string; synced: number }>(
                `SELECT DISTINCT tc_id, synced 
                 FROM event_queue 
                 WHERE event_type = 'PUTAWAY_TO_RACK' 
                   AND tc_id = ? 
                   AND synced = 1
                   AND tc_id IS NOT NULL 
                   AND tc_id != ''`,
                [putawayTC.tc_id]
              );
              
              if (syncedTransactions && syncedTransactions.length > 0) {
                console.warn(`⚠️ PutAwayScreen: Skipped Putaway box ${putawayTC.tc_id} - has synced PUTAWAY_TO_RACK events (already completed and synced)`);
                continue;
              }
            }
          } catch (error: any) {
            // Silently fail - table might not exist
          }
        }
        
        // ✅ Only show CLOSED boxes that are ready for putaway (no location assigned, task not completed)
        // These boxes are closed/sealed and waiting for putaway location to be scanned
        
        if (hasBackendTask && !isTaskCompleted && !isTaskClosed) {
          console.warn(`ℹ️ PutAwayScreen: Including Putaway box ${putawayTC.tc_id} - has backend putaway task (status: ${taskStatus}) even though local event exists`);
        }
        
        if (activeASN && putawayTC.asn_no) {
          const boxASN = putawayTC.asn_no.toUpperCase().trim();
          const activeASNUpper = activeASN.toUpperCase().trim();
          if (boxASN !== activeASNUpper && !boxASN.includes(activeASNUpper) && !activeASNUpper.includes(boxASN)) {
            console.warn(`⚠️ PutAwayScreen: Skipped box ${putawayTC.tc_id} - ASN mismatch: box ASN="${boxASN}" vs active ASN="${activeASNUpper}"`);
            continue; // Skip boxes that don't match active ASN
          }
        }
        
        const isWarehouse = await dataService.isWarehouse(putawayTC.store || "");
        if (!isWarehouse) {
          console.warn(`⚠️ PutAwayScreen: Skipped box ${putawayTC.tc_id} - not a warehouse (store: "${putawayTC.store}")`);
        } else {
          // Check if this box ID already exists as a TC (avoid duplicates)
          const exists = warehouseTCs.find(tc => tc.tc_id === putawayTC.tc_id);
          if (!exists) {
            warehouseTCs.push(putawayTC);
            seenTCIds.add(putawayTC.tc_id);
            console.warn(`✅ PutAwayScreen: Added Putaway box ${putawayTC.tc_id} (BOX ID = TC ID, Store: ${putawayTC.store}, ASN: ${putawayTC.asn_no})`);
          } else {
            console.warn(`⚠️ PutAwayScreen: Skipped duplicate box ${putawayTC.tc_id}`);
          }
        }
      }
      
      console.warn(`📦 PutAwayScreen: Found ${warehouseTCs.length} warehouse TCs + Putaway boxes from local database${activeASN ? ` (filtered by ASN: ${activeASN})` : ""}`);
      
      // ✅ NOTE: ASN backend tasks were already loaded earlier (before filtering)
      // Now continue with Transfer In tasks loading (if needed)
      try {
        const settings = await getSettings();
        if (settings.api_url && settings.demo_mode !== 1) {
          // ✅ Removed "All" tab - this section is no longer needed
          // ASN and Transfer In tabs fetch their own tasks separately
          if (false) {
            let allTasksResponse: any = null;
            try {
              console.warn(`📤 PutAwayScreen: Requesting ALL putaway tasks (ASN + Transfer In) - no source_type filter`);
              // ✅ No source_type parameter = returns all types (ASN + Transfer In)
              allTasksResponse = await apiService.getPutawayTasks({
                status: "Draft,Open,In Progress", // ✅ Include Open status for all putaway tasks
                // ✅ No source_type filter - backend returns all types
              });
              console.warn(`📥 PutAwayScreen: Received ALL putaway tasks response:`, {
                isArray: Array.isArray(allTasksResponse),
                hasData: !!allTasksResponse?.data,
                hasTasks: !!allTasksResponse?.tasks,
                dataLength: allTasksResponse?.data?.length,
                tasksLength: allTasksResponse?.tasks?.length,
                arrayLength: Array.isArray(allTasksResponse) ? allTasksResponse.length : undefined,
              });
              
              // Parse response
              let allTasksList: any[] = [];
              if (Array.isArray(allTasksResponse)) {
                allTasksList = allTasksResponse;
              } else if (allTasksResponse?.data && Array.isArray(allTasksResponse.data)) {
                allTasksList = allTasksResponse.data;
              } else if (allTasksResponse?.tasks && Array.isArray(allTasksResponse.tasks)) {
                allTasksList = allTasksResponse.tasks;
              }
              
              // Filter out completed tasks (client-side safety check)
              allTasksList = allTasksList.filter((task: any) => {
                const taskStatus = (task.status || "").toUpperCase();
                return taskStatus !== "COMPLETED" && taskStatus !== "CLOSED";
              });
              
              console.warn(`📥 PutAwayScreen: Processed ${allTasksList.length} active putaway task(s) from ALL types (ASN + Transfer In)`);
              
              // ✅ Split tasks into ASN and Transfer In for processing
              // ASN tasks will be processed in the existing ASN loop (if putawaySourceType === "ASN" or "All")
              // Transfer In tasks will be processed in the existing Transfer In loop (if putawaySourceType === "TransferIn" or "All")
              // For "All" tab, we need to process both types
              
              // Separate ASN and Transfer In tasks
              const asnTasksFromAll = allTasksList.filter((task: any) => {
                const hasASN = (task.asn_no || task.advance_shipping_notice) && !task.transfer_in;
                const isASNSource = task.source_type === "ASN";
                return hasASN || isASNSource;
              });
              
              const transferInTasksFromAll = allTasksList.filter((task: any) => {
                // ✅ Prioritize source_type first (most reliable indicator)
                const isTransferInSource = task.source_type === "TransferIn";
                if (isTransferInSource) {
                  return true;
                }
                // ✅ Fallback: Check for transfer_in field (but some backends may set both asn_no and transfer_in)
                const hasTransferIn = task.transfer_in && (task.source_type === "TransferIn" || (!task.asn_no && !task.advance_shipping_notice));
                return hasTransferIn;
              });
              
              console.warn(`📥 PutAwayScreen: Split ALL tasks - ASN: ${asnTasksFromAll.length}, Transfer In: ${transferInTasksFromAll.length}`);
              
              // ✅ Process ASN tasks (will be handled by existing ASN processing loop)
              // Store ASN tasks in putawayTasksResponse for processing
              if (asnTasksFromAll.length > 0) {
                putawayTasksResponse = asnTasksFromAll;
                console.warn(`📥 PutAwayScreen: Processing ${asnTasksFromAll.length} ASN task(s) from ALL response`);
              }
              
              // ✅ Process Transfer In tasks (will be handled by existing Transfer In processing loop)
              // Store Transfer In tasks in transferInTasksResponse for processing
              if (transferInTasksFromAll.length > 0) {
                transferInTasksResponse = transferInTasksFromAll;
                console.warn(`📥 PutAwayScreen: Processing ${transferInTasksFromAll.length} Transfer In task(s) from ALL response`);
              }
            } catch (allTasksError: any) {
              const errorMessage = allTasksError.message || "";
              console.warn(`⚠️ PutAwayScreen: Error fetching ALL putaway tasks: ${errorMessage}`);
              // Continue with separate ASN and Transfer In fetches as fallback
            }
          }
          
          // Load Transfer In putaway tasks (if filter allows)
          // ✅ NOTE: ASN tasks were already loaded earlier (before filtering)
          if (putawaySourceType === "TransferIn") {
            let transferInTasksResponse: any = null;
            try {
              console.warn(`📤 PutAwayScreen: Requesting Transfer In putaway tasks with filters:`, {
                status: "Draft,Open,In Progress",
                source_type: "TransferIn",
              });
              transferInTasksResponse = await apiService.getPutawayTasks({
                status: "Draft,Open,In Progress", // ✅ Includes Open status for Transfer In putaway tasks
                source_type: "TransferIn",
              });
              
              // ✅ DEBUG: Log full response to verify structure
              console.warn(`📥 PutAwayScreen: Received Transfer In putaway tasks response:`, {
                isArray: Array.isArray(transferInTasksResponse),
                hasOk: !!transferInTasksResponse?.ok,
                hasData: !!transferInTasksResponse?.data,
                hasTasks: !!transferInTasksResponse?.tasks,
                dataLength: transferInTasksResponse?.data?.length,
                tasksLength: transferInTasksResponse?.tasks?.length,
                arrayLength: Array.isArray(transferInTasksResponse) ? transferInTasksResponse.length : undefined,
                responseType: typeof transferInTasksResponse,
                responseKeys: transferInTasksResponse ? Object.keys(transferInTasksResponse) : [],
                fullResponsePreview: transferInTasksResponse ? JSON.stringify(transferInTasksResponse).substring(0, 1000) : 'null',
              });
              
              // ✅ DEBUG: Log tasks if found
              if (transferInTasksResponse?.data && Array.isArray(transferInTasksResponse.data)) {
                console.warn(`📥 PutAwayScreen: Transfer In tasks in response.data:`, transferInTasksResponse.data.map((t: any) => ({
                  title: t.title || t.putaway_task,
                  source_type: t.source_type,
                  status: t.status,
                  transfer_in: t.transfer_in,
                })));
              } else if (Array.isArray(transferInTasksResponse)) {
                console.warn(`📥 PutAwayScreen: Transfer In tasks in direct array:`, transferInTasksResponse.map((t: any) => ({
                  title: t.title || t.putaway_task,
                  source_type: t.source_type,
                  status: t.status,
                  transfer_in: t.transfer_in,
                })));
              }
            } catch (tiTasksError: any) {
              const errorMessage = tiTasksError.message || "";
              const errorDetails = tiTasksError.details || "";
              const errorCode = tiTasksError.code || "";
              const fullError = `${errorMessage} ${errorDetails} ${errorCode}`.toLowerCase();
              
              const isNetworkError = 
                errorMessage.includes("Network request failed") ||
                errorMessage.includes("Network error") ||
                errorMessage.includes("Failed to connect") ||
                errorMessage.includes("ECONNREFUSED") ||
                errorMessage.includes("ENOTFOUND") ||
                errorMessage.includes("timeout") ||
                tiTasksError.name === "TypeError" && errorMessage.includes("fetch");
              
              if (isNetworkError) {
                console.warn(`ℹ️ PutAwayScreen: Backend server not reachable for Transfer In tasks - working in offline mode`);
              } else if (
                  fullError.includes("source_type") || 
                  fullError.includes("unknown column") ||
                  fullError.includes("pt.source_type") ||
                  fullError.includes("er_bad_field_error") ||
                  (errorCode === "DATABASE_ERROR" && fullError.includes("source_type"))
              ) {
                // Backend doesn't support source_type column - fetch all tasks and filter client-side
                console.warn(`ℹ️ PutAwayScreen: Backend doesn't support source_type column - fetching all tasks and filtering client-side`);
                try {
                  // Try with minimal filters first (just status)
                  const allTasksResponse = await apiService.getPutawayTasks({
                    status: "Draft,Open,In Progress", // ✅ Includes Open status for Transfer In putaway tasks
                  });
                  
                  // Parse response
                  let allTasksList: any[] = [];
                  if (Array.isArray(allTasksResponse)) {
                    allTasksList = allTasksResponse;
                  } else if (allTasksResponse?.data && Array.isArray(allTasksResponse.data)) {
                    allTasksList = allTasksResponse.data;
                  } else if (allTasksResponse?.tasks && Array.isArray(allTasksResponse.tasks)) {
                    allTasksList = allTasksResponse.tasks;
                  }
                  
                  // Filter client-side for Transfer In tasks (check for transfer_in field or source_type in response)
                  // ✅ CRITICAL: Explicitly exclude Completed and Closed tasks
                  transferInTasksResponse = allTasksList.filter((t: any) => {
                    const taskStatus = (t.status || "").toUpperCase();
                    const isCompleted = taskStatus === "COMPLETED";
                    const isClosed = taskStatus === "CLOSED";
                    
                    // ✅ Filter out completed and closed tasks
                    if (isCompleted || isClosed) {
                      return false;
                    }
                    
                    // ✅ Transfer In tasks: Check source_type first (most reliable)
                    // If source_type is "TransferIn", it's a Transfer In task
                    const isTransferInSource = t.source_type === "TransferIn";
                    if (isTransferInSource) {
                      return true;
                    }
                    
                    // ✅ Fallback: Transfer In tasks have transfer_in field
                    // Note: Some backends may set both asn_no and transfer_in, so check source_type first
                    const hasTransferIn = t.transfer_in && (t.source_type === "TransferIn" || (!t.asn_no && !t.advance_shipping_notice));
                    return hasTransferIn;
                  });
                  
                  console.warn(`ℹ️ PutAwayScreen: Filtered ${transferInTasksResponse.length} Transfer In tasks from ${allTasksList.length} total tasks`);
                } catch (retryError: any) {
                  const retryErrorMessage = retryError.message || "";
                  const retryErrorDetails = retryError.details || {};
                  const retryFullError = `${retryErrorMessage} ${JSON.stringify(retryErrorDetails)}`.toLowerCase();
                  
                  const isRetryNetworkError = 
                    retryErrorMessage.includes("Network request failed") ||
                    retryErrorMessage.includes("Network error");
                  
                  // Check if this is a whereClause error (backend query construction issue)
                  const isWhereClauseError = 
                    retryErrorMessage.includes("whereClause") ||
                    retryErrorMessage.includes("where clause") ||
                    retryFullError.includes("whereclause");
                  
                  if (isRetryNetworkError) {
                    console.warn(`ℹ️ PutAwayScreen: Backend server not reachable - working in offline mode`);
                  } else if (isWhereClauseError) {
                    // Backend has a query construction issue - try with no filters at all
                    console.warn(`ℹ️ PutAwayScreen: Backend query construction issue - trying with no filters`);
                    try {
                      const allTasksNoFilters = await apiService.getPutawayTasks({});
                      let allTasksListNoFilters: any[] = [];
                      if (Array.isArray(allTasksNoFilters)) {
                        allTasksListNoFilters = allTasksNoFilters;
                      } else if (allTasksNoFilters?.data && Array.isArray(allTasksNoFilters.data)) {
                        allTasksListNoFilters = allTasksNoFilters.data;
                      } else if (allTasksNoFilters?.tasks && Array.isArray(allTasksNoFilters.tasks)) {
                        allTasksListNoFilters = allTasksNoFilters.tasks;
                      }
                      
                      // Filter by status and Transfer In client-side
                      // ✅ CRITICAL: Explicitly exclude Completed and Closed tasks
                      const filteredTasks = allTasksListNoFilters.filter((t: any) => {
                        const taskStatus = (t.status || "").toUpperCase();
                        const isCompleted = taskStatus === "COMPLETED";
                        const isClosed = taskStatus === "CLOSED";
                        
                        // ✅ Filter out completed and closed tasks
                        if (isCompleted || isClosed) {
                          return false;
                        }
                        
                        // ✅ Include Open status for Transfer In putaway tasks
                        const isDraftOpenOrInProgress = taskStatus === "DRAFT" || taskStatus === "OPEN" || taskStatus === "IN PROGRESS" || taskStatus === "INPROGRESS";
                        const hasTransferIn = t.transfer_in && !t.asn_no && !t.advance_shipping_notice;
                        const isTransferInSource = t.source_type === "TransferIn";
                        return isDraftOpenOrInProgress && (hasTransferIn || isTransferInSource);
                      });
                      
                      transferInTasksResponse = filteredTasks;
                      console.warn(`ℹ️ PutAwayScreen: Filtered ${filteredTasks.length} Transfer In tasks from ${allTasksListNoFilters.length} total tasks (no backend filters)`);
                    } catch (finalError: any) {
                      console.warn(`⚠️ Error fetching Transfer In putaway tasks even without filters:`, finalError.message);
                    }
                  } else {
                    console.warn(`⚠️ Error fetching all putaway tasks for client-side filtering:`, retryError.message);
                  }
                }
              } else if (tiTasksError.message?.includes("404") || tiTasksError.message?.includes("not found")) {
                console.warn(`⚠️ Transfer In putaway tasks API endpoint not available (404) - backend may not be implemented yet`);
              } else {
                console.warn(`⚠️ Error fetching Transfer In putaway tasks:`, tiTasksError.message);
              }
            }
            
            // Parse Transfer In tasks response
            // Backend may return: direct array [...], { ok: true, data: [...] }, { data: [...] }, or { tasks: [...] }
            // ✅ Based on backend logs, it returns direct array: [{ title: "...", status: "...", source_type: "TransferIn", ... }]
            let tiTasksList: any[] = [];
            
            // ✅ DEBUG: Log raw response first
            console.warn(`📦 PutAwayScreen: Raw Transfer In response type:`, typeof transferInTasksResponse);
            console.warn(`📦 PutAwayScreen: Raw Transfer In response isArray:`, Array.isArray(transferInTasksResponse));
            console.warn(`📦 PutAwayScreen: Raw Transfer In response:`, JSON.stringify(transferInTasksResponse, null, 2).substring(0, 1000));
            
            if (Array.isArray(transferInTasksResponse)) {
              // ✅ Backend returns direct array (most common case based on logs)
              tiTasksList = transferInTasksResponse;
              console.warn(`✅ PutAwayScreen: Transfer In tasks response is direct array (${tiTasksList.length} items)`);
              if (tiTasksList.length > 0) {
                console.warn(`✅ PutAwayScreen: First task in array:`, {
                  title: tiTasksList[0].title || tiTasksList[0].putaway_task,
                  status: tiTasksList[0].status,
                  source_type: tiTasksList[0].source_type,
                  transfer_in: tiTasksList[0].transfer_in,
                });
              }
            } else if (transferInTasksResponse?.data && Array.isArray(transferInTasksResponse.data)) {
              // ✅ Handle { ok: true, data: [...] } format
              tiTasksList = transferInTasksResponse.data;
              console.warn(`✅ PutAwayScreen: Transfer In tasks found in response.data (${tiTasksList.length} items)`);
            } else if (transferInTasksResponse?.tasks && Array.isArray(transferInTasksResponse.tasks)) {
              tiTasksList = transferInTasksResponse.tasks;
              console.warn(`✅ PutAwayScreen: Transfer In tasks found in response.tasks (${tiTasksList.length} items)`);
            } else {
              console.warn(`❌ PutAwayScreen: Transfer In tasks response format not recognized:`, {
                isArray: Array.isArray(transferInTasksResponse),
                hasOk: !!transferInTasksResponse?.ok,
                hasData: !!transferInTasksResponse?.data,
                hasTasks: !!transferInTasksResponse?.tasks,
                responseType: typeof transferInTasksResponse,
                responseKeys: transferInTasksResponse ? Object.keys(transferInTasksResponse) : [],
                responsePreview: transferInTasksResponse ? JSON.stringify(transferInTasksResponse).substring(0, 500) : 'null',
              });
            }
            
            // Convert Transfer In putaway tasks to TransferCarton format
            console.warn(`📦 PutAwayScreen: Processing ${tiTasksList.length} Transfer In task(s) from response`);
            if (tiTasksList.length === 0) {
              console.warn(`⚠️ PutAwayScreen: No Transfer In tasks found in response!`);
              console.warn(`   Response structure:`, {
                isArray: Array.isArray(transferInTasksResponse),
                hasOk: !!transferInTasksResponse?.ok,
                hasData: !!transferInTasksResponse?.data,
                hasTasks: !!transferInTasksResponse?.tasks,
                responseType: typeof transferInTasksResponse,
                responseKeys: transferInTasksResponse ? Object.keys(transferInTasksResponse) : [],
                responsePreview: transferInTasksResponse ? JSON.stringify(transferInTasksResponse).substring(0, 500) : 'null',
              });
            } else {
              console.warn(`📦 PutAwayScreen: Full Transfer In tasks list:`, JSON.stringify(tiTasksList, null, 2));
            }
            
            // ✅ CRITICAL: Only process if we have tasks in the list
            if (tiTasksList.length > 0) {
              for (const task of tiTasksList) {
              const taskId = task.putaway_task || task.task_title || task.id || task.task_id || task.title;
              const transferIn = task.transfer_in;
              const sourceType = task.source_type || "TransferIn";
              
              console.warn(`📦 PutAwayScreen: Processing Transfer In task ${taskId}:`, {
                taskId,
                transfer_in: transferIn,
                source_type: sourceType,
                asn_no: task.asn_no,
                status: task.status,
                has_items: !!task.items,
                items_count: task.items?.length || 0,
                has_lines: !!task.lines,
                lines_count: task.lines?.length || 0,
                full_task: JSON.stringify(task, null, 2),
              });
              
              // ✅ Extract carton_id from task (for Transfer In, carton_id = box_id)
              // Backend may return carton_id in task or in task lines
              // Carton ID (CTN-TI-...) is used as box_id for Transfer In putaway
              // The carton is created during receiving, items are scanned to it, then carton is closed
              let cartonId = (task as any).carton_id || task.carton_id || task.box_id || null;
              
              // ✅ CRITICAL: If carton_id not in task, try to get it from task lines
              // Backend may return carton_id in individual task lines
              if (!cartonId && task.lines && Array.isArray(task.lines) && task.lines.length > 0) {
                // Get carton_id from first line (all lines should have same carton_id for a task)
                const firstLine = task.lines[0];
                cartonId = firstLine.carton_id || (firstLine as any).carton_id || null;
                if (cartonId) {
                  console.warn(`✅ PutAwayScreen: Found carton_id from task lines: ${cartonId}`);
                }
              }
              
              // ✅ CRITICAL: If carton_id still not found, try to get it from task items
              // Backend returns carton_id in items array: items[0].carton_id = "CTN-TI-..."
              if (!cartonId && task.items && Array.isArray(task.items) && task.items.length > 0) {
                // Check all items for carton_id (all items should have same carton_id)
                for (const item of task.items) {
                  const itemCartonId = item.carton_id || (item as any).carton_ID || (item as any).carton_id;
                  if (itemCartonId && itemCartonId.startsWith("CTN-TI-")) {
                    cartonId = itemCartonId;
                    console.warn(`✅ PutAwayScreen: Found carton_id from task.items array: ${cartonId}`);
                    break;
                  }
                }
              }
              
              // ✅ For "TransferIn" tab, only process Transfer In tasks
              if (putawaySourceType === "TransferIn") {
                // Only process Transfer In tasks
                if (sourceType !== "TransferIn" && !transferIn) {
                  continue;
                }
              }
              
              // Check task status - include Draft, Open, and In Progress tasks
              // ✅ CRITICAL: Explicitly exclude Completed and Closed tasks
              // Backend returns status as "Draft" (capitalized), convert to uppercase for comparison
              const taskStatus = (task.status || "").toUpperCase();
              const isCompleted = taskStatus === "COMPLETED";
              const isClosed = taskStatus === "CLOSED";
              
              // ✅ Filter out completed and closed tasks
              if (isCompleted || isClosed) {
                console.warn(`⚠️ PutAwayScreen: Skipped Transfer In putaway task ${taskId} - status is "${task.status}"`);
                continue;
              }
              
              const isDraft = taskStatus === "DRAFT";
              const isOpen = taskStatus === "OPEN"; // ✅ Include Open status
              const isInProgress = taskStatus === "IN PROGRESS" || taskStatus === "INPROGRESS";
              
              if (!isDraft && !isOpen && !isInProgress) {
                console.warn(`⚠️ PutAwayScreen: Skipped Transfer In putaway task ${taskId} - status is "${task.status}" (expected "Draft", "Open", or "In Progress")`);
                continue;
              }
              
              // ✅ CRITICAL: Validate that carton_id exists and is in correct format (CTN-TI-*)
              // Do NOT use TI-PUT-* format (putaway task title) as fallback
              // ✅ Note: Backend list response may not include items array - try to get carton_id from local database
              if (!cartonId || !cartonId.startsWith("CTN-TI-")) {
                // ✅ Try one more time to get carton_id from items array (if backend includes it in list response)
                if (task.items && Array.isArray(task.items) && task.items.length > 0) {
                  // Check all items for carton_id
                  for (const item of task.items) {
                    const itemCartonId = item.carton_id || (item as any).carton_ID || (item as any).carton_id;
                    if (itemCartonId && itemCartonId.startsWith("CTN-TI-")) {
                      cartonId = itemCartonId;
                      console.warn(`✅ PutAwayScreen: Found carton_id from task.items array: ${cartonId}`);
                      break;
                    }
                  }
                }
                
                // ✅ FALLBACK: If carton_id still not found, try to get it from local database (scanned_items)
                // Backend list response may not include items, so we get carton_id from local data
                if ((!cartonId || !cartonId.startsWith("CTN-TI-")) && transferIn) {
                  try {
                    const db = await getDatabase();
                    if (db) {
                      // Get carton_id from scanned_items for this transfer_in
                      const cartonFromDB = await db.getFirstAsync<{ box_id: string }>(
                        `SELECT DISTINCT box_id 
                         FROM scanned_items 
                         WHERE transfer_in = ? 
                           AND box_id LIKE 'CTN-TI-%'
                         LIMIT 1`,
                        [transferIn]
                      );
                      
                      if (cartonFromDB && cartonFromDB.box_id && cartonFromDB.box_id.startsWith("CTN-TI-")) {
                        cartonId = cartonFromDB.box_id;
                        console.warn(`✅ PutAwayScreen: Found carton_id from local database (scanned_items): ${cartonId} for transfer_in: ${transferIn}`);
                      }
                    }
                  } catch (dbError: any) {
                    console.warn(`⚠️ PutAwayScreen: Error querying local database for carton_id: ${dbError.message}`);
                  }
                }
              }
              
              // ✅ Final check: If still no valid carton_id, try to fetch full task details
              if (!cartonId || !cartonId.startsWith("CTN-TI-")) {
                // ✅ FALLBACK: Try to fetch full task details to get carton_id
                // Note: This endpoint might not exist (404), so we handle it gracefully
                console.warn(`⚠️ PutAwayScreen: Transfer In putaway task ${taskId} missing carton_id in list response, fetching full task details...`);
                try {
                  const fullTask = await apiService.getPutawayTask(taskId);
                  const fullTaskData = fullTask?.data || fullTask;
                  
                  // Try to get carton_id from full task
                  const fullTaskCartonId = fullTaskData?.carton_id || 
                                          (fullTaskData as any)?.carton_id || 
                                          fullTaskData?.box_id ||
                                          (fullTaskData as any)?.box_id || null;
                  
                  // ✅ Handle response format: { ok: true, data: { items: [...] } }
                  const taskItems = fullTaskData?.items || fullTaskData?.lines || [];
                  // Try to get carton_id from task items
                  if (!fullTaskCartonId && Array.isArray(taskItems) && taskItems.length > 0) {
                    const firstItem = taskItems[0];
                    const itemCartonId = firstItem.carton_id || (firstItem as any).carton_id || null;
                    if (itemCartonId && itemCartonId.startsWith("CTN-TI-")) {
                      cartonId = itemCartonId;
                      console.warn(`✅ PutAwayScreen: Found carton_id from full task items: ${cartonId}`);
                    }
                  } else if (fullTaskCartonId && fullTaskCartonId.startsWith("CTN-TI-")) {
                    cartonId = fullTaskCartonId;
                    console.warn(`✅ PutAwayScreen: Found carton_id from full task: ${cartonId}`);
                  }
                } catch (fetchError: any) {
                  // ✅ Handle 404 gracefully - endpoint might not exist (don't log as error)
                  const errorMsg = fetchError.message || "";
                  if (errorMsg.includes("404") || errorMsg.includes("not found") || errorMsg.includes("Route")) {
                    console.warn(`ℹ️ PutAwayScreen: getPutawayTask endpoint not available (404) for ${taskId} - will use other data sources`);
                  } else {
                    console.warn(`⚠️ PutAwayScreen: Error fetching full task details for ${taskId}:`, errorMsg);
                  }
                }
                
                // ✅ Final validation: If still no valid carton_id, try one more time from local database
                if (!cartonId || !cartonId.startsWith("CTN-TI-")) {
                  // ✅ Last resort: Query local database for any carton_id associated with this transfer_in
                  if (transferIn) {
                    try {
                      const db = await getDatabase();
                      if (db) {
                        // Get carton_id from scanned_items for this transfer_in (any item scanned to this transfer)
                        const cartonFromDB = await db.getFirstAsync<{ box_id: string }>(
                          `SELECT DISTINCT box_id 
                           FROM scanned_items 
                           WHERE transfer_in = ? 
                             AND box_id LIKE 'CTN-TI-%'
                           ORDER BY event_time DESC
                           LIMIT 1`,
                          [transferIn]
                        );
                        
                        if (cartonFromDB && cartonFromDB.box_id && cartonFromDB.box_id.startsWith("CTN-TI-")) {
                          cartonId = cartonFromDB.box_id;
                          console.warn(`✅ PutAwayScreen: Found carton_id from local database (last resort): ${cartonId} for transfer_in: ${transferIn}`);
                        }
                      }
                    } catch (dbError: any) {
                      console.warn(`⚠️ PutAwayScreen: Error querying local database for carton_id (last resort): ${dbError.message}`);
                    }
                  }
                  
                  // ✅ If still no carton_id after all attempts, skip this task
                  // Carton_id is required for Transfer In putaway tasks
                  if (!cartonId || !cartonId.startsWith("CTN-TI-")) {
                    console.warn(`⚠️ PutAwayScreen: Transfer In putaway task ${taskId} missing valid carton_id (CTN-TI-* format) after all attempts`);
                    console.warn(`   Task carton_id: ${cartonId || 'null'}`);
                    console.warn(`   Task ID: ${taskId}`);
                    console.warn(`   Transfer In: ${transferIn}`);
                    console.warn(`   ⚠️ Skipping this task - carton_id is required for Transfer In putaway`);
                    console.warn(`   💡 Tip: Ensure items have been scanned to a carton (CTN-TI-*) during receiving`);
                    continue; // Skip tasks without valid carton_id
                  }
                }
              }
              
              console.warn(`✅ PutAwayScreen: Processing Transfer In putaway task ${taskId} with carton_id: ${cartonId}`);
              
              // ✅ For Transfer In, carton_id = box_id (CTN-TI-... format)
              // Use carton_id as identifier (NOT task ID)
              const identifier = cartonId; // ✅ Always use carton_id (CTN-TI-*), never use task ID (TI-PUT-*)
              
              const tcObj: TransferCarton = {
                tc_id: identifier, // ✅ Use carton_id (CTN-TI-*) as box_id for Transfer In putaway
                asn_no: transferIn, // Store Transfer In number in asn_no field for compatibility
                to_no: null,
                store: task.warehouse || null,
                status: task.status || "Draft", // Task status
                updated_on: task.updated_on || task.created_on || new Date().toISOString(),
              };
              
              // Store putaway_task and Transfer In info
              (tcObj as any).putaway_task = taskId;
              (tcObj as any).putaway_task_status = task.status;
              (tcObj as any).source_type = "TransferIn";
              (tcObj as any).transfer_in = transferIn;
              (tcObj as any).warehouse = task.warehouse;
              (tcObj as any).carton_id = cartonId; // ✅ Store carton_id for display in putaway list
              
              // ✅ FIX: Store task lines/items if available in list response
              // This avoids needing to fetch full task details later
              if (task.lines && Array.isArray(task.lines)) {
                (tcObj as any).task_lines = task.lines;
                console.warn(`📋 [CARTON_ID_TRACK] Stored ${task.lines.length} line(s) from task list for ${taskId}`);
              } else if (task.items && Array.isArray(task.items)) {
                (tcObj as any).task_lines = task.items;
                console.warn(`📋 [CARTON_ID_TRACK] Stored ${task.items.length} item(s) from task list for ${taskId}`);
              }
              
              backendPutawayTasks.push(tcObj);
              console.warn(`✅ PutAwayScreen: Added Transfer In putaway task ${taskId} (transfer_in: ${transferIn}, task_status: ${task.status})`);
            }
            } else {
              console.warn(`⚠️ PutAwayScreen: No Transfer In tasks to process (tiTasksList is empty)`);
            }
            
            console.warn(`✅ PutAwayScreen: Found ${tiTasksList.length} Transfer In putaway task(s) from backend, added ${backendPutawayTasks.filter(t => (t as any).source_type === "TransferIn").length} to backendPutawayTasks`);
          }
          
          console.warn(`✅ PutAwayScreen: Total ${backendPutawayTasks.length} putaway task(s) from backend (ASN + Transfer In)`);
        }
      } catch (backendError: any) {
        console.warn(`⚠️ Error loading putaway tasks from backend:`, backendError.message);
        // Continue with local database fallback
      }
      
      // Merge backend tasks with local TCs/boxes
      // Backend tasks take priority (they're the source of truth)
      // ✅ NOTE: backendTaskIds Set was already populated when loading ASN tasks earlier
      const allPutawayItems: TransferCarton[] = [];
      const seenIds = new Set<string>();
      
      // First, add backend putaway tasks (priority)
      // Track all IDs (both box_id and tc_id) from backend tasks for matching
      // ✅ NOTE: backendTaskIds was already populated, but we need to add Transfer In tasks too
      for (const backendTask of backendPutawayTasks) {
        const boxId = normalizeId((backendTask as any).box_id);
        const tcId = normalizeId(backendTask.tc_id);
        const taskId = (backendTask as any).putaway_task || backendTask.tc_id || (backendTask as any).box_id;
        // ✅ FIX: Use task ID if no box_id/tc_id (for task-only entries)
        const primaryId = backendTask.tc_id || (backendTask as any).box_id || taskId;
        const normalizedId = normalizeId(primaryId);
        
        // ✅ DEBUG: Log task details for troubleshooting
        const taskASN = backendTask.asn_no;
        const activeASNUpper = activeASN ? activeASN.toUpperCase().trim() : null;
        const taskASNUpper = taskASN ? taskASN.toUpperCase().trim() : null;
        const asnMatches = !activeASN || !taskASN || 
                          taskASNUpper === activeASNUpper || 
                          taskASNUpper?.includes(activeASNUpper || "") || 
                          activeASNUpper?.includes(taskASNUpper || "");
        
        console.warn(`🔍 PutAwayScreen: Processing backend task ${taskId}:`, {
          taskId,
          box_id: (backendTask as any).box_id,
          tc_id: backendTask.tc_id,
          primaryId,
          normalizedId,
          asn_no: taskASN,
          activeASN,
          asnMatches,
          status: (backendTask as any).putaway_task_status,
          is_task_only: (backendTask as any).is_task_only,
        });
        
        // ✅ FIX: Allow tasks without box_id/tc_id (task-only entries)
        if (normalizedId && !seenIds.has(normalizedId)) {
          // ✅ Check ASN match before adding (only for ASN tasks, not Transfer In)
          const taskSourceType = (backendTask as any).source_type;
          const isASNTask = taskSourceType === "ASN";
          const isTransferInTask = taskSourceType === "TransferIn";
          
          // ✅ Only apply ASN filtering to ASN tasks, not Transfer In tasks
          if (activeASN && taskASN && isASNTask) {
            if (!asnMatches) {
              console.warn(`⚠️ PutAwayScreen: Skipping ASN backend task ${taskId} - ASN mismatch: task ASN="${taskASN}" vs active ASN="${activeASN}"`);
              continue;
            }
          }
          
          // ✅ For Transfer In tasks, don't filter by ASN (they have transfer_in, not asn_no)
          // Transfer In tasks should always be included regardless of activeASN filter
          
          allPutawayItems.push(backendTask);
          seenIds.add(normalizedId);
          // Track both box_id and tc_id for matching (if not already tracked)
          if (boxId && !backendTaskIds.has(boxId)) backendTaskIds.add(boxId);
          if (tcId && !backendTaskIds.has(tcId)) backendTaskIds.add(tcId);
          console.warn(`✅ PutAwayScreen: Added backend task ${taskId} for ${primaryId} (normalized: ${normalizedId}, source_type: ${taskSourceType || 'N/A'}, box_id: ${(backendTask as any).box_id || 'N/A'}, tc_id: ${backendTask.tc_id || 'N/A'}, ASN/TransferIn: ${taskASN || 'N/A'})`);
        } else {
          console.warn(`⚠️ PutAwayScreen: Skipping backend task ${taskId} - already in list or no valid ID (normalizedId: ${normalizedId}, seen: ${seenIds.has(normalizedId || "")})`);
        }
      }
      
      // Then, add local TCs/boxes that aren't already in backend tasks
      // Include closed boxes IF they have an "Open" putaway task in backend
      // For closed boxes without backend tasks, they will be filtered out if backend task is required
      for (const localTC of warehouseTCs) {
        const id = localTC.tc_id;
        const normalizedId = normalizeId(id);
        
        if (!normalizedId) continue;
        
        // Check if this ID is already in the list (from backend tasks)
        // Also check if it matches any backend task's box_id or tc_id
        const matchesBackendTask = backendTaskIds.has(normalizedId);
        if (seenIds.has(normalizedId)) {
          // Already added from backend with same primary ID - skip to avoid duplicates
          console.warn(`⚠️ PutAwayScreen: Skipped local TC ${id} - already exists in backend tasks`);
          continue;
        }
        
        // If local TC matches a backend task (by box_id or tc_id), merge the putaway_task
        if (matchesBackendTask) {
          const matchingBackendTask = backendPutawayTasks.find(task => {
            const taskBoxId = normalizeId((task as any).box_id);
            const taskTCId = normalizeId(task.tc_id);
            return taskBoxId === normalizedId || taskTCId === normalizedId;
          });
          
          if (matchingBackendTask) {
            // Merge: Copy putaway_task and location_id to local TC
            (localTC as any).putaway_task = (matchingBackendTask as any).putaway_task;
            (localTC as any).putaway_task_status = (matchingBackendTask as any).putaway_task_status;
            // Copy header-level location_id from backend task if available
            if ((matchingBackendTask as any).location_id) {
              (localTC as any).location_id = (matchingBackendTask as any).location_id;
              console.warn(`✅ PutAwayScreen: Copied location_id ${(matchingBackendTask as any).location_id} from backend task`);
            }
            console.warn(`✅ PutAwayScreen: Merged backend task ${(matchingBackendTask as any).putaway_task} with local TC ${id}`);
            
            // Remove the backend task from the list if it exists (to avoid duplicates)
            // The local TC has more complete data, so we prefer it
            const backendTaskPrimaryId = normalizeId(matchingBackendTask.tc_id || (matchingBackendTask as any).box_id);
            const backendTaskIndex = allPutawayItems.findIndex(item => {
              const itemId = normalizeId(item.tc_id || (item as any).box_id);
              return itemId === backendTaskPrimaryId;
            });
            
            if (backendTaskIndex >= 0) {
              allPutawayItems.splice(backendTaskIndex, 1);
              seenIds.delete(backendTaskPrimaryId);
              console.warn(`✅ PutAwayScreen: Removed backend task with primary ID ${backendTaskPrimaryId} to replace with local TC ${id}`);
            }
          }
        }
        
        // Check if this is a closed box - if so, it should only appear if it has an "Open" putaway task
        const status = (localTC.status || "").toUpperCase();
        if (status === "CLOSED") {
          // Closed box - check if it has an "Open" putaway task in backend
          // If backend tasks were loaded, check if this box is in the backend tasks list
          const matchingBackendTask = backendPutawayTasks.find(task => {
            const taskBoxId = normalizeId((task as any).box_id);
            const taskTCId = normalizeId(task.tc_id);
            const taskStatus = ((task as any).putaway_task_status || "").toUpperCase();
            const matches = (taskBoxId === normalizedId || taskTCId === normalizedId) && taskStatus === "OPEN";
            
            if (matches) {
              console.warn(`🔍 PutAwayScreen: Found matching backend task for closed box ${id}:`, {
                taskId: (task as any).putaway_task,
                taskBoxId: (task as any).box_id,
                taskTCId: task.tc_id,
                normalizedLocalId: normalizedId,
                normalizedTaskBoxId: taskBoxId,
                normalizedTaskTCId: taskTCId,
              });
            }
            
            return matches;
          });
          
          if (!matchingBackendTask && backendPutawayTasks.length > 0) {
            // Backend tasks were loaded but this box doesn't have an "Open" task
            console.warn(`⚠️ PutAwayScreen: Skipped closed box ${id} - no Open putaway task found in backend`, {
              backendTasksCount: backendPutawayTasks.length,
              backendTaskIds: backendPutawayTasks.map(t => ({
                putaway_task: (t as any).putaway_task,
                box_id: (t as any).box_id,
                tc_id: t.tc_id,
                normalizedBoxId: normalizeId((t as any).box_id),
                normalizedTCId: normalizeId(t.tc_id),
              })),
              localId: id,
              normalizedLocalId: normalizedId,
            });
            continue;
          }
          
          // If we found a matching backend task, copy the putaway_task and location_id to the local TC
          if (matchingBackendTask) {
            (localTC as any).putaway_task = (matchingBackendTask as any).putaway_task;
            (localTC as any).putaway_task_status = (matchingBackendTask as any).putaway_task_status;
            // Copy header-level location_id from backend task if available
            if ((matchingBackendTask as any).location_id) {
              (localTC as any).location_id = (matchingBackendTask as any).location_id;
              console.warn(`✅ PutAwayScreen: Copied location_id ${(matchingBackendTask as any).location_id} from backend task`);
            }
            console.warn(`✅ PutAwayScreen: Added putaway_task ${(matchingBackendTask as any).putaway_task} to closed box ${id}`);
          }
          // If backend tasks weren't loaded, include the box (will be filtered by backend when task is checked)
        }
        
        // Check if this box/TC has a putaway task in backend (for non-closed items too)
        // Try to find matching backend task to get putaway_task
        // Only do this if we haven't already merged above
        if (!(localTC as any).putaway_task) {
          const matchingTask = backendPutawayTasks.find(task => {
            const taskBoxId = normalizeId((task as any).box_id);
            const taskTCId = normalizeId(task.tc_id);
            const matches = taskBoxId === normalizedId || taskTCId === normalizedId;
            
            if (matches) {
              console.warn(`🔍 PutAwayScreen: Found matching backend task for TC/box ${id}:`, {
                taskId: (task as any).putaway_task,
                taskBoxId: (task as any).box_id,
                taskTCId: task.tc_id,
                normalizedLocalId: normalizedId,
                normalizedTaskBoxId: taskBoxId,
                normalizedTaskTCId: taskTCId,
              });
            }
            
            return matches;
          });
          
          if (matchingTask) {
            // Copy putaway_task and location_id from backend task
            (localTC as any).putaway_task = (matchingTask as any).putaway_task;
            (localTC as any).putaway_task_status = (matchingTask as any).putaway_task_status;
            // Copy header-level location_id from backend task if available
            if ((matchingTask as any).location_id) {
              (localTC as any).location_id = (matchingTask as any).location_id;
              console.warn(`✅ PutAwayScreen: Copied location_id ${(matchingTask as any).location_id} from backend task`);
            }
            console.warn(`✅ PutAwayScreen: Added putaway_task ${(matchingTask as any).putaway_task} to TC/box ${id}`);
          } else if (backendPutawayTasks.length > 0) {
            // Backend tasks exist but no match found - log for debugging
            console.warn(`⚠️ PutAwayScreen: No matching backend task found for ${id}`, {
              backendTasksCount: backendPutawayTasks.length,
              backendTaskIds: backendPutawayTasks.map(t => ({
                putaway_task: (t as any).putaway_task,
                box_id: (t as any).box_id,
                tc_id: t.tc_id,
                normalizedBoxId: normalizeId((t as any).box_id),
                normalizedTCId: normalizeId(t.tc_id),
              })),
              localId: id,
              normalizedLocalId: normalizedId,
            });
          }
        }
        
        // Check if this box/TC has a putaway task in backend
        // If not, it might be a TC that needs putaway but backend hasn't created task yet
        // For now, include it (backend will create task when location is scanned)
        allPutawayItems.push(localTC);
        seenIds.add(normalizedId);
      }
      
      console.warn(`📦 PutAwayScreen: Total ${allPutawayItems.length} putaway items (${backendPutawayTasks.length} from backend, ${warehouseTCs.length} from local)`);
      
      setSealedTCs(allPutawayItems);
      
      // Legacy: Check for putaway tasks from backend API (for remaining items)
      // This ensures we show tasks created by the backend even if they're not in TCs yet
      if (activeASN) {
        try {
          // Try to get putaway tasks from backend
          // Note: Backend may not support source_type parameter, so we try without it first
          let putawayTasks: any = null;
          try {
            // Try without source_type first (most backends don't support it)
            putawayTasks = await apiService.getPutawayTasks({
              status: "Open",
              advance_shipping_notice: activeASN,
            });
          } catch (tasksError: any) {
            // Check both message and details fields for source_type errors
            const errorMessage = tasksError.message || "";
            const errorDetails = tasksError.details || "";
            const errorCode = tasksError.code || "";
            const fullError = `${errorMessage} ${errorDetails} ${errorCode}`.toLowerCase();
            
            // Check if this is a network error (server unreachable, connection failed, etc.)
            const isNetworkError = 
              errorMessage.includes("Network request failed") ||
              errorMessage.includes("Network error") ||
              errorMessage.includes("Failed to connect") ||
              errorMessage.includes("ECONNREFUSED") ||
              errorMessage.includes("ENOTFOUND") ||
              errorMessage.includes("timeout") ||
              tasksError.name === "TypeError" && errorMessage.includes("fetch");
            
            if (isNetworkError) {
              // Network error - backend is not reachable, app will work in offline mode
              // Don't log as error since this is expected when backend is unavailable
              putawayTasks = null;
            } else if (fullError.includes("source_type") || 
                fullError.includes("unknown column") ||
                fullError.includes("pt.source_type") ||
                (errorCode === "DATABASE_ERROR" && fullError.includes("source_type"))) {
              // Backend doesn't support source_type - this is expected, suppress error
              // Don't log as error, just continue without tasks
              putawayTasks = null;
            } else {
              // For other errors, log but don't block the screen
              console.warn(`⚠️ Error fetching putaway tasks:`, tasksError.message || tasksError);
              putawayTasks = null;
            }
          }
          
          let tasksList: any[] = [];
          if (Array.isArray(putawayTasks)) {
            tasksList = putawayTasks;
          } else if (putawayTasks?.data && Array.isArray(putawayTasks.data)) {
            tasksList = putawayTasks.data;
          } else if (putawayTasks?.tasks && Array.isArray(putawayTasks.tasks)) {
            tasksList = putawayTasks.tasks;
          }
          
          // ✅ CRITICAL: Filter out completed tasks even if backend returns them with status=Open
          tasksList = tasksList.filter((task: any) => {
            const taskStatus = (task.status || "").toUpperCase();
            const isCompleted = taskStatus === "COMPLETED";
            if (isCompleted) {
              console.warn(`⚠️ PutAwayScreen: Filtered out completed task ${task.putaway_task || task.task_title || task.id} (status: ${task.status})`);
              return false;
            }
            return true;
          });
          
          // Deduplicate tasks by task title/ID to prevent duplicates
          const uniqueTasks = new Map<string, any>();
          for (const task of tasksList) {
            const taskId = task.putaway_task || task.task_title || task.id || task.task_id;
            if (taskId && !uniqueTasks.has(taskId)) {
              uniqueTasks.set(taskId, task);
            }
          }
          const deduplicatedTasks = Array.from(uniqueTasks.values());
          
          if (deduplicatedTasks.length > 0) {
            console.warn(`✅ PutAwayScreen: Found ${deduplicatedTasks.length} unique putaway task(s) from backend API for ASN ${activeASN} (${tasksList.length} total, ${tasksList.length - deduplicatedTasks.length} duplicates removed)`);
            // Tasks are available - they will be shown when user scans TC/Box
            // The tasks are created by backend and will be used when scanning location
          } else {
            console.warn(`ℹ️ PutAwayScreen: No putaway tasks found in backend for ASN ${activeASN}`);
            console.warn(`   This is normal if:`);
            console.warn(`   - All items were allocated to Transfer Orders (TO)`);
            console.warn(`   - Putaway tasks haven't been created yet`);
            console.warn(`   - All boxes are for stores (not warehouse)`);
            console.warn(`   Note: Putaway tasks are created automatically when warehouse boxes are closed.`);
          }
        } catch (tasksError: any) {
          // Don't block if tasks API fails - app can still work with TCs and remaining items
          const errorMessage = tasksError.message || "";
          const errorDetails = tasksError.details || "";
          const fullError = `${errorMessage} ${errorDetails}`;
          
          // Check if this is a network error
          const isNetworkError = 
            errorMessage.includes("Network request failed") ||
            errorMessage.includes("Network error") ||
            errorMessage.includes("Failed to connect") ||
            errorMessage.includes("ECONNREFUSED") ||
            errorMessage.includes("ENOTFOUND") ||
            errorMessage.includes("timeout") ||
            tasksError.name === "TypeError" && errorMessage.includes("fetch");
          
          if (isNetworkError) {
            // Network error - backend is not reachable, app will work in offline mode
            // Don't log as error since this is expected when backend is unavailable
            // The app is already working with local data, so this is fine
          } else if (tasksError.message?.includes("404") || tasksError.message?.includes("not found")) {
            console.warn(`⚠️ Putaway tasks API endpoint not available (404) - this is optional`);
          } else if (fullError.includes("source_type") || 
                     fullError.includes("Unknown column") ||
                     fullError.includes("pt.source_type")) {
            // Backend doesn't support source_type - this is expected, suppress error
            console.warn(`⚠️ Backend database doesn't support source_type column - this is expected and can be ignored`);
          } else {
            console.warn(`⚠️ Error fetching putaway tasks:`, tasksError.message);
          }
        }
      }
      
      // Remaining items section removed - user prefers to see only TCs/Boxes, not individual items
      // await loadRemainingItems(); // Not needed anymore
    } catch (error: any) {
      console.error("❌ PutAwayScreen: Error loading warehouse TCs:", error);
      setSealedTCs([]);
    } finally {
      setLoading(false);
    }
  }, [activeASN, loadRemainingItems, putawaySourceType]);

  // Load remaining items (items in warehouse boxes that haven't been packed into TCs yet)
  // Enhanced to use dataService.getRemainingItems for full details (shipped_qty, allocated_qty, remaining_qty)
  const loadRemainingItems = useCallback(async () => {
    if (!activeASN) {
      setRemainingItems([]);
      return;
    }

    try {
      // Use dataService.getRemainingItems to get full details
      const allRemainingItems = await dataService.getRemainingItems(activeASN);
      
      const db = await getDatabase();
      if (!db) {
        setRemainingItems([]);
        return;
      }

      // Get items in warehouse boxes that haven't been packed into TCs yet
      const warehouseStores = await db.getAllAsync<{ code: string }>(
        `SELECT code FROM warehouse_store_cache WHERE warehouse_type = 'Warehouse'`
      );
      const warehouseStoreCodes = warehouseStores.map(ws => ws.code);
      const warehousePatterns = ['WAREHOUSE', 'WH-MAIN', 'WH-', ...warehouseStoreCodes];
      const placeholders = warehousePatterns.map(() => '?').join(',');

      const warehouseBoxItems = await db.getAllAsync<{
        item_code: string;
        box_id: string;
        scanned_qty: number;
        asn_no: string;
      }>(
        `SELECT 
          si.item_code, 
          si.box_id, 
          SUM(si.scanned_qty) as scanned_qty, 
          si.asn_no
        FROM scanned_items si
        WHERE si.asn_no = ? 
          AND (
            UPPER(si.store) = 'WAREHOUSE' 
            OR UPPER(si.store) LIKE 'WH-%'
            OR si.store IN (${placeholders})
          )
          AND si.box_id IS NOT NULL
          AND si.box_id != ''
          AND si.box_id NOT IN (
            SELECT DISTINCT box_id 
            FROM event_queue 
            WHERE event_type = 'PACK_BOX_TO_TC' 
              AND box_id IS NOT NULL 
              AND box_id != ''
          )
        GROUP BY si.item_code, si.box_id, si.asn_no
        HAVING scanned_qty > 0
        ORDER BY si.item_code, si.box_id
      `, [activeASN, ...warehousePatterns]);

      // Merge: Use full details from getRemainingItems, add box_id from warehouseBoxItems
      const boxMap = new Map<string, string>(); // item_code -> box_id
      warehouseBoxItems.forEach(boxItem => {
        if (!boxMap.has(boxItem.item_code)) {
          boxMap.set(boxItem.item_code, boxItem.box_id);
        }
      });

      // Combine remaining items with box information
      const remainingItemsList = allRemainingItems
        .filter(item => (item.remaining_qty || 0) > 0)
        .map(item => ({
          ...item,
          box_id: boxMap.get(item.item_code) || item.box_id,
        }));

      console.warn(`📦 PutAwayScreen: Found ${remainingItemsList.length} remaining items with full details`);
      
      setRemainingItems(remainingItemsList);
    } catch (error: any) {
      console.warn(`⚠️ PutAwayScreen: Error loading remaining items:`, error.message);
      setRemainingItems([]);
    }
  }, [activeASN]);

  // Load Put Away transactions
  const loadTransactions = useCallback(async () => {
    console.log("🔄 PutAwayScreen: Loading transactions...");
    setLoading(true);
    try {
      const db = await getDatabase();
      if (!db) {
        console.error("❌ PutAwayScreen: Database not initialized");
        setTransactions([]);
        setLoading(false);
        return;
      }

      // Query PUTAWAY_TO_RACK events only (these have the location/rack info)
      // PUTAWAY_DISPATCH is just a completion marker, so we don't need to show it separately
      // Deduplicate by showing only the most recent event for each TC+rack combination
      // This prevents duplicates when the same TC is scanned multiple times at the same location
      const putAwayEvents = await db.getAllAsync<PutAwayTransaction>(
        `SELECT 
          e1.offline_uuid,
          e1.tc_id,
          e1.rack,
          e1.synced,
          e1.event_time,
          e1.asn_no
        FROM event_queue e1
        INNER JOIN (
          SELECT tc_id, rack, MAX(event_time) as max_time
          FROM event_queue
          WHERE event_type = 'PUTAWAY_TO_RACK'
          GROUP BY tc_id, rack
        ) e2 ON e1.tc_id = e2.tc_id 
          AND e1.rack = e2.rack 
          AND e1.event_time = e2.max_time
        WHERE e1.event_type = 'PUTAWAY_TO_RACK'
        ORDER BY e1.event_time DESC`
      );

      // ✅ FIX: Additional client-side deduplication to prevent multiple identical transactions
      // Group by tc_id + rack combination and keep only the most recent one
      const transactionMap = new Map<string, PutAwayTransaction>();
      for (const event of putAwayEvents) {
        // Create a unique key from tc_id and rack
        const key = `${event.tc_id || 'N/A'}_${event.rack || 'N/A'}`;
        const existing = transactionMap.get(key);
        
        // If no existing transaction, or this one is newer, use this one
        if (!existing || new Date(event.event_time) > new Date(existing.event_time)) {
          transactionMap.set(key, event);
        }
      }
      
      // Convert map back to array
      const uniqueTransactions = Array.from(transactionMap.values());
      
      // Sort by event_time descending (most recent first)
      uniqueTransactions.sort((a, b) => 
        new Date(b.event_time).getTime() - new Date(a.event_time).getTime()
      );

      console.log(
        "✅ PutAwayScreen: Loaded transactions:",
        putAwayEvents.length,
        "→ Deduplicated to:",
        uniqueTransactions.length
      );
      
      if (putAwayEvents.length !== uniqueTransactions.length) {
        console.warn(
          `⚠️ PutAwayScreen: Removed ${putAwayEvents.length - uniqueTransactions.length} duplicate transaction(s)`
        );
      }
      
      setTransactions(uniqueTransactions);
    } catch (error: any) {
      console.error("❌ PutAwayScreen: Error loading transactions:", error);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // ✅ NEW: Verify putaway transaction status from backend
  // This checks if the transaction was actually processed on backend, even if sync failed
  const verifyPutawayTransactionFromBackend = async (
    tcId: string,
    locationId: string,
    asnNo?: string
  ): Promise<boolean> => {
    try {
      const settings = await getSettings();
      if (!settings.api_url || settings.demo_mode === 1) {
        console.log(`ℹ️ Cannot verify from backend - API not configured or demo mode`);
        return false;
      }

      // Check if we're online
      const { isDeviceOnline } = await import("../utils/network-check");
      const online = await isDeviceOnline();
      if (!online) {
        console.log(`ℹ️ Cannot verify from backend - device is offline`);
        return false;
      }

      // Try to verify by checking putaway tasks or events
      // We can check if a putaway task exists with this TC and location
      try {
        const tasks = await apiService.getPutawayTasks({
          asn_no: asnNo,
          status: "Completed,In Progress",
        });

        const taskArray = Array.isArray(tasks) ? tasks : (tasks?.data || []);
        
        // Check if any task matches this TC and location
        const matchingTask = taskArray.find((task: any) => {
          const taskBoxId = task.box_id || task.tc_id || task.transfer_carton_id;
          const taskLocation = task.location_id || task.rack_id || task.bin_id;
          
          return (
            (taskBoxId && taskBoxId.toUpperCase() === tcId.toUpperCase()) &&
            (taskLocation && taskLocation.toUpperCase() === locationId.toUpperCase())
          );
        });

        if (matchingTask) {
          console.log(`✅ Verified putaway transaction in backend: TC ${tcId} at ${locationId}`);
          return true;
        }

        console.log(`ℹ️ Putaway transaction not found in backend tasks: TC ${tcId} at ${locationId}`);
        return false;
      } catch (verifyError: any) {
        console.warn(`⚠️ Error verifying putaway transaction from backend:`, verifyError.message);
        return false;
      }
    } catch (error: any) {
      console.warn(`⚠️ Error verifying putaway transaction:`, error.message);
      return false;
    }
  };

  // ✅ NEW: Retry and verify putaway transaction
  // Syncs the event and verifies from backend before marking as synced
  const handleRetryPutawayTransaction = async (transaction: PutAwayTransaction) => {
    if (!transaction || !transaction.offline_uuid) {
      Alert.alert("Error", "Invalid transaction data");
      return;
    }

    setLoading(true);
    try {
      const settings = await getSettings();
      const db = await getDatabase();

      if (!db) {
        Alert.alert("Error", "Database not initialized");
        return;
      }

      // Step 1: Sync events to backend
      console.log(`🔄 Retrying sync for putaway transaction: ${transaction.tc_id}`);
      const syncResult = await syncEvents();
      console.log(`✅ Sync result: ${syncResult.synced} synced, ${syncResult.failed} failed`);

      // Step 2: Verify from backend if transaction was processed
      const locationId = transaction.rack || transaction.tc_id || "";
      const isVerified = await verifyPutawayTransactionFromBackend(
        transaction.tc_id,
        locationId,
        transaction.asn_no
      );

      if (isVerified) {
        // ✅ Backend confirmed - mark as synced
        await markEventSynced(transaction.offline_uuid);
        console.log(`✅ Transaction ${transaction.tc_id} verified and marked as synced`);

        // Also check and mark PUTAWAY_DISPATCH event if exists
        const dispatchEvent = await db.getFirstAsync<{ offline_uuid: string }>(
          `SELECT offline_uuid FROM event_queue 
           WHERE event_type = 'PUTAWAY_DISPATCH' 
             AND tc_id = ? 
             AND synced = 0 
           LIMIT 1`,
          [transaction.tc_id]
        );

        if (dispatchEvent) {
          await markEventSynced(dispatchEvent.offline_uuid);
          console.log(`✅ Dispatch event also marked as synced for TC ${transaction.tc_id}`);
        }

        // Update TC status to "Completed" if not already
        const tcStatus = await db.getFirstAsync<{ status: string }>(
          "SELECT status FROM tc_cache WHERE tc_id = ?",
          [transaction.tc_id]
        );

        if (tcStatus && tcStatus.status !== "Completed") {
          await dataService.updateTransferCartonStatus(transaction.tc_id, "Completed");
          console.log(`✅ TC ${transaction.tc_id} status updated to Completed`);
        }

        Alert.alert(
          "Success",
          `Putaway transaction verified and completed.\n\nTC: ${transaction.tc_id}\nLocation: ${transaction.rack}\n\nStatus updated in local database.`
        );

        // Reload transactions to refresh the list
        await loadTransactions();
      } else {
        // Backend doesn't confirm - check if event was synced anyway
        const event = await db.getFirstAsync<{ synced: number }>(
          "SELECT synced FROM event_queue WHERE offline_uuid = ?",
          [transaction.offline_uuid]
        );

        if (event && event.synced === 1) {
          // Event was synced but backend doesn't show it - might be pending processing
          Alert.alert(
            "Partial Success",
            `Event synced to backend but verification pending.\n\nTC: ${transaction.tc_id}\nLocation: ${transaction.rack}\n\nBackend may still be processing the transaction. Please check again later.`
          );
          await loadTransactions();
        } else {
          // Event still not synced
          Alert.alert(
            "Sync Failed",
            `Could not sync or verify putaway transaction.\n\nTC: ${transaction.tc_id}\nLocation: ${transaction.rack}\n\nPlease ensure you're online and try again.`
          );
        }
      }
    } catch (error: any) {
      console.error(`❌ Error retrying putaway transaction:`, error);
      Alert.alert("Error", error.message || "Failed to retry putaway transaction");
    } finally {
      setLoading(false);
    }
  };

  // ✅ NEW: Update stock for synced putaway transaction
  // This ensures stock is updated in backend even if the transaction was synced but not completed
  const handleUpdateStockForPutaway = async (transaction: PutAwayTransaction) => {
    if (!transaction || !transaction.tc_id) {
      Alert.alert("Error", "Invalid transaction data");
      return;
    }

    setLoading(true);
    try {
      const settings = await getSettings();
      const db = await getDatabase();

      if (!db) {
        Alert.alert("Error", "Database not initialized");
        return;
      }

      // Check if we're online
      const { isDeviceOnline } = await import("../utils/network-check");
      const online = await isDeviceOnline();
      if (!online) {
        Alert.alert("Offline", "Please ensure you're online to update stock in backend.");
        return;
      }

      const tcId = transaction.tc_id;
      const locationId = transaction.rack || "";
      const asnNo = transaction.asn_no || "";

      console.log(`🔄 Updating stock for putaway transaction: TC ${tcId} at ${locationId}`);

      // Step 1: Try to find putaway task for this TC
      let putawayTask: string | null = null;
      let taskDetails: any = null;
      try {
        // First, try to find task by searching for tasks with matching TC/box ID
        const tasks = await apiService.getPutawayTasks({
          asn_no: asnNo,
          status: "In Progress,Completed",
        });

        const taskArray = Array.isArray(tasks) ? tasks : (tasks?.data || []);
        
        console.log(`📋 Found ${taskArray.length} putaway task(s) for ASN ${asnNo || 'all'}`);
        if (taskArray.length > 0) {
          console.log(`📋 Sample task data:`, {
            title: taskArray[0].title || taskArray[0].putaway_task || taskArray[0].id,
            box_id: taskArray[0].box_id || taskArray[0].tc_id || taskArray[0].transfer_carton_id,
            status: taskArray[0].status,
            asn_no: taskArray[0].asn_no || taskArray[0].advance_shipping_notice,
          });
        }
        
        // Find task matching this TC
        // Strategy 1: Match by box_id/tc_id directly
        // Strategy 2: Match by carton_id prefix (e.g., PAW-ASN365425473-SKU-HAT-301-BLU-OS starts with PAW-ASN365425473-)
        // Strategy 3: Match by checking all tasks with "In Progress" status (if no direct match)
        let matchingTask = taskArray.find((task: any) => {
          const taskBoxId = task.box_id || task.tc_id || task.transfer_carton_id || "";
          
          // Direct match by box_id/tc_id
          if (taskBoxId && taskBoxId.toUpperCase() === tcId.toUpperCase()) {
            return true;
          }
          
          // Match by TC ID prefix (e.g., if TC is PAW-ASN365425473-1768132558343, match tasks with box_id starting with PAW-ASN365425473-)
          const tcIdPrefix = tcId.split('-').slice(0, -1).join('-'); // Remove last segment (timestamp)
          if (tcIdPrefix && taskBoxId.toUpperCase().startsWith(tcIdPrefix.toUpperCase())) {
            return true;
          }
          
          return false;
        });

        // If not found, try matching by status and ASN (fallback for tasks without box_id)
        // Since we can't fetch individual task details (getPutawayTask endpoint doesn't exist),
        // we'll try to match by ASN and "In Progress" status
        if (!matchingTask && taskArray.length > 0) {
          console.log(`ℹ️ No direct match found, trying fallback matching for TC ${tcId}...`);
          
          // Find tasks with matching ASN and "In Progress" status
          // This is a best-effort match when box_id/tc_id isn't available in list response
          const inProgressTasks = taskArray.filter((task: any) => {
            const taskStatus = (task.status || "").toUpperCase();
            const taskASN = task.asn_no || task.advance_shipping_notice || "";
            return taskStatus === "IN PROGRESS" && taskASN.toUpperCase() === (asnNo || "").toUpperCase();
          });
          
          if (inProgressTasks.length === 1) {
            // Only one matching task - likely the correct one
            matchingTask = inProgressTasks[0];
            console.log(`✅ Found matching task by ASN and status: ${matchingTask.title || matchingTask.putaway_task || matchingTask.id}`);
          } else if (inProgressTasks.length > 1) {
            // Multiple matching tasks - can't determine which one
            console.warn(`⚠️ Found ${inProgressTasks.length} tasks with matching ASN and status - cannot determine which one matches TC ${tcId}`);
          }
        }

        if (matchingTask) {
          putawayTask = matchingTask.title || matchingTask.putaway_task || matchingTask.id || null;
          console.log(`✅ Found putaway task: ${putawayTask}`);
          
          // Use task details from the matching task if available
          // Note: The singular getPutawayTask endpoint might not exist on backend
          // So we use the task data from the list response instead
          taskDetails = matchingTask;
          console.log(`✅ Using task data from list for ${putawayTask}:`, {
            status: taskDetails?.status || taskDetails?.data?.status,
            box_id: taskDetails?.box_id || taskDetails?.tc_id,
          });
          
          // Note: We don't try to get full task details since getPutawayTask endpoint doesn't exist
          // We use the task data from the list response instead
          // Items will be retrieved from local DB
        } else {
          console.warn(`⚠️ No putaway task found for TC ${tcId}`);
        }
      } catch (taskError: any) {
        console.warn(`⚠️ Error fetching putaway tasks:`, taskError.message);
      }

      if (!putawayTask) {
        Alert.alert(
          "No Putaway Task",
          `No putaway task found for TC ${tcId}.\n\nStock update requires a putaway task. The transaction may have been completed without a task.\n\nPlease contact administrator to update stock manually.`
        );
        return;
      }

      // Check task status - if already completed, no need to update
      const taskStatus = taskDetails?.status || taskDetails?.data?.status || "";
      if (taskStatus && taskStatus.toUpperCase() === "COMPLETED") {
        Alert.alert(
          "Already Completed",
          `Putaway task ${putawayTask} is already completed.\n\nTC: ${tcId}\nLocation: ${locationId}\n\nStock should already be updated in backend.`
        );
        return;
      }

      // Step 2: Get items - prefer from task details (more accurate), fallback to local DB
      let items: Array<{
        item_code: string;
        qty: number;
        carton_id?: string;
        location_id?: string;
        source_bin?: string;
        target_bin?: string;
        completed?: boolean;
      }> = [];

      // Try to get items from task details first (more reliable)
      if (taskDetails && (taskDetails.lines || taskDetails.data?.lines)) {
        const taskLines = taskDetails.lines || taskDetails.data?.lines || [];
        if (taskLines.length > 0) {
          console.warn(`📋 [CARTON_ID_TRACK] Getting items from task details. Task lines count: ${taskLines.length}`);
          items = taskLines.map((line: any) => {
            const item = {
              item_code: line.item_code || line.itemCode || line.item,
              qty: Number(line.qty || line.quantity || 0),
              // ✅ FIX: Use scanned carton_id if available, otherwise use line's carton_id
              carton_id: selectedCartonOrItem || line.carton_id || line.cartonId || null,
              location_id: locationId || line.location_id || line.locationId,
              source_bin: "DOCK-01",
              target_bin: locationId || line.target_bin || line.targetBin,
              completed: true,
            };
            console.warn(`📋 [CARTON_ID_TRACK] Item from task line: ${item.item_code}, carton_id from line: ${line.carton_id || line.cartonId || 'null'}, final carton_id: ${item.carton_id || 'null'}`);
            return item;
          }).filter((item: any) => item.item_code && item.qty > 0);

          console.log(`✅ Found ${items.length} item(s) from task details for ${putawayTask}`);
          console.warn(`📋 [CARTON_ID_TRACK] Items from task details summary:`, items.map(i => ({ item_code: i.item_code, carton_id: i.carton_id || 'MISSING' })));
          
          // ✅ FIX: For items missing carton_id, look up box_id from scanned_items
          // This is critical for Transfer In items that were put into BOXes
          const itemsMissingCartonId = items.filter((item: any) => !item.carton_id);
          console.warn(`📋 [CARTON_ID_TRACK] Checking for missing carton_id. Total items: ${items.length}, Missing carton_id: ${itemsMissingCartonId.length}`);
          if (itemsMissingCartonId.length > 0) {
            console.warn(`📋 [CARTON_ID_TRACK] Items missing carton_id:`, itemsMissingCartonId.map(i => i.item_code));
          }
          if (itemsMissingCartonId.length > 0 && db) {
            console.warn(`⚠️ Found ${itemsMissingCartonId.length} item(s) without carton_id, looking up box_id from scanned_items...`);
            console.warn(`📋 [CARTON_ID_TRACK] Starting box_id lookup for TC: ${tcId}, ASN: ${asnNo}`);
            
            try {
              // Get boxes that were packed into this TC
              const packedBoxes = await db.getAllAsync<{ box_id: string }>(
                `SELECT DISTINCT box_id 
                 FROM event_queue 
                 WHERE event_type = 'PACK_BOX_TO_TC' 
                   AND tc_id = ? 
                   AND box_id IS NOT NULL 
                   AND box_id != ''`,
                [tcId]
              );
              
              if (packedBoxes.length > 0) {
                const boxIds = packedBoxes.map(b => b.box_id);
                const placeholders = boxIds.map(() => '?').join(',');
                const itemCodes = itemsMissingCartonId.map((i: any) => i.item_code);
                const itemPlaceholders = itemCodes.map(() => '?').join(',');
                
                // Look up box_id for items missing carton_id
                const boxIdLookup = await db.getAllAsync<{
                  item_code: string;
                  box_id: string;
                }>(
                  `SELECT DISTINCT item_code, box_id
                   FROM scanned_items
                   WHERE box_id IN (${placeholders})
                     AND item_code IN (${itemPlaceholders})
                     AND asn_no = ?
                   GROUP BY item_code, box_id`,
                  [...boxIds, ...itemCodes, asnNo || '']
                );
                
                // Create a map of item_code -> box_id (use first box_id found for each item)
                const boxIdMap = new Map<string, string>();
                for (const lookup of boxIdLookup) {
                  if (!boxIdMap.has(lookup.item_code)) {
                    boxIdMap.set(lookup.item_code, lookup.box_id);
                  }
                }
                
                // Update items with box_id as carton_id
                console.warn(`📋 [CARTON_ID_TRACK] Box ID lookup results:`, Array.from(boxIdMap.entries()).map(([code, boxId]) => ({ item_code: code, box_id: boxId })));
                for (const item of items) {
                  if (!item.carton_id && boxIdMap.has(item.item_code)) {
                    const foundBoxId = boxIdMap.get(item.item_code);
                    item.carton_id = foundBoxId;
                    console.warn(`📦 [CARTON_ID_TRACK] ✅ Added box_id as carton_id for item ${item.item_code}: ${foundBoxId}`);
                  } else if (!item.carton_id) {
                    console.warn(`📦 [CARTON_ID_TRACK] ❌ No box_id found for item ${item.item_code} in lookup map`);
                  }
                }
                console.warn(`📋 [CARTON_ID_TRACK] After box_id lookup, items status:`, items.map(i => ({ item_code: i.item_code, carton_id: i.carton_id || 'STILL MISSING' })));
              } else {
                // No boxes found - might be a Putaway box (BOX ID = TC ID)
                // Check if items are in scanned_items with tcId as box_id
                const itemCodes = itemsMissingCartonId.map((i: any) => i.item_code);
                const itemPlaceholders = itemCodes.map(() => '?').join(',');
                
                const directBoxIdLookup = await db.getAllAsync<{
                  item_code: string;
                  box_id: string;
                }>(
                  `SELECT DISTINCT item_code, box_id
                   FROM scanned_items
                   WHERE box_id = ?
                     AND item_code IN (${itemPlaceholders})
                     AND asn_no = ?
                   GROUP BY item_code, box_id`,
                  [tcId, ...itemCodes, asnNo || '']
                );
                
                if (directBoxIdLookup.length > 0) {
                  console.warn(`📋 [CARTON_ID_TRACK] Direct box_id lookup found ${directBoxIdLookup.length} record(s) for Putaway box ${tcId}`);
                  // ✅ FIX: Use box_id from lookup (not tcId if it's PUT-* format)
                  // For Putaway boxes, use the actual box_id from scanned_items (should be CTN-* or BOX-* format)
                  for (const item of items) {
                    if (!item.carton_id) {
                      const matchingLookup = directBoxIdLookup.find(l => l.item_code === item.item_code);
                      if (matchingLookup && matchingLookup.box_id) {
                        // ✅ Use box_id from lookup (should be in CTN-* or BOX-* format, not PUT-*)
                        if (!matchingLookup.box_id.startsWith("PUT-")) {
                          item.carton_id = matchingLookup.box_id;
                          console.warn(`📦 [CARTON_ID_TRACK] ✅ Added box_id (${matchingLookup.box_id}) as carton_id for item ${item.item_code} in Putaway box`);
                        } else {
                          console.warn(`📦 [CARTON_ID_TRACK] ⚠️ box_id from lookup is PUT-* format (${matchingLookup.box_id}), skipping - need CTN-* format`);
                        }
                      } else {
                        console.warn(`📦 [CARTON_ID_TRACK] ❌ Item ${item.item_code} not found in directBoxIdLookup for Putaway box ${tcId}`);
                      }
                    }
                  }
                  console.warn(`📋 [CARTON_ID_TRACK] After Putaway box lookup, items status:`, items.map(i => ({ item_code: i.item_code, carton_id: i.carton_id || 'STILL MISSING' })));
                } else {
                  console.warn(`📋 [CARTON_ID_TRACK] ❌ No direct box_id lookup results for Putaway box ${tcId}`);
                }
              }
            } catch (lookupError: any) {
              console.warn(`⚠️ Error looking up box_id for items:`, lookupError.message);
              // Continue without box_id - backend will reject if required
            }
          }
        }
      }

      // Fallback: Get items from local scanned_items if task details don't have items
      if (items.length === 0) {
        try {
        // Get boxes that were packed into this TC
        const packedBoxes = await db.getAllAsync<{ box_id: string }>(
          `SELECT DISTINCT box_id 
           FROM event_queue 
           WHERE event_type = 'PACK_BOX_TO_TC' 
             AND tc_id = ? 
             AND box_id IS NOT NULL 
             AND box_id != ''`,
          [tcId]
        );

        if (packedBoxes.length > 0) {
          // Get scanned items from those boxes
          const boxIds = packedBoxes.map(b => b.box_id);
          const placeholders = boxIds.map(() => '?').join(',');
          
          // ✅ FIX: Get box_id along with items to include as carton_id
          const scannedItems = await db.getAllAsync<{
            item_code: string;
            scanned_qty: number;
            box_id: string;
          }>(
            `SELECT item_code, SUM(scanned_qty) as scanned_qty, box_id
             FROM scanned_items
             WHERE box_id IN (${placeholders})
               AND asn_no = ?
             GROUP BY item_code, box_id
             HAVING scanned_qty > 0`,
            [...boxIds, asnNo || '']
          );

          // ✅ FIX: Track box_id per item for Transfer In items (box_id needs to be sent as carton_id)
          const itemBoxMap = new Map<string, { qty: number; box_id: string }[]>();
          for (const item of scannedItems) {
            const key = item.item_code;
            if (!itemBoxMap.has(key)) {
              itemBoxMap.set(key, []);
            }
            const itemList = itemBoxMap.get(key)!;
            const existingBox = itemList.find(b => b.box_id === item.box_id);
            if (existingBox) {
              existingBox.qty += item.scanned_qty || 0;
            } else {
              itemList.push({ qty: item.scanned_qty || 0, box_id: item.box_id });
            }
          }

          items = Array.from(itemBoxMap.entries()).map(([item_code, boxList]) => {
            const totalQty = boxList.reduce((sum, b) => sum + b.qty, 0);
            const primaryBoxId = boxList[0]?.box_id;
            const item: any = {
              item_code,
              qty: Number(totalQty.toFixed(2)),
              location_id: locationId,
              source_bin: "DOCK-01",
              target_bin: locationId,
              completed: true,
            };
            // ✅ FIX: Include box_id as carton_id for Transfer In items from BOXes
            if (primaryBoxId) {
              item.carton_id = primaryBoxId;
              console.warn(`📦 [CARTON_ID_TRACK] ✅ Including box_id as carton_id for item ${item_code}: ${primaryBoxId}`);
            } else {
              console.warn(`📦 [CARTON_ID_TRACK] ❌ No primaryBoxId found for item ${item_code} from fallback boxes`);
            }
            return item;
          });
          
          console.warn(`📋 [CARTON_ID_TRACK] Fallback items from boxes summary:`, items.map(i => ({ item_code: i.item_code, carton_id: i.carton_id || 'MISSING' })));

          console.log(`✅ Found ${items.length} item(s) from boxes for TC ${tcId}`);
        } else {
          // No boxes found - might be a Putaway box (BOX ID = TC ID)
          const directItems = await db.getAllAsync<{
            item_code: string;
            scanned_qty: number;
          }>(
            `SELECT item_code, SUM(scanned_qty) as scanned_qty
             FROM scanned_items
             WHERE box_id = ?
               AND asn_no = ?
             GROUP BY item_code
             HAVING scanned_qty > 0`,
            [tcId, asnNo || '']
          );

          // ✅ FIX: Get box_id from scanned_items for all items at once (more efficient)
          let boxIdMap = new Map<string, string>(); // item_code -> box_id
          try {
            const db = await getDatabase();
            if (db && tcId) {
              const itemCodes = directItems.map(i => i.item_code);
              const placeholders = itemCodes.map(() => '?').join(',');
              
              const boxIdLookup = await db.getAllAsync<{ item_code: string; box_id: string }>(
                `SELECT DISTINCT item_code, box_id 
                 FROM scanned_items 
                 WHERE box_id = ? 
                   AND item_code IN (${placeholders})
                   AND asn_no = ?`,
                [tcId, ...itemCodes, asnNo || '']
              );
              
              for (const lookup of boxIdLookup) {
                if (!boxIdMap.has(lookup.item_code) && lookup.box_id && !lookup.box_id.startsWith("PUT-")) {
                  boxIdMap.set(lookup.item_code, lookup.box_id);
                }
              }
              
              console.warn(`📦 [CARTON_ID_TRACK] Found ${boxIdMap.size} box_id(s) from scanned_items for Putaway box ${tcId}`);
            }
          } catch (boxIdError: any) {
            console.warn(`⚠️ Error getting box_id from scanned_items: ${boxIdError.message}`);
          }
          
          items = directItems.map(item => {
            const itemObj: any = {
              item_code: item.item_code,
              qty: Number((item.scanned_qty || 0).toFixed(2)),
              location_id: locationId,
              source_bin: "DOCK-01",
              target_bin: locationId,
              completed: true,
            };
            
            // ✅ FIX: Use box_id from lookup map (should be CTN-* or BOX-* format, not PUT-*)
            const boxIdFromMap = boxIdMap.get(item.item_code);
            if (boxIdFromMap) {
              itemObj.carton_id = boxIdFromMap;
              console.warn(`📦 [CARTON_ID_TRACK] ✅ Using box_id (${boxIdFromMap}) from scanned_items for item ${item.item_code}`);
            } else if (tcId && !tcId.startsWith("PUT-")) {
              // Only use tcId if it's not PUT-* format
              itemObj.carton_id = tcId;
              console.warn(`📦 [CARTON_ID_TRACK] ✅ Using tcId (${tcId}) as carton_id for item ${item.item_code} (not PUT-* format)`);
            } else {
              console.warn(`📦 [CARTON_ID_TRACK] ⚠️ Cannot set carton_id for item ${item.item_code} - tcId is PUT-* format (${tcId}) or box_id not found in scanned_items`);
            }
            
            return itemObj;
          });
          
          console.warn(`📋 [CARTON_ID_TRACK] Fallback direct items summary:`, items.map(i => ({ item_code: i.item_code, carton_id: i.carton_id || 'MISSING' })));

          console.log(`✅ Found ${items.length} item(s) directly from scanned_items for TC ${tcId}`);
        }
        } catch (itemsError: any) {
          console.warn(`⚠️ Error getting items:`, itemsError.message);
          Alert.alert(
            "Warning",
            `Could not retrieve items for stock update.\n\nItems: ${itemsError.message}\n\nWill try to update without items array.`
          );
        }
      }

      // Step 3: Call completePutaway API to update stock
      // ✅ NEW: Use validated data instead of putaway_task (which will be created by backend)
      try {
        // ✅ NEW: Validate that we have validated data before completing
        if (!validatedData || (!validatedData.carton_id && !validatedData.box_id)) {
          Alert.alert(
            "Validation Required",
            "Please validate carton/box and location before completing putaway."
          );
          setLoading(false);
          return;
        }
        
        if (!validatedData.location_id) {
          Alert.alert(
            "Validation Required",
            "Please validate location before completing putaway."
          );
          setLoading(false);
          return;
        }
        
        if (!isReadyForCompletion) {
          Alert.alert(
            "Not Ready",
            "Carton and location must be validated before completing putaway."
          );
          setLoading(false);
          return;
        }
        
        // ✅ NEW: Send validated data to complete endpoint
        // The endpoint will create putaway task, lines, and update stock
        // ✅ CRITICAL: For ASN putaway, if validatedData.box_id is PUT-* format, we need to get carton_id from task lines
        let cartonIdForRequest: string | undefined = undefined;
        const sourceType = (selectedTCObj as any).source_type || "ASN";
        const isTransferIn = sourceType === "TransferIn";
        
        // ✅ FIX: For ASN tasks, if box_id is PUT-* format (task ID), get carton_id from task lines
        if (!isTransferIn && validatedData.box_id && validatedData.box_id.startsWith("PUT-")) {
          console.warn(`⚠️ ASN Putaway: box_id is PUT-* format (${validatedData.box_id}), need to get carton_id from task lines`);
          
          // ✅ Priority 1: Try to get carton_id from already-loaded task lines in selectedTCObj
          const taskLines = (selectedTCObj as any).task_lines;
          if (taskLines && Array.isArray(taskLines) && taskLines.length > 0) {
            // Check all lines for carton_id (not just first line)
            for (const line of taskLines) {
              const cartonIdFromLine = line.carton_id || line.box_id || (line as any).carton_ID;
              if (cartonIdFromLine && (cartonIdFromLine.startsWith("CTN-") || cartonIdFromLine.startsWith("BOX-") || cartonIdFromLine.startsWith("PAW-"))) {
                cartonIdForRequest = cartonIdFromLine;
                console.warn(`✅ ASN Putaway: Found carton_id from task lines: ${cartonIdFromLine}`);
                break;
              }
            }
          }
          
          // ✅ Priority 2: Try to get carton_id from box_id in selectedTCObj
          if (!cartonIdForRequest) {
            const boxIdFromObj = (selectedTCObj as any).box_id;
            if (boxIdFromObj && (boxIdFromObj.startsWith("CTN-") || boxIdFromObj.startsWith("BOX-") || boxIdFromObj.startsWith("PAW-"))) {
              cartonIdForRequest = boxIdFromObj;
              console.warn(`✅ ASN Putaway: Using box_id from selectedTCObj: ${boxIdFromObj}`);
            }
          }
          
          // ✅ Priority 3: Try to get carton_id from scanned_items (for items in this task)
          if (!cartonIdForRequest && items.length > 0) {
            // Get carton_id from items array (should have been populated earlier)
            const itemWithCartonId = items.find((item: any) => item.carton_id && !item.carton_id.startsWith("PUT-"));
            if (itemWithCartonId && itemWithCartonId.carton_id) {
              cartonIdForRequest = itemWithCartonId.carton_id;
              console.warn(`✅ ASN Putaway: Found carton_id from items array: ${cartonIdForRequest}`);
            }
          }
          
          // ✅ Priority 4: Try to fetch full task details (handle 404 gracefully)
          // Note: This endpoint might not exist (404), so we only try if we haven't found carton_id yet
          // and we don't already have task_lines loaded (to avoid unnecessary API calls)
          if (!cartonIdForRequest && putawayTask && (!taskLines || taskLines.length === 0)) {
            try {
              console.warn(`⚠️ ASN Putaway: Fetching full task details for ${putawayTask} to get carton_id...`);
              const fullTask = await apiService.getPutawayTask(putawayTask);
              // ✅ Handle response format: { ok: true, data: { items: [...] } }
              const fullTaskData = fullTask?.data || fullTask;
              const taskItems = fullTaskData?.items || fullTaskData?.lines || [];
              
              if (Array.isArray(taskItems) && taskItems.length > 0) {
                for (const item of taskItems) {
                  const cartonId = item.carton_id || item.box_id || (item as any).carton_ID;
                  if (cartonId && (cartonId.startsWith("CTN-") || cartonId.startsWith("BOX-") || cartonId.startsWith("PAW-"))) {
                    cartonIdForRequest = cartonId;
                    console.warn(`✅ ASN Putaway: Found carton_id from full task details: ${cartonId}`);
                    break;
                  }
                }
              }
            } catch (fetchError: any) {
              // ✅ Handle 404 gracefully - endpoint might not exist (don't log as error)
              const errorMsg = fetchError.message || "";
              if (errorMsg.includes("404") || errorMsg.includes("not found") || errorMsg.includes("Route")) {
                // Silently skip - endpoint doesn't exist, which is expected
                console.warn(`ℹ️ ASN Putaway: getPutawayTask endpoint not available (404) - using other methods`);
              } else {
                console.warn(`⚠️ ASN Putaway: Error fetching full task details: ${errorMsg}`);
              }
            }
          } else if (!cartonIdForRequest && taskLines && taskLines.length > 0) {
            console.warn(`ℹ️ ASN Putaway: Skipping getPutawayTask API call - already have task_lines loaded`);
          }
          
          // ✅ Priority 5: Try to get from scanned_items database
          if (!cartonIdForRequest) {
            try {
              const db = await getDatabase();
              if (db && items.length > 0) {
                const firstItemCode = items[0]?.item_code;
                if (firstItemCode) {
                  const boxIdFromDB = await db.getFirstAsync<{ box_id: string }>(
                    `SELECT DISTINCT box_id 
                     FROM scanned_items 
                     WHERE box_id != ? 
                       AND box_id NOT LIKE 'PUT-%'
                       AND box_id NOT LIKE 'TI-PUT-%'
                       AND item_code = ? 
                       AND asn_no = ? 
                     LIMIT 1`,
                    [validatedData.box_id, firstItemCode, selectedTCObj.asn_no || '']
                  );
                  
                  if (boxIdFromDB && boxIdFromDB.box_id && (boxIdFromDB.box_id.startsWith("CTN-") || boxIdFromDB.box_id.startsWith("BOX-") || boxIdFromDB.box_id.startsWith("PAW-"))) {
                    cartonIdForRequest = boxIdFromDB.box_id;
                    console.warn(`✅ ASN Putaway: Found carton_id from scanned_items: ${cartonIdForRequest}`);
                  }
                }
              }
            } catch (dbError: any) {
              console.warn(`⚠️ ASN Putaway: Error querying scanned_items: ${dbError.message}`);
            }
          }
          
          // ✅ CRITICAL: If still no valid carton_id, throw error with helpful message
          if (!cartonIdForRequest) {
            throw new Error(
              `Putaway requires carton ID (CTN-* format). Old format (TI-PUT-* or PUT-*) is no longer supported.\n\n` +
              `Task ID: ${validatedData.box_id}\n\n` +
              `Please ensure the putaway task has a valid carton_id (CTN-*) in the task lines.\n\n` +
              `Location: ${validatedData.location_id || locationId}`
            );
          }
        } else {
          // Use validatedData.carton_id or box_id if it's in correct format
          cartonIdForRequest = validatedData.carton_id || 
                              (validatedData.box_id && (validatedData.box_id.startsWith("CTN-") || validatedData.box_id.startsWith("BOX-") || validatedData.box_id.startsWith("PAW-")) 
                                ? validatedData.box_id 
                                : undefined);
        }
        
        const requestBody: any = {
          // ✅ CRITICAL: Send carton_id in CTN-* format (not PUT-* task ID)
          // For ASN: use carton_id from task lines if box_id is PUT-* format
          // For Transfer In: use carton_id (CTN-TI-* format)
          carton_id: cartonIdForRequest || validatedData.carton_id || undefined,
          box_id: (validatedData.box_id && !validatedData.box_id.startsWith("PUT-")) ? validatedData.box_id : undefined,
          location_id: validatedData.location_id,
          completed_by: settings.user_id || settings.user_code || undefined,
          performed_by: settings.user_id || settings.user_code || undefined,
          // Include putaway_task only if it exists (for backward compatibility with legacy workflow)
          ...(putawayTask ? { putaway_task: putawayTask } : {}),
        };
        
        // ✅ Note: items array is optional - backend can get items from carton/box
        // If we have items from task details, include them for better accuracy

        // ✅ NEW: Include items if available (optional - backend can get from carton/box)
        // ✅ CRITICAL: Ensure all items have carton_id in CTN-* format (not PUT-* task ID)
        if (items.length > 0) {
          // Update items to use correct carton_id format
          const updatedItems = items.map((item: any) => {
            // If item has carton_id in PUT-* format, replace with correct carton_id
            if (item.carton_id && item.carton_id.startsWith("PUT-") && cartonIdForRequest) {
              console.warn(`⚠️ Item ${item.item_code} has PUT-* carton_id (${item.carton_id}), replacing with ${cartonIdForRequest}`);
              return {
                ...item,
                carton_id: cartonIdForRequest,
              };
            }
            // If item doesn't have carton_id but we have one, add it
            if (!item.carton_id && cartonIdForRequest) {
              console.warn(`⚠️ Item ${item.item_code} missing carton_id, adding ${cartonIdForRequest}`);
              return {
                ...item,
                carton_id: cartonIdForRequest,
              };
            }
            return item;
          });
          
          requestBody.items = updatedItems;
          console.log(`📤 Sending ${updatedItems.length} item(s) to complete putaway:`, JSON.stringify(updatedItems, null, 2));
        } else {
          console.warn(`⚠️ No items found - backend will get items from carton/box`);
        }

        const response = await apiService.completePutaway(requestBody);
        console.log(`✅ Putaway completion API response:`, JSON.stringify(response).substring(0, 500));

        // Step 4: Completion API called successfully
        // ✅ NEW: Backend creates putaway_task, lines, and updates stock in one transaction
        const createdPutawayTask = response?.data?.putaway_task || response?.putaway_task || "N/A";
        Alert.alert(
          "Success",
          `Putaway completed successfully!\n\n` +
          `Carton/Box: ${validatedData.carton_id || validatedData.box_id || tcId}\n` +
          `Location: ${validatedData.location_id || locationId}\n` +
          `Putaway Task: ${createdPutawayTask}\n` +
          `Items: ${items.length}\n\n` +
          `Stock has been updated in backend.`
        );

        // ✅ NEW: Reset validation state after successful completion
        setValidatedData(null);
        setIsReadyForCompletion(false);
        
        // ✅ NEW: Mark TC as completed
        setCompletedTCs(prev => new Set(prev).add(selectedTC || ''));
        
        // ✅ NEW: Navigate back to list
        setWorkflowState("PUTAWAY_LIST");
        
        // Reload transactions to refresh status
        await loadTransactions();
        
        // Reload sealed TCs to remove completed one
        await loadSealedTCs();
      } catch (apiError: any) {
        console.error(`❌ Error updating stock:`, apiError);
        
        const errorMessage = apiError.message || apiError.toString() || "Unknown error";
        Alert.alert(
          "Stock Update Failed",
          `Failed to update stock in backend.\n\nError: ${errorMessage}\n\nTC: ${tcId}\nLocation: ${locationId}\n\nPlease check backend logs or contact administrator.`
        );
      }
    } catch (error: any) {
      console.error(`❌ Error updating stock for putaway:`, error);
      Alert.alert("Error", error.message || "Failed to update stock for putaway transaction");
    } finally {
      // ✅ NEW: Always reset loading and completing states
      setLoading(false);
      setIsCompleting(false);
    }
  };

  // Load sealed TCs when screen is focused
  useFocusEffect(
    useCallback(() => {
      if (workflowState === "PUTAWAY_LIST") {
        loadSealedTCs();
      } else if (workflowState === "PUTAWAY_TRANSACTIONS") {
        loadTransactions();
      } else if (workflowState === "SCAN_LOCATION") {
        // ✅ Auto-focus Location ID input when screen opens
        setTimeout(() => {
          locationInputRef.current?.focus();
        }, 300); // Small delay to ensure screen is fully rendered
      }
    }, [loadSealedTCs, loadTransactions, workflowState])
  );
  
  // ✅ Also focus when workflowState changes to SCAN_LOCATION
  useEffect(() => {
    if (workflowState === "SCAN_LOCATION") {
      // Focus the location input when entering SCAN_LOCATION state
      setTimeout(() => {
        locationInputRef.current?.focus();
      }, 300);
    }
  }, [workflowState]);

  // Also load on initial mount and when filter changes
  useEffect(() => {
    if (workflowState === "PUTAWAY_LIST") {
      loadSealedTCs();
    }
  }, [loadSealedTCs, workflowState, putawaySourceType]);

  // Step 11: Handle TC selection (double tap or scan)
  const handleTCSelection = async (tcId: string) => {
    const now = Date.now();
    const tc = sealedTCs.find((t) => t.tc_id === tcId);

    if (!tc) {
      Alert.alert("Error", `Putaway task ${tcId} not found`);
      return;
    }

    const selectTC = async () => {
      const sourceType = (tc as any).source_type || "ASN";
      const isTransferIn = sourceType === "TransferIn";
      
      setSelectedTC(tcId);
      setSelectedTCObj(tc);
      
      // ✅ NEW: Reset validation state when selecting new TC
      setValidatedData(null);
      setIsReadyForCompletion(false);
      
      // For Transfer In tasks, we already have the putaway_task
      // Simplified workflow: Skip carton/item scanning, go directly to location scan
      if (isTransferIn && (tc as any).putaway_task) {
        setPutawayTask((tc as any).putaway_task);
        setSelectedCartonOrItem(null); // Reset (not needed for simplified workflow)
        setSelectedItemCode(null); // Reset (not needed for simplified workflow)
        // For Transfer In, go directly to location scan (backend assigns location to all items)
        setWorkflowState("SCAN_LOCATION");
      } else {
        setPutawayTask(null); // Reset putaway task when selecting new TC
        // ✅ NEW: For validation-only workflow, we'll validate carton and location
        // For ASN tasks, go directly to location scan
        // The validation API will validate both carton and location when location is scanned
        setWorkflowState("SCAN_LOCATION");
      }
    };

    if (lastTap && lastTap.tcId === tcId && now - lastTap.time < 500) {
      // Double tap detected
      setLastTap(null);
      await selectTC();
    } else {
      // First tap - set timer for potential double tap
      setLastTap({ tcId, time: now });

      // If no second tap within 500ms, treat as single tap (select)
      setTimeout(() => {
        setLastTap((prev) => {
          if (prev && prev.tcId === tcId && Date.now() - prev.time >= 500) {
            // Single tap - select TC
            selectTC();
            return null;
          }
          return prev;
        });
      }, 500);
    }
  };

  // Step 11: Scan TC
  const handleTCScan = async (barcode: string) => {
    const scannedValue = barcode.trim().toUpperCase();
    
        // Check if scanned value is a BOX ID (starts with "BOX-" or "PAW-")
        if (scannedValue.startsWith("BOX-") || scannedValue.startsWith("PAW-")) {
          // User scanned a BOX - check if it's a warehouse box (closed and ready for putaway)
          try {
            const db = await getDatabase();
            if (!db) {
              Alert.alert("Error", "Database not available");
              return;
            }

            // Get box details
            const box = await db.getFirstAsync<{ 
              box_id: string; 
              purpose: string | null; 
              store: string; 
              status: string;
              asn_no: string;
            }>(
              `SELECT box_id, purpose, store, status, asn_no 
               FROM box_cache 
               WHERE box_id = ?`,
              [scannedValue]
            );

            if (!box) {
              Alert.alert("Box Not Found", `Box ${scannedValue} not found in local database.`);
              return;
            }

            // Check if box is closed
            if (box.status !== "Closed" && box.status !== "CLOSED" && box.status !== "closed") {
              Alert.alert(
                "Box Not Closed",
                `Box ${scannedValue} is not closed.\n\nCurrent status: ${box.status}\n\nPlease close the box in Box Management first.`
              );
              return;
            }

            // Check if store is warehouse using isWarehouse function (MANDATORY - no hardcoded values)
            const isWarehouse = await dataService.isWarehouse(box.store || "");
            if (!isWarehouse) {
              Alert.alert(
                "Not a Warehouse Box",
                `Box ${scannedValue} destination store is not a warehouse.\n\nStore: ${box.store}\n\nPlease use Packing screen for this box.`
              );
              return;
            }

            // ✅ NEW: Check if it's a Putaway box (purpose="PUTAWAY" or starts with "PAW-" or "TI-")
            // Transfer In boxes use TI- naming series (e.g., "TI-PUT-20260120-0001")
            const isPutawayBox = box.purpose === "PUTAWAY" || scannedValue.startsWith("PAW-") || scannedValue.startsWith("TI-");
            const isTransferInBox = scannedValue.startsWith("TI-") || scannedValue.startsWith("TI-PUT-");
            
            if (isPutawayBox) {
              // This is a Putaway box - BOX ID = TC ID
              // Check if it's in the sealed list (as a TC)
              const tc = sealedTCs.find((t) => t.tc_id === scannedValue);
              if (tc) {
                // Found in sealed list - use it directly
                setSelectedTC(scannedValue); // BOX ID = TC ID
                setSelectedTCObj(tc);
                setPutawayTask(null);
                // ✅ NEW: Reset validation state
                setValidatedData(null);
                setIsReadyForCompletion(false);
                setWorkflowState("SCAN_LOCATION");
                console.warn(`✅ Putaway box ${scannedValue} scanned (BOX ID = TC ID)`);
                return;
              } else {
                // Putaway box exists but not in sealed list - create TC object for it
                // ✅ NEW: Determine source type based on box ID format
                const sourceType = isTransferInBox ? "TransferIn" : "ASN";
                const boxAsTC = {
                  tc_id: scannedValue,
                  asn_no: box.asn_no,
                  store: box.store,
                  status: "Closed",
                  source_type: sourceType, // ✅ NEW: Mark as TransferIn or ASN
                };
                setSelectedTC(scannedValue);
                setSelectedTCObj(boxAsTC);
                setPutawayTask(null);
                // ✅ NEW: Reset validation state
                setValidatedData(null);
                setIsReadyForCompletion(false);
                setWorkflowState("SCAN_LOCATION");
                console.warn(`✅ Putaway box ${scannedValue} scanned (not in sealed list, using directly, source_type: ${sourceType})`);
                return;
              }
            }

            // Regular warehouse box (not Putaway box) - NEW WORKFLOW: can be used directly
            // Check if it's part of a TC first
            const tcForBox = await db.getFirstAsync<{ tc_id: string }>(
              `SELECT DISTINCT tc_id 
               FROM event_queue 
               WHERE event_type = 'PACK_BOX_TO_TC' 
                 AND box_id = ? 
                 AND tc_id IS NOT NULL 
                 AND tc_id != ''
               ORDER BY event_time DESC
               LIMIT 1`,
              [scannedValue]
            );

            if (tcForBox && tcForBox.tc_id) {
              // Box is part of a TC - find that TC in sealed list
              const tc = sealedTCs.find((t) => t.tc_id === tcForBox.tc_id);
              if (tc) {
                Alert.alert(
                  "Box Found in TC",
                  `Box ${scannedValue} is part of Putaway box ${tcForBox.tc_id}.\n\nUsing TC ${tcForBox.tc_id} for putaway.`,
                  [
                    {
                      text: "OK",
                      onPress: () => {
                        setSelectedTC(tcForBox.tc_id);
                        setSelectedTCObj(tc);
                        setPutawayTask(null);
                        setWorkflowState("SCAN_LOCATION");
                      },
                    },
                  ]
                );
                return;
              } else {
                Alert.alert(
                  "TC Not Available",
                  `Box ${scannedValue} is part of Putaway box ${tcForBox.tc_id}, but that TC is not available for putaway.\n\nPlease ensure the TC is sealed and belongs to a warehouse.`
                );
                return;
              }
            } else {
              // NEW WORKFLOW: Regular warehouse box not packed into TC - can be used directly
              // Backend will handle creating/updating putaway task when location is scanned
              const boxAsTC = {
                tc_id: scannedValue, // Use box_id as tc_id for warehouse boxes
                asn_no: box.asn_no,
                store: box.store,
                status: "Closed",
              };
              setSelectedTC(scannedValue);
              setSelectedTCObj(boxAsTC);
              setPutawayTask(null);
              // ✅ NEW: Reset validation state
              setValidatedData(null);
              setIsReadyForCompletion(false);
              setWorkflowState("SCAN_LOCATION");
              console.warn(`✅ Warehouse box ${scannedValue} scanned (will use box_id for putaway)`);
              return;
            }
          } catch (error: any) {
            console.error("❌ Error checking box:", error);
            Alert.alert("Error", `Failed to process box scan: ${error.message}`);
            return;
          }
        }

    // Scanned value is not a BOX - treat as TC ID
    const tc = sealedTCs.find((t) => t.tc_id === scannedValue);

    if (!tc) {
      // Check if it might be a TC that exists but isn't sealed/dispatched
      try {
        const db = await getDatabase();
        const existingTC = await db.getFirstAsync<{ tc_id: string; status: string; store: string }>(
          `SELECT tc_id, status, store FROM tc_cache WHERE tc_id = ?`,
          [scannedValue]
        );

        if (existingTC) {
          // TC exists but not in sealed list
          const isWarehouse = await dataService.isWarehouse(existingTC.store || "");
          if (!isWarehouse) {
            Alert.alert(
              "Not a Warehouse TC",
              `Putaway box ${scannedValue} belongs to ${existingTC.store}, which is not a warehouse.\n\nOnly warehouse Putaway boxes can be put away.`
            );
          } else if (existingTC.status !== "Sealed" && existingTC.status !== "Dispatched") {
            Alert.alert(
              "TC Not Ready",
              `Putaway box ${scannedValue} is ${existingTC.status}, but needs to be "Sealed" or "Dispatched" for putaway.\n\nCurrent status: ${existingTC.status}\n\nPlease seal or dispatch the TC first.`
            );
          } else {
            Alert.alert(
              "TC Not Found",
              `Putaway box ${scannedValue} exists but is not available for putaway.\n\nStatus: ${existingTC.status}\nStore: ${existingTC.store}\n\nPlease ensure the TC is sealed/dispatched and belongs to a warehouse.`
            );
          }
        } else {
          Alert.alert(
            "Putaway box Not Found",
            `Putaway box ${scannedValue} not found.\n\nPlease ensure:\n• The TC exists\n• The TC is sealed or dispatched\n• The TC belongs to a warehouse\n• You have synced the latest data`
          );
        }
      } catch (error: any) {
        console.error("❌ Error checking TC:", error);
        Alert.alert(
          "Error",
          `Putaway box ${scannedValue} not found in sealed list. Please ensure it is sealed and belongs to warehouse.`
        );
      }
      return;
    }

    const sourceType = (tc as any).source_type || "ASN";
    const isTransferIn = sourceType === "TransferIn";
    
    setSelectedTC(scannedValue);
    setSelectedTCObj(tc);
    
    // For Transfer In tasks, we already have the putaway_task
    // Simplified workflow: Skip carton/item scanning, go directly to location scan
    if (isTransferIn && (tc as any).putaway_task) {
      setPutawayTask((tc as any).putaway_task);
      setSelectedCartonOrItem(null); // Reset (not needed for simplified workflow)
      setSelectedItemCode(null); // Reset (not needed for simplified workflow)
      // For Transfer In, go directly to location scan (backend assigns location to all items)
      setWorkflowState("SCAN_LOCATION");
    } else {
      setPutawayTask(null); // Reset putaway task when selecting new TC
      // For ASN tasks, go directly to location scan
      // Note: We don't fetch putaway task here because the API requires a location (rack)
      // Instead, we'll get the putaway_task when location is scanned (Workflow 1)
      // Then if location is scanned again, we'll use the stored putaway_task (Workflow 2)
      setWorkflowState("SCAN_LOCATION");
    }
  };
  
  // Step 11b: Scan Carton or Item (for Transfer In tasks)
  const handleCartonOrItemScan = async (scannedValue: string) => {
    if (!selectedTC || !selectedTCObj) {
      Alert.alert("Error", "No putaway task selected");
      return;
    }
    
    const sourceType = (selectedTCObj as any).source_type || "ASN";
    if (sourceType !== "TransferIn") {
      Alert.alert("Error", "This function is only for Transfer In putaway tasks");
      return;
    }
    
    const scanned = scannedValue.trim().toUpperCase();
    
    // Check if it's a carton_id (typically starts with CTN- or similar)
    // Or it could be an item_code
    // For now, we'll treat it as carton_id if it looks like one, otherwise item_code
    const looksLikeCarton = scanned.startsWith("CTN-") || scanned.startsWith("BOX-") || scanned.length > 10;
    
    if (looksLikeCarton) {
      setSelectedCartonOrItem(scanned);
      setSelectedItemCode(null);
      Alert.alert(
        "Carton Scanned",
        `Carton ID: ${scanned}\n\nNow scan the location (rack/bin) to assign this carton.`,
        [{ text: "OK", onPress: () => setWorkflowState("SCAN_LOCATION") }]
      );
    } else {
      // Assume it's an item_code
      setSelectedCartonOrItem(null);
      setSelectedItemCode(scanned);
      Alert.alert(
        "Item Scanned",
        `Item Code: ${scanned}\n\nThis is a loose item. You will need to enter the quantity.\n\nNow scan the location (rack/bin) to assign this item.`,
        [{ text: "OK", onPress: () => setWorkflowState("SCAN_LOCATION") }]
      );
    }
  };

  // Step 12: Scan Location
  // ✅ FIX: Only store location in text input, don't validate immediately
  const handleLocationScan = async (locationId: string) => {
    if (!selectedTC || !selectedTCObj) {
      Alert.alert("Error", "No Putaway task selected");
      return;
    }
    
    // ✅ Store the scanned location in the text input
    // Barcode scanners send input as keyboard events, which will populate the TextInput
    // This function is kept for backward compatibility but TextInput handles scanning directly
    const locationIdUpper = locationId.trim().toUpperCase();
    setScannedLocationInput(locationIdUpper);
    console.warn(`📝 Scanned location stored in input: ${locationIdUpper} (not validated yet - click Submit to validate)`);
  };
  
  // ✅ NEW: Validate and submit location (called when user clicks Submit button)
  const handleSubmitLocation = async () => {
    if (!selectedTC || !selectedTCObj) {
      Alert.alert("Error", "No Putaway task selected");
      return;
    }
    
    if (!scannedLocationInput || scannedLocationInput.trim() === "") {
      Alert.alert("Error", "Please scan or enter a location ID");
      return;
    }
    
    const sourceType = (selectedTCObj as any).source_type || "ASN";
    const isTransferIn = sourceType === "TransferIn";
    const locationIdUpper = scannedLocationInput.trim().toUpperCase();
    
    // ✅ NEW: Get putaway_task and box_id for confirmation
    const putawayTaskId = putawayTask || (selectedTCObj as any).putaway_task;
    // ✅ Get box_id (carton_id for Transfer In, or tc_id for ASN)
    const boxId = (selectedTCObj as any).carton_id || (selectedTCObj as any).box_id || selectedTC;
    
    // ✅ NEW: Show confirmation dialog before processing
    Alert.alert(
      "Confirm Location",
      `Assign Location ID "${locationIdUpper}" to ${putawayTaskId ? `Putaway Task "${putawayTaskId}"` : `Box "${boxId}"`}?\n\nThis will update all items in this task.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit",
          onPress: async () => {
            await processLocationSubmission(locationIdUpper, putawayTaskId, boxId, isTransferIn);
          },
        },
      ]
    );
  };
  
  // ✅ NEW: Process location submission (called after confirmation)
  const processLocationSubmission = async (
    locationIdUpper: string,
    putawayTaskId: string | null,
    boxId: string | null,
    isTransferIn: boolean
  ) => {
    if (!selectedTC || !selectedTCObj) {
      Alert.alert("Error", "No Putaway task selected");
      return;
    }
    
    // ✅ NEW: For validation-only workflow, we need to validate carton first (if not already validated)
    // If carton is not validated yet, validate it first, then validate location
    if (!validatedData || (!validatedData.carton_id && !validatedData.box_id)) {
      // Carton not validated yet - validate carton first
      // This will be done in the same API call with location_id
      // The backend will validate both carton and location in one call
    }
    
    // For Transfer In tasks with putaway_task, we can skip carton/item scanning
    // The backend will assign the location to all items in the task automatically
    // Only require carton/item if we don't have a putaway_task (legacy workflow)
    if (isTransferIn && !putawayTaskId && !selectedCartonOrItem && !selectedItemCode && !validatedData) {
      Alert.alert("Error", "Please scan a carton ID or item code first, or select a putaway task");
      return;
    }

    // Check if this TC has already been assigned a location
    const db = await getDatabase();
    if (db) {
      const existingAssignment = await db.getFirstAsync<{ rack: string; event_time: string }>(
        `SELECT rack, event_time 
         FROM event_queue 
         WHERE event_type = 'PUTAWAY_TO_RACK' 
           AND tc_id = ? 
         ORDER BY event_time DESC 
         LIMIT 1`,
        [selectedTC]
      );
      
      if (existingAssignment) {
        Alert.alert(
          "Already Assigned",
          `Putaway box ${selectedTC} has already been assigned to location ${existingAssignment.rack}.\n\n` +
          `Assignment time: ${new Date(existingAssignment.event_time).toLocaleString()}\n\n` +
          `This TC will not appear in the Putaway list anymore.`
        );
        // Refresh the list to remove this TC
        await loadSealedTCs();
        setWorkflowState("PUTAWAY_LIST");
        return;
      }
    }

    setLoading(true);

    try {
      const settings = await getSettings();
      // Use ASN from the selected TC, fallback to active ASN or settings
      const asn = selectedTCObj.asn_no || activeASN || settings?.active_asn;
      // Use active session or settings session, or empty string if not available
      const session = activeSession || settings?.active_session || "";

      if (!asn) {
        Alert.alert(
          "Error",
          "Unable to determine ASN for this Putaway box"
        );
        setLoading(false);
        return;
      }

      const normalizedASN = normalizeASN(asn);

      // Validate location exists in location_cache (synced from tablocation table)
      let location = await dataService.getLocation(locationIdUpper);
      if (!location) {
        // Location not found in cache - try to fetch from backend
        try {
          console.warn(`⚠️ Location ${locationIdUpper} not found in cache, checking backend...`);
          // Trigger a sync of locations to ensure we have latest data
          const { syncMasterDataFromDesktop } = await import("../services/master-data-sync.service");
          await syncMasterDataFromDesktop();
          
          // Check again after sync
          location = await dataService.getLocation(locationIdUpper);
          
          if (!location) {
            // Still not found - location doesn't exist in backend
            setErrorModal({
              visible: true,
              title: "Invalid Location",
              message: `Location "${locationIdUpper}" is not a valid warehouse location.\n\nPlease scan a valid location code (location_id) that exists in the location master data.`,
            });
            setLoading(false);
            return;
          }
        } catch (syncError: any) {
          console.error("❌ Error syncing locations:", syncError);
          setErrorModal({
            visible: true,
            title: "Validation Error",
            message: `Unable to validate location "${locationIdUpper}" against backend.\n\nPlease ensure the location exists in the location master data (tablocation table).`,
          });
          setLoading(false);
          return;
        }
      }

      // Check if location is available
      if (location.is_available === 0) {
        setErrorModal({
          visible: true,
          title: "Location Not Available",
          message: `Location "${locationIdUpper}" is currently not available.\n\nPlease select a different location.`,
        });
        setLoading(false);
        return;
      }

      // Store location_id (primary identifier)
      setSelectedLocationId(locationIdUpper);
      
      // Also store rack and bin for display purposes (extracted from location)
      const bin = location.bin_id || undefined;
      const rack = locationIdUpper; // Use scanned location_id as rack
      setSelectedRack(rack);
      setSelectedBin(bin || null);

      // ✅ FIX: Get warehouse_id from location or settings
      // Priority: location.warehouse_id > location.warehouse > settings.warehouse_id > settings.warehouse
      const warehouseId = 
        location.warehouse_id || 
        location.warehouse || 
        settings.warehouse_id || 
        settings.warehouse || 
        undefined;
      
      if (!warehouseId) {
        console.warn(`⚠️ PutAwayScreen: No warehouse_id found in location or settings. Backend may require it.`);
        console.warn(`   Location data:`, { warehouse_id: location.warehouse_id, warehouse: location.warehouse });
        console.warn(`   Settings data:`, { warehouse_id: settings.warehouse_id, warehouse: settings.warehouse });
      } else {
        console.warn(`✅ PutAwayScreen: Using warehouse_id: ${warehouseId} (from ${location.warehouse_id ? 'location' : 'settings'})`);
      }

      // Try to call API to scan transfer carton and location
      // Supports two workflows:
      // Workflow 1: If putaway_task exists (from previous TC scan), update existing task with location
      // Workflow 2: If no putaway_task, create/update task with TC + location
      // If API endpoint doesn't exist (404), fall back to event-based approach
      let apiSuccess = false;
      let response: any = null;
      let apiErrorOccurred = false;
      let apiErrorMessage: string | null = null; // ✅ Store error message for final error handling
      
      try {
        // Validate required fields before sending request
        if (!locationIdUpper || locationIdUpper.trim() === '') {
          throw new Error("Location ID is required to scan transfer carton for putaway");
        }
        
        if (!putawayTask && !selectedTC) {
          throw new Error("Either putaway task or transfer carton ID is required");
        }
        
        // ✅ NEW: Use putaway_task parameter when available (per user requirements)
        // ⚠️ IMPORTANT: Backend requires either carton_id/tc_id OR box_id even when putaway_task is provided
        const requestBody: any = {
          location_id: locationIdUpper, // Required: location to validate
          user_id: settings.user_id || settings.user_code || undefined,
          warehouse_id: warehouseId, // Required by backend
        };
        
        // ✅ Determine source type and box_id/carton_id
        const sourceType = (selectedTCObj as any).source_type || "ASN";
        const isTransferIn = sourceType === "TransferIn";
        
        // ✅ Get box_id/carton_id based on source type
        let boxIdToSend: string | null = null;
        let cartonIdToSend: string | null = null;
        
        if (isTransferIn) {
          // ✅ Transfer In Putaway: Use box_id (carton_id format: CTN-TI-...)
          // For Transfer In, box_id = carton_id (CTN-TI-... format)
          // ⚠️ CRITICAL: Do NOT use TI-PUT-* format (putaway task title) - backend rejects it
          
          // ✅ CRITICAL: Get box_id from carton_id in selectedTCObj (not from selectedTC which might be putaway task title)
          // Priority: carton_id from selectedTCObj > box_id from selectedTCObj > selectedTC (only if it's CTN-TI-*)
          boxIdToSend = (selectedTCObj as any).carton_id || (selectedTCObj as any).box_id;
          
          // ✅ DEBUG: Log what we found
          console.warn(`🔍 Transfer In Putaway - Getting box_id:`, {
            selectedTC: selectedTC,
            selectedTCObj_carton_id: (selectedTCObj as any).carton_id,
            selectedTCObj_box_id: (selectedTCObj as any).box_id,
            selectedTCObj_tc_id: selectedTCObj.tc_id,
            putawayTaskId: putawayTaskId,
            boxIdToSend_before_check: boxIdToSend,
          });
          
          // ✅ If carton_id not in selectedTCObj, try to get it from selectedTC (but validate format)
          if (!boxIdToSend && selectedTC) {
            if (selectedTC.startsWith("CTN-TI-")) {
              // ✅ selectedTC is already in correct format (should be the case if carton_id was set correctly)
              boxIdToSend = selectedTC;
              console.warn(`✅ Using selectedTC as box_id (CTN-TI-* format): ${boxIdToSend}`);
            } else if (selectedTC.startsWith("TI-PUT-") || selectedTC.startsWith("PUT-")) {
              // ❌ selectedTC is putaway task title (TI-PUT-* or PUT-*) - reject it
              // This should not happen if carton_id was set correctly when loading tasks
              console.error(`❌ CRITICAL: selectedTC is in TI-PUT-* format: ${selectedTC}`);
              console.error(`   This means carton_id was not set correctly when loading the putaway task.`);
              console.error(`   selectedTCObj.carton_id: ${(selectedTCObj as any).carton_id || 'null'}`);
              throw new Error(
                "TI-PUT-* format is no longer used. For Transfer In Putaway, box_id should be the carton_id (CTN-TI-* format).\n\n" +
                "The putaway task is missing a valid carton_id. Please ensure the carton was created during receiving with a CTN-TI-* format ID.\n\n" +
                "If this error persists, the putaway task may need to be recreated with the correct carton_id."
              );
            } else {
              // Unknown format - reject it
              console.error(`❌ CRITICAL: selectedTC is in unknown format: ${selectedTC}`);
              throw new Error(
                `Invalid box_id format: "${selectedTC}". For Transfer In Putaway, box_id must be the carton_id (CTN-TI-* format).`
              );
            }
          }
          
          // ✅ Validate that we have a valid box_id
          if (!boxIdToSend || boxIdToSend.trim() === '') {
            console.error(`❌ CRITICAL: No box_id found for Transfer In putaway`);
            console.error(`   selectedTC: ${selectedTC}`);
            console.error(`   selectedTCObj.carton_id: ${(selectedTCObj as any).carton_id || 'null'}`);
            console.error(`   selectedTCObj.box_id: ${(selectedTCObj as any).box_id || 'null'}`);
            throw new Error("Box ID (carton_id) is required for Transfer In putaway. Please ensure the putaway task has a valid carton_id (CTN-TI-* format).");
          }
          
          // ✅ Validate format: Must be CTN-TI-* (not TI-PUT-*)
          if (boxIdToSend.startsWith("TI-PUT-") || boxIdToSend.startsWith("PUT-")) {
            console.error(`❌ CRITICAL: boxIdToSend is in TI-PUT-* format: ${boxIdToSend}`);
            throw new Error(
              "Invalid box_id format: TI-PUT-* format is no longer used.\n\n" +
              "For Transfer In Putaway, box_id must be the carton_id (CTN-TI-* format).\n\n" +
              "The carton ID is generated when you validate the carton during receiving.\n\n" +
              "Please use the carton ID (CTN-TI-*) instead of the putaway task title (TI-PUT-*)."
            );
          }
          
          // ✅ Final validation: Must start with CTN-TI-
          if (!boxIdToSend.startsWith("CTN-TI-")) {
            console.error(`❌ CRITICAL: boxIdToSend is not in CTN-TI-* format: ${boxIdToSend}`);
            throw new Error(
              `Invalid box_id format: "${boxIdToSend}". For Transfer In Putaway, box_id must be the carton_id (CTN-TI-* format).`
            );
          }
          
          console.warn(`✅ Transfer In Putaway - Using box_id: ${boxIdToSend} (CTN-TI-* format)`);
          
          // ✅ Clean carton_id - remove item code if appended
          if (selectedCartonOrItem) {
            const colonIndex = selectedCartonOrItem.indexOf(":");
            if (colonIndex > 0) {
              cartonIdToSend = selectedCartonOrItem.substring(0, colonIndex).trim();
            } else {
              cartonIdToSend = selectedCartonOrItem.trim();
            }
          } else if (selectedItemCode) {
            requestBody.item_code = selectedItemCode;
            cartonIdToSend = boxIdToSend; // Use box_id as carton_id for loose items
          } else {
            cartonIdToSend = boxIdToSend; // Use box_id as carton_id
          }
        } else {
          // ✅ ASN Putaway: Use box_id (from sorting process) or carton_id from task lines
          const isBoxId = selectedTC?.startsWith("BOX-") || selectedTC?.startsWith("PAW-");
          const isTaskId = selectedTC?.startsWith("PUT-");
          
          if (isBoxId) {
            boxIdToSend = selectedTC;
          } else if (isTaskId) {
            // ✅ FIX: selectedTC is a putaway task ID (PUT-*), need to get carton_id from task lines
            console.warn(`⚠️ ASN Putaway: selectedTC "${selectedTC}" is a putaway task ID, need to get carton_id from task lines`);
            
            // Try to get carton_id from selectedTCObj task lines
            const taskLines = (selectedTCObj as any).task_lines;
            if (taskLines && Array.isArray(taskLines) && taskLines.length > 0) {
              // Get carton_id from first line (all lines should have same carton_id)
              const firstLine = taskLines[0];
              const cartonIdFromLine = firstLine.carton_id || firstLine.box_id;
              
              if (cartonIdFromLine && (cartonIdFromLine.startsWith("CTN-") || cartonIdFromLine.startsWith("BOX-") || cartonIdFromLine.startsWith("PAW-"))) {
                boxIdToSend = cartonIdFromLine;
                cartonIdToSend = cartonIdFromLine;
                console.warn(`✅ ASN Putaway: Found carton_id from task lines: ${cartonIdFromLine}`);
              } else {
                console.warn(`⚠️ ASN Putaway: carton_id from task lines is not in valid format: ${cartonIdFromLine}`);
              }
            }
            
            // If still no carton_id, try to get from box_id in selectedTCObj
            if (!boxIdToSend) {
              const boxIdFromObj = (selectedTCObj as any).box_id;
              if (boxIdFromObj && (boxIdFromObj.startsWith("CTN-") || boxIdFromObj.startsWith("BOX-") || boxIdFromObj.startsWith("PAW-"))) {
                boxIdToSend = boxIdFromObj;
                cartonIdToSend = boxIdFromObj;
                console.warn(`✅ ASN Putaway: Using box_id from selectedTCObj: ${boxIdFromObj}`);
              }
            }
            
            // If still no carton_id, try to fetch full task details
            // Note: This endpoint might not exist (404), so we handle it gracefully
            if (!boxIdToSend && putawayTaskId) {
              try {
                console.warn(`⚠️ ASN Putaway: Fetching full task details for ${putawayTaskId} to get carton_id...`);
                const fullTask = await apiService.getPutawayTask(putawayTaskId);
                const fullTaskData = fullTask?.data || fullTask;
                
                // ✅ Handle response format: { ok: true, data: { items: [...] } }
                const taskItems = fullTaskData?.items || fullTaskData?.lines || [];
                if (Array.isArray(taskItems) && taskItems.length > 0) {
                  const firstItem = taskItems[0];
                  const cartonId = firstItem.carton_id || firstItem.box_id;
                  
                  if (cartonId && (cartonId.startsWith("CTN-") || cartonId.startsWith("BOX-") || cartonId.startsWith("PAW-"))) {
                    boxIdToSend = cartonId;
                    cartonIdToSend = cartonId;
                    console.warn(`✅ ASN Putaway: Found carton_id from full task details: ${cartonId}`);
                  }
                }
              } catch (fetchError: any) {
                // ✅ Handle 404 gracefully - endpoint might not exist (don't log as error)
                const errorMsg = fetchError.message || "";
                if (errorMsg.includes("404") || errorMsg.includes("not found") || errorMsg.includes("Route")) {
                  console.warn(`ℹ️ ASN Putaway: getPutawayTask endpoint not available (404) for ${putawayTaskId} - using other methods`);
                } else {
                  console.warn(`⚠️ ASN Putaway: Error fetching full task details: ${errorMsg}`);
                }
              }
            }
            
            // ✅ CRITICAL: If still no valid carton_id, throw error
            if (!boxIdToSend || (!boxIdToSend.startsWith("CTN-") && !boxIdToSend.startsWith("BOX-") && !boxIdToSend.startsWith("PAW-"))) {
              throw new Error(
                `Putaway requires carton ID (CTN-* format). Old format (TI-PUT-* or PUT-*) is no longer supported.\n\n` +
                `Task ID: ${selectedTC}\n\n` +
                `Please ensure the putaway task has a valid carton_id (CTN-*) in the task lines.`
              );
            }
          } else {
            console.warn(`⚠️ ASN Putaway: selectedTC "${selectedTC}" doesn't look like a box_id (should start with BOX- or PAW-)`);
            boxIdToSend = selectedTC;
          }
        }
        
        // ✅ Include putaway_task if available (preferred method)
        if (putawayTaskId) {
          requestBody.putaway_task = putawayTaskId;
          console.warn(`📤 Using putaway_task: ${putawayTaskId}`);
        }
        
        // ✅ CRITICAL FIX: Always include box_id (backend requires it even with putaway_task)
        if (boxIdToSend) {
          requestBody.box_id = boxIdToSend;
          console.warn(`📤 Including box_id: ${boxIdToSend}`);
        }
        
        // ✅ Include carton_id for Transfer In (if available)
        if (cartonIdToSend && isTransferIn) {
          requestBody.carton_id = cartonIdToSend;
          console.warn(`📤 Including carton_id: ${cartonIdToSend}`);
        }
        
        // ✅ Don't send tc_id for Transfer In putaway
        if (isTransferIn) {
          requestBody.tc_id = null;
        }
        
        console.warn(`📤 Sending scan transfer carton request:`, JSON.stringify(requestBody, null, 2));
        response = await apiService.scanTransferCarton(requestBody);

        // ✅ NEW: Handle validation-only response (not creation response)
        // The API now only validates - it does NOT create any database records
        if (response?.ok === true && response?.validated) {
          // ✅ Validation successful - store validated data
          const validated = response.validated;
          const sourceType = (selectedTCObj as any).source_type || "ASN";
          const isTransferIn = sourceType === "TransferIn";
          
          setValidatedData({
            // ✅ NEW: For Transfer In, store box_id (not carton_id)
            // Both ASN and Transfer In now use box_id
            carton_id: validated.carton_id || null, // Keep for backward compatibility
            box_id: validated.box_id || selectedTC || null, // Both ASN and Transfer In use box_id
            location_id: validated.location_id || null,
            location: validated.location || {
              location_id: locationIdUpper,
              zone: location?.zone || null,
              aisle: location?.aisle || null,
              rack: location?.rack || locationIdUpper,
              level: location?.level || null,
              bin: location?.bin_id || bin || "",
            },
          });
          
          // ✅ Check if ready for completion (both carton and location validated)
          if (response.ready_for_completion && validated.location_id) {
            setIsReadyForCompletion(true);
            // Validation status is shown in UI - no alert needed
          } else if (validated.location_id) {
            // Location validated but not ready yet (might need carton validation first)
            setIsReadyForCompletion(false);
            // Validation status is shown in UI - no alert needed
          } else {
            // Only carton validated, location still needed
            setIsReadyForCompletion(false);
            // Validation status is shown in UI - no alert needed
          }
          
          // Mark location as successfully scanned for this TC
          setLocationScannedSuccessfully(prev => {
            const newMap = new Map(prev);
            newMap.set(selectedTC, true);
            return newMap;
          });
          
          apiSuccess = true;
        } else if (response?.ok === true || response?.success === true) {
          // Legacy response format (backward compatibility)
          // Mark as success but don't set validated data
          apiSuccess = true;
          setLocationScannedSuccessfully(prev => {
            const newMap = new Map(prev);
            newMap.set(selectedTC, true);
            return newMap;
          });
          
          // Try to extract location info from response if available
          if (response?.data?.location_id || response?.location_id) {
            const respLocationId = response.data?.location_id || response.location_id;
            const sourceType = (selectedTCObj as any).source_type || "ASN";
            const isTransferIn = sourceType === "TransferIn";
            
            setValidatedData({
              // ✅ NEW: Both ASN and Transfer In use box_id
              carton_id: null, // Not used for putaway validation
              box_id: selectedTC || null, // Both ASN and Transfer In use box_id
              location_id: respLocationId,
              location: {
                location_id: respLocationId,
                zone: location?.zone || null,
                aisle: location?.aisle || null,
                rack: location?.rack || respLocationId,
                level: location?.level || null,
                bin: location?.bin_id || bin || "",
              },
            });
            setIsReadyForCompletion(true);
          }
        } else {
          // Unexpected response format
          apiSuccess = false;
          throw new Error("Unexpected response format from validation API");
        }
      } catch (apiError: any) {
        // API call failed - mark as error occurred
        apiErrorOccurred = true;
        apiSuccess = false;
        
        // ✅ Store error message for final error handling
        apiErrorMessage = apiError?.response?.data?.error?.message || 
                         apiError?.message || 
                         "Unknown error";
        
        // ✅ FIX: Mark location as NOT successfully scanned for this TC
        setLocationScannedSuccessfully(prev => {
          const newMap = new Map(prev);
          newMap.set(selectedTC, false);
          return newMap;
        });
        
        // ✅ NEW: Handle validation error codes
        const errorCode = apiError?.response?.data?.error?.code || apiError?.code;
        const errorMessage = apiError?.response?.data?.error?.message || apiError?.message || "Unknown error";
        const errorHint = apiError?.response?.data?.error?.hint || null;
        const troubleshooting = apiError?.response?.data?.error?.troubleshooting || null;
        
        if (errorCode === "CARTON_NOT_FOUND") {
          // ✅ NEW: Transfer In Putaway now uses box_id (not tc_id)
          // This error should not occur for Transfer In if using box_id correctly
          const sourceType = (selectedTCObj as any).source_type || "ASN";
          const isTransferIn = sourceType === "TransferIn";
          
          if (isTransferIn) {
            // Transfer In Putaway: Should use box_id from Box Management
            Alert.alert(
              "Box Not Found",
              "For Transfer In putaway, please scan the box ID (from Box Management), not a carton ID.\n\n" +
              "Box IDs for Transfer In typically start with 'TI-' or 'TI-PUT-'.\n\n" +
              "Please:\n" +
              "1. Go to Box Management\n" +
              "2. Create a box with TI- naming series\n" +
              "3. Scan items to the box\n" +
              "4. Close the box\n" +
              "5. Then scan the box ID for putaway",
              [
                {
                  text: "Go to Box Management",
                  onPress: () => {
                    try {
                      (navigation as any).navigate("BoxManagement");
                    } catch (navError) {
                      Alert.alert("Info", "Please navigate to Box Management screen manually to create Transfer In boxes.");
                    }
                  }
                },
                { 
                  text: "OK", 
                  style: "cancel",
                  onPress: () => {
                    setValidatedData(null);
                    setIsReadyForCompletion(false);
                  }
                }
              ]
            );
          } else {
            // ASN Putaway: Should use box_id, not tc_id
            Alert.alert(
              "Carton Not Found",
              "For ASN putaway, please scan the box ID (from sorting process), not the transfer carton ID.\n\n" +
              "Box IDs typically start with 'PAW-' or 'BOX-'.\n\n" +
              "If you scanned a transfer carton ID, please scan the box ID instead.",
              [
                { 
                  text: "OK", 
                  style: "cancel",
                  onPress: () => {
                    setValidatedData(null);
                    setIsReadyForCompletion(false);
                  }
                }
              ]
            );
          }
          setValidatedData(null);
          setIsReadyForCompletion(false);
          setLoading(false);
          return;
        } else if (errorCode === "BOX_NOT_FOUND") {
          // ✅ Handle BOX_NOT_FOUND for both ASN and Transfer In putaway
          // Backend now provides enhanced error messages with hints and troubleshooting
          const sourceType = (selectedTCObj as any).source_type || "ASN";
          const isTransferIn = sourceType === "TransferIn";
          
          // Extract hint and troubleshooting from error response
          const errorHint = apiError?.response?.data?.error?.hint || apiError?.response?.data?.hint || null;
          const troubleshooting = apiError?.response?.data?.error?.troubleshooting || apiError?.response?.data?.troubleshooting || null;
          
          if (isTransferIn) {
            // Transfer In Putaway: Box not found
            // Build message with backend hint and troubleshooting if available
            let alertMessage = errorMessage;
            if (errorHint) {
              alertMessage += "\n\n" + errorHint;
            }
            if (troubleshooting && Array.isArray(troubleshooting) && troubleshooting.length > 0) {
              alertMessage += "\n\n" + troubleshooting.join("\n");
            } else {
              // Fallback message if backend doesn't provide troubleshooting
              alertMessage += "\n\nFor Transfer In Putaway:\n" +
                "1. Go to Transfer In Receiving\n" +
                "2. Click 'Generate Carton ID' to create a box\n" +
                "3. Scan items to the box\n" +
                "4. Complete receiving to close the box\n" +
                "5. Use the Carton ID (CTN-TI-...) as box_id for putaway";
            }
            
            Alert.alert(
              "Box Not Found",
              alertMessage,
              [
                {
                  text: "Go to Receiving",
                  onPress: () => {
                    try {
                      (navigation as any).navigate("TransferInReceiving");
                    } catch (navError) {
                      Alert.alert("Info", "Please navigate to Transfer In Receiving screen manually.");
                    }
                  }
                },
                { 
                  text: "OK", 
                  style: "cancel",
                  onPress: () => {
                    setValidatedData(null);
                    setIsReadyForCompletion(false);
                  }
                }
              ]
            );
          } else {
            // ASN Putaway: Box not found in sorting
            Alert.alert(
              "Box Not Found",
              errorMessage + "\n\n" +
              "This box hasn't been created yet. Please complete sorting for this ASN before putaway.\n\n" +
              "Box IDs are created during the sorting process.",
              [
                {
                  text: "Go to Sorting",
                  onPress: () => {
                    try {
                      // Navigate to sorting screen if available
                      // Note: Adjust navigation based on your app structure
                      (navigation as any).navigate("Sorting");
                    } catch (navError) {
                      Alert.alert("Info", "Please navigate to Sorting screen manually to complete sorting for this ASN.");
                    }
                  }
                },
                { 
                  text: "OK", 
                  style: "cancel",
                  onPress: () => {
                    setValidatedData(null);
                    setIsReadyForCompletion(false);
                  }
                }
              ]
            );
          }
          setValidatedData(null);
          setIsReadyForCompletion(false);
          setLoading(false);
          return;
        } else if (errorCode === "LOCATION_NOT_FOUND") {
          Alert.alert("Validation Error", errorMessage);
          // Keep carton validated, but clear location
          if (validatedData) {
            setValidatedData({
              ...validatedData,
              location_id: null,
              location: {
                location_id: "",
                zone: null,
                aisle: null,
                rack: "",
                level: null,
                bin: "",
              },
            });
          }
          setIsReadyForCompletion(false);
          setLoading(false);
          return;
        } else if (errorCode === "VALIDATION_ERROR") {
          // ✅ NEW: Enhanced validation error message
          Alert.alert(
            "Validation Error",
            errorMessage + "\n\nPlease check the scanned values and try again.",
            [
              { 
                text: "OK", 
                style: "cancel",
                onPress: () => {
                  setValidatedData(null);
                  setIsReadyForCompletion(false);
                }
              }
            ]
          );
          setValidatedData(null);
          setIsReadyForCompletion(false);
          setLoading(false);
          return;
        } else if (errorCode === "INVALID_BOX_FORMAT") {
          // ✅ NEW: Handle INVALID_BOX_FORMAT error (TI-PUT-* format is deprecated)
          // Backend requires CTN-TI-* format (carton_id) instead of TI-PUT-* (putaway task title)
          const sourceType = (selectedTCObj as any).source_type || "ASN";
          const isTransferIn = sourceType === "TransferIn";
          
          if (isTransferIn) {
            // Build message with backend troubleshooting if available
            let alertMessage = errorMessage;
            if (troubleshooting && Array.isArray(troubleshooting) && troubleshooting.length > 0) {
              alertMessage += "\n\n" + troubleshooting.join("\n");
            }
            
            Alert.alert(
              "Invalid Box Format",
              alertMessage,
              [
                {
                  text: "Go to Receiving",
                  onPress: () => {
                    try {
                      (navigation as any).navigate("TransferInReceiving");
                    } catch (navError) {
                      Alert.alert("Info", "Please navigate to Transfer In Receiving screen manually to get the carton ID (CTN-TI-* format).");
                    }
                  }
                },
                { 
                  text: "OK", 
                  style: "cancel",
                  onPress: () => {
                    setValidatedData(null);
                    setIsReadyForCompletion(false);
                    // Clear scanned location input so user can try again
                    setScannedLocationInput("");
                  }
                }
              ]
            );
          } else {
            // ASN Putaway - shouldn't happen, but handle it
            Alert.alert(
              "Invalid Box Format",
              errorMessage,
              [
                { 
                  text: "OK", 
                  style: "cancel",
                  onPress: () => {
                    setValidatedData(null);
                    setIsReadyForCompletion(false);
                    setScannedLocationInput("");
                  }
                }
              ]
            );
          }
          setValidatedData(null);
          setIsReadyForCompletion(false);
          setLoading(false);
          return;
        }
        
        // Check if this is a Putaway box (starts with "PAW-") that backend doesn't recognize
        const isPutawayBox = selectedTC?.startsWith("PAW-");
        const isTransferCartonNotFound = 
          errorCode === "CARTON_NOT_FOUND" ||
          errorCode === "BOX_NOT_FOUND" ||
          apiError.message?.includes("TRANSFER_CARTON_NOT_FOUND") ||
          apiError.message?.includes("transfer carton not found") ||
          apiError.message?.includes("Transfer carton") && apiError.message?.includes("not found");
        
        // If API endpoint doesn't exist (404), fall back to event-based approach
        if (apiError.message?.includes("404") || apiError.message?.includes("not found")) {
          if (isTransferCartonNotFound && isPutawayBox) {
            console.warn(`⚠️ Putaway box ${selectedTC} not recognized as transfer carton by backend - using event-based approach`);
            console.warn(`   This is expected for Putaway boxes. Backend may need to handle Putaway boxes separately.`);
          } else {
            console.warn(`⚠️ Putaway API endpoint not available (404) - using event-based approach`);
            console.warn(`   Backend needs to implement: POST /api/putaway/scan-transfer-carton`);
          }
          // Continue with event-based approach below
        } else if (
          errorCode === "DATABASE_ERROR" ||
          apiError.message?.includes("GROUP BY") || 
          apiError.message?.includes("sql_mode") || 
          apiError.message?.includes("DATABASE_ERROR") ||
          apiError.message?.includes("nonaggregated column") ||
          apiError.message?.includes("carton_id") ||
          apiError.message?.includes("Assignment to constant variable") ||
          (apiError.message?.includes("500") && apiError.message?.includes("Failed to process")) ||
          (apiError.code === "DATABASE_ERROR" && apiError.message?.includes("Failed to process transfer carton for putaway"))
        ) {
          // ✅ NEW: Handle DATABASE_ERROR with specific message for "Assignment to constant variable"
          if (errorCode === "DATABASE_ERROR" && (errorMessage.includes("Assignment to constant variable") || apiError.message?.includes("Assignment to constant variable"))) {
            Alert.alert(
              "Backend Error",
              "The backend encountered an error while processing your request.\n\n" +
              "Error: Assignment to constant variable\n\n" +
              "This is a backend code issue that needs to be fixed by the backend developer.\n\n" +
              "Your request was correct:\n" +
              `- Box ID: ${boxIdToSend || 'N/A'}\n` +
              `- Location: ${locationIdUpper}\n\n` +
              "Please contact the backend team to fix this issue in putawayController.js:4366.",
              [
                { 
                  text: "OK", 
                  style: "cancel",
                  onPress: () => {
                    setValidatedData(null);
                    setIsReadyForCompletion(false);
                    setScannedLocationInput("");
                  }
                }
              ]
            );
            setValidatedData(null);
            setIsReadyForCompletion(false);
            setLoading(false);
            return;
          }
          
          // Backend SQL error (e.g., GROUP BY clause issue) - continue with event-based approach
          // Don't log as error - this is expected when backend has database schema issues
          console.warn(`⚠️ Putaway API database error (SQL issue) - using event-based approach`);
          console.warn(`   Backend SQL error: ${apiError.message || apiError.code || "DATABASE_ERROR"}`);
          console.warn(`   This is a backend database schema/query issue. Continuing with event-based tracking.`);
          // Continue with event-based approach below - don't block user workflow
        } else if (isTransferCartonNotFound) {
          // Transfer carton not found error - likely Putaway box not recognized
          if (isPutawayBox) {
            console.warn(`⚠️ Putaway box ${selectedTC} not found in backend - using event-based approach`);
            console.warn(`   Backend may not recognize Putaway boxes (PAW- prefix) as transfer cartons.`);
          } else {
            console.warn(`⚠️ Transfer carton ${selectedTC} not found in backend - using event-based approach`);
          }
          // Continue with event-based approach below
        } else {
          // For other errors, show the error but still allow event-based fallback
          console.warn(`⚠️ Putaway API error:`, apiError.message);
          console.warn(`   Continuing with event-based approach for offline support.`);
        }
      }

      // ✅ REMOVED: Event-based tracking fallback (per user requirements)
      // Now using direct API call only - no event creation for location updates

      // ✅ FIX: Clear scanned location input after successful validation
      setScannedLocationInput("");
      
      // ✅ NEW: Only navigate to Complete if validation is ready
      // Otherwise, stay on SCAN_LOCATION to allow user to scan location
      if (isReadyForCompletion) {
        setWorkflowState("COMPLETE_PUTAWAY");
      } else {
        // Stay on SCAN_LOCATION - validation status is shown in UI
        // User can continue scanning location
      }
      
      // Refresh the sealed TCs list to remove this TC (it's now assigned)
      await loadSealedTCs();
      
      if (apiSuccess && !apiErrorOccurred) {
        // ✅ NEW: Use API response message (per user requirements)
        const apiMessage = response?.message || response?.data?.message;
        const itemsCount = response?.data?.items_count || response?.items_count || 0;
        const responsePutawayTaskId = response?.data?.putaway_task || response?.putaway_task;
        
        // ✅ Use API message if available, otherwise construct message
        let successMessage = apiMessage || `Location ID "${locationIdUpper}" assigned to all items in putaway task.`;
        
        if (itemsCount > 0 && !apiMessage) {
          successMessage += `\n\n${itemsCount} item(s) assigned.`;
        }
        if (responsePutawayTaskId && !apiMessage) {
          successMessage += `\n\nPutaway Task: ${responsePutawayTaskId}`;
        }
        successMessage += `\n\nThis TC has been removed from the Putaway list.`;
        
        Alert.alert(
          "Success",
          successMessage,
          [
            {
              text: "OK",
              onPress: () => {
                // Navigate back or refresh list
                setWorkflowState("PUTAWAY_LIST");
              },
            },
          ]
        );
      } else {
        // ✅ NEW: Show detailed error message from API (if available)
        // The error should have been caught and handled in the catch block above
        // This is a fallback for unexpected errors
        const errorMessage = apiErrorMessage || `Failed to update location. Please try again.`;
        
        Alert.alert(
          "Error",
          `${errorMessage}\n\nLocation: ${locationIdUpper}`
        );
      }
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to scan location");
    } finally {
      setLoading(false);
    }
  };

  // Step 13: Complete Put Away
  // ✅ NEW: Updated to use validated data instead of putaway_task
  const handleCompletePutAway = async () => {
    // ✅ NEW: Validate that we have validated data before completing
    if (!isReadyForCompletion) {
      Alert.alert(
        "Validation Required",
        "Please validate carton/box and location before completing putaway."
      );
      return;
    }
    
    if (!validatedData || (!validatedData.carton_id && !validatedData.box_id)) {
      Alert.alert(
        "Validation Required",
        "Carton/box not validated. Please scan carton/box first."
      );
      return;
    }
    
    if (!validatedData.location_id) {
      Alert.alert(
        "Validation Required",
        "Location not validated. Please scan location first."
      );
      return;
    }
    if (!selectedTC || !selectedTCObj) {
      Alert.alert("Error", "No Putaway box selected");
      return;
    }

    // ✅ FIX: Prevent multiple simultaneous calls
    if (loading || isCompleting) {
      console.warn(`⚠️ handleCompletePutAway: Already processing, ignoring duplicate call`);
      return;
    }
    
    // ✅ NEW: Check if already completed in this session
    if (completedTCs.has(selectedTC)) {
      Alert.alert(
        "Already Completed",
        `Putaway box ${selectedTC} has already been completed in this session.\n\nPlease refresh the list to see updated status.`
      );
      await loadSealedTCs();
      setWorkflowState("PUTAWAY_LIST");
      return;
    }


    // ✅ NEW: Use validated location_id (already validated above)
    const locationId = validatedData.location_id || selectedLocationId || selectedRack || selectedBin;

    // ✅ FIX: Check if PUTAWAY_TO_RACK event already exists and is synced
    // If it's already synced, this putaway was already completed
    const db = await getDatabase();
    if (db) {
      const existingSyncedEvent = await db.getFirstAsync<{ offline_uuid: string; synced: number }>(
        `SELECT offline_uuid, synced FROM event_queue 
         WHERE event_type = 'PUTAWAY_TO_RACK' 
           AND tc_id = ? 
           AND synced = 1
         ORDER BY event_time DESC
         LIMIT 1`,
        [selectedTC]
      );
      
      if (existingSyncedEvent) {
        Alert.alert(
          "Already Completed",
          `Putaway box ${selectedTC} has already been completed and synced to backend.\n\nThis TC should not appear in the Putaway list anymore.`
        );
        // Mark as completed in session state
        setCompletedTCs(prev => new Set(prev).add(selectedTC));
        // Refresh the list
        await loadSealedTCs();
        setWorkflowState("PUTAWAY_LIST");
        return;
      }
    }

    // ✅ NEW: Disable Complete button immediately to prevent double-click
    setLoading(true);
    setIsCompleting(true);
    
    try {
      const settings = await getSettings();
      const asn = selectedTCObj.asn_no || activeASN || settings?.active_asn;
      const session = activeSession || settings?.active_session || "";
      const db = await getDatabase();
      
      // ✅ FIX: Get putaway_task from selectedTCObj (not state variable)
      // The putaway_task is stored in the TC object when tasks are loaded
      const currentPutawayTask = (selectedTCObj as any).putaway_task || putawayTask || null;
      
      // ✅ TRACK: Log initial state
      console.warn(`📋 [CARTON_ID_TRACK] ========== START PUTAWAY COMPLETION ==========`);
      console.warn(`📋 [CARTON_ID_TRACK] TC: ${selectedTC}`);
      console.warn(`📋 [CARTON_ID_TRACK] Putaway Task: ${currentPutawayTask}`);
      console.warn(`📋 [CARTON_ID_TRACK] ASN: ${asn}`);
      console.warn(`📋 [CARTON_ID_TRACK] Selected Location: ${selectedLocationId || selectedRack || selectedBin || 'N/A'}`);
      console.warn(`📋 [CARTON_ID_TRACK] ============================================`);
      
      // Get items from the Transfer Carton
      // Items are in boxes that were packed into this TC via PACK_BOX_TO_TC events
      let items: Array<{
        item_code: string;
        qty: number;
        source_bin?: string;
        target_bin?: string;
        completed?: boolean;
        carton_id?: string;
        location_id?: string;
      }> = [];
      
      // ✅ FIX: Determine if this is a Putaway box (BOX ID = TC ID)
      // For Transfer In putaway, box ID format is TI-* or TI-PUT-* (from Box Management)
      // For ASN putaway, box ID format is PAW-* (from sorting)
      const isPutawayBox = selectedTC?.startsWith("PAW-") || selectedTC?.startsWith("TI-") || selectedTC?.startsWith("TI-PUT-");
      const isTransferInPutaway = (selectedTCObj as any)?.source_type === "TransferIn" || selectedTC?.startsWith("TI-") || selectedTC?.startsWith("TI-PUT-");
      
      // ✅ FIX: First, check if task lines/items are already stored in selectedTCObj
      // This avoids needing to fetch from backend if we already have them
      const storedTaskLines = (selectedTCObj as any)?.task_lines;
      if (storedTaskLines && Array.isArray(storedTaskLines) && storedTaskLines.length > 0) {
        console.warn(`📋 [CARTON_ID_TRACK] ✅ Found ${storedTaskLines.length} stored task line(s) in selectedTCObj`);
        items = storedTaskLines.map((line: any) => {
          const item: any = {
            item_code: line.item_code || line.itemCode || line.item,
            qty: Number(line.qty || line.quantity || 0),
            carton_id: line.carton_id || line.cartonId || null,
            location_id: selectedLocationId || selectedRack || selectedBin || undefined,
            source_bin: "DOCK-01",
            target_bin: selectedBin || selectedRack || undefined,
            completed: true,
          };
          console.warn(`📋 [CARTON_ID_TRACK] Item from stored task lines: ${item.item_code}, carton_id from line: ${line.carton_id || line.cartonId || 'null'}, final carton_id: ${item.carton_id || 'MISSING'}`);
          
          // ✅ CRITICAL FIX: For Transfer In putaway, ALWAYS use TC ID as carton_id if missing
          // Backend task lines don't have carton_id, so we must add it
          if (!item.carton_id && (isPutawayBox || isTransferInPutaway)) {
            item.carton_id = selectedTC; // BOX ID = TC ID for Putaway boxes
            console.warn(`📋 [CARTON_ID_TRACK] ✅ Added TC ID as carton_id for item ${item.item_code}: ${selectedTC} (isPutawayBox: ${isPutawayBox}, isTransferInPutaway: ${isTransferInPutaway})`);
          }
          
          return item;
        }).filter((item: any) => item.item_code && item.qty > 0);
        
        console.warn(`📋 [CARTON_ID_TRACK] Items from stored task lines summary:`, items.map(i => ({ item_code: i.item_code, carton_id: i.carton_id || 'MISSING' })));
      }
      
      // If no items found from stored task lines, try other methods
      if (items.length === 0 && db) {
        try {
          // Get boxes that were packed into this TC
          const packedBoxes = await db.getAllAsync<{ box_id: string }>(
            `SELECT DISTINCT box_id 
             FROM event_queue 
             WHERE event_type = 'PACK_BOX_TO_TC' 
               AND tc_id = ? 
               AND box_id IS NOT NULL 
               AND box_id != ''`,
            [selectedTC]
          );
          
          console.warn(`📦 Found ${packedBoxes.length} box(es) packed into TC ${selectedTC}`);
          
          // Get scanned items from those boxes
          if (packedBoxes.length > 0) {
            const boxIds = packedBoxes.map(b => b.box_id);
            const placeholders = boxIds.map(() => '?').join(',');
            
            const scannedItems = await db.getAllAsync<{
              item_code: string;
              scanned_qty: number;
              box_id: string;
            }>(
              `SELECT item_code, SUM(scanned_qty) as scanned_qty, box_id
               FROM scanned_items
               WHERE box_id IN (${placeholders})
                 AND asn_no = ?
               GROUP BY item_code, box_id
               HAVING scanned_qty > 0`,
              [...boxIds, asn || '']
            );
            
            console.warn(`📦 Found ${scannedItems.length} item record(s) in boxes for TC ${selectedTC}`);
            console.warn(`📋 [CARTON_ID_TRACK] Scanned items from boxes (raw):`, scannedItems.map(i => ({ item_code: i.item_code, box_id: i.box_id, qty: i.scanned_qty })));
            
            // ✅ FIX: Track box_id per item for Transfer In items (box_id needs to be sent as carton_id)
            // Group by item_code and box_id to preserve box_id information
            const itemBoxMap = new Map<string, { qty: number; box_id: string }[]>();
            for (const item of scannedItems) {
              console.warn(`📋 [CARTON_ID_TRACK] Processing scanned item: ${item.item_code}, box_id: ${item.box_id}`);
              const key = item.item_code;
              if (!itemBoxMap.has(key)) {
                itemBoxMap.set(key, []);
              }
              const itemList = itemBoxMap.get(key)!;
              // Check if this box_id already exists for this item_code
              const existingBox = itemList.find(b => b.box_id === item.box_id);
              if (existingBox) {
                existingBox.qty += item.scanned_qty || 0;
              } else {
                itemList.push({ qty: item.scanned_qty || 0, box_id: item.box_id });
              }
            }
            
            // Build items array for API
            // ✅ FIX: For Transfer In items from BOXes, include box_id as carton_id
            // ✅ CRITICAL: Send separate items per box (Option 2) to preserve carton_id for each box
            // This ensures backend receives separate items for each box, each with its own carton_id
            items = Array.from(itemBoxMap.entries()).flatMap(([item_code, boxList]) => {
              // Option 2: Send separate items per box (one per box_id)
              // This is important when the same item_code is in multiple boxes
              return boxList.map(box => {
                const item: any = {
                  item_code,
                  qty: Number(box.qty.toFixed(2)), // Quantity for this specific box
                  source_bin: "DOCK-01", // Default source bin (can be enhanced to get from settings or event)
                  // location_id removed - will be sent at header level instead
                  target_bin: selectedBin || selectedRack || undefined, // Backward compatibility: also send target_bin
                  completed: true,
                };
                
                // ✅ FIX: Include box_id as carton_id for Transfer In items from BOXes
                // This ensures backend can track BOX ID in Stock Ledger, Transaction History, and Item Bin Location
                if (box.box_id) {
                  item.carton_id = box.box_id; // Backend uses carton_id field for box_id tracking
                  console.warn(`📦 [CARTON_ID_TRACK] Including box_id as carton_id for item ${item_code}: ${box.box_id} (qty: ${box.qty})`);
                } else {
                  console.warn(`📦 [CARTON_ID_TRACK] ⚠️ Box entry missing box_id for item ${item_code}`);
                }
                
                return item;
              });
            });
            
            // ✅ FIX: Verify duplicates by item_code + carton_id combination
            // Allow multiple items with same item_code if they have different carton_ids
            // This is important for Transfer In putaway where items might be in different boxes
            const itemKeys = items.map(i => `${i.item_code}|${i.carton_id || 'NO_CARTON'}`);
            const uniqueKeys = new Set(itemKeys);
            if (itemKeys.length !== uniqueKeys.size) {
              console.warn(`⚠️ [CARTON_ID_TRACK] Duplicate item_code+carton_id combinations found!`, {
                totalItems: items.length,
                uniqueItems: uniqueKeys.size,
                duplicates: itemKeys.filter((key, index) => itemKeys.indexOf(key) !== index)
              });
              // Remove duplicates by keeping only the first occurrence of each item_code+carton_id combination
              const seen = new Set<string>();
              items = items.filter(item => {
                const key = `${item.item_code}|${item.carton_id || 'NO_CARTON'}`;
                if (seen.has(key)) {
                  console.warn(`⚠️ [CARTON_ID_TRACK] Removing duplicate item: ${item.item_code} with carton_id: ${item.carton_id || 'MISSING'}`);
                  return false;
                }
                seen.add(key);
                return true;
              });
            }
            
            console.warn(`✅ Built items array with ${items.length} unique item(s) for putaway completion:`, items.map(i => ({
              item_code: i.item_code,
              qty: i.qty,
              target_bin: i.target_bin,
              box_id: i.box_id
            })));
            } else {
            // No boxes found - might be a Putaway box (BOX ID = TC ID)
            // ✅ NEW: For Transfer In putaway, box ID format is TI-* or TI-PUT-* (from Box Management)
            // Try to get items directly from scanned_items using TC ID as box_id
            // Note: isPutawayBox is already defined above, but we'll use it here too
            console.warn(`📋 [CARTON_ID_TRACK] No boxes found, trying direct lookup. TC: ${selectedTC}, isPutawayBox: ${isPutawayBox}, isTransferInPutaway: ${isTransferInPutaway}, ASN: ${asn}`);
            
            // ✅ FIX: Try multiple queries for Transfer In items
            // 1. Try with asn_no (if Transfer In items are stored with asn_no = Transfer In number)
            // 2. Try without asn_no filter (in case items don't have asn_no)
            let directItems = await db.getAllAsync<{
              item_code: string;
              scanned_qty: number;
            }>(
              `SELECT item_code, SUM(scanned_qty) as scanned_qty
               FROM scanned_items
               WHERE box_id = ?
                 AND (asn_no = ? OR asn_no IS NULL OR asn_no = '')
               GROUP BY item_code
               HAVING scanned_qty > 0`,
              [selectedTC, asn || '']
            );
            
            console.warn(`📋 [CARTON_ID_TRACK] Direct lookup with ASN filter found ${directItems.length} item(s)`);
            
            // If no items found, try without asn_no filter (for Transfer In items that might not have asn_no)
            if (directItems.length === 0) {
              console.warn(`📋 [CARTON_ID_TRACK] No items found with ASN filter, trying without ASN filter...`);
              directItems = await db.getAllAsync<{
                item_code: string;
                scanned_qty: number;
              }>(
                `SELECT item_code, SUM(scanned_qty) as scanned_qty
                 FROM scanned_items
                 WHERE box_id = ?
                 GROUP BY item_code
                 HAVING scanned_qty > 0`,
                [selectedTC]
              );
              console.warn(`📋 [CARTON_ID_TRACK] Direct lookup without ASN filter found ${directItems.length} item(s)`);
            }
            
            if (directItems.length > 0) {
              console.warn(`📋 [CARTON_ID_TRACK] ✅ Found ${directItems.length} item(s) for Putaway box ${selectedTC}`);
              // ✅ FIX: For Putaway boxes (BOX ID = TC ID), include box_id as carton_id
              // This is especially important for Transfer In items received without carton_id and then put into BOXes
              items = directItems.map(item => {
                const itemObj: any = {
                  item_code: item.item_code,
                  qty: Number((item.scanned_qty || 0).toFixed(2)),
                  source_bin: "DOCK-01",
                  // location_id removed - will be sent at header level instead
                  target_bin: selectedBin || selectedRack || undefined, // Backward compatibility: also send target_bin
                  completed: true,
                };
                
                // ✅ FIX: Include BOX ID as carton_id for Putaway boxes
                // This ensures backend can track BOX ID in Stock Ledger, Transaction History, and Item Bin Location
                if (selectedTC) {
                  itemObj.carton_id = selectedTC; // BOX ID = TC ID for Putaway boxes
                  console.warn(`📦 [CARTON_ID_TRACK] ✅ Including BOX ID (${selectedTC}) as carton_id for item ${item.item_code} in Putaway box`);
                } else {
                  console.warn(`📦 [CARTON_ID_TRACK] ❌ selectedTC is null, cannot set carton_id for item ${item.item_code}`);
                }
                
                return itemObj;
              });
              
              console.warn(`✅ Found ${items.length} item(s) directly from scanned_items for Putaway box ${selectedTC}`);
              console.warn(`📋 [CARTON_ID_TRACK] Direct items summary:`, items.map(i => ({ item_code: i.item_code, carton_id: i.carton_id || 'MISSING' })));
            } else {
              // ✅ FIX: If no items found locally, try to get from backend putaway task
              console.warn(`📋 [CARTON_ID_TRACK] ❌ No items found in scanned_items for ${selectedTC}, trying backend task...`);
              if (currentPutawayTask) {
                try {
                  // Try to get task details from backend
                  const taskDetails = await apiService.getPutawayTask(currentPutawayTask);
                  console.warn(`📋 [CARTON_ID_TRACK] Backend task details response:`, taskDetails ? 'Found' : 'Not found');
                  
                  // ✅ Handle response format: { ok: true, data: { items: [...] } }
                  const taskData = taskDetails?.data || taskDetails;
                  const taskItems = taskData?.items || taskData?.lines || taskDetails?.items || taskDetails?.lines || [];
                  if (taskItems.length > 0) {
                    console.warn(`📋 [CARTON_ID_TRACK] Found ${taskItems.length} item(s) in backend task ${currentPutawayTask}`);
                    
                    items = taskItems.map((line: any, index: number) => {
                      const item: any = {
                        item_code: line.item_code || line.itemCode || line.item,
                        qty: Number(line.qty || line.quantity || 0),
                        carton_id: line.carton_id || line.cartonId || null,
                        location_id: selectedLocationId || selectedRack || selectedBin || undefined,
                        source_bin: "DOCK-01",
                        target_bin: selectedBin || selectedRack || undefined,
                        completed: true,
                      };
                      console.warn(`📋 [CARTON_ID_TRACK] Item ${index + 1}/${taskItems.length} from backend task: ${item.item_code}, carton_id from item: ${line.carton_id || line.cartonId || 'null'}, final carton_id BEFORE fix: ${item.carton_id || 'MISSING'}`);
                      
                      // ✅ CRITICAL FIX: For Transfer In putaway, ALWAYS use TC ID as carton_id if missing
                      // Backend task items don't have carton_id, so we must add it to ALL items
                      if (!item.carton_id && (isPutawayBox || isTransferInPutaway)) {
                        item.carton_id = selectedTC; // BOX ID = TC ID for Putaway boxes
                        console.warn(`📋 [CARTON_ID_TRACK] ✅ Added TC ID as carton_id for item ${item.item_code} (item ${index + 1}): ${selectedTC} (isPutawayBox: ${isPutawayBox}, isTransferInPutaway: ${isTransferInPutaway})`);
                      }
                      
                      console.warn(`📋 [CARTON_ID_TRACK] Item ${index + 1}/${taskItems.length} FINAL: ${item.item_code}, qty: ${item.qty}, carton_id: ${item.carton_id || 'MISSING'}`);
                      return item;
                    }).filter((item: any) => item.item_code && item.qty > 0);
                    
                    console.warn(`📋 [CARTON_ID_TRACK] Items from backend task summary:`, items.map(i => ({ item_code: i.item_code, carton_id: i.carton_id || 'MISSING' })));
                  } else {
                    console.warn(`📋 [CARTON_ID_TRACK] ⚠️ Backend task ${currentPutawayTask} has no lines/items`);
                  }
                } catch (taskError: any) {
                  // ✅ Handle 404 gracefully - endpoint might not exist (don't log as error)
                  const errorMsg = taskError.message || "";
                  if (errorMsg.includes("404") || errorMsg.includes("not found") || errorMsg.includes("Route")) {
                    console.warn(`ℹ️ [CARTON_ID_TRACK] getPutawayTask endpoint not available (404) for ${currentPutawayTask} - will try fallback`);
                  } else {
                    console.warn(`📋 [CARTON_ID_TRACK] ⚠️ Error getting items from backend task:`, errorMsg);
                  }
                  // If getPutawayTask fails, try getPutawayTasks as fallback
                  try {
                    const taskResponse = await apiService.getPutawayTasks({});
                    const allTasks = Array.isArray(taskResponse) ? taskResponse : (taskResponse?.data || []);
                    const matchingTask = allTasks.find((t: any) => 
                      (t.putaway_task || t.title || t.id) === currentPutawayTask
                    );
                    
                    if (matchingTask && (matchingTask.lines || matchingTask.items)) {
                      const taskLines = matchingTask.lines || matchingTask.items || [];
                      console.warn(`📋 [CARTON_ID_TRACK] Found ${taskLines.length} line(s) in backend task list response`);
                      
                      items = taskLines.map((line: any) => {
                        const item: any = {
                          item_code: line.item_code || line.itemCode || line.item,
                          qty: Number(line.qty || line.quantity || 0),
                          carton_id: line.carton_id || line.cartonId || null,
                          location_id: selectedLocationId || selectedRack || selectedBin || undefined,
                          source_bin: "DOCK-01",
                          target_bin: selectedBin || selectedRack || undefined,
                          completed: true,
                        };
                        
                        // ✅ CRITICAL FIX: For Transfer In putaway, ALWAYS use TC ID as carton_id if missing
                        if (!item.carton_id && (isPutawayBox || isTransferInPutaway)) {
                          item.carton_id = selectedTC; // BOX ID = TC ID for Putaway boxes
                          console.warn(`📋 [CARTON_ID_TRACK] ✅ Added TC ID as carton_id for item ${item.item_code}: ${selectedTC} (isPutawayBox: ${isPutawayBox}, isTransferInPutaway: ${isTransferInPutaway})`);
                        }
                        
                        return item;
                      }).filter((item: any) => item.item_code && item.qty > 0);
                    }
                  } catch (fallbackError: any) {
                    console.warn(`📋 [CARTON_ID_TRACK] ⚠️ Fallback task lookup also failed:`, fallbackError.message);
                  }
                }
              } else {
                console.warn(`📋 [CARTON_ID_TRACK] ❌ No putaway task available to fetch items from backend`);
              }
            }
          }
        } catch (itemsError: any) {
          console.warn(`⚠️ Error getting items from TC:`, itemsError.message);
          console.warn(`📋 [CARTON_ID_TRACK] ❌ Exception in item retrieval:`, itemsError.message);
          // Continue without items - backend might be able to determine items from putaway task
        }
      }
      
      // ✅ CRITICAL FIX: Final validation - ensure ALL items have carton_id before sending
      // This is especially important for Transfer In putaway where backend task doesn't have carton_id
      if (items.length > 0) {
        const itemsMissingCartonId = items.filter(item => !item.carton_id);
        if (itemsMissingCartonId.length > 0 && (isPutawayBox || isTransferInPutaway)) {
          console.warn(`📋 [CARTON_ID_TRACK] ⚠️ Found ${itemsMissingCartonId.length} item(s) missing carton_id, adding TC ID...`);
          items = items.map(item => {
            if (!item.carton_id && (isPutawayBox || isTransferInPutaway)) {
              item.carton_id = selectedTC;
              console.warn(`📋 [CARTON_ID_TRACK] ✅ Added TC ID as carton_id for item ${item.item_code}: ${selectedTC}`);
            }
            return item;
          });
        }
      }
      
      // Try to call API to complete putaway task (if currentPutawayTask exists)
      // If no currentPutawayTask, we'll use event-based tracking
      let apiSuccess = false;
      let apiErrorOccurred = false;
      
      if (currentPutawayTask) {
        try {
          // ✅ Determine putaway type (ASN or Transfer In)
          const sourceType = (selectedTCObj as any).source_type || "ASN";
          const isTransferIn = sourceType === "TransferIn";
          const transferInNo = (selectedTCObj as any).transfer_in || selectedTCObj.asn_no || null; // Transfer In number stored in asn_no field
          
          const requestBody: any = {
            putaway_task: currentPutawayTask,
            completed_by: settings.user_id || settings.user_code || undefined,
            // Also send performed_by for backward compatibility
            performed_by: settings.user_id || settings.user_code || undefined,
          };
          
          // ✅ CRITICAL FIX: Send box_id or tc_id based on putaway type (same as ASN)
          // For Transfer In: box_id = carton_id (CTN-TI-... format)
          // For ASN: box_id from sorting (PAW- or BOX- format)
          if (isTransferIn) {
            // Transfer In Putaway: Send box_id (carton_id format)
            if (selectedTC) {
              requestBody.box_id = selectedTC; // ✅ box_id = carton_id for Transfer In
              requestBody.tc_id = null; // Don't send tc_id for Transfer In
            }
          } else {
            // ASN Putaway: Send box_id (from sorting)
            if (selectedTC && (selectedTC.startsWith("PAW-") || selectedTC.startsWith("BOX-"))) {
              requestBody.box_id = selectedTC;
              requestBody.tc_id = null; // Don't send tc_id for ASN putaway
            } else {
              // Fallback: use selectedTC as box_id
              requestBody.box_id = selectedTC;
            }
          }
          
          // ✅ CRITICAL FIX: Get warehouse for Transfer In from tabTransferIn.to_warehouse
          // For ASN: Get from location or settings
          // For Transfer In: Get from Transfer In details (to_warehouse)
          let warehouseId: string | undefined = undefined;
          if (isTransferIn && transferInNo) {
            try {
              // Fetch Transfer In details to get to_warehouse
              const transferInDetails = await apiService.getTransferIn(transferInNo);
              warehouseId = 
                transferInDetails?.to_warehouse ||
                transferInDetails?.data?.to_warehouse ||
                transferInDetails?.warehouse ||
                transferInDetails?.data?.warehouse ||
                undefined;
              
              if (warehouseId) {
                console.warn(`✅ Transfer In Putaway: Using warehouse from Transfer In details: ${warehouseId}`);
              } else {
                console.warn(`⚠️ Transfer In Putaway: to_warehouse not found in Transfer In details, trying location/settings...`);
              }
            } catch (tiError: any) {
              console.warn(`⚠️ Error fetching Transfer In details for warehouse:`, tiError.message);
            }
          }
          
          // Fallback: Get warehouse from location or settings (for both ASN and Transfer In)
          if (!warehouseId) {
            // Try to get location from validatedData or fetch it
            let locationData: any = null;
            if (validatedData?.location?.warehouse_id || validatedData?.location?.warehouse) {
              locationData = validatedData.location;
            } else if (selectedLocationId) {
              // Fetch location from cache
              try {
                locationData = await dataService.getLocation(selectedLocationId);
              } catch (locError: any) {
                console.warn(`⚠️ Error fetching location for warehouse:`, locError.message);
              }
            }
            
            warehouseId = 
              locationData?.warehouse_id || 
              locationData?.warehouse || 
              settings.warehouse_id || 
              settings.warehouse || 
              undefined;
            
            if (warehouseId) {
              console.warn(`✅ Using warehouse from ${locationData?.warehouse_id ? 'location' : 'settings'}: ${warehouseId}`);
            }
          }
          
          // ✅ Include warehouse in request (backend needs it for stock updates)
          if (warehouseId) {
            requestBody.warehouse = warehouseId;
            requestBody.warehouse_id = warehouseId; // Send both for compatibility
            console.warn(`📤 Sending warehouse: ${warehouseId} (for stock ledger updates)`);
          } else {
            console.warn(`⚠️ No warehouse found - backend may not update stock correctly`);
          }
          
          // ✅ FIX: CRITICAL - Always send location_id at header level (required by backend)
          // Priority: selectedLocationId (from scan) > selectedRack > selectedBin > task location_id (from backend)
          const locationIdToSend = selectedLocationId || selectedRack || selectedBin;
          if (locationIdToSend) {
            requestBody.location_id = locationIdToSend;
            console.warn(`📤 Sending header-level location_id: ${locationIdToSend} (from: ${selectedLocationId ? 'selectedLocationId' : selectedRack ? 'selectedRack' : 'selectedBin'})`);
          } else {
            // Try to get location_id from the putaway task (if it was stored when fetching tasks)
            const taskObj = sealedTCs.find(tc => (tc as any).putaway_task === currentPutawayTask);
            if (taskObj && (taskObj as any).location_id) {
              requestBody.location_id = (taskObj as any).location_id;
              console.warn(`📤 Using location_id from task: ${(taskObj as any).location_id}`);
            } else {
              // ✅ FIX: If no location_id available, throw error before calling API
              throw new Error(
                "Location is required to complete putaway.\n\n" +
                "Please scan a location (rack/bin) before completing putaway.\n\n" +
                "The backend requires location_id to be set via POST /api/putaway/scan-transfer-carton first."
              );
            }
          }
          
          // Include items array if we have items
          if (items.length > 0) {
            // ✅ FIX: Final check - ensure no duplicates by item_code + carton_id combination
            // Allow multiple items with same item_code if they have different carton_ids
            const finalItemKeys = items.map(i => `${i.item_code}|${i.carton_id || 'NO_CARTON'}`);
            const finalUniqueKeys = new Set(finalItemKeys);
            if (finalItemKeys.length !== finalUniqueKeys.size) {
              console.warn(`⚠️ [CARTON_ID_TRACK] Duplicate item_code+carton_id combinations detected before API call! Removing duplicates...`);
              const seen = new Set<string>();
              items = items.filter(item => {
                const key = `${item.item_code}|${item.carton_id || 'NO_CARTON'}`;
                if (seen.has(key)) {
                  console.warn(`⚠️ [CARTON_ID_TRACK] Removing duplicate item before API call: ${item.item_code} with carton_id: ${item.carton_id || 'MISSING'}`);
                  return false;
                }
                seen.add(key);
                return true;
              });
            }
            
            // Include location_id in items as well (backend validation may check items before applying header-level location_id)
            // We send location_id at both header level AND item level for maximum compatibility
            const locationIdToUse = requestBody.location_id || selectedLocationId;
            
            // CRITICAL: Backend requires location_id for all items - validate before sending
            // Check for undefined, null, empty string, or whitespace-only strings
            if (!locationIdToUse || (typeof locationIdToUse === 'string' && locationIdToUse.trim() === '')) {
              throw new Error(
                "Location is required to complete putaway.\n\n" +
                "Please scan a location (rack/bin) before completing putaway.\n\n" +
                "Items cannot be put away without a location."
              );
            }
            
            const itemsWithLocation = items.map(item => {
              const finalItem = {
                ...item,
                location_id: locationIdToUse, // Ensure each item has location_id
                completed: true, // Ensure completed flag is set
              };
              
              // ✅ CRITICAL FIX: Final check - if carton_id is still missing, add it
              // This is a safety net to ensure ALL items have carton_id before sending
              if (!finalItem.carton_id && (isPutawayBox || isTransferInPutaway)) {
                finalItem.carton_id = selectedTC; // BOX ID = TC ID for Putaway boxes
                console.warn(`📋 [CARTON_ID_TRACK] ✅ FINAL FIX: Added TC ID as carton_id for item ${finalItem.item_code}: ${selectedTC}`);
              }
              
              // ✅ TRACK: Log each item's carton_id status before sending
              if (!finalItem.carton_id) {
                console.warn(`⚠️ [CARTON_ID_TRACK] ❌ CRITICAL: Item ${finalItem.item_code} is missing carton_id in final request!`);
              } else {
                console.warn(`✅ [CARTON_ID_TRACK] Item ${finalItem.item_code} has carton_id: ${finalItem.carton_id}`);
              }
              return finalItem;
            });
            
            requestBody.items = itemsWithLocation;
            
            // ✅ TRACK: Comprehensive logging of final request
            const itemsWithCartonId = itemsWithLocation.filter(i => i.carton_id);
            const itemsWithoutCartonId = itemsWithLocation.filter(i => !i.carton_id);
            console.warn(`📤 [CARTON_ID_TRACK] ========== FINAL PUTAWAY REQUEST SUMMARY ==========`);
            console.warn(`📤 [CARTON_ID_TRACK] Total items: ${itemsWithLocation.length}`);
            console.warn(`📤 [CARTON_ID_TRACK] Items WITH carton_id: ${itemsWithCartonId.length}`, itemsWithCartonId.map(i => ({ item_code: i.item_code, carton_id: i.carton_id })));
            console.warn(`📤 [CARTON_ID_TRACK] Items WITHOUT carton_id: ${itemsWithoutCartonId.length}`, itemsWithoutCartonId.map(i => ({ item_code: i.item_code })));
            console.warn(`📤 [CARTON_ID_TRACK] Full request body:`, JSON.stringify(requestBody, null, 2));
            console.warn(`📤 [CARTON_ID_TRACK] ================================================`);
            
            console.warn(`📤 Sending ${itemsWithLocation.length} unique item(s) in putaway completion request (location_id: ${locationIdToUse} at header and item level)`);
          } else {
            console.warn(`⚠️ No items found for TC ${selectedTC} - sending completion without items array`);
          }
          
          const response = await apiService.completePutaway(requestBody);
          apiSuccess = true;
          apiErrorOccurred = false;
          console.warn(`✅ Putaway task completed via API: ${currentPutawayTask}`);
          
          // After successful API call, sync master data back to update status
          try {
            console.warn(`🔄 Syncing master data to update status after putaway completion...`);
            const { syncMasterDataFromDesktop } = await import("../services/master-data-sync.service");
            await syncMasterDataFromDesktop();
            console.warn(`✅ Master data synced - status updated back to mobile`);
          } catch (syncError: any) {
            console.warn(`⚠️ Error syncing master data:`, syncError.message);
            // Don't block - status will sync later
          }
        } catch (apiError: any) {
          apiErrorOccurred = true;
          
          // Check if this is related to Putaway box not being recognized
          const isPutawayBox = selectedTC?.startsWith("PAW-");
          const isTransferCartonNotFound = 
            apiError.message?.includes("TRANSFER_CARTON_NOT_FOUND") ||
            apiError.message?.includes("transfer carton not found") ||
            (apiError.message?.includes("Transfer carton") && apiError.message?.includes("not found"));
          
          // If API endpoint doesn't exist (404), fall back to event-based approach
          if (apiError.message?.includes("404") || apiError.message?.includes("not found")) {
            if (isTransferCartonNotFound && isPutawayBox) {
              console.warn(`⚠️ Putaway box ${selectedTC} not recognized during completion - using event-based approach`);
              console.warn(`   This is expected for Putaway boxes. Backend may need to handle Putaway boxes separately.`);
            } else {
              console.warn(`⚠️ Putaway complete API endpoint not available (404) - using event-based approach`);
              console.warn(`   Backend needs to implement: POST /api/putaway/complete`);
            }
            // Continue with event-based approach below
          } else if (apiError.message?.includes("TASK_NOT_FOUND")) {
            // Task not found - continue with event-based approach instead of blocking
            console.warn(`⚠️ Putaway task ${currentPutawayTask} not found in backend - using event-based approach`);
            // Continue with event-based approach below
          } else if (isTransferCartonNotFound) {
            // Transfer carton not found error - likely Putaway box not recognized
            if (isPutawayBox) {
              console.warn(`⚠️ Putaway box ${selectedTC} not found in backend during completion - using event-based approach`);
              console.warn(`   Backend may not recognize Putaway boxes (PAW- prefix) as transfer cartons.`);
            } else {
              console.warn(`⚠️ Transfer carton ${selectedTC} not found in backend during completion - using event-based approach`);
            }
            // Continue with event-based approach below
          } else if (apiError.message?.includes("warehouse") || apiError.message?.includes("DATABASE_ERROR")) {
            // Backend database schema error - continue with event-based approach
            console.warn(`⚠️ Putaway complete API database error:`, apiError.message);
            console.warn(`   This is a backend database schema issue. Continuing with event-based tracking.`);
            // Continue with event-based approach below
          } else {
            // For other errors, show warning but continue with event-based approach
            console.warn(`⚠️ Putaway complete API error:`, apiError.message);
            console.warn(`   Continuing with event-based approach for offline support.`);
          }
        }
      } else {
        // No putaway task - use event-based approach
        console.warn(`ℹ️ No putaway task available - using event-based tracking for putaway completion`);
      }

      // ✅ CRITICAL: Only update local database AFTER backend confirmation
      // Always record event for local tracking first (offline support)
      let dispatchEventId: string | null = null;
      if (asn) {
        const normalizedASN = normalizeASN(asn);
        dispatchEventId = await addEvent({
          event_type: "PUTAWAY_DISPATCH",
          asn_no: normalizedASN,
          inbound_session: session,
          tc_id: selectedTC,
          store: "WAREHOUSE",
          device_id: settings.device_id,
          user_id: settings.user_id,
        });
      }

      // ✅ Sync events to backend FIRST
      let syncSuccess = false;
      try {
        console.warn(`🔄 Syncing putaway events to backend...`);
        const syncResult = await syncEvents();
        console.warn(`✅ Synced ${syncResult.synced} event(s), ${syncResult.failed} failed`);
        syncSuccess = syncResult.failed === 0;
        
        if (syncResult.failed > 0) {
          console.warn(`⚠️ Some events failed to sync. Please check Sync Center.`);
        }
      } catch (syncError: any) {
        console.warn(`⚠️ Error syncing events:`, syncError.message);
        // Continue - will verify from backend below
      }

      // ✅ Verify from backend that transaction was processed
      // Only update local database status AFTER backend confirmation
      const locationId = selectedLocationId || selectedRack || selectedBin || "";
      const backendConfirmed = await verifyPutawayTransactionFromBackend(
        selectedTC,
        locationId,
        asn
      );

      if (backendConfirmed) {
        // ✅ Backend confirmed - safe to update local database
        await dataService.updateTransferCartonStatus(selectedTC, "Completed");
        console.log(`✅ PutAwayScreen: TC ${selectedTC} marked as Completed (backend confirmed)`);

        // Mark dispatch event as synced if it exists
        if (dispatchEventId) {
          await markEventSynced(dispatchEventId);
          console.log(`✅ Dispatch event marked as synced`);
        }

        // Also mark PUTAWAY_TO_RACK event as synced if exists
        const putawayToRackEvent = await db.getFirstAsync<{ offline_uuid: string }>(
          `SELECT offline_uuid FROM event_queue 
           WHERE event_type = 'PUTAWAY_TO_RACK' 
             AND tc_id = ? 
             AND synced = 0 
           ORDER BY event_time DESC 
           LIMIT 1`,
          [selectedTC]
        );

        if (putawayToRackEvent) {
          await markEventSynced(putawayToRackEvent.offline_uuid);
          console.log(`✅ PUTAWAY_TO_RACK event marked as synced`);
        }
      } else if (apiSuccess && currentPutawayTask && !apiErrorOccurred) {
        // ✅ API succeeded - safe to update even if verification didn't work
        await dataService.updateTransferCartonStatus(selectedTC, "Completed");
        console.log(`✅ PutAwayScreen: TC ${selectedTC} marked as Completed (API success)`);

        if (dispatchEventId) {
          await markEventSynced(dispatchEventId);
        }

        // Also mark PUTAWAY_TO_RACK event as synced
        const putawayToRackEvent = await db.getFirstAsync<{ offline_uuid: string }>(
          `SELECT offline_uuid FROM event_queue 
           WHERE event_type = 'PUTAWAY_TO_RACK' 
             AND tc_id = ? 
             AND synced = 0 
           ORDER BY event_time DESC 
           LIMIT 1`,
          [selectedTC]
        );

        if (putawayToRackEvent) {
          await markEventSynced(putawayToRackEvent.offline_uuid);
        }
      } else if (syncSuccess) {
        // ✅ Events synced successfully - use as confirmation for offline-first architecture
        // This is especially important for Transfer In putaway where putawayTask might not be available
        await dataService.updateTransferCartonStatus(selectedTC, "Completed");
        console.log(`✅ PutAwayScreen: TC ${selectedTC} marked as Completed (events synced successfully)`);

        if (dispatchEventId) {
          await markEventSynced(dispatchEventId);
        }

        // Also mark PUTAWAY_TO_RACK event as synced
        const putawayToRackEvent = await db.getFirstAsync<{ offline_uuid: string }>(
          `SELECT offline_uuid FROM event_queue 
           WHERE event_type = 'PUTAWAY_TO_RACK' 
             AND tc_id = ? 
             AND synced = 0 
           ORDER BY event_time DESC 
           LIMIT 1`,
          [selectedTC]
        );

        if (putawayToRackEvent) {
          await markEventSynced(putawayToRackEvent.offline_uuid);
        }
      } else {
        // ❌ Backend not confirmed, API didn't succeed, and events didn't sync
        // Don't update local status - transaction is stuck
        console.warn(`⚠️ PutAwayScreen: TC ${selectedTC} NOT marked as Completed - backend confirmation failed`);
        console.warn(`⚠️ User will need to retry/verify from Put Away Transactions list`);
        console.warn(`⚠️ Debug info: apiSuccess=${apiSuccess}, putawayTask=${currentPutawayTask}, apiErrorOccurred=${apiErrorOccurred}, syncSuccess=${syncSuccess}`);
        
        Alert.alert(
          "Warning",
          `Put Away completion recorded locally but backend confirmation failed.\n\nTC: ${selectedTC}\n\nPlease check "Put Away Transactions" and retry if needed.`
        );
        // Don't update status - let user retry from transactions list
        return; // Exit early - don't show success message
      }

      // Get location ID for display (use selectedLocationId, selectedRack, or selectedBin)
      const locationIdForDisplay = selectedLocationId || selectedRack || selectedBin || "";
      const locationDisplay = locationIdForDisplay ? `\nLocation ID: ${locationIdForDisplay}` : "";

      if (apiSuccess && currentPutawayTask && !apiErrorOccurred) {
        // API succeeded with putaway task
        Alert.alert(
          "Success",
          `Put Away completed for Putaway box ${selectedTC}${locationDisplay}\n\nPutaway task: ${currentPutawayTask}\n\nEvents synced to backend.`
        );
      } else if (currentPutawayTask && apiErrorOccurred) {
        // Had putaway task but API failed
        Alert.alert(
          "Success",
          `Put Away completed for Putaway box ${selectedTC}${locationDisplay}\n\nNote: Backend putaway API error. Using event-based tracking.\n\nEvents synced to backend.`
        );
      } else {
        // No putaway task - event-based only
        Alert.alert(
          "Success",
          `Put Away completed for Putaway box ${selectedTC}${locationDisplay}\n\nNote: Using event-based tracking.\n\nEvents synced to backend.`
        );
      }

      // Reset and reload list (Completed TCs will be filtered out)
      setSelectedTC(null);
      setSelectedTCObj(null);
      setPutawayTask(null);
      setSelectedLocationId(null);
      setSelectedRack(null);
      setSelectedBin(null);
      
      // Force refresh the list to ensure Completed TCs are excluded
      // Add a small delay to ensure database update is committed
      await new Promise(resolve => setTimeout(resolve, 100));
      await loadSealedTCs();
      setWorkflowState("PUTAWAY_LIST");
    } catch (error: any) {
      console.error("❌ Error completing putaway:", error);
      const errorMessage = error.message || "Failed to complete put away";
      Alert.alert("Error", errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Render UI based on workflow state
  const renderWorkflowStep = () => {
    console.log("🔄 PutAwayScreen: Rendering workflow step:", workflowState);
    switch (workflowState) {
      case "PUTAWAY_LIST":
        console.log(
          "📋 PutAwayScreen: Rendering PUTAWAY_LIST, sealedTCs:",
          sealedTCs.length
        );
        return (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>Put Away List</Text>
            
            {/* Source Type Filter Tabs */}
            <View style={styles.filterContainer}>
              <TouchableOpacity
                style={[
                  styles.filterTab,
                  putawaySourceType === "ASN" && styles.filterTabActive,
                ]}
                onPress={() => {
                  setPutawaySourceType("ASN");
                  loadSealedTCs();
                }}
              >
                <Text
                  style={[
                    styles.filterTabText,
                    putawaySourceType === "ASN" && styles.filterTabTextActive,
                  ]}
                >
                  ASN
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.filterTab,
                  putawaySourceType === "TransferIn" && styles.filterTabActive,
                ]}
                onPress={() => {
                  setPutawaySourceType("TransferIn");
                  loadSealedTCs();
                }}
              >
                <Text
                  style={[
                    styles.filterTabText,
                    putawaySourceType === "TransferIn" && styles.filterTabTextActive,
                  ]}
                >
                  Transfer In
                </Text>
              </TouchableOpacity>
            </View>
            
            <Text style={styles.infoText}>
              {putawaySourceType === "TransferIn"
                ? "Transfer In putaway tasks ready for put away"
                : putawaySourceType === "ASN"
                ? "Sealed Putaway boxes ready for put away"
                : "Putaway tasks ready for put away"}
            </Text>
            {sealedTCs.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  {putawaySourceType === "TransferIn"
                    ? "No Transfer In putaway tasks available"
                    : putawaySourceType === "ASN"
                    ? "No sealed Putaway boxes available"
                    : "No putaway tasks available"}
                </Text>
                {putawaySourceType === "TransferIn" ? (
                  <>
                    <Text style={styles.emptySubtext}>
                      Transfer In putaway tasks are created automatically when all items are received.
                    </Text>
                    <Text style={styles.emptySubtext}>
                      To create a Transfer In putaway task:
                    </Text>
                    <Text style={styles.emptySubtext}>
                      1. Go to Transfer In screen
                    </Text>
                    <Text style={styles.emptySubtext}>
                      2. Receive all items in a Transfer In
                    </Text>
                    <Text style={styles.emptySubtext}>
                      3. Putaway task will be created automatically
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.emptySubtext}>
                      Putaway boxes must be sealed and belong to WAREHOUSE to
                      appear here.
                    </Text>
                    <Text style={styles.emptySubtext}>
                      {activeASN ? `Current ASN: ${activeASN}` : "No active ASN"}
                    </Text>
                    <Text style={styles.emptySubtext}>
                      To create a Putaway box for put away:
                    </Text>
                    <Text style={styles.emptySubtext}>1. Go to Packing screen</Text>
                    <Text style={styles.emptySubtext}>
                      2. Select WAREHOUSE store
                    </Text>
                    <Text style={styles.emptySubtext}>
                      3. Create and seal a Putaway box
                    </Text>
                  </>
                )}
              </View>
            ) : (
              <>
                {/* Transfer Cartons Section */}
                {sealedTCs.length > 0 && (
                  <>
                    <Text style={[styles.sectionTitle, { marginBottom: 12, marginTop: 0 }]}>
                      📦 Putaway boxes ({sealedTCs.length})
                    </Text>
                    <FlatList
                      data={sealedTCs}
                      keyExtractor={(item) => item.tc_id}
                      renderItem={({ item }) => {
                        // Debug: Log putaway_task for troubleshooting
                        const putawayTaskId = (item as any).putaway_task;
                        if (putawayTaskId) {
                          console.warn(`📋 Rendering box ${item.tc_id} with putaway_task: ${putawayTaskId}`);
                        } else {
                          console.warn(`⚠️ Rendering box ${item.tc_id} WITHOUT putaway_task`);
                        }
                        
                        const sourceType = (item as any).source_type || "ASN";
                        const transferIn = (item as any).transfer_in;
                        const isTransferIn = sourceType === "TransferIn";
                        
                        // ✅ NEW: Get box_id (carton ID) for display (per user requirements)
                        // For Transfer In, box_id = carton_id (CTN-TI-* format)
                        // For ASN, box_id = tc_id (PAW-* or BOX-* format)
                        const displayBoxId = (item as any).carton_id || (item as any).box_id || item.tc_id;
                        
                        return (
                          <TouchableOpacity
                            style={styles.tcCard}
                            onPress={() => handleTCSelection(item.tc_id)}
                          >
                            <View style={styles.tcCardHeader}>
                              {/* ✅ NEW: Show Box ID (carton ID) instead of task title */}
                              <Text style={styles.tcId}>
                                Box: {displayBoxId}
                              </Text>
                              {/* ✅ StatusBadge moved below Box ID for better visibility */}
                              <View style={styles.statusBadgeContainer}>
                                <StatusBadge status={item.status} />
                              </View>
                            </View>
                            {/* ✅ NEW: Show putaway task separately (for reference) */}
                            {putawayTaskId && (
                              <Text style={styles.tcDetail}>
                                Task: {putawayTaskId}
                              </Text>
                            )}
                            {isTransferIn ? (
                              <>
                                <Text style={styles.tcDetail}>
                                  Transfer In: {transferIn || item.asn_no}
                                </Text>
                                {(item as any).warehouse && (
                                  <Text style={styles.tcDetail}>
                                    Warehouse: {(item as any).warehouse}
                                  </Text>
                                )}
                                {/* ✅ NEW: Show location if assigned */}
                                {(item as any).location_id ? (
                                  <Text style={styles.tcDetail}>
                                    Location: {(item as any).location_id}
                                  </Text>
                                ) : (
                                  <Text style={[styles.tcDetail, { color: "#999" }]}>
                                    Location: TBD
                                  </Text>
                                )}
                              </>
                            ) : (
                              <>
                                <Text style={styles.tcDetail}>ASN: {item.asn_no}</Text>
                                <Text style={styles.tcDetail}>
                                  Store: {item.store} | Updated:{" "}
                                  {new Date(item.updated_on).toLocaleDateString()}
                                </Text>
                              </>
                            )}
                            <Text style={styles.tapHint}>
                              Double tap or scan to select
                            </Text>
                          </TouchableOpacity>
                        );
                      }}
                      scrollEnabled={false}
                    />
                  </>
                )}

                {/* Remaining Items Section removed - user prefers to see only TCs/Boxes, not individual items */}

                {/* Scan Section */}
                <View style={styles.scanSection}>
                  <Text style={styles.scanSectionTitle}>
                    Or Scan Putaway box
                  </Text>
                  <BarcodeScanner
                    onScan={handleTCScan}
                    placeholder="Scan Putaway box barcode"
                    title="Putaway box"
                  />
                </View>
              </>
            )}
            <TouchableOpacity
              style={styles.transactionButton}
              onPress={() => {
                setWorkflowState("PUTAWAY_TRANSACTIONS");
                loadTransactions();
              }}
            >
              <Text style={styles.transactionButtonText}>
                View Put Away Transactions
              </Text>
            </TouchableOpacity>
          </View>
        );

      case "PUTAWAY_TRANSACTIONS":
        return (
          <View style={styles.section}>
            <View style={styles.transactionHeader}>
              <Text style={styles.stepTitle}>Put Away Transactions</Text>
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => setWorkflowState("PUTAWAY_LIST")}
              >
                <Text style={styles.backButtonText}>← Back</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.infoText}>
              List of all Put Away transactions with sync status
            </Text>
            {loading ? (
              <ActivityIndicator
                size="large"
                color="#007AFF"
                style={styles.loader}
              />
            ) : transactions.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  No Put Away transactions found
                </Text>
                <Text style={styles.emptySubtext}>
                  Transactions will appear here after you complete put away
                  operations.
                </Text>
              </View>
            ) : (
              <FlatList
                data={transactions}
                keyExtractor={(item) => item.offline_uuid}
                renderItem={({ item }) => (
                  <View style={styles.transactionCard}>
                    <View style={styles.transactionCardHeader}>
                      <Text style={styles.transactionTCId}>
                        {item.tc_id || "N/A"}
                      </Text>
                      <View
                        style={[
                          styles.syncBadge,
                          item.synced === 1
                            ? styles.syncBadgeSynced
                            : styles.syncBadgePending,
                        ]}
                      >
                        <Text
                          style={[
                            styles.syncBadgeText,
                            item.synced === 1
                              ? styles.syncBadgeTextSynced
                              : styles.syncBadgeTextPending,
                          ]}
                        >
                          {item.synced === 1 ? "Synced" : "Pending"}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.transactionDetails}>
                      <View style={styles.transactionDetailRow}>
                        <Text style={styles.transactionLabel}>Location ID:</Text>
                        <Text style={styles.transactionValue}>
                          {item.rack || "N/A"}
                        </Text>
                      </View>
                      {item.asn_no && (
                        <View style={styles.transactionDetailRow}>
                          <Text style={styles.transactionLabel}>ASN:</Text>
                          <Text style={styles.transactionValue}>
                            {item.asn_no}
                          </Text>
                        </View>
                      )}
                      <View style={styles.transactionDetailRow}>
                        <Text style={styles.transactionLabel}>Date:</Text>
                        <Text style={styles.transactionValue}>
                          {new Date(item.event_time).toLocaleString()}
                        </Text>
                      </View>
                    </View>
                    {/* ✅ NEW: Retry button for unsynced transactions */}
                    {item.synced === 0 && (
                      <TouchableOpacity
                        style={styles.retryButton}
                        onPress={() => handleRetryPutawayTransaction(item)}
                        disabled={loading}
                      >
                        <Text style={styles.retryButtonText}>
                          {loading ? "Verifying..." : "Retry & Verify"}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {/* ✅ NEW: Update Stock button for synced transactions */}
                    {item.synced === 1 && (
                      <TouchableOpacity
                        style={styles.updateStockButton}
                        onPress={() => handleUpdateStockForPutaway(item)}
                        disabled={loading}
                      >
                        <Text style={styles.updateStockButtonText}>
                          {loading ? "Updating Stock..." : "Update Stock"}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                scrollEnabled={false}
              />
            )}
          </View>
        );

      case "SCAN_TC_FOR_PUTAWAY":
        return (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>
              Step 11: Select Putaway box
            </Text>
            <BarcodeScanner
              onScan={handleTCScan}
              placeholder="Scan Putaway box barcode"
              title="Putaway box"
            />
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={() => setWorkflowState("PUTAWAY_LIST")}
            >
              <Text style={styles.secondaryButtonText}>Back to List</Text>
            </TouchableOpacity>
          </View>
        );

      case "SCAN_CARTON_OR_ITEM":
        return (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>Step 11b: Scan Carton or Item</Text>
            {selectedTCObj && (selectedTCObj as any).transfer_in && (
              <View style={styles.selectedCard}>
                <Text style={styles.selectedLabel}>Transfer In:</Text>
                <Text style={styles.selectedValue}>{(selectedTCObj as any).transfer_in}</Text>
                {putawayTask && (
                  <>
                    <Text style={styles.selectedLabel}>Putaway Task:</Text>
                    <Text style={styles.selectedValue}>{putawayTask}</Text>
                  </>
                )}
              </View>
            )}
            <Text style={styles.infoText}>
              Scan a carton ID (CTN-xxx) or item code for loose items
            </Text>
            <BarcodeScanner
              onScan={handleCartonOrItemScan}
              placeholder="Scan carton ID or item code"
              title="Carton/Item"
            />
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={() => {
                setSelectedTC(null);
                setSelectedTCObj(null);
                setPutawayTask(null);
                setSelectedCartonOrItem(null);
                setSelectedItemCode(null);
                setWorkflowState("PUTAWAY_LIST");
              }}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        );

      case "SCAN_LOCATION":
        return (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>Step 12: Scan Location</Text>
            {selectedTC && (
              <View style={styles.selectedCard}>
                <Text style={styles.selectedLabel}>
                  {(selectedTCObj as any)?.source_type === "TransferIn" ? "Putaway Task:" : "Selected TC:"}
                </Text>
                <Text style={styles.selectedValue}>{selectedTC}</Text>
                {(selectedTCObj as any)?.source_type === "TransferIn" && putawayTask && (
                  <>
                    <Text style={styles.selectedLabel}>Transfer In:</Text>
                    <Text style={styles.selectedValue}>{(selectedTCObj as any)?.transfer_in || (selectedTCObj as any)?.asn_no || "N/A"}</Text>
                    <Text style={[styles.selectedLabel, { marginTop: 8, fontSize: 12, color: "#666" }]}>
                      ℹ️ All items in this task will be assigned to the scanned location
                    </Text>
                  </>
                )}
                {/* Show carton/item only if they were scanned (legacy workflow) */}
                {(selectedTCObj as any)?.source_type === "TransferIn" && !putawayTask && (
                  <>
                    {selectedCartonOrItem && (
                      <>
                        <Text style={styles.selectedLabel}>Carton ID:</Text>
                        <Text style={styles.selectedValue}>{selectedCartonOrItem}</Text>
                      </>
                    )}
                    {selectedItemCode && (
                      <>
                        <Text style={styles.selectedLabel}>Item Code:</Text>
                        <Text style={styles.selectedValue}>{selectedItemCode}</Text>
                      </>
                    )}
                  </>
                )}
              </View>
            )}
            {/* ✅ NEW: Show validation status */}
            {validatedData && (
              <View style={[styles.selectedCard, { marginTop: 16, backgroundColor: "#E8F5E9" }]}>
                <Text style={[styles.selectedLabel, { fontWeight: "bold", marginBottom: 8 }]}>
                  Validation Status:
                </Text>
                {validatedData.carton_id || validatedData.box_id ? (
                  <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                    <Text style={{ fontSize: 16, marginRight: 8 }}>✅</Text>
                    <Text style={styles.selectedValue}>
                      Carton/Box: {validatedData.carton_id || validatedData.box_id}
                    </Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                    <Text style={{ fontSize: 16, marginRight: 8 }}>⏳</Text>
                    <Text style={[styles.selectedValue, { color: "#666" }]}>
                      Carton/Box: Not validated
                    </Text>
                  </View>
                )}
                {validatedData.location_id ? (
                  <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                    <Text style={{ fontSize: 16, marginRight: 8 }}>✅</Text>
                    <Text style={styles.selectedValue}>
                      Location: {validatedData.location_id}
                    </Text>
                    {validatedData.location.rack && (
                      <Text style={[styles.selectedValue, { marginLeft: 8, fontSize: 12, color: "#666" }]}>
                        ({validatedData.location.rack}, {validatedData.location.bin})
                      </Text>
                    )}
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                    <Text style={{ fontSize: 16, marginRight: 8 }}>⏳</Text>
                    <Text style={[styles.selectedValue, { color: "#666" }]}>
                      Location: Not validated
                    </Text>
                  </View>
                )}
                {isReadyForCompletion && (
                  <View style={{ marginTop: 8, padding: 8, backgroundColor: "#4CAF50", borderRadius: 4 }}>
                    <Text style={{ color: "#FFF", fontWeight: "bold", textAlign: "center" }}>
                      ✅ Ready to Complete Putaway
                    </Text>
                  </View>
                )}
              </View>
            )}
            {/* ✅ Single Location Input - handles both manual entry and barcode scanning */}
            <View style={{ marginTop: 16, marginBottom: 16 }}>
              <Text style={[styles.selectedLabel, { marginBottom: 8 }]}>
                Location ID:
              </Text>
              <TextInput
                ref={locationInputRef}
                style={{
                  borderWidth: 1,
                  borderColor: "#DDD",
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 16,
                  backgroundColor: "#FFF",
                  minHeight: 48,
                }}
                value={scannedLocationInput}
                onChangeText={(text) => setScannedLocationInput(text.trim().toUpperCase())}
                onSubmitEditing={() => {
                  // Auto-submit on Enter (from barcode scanner or keyboard)
                  if (scannedLocationInput && scannedLocationInput.trim() !== "") {
                    handleSubmitLocation();
                  }
                }}
                placeholder="Scan or enter location ID (e.g., A1-R02-L1-B2)"
                placeholderTextColor="#999"
                autoCapitalize="characters"
                editable={true}
                autoFocus={true}
              />
              {scannedLocationInput && (
                <Text style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                  Scanned/Entered: {scannedLocationInput}
                </Text>
              )}
            </View>
            
            {/* ✅ Submit button to validate location */}
            {scannedLocationInput && scannedLocationInput.trim() !== "" && (
              <TouchableOpacity
                style={[styles.button, { marginTop: 8, marginBottom: 16 }]}
                onPress={handleSubmitLocation}
                disabled={loading}
              >
                <Text style={styles.buttonText}>
                  {loading ? "Validating..." : "Submit Location"}
                </Text>
              </TouchableOpacity>
            )}
            
            {/* ✅ NEW: Show Continue button if validated, or allow scanning */}
            {isReadyForCompletion && (
              <TouchableOpacity
                style={[styles.button, { marginTop: 16 }]}
                onPress={() => setWorkflowState("COMPLETE_PUTAWAY")}
              >
                <Text style={styles.buttonText}>Continue to Complete</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={() => {
                setSelectedTC(null);
                setSelectedTCObj(null);
                setPutawayTask(null);
                setSelectedLocationId(null);
                setSelectedRack(null);
                setSelectedBin(null);
                setSelectedCartonOrItem(null);
                setSelectedItemCode(null);
                setScannedLocationInput(""); // ✅ Reset scanned location input
                setValidatedData(null); // ✅ Reset validation state
                setIsReadyForCompletion(false); // ✅ Reset ready state
                setWorkflowState("PUTAWAY_LIST");
              }}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        );

      case "COMPLETE_PUTAWAY":
        return (
          <View style={styles.section}>
            <Text style={styles.stepTitle}>Step 13: Complete Put Away</Text>
            {/* ✅ NEW: Show validation status summary */}
            {validatedData && (
              <View style={[styles.selectedCard, { marginBottom: 16, backgroundColor: "#E8F5E9" }]}>
                <Text style={[styles.selectedLabel, { fontWeight: "bold", marginBottom: 8 }]}>
                  Validated Information:
                </Text>
                {validatedData.carton_id && (
                  <View style={{ marginBottom: 4 }}>
                    <Text style={styles.selectedLabel}>Carton ID:</Text>
                    <Text style={styles.selectedValue}>{validatedData.carton_id}</Text>
                  </View>
                )}
                {validatedData.box_id && (
                  <View style={{ marginBottom: 4 }}>
                    <Text style={styles.selectedLabel}>Box ID:</Text>
                    <Text style={styles.selectedValue}>{validatedData.box_id}</Text>
                  </View>
                )}
                {validatedData.location_id && (
                  <View style={{ marginBottom: 4 }}>
                    <Text style={styles.selectedLabel}>Location ID:</Text>
                    <Text style={styles.selectedValue}>{validatedData.location_id}</Text>
                    {validatedData.location.rack && (
                      <Text style={[styles.selectedValue, { fontSize: 12, color: "#666", marginTop: 2 }]}>
                        Rack: {validatedData.location.rack}, Bin: {validatedData.location.bin}
                      </Text>
                    )}
                  </View>
                )}
              </View>
            )}
            {selectedTC && (
              <View style={styles.selectedCard}>
                <Text style={styles.selectedLabel}>Putaway box:</Text>
                <Text style={styles.selectedValue}>{selectedTC}</Text>
              </View>
            )}
            {/* ✅ NEW: Show validation warning if not ready */}
            {!isReadyForCompletion && (
              <View style={[styles.selectedCard, { backgroundColor: "#FFF3CD", marginBottom: 16 }]}>
                <Text style={[styles.selectedLabel, { color: "#856404" }]}>
                  ⚠️ Validation Required
                </Text>
                <Text style={[styles.selectedValue, { color: "#856404", fontSize: 12 }]}>
                  Please validate carton/box and location before completing putaway.
                </Text>
              </View>
            )}
            <TouchableOpacity
              style={[
                styles.button, 
                (loading || isCompleting || completedTCs.has(selectedTC || '') || !isReadyForCompletion) && styles.buttonDisabled
              ]}
              onPress={handleCompletePutAway}
              disabled={loading || isCompleting || completedTCs.has(selectedTC || '') || !isReadyForCompletion}
              // ✅ NEW: Prevent double-click by checking isCompleting
            >
              <Text style={styles.buttonText}>
                {isCompleting 
                  ? "Completing..." 
                  : loading
                    ? "Processing..."
                    : completedTCs.has(selectedTC || '') 
                      ? "Already Completed" 
                      : !isReadyForCompletion
                        ? "Validation Required"
                        : "Complete Put Away"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={() => {
                setSelectedTC(null);
                setSelectedTCObj(null);
                setPutawayTask(null);
                setSelectedLocationId(null);
                setSelectedRack(null);
                setSelectedBin(null);
                setValidatedData(null); // ✅ Reset validation state
                setIsReadyForCompletion(false); // ✅ Reset ready state
                setWorkflowState("PUTAWAY_LIST");
              }}
            >
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        {/* Header section removed */}

        {loading && workflowState === "PUTAWAY_LIST" ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Loading Transfer Cartons...</Text>
          </View>
        ) : (
          renderWorkflowStep() || (
            <View style={styles.section}>
              <Text style={styles.stepTitle}>Put Away</Text>
              <Text style={styles.infoText}>Initializing...</Text>
            </View>
          )
        )}
      </ScrollView>

      {/* Styled Error Modal */}
      <Modal
        visible={errorModal?.visible || false}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setErrorModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.errorModalContainer}>
            <View style={styles.errorModalHeader}>
              <View style={styles.errorIconContainer}>
                <Text style={styles.errorIcon}>⚠️</Text>
              </View>
              <Text style={styles.errorModalTitle}>
                {errorModal?.title || "Error"}
              </Text>
            </View>
            <View style={styles.errorModalContent}>
              <Text style={styles.errorModalMessage}>
                {errorModal?.message || "An error occurred"}
              </Text>
            </View>
            <View style={styles.errorModalFooter}>
              <TouchableOpacity
                style={styles.errorModalButton}
                onPress={() => setErrorModal(null)}
                activeOpacity={0.7}
              >
                <Text style={styles.errorModalButtonText}>OK</Text>
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
    backgroundColor: "#F5F5F5",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  header: {
    backgroundColor: "#fff",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#E0E0E0",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
  },
  asnBadge: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#E3F2FD",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  asnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1976D2",
  },
  section: {
    backgroundColor: "#fff",
    marginTop: 12,
    padding: 16,
    paddingRight: 20, // ✅ Extra padding on right to prevent StatusBadge cutoff
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#E0E0E0",
  },
  stepTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  infoText: {
    fontSize: 14,
    color: "#666",
    marginBottom: 12,
  },
  emptyContainer: {
    padding: 20,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 18,
    color: "#666",
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 12,
  },
  emptySubtext: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 4,
  },
  loader: {
    marginVertical: 20,
  },
  tcCard: {
    backgroundColor: "#F9F9F9",
    padding: 12,
    paddingRight: 20, // ✅ Increased right padding to prevent StatusBadge cutoff
    borderRadius: 8,
    marginBottom: 8,
    marginHorizontal: 0, // ✅ Remove horizontal margin - section padding handles spacing
    borderLeftWidth: 4,
    borderLeftColor: "#2196F3",
    overflow: "visible", // ✅ Ensure content is not clipped
  },
  tcCardHeader: {
    flexDirection: "column", // ✅ Changed to column layout - badge below Box ID
    alignItems: "flex-start", // ✅ Align items to the left
    marginBottom: 4,
  },
  statusBadgeContainer: {
    marginTop: 6, // ✅ Add spacing between Box ID and badge
    alignSelf: "flex-start", // ✅ Align badge to the left
  },
  tcId: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    flexWrap: "wrap", // ✅ Allow text to wrap if needed
  },
  tcDetail: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  tapHint: {
    fontSize: 10,
    color: "#999",
    marginTop: 4,
    fontStyle: "italic",
  },
  scanSection: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
    marginBottom: 8,
  },
  scanSectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  selectedCard: {
    backgroundColor: "#E3F2FD",
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  selectedLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  selectedValue: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1976D2",
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 12,
  },
  buttonDisabled: {
    backgroundColor: "#CCCCCC",
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: "#E0E0E0",
    marginTop: 8,
  },
  secondaryButtonText: {
    color: "#333",
  },
  loadingContainer: {
    padding: 20,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
  },
  transactionButton: {
    backgroundColor: "#4CAF50",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 0,
    marginBottom: 8,
  },
  transactionButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  transactionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  backButton: {
    padding: 8,
    paddingHorizontal: 12,
  },
  backButtonText: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "600",
  },
  transactionCard: {
    backgroundColor: "#F9F9F9",
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: "#2196F3",
  },
  transactionCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  transactionTCId: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  syncBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  syncBadgeSynced: {
    backgroundColor: "#4CAF50",
  },
  syncBadgePending: {
    backgroundColor: "#FF9800",
  },
  syncBadgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  syncBadgeTextSynced: {
    color: "#fff",
  },
  syncBadgeTextPending: {
    color: "#fff",
  },
  retryButton: {
    backgroundColor: "#FF9800",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  updateStockButton: {
    backgroundColor: "#4CAF50",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  updateStockButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  transactionDetails: {
    marginTop: 4,
  },
  transactionDetailRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  transactionLabel: {
    fontSize: 12,
    color: "#666",
    fontWeight: "600",
    width: 80,
  },
  transactionValue: {
    fontSize: 12,
    color: "#333",
    flex: 1,
  },
  // Error Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  errorModalContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    width: "100%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    overflow: "hidden",
  },
  errorModalHeader: {
    backgroundColor: "#FF5252",
    padding: 20,
    alignItems: "center",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  errorIconContainer: {
    marginBottom: 8,
  },
  errorIcon: {
    fontSize: 48,
  },
  errorModalTitle: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#FFFFFF",
    textAlign: "center",
  },
  errorModalContent: {
    padding: 24,
    paddingTop: 20,
  },
  errorModalMessage: {
    fontSize: 16,
    color: "#333333",
    lineHeight: 24,
    textAlign: "center",
  },
  errorModalFooter: {
    padding: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#E0E0E0",
    alignItems: "center",
  },
  errorModalButton: {
    backgroundColor: "#FF5252",
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 8,
    minWidth: 120,
    alignItems: "center",
    shadowColor: "#FF5252",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  errorModalButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  filterContainer: {
    flexDirection: "row",
    marginBottom: 16,
    backgroundColor: "#F5F5F5",
    borderRadius: 8,
    padding: 4,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  filterTabActive: {
    backgroundColor: "#007AFF",
  },
  filterTabText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#666",
  },
  filterTabTextActive: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
});
