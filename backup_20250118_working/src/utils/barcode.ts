import { DEMO_ITEMS } from '../types';

/**
 * Resolve item code from barcode
 */
export const resolveItemFromBarcode = (barcode: string): { item_code: string; item_name?: string } | null => {
  const item = DEMO_ITEMS.find(i => i.barcode === barcode);
  if (item) {
    return {
      item_code: item.item_code,
      item_name: item.item_name,
    };
  }
  return null;
};

/**
 * Validate barcode format
 */
export const isValidBarcode = (barcode: string): boolean => {
  return barcode.trim().length > 0;
};

/**
 * Normalize barcode (uppercase, trim)
 */
export const normalizeBarcode = (barcode: string): string => {
  return barcode.trim().toUpperCase();
};

