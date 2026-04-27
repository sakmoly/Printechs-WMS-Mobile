import { getDatabase } from "../database/database";
import { apiService } from "./api.service";
import { getSettings } from "./settings.service";
import { normalizeASN } from "../utils/asn";
import { canonicalStoreForToLine } from "../utils/to-store-master";
import {
  storeFieldFromAllocationRow,
  itemCodeFromAllocationRow,
} from "../utils/allocation-row-fields";
import { generateUUID } from "../utils/uuid";
import { syncItemMasterPaged } from "./item-master-sync.service";
import { createdByFromApiBox } from "../utils/box-created-by";

interface MasterDataSyncResult {
  items: { synced: number; failed: number };
  asns: { synced: number; failed: number };
  transferOrders: { synced: number; failed: number };
  boxes: { synced: number; failed: number };
  transferCartons: { synced: number; failed: number };
  warehouseRacks: { synced: number; failed: number };
  warehouses: { synced: number; failed: number };
  locations: { synced: number; failed: number };
  binMaster: { synced: number; failed: number };
  stockLedger: { synced: number; failed: number };
  itemBarcodeMap: { synced: number; failed: number };
}

/** Number of major phases in syncMasterDataFromDesktop (for UI progress). */
export const MASTER_SYNC_TOTAL_STEPS = 12;

export type MasterSyncProgress = {
  step: number;
  totalSteps: number;
  phase: string;
  detail?: string;
};

export type MasterDataSyncOptions = {
  onProgress?: (progress: MasterSyncProgress) => void;
};

// Helper function to extract array from nested response formats
const extractArrayFromResponse = (response: any, logPrefix: string): any[] => {
  if (Array.isArray(response)) {
    console.log(`${logPrefix}: Found ${response.length} items (direct array)`);
    return response;
  }

  if (response && typeof response === "object") {
    // Format: { data: [...], success: true }
    if (Array.isArray(response.data)) {
      console.log(
        `${logPrefix}: Found ${response.data.length} items (nested in data)`,
      );
      return response.data;
    }
    // Format: { data: { items: [...] }, success: true }
    if (response.data && Array.isArray(response.data.items)) {
      console.log(
        `${logPrefix}: Found ${response.data.items.length} items (nested in data.items)`,
      );
      return response.data.items;
    }
    // Format: { items: [...] }
    if (Array.isArray(response.items)) {
      console.log(
        `${logPrefix}: Found ${response.items.length} items (nested in items)`,
      );
      return response.items;
    }

    console.warn(
      `${logPrefix}: Unexpected response format:`,
      JSON.stringify(response).substring(0, 200),
    );
  }

  console.warn(`${logPrefix}: No array found in response`);
  return [];
};

/** Collapse duplicate bin rows (same location_id / bin_code). Last row wins — typical when pagination returns overlapping pages. */
function dedupeBinMasterByLocationKey(bins: any[]): {
  unique: any[];
  duplicatesDropped: number;
} {
  const byKey = new Map<string, any>();
  const withoutKey: any[] = [];
  let duplicatesDropped = 0;

  for (const bin of bins) {
    const key = String(bin.location_id || bin.bin_code || "").trim();
    if (!key) {
      withoutKey.push(bin);
      continue;
    }
    if (byKey.has(key)) duplicatesDropped++;
    byKey.set(key, bin);
  }

  return {
    unique: [...Array.from(byKey.values()), ...withoutKey],
    duplicatesDropped,
  };
}

