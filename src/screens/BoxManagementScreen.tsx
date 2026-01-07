import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  FlatList,
  TextInput,
  Modal,
} from "react-native";
import { useApp } from "../context/AppContext";
import { useNavigation } from "@react-navigation/native";
import { StatusBadge } from "../components/StatusBadge";
import { ProgressIndicator } from "../components/ProgressIndicator";
import { BarcodeDisplay } from "../components/BarcodeDisplay";
import { dataService } from "../services/data.service";
import { apiService } from "../services/api.service";
import { getSettings } from "../services/settings.service";
import { getDatabase } from "../database/database";
import { normalizeASN } from "../utils/asn";
import { Share } from "react-native";

export default function BoxManagementScreen() {
  const navigation = useNavigation();
  const { activeASN, activeSession } = useApp();
  const [boxes, setBoxes] = useState<any[]>([]);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedBox, setExpandedBox] = useState<string | null>(null);
  const [filteredBoxes, setFilteredBoxes] = useState<any[]>([]);
  const [transferOrder, setTransferOrder] = useState<string | null>(null);
  const [distributionStores, setDistributionStores] = useState<string[]>([]);
  const [warehousesAndStores, setWarehousesAndStores] = useState<any[]>([]);
  const [itemsWithoutTO, setItemsWithoutTO] = useState<any[]>([]);
  const [hasItemsWithoutTO, setHasItemsWithoutTO] = useState(false);
  const [totalASNQty, setTotalASNQty] = useState(0);
  const [totalTOAllocatedQty, setTotalTOAllocatedQty] = useState(0);
  const [remainingItemsQty, setRemainingItemsQty] = useState(0);
  const [boxItemsModal, setBoxItemsModal] = useState<{
    visible: boolean;
    boxId: string;
    items: Array<{ 
      item_code: string; 
      scanned_qty: number; // Quantity in this box
      asn_qty: number; // ASN quantity (from asn_carton_map)
      total_scanned_qty: number; // Total scanned across all boxes/stores
      balance: number; // ASN Qty - Total Scanned
    }>;
  } | null>(null);

  useEffect(() => {
    loadBoxes();
    loadTransferOrderAndStores();
    loadWarehousesAndStores();
    checkItemsWithoutTO();
    calculateRemainingItems();
  }, [activeASN]);

  // Calculate remaining items: Total ASN - Total TO
  const calculateRemainingItems = async () => {
    if (!activeASN) {
      setTotalASNQty(0);
      setTotalTOAllocatedQty(0);
      setRemainingItemsQty(0);
      return;
    }

    try {
      // Get Total ASN quantity from carton items
      const db = await getDatabase();
      if (!db) {
        setTotalASNQty(0);
        setTotalTOAllocatedQty(0);
        setRemainingItemsQty(0);
        return;
      }

      const normalizedASN = normalizeASN(activeASN);
      
      // Get Total ASN quantity - sum of all shipped_qty from asn_carton_map for this ASN
      // Try both original and normalized ASN formats
      const result = await db.getFirstAsync<{ total_qty: number }>(
        `SELECT COALESCE(SUM(shipped_qty), 0) as total_qty
         FROM asn_carton_map
         WHERE asn_no = ? OR asn_no = ?`,
        [activeASN, normalizedASN]
      );

      const totalASN = result?.total_qty || 0;
      setTotalASNQty(totalASN);

      // Get Total TO Allocated quantity
      const allocations = await dataService.getTransferOrderAllocations(activeASN);
      const totalTO = allocations.reduce((sum, alloc) => sum + (alloc.allocated_qty || 0), 0);
      setTotalTOAllocatedQty(totalTO);

      // Calculate remaining: Total ASN - Total TO
      const remaining = Math.max(0, totalASN - totalTO);
      setRemainingItemsQty(remaining);

      console.log(`📊 Remaining Items Calculation:`);
      console.log(`  - Total ASN: ${totalASN}`);
      console.log(`  - Total TO Allocated: ${totalTO}`);
      console.log(`  - Remaining (Putaway): ${remaining}`);
    } catch (error: any) {
      console.warn(`⚠️ Error calculating remaining items:`, error.message);
      setTotalASNQty(0);
      setTotalTOAllocatedQty(0);
      setRemainingItemsQty(0);
    }
  };

  // Also check items without TO when boxes change (items might have been sorted into boxes)
  useEffect(() => {
    if (activeASN) {
      checkItemsWithoutTO();
      calculateRemainingItems(); // Recalculate when boxes change
    }
  }, [boxes, activeASN, transferOrder]); // Recalculate when TO changes

  // Check for items without TO allocation
  const checkItemsWithoutTO = async () => {
    if (!activeASN) {
      setItemsWithoutTO([]);
      setHasItemsWithoutTO(false);
      return;
    }

    try {
      const db = await getDatabase();
      if (!db) {
        setItemsWithoutTO([]);
        setHasItemsWithoutTO(false);
        return;
      }

      const normalizedASN = normalizeASN(activeASN);

      // Get all scanned items for this ASN
      const scannedItems = await db.getAllAsync<{
        item_code: string;
        scanned_qty: number;
        store: string | null;
        box_id: string | null;
      }>(
        `SELECT item_code, SUM(scanned_qty) as scanned_qty, store, box_id 
         FROM scanned_items 
         WHERE asn_no = ? 
         GROUP BY item_code, store, box_id`,
        [normalizedASN]
      );

      // Get all TO allocations
      const allocations = await dataService.getTransferOrderAllocations(activeASN);
      const allocatedItemCodes = new Set(allocations.map(a => a.item_code));

      // Find items that are NOT allocated to any TO
      const unallocatedItems: any[] = [];
      const itemMap = new Map<string, { scanned_qty: number; store: string | null; box_id: string | null }>();

      for (const item of scannedItems) {
        const itemCode = item.item_code;
        const isAllocated = allocatedItemCodes.has(itemCode);
        
        // Also check if item was scanned to warehouse (needs putaway)
        const isWarehouse = item.store && (
          item.store.toUpperCase() === "WAREHOUSE" || 
          item.store.toUpperCase().startsWith("WH-")
        );

        if (!isAllocated || isWarehouse) {
          const existing = itemMap.get(itemCode);
          if (existing) {
            existing.scanned_qty += item.scanned_qty || 0;
          } else {
            itemMap.set(itemCode, {
              scanned_qty: item.scanned_qty || 0,
              store: item.store,
              box_id: item.box_id,
            });
          }
        }
      }

      // Convert map to array
      for (const [itemCode, data] of itemMap.entries()) {
        // Only include if not already in a Putaway box
        if (!data.box_id || !data.box_id.startsWith("PAW-")) {
          unallocatedItems.push({
            item_code: itemCode,
            scanned_qty: data.scanned_qty,
            store: data.store,
          });
        }
      }

      setItemsWithoutTO(unallocatedItems);
      setHasItemsWithoutTO(unallocatedItems.length > 0);
      
      console.warn(`📦 Items without TO: ${unallocatedItems.length}`, unallocatedItems);
    } catch (error: any) {
      console.warn(`⚠️ Error checking items without TO:`, error.message);
      setItemsWithoutTO([]);
      setHasItemsWithoutTO(false);
    }
  };

  const loadWarehousesAndStores = async () => {
    try {
      const response = await apiService.getWarehousesAndStores();
      let storesList: any[] = [];
      if (Array.isArray(response)) {
        storesList = response;
      } else if (response && typeof response === "object") {
        if (Array.isArray(response.data)) {
          storesList = response.data;
        } else if (Array.isArray(response.stores)) {
          storesList = response.stores;
        } else if (Array.isArray(response.items)) {
          storesList = response.items;
        }
      }
      console.log(`📦 Loaded ${storesList.length} warehouses/stores from API`);
      setWarehousesAndStores(storesList);
    } catch (error: any) {
      console.warn("⚠️ Could not fetch warehouses/stores from API:", error);
      // Fallback: Load from database cache
      try {
        const db = await getDatabase();
        if (db) {
          const cachedStores = await db.getAllAsync<{
            code: string;
            name: string;
            warehouse_type: string;
            is_group: number;
            parent_warehouse: string | null;
          }>("SELECT * FROM warehouse_store_cache ORDER BY code");
          console.log(`📦 Loaded ${cachedStores.length} warehouses/stores from cache`);
          setWarehousesAndStores(cachedStores);
        } else {
          setWarehousesAndStores([]);
        }
      } catch (cacheError: any) {
        console.warn("⚠️ Could not load warehouses/stores from cache:", cacheError);
        setWarehousesAndStores([]);
      }
    }
  };

  // Clear expanded box when store selection changes
  useEffect(() => {
    setExpandedBox(null);
  }, [selectedStore]);

  const loadTransferOrderAndStores = async () => {
    if (!activeASN) {
      setTransferOrder(null);
      setDistributionStores([]);
      return;
    }

    try {
      const db = await getDatabase();
      const normalizedASN = normalizeASN(activeASN);
      
      // STEP 1: Check if there are scanned items for this ASN
      // Items must be scanned first (in Receive + Sort) before we can create boxes
      const scannedItems = await db.getAllAsync<{
        item_code: string;
        store: string | null;
        scanned_qty: number;
      }>(
        `SELECT DISTINCT item_code, store, SUM(scanned_qty) as scanned_qty
         FROM scanned_items 
         WHERE asn_no = ? OR asn_no = ?
         GROUP BY item_code, store`,
        [activeASN, normalizedASN]
      );
      
      console.log(`🔍 Found ${scannedItems.length} scanned item/store combinations for ASN ${activeASN}`);
      
      // STEP 2: Get transfer order allocations for this ASN
      // This should only return allocations for the current ASN
      const allocations = await dataService.getTransferOrderAllocations(
        activeASN
      );
      
      // STEP 3: Determine if TO exists
      const hasTO = allocations.length > 0;
      
      console.log(`🔍 TO Analysis for ASN ${activeASN}:`);
      console.log(`  - Has TO: ${hasTO}`);
      console.log(`  - Scanned items count: ${scannedItems.length}`);
      
      // STEP 4: Logic for showing stores:
      // - If TO exists → show stores from TO → allow creating boxes for TO stores
      // - If no TO → show Putaway section → allow creating Putaway boxes
      // The Putaway section visibility is controlled separately by hasItemsWithoutTO and hasPutawayBoxes
      
      if (!hasTO) {
        console.log(`ℹ️ No TO found in local cache - will try API fetch, then show Putaway section if still no TO`);
        setTransferOrder(null);
        setDistributionStores([]);
        // Continue to API fetch - might find TO there
      } else {
        console.log(`ℹ️ TO exists in local cache - will show TO stores for creating boxes`);
        console.log(`ℹ️ Found ${allocations.length} TO allocations - extracting stores...`);
        // Continue with logic to load TO and stores below
      }

      // Continue with existing logic to load TO and stores
      // This will execute if hasTO is true
      console.log(`🔍 Loading TO allocations for ASN: ${activeASN}`);
      console.log(`🔍 Found ${allocations.length} allocations in database`);
      
      if (allocations.length > 0) {
        console.log(`🔍 Sample allocations:`, allocations.slice(0, 5).map(a => ({ 
          asn_no: a.asn_no, 
          to_no: a.to_no, 
          store: a.store, 
          item_code: a.item_code 
        })));
        
        // Verify all allocations are for the current ASN
        const wrongASN = allocations.filter(a => {
          const allocASN = a.asn_no?.toUpperCase().trim();
          const currentASN = activeASN.toUpperCase().trim();
          return allocASN !== currentASN;
        });
        if (wrongASN.length > 0) {
          console.error(`❌ ERROR: Found ${wrongASN.length} allocations for different ASN!`);
          console.error(`❌ Current ASN: ${activeASN}, Wrong ASN allocations:`, wrongASN.map(a => a.asn_no));
        }
      }

      let shouldFetchFromAPI = true; // Default to fetching from API
      
      if (allocations.length > 0) {
        // Get unique TO number (should be same for all allocations)
        const toNo = allocations[0].to_no;
        
        // Verify TO matches current ASN - if not, clear cache and fetch from API
        const allASNs = Array.from(new Set(allocations.map(a => a.asn_no).filter(Boolean)));
        const currentASNUpper = activeASN.toUpperCase().trim();
        const allocationsMatchASN = allASNs.every(asn => asn.toUpperCase().trim() === currentASNUpper);
        
        // Also verify TO number is correct (not old cached data like TO-00012 for ASN-12225)
        // For ASN-12225, the correct TO should be TO-0001 (from backend)
        let cacheIsValid = allocationsMatchASN && allASNs.length > 0;
        
        if (cacheIsValid && activeASN === "ASN-12225" && toNo && toNo !== "TO-0001") {
          console.error(`❌ ERROR: Cached TO ${toNo} doesn't match expected TO-0001 for ASN-12225!`);
          console.error(`❌ This is old cached data - clearing cache and fetching fresh data...`);
          cacheIsValid = false;
        }
        
        if (!cacheIsValid) {
          console.error(`❌ ERROR: Cached TO allocations are invalid or don't match!`);
          console.error(`❌ Current ASN: ${activeASN}`);
          console.error(`❌ Cached allocations ASNs:`, allASNs);
          console.error(`❌ Cached TO: ${toNo}`);
          console.warn(`⚠️ Clearing old cached allocations and fetching fresh data from API...`);
          
          // Clear old cached allocations for this ASN
          try {
            const dbForClear = await getDatabase();
            const normalizedASNForClear = normalizeASN(activeASN);
            await dbForClear.runAsync(
              `DELETE FROM transfer_order_cache WHERE asn_no = ? OR asn_no = ?`,
              [activeASN, normalizedASNForClear]
            );
            console.log(`✅ Cleared old cached TO allocations`);
          } catch (clearError: any) {
            console.warn(`⚠️ Failed to clear old cached allocations:`, clearError.message);
          }
          
          // Don't use cached data - will fetch from API below
          setTransferOrder(null);
          setDistributionStores([]);
          shouldFetchFromAPI = true; // Force API fetch
        } else {
          // Cache is valid - use it
          shouldFetchFromAPI = false; // Don't fetch from API
          // Allocations match current ASN and TO is valid - use them
          console.log(`✅ Verified: Cached TO allocations match current ASN ${activeASN}`);
          console.log(`✅ TO Number: ${toNo}`);
          setTransferOrder(toNo || null);

          // Get unique stores from allocations (include ALL stores from TO, including warehouses)
          // Log sample allocations to debug store field extraction
          if (allocations.length > 0) {
            console.log(`📦 Sample cached allocation:`, allocations[0]);
            console.log(`📦 All stores in cached allocations:`, allocations.map(a => a.store).filter(Boolean));
          }
          
          const uniqueStores = Array.from(
            new Set(allocations.map((a) => a.store).filter((s) => s && String(s).trim() !== ""))
          );

          console.log(`📦 Store codes from local TO allocations:`, uniqueStores);
          console.log(`📦 Total unique stores found: ${uniqueStores.length}`);
          
          // Include ALL stores from TO allocations (including warehouses like WAREHOUSE, WH-MAIN, etc.)
          setDistributionStores(uniqueStores.sort());
          
          console.log(
            `✅ Found ${allocations.length} allocations in local database for ASN ${activeASN}`
          );
          console.log(
            `📦 Stores from Transfer Order for ASN ${activeASN}:`,
            uniqueStores
          );
          console.log(`📦 Transfer Order: ${toNo}`);
          console.log(`📦 Sample allocations:`, allocations.slice(0, 5).map(a => ({ store: a.store, item: a.item_code, allocated_qty: a.allocated_qty })));
          console.log(`📦 All unique stores in allocations:`, Array.from(new Set(allocations.map(a => a.store).filter(Boolean))));
          
        }
      }
      
      // If we didn't use cached data (either no cache or invalid cache), fetch from API
      // Also fetch if cache had no stores (might be incomplete data)
      // Check if we need to fetch from API (no allocations found OR cache was invalid OR no stores found)
      const needsAPIFetch = allocations.length === 0 || shouldFetchFromAPI;
      
      if (needsAPIFetch) {
        if (allocations.length > 0) {
          console.log(`ℹ️ Cached allocations were invalid, fetching fresh data from API for ASN ${activeASN}...`);
        } else {
          console.log(`ℹ️ No allocations found in local database for ASN ${activeASN}, fetching from API...`);
        }
        // Fetch TO from API
        try {
          console.log(`🔄 Fetching Transfer Order from API for ASN: ${activeASN}`);
          const toResponse = await apiService.getTransferOrderByASN(activeASN);
          console.log("📋 Transfer Order API Response (raw):", toResponse);
          console.log("📋 Transfer Order API Response (stringified):", JSON.stringify(toResponse, null, 2));
          console.log("📋 Transfer Order API Response type:", typeof toResponse);
          console.log("📋 Transfer Order API Response is null?", toResponse === null);
          console.log("📋 Transfer Order API Response is undefined?", toResponse === undefined);
          console.log("📋 Transfer Order API Response keys:", toResponse ? Object.keys(toResponse) : "null/undefined");
          
          // Handle different response formats
          const toData = toResponse?.data || toResponse?.transfer_order || toResponse;
          console.log("📋 Extracted toData:", toData);
          console.log("📋 toData type:", typeof toData);
          console.log("📋 toData is null?", toData === null);
          console.log("📋 toData is undefined?", toData === undefined);
          console.log("📋 toData keys:", toData ? Object.keys(toData) : "null/undefined");
          
          // If toResponse is null, it means no TO was found (404)
          if (toResponse === null) {
            console.log(`ℹ️ API returned null - No Transfer Order found for ASN ${activeASN}`);
            setTransferOrder(null);
            setDistributionStores([]);
            return; // Exit early if no TO found
          }
          
          if (toData && (toData.to_no || toData.transfer_order)) {
            const toNo = toData.to_no || toData.transfer_order;
            setTransferOrder(toNo);
            console.log(`✅ Transfer Order found: ${toNo}`);
            console.log(`✅ Setting transferOrder state to: ${toNo}`);
            
            // Extract stores from allocations if available
            // Try multiple possible field names for allocations
            // Based on backend structure, it might be: allocations, items, item_lines, line_items, lines, etc.
            const allocations = 
              toData.allocations || 
              toData.items || 
              toData.item_lines ||  // Backend might use "item_lines" (as seen in TO details modal)
              toData.allocation || 
              toData.line_items ||
              toData.lines ||
              (Array.isArray(toData) ? toData : []);
            
            console.log(`📦 Extracted allocations:`, allocations);
            console.log(`📦 Allocations type:`, typeof allocations);
            console.log(`📦 Allocations isArray:`, Array.isArray(allocations));
            console.log(`📦 Allocations length:`, Array.isArray(allocations) ? allocations.length : "N/A");
            
            if (allocations && Array.isArray(allocations) && allocations.length > 0) {
              console.log(`📦 First allocation sample:`, allocations[0]);
              // Save allocations to local database for future queries
              // Normalize ASN for storage consistency
              const normalizedASN = normalizeASN(activeASN);
              const db = await getDatabase();
              
              try {
                // Clear old allocations for this ASN before saving new ones
                // This ensures we don't have stale data from previous sessions or different ASNs
                console.log(`🗑️ Clearing old TO allocations for ASN ${activeASN} before saving new ones...`);
                await db.runAsync(
                  `DELETE FROM transfer_order_cache WHERE asn_no = ? OR asn_no = ?`,
                  [activeASN, normalizedASN]
                );
                console.log(`✅ Cleared old TO allocations`);
                
                console.log(`💾 Saving ${allocations.length} TO allocations to local database...`);
                console.log(`💾 ASN: ${activeASN}, TO: ${toNo}`);
                for (const allocation of allocations) {
                  if (allocation.store && allocation.item_code) {
                    await db.runAsync(
                      `INSERT INTO transfer_order_cache 
                       (to_no, asn_no, store, item_code, allocated_qty) 
                       VALUES (?, ?, ?, ?, ?)`,
                      [
                        toNo,
                        normalizedASN, // Use normalized ASN for consistency
                        allocation.store || allocation.store_code,
                        allocation.item_code,
                        allocation.allocated_qty || allocation.qty || 0,
                      ]
                    );
                  }
                }
                console.log(`✅ Saved ${allocations.length} TO allocations to local database for ASN ${activeASN}, TO ${toNo}`);
              } catch (saveError: any) {
                console.warn(`⚠️ Failed to save TO allocations to database:`, saveError.message);
                // Continue even if save fails - we can still use the data from API
              }

              // Get store codes from allocations
              // Handle different field names for store: store, store_code, warehouse, etc.
              const allocationStoreCodes: string[] = Array.from(
                new Set(
                  allocations
                    .map((a: any) => a.store || a.store_code || a.warehouse || a.to_store || a.destination_store)
                    .filter((s: any) => s && String(s).trim() !== "")
                )
              ) as string[];

              console.log(`📦 Store codes from TO allocations:`, allocationStoreCodes);
              console.log(`📦 Raw allocations from API:`, allocations.slice(0, 5).map(a => ({ 
                store: a.store || a.store_code, 
                item: a.item_code,
                allocated_qty: a.allocated_qty || a.qty 
              })));

              // Include ALL stores from TO allocations (including warehouses like WAREHOUSE, WH-MAIN, etc.)
              setDistributionStores(allocationStoreCodes.sort());
              
              // Log which stores are in master for reference (but don't filter)
              if (warehousesAndStores.length > 0) {
                const masterStoreCodes = warehousesAndStores.map((ws: any) => ws.code);
                const storesInMaster = allocationStoreCodes.filter((code: string) =>
                  masterStoreCodes.some(
                    (masterCode: string) =>
                      code.toUpperCase() === String(masterCode || "").toUpperCase()
                  )
                );
                const storesNotInMaster = allocationStoreCodes.filter((code: string) =>
                  !masterStoreCodes.some(
                    (masterCode: string) =>
                      code.toUpperCase() === String(masterCode || "").toUpperCase()
                  )
                );
                console.log(`📦 Stores in master data:`, storesInMaster);
                if (storesNotInMaster.length > 0) {
                  console.log(`📦 Stores NOT in master (but will still be shown):`, storesNotInMaster);
                }
              }
            } else {
              // No allocations in TO - don't show warehouses, show empty list
              // Stores should ONLY come from tabtransferorderitem (TO allocations)
              console.log(`⚠️ No allocations found in TO response`);
              console.log(`⚠️ toData structure:`, JSON.stringify(toData, null, 2));
              console.log(`⚠️ Available fields in toData:`, toData ? Object.keys(toData) : "null");
              console.log(`ℹ️ No allocations in TO - showing empty store list (no warehouses)`);
              // Keep the TO number even if no allocations, but don't show warehouses
              setDistributionStores([]);
            }
          } else {
            // No Transfer Order found - show empty list (no warehouses)
            // Stores should ONLY come from tabtransferorderitem (TO allocations)
            console.log(`ℹ️ No Transfer Order found for ASN ${activeASN}`);
            setTransferOrder(null);
            setDistributionStores([]);
          }
        } catch (error: any) {
          console.warn("⚠️ Could not fetch transfer order:", error);
          console.warn("⚠️ Error details:", error.message);
          // No Transfer Order - show empty list (no warehouses)
          // Stores should ONLY come from tabtransferorderitem (TO allocations)
          setTransferOrder(null);
          setDistributionStores([]);
        }
      }
      
      // Final diagnostic: If TO exists but no stores, log a warning
      if (transferOrder && distributionStores.length === 0) {
        console.warn(`⚠️ DIAGNOSTIC: TO ${transferOrder} exists but no stores found!`);
        console.warn(`⚠️ This could mean:`);
        console.warn(`  1. TO allocations don't have store codes`);
        console.warn(`  2. API didn't return store data`);
        console.warn(`  3. Store codes in TO allocations are empty or null`);
        console.warn(`⚠️ User will see "No stores found in Transfer Order" message`);
        console.warn(`⚠️ Note: Warehouses (WAREHOUSE, WH-MAIN, etc.) ARE now included in stores`);
      }
    } catch (error) {
      console.error("❌ Error loading transfer order and stores:", error);
      setTransferOrder(null);
      // Don't set default stores - only show stores that actually exist in TO allocations
      // If there's an error, show empty list or only what's in the database
      setDistributionStores([]);
    }
  };

  const loadBoxes = async () => {
    if (!activeASN) return;
    // Load all boxes including Putaway boxes
    const boxList = await dataService.getBoxes(activeASN);
      console.log(
        "📦 All boxes loaded:",
        boxList.map((b) => ({
          box_id: b.box_id,
          store: b.store,
          purpose: b.purpose,
        }))
      );
      
      // Refresh items without TO check after loading boxes
      await checkItemsWithoutTO();

    // Get dispatched TCs to filter out boxes that are packed into dispatched TCs
    let dispatchedTCSet = new Set<string>();
    let boxToTC = new Map<string, string>();
    
    try {
      const db = await getDatabase();
      if (db) {
        const dispatchedTCs = await db.getAllAsync<{ tc_id: string }>(
          `SELECT DISTINCT tc_id 
           FROM event_queue 
           WHERE event_type = 'TC_DISPATCH' 
             AND tc_id IS NOT NULL 
             AND tc_id != ''`
        );
        dispatchedTCSet = new Set(dispatchedTCs.map(tc => tc.tc_id));
        
        // Get boxes that are packed into TCs
        const boxToTCMap = await db.getAllAsync<{ box_id: string; tc_id: string }>(
          `SELECT DISTINCT box_id, tc_id 
           FROM event_queue 
           WHERE event_type = 'PACK_BOX_TO_TC' 
             AND box_id IS NOT NULL 
             AND box_id != ''
             AND tc_id IS NOT NULL 
             AND tc_id != ''`
        );
        boxToTC = new Map(boxToTCMap.map(b => [b.box_id, b.tc_id]));
      }
    } catch (error: any) {
      console.warn(`⚠️ Error loading dispatched TCs in loadBoxes:`, error.message);
      // Continue with empty Set/Map if there's an error
    }
    
    // Filter boxes - show all store boxes (SR-* or STORE-*) and warehouse boxes
    // Exclude Putaway boxes (they will be shown in separate section)
    // Exclude boxes that are packed into dispatched TCs
    // Also ensure boxes have a valid store property
    const storeBoxes = boxList.filter((box) => {
      if (!box.store) {
        console.log("⚠️ Box missing store:", box.box_id);
        return false;
      }
      
      // Check if box is packed into a dispatched TC
      const tcId = boxToTC.get(box.box_id);
      if (tcId && dispatchedTCSet.has(tcId)) {
        console.log(`⚠️ Box ${box.box_id} filtered out - packed into dispatched TC ${tcId}`);
        return false;
      }
      
      const storeUpper = String(box.store).trim().toUpperCase();
      // Accept stores starting with "SR-" (e.g., SR-01, SR-02) OR "STORE-" (e.g., STORE-001, STORE-003)
      const isStore = storeUpper.startsWith("SR-") || storeUpper.startsWith("STORE-");
      // Accept both "WAREHOUSE" and warehouse codes starting with "WH-" (e.g., "WH-MAIN", "WH-MAAIN")
      const isWarehouse = storeUpper === "WAREHOUSE" || storeUpper.startsWith("WH-");
      const isNotPutAway = box.purpose !== "PUTAWAY";

      const shouldInclude = isNotPutAway && (isStore || isWarehouse);
      if (!shouldInclude) {
        console.log("⚠️ Box filtered out:", {
          box_id: box.box_id,
          store: box.store,
          storeUpper,
          isStore,
          isWarehouse,
          purpose: box.purpose,
          isNotPutAway,
        });
      }

      return shouldInclude;
    });

    console.log(
      "✅ Filtered boxes:",
      storeBoxes.map((b) => ({
        box_id: b.box_id,
        store: b.store,
        purpose: b.purpose,
      }))
    );

    // Filter out dispatched boxes from Putaway boxes too
    // Putaway boxes that are packed into dispatched TCs should not be shown
    // Also filter out closed Putaway boxes (same as regular boxes)
    // Exclude Transfer Cartons (TC-*) - they should not be shown in Putaway section
    const putawayBoxes = boxList.filter((box) => {
      // Exclude Transfer Cartons (TC-*) - they are not Putaway boxes
      if (box.box_id?.startsWith("TC-")) {
        console.log(`⚠️ Transfer Carton ${box.box_id} filtered out - not a Putaway box`);
        return false;
      }
      
      if (box.purpose !== "PUTAWAY" && !box.box_id?.startsWith("PAW-")) {
        return false; // Not a Putaway box
      }
      
      // Exclude closed Putaway boxes (same as regular boxes)
      if (box.status === "Closed" || box.status === "CLOSED" || box.status === "closed") {
        console.log(`⚠️ Putaway box ${box.box_id} filtered out - status is Closed`);
        return false;
      }
      
      // Exclude sealed/dispatched Transfer Cartons (if they somehow got into box_cache)
      if (box.status === "Sealed" || box.status === "SEALED" || box.status === "sealed" ||
          box.status === "Dispatched" || box.status === "DISPATCHED" || box.status === "dispatched") {
        console.log(`⚠️ Box ${box.box_id} filtered out - status is ${box.status} (Transfer Carton)`);
        return false;
      }
      
      // Check if Putaway box is packed into a dispatched TC
      const tcId = boxToTC.get(box.box_id);
      if (tcId && dispatchedTCSet.has(tcId)) {
        console.log(`⚠️ Putaway box ${box.box_id} filtered out - packed into dispatched TC ${tcId}`);
        return false;
      }
      
      return true;
    });
    
    // Get units scanned for all boxes (including Putaway boxes)
    const allBoxIds = boxList.map(b => b.box_id).filter(Boolean);
    const unitsMap = await dataService.getUnitsScannedForBoxes(allBoxIds);
    
    // Add units_scanned to boxes (excluding dispatched boxes)
    // Filter out dispatched boxes from all boxes list
    const nonDispatchedBoxes = boxList.filter((box) => {
      const tcId = boxToTC.get(box.box_id);
      return !(tcId && dispatchedTCSet.has(tcId));
    });
    
    const allBoxesWithUnits = nonDispatchedBoxes.map(box => ({
      ...box,
      units_scanned: unitsMap.get(box.box_id) || 0,
    }));

    // Add units_scanned to store boxes (for store sections)
    const boxesWithUnits = storeBoxes.map(box => ({
      ...box,
      units_scanned: unitsMap.get(box.box_id) || 0,
    }));

    console.log(
      "📊 All boxes with units scanned:",
      allBoxesWithUnits.map((b) => ({
        box_id: b.box_id,
        store: b.store,
        purpose: b.purpose,
        units_scanned: b.units_scanned,
      }))
    );

    // Set boxes state to include ALL boxes (including Putaway) so Putaway section can access them
    setBoxes(allBoxesWithUnits);
  };

  // Fetch boxes from backend for selected store
  const fetchBoxesFromBackend = async (store: string) => {
    if (!activeASN || !store) return;

    setLoading(true);
    try {
      console.log(
        `🔄 Fetching boxes from backend for ASN: ${activeASN}, Store: ${store}`
      );

      // Fetch boxes from backend API
      const response = await apiService.getBoxes({
        asn: activeASN,
        store: store,
      });

      console.log(`📦 Backend response for boxes:`, {
        type: typeof response,
        isArray: Array.isArray(response),
        response: response,
      });

      // Handle different response formats from backend
      let backendBoxes: any[] = [];

      if (Array.isArray(response)) {
        // Direct array response
        backendBoxes = response;
      } else if (response && typeof response === "object") {
        // Response might be wrapped in an object
        if (Array.isArray(response.boxes)) {
          backendBoxes = response.boxes;
        } else if (Array.isArray(response.data)) {
          backendBoxes = response.data;
        } else if (Array.isArray(response.items)) {
          backendBoxes = response.items;
        } else if (response.results && Array.isArray(response.results)) {
          backendBoxes = response.results;
        } else {
          console.warn(
            `⚠️ Unexpected response format from backend:`,
            Object.keys(response)
          );
        }
      }

      if (backendBoxes.length > 0) {
        console.log(
          `✅ Received ${backendBoxes.length} boxes from backend for ${store}`
        );

        // Save boxes to local database
        let savedCount = 0;
        for (const box of backendBoxes) {
          if (box.box_id && box.store) {
            await dataService.saveBox({
              box_id: box.box_id,
              asn_no: activeASN,
              to_no: box.to_no || null,
              store: box.store,
              status: box.status || "Open",
              purpose: box.purpose || "STORE",
              updated_on: box.updated_on || new Date().toISOString(),
            });
            savedCount++;
          } else {
            console.warn(`⚠️ Skipping invalid box data:`, box);
          }
        }

        console.log(`✅ Synced ${savedCount} boxes to local database`);

        // Reload boxes from local database to update UI
        await loadBoxes();
      } else {
        console.log(
          `ℹ️ No boxes found in backend for ${store} (response was empty or not an array)`
        );
        // Still reload local boxes in case there are local boxes
        await loadBoxes();
      }
    } catch (error: any) {
      console.warn(
        `⚠️ Could not fetch boxes from backend for ${store}:`,
        error
      );
      // If backend fetch fails, still load from local database
      await loadBoxes();
    } finally {
      setLoading(false);
    }
  };

  // Handle store selection - fetch boxes from backend when store is selected
  const handleStoreSelection = async (store: string) => {
    setSelectedStore(store);
    // Fetch boxes from backend for the selected store
    await fetchBoxesFromBackend(store);
  };

  const handleCreateBox = async (store?: string) => {
    if (!activeASN) {
      Alert.alert("Error", "No active ASN");
      return;
    }

    // Use provided store or fall back to selectedStore
    const targetStore = store || selectedStore;
    if (!targetStore) {
      Alert.alert("Error", "Please select a store first");
      return;
    }

    // Set selected store temporarily for loading state
    const previousSelectedStore = selectedStore;
    setSelectedStore(targetStore);
    setLoading(true);
    try {
      // Normalize store value to ensure consistency
      const normalizedStore = String(targetStore).trim().toUpperCase();

      console.log("📦 Creating box for store:", normalizedStore);

      const settings = await getSettings();

      // Check if transfer order exists - only warn if store is NOT a Warehouse
      // Warehouses (warehouse_type = "Warehouse" or codes starting with "WH-") don't require a Transfer Order
      // Find the store in warehouses/stores master to check warehouse_type
      const selectedStoreInfo = warehousesAndStores.find(
        (ws: any) => String(ws.code || "").toUpperCase() === normalizedStore
      );
      
      // VALIDATION: Check if store exists in warehouse master
      // This prevents the backend error "Store not found in warehouse master table"
      if (!selectedStoreInfo && warehousesAndStores.length > 0) {
        // Store not found in master data - check if we need to sync
        console.warn(`⚠️ Store ${normalizedStore} not found in warehouse master data`);
        console.warn(`📋 Available stores in master:`, warehousesAndStores.map((ws: any) => ({
          code: ws.code,
          name: ws.name,
          warehouse_type: ws.warehouse_type
        })));
        
        // Check if there's a similar store code (case-insensitive or format difference)
        const similarStore = warehousesAndStores.find((ws: any) => {
          const wsCode = String(ws.code || "").toUpperCase().trim();
          return wsCode === normalizedStore || 
                 wsCode.replace(/-/g, "") === normalizedStore.replace(/-/g, "") ||
                 wsCode.replace(/SR-/, "STORE-") === normalizedStore.replace(/SR-/, "STORE-");
        });
        
        if (similarStore) {
          Alert.alert(
            "Store Code Mismatch",
            `Store "${normalizedStore}" not found in warehouse master.\n\n` +
            `Found similar store: "${similarStore.code}" (${similarStore.warehouse_type || "Unknown type"})\n\n` +
            `Please use the correct store code from the master data, or sync master data from the backend.`,
            [{ text: "OK", onPress: () => setLoading(false) }]
          );
          return;
        }
        
        // No similar store found - suggest syncing master data
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            "Store Not Found in Master",
            `Store "${normalizedStore}" is not found in the warehouse master table.\n\n` +
            `This will cause a backend validation error.\n\n` +
            `Possible solutions:\n` +
            `1. Sync master data from backend (Sync Center)\n` +
            `2. Use a store code that exists in master data\n` +
            `3. Add the store to backend warehouse master first\n\n` +
            `Do you want to proceed anyway?`,
            [
              { text: "Cancel", style: "cancel", onPress: () => { setLoading(false); resolve(false); } },
              { text: "Proceed Anyway", onPress: () => resolve(true) }
            ]
          );
        });
        
        if (!proceed) {
          return;
        }
      } else if (warehousesAndStores.length === 0) {
        // No master data loaded - suggest syncing
        console.warn(`⚠️ No warehouse/store master data loaded. Store validation cannot be performed.`);
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            "Master Data Not Loaded",
            `Warehouse/store master data is not available.\n\n` +
            `Please sync master data from the backend first (Sync Center) to ensure store codes are valid.\n\n` +
            `Do you want to proceed without validation?`,
            [
              { text: "Cancel", style: "cancel", onPress: () => { setLoading(false); resolve(false); } },
              { text: "Proceed", onPress: () => resolve(true) }
            ]
          );
        });
        
        if (!proceed) {
          return;
        }
      }
      
      // Check if it's a warehouse:
      // 1. warehouse_type === "Warehouse" in master data
      // 2. Store code is exactly "WAREHOUSE"
      // 3. Store code starts with "WH-" (e.g., "WH-MAIN", "WH-MAAIN")
      const isWarehouse =
        selectedStoreInfo?.warehouse_type === "Warehouse" ||
        normalizedStore === "WAREHOUSE" ||
        normalizedStore.startsWith("WH-");
      
      console.log(`🏭 Warehouse check for ${normalizedStore}:`, {
        isWarehouse,
        warehouse_type: selectedStoreInfo?.warehouse_type,
        foundInMaster: !!selectedStoreInfo,
        storeCode: selectedStoreInfo?.code,
      });

      if (!transferOrder && !isWarehouse) {
        // Only show alert for distribution stores (SR-*), not for WAREHOUSE
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert(
            "No Transfer Order Found",
            `ASN ${activeASN} does not have an associated Transfer Order.\n\n` +
              `Distribution stores (${normalizedStore}) typically require a Transfer Order.\n\n` +
              `Do you want to create the box without a Transfer Order?`,
            [
              {
                text: "Cancel",
                style: "cancel",
                onPress: () => {
                  setLoading(false);
                  resolve(false);
                },
              },
              {
                text: "Create Without TO",
                onPress: () => resolve(true),
              },
            ]
          );
        });

        if (!proceed) {
          return; // User cancelled
        }
      }

      // Build request data - conditionally include to_no only if it exists
      // Backend requires to_no, but for WAREHOUSE we can send empty string
      const requestData: any = {
        asn_no: activeASN,
        store: normalizedStore,
        purpose: "STORE", // Per PDF section 12.6
        user_id: settings.user_id, // Per PDF section 12.6
      };

      // Include to_no/transfer_order - send null if not available (backend should handle null)
      // Some backends might require the field, others might accept null
      if (transferOrder && transferOrder.trim().length > 0) {
        requestData.to_no = transferOrder;
        requestData.transfer_order = transferOrder; // Also send as transfer_order for compatibility
        console.log(`📋 Including transfer_order in box creation: ${transferOrder}`);
      } else {
        // Send null instead of empty string - some backends prefer null for optional fields
        requestData.to_no = null;
        requestData.transfer_order = null;
        console.log(`ℹ️ No transfer_order available for box creation (sending null)`);
      }

      let response;
      try {
        response = await apiService.createBox(requestData);
        console.log("📦 API Response:", JSON.stringify(response, null, 2));
      } catch (apiError: any) {
        // Enhanced error handling for validation errors
        const errorMessage = apiError.message || apiError.toString() || "Unknown error";
        console.error("❌ Error creating box:", errorMessage);
        
        // Check if it's a validation error about store not found
        if (errorMessage.includes("not found in warehouse master") || 
            errorMessage.includes("VALIDATION_ERROR") ||
            (errorMessage.includes("Store") && errorMessage.includes("not found"))) {
          
          // Extract store code from error message if possible
          const storeMatch = errorMessage.match(/Store\s+([A-Z0-9-]+)/i);
          const mentionedStore = storeMatch ? storeMatch[1] : normalizedStore;
          
          // Check database cache for the store
          const dbStore = await dataService.getWarehouseStoreByCode(normalizedStore);
          const availableStores = warehousesAndStores.length > 0 
            ? warehousesAndStores.map((ws: any) => ws.code).join(", ")
            : "None loaded";
          
          Alert.alert(
            "Store Validation Error",
            `Store "${mentionedStore}" is not found in the backend warehouse master table.\n\n` +
            `Store Type Check:\n` +
            `• Requested: ${normalizedStore}\n` +
            `• Found in local cache: ${dbStore ? `Yes (${dbStore.warehouse_type || "Unknown type"})` : "No"}\n` +
            `• Available stores in master: ${availableStores}\n\n` +
            `Possible Solutions:\n` +
            `1. Sync master data from backend (Sync Center)\n` +
            `2. Verify store code format matches backend (e.g., "STORE-001" vs "SR-01")\n` +
            `3. Add the store to backend warehouse master first\n` +
            `4. Check if store code is case-sensitive\n\n` +
            `Current warehouse_type: ${selectedStoreInfo?.warehouse_type || "Not found"}`,
            [{ text: "OK", onPress: () => setLoading(false) }]
          );
          return;
        }
        
        // Re-throw other errors
        throw apiError;
      }

      // Handle different response formats from backend
      // Backend might return: { box_id: "..." } or { data: { box_id: "..." } } or { box: { box_id: "..." } }
      const boxId =
        response?.box_id ||
        response?.data?.box_id ||
        response?.box?.box_id ||
        response?.id ||
        null;

      if (!boxId) {
        console.error("❌ No box_id in API response:", response);
        // Generate a temporary box ID if backend doesn't return one
        const tempBoxId = `BOX-${normalizedStore}-${Date.now()}`;
        console.warn(`⚠️ Using temporary box ID: ${tempBoxId}`);

        const newBox: any = {
          box_id: tempBoxId,
          asn_no: activeASN,
          to_no: transferOrder || null, // Use null if no TO (instead of undefined for database)
          store: normalizedStore,
          status: "Open",
          purpose: "STORE",
          updated_on: new Date().toISOString(),
        };

        await dataService.saveBox(newBox);
        await loadBoxes();
        Alert.alert(
          "Success",
          `BOX ${tempBoxId} created for ${targetStore}\n\nNote: Backend did not return box_id. Using temporary ID.`
        );
        return;
      }

      const newBox: any = {
        box_id: boxId,
        asn_no: activeASN,
        to_no: transferOrder || null, // Use null if no TO (instead of undefined for database)
        store: normalizedStore, // Use normalized store value
        status: "Open",
        purpose: "STORE", // Explicitly set purpose for warehouse and store boxes
        updated_on: new Date().toISOString(),
      };

      console.log("💾 Saving box:", newBox);
      await dataService.saveBox(newBox);
      console.log("✅ Box saved, reloading...");
      // Wait a moment for database to be ready, then reload
      await new Promise(resolve => setTimeout(resolve, 100));
      await loadBoxes();
      // Also ensure the store is selected so the box appears
      if (targetStore && targetStore !== selectedStore) {
        setSelectedStore(targetStore);
      }
      Alert.alert("Success", `BOX ${boxId} created for ${targetStore}`);
    } catch (error: any) {
      console.error("❌ Error creating box:", error);
      Alert.alert("Error", error.message || "Failed to create BOX");
    } finally {
      setLoading(false);
      // Restore previous selected store if it was different
      if (previousSelectedStore && previousSelectedStore !== targetStore) {
        setSelectedStore(previousSelectedStore);
      }
    }
  };

  const handleCloseBox = async (boxId: string) => {
    // First, check if box is warehouse box to show appropriate warning
    let isWarehouseBox = false;
    try {
      const db = await getDatabase();
      if (db) {
        const box = await db.getFirstAsync<{ store: string }>(
          `SELECT store FROM box_cache WHERE box_id = ?`,
          [boxId]
        );
        if (box) {
          isWarehouseBox = await dataService.isWarehouse(box.store || "");
        }
      }
    } catch (error: any) {
      console.warn(`⚠️ Could not check warehouse status for box ${boxId}:`, error.message);
    }
    
    // Show confirmation dialog before closing
    Alert.alert(
      "Close Box",
      "Is the Box completely Full?\n\nOnce Closed, it will be available for Putaway.",
      [
        {
          text: "Cancel",
          style: "cancel",
          onPress: () => {
            // User cancelled - do nothing
            console.log(`❌ User cancelled closing box ${boxId}`);
          },
        },
        {
          text: "OK",
          style: "default",
          onPress: async () => {
            // User confirmed - proceed with closing
            await proceedCloseBox(boxId, isWarehouseBox);
          },
        },
      ]
    );
  };

  const proceedCloseBox = async (boxId: string, isWarehouseBox: boolean) => {
    setLoading(true);
    try {
      const settings = await getSettings();
      const closedBy = settings.user_id || undefined;
      
      // NEW WORKFLOW: All boxes (including Putaway boxes) should call backend
      // Backend will check if store is warehouse and create putaway task accordingly
      let putawayTask: string | null = null;
      
      try {
        const response = await apiService.closeBox({ 
          box_id: boxId,
          closed_by: closedBy 
        });
        
        // Check response format: use 'ok' (not 'success')
        if (response && (response.ok === true || response.ok === false)) {
          // Backend uses 'ok' format
          if (response.ok === true) {
            console.log(`✅ Box ${boxId} closed in backend`);
            // Check if putaway task was created (warehouse box)
            if (response.putaway_task) {
              putawayTask = response.putaway_task;
              console.log(`✅ Putaway task created: ${putawayTask}`);
            }
          } else {
            // Backend returned error
            const errorCode = response.error?.code || "UNKNOWN_ERROR";
            const errorMessage = response.error?.message || "Failed to close box";
            throw new Error(`${errorCode}: ${errorMessage}`);
          }
        } else if (response && (response.success === true || response.success === false)) {
          // Fallback: old format with 'success' (for backward compatibility)
          if (response.success === true) {
            console.log(`✅ Box ${boxId} closed in backend`);
            if (response.putaway_task) {
              putawayTask = response.putaway_task;
              console.log(`✅ Putaway task created: ${putawayTask}`);
            }
          } else {
            const errorCode = response.error?.code || "UNKNOWN_ERROR";
            const errorMessage = response.error?.message || "Failed to close box";
            throw new Error(`${errorCode}: ${errorMessage}`);
          }
        } else {
          // No error thrown, assume success
          console.log(`✅ Box ${boxId} closed in backend`);
        }
      } catch (backendError: any) {
        const errorMessage = backendError.message || "";
        const errorCode = backendError.code || "";
        const isNotFound = 
          errorMessage.includes("404") ||
          errorMessage.includes("not found") ||
          errorMessage.includes("NOT_FOUND") ||
          errorCode === "NOT_FOUND";
        
        if (isNotFound) {
          console.warn(
            `⚠️ Box ${boxId} not found in backend, closing locally only`
          );
          // For Putaway boxes (PAW-*), if backend doesn't have it, still check if it's warehouse
          // and should go to Putaway screen
          if (boxId.startsWith("PAW-")) {
            // Get box details to check if store is warehouse
            try {
              const db = await getDatabase();
              if (db) {
                const box = await db.getFirstAsync<{ store: string }>(
                  `SELECT store FROM box_cache WHERE box_id = ?`,
                  [boxId]
                );
                if (box) {
                  const isWarehouse = await dataService.isWarehouse(box.store || "");
                  if (isWarehouse) {
                    // Putaway box with warehouse store - should go to Putaway screen
                    // (Backend will create task when location is scanned)
                    putawayTask = "PENDING"; // Mark as pending - will be created when location scanned
                    console.log(`ℹ️ Putaway box ${boxId} with warehouse store - will create task when location scanned`);
                  }
                }
              }
            } catch (checkError: any) {
              console.warn(`⚠️ Could not check warehouse status for Putaway box:`, checkError.message);
            }
          }
        } else {
          throw backendError; // Re-throw other errors
        }
      }
      
      await dataService.updateBoxStatus(boxId, "Closed");
      await loadBoxes();
      
      // Show success message - user can navigate to Putaway manually when ready
      const isPutawayBox = boxId.startsWith("PAW-");
      
      // Check if this is a warehouse box (for cases where putawayTask might not be set)
      let isWarehouseBoxCheck = isWarehouseBox; // Use parameter as default
      try {
        const db = await getDatabase();
        if (db) {
          const box = await db.getFirstAsync<{ store: string }>(
            `SELECT store FROM box_cache WHERE box_id = ?`,
            [boxId]
          );
          if (box) {
            isWarehouseBoxCheck = await dataService.isWarehouse(box.store || "");
          }
        }
      } catch (error: any) {
        // Ignore error, use isWarehouseBox from parameter
        console.warn(`⚠️ Could not check warehouse status for box ${boxId}:`, error.message);
      }
      
      const message = putawayTask && putawayTask !== "PENDING"
        ? `BOX ${boxId} closed successfully.\n\nPutaway task created: ${putawayTask}\n\nYou can navigate to Putaway screen when ready.`
        : isPutawayBox || isWarehouseBoxCheck
        ? `BOX ${boxId} closed successfully.\n\nThis is a ${isPutawayBox ? 'putaway' : 'warehouse'} box. You can navigate to Putaway screen when ready.`
        : `BOX ${boxId} closed successfully.`;
      
      Alert.alert("Success", message);
    } catch (error: any) {
      console.error("❌ Error closing box:", error);
      
      // Handle specific error codes
      const errorMessage = error.message || "Failed to close BOX";
      if (errorMessage.includes("NOT_WAREHOUSE_BOX")) {
        Alert.alert(
          "Box Closed",
          `BOX ${boxId} closed successfully.\n\nThis box is not a warehouse box. Please use Packing screen.`
        );
        // Still update local status even if backend says it's not warehouse
        try {
          await dataService.updateBoxStatus(boxId, "Closed");
          await loadBoxes();
        } catch (localError: any) {
          console.error("❌ Error updating local status:", localError);
        }
      } else {
        Alert.alert("Error", errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReopenBox = async (boxId: string) => {
    setLoading(true);
    try {
      // Check if this is a Putaway box (created locally, may not exist in backend)
      const isPutawayBox = boxId.startsWith("PAW-");
      
      if (!isPutawayBox) {
        try {
          await apiService.reopenBox({ box_id: boxId });
          console.log(`✅ Box ${boxId} reopened in backend`);
        } catch (backendError: any) {
          const errorMessage = backendError.message || "";
          const errorCode = backendError.code || "";
          const isNotFound = 
            errorMessage.includes("404") ||
            errorMessage.includes("not found") ||
            errorMessage.includes("NOT_FOUND") ||
            errorCode === "NOT_FOUND";
          
          if (isNotFound) {
            console.warn(
              `⚠️ Box ${boxId} not found in backend, reopening locally only`
            );
          } else {
            throw backendError; // Re-throw other errors
          }
        }
      } else {
        console.log(`ℹ️ Putaway box ${boxId} - skipping backend reopen (local-only box)`);
      }
      
      await dataService.updateBoxStatus(boxId, "Open");
      await loadBoxes();
      Alert.alert("Success", `BOX ${boxId} reopened`);
    } catch (error: any) {
      console.error("❌ Error reopening box:", error);
      Alert.alert("Error", error.message || "Failed to reopen BOX");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBox = async (boxId: string) => {
    setLoading(true);
    try {
      // Check if box has any scanned items
      const scannedItems = await dataService.getScannedItemsByBox(boxId);

      if (scannedItems && scannedItems.length > 0) {
        Alert.alert(
          "Cannot Delete Box",
          `BOX ${boxId} contains ${scannedItems.length} scanned item(s).\n\n` +
            `Please remove all items from the box before deleting it.`,
          [{ text: "OK" }]
        );
        setLoading(false);
        return;
      }

      // Confirm deletion
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Delete Box",
          `Are you sure you want to delete BOX ${boxId}?\n\n` +
            `This action cannot be undone.`,
          [
            {
              text: "Cancel",
              style: "cancel",
              onPress: () => {
                setLoading(false);
                resolve(false);
              },
            },
            {
              text: "Delete",
              style: "destructive",
              onPress: () => resolve(true),
            },
          ]
        );
      });

      if (!confirmed) {
        return;
      }

      // Check if this is a Putaway box (created locally, may not exist in backend)
      const isPutawayBox = boxId.startsWith("PAW-");
      
      // Delete from backend (skip for Putaway boxes as they may not exist in backend)
      if (!isPutawayBox) {
        try {
          await apiService.deleteBox({ box_id: boxId });
          console.log(`✅ Box ${boxId} deleted from backend`);
        } catch (backendError: any) {
          // If backend delete fails (404 = endpoint not implemented or box not found), still delete locally
          const errorMessage = backendError.message || "";
          const errorCode = backendError.code || "";
          const isNotFound = 
            errorMessage.includes("404") ||
            errorMessage.includes("not found") ||
            errorMessage.includes("NOT_FOUND") ||
            errorCode === "NOT_FOUND";
          
          if (isNotFound) {
            console.warn(
              `⚠️ Box ${boxId} not found in backend (may be local-only), deleting locally only`
            );
          } else {
            throw backendError; // Re-throw other errors
          }
        }
      } else {
        console.log(`ℹ️ Putaway box ${boxId} - skipping backend delete (local-only box)`);
      }

      // Delete from local database
      const db = await getDatabase();
      await db.runAsync("DELETE FROM box_cache WHERE box_id = ?", [boxId]);
      await db.runAsync("DELETE FROM scanned_items WHERE box_id = ?", [boxId]);
      await db.runAsync("DELETE FROM event_queue WHERE box_id = ?", [boxId]);

      console.log(`✅ Box ${boxId} deleted from local database`);

      // Wait a moment for database to be ready, then reload
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Reload boxes list
      await loadBoxes();
      
      // Also manually remove from state to ensure immediate UI update
      setBoxes(prevBoxes => prevBoxes.filter(b => b.box_id !== boxId));
      setFilteredBoxes(prevFiltered => prevFiltered.filter(b => b.box_id !== boxId));

      Alert.alert("Success", `BOX ${boxId} deleted successfully`);
    } catch (error: any) {
      console.error("❌ Error deleting box:", error);
      Alert.alert("Error", error.message || "Failed to delete BOX");
    } finally {
      setLoading(false);
    }
  };

  const handleShareBox = async (boxId: string) => {
    try {
      await Share.share({
        message: `BOX ID: ${boxId}\nStore: ${selectedStore}\nASN: ${
          activeASN || "N/A"
        }\n\nScan this barcode during Receive + Sort to sort items into this BOX.`,
        title: "BOX Barcode",
      });
    } catch (error) {
      Alert.alert("Error", "Failed to share BOX barcode");
    }
  };

  const handleViewBoxItems = async (boxId: string) => {
    if (!activeASN) {
      Alert.alert("Error", "No active ASN");
      return;
    }

    setLoading(true);
    try {
      const db = await getDatabase();
      if (!db) {
        Alert.alert("Error", "Database not initialized");
        setLoading(false);
        return;
      }

      const normalizedASN = normalizeASN(activeASN);
      
      // Get box info to determine store
      const boxes = await dataService.getBoxes(activeASN);
      const box = boxes.find(b => b.box_id === boxId);
      const boxStore = box?.store || null;
      
      // Get all scanned items for this box
      let boxItems = await db.getAllAsync<{
        item_code: string;
        scanned_qty: number;
      }>(
        `SELECT item_code, SUM(scanned_qty) as scanned_qty
         FROM scanned_items
         WHERE (asn_no = ? OR asn_no = ?) AND box_id = ?
         GROUP BY item_code
         HAVING scanned_qty > 0
         ORDER BY item_code`,
        [activeASN, normalizedASN, boxId]
      );

      // If no results, try with original ASN format only
      if (boxItems.length === 0 && normalizedASN !== activeASN) {
        boxItems = await db.getAllAsync<{
          item_code: string;
          scanned_qty: number;
        }>(
          `SELECT item_code, SUM(scanned_qty) as scanned_qty
           FROM scanned_items
           WHERE asn_no = ? AND box_id = ?
           GROUP BY item_code
           HAVING scanned_qty > 0
           ORDER BY item_code`,
          [activeASN, boxId]
        );
      }

      // Get ASN quantities for each item from asn_carton_map
      // Try both ASN formats to ensure we get all items
      let asnItems = await db.getAllAsync<{
        item_code: string;
        asn_qty: number;
      }>(
        `SELECT item_code, SUM(shipped_qty) as asn_qty
         FROM asn_carton_map
         WHERE asn_no = ?
         GROUP BY item_code`,
        [normalizedASN]
      );
      
      // If no results with normalized ASN, try original format
      if (asnItems.length === 0 && normalizedASN !== activeASN) {
        asnItems = await db.getAllAsync<{
          item_code: string;
          asn_qty: number;
        }>(
          `SELECT item_code, SUM(shipped_qty) as asn_qty
           FROM asn_carton_map
           WHERE asn_no = ?
           GROUP BY item_code`,
          [activeASN]
        );
      }
      
      // Also try combining both formats if still no results
      if (asnItems.length === 0 && normalizedASN !== activeASN) {
        asnItems = await db.getAllAsync<{
          item_code: string;
          asn_qty: number;
        }>(
          `SELECT item_code, SUM(shipped_qty) as asn_qty
           FROM asn_carton_map
           WHERE asn_no = ? OR asn_no = ?
           GROUP BY item_code`,
          [activeASN, normalizedASN]
        );
      }
      
      const asnQtyMap = new Map<string, number>();
      asnItems.forEach(item => {
        const currentQty = asnQtyMap.get(item.item_code) || 0;
        asnQtyMap.set(item.item_code, currentQty + (item.asn_qty || 0));
      });
      
      console.log(`📦 ASN Quantities loaded:`, Array.from(asnQtyMap.entries()));
      
      // Get total scanned quantities for each item (across all boxes/stores)
      // If activeSession is available, filter by it; otherwise get all for the ASN
      const totalScannedQuery = activeSession
        ? `SELECT item_code, SUM(scanned_qty) as total_scanned_qty
           FROM scanned_items
           WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ?
           GROUP BY item_code`
        : `SELECT item_code, SUM(scanned_qty) as total_scanned_qty
           FROM scanned_items
           WHERE (asn_no = ? OR asn_no = ?)
           GROUP BY item_code`;
      
      const totalScannedParams = activeSession
        ? [activeASN, normalizedASN, activeSession]
        : [activeASN, normalizedASN];
      
      const totalScannedItems = await db.getAllAsync<{
        item_code: string;
        total_scanned_qty: number;
      }>(totalScannedQuery, totalScannedParams);
      
      const totalScannedMap = new Map<string, number>();
      totalScannedItems.forEach(item => {
        totalScannedMap.set(item.item_code, item.total_scanned_qty || 0);
      });
      
      // Enrich box items with ASN quantity and total scanned data
      const enrichedItems = boxItems.map(boxItem => {
        const asnQty = asnQtyMap.get(boxItem.item_code) || 0;
        const totalScannedQty = totalScannedMap.get(boxItem.item_code) || 0;
        // Balance = ASN Qty - Scanned Qty (remaining quantity to scan)
        // Positive = still need to scan, Zero = all scanned, Negative = over-scanned
        const balance = asnQty - totalScannedQty;
        
        console.warn(`📊 Item ${boxItem.item_code}: ASN Qty=${asnQty}, Scanned=${totalScannedQty}, Balance=${balance} (remaining to scan)`);
        
        return {
          item_code: boxItem.item_code,
          scanned_qty: boxItem.scanned_qty, // Quantity in this box (Putwy Qty)
          asn_qty: asnQty,
          total_scanned_qty: totalScannedQty,
          balance: balance, // Remaining quantity to scan = ASN Qty - Scanned Qty
        };
      });

      console.log(`📦 Loaded ${enrichedItems.length} items for box ${boxId}:`, enrichedItems);
      
      setBoxItemsModal({
        visible: true,
        boxId,
        items: enrichedItems,
      });
    } catch (error: any) {
      console.error("❌ Error loading box items:", error);
      Alert.alert("Error", `Failed to load box items: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePrintBox = async (boxId: string) => {
    setLoading(true);
    try {
      const settings = await getSettings();

      // Call backend print API
      const response = await apiService.printBox({
        box_id: boxId,
        // printer_id: settings.default_printer_id, // Optional: use saved printer if available
        copies: 1, // Default to 1 copy
      });

      if (response.success || response.ok) {
        Alert.alert(
          "Success",
          `Print job sent to printer${
            response.job_id ? ` (Job ID: ${response.job_id})` : ""
          }`
        );
      } else {
        Alert.alert(
          "Print Request Sent",
          "Print job has been queued. Label will be printed using the same format as desktop."
        );
      }
    } catch (error: any) {
      const errorMsg = error.message || error.toString() || "Unknown error";

      // If backend doesn't have print endpoint yet, show helpful message
      if (errorMsg.includes("404") || errorMsg.includes("not found")) {
        Alert.alert(
          "Print Endpoint Not Available",
          `The backend print endpoint is not implemented yet.\n\n` +
            `Please ensure backend implements:\n` +
            `POST /api/boxes/print\n\n` +
            `See BACKEND_API_SERVER_UPDATE_REQUIRED.md for implementation details.`,
          [
            {
              text: "OK",
              onPress: () => {
                // Fallback to Share as temporary workaround
                Share.share({
                  message: `BOX Barcode: ${boxId}\nStore: ${selectedStore}\nASN: ${
                    activeASN || "N/A"
                  }`,
                  title: "BOX Barcode",
                });
              },
            },
          ]
        );
      } else {
        Alert.alert("Error", `Failed to send print job: ${errorMsg}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Create Putaway BOX/TC for items without TO
  // Just creates the box - items will be added normally during Receive + Sort
  const handleCreatePutawayBox = async () => {
    if (!activeASN) {
      Alert.alert("Error", "No active ASN");
      return;
    }

    setLoading(true);
    try {
      const db = await getDatabase();
      if (!db) {
        Alert.alert("Error", "Database not available");
        setLoading(false);
        return;
      }

      const settings = await getSettings();

      // Determine warehouse store code
      const warehouseStores = await db.getAllAsync<{ code: string }>(
        `SELECT code FROM warehouse_store_cache WHERE warehouse_type = 'Warehouse' LIMIT 1`
      );
      const warehouseStore = warehouseStores.length > 0 
        ? warehouseStores[0].code 
        : "WH-MAIN";

      // Generate BOX ID for Putaway (will also be used as TC ID)
      // Format: PAW-{ASN}-{TIMESTAMP} (different abbreviation from normal BOX-{STORE}-{TIMESTAMP})
      const timestamp = Date.now();
      const putawayBoxId = `PAW-${activeASN.replace(/[^A-Z0-9]/g, "")}-${timestamp}`;

      // Build request data for backend API
      // Include box_id in request so backend uses our PAW- format
      const requestData: any = {
        asn_no: activeASN,
        store: warehouseStore,
        purpose: "PUTAWAY", // Mark as Putaway box
        user_id: settings.user_id,
        to_no: "Putaway", // Set Transfer Order to "Putaway" for putaway boxes
        transfer_order: "Putaway",
        box_id: putawayBoxId, // Send our generated PAW- format box_id to backend
      };

      let response;
      let boxId = putawayBoxId; // Always use our generated PAW- format for Putaway boxes

      // Create box in backend Sort BOX table
      try {
        response = await apiService.createBox(requestData);
        console.log("📦 Putaway Box API Response:", JSON.stringify(response, null, 2));
        
        // For Putaway boxes, always use our generated PAW- format
        // Backend might return a different box_id, but we'll use our format for consistency
        const backendBoxId =
          response?.box_id ||
          response?.data?.box_id ||
          response?.box?.box_id ||
          response?.id ||
          null;

        if (backendBoxId && backendBoxId.startsWith("PAW-")) {
          // Only use backend box_id if it matches our PAW- format
          boxId = backendBoxId;
          console.log(`✅ Backend returned PAW- format box_id: ${boxId}`);
        } else if (backendBoxId) {
          // Backend returned different format - log warning but use our format
          console.warn(`⚠️ Backend returned box_id in different format: ${backendBoxId}, using our PAW- format: ${boxId}`);
        } else {
          console.log(`ℹ️ Backend did not return box_id, using generated PAW- format: ${boxId}`);
        }
      } catch (apiError: any) {
        // If backend API fails, still create locally with generated PAW- format
        const errorMessage = apiError.message || apiError.toString() || "Unknown error";
        console.warn(`⚠️ Backend API error creating Putaway box: ${errorMessage}`);
        console.warn(`⚠️ Creating Putaway box locally with PAW- format ID: ${boxId}`);
        // Continue with local creation
      }

      // Create BOX for Putaway (save to local database)
      const putawayBox = {
        box_id: boxId,
        asn_no: activeASN,
        to_no: "Putaway", // Set Transfer Order to "Putaway" for putaway boxes
        store: warehouseStore,
        status: "Open",
        purpose: "PUTAWAY", // Mark as Putaway box
        updated_on: new Date().toISOString(),
      };

      await dataService.saveBox(putawayBox);
      console.log(`✅ Putaway Box ${boxId} saved to local database`);

      // Reload boxes and check items without TO again
      await loadBoxes();
      await checkItemsWithoutTO();

      Alert.alert(
        "Putaway Box Created",
        `Putaway Box ${boxId} created successfully.\n\nItems without TO can now be sorted into this box during Receive + Sort.\n\nThis box will appear in Putaway list after sealing.`,
        [{ text: "OK" }]
      );
    } catch (error: any) {
      console.error("❌ Error creating Putaway box:", error);
      Alert.alert("Error", `Failed to create Putaway box: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Use only stores from Transfer Order
  // If no TO exists or no stores in TO, show empty list (don't show default stores)
  // Only show stores that actually exist in the TO allocations
  const stores = distributionStores; // No fallback - only show stores from TO
  
  // Log current state for debugging
  useEffect(() => {
    console.log(`📊 BoxManagement stores state:`, {
      distributionStores,
      stores,
      transferOrder,
      activeASN,
      distributionStoresCount: distributionStores.length,
      storesCount: stores.length,
      willShowStores: transferOrder && stores.length > 0,
      willShowFallback: transferOrder && stores.length === 0,
      willShowNoTO: !transferOrder,
    });
  }, [distributionStores, stores, transferOrder, activeASN]);

  // Note: No auto-selection of store - user must select manually

  // Filter boxes to only show boxes for the selected store
  useEffect(() => {
    if (!selectedStore) {
      setFilteredBoxes([]);
      return;
    }

    const filtered = boxes.filter((b) => {
      // First, exclude boxes with null/undefined/empty box_id
      if (!b.box_id || b.box_id === "" || b.box_id === null) {
        return false;
      }
      // Ensure box has a store property
      if (!b.store) {
        return false;
      }
      // Normalize store values for comparison (trim whitespace, handle case)
      const boxStore = String(b.store).trim().toUpperCase();
      const selected = String(selectedStore).trim().toUpperCase();
      return boxStore === selected;
    });

    console.log(`🔄 Updating filtered boxes for ${selectedStore}:`, {
      totalBoxes: boxes.length,
      filteredCount: filtered.length,
      filtered: filtered.map((b) => b.box_id),
    });

    setFilteredBoxes(filtered);
  }, [boxes, selectedStore]);

  // Refresh boxes and TO stores when screen comes into focus to ensure newly created boxes appear
  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      console.log(`🔄 BoxManagement: Screen focused, reloading data...`);
      loadBoxes();
      loadTransferOrderAndStores();
      loadWarehousesAndStores();
    });
    return unsubscribe;
  }, [navigation, activeASN]);

  // Group boxes by store for summary view (case-insensitive matching)
  // Exclude Putaway boxes - they are shown in a separate section
  // Exclude boxes that are packed into dispatched TCs
  const boxesByStore = useMemo(() => {
    return stores.reduce((acc, store) => {
      const storeUpper = String(store).trim().toUpperCase();
      acc[store] = boxes.filter((b) => {
        // Only show Open boxes - exclude Closed boxes
        if (b.status === "Closed" || b.status === "CLOSED" || b.status === "closed") {
          return false;
        }
        if (!b.store) return false;
        // Exclude Putaway boxes from store sections
        if (b.purpose === "PUTAWAY") return false;
        // Exclude boxes that are packed into dispatched TCs (if maps are loaded)
        if (boxToTCMap && dispatchedTCSet) {
          const tcId = boxToTCMap.get(b.box_id);
          if (tcId && dispatchedTCSet.has(tcId)) {
            return false; // Exclude dispatched boxes
          }
        }
        const boxStoreUpper = String(b.store).trim().toUpperCase();
        return boxStoreUpper === storeUpper;
      });
      return acc;
    }, {} as Record<string, any[]>);
  }, [stores, boxes, boxToTCMap, dispatchedTCSet]);

  // Get warehouse boxes separately (for warehouses not in TO stores)
  // Note: Warehouses ARE now included in TO stores, so this section will typically be empty
  // These are regular warehouse boxes (not Putaway boxes)
  const warehouseBoxes = useMemo(() => {
    return boxes.filter((b) => {
      if (!b.store) return false;
      // Only show Open boxes - exclude Closed boxes
      if (b.status === "Closed" || b.status === "CLOSED" || b.status === "closed") {
        return false;
      }
      // Exclude Putaway boxes
      if (b.purpose === "PUTAWAY" || b.box_id?.startsWith("PAW-")) return false;
      // Exclude boxes that are packed into dispatched TCs
      if (boxToTCMap && dispatchedTCSet) {
        const tcId = boxToTCMap.get(b.box_id);
        if (tcId && dispatchedTCSet.has(tcId)) {
          return false;
        }
      }
      // Check if it's a warehouse store
      const storeUpper = String(b.store).trim().toUpperCase();
      const isWarehouse = storeUpper === "WAREHOUSE" || storeUpper.startsWith("WH-");
      // Only include if it's a warehouse AND not already in stores array (from TO)
      // Since warehouses are now in TO stores, this will typically be empty
      return isWarehouse && !stores.some(s => String(s).trim().toUpperCase() === storeUpper);
    });
  }, [boxes, stores, boxToTCMap, dispatchedTCSet]);

  // Check if Next button should be enabled:
  // - At least one box exists for any store from TO
  // - At least one box for any store is Closed
  const hasAnyClosedBox = boxes.some((box) => box.status === "Closed");
  const canProceed = boxes.length > 0 && hasAnyClosedBox;

  // Get dispatched TCs to filter out Putaway boxes that are packed into dispatched TCs
  const [dispatchedTCSet, setDispatchedTCSet] = useState<Set<string>>(new Set());
  const [boxToTCMap, setBoxToTCMap] = useState<Map<string, string>>(new Map());
  
  useEffect(() => {
    const loadDispatchedTCs = async () => {
      try {
        const db = await getDatabase();
        if (!db) return;
        
        // Get dispatched TCs
        const dispatchedTCs = await db.getAllAsync<{ tc_id: string }>(
          `SELECT DISTINCT tc_id 
           FROM event_queue 
           WHERE event_type = 'TC_DISPATCH' 
             AND tc_id IS NOT NULL 
             AND tc_id != ''`
        );
        setDispatchedTCSet(new Set(dispatchedTCs.map(tc => tc.tc_id)));
        
        // Get boxes packed into TCs
        const boxToTC = await db.getAllAsync<{ box_id: string; tc_id: string }>(
          `SELECT DISTINCT box_id, tc_id 
           FROM event_queue 
           WHERE event_type = 'PACK_BOX_TO_TC' 
             AND box_id IS NOT NULL 
             AND box_id != ''
             AND tc_id IS NOT NULL 
             AND tc_id != ''`
        );
        setBoxToTCMap(new Map(boxToTC.map(b => [b.box_id, b.tc_id])));
      } catch (error: any) {
        console.warn(`⚠️ Error loading dispatched TCs:`, error.message);
      }
    };
    
    loadDispatchedTCs();
  }, [activeASN]);
  
  // Filter Putaway boxes - exclude those packed into dispatched TCs and closed boxes
  // Also exclude Transfer Cartons (TC-*) - they should not be shown in Putaway section
  const putawayBoxes = useMemo(() => {
    if (!boxToTCMap || !dispatchedTCSet) {
      // If maps not loaded yet, return all Putaway boxes (excluding closed and Transfer Cartons)
      return boxes.filter(b => {
        // Exclude Transfer Cartons (TC-*)
        if (b.box_id?.startsWith("TC-")) {
          return false;
        }
        const isPutaway = b.purpose === "PUTAWAY" || b.box_id?.startsWith("PAW-");
        const isClosed = b.status === "Closed" || b.status === "CLOSED" || b.status === "closed";
        // Exclude sealed/dispatched Transfer Cartons
        const isSealedOrDispatched = b.status === "Sealed" || b.status === "SEALED" || b.status === "sealed" ||
                                     b.status === "Dispatched" || b.status === "DISPATCHED" || b.status === "dispatched";
        return isPutaway && !isClosed && !isSealedOrDispatched;
      });
    }
    return boxes.filter(b => {
      // Exclude Transfer Cartons (TC-*)
      if (b.box_id?.startsWith("TC-")) {
        return false;
      }
      if (b.purpose !== "PUTAWAY" && !b.box_id?.startsWith("PAW-")) {
        return false;
      }
      // Exclude closed Putaway boxes (same as regular boxes)
      if (b.status === "Closed" || b.status === "CLOSED" || b.status === "closed") {
        return false;
      }
      // Exclude sealed/dispatched Transfer Cartons
      if (b.status === "Sealed" || b.status === "SEALED" || b.status === "sealed" ||
          b.status === "Dispatched" || b.status === "DISPATCHED" || b.status === "dispatched") {
        return false;
      }
      // Check if box is packed into a dispatched TC
      const tcId = boxToTCMap.get(b.box_id);
      if (tcId && dispatchedTCSet.has(tcId)) {
        return false; // Exclude dispatched boxes
      }
      return true;
    });
  }, [boxes, boxToTCMap, dispatchedTCSet]);
  
  // Check if there are Putaway boxes (to show the section even if no items without TO)
  const hasPutawayBoxes = putawayBoxes.length > 0;
  // Show Putaway section if:
  // 1. No TO exists (no transfer order), OR
  // 2. Remaining items > 0 (Total ASN - Total TO > 0), OR
  // 3. There are Putaway boxes already created
  // Validation: If Total ASN - Total TO = 0, no Putaway needed
  // If TO exists, show "Create New BOX" section with TO stores instead
  const showPutawaySection = !transferOrder || remainingItemsQty > 0 || hasPutawayBoxes;

  return (
    <ScrollView style={styles.container}>
      {/* Header with Back Button */}
      <View style={styles.headerContainer}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>BoxManagement</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ProgressIndicator
        currentStep={4}
        totalSteps={6}
        stepName="BOX Management"
      />
      <View style={styles.content}>
        {/* Show Transfer Order info if available */}
        {transferOrder && (
          <View style={styles.toInfoSection}>
            <Text style={styles.toInfoText}>
              Transfer Order: <Text style={styles.toInfoValue}>{transferOrder}</Text>
            </Text>
          </View>
        )}

        {/* Show Items Without TO Section */}
        {showPutawaySection && (
          <View style={styles.putawaySection}>
            <View style={styles.putawaySectionHeader}>
              <Text style={styles.putawaySectionTitle} numberOfLines={1}>
                Items Without Transfer Order
              </Text>
            </View>
            
            {/* Show calculation details if TO exists */}
            {transferOrder && (
              <View style={styles.putawayCalculationSection}>
                <Text style={styles.putawayCalculationTitle}>Remaining Items Calculation:</Text>
                <View style={styles.putawayCalculationRow}>
                  <Text style={styles.putawayCalculationLabel}>Total ASN:</Text>
                  <Text style={styles.putawayCalculationValue}>{totalASNQty}</Text>
                </View>
                <View style={styles.putawayCalculationRow}>
                  <Text style={styles.putawayCalculationLabel}>Total TO Allocated:</Text>
                  <Text style={styles.putawayCalculationValue}>{totalTOAllocatedQty}</Text>
                </View>
                <View style={[styles.putawayCalculationRow, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#FFE0B2" }]}>
                  <Text style={[styles.putawayCalculationLabel, { fontWeight: "bold", fontSize: 16 }]}>Remaining (Putaway):</Text>
                  <Text style={[styles.putawayCalculationValue, { fontWeight: "bold", fontSize: 16, color: remainingItemsQty > 0 ? "#E65100" : "#4CAF50" }]}>
                    {remainingItemsQty}
                  </Text>
                </View>
                {remainingItemsQty === 0 && (
                  <Text style={styles.putawayCalculationNote}>
                    ✅ All items are allocated to Transfer Order. No Putaway needed.
                  </Text>
                )}
              </View>
            )}
            
            {/* Only show Create button if remaining items > 0 */}
            {remainingItemsQty > 0 && (
              <TouchableOpacity
                style={[
                  styles.createPutawayButton,
                  loading && styles.createPutawayButtonDisabled,
                ]}
                onPress={handleCreatePutawayBox}
                disabled={loading}
              >
                <Text style={styles.createPutawayButtonText}>
                  {loading ? "Creating..." : `+ Create Putaway BOX (${remainingItemsQty} items)`}
                </Text>
              </TouchableOpacity>
            )}

            {/* Show Putaway boxes in same format as regular boxes */}
            {(() => {
              // Use the filtered putawayBoxes (already excludes dispatched boxes)
              if (putawayBoxes.length === 0) {
                return (
                  <Text style={styles.emptyText}>
                    No Putaway boxes created yet
                  </Text>
                );
              }

              return (
                <FlatList
                  data={putawayBoxes}
                  key={`putaway-boxes-list-${putawayBoxes.length}`}
                  extraData={`putaway-${putawayBoxes.length}`}
                  keyExtractor={(item) => `${item.box_id}-putaway`}
                  removeClippedSubviews={false}
                  scrollEnabled={false}
                  renderItem={({ item }) => (
                    <View style={styles.boxItem}>
                      <TouchableOpacity
                        onPress={() =>
                          setExpandedBox(
                            expandedBox === item.box_id ? null : item.box_id
                          )
                        }
                        activeOpacity={0.7}
                      >
                        <View style={styles.boxHeader}>
                          <View style={styles.boxHeaderLeft}>
                            <Text style={styles.boxIdPutaway}>{item.box_id}</Text>
                            <StatusBadge status={item.status} />
                          </View>
                          <Text style={styles.expandIcon}>
                            {expandedBox === item.box_id ? "▼" : "▶"}
                          </Text>
                        </View>
                        <View style={styles.boxUnitsContainer}>
                          <Text style={styles.boxUnitsLabel}>Units Scanned:</Text>
                          <Text style={styles.boxUnitsValue}>
                            {item.units_scanned || 0}
                          </Text>
                        </View>
                      </TouchableOpacity>

                      {expandedBox === item.box_id && (
                        <View style={styles.boxDetails}>
                          <Text style={styles.barcodeTitle}>BOX Barcode</Text>
                          <Text style={styles.barcodeHint}>
                            Scan this barcode during Receive + Sort to sort items
                            into this BOX
                          </Text>
                          <BarcodeDisplay
                            value={item.box_id}
                            format="CODE128"
                            width={280}
                            height={80}
                          />

                          <View style={styles.boxActionButtons}>
                            <TouchableOpacity
                              style={[styles.actionButton, styles.shareButton]}
                              onPress={() => handleShareBox(item.box_id)}
                            >
                              <Text style={styles.actionButtonText}>Share</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.actionButton, styles.printButton]}
                              onPress={() => handlePrintBox(item.box_id)}
                            >
                              <Text style={styles.actionButtonText}>Print</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}

                      <View style={styles.boxActions}>
                        {item.status === "Open" ? (
                          <>
                            <TouchableOpacity
                              style={styles.actionButton}
                              onPress={() => handleCloseBox(item.box_id)}
                            >
                              <Text style={styles.actionButtonText}>Close</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.actionButton,
                                styles.actionButtonDelete,
                              ]}
                              onPress={() => handleDeleteBox(item.box_id)}
                            >
                              <Text style={styles.actionButtonText}>Delete</Text>
                            </TouchableOpacity>
                            {(() => {
                              const unitsScanned = typeof item.units_scanned === 'number' 
                                ? item.units_scanned 
                                : parseInt(String(item.units_scanned || '0'), 10) || 0;
                              const shouldShow = unitsScanned > 0;
                              if (!shouldShow && item.box_id) {
                                console.log(`🔍 Box ${item.box_id}: units_scanned=${item.units_scanned} (type: ${typeof item.units_scanned}), converted=${unitsScanned}, shouldShow=${shouldShow}`);
                              }
                              return shouldShow;
                            })() && (
                              <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: "#2196F3" }]}
                                onPress={() => handleViewBoxItems(item.box_id)}
                              >
                                <Text style={styles.actionButtonText}>📦 View Items</Text>
                              </TouchableOpacity>
                            )}
                          </>
                        ) : (
                          <>
                            <TouchableOpacity
                              style={[
                                styles.actionButton,
                                styles.actionButtonSecondary,
                              ]}
                              onPress={() => handleReopenBox(item.box_id)}
                            >
                              <Text style={styles.actionButtonText}>Reopen</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.actionButton,
                                styles.actionButtonDelete,
                              ]}
                              onPress={() => handleDeleteBox(item.box_id)}
                            >
                              <Text style={styles.actionButtonText}>Delete</Text>
                            </TouchableOpacity>
                            {(() => {
                              const unitsScanned = typeof item.units_scanned === 'number' 
                                ? item.units_scanned 
                                : parseInt(String(item.units_scanned || '0'), 10) || 0;
                              const shouldShow = unitsScanned > 0;
                              if (!shouldShow && item.box_id) {
                                console.log(`🔍 Box ${item.box_id}: units_scanned=${item.units_scanned} (type: ${typeof item.units_scanned}), converted=${unitsScanned}, shouldShow=${shouldShow}`);
                              }
                              return shouldShow;
                            })() && (
                              <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: "#2196F3" }]}
                                onPress={() => handleViewBoxItems(item.box_id)}
                              >
                                <Text style={styles.actionButtonText}>📦 View Items</Text>
                              </TouchableOpacity>
                            )}
                          </>
                        )}
                      </View>
                    </View>
                  )}
                />
              );
            })()}
          </View>
        )}

        {/* Display warehouse boxes separately (for warehouses not in TO stores) */}
        {(() => {
          const warehouseBoxes = boxes.filter((b) => {
            if (!b.store) return false;
            // Only show Open boxes - exclude Closed boxes
            if (b.status === "Closed" || b.status === "CLOSED" || b.status === "closed") {
              return false;
            }
            // Exclude Putaway boxes
            if (b.purpose === "PUTAWAY" || b.box_id?.startsWith("PAW-")) return false;
            // Exclude boxes that are packed into dispatched TCs
            if (boxToTCMap && dispatchedTCSet) {
              const tcId = boxToTCMap.get(b.box_id);
              if (tcId && dispatchedTCSet.has(tcId)) {
                return false;
              }
            }
            // Check if it's a warehouse store
            const storeUpper = String(b.store).trim().toUpperCase();
            const isWarehouse = storeUpper === "WAREHOUSE" || storeUpper.startsWith("WH-");
            // Only include if it's a warehouse AND not already in stores array
            return isWarehouse && !stores.some(s => String(s).trim().toUpperCase() === storeUpper);
          });

          if (warehouseBoxes.length === 0) return null;

          // Group warehouse boxes by store
          const warehouseBoxesByStore = warehouseBoxes.reduce((acc, box) => {
            const store = box.store || "WAREHOUSE";
            if (!acc[store]) acc[store] = [];
            acc[store].push(box);
            return acc;
          }, {} as Record<string, any[]>);

          return Object.entries(warehouseBoxesByStore).map(([store, storeBoxes]) => (
            <View key={`warehouse-${store}`} style={styles.storeSection}>
              <View style={styles.storeSectionHeader}>
                <View style={styles.storeSectionHeaderLeft}>
                  <Text style={styles.storeSectionTitle}>{store}</Text>
                  <Text style={styles.storeSectionSubtitle}>
                    {storeBoxes.length} {storeBoxes.length === 1 ? "box" : "boxes"}
                  </Text>
                </View>
              </View>
              <FlatList
                data={storeBoxes}
                key={`warehouse-boxes-${store}-${storeBoxes.length}`}
                extraData={`warehouse-${store}-${storeBoxes.length}`}
                keyExtractor={(item) => `${item.box_id}-warehouse-${store}`}
                removeClippedSubviews={false}
                scrollEnabled={false}
                renderItem={({ item }) => (
                  <View style={styles.boxItem}>
                    <TouchableOpacity
                      onPress={() =>
                        setExpandedBox(
                          expandedBox === item.box_id ? null : item.box_id
                        )
                      }
                      activeOpacity={0.7}
                    >
                      <View style={styles.boxHeader}>
                        <View style={styles.boxHeaderLeft}>
                          <Text style={styles.boxId}>{item.box_id}</Text>
                          <StatusBadge status={item.status} />
                        </View>
                        <Text style={styles.expandIcon}>
                          {expandedBox === item.box_id ? "▼" : "▶"}
                        </Text>
                      </View>
                      <View style={styles.boxStoreContainer}>
                        <Text style={styles.boxStoreLabel}>Store:</Text>
                        <Text style={styles.boxStoreValue}>{item.store}</Text>
                      </View>
                      <View style={styles.boxUnitsContainer}>
                        <Text style={styles.boxUnitsLabel}>Units Scanned:</Text>
                        <Text style={styles.boxUnitsValue}>
                          {item.units_scanned || 0}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {expandedBox === item.box_id && (
                      <View style={styles.boxDetails}>
                        <Text style={styles.barcodeTitle}>BOX Barcode</Text>
                        <Text style={styles.barcodeHint}>
                          Scan this barcode during Receive + Sort to sort items
                          into this BOX
                        </Text>
                        <BarcodeDisplay
                          value={item.box_id}
                          format="CODE128"
                          width={280}
                          height={80}
                        />
                        <View style={styles.boxActionButtons}>
                          <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: "#2196F3", marginRight: 8, flex: 1 }]}
                            onPress={() => handleViewBoxItems(item.box_id)}
                          >
                            <Text style={styles.actionButtonText}>📦 View Items</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.actionButton, styles.shareButton, { flex: 1, marginRight: 8 }]}
                            onPress={() => handleShareBox(item.box_id)}
                          >
                            <Text style={styles.actionButtonText}>Share</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.actionButton, styles.printButton, { flex: 1 }]}
                            onPress={() => handlePrintBox(item.box_id)}
                          >
                            <Text style={styles.actionButtonText}>Print</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    <View style={styles.boxActions}>
                      {item.status === "Open" ? (
                        <>
                          <TouchableOpacity
                            style={styles.actionButton}
                            onPress={() => handleCloseBox(item.box_id)}
                          >
                            <Text style={styles.actionButtonText}>Close</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.actionButton, styles.actionButtonDelete]}
                            onPress={() => handleDeleteBox(item.box_id)}
                          >
                            <Text style={styles.actionButtonText}>Delete</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: "#2196F3" }]}
                            onPress={() => handleViewBoxItems(item.box_id)}
                          >
                            <Text style={styles.actionButtonText}>📦 View Items</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <>
                          <TouchableOpacity
                            style={[styles.actionButton, styles.actionButtonSecondary]}
                            onPress={() => handleReopenBox(item.box_id)}
                          >
                            <Text style={styles.actionButtonText}>Reopen</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.actionButton, styles.actionButtonDelete]}
                            onPress={() => handleDeleteBox(item.box_id)}
                          >
                            <Text style={styles.actionButtonText}>Delete</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.actionButton, { backgroundColor: "#2196F3" }]}
                            onPress={() => handleViewBoxItems(item.box_id)}
                          >
                            <Text style={styles.actionButtonText}>📦 View Items</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>
                  </View>
                )}
              />
            </View>
          ));
        })()}

        {/* Display all stores from TO as separate sections */}
        {/* Always show stores section if TO exists and has stores */}
        {transferOrder && stores.length > 0 ? (
          stores.map((store) => {
            const storeBoxes = boxesByStore[store] || [];
            const openCount = storeBoxes.filter((b) => b.status === "Open").length;
            const closedCount = storeBoxes.filter((b) => b.status === "Closed").length;
            const totalCount = storeBoxes.length;
            const isCreating = loading && selectedStore === store;

            return (
              <View key={store} style={styles.storeSection}>
                <View style={styles.storeSectionHeader}>
                  <View style={styles.storeSectionHeaderLeft}>
                    <Text style={styles.storeSectionTitle}>{store}</Text>
                    <Text style={styles.storeSectionSubtitle}>
                      {totalCount} {totalCount === 1 ? "box" : "boxes"} • {openCount} Open • {closedCount} Closed
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.createBoxButton,
                      isCreating && styles.createBoxButtonDisabled,
                    ]}
                    onPress={() => handleCreateBox(store)}
                    disabled={loading}
                  >
                    <Text style={styles.createBoxButtonText}>
                      {isCreating ? "Creating..." : "+ Create BOX"}
                    </Text>
                  </TouchableOpacity>
                </View>

                {storeBoxes.length === 0 ? (
                  <Text style={styles.emptyText}>
                    No boxes created for {store} yet
                  </Text>
                ) : (
                  <FlatList
                    data={storeBoxes}
                    key={`boxes-list-${store}-${storeBoxes.length}`}
                    extraData={`${store}-${storeBoxes.length}`}
                    keyExtractor={(item) => `${item.box_id}-${item.store}`}
                    removeClippedSubviews={false}
                    scrollEnabled={false}
                    renderItem={({ item }) => (
                      <View style={styles.boxItem}>
                        <TouchableOpacity
                          onPress={() =>
                            setExpandedBox(
                              expandedBox === item.box_id ? null : item.box_id
                            )
                          }
                          activeOpacity={0.7}
                        >
                          <View style={styles.boxHeader}>
                            <View style={styles.boxHeaderLeft}>
                              <Text style={styles.boxId}>{item.box_id}</Text>
                              <StatusBadge status={item.status} />
                            </View>
                            <Text style={styles.expandIcon}>
                              {expandedBox === item.box_id ? "▼" : "▶"}
                            </Text>
                          </View>
                          <View style={styles.boxStoreContainer}>
                            <Text style={styles.boxStoreLabel}>Store:</Text>
                            <Text style={styles.boxStoreValue}>{item.store}</Text>
                          </View>
                          <View style={styles.boxUnitsContainer}>
                            <Text style={styles.boxUnitsLabel}>Units Scanned:</Text>
                            <Text style={styles.boxUnitsValue}>
                              {item.units_scanned || 0}
                            </Text>
                          </View>
                        </TouchableOpacity>

                        {expandedBox === item.box_id && (
                          <View style={styles.boxDetails}>
                            <Text style={styles.barcodeTitle}>BOX Barcode</Text>
                            <Text style={styles.barcodeHint}>
                              Scan this barcode during Receive + Sort to sort items
                              into this BOX
                            </Text>
                            <BarcodeDisplay
                              value={item.box_id}
                              format="CODE128"
                              width={280}
                              height={80}
                            />

                            <View style={styles.boxActionButtons}>
                              <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: "#2196F3", marginRight: 8, flex: 1 }]}
                                onPress={() => handleViewBoxItems(item.box_id)}
                              >
                                <Text style={styles.actionButtonText}>📦 View Items</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.actionButton, styles.shareButton, { flex: 1, marginRight: 8 }]}
                                onPress={() => handleShareBox(item.box_id)}
                              >
                                <Text style={styles.actionButtonText}>Share</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.actionButton, styles.printButton, { flex: 1 }]}
                                onPress={() => handlePrintBox(item.box_id)}
                              >
                                <Text style={styles.actionButtonText}>Print</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        )}

                        <View style={styles.boxActions}>
                          {item.status === "Open" ? (
                            <>
                              <TouchableOpacity
                                style={styles.actionButton}
                                onPress={() => handleCloseBox(item.box_id)}
                              >
                                <Text style={styles.actionButtonText}>Close</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.actionButton,
                                  styles.actionButtonDelete,
                                ]}
                                onPress={() => handleDeleteBox(item.box_id)}
                              >
                                <Text style={styles.actionButtonText}>Delete</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: "#2196F3" }]}
                                onPress={() => handleViewBoxItems(item.box_id)}
                              >
                                <Text style={styles.actionButtonText}>📦 View Items</Text>
                              </TouchableOpacity>
                            </>
                          ) : (
                            <>
                              <TouchableOpacity
                                style={[
                                  styles.actionButton,
                                  styles.actionButtonSecondary,
                                ]}
                                onPress={() => handleReopenBox(item.box_id)}
                              >
                                <Text style={styles.actionButtonText}>Reopen</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  styles.actionButton,
                                  styles.actionButtonDelete,
                                ]}
                                onPress={() => handleDeleteBox(item.box_id)}
                              >
                                <Text style={styles.actionButtonText}>Delete</Text>
                              </TouchableOpacity>
                            </>
                          )}
                        </View>
                      </View>
                    )}
                  />
                )}
              </View>
            );
          })
        ) : transferOrder ? (
          // TO exists but no stores loaded yet, or stores are empty - show message
          <View style={styles.createSection}>
            <Text style={styles.sectionTitle}>Create New BOX</Text>
            <Text style={styles.emptyText}>
              {distributionStores.length === 0
                ? "No stores found in Transfer Order. Please check the TO allocations or wait for stores to load."
                : "Loading stores from Transfer Order..."}
            </Text>
            {/* Show stores if they exist but weren't displayed above */}
            {distributionStores.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.storeSelector}
                contentContainerStyle={styles.storeSelectorContent}
              >
                {distributionStores.map((store) => (
                  <TouchableOpacity
                    key={store}
                    style={[
                      styles.storeButton,
                      selectedStore === store && styles.storeButtonActive,
                    ]}
                    onPress={() => handleStoreSelection(store)}
                  >
                    <Text
                      style={[
                        styles.storeButtonText,
                        selectedStore === store && styles.storeButtonTextActive,
                      ]}
                    >
                      {store}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            {distributionStores.length > 0 && (
              <TouchableOpacity
                style={[styles.button, loading && styles.buttonDisabled]}
                onPress={handleCreateBox}
                disabled={loading || !selectedStore}
              >
                <Text style={styles.buttonText}>
                  {loading ? "Creating..." : "Create BOX"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.createSection}>
            <Text style={styles.sectionTitle}>Create New BOX</Text>
            <Text style={styles.emptyText}>
              No Transfer Order found. Please select a store to create boxes.
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.storeSelector}
              contentContainerStyle={styles.storeSelectorContent}
            >
              {stores.length > 0 ? (
                stores.map((store) => (
                  <TouchableOpacity
                    key={store}
                    style={[
                      styles.storeButton,
                      selectedStore === store && styles.storeButtonActive,
                    ]}
                    onPress={() => handleStoreSelection(store)}
                  >
                    <Text
                      style={[
                        styles.storeButtonText,
                        selectedStore === store && styles.storeButtonTextActive,
                      ]}
                    >
                      {store}
                    </Text>
                  </TouchableOpacity>
                ))
              ) : (
                <Text style={styles.emptyText}>
                  No stores available. Stores must come from Transfer Order allocations.
                </Text>
              )}
            </ScrollView>
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleCreateBox}
              disabled={loading || !selectedStore}
            >
              <Text style={styles.buttonText}>
                {loading ? "Creating..." : "Create BOX"}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={[styles.nextButton, !canProceed && styles.nextButtonDisabled]}
          onPress={() => navigation.navigate("Packing" as never, { 
            initialStore: selectedStore || undefined 
          } as never)}
          disabled={!canProceed}
        >
          <Text style={styles.nextButtonText}>Next →</Text>
          <Text style={styles.nextButtonSubtext}>Packing</Text>
        </TouchableOpacity>
        {!canProceed && (
          <View style={styles.hintContainer}>
            <Text style={styles.hintText}>
              {(() => {
                // Check if any store has closed boxes
                const hasAnyClosedBox = stores.some((store) => {
                  const storeBoxes = boxesByStore[store] || [];
                  return storeBoxes.some((b) => b.status === "Closed");
                });
                const totalBoxes = boxes.reduce((sum, b) => sum + 1, 0);
                
                if (totalBoxes === 0) {
                  return "Create and close at least one box for any store to proceed.";
                } else if (!hasAnyClosedBox) {
                  return "Please close at least one box for any store to proceed.";
                } else {
                  return "All requirements met. You can proceed to Packing.";
                }
              })()}
            </Text>
          </View>
        )}
      </View>

      {/* Box Items Modal */}
      <Modal
        visible={boxItemsModal?.visible || false}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setBoxItemsModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Items in {boxItemsModal?.boxId}
              </Text>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setBoxItemsModal(null)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {boxItemsModal && boxItemsModal.items.length > 0 ? (
              <View style={styles.modalContentWrapper}>
                <View style={styles.itemsListHeader}>
                  <View style={styles.itemsListHeaderRow}>
                    <Text style={[styles.itemsListHeaderText, { flex: 1, textAlign: 'center' }]}>Putwy Qty</Text>
                    <Text style={[styles.itemsListHeaderText, { flex: 1, textAlign: 'center' }]}>ASN Qty</Text>
                    <Text style={[styles.itemsListHeaderText, { flex: 1, textAlign: 'center' }]}>Scanned</Text>
                    <Text style={[styles.itemsListHeaderText, { flex: 1, textAlign: 'center' }]}>Balance</Text>
                  </View>
                </View>
                <FlatList
                  data={boxItemsModal.items}
                  keyExtractor={(item, index) => `${item.item_code}-${index}`}
                  renderItem={({ item }) => (
                    <View style={styles.itemsListItem}>
                      <Text style={styles.itemsListItemCode}>{item.item_code}</Text>
                      <View style={styles.itemsListItemRow}>
                        <Text style={[styles.itemsListItemQty, { flex: 1, textAlign: 'center' }]}>{item.scanned_qty}</Text>
                        <Text style={[styles.itemsListItemQty, { flex: 1, textAlign: 'center', color: '#666' }]}>{item.asn_qty || 0}</Text>
                        <Text style={[styles.itemsListItemQty, { flex: 1, textAlign: 'center', color: '#2196F3' }]}>{item.total_scanned_qty || 0}</Text>
                        <Text style={[styles.itemsListItemQty, { flex: 1, textAlign: 'center', color: item.balance >= 0 ? '#4CAF50' : '#F44336' }]}>{item.balance}</Text>
                      </View>
                    </View>
                  )}
                  style={styles.modalContent}
                  contentContainerStyle={styles.modalContentContainer}
                  showsVerticalScrollIndicator={true}
                  ListEmptyComponent={
                    <View style={styles.emptyModalContainer}>
                      <Text style={styles.emptyModalText}>
                        No items found
                      </Text>
                    </View>
                  }
                  ListFooterComponent={
                    <View>
                      <View style={styles.itemsListFooter}>
                        <Text style={styles.itemsListFooterLabel}>Total Items:</Text>
                        <Text style={styles.itemsListFooterValue}>
                          {boxItemsModal.items.length}
                        </Text>
                      </View>
                      <View style={styles.itemsListFooter}>
                        <Text style={styles.itemsListFooterLabel}>Total Quantity:</Text>
                        <Text style={styles.itemsListFooterValue}>
                          {boxItemsModal.items.reduce((sum, item) => sum + item.scanned_qty, 0)}
                        </Text>
                      </View>
                    </View>
                  }
                />
              </View>
            ) : (
              <View style={styles.modalContent}>
                <View style={styles.emptyModalContainer}>
                  <Text style={styles.emptyModalText}>
                    No items scanned in this box yet
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCloseButtonLarge}
                onPress={() => setBoxItemsModal(null)}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  headerContainer: {
    backgroundColor: "#007AFF",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.2)",
  },
  backButton: {
    padding: 8,
    marginRight: 12,
    justifyContent: "center",
    alignItems: "center",
    minWidth: 40,
  },
  backButtonText: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold",
  },
  headerTitle: {
    flex: 1,
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    padding: 16,
  },
  createSection: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  listSection: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 16,
    color: "#333",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  storeSelector: {
    marginBottom: 16,
  },
  storeSelectorContent: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 16,
  },
  storeButton: {
    minWidth: 100,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#ddd",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  storeButtonActive: {
    borderColor: "#007AFF",
    backgroundColor: "#E3F2FD",
  },
  storeButtonText: {
    fontSize: 16,
    color: "#666",
    fontWeight: "600",
  },
  storeButtonTextActive: {
    color: "#007AFF",
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 18,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  boxItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  boxHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  boxHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  boxId: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
  },
  boxIdPutaway: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    flexShrink: 1,
  },
  expandIcon: {
    fontSize: 16,
    color: "#666",
    marginLeft: 8,
  },
  boxDetails: {
    marginTop: 12,
    padding: 12,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  barcodeTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 4,
    textAlign: "center",
  },
  barcodeHint: {
    fontSize: 12,
    color: "#666",
    textAlign: "center",
    marginBottom: 12,
    fontStyle: "italic",
  },
  boxActionButtons: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  shareButton: {
    flex: 1,
    backgroundColor: "#2196F3",
  },
  printButton: {
    flex: 1,
    backgroundColor: "#FF9800",
  },
  boxStoreContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    marginBottom: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#F5F5F5",
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  boxStoreLabel: {
    fontSize: 14,
    color: "#666",
    fontWeight: "600",
    marginRight: 6,
  },
  boxStoreValue: {
    fontSize: 15,
    color: "#007AFF",
    fontWeight: "bold",
  },
  boxUnitsContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 6,
  },
  boxUnitsLabel: {
    fontSize: 14,
    color: "#666",
  },
  boxUnitsValue: {
    fontSize: 15,
    color: "#4CAF50",
    fontWeight: "bold",
  },
  viewItemsButtonSmall: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginTop: 8,
    alignSelf: "flex-start",
  },
  viewItemsButtonSmallText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  boxActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  actionButton: {
    backgroundColor: "#F44336",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  actionButtonSecondary: {
    backgroundColor: "#4CAF50",
  },
  actionButtonDelete: {
    backgroundColor: "#F44336",
  },
  actionButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  emptyText: {
    color: "#999",
    fontStyle: "italic",
    textAlign: "center",
    padding: 24,
  },
  nextButton: {
    backgroundColor: "#4CAF50",
    padding: 20,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 24,
    marginBottom: 16,
  },
  nextButtonText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
  },
  nextButtonSubtext: {
    color: "rgba(255, 255, 255, 0.9)",
    fontSize: 14,
    marginTop: 4,
  },
  nextButtonDisabled: {
    backgroundColor: "#ccc",
    opacity: 0.6,
  },
  hintContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: "#FFF3E0",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FFB74D",
  },
  hintText: {
    color: "#E65100",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  summarySection: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  summaryGrid: {
    flexDirection: "row",
    gap: 12,
    flexWrap: "wrap",
  },
  summaryCard: {
    flex: 1,
    minWidth: "30%",
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#ddd",
    backgroundColor: "#f9f9f9",
  },
  summaryCardActive: {
    borderColor: "#007AFF",
    backgroundColor: "#E3F2FD",
  },
  summaryStoreName: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 10,
    textAlign: "center",
  },
  summaryCount: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#007AFF",
    textAlign: "center",
    marginBottom: 10,
  },
  summaryStatusRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 6,
    gap: 8,
  },
  summaryStatusOpen: {
    fontSize: 13,
    color: "#2196F3",
    fontWeight: "bold",
    backgroundColor: "#E3F2FD",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  summaryStatusClosed: {
    fontSize: 13,
    color: "#4CAF50",
    fontWeight: "bold",
    backgroundColor: "#E8F5E9",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  boxCount: {
    fontSize: 14,
    color: "#007AFF",
    fontWeight: "bold",
    backgroundColor: "#E3F2FD",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  toInfoSection: {
    backgroundColor: "#E3F2FD",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: "#007AFF",
  },
  toInfoText: {
    fontSize: 14,
    color: "#333",
    fontWeight: "600",
  },
  toInfoValue: {
    fontSize: 16,
    color: "#007AFF",
    fontWeight: "bold",
  },
  putawaySection: {
    backgroundColor: "#FFF3E0",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#FFB74D",
  },
  putawaySectionHeader: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#FFE0B2",
  },
  putawaySectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#E65100",
  },
  putawayCalculationSection: {
    backgroundColor: "#FFF8E1",
    borderRadius: 6,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#FFE0B2",
  },
  putawayCalculationTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#E65100",
    marginBottom: 8,
  },
  putawayCalculationRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  putawayCalculationLabel: {
    fontSize: 14,
    color: "#666",
  },
  putawayCalculationValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#E65100",
  },
  putawayCalculationNote: {
    fontSize: 12,
    color: "#4CAF50",
    fontStyle: "italic",
    marginTop: 8,
    textAlign: "center",
  },
  createPutawayButton: {
    backgroundColor: "#FF9800",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    minWidth: 150,
    alignItems: "center",
    marginTop: 8,
    marginBottom: 12,
    alignSelf: "flex-start",
  },
  createPutawayButtonDisabled: {
    opacity: 0.5,
  },
  createPutawayButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  putawayItemsList: {
    marginTop: 8,
  },
  putawayItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
    borderRadius: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#FFE0B2",
  },
  putawayItemCode: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  putawayItemQty: {
    fontSize: 14,
    color: "#F57C00",
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    backgroundColor: "#fff",
    borderRadius: 12,
    width: "90%",
    maxHeight: "90%",
    minHeight: 500,
    height: "85%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    overflow: "hidden",
    flexDirection: "column",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    minHeight: 56,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    flex: 1,
    marginRight: 12,
    paddingRight: 8,
  },
  modalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f0f0f0",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  modalCloseText: {
    fontSize: 18,
    color: "#666",
    fontWeight: "bold",
  },
  modalContentWrapper: {
    flex: 1,
    flexDirection: "column",
    minHeight: 400,
  },
  modalContent: {
    flex: 1,
    minHeight: 300,
  },
  modalContentContainer: {
    padding: 16,
    paddingBottom: 8,
    flexGrow: 1,
    minHeight: 200,
  },
  modalFooter: {
    padding: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    flexShrink: 0,
  },
  modalCloseButtonLarge: {
    backgroundColor: "#1976D2",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  modalCloseButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  itemsListHeader: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: "#f5f5f5",
    borderBottomWidth: 2,
    borderBottomColor: "#2196F3",
    marginBottom: 0,
    zIndex: 10,
    elevation: 2,
  },
  itemsListHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  itemsListHeaderText: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#333",
  },
  itemsListItem: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  itemsListItemCode: {
    fontSize: 13,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  itemsListItemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  itemsListItemColumn: {
    flex: 1,
    alignItems: "center",
  },
  itemsListItemLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  itemsListItemQty: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#2196F3",
  },
  itemsListFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 12,
    backgroundColor: "#E3F2FD",
    borderRadius: 8,
    borderTopWidth: 2,
    borderTopColor: "#2196F3",
  },
  itemsListFooterLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  itemsListFooterValue: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1976D2",
  },
  emptyModalContainer: {
    padding: 40,
    alignItems: "center",
  },
  emptyModalText: {
    fontSize: 16,
    color: "#999",
    textAlign: "center",
  },
  putawayMoreText: {
    fontSize: 12,
    color: "#F57C00",
    fontStyle: "italic",
    textAlign: "center",
    marginTop: 4,
  },
  storeSection: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  storeSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  storeSectionHeaderLeft: {
    flex: 1,
    marginRight: 12,
  },
  storeSectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  storeSectionSubtitle: {
    fontSize: 14,
    color: "#666",
  },
  createBoxButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    minWidth: 120,
    alignItems: "center",
  },
  createBoxButtonDisabled: {
    opacity: 0.5,
  },
  createBoxButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});
