/**
 * Example: How to Get Remaining Items for an ASN
 * 
 * This file demonstrates different ways to retrieve remaining items for a specific ASN.
 * Remaining items are items that:
 * - Were shipped in the ASN
 * - Are NOT allocated to any Transfer Order (TO)
 * - Need to go to Putaway
 */

import { dataService } from "../services/data.service";
import { apiService } from "../services/api.service";

/**
 * Method 1: Using Data Service (Local Database)
 * 
 * This reads from the local SQLite database and calculates remaining items
 * based on:
 * - Shipped items from asn_carton_map
 * - TO allocations from transfer_order_cache
 * - Scanned items from scanned_items
 * - Warehouse items that need putaway
 * 
 * @param asn_no - The ASN number (e.g., "ASN-AAA")
 * @returns Array of RemainingItem objects
 */
export async function getRemainingItemsFromLocalDB(asn_no: string) {
  try {
    const remainingItems = await dataService.getRemainingItems(asn_no);
    
    console.warn(`📦 Found ${remainingItems.length} remaining items for ${asn_no}:`);
    remainingItems.forEach((item) => {
      console.warn(`  - ${item.item_code}: ${item.remaining_qty} qty (Shipped: ${item.shipped_qty}, Allocated: ${item.allocated_qty})`);
    });
    
    return remainingItems;
  } catch (error: any) {
    console.error(`❌ Error getting remaining items from local DB:`, error.message);
    throw error;
  }
}

/**
 * Method 2: Using API Service (Backend)
 * 
 * This calls the backend API endpoint to get remaining items.
 * The backend calculates remaining items server-side.
 * 
 * @param asn_no - The ASN number (e.g., "ASN-AAA")
 * @returns Array of RemainingItem objects from backend
 */
export async function getRemainingItemsFromAPI(asn_no: string) {
  try {
    const response = await apiService.getRemainingItems(asn_no);
    
    // Handle different response formats
    let remainingItems: any[] = [];
    if (Array.isArray(response)) {
      remainingItems = response;
    } else if (response?.data && Array.isArray(response.data)) {
      remainingItems = response.data;
    } else if (response?.items && Array.isArray(response.items)) {
      remainingItems = response.items;
    } else if (response?.remaining_items && Array.isArray(response.remaining_items)) {
      remainingItems = response.remaining_items;
    }
    
    console.warn(`📦 Found ${remainingItems.length} remaining items from API for ${asn_no}:`);
    remainingItems.forEach((item: any) => {
      console.warn(`  - ${item.item_code}: ${item.remaining_qty || item.qty} qty`);
    });
    
    return remainingItems;
  } catch (error: any) {
    // If API endpoint doesn't exist (404), fall back to local DB
    if (error.message?.includes("404") || error.message?.includes("not found")) {
      console.warn(`⚠️ API endpoint not available (404) - falling back to local DB`);
      return await getRemainingItemsFromLocalDB(asn_no);
    }
    console.error(`❌ Error getting remaining items from API:`, error.message);
    throw error;
  }
}

/**
 * Method 3: Combined Approach (Try API first, fallback to local DB)
 * 
 * This is the recommended approach - tries API first, falls back to local DB
 * if API is not available.
 * 
 * @param asn_no - The ASN number (e.g., "ASN-AAA")
 * @returns Array of RemainingItem objects
 */
export async function getRemainingItems(asn_no: string) {
  try {
    // Try API first
    return await getRemainingItemsFromAPI(asn_no);
  } catch (error: any) {
    // Fallback to local DB
    console.warn(`⚠️ API failed, using local DB:`, error.message);
    return await getRemainingItemsFromLocalDB(asn_no);
  }
}

/**
 * Example Usage:
 * 
 * ```typescript
 * import { getRemainingItems } from "../utils/get-remaining-items-example";
 * 
 * // Get remaining items for ASN-AAA
 * const remainingItems = await getRemainingItems("ASN-AAA");
 * 
 * // Process remaining items
 * remainingItems.forEach((item) => {
 *   console.log(`Item: ${item.item_code}, Remaining Qty: ${item.remaining_qty}`);
 * });
 * ```
 */

