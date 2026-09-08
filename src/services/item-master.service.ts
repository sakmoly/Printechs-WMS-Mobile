import { ItemMaster } from "../types";
import { getSettings } from "./settings.service";
import { apiService } from "./api.service";
import { getDatabase } from "../database/database";
import { normalizeItemMasterBarcode } from "../utils/itemMasterBarcode";

export const cacheItemMasterRecord = async (
  item: ItemMaster,
  updatedOn?: string | null
) => {
  try {
    const db = await getDatabase();
    const barcode = normalizeItemMasterBarcode(item.barcode, item.item_code);
    const ts = updatedOn || new Date().toISOString();
    await db.runAsync(
      `INSERT OR REPLACE INTO item_master (item_code, barcode, item_name, updated_on) 
       VALUES (?, ?, ?, ?)`,
      [item.item_code, barcode, item.item_name || null, ts]
    );
    if (barcode && barcode !== item.item_code) {
      await db.runAsync(
        `INSERT OR REPLACE INTO item_barcode_map (
           barcode, item_code, uom, pack_size, barcode_type, updated_on
         ) VALUES (?, ?, 'EA', 1, 'Unit', ?)`,
        [barcode, item.item_code, ts]
      );
    }
    console.log(
      `💾 Cached resolved item: item_code="${item.item_code}", barcode="${barcode}"`
    );
  } catch (cacheError: any) {
    console.warn(`⚠️ Failed to cache resolved item:`, cacheError.message);
  }
};

const cacheResolvedItem = cacheItemMasterRecord;

const itemFromLookupResponse = (
  response: any,
  scannedValue: string
): { item: ItemMaster; updatedOn?: string | null } | null => {
  if (!response || typeof response !== "object") {
    return null;
  }

  if (
    response.ok === false ||
    response.found === false ||
    response.data?.found === false
  ) {
    return null;
  }

  const raw =
    response.item ||
    response.data?.item ||
    (response.data &&
    typeof response.data === "object" &&
    !Array.isArray(response.data) &&
    (response.data.item_code || response.data.code)
      ? response.data
      : null) ||
    response.result ||
    null;

  const lookupItem = raw ? (Array.isArray(raw) ? raw[0] : raw) : null;
  if (!lookupItem || typeof lookupItem !== "object") {
    return null;
  }

  const itemCode = String(
    lookupItem.item_code ||
      lookupItem.code ||
      lookupItem.name ||
      lookupItem.item ||
      ""
  ).trim();
  if (!itemCode) {
    return null;
  }

  const barcode = normalizeItemMasterBarcode(
    lookupItem.barcode || lookupItem.item_barcode || scannedValue,
    itemCode
  );

  return {
    item: {
      item_code: itemCode,
      barcode,
      item_name:
        lookupItem.item_name ||
        lookupItem.name1 ||
        lookupItem.description ||
        null,
    },
    updatedOn: lookupItem.updated_on || lookupItem.modified || null,
  };
};

/** Lookup one item via wms-api /api/master/items/lookup and cache locally. */
export async function lookupAndCacheItemFromApi(
  params: { barcode?: string; item_code?: string },
  scannedValue: string
): Promise<ItemMaster | null> {
  const settings = await getSettings();
  if (!settings.api_url) return null;
  try {
    const response = await apiService.lookupItem(params);
    const parsed = itemFromLookupResponse(response, scannedValue);
    if (!parsed) return null;
    await cacheItemMasterRecord(parsed.item, parsed.updatedOn);
    return parsed.item;
  } catch (error: any) {
    console.warn(
      `⚠️ Item lookup API failed (${params.barcode || params.item_code}):`,
      error?.message || error
    );
    return null;
  }
}

