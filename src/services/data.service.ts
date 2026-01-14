import { getDatabase } from "../database/database";
import {
  ASNItem,
  TransferOrderAllocation,
  Box,
  TransferCarton,
  CartonStatus,
  RemainingItem,
  PutAwayItem,
  WarehouseRack,
} from "../types";
import { normalizeASN } from "../utils/asn";

// Mutex to prevent concurrent database operations
let dbOperationQueue: Array<{
  operation: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}> = [];
let isProcessingDbOperation = false;

// Process database operation queue
const processDbOperationQueue = async () => {
  if (isProcessingDbOperation || dbOperationQueue.length === 0) {
    return;
  }

  isProcessingDbOperation = true;
  const { operation, resolve, reject } = dbOperationQueue.shift()!;

  try {
    const result = await operation();
    resolve(result);
  } catch (error) {
    reject(error);
  } finally {
    isProcessingDbOperation = false;
    // Process next item in queue
    if (dbOperationQueue.length > 0) {
      setTimeout(() => processDbOperationQueue(), 0);
    }
  }
};

// Helper function to queue database operations (for heavy operations like clearAllData)
const queueDbOperation = async <T>(operation: () => Promise<T>): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    dbOperationQueue.push({ operation, resolve, reject });
    processDbOperationQueue();
  });
};