export const syncMasterDataFromDesktop = async (
  options?: MasterDataSyncOptions,
): Promise<MasterDataSyncResult> => {
  const settings = await getSettings();

  // Check if in demo mode
  // ✅ REMOVED: Demo mode check - master data sync always goes to backend
  if (!settings.api_url) {
    throw new Error("API URL is required for master data sync");
  }

  if (!settings.api_url) {
    throw new Error("API URL not configured");
  }

  const result: MasterDataSyncResult = {
    items: { synced: 0, failed: 0 },
    asns: { synced: 0, failed: 0 },
    transferOrders: { synced: 0, failed: 0 },
    boxes: { synced: 0, failed: 0 },
    transferCartons: { synced: 0, failed: 0 },
    warehouseRacks: { synced: 0, failed: 0 },
    warehouses: { synced: 0, failed: 0 },
    locations: { synced: 0, failed: 0 },
    binMaster: { synced: 0, failed: 0 },
    stockLedger: { synced: 0, failed: 0 },
    itemBarcodeMap: { synced: 0, failed: 0 },
  };

  const db = await getDatabase();
  if (!db) throw new Error("Database not initialized");

  const onProgress = options?.onProgress;
  const report = (step: number, phase: string, detail?: string) => {
    if (!onProgress) return;
    try {
      onProgress({
        step,
        totalSteps: MASTER_SYNC_TOTAL_STEPS,
        phase,
        detail,
      });
    } catch {
      /* listener must not break sync */
    }
  };

  // Note: Demo data is not used in production - only real data from desktop API

  try {
    // 1. Sync Item Master (paged API + bulk local insert)
    try {
      report(1, "Items", "Downloading from server…");
      const itemRes = await syncItemMasterPaged(db, {
        onProgress: (detail) => report(1, "Items", detail),
      });
      result.items.synced = itemRes.synced;
      result.items.failed = itemRes.failed;
    } catch (error: any) {
      const errorMsg = error.message || error.toString() || "Unknown error";
      // 404 or 500 means endpoint not implemented or has issues - this is optional, just log a warning
      if (
        errorMsg.includes("404") ||
        errorMsg.includes("500") ||
        errorMsg.includes("not found") ||
        errorMsg.includes("Server error")
      ) {
        console.warn(
          `⚠️ Item Master endpoint issue (${
            errorMsg.includes("404") ? "404" : "500"
          }) - skipping. This endpoint is optional. Items can still be scanned by item code directly.`,
        );
      } else {
        console.error(
          `❌ Failed to pull item master: ${errorMsg}\n` +
            `   This is a non-optional error. Check backend server logs for details.`,
        );
        result.items.failed++;
      }
    }

    // Small delay between sync steps to allow UI updates
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 2. Sync ASN Data
    try {
      report(2, "ASNs", "Downloading from server…");
      const response = await apiService.pullASNData();
      const asns = extractArrayFromResponse(response, "📋 ASNs");
      report(
        2,
        "ASNs",
        asns.length
          ? `Processing ${asns.length.toLocaleString()} ASNs…`
          : "No ASNs in response",
      );

      console.log(`📋 ASN Sync: Received ${asns.length} ASNs from API`);
      if (asns.length > 0) {
        console.log(
          `📋 Sample ASN structure:`,
          JSON.stringify(asns[0], null, 2),
        );
      }

      for (let asnIndex = 0; asnIndex < asns.length; asnIndex++) {
        const asn = asns[asnIndex];
        try {
          // Handle both 'asn_no' and 'title' fields (API might use either)
          const asnNumber = asn.asn_no || asn.title;
          if (!asnNumber) {
            console.warn("⚠️ Skipping ASN without asn_no or title:", asn);
            continue;
          }

          // Store ASN exactly as received from API - preserve original format (3, 4, 5, 10 digits, etc.)
          // No normalization - show ASN exactly as it comes from backend/desktop
          const apiASN = asnNumber.trim().toUpperCase();
          // Use original format as primary key - no normalization
          const asnPrimaryKey = apiASN;

          console.log(
            `📋 Syncing ASN: API returned="${asnNumber}", Storing exactly as="${apiASN}" (preserving original format)`,
          );
          console.log(`📋 ASN Object Keys:`, Object.keys(asn));
          console.log(`📋 ASN Data:`, {
            asn_no_original: asn.asn_no || asn.title,
            asn_no_stored: asnPrimaryKey, // Original format from API (no normalization)
            has_total_carton_count: asn.total_carton_count !== undefined,
            total_carton_count: asn.total_carton_count,
            has_total_shipped_qty: asn.total_shipped_qty !== undefined,
            total_shipped_qty: asn.total_shipped_qty,
            has_cartons: !!asn.cartons,
            cartons_length: asn.cartons?.length || 0,
            has_details: !!asn.details,
            details_length: asn.details?.length || 0,
            has_payload_json: !!asn.payload_json,
            payload_json_type: typeof asn.payload_json,
          });

          // Extract fields from the ASN object
          const status = asn.status || null;
          const purchase_order = asn.purchase_order || null;
          const supplier = asn.supplier || null;
          const shipment_date = asn.shipment_date || null;
          const expected_arrival_date = asn.expected_arrival_date || null;
          // Ensure numeric values are properly converted
          // Support multiple field name variations from backend
          const total_shipped_qty =
            asn.total_shipped_qty !== undefined &&
            asn.total_shipped_qty !== null
              ? Number(asn.total_shipped_qty)
              : asn.total_qty !== undefined && asn.total_qty !== null
                ? Number(asn.total_qty)
                : asn.shipped_qty !== undefined && asn.shipped_qty !== null
                  ? Number(asn.shipped_qty)
                  : asn.totalShippedQty !== undefined &&
                      asn.totalShippedQty !== null
                    ? Number(asn.totalShippedQty)
                    : null;
          const total_carton_count =
            asn.total_carton_count !== undefined &&
            asn.total_carton_count !== null
              ? Number(asn.total_carton_count)
              : asn.total_cartons !== undefined && asn.total_cartons !== null
                ? Number(asn.total_cartons)
                : asn.carton_count !== undefined && asn.carton_count !== null
                  ? Number(asn.carton_count)
                  : null;
          const airway_bill_no = asn.airway_bill_no || null;
          const shipment_type = asn.shipment_type || null;

          // Build payload_json if not provided
          let payload_json = asn.payload_json;

          // Try to parse payload_json to extract missing fields
          let parsedPayload: any = null;
          if (payload_json) {
            try {
              parsedPayload =
                typeof payload_json === "string"
                  ? JSON.parse(payload_json)
                  : payload_json;

              // Extract fields from parsed payload if not already in ASN object
              // Support multiple field name variations
              if (
                !asn.total_carton_count &&
                (parsedPayload.total_carton_count ||
                  parsedPayload.total_cartons ||
                  parsedPayload.carton_count)
              ) {
                asn.total_carton_count =
                  parsedPayload.total_carton_count ||
                  parsedPayload.total_cartons ||
                  parsedPayload.carton_count;
              }
              if (
                !asn.total_shipped_qty &&
                (parsedPayload.total_shipped_qty ||
                  parsedPayload.total_qty ||
                  parsedPayload.shipped_qty ||
                  parsedPayload.totalShippedQty)
              ) {
                asn.total_shipped_qty =
                  parsedPayload.total_shipped_qty ||
                  parsedPayload.total_qty ||
                  parsedPayload.shipped_qty ||
                  parsedPayload.totalShippedQty;
              }
              if (!asn.status && parsedPayload.status) {
                asn.status = parsedPayload.status;
              }
              if (!asn.details && parsedPayload.details) {
                asn.details = parsedPayload.details;
              }
              if (!asn.cartons && parsedPayload.cartons) {
                asn.cartons = parsedPayload.cartons;
              }
            } catch (parseError) {
              console.warn(
                `⚠️ Failed to parse payload_json for ASN ${asnPrimaryKey}:`,
                parseError,
              );
            }
          }

          if (!payload_json && (asn.transfer_order || asn.dock)) {
            payload_json = JSON.stringify({
              asn_no: asnPrimaryKey, // Use original format
              transfer_order: asn.transfer_order || null,
              dock: asn.dock || null,
            });
          } else if (!payload_json) {
            payload_json = JSON.stringify(asn);
          }

          // Re-extract numeric values after potentially updating from payload_json
          // Support multiple field name variations
          let final_total_shipped_qty =
            asn.total_shipped_qty !== undefined &&
            asn.total_shipped_qty !== null
              ? Number(asn.total_shipped_qty)
              : asn.total_qty !== undefined && asn.total_qty !== null
                ? Number(asn.total_qty)
                : asn.shipped_qty !== undefined && asn.shipped_qty !== null
                  ? Number(asn.shipped_qty)
                  : asn.totalShippedQty !== undefined &&
                      asn.totalShippedQty !== null
                    ? Number(asn.totalShippedQty)
                    : null;
          const final_total_carton_count =
            asn.total_carton_count !== undefined &&
            asn.total_carton_count !== null
              ? Number(asn.total_carton_count)
              : asn.total_cartons !== undefined && asn.total_cartons !== null
                ? Number(asn.total_cartons)
                : asn.carton_count !== undefined && asn.carton_count !== null
                  ? Number(asn.carton_count)
                  : null;

          // Log what we found for debugging
          console.warn(
            `📊 ASN ${asnPrimaryKey} total_shipped_qty extraction:`,
            {
              total_shipped_qty: asn.total_shipped_qty,
              total_qty: asn.total_qty,
              shipped_qty: asn.shipped_qty,
              totalShippedQty: asn.totalShippedQty,
              final_value: final_total_shipped_qty,
            },
          );

          // Store ASN exactly as received from API - use original format as primary key
          // Both asn_no and asn_no_original will be the same (original format from backend)
          await db.runAsync(
            `INSERT OR REPLACE INTO asn_cache (
                asn_no, asn_no_original, status, purchase_order, supplier, shipment_date, 
                expected_arrival_date, total_shipped_qty, total_carton_count, 
                airway_bill_no, shipment_type, payload_json, updated_on
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              asnPrimaryKey, // Primary key (original format from API - no normalization)
              asnPrimaryKey, // Display format (same as primary key - original format)
              status,
              purchase_order,
              supplier,
              shipment_date,
              expected_arrival_date,
              final_total_shipped_qty,
              final_total_carton_count,
              airway_bill_no,
              shipment_type,
              payload_json,
              asn.updated_on || new Date().toISOString(),
            ],
          );

          // Sync ASN carton map if provided
          // IMPORTANT: Clear old carton mappings for this ASN first to prevent stale data
          // This ensures we only have cartons that match the current backend data
          console.log(
            `🗑️ Clearing old carton mappings for ASN ${asnPrimaryKey} before syncing...`,
          );
          await db.runAsync(`DELETE FROM asn_carton_map WHERE asn_no = ?`, [
            asnPrimaryKey,
          ]);

          // Check both asn.cartons (from detail API) and asn.details (from list API)
          let cartonMapSynced = false;
          const syncedCartonIds = new Set<string>();

          if (asn.cartons && Array.isArray(asn.cartons)) {
            // Format from detail API: { cartons: [{ carton_id, items: [{ item_code, shipped_qty }] }] }
            console.log(
              `📦 Syncing ${asn.cartons.length} carton(s) from API for ASN ${asnPrimaryKey}...`,
            );
            for (const carton of asn.cartons) {
              if (!carton.carton_id) {
                console.warn(`⚠️ Skipping carton without carton_id:`, carton);
                continue;
              }
              syncedCartonIds.add(carton.carton_id);
              console.log(`  📦 Carton: ${carton.carton_id}`);

              if (carton.items && Array.isArray(carton.items)) {
                for (const item of carton.items) {
                  try {
                    await db.runAsync(
                      `INSERT OR REPLACE INTO asn_carton_map 
                         (asn_no, carton_id, item_code, shipped_qty) 
                         VALUES (?, ?, ?, ?)`,
                      [
                        asnPrimaryKey, // Use original format (no normalization)
                        carton.carton_id,
                        item.item_code,
                        item.shipped_qty || 0,
                      ],
                    );
                    cartonMapSynced = true;
                  } catch (error: any) {
                    console.error(
                      `Failed to sync carton item ${carton.carton_id}/${item.item_code}:`,
                      error,
                    );
                  }
                }
              }
            }
          } else if (asn.details && Array.isArray(asn.details)) {
            // Format from list API: { details: [{ item_code, shipped_qty, carton_id }] }
            console.log(
              `📦 Syncing ${asn.details.length} detail(s) from API for ASN ${asnPrimaryKey}...`,
            );
            for (const detail of asn.details) {
              if (detail.carton_id && detail.item_code) {
                if (!syncedCartonIds.has(detail.carton_id)) {
                  syncedCartonIds.add(detail.carton_id);
                  console.log(`  📦 Carton: ${detail.carton_id}`);
                }
                try {
                  await db.runAsync(
                    `INSERT OR REPLACE INTO asn_carton_map 
                       (asn_no, carton_id, item_code, shipped_qty) 
                       VALUES (?, ?, ?, ?)`,
                    [
                      asnPrimaryKey, // Use original format (no normalization)
                      detail.carton_id,
                      detail.item_code,
                      detail.shipped_qty || 0,
                    ],
                  );
                  cartonMapSynced = true;
                } catch (error: any) {
                  console.error(
                    `Failed to sync carton item ${detail.carton_id}/${detail.item_code}:`,
                    error,
                  );
                }
              }
            }
          }

          // Log synced carton IDs for debugging
          if (cartonMapSynced && syncedCartonIds.size > 0) {
            console.log(
              `✅ Synced carton IDs for ASN ${asnPrimaryKey}:`,
              Array.from(syncedCartonIds).sort().join(", "),
            );

            // Clear old carton statuses that don't match the synced cartons
            // This prevents showing stale carton IDs (e.g., CTN-0101 when API returns CTN-0001)
            console.log(
              `🗑️ Clearing old carton statuses for ASN ${asnPrimaryKey} that don't match synced cartons...`,
            );
            const validCartonIdsList = Array.from(syncedCartonIds);
            const placeholders = validCartonIdsList.map(() => "?").join(",");
            const deletedCount = await db.runAsync(
              `DELETE FROM carton_status_cache 
                 WHERE asn_no = ? 
                 AND carton_id NOT IN (${placeholders})`,
              [asnPrimaryKey, ...validCartonIdsList],
            );
            console.log(
              `✅ Cleared old carton statuses for ASN ${asnPrimaryKey} (removed cartons not in synced list)`,
            );
          }

          // Log if carton map was synced or not
          if (!cartonMapSynced) {
            console.log(
              `⚠️ ASN ${asnPrimaryKey} has no cartons/details array - carton map not populated. Using total_carton_count (${final_total_carton_count}) and total_shipped_qty (${final_total_shipped_qty}) from ASN object.`,
            );
          } else {
            console.log(
              `✅ ASN ${asnPrimaryKey} carton map synced successfully`,
            );
          }

          // Always verify/update total_shipped_qty by calculating from cartons if carton map exists
          // This ensures accuracy even if API returns incorrect value
          // Check if carton map has data (either just synced or from previous sync)
          const cartonMapCount = await db.getFirstAsync<{ count: number }>(
            "SELECT COUNT(*) as count FROM asn_carton_map WHERE asn_no = ?",
            [asnPrimaryKey],
          );
          const hasCartonMapData = (cartonMapCount?.count || 0) > 0;

          if (hasCartonMapData) {
            const calculatedQty = await db.getFirstAsync<{ total: number }>(
              "SELECT SUM(shipped_qty) as total FROM asn_carton_map WHERE asn_no = ?",
              [asnPrimaryKey],
            );
            const calculatedTotal = calculatedQty?.total || 0;

            console.warn(
              `📊 ASN ${asnPrimaryKey}: Verifying total_shipped_qty - API value: ${final_total_shipped_qty}, Calculated from ${
                cartonMapCount?.count || 0
              } carton map entries: ${calculatedTotal}`,
            );

            // Always use calculated value if it's greater than 0 and different from API value
            // This ensures we use the accurate sum from carton map
            if (calculatedTotal > 0) {
              if (
                !final_total_shipped_qty ||
                calculatedTotal !== final_total_shipped_qty
              ) {
                console.warn(
                  `⚠️ ASN ${asnPrimaryKey}: Updating total_shipped_qty - API: ${
                    final_total_shipped_qty || "null"
                  }, Calculated from cartons: ${calculatedTotal}. Using calculated value (more accurate).`,
                );
                await db.runAsync(
                  `UPDATE asn_cache SET total_shipped_qty = ? WHERE asn_no = ?`,
                  [calculatedTotal, asnPrimaryKey],
                );
                final_total_shipped_qty = calculatedTotal;
              } else {
                console.warn(
                  `✅ ASN ${asnPrimaryKey}: total_shipped_qty matches calculated value: ${calculatedTotal}`,
                );
              }
            } else {
              console.warn(
                `⚠️ ASN ${asnPrimaryKey}: Carton map exists but calculated total is 0. Keeping API value: ${final_total_shipped_qty}`,
              );
            }
          } else {
            console.warn(
              `ℹ️ ASN ${asnPrimaryKey}: No carton map data found. Using API value: ${final_total_shipped_qty}`,
            );
          }

          console.log(`✅ ASN synced:`, {
            asn_no: asnPrimaryKey, // Original format from backend (preserved exactly)
            total_carton_count: final_total_carton_count,
            total_shipped_qty: final_total_shipped_qty,
            carton_map_synced: cartonMapSynced,
            has_payload_json: !!payload_json,
            payload_parsed: !!parsedPayload,
            payload_keys: parsedPayload ? Object.keys(parsedPayload) : [],
          });

          // Verify the stored values
          const verify = await db.getFirstAsync<{
            asn_no: string;
            asn_no_original: string | null;
          }>("SELECT asn_no, asn_no_original FROM asn_cache WHERE asn_no = ?", [
            asnPrimaryKey,
          ]);

          if (verify) {
            console.log(`✅ Verified stored ASN:`, {
              asn_no: verify.asn_no,
              asn_no_original: verify.asn_no_original,
              display_format_matches_api:
                verify.asn_no_original === asnPrimaryKey,
            });
          }

          // Log warning if no data was found
          if (
            !final_total_carton_count &&
            !final_total_shipped_qty &&
            !cartonMapSynced
          ) {
            console.warn(
              `⚠️ ASN ${asnPrimaryKey}: No carton/piece data found in API response!`,
            );
            console.warn(
              `⚠️ ASN ${asnPrimaryKey}: Full ASN object:`,
              JSON.stringify(asn, null, 2),
            );

            // Try to fetch ASN details from detail endpoint as fallback
            try {
              console.log(
                `🔄 ASN ${asnPrimaryKey}: Attempting to fetch details from /api/asn/${asnPrimaryKey}...`,
              );
              const { apiService: apiServiceDetail } =
                await import("./api.service");
              const asnDetail = await apiServiceDetail.getASN(asnPrimaryKey);

              if (
                asnDetail &&
                asnDetail.cartons &&
                Array.isArray(asnDetail.cartons)
              ) {
                console.log(
                  `✅ ASN ${asnPrimaryKey}: Found ${asnDetail.cartons.length} cartons in detail response`,
                );

                // Update total_carton_count
                const detailCartonCount = asnDetail.cartons.length;
                if (detailCartonCount > 0) {
                  await db.runAsync(
                    `UPDATE asn_cache SET total_carton_count = ? WHERE asn_no = ?`,
                    [detailCartonCount, asnPrimaryKey],
                  );
                  console.log(
                    `✅ ASN ${asnPrimaryKey}: Updated total_carton_count to ${detailCartonCount}`,
                  );
                }

                // Calculate total_shipped_qty from cartons
                // This is the authoritative source - sum all items from all cartons
                let detailTotalQty = 0;
                for (const carton of asnDetail.cartons) {
                  if (carton.items && Array.isArray(carton.items)) {
                    for (const item of carton.items) {
                      detailTotalQty += Number(item.shipped_qty || 0);

                      // Also populate asn_carton_map
                      try {
                        await db.runAsync(
                          `INSERT OR REPLACE INTO asn_carton_map 
                             (asn_no, carton_id, item_code, shipped_qty) 
                             VALUES (?, ?, ?, ?)`,
                          [
                            asnPrimaryKey, // Use original format (no normalization)
                            carton.carton_id,
                            item.item_code,
                            item.shipped_qty || 0,
                          ],
                        );
                      } catch (error: any) {
                        console.error(
                          `Failed to sync carton item ${carton.carton_id}/${item.item_code}:`,
                          error,
                        );
                      }
                    }
                  }
                }

                if (detailTotalQty > 0) {
                  await db.runAsync(
                    `UPDATE asn_cache SET total_shipped_qty = ? WHERE asn_no = ?`,
                    [detailTotalQty, asnPrimaryKey],
                  );
                  console.warn(
                    `✅ ASN ${asnPrimaryKey}: Calculated and updated total_shipped_qty from cartons: ${detailTotalQty} (was ${
                      final_total_shipped_qty || "null"
                    })`,
                  );
                }
              } else {
                console.warn(
                  `⚠️ ASN ${asnPrimaryKey}: Detail endpoint also returned no carton data`,
                );
              }
            } catch (detailError: any) {
              console.warn(
                `⚠️ ASN ${asnPrimaryKey}: Failed to fetch details:`,
                detailError.message,
              );
            }
          }

          result.asns.synced++;

          // Yield to UI thread every 10 ASNs
          if ((asnIndex + 1) % 10 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          if ((asnIndex + 1) % 4 === 0 || asnIndex === asns.length - 1) {
            report(2, "ASNs", `${asnIndex + 1} / ${asns.length}`);
          }
        } catch (error: any) {
          console.error(`Failed to sync ASN ${asn.asn_no}:`, error);
          result.asns.failed++;
        }
      }
    } catch (error: any) {
      const errorMsg = error.message || error.toString() || "Unknown error";
      console.error("Failed to pull ASN data:", errorMsg);
      result.asns.failed++;
    }

    // Small delay between sync steps to allow UI updates
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 3. Sync Transfer Orders
    try {
      report(3, "Transfer orders", "Downloading…");
      const response = await apiService.pullTransferOrders();
      const transferOrders = extractArrayFromResponse(
        response,
        "📄 Transfer Orders",
      );
      report(
        3,
        "Transfer orders",
        `${transferOrders.length.toLocaleString()} order(s)…`,
      );

      let totalAllocations = 0;
      let unknownToStoreLogCount = 0;
      const masterStoreRows = await db.getAllAsync<{ code: string }>(
        `SELECT DISTINCT TRIM(code) AS code FROM warehouse_store_cache 
           WHERE code IS NOT NULL AND TRIM(code) != ''`,
      );

      for (const to of transferOrders) {
        // Support both field names: to_no (preferred) or transfer_order (from API)
        const toNo = to.to_no || to.transfer_order;
        if (!toNo) {
          console.warn(
            "⚠️ Skipping transfer order without to_no or transfer_order:",
            to,
          );
          continue;
        }

        if (to.allocations && Array.isArray(to.allocations)) {
          totalAllocations += to.allocations.length;
          for (
            let allocIndex = 0;
            allocIndex < to.allocations.length;
            allocIndex++
          ) {
            const allocation = to.allocations[allocIndex];
            try {
              // Use original ASN format for storage (matches how cartons are stored)
              // This ensures consistency across all data (cartons, statuses, allocations)
              const toASN = to.asn_no || "";
              const rawStore = String(
                allocation.store ?? allocation.store_code ?? "",
              ).trim();
              const resolved = canonicalStoreForToLine(
                rawStore,
                masterStoreRows,
              );
              if (
                resolved.unknownInMaster &&
                rawStore &&
                unknownToStoreLogCount < 25
              ) {
                unknownToStoreLogCount++;
                console.warn(
                  `⚠️ TO store "${rawStore}" not found in warehouse master (TO ${toNo}, item ${allocation.item_code}). ` +
                    (resolved.suggestions.length
                      ? `Similar: ${resolved.suggestions.join(", ")}`
                      : "Sync Warehouses & Stores master if this store is valid."),
                );
              } else if (
                resolved.normalized &&
                rawStore !== resolved.storeToPersist
              ) {
                console.log(
                  `📌 Normalized TO store "${rawStore}" → "${resolved.storeToPersist}" (warehouse master)`,
                );
              }
              await db.runAsync(
                `INSERT OR REPLACE INTO transfer_order_cache 
                   (to_no, asn_no, store, item_code, allocated_qty) 
                   VALUES (?, ?, ?, ?, ?)`,
                [
                  toNo, // Use mapped to_no
                  toASN, // Use original ASN format (preserve exact format from API)
                  resolved.storeToPersist || rawStore,
                  allocation.item_code,
                  allocation.allocated_qty || 0,
                ],
              );
              result.transferOrders.synced++;

              // Yield to UI thread every 50 allocations
              if ((allocIndex + 1) % 50 === 0) {
                await new Promise((resolve) => setTimeout(resolve, 10));
              }
              if (
                result.transferOrders.synced > 0 &&
                result.transferOrders.synced % 250 === 0
              ) {
                report(
                  3,
                  "Transfer orders",
                  `${result.transferOrders.synced.toLocaleString()} rows saved…`,
                );
              }
            } catch (error: any) {
              console.error(
                `Failed to sync transfer order allocation ${toNo}:`,
                error,
              );
              result.transferOrders.failed++;
            }
          }
        } else {
          // Transfer order exists but has no allocations - this is OK (may be empty or allocations added later)
          // Only log at debug level, not as warning
          console.log(
            `ℹ️ Transfer order ${toNo} has no allocations array (this is OK - allocations may be added later)`,
          );
        }
      }
      console.log(
        `📄 Transfer Orders: ${transferOrders.length} orders, ${totalAllocations} total allocations`,
      );
    } catch (error: any) {
      const errorMsg = error.message || error.toString() || "Unknown error";
      // 404 means endpoint not implemented - this is optional, just log a warning
      if (errorMsg.includes("404") || errorMsg.includes("not found")) {
        console.warn(
          "⚠️ Transfer Orders endpoint not implemented (404) - skipping",
        );
      } else {
        console.error("Failed to pull transfer orders:", errorMsg);
        result.transferOrders.failed++;
      }
    }

    // Small delay between sync steps to allow UI updates
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 4. Sync Boxes
    try {
      report(4, "Boxes", "Downloading…");
      const response = await apiService.pullBoxes();
      const boxes = extractArrayFromResponse(response, "📦 Boxes");
      report(
        4,
        "Boxes",
        boxes.length
          ? `Saving ${boxes.length.toLocaleString()} boxes…`
          : "No boxes in response",
      );

      for (let boxIndex = 0; boxIndex < boxes.length; boxIndex++) {
        const box = boxes[boxIndex];
        try {
          // Normalize ASN if present
          // Use original ASN format (preserve exact format from API)
          // This ensures boxes are stored with the same ASN format as other data
          const boxASN = box.asn_no || null;
          const createdBy = createdByFromApiBox(
            box as Record<string, unknown>,
          );
          await db.runAsync(
            `INSERT OR REPLACE INTO box_cache 
               (box_id, asn_no, to_no, store, status, purpose, updated_on, created_by) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              box.box_id,
              boxASN,
              box.to_no || null,
              box.store,
              box.status || "Open",
              box.purpose || "STORE",
              box.updated_on || new Date().toISOString(),
              createdBy || null,
            ],
          );
          result.boxes.synced++;

          // Yield to UI thread every 50 boxes
          if ((boxIndex + 1) % 50 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          if ((boxIndex + 1) % 300 === 0 || boxIndex === boxes.length - 1) {
            report(4, "Boxes", `${boxIndex + 1} / ${boxes.length}`);
          }
        } catch (error: any) {
          console.error(`Failed to sync box ${box.box_id}:`, error);
          result.boxes.failed++;
        }
      }
    } catch (error: any) {
      const errorMsg = error.message || error.toString() || "Unknown error";
      // 404 means endpoint not implemented - this is optional, just log a warning
      if (errorMsg.includes("404") || errorMsg.includes("not found")) {
        console.warn("⚠️ Boxes endpoint not implemented (404) - skipping");
      } else {
        console.error("Failed to pull boxes:", errorMsg);
        result.boxes.failed++;
      }
    }

    // Small delay between sync steps to allow UI updates
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 5. Sync Transfer Cartons
    try {
      report(5, "Transfer cartons", "Downloading…");
      const response = await apiService.pullTransferCartons();
      const transferCartons = extractArrayFromResponse(
        response,
        "📦 Transfer Cartons",
      );
      report(
        5,
        "Transfer cartons",
        transferCartons.length
          ? `Saving ${transferCartons.length.toLocaleString()}…`
          : "No transfer cartons in response",
      );

      for (let tcIndex = 0; tcIndex < transferCartons.length; tcIndex++) {
        const tc = transferCartons[tcIndex];
        try {
          // Preserve original ASN format from backend (don't normalize)
          // This ensures Transfer Cartons can be found regardless of ASN format
          const tcASN = tc.asn_no || null;
          await db.runAsync(
            `INSERT OR REPLACE INTO tc_cache 
               (tc_id, asn_no, to_no, store, status, updated_on) 
               VALUES (?, ?, ?, ?, ?, ?)`,
            [
              tc.tc_id,
              tcASN,
              tc.to_no || null,
              tc.store,
              tc.status || "Open",
              tc.updated_on || new Date().toISOString(),
            ],
          );
          result.transferCartons.synced++;

          // Yield to UI thread every 50 transfer cartons
          if ((tcIndex + 1) % 50 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          if (
            (tcIndex + 1) % 200 === 0 ||
            tcIndex === transferCartons.length - 1
          ) {
            report(
              5,
              "Transfer cartons",
              `${tcIndex + 1} / ${transferCartons.length}`,
            );
          }
        } catch (error: any) {
          console.error(`Failed to sync transfer carton ${tc.tc_id}:`, error);
          result.transferCartons.failed++;
        }
      }
    } catch (error: any) {
      const errorMsg = error.message || error.toString() || "Unknown error";
      // 404 or 500 means endpoint not implemented or has issues - this is optional, just log a warning
      if (
        errorMsg.includes("404") ||
        errorMsg.includes("500") ||
        errorMsg.includes("not found") ||
        errorMsg.includes("Server error")
      ) {
        console.warn(
          `⚠️ Transfer Cartons endpoint issue (${
            errorMsg.includes("404") ? "404" : "500"
          }) - skipping. This endpoint is optional and may not be fully implemented on the backend yet.`,
        );
      } else {
        console.error(
          `❌ Failed to pull transfer cartons: ${errorMsg}\n` +
            `   This is a non-optional error. Check backend server logs for details.`,
        );
        result.transferCartons.failed++;
      }
    }

    // Small delay between sync steps to allow UI updates
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 6. Sync Warehouse Racks
    try {
      report(6, "Warehouse racks", "Downloading…");
      const response = await apiService.pullWarehouseRacks();
      const racks = extractArrayFromResponse(response, "🏢 Warehouse Racks");
      report(
        6,
        "Warehouse racks",
        racks.length
          ? `Saving ${racks.length.toLocaleString()} racks…`
          : "No racks in response",
      );

      for (let rackIndex = 0; rackIndex < racks.length; rackIndex++) {
        const rack = racks[rackIndex];
        try {
          await db.runAsync(
            `INSERT OR REPLACE INTO warehouse_rack_cache 
               (rack_id, bin_id, location_code, capacity, current_qty, updated_on) 
               VALUES (?, ?, ?, ?, ?, ?)`,
            [
              rack.rack_id,
              rack.bin_id || null,
              rack.location_code || rack.rack_id,
              rack.capacity || null,
              rack.current_qty || 0,
              rack.updated_on || new Date().toISOString(),
            ],
          );
          result.warehouseRacks.synced++;

          // Yield to UI thread every 50 racks
          if ((rackIndex + 1) % 50 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          if ((rackIndex + 1) % 200 === 0 || rackIndex === racks.length - 1) {
            report(6, "Warehouse racks", `${rackIndex + 1} / ${racks.length}`);
          }
        } catch (error: any) {
          console.error(`Failed to sync rack ${rack.rack_id}:`, error);
          result.warehouseRacks.failed++;
        }
      }
    } catch (error: any) {
      const errorMsg = error.message || error.toString() || "Unknown error";
      // 404 means endpoint not implemented - this is optional, just log a warning
      if (errorMsg.includes("404") || errorMsg.includes("not found")) {
        console.warn(
          "⚠️ Warehouse Racks endpoint not implemented (404) - skipping",
        );
      } else {
        console.error("Failed to pull warehouse racks:", errorMsg);
        result.warehouseRacks.failed++;
      }
    }

    // Small delay between sync steps to allow UI updates
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 7. Sync Warehouses from tabwarehouse table
    // Backend endpoint: GET /api/master/warehouses
    // Expected to return data from tabwarehouse table
    try {
      report(7, "Warehouses", "Downloading…");
      console.log(
        "🔄 Syncing warehouses from tabwarehouse (endpoint: /api/master/warehouses)...",
      );
      const response = await apiService.pullWarehouses();
      const warehouses = extractArrayFromResponse(
        response,
        "🏭 Warehouses from tabwarehouse",
      );

      console.log(
        `📦 Processing ${warehouses.length} warehouses from tabwarehouse...`,
      );
      report(
        7,
        "Warehouses",
        `${warehouses.length.toLocaleString()} warehouse(s)…`,
      );
      for (let whIndex = 0; whIndex < warehouses.length; whIndex++) {
        const warehouse = warehouses[whIndex];
        try {
          // Map tabwarehouse fields to mobile app cache
          // Expected fields from tabwarehouse: warehouse_id, warehouse_name, location, is_active, updated_on
          await db.runAsync(
            `INSERT OR REPLACE INTO warehouse_cache 
               (warehouse_id, warehouse_name, location, is_active, updated_on) 
               VALUES (?, ?, ?, ?, ?)`,
            [
              warehouse.warehouse_id || warehouse.name || warehouse.code,
              warehouse.warehouse_name || warehouse.name || null,
              warehouse.location || null,
              warehouse.is_active !== undefined
                ? warehouse.is_active
                  ? 1
                  : 0
                : warehouse.active !== undefined
                  ? warehouse.active
                    ? 1
                    : 0
                  : 1,
              warehouse.updated_on ||
                warehouse.updatedAt ||
                warehouse.updated_at ||
                new Date().toISOString(),
            ],
          );
          result.warehouses.synced++;

          // Log first few warehouses for debugging
          if (whIndex < 3) {
            console.log(
              `  ✅ Synced warehouse: ${warehouse.warehouse_id || warehouse.name} (${warehouse.warehouse_name || warehouse.name})`,
            );
          }

          // Yield to UI thread every 20 warehouses
          if ((whIndex + 1) % 20 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          if ((whIndex + 1) % 50 === 0 || whIndex === warehouses.length - 1) {
            report(7, "Warehouses", `${whIndex + 1} / ${warehouses.length}`);
          }
        } catch (error: any) {
          console.error(
            `Failed to sync warehouse ${warehouse.warehouse_id}:`,
            error,
          );
          result.warehouses.failed++;
        }
      }
      console.log(
        `✅ Successfully synced ${result.warehouses.synced} warehouses from tabwarehouse to warehouse_cache table`,
      );
    } catch (error: any) {
      const errorMsg = error.message || error.toString() || "Unknown error";
      // 404 means endpoint not implemented - this is optional, just log a warning
      if (errorMsg.includes("404") || errorMsg.includes("not found")) {
        console.warn(
          "⚠️ Warehouses endpoint (/api/master/warehouses) not implemented (404) - skipping tabwarehouse sync",
        );
        console.warn(
          "⚠️ Backend should implement GET /api/master/warehouses to return data from tabwarehouse table",
        );
      } else {
        console.error(
          "❌ Failed to pull warehouses from tabwarehouse:",
          errorMsg,
        );
        result.warehouses.failed++;
      }
    }

    // Small delay between sync steps to allow UI updates
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 7.5. Sync Warehouses and Stores (with warehouse_type)
    try {
      report(8, "Warehouses & stores", "Downloading…");
      const response = await apiService.getWarehousesAndStores();
      const warehousesStores = extractArrayFromResponse(
        response,
        "🏪 Warehouses & Stores",
      );
      report(
        8,
        "Warehouses & stores",
        `${warehousesStores.length.toLocaleString()} row(s)…`,
      );

      for (let wsIndex = 0; wsIndex < warehousesStores.length; wsIndex++) {
        const ws = warehousesStores[wsIndex];
        try {
          await db.runAsync(
            `INSERT OR REPLACE INTO warehouse_store_cache 
               (code, name, warehouse_type, is_group, parent_warehouse, updated_on) 
               VALUES (?, ?, ?, ?, ?, ?)`,
            [
              ws.code || ws.warehouse_id || ws.store_code,
              ws.name || ws.warehouse_name || ws.store_name || null,
              ws.warehouse_type || null,
              ws.is_group !== undefined ? (ws.is_group ? 1 : 0) : 0,
              ws.parent_warehouse || null,
              ws.updated_on || ws.updated_at || new Date().toISOString(),
            ],
          );
          result.warehouses.synced++;

          // Yield to UI thread every 20 items
          if ((wsIndex + 1) % 20 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          if (
            (wsIndex + 1) % 80 === 0 ||
            wsIndex === warehousesStores.length - 1
          ) {
            report(
              8,
              "Warehouses & stores",
              `${wsIndex + 1} / ${warehousesStores.length}`,
            );
          }
        } catch (error: any) {
          console.error(`Failed to sync warehouse/store ${ws.code}:`, error);
          result.warehouses.failed++;
        }
      }
    } catch (error: any) {
      const errorMsg = error.message || error.toString() || "Unknown error";
      // 404 means endpoint not implemented - this is optional, just log a warning
      if (errorMsg.includes("404") || errorMsg.includes("not found")) {
        console.warn(
          "⚠️ Warehouses & Stores endpoint not implemented (404) - skipping",
        );
      } else {
        console.error("Failed to pull warehouses & stores:", errorMsg);
        result.warehouses.failed++;
      }
    }

    // Small delay between sync steps to allow UI updates
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 8. Sync Locations
    try {
      report(9, "Locations", "Downloading…");
      const response = await apiService.pullLocations();
      const locations = extractArrayFromResponse(response, "📍 Locations");
      report(
        9,
        "Locations",
        locations.length
          ? `Saving ${locations.length.toLocaleString()} locations…`
          : "No locations in response",
      );

      for (let locIndex = 0; locIndex < locations.length; locIndex++) {
        const location = locations[locIndex];
        try {
          if (!location.location_id) {
            console.warn("⚠️ Skipping location without location_id:", location);
            continue;
          }

          await db.runAsync(
            `INSERT OR REPLACE INTO location_cache 
               (location_id, warehouse, zone, aisle, parent_rack, level, bin_id, 
                location_type, location_type_detailed, is_available, capacity_volume_weight, updated_on) 
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              location.location_id,
              location.warehouse || null,
              location.zone || null,
              location.aisle || null,
              location.parent_rack || null,
              location.level || null,
              location.bin_id || null,
              location.location_type || null,
              location.location_type_detailed || null,
              location.is_available !== undefined
                ? location.is_available
                  ? 1
                  : 0
                : location.isAvailable !== undefined
                  ? location.isAvailable
                    ? 1
                    : 0
                  : 1,
              location.capacity_volume_weight !== undefined &&
              location.capacity_volume_weight !== null
                ? location.capacity_volume_weight
                : null,
              location.updated_on ||
                location.updatedAt ||
                location.updated_at ||
                new Date().toISOString(),
            ],
          );
          result.locations.synced++;

          // Yield to UI thread every 50 locations
          if ((locIndex + 1) % 50 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          if ((locIndex + 1) % 400 === 0 || locIndex === locations.length - 1) {
            report(9, "Locations", `${locIndex + 1} / ${locations.length}`);
          }
        } catch (error: any) {
          console.error(
            `Failed to sync location ${location.location_id}:`,
            error,
          );
          result.locations.failed++;
        }
      }
    } catch (error: any) {
      const errorMsg = error.message || error.toString() || "Unknown error";
      // 404 means endpoint not implemented - this is optional, just log a warning
      if (errorMsg.includes("404") || errorMsg.includes("not found")) {
        console.warn("⚠️ Locations endpoint not implemented (404) - skipping");
      } else {
        console.error("Failed to pull locations:", errorMsg);
        result.locations.failed++;
      }
    }

    // Small delay between sync steps to allow UI updates
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 9. Sync Bin Master (for Cycle Count)
    try {
      report(10, "Bin master", "Fetching from server…");
      console.log("🔄 Starting Bin Master sync...");

      let allBins: any[] = [];
      let offset = 0;
      const pageSize = 100; // Fetch 100 at a time
      let hasMore = true;
      let attempt = 0;
      const maxAttempts = 100; // Safety limit to prevent infinite loops

      // Try pagination approach - fetch in batches
      while (hasMore && attempt < maxAttempts) {
        attempt++;
        try {
          // First attempt: try without parameters
          if (attempt === 1) {
            const response = await apiService.pullBinMaster();
            console.log(
              `📥 Bin Master API response (attempt ${attempt}):`,
              JSON.stringify(response).substring(0, 300),
            );

            const bins = extractArrayFromResponse(
              response,
              `📦 Bin Master (attempt ${attempt})`,
            );
            console.log(`📊 Extracted ${bins.length} bins from response`);

            allBins.push(...bins);

            // Check if response indicates more data available
            const responseObj =
              response && typeof response === "object" ? response : null;
            const hasPagination =
              responseObj &&
              (responseObj.total !== undefined ||
                responseObj.has_more !== undefined ||
                responseObj.next_page !== undefined ||
                (responseObj.data &&
                  (responseObj.data.total !== undefined ||
                    responseObj.data.has_more !== undefined)));

            // If we got exactly 10 bins, try with limit parameter
            if (bins.length === 10 && !hasPagination) {
              console.warn(
                `⚠️ Got exactly 10 bins - trying with limit parameter...`,
              );
              try {
                const responseWithLimit = await apiService.pullBinMaster({
                  limit: 10000,
                });
                const binsWithLimit = extractArrayFromResponse(
                  responseWithLimit,
                  "📦 Bin Master (with limit=10000)",
                );
                console.log(
                  `📊 Extracted ${binsWithLimit.length} bins with limit=10000`,
                );

                if (binsWithLimit.length > bins.length) {
                  console.log(
                    `✅ Got more bins with limit parameter: ${binsWithLimit.length} vs ${bins.length}`,
                  );
                  allBins = binsWithLimit; // Replace with the larger set
                  hasMore = false; // Stop pagination
                  break;
                }
              } catch (limitError: any) {
                console.warn(
                  `⚠️ Failed to fetch with limit parameter: ${limitError.message}`,
                );
              }
            }

            // If we got less than pageSize, probably no more data
            if (bins.length < pageSize) {
              hasMore = false;
            } else if (!hasPagination) {
              // If no pagination info and we got a full page, try pagination
              console.log(
                `🔄 Got ${bins.length} bins (full page), trying pagination...`,
              );
              offset = bins.length;
              continue; // Try next page
            } else {
              hasMore = false; // No pagination support, stop
            }
          } else {
            // Subsequent attempts: try with offset/limit
            try {
              const response = await apiService.pullBinMaster({
                limit: pageSize,
                offset,
              });
              const bins = extractArrayFromResponse(
                response,
                `📦 Bin Master (page ${attempt}, offset ${offset})`,
              );
              console.log(`📊 Page ${attempt}: Extracted ${bins.length} bins`);

              if (bins.length === 0) {
                hasMore = false;
                break;
              }

              allBins.push(...bins);
              offset += bins.length;

              // If we got less than pageSize, no more pages
              if (bins.length < pageSize) {
                hasMore = false;
              }
            } catch (pageError: any) {
              console.warn(
                `⚠️ Failed to fetch page ${attempt}: ${pageError.message}`,
              );
              hasMore = false; // Stop on error
            }
          }
        } catch (error: any) {
          console.error(
            `❌ Error fetching bin master (attempt ${attempt}):`,
            error,
          );
          hasMore = false;
          break;
        }
      }

      const rawBinCount = allBins.length;
      const { unique: bins, duplicatesDropped } =
        dedupeBinMasterByLocationKey(allBins);
      console.log(
        `📊 Total bin rows from API: ${rawBinCount} → ${bins.length} unique location_id/bin_code (dropped ${duplicatesDropped} duplicate row(s))`,
      );

      if (duplicatesDropped > 0) {
        console.warn(
          `⚠️ Bin Master API returned duplicate rows for the same location (e.g. overlapping pagination). Kept the last occurrence per location.`,
        );
      }

      if (bins.length === 0) {
        console.warn("⚠️ No bins found in API response");
      } else if (bins.length === 10 && rawBinCount <= 10) {
        console.warn(
          `⚠️ Only 10 bins found - this might be incomplete. Backend might have a default limit.`,
        );
      }

      report(
        10,
        "Bin master",
        bins.length
          ? `Saving ${bins.length.toLocaleString()} bins…`
          : "No bins in response",
      );

      for (let binIndex = 0; binIndex < bins.length; binIndex++) {
        const bin = bins[binIndex];
        try {
          // Handle new response format: location_id, bin_code, bin_id, warehouse, rack, is_available
          // Also support old format: bin_id, bin_code, bin_barcode, warehouse_id, zone, aisle, rack, level
          // Backend returns: { location_id: "A1-R01-L1-B1", bin_code: "A1-R01-L1-B1", warehouse: "WH-MAIN", ... }
          // Use bin_code if available, otherwise use location_id (they should match)
          // bin_code is the primary field for lookup in mobile app
          // location_id is the unique identifier (e.g., "A1-R01-L1-B1")
          // This must be used as the PRIMARY KEY (bin_id) in the database
          const locationId = bin.location_id || bin.bin_code;
          const binCode = bin.bin_code || bin.location_id;

          // CRITICAL: Use location_id as bin_id (PRIMARY KEY) to ensure uniqueness
          // Backend's bin_id field may not be unique (e.g., "B1", "B2" for multiple bins)
          // location_id (e.g., "A1-R01-L1-B1") is the unique identifier
          const binId = locationId; // Always use location_id as bin_id for PRIMARY KEY

          // Ensure bin_code matches location_id for consistency
          // bin_code should be the same as location_id, but use location_id as the source of truth
          const finalBinCode = binCode || locationId;

          // Log if backend provided a different bin_id
          if (bin.bin_id && bin.bin_id !== locationId && binIndex < 5) {
            console.log(
              `📝 Backend bin_id="${bin.bin_id}" differs from location_id="${locationId}" - using location_id as bin_id for uniqueness`,
            );
          }

          // Track bin_id usage to detect duplicates
          if (binIndex === 0) {
            console.log(`🔍 Starting bin sync - will track bin_id duplicates`);
          }

          // bin_barcode can be different from bin_code, but if not provided, use bin_code/location_id
          const binBarcode = bin.bin_barcode || bin.bin_code || bin.location_id;
          const warehouseId = bin.warehouse_id || bin.warehouse || null;

          // Log all bins for debugging (first 5 and last 5)
          if (binIndex < 5 || binIndex >= bins.length - 5) {
            console.log(
              `📦 Bin ${binIndex + 1}/${bins.length}: bin_id="${binId}" (from location_id), bin_code="${finalBinCode}", location_id="${bin.location_id}", warehouse="${warehouseId}"`,
            );
          }
          const zone = bin.zone || null;
          const aisle = bin.aisle || null;
          const rack = bin.rack || null;
          const level = bin.level || null;
          const isActive =
            bin.is_active !== undefined
              ? bin.is_active
                ? 1
                : 0
              : bin.is_available !== undefined
                ? bin.is_available
                  ? 1
                  : 0
                : 1;

          // Validate location_id (which is used as bin_id) before insertion
          if (!locationId || locationId.trim() === "") {
            console.warn(`⚠️ Skipping bin with empty location_id:`, {
              bin_id: bin.bin_id,
              location_id: bin.location_id,
              bin_code: bin.bin_code,
              raw_bin: JSON.stringify(bin).substring(0, 200),
            });
            result.binMaster.failed++;
            continue;
          }

          // Validate bin_code as well
          if (!finalBinCode || finalBinCode.trim() === "") {
            console.warn(`⚠️ Skipping bin with empty bin_code:`, {
              bin_id: binId,
              location_id: bin.location_id,
              bin_code: bin.bin_code,
              raw_bin: JSON.stringify(bin).substring(0, 200),
            });
            result.binMaster.failed++;
            continue;
          }

          // Check for existing bin with same bin_code but different bin_id
          // This happens when old bins were inserted with backend's bin_id (e.g., "B1", "B2")
          // but now we're using location_id (e.g., "A1-R01-L1-B1") as bin_id
          // Solution: Delete the old bin first, then insert the new one
          const existingBinByCode = await db.getFirstAsync<{ bin_id: string }>(
            "SELECT bin_id FROM bin_master_cache WHERE bin_code = ?",
            [finalBinCode],
          );

          if (existingBinByCode && existingBinByCode.bin_id !== binId) {
            console.log(
              `🔄 Migrating bin: bin_code="${finalBinCode}" from old bin_id="${existingBinByCode.bin_id}" to new bin_id="${binId}" (using location_id)`,
            );
            // Delete the old bin with the wrong bin_id
            await db.runAsync(
              "DELETE FROM bin_master_cache WHERE bin_code = ? AND bin_id != ?",
              [finalBinCode, binId],
            );
            console.log(
              `✅ Deleted old bin with bin_id="${existingBinByCode.bin_id}", will insert with bin_id="${binId}"`,
            );
          }

          // Check for existing bin with same bin_id (PRIMARY KEY) - INSERT OR REPLACE will handle this
          const existingBinById = await db.getFirstAsync<{ bin_code: string }>(
            "SELECT bin_code FROM bin_master_cache WHERE bin_id = ?",
            [binId],
          );

          if (existingBinById) {
            if (existingBinById.bin_code !== finalBinCode) {
              console.log(
                `🔄 Updating bin: bin_id="${binId}" bin_code from "${existingBinById.bin_code}" to "${finalBinCode}"`,
              );
            }
          }

          const insertResult = await db.runAsync(
            `INSERT OR REPLACE INTO bin_master_cache (
                bin_id, bin_code, bin_barcode, warehouse_id, zone, aisle, rack, level, is_active, updated_on
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              binId, // location_id used as PRIMARY KEY
              finalBinCode, // bin_code for lookup
              binBarcode,
              warehouseId,
              zone,
              aisle,
              rack,
              level,
              isActive,
              bin.updated_on || bin.updated_at || new Date().toISOString(),
            ],
          );

          // Verify the bin was actually inserted using location_id (bin_id)
          const verifyBin = await db.getFirstAsync<{ bin_code: string }>(
            "SELECT bin_code FROM bin_master_cache WHERE bin_id = ?",
            [binId],
          );

          if (!verifyBin) {
            console.error(
              `❌ Failed to verify bin insertion: location_id="${locationId}" (bin_id="${binId}")`,
            );
            result.binMaster.failed++;
          } else {
            result.binMaster.synced++;
          }

          // Yield to UI thread every 50 bins
          if ((binIndex + 1) % 50 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }

          // Log progress every 10 bins
          if ((binIndex + 1) % 10 === 0) {
            console.log(
              `📦 Bin Master sync progress: ${binIndex + 1}/${bins.length} bins processed, ${result.binMaster.synced} synced, ${result.binMaster.failed} failed`,
            );
          }
          if ((binIndex + 1) % 200 === 0 || binIndex === bins.length - 1) {
            report(10, "Bin master", `${binIndex + 1} / ${bins.length}`);
          }
        } catch (error: any) {
          console.error(
            `❌ Failed to sync bin location_id="${bin.location_id || bin.bin_code}":`,
            error,
          );
          console.error(`❌ Error details:`, {
            location_id: bin.location_id,
            bin_code: bin.bin_code,
            bin_id: bin.bin_id,
            error: error.message,
          });
          result.binMaster.failed++;
        }
      }

      console.log(
        `✅ Bin Master sync complete: ${result.binMaster.synced} synced, ${result.binMaster.failed} failed`,
      );

      // Verify final count in database
      const finalCount = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM bin_master_cache",
      );
      console.log(
        `📊 Final bin count in database: ${finalCount?.count || 0} (expected: ${bins.length})`,
      );

      if (finalCount && finalCount.count !== bins.length) {
        console.warn(
          `⚠️ Mismatch: ${bins.length} bins processed but only ${finalCount.count} in database`,
        );

        // List all bins in database for debugging
        const allDbBins = await db.getAllAsync<{
          bin_code: string;
          bin_id: string;
        }>("SELECT bin_code, bin_id FROM bin_master_cache ORDER BY bin_code");
        console.log(
          `📋 Bins in database:`,
          allDbBins.map((b) => `${b.bin_code} (${b.bin_id})`).join(", "),
        );
      }
    } catch (error: any) {
      const errorMsg = error.message || error.toString() || "Unknown error";
      // 404 means endpoint not implemented - this is optional, just log a warning
      if (errorMsg.includes("404") || errorMsg.includes("not found")) {
        console.warn("⚠️ Bin Master endpoint not implemented (404) - skipping");
      } else {
        console.error("Failed to pull bin master:", errorMsg);
        result.binMaster.failed++;
      }
    }

    // Small delay between sync steps to allow UI updates
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 10. Sync Stock Ledger (for Cycle Count expected quantities)
    try {
      report(11, "Stock ledger", "Downloading…");
      const response = await apiService.pullStockLedger();
      const stockEntries = extractArrayFromResponse(
        response,
        "📊 Stock Ledger",
      );
      report(
        11,
        "Stock ledger",
        stockEntries.length
          ? `Saving ${stockEntries.length.toLocaleString()} rows…`
          : "No stock rows in response",
      );

      for (let stockIndex = 0; stockIndex < stockEntries.length; stockIndex++) {
        const stock = stockEntries[stockIndex];
        try {
          await db.runAsync(
            `INSERT OR REPLACE INTO stock_ledger_cache (
                item_code, warehouse, bin_location, qty, reserved_qty, updated_on
              ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              stock.item_code,
              stock.warehouse || stock.warehouse_id || null,
              stock.bin_location || stock.bin_code || stock.location || null,
              stock.qty || stock.quantity || 0,
              stock.reserved_qty || stock.reserved_quantity || 0,
              stock.updated_on || stock.updated_at || new Date().toISOString(),
            ],
          );
          result.stockLedger.synced++;

          // Yield to UI thread every 100 stock entries
          if ((stockIndex + 1) % 100 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          if (
            (stockIndex + 1) % 500 === 0 ||
            stockIndex === stockEntries.length - 1
          ) {
            report(
              11,
              "Stock ledger",
              `${stockIndex + 1} / ${stockEntries.length}`,
            );
          }
        } catch (error: any) {
          console.error(
            `Failed to sync stock entry ${stock.item_code}:`,
            error,
          );
          result.stockLedger.failed++;
        }
      }
    } catch (error: any) {
      const errorMsg = error.message || error.toString() || "Unknown error";
      // 404 means endpoint not implemented - this is optional, just log a warning
      if (errorMsg.includes("404") || errorMsg.includes("not found")) {
        console.warn(
          "⚠️ Stock Ledger endpoint not implemented (404) - skipping",
        );
      } else {
        console.error("Failed to pull stock ledger:", errorMsg);
        result.stockLedger.failed++;
      }
    }

    // Small delay between sync steps to allow UI updates
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 11. Sync Item Barcode Map (for Cycle Count barcode scanning)
    try {
      report(12, "Item barcode map", "Downloading…");
      const response = await apiService.pullItemBarcodeMap();
      const barcodeMappings = extractArrayFromResponse(
        response,
        "🏷️ Item Barcode Map",
      );
      report(
        12,
        "Item barcode map",
        barcodeMappings.length
          ? `Saving ${barcodeMappings.length.toLocaleString()} mappings…`
          : "No barcode mappings in response",
      );

      for (let mapIndex = 0; mapIndex < barcodeMappings.length; mapIndex++) {
        const mapping = barcodeMappings[mapIndex];
        try {
          await db.runAsync(
            `INSERT OR REPLACE INTO item_barcode_map (
                barcode, item_code, uom, pack_size, barcode_type, updated_on
              ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              mapping.barcode,
              mapping.item_code,
              mapping.uom || "EA",
              mapping.pack_size || mapping.packSize || 1,
              mapping.barcode_type || mapping.barcodeType || "Unit",
              mapping.updated_on ||
                mapping.updated_at ||
                new Date().toISOString(),
            ],
          );
          result.itemBarcodeMap.synced++;

          // Yield to UI thread every 100 mappings
          if ((mapIndex + 1) % 100 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          if (
            (mapIndex + 1) % 400 === 0 ||
            mapIndex === barcodeMappings.length - 1
          ) {
            report(
              12,
              "Item barcode map",
              `${mapIndex + 1} / ${barcodeMappings.length}`,
            );
          }
        } catch (error: any) {
          console.error(
            `Failed to sync barcode mapping ${mapping.barcode}:`,
            error,
          );
          result.itemBarcodeMap.failed++;
        }
      }
    } catch (error: any) {
      const errorMsg = error.message || error.toString() || "Unknown error";
      // 404 means endpoint not implemented - this is optional, just log a warning
      if (errorMsg.includes("404") || errorMsg.includes("not found")) {
        console.warn(
          "⚠️ Item Barcode Map endpoint not implemented (404) - skipping",
        );
      } else {
        console.error("Failed to pull item barcode map:", errorMsg);
        result.itemBarcodeMap.failed++;
      }
    }

    return result;
  } catch (error: any) {
    console.error("Master data sync error:", error);
    throw error;
  }
};
