import { getDatabase } from "../database/database";
import { apiService } from "./api.service";
import { getSettings } from "./settings.service";

interface CycleCountSession {
  session_id: string;
  count_type: string;
  warehouse_id: string;
  bin_id: string;
  bin_code: string;
  started_by: string;
  started_at: string;
  status: string;
  is_blind_count: number;
  device_id: string;
  synced: number;
  created_at: string;
  updated_at: string;
}

interface CycleCountLine {
  line_id: string;
  session_id: string;
  item_code: string;
  barcode: string;
  uom: string;
  expected_qty: number | null;
  counted_qty: number;
  variance_qty: number | null;
  is_unexpected_item: number;
  reason_code: string | null;
  notes: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Sync cycle count sessions to backend
 * This function syncs unsynced cycle count sessions and their lines to the backend API
 */
export const syncCycleCountSessions = async (): Promise<{
  synced: number;
  failed: number;
  errors: string[];
}> => {
  const result = {
    synced: 0,
    failed: 0,
    errors: [] as string[],
  };

  try {
    const db = await getDatabase();
    const settings = await getSettings();

    // Check if we're in demo mode or API is not configured
    if (settings.demo_mode === 1 || !settings.api_url) {
      console.log("⏭️ Cycle Count Sync: Skipping (demo mode or no API URL)");
      return result;
    }

    // Get all unsynced draft sessions
    const unsyncedSessions = await db.getAllAsync<CycleCountSession>(
      `SELECT * FROM cycle_count_sessions 
       WHERE synced = 0 AND status IN ('Draft', 'Submitted')
       ORDER BY created_at ASC`
    );

    console.log(`🔄 Cycle Count Sync: Found ${unsyncedSessions.length} unsynced sessions`);

    if (unsyncedSessions.length === 0) {
      return result;
    }

    for (const session of unsyncedSessions) {
      try {
        console.log(`🔄 Syncing session ${session.session_id} for bin ${session.bin_code}`);

        // Get all lines for this session
        const lines = await db.getAllAsync<CycleCountLine>(
          "SELECT * FROM cycle_count_lines WHERE session_id = ?",
          [session.session_id]
        );

        console.log(`📊 Session ${session.session_id}: ${lines.length} count lines`);

        if (lines.length === 0) {
          console.log(`⏭️ Session ${session.session_id}: No lines to sync, skipping`);
          continue;
        }

        // Check if we have a server_session_id (from previous sync) or generate a title
        // The backend expects an existing task title, so we need to either:
        // 1. Use server_session_id if available
        // 2. Or try to find/create a task for this bin
        let title = session.server_session_id;
        
        if (!title) {
          // Try to find an existing task for this bin
          try {
            console.log(`🔍 Looking for existing backend task for bin ${session.bin_code}...`);
            const tasks = await apiService.getCycleCounts({ status: "Draft,In Progress,Review" });
            const taskArray = Array.isArray(tasks) ? tasks : (tasks?.data || []);
            console.log(`📋 Found ${taskArray.length} tasks from backend`);
            
            const existingTask = taskArray.find((t: any) => {
              const matchesBin = 
                t.bin_code === session.bin_code || 
                t.bin_id === session.bin_code ||
                (t.bin_location && t.bin_location === session.bin_code) ||
                (t.zone && t.zone === session.bin_code);
              
              if (matchesBin) {
                console.log(`✅ Found matching task: ${t.title} for bin ${session.bin_code}`);
              }
              return matchesBin;
            });
            
            if (existingTask) {
              title = existingTask.title;
              console.log(`✅ Using existing task ${title} for bin ${session.bin_code}`);
              // Save the server session ID for future syncs
              await db.runAsync(
                "UPDATE cycle_count_sessions SET server_session_id = ?, updated_at = ? WHERE session_id = ?",
                [title, new Date().toISOString(), session.session_id]
              );
            } else {
              // No existing task found - skip sync for now
              // The backend needs to create the task first
              console.warn(`⚠️ No backend task found for bin ${session.bin_code}. Task must be created on backend first.`);
              console.warn(`⚠️ Available tasks:`, taskArray.map((t: any) => ({ title: t.title, bin_code: t.bin_code, bin_id: t.bin_id })));
              result.errors.push(`Session ${session.session_id}: No backend task found for bin ${session.bin_code}`);
              continue;
            }
          } catch (error: any) {
            const errorMsg = error.message || error.toString() || "Unknown error";
            console.error(`❌ Failed to check for existing task:`, errorMsg);
            console.error(`❌ Error details:`, error);
            result.errors.push(`Session ${session.session_id}: ${errorMsg}`);
            continue;
          }
        } else {
          console.log(`✅ Using saved server_session_id: ${title} for session ${session.session_id}`);
        }

        // Prepare lines for API (only lines with counted_qty > 0 or expected items)
        // MUST include item_code (or barcode) for backend matching
        const linesToSync = lines
          .filter(line => line.counted_qty > 0 || (line.expected_qty !== null && line.expected_qty > 0))
          .map((line, index) => ({
            id: index + 1, // Sequential ID for backend (optional, for reference)
            item_code: line.item_code, // ✅ REQUIRED - Backend uses this for matching
            barcode: line.barcode || null, // Optional - Also accepted by backend
            actual_qty: line.counted_qty,
            counted_qty: line.counted_qty,
            bin_location: session.bin_code, // Help backend match by bin + item
            expected_qty: line.expected_qty || null, // Optional - For new lines
            discrepancy_reason: line.reason_code || line.notes || null,
            reason_code: line.reason_code || null, // Alternative field
            notes: line.notes || null, // Alternative field
          }));

        if (linesToSync.length === 0) {
          console.log(`⏭️ Session ${session.session_id}: No lines with counts to sync`);
          continue;
        }

        // Submit counts to backend
        const countedBy = session.started_by || settings.user_id || settings.user_code || "MOBILE-USER";
        
        console.log(`📤 Submitting ${linesToSync.length} lines to backend for task ${title}, session ${session.session_id}`);
        console.log(`📤 Request URL: POST /api/cycle-count/${title}/count`);
        console.log(`📤 Request body:`, JSON.stringify({
          counted_by: countedBy,
          lines: linesToSync,
        }, null, 2));
        
        try {
          const response = await apiService.submitCycleCountCounts(title, {
            counted_by: countedBy,
            lines: linesToSync,
          });
          
          console.log(`✅ Backend response:`, JSON.stringify(response, null, 2));

          // If session is submitted, also submit the task
          if (session.status === "Submitted") {
            console.log(`📤 Submitting cycle count task ${title}`);
            await apiService.submitCycleCount(title);
          }

          // Mark session as synced only after successful API call
          await db.runAsync(
            "UPDATE cycle_count_sessions SET synced = 1, updated_at = ? WHERE session_id = ?",
            [new Date().toISOString(), session.session_id]
          );

          console.log(`✅ Successfully synced session ${session.session_id} - ${linesToSync.length} lines updated in backend`);
          result.synced++;
        } catch (apiError: any) {
          const errorMsg = apiError.message || apiError.toString() || "Unknown error";
          console.error(`❌ API call failed for session ${session.session_id}:`, errorMsg);
          console.error(`❌ API error details:`, apiError);
          
          // Don't mark as synced if API call failed
          // Update timestamp to track last attempt
          await db.runAsync(
            "UPDATE cycle_count_sessions SET updated_at = ? WHERE session_id = ?",
            [new Date().toISOString(), session.session_id]
          );
          
          result.failed++;
          result.errors.push(`Session ${session.session_id}: ${errorMsg}`);
        }
      } catch (error: any) {
        const errorMsg = error.message || error.toString() || "Unknown error";
        console.error(`❌ Failed to sync session ${session.session_id}:`, errorMsg);
        console.error(`❌ Error details:`, error);
        result.failed++;
        result.errors.push(`Session ${session.session_id}: ${errorMsg}`);

        // Mark session with error (but don't mark as synced)
        try {
          await db.runAsync(
            "UPDATE cycle_count_sessions SET updated_at = ? WHERE session_id = ?",
            [new Date().toISOString(), session.session_id]
          );
        } catch (updateError) {
          console.error(`Failed to update session error timestamp:`, updateError);
        }
      }
    }

    console.log(`✅ Cycle Count Sync Complete: ${result.synced} synced, ${result.failed} failed`);
    return result;
  } catch (error: any) {
    console.error("❌ Cycle Count Sync Error:", error);
    result.errors.push(`Sync error: ${error.message || error.toString()}`);
    return result;
  }
};

/**
 * Sync a specific cycle count session
 * @param sessionId - The session ID to sync
 * @param itemCode - Optional: If provided, only sync this specific item (for real-time updates)
 */
export const syncCycleCountSession = async (sessionId: string, itemCode?: string): Promise<boolean> => {
  try {
    const db = await getDatabase();
    const session = await db.getFirstAsync<CycleCountSession>(
      "SELECT * FROM cycle_count_sessions WHERE session_id = ?",
      [sessionId]
    );

    if (!session) {
      console.error(`❌ Session ${sessionId} not found`);
      return false;
    }

    // Get lines for this session - if itemCode is provided, only get that specific item
    const lines = itemCode
      ? await db.getAllAsync<CycleCountLine>(
          "SELECT * FROM cycle_count_lines WHERE session_id = ? AND item_code = ?",
          [sessionId, itemCode]
        )
      : await db.getAllAsync<CycleCountLine>(
          "SELECT * FROM cycle_count_lines WHERE session_id = ?",
          [sessionId]
        );

    if (lines.length === 0) {
      if (itemCode) {
        console.log(`⏭️ Session ${sessionId}: No line found for item ${itemCode} to sync`);
      } else {
        console.log(`⏭️ Session ${sessionId}: No lines to sync`);
      }
      return true;
    }

    if (itemCode) {
      console.log(`🔄 Syncing only item ${itemCode} for session ${sessionId}`);
    }

    const settings = await getSettings();
    
    // Check if we're in demo mode or API is not configured
    if (settings.demo_mode === 1 || !settings.api_url) {
      console.log(`⏭️ Cycle Count Sync: Skipping (demo mode or no API URL)`);
      return false;
    }
    
    // Check if we have a server_session_id (from previous sync)
    let title = session.server_session_id;
    
    if (!title) {
      // Try to find an existing task for this bin
      try {
        console.log(`🔍 Looking for existing backend task for bin ${session.bin_code}...`);
        const tasks = await apiService.getCycleCounts({ status: "Draft,In Progress,Review" });
        const taskArray = Array.isArray(tasks) ? tasks : (tasks?.data || []);
        console.log(`📋 Found ${taskArray.length} tasks from backend`);
        
        const existingTask = taskArray.find((t: any) => {
          const matchesBin = 
            t.bin_code === session.bin_code || 
            t.bin_id === session.bin_code ||
            (t.bin_location && t.bin_location === session.bin_code) ||
            (t.zone && t.zone === session.bin_code);
          
          if (matchesBin) {
            console.log(`✅ Found matching task: ${t.title} for bin ${session.bin_code}`);
          }
          return matchesBin;
        });
        
        if (existingTask) {
          title = existingTask.title;
          console.log(`✅ Using existing task ${title} for bin ${session.bin_code}`);
          // Save the server session ID for future syncs
          await db.runAsync(
            "UPDATE cycle_count_sessions SET server_session_id = ?, updated_at = ? WHERE session_id = ?",
            [title, new Date().toISOString(), sessionId]
          );
        } else {
          console.warn(`⚠️ No backend task found for bin ${session.bin_code}. Task must be created on backend first.`);
          console.warn(`⚠️ Available tasks:`, taskArray.map((t: any) => ({ title: t.title, bin_code: t.bin_code, bin_id: t.bin_id })));
          return false;
        }
      } catch (error: any) {
        const errorMsg = error.message || error.toString() || "Unknown error";
        console.error(`❌ Failed to check for existing task:`, errorMsg);
        console.error(`❌ Error details:`, error);
        return false;
      }
    } else {
      console.log(`✅ Using saved server_session_id: ${title} for session ${sessionId}`);
    }

    const countedBy = session.started_by || settings.user_id || settings.user_code || "MOBILE-USER";

    // Prepare lines for API - MUST include item_code (or barcode) for backend matching
    // CRITICAL: NEVER send items with counted_qty = 0 to backend
    // Backend should only receive items that have actually been counted (counted_qty > 0)
    // This prevents overwriting scanned quantities with 0
    const linesToSync = lines
      .filter(line => {
        // Always filter out items with counted_qty = 0, regardless of sync type
        if (line.counted_qty <= 0) {
          if (itemCode) {
            console.log(`⏭️ Skipping item ${line.item_code} in real-time sync: counted_qty = ${line.counted_qty} (must be > 0)`);
          } else {
            console.log(`⏭️ Skipping item ${line.item_code} in full sync: counted_qty = ${line.counted_qty} (must be > 0)`);
          }
          return false;
        }
        // Only send items that have been scanned (counted_qty > 0)
        return true;
      })
      .map((line, index) => {
        // Double-check: Never send items with counted_qty = 0 (safety check)
        if (line.counted_qty <= 0) {
          console.error(`❌ CRITICAL: Attempted to sync item ${line.item_code} with counted_qty = ${line.counted_qty}. This should have been filtered out!`);
          return null;
        }
        return {
          id: index + 1, // Sequential ID for backend (optional, for reference)
          item_code: line.item_code, // ✅ REQUIRED - Backend uses this for matching
          barcode: line.barcode || null, // Optional - Also accepted by backend
          actual_qty: line.counted_qty,
          counted_qty: line.counted_qty,
          bin_location: session.bin_code, // Help backend match by bin + item
          expected_qty: line.expected_qty || null, // Optional - For new lines
          discrepancy_reason: line.reason_code || line.notes || null,
          reason_code: line.reason_code || null, // Alternative field
          notes: line.notes || null, // Alternative field
        };
      })
      .filter((line): line is NonNullable<typeof line> => line !== null); // Remove any null entries

    if (linesToSync.length > 0) {
      if (itemCode) {
        console.log(`📤 Submitting ${linesToSync.length} item(s) (${itemCode}) to backend for task ${title} (real-time sync)`);
        // Log each line being sent for debugging
        linesToSync.forEach((line, idx) => {
          console.log(`📤   Line ${idx + 1}: item_code=${line.item_code}, counted_qty=${line.counted_qty}, expected_qty=${line.expected_qty}`);
        });
      } else {
        console.log(`📤 Submitting ${linesToSync.length} lines to backend for task ${title}`);
      }
      console.log(`📤 Request URL: POST /api/cycle-count/${title}/count`);
      console.log(`📤 Request body:`, JSON.stringify({
        counted_by: countedBy,
        lines: linesToSync,
      }, null, 2));
      
      try {
        const response = await apiService.submitCycleCountCounts(title, {
          counted_by: countedBy,
          lines: linesToSync,
        });
        
        console.log(`✅ Backend response:`, JSON.stringify(response, null, 2));

        if (session.status === "Submitted") {
          console.log(`📤 Submitting cycle count task ${title}`);
          await apiService.submitCycleCount(title);
        }

        // Mark as synced only after successful API call
        await db.runAsync(
          "UPDATE cycle_count_sessions SET synced = 1, updated_at = ? WHERE session_id = ?",
          [new Date().toISOString(), sessionId]
        );

        if (itemCode) {
          console.log(`✅ Successfully synced item ${itemCode} for session ${sessionId} (real-time sync)`);
        } else {
          console.log(`✅ Successfully synced session ${sessionId} - ${linesToSync.length} lines updated in backend`);
        }
        return true;
      } catch (apiError: any) {
        const errorMsg = apiError.message || apiError.toString() || "Unknown error";
        console.error(`❌ API call failed for session ${sessionId}:`, errorMsg);
        console.error(`❌ API error details:`, apiError);
        
        // Don't mark as synced if API call failed
        // Update timestamp to track last attempt
        await db.runAsync(
          "UPDATE cycle_count_sessions SET updated_at = ? WHERE session_id = ?",
          [new Date().toISOString(), sessionId]
        );
        
        return false;
      }
    } else {
      if (itemCode) {
        console.log(`⏭️ No lines to sync for item ${itemCode} (filtered out - likely counted_qty = 0)`);
      } else {
        console.log(`⏭️ Session ${sessionId}: No lines with counts to sync`);
      }
      // Even if no lines, mark as synced if we have a title (task exists)
      if (title) {
        await db.runAsync(
          "UPDATE cycle_count_sessions SET synced = 1, updated_at = ? WHERE session_id = ?",
          [new Date().toISOString(), sessionId]
        );
      }
      return true;
    }
  } catch (error: any) {
    const errorMsg = error.message || error.toString() || "Unknown error";
    console.error(`❌ Failed to sync session ${sessionId}:`, errorMsg);
    console.error(`❌ Error details:`, error);
    console.error(`❌ Error stack:`, error.stack);
    return false;
  }
};

