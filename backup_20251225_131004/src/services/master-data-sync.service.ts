import { getDatabase } from "../database/database";
import { apiService } from "./api.service";
import { getSettings } from "./settings.service";
import { normalizeASN } from "../utils/asn";

interface MasterDataSyncResult {
  items: { synced: number; failed: number };
  asns: { synced: number; failed: number };
  transferOrders: { synced: number; failed: number };
  boxes: { synced: number; failed: number };
  transferCartons: { synced: number; failed: number };
  warehouseRacks: { synced: number; failed: number };
  warehouses: { synced: number; failed: number };
  locations: { synced: number; failed: number };
}

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
        `${logPrefix}: Found ${response.data.length} items (nested in data)`
      );
      return response.data;
    }
    // Format: { data: { items: [...] }, success: true }
    if (response.data && Array.isArray(response.data.items)) {
      console.log(
        `${logPrefix}: Found ${response.data.items.length} items (nested in data.items)`
      );
      return response.data.items;
    }
    // Format: { items: [...] }
    if (Array.isArray(response.items)) {
      console.log(
        `${logPrefix}: Found ${response.items.length} items (nested in items)`
      );
      return response.items;
    }

    console.warn(
      `${logPrefix}: Unexpected response format:`,
      JSON.stringify(response).substring(0, 200)
    );
  }

  console.warn(`${logPrefix}: No array found in response`);
  return [];
};