async function findItemInLocalDatabase(
  scannedValue: string
): Promise<ItemMaster | null> {
  const scan = scannedValue.trim();
  if (!scan) return null;

  try {
    const db = await getDatabase();
    const inputUpper = scan.toUpperCase();

    const fromMap = await db.getFirstAsync<{
      item_code: string;
      barcode: string;
    }>(
      "SELECT item_code, barcode FROM item_barcode_map WHERE barcode = ? OR UPPER(barcode) = ? OR item_code = ? OR UPPER(item_code) = ?",
      [scan, inputUpper, scan, inputUpper]
    );
    if (fromMap) {
      const itemMaster = await db.getFirstAsync<ItemMaster>(
        "SELECT item_code, barcode, item_name FROM item_master WHERE item_code = ?",
        [fromMap.item_code]
      );
      return (
        itemMaster || {
          item_code: fromMap.item_code,
          barcode: fromMap.barcode,
          item_name: undefined,
        }
      );
    }

    const item = await db.getFirstAsync<ItemMaster>(
      `SELECT item_code, barcode, item_name FROM item_master
       WHERE barcode = ? OR UPPER(barcode) = ? OR item_code = ? OR UPPER(item_code) = ?
       LIMIT 1`,
      [scan, inputUpper, scan, inputUpper]
    );
    return item || null;
  } catch {
    return null;
  }
}

/**
 * Cycle count online scan: resolve exactly one scanned item through backend.
 * This avoids downloading the full item master for large ERPNext item catalogs.
 */
export const resolveItemFromOnlineScan = async (
  scannedValue: string
): Promise<ItemMaster | null> => {
  const scan = scannedValue.trim();
  if (!scan) return null;

  const localItem = await findItemInLocalDatabase(scan);
  if (localItem) {
    console.log(
      `✅ Online scan: item "${scan}" found in local cache (item_code=${localItem.item_code})`
    );
    return localItem;
  }

  const tryLookup = async (mode: "barcode" | "item_code") => {
    const response = await apiService.lookupItem({
      [mode]: scan,
      online: true,
    });
    console.log(
      `🌐 Online lookup response (${mode}):`,
      JSON.stringify(response)?.substring(0, 500)
    );
    const parsed = itemFromLookupResponse(response, scan);
    if (!parsed && response && typeof response === "object") {
      const reason =
        (response as any).message ||
        (response as any).online_lookup_reason ||
        (response as any).error?.message;
      if (reason) {
        throw new Error(String(reason));
      }
    }
    return parsed;
  };

  try {
    console.log(`🌐 Online cycle count item lookup by barcode: "${scan}"`);
    let resolved = await tryLookup("barcode");
    if (!resolved) {
      console.log(`🌐 Online cycle count item lookup by item_code: "${scan}"`);
      resolved = await tryLookup("item_code");
    }

    if (!resolved) {
      throw new Error(
        `Backend lookup returned no item for "${scan}". Check server log for [Master] items/lookup.`
      );
    }

    await cacheResolvedItem(resolved.item, resolved.updatedOn);
    return resolved.item;
  } catch (error: any) {
    const status = (error as any).status;
    const detail = error?.message || "Unknown error";
    console.warn(
      `⚠️ Online item lookup failed for "${scan}":`,
      detail,
      status ? `(HTTP ${status})` : ""
    );
    throw new Error(
      status
        ? `Online lookup failed (HTTP ${status}): ${detail}`
        : `Online lookup failed: ${detail}`
    );
  }
};

/**
 * Resolve item_code from barcode or item code
 * Accepts both barcode (e.g., 100000000001) and item code (e.g., ITEM-0001)
 * Priority 1: Checks local database first (item_master, item_barcode_map)
 * Priority 2: If not found locally, checks backend server and caches result
 * Falls back gracefully if backend is unavailable
 */
