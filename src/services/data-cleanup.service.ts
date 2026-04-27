/**
 * Data Cleanup Service
 * Functions to clear all local data and prepare for backend sync
 */

import { getDatabase } from "../database/database";

/**
 * Clear all local cache data (except settings)
 * This prepares the app to sync fresh data from backend
 */
export const clearAllCacheData = async () => {
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
      "transfer_in_cache", // ✅ FIX: Clear transfer in cache
      "stock_ledger_cache", // ✅ FIX: Clear stock ledger cache (sources expected quantities)
      "stock_transaction_cache", // ✅ FIX: Clear stock transaction cache
      "cycle_count_sessions", // ✅ FIX: Clear cycle count sessions
      "cycle_count_lines", // ✅ FIX: Clear cycle count lines (contains expected_qty)
      "cycle_count_cache", // ✅ FIX: Clear cycle count cache
      "bin_master_cache", // ✅ FIX: Clear bin master cache
      "item_barcode_map", // ✅ FIX: Clear item barcode map
      "workflow_state_cache", // ✅ FIX: Clear workflow state cache
      "putaway_items_cache", // ✅ FIX: Clear putaway items cache
      "warehouse_rack_cache", // ✅ FIX: Clear warehouse rack cache
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
    return true;
  } catch (error: any) {
    console.error("❌ Error clearing cache data:", error);
    throw error;
  }
};

/**
 * Clear all data including event queue (use with caution!)
 * This should only be used when you want a complete fresh start
 */
export const clearAllDataIncludingEvents = async () => {
  const db = await getDatabase();
  if (!db) throw new Error("Database not initialized");

  console.log("🗑️ Clearing ALL local data including events...");

  try {
    await clearAllCacheData();
    
    // Also clear event queue
    try {
      const result = await db.runAsync("DELETE FROM event_queue");
      console.log(`✅ Cleared event_queue: ${result.changes || 0} rows`);
    } catch (error: any) {
      console.warn(`⚠️ Error clearing event_queue:`, error.message);
    }

    console.log("✅ All data cleared successfully");
    return true;
  } catch (error: any) {
    console.error("❌ Error clearing all data:", error);
    throw error;
  }
};

/**
 * Clear only demo/mock data
 * Removes ASN-00045 and mock Material Requests
 */
export const clearDemoData = async () => {
  const db = await getDatabase();
  if (!db) throw new Error("Database not initialized");

  console.log("🗑️ Clearing demo/mock data...");

  try {
    const demoASN = "ASN-00045";
    const mockMRs = ["MR-0001", "MR-0002"];

    // Clear demo ASN data
    const demoDataQueries: [string, string[]][] = [
      [`DELETE FROM asn_carton_map WHERE asn_no = ?`, [demoASN]],
      [`DELETE FROM transfer_order_cache WHERE asn_no = ?`, [demoASN]],
      [`DELETE FROM box_cache WHERE asn_no = ?`, [demoASN]],
      [`DELETE FROM asn_cache WHERE asn_no = ?`, [demoASN]],
      [`DELETE FROM carton_status_cache WHERE asn_no = ?`, [demoASN]],
      [`DELETE FROM scanned_items WHERE asn_no = ?`, [demoASN]],
    ];

    for (const row of demoDataQueries) {
      const query = row[0];
      const params = row[1];
      try {
        const result = await db.runAsync(query, params);
        if (result.changes && result.changes > 0) {
          console.log(`✅ Cleared demo ASN data: ${result.changes} rows`);
        }
      } catch (error: any) {
        console.warn(`⚠️ Error clearing demo ASN data:`, error.message);
      }
    }

    // Clear mock Material Requests
    for (const mrTitle of mockMRs) {
      try {
        const result = await db.runAsync(
          `DELETE FROM material_request_cache WHERE title = ?`,
          [mrTitle]
        );
        if (result.changes && result.changes > 0) {
          console.log(`✅ Cleared mock Material Request: ${mrTitle}`);
        }
      } catch (error: any) {
        console.warn(`⚠️ Error clearing mock MR ${mrTitle}:`, error.message);
      }
    }

    console.log("✅ Demo data cleared successfully");
    return true;
  } catch (error: any) {
    console.error("❌ Error clearing demo data:", error);
    throw error;
  }
};

