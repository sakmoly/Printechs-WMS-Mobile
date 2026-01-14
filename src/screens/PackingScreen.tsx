import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  FlatList,
} from "react-native";
import { useApp } from "../context/AppContext";
import {
  useNavigation,
  useFocusEffect,
  useRoute,
} from "@react-navigation/native";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { StatusBadge } from "../components/StatusBadge";
import { ProgressIndicator } from "../components/ProgressIndicator";
import { dataService } from "../services/data.service";
import { apiService } from "../services/api.service";
import { addEvent } from "../services/event-queue.service";
import { getSettings } from "../services/settings.service";
import { getDatabase } from "../database/database";

export default function PackingScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { activeASN, activeSession } = useApp();
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [transferCarton, setTransferCarton] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<any[]>([]);
  const [packedBoxes, setPackedBoxes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSealing, setIsSealing] = useState(false);
  const [hasSealedTC, setHasSealedTC] = useState(false);
  const [availableStores, setAvailableStores] = useState<string[]>([]);
  const [transferOrder, setTransferOrder] = useState<string | null>(null);

  // Function to check and load existing Transfer Cartons
  const checkExistingTC = useCallback(async () => {
    if (!activeASN) {
      console.log("⚠️ checkExistingTC: No activeASN, skipping");
      return;
    }

    // Don't load TCs if no store is selected - wait for store to be set
    if (!selectedStore) {
      console.log(
        "⚠️ checkExistingTC: No selectedStore, skipping (will load when store is selected)"
      );
      return;
    }

    console.log(
      `🔄 checkExistingTC: Starting for ASN ${activeASN}, Store ${selectedStore}`
    );

    // First, try to fetch from backend API to ensure we have latest data
    try {
      const settings = await getSettings();
      if (settings.api_url && settings.demo_mode !== 1) {
        console.log(
          `🌐 Fetching Transfer Cartons from backend for ASN: ${activeASN}, Store: ${selectedStore}`
        );
        const backendResponse = await apiService.getTransferCartons({
          asn: activeASN,
          store: selectedStore,
        });

        console.log(
          "📡 Backend response:",
          JSON.stringify(backendResponse).substring(0, 500)
        );

        // Handle different response formats
        let backendTCs: any[] = [];
        if (Array.isArray(backendResponse)) {
          backendTCs = backendResponse;
        } else if (backendResponse && typeof backendResponse === "object") {
          if (Array.isArray(backendResponse.data)) {
            backendTCs = backendResponse.data;
          } else if (Array.isArray(backendResponse.items)) {
            backendTCs = backendResponse.items;
          } else if (Array.isArray(backendResponse.transfer_cartons)) {
            backendTCs = backendResponse.transfer_cartons;
          }
        }

        console.log(
          `📦 Extracted ${backendTCs.length} Transfer Carton(s) from backend response`
        );

        // Save backend Transfer Cartons to local database
        // First, check existing TCs to prevent duplicates
        const existingTCsInDB = await dataService.getTransferCartons(
          activeASN,
          selectedStore
        );
        const existingTCIds = new Set(
          existingTCsInDB.map((tc) => tc.tc_id).filter(Boolean)
        );

        if (backendTCs.length > 0) {
          let newTCsCount = 0;
          let skippedDuplicatesCount = 0;
          for (const tc of backendTCs) {
            if (tc.tc_id) {
              // Check if this TC already exists locally
              if (existingTCIds.has(tc.tc_id)) {
                console.log(
                  `⏭️ Skipping duplicate TC ${tc.tc_id} - already exists in local DB`
                );
                skippedDuplicatesCount++;
                continue;
              }

              // Map backend status to local status
              // "Created" status from backend should be treated as "Open"
              let mappedStatus = tc.status || "Open";
              if (mappedStatus === "Created") {
                mappedStatus = "Open";
              }

              const tcToSave = {
                tc_id: tc.tc_id,
                asn_no: tc.asn_no || tc.advance_shipping_notice || activeASN,
                to_no: tc.to_no || tc.transfer_order || null,
                store: tc.store || selectedStore,
                status: mappedStatus,
                updated_on:
                  tc.updated_on || tc.updated_at || new Date().toISOString(),
              };
              console.log(`💾 Saving Transfer Carton to local DB:`, tcToSave);
              await dataService.saveTransferCarton(tcToSave);
              newTCsCount++;
            }
          }
          console.log(
            `✅ Synced ${newTCsCount} new Transfer Carton(s) from backend for ASN ${activeASN} (skipped ${skippedDuplicatesCount} duplicates)`
          );
        } else {
          console.log(`ℹ️ No Transfer Cartons found in backend response`);
        }
      } else {
        console.log(`ℹ️ Skipping backend fetch (demo mode or no API URL)`);
      }
    } catch (error: any) {
      // If backend fetch fails, continue with local data
      // 404 is expected if endpoint doesn't exist - don't log as error
      if (
        !error.message?.includes("404") &&
        !error.message?.includes("not found")
      ) {
        console.warn(
          `⚠️ Failed to fetch Transfer Cartons from backend:`,
          error.message
        );
      } else {
        console.log(
          `ℹ️ Backend endpoint not found (404) - using local data only`
        );
      }
    }

    // Load from local database (now includes synced data from backend)
    console.log(
      `🔍 Querying local database for ASN: ${activeASN}, Store: ${selectedStore}`
    );
    const allTCsFromDB = await dataService.getTransferCartons(
      activeASN,
      selectedStore
    );

    // Filter out completed/dispatched TCs - they should not be shown in Packing screen
    const existingTCs = allTCsFromDB.filter(
      (tc) =>
        tc.status !== "Sealed" &&
        tc.status !== "Dispatched" &&
        tc.status !== "SEALED" &&
        tc.status !== "DISPATCHED"
    );

    console.log(
      `📦 Found ${allTCsFromDB.length} Transfer Carton(s) in local DB (${
        existingTCs.length
      } active, ${
        allTCsFromDB.length - existingTCs.length
      } completed) for ASN ${activeASN}, Store ${selectedStore}`,
      existingTCs.map((tc) => ({
        tc_id: tc.tc_id,
        status: tc.status,
        asn_no: tc.asn_no,
        store: tc.store,
      }))
    );

    // Also check without store filter to see all Transfer Cartons for this ASN (excluding completed)
    const allTCsForASN = await dataService.getTransferCartons(activeASN);
    const activeTCsForASN = allTCsForASN.filter(
      (tc) =>
        tc.status !== "Sealed" &&
        tc.status !== "Dispatched" &&
        tc.status !== "SEALED" &&
        tc.status !== "DISPATCHED"
    );
    console.log(
      `📦 Total ${activeTCsForASN.length} active Transfer Carton(s) for ASN ${activeASN} (all stores, excluding completed):`,
      activeTCsForASN.map((tc) => ({
        tc_id: tc.tc_id,
        status: tc.status,
        asn_no: tc.asn_no,
        store: tc.store,
      }))
    );

    // Filter out Sealed and Dispatched TCs - only show Open/Created TCs
    const activeTCs = existingTCs.filter(
      (tc) =>
        tc.tc_id &&
        (tc.status === "Open" || tc.status === "Created") &&
        tc.store === selectedStore
    );

    // Check for sealed or dispatched TCs from original query (for UI state, but don't use them)
    // These are filtered out from existingTCs, so we need to check allTCsFromDB
    const sealedTC = allTCsFromDB.find(
      (tc) =>
        tc.tc_id &&
        (tc.status === "Sealed" || tc.status === "SEALED") &&
        tc.store === selectedStore
    );
    const dispatchedTC = allTCsFromDB.find(
      (tc) =>
        tc.tc_id &&
        (tc.status === "Dispatched" || tc.status === "DISPATCHED") &&
        tc.store === selectedStore
    );

    if (activeTCs.length > 0 && activeTCs[0].tc_id) {
      const openTC = activeTCs[0];
      console.log(`✅ Found Open Transfer Carton: ${openTC.tc_id}`);
      setTransferCarton(openTC.tc_id);
      setHasSealedTC(false);
    } else {
      console.log(
        `ℹ️ No Open Transfer Carton found for store ${selectedStore}`
      );
      setTransferCarton(null);

      // Check if there are closed boxes that haven't been packed yet
      // Allow creating new TC if there are unpacked closed boxes, even if sealed/dispatched TC exists
      const db = await getDatabase();
      let hasUnpackedBoxes = false;

      if (db) {
        try {
          // Get all closed boxes for this store
          const closedBoxes = await dataService.getBoxes(
            activeASN,
            selectedStore
          );
          const closedBoxIds = closedBoxes
            .filter(
              (b) =>
                b.status === "Closed" ||
                b.status === "CLOSED" ||
                b.status === "closed"
            )
            .map((b) => b.box_id)
            .filter(Boolean);

          if (closedBoxIds.length > 0) {
            // Check which boxes are already packed into sealed/dispatched TCs
            // Use allTCsFromDB to check for completed TCs (they're filtered out from existingTCs)
            const sealedOrDispatchedTCs = allTCsFromDB.filter(
              (tc) =>
                tc.tc_id &&
                (tc.status === "Sealed" ||
                  tc.status === "Dispatched" ||
                  tc.status === "SEALED" ||
                  tc.status === "DISPATCHED")
            );

            if (sealedOrDispatchedTCs.length > 0) {
              const sealedOrDispatchedTCIds = sealedOrDispatchedTCs
                .map((tc) => tc.tc_id)
                .filter(Boolean);
              const placeholders = sealedOrDispatchedTCIds
                .map(() => "?")
                .join(",");

              // Get boxes that are already packed into sealed/dispatched TCs
              const packedBoxes = await db.getAllAsync<{ box_id: string }>(
                `SELECT DISTINCT box_id 
                   FROM event_queue 
                   WHERE event_type = 'PACK_BOX_TO_TC' 
                     AND tc_id IN (${placeholders})
                     AND box_id IS NOT NULL
                     AND box_id != ''`,
                sealedOrDispatchedTCIds
              );

              const packedBoxIds = new Set(packedBoxes.map((b) => b.box_id));

              // Check if there are any closed boxes NOT packed into sealed/dispatched TCs
              hasUnpackedBoxes = closedBoxIds.some(
                (boxId) => !packedBoxIds.has(boxId)
              );

              console.log(`📦 Closed boxes check:`, {
                totalClosed: closedBoxIds.length,
                packedIntoSealedDispatched: packedBoxIds.size,
                hasUnpackedBoxes,
              });
            } else {
              // No sealed/dispatched TCs, so all closed boxes are available
              hasUnpackedBoxes = closedBoxIds.length > 0;
              console.log(
                `📦 No sealed/dispatched TCs, ${closedBoxIds.length} closed boxes available`
              );
            }
          }
        } catch (error: any) {
          console.warn(`⚠️ Error checking unpacked boxes:`, error.message);
          // On error, default to allowing creation if there are non-warehouse closed boxes
          const closedBoxes = await dataService.getBoxes(
            activeASN,
            selectedStore
          );
          const nonWarehouseBoxes = closedBoxes.filter((b) => {
            // Skip Putaway boxes
            if (b.box_id && b.box_id.startsWith("PAW-")) {
              return false;
            }
            // Check if warehouse (async, but in error case we'll be conservative)
            return (
              b.status === "Closed" ||
              b.status === "CLOSED" ||
              b.status === "closed"
            );
          });
          hasUnpackedBoxes = nonWarehouseBoxes.length > 0;
        }
      }

      // Only disable if there's a sealed/dispatched TC AND no unpacked closed boxes
      // This allows creating multiple TCs when there are still boxes to pack
      setHasSealedTC((!!sealedTC || !!dispatchedTC) && !hasUnpackedBoxes);

      if (sealedTC && sealedTC.tc_id) {
        console.log(`ℹ️ Found Sealed Transfer Carton: ${sealedTC.tc_id}`);
      }
      if (dispatchedTC && dispatchedTC.tc_id) {
        console.log(
          `ℹ️ Found Dispatched Transfer Carton: ${dispatchedTC.tc_id}`
        );
      }
      if (hasUnpackedBoxes) {
        console.log(
          `✅ Unpacked closed boxes available - allowing new TC creation`
        );
      } else if (sealedTC || dispatchedTC) {
        console.log(
          `ℹ️ All boxes are packed into sealed/dispatched TCs - disabling new TC creation`
        );
      }
    }
    setPackedBoxes([]);
  }, [activeASN, selectedStore]);

  useEffect(() => {
    loadBoxes();
    checkExistingTC();
  }, [activeASN, selectedStore, checkExistingTC]);

  // Refresh when screen is focused
  useFocusEffect(
    useCallback(() => {
      console.log(
        "🔄 PackingScreen focused - refreshing Transfer Cartons and stores"
      );
      if (activeASN) {
        // Check if there are any closed boxes before allowing access to Packing screen
        const checkClosedBoxes = async () => {
          try {
            const allBoxes = await dataService.getBoxes(activeASN);
            const closedBoxes = allBoxes.filter(
              (b) =>
                b.status === "Closed" ||
                b.status === "CLOSED" ||
                b.status === "closed"
            );

            // Filter out warehouse boxes and Putaway boxes
            const nonWarehouseClosedBoxes: any[] = [];
            for (const box of closedBoxes) {
              // Skip Putaway boxes (PAW-*)
              if (box.box_id && box.box_id.startsWith("PAW-")) {
                continue;
              }

              // Check if box store is warehouse
              const isWarehouse = await dataService.isWarehouse(
                box.store || ""
              );
              if (!isWarehouse) {
                nonWarehouseClosedBoxes.push(box);
              }
            }

            if (nonWarehouseClosedBoxes.length === 0) {
              Alert.alert(
                "No Boxes Available",
                "There are no closed boxes available for packing.\n\nPlease close some boxes first before accessing the Packing screen.",
                [
                  {
                    text: "OK",
                    onPress: () => {
                      navigation.goBack();
                    },
                  },
                ]
              );
              return;
            }

            // If there are closed boxes, proceed with normal loading
            loadTransferOrderStores();
            checkExistingTC();
            loadBoxes();
          } catch (error: any) {
            console.error("❌ Error checking closed boxes:", error);
            // On error, still allow access (don't block user)
            loadTransferOrderStores();
            checkExistingTC();
            loadBoxes();
          }
        };

        checkClosedBoxes();
      }
    }, [activeASN, checkExistingTC, navigation])
  );

  const loadBoxes = async () => {
    if (!activeASN) {
      console.warn(`⚠️ PackingScreen: loadBoxes skipped - no activeASN`);
      return;
    }

    if (!selectedStore) {
      console.warn(
        `⚠️ PackingScreen: loadBoxes skipped - no selectedStore (will load when store is selected)`
      );
      setBoxes([]);
      return;
    }

    console.log(
      `🔄 PackingScreen: loadBoxes called for ASN ${activeASN}, Store ${selectedStore}`
    );
    const boxList = await dataService.getBoxes(activeASN, selectedStore);
    console.log(
      `📦 PackingScreen: getBoxes returned ${boxList.length} total boxes for Store ${selectedStore}`
    );
    console.log(
      `📦 All boxes from getBoxes:`,
      boxList.map((b) => ({
        box_id: b.box_id,
        store: b.store,
        status: b.status,
      }))
    );

    const closedBoxes = boxList.filter(
      (b) =>
        b.status === "Closed" || b.status === "CLOSED" || b.status === "closed"
    );

    console.log(
      `📦 PackingScreen: Found ${closedBoxes.length} closed boxes for ASN ${activeASN}, Store ${selectedStore}`
    );
    console.log(
      `📦 Closed boxes:`,
      closedBoxes.map((b) => ({
        box_id: b.box_id,
        store: b.store,
        status: b.status,
      }))
    );

    // NEW WORKFLOW: Filter out warehouse boxes - they should go to Putaway screen, not Packing
    // Also filter out Putaway boxes (PAW-*) - they should go to Putaway screen
    const nonWarehouseBoxes: any[] = [];
    for (const box of closedBoxes) {
      // Skip Putaway boxes (PAW-*)
      if (box.box_id && box.box_id.startsWith("PAW-")) {
        console.log(
          `⏭️ PackingScreen: Skipping Putaway box ${box.box_id} - should go to Putaway screen`
        );
        continue;
      }

      // Check if box store is warehouse
      const isWarehouse = await dataService.isWarehouse(box.store || "");
      if (isWarehouse) {
        console.log(
          `⏭️ PackingScreen: Skipping warehouse box ${box.box_id} (store: ${box.store}) - should go to Putaway screen`
        );
        continue;
      }

      // Non-warehouse box - include it
      nonWarehouseBoxes.push(box);
    }

    console.log(
      `📦 PackingScreen: After filtering warehouse boxes: ${nonWarehouseBoxes.length} non-warehouse closed boxes`
    );

    // Additional client-side filter: ensure boxes match the selected store exactly
    // This is a safety measure in case the database query didn't filter correctly
    const selectedStoreUpper = selectedStore.trim().toUpperCase();
    const storeFilteredBoxes = nonWarehouseBoxes.filter((box) => {
      const boxStoreUpper = (box.store || "").trim().toUpperCase();
      const matches = boxStoreUpper === selectedStoreUpper;
      if (!matches) {
        console.warn(
          `⚠️ PackingScreen: Box ${box.box_id} has store "${box.store}" but selected store is "${selectedStore}" - filtering out`
        );
      }
      return matches;
    });

    console.log(
      `📦 PackingScreen: After client-side store filter: ${storeFilteredBoxes.length} boxes match store ${selectedStore}`
    );

    // Get all Transfer Cartons for this ASN and store (excluding completed ones)
    // Boxes packed into sealed OR dispatched TCs should not be shown
    const allTCs = await dataService.getTransferCartons(
      activeASN,
      selectedStore
    );
    // Filter out completed TCs - they should not be considered
    const completedTCs = allTCs.filter(
      (tc) =>
        tc.status === "Sealed" ||
        tc.status === "Dispatched" ||
        tc.status === "SEALED" ||
        tc.status === "DISPATCHED"
    );

    console.log(
      `📦 PackingScreen: Found ${completedTCs.length} completed TCs (Sealed/Dispatched) for ASN ${activeASN}, Store ${selectedStore}`
    );

    if (completedTCs.length > 0) {
      // Get all box_ids that are already packed into sealed or dispatched TCs
      const db = await getDatabase();
      const completedTCIds = completedTCs.map((tc) => tc.tc_id).filter(Boolean);

      if (completedTCIds.length > 0) {
        // Query event_queue for boxes packed into sealed or dispatched TCs
        const placeholders = completedTCIds.map(() => "?").join(",");
        const packedBoxes = await db.getAllAsync<{ box_id: string }>(
          `SELECT DISTINCT box_id 
           FROM event_queue 
           WHERE event_type = 'PACK_BOX_TO_TC' 
             AND tc_id IN (${placeholders})
             AND box_id IS NOT NULL`,
          completedTCIds
        );

        const packedBoxIds = new Set(
          packedBoxes.map((b) => b.box_id).filter(Boolean)
        );

        console.log(
          `📦 Found ${packedBoxIds.size} box(es) already packed into sealed/dispatched TCs:`,
          Array.from(packedBoxIds)
        );
        console.log(
          `📦 Completed TCs (Sealed/Dispatched):`,
          completedTCs.map((tc) => ({ tc_id: tc.tc_id, status: tc.status }))
        );

        // Filter out boxes that are already packed into sealed or dispatched TCs
        const availableBoxes = storeFilteredBoxes.filter(
          (box) => !packedBoxIds.has(box.box_id)
        );

        console.log(
          `📦 Available boxes (excluding packed into sealed/dispatched TCs): ${availableBoxes.length} out of ${storeFilteredBoxes.length} store-filtered closed boxes`
        );
        console.log(
          `📦 Available box IDs:`,
          availableBoxes.map((b) => b.box_id)
        );
        setBoxes(availableBoxes);
      } else {
        // No completed TC IDs found, show all store-filtered closed boxes
        console.log(
          `📦 No completed TC IDs found, showing all ${storeFilteredBoxes.length} store-filtered closed boxes`
        );
        setBoxes(storeFilteredBoxes);
      }
    } else {
      // No sealed or dispatched TCs, show all store-filtered closed boxes
      console.log(
        `📦 No sealed/dispatched TCs found, showing all ${storeFilteredBoxes.length} store-filtered closed boxes`
      );
      setBoxes(storeFilteredBoxes);
    }
  };

  const handleCreateTC = async () => {
    // Prevent multiple simultaneous calls
    if (isCreating || loading) {
      return;
    }

    if (!activeASN) {
      Alert.alert("Error", "No active ASN");
      return;
    }

    // ✅ STRICT VALIDATION: Check for ANY existing TC for this store (except Dispatched)
    // This prevents creating duplicate TCs for the same store
    const allTCsFromDB = await dataService.getTransferCartons(
      activeASN,
      selectedStore
    );

    // Filter TCs for the selected store
    const storeTCs = allTCsFromDB.filter((tc) => tc.store === selectedStore);

    // Check for Open/Created TCs (active, can still pack items)
    const openTCs = storeTCs.filter(
      (tc) =>
        tc.status === "Open" ||
        tc.status === "Created" ||
        tc.status === "OPEN" ||
        tc.status === "CREATED"
    );

    // Check for Sealed TCs (completed, but not yet dispatched)
    const sealedTCs = storeTCs.filter(
      (tc) => tc.status === "Sealed" || tc.status === "SEALED"
    );

    // Check for Dispatched TCs (fully completed)
    const dispatchedTCs = storeTCs.filter(
      (tc) => tc.status === "Dispatched" || tc.status === "DISPATCHED"
    );

    // ✅ PREVENT DUPLICATE: If there's an Open/Created TC, prevent creating a new one
    if (openTCs.length > 0) {
      const existingTC = openTCs[0];
      Alert.alert(
        "Transfer Carton Already Exists",
        `An open Transfer Carton (${existingTC.tc_id}) already exists for ${selectedStore}.\n\nPlease use the existing Transfer Carton to pack items.\n\nYou cannot create another Transfer Carton for the same store.`,
        [{ text: "OK" }]
      );
      return;
    }

    // ✅ PREVENT DUPLICATE: If there's a Sealed TC (not dispatched), prevent creating a new one
    // Only allow new TC if all existing TCs are Dispatched
    if (sealedTCs.length > 0 && dispatchedTCs.length === 0) {
      const sealedTC = sealedTCs[0];
      Alert.alert(
        "Transfer Carton Already Sealed",
        `A Transfer Carton (${sealedTC.tc_id}) has already been sealed for ${selectedStore}.\n\nPlease dispatch the existing Transfer Carton before creating a new one.\n\nYou cannot create another Transfer Carton for the same store.`,
        [{ text: "OK" }]
      );
      return;
    }

    // If we have both Sealed and Dispatched TCs, check if all boxes are packed
    // This allows creating a new TC only if there are unpacked boxes AND all previous TCs are dispatched
    const sealedOrDispatchedTCs = [...sealedTCs, ...dispatchedTCs];

    // Check if there are closed boxes that haven't been packed yet
    // Allow creating new TC if there are unpacked closed boxes, even if sealed/dispatched TC exists
    // IMPORTANT: Only count non-warehouse boxes (warehouse boxes go to Putaway screen)
    const closedBoxes = await dataService.getBoxes(activeASN, selectedStore);
    const closedBoxesFiltered = closedBoxes.filter(
      (b) =>
        b.status === "Closed" || b.status === "CLOSED" || b.status === "closed"
    );

    // Filter out warehouse boxes and Putaway boxes - they should go to Putaway screen
    const nonWarehouseClosedBoxes: any[] = [];
    for (const box of closedBoxesFiltered) {
      // Skip Putaway boxes (PAW-*)
      if (box.box_id && box.box_id.startsWith("PAW-")) {
        continue;
      }

      // Check if box store is warehouse
      const isWarehouse = await dataService.isWarehouse(box.store || "");
      if (!isWarehouse) {
        // Non-warehouse box - include it
        nonWarehouseClosedBoxes.push(box);
      }
    }

    const closedBoxIds = nonWarehouseClosedBoxes
      .map((b) => b.box_id)
      .filter(Boolean);

    let hasUnpackedBoxes = false;
    if (closedBoxIds.length > 0 && sealedOrDispatchedTCs.length > 0) {
      const db = await getDatabase();
      if (db) {
        const sealedOrDispatchedTCIds = sealedOrDispatchedTCs
          .map((tc) => tc.tc_id)
          .filter(Boolean);
        const placeholders = sealedOrDispatchedTCIds.map(() => "?").join(",");

        // Get boxes that are already packed into sealed/dispatched TCs
        const packedBoxes = await db.getAllAsync<{ box_id: string }>(
          `SELECT DISTINCT box_id 
           FROM event_queue 
           WHERE event_type = 'PACK_BOX_TO_TC' 
             AND tc_id IN (${placeholders})
             AND box_id IS NOT NULL
             AND box_id != ''`,
          sealedOrDispatchedTCIds
        );

        const packedBoxIds = new Set(packedBoxes.map((b) => b.box_id));

        // Check if there are any closed boxes NOT packed into sealed/dispatched TCs
        hasUnpackedBoxes = closedBoxIds.some(
          (boxId) => !packedBoxIds.has(boxId)
        );
      }
    } else if (closedBoxIds.length > 0) {
      // No sealed/dispatched TCs, so all closed boxes are available
      hasUnpackedBoxes = true;
    }

    // ✅ ADDITIONAL VALIDATION: If there are Sealed/Dispatched TCs, only allow new TC if:
    // 1. All previous TCs are Dispatched (not just Sealed)
    // 2. AND there are unpacked closed boxes
    if (sealedOrDispatchedTCs.length > 0) {
      // Check if ALL existing TCs are Dispatched (not just Sealed)
      const allDispatched = sealedTCs.length === 0 && dispatchedTCs.length > 0;

      if (!allDispatched) {
        // There are Sealed (but not dispatched) TCs - prevent new TC
        const sealedTC = sealedTCs[0];
        Alert.alert(
          "Transfer Carton Already Sealed",
          `A Transfer Carton (${sealedTC.tc_id}) has already been sealed for ${selectedStore}.\n\nPlease dispatch the existing Transfer Carton before creating a new one.\n\nYou cannot create another Transfer Carton for the same store.`,
          [{ text: "OK" }]
        );
        return;
      }

      // All TCs are Dispatched, but check if there are unpacked boxes
      if (!hasUnpackedBoxes) {
        const dispatchedTC = dispatchedTCs[0];
        Alert.alert(
          "All Boxes Packed",
          `All Transfer Cartons for ${selectedStore} have been dispatched, and all closed boxes have been packed.\n\nYou cannot create another Transfer Carton.`,
          [{ text: "OK" }]
        );
        return;
      }
    }

    // Validate that there are closed boxes available before creating a TC
    if (closedBoxIds.length === 0) {
      Alert.alert(
        "No Boxes Available",
        `There are no closed boxes available for ${selectedStore}.\n\nPlease close some boxes first before creating a Transfer Carton.`,
        [{ text: "OK" }]
      );
      return;
    }

    setIsCreating(true);
    setLoading(true);
    try {
      // Get user_id from settings for created_by field
      const settings = await getSettings();

      // Validate that user_id exists (required by backend)
      if (!settings.user_id) {
        Alert.alert(
          "Error",
          "User ID not found. Please configure device settings."
        );
        setLoading(false);
        setIsCreating(false);
        return;
      }

      // Get TO number from Transfer Order allocations for the selected store
      // This handles both store boxes (STORE-001, etc.) and warehouse boxes (WH-MAIN, WAREHOUSE)
      let toNo: string | null = null;
      try {
        const allocations = await dataService.getTransferOrderAllocations(
          activeASN
        );

        if (allocations.length > 0) {
          // Check if selected store has allocations (handle warehouse stores flexibly)
          const storeUpper = selectedStore.toUpperCase().trim();
          const warehouseStores = ["WAREHOUSE", "WH-MAIN"];
          const isWarehouseStore =
            warehouseStores.includes(storeUpper) ||
            storeUpper.startsWith("WH-");

          // Find allocation for the selected store
          let storeAllocation = allocations.find((a) => {
            const allocStore = String(a.store || "")
              .toUpperCase()
              .trim();
            if (isWarehouseStore) {
              // For warehouse, match WAREHOUSE, WH-MAIN, or any WH-* store
              return (
                warehouseStores.includes(allocStore) ||
                allocStore.startsWith("WH-")
              );
            } else {
              // For regular stores, exact match
              return allocStore === storeUpper;
            }
          });

          if (storeAllocation && storeAllocation.to_no) {
            toNo = storeAllocation.to_no;
            console.log(`✅ Found TO number for ${selectedStore}: ${toNo}`);
          } else {
            // If no allocation found for this store, try to get TO from any allocation (same TO for all stores)
            const firstAllocation = allocations[0];
            if (firstAllocation && firstAllocation.to_no) {
              toNo = firstAllocation.to_no;
              console.log(
                `ℹ️ No specific allocation for ${selectedStore}, using TO from other allocations: ${toNo}`
              );
            } else {
              console.log(
                `⚠️ No TO number found in allocations for ${selectedStore}`
              );
            }
          }
        } else {
          console.log(
            `ℹ️ No Transfer Order allocations found for ASN ${activeASN}`
          );
        }
      } catch (error: any) {
        console.warn(
          `⚠️ Failed to get TO number from allocations:`,
          error.message
        );
        // Continue with null TO - backend should handle this
      }

      // ✅ Generate tc_id before calling API (backend requires it)
      // Format: TC-{ASN}-{timestamp}
      // Example: TC-ASN-0001-1767516827262
      const tc_id = `TC-${activeASN.replace(/^ASN-?/i, "")}-${Date.now()}`;

      console.log("📦 Creating Transfer Carton with:", {
        tc_id,
        asn_no: activeASN,
        to_no: toNo,
        store: selectedStore,
        user_id: settings.user_id,
        created_by: settings.user_id,
      });

      const response = await apiService.createTransferCarton({
        tc_id, // ✅ NEW: Backend requires tc_id
        asn_no: activeASN,
        to_no: toNo || undefined, // Optional - convert null to undefined
        store: selectedStore,
        user_id: settings.user_id || undefined,
        created_by: settings.user_id || undefined, // Backend requires created_by field
      });

      console.log(
        "📡 Transfer Carton creation response:",
        JSON.stringify(response).substring(0, 500)
      );

      // ✅ Extract tc_id from various possible response formats
      // Backend might return: { tc_id: "..." }, { data: { tc_id: "..." } }, { result: { tc_id: "..." } }, etc.
      // If backend returns a tc_id, use that (it may have modified our generated one)
      // Otherwise, use the tc_id we generated and sent
      const returnedTcId =
        response.tc_id ||
        response.data?.tc_id ||
        response.result?.tc_id ||
        response.response?.tc_id ||
        response.transfer_carton?.tc_id ||
        (response as any)?.id; // Some backends might return just "id"

      // Use the backend's tc_id if available, otherwise use the one we generated
      // Use the backend's tc_id if available, otherwise use the one we generated
      const finalTcId = returnedTcId || tc_id;
      
      if (returnedTcId && returnedTcId !== tc_id) {
        console.log(`✅ Backend returned different tc_id: ${returnedTcId} (we sent: ${tc_id})`);
      } else if (!returnedTcId) {
        console.log(`ℹ️ Backend did not return tc_id, using generated one: ${tc_id}`);
      }

      console.log(`✅ Transfer Carton created with tc_id: ${finalTcId}`);

      // ✅ PREVENT DUPLICATE: Check if TC with this ID already exists before saving
      const existingTCWithId = await dataService.getTransferCartons(activeASN);
      const duplicateTC = existingTCWithId.find((tc) => tc.tc_id === finalTcId);

      if (duplicateTC) {
        console.warn(
          `⚠️ TC ${finalTcId} already exists in local DB - skipping save to prevent duplicate`
        );
        Alert.alert(
          "Transfer Carton Already Exists",
          `Transfer Carton ${finalTcId} already exists in the database.\n\nPlease use the existing Transfer Carton.`,
          [{ text: "OK" }]
        );
        setLoading(false);
        setIsCreating(false);
        return;
      }

      const newTC: any = {
        tc_id: finalTcId, // ✅ Use finalTcId (backend's tc_id if returned, otherwise our generated one)
        asn_no: activeASN,
        to_no: toNo || null, // Use the TO number we found (or null if none)
        store: selectedStore,
        status: "Open",
        updated_on: new Date().toISOString(),
      };

      await dataService.saveTransferCarton(newTC);
      console.log(`✅ Transfer Carton saved to local DB:`, newTC);

      // Refresh the Transfer Carton list after creation
      await checkExistingTC();

      setTransferCarton(finalTcId); // ✅ Use finalTcId
      setPackedBoxes([]);
      Alert.alert("Success", `Transfer Carton ${finalTcId} created`);
    } catch (error: any) {
      console.error("❌ ERROR: Failed to create Transfer Carton:", error);
      Alert.alert("Error", error.message || "Failed to create Transfer Carton");
    } finally {
      setLoading(false);
      setIsCreating(false);
    }
  };

  const handleBoxScan = async (barcode: string) => {
    if (!transferCarton) {
      Alert.alert("Error", "Please create a Transfer Carton first");
      return;
    }

    const boxId = barcode.trim().toUpperCase();

    // Check if already packed
    if (packedBoxes.includes(boxId)) {
      Alert.alert("Info", "BOX already packed");
      return;
    }

    setLoading(true);
    try {
      // Query the box directly from database to get accurate status
      // This ensures we check the actual box status, not just what's in the filtered list
      // First try with store filter
      let allBoxes = await dataService.getBoxes(
        activeASN || undefined,
        selectedStore || undefined
      );
      let box = allBoxes.find((b) => b.box_id === boxId);

      // If not found with store filter, try without store filter (box might have different store format)
      if (!box) {
        console.log(
          `⚠️ Box ${boxId} not found with store filter "${selectedStore}", trying without store filter...`
        );
        allBoxes = await dataService.getBoxes(
          activeASN || undefined,
          undefined
        );
        box = allBoxes.find((b) => b.box_id === boxId);

        if (box) {
          console.log(
            `✅ Found box ${boxId} with store "${box.store}" (different from selected store "${selectedStore}")`
          );
          // Check if it's a warehouse store variation (WAREHOUSE vs WH-*)
          const selectedStoreUpper = selectedStore.toUpperCase();
          const boxStoreUpper = box.store?.toUpperCase() || "";
          const isWarehouseMatch =
            (selectedStoreUpper === "WAREHOUSE" &&
              boxStoreUpper.startsWith("WH-")) ||
            (selectedStoreUpper.startsWith("WH-") &&
              boxStoreUpper === "WAREHOUSE");

          if (!isWarehouseMatch) {
            Alert.alert(
              "Error",
              `BOX ${boxId} found but for different store.\n\nBox store: ${box.store}\nSelected store: ${selectedStore}\n\nPlease select the correct store or ensure the box is for the selected store.`
            );
            setLoading(false);
            return;
          }
          // If it's a warehouse match, continue (warehouse stores are flexible)
        }
      }

      if (!box) {
        // Try to find the box with any ASN to provide better error message
        const db = await getDatabase();
        const boxInfo = await db.getFirstAsync<{
          asn_no: string;
          store: string;
        }>("SELECT asn_no, store FROM box_cache WHERE box_id = ? LIMIT 1", [
          boxId,
        ]);

        if (boxInfo) {
          Alert.alert(
            "Error",
            `BOX ${boxId} found but for different ASN or store.\n\nBox ASN: ${boxInfo.asn_no}\nBox Store: ${boxInfo.store}\n\nCurrent ASN: ${activeASN}\nSelected Store: ${selectedStore}\n\nPlease ensure you're using the correct ASN and store.`
          );
        } else {
          Alert.alert(
            "Error",
            `BOX ${boxId} not found in database.\n\nPlease ensure:\n- The box exists for ASN ${activeASN}\n- The box is for store ${selectedStore}\n- The box was created during ReceiveSort`
          );
        }
        setLoading(false);
        return;
      }

      // Check if box is closed (required for packing)
      if (box.status !== "Closed") {
        Alert.alert(
          "Error",
          `BOX ${boxId} is not closed.\n\nCurrent status: ${
            box.status || "Unknown"
          }\n\nOnly closed boxes can be packed into Transfer Cartons.`
        );
        setLoading(false);
        return;
      }

      const settings = await getSettings();

      // Get all items in this box from scanned_items
      const boxItems = (await dataService.getScannedItemsByBox(
        boxId
      )) as Array<{
        carton_id?: string | null;
        item_code?: string | null;
        scanned_qty?: number | null;
        [key: string]: any;
      }>;

      if (boxItems.length === 0) {
        Alert.alert(
          "Warning",
          `BOX ${boxId} has no items.\n\nThis box cannot be packed because it contains no scanned items.`
        );
        setLoading(false);
        return;
      }

      console.log(
        `📦 Found ${boxItems.length} item(s) in box ${boxId} to pack to TC ${transferCarton}`
      );

      // ✅ PREVENT DUPLICATE: Check if this box is already packed into this TC
      const db = await getDatabase();
      if (db) {
        const existingPackedBox = await db.getFirstAsync<{ box_id: string }>(
          `SELECT box_id FROM event_queue 
           WHERE event_type = 'PACK_BOX_TO_TC' 
             AND tc_id = ? 
             AND box_id = ? 
             LIMIT 1`,
          [transferCarton, boxId]
        );

        if (existingPackedBox) {
          Alert.alert(
            "Box Already Packed",
            `BOX ${boxId} has already been packed into Transfer Carton ${transferCarton}.\n\nYou cannot pack the same box twice into the same Transfer Carton.`
          );
          setLoading(false);
          return;
        }
      }

      // Create one PACK_BOX_TO_TC event per item in the box
      // Backend expects: carton_id, item_code, qty for each item
      // IMPORTANT: box_id is stored as source carton to track which box the items came from
      let eventsCreated = 0;
      for (const item of boxItems) {
        await addEvent({
          event_type: "PACK_BOX_TO_TC",
          asn_no: activeASN ?? undefined,
          to_no: box.to_no ?? undefined,
          inbound_session: activeSession ?? undefined,
          carton_id: item.carton_id ?? undefined,
          item_code: item.item_code ?? undefined,
          qty: item.scanned_qty ?? undefined,
          store: box.store,
          box_id: boxId, // ✅ Source carton (box_id) - tracks which box items came from
          tc_id: transferCarton,
          device_id: settings.device_id ?? undefined,
          user_id: settings.user_id ?? undefined,
        });
        eventsCreated++;
      }

      console.log(
        `✅ Created ${eventsCreated} PACK_BOX_TO_TC event(s) for box ${boxId}`
      );

      setPackedBoxes([...packedBoxes, boxId]);

      // Refresh the boxes list to update UI
      await loadBoxes();

      Alert.alert(
        "Success",
        `BOX ${boxId} packed to ${transferCarton}\n\n${eventsCreated} item(s) added to Transfer Carton.`
      );
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to pack BOX");
    } finally {
      setLoading(false);
    }
  };

  const handleSeal = async () => {
    if (!transferCarton) return;

    // Prevent multiple simultaneous seal operations
    if (isSealing || loading) {
      return;
    }

    // Check if TC is already sealed
    try {
      const existingTCs = await dataService.getTransferCartons(
        activeASN ?? undefined,
        selectedStore
      );
      const currentTC = existingTCs.find((tc) => tc.tc_id === transferCarton);

      if (currentTC && currentTC.status === "Sealed") {
        Alert.alert(
          "Already Sealed",
          `Transfer Carton ${transferCarton} is already sealed.`,
          [
            {
              text: "OK",
              onPress: () => {
                setTransferCarton(null);
                setPackedBoxes([]);
                loadBoxes();
              },
            },
          ]
        );
        return;
      }
    } catch (error) {
      console.error("Error checking TC status:", error);
    }

    setIsSealing(true);
    setLoading(true);
    try {
      const settings = await getSettings();

      // Check if this TC is for Putaway (warehouse store or contains putaway boxes)
      const existingTCs = await dataService.getTransferCartons(
        activeASN ?? undefined,
        selectedStore
      );
      const currentTC = existingTCs.find((tc) => tc.tc_id === transferCarton);

      // Use isWarehouse function instead of hardcoded checks
      const isWarehouseTC =
        currentTC && currentTC.store
          ? await dataService.isWarehouse(currentTC.store)
          : false;

      // Check if any packed boxes are for putaway
      const db = await getDatabase();
      let hasPutawayBox = false;
      if (packedBoxes.length > 0 && db) {
        for (const boxId of packedBoxes) {
          const box = await db.getFirstAsync<{
            purpose: string;
            store: string;
          }>("SELECT purpose, store FROM box_cache WHERE box_id = ?", [boxId]);
          if (box) {
            // Check if box is for putaway (purpose = PUTAWAY) or warehouse store
            const isPutawayPurpose = box.purpose === "PUTAWAY";
            const isWarehouseStore = box.store
              ? await dataService.isWarehouse(box.store)
              : false;
            if (isPutawayPurpose || isWarehouseStore) {
              hasPutawayBox = true;
              break;
            }
          }
        }
      }

      const isPutawayTC = isWarehouseTC || hasPutawayBox;

      // Seal the Transfer Carton
      try {
        await apiService.sealTransferCarton({
          tc_id: transferCarton,
          sealed_by: settings.user_id || settings.user_code || undefined,
        });
      } catch (error: any) {
        // ✅ Handle duplicate Putaway box error gracefully
        // If backend tries to create a Putaway box that already exists, treat it as success
        const errorMessage = error.message || "";
        const errorString = JSON.stringify(error).toLowerCase(); // Convert full error to string for searching
        const errorDetails = error.details || {};
        const errorDetailsMessage = errorDetails.message || "";
        const errorCode = error.code || errorDetails.code || "";
        
        // Check for duplicate entry errors in multiple places
        const isDuplicatePutawayError =
          errorMessage.includes("Duplicate entry") ||
          errorMessage.includes("ER_DUP_ENTRY") ||
          errorMessage.includes("PAW-") ||
          errorMessage.includes("Failed to process transfer carton for putaway") ||
          errorString.includes("duplicate entry") ||
          errorString.includes("er_dup_entry") ||
          errorString.includes("paw-") ||
          errorDetailsMessage.includes("Duplicate entry") ||
          errorDetailsMessage.includes("ER_DUP_ENTRY") ||
          errorDetailsMessage.includes("PAW-") ||
          errorCode === "ER_DUP_ENTRY" ||
          errorCode === "DATABASE_ERROR"; // DATABASE_ERROR with duplicate entry details

        if (isDuplicatePutawayError && isPutawayTC) {
          console.log(
            `ℹ️ Duplicate Putaway box detected during seal - Putaway box already exists in backend, treating as success`
          );
          console.log(
            `ℹ️ This is expected if the putaway box was already created - continuing with seal process`
          );
          // Continue with the sealing process - the Putaway box already exists, which is fine
          // The backend has already created the putaway box, so we can proceed
        } else {
          // Re-throw other errors
          console.error(`❌ Error sealing Transfer Carton (not a duplicate putaway error):`, error);
          throw error;
        }
      }

      // NEW WORKFLOW: For Putaway TCs, skip dispatch - directly move to "Sealed" status
      // They will appear in Putaway list (PutAwayScreen shows "Sealed" and "Dispatched" TCs)
      // For warehouse TCs, also skip dispatch
      if (isPutawayTC) {
        // Also ensure BOX ID = TC ID for putaway boxes
        // If this TC was created from a putaway box, ensure they have the same ID
        if (packedBoxes.length > 0 && db) {
          for (const boxId of packedBoxes) {
            const box = await db.getFirstAsync<{
              purpose: string;
              box_id: string;
              store: string;
            }>(
              "SELECT purpose, box_id, store FROM box_cache WHERE box_id = ?",
              [boxId]
            );
            if (box && box.purpose === "PUTAWAY") {
              // For Putaway boxes: BOX ID = TC ID (use the same identifier)
              // If box_id doesn't match TC ID, update it
              if (box.box_id !== transferCarton) {
                // Check if TC ID already exists in box_cache (to avoid UNIQUE constraint violation)
                const existingTCBox = await db.getFirstAsync<{
                  box_id: string;
                }>("SELECT box_id FROM box_cache WHERE box_id = ?", [
                  transferCarton,
                ]);

                if (existingTCBox) {
                  // TC ID already exists - delete the old Putaway box record and update the existing one
                  console.log(
                    `⚠️ TC ID ${transferCarton} already exists in box_cache, updating existing record instead of creating duplicate`
                  );
                  // Delete the old Putaway box record
                  await db.runAsync("DELETE FROM box_cache WHERE box_id = ?", [
                    boxId,
                  ]);
                  // Update the existing TC box record with Putaway box data
                  await db.runAsync(
                    "UPDATE box_cache SET status = 'Sealed', purpose = 'PUTAWAY', updated_on = ? WHERE box_id = ?",
                    [new Date().toISOString(), transferCarton]
                  );
                } else {
                  // TC ID doesn't exist - safe to update box_id
                  await db.runAsync(
                    "UPDATE box_cache SET box_id = ?, status = 'Sealed' WHERE box_id = ?",
                    [transferCarton, boxId]
                  );
                }

                // Also update scanned_items to use new box_id (TC ID)
                await db.runAsync(
                  "UPDATE scanned_items SET box_id = ? WHERE box_id = ?",
                  [transferCarton, boxId]
                );
                // Update event_queue to use new box_id
                await db.runAsync(
                  "UPDATE event_queue SET box_id = ?, tc_id = ? WHERE box_id = ?",
                  [transferCarton, transferCarton, boxId]
                );
                console.warn(
                  `✅ Updated Putaway box ${boxId} to use TC ID ${transferCarton} (BOX ID = TC ID)`
                );
              }

              // Ensure TC exists with same ID as box (BOX ID = TC ID)
              const existingTC = await db.getFirstAsync<{ tc_id: string }>(
                "SELECT tc_id FROM tc_cache WHERE tc_id = ?",
                [transferCarton]
              );

              if (!existingTC) {
                // Create TC entry with same ID as box
                await dataService.saveTransferCarton({
                  tc_id: transferCarton, // BOX ID = TC ID
                  asn_no: activeASN || "",
                  to_no: "",
                  store: box.store || "WH-MAIN",
                  status: "Sealed",
                  updated_on: new Date().toISOString(),
                } as any);
                console.warn(
                  `✅ Created TC ${transferCarton} for Putaway box (BOX ID = TC ID)`
                );
              }
            }
          }
        }

        // Keep status as "Sealed" - PutAwayScreen will show it
        // Ensure TC is properly saved with Sealed status and correct store
        await dataService.updateTransferCartonStatus(transferCarton, "Sealed");

        // Also ensure TC exists in database with correct information
        if (currentTC) {
          const tcToSave = {
            tc_id: transferCarton,
            asn_no: currentTC.asn_no || activeASN || "",
            to_no: currentTC.to_no || "",
            store: currentTC.store || selectedStore,
            status: "Sealed",
            updated_on: new Date().toISOString(),
          };
          await dataService.saveTransferCarton(tcToSave);
          console.warn(
            `✅ Saved warehouse TC ${transferCarton} to database (Store: ${tcToSave.store}, Status: Sealed)`
          );
        }

        console.warn(
          `✅ Putaway TC ${transferCarton} sealed - will appear in Putaway list (dispatch skipped)`
        );

        Alert.alert(
          "Success",
          `Putaway Transfer Carton ${transferCarton} sealed\n\nThis TC will appear in Putaway list.\n\nDispatch step skipped.`,
          [
            {
              text: "OK",
              onPress: () => {
                setTransferCarton(null);
                setPackedBoxes([]);
                loadBoxes();
              },
            },
          ]
        );
      } else {
        // Normal TC - proceed with normal sealing
        await dataService.updateTransferCartonStatus(transferCarton, "Sealed");
        setHasSealedTC(true);
        Alert.alert("Success", `Transfer Carton ${transferCarton} sealed`, [
          {
            text: "OK",
            onPress: () => {
              setTransferCarton(null);
              setPackedBoxes([]);
              loadBoxes();
            },
          },
        ]);
      }
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to seal Transfer Carton");
    } finally {
      setLoading(false);
      setIsSealing(false);
    }
  };

  // Load stores from Transfer Order allocations
  const loadTransferOrderStores = async () => {
    if (!activeASN) {
      setAvailableStores(["WH-MAIN"]); // Fallback to warehouse
      if (!selectedStore) {
        setSelectedStore("WH-MAIN");
      }
      return;
    }

    try {
      // First, try to get stores from local database (transfer_order_cache)
      const allocations = await dataService.getTransferOrderAllocations(
        activeASN
      );

      if (allocations.length > 0) {
        // Get unique stores from allocations
        const uniqueStores = Array.from(
          new Set(allocations.map((a) => a.store).filter((s) => s))
        ).sort();

        // Get TO number
        const toNo = allocations[0].to_no;
        setTransferOrder(toNo || null);

        if (uniqueStores.length > 0) {
          console.log(
            `📦 Found ${uniqueStores.length} stores from TO allocations:`,
            uniqueStores
          );
          setAvailableStores(uniqueStores);

          // Auto-select first store if none selected (but don't override route param)
          const routeParams = route.params as
            | { initialStore?: string }
            | undefined;
          const initialStoreFromRoute = routeParams?.initialStore;
          if (
            !selectedStore ||
            (!uniqueStores.includes(selectedStore) && !initialStoreFromRoute)
          ) {
            setSelectedStore(uniqueStores[0]);
          } else if (
            initialStoreFromRoute &&
            uniqueStores.includes(initialStoreFromRoute) &&
            selectedStore !== initialStoreFromRoute
          ) {
            // Route param takes precedence if it's a valid store
            setSelectedStore(initialStoreFromRoute);
          }
          return;
        }
      }

      // No allocations in local DB - try to fetch from API
      console.log(
        `ℹ️ No allocations found in local database, fetching from API...`
      );
      try {
        const toResponse = await apiService.getTransferOrderByASN(activeASN);
        const toData =
          toResponse?.data || toResponse?.transfer_order || toResponse;

        if (toData && (toData.to_no || toData.transfer_order)) {
          const toNo = toData.to_no || toData.transfer_order;
          setTransferOrder(toNo);

          // Extract stores from allocations
          const allocations =
            toData.allocations ||
            toData.items ||
            toData.allocation ||
            toData.line_items ||
            toData.lines ||
            (Array.isArray(toData) ? toData : []);

          if (
            allocations &&
            Array.isArray(allocations) &&
            allocations.length > 0
          ) {
            // Save allocations to local database for future queries
            const db = await getDatabase();

            try {
              console.log(
                `💾 Saving ${allocations.length} TO allocations to local database...`
              );
              for (const allocation of allocations) {
                if (allocation.store && allocation.item_code) {
                  await db.runAsync(
                    `INSERT OR REPLACE INTO transfer_order_cache 
                     (to_no, asn_no, store, item_code, allocated_qty) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [
                      toNo,
                      activeASN,
                      allocation.store || allocation.store_code,
                      allocation.item_code,
                      allocation.allocated_qty || allocation.qty || 0,
                    ]
                  );
                }
              }
              console.log(
                `✅ Saved ${allocations.length} TO allocations to local database`
              );
            } catch (saveError: any) {
              console.warn(
                `⚠️ Failed to save TO allocations to database:`,
                saveError.message
              );
            }

            // Get unique stores from allocations
            const allocationStoreCodes: string[] = Array.from(
              new Set(
                allocations
                  .map((a: any) => a.store || a.store_code)
                  .filter((s: any) => s)
              )
            ).sort() as string[];

            if (allocationStoreCodes.length > 0) {
              console.log(
                `📦 Store codes from TO allocations:`,
                allocationStoreCodes
              );
              setAvailableStores(allocationStoreCodes);

              // Auto-select first store if none selected (but don't override route param)
              const routeParams = route.params as
                | { initialStore?: string }
                | undefined;
              const initialStoreFromRoute = routeParams?.initialStore;
              if (
                initialStoreFromRoute &&
                allocationStoreCodes.includes(initialStoreFromRoute)
              ) {
                // Route param takes precedence if it's a valid store
                console.log(
                  `🔄 PackingScreen: Setting store from route param: ${initialStoreFromRoute}`
                );
                setSelectedStore(initialStoreFromRoute);
              } else if (
                !selectedStore ||
                !allocationStoreCodes.includes(selectedStore)
              ) {
                console.log(
                  `🔄 PackingScreen: Auto-selecting first store: ${allocationStoreCodes[0]}`
                );
                setSelectedStore(allocationStoreCodes[0]);
              }
              return;
            }
          }
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
            `ℹ️ PackingScreen: No transfer order found for ASN ${activeASN} (this is OK - ASN can be received without Transfer Order)`
          );
        } else {
          // Other errors (network, 500, etc.) - log as warning
          console.warn("⚠️ PackingScreen: Could not fetch transfer order:", errorMessage);
        }
      }

      // No TO found or no allocations - Packing screen requires Transfer Order
      // Warehouse boxes should go to Putaway screen, not Packing screen
      console.log(
        `ℹ️ No Transfer Order found or no allocations - Packing screen requires Transfer Order with store allocations`
      );
      console.log(
        `ℹ️ Warehouse boxes should be handled in Putaway screen, not Packing screen`
      );
      setAvailableStores([]);
      setSelectedStore("");
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
          `ℹ️ PackingScreen: No transfer order found for ASN ${activeASN} (this is OK - ASN can be received without Transfer Order)`
        );
      } else {
        // Other errors (network, 500, etc.) - log as warning
        console.warn("⚠️ PackingScreen: Error loading transfer order stores:", errorMessage);
      }
      // Warehouse boxes should go to Putaway screen, not Packing screen
      setAvailableStores([]);
      setSelectedStore("");
    }
  };

  // Load stores when ASN changes
  useEffect(() => {
    loadTransferOrderStores();
  }, [activeASN]);

  // Initialize selected store from route params (when navigating from Box Management)
  useEffect(() => {
    const routeParams = route.params as { initialStore?: string } | undefined;
    if (
      routeParams?.initialStore &&
      routeParams.initialStore !== selectedStore
    ) {
      console.log(
        `🔄 PackingScreen: Setting initial store from route params: ${routeParams.initialStore}`
      );
      setSelectedStore(routeParams.initialStore);
    }
  }, [route.params]);

  // Use stores from TO allocations, fallback to WH-MAIN if none found
  const stores = availableStores.length > 0 ? availableStores : ["WH-MAIN"];

  return (
    <ScrollView style={styles.container}>
      <ProgressIndicator currentStep={5} totalSteps={6} stepName="Packing" />
      <View style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Store</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.storeSelector}
            contentContainerStyle={styles.storeSelectorContent}
          >
            {stores.map((store) => (
              <TouchableOpacity
                key={store}
                style={[
                  styles.storeButton,
                  selectedStore === store && styles.storeButtonActive,
                ]}
                onPress={() => {
                  setSelectedStore(store);
                  setTransferCarton(null);
                  setPackedBoxes([]);
                }}
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
        </View>

        {!transferCarton ? (
          <View style={styles.section}>
            <TouchableOpacity
              style={[
                styles.button,
                (loading || isCreating || hasSealedTC) && styles.buttonDisabled,
              ]}
              onPress={handleCreateTC}
              disabled={loading || isCreating || hasSealedTC}
            >
              <Text style={styles.buttonText}>
                {loading || isCreating
                  ? "Creating..."
                  : hasSealedTC
                  ? "Transfer Carton Sealed"
                  : "Create Transfer Carton"}
              </Text>
            </TouchableOpacity>
            {hasSealedTC && (
              <Text style={styles.disabledHint}>
                A Transfer Carton has already been created and sealed or
                dispatched for {selectedStore}. All closed boxes have been
                packed. You cannot create another one.
              </Text>
            )}
          </View>
        ) : (
          <>
            <View style={styles.tcInfo}>
              <Text style={styles.tcText}>TC: {transferCarton}</Text>
              <Text style={styles.tcText}>Store: {selectedStore}</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Scan BOX to Pack</Text>
              <BarcodeScanner
                onScan={handleBoxScan}
                placeholder="Scan BOX barcode"
                title="BOX Barcode"
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Packed BOXes</Text>
              {packedBoxes.length === 0 ? (
                <Text style={styles.emptyText}>No BOXes packed yet</Text>
              ) : (
                <FlatList
                  data={packedBoxes}
                  keyExtractor={(item) => item}
                  renderItem={({ item }) => (
                    <View style={styles.packedItem}>
                      <Text style={styles.packedBoxId}>{item}</Text>
                    </View>
                  )}
                  scrollEnabled={false}
                />
              )}
            </View>

            <TouchableOpacity
              style={[
                styles.button,
                styles.sealButton,
                (loading || isSealing) && styles.buttonDisabled,
              ]}
              onPress={handleSeal}
              disabled={loading || isSealing}
            >
              <Text style={styles.buttonText}>
                {loading || isSealing ? "Sealing..." : "Seal Transfer Carton"}
              </Text>
            </TouchableOpacity>
          </>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Available Closed BOXes</Text>
          {boxes.length === 0 ? (
            <Text style={styles.emptyText}>No closed BOXes available</Text>
          ) : (
            <FlatList
              data={boxes}
              keyExtractor={(item) => item.box_id}
              renderItem={({ item }) => (
                <View style={styles.boxItem}>
                  <Text style={styles.boxId}>{item.box_id}</Text>
                  <StatusBadge status={item.status} />
                </View>
              )}
              scrollEnabled={false}
            />
          )}
        </View>

        <TouchableOpacity
          style={styles.nextButton}
          onPress={() => navigation.navigate("Dispatch" as never)}
        >
          <Text style={styles.nextButtonText}>Next →</Text>
          <Text style={styles.nextButtonSubtext}>Dispatch</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  content: {
    padding: 16,
  },
  section: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 16,
    color: "#333",
  },
  storeSelector: {
    marginBottom: 0,
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
    backgroundColor: "#fff",
    alignItems: "center",
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
  tcInfo: {
    backgroundColor: "#E3F2FD",
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  tcText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1976D2",
    marginBottom: 4,
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 18,
    borderRadius: 8,
    alignItems: "center",
  },
  sealButton: {
    backgroundColor: "#FF9800",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  packedItem: {
    padding: 12,
    backgroundColor: "#E8F5E9",
    borderRadius: 6,
    marginBottom: 8,
  },
  packedBoxId: {
    fontSize: 16,
    fontWeight: "600",
    color: "#4CAF50",
  },
  boxItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  boxId: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  emptyText: {
    color: "#999",
    fontStyle: "italic",
    textAlign: "center",
    padding: 24,
  },
  disabledHint: {
    color: "#FF9800",
    fontSize: 14,
    textAlign: "center",
    marginTop: 12,
    fontStyle: "italic",
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
});