export const syncMasterDataFromDesktop =
  async (): Promise<MasterDataSyncResult> => {
    const settings = await getSettings();

    // Check if in demo mode
    if (settings.demo_mode === 1) {
      throw new Error("Cannot sync master data in demo mode");
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
    };

    const db = await getDatabase();
    if (!db) throw new Error("Database not initialized");

    // Note: Demo data is not used in production - only real data from desktop API

    try {
      // 1. Sync Item Master
      try {
        const response = await apiService.pullItemMaster();
        const items = extractArrayFromResponse(response, "📦 Items");

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          try {
            await db.runAsync(
              `INSERT OR REPLACE INTO item_master (item_code, barcode, item_name, updated_on) 
               VALUES (?, ?, ?, ?)`,
              [
                item.item_code,
                item.barcode,
                item.item_name || null,
                item.updated_on || new Date().toISOString(),
              ]
            );
            result.items.synced++;

            // Yield to UI thread every 50 items
            if ((i + 1) % 50 === 0) {
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          } catch (error: any) {
            console.error(`Failed to sync item ${item.item_code}:`, error);
            result.items.failed++;
          }
        }
      } catch (error: any) {
        const errorMsg = error.message || error.toString() || "Unknown error";
        console.error("Failed to pull item master:", errorMsg);
        result.items.failed++;
      }

      // Small delay between sync steps to allow UI updates
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 2. Sync ASN Data
      try {
        const response = await apiService.pullASNData();
        const asns = extractArrayFromResponse(response, "📋 ASNs");

        console.log(`📋 ASN Sync: Received ${asns.length} ASNs from API`);
        if (asns.length > 0) {
          console.log(
            `📋 Sample ASN structure:`,
            JSON.stringify(asns[0], null, 2)
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
              `📋 Syncing ASN: API returned="${asnNumber}", Storing exactly as="${apiASN}" (preserving original format)`
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
            const total_shipped_qty =
              asn.total_shipped_qty !== undefined &&
              asn.total_shipped_qty !== null
                ? Number(asn.total_shipped_qty)
                : null;
            const total_carton_count =
              asn.total_carton_count !== undefined &&
              asn.total_carton_count !== null
                ? Number(asn.total_carton_count)
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
                if (
                  !asn.total_carton_count &&
                  parsedPayload.total_carton_count
                ) {
                  asn.total_carton_count = parsedPayload.total_carton_count;
                }
                if (!asn.total_shipped_qty && parsedPayload.total_shipped_qty) {
                  asn.total_shipped_qty = parsedPayload.total_shipped_qty;
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
                  parseError
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
            const final_total_shipped_qty =
              asn.total_shipped_qty !== undefined &&
              asn.total_shipped_qty !== null
                ? Number(asn.total_shipped_qty)
                : null;
            const final_total_carton_count =
              asn.total_carton_count !== undefined &&
              asn.total_carton_count !== null
                ? Number(asn.total_carton_count)
                : null;

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
              ]
            );

            // Sync ASN carton map if provided
            // Check both asn.cartons (from detail API) and asn.details (from list API)
            let cartonMapSynced = false;
            if (asn.cartons && Array.isArray(asn.cartons)) {
              // Format from detail API: { cartons: [{ carton_id, items: [{ item_code, shipped_qty }] }] }
              for (const carton of asn.cartons) {
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
                        ]
                      );
                      cartonMapSynced = true;
                    } catch (error: any) {
                      console.error(
                        `Failed to sync carton item ${carton.carton_id}/${item.item_code}:`,
                        error
                      );
                    }
                  }
                }
              }
            } else if (asn.details && Array.isArray(asn.details)) {
              // Format from list API: { details: [{ item_code, shipped_qty, carton_id }] }
              for (const detail of asn.details) {
                if (detail.carton_id && detail.item_code) {
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
                      ]
                    );
                    cartonMapSynced = true;
                  } catch (error: any) {
                    console.error(
                      `Failed to sync carton item ${detail.carton_id}/${detail.item_code}:`,
                      error
                    );
                  }
                }
              }
            }

            // Log if carton map was synced or not
            if (!cartonMapSynced) {
              console.log(
                `⚠️ ASN ${asnPrimaryKey} has no cartons/details array - carton map not populated. Using total_carton_count (${final_total_carton_count}) and total_shipped_qty (${final_total_shipped_qty}) from ASN object.`
              );
            } else {
              console.log(
                `✅ ASN ${asnPrimaryKey} carton map synced successfully`
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
            }>(
              "SELECT asn_no, asn_no_original FROM asn_cache WHERE asn_no = ?",
              [asnPrimaryKey]
            );

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
                `⚠️ ASN ${asnPrimaryKey}: No carton/piece data found in API response!`
              );
              console.warn(
                `⚠️ ASN ${asnPrimaryKey}: Full ASN object:`,
                JSON.stringify(asn, null, 2)
              );

              // Try to fetch ASN details from detail endpoint as fallback
              try {
                console.log(
                  `🔄 ASN ${asnPrimaryKey}: Attempting to fetch details from /api/asn/${asnPrimaryKey}...`
                );
                const { apiService: apiServiceDetail } = await import(
                  "./api.service"
                );
                const asnDetail = await apiServiceDetail.getASN(asnPrimaryKey);

                if (
                  asnDetail &&
                  asnDetail.cartons &&
                  Array.isArray(asnDetail.cartons)
                ) {
                  console.log(
                    `✅ ASN ${asnPrimaryKey}: Found ${asnDetail.cartons.length} cartons in detail response`
                  );

                  // Update total_carton_count
                  const detailCartonCount = asnDetail.cartons.length;
                  if (detailCartonCount > 0) {
                    await db.runAsync(
                      `UPDATE asn_cache SET total_carton_count = ? WHERE asn_no = ?`,
                      [detailCartonCount, asnPrimaryKey]
                    );
                    console.log(
                      `✅ ASN ${asnPrimaryKey}: Updated total_carton_count to ${detailCartonCount}`
                    );
                  }

                  // Calculate total_shipped_qty from cartons
                  let detailTotalQty = 0;
                  for (const carton of asnDetail.cartons) {
                    if (carton.items && Array.isArray(carton.items)) {
                      for (const item of carton.items) {
                        detailTotalQty += item.shipped_qty || 0;

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
                            ]
                          );
                        } catch (error: any) {
                          console.error(
                            `Failed to sync carton item ${carton.carton_id}/${item.item_code}:`,
                            error
                          );
                        }
                      }
                    }
                  }

                  if (detailTotalQty > 0) {
                    await db.runAsync(
                      `UPDATE asn_cache SET total_shipped_qty = ? WHERE asn_no = ?`,
                      [detailTotalQty, asnPrimaryKey]
                    );
                    console.log(
                      `✅ ASN ${asnPrimaryKey}: Updated total_shipped_qty to ${detailTotalQty}`
                    );
                  }
                } else {
                  console.warn(
                    `⚠️ ASN ${asnPrimaryKey}: Detail endpoint also returned no carton data`
                  );
                }
              } catch (detailError: any) {
                console.warn(
                  `⚠️ ASN ${asnPrimaryKey}: Failed to fetch details:`,
                  detailError.message
                );
              }
            }

            result.asns.synced++;

            // Yield to UI thread every 10 ASNs
            if ((asnIndex + 1) % 10 === 0) {
              await new Promise((resolve) => setTimeout(resolve, 50));
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
        const response = await apiService.pullTransferOrders();
        const transferOrders = extractArrayFromResponse(
          response,
          "📄 Transfer Orders"
        );

        let totalAllocations = 0;
        for (const to of transferOrders) {
          if (!to.to_no) {
            console.warn("⚠️ Skipping transfer order without to_no:", to);
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
                // Normalize ASN for storage, but keep original for reference
                const toASN = to.asn_no || "";
                const normalizedTOASN = normalizeASN(toASN);
                await db.runAsync(
                  `INSERT OR REPLACE INTO transfer_order_cache 
                   (to_no, asn_no, store, item_code, allocated_qty) 
                   VALUES (?, ?, ?, ?, ?)`,
                  [
                    to.to_no,
                    normalizedTOASN,
                    allocation.store,
                    allocation.item_code,
                    allocation.allocated_qty || 0,
                  ]
                );
                result.transferOrders.synced++;

                // Yield to UI thread every 50 allocations
                if ((allocIndex + 1) % 50 === 0) {
                  await new Promise((resolve) => setTimeout(resolve, 10));
                }
              } catch (error: any) {
                console.error(
                  `Failed to sync transfer order allocation ${to.to_no}:`,
                  error
                );
                result.transferOrders.failed++;
              }
            }
          } else {
            console.warn(
              `⚠️ Transfer order ${to.to_no} has no allocations array`
            );
          }
        }
        console.log(
          `📄 Transfer Orders: ${transferOrders.length} orders, ${totalAllocations} total allocations`
        );
      } catch (error: any) {
        const errorMsg = error.message || error.toString() || "Unknown error";
        console.error("Failed to pull transfer orders:", errorMsg);
        result.transferOrders.failed++;
      }

      // Small delay between sync steps to allow UI updates
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 4. Sync Boxes
      try {
        const response = await apiService.pullBoxes();
        const boxes = extractArrayFromResponse(response, "📦 Boxes");

        for (let boxIndex = 0; boxIndex < boxes.length; boxIndex++) {
          const box = boxes[boxIndex];
          try {
            // Normalize ASN if present
            const boxASN = box.asn_no ? normalizeASN(box.asn_no) : null;
            await db.runAsync(
              `INSERT OR REPLACE INTO box_cache 
               (box_id, asn_no, to_no, store, status, purpose, updated_on) 
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                box.box_id,
                boxASN,
                box.to_no || null,
                box.store,
                box.status || "Open",
                box.purpose || "STORE",
                box.updated_on || new Date().toISOString(),
              ]
            );
            result.boxes.synced++;

            // Yield to UI thread every 50 boxes
            if ((boxIndex + 1) % 50 === 0) {
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          } catch (error: any) {
            console.error(`Failed to sync box ${box.box_id}:`, error);
            result.boxes.failed++;
          }
        }
      } catch (error: any) {
        const errorMsg = error.message || error.toString() || "Unknown error";
        console.error("Failed to pull boxes:", errorMsg);
        result.boxes.failed++;
      }

      // Small delay between sync steps to allow UI updates
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 5. Sync Transfer Cartons
      try {
        const response = await apiService.pullTransferCartons();
        const transferCartons = extractArrayFromResponse(
          response,
          "📦 Transfer Cartons"
        );

        for (let tcIndex = 0; tcIndex < transferCartons.length; tcIndex++) {
          const tc = transferCartons[tcIndex];
          try {
            // Normalize ASN if present
            const tcASN = tc.asn_no ? normalizeASN(tc.asn_no) : null;
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
              ]
            );
            result.transferCartons.synced++;

            // Yield to UI thread every 50 transfer cartons
            if ((tcIndex + 1) % 50 === 0) {
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          } catch (error: any) {
            console.error(`Failed to sync transfer carton ${tc.tc_id}:`, error);
            result.transferCartons.failed++;
          }
        }
      } catch (error: any) {
        const errorMsg = error.message || error.toString() || "Unknown error";
        console.error("Failed to pull transfer cartons:", errorMsg);
        result.transferCartons.failed++;
      }

      // Small delay between sync steps to allow UI updates
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 6. Sync Warehouse Racks
      try {
        const response = await apiService.pullWarehouseRacks();
        const racks = extractArrayFromResponse(response, "🏢 Warehouse Racks");

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
              ]
            );
            result.warehouseRacks.synced++;

            // Yield to UI thread every 50 racks
            if ((rackIndex + 1) % 50 === 0) {
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          } catch (error: any) {
            console.error(`Failed to sync rack ${rack.rack_id}:`, error);
            result.warehouseRacks.failed++;
          }
        }
      } catch (error: any) {
        const errorMsg = error.message || error.toString() || "Unknown error";
        console.error("Failed to pull warehouse racks:", errorMsg);
        result.warehouseRacks.failed++;
      }

      // Small delay between sync steps to allow UI updates
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 7. Sync Warehouses
      try {
        const response = await apiService.pullWarehouses();
        const warehouses = extractArrayFromResponse(response, "🏭 Warehouses");

        for (let whIndex = 0; whIndex < warehouses.length; whIndex++) {
          const warehouse = warehouses[whIndex];
          try {
            await db.runAsync(
              `INSERT OR REPLACE INTO warehouse_cache 
               (warehouse_id, warehouse_name, location, is_active, updated_on) 
               VALUES (?, ?, ?, ?, ?)`,
              [
                warehouse.warehouse_id,
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
              ]
            );
            result.warehouses.synced++;

            // Yield to UI thread every 20 warehouses
            if ((whIndex + 1) % 20 === 0) {
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          } catch (error: any) {
            console.error(
              `Failed to sync warehouse ${warehouse.warehouse_id}:`,
              error
            );
            result.warehouses.failed++;
          }
        }
      } catch (error: any) {
        const errorMsg = error.message || error.toString() || "Unknown error";
        console.error("Failed to pull warehouses:", errorMsg);
        result.warehouses.failed++;
      }

      // Small delay between sync steps to allow UI updates
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 8. Sync Locations
      try {
        const response = await apiService.pullLocations();
        const locations = extractArrayFromResponse(response, "📍 Locations");

        for (let locIndex = 0; locIndex < locations.length; locIndex++) {
          const location = locations[locIndex];
          try {
            if (!location.location_id) {
              console.warn(
                "⚠️ Skipping location without location_id:",
                location
              );
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
              ]
            );
            result.locations.synced++;

            // Yield to UI thread every 50 locations
            if ((locIndex + 1) % 50 === 0) {
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          } catch (error: any) {
            console.error(
              `Failed to sync location ${location.location_id}:`,
              error
            );
            result.locations.failed++;
          }
        }
      } catch (error: any) {
        const errorMsg = error.message || error.toString() || "Unknown error";
        console.error("Failed to pull locations:", errorMsg);
        result.locations.failed++;
      }

      return result;
    } catch (error: any) {
      console.error("Master data sync error:", error);
      throw error;
    }
  };
