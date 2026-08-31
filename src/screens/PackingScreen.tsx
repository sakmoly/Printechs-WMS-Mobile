import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { syncEvents } from "../services/event-queue.service";
import { resendReceiveLinesToBackend } from "../services/receive-lines-resend.service";
import { getSettings } from "../services/settings.service";
import { getDatabase } from "../database/database";
import { canonicalStoreForToLine } from "../utils/to-store-master";
import { normalizeASN } from "../utils/asn";
import {
  storeFieldFromAllocationRow,
  itemCodeFromAllocationRow,
} from "../utils/allocation-row-fields";

const storesMatch = (a: unknown, b: unknown): boolean =>
  String(a || "").trim().toUpperCase() ===
  String(b || "").trim().toUpperCase();

const isPutawayBoxId = (boxId: unknown): boolean => {
  const normalized = String(boxId || "").trim().toUpperCase();
  return normalized.startsWith("PAW-");
};

const isPutawayPurpose = (purpose: unknown): boolean =>
  String(purpose || "").trim().toUpperCase() === "PUTAWAY";

const isPutawayBoxRow = (box: any): boolean =>
  isPutawayBoxId(box?.box_id || box?.name) || isPutawayPurpose(box?.purpose);

const cartonStockErrorMessage = (error: any): string | null => {
  const raw = String(error?.message || JSON.stringify(error) || "");
  if (!raw.includes("CARTON_NOT_IN_STOCK") && !raw.includes("tabCartonStock")) {
    return null;
  }

  const cartonMatch = raw.match(/Carton\s+([^"\s]+)\s+not found/i);
  const itemMatch = raw.match(/item\s+([^".\s}]+)/i);
  const cartonText = cartonMatch?.[1] ? `Carton: ${cartonMatch[1]}\n` : "";
  const itemText = itemMatch?.[1] ? `Item: ${itemMatch[1]}\n` : "";

  return (
    "Backend carton stock is not ready for this BOX yet.\n\n" +
    cartonText +
    itemText +
    "\nThe app synced pending events and receive lines before packing, but the backend still cannot find this carton/item in carton stock.\n\nPlease confirm the carton was fully received/sorted on backend, then try packing again."
  );
};

const extractCartonIds = (input: unknown): string[] => {
  const cartonIds = new Set<string>();
  const cartonKeys = [
    "carton_id",
    "source_carton_id",
    "supplier_carton_id",
    "ctn",
    "carton",
    "Carton",
    "Supplier Carton",
  ];
  const arrayKeys = [
    "items",
    "lines",
    "box_items",
    "boxItems",
    "carton_contents",
    "contents",
    "data",
    "result",
  ];

  const scan = (value: unknown, depth = 0) => {
    if (!value || depth > 6) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => scan(entry, depth + 1));
      return;
    }
    if (typeof value !== "object") return;

    const row = value as Record<string, unknown>;
    for (const key of cartonKeys) {
      const text = String(row[key] || "").trim();
      if (text) cartonIds.add(text.toUpperCase());
    }
    for (const key of arrayKeys) {
      if (row[key] != null) scan(row[key], depth + 1);
    }
  };

  scan(input);
  return Array.from(cartonIds);
};

export default function PackingScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { activeASN, activeSession } = useApp();
  const [selectedStore, setSelectedStore] = useState<string>("");
  const [transferCarton, setTransferCarton] = useState<string | null>(null);
  const [transferCartonStatus, setTransferCartonStatus] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<any[]>([]);
  const [packedBoxes, setPackedBoxes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSealing, setIsSealing] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  const [hasSealedTC, setHasSealedTC] = useState(false);
  const [availableStores, setAvailableStores] = useState<string[]>([]);
  const [transferOrder, setTransferOrder] = useState<string | null>(null);

  /** Same action as scanning / Submit on BOX Barcode — updated every render */
  const handleBoxScanRef = useRef<(barcode: string) => Promise<void>>(
    async () => {}
  );
  /** Double-tap detector for packing from "Available Closed BOXes" without a scanner */
  const closedBoxDoubleTapRef = useRef<{ boxId: string; t: number }>({
    boxId: "",
    t: 0,
  });

  const loadPackedBoxIdsForTC = async (tcId: string | null | undefined) => {
    if (!tcId) return [];
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ box_id: string }>(
      `SELECT DISTINCT box_id
       FROM event_queue
       WHERE event_type = 'PACK_BOX_TO_TC'
         AND tc_id = ?
         AND box_id IS NOT NULL
         AND box_id != ''`,
      [tcId]
    );
    return rows.map((row) => row.box_id).filter(Boolean);
  };

  const packedBoxIdsFromTransferCarton = (tc: any): string[] => {
    const result = new Set<string>();
    const boxKeys = [
      "box_id",
      "source_box_id",
      "sort_box",
      "sort_box_id",
      "sortBox",
      "sortBoxId",
      "box",
      "Sort box (Box ID)",
      "sort box (box id)",
      "Sort Box",
      "sort_box_box_id",
    ];
    const rowArrayKeys = [
      "packed_boxes",
      "packedBoxes",
      "boxes_packed",
      "items",
      "lines",
      "box_items",
      "carton_contents",
      "cartonContents",
      "contents",
      "scan_events",
      "wms_scan_events",
      "data",
      "result",
    ];

    const addBoxId = (value: unknown) => {
      const text = String(value || "").trim();
      if (text) result.add(text);
    };

    const scan = (value: unknown, depth = 0) => {
      if (!value || depth > 5) return;
      if (typeof value === "string") {
        addBoxId(value);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((entry) => scan(entry, depth + 1));
        return;
      }
      if (typeof value !== "object") return;

      const row = value as Record<string, unknown>;
      for (const key of boxKeys) {
        if (row[key] != null) addBoxId(row[key]);
      }
      for (const key of rowArrayKeys) {
        if (row[key] != null) scan(row[key], depth + 1);
      }
    };

    scan(tc);
    return Array.from(result);
  };

  const loadPackedBoxIdsForTransferCarton = async (tc: any) => {
    const fromBackend = packedBoxIdsFromTransferCarton(tc);
    if (fromBackend.length > 0) return fromBackend;

    if (tc?.tc_id) {
      try {
        const detail = await apiService.getTransferCarton(tc.tc_id);
        const fromDetail = packedBoxIdsFromTransferCarton(detail);
        if (fromDetail.length > 0) return fromDetail;
      } catch (error: any) {
        console.warn(
          "⚠️ Could not load transfer carton packed boxes from backend:",
          error?.message || error
        );
      }
    }

    return loadPackedBoxIdsForTC(tc?.tc_id);
  };

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
    const latestBackendTCById = new Map<string, any>();
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
        backendTCs.forEach((tc) => {
          if (tc?.tc_id) latestBackendTCById.set(String(tc.tc_id), tc);
        });

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
    const allTCsWithBackend = allTCsFromDB.map((tc) => ({
      ...tc,
      ...(latestBackendTCById.get(String(tc.tc_id)) || {}),
    }));

    // Filter out completed/dispatched TCs - they should not be shown in Packing screen
    const existingTCs = allTCsWithBackend.filter(
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
        allTCsWithBackend.length - existingTCs.length
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
        storesMatch(tc.store, selectedStore)
    );

    // Check for sealed or dispatched TCs from original query (for UI state, but don't use them)
    // These are filtered out from existingTCs, so we need to check allTCsFromDB
    const sealedTC = allTCsWithBackend.find(
      (tc) =>
        tc.tc_id &&
        (tc.status === "Sealed" || tc.status === "SEALED") &&
        storesMatch(tc.store, selectedStore)
    );
    const dispatchedTC = allTCsWithBackend.find(
      (tc) =>
        tc.tc_id &&
        (tc.status === "Dispatched" || tc.status === "DISPATCHED") &&
        storesMatch(tc.store, selectedStore)
    );

    if (activeTCs.length > 0 && activeTCs[0].tc_id) {
      const openTC = activeTCs[0];
      console.log(`✅ Found Open Transfer Carton: ${openTC.tc_id}`);
      setTransferCarton(openTC.tc_id);
      setTransferCartonStatus(openTC.status || "Open");
      setPackedBoxes(await loadPackedBoxIdsForTransferCarton(openTC));
      setHasSealedTC(false);
    } else if (sealedTC?.tc_id) {
      console.log(`ℹ️ Auto-assigning sealed Transfer Carton: ${sealedTC.tc_id}`);
      setTransferCarton(sealedTC.tc_id);
      setTransferCartonStatus(sealedTC.status || "Sealed");
      setPackedBoxes(await loadPackedBoxIdsForTransferCarton(sealedTC));
      setHasSealedTC(true);
    } else if (dispatchedTC?.tc_id) {
      console.log(
        `ℹ️ Auto-assigning dispatched Transfer Carton: ${dispatchedTC.tc_id}`
      );
      setTransferCarton(dispatchedTC.tc_id);
      setTransferCartonStatus(dispatchedTC.status || "Dispatched");
      setPackedBoxes(await loadPackedBoxIdsForTransferCarton(dispatchedTC));
      setHasSealedTC(true);
    } else {
      console.log(
        `ℹ️ No Open Transfer Carton found for store ${selectedStore}`
      );
      setTransferCarton(null);
      setTransferCartonStatus(null);

      // Check if there are closed boxes that haven't been packed yet
      // Allow creating new TC if there are unpacked closed boxes, even if sealed/dispatched TC exists
      const db = await getDatabase();
      let hasUnpackedBoxes = false;

      if (db) {
        try {
          const settings = await getSettings();
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
          const settings = await getSettings();
          // On error, default to allowing creation if there are non-warehouse closed boxes
          const closedBoxes = await dataService.getBoxes(
            activeASN,
            selectedStore
          );
          const nonWarehouseBoxes = closedBoxes.filter((b) => {
            // Skip Putaway boxes - they belong in Put Away, not store packing.
            if (isPutawayBoxRow(b)) {
              return false;
            }
            // Check if warehouse (async, but in error case we'll be conservative)
            return (
              (b.status === "Closed" ||
                b.status === "CLOSED" ||
                b.status === "closed")
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
        // A store can have no Closed boxes because they were already packed.
        // Do not block access; the screen still needs to show the assigned TC and packed BOXes.
        loadTransferOrderStores();
        checkExistingTC();
        loadBoxes();
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
    const settings = await getSettings();
    if (settings.api_url && settings.demo_mode !== 1) {
      try {
        const backendResponse = await apiService.getBoxes({
          asn: activeASN,
          store: selectedStore,
          status: "Closed",
        });
        const backendBoxes = Array.isArray(backendResponse)
          ? backendResponse
          : Array.isArray(backendResponse?.data)
            ? backendResponse.data
            : Array.isArray(backendResponse?.data?.boxes)
              ? backendResponse.data.boxes
              : Array.isArray(backendResponse?.data?.items)
                ? backendResponse.data.items
            : Array.isArray(backendResponse?.items)
              ? backendResponse.items
              : Array.isArray(backendResponse?.boxes)
                ? backendResponse.boxes
                : [];

        for (const row of backendBoxes) {
          const boxId = String(row?.box_id || row?.name || "").trim();
          if (!boxId) continue;
          await dataService.saveBox({
            box_id: boxId,
            asn_no:
              row?.asn_no ||
              row?.advance_shipping_notice ||
              row?.asn ||
              activeASN,
            to_no: row?.to_no || row?.transfer_order || null,
            store: row?.store || selectedStore,
            status: row?.status || "Open",
            purpose: row?.purpose || "STORE",
            updated_on:
              row?.updated_on ||
              row?.modified ||
              row?.created_on ||
              new Date().toISOString(),
            created_by: row?.created_by || row?.owner || null,
          });
        }

        if (backendBoxes.length > 0) {
          console.log(
            `✅ PackingScreen: synced ${backendBoxes.length} backend BOX row(s) for ${selectedStore}`
          );
        }

        const apiAvailableBoxes: any[] = [];
        for (const row of backendBoxes) {
          const boxId = String(row?.box_id || row?.name || "").trim();
          if (!boxId || isPutawayBoxRow(row)) continue;
          const rowStore = String(row?.store || selectedStore).trim();
          if (!storesMatch(rowStore, selectedStore)) continue;
          if (await dataService.isWarehouse(rowStore)) continue;

          const status = String(row?.status || "").trim().toUpperCase();
          const hasEligibility = row?.pack_eligible !== undefined;
          const isEligible = hasEligibility
            ? row.pack_eligible === true
            : status === "CLOSED" && !row?.packed_tc_id;

          if (isEligible) {
            apiAvailableBoxes.push({
              ...row,
              box_id: boxId,
              store: rowStore,
              status: row?.status || "Closed",
            });
          }
        }

        console.log(
          `📦 PackingScreen: API-authoritative available closed BOXes: ${apiAvailableBoxes.length}`,
          apiAvailableBoxes.map((box) => ({
            box_id: box.box_id,
            status: box.status,
            packed_tc_id: box.packed_tc_id,
            pack_eligible: box.pack_eligible,
            pack_block_reason: box.pack_block_reason,
          }))
        );
        setBoxes(apiAvailableBoxes);
        return;
      } catch (error: any) {
        console.warn(
          "⚠️ PackingScreen: could not refresh backend boxes:",
          error?.message || error
        );
      }
    }

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

    // NEW WORKFLOW: Filter out warehouse/putaway boxes - they should go to Put Away, not Packing.
    const nonWarehouseBoxes: any[] = [];
    for (const box of closedBoxes) {
      if (isPutawayBoxRow(box)) {
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

    const userFilteredBoxes = storeFilteredBoxes;

    console.log(
      `📦 PackingScreen: After store filter: ${userFilteredBoxes.length} boxes are available for packing`
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

    const db = await getDatabase();
    const allTcIds = allTCs.map((tc) => tc.tc_id).filter(Boolean);
    let packedBoxIdsForStore = new Set<string>();
    if (allTcIds.length > 0) {
      const placeholders = allTcIds.map(() => "?").join(",");
      const packedRows = await db.getAllAsync<{ box_id: string }>(
        `SELECT DISTINCT box_id
         FROM event_queue
         WHERE event_type = 'PACK_BOX_TO_TC'
           AND tc_id IN (${placeholders})
           AND box_id IS NOT NULL
           AND box_id != ''`,
        allTcIds
      );
      packedBoxIdsForStore = new Set(
        packedRows.map((row) => row.box_id).filter(Boolean)
      );
    }

    const unpackedUserBoxes = userFilteredBoxes.filter(
      (box) => !packedBoxIdsForStore.has(box.box_id)
    );

    console.log(
      `📦 PackingScreen: Found ${completedTCs.length} completed TCs (Sealed/Dispatched) for ASN ${activeASN}, Store ${selectedStore}`
    );
    console.log(
      `📦 PackingScreen: ${unpackedUserBoxes.length} unpacked boxes available after excluding ${packedBoxIdsForStore.size} packed box(es)`
    );

    if (completedTCs.length > 0) {
      // Get all box_ids that are already packed into sealed or dispatched TCs
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
        const availableBoxes = unpackedUserBoxes.filter(
          (box) => !packedBoxIds.has(box.box_id)
        );

        console.log(
          `📦 Available boxes (excluding packed into TCs): ${availableBoxes.length} out of ${userFilteredBoxes.length} user/store-filtered closed boxes`
        );
        console.log(
          `📦 Available box IDs:`,
          availableBoxes.map((b) => b.box_id)
        );
        setBoxes(availableBoxes);
      } else {
        // No completed TC IDs found, show all store-filtered closed boxes
        console.log(
          `📦 No completed TC IDs found, showing all ${unpackedUserBoxes.length} unpacked user/store-filtered closed boxes`
        );
        setBoxes(unpackedUserBoxes);
      }
    } else {
      // No sealed or dispatched TCs, show all store-filtered closed boxes
      console.log(
        `📦 No sealed/dispatched TCs found, showing all ${unpackedUserBoxes.length} unpacked user/store-filtered closed boxes`
      );
      setBoxes(unpackedUserBoxes);
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

    try {
      const settings = await getSettings();
      if (settings.api_url && settings.demo_mode !== 1) {
        const backendResponse = await apiService.getTransferCartons({
          asn: activeASN,
          store: selectedStore,
        });
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

        for (const tc of backendTCs) {
          if (!tc?.tc_id) continue;
          await dataService.saveTransferCarton({
            tc_id: tc.tc_id,
            asn_no: tc.asn_no || tc.advance_shipping_notice || activeASN,
            to_no: tc.to_no || tc.transfer_order || null,
            store: tc.store || selectedStore,
            status: tc.status === "Created" ? "Open" : tc.status || "Open",
            updated_on: tc.updated_on || tc.updated_at || new Date().toISOString(),
          });
        }
      }
    } catch (error: any) {
      console.warn(
        "⚠️ Could not refresh Transfer Cartons before create:",
        error?.message || error
      );
    }

    // ✅ STRICT VALIDATION: one Transfer Carton per store/showroom.
    const allTCsFromDB = await dataService.getTransferCartons(
      activeASN,
      selectedStore
    );

    // Filter TCs for the selected store
    const storeTCs = allTCsFromDB.filter((tc) =>
      storesMatch(tc.store, selectedStore)
    );

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
      setTransferCarton(existingTC.tc_id);
      setTransferCartonStatus(existingTC.status || "Open");
      setPackedBoxes(await loadPackedBoxIdsForTransferCarton(existingTC));
      setHasSealedTC(false);
      Alert.alert(
        "Using Existing Transfer Carton",
        `Transfer Carton ${existingTC.tc_id} already exists for ${selectedStore}.\n\nAll BOXes for this store will be packed into this same Transfer Carton.`,
        [{ text: "OK" }]
      );
      return;
    }

    // ✅ PREVENT DUPLICATE: If there's a Sealed TC (not dispatched), prevent creating a new one
    // Only allow new TC if all existing TCs are Dispatched
    if (sealedTCs.length > 0 && dispatchedTCs.length === 0) {
      const sealedTC = sealedTCs[0];
      setTransferCarton(sealedTC.tc_id);
      setTransferCartonStatus(sealedTC.status || "Sealed");
      setPackedBoxes(await loadPackedBoxIdsForTransferCarton(sealedTC));
      setHasSealedTC(true);
      Alert.alert(
        "Using Existing Transfer Carton",
        `Transfer Carton ${sealedTC.tc_id} already exists for ${selectedStore} and is sealed.\n\nPlease continue to Dispatch. A new Transfer Carton is not required.`,
        [{ text: "OK" }]
      );
      return;
    }

    if (dispatchedTCs.length > 0 && sealedTCs.length === 0) {
      const dispatchedTC = dispatchedTCs[0];
      setTransferCarton(dispatchedTC.tc_id);
      setTransferCartonStatus(dispatchedTC.status || "Dispatched");
      setPackedBoxes(await loadPackedBoxIdsForTransferCarton(dispatchedTC));
      setHasSealedTC(true);
      Alert.alert(
        "Transfer Carton Already Dispatched",
        `Transfer Carton ${dispatchedTC.tc_id} already exists for ${selectedStore} and has been dispatched.\n\nOnly one Transfer Carton is allowed per store.`,
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

    // Filter out warehouse/putaway boxes - they should go to Put Away, not Packing.
    const nonWarehouseClosedBoxes: any[] = [];
    for (const box of closedBoxesFiltered) {
      if (isPutawayBoxRow(box)) {
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
      const finalStatus = "Open";
      
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
      setTransferCartonStatus(finalStatus);
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
    const tcStatus = String(transferCartonStatus || "").trim().toLowerCase();
    if (tcStatus === "sealed" || tcStatus === "dispatched") {
      Alert.alert(
        tcStatus === "sealed"
          ? "Transfer Carton Sealed"
          : "Transfer Carton Dispatched",
        `Transfer Carton ${transferCarton} is already ${transferCartonStatus}.\n\nYou cannot pack more BOXes into it. Please continue to Dispatch.`
      );
      return;
    }

    const boxId = barcode.trim().toUpperCase();

    if (isPutawayBoxId(boxId)) {
      Alert.alert(
        "Use Put Away",
        `BOX ${boxId} is a Putaway box and cannot be packed into a store Transfer Carton.\n\nPlease continue this box from the Put Away screen.`
      );
      return;
    }

    // Check if already packed
    if (packedBoxes.includes(boxId)) {
      Alert.alert("Info", "BOX already packed");
      return;
    }

    setLoading(true);
    try {
      const settings = await getSettings();
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

      if (isPutawayBoxRow(box)) {
        Alert.alert(
          "Use Put Away",
          `BOX ${boxId} is a Putaway box and cannot be packed into a store Transfer Carton.\n\nPlease continue this box from the Put Away screen.`
        );
        setLoading(false);
        return;
      }

      // Check if box is closed (required for packing)
      if ((box as any).pack_eligible === false) {
        Alert.alert(
          "BOX Not Available",
          (box as any).pack_block_reason ||
            `BOX ${boxId} is not eligible for packing.`
        );
        setLoading(false);
        return;
      }

      if (String(box.status || "").trim().toLowerCase() === "packed") {
        Alert.alert(
          "Already Packed",
          `BOX ${boxId} is already packed into a Transfer Carton.`
        );
        setLoading(false);
        return;
      }

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

      try {
        const syncResult = await syncEvents();
        if (syncResult.failed > 0) {
          console.warn(
            `⚠️ ${syncResult.failed} event(s) failed to sync before packing BOX ${boxId}`
          );
        }

        const syncAsn = activeASN || settings.active_asn;
        const syncSession = activeSession || settings.active_session;
        if (syncAsn && syncSession) {
          await resendReceiveLinesToBackend(syncAsn, syncSession);

          const db = await getDatabase();
          const cartonRows = await db.getAllAsync<{ carton_id: string }>(
            `SELECT DISTINCT carton_id
             FROM scanned_items
             WHERE UPPER(TRIM(box_id)) = UPPER(TRIM(?))
               AND carton_id IS NOT NULL
               AND TRIM(carton_id) != ''`,
            [boxId]
          );
          const cartonIds = new Set(
            cartonRows
              .map((row) => String(row.carton_id || "").trim().toUpperCase())
              .filter(Boolean)
          );

          try {
            const backendBoxItems = await apiService.getBoxItems(boxId, {
              asn: syncAsn,
              store: selectedStore || undefined,
            });
            extractCartonIds(backendBoxItems).forEach((cartonId) =>
              cartonIds.add(cartonId)
            );
          } catch (boxItemsError: any) {
            console.warn(
              `⚠️ Could not load backend BOX contents for ${boxId} before packing:`,
              boxItemsError?.message || boxItemsError
            );
          }

          for (const cartonId of cartonIds) {
            if (!cartonId) continue;
            try {
              await apiService.completeCarton({
                inbound_session: syncSession,
                asn_no: normalizeASN(syncAsn),
                carton_id: cartonId,
                user_id: settings.user_id || settings.user_code || "",
                device_id: settings.device_id || "",
              });
            } catch (completeError: any) {
              const msg = String(completeError?.message || completeError || "");
              if (
                !msg.toLowerCase().includes("already") &&
                !msg.toLowerCase().includes("received") &&
                !msg.toLowerCase().includes("completed")
              ) {
                throw completeError;
              }
            }
          }
        } else {
          throw new Error(
            "No active inbound session is available to sync receive lines."
          );
        }
      } catch (syncError: any) {
        Alert.alert(
          "Sync Required",
          `Could not sync receiving data before packing BOX ${boxId}.\n\n${
            syncError?.message || "Please sync and try again."
          }`
        );
        setLoading(false);
        return;
      }

      const packResponse = await apiService.packBoxIntoTransferCarton(
        transferCarton,
        {
          asn_no: activeASN || "",
          box_id: boxId,
          store: selectedStore,
          user_id: settings.user_id || settings.user_code || undefined,
          device_id: settings.device_id || undefined,
        }
      );
      const packedQty =
        Number(packResponse?.packed_qty ?? packResponse?.data?.packed_qty ?? 0) || 0;
      const serverPackedBoxes =
        packResponse?.packed_boxes || packResponse?.data?.packed_boxes;

      await dataService.updateBoxStatus(boxId, "Packed");
      setPackedBoxes((prev) =>
        Array.isArray(serverPackedBoxes)
          ? Array.from(new Set([...prev, ...serverPackedBoxes]))
          : prev.includes(boxId)
            ? prev
            : [...prev, boxId]
      );
      setBoxes((prev) => prev.filter((box) => box.box_id !== boxId));

      // Refresh the boxes list to update UI
      await loadBoxes();

      Alert.alert(
        "Success",
        `BOX ${boxId} packed to ${transferCarton}${
          packedQty > 0 ? `\n\nPacked qty: ${packedQty}` : ""
        }`
      );
    } catch (error: any) {
      Alert.alert(
        "Packing Blocked",
        cartonStockErrorMessage(error) || error.message || "Failed to pack BOX"
      );
    } finally {
      setLoading(false);
    }
  };

  handleBoxScanRef.current = handleBoxScan;

  const handleClosedBoxIdDoubleTap = useCallback((boxId: string) => {
    if (loading || isSealing || isReopening) return;
    const now = Date.now();
    const WINDOW_MS = 350;
    const prev = closedBoxDoubleTapRef.current;
    if (prev.boxId === boxId && now - prev.t < WINDOW_MS) {
      closedBoxDoubleTapRef.current = { boxId: "", t: 0 };
      void handleBoxScanRef.current(boxId);
      return;
    }
    closedBoxDoubleTapRef.current = { boxId, t: now };
  }, [loading, isSealing, isReopening]);

  const handleReopenTransferCarton = async () => {
    if (!transferCarton) return;
    if (isReopening || loading) return;

    const tcStatus = String(transferCartonStatus || "").trim().toLowerCase();
    if (tcStatus !== "sealed") {
      Alert.alert(
        "Cannot Reopen",
        "Only sealed Transfer Cartons can be reopened from mobile."
      );
      return;
    }

    Alert.alert(
      "Reopen Transfer Carton",
      `Reopen ${transferCarton} so more BOXes can be packed?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reopen",
          onPress: async () => {
            setIsReopening(true);
            setLoading(true);
            try {
              const settings = await getSettings();
              const response = await apiService.reopenTransferCarton({
                tc_id: transferCarton,
                reopened_by:
                  settings.user_id || settings.user_code || undefined,
                reason: "Need to add more boxes",
              });
              const reopenedStatus =
                response?.data?.status || response?.status || "Open";

              await dataService.updateTransferCartonStatus(
                transferCarton,
                reopenedStatus
              );
              setTransferCartonStatus(reopenedStatus);
              setHasSealedTC(false);
              await loadBoxes();

              Alert.alert(
                "Transfer Carton Reopened",
                `Transfer Carton ${transferCarton} is now ${reopenedStatus}. You can pack more BOXes.`
              );
            } catch (error: any) {
              Alert.alert(
                "Reopen Failed",
                error?.message || "Failed to reopen Transfer Carton"
              );
            } finally {
              setLoading(false);
              setIsReopening(false);
            }
          },
        },
      ]
    );
  };

  const handleSeal = async () => {
    if (!transferCarton) return;

    if (packedBoxes.length === 0) {
      Alert.alert(
        "No BOXes Packed",
        "Please pack at least one closed BOX into this Transfer Carton before sealing."
      );
      return;
    }

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
                setTransferCartonStatus(null);
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

      try {
        const syncResult = await syncEvents();
        if (syncResult.failed > 0) {
          console.warn(
            `⚠️ ${syncResult.failed} event(s) failed to sync before sealing TC ${transferCarton}`
          );
        }
      } catch (syncError: any) {
        console.warn(
          "⚠️ Could not sync pending pack events before sealing:",
          syncError?.message || syncError
        );
      }

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
                setTransferCartonStatus(null);
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
              setTransferCartonStatus(null);
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
        const toResponse = await apiService.getLiveTransferOrderByASN(activeASN, {
          include_completed: true,
        });
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
              let masterRows: { code: string }[] = [];
              try {
                masterRows = await dataService.getWarehouseStoreMasterRows();
              } catch {
                masterRows = [];
              }
              for (const allocation of allocations) {
                const rawStore = storeFieldFromAllocationRow(allocation);
                const lineItem = itemCodeFromAllocationRow(allocation);
                if (rawStore && lineItem) {
                  const resolved = canonicalStoreForToLine(
                    rawStore,
                    masterRows
                  );
                  await db.runAsync(
                    `INSERT OR REPLACE INTO transfer_order_cache 
                     (to_no, asn_no, store, item_code, allocated_qty) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [
                      toNo,
                      activeASN,
                      resolved.storeToPersist || rawStore,
                      lineItem,
                      allocation.allocated_qty ||
                        allocation.to_qty ||
                        allocation.qty ||
                        0,
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
  const transferCartonStatusKey = String(transferCartonStatus || "")
    .trim()
    .toLowerCase();
  const transferCartonSealed = transferCartonStatusKey === "sealed";
  const transferCartonClosedForPacking =
    transferCartonSealed || transferCartonStatusKey === "dispatched";

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
                  setTransferCartonStatus(null);
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
              {transferCartonStatus ? (
                <Text style={styles.tcText}>Status: {transferCartonStatus}</Text>
              ) : null}
            </View>

            {transferCartonClosedForPacking ? (
              <View style={styles.section}>
                <Text style={styles.disabledHint}>
                  This Transfer Carton is already {transferCartonStatus}. Use
                  {transferCartonSealed
                    ? boxes.length > 0
                      ? " Reopen if you need to add the available BOXes below, or use Next to continue to Dispatch."
                      : " Next to continue to Dispatch."
                    : " Next to continue to Dispatch."}
                </Text>
                {transferCartonSealed && boxes.length > 0 ? (
                  <TouchableOpacity
                    style={[
                      styles.button,
                      styles.reopenButton,
                      (loading || isReopening) && styles.buttonDisabled,
                    ]}
                    onPress={handleReopenTransferCarton}
                    disabled={loading || isReopening}
                  >
                    <Text style={styles.buttonText}>
                      {isReopening
                        ? "Reopening..."
                        : "Reopen Transfer Carton"}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Scan BOX to Pack</Text>
                <BarcodeScanner
                  onScan={handleBoxScan}
                  placeholder="Scan BOX barcode"
                  title="BOX Barcode"
                />
              </View>
            )}

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
                      <StatusBadge status="Packed" color="#4CAF50" />
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
                (loading || isSealing || transferCartonClosedForPacking) &&
                  styles.buttonDisabled,
              ]}
              onPress={handleSeal}
              disabled={loading || isSealing || transferCartonClosedForPacking}
            >
              <Text style={styles.buttonText}>
                {loading || isSealing
                  ? "Sealing..."
                  : transferCartonClosedForPacking
                  ? `Transfer Carton ${transferCartonStatus}`
                  : "Seal Transfer Carton"}
              </Text>
            </TouchableOpacity>
          </>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Available Closed BOXes</Text>
          {boxes.length > 0 ? (
            <Text style={styles.closedBoxesHint}>
              {transferCartonClosedForPacking
                ? `Reopen the ${transferCartonStatus} Transfer Carton before packing these BOXes.`
                : "Double-tap a BOX ID to pack without scanning (after a Transfer Carton is created)."}
            </Text>
          ) : null}
          {boxes.length === 0 ? (
            <Text style={styles.emptyText}>No closed BOXes available</Text>
          ) : (
            <FlatList
              data={boxes}
              keyExtractor={(item) => item.box_id}
              renderItem={({ item }) => (
                <View style={styles.boxItem}>
                  <TouchableOpacity
                    activeOpacity={0.6}
                    onPress={() => handleClosedBoxIdDoubleTap(item.box_id)}
                    disabled={transferCartonClosedForPacking}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  >
                    <Text
                      style={[
                        styles.boxId,
                        transferCartonClosedForPacking && styles.boxIdDisabled,
                      ]}
                    >
                      {item.box_id}
                    </Text>
                  </TouchableOpacity>
                  <StatusBadge status={item.status} />
                </View>
              )}
              scrollEnabled={false}
            />
          )}
        </View>

        <TouchableOpacity
          style={styles.nextButton}
          onPress={() => {
            Alert.alert(
              "Packing Complete",
              "Packing is complete for this operator. Dispatch can be handled separately from the Dispatch screen.",
              [
                {
                  text: "OK",
                  onPress: () => navigation.navigate("Home" as never),
                },
              ]
            );
          }}
        >
          <Text style={styles.nextButtonText}>Complete</Text>
          <Text style={styles.nextButtonSubtext}>Dispatch separately</Text>
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
  reopenButton: {
    backgroundColor: "#2196F3",
    marginTop: 12,
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
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
  boxIdDisabled: {
    color: "#777",
  },
  closedBoxesHint: {
    fontSize: 12,
    color: "#666",
    marginBottom: 12,
    lineHeight: 18,
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
