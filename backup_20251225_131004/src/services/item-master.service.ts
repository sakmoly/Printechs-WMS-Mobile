import { ItemMaster } from "../types";
import { getSettings } from "./settings.service";
import { apiService } from "./api.service";
import { getDatabase } from "../database/database";

/**
 * Resolve item_code from barcode or item code
 * Accepts both barcode (e.g., 100000000001) and item code (e.g., ITEM-0001)
 * First checks database (item_master table), then backend if needed
 */
export const resolveItemFromBarcode = async (
  barcode: string
): Promise<ItemMaster | null> => {
  const settings = await getSettings();
  const input = barcode.trim().toUpperCase();

  try {
    // First, try to find in database (item_master table)
    const db = await getDatabase();

    // Try to find by barcode
    let item = await db.getFirstAsync<ItemMaster>(
      "SELECT item_code, barcode, item_name FROM item_master WHERE barcode = ? OR barcode = ?",
      [input, barcode]
    );

    if (item) {
      return item;
    }

    // If not found by barcode, try to find by item code
    item = await db.getFirstAsync<ItemMaster>(
      "SELECT item_code, barcode, item_name FROM item_master WHERE item_code = ? OR item_code = ?",
      [input, barcode]
    );

    if (item) {
      return item;
    }
  } catch (error: any) {
    // If database lookup fails, log error and return null
    console.warn("⚠️ Database lookup failed:", error.message);
    return null;
  }

  // TODO: Backend lookup
  // For production, implement:
  // const item = await apiService.getItemByBarcode(barcode);
  // return item;

  return null;
};

/**
 * Get item by item_code
 * First checks database (item_master table), then backend if needed
 */
export const getItemByCode = async (
  item_code: string
): Promise<ItemMaster | null> => {
  const settings = await getSettings();
  const input = item_code.trim().toUpperCase();

  try {
    // First, try to find in database (item_master table)
    const db = await getDatabase();
    const item = await db.getFirstAsync<ItemMaster>(
      "SELECT item_code, barcode, item_name FROM item_master WHERE item_code = ? OR item_code = ?",
      [input, item_code]
    );

    if (item) {
      return item;
    }
  } catch (error: any) {
    // If database lookup fails, log error and return null
    console.warn("⚠️ Database lookup failed:", error.message);
    return null;
  }

  // TODO: Backend lookup
  return null;
};
