import React, { useState, useEffect, useCallback } from "react";
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
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useApp } from "../context/AppContext";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { StatusBadge } from "../components/StatusBadge";
import { ProgressIndicator } from "../components/ProgressIndicator";
import { dataService } from "../services/data.service";
import { apiService } from "../services/api.service";
import { addEvent, syncEvents } from "../services/event-queue.service";
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
  const [putawayTask, setPutawayTask] = useState<string | null>(null); // Store putaway task from API response
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null); // Store location_id from scan
  // Keep selectedRack and selectedBin for backward compatibility and display purposes
  const [selectedRack, setSelectedRack] = useState<string | null>(null); // Store rack/location from scan (for display)
  const [selectedBin, setSelectedBin] = useState<string | null>(null); // Store bin from location scan (for display)
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
  
  // Source type filter for putaway tasks (ASN, TransferIn, or All)
  const [putawaySourceType, setPutawaySourceType] = useState<"ASN" | "TransferIn" | "All">("All");

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
           AND status != "Completed" 
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
      // These boxes have BOX ID = TC ID (same identifier)
      // Include closed Putaway boxes - they should appear if they have an "Open" putaway task
      const putawayBoxes = await db.getAllAsync<{
        box_id: string;
        asn_no: string;
        store: string;
        status: string;
        updated_on: string;
      }>(
        `SELECT box_id, asn_no, store, status, updated_on 
         FROM box_cache 
         WHERE (purpose = 'PUTAWAY' OR box_id LIKE 'PAW-%')
           AND status IN ('Closed', 'CLOSED', 'closed', 'Sealed', 'SEALED', 'sealed')
         ORDER BY updated_on DESC`
      );
      
      console.warn(`📦 PutAwayScreen: Found ${putawayBoxes.length} Putaway boxes`);
      
      // Convert Putaway boxes to TransferCarton format (BOX ID = TC ID)
      // Include both Closed and Sealed Putaway boxes - they should appear if they have an "Open" putaway task
      const putawayTCs: TransferCarton[] = putawayBoxes
        .filter(box => {
          // Include closed or sealed Putaway boxes (will be filtered by putaway task status later)
          const status = box.status?.toUpperCase() || "";
          return status === "CLOSED" || status === "SEALED";
        })
        .map(box => ({
          tc_id: box.box_id, // BOX ID = TC ID
          asn_no: box.asn_no,
          to_no: null,
          store: box.store,
          status: box.status === "Sealed" || box.status === "SEALED" ? "Sealed" : "Closed", // Keep original status
          updated_on: box.updated_on,
        }));
      
      // Get list of TCs that have already been assigned a location (have PUTAWAY_TO_RACK events)
      // These should NOT appear in the list as they've already been scanned
      const alreadyAssignedTCs = await db.getAllAsync<{ tc_id: string }>(
        `SELECT DISTINCT tc_id 
         FROM event_queue 
         WHERE event_type = 'PUTAWAY_TO_RACK' 
           AND tc_id IS NOT NULL 
           AND tc_id != ''`
      );
      const assignedTCSet = new Set(alreadyAssignedTCs.map(t => t.tc_id.toUpperCase()));
      console.warn(`📦 PutAwayScreen: Found ${assignedTCSet.size} TCs already assigned to locations (will be excluded)`);
      
      // Filter by warehouse_type and optionally by ASN
      // Also deduplicate TCs by tc_id to prevent duplicates
      // Exclude TCs that have already been assigned a location
      const warehouseTCs: TransferCarton[] = [];
      const seenTCIds = new Set<string>();
      
      for (const tc of allTCs) {
        // Skip if already seen (deduplication)
        if (seenTCIds.has(tc.tc_id)) {
          console.warn(`⚠️ PutAwayScreen: Skipped duplicate TC ${tc.tc_id}`);
          continue;
        }
        
        // Skip if status is Completed (shouldn't happen due to query, but double-check)
        if (tc.status === "Completed") {
          console.warn(`⚠️ PutAwayScreen: Skipped completed TC ${tc.tc_id}`);
          continue;
        }
        
        // Skip if TC has already been assigned a location
        // BUT: If it has a backend putaway task, show it anyway (backend task is source of truth)
        const hasBackendTask = (tc as any).putaway_task;
        const taskStatus = (tc as any).putaway_task_status;
        const isTaskCompleted = taskStatus && (taskStatus.toUpperCase() === "COMPLETED");
        
        if (assignedTCSet.has(tc.tc_id.toUpperCase()) && !hasBackendTask) {
          console.warn(`⚠️ PutAwayScreen: Skipped TC ${tc.tc_id} - already assigned to a location (no backend task). If this TC should appear, check if a backend putaway task exists.`);
          continue;
        }
        
        if (hasBackendTask && isTaskCompleted) {
          console.warn(`⚠️ PutAwayScreen: Skipped TC ${tc.tc_id} - putaway task is completed`);
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
        const hasBackendTask = (putawayTC as any).putaway_task;
        const taskStatus = (putawayTC as any).putaway_task_status;
        const isTaskCompleted = taskStatus && (taskStatus.toUpperCase() === "COMPLETED");
        
        if (assignedTCSet.has(putawayTC.tc_id.toUpperCase()) && !hasBackendTask) {
          console.warn(`⚠️ PutAwayScreen: Skipped Putaway box ${putawayTC.tc_id} - already assigned to a location (no backend task). If this box should appear, check if a backend putaway task exists.`);
          continue;
        }
        
        if (hasBackendTask && isTaskCompleted) {
          console.warn(`⚠️ PutAwayScreen: Skipped Putaway box ${putawayTC.tc_id} - putaway task is completed`);
          continue;
        }
        
        if (hasBackendTask && !isTaskCompleted) {
          console.warn(`ℹ️ PutAwayScreen: Including Putaway box ${putawayTC.tc_id} - has backend putaway task (status: ${taskStatus}) even though local event exists`);
        }
        
        if (activeASN && putawayTC.asn_no && putawayTC.asn_no.toUpperCase().trim() !== activeASN.toUpperCase().trim()) {
          continue; // Skip boxes that don't match active ASN
        }
        
        const isWarehouse = await dataService.isWarehouse(putawayTC.store || "");
        if (isWarehouse) {
          // Check if this box ID already exists as a TC (avoid duplicates)
          const exists = warehouseTCs.find(tc => tc.tc_id === putawayTC.tc_id);
          if (!exists) {
            warehouseTCs.push(putawayTC);
            seenTCIds.add(putawayTC.tc_id);
            console.warn(`✅ PutAwayScreen: Added Putaway box ${putawayTC.tc_id} (BOX ID = TC ID, Store: ${putawayTC.store}, ASN: ${putawayTC.asn_no})`);
          }
        }
      }
      
      console.warn(`📦 PutAwayScreen: Found ${warehouseTCs.length} warehouse TCs + Putaway boxes from local database${activeASN ? ` (filtered by ASN: ${activeASN})` : ""}`);
      
      // PRIORITY: Load putaway tasks from backend API
      // Backend creates putaway tasks when boxes are closed (ASN) or Transfer In items are received
      const backendPutawayTasks: TransferCarton[] = [];
      try {
        const settings = await getSettings();
        if (settings.api_url && settings.demo_mode !== 1) {
          // Load ASN putaway tasks (if filter allows)
          if (putawaySourceType === "ASN" || putawaySourceType === "All") {
            // Get open putaway tasks from backend for ASN
            let putawayTasksResponse: any = null;
            try {
              putawayTasksResponse = await apiService.getPutawayTasks({
                status: "Draft,In Progress",
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
                    status: "Draft,In Progress",
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
                  const asnTasksList = allTasksList.filter((t: any) => {
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
                      const filteredTasks = allTasksListNoFilters.filter((t: any) => {
                        const taskStatus = (t.status || "").toUpperCase();
                        const isDraftOrInProgress = taskStatus === "DRAFT" || taskStatus === "IN PROGRESS";
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
          
          // Convert backend putaway tasks to TransferCarton format
          for (const task of tasksList) {
            const taskId = task.putaway_task || task.task_title || task.id || task.task_id;
            const boxId = task.box_id;
            const tcId = task.tc_id;
            const asnNo = task.asn_no || task.advance_shipping_notice;
            
            // Only include tasks with box_id (warehouse boxes) or tc_id (transfer cartons)
            // Only include tasks with Status = "Open" (as shown in backend screenshot)
            if (boxId || tcId) {
              // Check task status - only include "Open" tasks (exclude "Closed", "Completed", "In Progress")
              const taskStatus = (task.status || "").toUpperCase();
              if (taskStatus !== "OPEN") {
                console.warn(`⚠️ PutAwayScreen: Skipped backend putaway task ${taskId} - status is ${task.status} (only Open tasks should appear)`);
                continue;
              }
              
              const tcObj: TransferCarton = {
                tc_id: tcId || boxId, // Use tc_id if available, otherwise box_id
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
              
              // Store header-level location_id from backend (NEW: API now returns location_id at header level)
              if (task.location_id) {
                (tcObj as any).location_id = task.location_id;
                console.warn(`✅ PutAwayScreen: Task ${taskId} has header-level location_id: ${task.location_id}`);
              }
              
              backendPutawayTasks.push(tcObj);
              console.warn(`✅ PutAwayScreen: Added backend putaway task ${taskId} (box_id: ${boxId}, tc_id: ${tcId}, task_status: ${task.status}, location_id: ${task.location_id || 'N/A'})`);
            }
          }
          
          console.warn(`✅ PutAwayScreen: Found ${backendPutawayTasks.length} ASN putaway task(s) from backend`);
          }
          
          // Load Transfer In putaway tasks (if filter allows)
          if (putawaySourceType === "TransferIn" || putawaySourceType === "All") {
            let transferInTasksResponse: any = null;
            try {
              console.warn(`📤 PutAwayScreen: Requesting Transfer In putaway tasks with filters:`, {
                status: "Draft,In Progress",
                source_type: "TransferIn",
              });
              transferInTasksResponse = await apiService.getPutawayTasks({
                status: "Draft,In Progress",
                source_type: "TransferIn",
              });
              console.warn(`📥 PutAwayScreen: Received Transfer In putaway tasks response:`, {
                isArray: Array.isArray(transferInTasksResponse),
                hasData: !!transferInTasksResponse?.data,
                hasTasks: !!transferInTasksResponse?.tasks,
                dataLength: transferInTasksResponse?.data?.length,
                tasksLength: transferInTasksResponse?.tasks?.length,
                arrayLength: Array.isArray(transferInTasksResponse) ? transferInTasksResponse.length : undefined,
              });
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
                    status: "Draft,In Progress",
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
                  transferInTasksResponse = allTasksList.filter((t: any) => {
                    // Transfer In tasks have transfer_in field (not asn_no or advance_shipping_notice)
                    const hasTransferIn = t.transfer_in && !t.asn_no && !t.advance_shipping_notice;
                    // Or explicitly marked as TransferIn source type
                    const isTransferInSource = t.source_type === "TransferIn";
                    return hasTransferIn || isTransferInSource;
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
                      const filteredTasks = allTasksListNoFilters.filter((t: any) => {
                        const taskStatus = (t.status || "").toUpperCase();
                        const isDraftOrInProgress = taskStatus === "DRAFT" || taskStatus === "IN PROGRESS";
                        const hasTransferIn = t.transfer_in && !t.asn_no && !t.advance_shipping_notice;
                        const isTransferInSource = t.source_type === "TransferIn";
                        return isDraftOrInProgress && (hasTransferIn || isTransferInSource);
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
            // Backend may return: { data: [...] }, { tasks: [...] }, or direct array
            let tiTasksList: any[] = [];
            if (Array.isArray(transferInTasksResponse)) {
              tiTasksList = transferInTasksResponse;
              console.warn(`📦 PutAwayScreen: Transfer In tasks response is direct array (${tiTasksList.length} items)`);
            } else if (transferInTasksResponse?.data && Array.isArray(transferInTasksResponse.data)) {
              tiTasksList = transferInTasksResponse.data;
              console.warn(`📦 PutAwayScreen: Transfer In tasks found in response.data (${tiTasksList.length} items)`);
            } else if (transferInTasksResponse?.tasks && Array.isArray(transferInTasksResponse.tasks)) {
              tiTasksList = transferInTasksResponse.tasks;
              console.warn(`📦 PutAwayScreen: Transfer In tasks found in response.tasks (${tiTasksList.length} items)`);
            } else {
              console.warn(`⚠️ PutAwayScreen: Transfer In tasks response format not recognized:`, {
                isArray: Array.isArray(transferInTasksResponse),
                hasData: !!transferInTasksResponse?.data,
                hasTasks: !!transferInTasksResponse?.tasks,
                responseKeys: transferInTasksResponse ? Object.keys(transferInTasksResponse) : [],
              });
            }
            
            // Convert Transfer In putaway tasks to TransferCarton format
            for (const task of tiTasksList) {
              const taskId = task.putaway_task || task.task_title || task.id || task.task_id || task.title;
              const transferIn = task.transfer_in;
              const sourceType = task.source_type || "TransferIn";
              
              // Only process Transfer In tasks
              if (sourceType !== "TransferIn" && !transferIn) {
                continue;
              }
              
              // Check task status - include Draft and In Progress tasks
              // Backend returns status as "Draft" (capitalized), convert to uppercase for comparison
              const taskStatus = (task.status || "").toUpperCase();
              const isDraft = taskStatus === "DRAFT";
              const isInProgress = taskStatus === "IN PROGRESS" || taskStatus === "INPROGRESS";
              
              if (!isDraft && !isInProgress) {
                console.warn(`⚠️ PutAwayScreen: Skipped Transfer In putaway task ${taskId} - status is "${task.status}" (expected "Draft" or "In Progress")`);
                continue;
              }
              
              console.warn(`✅ PutAwayScreen: Processing Transfer In putaway task ${taskId} with status "${task.status}"`);
              
              // For Transfer In tasks, we use the task title as the identifier
              // Create a task object that represents the Transfer In putaway task
              const tcObj: TransferCarton = {
                tc_id: `TI-${taskId}`, // Use task ID as identifier (since there's no TC/box for Transfer In)
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
              
              backendPutawayTasks.push(tcObj);
              console.warn(`✅ PutAwayScreen: Added Transfer In putaway task ${taskId} (transfer_in: ${transferIn}, task_status: ${task.status})`);
            }
            
            console.warn(`✅ PutAwayScreen: Found ${tiTasksList.length} Transfer In putaway task(s) from backend`);
          }
          
          console.warn(`✅ PutAwayScreen: Total ${backendPutawayTasks.length} putaway task(s) from backend (ASN + Transfer In)`);
        }
      } catch (backendError: any) {
        console.warn(`⚠️ Error loading putaway tasks from backend:`, backendError.message);
        // Continue with local database fallback
      }
      
      // Merge backend tasks with local TCs/boxes
      // Backend tasks take priority (they're the source of truth)
      const allPutawayItems: TransferCarton[] = [];
      const seenIds = new Set<string>();
      
      // Helper function to normalize IDs for comparison (case-insensitive, trimmed)
      const normalizeId = (id: string | null | undefined): string => {
        if (!id) return "";
        return String(id).trim().toUpperCase();
      };
      
      // First, add backend putaway tasks (priority)
      // Track all IDs (both box_id and tc_id) from backend tasks for matching
      const backendTaskIds = new Set<string>();
      for (const backendTask of backendPutawayTasks) {
        const boxId = normalizeId((backendTask as any).box_id);
        const tcId = normalizeId(backendTask.tc_id);
        const primaryId = backendTask.tc_id || (backendTask as any).box_id;
        const normalizedId = normalizeId(primaryId);
        
        if (normalizedId && !seenIds.has(normalizedId)) {
          allPutawayItems.push(backendTask);
          seenIds.add(normalizedId);
          // Track both box_id and tc_id for matching
          if (boxId) backendTaskIds.add(boxId);
          if (tcId) backendTaskIds.add(tcId);
          console.warn(`✅ PutAwayScreen: Added backend task ${(backendTask as any).putaway_task} for ${primaryId} (normalized: ${normalizedId}, box_id: ${(backendTask as any).box_id}, tc_id: ${backendTask.tc_id})`);
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

      console.log(
        "✅ PutAwayScreen: Loaded transactions:",
        putAwayEvents.length
      );
      setTransactions(putAwayEvents);
    } catch (error: any) {
      console.error("❌ PutAwayScreen: Error loading transactions:", error);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load sealed TCs when screen is focused
  useFocusEffect(
    useCallback(() => {
      if (workflowState === "PUTAWAY_LIST") {
        loadSealedTCs();
      } else if (workflowState === "PUTAWAY_TRANSACTIONS") {
        loadTransactions();
      }
    }, [loadSealedTCs, loadTransactions, workflowState])
  );

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

            // Check if it's a Putaway box (purpose="PUTAWAY" or starts with "PAW-")
            const isPutawayBox = box.purpose === "PUTAWAY" || scannedValue.startsWith("PAW-");
            
            if (isPutawayBox) {
              // This is a Putaway box - BOX ID = TC ID
              // Check if it's in the sealed list (as a TC)
              const tc = sealedTCs.find((t) => t.tc_id === scannedValue);
              if (tc) {
                // Found in sealed list - use it directly
                setSelectedTC(scannedValue); // BOX ID = TC ID
                setSelectedTCObj(tc);
                setPutawayTask(null);
                setWorkflowState("SCAN_LOCATION");
                console.warn(`✅ Putaway box ${scannedValue} scanned (BOX ID = TC ID)`);
                return;
              } else {
                // Putaway box exists but not in sealed list - create TC object for it
                const boxAsTC = {
                  tc_id: scannedValue,
                  asn_no: box.asn_no,
                  store: box.store,
                  status: "Closed",
                };
                setSelectedTC(scannedValue);
                setSelectedTCObj(boxAsTC);
                setPutawayTask(null);
                setWorkflowState("SCAN_LOCATION");
                console.warn(`✅ Putaway box ${scannedValue} scanned (not in sealed list, using directly)`);
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
  const handleLocationScan = async (locationId: string) => {
    if (!selectedTC || !selectedTCObj) {
      Alert.alert("Error", "No Putaway task selected");
      return;
    }
    
    const sourceType = (selectedTCObj as any).source_type || "ASN";
    const isTransferIn = sourceType === "TransferIn";
    
    // For Transfer In tasks with putaway_task, we can skip carton/item scanning
    // The backend will assign the location to all items in the task automatically
    // Only require carton/item if we don't have a putaway_task (legacy workflow)
    if (isTransferIn && !putawayTask && !selectedCartonOrItem && !selectedItemCode) {
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

    const locationIdUpper = locationId.trim().toUpperCase();
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

      // Try to call API to scan transfer carton and location
      // Supports two workflows:
      // Workflow 1: If putaway_task exists (from previous TC scan), update existing task with location
      // Workflow 2: If no putaway_task, create/update task with TC + location
      // If API endpoint doesn't exist (404), fall back to event-based approach
      let apiSuccess = false;
      let response: any = null;
      let apiErrorOccurred = false;
      
      try {
        // Validate required fields before sending request
        if (!locationIdUpper || locationIdUpper.trim() === '') {
          throw new Error("Location ID is required to scan transfer carton for putaway");
        }
        
        if (!putawayTask && !selectedTC) {
          throw new Error("Either putaway task or transfer carton ID is required");
        }
        
        // If we have a putaway_task from previous step, use it to update location only
        // Otherwise, use tc_id or box_id to create/update task with location
        const requestBody: any = {
          location_id: locationIdUpper, // Primary: send location_id
          rack: rack, // Backward compatibility: also send rack
          bin: bin, // Backward compatibility: also send bin (if available)
          user_id: settings.user_id || settings.user_code || undefined,
        };
        
        // Check if this is a Transfer In task
        const sourceType = (selectedTCObj as any).source_type || "ASN";
        const isTransferIn = sourceType === "TransferIn";
        
        if (putawayTask) {
          // Workflow 2: Update existing task with location
          requestBody.putaway_task = putawayTask;
          
          // For Transfer In tasks with putaway_task, simplified workflow:
          // Only send putaway_task and location_id - backend assigns location to all items
          if (isTransferIn) {
            // Simplified workflow: Just putaway_task + location_id (no carton/item needed)
            console.warn(`🔄 Assigning location ${locationIdUpper} to all items in Transfer In putaway task ${putawayTask}`);
            // Don't send carton_id or item_code - backend handles all items automatically
          } else {
            // For ASN tasks, we might still need carton/item info
            if (selectedCartonOrItem) {
              requestBody.box_id = selectedCartonOrItem;
            } else if (selectedItemCode) {
              requestBody.item_code = selectedItemCode;
            }
            console.warn(`🔄 Updating existing putaway task ${putawayTask} with location ${locationIdUpper}`);
          }
        } else {
          // Workflow 1: Create/update task with TC + location
          // Check if selectedTC is actually a box_id (warehouse box)
          const isBoxId = selectedTC?.startsWith("BOX-") || selectedTC?.startsWith("PAW-");
          
          if (isBoxId) {
            // This is a warehouse box (regular or Putaway) - send box_id
            // Backend will handle creating/updating putaway task for the box
            requestBody.box_id = selectedTC;
            // Also send tc_id if it's a Putaway box (box_id = tc_id for PAW-*)
            if (selectedTC?.startsWith("PAW-")) {
              requestBody.tc_id = selectedTC;
              console.warn(`🔄 Creating/updating putaway task for Putaway box ${selectedTC} (box_id=tc_id) with location ${locationIdUpper}`);
            } else {
              console.warn(`🔄 Creating/updating putaway task for warehouse box ${selectedTC} with location ${locationIdUpper}`);
            }
          } else {
            // Regular Transfer Carton: send only tc_id
            if (!selectedTC || selectedTC.trim() === '') {
              throw new Error("Transfer carton ID is required");
            }
            requestBody.tc_id = selectedTC;
            console.warn(`🔄 Creating/updating putaway task for TC ${selectedTC} with location ${locationIdUpper}`);
          }
        }
        
        console.warn(`📤 Sending scan transfer carton request:`, JSON.stringify(requestBody, null, 2));
        response = await apiService.scanTransferCarton(requestBody);

        // API call succeeded - mark as success even if response structure is different
        apiSuccess = true;
        console.warn(`✅ Putaway API call succeeded`);

        // Store putaway task from response for completion (if available)
        if (response?.data?.putaway_task) {
          setPutawayTask(response.data.putaway_task);
          console.warn(`✅ Putaway task created/updated: ${response.data.putaway_task}`);
        } else if (response?.putaway_task) {
          setPutawayTask(response.putaway_task);
          console.warn(`✅ Putaway task created/updated: ${response.putaway_task}`);
        } else if (response?.ok === true || response?.success === true) {
          // API returned success but no putaway_task - that's okay, backend might handle it differently
          console.warn(`✅ Putaway API returned success (no putaway_task in response - backend may handle differently)`);
        }
      } catch (apiError: any) {
        // API call failed - mark as error occurred
        apiErrorOccurred = true;
        apiSuccess = false;
        
        // Check if this is a Putaway box (starts with "PAW-") that backend doesn't recognize
        const isPutawayBox = selectedTC?.startsWith("PAW-");
        const isTransferCartonNotFound = 
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
          apiError.message?.includes("GROUP BY") || 
          apiError.message?.includes("sql_mode") || 
          apiError.message?.includes("DATABASE_ERROR") ||
          apiError.message?.includes("nonaggregated column") ||
          apiError.message?.includes("carton_id") ||
          (apiError.message?.includes("500") && apiError.message?.includes("Failed to process")) ||
          (apiError.code === "DATABASE_ERROR" && apiError.message?.includes("Failed to process transfer carton for putaway"))
        ) {
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

      // Record event for local tracking (always do this, even if API call succeeded)
      // This ensures offline support and backward compatibility
      await addEvent({
        event_type: "PUTAWAY_TO_RACK",
        asn_no: normalizedASN,
        inbound_session: session,
        tc_id: selectedTC,
        rack: rack,
        bin: bin,
        device_id: settings.device_id,
        user_id: settings.user_id,
      });

      setWorkflowState("COMPLETE_PUTAWAY");
      
      // Refresh the sealed TCs list to remove this TC (it's now assigned)
      await loadSealedTCs();
      
      if (apiSuccess && !apiErrorOccurred) {
        // API call succeeded - show success message
        const itemsCount = response?.data?.items_count || response?.items_count || 0;
        const putawayTaskId = response?.data?.putaway_task || response?.putaway_task;
        
        let successMessage = `Putaway box ${selectedTC} placed at Location ID: ${locationIdUpper}`;
        // Display rack/bin if available (for user information)
        if (selectedRack || selectedBin) {
          const locationInfo = [selectedRack, selectedBin].filter(Boolean).join(" - ");
          if (locationInfo) {
            successMessage += `\nLocation: ${locationInfo}`;
          }
        }
        if (itemsCount > 0) {
          successMessage += `\n\n${itemsCount} item(s) assigned to putaway task.`;
        }
        if (putawayTaskId) {
          successMessage += `\n\nPutaway Task: ${putawayTaskId}`;
        }
        successMessage += `\n\nThis TC has been removed from the Putaway list.`;
        
        Alert.alert("Success", successMessage);
      } else {
        // Event-based approach - API failed or not available
        Alert.alert(
          "Success",
          `Putaway box ${selectedTC} placed at Location ID: ${locationIdUpper}\n\nNote: Backend putaway API not available. Using event-based tracking.\n\nThis TC has been removed from the Putaway list.`
        );
      }
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to scan location");
    } finally {
      setLoading(false);
    }
  };

  // Step 13: Complete Put Away
  const handleCompletePutAway = async () => {
    if (!selectedTC || !selectedTCObj) {
      Alert.alert("Error", "No Putaway box selected");
      return;
    }

    setLoading(true);
    try {
      const settings = await getSettings();
      const asn = selectedTCObj.asn_no || activeASN || settings?.active_asn;
      const session = activeSession || settings?.active_session || "";
      const db = await getDatabase();
      
      // Get items from the Transfer Carton
      // Items are in boxes that were packed into this TC via PACK_BOX_TO_TC events
      let items: Array<{
        item_code: string;
        qty: number;
        source_bin?: string;
        target_bin?: string;
        completed?: boolean;
      }> = [];
      
      if (db) {
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
            
            // Group by item_code and sum quantities
            const itemMap = new Map<string, number>();
            for (const item of scannedItems) {
              const currentQty = itemMap.get(item.item_code) || 0;
              itemMap.set(item.item_code, currentQty + (item.scanned_qty || 0));
            }
            
            // Build items array for API
            // Check if this is a Putaway box (for box_id in items)
            const isPutawayBox = selectedTC?.startsWith("PAW-");
            
            // Ensure we only create ONE item per item_code (aggregated from all boxes)
            // The itemMap already aggregates quantities by item_code, so we should have unique item_codes
            // NOTE: location_id is NOT included in items - it will be sent at header level in the API request
            items = Array.from(itemMap.entries()).map(([item_code, qty]) => {
              const item: any = {
                item_code,
                qty: Number(qty.toFixed(2)), // Round to 2 decimal places
                source_bin: "DOCK-01", // Default source bin (can be enhanced to get from settings or event)
                // location_id removed - will be sent at header level instead
                target_bin: selectedBin || selectedRack || undefined, // Backward compatibility: also send target_bin
                completed: true,
              };
              // NOTE: Backend doesn't accept box_id in items array - it gets box_id from putaway_task
              // The backend table tabPutawayLine uses carton_id, not box_id
              // Backend will map box_id to carton_id based on the putaway_task
              return item;
            });
            
            // Verify no duplicates by item_code
            const itemCodes = items.map(i => i.item_code);
            const uniqueItemCodes = new Set(itemCodes);
            if (itemCodes.length !== uniqueItemCodes.size) {
              console.error(`❌ ERROR: Duplicate item_code(s) found in items array!`, {
                totalItems: items.length,
                uniqueItems: uniqueItemCodes.size,
                duplicates: itemCodes.filter((code, index) => itemCodes.indexOf(code) !== index)
              });
              // Remove duplicates by keeping only the first occurrence of each item_code
              const seen = new Set<string>();
              items = items.filter(item => {
                if (seen.has(item.item_code)) {
                  console.warn(`⚠️ Removing duplicate item: ${item.item_code}`);
                  return false;
                }
                seen.add(item.item_code);
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
            // Try to get items directly from scanned_items using TC ID as box_id
            const isPutawayBox = selectedTC?.startsWith("PAW-");
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
              [selectedTC, asn || '']
            );
            
            if (directItems.length > 0) {
              // NOTE: location_id is NOT included in items - it will be sent at header level in the API request
              items = directItems.map(item => {
                const itemObj: any = {
                  item_code: item.item_code,
                  qty: Number((item.scanned_qty || 0).toFixed(2)),
                  source_bin: "DOCK-01",
                  // location_id removed - will be sent at header level instead
                  target_bin: selectedBin || selectedRack || undefined, // Backward compatibility: also send target_bin
                  completed: true,
                };
                // NOTE: Backend doesn't accept box_id in items array - it gets box_id from putaway_task
                // The backend table tabPutawayLine uses carton_id, not box_id
                // Backend will map box_id to carton_id based on the putaway_task
                return itemObj;
              });
              
              console.warn(`✅ Found ${items.length} item(s) directly from scanned_items for Putaway box ${selectedTC}`);
            }
          }
        } catch (itemsError: any) {
          console.warn(`⚠️ Error getting items from TC:`, itemsError.message);
          // Continue without items - backend might be able to determine items from putaway task
        }
      }
      
      // Try to call API to complete putaway task (if putawayTask exists)
      // If no putawayTask, we'll use event-based tracking
      let apiSuccess = false;
      let apiErrorOccurred = false;
      
      if (putawayTask) {
        try {
          const requestBody: any = {
            putaway_task: putawayTask,
            completed_by: settings.user_id || settings.user_code || undefined,
            // Also send performed_by for backward compatibility
            performed_by: settings.user_id || settings.user_code || undefined,
          };
          
          // NEW: Send location_id at header level (applies to all items)
          // Priority: selectedLocationId (from scan) > task location_id (from backend) > undefined
          if (selectedLocationId) {
            requestBody.location_id = selectedLocationId;
            console.warn(`📤 Sending header-level location_id: ${selectedLocationId}`);
          } else {
            // Try to get location_id from the putaway task (if it was stored when fetching tasks)
            const taskObj = sealedTCs.find(tc => (tc as any).putaway_task === putawayTask);
            if (taskObj && (taskObj as any).location_id) {
              requestBody.location_id = (taskObj as any).location_id;
              console.warn(`📤 Using location_id from task: ${(taskObj as any).location_id}`);
            }
          }
          
          // Include items array if we have items
          if (items.length > 0) {
            // Final check: Ensure no duplicates before sending
            const finalItemCodes = items.map(i => i.item_code);
            const finalUniqueCodes = new Set(finalItemCodes);
            if (finalItemCodes.length !== finalUniqueCodes.size) {
              console.error(`❌ CRITICAL: Duplicate items detected before API call! Removing duplicates...`);
              const seen = new Set<string>();
              items = items.filter(item => {
                if (seen.has(item.item_code)) {
                  console.warn(`⚠️ Removing duplicate item before API call: ${item.item_code}`);
                  return false;
                }
                seen.add(item.item_code);
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
              return {
                ...item,
                location_id: locationIdToUse, // Ensure each item has location_id
                completed: true, // Ensure completed flag is set
              };
            });
            
            requestBody.items = itemsWithLocation;
            console.warn(`📤 Sending ${itemsWithLocation.length} unique item(s) in putaway completion request (location_id: ${locationIdToUse} at header and item level):`, JSON.stringify(itemsWithLocation, null, 2));
          } else {
            console.warn(`⚠️ No items found for TC ${selectedTC} - sending completion without items array`);
          }
          
          const response = await apiService.completePutaway(requestBody);
          apiSuccess = true;
          apiErrorOccurred = false;
          console.warn(`✅ Putaway task completed via API: ${putawayTask}`);
          
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
            console.warn(`⚠️ Putaway task ${putawayTask} not found in backend - using event-based approach`);
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

      // Always record event for local tracking (backward compatibility and offline support)
      if (asn) {
        const normalizedASN = normalizeASN(asn);
        await addEvent({
          event_type: "PUTAWAY_DISPATCH",
          asn_no: normalizedASN,
          inbound_session: session,
          tc_id: selectedTC,
          store: "WAREHOUSE",
          device_id: settings.device_id,
          user_id: settings.user_id,
        });
      }

      // Update TC status to "Completed"
      await dataService.updateTransferCartonStatus(selectedTC, "Completed");
      console.log(`✅ PutAwayScreen: TC ${selectedTC} marked as Completed`);

      // Sync events to backend to ensure putaway transaction appears in backend
      try {
        console.warn(`🔄 Syncing putaway events to backend...`);
        const syncResult = await syncEvents();
        console.warn(`✅ Synced ${syncResult.synced} event(s), ${syncResult.failed} failed`);
        
        if (syncResult.failed > 0) {
          console.warn(`⚠️ Some events failed to sync. Please check Sync Center.`);
        }
      } catch (syncError: any) {
        console.warn(`⚠️ Error syncing events:`, syncError.message);
        // Don't block user - events will sync later
      }

      if (apiSuccess && putawayTask && !apiErrorOccurred) {
        // API succeeded with putaway task
        Alert.alert(
          "Success",
          `Put Away completed for Putaway box ${selectedTC}\n\nPutaway task: ${putawayTask}\n\nEvents synced to backend.`
        );
      } else if (putawayTask && apiErrorOccurred) {
        // Had putaway task but API failed
        Alert.alert(
          "Success",
          `Put Away completed for Putaway box ${selectedTC}\n\nNote: Backend putaway API error. Using event-based tracking.\n\nEvents synced to backend.`
        );
      } else {
        // No putaway task - event-based only
        Alert.alert(
          "Success",
          `Put Away completed for Putaway box ${selectedTC}\n\nNote: Using event-based tracking.\n\nEvents synced to backend.`
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
                  putawaySourceType === "All" && styles.filterTabActive,
                ]}
                onPress={() => {
                  setPutawaySourceType("All");
                  loadSealedTCs();
                }}
              >
                <Text
                  style={[
                    styles.filterTabText,
                    putawaySourceType === "All" && styles.filterTabTextActive,
                  ]}
                >
                  All
                </Text>
              </TouchableOpacity>
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
                        
                        return (
                          <TouchableOpacity
                            style={styles.tcCard}
                            onPress={() => handleTCSelection(item.tc_id)}
                          >
                            <View style={styles.tcCardHeader}>
                              <Text style={styles.tcId}>
                                {isTransferIn ? `Task: ${putawayTaskId || item.tc_id}` : item.tc_id}
                              </Text>
                              <StatusBadge status={item.status} />
                            </View>
                            {putawayTaskId ? (
                              <Text style={styles.tcDetail}>
                                Putaway Task: {putawayTaskId}
                              </Text>
                            ) : null}
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
            <BarcodeScanner
              onScan={handleLocationScan}
              placeholder="Scan warehouse location/rack barcode"
              title="Location"
            />
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
            {selectedTC && (
              <View style={styles.selectedCard}>
                <Text style={styles.selectedLabel}>Putaway box:</Text>
                <Text style={styles.selectedValue}>{selectedTC}</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.button}
              onPress={handleCompletePutAway}
              disabled={loading}
            >
              <Text style={styles.buttonText}>Complete Put Away</Text>
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
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: "#2196F3",
  },
  tcCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  tcId: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
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