export const resolveItemFromBarcode = async (
  barcode: string
): Promise<ItemMaster | null> => {
  const settings = await getSettings();
  const input = barcode.trim().toUpperCase();
  const originalInput = barcode.trim(); // Keep original case for backend lookup

  // Priority 1: Check local database first (faster, works offline)
  try {
    const db = await getDatabase();

    // First, try item_barcode_map table (most specific)
    let barcodeMap = await db.getFirstAsync<{
      item_code: string;
      barcode: string;
      uom: string;
      pack_size: number;
    }>(
      "SELECT item_code, barcode, uom, pack_size FROM item_barcode_map WHERE barcode = ? OR UPPER(barcode) = ?",
      [originalInput, input]
    );

    if (barcodeMap) {
      console.log(
        `✅ Item found in local item_barcode_map: item_code="${barcodeMap.item_code}", barcode="${barcodeMap.barcode}"`
      );
      // Get item details from item_master if available
      const itemMaster = await db.getFirstAsync<ItemMaster>(
        "SELECT item_code, barcode, item_name FROM item_master WHERE item_code = ?",
        [barcodeMap.item_code]
      );
      if (itemMaster) {
        return itemMaster;
      }
      // Return basic info from barcode_map
      return {
        item_code: barcodeMap.item_code,
        barcode: barcodeMap.barcode,
        item_name: undefined,
      };
    }

    // Try to find by barcode in item_master (case-insensitive)
    let item = await db.getFirstAsync<ItemMaster>(
      "SELECT item_code, barcode, item_name FROM item_master WHERE UPPER(barcode) = ? OR barcode = ?",
      [input, originalInput]
    );

    if (item) {
      console.log(
        `✅ Item found in local database by barcode: item_code="${item.item_code}"`
      );
      return item;
    }

    // If not found by barcode, try to find by item code (case-insensitive)
    item = await db.getFirstAsync<ItemMaster>(
      "SELECT item_code, barcode, item_name FROM item_master WHERE UPPER(item_code) = ? OR item_code = ?",
      [input, originalInput]
    );

    if (item) {
      console.log(
        `✅ Item found in local database by item_code: item_code="${item.item_code}"`
      );
      return item;
    }
  } catch (error: any) {
    // If database lookup fails, log error and continue to backend lookup
    console.warn("⚠️ Database lookup failed:", error.message);
  }

  // Priority 2: Single-item lookup API (same as Postman / cycle count online)
  if (settings.api_url) {
    const fromBarcode = await lookupAndCacheItemFromApi(
      { barcode: originalInput },
      originalInput
    );
    if (fromBarcode) {
      console.log(
        `✅ Item found via lookup API (barcode): item_code="${fromBarcode.item_code}"`
      );
      return fromBarcode;
    }
    const fromItemCode = await lookupAndCacheItemFromApi(
      { item_code: originalInput },
      originalInput
    );
    if (fromItemCode) {
      console.log(
        `✅ Item found via lookup API (item_code): item_code="${fromItemCode.item_code}"`
      );
      return fromItemCode;
    }
  }

  // Priority 3: If not found locally, check backend server (full catalog download)
  if (settings.api_url) {
    try {
      console.log(`🔍 Fetching from server for: ${originalInput}`);

      // Fetch all items from backend and search
      // Catch network errors gracefully - fallback to local database is expected
      const { fetchAllItemMasterRowsForLookup } = await import(
        "./item-master-sync.service"
      );
      const response: unknown = await fetchAllItemMasterRowsForLookup().catch((error: any) => {
        // Check if it's a network error (expected when offline or server unavailable)
        const isNetworkError =
          error?.message?.includes("Network") ||
          error?.message?.includes("Failed") ||
          error?.message?.includes("aborted") ||
          error?.name === "AbortError" ||
          error?.message?.includes("request failed");

        if (isNetworkError) {
          // Network errors are expected - log as warning, not error
          console.warn(
            `⚠️ Network error fetching item master (will use local database): ${
              error.message || error.name || "Network request failed"
            }`
          );
          // Return null to trigger fallback to local database
          return null;
        }
        // For other errors, re-throw to be handled by outer try-catch
        throw error;
      });

      // If response is null, it means network error occurred - item not found
      if (response === null) {
        console.log(
          `ℹ️ Backend unavailable, item not found: ${originalInput}`
        );
        // Return null - item not found
        return null;
      } else {
        // Handle different response formats
        let items: any[] = [];
        const r = response as Record<string, unknown> | unknown[] | null;
        if (Array.isArray(r)) {
          items = r;
        } else if (r && typeof r === "object") {
          const obj = r as Record<string, unknown>;
          if (Array.isArray(obj.data)) {
            items = obj.data as any[];
          } else if (Array.isArray(obj.items)) {
            items = obj.items as any[];
          } else if (Array.isArray(obj.result)) {
            items = obj.result as any[];
          }
        }

        console.log(
          `📦 Fetched ${items.length} items from backend, searching for: ${originalInput}`
        );

        // Search for item by barcode or item_code (case-insensitive, with partial matching)
        const searchInput = originalInput.trim();
        const searchInputUpper = searchInput.toUpperCase();

        const isWmsContainerId = /^(BOX|PAW|PUTAWAY|CTN|TC)-/i.test(
          searchInputUpper
        );

        const foundItem = items.find((item: any) => {
          const itemBarcode = String(item.barcode || "").trim();
          const itemCode = String(item.item_code || "").trim();
          const itemBarcodeUpper = itemBarcode.toUpperCase();
          const itemCodeUpper = itemCode.toUpperCase();

          // Exact match (case-insensitive)
          if (
            itemBarcodeUpper === searchInputUpper ||
            itemBarcode === searchInput ||
            itemCodeUpper === searchInputUpper ||
            itemCode === searchInput
          ) {
            return true;
          }

          // Never fuzzy-match WMS box/carton ids to items (e.g. BOX-006-171550 must not match item "15").
          if (isWmsContainerId) {
            return false;
          }

          // Partial match when the scan looks like an item barcode/SKU fragment.
          // Only allow "item contains scan", not "scan contains item" — short codes like "15"
          // must not match inside longer ids such as BOX-006-171550.
          if (
            itemBarcode &&
            itemBarcodeUpper.includes(searchInputUpper)
          ) {
            return true;
          }
          if (
            itemCode &&
            itemCodeUpper.length >= 4 &&
            itemCodeUpper.includes(searchInputUpper)
          ) {
            return true;
          }

          return false;
        });

        if (foundItem) {
          // Prioritize item_code from backend - only use barcode as fallback if item_code is truly missing
          // This ensures we get the correct item_code (e.g., "SKU-TSHIRT-001-BLK-S") not the barcode (e.g., "1234567890124")
          let resolvedItemCode = foundItem.item_code;

          // If item_code is missing or empty, try to use barcode, but log a warning
          if (!resolvedItemCode || resolvedItemCode.trim() === "") {
            console.warn(
              `⚠️ Item found in backend but item_code is missing, using barcode as fallback:`,
              foundItem
            );
            resolvedItemCode = foundItem.barcode || originalInput;
          }

          const resolvedBarcode = normalizeItemMasterBarcode(
            foundItem.barcode,
            String(resolvedItemCode).trim()
          );

          // Ensure we have at least one identifier
          if (!resolvedItemCode || resolvedItemCode.trim() === "") {
            console.warn(
              `⚠️ Item found but has no item_code or barcode:`,
              foundItem
            );
            return null;
          }

          console.log(
            `✅ Item found in backend: item_code="${resolvedItemCode}", barcode="${resolvedBarcode}"`
          );

          await cacheResolvedItem(
            {
              item_code: resolvedItemCode,
              barcode: resolvedBarcode,
              item_name: foundItem.item_name || null,
            },
            foundItem.updated_on
          );

          return {
            item_code: resolvedItemCode,
            barcode: resolvedBarcode,
            item_name: foundItem.item_name || null,
          };
        } else {
          console.log(`❌ Item not found in backend: ${originalInput}`);
          // Item not found in backend - return null
          return null;
        }
      }
    } catch (error: any) {
      // Check if it's a network error (expected when offline or server unavailable)
      const isNetworkError =
        error?.message?.includes("Network") ||
        error?.message?.includes("Failed") ||
        error?.message?.includes("aborted") ||
        error?.name === "AbortError" ||
        error?.message?.includes("request failed");

      if (isNetworkError) {
        // Network errors are expected - log as info
        console.log(
          `ℹ️ Network unavailable for ${originalInput}: ${
            error.message || error.name || "Network request failed"
          }`
        );
      } else {
        // Other errors - log as warning
        console.warn(
          `⚠️ Backend lookup failed for ${originalInput}:`,
          error.message
        );
      }
      // Backend unavailable or error - item not found
      return null;
    }
  }

  // Item not found in local database or backend
  console.log(`❌ Item not found: ${originalInput}`);
  return null;
};

/**
 * Get item by item_code
 * First checks database (item_master table), then backend if needed
 */
export const getItemByCode = async (
  item_code: string
): Promise<ItemMaster | null> => {
  // Use resolveItemFromBarcode since it handles both barcode and item_code lookups
  return resolveItemFromBarcode(item_code);
};
