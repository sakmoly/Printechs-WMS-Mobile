import { ItemMaster } from "../types";
import { getSettings } from "./settings.service";
import { apiService } from "./api.service";
import { getDatabase } from "../database/database";

/**
 * Resolve item_code from barcode or item code
 * Accepts both barcode (e.g., 100000000001) and item code (e.g., ITEM-0001)
 * Always checks backend server first (if available), then caches in local database
 * Falls back to local database if backend is unavailable
 */
export const resolveItemFromBarcode = async (
  barcode: string
): Promise<ItemMaster | null> => {
  const settings = await getSettings();
  const input = barcode.trim().toUpperCase();
  const originalInput = barcode.trim(); // Keep original case for backend lookup

  // Priority 1: Always check backend server first (if available) to get latest data
  // ✅ REMOVED: Demo mode check - always use backend if API URL is configured
  if (settings.api_url) {
    try {
      console.log(`🔍 Fetching from server for: ${originalInput}`);

      // Fetch all items from backend and search
      // Catch network errors gracefully - fallback to local database is expected
      const response = await apiService.pullItemMaster().catch((error: any) => {
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

      // If response is null, it means network error occurred - fallback to local
      if (response === null) {
        console.log(
          `ℹ️ Backend unavailable, falling back to local database for: ${originalInput}`
        );
        // Continue to local database lookup below
      } else {
        // Handle different response formats
        let items: any[] = [];
        if (Array.isArray(response)) {
          items = response;
        } else if (response && typeof response === "object") {
          if (Array.isArray(response.data)) {
            items = response.data;
          } else if (Array.isArray(response.items)) {
            items = response.items;
          } else if (Array.isArray(response.result)) {
            items = response.result;
          }
        }

        console.log(
          `📦 Fetched ${items.length} items from backend, searching for: ${originalInput}`
        );

        // Search for item by barcode or item_code (case-insensitive, with partial matching)
        const searchInput = originalInput.trim();
        const searchInputUpper = searchInput.toUpperCase();

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

          // Partial match: check if barcode contains the search input or vice versa
          // This handles cases like "JEANS-041-BLK-32" matching "SKU-JEANS-041-BLK-32"
          if (
            (itemBarcode &&
              (itemBarcodeUpper.includes(searchInputUpper) ||
                searchInputUpper.includes(itemBarcodeUpper))) ||
            (itemCode &&
              (itemCodeUpper.includes(searchInputUpper) ||
                searchInputUpper.includes(itemCodeUpper)))
          ) {
            return true;
          }

          return false;
        });

        if (foundItem) {
          // Prioritize item_code from backend - only use barcode as fallback if item_code is truly missing
          // This ensures we get the correct item_code (e.g., "SKU-TSHIRT-001-BLK-S") not the barcode (e.g., "1234567890124")
          let resolvedItemCode = foundItem.item_code;
          let resolvedBarcode = foundItem.barcode;

          // If item_code is missing or empty, try to use barcode, but log a warning
          if (!resolvedItemCode || resolvedItemCode.trim() === "") {
            console.warn(
              `⚠️ Item found in backend but item_code is missing, using barcode as fallback:`,
              foundItem
            );
            resolvedItemCode = foundItem.barcode || originalInput;
          }

          // If barcode is missing, use item_code as barcode (for items that use item_code as barcode)
          if (!resolvedBarcode || resolvedBarcode.trim() === "") {
            resolvedBarcode = foundItem.item_code || originalInput;
          }

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

          // Cache the item in local database for future lookups
          try {
            const db = await getDatabase();
            await db.runAsync(
              `INSERT OR REPLACE INTO item_master (item_code, barcode, item_name, updated_on) 
             VALUES (?, ?, ?, ?)`,
              [
                resolvedItemCode,
                resolvedBarcode,
                foundItem.item_name || null,
                foundItem.updated_on || new Date().toISOString(),
              ]
            );
            console.log(
              `💾 Cached item in local database: item_code="${resolvedItemCode}", barcode="${resolvedBarcode}"`
            );
          } catch (cacheError: any) {
            console.warn(
              `⚠️ Failed to cache item in database:`,
              cacheError.message
            );
          }

          return {
            item_code: resolvedItemCode,
            barcode: resolvedBarcode,
            item_name: foundItem.item_name || null,
          };
        } else {
          console.log(`❌ Item not found in backend: ${originalInput}`);
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
        // Network errors are expected - log as info, not warning/error
        console.log(
          `ℹ️ Network unavailable for ${originalInput} (using local database): ${
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
      // Continue to local database fallback
    }
  }

  // Priority 2: Fallback to local database if backend unavailable or item not found in backend
  try {
    const db = await getDatabase();

    // Try to find by barcode (case-insensitive)
    let item = await db.getFirstAsync<ItemMaster>(
      "SELECT item_code, barcode, item_name FROM item_master WHERE UPPER(barcode) = ? OR barcode = ?",
      [input, originalInput]
    );

    if (item) {
      console.log(
        `✅ Item found in local database by barcode: ${item.item_code}`
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
        `✅ Item found in local database by item_code: ${item.item_code}`
      );
      return item;
    }
  } catch (error: any) {
    // If database lookup fails, log error
    console.warn("⚠️ Database lookup failed:", error.message);
  }

  // Item not found in backend or local database
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
