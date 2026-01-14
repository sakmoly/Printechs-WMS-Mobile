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
  carton_id?: string | null; // ✅ NEW: Optional carton_id for carton-level inventory
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
        // ✅ DEBUG: Log expected_qty from database to verify it's stored correctly
        if (lines.length > 0) {
          console.log(`📊 Database expected_qty values:`, lines.map(l => ({
            item_code: l.item_code,
            expected_qty: l.expected_qty,
            counted_qty: l.counted_qty,
            carton_id: l.carton_id || 'null'
          })));
        }

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
            
            // Normalize bin codes for comparison (case-insensitive, trim whitespace, remove double dashes)
            const normalizeBinCode = (code: string | null | undefined): string => {
              if (!code) return "";
              return String(code).trim().toUpperCase().replace(/\s+/g, "").replace(/--+/g, "-");
            };
            
            const sessionBinNormalized = normalizeBinCode(session.bin_code);
            
            const existingTask = taskArray.find((t: any) => {
              // Try multiple matching strategies with normalized codes
              const taskBinCode = normalizeBinCode(t.bin_code);
              const taskBinId = normalizeBinCode(t.bin_id);
              const taskBinLocation = normalizeBinCode(t.bin_location);
              const taskZone = normalizeBinCode(t.zone);
              
              // Exact match (normalized) - try all possible fields
              const matchesBin = 
                (taskBinCode && taskBinCode === sessionBinNormalized) || 
                (taskBinId && taskBinId === sessionBinNormalized) ||
                (taskBinLocation && taskBinLocation === sessionBinNormalized) ||
                (taskZone && taskZone === sessionBinNormalized);
              
              if (matchesBin) {
                console.log(`✅ Found matching task: ${t.title} for bin ${session.bin_code}`);
                console.log(`   Task bin_code: ${t.bin_code}, bin_id: ${t.bin_id}, bin_location: ${t.bin_location}`);
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
              // No specific bin task found - try fallback to general task (bin_code/bin_id is null)
              const generalTask = taskArray.find((t: any) => {
                const hasNoBin = !t.bin_code && !t.bin_id && !t.bin_location;
                if (hasNoBin) {
                  console.log(`🔍 Found general task (no bin): ${t.title}`);
                }
                return hasNoBin;
              });
              
              if (generalTask) {
                title = generalTask.title;
                console.log(`⚠️ Using general task ${title} as fallback for bin ${session.bin_code} (no bin-specific task found)`);
                console.log(`⚠️ Note: This task has no bin_code/bin_id - ensure backend accepts counts for any bin`);
                // Save the server session ID for future syncs
                await db.runAsync(
                  "UPDATE cycle_count_sessions SET server_session_id = ?, updated_at = ? WHERE session_id = ?",
                  [title, new Date().toISOString(), session.session_id]
                );
              } else {
                // No existing task found - try to create one automatically for Ad-hoc counts
                console.log(`📝 No backend task found for bin ${session.bin_code}. Attempting to create task automatically...`);
                console.log(`📋 Session bin (normalized): "${sessionBinNormalized}"`);
                
                try {
                  // Generate a task title based on bin code and timestamp
                  const now = new Date();
                  const timestamp = now.getTime().toString().slice(-6); // Last 6 digits of timestamp
                  const generatedTitle = `CC-${sessionBinNormalized}-${timestamp}`;
                  
                  // Prepare task creation data from session
                  // ✅ NEW: Add opening_stock (independent of blind_count) - default to true for auto-created tasks
                  const taskData = {
                    title: generatedTitle,
                    bin_code: session.bin_code,
                    bin_id: session.bin_id || session.bin_code,
                    warehouse: session.warehouse_id || "DEFAULT-WH",
                    warehouse_id: session.warehouse_id || "DEFAULT-WH",
                    count_type: session.count_type || "Adhoc",
                    count_date: now.toISOString().split('T')[0], // YYYY-MM-DD format
                    is_blind_count: session.is_blind_count === 1,
                    opening_stock: true, // ✅ NEW: Independent of blind_count - auto-created tasks default to opening stock
                    is_opening_stock: true, // ✅ NEW: Send both field names for backend compatibility
                    created_by: session.started_by || "USER-AUTO",
                    lines: [], // Empty lines - will be populated when items are synced
                  };
                  
                  console.log(`📤 Creating backend task with data:`, JSON.stringify(taskData, null, 2));
                  
                  const createResponse = await apiService.createCycleCount(taskData);
                  console.log(`✅ Task creation response:`, createResponse);
                  
                  // Extract task title from response
                  const createdTaskTitle = createResponse?.title || createResponse?.data?.title || createResponse?.task_title || generatedTitle;
                  
                  if (createdTaskTitle) {
                    title = createdTaskTitle;
                    console.log(`✅ Successfully created backend task: ${title} for bin ${session.bin_code}`);
                    
                    // Save the server session ID for future syncs
                    await db.runAsync(
                      "UPDATE cycle_count_sessions SET server_session_id = ?, updated_at = ? WHERE session_id = ?",
                      [title, now.toISOString(), session.session_id]
                    );
                  } else {
                    throw new Error("Backend did not return task title after creation");
                  }
                } catch (createError: any) {
                  const createErrorMsg = createError.message || createError.toString() || "Unknown error";
                  console.error(`❌ Failed to create backend task automatically:`, createErrorMsg);
                  console.error(`❌ Error details:`, createError);
                  console.warn(`⚠️ Items will be saved locally but won't sync until a matching backend task is created manually.`);
                  result.errors.push(`Session ${session.session_id}: Failed to create backend task automatically - ${createErrorMsg}`);
                  continue;
                }
              }
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

        // ✅ FIX: Fetch task from backend first to get actual line IDs
        // Backend requires lineId to match existing lines in the task
        let backendTaskLines: Array<{ id?: number; line_id?: string; item_code?: string; itemCode?: string; barcode?: string }> = [];
        try {
          console.log(`🔍 Fetching task ${title} from backend to get line IDs...`);
          const taskResponse = await apiService.getCycleCount(title);
          const taskData = taskResponse?.data || taskResponse;
          backendTaskLines = taskData?.lines || taskData?.items || [];
          console.log(`✅ Found ${backendTaskLines.length} lines in backend task`);
          
          // ✅ DEBUG: Log backend lines for debugging
          if (backendTaskLines.length > 0) {
            console.log(`📋 Backend task lines (first 5):`, backendTaskLines.slice(0, 5).map((bl: any) => ({
              id: bl.id,
              line_id: bl.line_id,
              item_code: bl.item_code || bl.itemCode || bl.item,
              barcode: bl.barcode
            })));
          } else {
            console.log(`⚠️ Backend task has no lines - items will be matched by item_code only`);
          }
        } catch (fetchError: any) {
          console.warn(`⚠️ Failed to fetch task from backend:`, fetchError.message);
          console.warn(`⚠️ Will try to match by item_code only - lineId may be missing`);
        }

        // Prepare lines for API (only lines with counted_qty > 0 or expected items)
        // MUST include item_code (or barcode) for backend matching
        // ✅ FIX: Match local lines with backend lines by item_code to get correct lineId
        const linesToSync = lines
          .filter(line => line.counted_qty > 0 || (line.expected_qty !== null && line.expected_qty > 0))
          .map((line, index) => {
            // ✅ FIX: Find matching backend line by item_code to get the actual lineId
            // Use case-insensitive, trimmed comparison to handle variations
            let lineId: number | undefined = undefined;
            let lineIdString: string | undefined = undefined;
            
            // Normalize item codes for comparison (trim whitespace, uppercase)
            const normalizeItemCode = (code: string | undefined | null): string => {
              if (!code) return '';
              return String(code).trim().toUpperCase();
            };
            
            const localItemCode = normalizeItemCode(line.item_code);
            const localBarcode = normalizeItemCode(line.barcode);
            
            // Try to find matching backend line using multiple strategies
            const matchingBackendLine = backendTaskLines.find((bl: any) => {
              // Try different field name variations (item_code, itemCode, item)
              const backendItemCode = normalizeItemCode(bl.item_code || bl.itemCode || bl.item);
              const backendBarcode = normalizeItemCode(bl.barcode);
              
              // Exact match (case-insensitive, trimmed)
              const itemCodeMatch = localItemCode && backendItemCode && localItemCode === backendItemCode;
              const barcodeMatch = localBarcode && backendBarcode && localBarcode === backendBarcode;
              
              return itemCodeMatch || barcodeMatch;
            });
            
            if (matchingBackendLine) {
              // Use backend line ID - this is the actual database ID from backend
              // ✅ FIX: Backend line might have id (number) or line_id (string like "LINE-1") or both
              lineId = matchingBackendLine.id;
              lineIdString = matchingBackendLine.line_id;
              
              // If line_id is provided but id is not, try to extract numeric ID from line_id
              if (!lineId && lineIdString) {
                if (lineIdString.startsWith('LINE-')) {
                  const numericPart = parseInt(lineIdString.replace('LINE-', ''), 10);
                  if (!isNaN(numericPart) && numericPart > 0) {
                    lineId = numericPart;
                  }
                }
              }
              
              // If id is provided but line_id is not, generate line_id from id
              if (lineId && !lineIdString) {
                lineIdString = `LINE-${lineId}`;
              }
              
              // ✅ CRITICAL: If backend line exists but has no valid ID, we can't use it
              // Backend requires a valid numeric lineId for updates
              if (!lineId || typeof lineId !== 'number' || lineId <= 0) {
                console.warn(`⚠️ Backend line found for ${line.item_code} but has invalid id: ${matchingBackendLine.id}, will use item_code matching`);
                lineId = undefined; // Reset to undefined so we fall through to fallback logic
                lineIdString = undefined;
              } else {
                console.log(`✅ Matched item ${line.item_code} with backend line id=${lineId}, line_id=${lineIdString}`);
              }
            } else {
              // ✅ DEBUG: Log why no match was found
              if (backendTaskLines.length > 0) {
                const backendItemCodes = backendTaskLines
                  .map((bl: any) => normalizeItemCode(bl.item_code || bl.itemCode || bl.item))
                  .filter((code: string) => code);
                console.log(`🔍 No backend match found for "${line.item_code}"`);
                console.log(`🔍 Looking for: "${localItemCode}" (normalized)`);
                console.log(`🔍 Available backend item codes (first 10):`, backendItemCodes.slice(0, 10));
                
                // Check for partial matches (for debugging)
                const partialMatches = backendItemCodes.filter((code: string) => 
                  code.includes(localItemCode) || localItemCode.includes(code)
                );
                if (partialMatches.length > 0) {
                  console.log(`⚠️ Found partial matches:`, partialMatches);
                }
              } else {
                console.log(`⚠️ Backend task has no lines - item "${line.item_code}" will be created as new line`);
              }
              
              // Try to extract from local line_id if available (might have been saved from previous sync)
              if (line.line_id && typeof line.line_id === 'string' && line.line_id.startsWith('LINE-')) {
                const numericPart = parseInt(line.line_id.replace('LINE-', ''), 10);
                if (!isNaN(numericPart) && numericPart > 0) {
                  lineId = numericPart;
                  lineIdString = line.line_id;
                  console.log(`⚠️ Using saved line_id from database: ${lineIdString} for ${line.item_code} (no backend match found)`);
                }
              }
              
              // Last resort: use index + 1 (backend should match by item_code, but lineId is required for updates)
              if (!lineId || typeof lineId !== 'number' || lineId <= 0) {
                lineId = index + 1;
                lineIdString = `LINE-${lineId}`;
                console.warn(`⚠️ No backend line match found for ${line.item_code}, using generated lineId=${lineId} (backend should match by item_code)`);
                console.warn(`ℹ️  Note: Backend should create/update line by item_code="${line.item_code}" even without exact lineId match`);
              }
            }
            
            // ✅ CRITICAL: Ensure lineId is always a valid positive number (never undefined, null, or 0)
            // Backend requires lineId to be a positive number for database updates
            // Backend error "lineId is not defined" suggests backend code expects this to always exist
            const finalLineId = (lineId && typeof lineId === 'number' && lineId > 0) ? lineId : (index + 1);
            
            // ✅ CRITICAL: Build line object - ensure lineId is ALWAYS a valid positive number
            // Backend error "lineId is not defined" suggests backend code tries to access lineId directly
            // Never send undefined/null/0 for lineId - always use index + 1 as minimum
            const lineObject: Record<string, any> = {
              id: finalLineId, // Sequential ID for backend (optional, for reference)
              lineId: finalLineId, // ✅ FIX: Backend expects lineId (camelCase) - MUST be valid positive number (never undefined)
              item_code: line.item_code, // ✅ REQUIRED - Backend uses this for matching (primary identifier)
              actual_qty: line.counted_qty, // ✅ REQUIRED - Counted quantity
              counted_qty: line.counted_qty, // Also send counted_qty (backend accepts both)
            };
            
            // Add optional fields only if they have values
            if (lineIdString) {
              lineObject.line_id = lineIdString;
            }
            if (line.barcode) {
              lineObject.barcode = line.barcode;
            }
            if (line.carton_id) {
              lineObject.carton_id = line.carton_id;
            }
            if (session.bin_code) {
              lineObject.bin_location = session.bin_code;
            }
            // ✅ CRITICAL: ALWAYS send expected_qty to backend
            // Backend expects expected_qty to be set from mobile app
            // Always include expected_qty in the payload (even if 0 or null)
            if (line.expected_qty !== null && line.expected_qty !== undefined) {
              // expected_qty has a valid value (including 0) - send it
              lineObject.expected_qty = line.expected_qty;
              console.log(`✅ Sending expected_qty=${line.expected_qty} for item ${line.item_code}`);
            } else {
              // expected_qty is null or undefined - default to 0 for backend compatibility
              lineObject.expected_qty = 0;
              console.warn(`⚠️ WARNING: expected_qty is null/undefined for item ${line.item_code}, defaulting to 0`);
            }
            if (line.reason_code) {
              lineObject.reason_code = line.reason_code;
              lineObject.discrepancy_reason = line.reason_code;
            }
            if (line.notes) {
              lineObject.notes = line.notes;
              if (!lineObject.discrepancy_reason) {
                lineObject.discrepancy_reason = line.notes;
              }
            }
            
            // ✅ CRITICAL: Never send 'discrepancy' field - it's a GENERATED COLUMN in MySQL
            // Backend error: "The value specified for generated column 'discrepancy' is not allowed"
            // MySQL automatically calculates: discrepancy = actual_qty - expected_qty
            // Backend should NOT try to update this column - it's calculated automatically
            // Mobile app should NOT send this field (we're already not sending it, but ensuring we never do)
            
            return lineObject;
          });

        if (linesToSync.length === 0) {
          console.log(`⏭️ Session ${session.session_id}: No lines with counts to sync`);
          continue;
        }

        // Submit counts to backend
        const countedBy = session.started_by || settings.user_id || settings.user_code || "MOBILE-USER";
        
        // ✅ DEBUG: Log first line to verify lineId and expected_qty are included
        if (linesToSync.length > 0) {
          console.log(`📤 First line example:`, JSON.stringify(linesToSync[0], null, 2));
          console.log(`📤 First line expected_qty: ${linesToSync[0].expected_qty !== undefined ? linesToSync[0].expected_qty : 'UNDEFINED'}`);
        }
        
        // ✅ DEBUG: Log all lines to verify expected_qty is being sent
        console.log(`📤 Submitting ${linesToSync.length} lines to backend for task ${title}, session ${session.session_id}`);
        linesToSync.forEach((line: any, idx: number) => {
          console.log(`📤   Line ${idx + 1} (${line.item_code}): expected_qty=${line.expected_qty !== undefined ? line.expected_qty : 'UNDEFINED'}, actual_qty=${line.actual_qty !== undefined ? line.actual_qty : 'UNDEFINED'}, counted_qty=${line.counted_qty !== undefined ? line.counted_qty : 'UNDEFINED'}`);
        });
        
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
          // ✅ FIX: Don't auto-submit during sync - submission should only happen when user clicks "Submit Bin"
          // The backend task might still be in "Draft" status and cannot be submitted until it's ready
          // Submission will be handled by the "Submit Bin" button in the UI
          // if (session.status === "Submitted") {
          //   console.log(`📤 Submitting cycle count task ${title}`);
          //   await apiService.submitCycleCount(title);
          // }

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
        
        // Normalize bin codes for comparison (case-insensitive, trim whitespace, remove double dashes)
        const normalizeBinCode = (code: string | null | undefined): string => {
          if (!code) return "";
          return String(code).trim().toUpperCase().replace(/\s+/g, "").replace(/--+/g, "-");
        };
        
        const sessionBinNormalized = normalizeBinCode(session.bin_code);
        
        const existingTask = taskArray.find((t: any) => {
          // Try multiple matching strategies with normalized codes
          const taskBinCode = normalizeBinCode(t.bin_code);
          const taskBinId = normalizeBinCode(t.bin_id);
          const taskBinLocation = normalizeBinCode(t.bin_location);
          const taskZone = normalizeBinCode(t.zone);
          
          // Exact match (normalized) - try all possible fields
          const matchesBin = 
            (taskBinCode && taskBinCode === sessionBinNormalized) || 
            (taskBinId && taskBinId === sessionBinNormalized) ||
            (taskBinLocation && taskBinLocation === sessionBinNormalized) ||
            (taskZone && taskZone === sessionBinNormalized);
          
          if (matchesBin) {
            console.log(`✅ Found matching task: ${t.title} for bin ${session.bin_code}`);
            console.log(`   Task bin_code: ${t.bin_code}, bin_id: ${t.bin_id}, bin_location: ${t.bin_location}`);
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
          // No specific bin task found - try fallback to general task (bin_code/bin_id is null)
          const generalTask = taskArray.find((t: any) => {
            const hasNoBin = !t.bin_code && !t.bin_id && !t.bin_location;
            if (hasNoBin) {
              console.log(`🔍 Found general task (no bin): ${t.title}`);
            }
            return hasNoBin;
          });
          
          if (generalTask) {
            title = generalTask.title;
            console.log(`⚠️ Using general task ${title} as fallback for bin ${session.bin_code} (no bin-specific task found)`);
            console.log(`⚠️ Note: This task has no bin_code/bin_id - ensure backend accepts counts for any bin`);
            // Save the server session ID for future syncs
            await db.runAsync(
              "UPDATE cycle_count_sessions SET server_session_id = ?, updated_at = ? WHERE session_id = ?",
              [title, new Date().toISOString(), sessionId]
            );
          } else {
            // No existing task found - try to create one automatically for Ad-hoc counts
            console.log(`📝 No backend task found for bin ${session.bin_code}. Attempting to create task automatically...`);
            console.log(`📋 Session bin (normalized): "${sessionBinNormalized}"`);
            
            try {
              // Generate a task title based on bin code and timestamp
              const now = new Date();
              const timestamp = now.getTime().toString().slice(-6); // Last 6 digits of timestamp
              const generatedTitle = `CC-${sessionBinNormalized}-${timestamp}`;
              
              // Prepare task creation data from session
              // ✅ NEW: Add opening_stock (independent of blind_count) - default to true for auto-created tasks
              const taskData = {
                title: generatedTitle,
                bin_code: session.bin_code,
                bin_id: session.bin_id || session.bin_code,
                warehouse: session.warehouse_id || "DEFAULT-WH",
                warehouse_id: session.warehouse_id || "DEFAULT-WH",
                count_type: session.count_type || "Adhoc",
                count_date: now.toISOString().split('T')[0], // YYYY-MM-DD format
                is_blind_count: session.is_blind_count === 1,
                opening_stock: true, // ✅ NEW: Independent of blind_count - auto-created tasks default to opening stock
                is_opening_stock: true, // ✅ NEW: Send both field names for backend compatibility
                created_by: session.started_by || "USER-AUTO",
                lines: [], // Empty lines - will be populated when items are synced
              };
              
              console.log(`📤 Creating backend task with data:`, JSON.stringify(taskData, null, 2));
              
              const createResponse = await apiService.createCycleCount(taskData);
              console.log(`✅ Task creation response:`, createResponse);
              
              // Extract task title from response
              const createdTaskTitle = createResponse?.title || createResponse?.data?.title || createResponse?.task_title || generatedTitle;
              
              if (createdTaskTitle) {
                title = createdTaskTitle;
                console.log(`✅ Successfully created backend task: ${title} for bin ${session.bin_code}`);
                
                // Save the server session ID for future syncs
                await db.runAsync(
                  "UPDATE cycle_count_sessions SET server_session_id = ?, updated_at = ? WHERE session_id = ?",
                  [title, now.toISOString(), sessionId]
                );
              } else {
                throw new Error("Backend did not return task title after creation");
              }
            } catch (createError: any) {
              const createErrorMsg = createError.message || createError.toString() || "Unknown error";
              console.error(`❌ Failed to create backend task automatically:`, createErrorMsg);
              console.error(`❌ Error details:`, createError);
              console.warn(`⚠️ Items will be saved locally but won't sync until a matching backend task is created manually.`);
              return false;
            }
          }
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

    // ✅ FIX: Fetch task from backend first to get actual line IDs (fetch once, use for all lines)
    let backendTaskLines: Array<{ id?: number; line_id?: string; item_code?: string; itemCode?: string; barcode?: string }> = [];
    try {
      console.log(`🔍 Fetching task ${title} from backend to get line IDs for sync...`);
      const taskResponse = await apiService.getCycleCount(title);
      const taskData = taskResponse?.data || taskResponse;
      backendTaskLines = taskData?.lines || taskData?.items || [];
      console.log(`✅ Found ${backendTaskLines.length} lines in backend task for matching`);
      
      // ✅ DEBUG: Log backend lines for debugging
      if (backendTaskLines.length > 0) {
        console.log(`📋 Backend task lines (first 5):`, backendTaskLines.slice(0, 5).map((bl: any) => ({
          id: bl.id,
          line_id: bl.line_id,
          item_code: bl.item_code || bl.itemCode || bl.item,
          barcode: bl.barcode
        })));
      } else {
        console.log(`⚠️ Backend task has no lines - items will be matched by item_code only`);
      }
    } catch (fetchError: any) {
      console.warn(`⚠️ Failed to fetch task from backend for line ID matching:`, fetchError.message);
      console.warn(`⚠️ Will try to match by item_code only - lineId may be missing`);
    }

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
        
        // ✅ FIX: Match local line with backend line by item_code to get correct lineId
        // Use case-insensitive, trimmed comparison to handle variations
        let lineId: number | undefined = undefined;
        let lineIdString: string | undefined = undefined;
        
        // Normalize item codes for comparison (trim whitespace, uppercase)
        const normalizeItemCode = (code: string | undefined | null): string => {
          if (!code) return '';
          return String(code).trim().toUpperCase();
        };
        
        const localItemCode = normalizeItemCode(line.item_code);
        const localBarcode = normalizeItemCode(line.barcode);
        
        // Try to find matching backend line using multiple strategies
        const matchingBackendLine = backendTaskLines.find((bl: any) => {
          // Try different field name variations (item_code, itemCode, item)
          const backendItemCode = normalizeItemCode(bl.item_code || bl.itemCode || bl.item);
          const backendBarcode = normalizeItemCode(bl.barcode);
          
          // Exact match (case-insensitive, trimmed)
          const itemCodeMatch = localItemCode && backendItemCode && localItemCode === backendItemCode;
          const barcodeMatch = localBarcode && backendBarcode && localBarcode === backendBarcode;
          
          return itemCodeMatch || barcodeMatch;
        });
        
        if (matchingBackendLine) {
          // ✅ FIX: Backend line might have id (number) or line_id (string like "LINE-1") or both
          lineId = matchingBackendLine.id;
          lineIdString = matchingBackendLine.line_id;
          
          // If line_id is provided but id is not, try to extract numeric ID from line_id
          if (!lineId && lineIdString) {
            if (lineIdString.startsWith('LINE-')) {
              const numericPart = parseInt(lineIdString.replace('LINE-', ''), 10);
              if (!isNaN(numericPart) && numericPart > 0) {
                lineId = numericPart;
              }
            }
          }
          
          // If id is provided but line_id is not, generate line_id from id
          if (lineId && !lineIdString) {
            lineIdString = `LINE-${lineId}`;
          }
          
          // ✅ CRITICAL: If backend line exists but has no valid ID, we can't use it
          // Backend requires a valid numeric lineId for updates
          if (!lineId || typeof lineId !== 'number' || lineId <= 0) {
            console.warn(`⚠️ Backend line found for ${line.item_code} but has invalid id: ${matchingBackendLine.id}, will use item_code matching`);
            lineId = undefined; // Reset to undefined so we fall through to fallback logic
            lineIdString = undefined;
          } else {
            console.log(`✅ Matched item ${line.item_code} with backend line id=${lineId}, line_id=${lineIdString}`);
          }
        } else {
          // ✅ DEBUG: Log why no match was found
          if (backendTaskLines.length > 0) {
            const backendItemCodes = backendTaskLines
              .map((bl: any) => normalizeItemCode(bl.item_code || bl.itemCode || bl.item))
              .filter((code: string) => code);
            console.log(`🔍 No backend match found for "${line.item_code}"`);
            console.log(`🔍 Looking for: "${localItemCode}" (normalized)`);
            console.log(`🔍 Available backend item codes (first 10):`, backendItemCodes.slice(0, 10));
            
            // Check for partial matches (for debugging)
            const partialMatches = backendItemCodes.filter((code: string) => 
              code.includes(localItemCode) || localItemCode.includes(code)
            );
            if (partialMatches.length > 0) {
              console.log(`⚠️ Found partial matches:`, partialMatches);
            }
          } else {
            console.log(`⚠️ Backend task has no lines - item "${line.item_code}" will be created as new line`);
          }
          
          // Try to extract from local line_id if available (might have been saved from previous sync)
          if (line.line_id && typeof line.line_id === 'string' && line.line_id.startsWith('LINE-')) {
            const numericPart = parseInt(line.line_id.replace('LINE-', ''), 10);
            if (!isNaN(numericPart) && numericPart > 0) {
              lineId = numericPart;
              lineIdString = line.line_id;
              console.log(`⚠️ Using saved line_id from database: ${lineIdString} for ${line.item_code} (no backend match found)`);
            }
          }
          
          // Last resort: use index + 1 (backend should match by item_code, but lineId is required for updates)
          if (!lineId || typeof lineId !== 'number' || lineId <= 0) {
            lineId = index + 1;
            lineIdString = `LINE-${lineId}`;
            console.warn(`⚠️ No backend line match found for ${line.item_code}, using generated lineId=${lineId} (backend should match by item_code)`);
            console.warn(`ℹ️  Note: Backend should create/update line by item_code="${line.item_code}" even without exact lineId match`);
          }
        }
        
        // ✅ CRITICAL: Ensure lineId is always a valid positive number (never undefined, null, or 0)
        // Backend requires lineId to be a positive number for database updates
        // Backend error "lineId is not defined" suggests backend code expects this to always exist as a valid number
        const finalLineId = (lineId && typeof lineId === 'number' && lineId > 0) ? lineId : (index + 1);
        
        // ✅ CRITICAL: Build line object - ensure lineId is ALWAYS a valid positive number
        // Never send undefined/null/0 for lineId - always use index + 1 as minimum
        const lineObject: Record<string, any> = {
          id: finalLineId, // Sequential ID for backend (optional, for reference)
          lineId: finalLineId, // ✅ FIX: Backend expects lineId (camelCase) - MUST be valid positive number (never undefined)
          item_code: line.item_code, // ✅ REQUIRED - Backend uses this for matching (primary identifier)
          actual_qty: line.counted_qty, // ✅ REQUIRED - Counted quantity
          counted_qty: line.counted_qty, // Also send counted_qty (backend accepts both)
        };
        
        // Add optional fields only if they have values
        if (lineIdString) {
          lineObject.line_id = lineIdString;
        }
        if (line.barcode) {
          lineObject.barcode = line.barcode;
        }
        if (line.carton_id) {
          lineObject.carton_id = line.carton_id;
        }
        if (session.bin_code) {
          lineObject.bin_location = session.bin_code;
        }
        // ✅ CRITICAL: ALWAYS send expected_qty to backend
        // Backend expects expected_qty to be set from mobile app
        if (line.expected_qty !== null && line.expected_qty !== undefined) {
          // expected_qty has a valid value (including 0) - send it
          lineObject.expected_qty = line.expected_qty;
          console.log(`✅ Sending expected_qty=${line.expected_qty} for item ${line.item_code}`);
        } else {
          // expected_qty is null or undefined - default to 0 for backend compatibility
          lineObject.expected_qty = 0;
          console.warn(`⚠️ WARNING: expected_qty is null/undefined for item ${line.item_code}, defaulting to 0`);
        }
        if (line.reason_code) {
          lineObject.reason_code = line.reason_code;
          lineObject.discrepancy_reason = line.reason_code;
        }
        if (line.notes) {
          lineObject.notes = line.notes;
          if (!lineObject.discrepancy_reason) {
            lineObject.discrepancy_reason = line.notes;
          }
        }
        
        // ✅ CRITICAL: Never send 'discrepancy' field - it's a GENERATED COLUMN in MySQL
        // Backend error: "The value specified for generated column 'discrepancy' is not allowed"
        // MySQL automatically calculates: discrepancy = actual_qty - expected_qty
        // Backend should NOT try to update this column - it's calculated automatically
        // Mobile app should NOT send this field (we're already not sending it, ensuring we never do)
        
        return lineObject;
      })
      .filter((line): line is NonNullable<typeof line> => line !== null); // Remove any null entries

    if (linesToSync.length > 0) {
      if (itemCode) {
        console.log(`📤 Submitting ${linesToSync.length} item(s) (${itemCode}) to backend for task ${title} (real-time sync)`);
        // Log each line being sent for debugging
        linesToSync.forEach((line, idx) => {
          console.log(`📤   Line ${idx + 1}: item_code=${line.item_code}, counted_qty=${line.counted_qty}, expected_qty=${line.expected_qty}, carton_id=${line.carton_id || 'null'}, bin_location=${line.bin_location || 'null'}`);
        });
        console.log(`📤 Full request body:`, JSON.stringify({
          counted_by: countedBy,
          lines: linesToSync,
        }, null, 2));
      } else {
        console.log(`📤 Submitting ${linesToSync.length} lines to backend for task ${title}`);
      }
      console.log(`📤 Request URL: POST /api/cycle-count/${title}/count`);
      console.log(`📤 Request body:`, JSON.stringify({
        counted_by: countedBy,
        lines: linesToSync,
      }, null, 2));
      
      try {
        console.log(`🔄 Calling apiService.submitCycleCountCounts for task ${title}...`);
        const response = await apiService.submitCycleCountCounts(title, {
          counted_by: countedBy,
          lines: linesToSync,
        });
        
        console.log(`✅ Backend response received:`, JSON.stringify(response, null, 2));
        console.log(`✅ Successfully synced ${linesToSync.length} line(s) to backend for task ${title}`);

        // ✅ FIX: Don't auto-submit during sync - submission should only happen when user clicks "Submit Bin"
        // The backend task might still be in "Draft" status and cannot be submitted until it's ready
        // Submission will be handled by the "Submit Bin" button in the UI
        // if (session.status === "Submitted") {
        //   console.log(`📤 Submitting cycle count task ${title}`);
        //   await apiService.submitCycleCount(title);
        // }

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

