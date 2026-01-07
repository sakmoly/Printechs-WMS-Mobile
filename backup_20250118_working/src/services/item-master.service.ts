import { DEMO_ITEMS, ItemMaster } from '../types';
import { getSettings } from './settings.service';
import { apiService } from './api.service';

/**
 * Resolve item_code from barcode or item code
 * Accepts both barcode (e.g., 100000000001) and item code (e.g., ITEM-0001)
 * First checks cached item master, then backend if needed
 */
export const resolveItemFromBarcode = async (barcode: string): Promise<ItemMaster | null> => {
  const settings = await getSettings();
  const input = barcode.trim().toUpperCase();

  // First, try to find by barcode
  let demoItem = DEMO_ITEMS.find(i => i.barcode === input || i.barcode === barcode);
  if (demoItem) {
    return demoItem;
  }

  // If not found by barcode, try to find by item code
  demoItem = DEMO_ITEMS.find(i => i.item_code === input || i.item_code === barcode);
  if (demoItem) {
    return demoItem;
  }

  // In demo mode, return null if not found in demo items
  if (settings.demo_mode === 1) {
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
 */
export const getItemByCode = async (item_code: string): Promise<ItemMaster | null> => {
  const settings = await getSettings();

  // Check demo items
  const demoItem = DEMO_ITEMS.find(i => i.item_code === item_code);
  if (demoItem) {
    return demoItem;
  }

  // In demo mode, return null if not found
  if (settings.demo_mode === 1) {
    return null;
  }

  // TODO: Backend lookup
  return null;
};

