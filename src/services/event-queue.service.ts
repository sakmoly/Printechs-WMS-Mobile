import { generateUUID } from "../utils/uuid";
import { getDatabase } from "../database/database";
import { ScanEvent } from "../types";
import { apiService } from "./api.service";
import { getSettings } from "./settings.service";
import { dataService } from "./data.service";

/** Track (asn_no, inbound_session) for which we already called completeInboundSession to avoid duplicate API calls */
const inboundCompleteAttempted = new Set<string>();

// Debounce sync to prevent rate limiting
let syncTimeout: ReturnType<typeof setTimeout> | null = null;
let isSyncing = false;
const SYNC_DEBOUNCE_MS = 2000; // Wait 2 seconds after last event before syncing
const MAX_BATCH_SIZE = 1000; // Backend limit: max 1000 events per batch

/**
 * Check if an error message indicates a duplicate UUID (which should be treated as success)
 * Backend correctly rejects duplicates, but mobile should treat them as ACK success
 */
function isDuplicateUuidError(msg: string): boolean {
  const m = (msg || "").toLowerCase();
  return (
    m.includes("duplicate") ||
    m.includes("already exists") ||
    m.includes("unique constraint") ||
    m.includes("primary key")
  );
}

export const addEvent = async (
  event: Omit<ScanEvent, "offline_uuid" | "synced" | "event_time">
): Promise<string> => {
  const db = await getDatabase();
  const settings = await getSettings();

  // ✅ CRITICAL VALIDATION: TRANSFER_IN_RECEIVE events MUST include transfer_in
  if (event.event_type === "TRANSFER_IN_RECEIVE") {
    if (!event.transfer_in || event.transfer_in.trim() === "") {
      const errorMsg = `❌ CRITICAL ERROR: TRANSFER_IN_RECEIVE event is missing required 'transfer_in' field! Event will be rejected.`;
      console.error(errorMsg);
      console.error(`   Event details:`, {
        item_code: event.item_code,
        carton_id: event.carton_id,
        qty: event.qty,
      });
      throw new Error(`TRANSFER_IN_RECEIVE event requires 'transfer_in' field. Please include transfer_in when creating the event.`);
    }
    
    // Also validate that item_code is present (required for backend processing)
    if (!event.item_code || event.item_code.trim() === "") {
      const errorMsg = `❌ CRITICAL ERROR: TRANSFER_IN_RECEIVE event is missing required 'item_code' field!`;
      console.error(errorMsg);
      throw new Error(`TRANSFER_IN_RECEIVE event requires 'item_code' field.`);
    }
    
    // Log successful validation
    console.log(`✅ TRANSFER_IN_RECEIVE event validated: transfer_in=${event.transfer_in}, item_code=${event.item_code}, carton_id=${event.carton_id || 'N/A'}`);
  }

  const offline_uuid = generateUUID();
  const event_time = new Date().toISOString();

  const fullEvent: ScanEvent = {
    ...event,
    offline_uuid,
    event_time,
    synced: 0,
    device_id: event.device_id || settings.device_id || "",
    user_id: event.user_id || settings.user_id || "",
  };

  await db.runAsync(
    `INSERT INTO event_queue (
      offline_uuid, event_type, asn_no, to_no, inbound_session, carton_id,
      item_code, qty, store, box_id, tc_id, rack, bin, source_bin, location_id,
      device_id, user_id, event_time, synced, error_msg, material_request, transfer_in, cycle_count_title
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fullEvent.offline_uuid,
      fullEvent.event_type,
      fullEvent.asn_no ?? null,
      fullEvent.to_no ?? null,
      fullEvent.inbound_session ?? null,
      fullEvent.carton_id ?? null,
      fullEvent.item_code ?? null,
      fullEvent.qty ?? null,
      fullEvent.store ?? null,
      fullEvent.box_id ?? null,
      fullEvent.tc_id ?? null,
      fullEvent.rack ?? null,
      fullEvent.bin ?? null,
      fullEvent.source_bin ?? null,
      fullEvent.location_id ?? null,
      fullEvent.device_id ?? "",
      fullEvent.user_id ?? "",
      fullEvent.event_time,
      fullEvent.synced,
      fullEvent.error_msg ?? null,
      fullEvent.material_request ?? null,
      fullEvent.transfer_in ?? null,
      fullEvent.cycle_count_title ?? null,
    ]
  );

  // Debounced sync: wait a bit before syncing to batch multiple events
  // This prevents rate limiting when adding many events quickly (e.g., manual quantity entry)
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }

  syncTimeout = setTimeout(async () => {
    syncTimeout = null;
    if (!isSyncing) {
      try {
        await syncEvents();
      } catch (error) {
        // Ignore sync errors, will retry later
        console.log("⚠️ Auto-sync failed, will retry later:", error);
      }
    }
  }, SYNC_DEBOUNCE_MS);

  return offline_uuid;
};

export const getUnsyncedEvents = async (): Promise<ScanEvent[]> => {
  const db = await getDatabase();
  const result = await db.getAllAsync<ScanEvent>(
    "SELECT * FROM event_queue WHERE synced = 0 ORDER BY event_time ASC"
  );
  return result;
};

export const markEventSynced = async (offline_uuid: string) => {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE event_queue SET synced = 1, error_msg = NULL WHERE offline_uuid = ?",
    [offline_uuid]
  );
};

export const markEventFailed = async (
  offline_uuid: string,
  error_msg: string
) => {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE event_queue SET error_msg = ? WHERE offline_uuid = ?",
    [error_msg, offline_uuid]
  );
};

// Track ASNs for which we've already attempted to create putaway tasks
// This prevents duplicate task creation attempts
const putawayTaskCreationAttempted = new Set<string>();

/**
 * When all cartons for an ASN are received, call POST /api/inbound/complete so the backend
 * can update ASN status to "Completed" / "Received" (and carton/receiving status on desktop).
 * This is called after successful sync so the Operations Console shows the correct status.
 */
const checkAndCompleteInboundSessionsAfterSync = async (syncedEvents: ScanEvent[]) => {
  try {
    const pairs = new Map<string, { asn_no: string; inbound_session: string }>();
    for (const event of syncedEvents) {
      if (event.asn_no && event.inbound_session && event.inbound_session.trim() !== "") {
        const key = `${event.asn_no.toUpperCase().trim()}|${event.inbound_session.trim()}`;
        if (!pairs.has(key)) {
          pairs.set(key, { asn_no: event.asn_no, inbound_session: event.inbound_session });
        }
      }
    }
    const settings = await getSettings();
    const user_id = settings.user_id || settings.user_code || "";
    const device_id = settings.device_id || "";
    for (const { asn_no, inbound_session } of pairs.values()) {
      const key = `${asn_no.toUpperCase().trim()}|${inbound_session}`;
      if (inboundCompleteAttempted.has(key)) continue;
      try {
        const allReceived = await dataService.areAllCartonsReceived(asn_no, inbound_session);
        if (!allReceived) continue;
        inboundCompleteAttempted.add(key);
        await apiService.completeInboundSession({
          inbound_session,
          asn_no,
          user_id,
          device_id,
        });
        console.warn(`✅ Inbound session completed for ASN ${asn_no} (${inbound_session}) — backend can update ASN status to Completed`);
      } catch (err: any) {
        console.warn(`⚠️ Could not complete inbound session for ASN ${asn_no}:`, err?.message || err);
        inboundCompleteAttempted.delete(key);
      }
    }
  } catch (error: any) {
    console.warn(`⚠️ Error in checkAndCompleteInboundSessionsAfterSync:`, error.message);
  }
};

/**
 * Try to complete inbound session for the active ASN/session from settings.
 * Called when user taps Sync even if there are no events to sync, so we still tell the backend
 * to set ASN status to Completed when all cartons are received.
 */
const tryCompleteInboundForActiveSession = async (): Promise<void> => {
  try {
    const settings = await getSettings();
    const activeASN = settings.active_asn ?? "";
    const activeSession = settings.active_session ?? "";
    if (!activeASN.trim() || !activeSession.trim()) return;
    const key = `${activeASN.toUpperCase().trim()}|${activeSession.trim()}`;
    if (inboundCompleteAttempted.has(key)) return;
    const allReceived = await dataService.areAllCartonsReceived(activeASN, activeSession);
    if (!allReceived) return;
    inboundCompleteAttempted.add(key);
    const user_id = settings.user_id || settings.user_code || "";
    const device_id = settings.device_id || "";
    await apiService.completeInboundSession({
      inbound_session: activeSession,
      asn_no: activeASN,
      user_id,
      device_id,
    });
    console.warn(`✅ Inbound session completed for active ASN ${activeASN} (${activeSession}) — backend can update ASN status to Completed`);
  } catch (err: any) {
    console.warn(`⚠️ tryCompleteInboundForActiveSession:`, err?.message || err);
  }
};

/**
 * Check if all cartons are completed for an ASN and create putaway task if needed
 * This is called after successful sync to ensure backend has all data
 */
const checkAndCreatePutawayTasksAfterSync = async (syncedEvents: ScanEvent[]) => {
  try {
    // Extract unique ASNs from synced events
    const asnSet = new Set<string>();
    for (const event of syncedEvents) {
      if (event.asn_no) {
        asnSet.add(event.asn_no.toUpperCase().trim());
      }
    }

    // Check each ASN to see if all cartons are completed
    for (const asnNo of asnSet) {
      // Skip if we've already attempted to create a task for this ASN
      if (putawayTaskCreationAttempted.has(asnNo)) {
        continue;
      }

      try {
        // Check if all cartons are completed for this ASN
        const cartons = await dataService.getASNCartons(asnNo);
        if (!cartons || cartons.length === 0) {
          continue; // No cartons found, skip
        }

        const totalCartons = cartons.length;
        const completedCartons = cartons.filter(
          (c) => c.status === "Completed" || c.status === "COMPLETED"
        ).length;

        const allCartonsCompleted = completedCartons === totalCartons && totalCartons > 0;

        if (allCartonsCompleted) {
          console.warn(`✅ All cartons completed for ASN ${asnNo} (${completedCartons}/${totalCartons})`);
          console.warn(`🔄 Checking if putaway task creation is needed after successful sync...`);

          // Mark that we're attempting to create a task for this ASN
          putawayTaskCreationAttempted.add(asnNo);

          // First, check if a putaway task already exists for this ASN
          let existingTask = null;
          try {
            const existingTasks = await apiService.getPutawayTasks({
              status: "Open",
              advance_shipping_notice: asnNo,
            });

            let tasksList: any[] = [];
            if (Array.isArray(existingTasks)) {
              tasksList = existingTasks;
            } else if (existingTasks?.data && Array.isArray(existingTasks.data)) {
              tasksList = existingTasks.data;
            } else if (existingTasks?.tasks && Array.isArray(existingTasks.tasks)) {
              tasksList = existingTasks.tasks;
            }

            // Check if there's already an open task for this ASN
            existingTask = tasksList.find((task: any) => {
              const taskASN = task.advance_shipping_notice || task.asn_no || task.asn;
              return taskASN && taskASN.toUpperCase().trim() === asnNo.toUpperCase().trim();
            });

            if (existingTask) {
              console.warn(`ℹ️ Putaway task already exists for ASN ${asnNo}: ${existingTask.putaway_task || existingTask.task_title || existingTask.id}`);
              console.warn(`   Skipping task creation to prevent duplicates`);
              continue; // Don't create duplicate task
            }
          } catch (checkError: any) {
            // If checking fails, log but continue (might be 404 or schema issue)
            console.warn(`⚠️ Could not check for existing putaway tasks for ASN ${asnNo}:`, checkError.message);
            // Continue with creation - backend should handle duplicates
          }

          // Create putaway task for remaining items
          try {
            console.warn(`🔄 Creating putaway task for remaining items (ASN: ${asnNo}) after successful sync`);
            const putawayTaskResponse = await apiService.createTaskForRemainingItems(asnNo);

            if (putawayTaskResponse?.ok || putawayTaskResponse?.success) {
              const taskId = putawayTaskResponse?.data?.putaway_task || putawayTaskResponse?.putaway_task;
              const itemsCount = putawayTaskResponse?.data?.remaining_items_count || putawayTaskResponse?.data?.items_added || 0;
              const isNewTask = putawayTaskResponse?.data?.is_new_task || false;

              console.warn(`✅ Putaway task created for remaining items after sync:`, {
                putaway_task: taskId,
                asn_no: asnNo,
                items_count: itemsCount,
                is_new_task: isNewTask,
              });

              if (itemsCount > 0) {
                console.warn(`📦 ${itemsCount} remaining item(s) added to putaway task ${taskId}`);
              } else {
                console.warn(`ℹ️ No remaining items found for putaway (all items were allocated to TO)`);
              }
            } else {
              console.warn(`⚠️ Putaway task creation response format not recognized:`, putawayTaskResponse);
            }
          } catch (putawayTaskError: any) {
            // Don't block sync if putaway task creation fails
            if (putawayTaskError.message?.includes("404") || putawayTaskError.message?.includes("not found")) {
              console.warn(`⚠️ Putaway task creation endpoint not available (404) - this is optional`);
              console.warn(`   Backend needs to implement: POST /api/putaway/create-task-for-remaining-items`);
            } else {
              console.warn(`⚠️ Failed to create putaway task for remaining items after sync:`, putawayTaskError.message);
              console.warn(`   App will continue - putaway tasks can be checked later using GET /api/putaway/tasks`);
            }
            // Remove from attempted set so we can retry later
            putawayTaskCreationAttempted.delete(asnNo);
          }
        }
      } catch (asnError: any) {
        console.warn(`⚠️ Error checking carton status for ASN ${asnNo}:`, asnError.message);
        // Remove from attempted set so we can retry later
        putawayTaskCreationAttempted.delete(asnNo);
      }
    }
  } catch (error: any) {
    console.warn(`⚠️ Error in checkAndCreatePutawayTasksAfterSync:`, error.message);
  }
};

export const syncEvents = async (): Promise<{
  synced: number;
  failed: number;
}> => {
  // Prevent concurrent syncs
  if (isSyncing) {
    console.warn("⏳ Sync already in progress, skipping...");
    return { synced: 0, failed: 0 };
  }

  const unsynced = await getUnsyncedEvents();

  if (unsynced.length === 0) {
    // Still try to complete inbound for active session so desktop status updates (e.g. after several syncs)
    await tryCompleteInboundForActiveSession();
    return { synced: 0, failed: 0 };
  }

  // Clear old error messages before retrying
  await clearErrorMessages();

  isSyncing = true;

  try {
    // Normalize events: ensure qty is a number (SQLite may return it as string)
    const normalizedEvents = unsynced.map((event) => ({
      ...event,
      qty: event.qty != null ? Number(event.qty) : undefined,
    }));

    // ✅ FIX: Deduplicate PUTAWAY_TO_RACK events before sending
    // Group by event_type + tc_id + rack to identify duplicates
    // Keep only the most recent event for each unique combination
    const deduplicatedEvents: ScanEvent[] = [];
    const eventKeyMap = new Map<string, ScanEvent>();
    
    for (const event of normalizedEvents) {
      // For PUTAWAY_TO_RACK events, create a unique key from tc_id + rack
      if (event.event_type === "PUTAWAY_TO_RACK" && event.tc_id && event.rack) {
        const key = `PUTAWAY_TO_RACK:${event.tc_id}:${event.rack}`;
        const existing = eventKeyMap.get(key);
        
        // Keep the most recent event (by event_time)
        if (!existing || new Date(event.event_time) > new Date(existing.event_time)) {
          eventKeyMap.set(key, event);
        } else {
          console.warn(`⚠️ Deduplicating PUTAWAY_TO_RACK event: TC ${event.tc_id} at ${event.rack} (keeping older event: ${existing.offline_uuid.substring(0, 8)}...)`);
        }
      } else {
        // For other events, add them as-is (no deduplication needed)
        deduplicatedEvents.push(event);
      }
    }
    
    // Add deduplicated PUTAWAY_TO_RACK events
    for (const [key, event] of eventKeyMap.entries()) {
      deduplicatedEvents.push(event);
    }
    
    if (normalizedEvents.length !== deduplicatedEvents.length) {
      const duplicatesRemoved = normalizedEvents.length - deduplicatedEvents.length;
      console.warn(`✅ Deduplicated ${duplicatesRemoved} duplicate PUTAWAY_TO_RACK event(s) before sending`);
      console.warn(`   Original: ${normalizedEvents.length} events → Deduplicated: ${deduplicatedEvents.length} events`);
    }

    // Split deduplicated events into chunks of MAX_BATCH_SIZE to comply with backend limit
    const chunks: ScanEvent[][] = [];
    for (let i = 0; i < deduplicatedEvents.length; i += MAX_BATCH_SIZE) {
      const chunk = deduplicatedEvents.slice(i, i + MAX_BATCH_SIZE);
      // Safety check: ensure chunk never exceeds MAX_BATCH_SIZE
      if (chunk.length > MAX_BATCH_SIZE) {
        console.error(
          `❌ ERROR: Chunk size (${chunk.length}) exceeds MAX_BATCH_SIZE (${MAX_BATCH_SIZE})!`
        );
        // Split this chunk further
        for (let j = 0; j < chunk.length; j += MAX_BATCH_SIZE) {
          chunks.push(chunk.slice(j, j + MAX_BATCH_SIZE));
        }
      } else {
        chunks.push(chunk);
      }
    }

    // Validate all chunks are within limit
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].length > MAX_BATCH_SIZE) {
        console.error(
          `❌ ERROR: Chunk ${i + 1} has ${
            chunks[i].length
          } events, exceeds limit of ${MAX_BATCH_SIZE}!`
        );
      }
    }

    console.warn(
      `📦 Syncing ${deduplicatedEvents.length} events in ${chunks.length} batch(es) of max ${MAX_BATCH_SIZE}`
    );

    // Log chunk sizes for debugging (use warn so it shows up)
    chunks.forEach((chunk, idx) => {
      console.warn(`  Batch ${idx + 1}: ${chunk.length} events`);
    });

    let totalSyncedCount = 0;
    let totalFailedCount = 0;

    // Process each chunk sequentially
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      console.warn(
        `📤 Sending batch ${chunkIndex + 1}/${chunks.length} (${
          chunk.length
        } events)...`
      );

      try {
        // Double-check chunk size before sending
        if (chunk.length > MAX_BATCH_SIZE) {
          throw new Error(
            `Chunk size (${chunk.length}) exceeds backend limit (${MAX_BATCH_SIZE}). This should never happen!`
          );
        }

        console.warn(
          `📤 Sending batch ${chunkIndex + 1}/${chunks.length} with exactly ${
            chunk.length
          } events (limit: ${MAX_BATCH_SIZE})`
        );

        // Validate chunk is not empty before sending
        if (chunk.length === 0) {
          console.error(`❌ ERROR: Attempted to send empty chunk ${chunkIndex + 1}! Skipping...`);
          continue;
        }

        // Log PACK_ITEM_TO_TC (and PACK_BOX_TO_TC for backward compatibility) events in this batch for debugging
        const packEvents = chunk.filter(e => e.event_type === "PACK_ITEM_TO_TC" || e.event_type === "PACK_BOX_TO_TC");
        if (packEvents.length > 0) {
          console.warn(`📦 PACK_ITEM_TO_TC/PACK_BOX_TO_TC events in this batch (${packEvents.length}):`);
          packEvents.forEach((e, idx) => {
            console.warn(`   Event ${idx + 1}:`, {
              uuid: e.offline_uuid.substring(0, 12) + '...',
              event_type: e.event_type,
              item_code: e.item_code,
              qty: e.qty,
              carton_id: e.carton_id,
              carton_id_length: e.carton_id?.length || 0,
              box_id: e.box_id,
              source_bin: e.source_bin,
              source_bin_length: e.source_bin?.length || 0,
              bin: e.bin,
              location_id: e.location_id,
              rack: e.rack,
              tc_id: e.tc_id,
              material_request: e.material_request,
              to_no: e.to_no,
              store: e.store,
              asn_no: e.asn_no,
              device_id: e.device_id,
              user_id: e.user_id
            });
          });
        }

        // ✅ CRITICAL: Log TRANSFER_IN_RECEIVE events to verify transfer_in is included
        const transferInEvents = chunk.filter(e => e.event_type === "TRANSFER_IN_RECEIVE");
        if (transferInEvents.length > 0) {
          console.warn(`📦 TRANSFER_IN_RECEIVE events in this batch (${transferInEvents.length}):`);
          transferInEvents.forEach((e, idx) => {
            const hasTransferIn = e.transfer_in !== undefined && e.transfer_in !== null && e.transfer_in.trim() !== "";
            const hasCartonId = e.carton_id !== undefined && e.carton_id !== null && e.carton_id.trim() !== "";
            const hasItemCode = e.item_code !== undefined && e.item_code !== null && e.item_code.trim() !== "";
            
            if (!hasTransferIn) {
              console.error(`❌ CRITICAL: TRANSFER_IN_RECEIVE event ${idx + 1} is MISSING transfer_in field!`);
              console.error(`   This event will be SKIPPED by backend processing.`);
            }
            
            console.warn(`   Event ${idx + 1}:`, {
              uuid: e.offline_uuid?.substring(0, 12) + '...',
              event_type: e.event_type,
              transfer_in: e.transfer_in || "❌ MISSING",
              has_transfer_in: hasTransferIn,
              item_code: e.item_code || "❌ MISSING",
              has_item_code: hasItemCode,
              carton_id: e.carton_id || "❌ MISSING",
              has_carton_id: hasCartonId,
              qty: e.qty,
              device_id: e.device_id,
              user_id: e.user_id,
            });
          });
        }

        // Log first event structure for debugging
        if (chunk.length > 0) {
          console.warn(`📋 Sample event structure:`, {
            offline_uuid: chunk[0].offline_uuid?.substring(0, 8) + '...',
            event_type: chunk[0].event_type,
            has_qty: chunk[0].qty !== undefined && chunk[0].qty !== null,
            qty_value: chunk[0].qty,
          });
        }

        // ✅ Check if items are already scanned (for Material Request events)
        // If events with same item_code and tc_id already exist, use update_mode
        // Backend uses item_code + tc_id to identify existing scans for update
        let useUpdateMode = false;
        
        if (packEvents.length > 0) {
          try {
            const db = await getDatabase();
            // Check if any of these items are already scanned (exist in synced events)
            // Backend identifies existing scans by item_code + tc_id (not carton_id)
            for (const event of packEvents) {
              if (event.item_code && event.tc_id) {
                // Check for existing synced events with same item_code and tc_id
                const existingEvent = await db.getFirstAsync<{ count: number }>(
                  `SELECT COUNT(*) as count FROM event_queue 
                   WHERE item_code = ? AND tc_id = ? AND synced = 1
                   AND event_type IN ('PACK_ITEM_TO_TC', 'PACK_BOX_TO_TC')`,
                  [event.item_code, event.tc_id]
                );
                
                if (existingEvent && existingEvent.count > 0) {
                  useUpdateMode = true;
                  console.warn(`🔄 Item ${event.item_code} already scanned in TC ${event.tc_id} (${existingEvent.count} existing events) - using update_mode: true`);
                  break; // If any item is already scanned, use update mode for the whole batch
                }
              }
            }
          } catch (checkError: any) {
            console.warn(`⚠️ Failed to check for existing events, using normal mode:`, checkError.message);
            // Continue with normal mode if check fails
          }
        }
        
        // Log update mode decision
        if (useUpdateMode) {
          console.warn(`🔄 UPDATE MODE: Will send events with update_mode: true`);
        } else {
          console.warn(`➕ NORMAL MODE: Will send events without update_mode (new items)`);
        }

        const response = await apiService.batchEvents(chunk, useUpdateMode);
        
        if (useUpdateMode) {
          console.warn(`✅ Sent batch with update_mode: true (items already scanned)`);
        }

        // Log raw response for debugging (use warn so it shows up)
        console.warn(`📡 Backend batch response (raw):`, JSON.stringify(response, null, 2));

        // Check if we're in demo mode (events are NOT saved to backend in demo mode)
        const settings = await getSettings();
        // ✅ REMOVED: Demo mode check - events always sync to backend
        const isOffline = !settings.api_url;
        if (isOffline) {
          console.warn(`⚠️ API URL not configured: Events are NOT being saved to backend database. They are only marked as synced locally.`);
        }

        // Handle multiple response formats:
        // Format 1: { acked: [uuid1, uuid2, ...], failed: [{uuid, message}, ...] }
        // Format 2: { acked_count: 2, acked_uuids: [uuid1, uuid2], failed_count: 0, failed_details: [...] }
        // Format 3: { ok: true, processed: N } (demo mode or simple acknowledgment)
        // Format 4: { success: true, acked: [...] } (alternative format)
        // Format 5: { ok: true, inserted_count: N, total_count: N } (backend saved events format)
        let ackedUuids: string[] = [];
        let failedItems: any[] = [];
        let usingFallbackAck = false;

        if (response.acked && Array.isArray(response.acked)) {
          ackedUuids = response.acked;
          console.warn(`✅ Backend returned explicit acked array with ${ackedUuids.length} UUIDs - events ARE saved to backend`);
        } else if (response.acked_uuids && Array.isArray(response.acked_uuids)) {
          ackedUuids = response.acked_uuids;
          console.warn(`✅ Backend returned acked_uuids array with ${ackedUuids.length} UUIDs - events ARE saved to backend`);
        } else if (response.ok === true && (response.inserted_count !== undefined || response.total_count !== undefined)) {
          // Format 5: Backend saved events and returned count
          const insertedCount = response.inserted_count || 0;
          const totalCount = response.total_count || chunk.length;
          
          // ✅ IMPORTANT: Only mark events as synced if they were actually inserted
          // If inserted_count is 0, events failed validation and were NOT saved
          if (insertedCount > 0) {
            console.warn(`✅ Backend returned ok: true with inserted_count: ${insertedCount} - events ARE saved to backend`);
            // If backend says it inserted events, mark all events in chunk as synced
            // BUT: Exclude events that have errors (they will be handled below)
            const errorUuids = new Set(
              (response.errors || []).map((e: any) => e.offline_uuid || e.uuid).filter(Boolean)
            );
            ackedUuids = chunk
              .filter(e => !errorUuids.has(e.offline_uuid))
              .map(e => e.offline_uuid);
            usingFallbackAck = false; // Not a fallback - backend confirmed insertion
          } else {
            console.warn(`⚠️ Backend returned ok: true but inserted_count: 0 - events were NOT saved (validation errors)`);
            // Don't mark any events as synced - they all failed
            ackedUuids = [];
          }
        } else if (response.ok === true && response.processed) {
          // Simple acknowledgment - mark all events as synced
          console.warn(`ℹ️ Backend returned simple acknowledgment (ok: true, processed: ${response.processed})`);
          if (isOffline) {
            console.warn(`⚠️ API URL not configured: Using fallback acknowledgment - events NOT saved to backend`);
          } else {
            console.warn(`⚠️ Backend returned simple 'ok' without acked_uuids - assuming events are saved but cannot verify`);
          }
          // If backend just says "ok", assume all events in this chunk were processed
          ackedUuids = chunk.map(e => e.offline_uuid);
          usingFallbackAck = true;
        } else if (response.success === true && response.acked && Array.isArray(response.acked)) {
          ackedUuids = response.acked;
          console.warn(`✅ Backend returned success with acked array - events ARE saved to backend`);
        } else {
          console.warn(`⚠️ Backend response format not recognized - cannot determine if events were saved`);
          console.warn(`   Response keys:`, Object.keys(response || {}));
        }

        // Check for failed events in multiple formats
        if (response.failed && Array.isArray(response.failed)) {
          failedItems = response.failed;
        } else if (response.failed_details && Array.isArray(response.failed_details)) {
          failedItems = response.failed_details;
        } else if (response.errors && Array.isArray(response.errors)) {
          // ✅ Backend returns errors array with { offline_uuid, error } format
          failedItems = response.errors.map((err: any) => ({
            offline_uuid: err.offline_uuid || err.uuid,
            uuid: err.offline_uuid || err.uuid,
            message: err.error || err.message || "Validation error"
          }));
          console.warn(`⚠️ Backend returned ${failedItems.length} error(s) - events failed validation`);
        }

        // Determine if events were actually saved to backend
        const eventsSavedToBackend = !isOffline && (
          (ackedUuids.length > 0 && !usingFallbackAck) || // Explicit acked UUIDs
          (response.ok === true && (response.inserted_count !== undefined || response.total_count !== undefined)) // Backend confirmed insertion
        );

        // Log processed response for debugging (use warn so it shows up)
        console.warn(`📡 Backend batch response (processed):`, {
          acked_count: ackedUuids.length,
          failed_count: failedItems.length,
          total_events_in_chunk: chunk.length,
          using_fallback_ack: usingFallbackAck,
          offline_mode: isOffline,
          events_saved_to_backend: eventsSavedToBackend,
          inserted_count: response.inserted_count,
          total_count: response.total_count,
          acked_uuids_preview: ackedUuids.slice(0, 5).map((u: string) => u.substring(0, 8) + '...'),
          failed_details_preview: failedItems.slice(0, 3).map((f: any) => ({
            uuid: (f.uuid || f.offline_uuid)?.substring(0, 8) + '...',
            message: f.message
          }))
        });

        // ✅ IMPORTANT: Exclude failed events from acked list
        // If an event has an error, it should NOT be marked as synced
        const failedUuids = new Set(
          failedItems.map((f: any) => f.offline_uuid || f.uuid).filter(Boolean)
        );
        const validAckedUuids = ackedUuids.filter(uuid => !failedUuids.has(uuid));
        
        // ✅ CRITICAL: Only mark events as synced if they were actually inserted
        // If inserted_count is 0, even if response.ok is true, events were NOT saved
        const actuallyInserted = response.inserted_count !== undefined && response.inserted_count > 0;
        const hasErrors = failedItems.length > 0;
        
        // Mark acked events as synced (this also clears error_msg)
        if (validAckedUuids.length > 0 && actuallyInserted) {
          for (const uuid of validAckedUuids) {
            await markEventSynced(uuid);
            totalSyncedCount++;
          }
          console.warn(`✅ Marked ${validAckedUuids.length} events as synced (${ackedUuids.length - validAckedUuids.length} excluded due to errors)`);
        } else if (response.ok === true && !hasErrors && (response.inserted_count === undefined || response.inserted_count > 0)) {
          // Backend returned success but no acked_uuids - assume all events were processed
          // BUT: Only if there are no errors and events were actually inserted
          // This handles cases where backend uses simple acknowledgment format
          console.warn(`ℹ️ Backend returned success but no acked_uuids - marking all ${chunk.length} events as synced (fallback)`);
          for (const event of chunk) {
            // Don't mark failed events as synced
            if (!failedUuids.has(event.offline_uuid)) {
              await markEventSynced(event.offline_uuid);
              totalSyncedCount++;
            }
          }
          console.warn(`✅ Marked ${chunk.length - failedUuids.size} events in chunk as synced (fallback, ${failedUuids.size} excluded)`);
        } else {
          // ✅ CRITICAL: If inserted_count is 0, events were NOT saved, even if response.ok is true
          if (response.ok === true && response.inserted_count === 0) {
            console.warn(`⚠️ Backend returned ok:true but inserted_count:0 - events were NOT saved to backend`);
            console.warn(`   This means all events failed validation or were rejected`);
          } else {
            console.warn(`⚠️ No events were acked by backend (acked_uuids is empty or missing, and response.ok/success is not true, or all events have errors)`);
          }
          console.warn(`   Response keys:`, Object.keys(response || {}));
          if (response.errors && response.errors.length > 0) {
            console.warn(`   Errors:`, response.errors.map((e: any) => e.error || e.message).join(", "));
          }
        }

        // ✅ FIX: Treat duplicate UUID errors as success (events were already processed)
        // Mark failed events (but exclude duplicates which should be treated as ACK)
        if (failedItems.length > 0) {
          const duplicateUuids: string[] = [];
          const realFailedItems: any[] = [];
          
          for (const failure of failedItems) {
            const failureUuid = failure.uuid || failure.offline_uuid;
            const errorMsg = failure.message || "Unknown error";
            
            if (failureUuid && isDuplicateUuidError(errorMsg)) {
              // ✅ Duplicate UUID = event was already processed by backend = success
              duplicateUuids.push(failureUuid);
              console.log(`ℹ️ Event ${failureUuid.substring(0, 8)}... is duplicate - treating as ACK success`);
            } else if (failureUuid) {
              // Real failure - mark as failed
              realFailedItems.push(failure);
            }
          }
          
          // Mark duplicate UUIDs as synced (they were already processed)
          if (duplicateUuids.length > 0) {
            for (const uuid of duplicateUuids) {
              await markEventSynced(uuid);
              totalSyncedCount++;
            }
            console.log(`✅ Marked ${duplicateUuids.length} duplicate events as synced (already processed by backend)`);
          }
          
          // Mark real failures
          if (realFailedItems.length > 0) {
            for (const failure of realFailedItems) {
              const failureUuid = failure.uuid || failure.offline_uuid;
              if (failureUuid) {
                await markEventFailed(
                  failureUuid,
                  failure.message || "Unknown error"
                );
                totalFailedCount++;
              }
            }
            console.log(`❌ Marked ${realFailedItems.length} events as failed`);
          }
        }

        // Check if PACK_BOX_TO_TC events were acked
        if (packEvents.length > 0) {
          const ackedPackEvents = packEvents.filter(e => ackedUuids.includes(e.offline_uuid));
          const failedPackEvents = packEvents.filter(e => 
            failedItems.some((f: any) => (f.uuid || f.offline_uuid) === e.offline_uuid)
          );
          console.warn(`📦 PACK_ITEM_TO_TC/PACK_BOX_TO_TC sync result: ${ackedPackEvents.length} acked, ${failedPackEvents.length} failed, ${packEvents.length - ackedPackEvents.length - failedPackEvents.length} not acknowledged`);
        }

        // Calculate actual synced/failed counts for this chunk
        const chunkSyncedCount = ackedUuids.length > 0 
          ? ackedUuids.length 
          : (response.ok === true || response.success === true ? chunk.length : 0);
        const chunkFailedCount = failedItems.length;
        
        console.warn(
          `✅ Batch ${chunkIndex + 1}/${chunks.length} completed: ${chunkSyncedCount} synced, ${chunkFailedCount} failed`
        );

        // Add a delay between chunks to avoid rate limiting and allow UI updates
        if (chunkIndex < chunks.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        // Yield to UI thread every 3 chunks to prevent hanging
        if ((chunkIndex + 1) % 3 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (chunkError: any) {
        // Handle rate limiting gracefully - don't mark events as failed, they'll retry
        if (
          chunkError.message?.includes("429") ||
          chunkError.message?.includes("RATE_LIMIT") ||
          chunkError.message?.includes("rate limit")
        ) {
          console.log(
            `⚠️ Rate limit hit on batch ${chunkIndex + 1}/${
              chunks.length
            }, remaining events will be synced later`
          );
          // Don't mark as failed, just break - remaining chunks will be retried on next sync
          break;
        }

        // Check if error is about batch size limit
        if (
          chunkError.message?.includes("1000") ||
          chunkError.message?.includes("less than or equal to 1000") ||
          chunkError.message?.includes("VALIDATION_ERROR")
        ) {
          console.error(
            `❌ Batch size validation error on batch ${chunkIndex + 1}/${
              chunks.length
            }:`,
            chunkError.message
          );
          console.error(
            `   Chunk size was: ${chunk.length}, limit is: ${MAX_BATCH_SIZE}`
          );
          // This shouldn't happen if chunking is working correctly
          // But if it does, split this chunk further
          console.log(
            `   Attempting to split chunk ${
              chunkIndex + 1
            } into smaller batches...`
          );
          const subChunks: ScanEvent[][] = [];
          for (let j = 0; j < chunk.length; j += 500) {
            subChunks.push(chunk.slice(j, j + 500));
          }
          // Retry with smaller chunks
          for (const subChunk of subChunks) {
            try {
              const subResponse = await apiService.batchEvents(subChunk);
              if (subResponse.acked) {
                for (const uuid of subResponse.acked) {
                  await markEventSynced(uuid);
                  totalSyncedCount++;
                }
              }
            } catch (subError: any) {
              console.error(`   Sub-chunk also failed:`, subError.message);
              for (const event of subChunk) {
                await markEventFailed(
                  event.offline_uuid,
                  subError.message || "Sync failed"
                );
                totalFailedCount++;
              }
            }
          }
        } else {
          // For other errors, mark this chunk as failed and continue with next chunk
          console.error(
            `❌ Batch ${chunkIndex + 1}/${chunks.length} failed:`,
            chunkError.message
          );
          for (const event of chunk) {
            await markEventFailed(
              event.offline_uuid,
              chunkError.message || "Sync failed"
            );
            totalFailedCount++;
          }
        }
        // Continue with next chunk instead of throwing
      }
    }

    // After successful sync, check if we should create putaway tasks for completed ASNs
    if (totalSyncedCount > 0) {
      await checkAndCreatePutawayTasksAfterSync(unsynced);
      // When all cartons are received, call inbound/complete so backend can set ASN status to Completed
      await checkAndCompleteInboundSessionsAfterSync(unsynced);
    }

    return { synced: totalSyncedCount, failed: totalFailedCount };
  } catch (error: any) {
    // This catch block handles unexpected errors before chunk processing
    console.error("❌ Sync error:", error);
    // Mark all remaining unsynced events as failed
    for (const event of unsynced) {
      await markEventFailed(event.offline_uuid, error.message || "Sync failed");
    }
    throw error;
  } finally {
    isSyncing = false;
  }
};

export const getEventCount = async (): Promise<number> => {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM event_queue WHERE synced = 0"
  );
  return result?.count || 0;
};

export const clearErrorMessages = async (): Promise<void> => {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE event_queue SET error_msg = NULL WHERE synced = 0 AND error_msg IS NOT NULL"
  );
  console.log("✅ Cleared error messages from unsynced events");
};

/**
 * Get all PACK_BOX_TO_TC events for a specific transfer carton
 * Also checks for case-insensitive matches and similar tc_id variations
 */
export const getEventsForTransferCarton = async (tc_id: string): Promise<ScanEvent[]> => {
  const db = await getDatabase();
  
  // First try exact match
  let events = await db.getAllAsync<ScanEvent>(
    "SELECT * FROM event_queue WHERE tc_id = ? AND event_type IN ('PACK_BOX_TO_TC', 'PACK_ITEM_TO_TC') ORDER BY event_time ASC",
    [tc_id]
  );
  
  // If no exact match, try case-insensitive match
  if (events.length === 0) {
    events = await db.getAllAsync<ScanEvent>(
      "SELECT * FROM event_queue WHERE UPPER(tc_id) = UPPER(?) AND event_type IN ('PACK_BOX_TO_TC', 'PACK_ITEM_TO_TC') ORDER BY event_time ASC",
      [tc_id]
    );
  }
  
  // If still no match, try to find events with similar tc_id (contains the tc_id)
  if (events.length === 0) {
    events = await db.getAllAsync<ScanEvent>(
      "SELECT * FROM event_queue WHERE tc_id LIKE ? AND event_type IN ('PACK_BOX_TO_TC', 'PACK_ITEM_TO_TC') ORDER BY event_time ASC",
      [`%${tc_id}%`]
    );
  }
  
  return events;
};

/**
 * Get all PACK_BOX_TO_TC events that might be related to a transfer carton
 * This searches for events with similar tc_id patterns
 */
export const searchRelatedEvents = async (tc_id: string): Promise<ScanEvent[]> => {
  const db = await getDatabase();
  
  // Search for events that contain the tc_id (partial match)
  // This helps find events where tc_id might have been stored with a different format
  const events = await db.getAllAsync<ScanEvent>(
    `SELECT * FROM event_queue 
     WHERE event_type IN ('PACK_BOX_TO_TC', 'PACK_ITEM_TO_TC') 
     AND (
       tc_id = ? 
       OR UPPER(tc_id) = UPPER(?)
       OR tc_id LIKE ?
       OR tc_id LIKE ?
     )
     ORDER BY event_time ASC`,
    [tc_id, tc_id, `%${tc_id}%`, `${tc_id}%`]
  );
  
  return events;
};

/**
 * Mark events as unsynced so they can be resent
 * Useful when backend didn't receive events or needs them resent
 * Also handles case-insensitive and partial matches
 */
export const markEventsAsUnsynced = async (tc_id: string): Promise<number> => {
  const db = await getDatabase();
  
  // First, find all related events
  const relatedEvents = await searchRelatedEvents(tc_id);
  
  if (relatedEvents.length === 0) {
    return 0;
  }
  
  // Log current sync status of events
  console.log(`📊 Current sync status of events:`, relatedEvents.map(e => ({
    uuid: e.offline_uuid.substring(0, 8) + '...',
    synced: e.synced,
    tc_id: e.tc_id,
    box_id: e.box_id
  })));
  
  // Mark all related events as unsynced (force update even if already unsynced)
  let totalChanges = 0;
  for (const event of relatedEvents) {
    // Check current status before update
    const before = await db.getFirstAsync<{ synced: number }>(
      "SELECT synced FROM event_queue WHERE offline_uuid = ?",
      [event.offline_uuid]
    );
    
    // Force update to unsynced (even if already 0, this ensures it's reset)
    // Use UPDATE with WHERE clause that always matches to force the update
    const result = await db.runAsync(
      "UPDATE event_queue SET synced = 0, error_msg = NULL WHERE offline_uuid = ?",
      [event.offline_uuid]
    );
    
    // Verify the update worked
    const after = await db.getFirstAsync<{ synced: number }>(
      "SELECT synced FROM event_queue WHERE offline_uuid = ?",
      [event.offline_uuid]
    );
    
    console.log(`🔄 Event ${event.offline_uuid.substring(0, 8)}...: synced ${before?.synced} → ${after?.synced}, changes: ${result.changes}`);
    
    // Count as changed if status actually changed OR if we forced the update
    if (result.changes > 0 || (before?.synced !== 0 && after?.synced === 0)) {
      totalChanges++;
    } else if (before?.synced === 0 && after?.synced === 0) {
      // Already unsynced, but we still want to resync it
      totalChanges++;
      console.log(`ℹ️ Event ${event.offline_uuid.substring(0, 8)}... was already unsynced, will resync`);
    }
  }
  
  console.log(`🔄 Marked ${totalChanges} PACK_BOX_TO_TC events as unsynced for TC: ${tc_id}`);
  return totalChanges;
};

/**
 * Resync events for a specific transfer carton
 * This will mark all PACK_BOX_TO_TC events for the TC as unsynced and then sync them
 */
export const resyncTransferCartonEvents = async (tc_id: string): Promise<{
  synced: number;
  failed: number;
  total: number;
}> => {
  console.log(`🔄 Resyncing events for Transfer Carton: ${tc_id}`);
  
  // First, search for all related events to see what we have
  const relatedEvents = await searchRelatedEvents(tc_id);
  
  if (relatedEvents.length === 0) {
    console.log(`ℹ️ No PACK_BOX_TO_TC events found for TC: ${tc_id} (searched with multiple patterns)`);
    return { synced: 0, failed: 0, total: 0 };
  }
  
  // Log unique tc_id values found
  const uniqueTcIds = [...new Set(relatedEvents.map(e => e.tc_id).filter(Boolean))];
  console.log(`📦 Found ${relatedEvents.length} related events for TC: ${tc_id}`);
  console.log(`📋 Found tc_id values:`, uniqueTcIds);
  
  // Store the offline_uuids of events we're about to mark as unsynced
  const eventUuids = relatedEvents.map(e => e.offline_uuid);
  console.log(`📝 Event UUIDs to resync:`, eventUuids);
  
  // Mark all related events as unsynced
  const markedCount = await markEventsAsUnsynced(tc_id);
  
  if (markedCount === 0) {
    console.log(`⚠️ Found ${relatedEvents.length} events but couldn't mark them as unsynced`);
    return { synced: 0, failed: 0, total: relatedEvents.length };
  }
  
  console.log(`📦 Marked ${markedCount} events as unsynced for TC: ${tc_id}`);
  
  // Verify events are actually unsynced now
  const db = await getDatabase();
  const unsyncedCheck = await db.getAllAsync<{ offline_uuid: string; synced: number }>(
    "SELECT offline_uuid, synced FROM event_queue WHERE offline_uuid IN (" + 
    eventUuids.map(() => "?").join(",") + ")",
    eventUuids
  );
  const actuallyUnsynced = unsyncedCheck.filter(e => e.synced === 0);
  console.log(`✅ Verified ${actuallyUnsynced.length} of ${eventUuids.length} events are now unsynced`);
  
  if (actuallyUnsynced.length === 0) {
    console.log(`⚠️ Events were marked but are still showing as synced. This might indicate they were already synced.`);
    // Force them to be unsynced by updating again
    for (const uuid of eventUuids) {
      await db.runAsync(
        "UPDATE event_queue SET synced = 0, error_msg = NULL WHERE offline_uuid = ?",
        [uuid]
      );
    }
    console.log(`🔄 Force-updated all events to unsynced status`);
  }
  
  // Get the actual unsynced events to verify they'll be synced
  const eventsToSync = await db.getAllAsync<ScanEvent>(
    "SELECT * FROM event_queue WHERE offline_uuid IN (" + 
    eventUuids.map(() => "?").join(",") + ") AND synced = 0",
    eventUuids
  );
  console.log(`📤 Found ${eventsToSync.length} events ready to sync for TC ${tc_id}`);
  
  // Now sync all events (this will include the ones we just marked as unsynced)
  const result = await syncEvents();
  
  // Wait a moment for sync to complete
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Check how many of our specific events were synced
  const syncedCheck = await db.getAllAsync<{ offline_uuid: string; synced: number }>(
    "SELECT offline_uuid, synced FROM event_queue WHERE offline_uuid IN (" + 
    eventUuids.map(() => "?").join(",") + ")",
    eventUuids
  );
  const ourSyncedCount = syncedCheck.filter(e => e.synced === 1).length;
  const stillUnsynced = syncedCheck.filter(e => e.synced === 0).length;
  
  console.log(`✅ Resync completed for TC ${tc_id}: ${ourSyncedCount} of our events synced, ${stillUnsynced} still unsynced, ${result.synced} total events synced, ${result.failed} failed`);
  
  return {
    synced: ourSyncedCount, // Return count of our specific events that were synced
    failed: result.failed,
    total: markedCount,
  };
};