// Helper function to retry database operations
const withRetry = async <T>(
  operation: () => Promise<T>,
  retries = 3,
  baseDelay = 50
): Promise<T> => {
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (error: any) {
      const isLockedError = 
        error?.message?.includes("database is locked") ||
        error?.message?.includes("locked") ||
        error?.code === "SQLITE_BUSY" ||
        error?.code === "SQLITE_LOCKED";
      
      const isNullPointerError =
        error?.message?.includes("NullPointerException") ||
        error?.message?.includes("prepareAsync");
      
      if ((isLockedError || isNullPointerError) && i < retries - 1) {
        // Calculate exponential backoff delay
        const delay = baseDelay * Math.pow(2, i);
        console.warn(
          `⚠️ Database error (${isLockedError ? "locked" : "null pointer"}) (attempt ${i + 1}/${retries}), retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        
        // Re-initialize database connection for null pointer errors
        if (isNullPointerError) {
          const db = await getDatabase();
          if (!db) {
            throw new Error("Database connection is null");
          }
        }
        // Continue to retry
      } else {
        // Not a retryable error, or max retries reached
        throw error;
      }
    }
  }
  throw new Error("Operation failed after retries");
};

export const dataService = {
  // ASN Operations
  getAllASNs: async (): Promise<
    Array<{
      asn_no: string;
      status?: string;
      purchase_order?: string;
      supplier?: string;
      shipment_date?: string;
      expected_arrival_date?: string;
      total_shipped_qty?: number;
      total_carton_count?: number;
      airway_bill_no?: string;
      shipment_type?: string;
      transfer_order?: string;
      dock?: string;
      updated_on: string;
      total_cartons?: number;
      total_pieces?: number;
    }>
  > => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");

      // Get all ASNs with all fields, excluding demo ASNs
      // Demo ASNs like ASN-00045 should not appear in the list
      const asns = await db.getAllAsync<{
        asn_no: string;
        asn_no_original: string | null;
        status: string | null;
        purchase_order: string | null;
        supplier: string | null;
        shipment_date: string | null;
        expected_arrival_date: string | null;
        total_shipped_qty: number | null;
        total_carton_count: number | null;
        airway_bill_no: string | null;
        shipment_type: string | null;
        payload_json: string | null;
        updated_on: string;
      }>(
        `SELECT 
          asn_no, asn_no_original, status, purchase_order, supplier, shipment_date, 
          expected_arrival_date, total_shipped_qty, total_carton_count, 
          airway_bill_no, shipment_type, payload_json, updated_on 
        FROM asn_cache 
        WHERE asn_no NOT IN ('ASN-00045') 
        ORDER BY updated_on DESC`
      );

      console.log(`📋 getAllASNs: Found ${asns.length} ASNs in database`);
      if (asns.length > 0) {
        console.log(`📋 Sample ASN from DB:`, {
          asn_no: asns[0].asn_no,
          asn_no_original: asns[0].asn_no_original,
          total_carton_count: asns[0].total_carton_count,
          total_shipped_qty: asns[0].total_shipped_qty,
          has_payload_json: !!asns[0].payload_json,
          payload_json_preview: asns[0].payload_json?.substring(0, 200),
        });
      }

      // Deduplicate ASNs: Use original format as key (no normalization)
      // ASNs are stored in their original format from backend (3, 4, 5, 10 digits, etc.)
      const asnMap = new Map<string, (typeof asns)[0]>();
      for (const asn of asns) {
        // Use original format from asn_no_original if available, otherwise use asn_no
        const asnKey = asn.asn_no_original || asn.asn_no;
        const existing = asnMap.get(asnKey);
        if (
          !existing ||
          new Date(asn.updated_on) > new Date(existing.updated_on)
        ) {
          asnMap.set(asnKey, asn);
        }
      }
      const uniqueASNs = Array.from(asnMap.values());
      console.log(
        `📋 Deduplicated ASNs: ${asns.length} → ${uniqueASNs.length} (removed ${
          asns.length - uniqueASNs.length
        } duplicates)`
      );

      // Parse payload_json and enrich with carton/piece counts
      const enrichedASNs = await Promise.all(
        uniqueASNs.map(async (asn) => {
          let transfer_order: string | undefined;
          let dock: string | undefined;

          // Parse payload_json to extract transfer_order and dock
          if (asn.payload_json) {
            try {
              const payload = JSON.parse(asn.payload_json);
              transfer_order = payload.transfer_order || payload.to_no;
              dock = payload.dock;
            } catch (error) {
              console.warn(
                `Failed to parse payload_json for ASN ${asn.asn_no}:`,
                error
              );
            }
          }

          // If transfer_order not found in payload_json, check inbound_sessions table
          if (!transfer_order) {
            try {
              const normalizedASN = normalizeASN(asn.asn_no);
              const session = await db.getFirstAsync<{
                transfer_order: string | null;
                dock: string | null;
              }>(
                "SELECT transfer_order, dock FROM inbound_sessions WHERE asn_no = ? AND transfer_order IS NOT NULL AND transfer_order != '' ORDER BY started_on DESC LIMIT 1",
                [normalizedASN]
              );
              if (session?.transfer_order) {
                transfer_order = session.transfer_order;
                console.log(
                  `📋 Found transfer_order from inbound_sessions for ASN ${asn.asn_no}: ${transfer_order}`
                );
              }
              if (!dock && session?.dock) {
                dock = session.dock;
              }
            } catch (error) {
              console.warn(
                `Failed to get transfer_order from inbound_sessions for ASN ${asn.asn_no}:`,
                error
              );
            }
          }

          // If still not found, check transfer_order_cache table
          if (!transfer_order) {
            try {
              const normalizedASN = normalizeASN(asn.asn_no);
              const toCache = await db.getFirstAsync<{
                to_no: string | null;
              }>(
                "SELECT DISTINCT to_no FROM transfer_order_cache WHERE asn_no = ? AND to_no IS NOT NULL AND to_no != '' LIMIT 1",
                [normalizedASN]
              );
              if (toCache?.to_no) {
                transfer_order = toCache.to_no;
                console.log(
                  `📋 Found transfer_order from transfer_order_cache for ASN ${asn.asn_no}: ${transfer_order}`
                );
              }
            } catch (error) {
              console.warn(
                `Failed to get transfer_order from transfer_order_cache for ASN ${asn.asn_no}:`,
                error
              );
            }
          }

          // Get total cartons and total pieces for this ASN
          // ASN is stored in original format from backend (no normalization)
          const asnKey = asn.asn_no; // Original format from backend

          // Priority 1: Use values from asn_cache table (synced from API)
          // Priority 2: Calculate from asn_carton_map if available
          // Priority 3: Use 0 as fallback

          let totalCartons = 0;
          let totalPieces = 0;

          // First, try to use values from the table (synced from API)
          if (
            asn.total_carton_count !== null &&
            asn.total_carton_count !== undefined &&
            asn.total_carton_count > 0
          ) {
            totalCartons = Number(asn.total_carton_count);
            console.log(
              `📦 ASN ${asnKey}: Using total_carton_count from table: ${totalCartons}`
            );
          } else {
            // Fallback: Count distinct cartons from asn_carton_map
            const cartonCount = await db.getFirstAsync<{ count: number }>(
              "SELECT COUNT(DISTINCT carton_id) as count FROM asn_carton_map WHERE asn_no = ?",
              [asnKey]
            );
            totalCartons = cartonCount?.count || 0;
            console.log(
              `📦 ASN ${asnKey}: Calculated cartons from asn_carton_map: ${totalCartons}`
            );
          }

          // Always prefer total_shipped_qty from asn_cache (synced from backend)
          // This is the authoritative source from the backend
          // Use it even if it's 0 (backend might have 0 as a valid value)
          if (
            asn.total_shipped_qty !== null &&
            asn.total_shipped_qty !== undefined
          ) {
            totalPieces = Number(asn.total_shipped_qty);
            console.warn(
              `📦 ASN ${asnKey}: Using total_shipped_qty from asn_cache: ${totalPieces}`
            );
          } else {
            // Fallback: Sum total pieces from asn_carton_map
            // Try original ASN format first
            let piecesResult = await db.getFirstAsync<{ total: number }>(
              "SELECT SUM(shipped_qty) as total FROM asn_carton_map WHERE asn_no = ?",
              [asnKey]
            );
            
            // If no results and ASN might be normalized, try normalized format
            if ((!piecesResult || piecesResult.total === null || piecesResult.total === undefined) && asnKey !== normalizeASN(asnKey)) {
              const normalizedASN = normalizeASN(asnKey);
              piecesResult = await db.getFirstAsync<{ total: number }>(
                "SELECT SUM(shipped_qty) as total FROM asn_carton_map WHERE asn_no = ?",
                [normalizedASN]
              );
            }
            
            totalPieces = piecesResult?.total || 0;
            console.warn(
              `⚠️ ASN ${asnKey}: total_shipped_qty missing in cache, calculated from asn_carton_map: ${totalPieces}. Please sync master data to get correct value from backend.`
            );
          }

          // Use original format from backend - both asn_no and asn_no_original are the same (original format)
          const displayASN = asn.asn_no_original || asn.asn_no;

          return {
            asn_no: displayASN, // Return original format from backend (preserved exactly)
            asn_no_db: asn.asn_no, // Keep DB key for React key uniqueness
            status: asn.status || undefined,
            purchase_order: asn.purchase_order || undefined,
            supplier: asn.supplier || undefined,
            shipment_date: asn.shipment_date || undefined,
            expected_arrival_date: asn.expected_arrival_date || undefined,
            total_shipped_qty: asn.total_shipped_qty || undefined,
            total_carton_count: asn.total_carton_count || undefined,
            airway_bill_no: asn.airway_bill_no || undefined,
            shipment_type: asn.shipment_type || undefined,
            transfer_order,
            dock,
            updated_on: asn.updated_on,
            total_cartons: totalCartons,
            total_pieces: totalPieces,
          };
        })
      );

      return enrichedASNs;
    });
  },

  getASN: async (asn_no: string) => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      
      // Try original format first (new data stored in original format)
      let result = await db.getFirstAsync<{
        asn_no: string;
        asn_no_original: string | null;
        payload_json: string;
        updated_on: string;
      }>("SELECT * FROM asn_cache WHERE asn_no = ?", [asn_no]);
      
      // If not found, try normalized format (backward compatibility with old data)
      if (!result) {
        const normalizedASN = normalizeASN(asn_no);
        if (normalizedASN !== asn_no) {
          result = await db.getFirstAsync<{
            asn_no: string;
            asn_no_original: string | null;
            payload_json: string;
            updated_on: string;
          }>("SELECT * FROM asn_cache WHERE asn_no = ?", [normalizedASN]);
        }
      }
      
      return result || null;
    });
  },

  // Get the original ASN format from backend (for display)
  getOriginalASNFormat: async (asn_no: string): Promise<string> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      
      // Normalize the input ASN to search for it
      const normalizedASN = normalizeASN(asn_no);
      
      // Try multiple search strategies:
      // 1. Search by exact match (original format)
      let asnRecord = await db.getFirstAsync<{
        asn_no: string;
        asn_no_original: string | null;
      }>("SELECT asn_no, asn_no_original FROM asn_cache WHERE asn_no = ? OR asn_no_original = ?", [asn_no, asn_no]);
      
      // 2. If not found, try normalized format
      if (!asnRecord && normalizedASN !== asn_no) {
        asnRecord = await db.getFirstAsync<{
          asn_no: string;
          asn_no_original: string | null;
        }>("SELECT asn_no, asn_no_original FROM asn_cache WHERE asn_no = ? OR asn_no_original = ?", [normalizedASN, normalizedASN]);
      }
      
      // 3. If still not found, try searching by normalized format in asn_no_original
      if (!asnRecord) {
        // Get all ASNs and find one that normalizes to the same value
        const allASNs = await db.getAllAsync<{
          asn_no: string;
          asn_no_original: string | null;
        }>("SELECT asn_no, asn_no_original FROM asn_cache");
        
        for (const record of allASNs) {
          const recordNormalized = normalizeASN(record.asn_no);
          const originalNormalized = record.asn_no_original ? normalizeASN(record.asn_no_original) : null;
          
          if (recordNormalized === normalizedASN || originalNormalized === normalizedASN) {
            asnRecord = record;
            break;
          }
        }
      }
      
      // Return original format if available, otherwise return normalized format (4 digits)
      // This ensures we always return a properly formatted ASN
      if (asnRecord) {
        const original = asnRecord.asn_no_original || asnRecord.asn_no;
        // If we found a record, use its format (prefer asn_no_original)
        return original;
      }
      
      // If no record found, return normalized format (4 digits) instead of the potentially incorrect input
      console.log(`⚠️ ASN ${asn_no} not found in database, returning normalized format: ${normalizedASN}`);
      return normalizedASN;
    });
  },

  getASNCartonsWithPieces: async (
    asn_no: string
  ): Promise<Array<{ carton_id: string; total_pieces: number }>> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      const normalizedASN = normalizeASN(asn_no);

      // Get cartons with total pieces (sum of shipped_qty)
      return await db.getAllAsync<{ carton_id: string; total_pieces: number }>(
        `SELECT 
          carton_id, 
          SUM(shipped_qty) as total_pieces 
        FROM asn_carton_map 
        WHERE asn_no = ? 
        GROUP BY carton_id 
        ORDER BY carton_id`,
        [normalizedASN]
      );
    });
  },

  // Get boxes for a Transfer Carton
  getBoxesForTC: async (
    tc_id: string
  ): Promise<Array<{ box_id: string; store: string }>> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");

      // Get boxes from PACK_BOX_TO_TC events
      return await db.getAllAsync<{ box_id: string; store: string }>(
        `SELECT DISTINCT box_id, store 
        FROM event_queue 
        WHERE event_type = 'PACK_BOX_TO_TC' AND tc_id = ? 
        ORDER BY box_id`,
        [tc_id]
      );
    });
  },

  // Get TC summary: number of CTNs, total pieces, and sync status
  getTCSummary: async (
    tc_id: string
  ): Promise<{
    ctn_count: number;
    total_pieces: number;
    synced: boolean;
  }> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");

      // Get boxes in this TC
      const boxes = await db.getAllAsync<{ box_id: string }>(
        `SELECT DISTINCT box_id 
        FROM event_queue 
        WHERE event_type = 'PACK_BOX_TO_TC' AND tc_id = ?`,
        [tc_id]
      );

      const ctn_count = boxes.length;
      let total_pieces = 0;

      // Calculate total pieces from scanned_items for these boxes
      if (boxes.length > 0) {
        const boxIds = boxes.map((b) => b.box_id);
        const placeholders = boxIds.map(() => "?").join(",");

        const piecesResult = await db.getAllAsync<{ total_pieces: number }>(
          `SELECT SUM(scanned_qty) as total_pieces 
          FROM scanned_items 
          WHERE box_id IN (${placeholders})`,
          boxIds
        );

        total_pieces = piecesResult[0]?.total_pieces || 0;
      }

      // Check sync status - if all PACK_BOX_TO_TC and TC_DISPATCH events are synced
      // First, check what events exist for this TC
      const allEvents = await db.getAllAsync<{ event_type: string; synced: number; offline_uuid: string }>(
        `SELECT event_type, synced, offline_uuid 
         FROM event_queue 
         WHERE (event_type = 'PACK_BOX_TO_TC' OR event_type = 'TC_DISPATCH') AND tc_id = ?`,
        [tc_id]
      );

      const syncResult = await db.getFirstAsync<{ 
        total: number; 
        synced_count: number; 
        all_synced: number 
      }>(
        `SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN synced = 1 THEN 1 ELSE 0 END) as synced_count,
          CASE 
            WHEN COUNT(*) = 0 THEN 1
            WHEN SUM(synced) = COUNT(*) THEN 1
            ELSE 0
          END as all_synced
        FROM event_queue 
        WHERE (event_type = 'PACK_BOX_TO_TC' OR event_type = 'TC_DISPATCH') AND tc_id = ?`,
        [tc_id]
      );

      const synced = (syncResult?.all_synced || 0) === 1;
      
      // Debug logging (use warn so it shows up)
      if (allEvents.length > 0 && !synced) {
        console.warn(`⚠️ TC ${tc_id} sync status: ${syncResult?.synced_count || 0}/${syncResult?.total || 0} events synced`);
        const unsyncedEvents = allEvents.filter(e => e.synced === 0);
        if (unsyncedEvents.length > 0) {
          console.warn(`   Unsynced events: ${unsyncedEvents.length}`, unsyncedEvents.map(e => ({ type: e.event_type, uuid: e.offline_uuid.substring(0, 8) + '...' })));
        }
      }

      return {
        ctn_count,
        total_pieces: Math.round(total_pieces),
        synced,
      };
    });
  },

  getCartonItems: async (
    asn_no: string,
    carton_id: string
  ): Promise<ASNItem[]> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      const normalizedASN = normalizeASN(asn_no);
      const normalizedCartonId = carton_id.trim().toUpperCase();
      
      // First, verify all cartons for this ASN in the database
      // Try original format FIRST (cartons are stored with original format from desktop)
      let allCartons = await db.getAllAsync<{
        carton_id: string;
        item_code: string;
        shipped_qty: number;
      }>(
        "SELECT carton_id, item_code, shipped_qty FROM asn_carton_map WHERE asn_no = ? ORDER BY carton_id, item_code",
        [asn_no]
      );
      
      // If no results and ASN was normalized, try with normalized format for backward compatibility
      if (allCartons.length === 0 && asn_no !== normalizedASN) {
        allCartons = await db.getAllAsync<{
          carton_id: string;
          item_code: string;
          shipped_qty: number;
        }>(
          "SELECT carton_id, item_code, shipped_qty FROM asn_carton_map WHERE asn_no = ? ORDER BY carton_id, item_code",
          [normalizedASN]
        );
      }
      
      console.log(
        `📊 getCartonItems: Total carton mappings in DB for ASN ${asn_no}: ${allCartons.length}`
      );
      
      // Group by carton for display
      const cartonGroups: Record<
        string,
        Array<{ item_code: string; shipped_qty: number }>
      > = {};
      allCartons.forEach((c) => {
        if (!cartonGroups[c.carton_id]) {
          cartonGroups[c.carton_id] = [];
        }
        cartonGroups[c.carton_id].push({
          item_code: c.item_code,
          shipped_qty: c.shipped_qty,
        });
      });
      
      // Log all cartons
      Object.keys(cartonGroups)
        .sort()
        .forEach((cid) => {
          const items = cartonGroups[cid]
            .map((i) => `${i.item_code} (${i.shipped_qty})`)
            .join(", ");
        console.log(`  📦 ${cid}: ${items}`);
      });
      
      // Try with original format FIRST
      let items = await db.getAllAsync<ASNItem>(
        "SELECT * FROM asn_carton_map WHERE asn_no = ? AND carton_id = ?",
        [asn_no, normalizedCartonId]
      );
      
      // If no results and ASN was normalized, try with normalized format for backward compatibility
      if (items.length === 0 && asn_no !== normalizedASN) {
        items = await db.getAllAsync<ASNItem>(
          "SELECT * FROM asn_carton_map WHERE asn_no = ? AND carton_id = ?",
          [normalizedASN, normalizedCartonId]
        );
      }
      
      // Enhance items with barcode information from item_master for better matching
      // This allows matching by barcode even if carton items only have item_code
      if (items.length > 0) {
        const itemCodes = items.map(i => i.item_code).filter(Boolean);
        if (itemCodes.length > 0) {
          const placeholders = itemCodes.map(() => "?").join(",");
          const barcodeMap = await db.getAllAsync<{ item_code: string; barcode: string }>(
            `SELECT item_code, barcode FROM item_master WHERE item_code IN (${placeholders})`,
            itemCodes
          );
          
          // Create a map for quick lookup
          const barcodeLookup = new Map(barcodeMap.map(b => [b.item_code, b.barcode]));
          
          // Add barcode to items
          items = items.map(item => ({
            ...item,
            barcode: barcodeLookup.get(item.item_code) || undefined
          }));
        }
      }
      
      console.log(
        `✅ getCartonItems: Found ${items.length} items for ${normalizedCartonId} in ASN ${asn_no}:`,
        items.map((i) => `${i.item_code}${i.barcode ? ` (barcode: ${i.barcode})` : ""} (${i.shipped_qty})`).join(", ")
      );
      
      if (items.length === 0) {
        console.error(
          `❌ getCartonItems: No items found for carton ${normalizedCartonId} in ASN ${asn_no}!`
        );
        console.error(
          `   Available cartons in DB: ${Object.keys(cartonGroups).join(", ")}`
        );
        console.error(
          `   Tried ASN formats: ${asn_no}${asn_no !== normalizedASN ? `, ${normalizedASN}` : ""}`
        );
      }
      
      return items;
    });
  },

  // Check if carton belongs to ASN (with ASN normalization)
  isCartonInASN: async (
    asn_no: string,
    carton_id: string
  ): Promise<boolean> => {
    const db = await getDatabase();
    const normalizedASN = normalizeASN(asn_no);
    
    // Check with original format FIRST (cartons are stored with original format from desktop)
    let result = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM asn_carton_map WHERE UPPER(TRIM(asn_no)) = UPPER(TRIM(?)) AND UPPER(TRIM(carton_id)) = UPPER(TRIM(?))",
      [asn_no, carton_id]
    );
    
    if ((result?.count || 0) > 0) {
      return true;
    }
    
    // If not found and ASN was normalized, try with normalized format for backward compatibility
    if (asn_no !== normalizedASN) {
      result = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM asn_carton_map WHERE UPPER(TRIM(asn_no)) = UPPER(TRIM(?)) AND UPPER(TRIM(carton_id)) = UPPER(TRIM(?))",
        [normalizedASN, carton_id]
      );
      
      if ((result?.count || 0) > 0) {
        return true;
      }
    }
    
    // Also check with original ASN format (in case data wasn't normalized)
    if (asn_no !== normalizedASN) {
      result = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM asn_carton_map WHERE UPPER(TRIM(asn_no)) = UPPER(TRIM(?)) AND UPPER(TRIM(carton_id)) = UPPER(TRIM(?))",
        [asn_no, carton_id]
      );
      
      if ((result?.count || 0) > 0) {
        return true;
      }
    }
    
    // Try to find any carton with this ID and check all possible ASN formats
    const allCartons = await db.getAllAsync<{ asn_no: string }>(
      "SELECT DISTINCT asn_no FROM asn_carton_map WHERE UPPER(TRIM(carton_id)) = UPPER(TRIM(?))",
      [carton_id]
    );
    
    // Check if any of the found ASNs match (normalized)
    for (const row of allCartons) {
      if (normalizeASN(row.asn_no) === normalizedASN) {
        return true;
      }
    }
    
    return false;
  },

  // Get all cartons for an ASN
  getASNCartons: async (asn_no: string): Promise<string[]> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      const normalizedASN = normalizeASN(asn_no);
      
      // Try with original format FIRST (cartons are stored with original format from desktop/backend)
      // Use case-insensitive matching to handle format variations
      let result = await db.getAllAsync<{ carton_id: string }>(
        "SELECT DISTINCT carton_id FROM asn_carton_map WHERE UPPER(TRIM(asn_no)) = UPPER(TRIM(?))",
        [asn_no]
      );
      
      console.warn(`📦 getASNCartons: Query with original format "${asn_no}": Found ${result.length} carton(s)`);
      
      // If no results and ASN was normalized, try with normalized format for backward compatibility
      if (result.length === 0 && asn_no !== normalizedASN) {
        result = await db.getAllAsync<{ carton_id: string }>(
          "SELECT DISTINCT carton_id FROM asn_carton_map WHERE UPPER(TRIM(asn_no)) = UPPER(TRIM(?))",
          [normalizedASN]
        );
        console.warn(`📦 getASNCartons: Query with normalized format "${normalizedASN}": Found ${result.length} carton(s)`);
      }
      
      // If still no results, try a broader search (case-insensitive, any format)
      if (result.length === 0) {
        // Get all unique ASN formats in the database for this ASN (case-insensitive)
        const allASNFormats = await db.getAllAsync<{ asn_no: string }>(
          "SELECT DISTINCT asn_no FROM asn_carton_map WHERE UPPER(TRIM(asn_no)) LIKE UPPER(TRIM(?))",
          [`%${asn_no.replace(/[^A-Z0-9]/g, "")}%`] // Remove special chars for pattern matching
        );
        console.warn(`📦 getASNCartons: Found ${allASNFormats.length} ASN format(s) in database:`, allASNFormats.map(a => a.asn_no));
        
        // Try each format found
        for (const asnFormat of allASNFormats) {
          const formatResult = await db.getAllAsync<{ carton_id: string }>(
            "SELECT DISTINCT carton_id FROM asn_carton_map WHERE asn_no = ?",
            [asnFormat.asn_no]
          );
          if (formatResult.length > 0) {
            console.warn(`📦 getASNCartons: Found ${formatResult.length} carton(s) using ASN format "${asnFormat.asn_no}"`);
            result = formatResult;
            break;
          }
        }
      }
      
      const cartonIds = result.map((r) => r.carton_id).filter(Boolean);
      console.warn(`📦 getASNCartons: Final result for ASN "${asn_no}": ${cartonIds.length} carton(s):`, cartonIds);
      
      return cartonIds;
    });
  },

  // Transfer Order Operations
  getTransferOrderAllocations: async (
    asn_no: string,
    store?: string
  ): Promise<TransferOrderAllocation[]> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      const normalizedASN = normalizeASN(asn_no);
    
      if (store) {
        // Try with original ASN format FIRST (allocations may be stored with original format)
        let results = await db.getAllAsync<TransferOrderAllocation>(
          "SELECT * FROM transfer_order_cache WHERE asn_no = ? AND store = ?",
          [asn_no, store]
        );
        
        // If no results and ASN was normalized, try with normalized format (for backward compatibility)
        if (results.length === 0 && asn_no !== normalizedASN) {
          results = await db.getAllAsync<TransferOrderAllocation>(
            "SELECT * FROM transfer_order_cache WHERE asn_no = ? AND store = ?",
            [normalizedASN, store]
          );
        }
        
        return results;
      }
      
      // Try with original ASN format FIRST (allocations may be stored with original format)
      let results = await db.getAllAsync<TransferOrderAllocation>(
        "SELECT * FROM transfer_order_cache WHERE asn_no = ?",
        [asn_no]
      );
      
      // If no results and ASN was normalized, try with normalized format (for backward compatibility)
      if (results.length === 0 && asn_no !== normalizedASN) {
        results = await db.getAllAsync<TransferOrderAllocation>(
          "SELECT * FROM transfer_order_cache WHERE asn_no = ?",
          [normalizedASN]
        );
      }
      
      return results;
    });
  },

  // Box Operations
  getBoxes: async (
    asn_no?: string,
    store?: string,
    purpose?: "STORE" | "PUTAWAY"
  ): Promise<Box[]> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      
      // First, sync boxes from scanned_items to box_cache
      // This ensures boxes created during ReceiveSort are available
      if (asn_no) {
        const normalizedASN = normalizeASN(asn_no);
        try {
          // Get unique boxes from scanned_items that don't exist in box_cache
          // Check both normalized and original ASN formats
          // Also handle warehouse stores flexibly (WAREHOUSE vs WH-*)
          const boxesFromScannedItems = await db.getAllAsync<{
            box_id: string;
            store: string;
            asn_no: string;
          }>(
            `SELECT DISTINCT si.box_id, si.store, si.asn_no 
             FROM scanned_items si
             WHERE (si.asn_no = ? OR si.asn_no = ?) 
             AND si.box_id IS NOT NULL AND si.box_id != ''
             AND si.box_id NOT IN (
               SELECT box_id FROM box_cache 
               WHERE box_id IS NOT NULL AND box_id != ''
             )`,
            [normalizedASN, asn_no]
          );

          console.log(
            `📦 Found ${boxesFromScannedItems.length} box(es) in scanned_items to sync to box_cache`
          );

          // Create boxes in box_cache from scanned_items
          for (const scannedBox of boxesFromScannedItems) {
            if (scannedBox.box_id && scannedBox.store) {
              try {
                // Get transfer order for this ASN if available (try both formats)
                const toAllocation = await db.getFirstAsync<{ to_no: string }>(
                  `SELECT DISTINCT to_no FROM to_allocations 
                   WHERE asn_no = ? OR asn_no = ? 
                   LIMIT 1`,
                  [normalizedASN, asn_no]
                );

                // Use the ASN format from scanned_items (preserve original format)
                const boxASN = scannedBox.asn_no || normalizedASN;

                await db.runAsync(
                  `INSERT OR IGNORE INTO box_cache 
                   (box_id, asn_no, to_no, store, status, purpose, updated_on) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
                  [
                    scannedBox.box_id,
                    boxASN,
                    toAllocation?.to_no || null,
                    scannedBox.store,
                    "Open", // Default status for boxes created from scanned items
                    purpose || "STORE",
                    new Date().toISOString(),
                  ]
                );
                console.log(
                  `✅ Created box ${scannedBox.box_id} from scanned_items for store ${scannedBox.store} (ASN: ${boxASN})`
                );
              } catch (error: any) {
                console.warn(
                  `⚠️ Failed to create box ${scannedBox.box_id} from scanned_items:`,
                  error.message
                );
              }
            }
          }
        } catch (error: any) {
          console.warn(
            `⚠️ Error syncing boxes from scanned_items:`,
            error.message
          );
        }
      }

      // Now load boxes from box_cache
      // Try original ASN format FIRST to avoid matching boxes from different ASNs
      // Only use normalized format as fallback for backward compatibility
      let query = "SELECT * FROM box_cache WHERE 1=1";
      const params: any[] = [];

      if (asn_no) {
        // Use original format ONLY to prevent matching boxes from different ASNs
        // (e.g., "ASN-0001" vs "ASN-00001" are different ASNs and should not match)
        query += " AND asn_no = ?";
        params.push(asn_no); // Use original format only
      }
      if (store) {
        // Handle warehouse stores flexibly:
        // - If store is "WAREHOUSE", also match stores starting with "WH-"
        // - If store starts with "WH-", also match "WAREHOUSE"
        const storeUpper = store.toUpperCase();
        if (storeUpper === "WAREHOUSE") {
          query += " AND (store = ? OR store LIKE ?)";
          params.push(store, "WH-%");
        } else if (storeUpper.startsWith("WH-")) {
          query += " AND (store = ? OR store = ?)";
          params.push(store, "WAREHOUSE");
        } else {
          query += " AND store = ?";
          params.push(store);
        }
      }
      if (purpose) {
        query += " AND (purpose = ? OR purpose IS NULL)";
        params.push(purpose);
      }

      // Filter out boxes with null/undefined/empty box_id at the database level
      query += " AND box_id IS NOT NULL AND box_id != ''";

      query += " ORDER BY updated_on DESC";
      let boxes = await db.getAllAsync<Box>(query, params);
      
      // If no results and ASN was normalized, try with normalized format only (for backward compatibility)
      // But only if we got no results with the original format
      if (boxes.length === 0 && asn_no) {
        const normalizedASN = normalizeASN(asn_no);
        if (normalizedASN !== asn_no) {
          console.log(`⚠️ No boxes found with original ASN format "${asn_no}", trying normalized format "${normalizedASN}" for backward compatibility...`);
          let fallbackQuery = "SELECT * FROM box_cache WHERE 1=1";
          const fallbackParams: any[] = [];
          
          fallbackQuery += " AND asn_no = ?";
          fallbackParams.push(normalizedASN);
          
          if (store) {
            const storeUpper = store.toUpperCase();
            if (storeUpper === "WAREHOUSE") {
              fallbackQuery += " AND (store = ? OR store LIKE ?)";
              fallbackParams.push(store, "WH-%");
            } else if (storeUpper.startsWith("WH-")) {
              fallbackQuery += " AND (store = ? OR store = ?)";
              fallbackParams.push(store, "WAREHOUSE");
            } else {
              fallbackQuery += " AND store = ?";
              fallbackParams.push(store);
            }
          }
          if (purpose) {
            fallbackQuery += " AND (purpose = ? OR purpose IS NULL)";
            fallbackParams.push(purpose);
          }
          fallbackQuery += " AND box_id IS NOT NULL AND box_id != ''";
          fallbackQuery += " ORDER BY updated_on DESC";
          
          boxes = await db.getAllAsync<Box>(fallbackQuery, fallbackParams);
          if (boxes.length > 0) {
            console.log(`✅ Found ${boxes.length} box(es) using normalized ASN format (backward compatibility)`);
          }
        }
      }

      // Additional client-side filter as a safety measure
      return boxes.filter(
        (box) => box.box_id && box.box_id !== "" && box.box_id !== null
      );
    });
  },

  saveBox: async (box: Box) => {
    const db = await getDatabase();
    const purpose = box.purpose || "STORE";
    await db.runAsync(
      "INSERT OR REPLACE INTO box_cache (box_id, asn_no, to_no, store, status, purpose, updated_on) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        box.box_id,
        box.asn_no,
        box.to_no,
        box.store,
        box.status,
        purpose,
        box.updated_on,
      ]
    );
  },

  updateBoxStatus: async (box_id: string, status: string) => {
    const db = await getDatabase();
    await db.runAsync(
      "UPDATE box_cache SET status = ?, updated_on = ? WHERE box_id = ?",
      [status, new Date().toISOString(), box_id]
    );
  },

  // Transfer Carton Operations
  getTransferCartons: async (
    asn_no?: string,
    store?: string
  ): Promise<TransferCarton[]> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      
      // First, clean up any invalid Transfer Cartons (with null or empty tc_id)
      try {
        const deletedCount = await db.runAsync(
          "DELETE FROM tc_cache WHERE tc_id IS NULL OR tc_id = ''"
        );
        if (deletedCount && deletedCount.changes > 0) {
          console.log(
            `🗑️ Cleaned up ${deletedCount.changes} invalid Transfer Carton(s) with null/empty tc_id`
          );
        }
      } catch (cleanupError: any) {
        console.warn(`⚠️ Failed to clean up invalid Transfer Cartons:`, cleanupError.message);
      }
      
      let query = "SELECT * FROM tc_cache WHERE tc_id IS NOT NULL AND tc_id != ''";
      const params: any[] = [];

      if (asn_no) {
        // CRITICAL: Only query with original ASN format (no fallback to normalized)
        // This prevents matching Transfer Cartons from different ASNs (e.g., "ASN-0001" vs "ASN-00001")
        // Transfer Cartons should be stored with the original ASN format from the backend
        // Use case-insensitive matching for ASN (SQLite doesn't support ILIKE, so use UPPER)
        query += " AND UPPER(TRIM(asn_no)) = UPPER(TRIM(?))";
        params.push(asn_no); // Use original format only
      }
      if (store) {
        // Handle warehouse stores flexibly (same logic as getBoxes):
        // - If store is "WAREHOUSE", also match stores starting with "WH-"
        // - If store starts with "WH-", also match "WAREHOUSE"
        const storeUpper = store.toUpperCase().trim();
        if (storeUpper === "WAREHOUSE") {
          query += " AND (store = ? OR store LIKE ?)";
          params.push(store, "WH-%");
        } else if (storeUpper.startsWith("WH-")) {
          query += " AND (store = ? OR store = ?)";
          params.push(store, "WAREHOUSE");
        } else {
          query += " AND store = ?";
          params.push(store);
        }
      }

      query += " ORDER BY updated_on DESC";
      const transferCartons = await db.getAllAsync<TransferCarton>(query, params);
      
      // CRITICAL: Additional filtering to ensure exact ASN match (case-insensitive)
      // This prevents matching Transfer Cartons from different ASNs that might have been stored incorrectly
      let filteredTransferCartons = transferCartons;
      if (asn_no) {
        filteredTransferCartons = transferCartons.filter(
          (tc) => tc.asn_no && tc.asn_no.toUpperCase().trim() === asn_no.toUpperCase().trim()
        );
        
        if (filteredTransferCartons.length !== transferCartons.length) {
          console.warn(
            `⚠️ getTransferCartons: Filtered out ${transferCartons.length - filteredTransferCartons.length} Transfer Carton(s) with mismatched ASN format`
          );
        }
      }
      
      // Filter out any Transfer Cartons with null or empty tc_id (safety check)
      const validTransferCartons = filteredTransferCartons.filter(
        (tc) => tc.tc_id && tc.tc_id.trim() !== ""
      );
      
      if (validTransferCartons.length !== transferCartons.length) {
        console.warn(
          `⚠️ getTransferCartons: Filtered out ${transferCartons.length - validTransferCartons.length} Transfer Carton(s) with invalid tc_id`
        );
      }
      
      console.log(
        `📦 getTransferCartons: Found ${validTransferCartons.length} valid Transfer Carton(s) for ASN: ${asn_no}`,
        validTransferCartons.map((tc) => ({
          tc_id: tc.tc_id,
          asn_no: tc.asn_no,
          store: tc.store,
          status: tc.status,
        }))
      );
      
      return validTransferCartons;
    });
  },

  saveTransferCarton: async (tc: TransferCarton) => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      
      // Validate that tc_id is provided (required as PRIMARY KEY)
      if (!tc.tc_id || tc.tc_id.trim() === "") {
        throw new Error("Cannot save Transfer Carton: tc_id is required");
      }
      
      console.log(
        `💾 saveTransferCarton: Saving Transfer Carton:`,
        {
          tc_id: tc.tc_id,
          asn_no: tc.asn_no,
          to_no: tc.to_no,
          store: tc.store,
          status: tc.status,
        }
      );
      
      await db.runAsync(
        "INSERT OR REPLACE INTO tc_cache (tc_id, asn_no, to_no, store, status, updated_on) VALUES (?, ?, ?, ?, ?, ?)",
        [tc.tc_id, tc.asn_no, tc.to_no, tc.store, tc.status, tc.updated_on]
      );
      
      // Verify it was saved
      const saved = await db.getFirstAsync<TransferCarton>(
        "SELECT * FROM tc_cache WHERE tc_id = ?",
        [tc.tc_id]
      );
      
      if (saved) {
        console.log(
          `✅ saveTransferCarton: Verified Transfer Carton saved:`,
          {
            tc_id: saved.tc_id,
            asn_no: saved.asn_no,
            store: saved.store,
            status: saved.status,
          }
        );
      } else {
        console.warn(
          `⚠️ saveTransferCarton: Transfer Carton not found after save!`
        );
      }
    });
  },

  updateTransferCartonStatus: async (tc_id: string, status: string) => {
    const db = await getDatabase();
    await db.runAsync(
      "UPDATE tc_cache SET status = ?, updated_on = ? WHERE tc_id = ?",
      [status, new Date().toISOString(), tc_id]
    );
  },

  // Carton Status Operations
  getCartonStatus: async (
    asn_no: string,
    inbound_session: string,
    carton_id: string
  ): Promise<CartonStatus | null> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      const normalizedASN = normalizeASN(asn_no);
      
      // Try with original ASN format FIRST (statuses are stored with original format)
      let result = await db.getFirstAsync<CartonStatus>(
        "SELECT * FROM carton_status_cache WHERE asn_no = ? AND inbound_session = ? AND carton_id = ?",
        [asn_no, inbound_session, carton_id.trim().toUpperCase()]
      );
      
      if (result) {
        // Normalize status: Convert "In Receiving" to "Receiving" for consistency
        if (result.status === "In Receiving") {
          result.status = "Receiving";
        }
        return result;
      }
      
      // Fallback: try with normalized ASN format (for backward compatibility)
      if (asn_no !== normalizedASN) {
        result = await db.getFirstAsync<CartonStatus>(
          "SELECT * FROM carton_status_cache WHERE asn_no = ? AND inbound_session = ? AND carton_id = ?",
          [normalizedASN, inbound_session, carton_id.trim().toUpperCase()]
        );
        // Normalize status if found
        if (result && result.status === "In Receiving") {
          result.status = "Receiving";
        }
      }
      
      return result || null;
    });
  },

  getAllCartonStatuses: async (
    asn_no: string,
    inbound_session: string
  ): Promise<CartonStatus[]> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      const normalizedASN = normalizeASN(asn_no);
      
      // Try with original format FIRST (statuses should match carton storage format)
      let results = await db.getAllAsync<CartonStatus>(
        "SELECT * FROM carton_status_cache WHERE asn_no = ? AND inbound_session = ? ORDER BY carton_id",
        [asn_no, inbound_session]
      );
      
      // If no results and ASN was normalized, try with normalized format for backward compatibility
      if (results.length === 0 && asn_no !== normalizedASN) {
        results = await db.getAllAsync<CartonStatus>(
          "SELECT * FROM carton_status_cache WHERE asn_no = ? AND inbound_session = ? ORDER BY carton_id",
          [normalizedASN, inbound_session]
        );
      }

      // If still no results and session is not empty, try with empty session (for demo data migration)
      // Try with original format first, then normalized
      if (
        results.length === 0 &&
        inbound_session &&
        inbound_session.trim() !== ""
      ) {
        console.log(
          `⚠️ No statuses found for session ${inbound_session}, checking empty session...`
        );
        // Try with original format first
        let emptySessionResults = await db.getAllAsync<CartonStatus>(
          "SELECT * FROM carton_status_cache WHERE asn_no = ? AND (inbound_session = ? OR inbound_session = ?) ORDER BY carton_id",
          [asn_no, inbound_session, ""]
        );
        
        // If no results and ASN was normalized, try with normalized format
        if (emptySessionResults.length === 0 && asn_no !== normalizedASN) {
          emptySessionResults = await db.getAllAsync<CartonStatus>(
            "SELECT * FROM carton_status_cache WHERE asn_no = ? AND (inbound_session = ? OR inbound_session = ?) ORDER BY carton_id",
            [normalizedASN, inbound_session, ""]
          );
        }
        if (emptySessionResults.length > 0) {
          console.log(
            `📦 Found ${emptySessionResults.length} statuses with empty session, will migrate to current session`
          );
        }
        // Normalize statuses in empty session results
        emptySessionResults.forEach((s) => {
          if (s.status === "In Receiving") {
            s.status = "Receiving";
          }
        });
        return emptySessionResults;
      }
      
      // Normalize statuses: Convert "In Receiving" to "Receiving" for consistency
      results.forEach((s) => {
        if (s.status === "In Receiving") {
          s.status = "Receiving";
        }
      });
      
      return results;
    });
  },

  updateCartonStatus: async (status: CartonStatus) => {
    const db = await getDatabase();
    
    // Normalize status: Convert "In Receiving" (with space) to "Receiving" (without space) for local storage
    // This ensures consistency in the local database regardless of what format comes from API or desktop sync
    const normalizedStatus = status.status === "In Receiving" ? "Receiving" : status.status;
    
    const params = [
        status.asn_no,
        status.inbound_session,
        status.carton_id,
        normalizedStatus, // Use normalized status for storage
        status.locked_by || null,
        status.locked_on || null,
        status.updated_on,
    ];

    console.log(`💾 updateCartonStatus called:`, {
      carton: status.carton_id,
      asn: status.asn_no,
      session: status.inbound_session,
      originalStatus: status.status,
      normalizedStatus: normalizedStatus,
      params,
    });

    await db.runAsync(
      `INSERT OR REPLACE INTO carton_status_cache 
       (asn_no, inbound_session, carton_id, status, locked_by, locked_on, updated_on) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params
    );

    // Verify the update
    const verify = await db.getFirstAsync<CartonStatus>(
      "SELECT * FROM carton_status_cache WHERE asn_no = ? AND inbound_session = ? AND carton_id = ?",
      [status.asn_no, status.inbound_session, status.carton_id]
    );

    // Normalize status in verification result for comparison
    const verifyNormalizedStatus = verify?.status === "In Receiving" ? "Receiving" : verify?.status;

    console.log(`✅ updateCartonStatus verified:`, {
      carton: status.carton_id,
      savedStatus: verifyNormalizedStatus,
      savedSession: verify?.inbound_session,
      match:
        verifyNormalizedStatus === normalizedStatus &&
        verify?.inbound_session === status.inbound_session,
    });
  },

  // Scanned Items Operations - Query saved scanned items
  getScannedItems: async (
    asn_no: string,
    inbound_session?: string,
    carton_id?: string
  ) => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      const normalizedASN = normalizeASN(asn_no);
      
      // Try original format FIRST (scanned items are stored with original format)
      // Include items with carton_id = carton_id (old workflow) OR carton_id IS NULL (new BOX ID workflow)
      // Check both ASN formats to ensure we get all records
      let query = "SELECT * FROM scanned_items WHERE (asn_no = ? OR asn_no = ?)";
      const params: any[] = [asn_no, normalizedASN];
      
      if (inbound_session) {
        query += " AND inbound_session = ?";
        params.push(inbound_session);
      }
      
      if (carton_id) {
        // Include items with carton_id = carton_id OR carton_id IS NULL (BOX ID workflow)
        query += " AND (carton_id = ? OR carton_id IS NULL)";
        params.push(carton_id);
      }
      
      query += " ORDER BY scanned_on DESC";
      
      let results = await db.getAllAsync(query, params);
      
      // If no results, try with just normalized format (backward compatibility)
      if (results.length === 0 && asn_no !== normalizedASN) {
        const normalizedQuery = "SELECT * FROM scanned_items WHERE asn_no = ?";
        const normalizedParams: any[] = [normalizedASN];
        
        if (inbound_session) {
          normalizedQuery += " AND inbound_session = ?";
          normalizedParams.push(inbound_session);
        }
        
        if (carton_id) {
          // Include items with carton_id = carton_id OR carton_id IS NULL (BOX ID workflow)
          normalizedQuery += " AND (carton_id = ? OR carton_id IS NULL)";
          normalizedParams.push(carton_id);
        }
        
        normalizedQuery += " ORDER BY scanned_on DESC";
        
        results = await db.getAllAsync(normalizedQuery, normalizedParams);
      }
      
      return results;
    });
  },

  getScannedItemsByBox: async (box_id: string) => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      return await db.getAllAsync(
        "SELECT * FROM scanned_items WHERE box_id = ? ORDER BY scanned_on DESC",
        [box_id]
      );
    });
  },

  getUnitsScannedPerBox: async (box_id: string): Promise<number> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      const result = await db.getFirstAsync<{ total_units: number }>(
        "SELECT COALESCE(SUM(scanned_qty), 0) as total_units FROM scanned_items WHERE box_id = ?",
        [box_id]
      );
      return result?.total_units || 0;
    });
  },

  getUnitsScannedForBoxes: async (boxIds: string[]): Promise<Map<string, number>> => {
    if (boxIds.length === 0) return new Map();
    
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      
      const placeholders = boxIds.map(() => "?").join(",");
      const results = await db.getAllAsync<{ box_id: string; total_units: number }>(
        `SELECT box_id, COALESCE(SUM(scanned_qty), 0) as total_units 
         FROM scanned_items 
         WHERE box_id IN (${placeholders})
         GROUP BY box_id`,
        boxIds
      );
      
      const unitsMap = new Map<string, number>();
      // Initialize all boxes with 0
      boxIds.forEach(boxId => unitsMap.set(boxId, 0));
      // Update with actual counts
      results.forEach(result => {
        unitsMap.set(result.box_id, result.total_units || 0);
      });
      
      return unitsMap;
    });
  },

  getScannedItemsSummary: async (asn_no: string, inbound_session?: string) => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      const normalizedASN = normalizeASN(asn_no);
      
      // Try original format FIRST (scanned items are stored with original format)
      let query = `
        SELECT 
          carton_id,
          item_code,
          box_id,
          store,
          SUM(scanned_qty) as total_qty,
          COUNT(*) as scan_count
        FROM scanned_items 
        WHERE asn_no = ?
      `;
      const params: any[] = [asn_no];
      
      if (inbound_session) {
        query += " AND inbound_session = ?";
        params.push(inbound_session);
      }
      
      query +=
        " GROUP BY carton_id, item_code, box_id, store ORDER BY carton_id, item_code";
      
      let results = await db.getAllAsync(query, params);
      
      // If no results and ASN was normalized, try with normalized format
      if (results.length === 0 && asn_no !== normalizedASN) {
        let normalizedQuery = `
          SELECT 
            carton_id,
            item_code,
            box_id,
            store,
            SUM(scanned_qty) as total_qty,
            COUNT(*) as scan_count
          FROM scanned_items 
          WHERE asn_no = ?
        `;
        const normalizedParams: any[] = [normalizedASN];
        
        if (inbound_session) {
          normalizedQuery += " AND inbound_session = ?";
          normalizedParams.push(inbound_session);
        }
        
        normalizedQuery +=
          " GROUP BY carton_id, item_code, box_id, store ORDER BY carton_id, item_code";
        
        results = await db.getAllAsync(normalizedQuery, normalizedParams);
      }
      
      return results;
    });
  },

  // Verification: Get all data counts for an ASN
  getDataVerification: async (asn_no: string, inbound_session?: string) => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      const normalizedASN = normalizeASN(asn_no);
      
      // Try original format FIRST
      const sessionFilter = inbound_session ? " AND inbound_session = ?" : "";
      let params = inbound_session
        ? [asn_no, inbound_session]
        : [asn_no];
      
      let events = await db.getAllAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM event_queue WHERE asn_no = ?${sessionFilter}`,
        params
      );
      
      let scannedItems = await db.getAllAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM scanned_items WHERE asn_no = ?${sessionFilter}`,
        params
      );
      
      // If no results and ASN was normalized, try with normalized format
      if ((events.length === 0 || (events[0]?.count || 0) === 0) && 
          (scannedItems.length === 0 || (scannedItems[0]?.count || 0) === 0) &&
          asn_no !== normalizedASN) {
        params = inbound_session
          ? [normalizedASN, inbound_session]
          : [normalizedASN];
        
        events = await db.getAllAsync<{ count: number }>(
          `SELECT COUNT(*) as count FROM event_queue WHERE asn_no = ?${sessionFilter}`,
          params
        );
        
        scannedItems = await db.getAllAsync<{ count: number }>(
          `SELECT COUNT(*) as count FROM scanned_items WHERE asn_no = ?${sessionFilter}`,
          params
        );
      }
      
      const [cartonStatuses] = await db.getAllAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM carton_status_cache WHERE asn_no = ?${sessionFilter}`,
        params
      );
      
      const [boxes] = await db.getAllAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM box_cache WHERE asn_no = ?`,
        [normalizedASN]
      );
      
      const [tcs] = await db.getAllAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM tc_cache WHERE asn_no = ?`,
        [normalizedASN]
      );
      
      return {
        events: events?.count || 0,
        scannedItems: scannedItems?.count || 0,
        cartonStatuses: cartonStatuses?.count || 0,
        boxes: boxes?.count || 0,
        transferCartons: tcs?.count || 0,
      };
    });
  },

  // Clear all cache data (for syncing from backend)
  clearAllCacheData: async (): Promise<void> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");

      console.log("🗑️ Clearing all local cache data...");

      try {
        // Clear all cache tables (but keep settings and event_queue for now)
        // Event queue should be synced first before clearing
        
        const tablesToClear = [
          "asn_cache",
          "asn_carton_map",
          "transfer_order_cache",
          "box_cache",
          "tc_cache",
          "carton_status_cache",
          "item_master",
          "material_request_cache",
          "scanned_items",
          "inbound_sessions",
        ];

        for (const table of tablesToClear) {
          try {
            const result = await db.runAsync(`DELETE FROM ${table}`);
            console.log(`✅ Cleared ${table}: ${result.changes || 0} rows`);
          } catch (error: any) {
            console.warn(`⚠️ Error clearing ${table}:`, error.message);
          }
        }

        console.log("✅ All cache data cleared successfully");
      } catch (error: any) {
        console.error("❌ Error clearing cache data:", error);
        throw error;
      }
    });
  },

  // Clear all transaction data
  clearAllTransactionData: async (): Promise<void> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");

      console.log("🗑️ Clearing all transaction data...");

      // Clear all transaction tables in proper order (respecting dependencies)
      // 1. Clear event/transaction data first
      console.log("  - Clearing event queue...");
      await db.runAsync("DELETE FROM event_queue");
      
      console.log("  - Clearing scanned items...");
      await db.runAsync("DELETE FROM scanned_items");
      
      console.log("  - Clearing workflow state...");
      await db.runAsync("DELETE FROM workflow_state_cache");
      
      console.log("  - Clearing carton statuses...");
      await db.runAsync("DELETE FROM carton_status_cache");
      
      // 2. Clear box and transfer carton data
      console.log("  - Clearing boxes...");
      await db.runAsync("DELETE FROM box_cache");
      
      console.log("  - Clearing transfer cartons...");
      await db.runAsync("DELETE FROM tc_cache");
      
      // 3. Clear putaway data
      console.log("  - Clearing putaway items...");
      await db.runAsync("DELETE FROM putaway_items_cache");
      
      // 4. Clear ASN carton map (CTN data) - THIS WAS MISSING!
      console.log("  - Clearing ASN carton map (carton/CTN data)...");
      await db.runAsync("DELETE FROM asn_carton_map");
      
      // 5. Clear transfer order allocations
      console.log("  - Clearing transfer order allocations...");
      await db.runAsync("DELETE FROM transfer_order_cache");
      
      // 5a. Clear transfer in cache
      console.log("  - Clearing transfer in cache...");
      try {
        await db.runAsync("DELETE FROM transfer_in_cache");
      } catch (error: any) {
        console.warn("    - Could not clear transfer_in_cache:", error.message);
      }
      
      // 5b. Clear material request cache
      console.log("  - Clearing material request cache...");
      try {
        await db.runAsync("DELETE FROM material_request_cache");
      } catch (error: any) {
        console.warn("    - Could not clear material_request_cache:", error.message);
      }
      
      // 6. Clear ASN cache
      console.log("  - Clearing ASN cache...");
      await db.runAsync("DELETE FROM asn_cache");
      
      // 7. Clear inbound sessions
      console.log("  - Clearing inbound sessions...");
      try {
        // Check if table exists first
        const tableInfo = await db.getAllAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='inbound_sessions'"
        );
        if (tableInfo.length > 0) {
          await db.runAsync("DELETE FROM inbound_sessions");
        }
      } catch (error: any) {
        console.warn("⚠️ Could not clear inbound_sessions (table may not exist):", error.message);
      }
      
      // 8. Clear warehouse rack cache
      console.log("  - Clearing warehouse rack cache...");
      await db.runAsync("DELETE FROM warehouse_rack_cache");
      
      // 9. Clear cycle count data
      console.log("  - Clearing cycle count data...");
      try {
        await db.runAsync("DELETE FROM cycle_count_lines");
        console.log("    - Cycle count lines cleared");
      } catch (error: any) {
        console.warn("    - Could not clear cycle_count_lines:", error.message);
      }
      
      try {
        await db.runAsync("DELETE FROM cycle_count_sessions");
        console.log("    - Cycle count sessions cleared");
      } catch (error: any) {
        console.warn("    - Could not clear cycle_count_sessions:", error.message);
      }
      
      try {
        await db.runAsync("DELETE FROM cycle_count_cache");
        console.log("    - Cycle count cache cleared");
      } catch (error: any) {
        console.warn("    - Could not clear cycle_count_cache:", error.message);
      }
      
      // 10. Clear stock ledger cache (sources expected quantities for cycle count)
      console.log("  - Clearing stock ledger cache...");
      try {
        await db.runAsync("DELETE FROM stock_ledger_cache");
        console.log("    - Stock ledger cache cleared");
      } catch (error: any) {
        console.warn("    - Could not clear stock_ledger_cache:", error.message);
      }
      
      try {
        await db.runAsync("DELETE FROM stock_transaction_cache");
        console.log("    - Stock transaction cache cleared");
      } catch (error: any) {
        console.warn("    - Could not clear stock_transaction_cache:", error.message);
      }
      
      // 11. Clear master data tables (will be repopulated from backend during sync)
      console.log("  - Clearing master data (will sync from backend)...");
      console.log("    - Item master...");
      await db.runAsync("DELETE FROM item_master");
      
      console.log("    - Users...");
      await db.runAsync("DELETE FROM users");
      
      console.log("    - Warehouses...");
      await db.runAsync("DELETE FROM warehouse_cache");
      
      console.log("    - Warehouse stores...");
      try {
        // Check if table exists first
        const wsTableInfo = await db.getAllAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='warehouse_store_cache'"
        );
        if (wsTableInfo.length > 0) {
          await db.runAsync("DELETE FROM warehouse_store_cache");
        }
      } catch (error: any) {
        console.warn("⚠️ Could not clear warehouse_store_cache (table may not exist):", error.message);
      }
      
      console.log("    - Locations...");
      await db.runAsync("DELETE FROM location_cache");
      
      console.log("    - Bin master...");
      try {
        await db.runAsync("DELETE FROM bin_master_cache");
      } catch (error: any) {
        console.warn("    - Could not clear bin_master_cache:", error.message);
      }
      
      console.log("    - Item barcode map...");
      try {
        await db.runAsync("DELETE FROM item_barcode_map");
      } catch (error: any) {
        console.warn("    - Could not clear item_barcode_map:", error.message);
      }
      
      // Clear active session from settings (but keep other settings)
      console.log("  - Clearing active session from settings...");
      await db.runAsync(
        "UPDATE settings SET active_asn = NULL, active_session = NULL"
      );
      
      console.log("✅ All transaction data and master data cleared successfully");
      console.log("   - Events, scanned items, workflow states");
      console.log("   - Cartons (CTN), boxes, transfer cartons");
      console.log("   - ASN data, transfer orders, transfer in, material requests, sessions");
      console.log("   - Cycle count data (sessions, lines, cache)");
      console.log("   - Stock ledger and transaction cache");
      console.log("   - Master data (items, users, warehouses, locations, bins, barcode maps)");
      console.log("   ℹ️  Master data will be repopulated from backend during next sync");
    });
  },

  // Put Away Operations - Calculate Remaining Items
  getRemainingItems: async (asn_no: string): Promise<RemainingItem[]> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      const normalizedASN = normalizeASN(asn_no);

      // Get all items shipped in ASN (from all cartons)
      // Try original format FIRST (cartons are stored with original format)
      let shippedItems = await db.getAllAsync<{
        item_code: string;
        shipped_qty: number;
      }>(
        `SELECT item_code, SUM(shipped_qty) as shipped_qty 
         FROM asn_carton_map 
         WHERE asn_no = ? 
         GROUP BY item_code`,
        [asn_no]
      );
      
      // If no results and ASN was normalized, try with normalized format
      if (shippedItems.length === 0 && asn_no !== normalizedASN) {
        shippedItems = await db.getAllAsync<{
          item_code: string;
          shipped_qty: number;
        }>(
          `SELECT item_code, SUM(shipped_qty) as shipped_qty 
           FROM asn_carton_map 
           WHERE asn_no = ? 
           GROUP BY item_code`,
          [normalizedASN]
        );
      }

      // Get all TO allocations for this ASN
      // Try original format FIRST (allocations are stored with original format)
      let allocations = await db.getAllAsync<{
        item_code: string;
        allocated_qty: number;
      }>(
        `SELECT item_code, SUM(allocated_qty) as allocated_qty 
         FROM transfer_order_cache 
         WHERE asn_no = ? 
         GROUP BY item_code`,
        [asn_no]
      );
      
      // If no results and ASN was normalized, try with normalized format
      if (allocations.length === 0 && asn_no !== normalizedASN) {
        allocations = await db.getAllAsync<{
          item_code: string;
          allocated_qty: number;
        }>(
          `SELECT item_code, SUM(allocated_qty) as allocated_qty 
           FROM transfer_order_cache 
           WHERE asn_no = ? 
           GROUP BY item_code`,
          [normalizedASN]
        );
      }

      // Get all scanned items (sorted to store BOXes)
      // Try original format FIRST (scanned items are stored with original format)
      let scannedItems = await db.getAllAsync<{
        item_code: string;
        scanned_qty: number;
      }>(
        `SELECT item_code, SUM(scanned_qty) as scanned_qty 
         FROM scanned_items 
         WHERE asn_no = ? 
         GROUP BY item_code`,
        [asn_no]
      );
      
      // If no results and ASN was normalized, try with normalized format
      if (scannedItems.length === 0 && asn_no !== normalizedASN) {
        scannedItems = await db.getAllAsync<{
          item_code: string;
          scanned_qty: number;
        }>(
          `SELECT item_code, SUM(scanned_qty) as scanned_qty 
           FROM scanned_items 
           WHERE asn_no = ? 
           GROUP BY item_code`,
          [normalizedASN]
        );
      }

      // Get items sorted to WAREHOUSE boxes (these need to be put away)
      // Try original format FIRST
      let warehouseItems = await db.getAllAsync<{
        item_code: string;
        scanned_qty: number;
      }>(
        `SELECT item_code, SUM(scanned_qty) as scanned_qty 
         FROM scanned_items 
         WHERE asn_no = ? AND store = 'WAREHOUSE'
         GROUP BY item_code`,
        [asn_no]
      );
      
      // If no results and ASN was normalized, try with normalized format
      if (warehouseItems.length === 0 && asn_no !== normalizedASN) {
        warehouseItems = await db.getAllAsync<{
          item_code: string;
          scanned_qty: number;
        }>(
          `SELECT item_code, SUM(scanned_qty) as scanned_qty 
           FROM scanned_items 
           WHERE asn_no = ? AND store = 'WAREHOUSE'
           GROUP BY item_code`,
          [normalizedASN]
        );
      }

      // Get items already put away (to exclude from remaining)
      // Try original format FIRST
      let putAwayItems = await db.getAllAsync<{
        item_code: string;
        remaining_qty: number;
      }>(
        `SELECT item_code, SUM(remaining_qty) as remaining_qty 
         FROM putaway_items_cache 
         WHERE asn_no = ? 
         GROUP BY item_code`,
        [asn_no]
      );
      
      // If no results and ASN was normalized, try with normalized format
      if (putAwayItems.length === 0 && asn_no !== normalizedASN) {
        putAwayItems = await db.getAllAsync<{
          item_code: string;
          remaining_qty: number;
        }>(
          `SELECT item_code, SUM(remaining_qty) as remaining_qty 
           FROM putaway_items_cache 
           WHERE asn_no = ? 
           GROUP BY item_code`,
          [normalizedASN]
        );
      }

      // Create maps for easy lookup
      const allocationMap = new Map(
        allocations.map((a) => [a.item_code, a.allocated_qty || 0])
      );
      const scannedMap = new Map(
        scannedItems.map((s) => [s.item_code, s.scanned_qty || 0])
      );
      const warehouseMap = new Map(
        warehouseItems.map((w) => [w.item_code, w.scanned_qty || 0])
      );
      const putAwayMap = new Map(
        putAwayItems.map((p) => [p.item_code, p.remaining_qty || 0])
      );

      // Calculate remaining items (unallocated items)
      const unallocatedItems: RemainingItem[] = shippedItems
        .map((shipped) => {
          const itemCode = shipped.item_code;
          const shippedQty = shipped.shipped_qty || 0;
          const allocatedQty = allocationMap.get(itemCode) || 0;
          const scannedToStores = scannedMap.get(itemCode) || 0;
          const remainingQty = Math.max(0, shippedQty - allocatedQty);

          return {
            item_code: itemCode,
            shipped_qty: shippedQty,
            allocated_qty: allocatedQty,
            remaining_qty: remainingQty,
            scanned_to_stores: scannedToStores,
          };
        })
        .filter((item) => item.remaining_qty > 0); // Only items with remaining quantity

      // Add items from WAREHOUSE boxes that haven't been put away yet
      const warehouseItemsForPutAway: RemainingItem[] = warehouseItems
        .map((warehouse) => {
          const itemCode = warehouse.item_code;
          const warehouseQty = warehouse.scanned_qty || 0;
          const alreadyPutAway = putAwayMap.get(itemCode) || 0;
          const remainingForPutAway = Math.max(
            0,
            warehouseQty - alreadyPutAway
          );

          if (remainingForPutAway > 0) {
            // Get shipped qty and allocated qty for this item
            const shippedItem = shippedItems.find(
              (s) => s.item_code === itemCode
            );
            const allocatedQty = allocationMap.get(itemCode) || 0;

            return {
              item_code: itemCode,
              shipped_qty: shippedItem?.shipped_qty || warehouseQty,
              allocated_qty: allocatedQty,
              remaining_qty: remainingForPutAway,
              scanned_to_stores: warehouseQty, // Items in warehouse boxes
            };
          }
          return null;
        })
        .filter((item): item is RemainingItem => item !== null);

      // Combine unallocated items and warehouse items for put away
      const allRemainingItems = [
        ...unallocatedItems,
        ...warehouseItemsForPutAway,
      ];

      // Remove duplicates (if an item appears in both, keep the one with higher remaining_qty)
      const uniqueItems = new Map<string, RemainingItem>();
      for (const item of allRemainingItems) {
        const existing = uniqueItems.get(item.item_code);
        if (!existing || item.remaining_qty > existing.remaining_qty) {
          uniqueItems.set(item.item_code, item);
        }
      }

      return Array.from(uniqueItems.values());
    });
  },

  // Save Put Away Item
  savePutAwayItem: async (
    putawayItem: PutAwayItem,
    deviceId: string,
    userId: string
  ) => {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT OR REPLACE INTO putaway_items_cache 
       (asn_no, item_code, remaining_qty, putaway_box_id, rack_id, bin_id, putaway_on, device_id, user_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        putawayItem.asn_no,
        putawayItem.item_code,
        putawayItem.remaining_qty,
        putawayItem.putaway_box_id || null,
        putawayItem.rack_id || null,
        putawayItem.bin_id || null,
        putawayItem.putaway_on || new Date().toISOString(),
        deviceId,
        userId,
      ]
    );
  },

  // Get Put Away Items
  getPutAwayItems: async (asn_no: string): Promise<PutAwayItem[]> => {
    const db = await getDatabase();
    const normalizedASN = normalizeASN(asn_no);
    return await db.getAllAsync<PutAwayItem>(
      "SELECT * FROM putaway_items_cache WHERE asn_no = ? ORDER BY item_code",
      [normalizedASN]
    );
  },

  // Save Warehouse Rack
  saveWarehouseRack: async (rack: WarehouseRack) => {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT OR REPLACE INTO warehouse_rack_cache 
       (rack_id, bin_id, location_code, capacity, current_qty, updated_on) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        rack.rack_id,
        rack.bin_id || null,
        rack.location_code,
        rack.capacity || null,
        rack.current_qty || 0,
        rack.updated_on || new Date().toISOString(),
      ]
    );
  },

  // Get Warehouse Rack
  getWarehouseRack: async (rack_id: string): Promise<WarehouseRack | null> => {
    const db = await getDatabase();
    return await db.getFirstAsync<WarehouseRack>(
      "SELECT * FROM warehouse_rack_cache WHERE rack_id = ?",
      [rack_id]
    );
  },

  // Get Location by location_id (from tablocation table)
  getLocation: async (location_id: string): Promise<{
    location_id: string;
    warehouse: string | null;
    zone: string | null;
    aisle: string | null;
    parent_rack: string | null;
    level: string | null;
    bin_id: string | null;
    location_type: string | null;
    location_type_detailed: string | null;
    is_available: number;
    capacity_volume_weight: number | null;
    updated_on: string;
  } | null> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      return await db.getFirstAsync<{
        location_id: string;
        warehouse: string | null;
        zone: string | null;
        aisle: string | null;
        parent_rack: string | null;
        level: string | null;
        bin_id: string | null;
        location_type: string | null;
        location_type_detailed: string | null;
        is_available: number;
        capacity_volume_weight: number | null;
        updated_on: string;
      }>(
        "SELECT * FROM location_cache WHERE location_id = ?",
        [location_id]
      );
    });
  },

  // Check if all cartons are received
  areAllCartonsReceived: async (
    asn_no: string,
    inbound_session: string
  ): Promise<boolean> => {
    const db = await getDatabase();
    const normalizedASN = normalizeASN(asn_no);
    
    // Get all unique cartons in ASN
    const allCartons = await db.getAllAsync<{ carton_id: string }>(
      "SELECT DISTINCT carton_id FROM asn_carton_map WHERE asn_no = ?",
      [normalizedASN]
    );
    
    if (allCartons.length === 0) return false;
    
    // Get all received cartons
    const receivedCartons = await db.getAllAsync<{ carton_id: string }>(
      "SELECT DISTINCT carton_id FROM carton_status_cache WHERE asn_no = ? AND inbound_session = ? AND status = ?",
      [normalizedASN, inbound_session, "Received"]
    );
    
    return allCartons.length === receivedCartons.length;
  },

  // Clear all demo data from the mobile device
  // This removes ASN-00045, TO-00012, demo boxes, cartons, and all related data
  clearAllDemoData: async (): Promise<void> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");

      console.log("🗑️ Clearing all demo data from mobile device...");

      // Demo identifiers
      const demoASN = "ASN-00045";
      const demoTO = "TO-00012";
      const demoBoxes = ["BOX-SR01-001", "BOX-SR02-001", "BOX-SR03-001"];
      const demoCartons = ["CTN-001", "CTN-002", "CTN-003", "CTN-004"];

      // 1. Clear all data related to demo ASN
      console.log(`  - Clearing ASN: ${demoASN}`);
      await db.runAsync("DELETE FROM asn_carton_map WHERE asn_no = ?", [
        demoASN,
      ]);
      await db.runAsync("DELETE FROM transfer_order_cache WHERE asn_no = ?", [
        demoASN,
      ]);
      await db.runAsync("DELETE FROM box_cache WHERE asn_no = ?", [demoASN]);
      await db.runAsync("DELETE FROM asn_cache WHERE asn_no = ?", [demoASN]);
      await db.runAsync("DELETE FROM carton_status_cache WHERE asn_no = ?", [
        demoASN,
      ]);
      await db.runAsync("DELETE FROM scanned_items WHERE asn_no = ?", [
        demoASN,
      ]);
      await db.runAsync("DELETE FROM putaway_items_cache WHERE asn_no = ?", [
        demoASN,
      ]);
      await db.runAsync("DELETE FROM event_queue WHERE asn_no = ?", [demoASN]);
      await db.runAsync("DELETE FROM workflow_state_cache WHERE asn_no = ?", [
        demoASN,
      ]);
      await db.runAsync("DELETE FROM tc_cache WHERE asn_no = ?", [demoASN]);

      // 2. Clear demo transfer order (TO-00012) if it exists without ASN
      console.log(`  - Clearing Transfer Order: ${demoTO}`);
      await db.runAsync(
        "DELETE FROM transfer_order_cache WHERE to_no = ? AND (asn_no IS NULL OR asn_no = '')",
        [demoTO]
      );

      // 3. Clear demo boxes by box_id (even if ASN is already cleared)
      console.log(`  - Clearing demo boxes: ${demoBoxes.join(", ")}`);
      for (const boxId of demoBoxes) {
        await db.runAsync("DELETE FROM box_cache WHERE box_id = ?", [boxId]);
        await db.runAsync("DELETE FROM scanned_items WHERE box_id = ?", [
          boxId,
        ]);
        await db.runAsync("DELETE FROM event_queue WHERE box_id = ?", [boxId]);
      }

      // 4. Clear demo cartons from carton status cache (even if ASN is already cleared)
      console.log(`  - Clearing demo cartons: ${demoCartons.join(", ")}`);
      for (const cartonId of demoCartons) {
        await db.runAsync(
          "DELETE FROM carton_status_cache WHERE carton_id = ?",
          [cartonId]
        );
        await db.runAsync("DELETE FROM scanned_items WHERE carton_id = ?", [
          cartonId,
        ]);
        await db.runAsync("DELETE FROM event_queue WHERE carton_id = ?", [
          cartonId,
        ]);
      }

      // 5. Clear any events or data that reference demo identifiers
      console.log("  - Clearing remaining demo references...");
      await db.runAsync(
        "DELETE FROM event_queue WHERE tc_id LIKE 'TC-%' AND asn_no = ?",
        [demoASN]
      );

      console.log("✅ All demo data cleared successfully");
    });
  },

  // Clear demo data ASNs (specifically ASN-00045 and related demo data)
  // Kept for backward compatibility, but now calls clearAllDemoData
  clearDemoASNs: async (): Promise<void> => {
    // Use the clearAllDemoData function defined above
    const db = await getDatabase();
    if (!db) throw new Error("Database not initialized");

    console.log("🗑️ Clearing demo ASN (using clearAllDemoData)...");
    return withRetry(async () => {
      const demoASN = "ASN-00045";
      const demoTO = "TO-00012";
      const demoBoxes = ["BOX-SR01-001", "BOX-SR02-001", "BOX-SR03-001"];
      const demoCartons = ["CTN-001", "CTN-002", "CTN-003", "CTN-004"];

      // Clear all related demo data
      await db.runAsync("DELETE FROM asn_carton_map WHERE asn_no = ?", [
        demoASN,
      ]);
      await db.runAsync("DELETE FROM transfer_order_cache WHERE asn_no = ?", [
        demoASN,
      ]);
      await db.runAsync("DELETE FROM box_cache WHERE asn_no = ?", [demoASN]);
      await db.runAsync("DELETE FROM asn_cache WHERE asn_no = ?", [demoASN]);
      await db.runAsync("DELETE FROM carton_status_cache WHERE asn_no = ?", [
        demoASN,
      ]);
      await db.runAsync("DELETE FROM scanned_items WHERE asn_no = ?", [
        demoASN,
      ]);
      await db.runAsync("DELETE FROM putaway_items_cache WHERE asn_no = ?", [
        demoASN,
      ]);
      await db.runAsync("DELETE FROM event_queue WHERE asn_no = ?", [demoASN]);
      await db.runAsync("DELETE FROM workflow_state_cache WHERE asn_no = ?", [
        demoASN,
      ]);
      await db.runAsync("DELETE FROM tc_cache WHERE asn_no = ?", [demoASN]);

      // Clear demo boxes and cartons
      for (const boxId of demoBoxes) {
        await db.runAsync("DELETE FROM box_cache WHERE box_id = ?", [boxId]);
        await db.runAsync("DELETE FROM scanned_items WHERE box_id = ?", [
          boxId,
        ]);
        await db.runAsync("DELETE FROM event_queue WHERE box_id = ?", [boxId]);
      }

      for (const cartonId of demoCartons) {
        await db.runAsync(
          "DELETE FROM carton_status_cache WHERE carton_id = ?",
          [cartonId]
        );
        await db.runAsync("DELETE FROM scanned_items WHERE carton_id = ?", [
          cartonId,
        ]);
        await db.runAsync("DELETE FROM event_queue WHERE carton_id = ?", [
          cartonId,
        ]);
      }

      console.log(`✅ Cleared demo ASN: ${demoASN}`);
    });
  },

  // Clear ALL data from database (except settings)
  // This will remove all ASNs, cartons, boxes, transfer cartons, events, etc.
  // Use with caution - this cannot be undone!
  clearAllData: async (): Promise<void> => {
    // Queue this operation to prevent concurrent calls
    return queueDbOperation(async () => {
      return withRetry(async () => {
        const db = await getDatabase();
        if (!db) throw new Error("Database not initialized");

        console.log("🗑️ Clearing ALL data from database...");
        console.log("⚠️ WARNING: This will delete all data except settings!");

      // Clear all data tables (in order to respect foreign key constraints)
      // 1. Clear transaction/event data first
      console.log("  - Clearing event queue...");
      await db.runAsync("DELETE FROM event_queue");

      console.log("  - Clearing scanned items...");
      await db.runAsync("DELETE FROM scanned_items");

      console.log("  - Clearing workflow state...");
      await db.runAsync("DELETE FROM workflow_state_cache");

      console.log("  - Clearing carton statuses...");
      await db.runAsync("DELETE FROM carton_status_cache");

      console.log("  - Clearing putaway items...");
      await db.runAsync("DELETE FROM putaway_items_cache");

      // 2. Clear master data cache
      console.log("  - Clearing transfer cartons...");
      await db.runAsync("DELETE FROM tc_cache");

      console.log("  - Clearing boxes...");
      await db.runAsync("DELETE FROM box_cache");

      console.log("  - Clearing transfer orders...");
      await db.runAsync("DELETE FROM transfer_order_cache");

      console.log("  - Clearing ASN carton map...");
      await db.runAsync("DELETE FROM asn_carton_map");

      console.log("  - Clearing ASN cache...");
      await db.runAsync("DELETE FROM asn_cache");

      console.log("  - Clearing warehouse racks...");
      await db.runAsync("DELETE FROM warehouse_rack_cache");
      
      // Clear cycle count data
      console.log("  - Clearing cycle count data...");
      try {
        await db.runAsync("DELETE FROM cycle_count_lines");
        console.log("    - Cycle count lines cleared");
      } catch (error: any) {
        console.warn("    - Could not clear cycle_count_lines:", error.message);
      }
      
      try {
        await db.runAsync("DELETE FROM cycle_count_sessions");
        console.log("    - Cycle count sessions cleared");
      } catch (error: any) {
        console.warn("    - Could not clear cycle_count_sessions:", error.message);
      }
      
      try {
        await db.runAsync("DELETE FROM cycle_count_cache");
        console.log("    - Cycle count cache cleared");
      } catch (error: any) {
        console.warn("    - Could not clear cycle_count_cache:", error.message);
      }
      
      // Clear stock ledger cache (sources expected quantities for cycle count)
      console.log("  - Clearing stock ledger cache...");
      try {
        await db.runAsync("DELETE FROM stock_ledger_cache");
        console.log("    - Stock ledger cache cleared (this was the source of 'Exp: 74')");
      } catch (error: any) {
        console.warn("    - Could not clear stock_ledger_cache:", error.message);
      }
      
      try {
        await db.runAsync("DELETE FROM stock_transaction_cache");
        console.log("    - Stock transaction cache cleared");
      } catch (error: any) {
        console.warn("    - Could not clear stock_transaction_cache:", error.message);
      }

      console.log("  - Clearing item master...");
      await db.runAsync("DELETE FROM item_master");

      console.log("  - Clearing users...");
      await db.runAsync("DELETE FROM users");

      console.log("  - Clearing warehouses...");
      await db.runAsync("DELETE FROM warehouse_cache");

      console.log("  - Clearing locations...");
      await db.runAsync("DELETE FROM location_cache");
      
      console.log("  - Clearing transfer in cache...");
      try {
        await db.runAsync("DELETE FROM transfer_in_cache");
      } catch (error: any) {
        console.warn("    - Could not clear transfer_in_cache:", error.message);
      }
      
      console.log("  - Clearing material request cache...");
      try {
        await db.runAsync("DELETE FROM material_request_cache");
      } catch (error: any) {
        console.warn("    - Could not clear material_request_cache:", error.message);
      }
      
      console.log("  - Clearing bin master cache...");
      try {
        await db.runAsync("DELETE FROM bin_master_cache");
      } catch (error: any) {
        console.warn("    - Could not clear bin_master_cache:", error.message);
      }
      
      console.log("  - Clearing item barcode map...");
      try {
        await db.runAsync("DELETE FROM item_barcode_map");
      } catch (error: any) {
        console.warn("    - Could not clear item_barcode_map:", error.message);
      }

      // 3. Clear active session from settings (but keep other settings)
      console.log("  - Clearing active session from settings...");
      await db.runAsync(
        "UPDATE settings SET active_asn = NULL, active_session = NULL"
      );

      console.log("✅ All data cleared successfully!");
      console.log(
        "ℹ️ Settings (API URL, Device ID, User ID, etc.) are preserved."
      );
      });
    });
  },

  // Session Management
  saveInboundSession: async (session: {
    inbound_session: string;
    asn_no?: string | null;
    transfer_in?: string | null;
    transfer_order?: string;
    dock?: string;
    status?: string;
    completed_cartons?: number;
    total_cartons?: number;
    started_by?: string;
    started_on?: string;
    completed_on?: string;
    synced?: number;
  }) => {
    try {
      const db = await getDatabase();
      const now = new Date().toISOString();

      // Check if table exists first, create if not
      const tableInfo = await db.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='inbound_sessions'"
      );

      if (tableInfo.length === 0) {
        console.log("📝 Creating inbound_sessions table...");
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS inbound_sessions (
            inbound_session TEXT PRIMARY KEY,
            asn_no TEXT,
            transfer_order TEXT,
            dock TEXT,
            status TEXT DEFAULT 'Active',
            completed_cartons INTEGER DEFAULT 0,
            total_cartons INTEGER DEFAULT 0,
            started_by TEXT,
            started_on TEXT,
            completed_on TEXT,
            synced INTEGER DEFAULT 0,
            updated_on TEXT
          );
        `);
        console.log("✅ Created inbound_sessions table");
      }

      await db.runAsync(
        `INSERT OR REPLACE INTO inbound_sessions (
          inbound_session, asn_no, transfer_in, transfer_order, dock, status,
          completed_cartons, total_cartons, started_by, started_on,
          completed_on, synced, updated_on
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.inbound_session,
          session.asn_no || null,
          session.transfer_in || null,
          session.transfer_order || null,
          session.dock || null,
          session.status || "Receiving",
          session.completed_cartons || 0,
          session.total_cartons || 0,
          session.started_by || null,
          session.started_on || now,
          session.completed_on || null,
          session.synced || 0,
          now,
        ]
      );
    } catch (error: any) {
      console.error("❌ Error saving inbound session:", error.message);
      throw error;
    }
  },

  getInboundSession: async (
    inbound_session: string
  ): Promise<{
    inbound_session: string;
    asn_no: string;
    transfer_order: string | null;
    dock: string | null;
    status: string;
    completed_cartons: number;
    total_cartons: number;
    started_by: string | null;
    started_on: string | null;
    completed_on: string | null;
    synced: number;
    updated_on: string;
  } | null> => {
    try {
      const db = await getDatabase();

      if (!db) {
        console.error("❌ Database is null, cannot get inbound session");
        return null;
      }

      // Check if table exists first
      let tableInfo: Array<{ name: string }> = [];
      try {
        tableInfo = await db.getAllAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='inbound_sessions'"
        );
      } catch (checkError: any) {
        console.warn("⚠️ Error checking table existence:", checkError.message);
        // If check fails, try to query anyway - table might exist
      }

      if (tableInfo.length === 0) {
        console.log("⚠️ inbound_sessions table does not exist yet");
        return null;
      }

      const session = await db.getFirstAsync<{
        inbound_session: string;
        asn_no: string;
        transfer_order: string | null;
        dock: string | null;
        status: string;
        completed_cartons: number;
        total_cartons: number;
        started_by: string | null;
        started_on: string | null;
        completed_on: string | null;
        synced: number;
        updated_on: string;
      }>("SELECT * FROM inbound_sessions WHERE inbound_session = ?", [
        inbound_session,
      ]);
      return session || null;
    } catch (error: any) {
      console.error("❌ Error getting inbound session:", error);
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
      return null;
    }
  },

  updateInboundSessionStatus: async (
    inbound_session: string,
    status: "Active" | "Completed" | "Cancelled",
    completed_cartons?: number,
    total_cartons?: number
  ) => {
    try {
      const db = await getDatabase();

      // Check if table exists first
      const tableInfo = await db.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='inbound_sessions'"
      );

      if (tableInfo.length === 0) {
        console.log(
          "⚠️ inbound_sessions table does not exist yet, cannot update"
        );
        return;
      }

      const now = new Date().toISOString();

      const updates: string[] = ["status = ?", "updated_on = ?"];
      const values: any[] = [status, now];

      if (completed_cartons !== undefined) {
        updates.push("completed_cartons = ?");
        values.push(completed_cartons);
      }

      if (total_cartons !== undefined) {
        updates.push("total_cartons = ?");
        values.push(total_cartons);
      }

      if (status === "Completed") {
        updates.push("completed_on = ?");
        values.push(now);
      }

      values.push(inbound_session);

      await db.runAsync(
        `UPDATE inbound_sessions SET ${updates.join(
          ", "
        )} WHERE inbound_session = ?`,
        values
      );
    } catch (error: any) {
      console.error("❌ Error updating inbound session status:", error.message);
      // Don't throw - allow workflow to continue
    }
  },

  markSessionUnsynced: async (inbound_session: string) => {
    try {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");

      await db.runAsync(
        "UPDATE inbound_sessions SET synced = 0 WHERE inbound_session = ?",
        [inbound_session]
      );
      console.log(`🔄 Marked session ${inbound_session} as unsynced`);
    } catch (error: any) {
      console.error("❌ Error marking session as unsynced:", error);
      throw error;
    }
  },

  markSessionSynced: async (inbound_session: string) => {
    try {
      const db = await getDatabase();

      // Check if table exists first
      const tableInfo = await db.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='inbound_sessions'"
      );

      if (tableInfo.length === 0) {
        console.log(
          "⚠️ inbound_sessions table does not exist yet, cannot mark as synced"
        );
        return;
      }

      await db.runAsync(
        "UPDATE inbound_sessions SET synced = 1, updated_on = ? WHERE inbound_session = ?",
        [new Date().toISOString(), inbound_session]
      );
    } catch (error: any) {
      console.error("❌ Error marking session as synced:", error.message);
      // Don't throw - allow workflow to continue
    }
  },

  getUnsyncedSessions: async (): Promise<
    Array<{
      inbound_session: string;
      asn_no: string;
      transfer_order: string | null;
      dock: string | null;
      status: string;
      completed_cartons: number;
      total_cartons: number;
      started_by: string | null;
      started_on: string | null;
      completed_on: string | null;
      updated_on: string;
    }>
  > => {
    try {
      const db = await getDatabase();

      if (!db) {
        console.error("❌ Database is null, cannot get unsynced sessions");
        return [];
      }

      // Check if table exists first
      let tableInfo: Array<{ name: string }> = [];
      try {
        tableInfo = await db.getAllAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='inbound_sessions'"
        );
      } catch (checkError: any) {
        console.warn("⚠️ Error checking table existence:", checkError.message);
        // If check fails, try to query anyway - table might exist
      }

      if (tableInfo.length === 0) {
        console.log(
          "⚠️ inbound_sessions table does not exist yet, returning empty array"
        );
        return [];
      }

      const sessions = await db.getAllAsync<{
        inbound_session: string;
        asn_no: string;
        transfer_order: string | null;
        dock: string | null;
        status: string;
        completed_cartons: number;
        total_cartons: number;
        started_by: string | null;
        started_on: string | null;
        completed_on: string | null;
        updated_on: string;
      }>(
        "SELECT * FROM inbound_sessions WHERE synced = 0 ORDER BY updated_on DESC"
      );
      return sessions || [];
    } catch (error: any) {
      console.error("❌ Error getting unsynced sessions:", error);
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
        name: error.name,
      });
      // Return empty array if table doesn't exist or query fails
      return [];
    }
  },

  // Get warehouse/store info by code
  getWarehouseStoreByCode: async (code: string): Promise<{
    code: string;
    name: string;
    warehouse_type: string;
    is_group: number;
    parent_warehouse: string | null;
  } | null> => {
    return withRetry(async () => {
      const db = await getDatabase();
      if (!db) throw new Error("Database not initialized");
      
      const result = await db.getFirstAsync<{
        code: string;
        name: string;
        warehouse_type: string;
        is_group: number;
        parent_warehouse: string | null;
      }>(
        "SELECT * FROM warehouse_store_cache WHERE code = ?",
        [code]
      );
      
      return result || null;
    });
  },

  // Check if a store code is a warehouse based on warehouse_type
  isWarehouse: async (storeCode: string): Promise<boolean> => {
    try {
      const ws = await dataService.getWarehouseStoreByCode(storeCode);
      if (ws && ws.warehouse_type === "Warehouse") {
        return true;
      }
      // Fallback to code pattern matching for backward compatibility
      const codeUpper = storeCode.toUpperCase().trim();
      return codeUpper === "WAREHOUSE" || codeUpper.startsWith("WH-");
    } catch (error: any) {
      // Fallback to code pattern matching if lookup fails
      const codeUpper = storeCode.toUpperCase().trim();
      return codeUpper === "WAREHOUSE" || codeUpper.startsWith("WH-");
    }
  },

  // Generate session ID based on ASN-Device-User combination
  generateSessionId: (asn_no: string, device_id: string, user_id: string): string => {
    // Remove special characters and normalize
    const cleanASN = asn_no.replace(/[^A-Z0-9]/g, "").toUpperCase();
    const cleanDevice = device_id.replace(/[^A-Z0-9]/g, "").toUpperCase();
    const cleanUser = user_id.replace(/[^A-Z0-9]/g, "").toUpperCase();
    
    // Format: SESSION-{ASN_NUMBER}-{DEVICE_ID}-{USER_ID}
    return `SESSION-${cleanASN}-${cleanDevice}-${cleanUser}`;
  },

  // Get all sessions for a specific ASN-Device-User combination
  getSessionsByCombination: async (
    asn_no: string,
    device_id: string,
    user_id: string
  ): Promise<
    Array<{
      inbound_session: string;
      asn_no: string;
      transfer_order: string | null;
      dock: string | null;
      status: string;
      completed_cartons: number;
      total_cartons: number;
      started_by: string | null;
      started_on: string | null;
      completed_on: string | null;
      updated_on: string;
    }>
  > => {
    try {
      const db = await getDatabase();

      if (!db) {
        console.error("❌ Database is null, cannot get sessions by combination");
        return [];
      }

      // Check if table exists first
      let tableInfo: Array<{ name: string }> = [];
      try {
        tableInfo = await db.getAllAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='inbound_sessions'"
        );
      } catch (checkError: any) {
        console.warn("⚠️ Error checking table existence:", checkError.message);
      }

      if (tableInfo.length === 0) {
        return [];
      }

      // Get sessions where ASN matches and started_by matches user_id
      // The session ID itself contains the device_id, so we can filter by that
      const normalizedASN = normalizeASN(asn_no);
      
      // Generate expected session ID pattern
      const cleanASN = normalizedASN.replace(/[^A-Z0-9]/g, "").toUpperCase();
      const cleanDevice = device_id.replace(/[^A-Z0-9]/g, "").toUpperCase();
      const cleanUser = user_id.replace(/[^A-Z0-9]/g, "").toUpperCase();
      const expectedSessionId = `SESSION-${cleanASN}-${cleanDevice}-${cleanUser}`;
      
      // Get all sessions for this ASN and user, then filter by session ID pattern
      const sessions = await db.getAllAsync<{
        inbound_session: string;
        asn_no: string;
        transfer_order: string | null;
        dock: string | null;
        status: string;
        completed_cartons: number;
        total_cartons: number;
        started_by: string | null;
        started_on: string | null;
        completed_on: string | null;
        updated_on: string;
      }>(
        "SELECT * FROM inbound_sessions WHERE asn_no = ? AND started_by = ? ORDER BY started_on DESC",
        [normalizedASN, user_id]
      );

      // Filter sessions that match the expected session ID pattern
      // This ensures we only return sessions for the exact ASN-Device-User combination
      const matchingSessions = sessions.filter(session => {
        // Check if session ID exactly matches the expected pattern
        return session.inbound_session === expectedSessionId;
      });

      return matchingSessions;
    } catch (error: any) {
      console.error("❌ Error getting sessions by combination:", error);
      return [];
    }
  },

  // Delete all sessions from the database
  deleteAllSessions: async (): Promise<number> => {
    // Queue this operation to prevent concurrent calls
    return queueDbOperation(async () => {
      return withRetry(async () => {
        const db = await getDatabase();

      if (!db) {
        console.error("❌ Database is null, cannot delete sessions");
        return 0;
      }

      // Check if table exists first
      let tableInfo: Array<{ name: string }> = [];
      try {
        tableInfo = await db.getAllAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='inbound_sessions'"
        );
      } catch (checkError: any) {
        // If it's a locking error, let withRetry handle it
        const isLockedError = 
          checkError?.message?.includes("database is locked") ||
          checkError?.message?.includes("locked") ||
          checkError?.code === "SQLITE_BUSY" ||
          checkError?.code === "SQLITE_LOCKED";
        
        if (isLockedError) {
          throw checkError; // Let withRetry handle it
        }
        console.warn("⚠️ Error checking table existence:", checkError.message);
      }

      if (tableInfo.length === 0) {
        console.log("⚠️ inbound_sessions table does not exist, nothing to delete");
        // Still clear active session from settings even if table doesn't exist
        try {
          const { saveSettings } = await import("./settings.service");
          await saveSettings({
            active_asn: null,
            active_session: null,
          });
          console.log("✅ Cleared active session from settings");
        } catch (settingsError: any) {
          console.warn("⚠️ Failed to clear active session from settings:", settingsError.message);
        }
        return 0;
      }

      // Get count before deletion
      const countResult = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM inbound_sessions"
      );
      const count = countResult?.count || 0;

      // Delete all sessions
      await db.runAsync("DELETE FROM inbound_sessions");
      console.log(`✅ Deleted ${count} session(s) from database`);

      // Also clear active session from settings
      try {
        const { saveSettings } = await import("./settings.service");
        await saveSettings({
          active_asn: null,
          active_session: null,
        });
        console.log("✅ Cleared active session from settings");
      } catch (settingsError: any) {
        console.warn("⚠️ Failed to clear active session from settings:", settingsError.message);
        // Don't throw - sessions were deleted successfully
      }

      return count;
      }, 5, 50); // 5 retries with 50ms base delay (exponential backoff)
    });
  },
};
