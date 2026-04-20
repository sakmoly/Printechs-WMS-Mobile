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
import { useNavigation, useRoute } from "@react-navigation/native";
import { StatusBadge } from "../components/StatusBadge";
import { ProgressIndicator } from "../components/ProgressIndicator";
import { BarcodeDisplay } from "../components/BarcodeDisplay";
import { dataService } from "../services/data.service";
import { apiService } from "../services/api.service";
import { getSettings } from "../services/settings.service";
import { getDatabase } from "../database/database";
import { normalizeASN } from "../utils/asn";
import { Share } from "react-native";
import { isDeviceOnline } from "../utils/network-check";

export default function BoxManagementScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { activeASN, activeSession } = useApp();
  // ✅ NEW: Support Transfer In context (from route params)
  const routeParams = (route.params as any) || {};
  const transferIn = routeParams.transferIn || null;
  const sourceType = routeParams.sourceType || (activeASN ? "ASN" : null); // "ASN" or "TransferIn"
  const isTransferIn = sourceType === "TransferIn";
  
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
  const [refreshingTO, setRefreshingTO] = useState(false);
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
    // ✅ NEW: Load data - support both ASN and Transfer In
    const loadData = async () => {
      if (isTransferIn && transferIn) {
        // Transfer In: Load warehouses/stores and boxes
        await loadWarehousesAndStores();
        await loadBoxes();
      } else if (activeASN) {
        // ASN: Load stores first, then boxes (so sync can use stores list)
        await loadTransferOrderAndStores();
        await loadWarehousesAndStores();
        // Now load boxes (which will sync from backend using stores)
        await loadBoxes();
        await checkItemsWithoutTO();
        await calculateRemainingItems();
      }
    };
    loadData();
  }, [activeASN, transferIn, isTransferIn]);

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

      // ✅ FIX: Get Total TO Allocated quantity from API (not cache)
      // Fetch TO from API to get allocations
      let totalTO = 0;
      try {
        const online = await isDeviceOnline();
        if (!online) {
          console.warn(`⚠️ Device is offline - cannot calculate TO allocations. Please sync when online.`);
          setTotalTOAllocatedQty(0);
          setRemainingItemsQty(totalASN); // Assume all items are remaining if we can't get TO data
          return;
        }
        
        const toResponse = await apiService.getTransferOrderByASN(activeASN);
        if (toResponse) {
          const toData =
            toResponse?.data ||
            (typeof toResponse?.transfer_order === "object" ? toResponse?.transfer_order : null) ||
            toResponse;
          const allocations = 
            toData?.allocations || 
            toData?.items || 
            toData?.item_lines || 
            toData?.allocation || 
            toData?.line_items ||
            toData?.lines ||
            [];
          
          if (Array.isArray(allocations) && allocations.length > 0) {
            totalTO = allocations.reduce((sum: number, alloc: any) => sum + (alloc.allocated_qty || alloc.qty || 0), 0);
          }
        } else {
          // ✅ FIX: No TO found (404/null) - this is OK, all items need putaway
          console.log(`ℹ️ No Transfer Order found for ASN ${activeASN} - all items will need putaway`);
          totalTO = 0; // No TO means no allocations, so totalTO = 0
        }
      } catch (error: any) {
        console.warn(`⚠️ Error fetching TO allocations from API:`, error.message);
        // Check if it's a 404 (no TO found) - this is OK, not an error
        const is404Error = 
          error.message?.includes("404") ||
          error.message?.includes("No transfer order found") ||
          error.message?.includes("not found") ||
          error.message?.includes("TRANSFER_ORDER_NOT_FOUND");
        
        if (is404Error) {
          // ✅ FIX: 404 means no TO exists - this is OK, all items need putaway
          console.log(`ℹ️ No Transfer Order found (404) - all items will need putaway`);
          totalTO = 0; // No TO means no allocations
        } else {
          // Other errors (offline, 500, etc.)
          const isOffline = error.message?.includes("Network") || error.message?.includes("fetch");
          if (isOffline) {
            console.warn(`⚠️ Device appears offline - cannot calculate TO allocations. Please sync when online.`);
          }
          totalTO = 0; // Default to 0 if we can't fetch
        }
      }
      setTotalTOAllocatedQty(totalTO);

      // Remaining putaway = ASN total minus TO allocation sum from API.
      // Do NOT override with full ASN when `transferOrder` string is missing but API still returned
      // allocations (totalTO > 0) — that caused Remaining to show 800 while TO Allocated showed 400.
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

      // ✅ FIX: Get TO allocations from API (not cache)
      let allocatedItemCodes = new Set<string>();
      try {
        const online = await isDeviceOnline();
        if (!online) {
          console.warn(`⚠️ Device is offline - cannot check TO allocations. Please sync when online.`);
          // Don't use cache - show all items as unallocated when offline
          setItemsWithoutTO(scannedItems.map(item => ({
            item_code: item.item_code,
            scanned_qty: item.scanned_qty,
            store: item.store,
            box_id: item.box_id,
          })));
          setHasItemsWithoutTO(scannedItems.length > 0);
          return;
        }
        
        const toResponse = await apiService.getTransferOrderByASN(activeASN);
        if (toResponse) {
          const toData =
            toResponse?.data ||
            (typeof toResponse?.transfer_order === "object" ? toResponse?.transfer_order : null) ||
            toResponse;
          const allocations = 
            toData?.allocations || 
            toData?.items || 
            toData?.item_lines || 
            toData?.allocation || 
            toData?.line_items ||
            toData?.lines ||
            [];
          
          if (Array.isArray(allocations) && allocations.length > 0) {
            allocatedItemCodes = new Set(allocations.map((a: any) => a.item_code).filter(Boolean));
          }
        }
      } catch (error: any) {
        console.warn(`⚠️ Error fetching TO allocations from API:`, error.message);
        const isOffline = error.message?.includes("Network") || error.message?.includes("fetch");
        if (isOffline) {
          console.warn(`⚠️ Device appears offline - cannot check TO allocations. Please sync when online.`);
          // Don't use cache - show all items as unallocated when offline
          setItemsWithoutTO(scannedItems.map(item => ({
            item_code: item.item_code,
            scanned_qty: item.scanned_qty,
            store: item.store,
            box_id: item.box_id,
          })));
          setHasItemsWithoutTO(scannedItems.length > 0);
          return;
        }
        // For other errors, assume no allocations (all items are unallocated)
        allocatedItemCodes = new Set();
      }

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
      // ✅ FIX: Always fetch from API directly - do NOT use local cache
      // User requirement: Transfer Order data must come from backend API, not local cache
      // If offline, ask user to sync instead of using stale cache
      console.log(`🔄 Fetching Transfer Order directly from API for ASN: ${activeASN}`);
      console.log(`✅ DATA SOURCE: Always using backend API - NOT reading from local cache`);
      console.log(`✅ API Endpoint: GET /api/transfer-order/by-asn/${activeASN}`);
      
      // Check if device is online
      const online = await isDeviceOnline();
      if (!online) {
        console.warn(`⚠️ Device is offline - cannot fetch Transfer Order from API`);
        Alert.alert(
          "Offline Mode",
          "Your device is currently offline.\n\n" +
          "Transfer Order data must be fetched from the backend API.\n\n" +
          "Please connect to the internet and sync data, or try again when online.",
          [
            {
              text: "OK",
              onPress: () => {
                setTransferOrder(null);
                setDistributionStores([]);
              }
            }
          ]
        );
        setTransferOrder(null);
        setDistributionStores([]);
        return;
      }
      
      // Fetch TO from API (try activeASN, then normalized ASN if 404)
      let toResponse: any = null;
      try {
        toResponse = await apiService.getTransferOrderByASN(activeASN);
        if (toResponse === null) {
          const normalizedASNForTO = normalizeASN(activeASN);
          if (normalizedASNForTO !== activeASN) {
            console.log(`🔄 Retrying Transfer Order with normalized ASN: ${normalizedASNForTO}`);
            toResponse = await apiService.getTransferOrderByASN(normalizedASNForTO);
          }
        }
      } catch (_) {
        toResponse = null;
      }
      try {
        console.log("📋 Transfer Order API Response (raw):", toResponse);
        console.log("📋 Transfer Order API Response (stringified):", JSON.stringify(toResponse, null, 2));
        console.log(`✅ DATA SOURCE: Transfer Order data comes from backend API - NO CACHE - NO MOCK DATA`);
          console.log("📋 Transfer Order API Response type:", typeof toResponse);
          console.log("📋 Transfer Order API Response is null?", toResponse === null);
          console.log("📋 Transfer Order API Response is undefined?", toResponse === undefined);
          console.log("📋 Transfer Order API Response keys:", toResponse ? Object.keys(toResponse) : "null/undefined");
          
          // Handle different response formats (backend may wrap in .data or use different TO keys)
          // IMPORTANT: If transfer_order is a string (e.g. "WMS-TO-00006"), do NOT use it as toData —
          // use the full toResponse so we have access to allocations and to_no at top level.
          const toData =
            toResponse?.data ||
            (typeof toResponse?.transfer_order === "object" ? toResponse?.transfer_order : null) ||
            toResponse;
          console.log("📋 Extracted toData:", toData);
          console.log("📋 toData type:", typeof toData);
          console.log("📋 toData keys:", toData && typeof toData === "object" ? Object.keys(toData) : toData);
          
          // If toResponse is null, try to get TO and stores from ASN details (backend may embed them in ASN)
          if (toResponse === null) {
            console.log(`ℹ️ No Transfer Order from by-asn API - trying ASN details for TO and stores...`);
            try {
              const asnRes = await apiService.getASN(activeASN);
              const asnData = asnRes?.data || asnRes;
              const toNoFromASN = asnData?.transfer_order || asnData?.to_no || asnData?.transfer_order_no || asnData?.linked_to;
              const details: any[] = asnData?.details || asnData?.lines || asnData?.items || asnData?.data?.details || [];
              const storeFromRow = (r: any) => r.store || r.store_code || r.destination || r.to_store || r.warehouse || r.destination_store;
              const storesFromDetails = Array.from(new Set(
                details.map((r: any) => storeFromRow(r)).filter((s: any) => s && String(s).trim() !== "")
              )) as string[];
              const directStoresFromASN = asnData?.stores || asnData?.store_codes || asnData?.destinations || [];
              const directList = Array.isArray(directStoresFromASN)
                ? directStoresFromASN.map((s: any) => (typeof s === "string" ? s : s?.code ?? s?.store ?? "")).filter(Boolean)
                : [];
              const allStoresFromASN = storesFromDetails.length > 0 ? storesFromDetails : directList;
              if (toNoFromASN && String(toNoFromASN).trim()) {
                setTransferOrder(String(toNoFromASN).trim());
                console.log(`✅ Transfer Order from ASN details: ${toNoFromASN}`);
              }
              if (allStoresFromASN.length > 0) {
                setDistributionStores(Array.from(new Set(allStoresFromASN)).sort());
                console.log(`✅ Stores from ASN details:`, allStoresFromASN);
                return;
              }
            } catch (asnErr: any) {
              console.warn(`⚠️ Could not get stores from ASN details:`, asnErr?.message);
            }
            setTransferOrder(null);
            setDistributionStores([]);
            return;
          }
          
          // Accept multiple possible keys for TO number (e.g. WMS-TO-00006 from backend)
          const toNo =
            toData?.to_no ||
            toData?.transfer_order ||
            toData?.to_number ||
            toData?.transfer_order_no ||
            toData?.id ||
            toData?.title;
          const hasValidTO = toData && toNo && String(toNo).trim().length > 0;
          
          if (hasValidTO) {
            setTransferOrder(String(toNo).trim());
            console.log(`✅ Transfer Order found from API: ${toNo}`);
            console.log(`✅ Setting transferOrder state to: ${toNo} (from API, not cache)`);
            
            // Extract stores from allocations (try toData first, then top-level toResponse for WMS-TO-* style APIs)
            const allocations =
              toData?.allocations ||
              toData?.items ||
              toData?.item_lines ||
              toData?.allocation ||
              toData?.line_items ||
              toData?.lines ||
              toResponse?.allocations ||
              toResponse?.items ||
              toResponse?.item_lines ||
              (Array.isArray(toData) ? toData : []);
            
            console.log(`📦 Extracted allocations from API:`, allocations);
            console.log(`📦 Allocations type:`, typeof allocations);
            console.log(`📦 Allocations isArray:`, Array.isArray(allocations));
            console.log(`📦 Allocations length:`, Array.isArray(allocations) ? allocations.length : "N/A");
            
            if (allocations && Array.isArray(allocations) && allocations.length > 0) {
              console.log(`📦 First allocation sample from API:`, allocations[0]);
              console.log(`✅ DATA SOURCE: Stores extracted from TO allocations (API) - NO CACHE - NO MOCK DATA`);
              console.log(`✅ Stores found in TO allocations:`, Array.from(new Set(allocations.map((a: any) => a.store || a.store_code).filter(Boolean))));
              
              // ✅ FIX: Update local cache from API response (for sync purposes only)
              // Cache is updated from API, but never used for display - always use API data
              const normalizedASN = normalizeASN(activeASN);
              const db = await getDatabase();
              
              try {
                // Clear old allocations for this ASN before saving new ones from API
                console.log(`🗑️ Updating local cache from API response (cache updated from API, not used for display)...`);
                await db.runAsync(
                  `DELETE FROM transfer_order_cache WHERE asn_no = ? OR asn_no = ?`,
                  [activeASN, normalizedASN]
                );
                console.log(`✅ Cleared old cache data`);
                
                // Save API response to local cache (for sync/offline reference only - NOT used for display)
                console.log(`💾 Updating local cache with ${allocations.length} TO allocations from API response...`);
                for (const allocation of allocations) {
                  if (allocation.store && allocation.item_code) {
                    await db.runAsync(
                      `INSERT INTO transfer_order_cache 
                       (to_no, asn_no, store, item_code, allocated_qty) 
                       VALUES (?, ?, ?, ?, ?)`,
                      [
                        toNo,
                        normalizedASN,
                        allocation.store || allocation.store_code,
                        allocation.item_code,
                        allocation.allocated_qty || allocation.qty || 0,
                      ]
                    );
                  }
                }
                console.log(`✅ Local cache updated from API (cache is for sync only, display always uses API)`);
              } catch (saveError: any) {
                console.warn(`⚠️ Failed to update local cache from API:`, saveError.message);
                // Continue - cache update is optional, API data is primary
              }

              // Get store codes from API allocations (try all common field names)
              const storeFromAlloc = (a: any) =>
                a.store || a.store_code || a.warehouse || a.to_store || a.destination_store ||
                a.destination || a.target_store || a.location_code || a.warehouse_code;
              const allocationStoreCodes: string[] = Array.from(
                new Set(
                  allocations
                    .map((a: any) => (typeof a === "string" ? a : storeFromAlloc(a)))
                    .filter((s: any) => s && String(s).trim() !== "")
                )
              ) as string[];

              // If no stores from allocations, try direct store list (backend may send stores[] or store_codes[])
              let storeCodes = allocationStoreCodes;
              if (storeCodes.length === 0) {
                const directStores =
                  toData?.stores ||
                  toData?.store_codes ||
                  toData?.destinations ||
                  toResponse?.stores ||
                  toResponse?.store_codes ||
                  [];
                const directList = Array.isArray(directStores)
                  ? directStores.map((s: any) => (typeof s === "string" ? s : s?.code ?? s?.store ?? s?.store_code ?? "")).filter(Boolean)
                  : [];
                if (directList.length > 0) {
                  storeCodes = Array.from(new Set(directList)) as string[];
                  console.log(`📦 Store codes from TO direct list (stores/store_codes):`, storeCodes);
                }
              }

              console.log(`📦 Store codes from API TO:`, storeCodes);
              console.log(`📦 Raw allocations from API:`, allocations.slice(0, 5).map((a: any) => ({
                store: storeFromAlloc(a),
                item: a.item_code,
                allocated_qty: a.allocated_qty || a.qty,
              })));

              // Set stores from API data (NOT from cache)
              setDistributionStores(storeCodes.sort());
              
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
              // No allocations in TO - try ASN details for stores (ASN may have store per line)
              console.log(`⚠️ No allocations/stores in TO response - trying ASN details...`);
              try {
                const asnRes = await apiService.getASN(activeASN);
                const asnData = asnRes?.data || asnRes;
                const details: any[] = asnData?.details || asnData?.lines || asnData?.items || asnData?.data?.details || [];
                const storeFromRow = (r: any) => r.store || r.store_code || r.destination || r.to_store || r.warehouse || r.destination_store;
                const storesFromDetails = Array.from(new Set(
                  details.map((r: any) => storeFromRow(r)).filter((s: any) => s && String(s).trim() !== "")
                )) as string[];
                const directStoresFromASN = asnData?.stores || asnData?.store_codes || asnData?.destinations || [];
                const directList = Array.isArray(directStoresFromASN)
                  ? directStoresFromASN.map((s: any) => (typeof s === "string" ? s : s?.code ?? s?.store ?? "")).filter(Boolean)
                  : [];
                const allStoresFromASN = storesFromDetails.length > 0 ? storesFromDetails : directList;
                if (allStoresFromASN.length > 0) {
                  setDistributionStores(Array.from(new Set(allStoresFromASN)).sort());
                  console.log(`✅ Stores from ASN details (TO had no allocations):`, allStoresFromASN);
                } else {
                  setDistributionStores([]);
                }
              } catch (_) {
                setDistributionStores([]);
              }
            }
          } else {
            // No Transfer Order found - show empty list
            console.log(`ℹ️ No Transfer Order found for ASN ${activeASN} (from API)`);
            setTransferOrder(null);
            setDistributionStores([]);
          }
        } catch (error: any) {
          // Handle errors - check if offline
          const errorMessage = error?.message || error?.toString() || "";
          const isOffline = 
            errorMessage.includes("Network") ||
            errorMessage.includes("fetch") ||
            errorMessage.includes("Failed to fetch") ||
            errorMessage.includes("Network request failed");
          
          const is404Error = 
            errorMessage.includes("404") ||
            errorMessage.includes("No transfer order found") ||
            errorMessage.includes("not found") ||
            errorMessage.includes("TRANSFER_ORDER_NOT_FOUND");
          
          if (isOffline) {
            // Device is offline - ask user to sync
            console.warn(`⚠️ BoxManagementScreen: Device is offline - cannot fetch Transfer Order`);
            Alert.alert(
              "Offline Mode",
              "Your device is currently offline.\n\n" +
              "Transfer Order data must be fetched from the backend API.\n\n" +
              "Please connect to the internet and sync data, or try again when online.",
              [
                {
                  text: "OK",
                  onPress: () => {
                    setTransferOrder(null);
                    setDistributionStores([]);
                  }
                }
              ]
            );
            setTransferOrder(null);
            setDistributionStores([]);
            return;
          } else if (is404Error) {
            // 404 is expected - ASN can be received without Transfer Order
            console.log(
              `ℹ️ BoxManagementScreen: No transfer order found for ASN ${activeASN} (this is OK - ASN can be received without Transfer Order)`
            );
            setTransferOrder(null);
            setDistributionStores([]);
          } else {
            // Other errors (500, etc.) - log as warning
            console.warn("⚠️ BoxManagementScreen: Could not fetch transfer order from API:", errorMessage);
            Alert.alert(
              "API Error",
              `Failed to fetch Transfer Order from backend:\n\n${errorMessage}\n\nPlease try again or contact support.`,
              [
                {
                  text: "OK",
                  onPress: () => {
                    setTransferOrder(null);
                    setDistributionStores([]);
                  }
                }
              ]
            );
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
    } catch (error: any) {
      // Handle 404 errors gracefully - ASN can be received without Transfer Order
      const errorMessage = error?.message || error?.toString() || "";
      const is404Error = 
        errorMessage.includes("404") ||
        errorMessage.includes("No transfer order found") ||
        errorMessage.includes("not found") ||
        errorMessage.includes("TRANSFER_ORDER_NOT_FOUND");
      
      if (is404Error) {
        // 404 is expected - ASN can be received without Transfer Order
        console.log(
          `ℹ️ BoxManagementScreen: No transfer order found for ASN ${activeASN} (this is OK - ASN can be received without Transfer Order)`
        );
      } else {
        // Other errors (network, 500, etc.) - log as warning
        console.warn("⚠️ BoxManagementScreen: Error loading transfer order and stores:", errorMessage);
      }
      setTransferOrder(null);
      // Don't set default stores - only show stores that actually exist in TO allocations
      // If there's an error, show empty list or only what's in the database
      setDistributionStores([]);
    }
  };

  const loadBoxes = async () => {
    if (!activeASN) return;
    
    // ✅ FIX: Always fetch boxes from backend API - do NOT use local cache for display
    // Check if device is online first
    const online = await isDeviceOnline();
    if (!online) {
      console.warn(`⚠️ Device is offline - cannot fetch boxes from API`);
      Alert.alert(
        "Offline Mode",
        "Your device is currently offline.\n\n" +
        "Box data must be fetched from the backend API.\n\n" +
        "Please connect to the internet and sync data, or try again when online.",
        [
          {
            text: "OK",
            onPress: () => {
              setBoxes([]);
            }
          }
        ]
      );
      setBoxes([]);
      return;
    }
    
    // ✅ SYNC: Fetch boxes from backend API for each store
    // This ensures boxes created on backend/desktop are visible on mobile
    try {
      // Get current stores (from TO allocations - distributionStores)
      // Note: stores variable is defined later as distributionStores, so use distributionStores directly
      const currentStores = distributionStores.length > 0 ? distributionStores : [];
      if (currentStores.length > 0) {
        console.log(`🔄 Fetching boxes from backend API for ${currentStores.length} store(s): ${currentStores.join(", ")}`);
        console.log(`✅ DATA SOURCE: Always using backend API - NOT reading from local cache`);
        console.log(`✅ API Endpoint: GET /api/boxes?asn=${activeASN}&store={store}`);
        for (const store of currentStores) {
          try {
            const backendBoxes = await apiService.getBoxes({ asn: activeASN, store });
            console.log(`✅ Fetching boxes for store ${store} from backend API (not cache)`);
            let boxesArray: any[] = [];
            
            // Handle different response formats
            if (Array.isArray(backendBoxes)) {
              boxesArray = backendBoxes;
            } else if (backendBoxes && typeof backendBoxes === 'object') {
              boxesArray = (backendBoxes as any).data || (backendBoxes as any).boxes || (backendBoxes as any).items || [];
            }
            
            if (Array.isArray(boxesArray) && boxesArray.length > 0) {
              const db = await getDatabase();
              if (db) {
                let syncedCount = 0;
                for (const box of boxesArray) {
                  if (box.box_id && box.store) {
                    await dataService.saveBox({
                      box_id: box.box_id,
                      asn_no: box.asn_no || activeASN,
                      to_no: box.to_no || null,
                      store: box.store,
                      status: box.status || "Open",
                      purpose: box.purpose || "STORE",
                      updated_on: box.updated_on || new Date().toISOString(),
                    });
                    syncedCount++;
                  }
                }
                console.log(`✅ Synced ${syncedCount} box(es) from backend for store ${store}`);
              }
            } else {
              console.log(`ℹ️ No boxes found in backend API for store ${store} (this is OK if no boxes created yet)`);
            }
          } catch (error: any) {
            // Check if offline
            const errorMessage = error?.message || error?.toString() || "";
            const isOffline = 
              errorMessage.includes("Network") ||
              errorMessage.includes("fetch") ||
              errorMessage.includes("Failed to fetch");
            
            if (isOffline) {
              console.warn(`⚠️ Device is offline - cannot fetch boxes for store ${store}`);
              // Don't use cache - show error
              Alert.alert(
                "Offline Mode",
                `Cannot fetch boxes for store ${store}.\n\n` +
                "Your device is offline. Please connect to the internet and sync data.",
                [{ text: "OK" }]
              );
            } else {
              // Other API errors (404, 500, etc.)
              console.warn(`⚠️ Could not fetch boxes from backend API for store ${store}:`, errorMessage);
            }
          }
        }
      } else {
        console.log(`ℹ️ No stores available yet for fetching boxes (stores will be loaded from TO API)`);
      }
    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || "";
      const isOffline = 
        errorMessage.includes("Network") ||
        errorMessage.includes("fetch") ||
        errorMessage.includes("Failed to fetch");
      
      if (isOffline) {
        console.warn(`⚠️ Device is offline - cannot fetch boxes from API`);
        Alert.alert(
          "Offline Mode",
          "Your device is currently offline.\n\n" +
          "Box data must be fetched from the backend API.\n\n" +
          "Please connect to the internet and sync data.",
          [{ text: "OK" }]
        );
        setBoxes([]);
        return;
      } else {
        console.warn(`⚠️ Error fetching boxes from backend API:`, errorMessage);
      }
    }
    
    // ✅ FIX: Load boxes from local database (updated from API above) - but only if API fetch succeeded
    // If API failed, don't show stale cache data
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
    // ✅ NEW: Support both ASN and Transfer In
    if (!activeASN && !transferIn) {
      Alert.alert("Error", isTransferIn ? "No Transfer In selected" : "No active ASN");
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

      // ✅ NEW: Only check Transfer Order for ASN (not Transfer In)
      if (!isTransferIn && !transferOrder && !isWarehouse) {
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

      // ✅ NEW: Build request data - support both ASN and Transfer In
      const requestData: any = {
        store: normalizedStore,
        purpose: isTransferIn ? "PUTAWAY" : "STORE", // Transfer In boxes are for putaway
        user_id: settings.user_id,
      };
      
      // ✅ NEW: Include Transfer In or ASN based on source type
      if (isTransferIn && transferIn) {
        requestData.transfer_in = transferIn;
        // ✅ NEW: Generate TI- naming series for Transfer In boxes
        const timestamp = Date.now();
        const transferInBoxId = `TI-PUT-${transferIn.replace(/[^A-Z0-9]/g, "")}-${timestamp}`;
        requestData.box_id = transferInBoxId; // Send TI- format box_id to backend
        requestData.to_no = "Putaway"; // Set Transfer Order to "Putaway" for Transfer In putaway boxes
        requestData.transfer_order = "Putaway";
      } else if (activeASN) {
        requestData.asn_no = activeASN;
      } else {
        Alert.alert("Error", "No ASN or Transfer In available");
        setLoading(false);
        return;
      }

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
      let boxId: string | null = null;
      
      // ✅ NEW: For Transfer In, use generated TI- box_id
      if (isTransferIn && requestData.box_id) {
        boxId = requestData.box_id; // Use generated TI-PUT- format
      }
      
      try {
        response = await apiService.createBox(requestData);
        console.log("📦 API Response:", JSON.stringify(response, null, 2));
        
        // ✅ NEW: For Transfer In, prefer our generated TI- format
        if (isTransferIn && boxId) {
          const backendBoxId =
            response?.box_id ||
            response?.data?.box_id ||
            response?.box?.box_id ||
            response?.id ||
            null;
          
          if (backendBoxId && (backendBoxId.startsWith("TI-") || backendBoxId.startsWith("TI-PUT-"))) {
            // Backend returned TI- format - use it
            boxId = backendBoxId;
            console.log(`✅ Backend returned TI- format box_id: ${boxId}`);
          } else if (backendBoxId) {
            // Backend returned different format - use our format
            console.warn(`⚠️ Backend returned box_id in different format: ${backendBoxId}, using our TI- format: ${boxId}`);
          } else {
            console.log(`ℹ️ Backend did not return box_id, using generated TI- format: ${boxId}`);
          }
        }
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

      // ✅ NEW: Extract box_id from response (only if not Transfer In, as we already have TI- format)
      if (!isTransferIn) {
        // For ASN, extract box_id from response
        const backendBoxId =
          response?.box_id ||
          response?.data?.box_id ||
          response?.box?.box_id ||
          response?.id ||
          null;

        if (backendBoxId) {
          boxId = backendBoxId;
          console.log(`✅ Using backend box_id: ${boxId}`);
        } else {
          // Backend didn't return box_id - generate one
          // Format: BOX-{STORE}-{TIMESTAMP}
          const timestamp = Date.now();
          boxId = `BOX-${normalizedStore.replace(/[^A-Z0-9]/g, "")}-${timestamp}`;
          console.log(`ℹ️ Backend didn't return box_id, generated: ${boxId}`);
        }
      }
      // For Transfer In, boxId is already set from generated TI- format above

      if (!boxId) {
        console.error("❌ No box_id in API response:", response);
        // Generate a temporary box ID if backend doesn't return one
        const tempBoxId = `BOX-${normalizedStore}-${Date.now()}`;
        console.warn(`⚠️ Using temporary box ID: ${tempBoxId}`);

        // ✅ NEW: Build box data - support both ASN and Transfer In
        const newBox: any = {
          box_id: tempBoxId,
          store: normalizedStore,
          status: "Open",
          purpose: isTransferIn ? "PUTAWAY" : "STORE",
          updated_on: new Date().toISOString(),
        };
        
        // ✅ NEW: Include Transfer In or ASN based on source type
        if (isTransferIn && transferIn) {
          newBox.transfer_in = transferIn;
          newBox.to_no = "Putaway";
        } else if (activeASN) {
          newBox.asn_no = activeASN;
          newBox.to_no = transferOrder || null;
        }

        await dataService.saveBox(newBox);
        await loadBoxes();
        Alert.alert(
          "Success",
          `BOX ${tempBoxId} created for ${targetStore}\n\nNote: Backend did not return box_id. Using temporary ID.`
        );
        return;
      }

      // ✅ NEW: Build box data - support both ASN and Transfer In
      const newBox: any = {
        box_id: boxId,
        store: normalizedStore, // Use normalized store value
        status: "Open",
        purpose: isTransferIn ? "PUTAWAY" : "STORE", // Transfer In boxes are for putaway
        updated_on: new Date().toISOString(),
      };
      
      // ✅ NEW: Include Transfer In or ASN based on source type
      if (isTransferIn && transferIn) {
        newBox.transfer_in = transferIn;
        newBox.to_no = "Putaway";
      } else if (activeASN) {
        newBox.asn_no = activeASN;
        newBox.to_no = transferOrder || null;
      }

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
      
      // ✅ PERMANENT FIX: Check if there are open cartons for other stores
      // If yes, stay on screen; if no, navigate to main menu
      let hasOpenCartons = false;
      if (activeASN && activeSession) {
        try {
          const allCartonStatuses = await dataService.getAllCartonStatuses(
            activeASN,
            activeSession
          );
          // Check if there are any cartons that are not "Received" (i.e., still open)
          // Valid statuses: "Pending" | "Unloaded" | "Receiving" | "Received"
          hasOpenCartons = allCartonStatuses.some(
            (status) => status.status !== "Received"
          );
          console.log(
            `🔍 Open cartons check: ${hasOpenCartons ? "Found" : "No"} open cartons`
          );
        } catch (error: any) {
          console.warn(
            `⚠️ Could not check for open cartons:`,
            error.message
          );
          // If check fails, assume there might be open cartons (safer to stay)
          hasOpenCartons = true;
        }
      }
      
      Alert.alert(
        "Success",
        message,
        [
          {
            text: "OK",
            onPress: () => {
              // If no open cartons, navigate to main menu
              // If there are open cartons, stay on current screen
              if (!hasOpenCartons) {
                console.log(
                  `✅ No open cartons - navigating to Home screen`
                );
                (navigation as any).navigate("Home");
              } else {
                console.log(
                  `ℹ️ Open cartons exist - staying on Box Management screen`
                );
              }
            },
          },
        ]
      );
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

  // ✅ NEW: Create Putaway BOX/TC for items without TO - support both ASN and Transfer In
  // For ASN: Items will be added during Receive + Sort
  // For Transfer In: Items will be scanned directly in Box Management
  const handleCreatePutawayBox = async () => {
    // ✅ NEW: Support both ASN and Transfer In
    if (!activeASN && !transferIn) {
      Alert.alert("Error", isTransferIn ? "No Transfer In selected" : "No active ASN");
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

      // ✅ NEW: Generate BOX ID for Putaway - support both ASN and Transfer In
      // ASN Format: PAW-{ASN}-{TIMESTAMP}
      // Transfer In Format: TI-PUT-{TRANSFER_IN}-{TIMESTAMP}
      const timestamp = Date.now();
      let putawayBoxId: string;
      
      if (isTransferIn && transferIn) {
        // ✅ NEW: Transfer In Putaway box - use TI- naming series
        putawayBoxId = `TI-PUT-${transferIn.replace(/[^A-Z0-9]/g, "")}-${timestamp}`;
      } else if (activeASN) {
        // ASN Putaway box - use PAW- format
        putawayBoxId = `PAW-${activeASN.replace(/[^A-Z0-9]/g, "")}-${timestamp}`;
      } else {
        Alert.alert("Error", "No ASN or Transfer In available");
        setLoading(false);
        return;
      }

      // ✅ NEW: Build request data for backend API - support both ASN and Transfer In
      const requestData: any = {
        store: warehouseStore,
        purpose: "PUTAWAY", // Mark as Putaway box
        user_id: settings.user_id,
        to_no: "Putaway", // Set Transfer Order to "Putaway" for putaway boxes
        transfer_order: "Putaway",
        box_id: putawayBoxId, // Send our generated format (PAW- for ASN, TI-PUT- for Transfer In)
      };
      
      // ✅ NEW: Include ASN or Transfer In based on source type
      if (isTransferIn && transferIn) {
        requestData.transfer_in = transferIn;
      } else if (activeASN) {
        requestData.asn_no = activeASN;
      }

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

        // ✅ NEW: Check backend box_id format - support both PAW- (ASN) and TI- (Transfer In)
        if (isTransferIn && transferIn) {
          // Transfer In: Check for TI- format
          if (backendBoxId && (backendBoxId.startsWith("TI-") || backendBoxId.startsWith("TI-PUT-"))) {
            boxId = backendBoxId;
            console.log(`✅ Backend returned TI- format box_id: ${boxId}`);
          } else if (backendBoxId) {
            console.warn(`⚠️ Backend returned box_id in different format: ${backendBoxId}, using our TI- format: ${boxId}`);
          } else {
            console.log(`ℹ️ Backend did not return box_id, using generated TI- format: ${boxId}`);
          }
        } else {
          // ASN: Check for PAW- format
          if (backendBoxId && backendBoxId.startsWith("PAW-")) {
            boxId = backendBoxId;
            console.log(`✅ Backend returned PAW- format box_id: ${boxId}`);
          } else if (backendBoxId) {
            console.warn(`⚠️ Backend returned box_id in different format: ${backendBoxId}, using our PAW- format: ${boxId}`);
          } else {
            console.log(`ℹ️ Backend did not return box_id, using generated PAW- format: ${boxId}`);
          }
        }
      } catch (apiError: any) {
        // If backend API fails, still create locally with generated PAW- format
        const errorMessage = apiError.message || apiError.toString() || "Unknown error";
        console.warn(`⚠️ Backend API error creating Putaway box: ${errorMessage}`);
        console.warn(`⚠️ Creating Putaway box locally with PAW- format ID: ${boxId}`);
        // Continue with local creation
      }

      // ✅ NEW: Create BOX for Putaway (save to local database) - support both ASN and Transfer In
      const putawayBox: any = {
        box_id: boxId,
        to_no: "Putaway", // Set Transfer Order to "Putaway" for putaway boxes
        store: warehouseStore,
        status: "Open",
        purpose: "PUTAWAY", // Mark as Putaway box
        updated_on: new Date().toISOString(),
      };
      
      // ✅ NEW: Include ASN or Transfer In based on source type
      if (isTransferIn && transferIn) {
        putawayBox.transfer_in = transferIn;
      } else if (activeASN) {
        putawayBox.asn_no = activeASN;
      }

      await dataService.saveBox(putawayBox);
      console.log(`✅ Putaway Box ${boxId} saved to local database`);

      // Reload boxes and check items without TO again
      await loadBoxes();
      await checkItemsWithoutTO();

      Alert.alert(
        "Putaway Box Created",
        isTransferIn
          ? `Transfer In Putaway Box ${boxId} created successfully.\n\nYou can now scan items into this box. After closing the box, it will appear in Putaway list.`
          : `Putaway Box ${boxId} created successfully.\n\nItems without TO can now be sorted into this box during Receive + Sort.\n\nThis box will appear in Putaway list after sealing.`,
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
      // Load stores first, then boxes (so sync can use stores list)
      loadTransferOrderAndStores().then(() => {
        loadBoxes();
      });
      loadWarehousesAndStores();
    });
    return unsubscribe;
  }, [navigation, activeASN]);

  // Group boxes by store for summary view (case-insensitive matching)
  // Include both Open and Closed boxes for accurate counting
  // Exclude Putaway boxes - they are shown in a separate section
  // Exclude boxes that are packed into dispatched TCs
  const boxesByStore = useMemo(() => {
    // ✅ FIX: Normalize store codes for better matching
    // Create a map of normalized store codes to original store codes
    const normalizedStoreMap = new Map<string, string>();
    stores.forEach(store => {
      const normalized = String(store).trim().toUpperCase();
      normalizedStoreMap.set(normalized, store);
    });
    
    // Also create reverse map: all unique box store codes (normalized) -> original
    const boxStoreCodes = new Set<string>();
    boxes.forEach(box => {
      if (box.store) {
        const normalized = String(box.store).trim().toUpperCase();
        boxStoreCodes.add(normalized);
      }
    });
    
    // Log for debugging
    console.log(`📊 BoxManagement: Grouping boxes by store`, {
      storesFromTO: stores,
      normalizedStores: Array.from(normalizedStoreMap.keys()),
      boxStoreCodes: Array.from(boxStoreCodes),
      totalBoxes: boxes.length,
    });
    
    return stores.reduce((acc, store) => {
      const storeUpper = String(store).trim().toUpperCase();
      // ✅ Include ALL boxes (Open and Closed) for accurate counting
      const matchingBoxes = boxes.filter((b) => {
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
        const matches = boxStoreUpper === storeUpper;
        
        // Log mismatches for debugging
        if (!matches && boxStoreCodes.has(boxStoreUpper)) {
          console.warn(`⚠️ BoxManagement: Store code mismatch - Box store: "${b.store}" (normalized: "${boxStoreUpper}") vs TO store: "${store}" (normalized: "${storeUpper}")`);
        }
        
        return matches;
      });
      
      acc[store] = matchingBoxes;
      
      // Log grouping results
      if (matchingBoxes.length > 0) {
        console.log(`✅ BoxManagement: Store "${store}" has ${matchingBoxes.length} box(es)`, {
          boxIds: matchingBoxes.map(b => b.box_id),
          boxStores: matchingBoxes.map(b => b.store),
        });
      } else {
        console.warn(`⚠️ BoxManagement: Store "${store}" has 0 boxes - checking for format mismatch...`);
        // Check if there are boxes with similar store codes
        const similarBoxes = boxes.filter(b => {
          if (!b.store || b.purpose === "PUTAWAY") return false;
          const boxStoreUpper = String(b.store).trim().toUpperCase();
          // Check if store codes are similar (e.g., "SR-01" vs "SR-01 ")
          return boxStoreUpper.includes(storeUpper) || storeUpper.includes(boxStoreUpper);
        });
        if (similarBoxes.length > 0) {
          console.warn(`⚠️ BoxManagement: Found ${similarBoxes.length} box(es) with similar store codes:`, {
            boxes: similarBoxes.map(b => ({ box_id: b.box_id, store: b.store, normalized: String(b.store).trim().toUpperCase() })),
            expectedStore: store,
            expectedNormalized: storeUpper,
          });
        }
      }
      
      return acc;
    }, {} as Record<string, any[]>);
  }, [stores, boxes, boxToTCMap, dispatchedTCSet]);
  
  // Separate: Filter for display (only show Open boxes in the list, but count includes Closed)
  const boxesByStoreForDisplay = useMemo(() => {
    return stores.reduce((acc, store) => {
      const storeUpper = String(store).trim().toUpperCase();
      // Only show Open boxes in the list (Closed boxes are counted but not displayed)
      acc[store] = (boxesByStore[store] || []).filter((b) => {
        // Only show Open boxes in the list
        return b.status === "Open" || b.status === "OPEN" || b.status === "open";
      });
      return acc;
    }, {} as Record<string, any[]>);
  }, [stores, boxesByStore]);

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
  // ✅ FIX: Show Putaway section if:
  // 1. No TO exists (no transfer order) AND there's available quantity (totalASNQty > 0), OR
  // 2. Remaining items > 0 (Total ASN - Total TO > 0), OR
  // 3. There are Putaway boxes already created
  // This allows creating Putaway boxes even when there's no Transfer Order but there's available quantity
  const showPutawaySection = 
    (!transferOrder && totalASNQty > 0) || // No TO but has available quantity
    remainingItemsQty > 0 || // Has remaining items after TO allocation
    hasPutawayBoxes; // Already has Putaway boxes

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
        {/* ✅ DATA SOURCE: Transfer Order ALWAYS comes from backend API (GET /api/transfer-order/by-asn/{asn}) - NOT from local cache */}
        {(transferOrder || activeASN) && (
          <View style={styles.toInfoSection}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <Text style={styles.toInfoText}>
                {transferOrder ? (
                  <>Transfer Order: <Text style={styles.toInfoValue}>{transferOrder}</Text></>
                ) : (
                  <>ASN: <Text style={styles.toInfoValue}>{activeASN}</Text></>
                )}
              </Text>
              <TouchableOpacity
                style={[styles.refreshTOButton, refreshingTO && { opacity: 0.6 }]}
                onPress={async () => {
                  if (refreshingTO || !activeASN) return;
                  setRefreshingTO(true);
                  try {
                    await loadTransferOrderAndStores();
                    await loadBoxes();
                    if (activeASN) {
                      await checkItemsWithoutTO();
                      await calculateRemainingItems();
                    }
                    Alert.alert("Refreshed", "Transfer Order and stores have been reloaded from the backend. You can now create boxes per store.");
                  } catch (e: any) {
                    Alert.alert("Refresh failed", e?.message || "Could not refresh. Check connection and try again.");
                  } finally {
                    setRefreshingTO(false);
                  }
                }}
                disabled={refreshingTO}
              >
                <Text style={styles.refreshTOButtonText}>{refreshingTO ? "Refreshing…" : "Refresh TO & Stores"}</Text>
              </TouchableOpacity>
            </View>
            {__DEV__ && transferOrder && (
              <Text style={[styles.toInfoText, { fontSize: 10, color: "#666", marginTop: 4 }]}>
                Source: Backend API (always fetched directly, not from cache)
              </Text>
            )}
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
            
            {/* ✅ FIX: Show Create button if:
                1. No TO exists AND there's available quantity (totalASNQty > 0), OR
                2. Remaining items > 0 (Total ASN - Total TO > 0)
                This allows creating Putaway boxes even when there's no Transfer Order but there's available quantity */}
            {((!transferOrder && totalASNQty > 0) || remainingItemsQty > 0) && (
              <TouchableOpacity
                style={[
                  styles.createPutawayButton,
                  loading && styles.createPutawayButtonDisabled,
                ]}
                onPress={handleCreatePutawayBox}
                disabled={loading}
              >
                <Text style={styles.createPutawayButtonText}>
                  {loading ? "Creating..." : `+ Create Putaway BOX (${!transferOrder && totalASNQty > 0 ? totalASNQty : remainingItemsQty} items)`}
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
        {/* ✅ DATA SOURCE: Stores come ONLY from Transfer Order allocations (backend API: GET /api/transfer-order/by-asn/{asn}) */}
        {/* ✅ NO MOCK DATA: All stores are extracted from TO allocations - no hardcoded or default stores */}
        {transferOrder && stores.length > 0 ? (
          stores.map((store) => {
            const storeBoxes = boxesByStore[store] || [];
            const openCount = storeBoxes.filter((b) => b.status === "Open" || b.status === "OPEN" || b.status === "open").length;
            const closedCount = storeBoxes.filter((b) => b.status === "Closed" || b.status === "CLOSED" || b.status === "closed").length;
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

                {(() => {
                  // Use display list (only Open boxes) for rendering
                  const displayBoxes = boxesByStoreForDisplay[store] || [];
                  return displayBoxes.length === 0 ? (
                    <Text style={styles.emptyText}>
                      {totalCount === 0
                        ? `No boxes created for ${store} yet`
                        : `${closedCount} closed box${closedCount === 1 ? "" : "es"} — go to Packing to create Transfer Carton`}
                    </Text>
                  ) : (
                    <FlatList
                      data={displayBoxes}
                      key={`boxes-list-${store}-${displayBoxes.length}`}
                      extraData={`${store}-${displayBoxes.length}`}
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
                  );
                })()}
              </View>
            );
          })
        ) : transferOrder ? (
          // TO exists but no stores loaded yet, or stores are empty - show message
          <View style={styles.createSection}>
            <Text style={styles.sectionTitle}>Create New BOX</Text>
            <Text style={styles.emptyText}>
              {distributionStores.length === 0
                ? "No stores found in Transfer Order.\n\nEnsure GET /api/transfer-order/by-asn/{ASN} returns allocations (each with store or store_code) or a stores array so you can create boxes per store."
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
          // ✅ FIX: When no TO exists, show message directing user to Putaway section
          // Putaway section will show "Create Putaway BOX" button if there's available quantity
          <View style={styles.createSection}>
            <Text style={styles.sectionTitle}>Create New BOX</Text>
            <Text style={styles.emptyText}>
              {totalASNQty > 0 
                ? `No Transfer Order found.\n\nIf you have available quantity (${totalASNQty} items), please use the "Items Without Transfer Order" section above to create Putaway boxes.`
                : "No Transfer Order found.\n\nStores must come from Transfer Order allocations.\n\nIf you have items to put away, they will appear in the \"Items Without Transfer Order\" section above."}
            </Text>
            {totalASNQty === 0 && (
              <Text style={[styles.emptyText, { marginTop: 8, fontSize: 12, color: "#999" }]}>
                Note: Items must be scanned first (in Receive + Sort) before creating boxes.
              </Text>
            )}
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
  refreshTOButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  refreshTOButtonText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "600",
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
