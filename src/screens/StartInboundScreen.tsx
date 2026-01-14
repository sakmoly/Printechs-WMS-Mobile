import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
  FlatList,
  Modal,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useNavigation,
  useFocusEffect,
  useRoute,
} from "@react-navigation/native";
import { useApp } from "../context/AppContext";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { apiService } from "../services/api.service";
import { getSettings, saveSettings } from "../services/settings.service";
import { getDatabase } from "../database/database";
import { dataService } from "../services/data.service";
import { normalizeASN } from "../utils/asn";
import { ProgressIndicator } from "../components/ProgressIndicator";

export default function StartInboundScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { setActiveASN, setActiveSession, activeASN } = useApp();
  const insets = useSafeAreaInsets();
  const [sourceType, setSourceType] = useState<"ASN" | "TransferIn">("ASN");
  const [asnNo, setAsnNo] = useState("");
  const [selectedTransferIn, setSelectedTransferIn] = useState<string | null>(
    null
  );
  const [transferIns, setTransferIns] = useState<any[]>([]);
  const [loadingTransferIns, setLoadingTransferIns] = useState(false);
  const [dock, setDock] = useState("DOCK-01");
  const [transferOrder, setTransferOrder] = useState("");
  const [transferOrders, setTransferOrders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingTO, setLoadingTO] = useState(false);
  const [sessionId, setSessionId] = useState<string>("");
  const [existingSessions, setExistingSessions] = useState<
    Array<{
      inbound_session: string;
      status: string;
      started_on: string | null;
      completed_cartons: number;
      total_cartons: number;
      updated_on: string;
    }>
  >([]);
  const [showSessionList, setShowSessionList] = useState(false);
  const [allCartonsCompleted, setAllCartonsCompleted] = useState(false);

  // Check if Transfer In was passed from navigation
  useEffect(() => {
    const params = (route.params as any) || {};
    if (params.transferIn && params.sourceType === "TransferIn") {
      setSourceType("TransferIn");
      setSelectedTransferIn(params.transferIn);
    }
  }, [route.params]);

  // Load Transfer Ins when source type is Transfer In
  const loadTransferIns = async () => {
    if (sourceType !== "TransferIn") return;

    setLoadingTransferIns(true);
    try {
      const response = await apiService.getTransferIns();
      let transferInsList: any[] = [];
      if (Array.isArray(response)) {
        transferInsList = response;
      } else if (response && typeof response === "object") {
        if (Array.isArray(response.data)) {
          transferInsList = response.data;
        } else if (Array.isArray(response.items)) {
          transferInsList = response.items;
        } else if (Array.isArray(response.transfer_ins)) {
          transferInsList = response.transfer_ins;
        }
      }
      // Filter only Active Transfer Ins
      const activeTransferIns = transferInsList.filter(
        (ti) => ti.status === "Submitted" || ti.status === "In Transit"
      );
      setTransferIns(activeTransferIns);
      console.log(
        `✅ Loaded ${activeTransferIns.length} Active Transfer In(s)`
      );
    } catch (error: any) {
      console.error("❌ Error loading Transfer Ins:", error);

      // Check if it's a database table error
      const errorMessageStr = error.message || "";
      const isDatabaseError =
        errorMessageStr.includes("doesn't exist") ||
        errorMessageStr.includes("DATABASE_ERROR") ||
        errorMessageStr.includes("Table");

      if (isDatabaseError) {
        console.warn(
          "⚠️ Backend database table 'tabtransferin' doesn't exist. " +
            "Please ensure the backend database schema is set up correctly."
        );
      }

      setTransferIns([]);
    } finally {
      setLoadingTransferIns(false);
    }
  };

  useEffect(() => {
    if (sourceType === "TransferIn") {
      loadTransferIns();
    } else {
      setTransferIns([]);
      setSelectedTransferIn(null);
    }
  }, [sourceType]);

  // Reset allCartonsCompleted when ASN changes
  useEffect(() => {
    if (sourceType === "ASN") {
      setAllCartonsCompleted(false);
    }
  }, [asnNo, sourceType]);

  // Update session ID when ASN or Transfer In changes
  useEffect(() => {
    const updateSessionId = async () => {
      try {
        const settings = await getSettings();
        const userId = settings.user_id || "USER-AUTO";
        const deviceId = settings.device_id || "DEV-AUTO";

        if (sourceType === "ASN" && asnNo.trim()) {
          const normalizedASN = normalizeASN(asnNo);
          const generatedId = dataService.generateSessionId(
            normalizedASN,
            deviceId,
            userId
          );
          setSessionId(generatedId);
        } else if (sourceType === "TransferIn" && selectedTransferIn) {
          // Generate session ID for Transfer In
          const generatedId = dataService.generateSessionId(
            selectedTransferIn,
            deviceId,
            userId
          );
          setSessionId(generatedId);
        } else {
          setSessionId("");
        }
      } catch (error) {
        console.error("Error generating session ID:", error);
      }
    };
    updateSessionId();
  }, [asnNo, selectedTransferIn, sourceType]);

  const handleASNScan = async (barcode: string) => {
    const scannedASN = barcode.trim().toUpperCase();
    console.log(`📱 ASN scanned: ${scannedASN}`);

    if (!scannedASN) {
      return;
    }

    // STEP 1: Validate ASN - Check locally first
    console.log(`🔍 Validating ASN ${scannedASN}...`);
    let asnValid = false;

    try {
      // Check if ASN exists locally (in asn_cache or asn_carton_map)
      const db = await getDatabase();
      if (db) {
        // Check asn_cache first
        const asnInCache = await db.getFirstAsync<{ asn_no: string }>(
          `SELECT asn_no FROM asn_cache WHERE asn_no = ? OR asn_no_original = ?`,
          [scannedASN, scannedASN]
        );

        if (asnInCache) {
          console.log(`✅ ASN ${scannedASN} found in local cache`);
          asnValid = true;
        } else {
          // Check asn_carton_map
          const normalizedASN = normalizeASN(scannedASN);
          const cartonsInMap = await db.getFirstAsync<{ carton_id: string }>(
            `SELECT DISTINCT carton_id FROM asn_carton_map WHERE asn_no = ? OR asn_no = ? LIMIT 1`,
            [scannedASN, normalizedASN]
          );

          if (cartonsInMap) {
            console.log(`✅ ASN ${scannedASN} found in local asn_carton_map`);
            asnValid = true;
          }
        }
      }
    } catch (localError: any) {
      console.warn(`⚠️ Error checking local ASN:`, localError.message);
    }

    // STEP 2: If not found locally, check backend
    if (!asnValid) {
      console.log(`🔍 ASN ${scannedASN} not found locally, checking backend...`);
      try {
        const settings = await getSettings();
        if (settings.api_url && settings.demo_mode !== 1) {
          const asnDetails = await apiService.getASN(scannedASN);
          
          if (asnDetails && (asnDetails.asn_no || asnDetails.advance_shipping_notice || asnDetails.details || asnDetails.cartons)) {
            console.log(`✅ ASN ${scannedASN} validated from backend`);
            asnValid = true;
          } else {
            console.log(`❌ ASN ${scannedASN} not found in backend`);
          }
        } else {
          // Demo mode or no API URL - skip backend validation
          console.log(`ℹ️ Demo mode or no API URL - skipping backend validation`);
        }
      } catch (backendError: any) {
        const errorMessage = backendError.message || "";
        const errorCode = backendError.code || "";
        const is404 = 
          errorMessage.includes("404") || 
          errorMessage.includes("not found") ||
          errorCode === "NOT_FOUND";
        
        if (is404) {
          console.log(`❌ ASN ${scannedASN} not found in backend (404/NOT_FOUND)`);
        } else {
          console.error(`❌ Error validating ASN from backend:`, backendError.message);
          // For non-404 errors, we might want to allow proceeding (network issues, etc.)
          // But for now, we'll treat it as invalid
        }
      }
    }

    // STEP 3: If ASN is invalid, show error and don't proceed
    if (!asnValid) {
      Alert.alert(
        "ASN Wrong",
        `ASN ${scannedASN} was not found.\n\nPlease check the ASN number and try again.`,
        [{ text: "OK" }]
      );
      setAsnNo(""); // Clear the ASN input
      return;
    }

    // STEP 4: ASN is valid - proceed with normal flow
    console.log(`✅ ASN ${scannedASN} is valid, proceeding...`);

    // Preserve the original scanned format for display
    setAsnNo(scannedASN);

    // Immediately update activeASN in context to prevent useFocusEffect from restoring old ASN
    // This ensures the newly scanned ASN takes priority
    console.log(`📱 Updating activeASN in context to: ${scannedASN}`);
    setActiveASN(scannedASN);

    // Use scanned ASN format directly (no normalization)
    // Backend expects exact format from database (e.g., ASN-0001, ASN-0002)
    await loadTransferOrders(scannedASN);
    // For session lookup, still normalize for backward compatibility with existing sessions
    const normalizedASN = normalizeASN(scannedASN);
    await checkExistingSessions(normalizedASN);
  };

  const handleTransferInScan = async (barcode: string) => {
    const scannedTransferIn = barcode.trim();
    console.log(`📱 Transfer In scanned: ${scannedTransferIn}`);

    // Validate that the scanned Transfer In exists in the list
    const transferIn = transferIns.find((ti) => ti.title === scannedTransferIn);

    if (transferIn) {
      setSelectedTransferIn(scannedTransferIn);
      console.log(`✅ Transfer In ${scannedTransferIn} selected`);
    } else {
      // Try to fetch the Transfer In from backend to validate
      try {
        const response = await apiService.getTransferIn(scannedTransferIn);
        if (response && (response.title || response.transfer_in_title)) {
          const fetchedTransferIn =
            response.title || response.transfer_in_title;
          setSelectedTransferIn(fetchedTransferIn);
          console.log(
            `✅ Transfer In ${fetchedTransferIn} validated and selected`
          );

          // Reload Transfer Ins list to include this one
          await loadTransferIns();
        } else {
          Alert.alert(
            "Transfer In Not Found",
            `Transfer In "${scannedTransferIn}" was not found. Please check the barcode and try again.`
          );
        }
      } catch (error: any) {
        console.error("❌ Error validating Transfer In:", error);
        Alert.alert(
          "Error",
          `Failed to validate Transfer In "${scannedTransferIn}": ${
            error.message || "Unknown error"
          }`
        );
      }
    }
  };

  // Check for existing sessions when ASN is set
  const checkExistingSessions = async (asn: string) => {
    try {
      const settings = await getSettings();
      const userId = settings.user_id || "USER-AUTO";
      const deviceId = settings.device_id || "DEV-AUTO";

      // First, check local database - try both with and without device/user filters
      // This ensures we show all sessions for the ASN, not just for current device/user
      const localSessionsByCombination =
        await dataService.getSessionsByCombination(asn, deviceId, userId);

      // Also get all sessions for this ASN (regardless of device/user)
      // This helps when user navigates back and wants to see all sessions
      let localSessionsAll: any[] = [];
      try {
        const db = await getDatabase();
        const normalizedASN = normalizeASN(asn);
        localSessionsAll = await db.getAllAsync<any>(
          "SELECT * FROM inbound_sessions WHERE asn_no = ? ORDER BY updated_on DESC",
          [normalizedASN]
        );
        console.log(
          `📋 Found ${localSessionsAll.length} total session(s) in DB for ASN ${normalizedASN}`
        );
      } catch (dbError: any) {
        console.warn(
          `⚠️ Error querying all sessions for ASN:`,
          dbError.message
        );
      }

      // Merge both results, deduplicate by inbound_session
      const sessionMap = new Map<string, any>();
      for (const session of localSessionsByCombination) {
        sessionMap.set(session.inbound_session, session);
      }
      for (const session of localSessionsAll) {
        if (!sessionMap.has(session.inbound_session)) {
          sessionMap.set(session.inbound_session, session);
        }
      }
      const localSessions = Array.from(sessionMap.values());

      console.log(
        `📋 Merged sessions: ${localSessions.length} total (${localSessionsByCombination.length} by combination, ${localSessionsAll.length} by ASN only)`
      );

      // Also try to fetch from backend API (if available and not in demo mode)
      let backendSessions: any[] = [];
      if (settings.api_url && settings.demo_mode !== 1) {
        try {
          console.log(`🌐 Fetching sessions from backend for ASN: ${asn}`);
          const backendResponse = await apiService.getInboundSessions();

          // Handle different response formats
          if (Array.isArray(backendResponse)) {
            backendSessions = backendResponse;
          } else if (
            backendResponse?.data &&
            Array.isArray(backendResponse.data)
          ) {
            backendSessions = backendResponse.data;
          } else if (
            backendResponse?.sessions &&
            Array.isArray(backendResponse.sessions)
          ) {
            backendSessions = backendResponse.sessions;
          }

          // Filter sessions for this ASN (normalize for comparison)
          const normalizedASN = normalizeASN(asn);
          backendSessions = backendSessions.filter((s: any) => {
            const sessionASN = normalizeASN(
              s.asn_no || s.advance_shipping_notice || ""
            );
            return sessionASN === normalizedASN;
          });

          console.log(
            `📋 Found ${backendSessions.length} session(s) from backend for ASN ${asn}`
          );
        } catch (backendError: any) {
          // Backend API might not be available or might return 404 - that's OK
          console.log(
            `ℹ️ Could not fetch sessions from backend: ${backendError.message}`
          );
        }
      }

      // Merge local and backend sessions (deduplicate by inbound_session)
      // Map local sessions to match existingSessions type (subset of fields)
      const allSessions: Array<{
        inbound_session: string;
        status: string;
        started_on: string | null;
        completed_cartons: number;
        total_cartons: number;
        updated_on: string;
      }> = localSessions.map((s: any) => ({
        inbound_session: s.inbound_session,
        status: s.status,
        started_on: s.started_on,
        completed_cartons: s.completed_cartons,
        total_cartons: s.total_cartons,
        updated_on: s.updated_on,
      }));

      const localSessionIds = new Set(
        localSessions.map((s: any) => s.inbound_session)
      );

      for (const backendSession of backendSessions) {
        if (!localSessionIds.has(backendSession.inbound_session)) {
          // Convert backend format to local format (matching existingSessions type)
          allSessions.push({
            inbound_session: backendSession.inbound_session || "",
            status: backendSession.status || "Active",
            started_on:
              backendSession.started_on || backendSession.started_at || null,
            completed_cartons: backendSession.completed_cartons || 0,
            total_cartons: backendSession.total_cartons || 0,
            updated_on:
              backendSession.updated_on ||
              backendSession.updated_at ||
              new Date().toISOString(),
          });
        }
      }

      if (allSessions.length > 0) {
        setExistingSessions(allSessions);
        console.log(
          `✅ Found ${allSessions.length} existing session(s) for ASN ${asn} (${localSessions.length} local, ${backendSessions.length} from backend)`
        );
        console.log(
          `📋 Sessions list updated - existingSessions.length: ${allSessions.length}`
        );
        
        // Check if all cartons are completed across all sessions
        const hasAllCartonsCompleted = allSessions.some(
          (session) =>
            session.total_cartons > 0 &&
            session.completed_cartons >= session.total_cartons
        );
        setAllCartonsCompleted(hasAllCartonsCompleted);
        
        if (hasAllCartonsCompleted) {
          console.log(
            `✅ All cartons completed for ASN ${asn} - disabling new session creation`
          );
        }
      } else {
        setExistingSessions([]);
        setAllCartonsCompleted(false);
        console.log(
          `ℹ️ No sessions found for ASN ${asn} - existingSessions cleared`
        );
      }
    } catch (error: any) {
      console.error("Error checking existing sessions:", error);
      setExistingSessions([]);
    }
  };

  const loadTransferOrders = async (asn: string) => {
    setLoadingTO(true);
    try {
      const settings = await getSettings();

      // Use demo data if:
      // 1. Demo mode is explicitly enabled (demo_mode === 1)
      // 2. No API URL is configured (auto-fallback to demo mode)
      const useDemoData = settings.demo_mode === 1 || !settings.api_url;

      if (useDemoData) {
        // Use demo transfer order
        setTransferOrder("TO-00012");
        setTransferOrders(["TO-00012"]);

        // Check if allocations already exist (from seeder) - don't override them
        const normalizedASN = normalizeASN(asn);
        const existingAllocations =
          await dataService.getTransferOrderAllocations(normalizedASN);

        // Only create allocations if they don't exist
        if (existingAllocations.length === 0) {
          // Cache demo transfer order allocations
          // Different items and quantities per store to show variety
          const db = await getDatabase();

          // Different items and quantities per store for variety
          const demoAllocations = [
            { store: "SR-01", item_code: "ITEM-0001", allocated_qty: 2 },
            { store: "SR-01", item_code: "ITEM-0002", allocated_qty: 1 },
            { store: "SR-01", item_code: "ITEM-0004", allocated_qty: 1 },
            { store: "SR-02", item_code: "ITEM-0001", allocated_qty: 1 },
            { store: "SR-02", item_code: "ITEM-0003", allocated_qty: 2 },
            { store: "SR-02", item_code: "ITEM-0006", allocated_qty: 1 },
            { store: "SR-03", item_code: "ITEM-0002", allocated_qty: 2 },
            { store: "SR-03", item_code: "ITEM-0004", allocated_qty: 1 },
            { store: "SR-03", item_code: "ITEM-0005", allocated_qty: 1 },
          ];

          for (const alloc of demoAllocations) {
            await db.runAsync(
              "INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES (?, ?, ?, ?, ?)",
              [
                "TO-00012",
                normalizedASN,
                alloc.store,
                alloc.item_code,
                alloc.allocated_qty,
              ]
            );
          }
        }
      } else {
        // Try to fetch from API (only if API URL is configured)
        // Use ASN format directly (no normalization) - backend expects exact format from database
        // ASN is already in the format from backend (e.g., ASN-0001, ASN-0002)
        const asnToQuery = asn; // Use ASN format as-is (preserving exact format from backend)
        console.log(
          `📋 Using ASN format "${asnToQuery}" for API call (preserving exact format)`
        );

        try {
          const toData = await apiService.getTransferOrderByASN(asnToQuery);
          if (toData && toData.to_no) {
            setTransferOrder(toData.to_no);
            setTransferOrders([toData.to_no]);

            // Cache transfer order allocations
            if (toData.allocations) {
              const db = await getDatabase();
              for (const alloc of toData.allocations) {
                await db.runAsync(
                  "INSERT OR REPLACE INTO transfer_order_cache (to_no, asn_no, store, item_code, allocated_qty) VALUES (?, ?, ?, ?, ?)",
                  [
                    toData.to_no,
                    asn,
                    alloc.store,
                    alloc.item_code,
                    alloc.allocated_qty,
                  ]
                );
              }
            }
          } else {
            // No transfer order found - this is OK, user can still proceed
            console.log(
              `ℹ️ No transfer order found for ASN ${asnToQuery}. User can still proceed without transfer order.`
            );
            setTransferOrder("");
            setTransferOrders([]);
          }
        } catch (apiError: any) {
          // If API call fails (404 = no transfer order), that's OK
          // User can still proceed without transfer order
          if (
            apiError.message?.includes("404") ||
            apiError.message?.includes("ASN_NOT_FOUND") ||
            apiError.message?.includes("TRANSFER_ORDER_NOT_FOUND")
          ) {
            console.log(
              `ℹ️ No transfer order found for ASN ${asnToQuery} (this is OK - user can proceed without transfer order)`
            );
            setTransferOrder("");
            setTransferOrders([]);
          } else {
            // For other errors (network, 500, etc.), show warning but still allow proceeding
            console.warn(
              "⚠️ Failed to fetch transfer order (non-404 error):",
              apiError.message
            );
            setTransferOrder("");
            setTransferOrders([]);
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
          `ℹ️ StartInboundScreen: No transfer order found for ASN (this is OK - ASN can be received without Transfer Order)`
        );
      } else {
        // Other errors (network, 500, etc.) - log as warning
        console.warn("⚠️ StartInboundScreen: Failed to load transfer orders:", errorMessage);
      }
      // Don't fall back to demo data - allow proceeding without transfer order
      setTransferOrder("");
      setTransferOrders([]);
    } finally {
      setLoadingTO(false);
    }
  };

  // Restore ASN and reload sessions when screen is focused (user navigates back)
  useFocusEffect(
    React.useCallback(() => {
      const restoreASNAndSessions = async () => {
        console.log(
          `🔄 useFocusEffect triggered - activeASN: ${activeASN}, asnNo: ${asnNo}`
        );

        let asnToUse: string | null = null;

        // Priority 1: Check if we have asnNo in state (most recent user input)
        // This takes priority to prevent overwriting a newly scanned ASN
        if (asnNo && asnNo.trim()) {
          asnToUse = asnNo;
          console.log(`🔄 Using ASN from state (priority): ${asnToUse}`);
        }
        // Priority 2: If there's an active ASN from context, use it
        else if (activeASN && activeASN.trim()) {
          asnToUse = activeASN;
          console.log(`🔄 Using ASN from context: ${asnToUse}`);
        }
        // Priority 3: Try to get ASN from settings
        else {
          try {
            const settings = await getSettings();
            const settingsASN = settings.active_asn;
            if (settingsASN && settingsASN.trim()) {
              asnToUse = settingsASN;
              console.log(`🔄 Using ASN from settings: ${asnToUse}`);
            }
          } catch (error: any) {
            console.error(`❌ Error getting ASN from settings:`, error);
          }
        }

        if (asnToUse) {
          // Only set the ASN in state if it's different (avoid unnecessary updates)
          if (!asnNo || asnNo.trim() !== asnToUse.trim()) {
            console.log(`📝 Setting asnNo state to: ${asnToUse}`);
            setAsnNo(asnToUse);
          }

          // Reload transfer orders for this ASN
          await loadTransferOrders(asnToUse);

          // Reload existing sessions for this ASN
          const normalizedASN = normalizeASN(asnToUse);
          console.log(
            `🔄 Checking sessions for normalized ASN: ${normalizedASN}`
          );
          await checkExistingSessions(normalizedASN);
        } else {
          console.log(
            `ℹ️ No ASN found in context, state, or settings - sessions list will be empty`
          );
        }
      };

      restoreASNAndSessions();
    }, [activeASN, asnNo])
  );

  // Handle selecting an existing session
  const handleSelectExistingSession = async (session: {
    inbound_session: string;
    status: string;
    started_on: string | null;
    asn_no?: string; // Add asn_no field to session type
  }) => {
    // Get the ASN from the session or from asnNo state
    // Sessions store normalized ASN, so we need to get the original format
    const sessionASN = session.asn_no || asnNo.trim().toUpperCase();
    if (!sessionASN) {
      Alert.alert("Error", "ASN number is required");
      return;
    }

    // The session ASN is normalized, so try to get original format from database
    const normalizedASN = normalizeASN(sessionASN);

    // Try to get original ASN format from database (from desktop sync)
    let displayASN = sessionASN; // Default to session ASN
    try {
      const originalASN = await dataService.getOriginalASNFormat(normalizedASN);
      if (originalASN && originalASN !== normalizedASN) {
        displayASN = originalASN;
        console.log(
          `📋 Using original ASN format from desktop: ${displayASN} (session: ${sessionASN}, normalized: ${normalizedASN})`
        );
      } else {
        // If no original format found, try using scanned ASN if available
        const scannedASN = asnNo.trim().toUpperCase();
        if (scannedASN && scannedASN !== normalizedASN) {
          displayASN = scannedASN;
          console.log(
            `📋 Using scanned ASN format: ${displayASN} (normalized: ${normalizedASN})`
          );
        } else {
          // Fallback to normalized ASN if no original or scanned format available
          displayASN = normalizedASN;
          console.log(`📋 Using normalized ASN format: ${displayASN}`);
        }
      }
    } catch (error: any) {
      // Fallback: use scanned ASN if available, otherwise use session ASN
      const scannedASN = asnNo.trim().toUpperCase();
      displayASN = scannedASN || sessionASN;
      console.warn(
        `⚠️ Could not get original ASN format, using: ${displayASN}`
      );
    }

    // Set active ASN (preserved format) and session
    setActiveASN(displayASN);
    setActiveSession(session.inbound_session);

    // Persist to settings (use preserved format)
    await saveSettings({
      active_asn: displayASN,
      active_session: session.inbound_session,
    });

    // Navigate to Unload screen
    (navigation as any).replace("Unload");
  };

  // Create new session with generated session ID
  const createNewSession = async (
    scannedASN: string | null, // Original scanned format (e.g., ASN-00001) or null for Transfer In
    userId: string,
    deviceId: string,
    generatedSessionId: string,
    transferInTitle?: string | null // Transfer In title if source type is Transfer In
  ) => {
    setLoading(true);
    try {
      const settings = await getSettings();

      // Normalize ASN only for database operations (lookups, storage) - only if ASN is provided
      const normalizedASN = scannedASN ? normalizeASN(scannedASN) : null;

      // CRITICAL: Check for existing session in backend BEFORE creating new one
      // This prevents duplicate sessions and ensures we load existing data
      let existingSession: any = null;
      let inboundSessionId = generatedSessionId; // Default to new session ID
      let sessionTotalCartons = 0;
      let sessionCompletedCartons = 0;

      if (
        !transferInTitle &&
        normalizedASN &&
        settings.api_url &&
        settings.demo_mode !== 1
      ) {
        try {
          console.warn(
            `🔍 Checking for existing sessions in backend for ASN: ${scannedASN}`
          );
          const backendSessions = await apiService.getInboundSessions();

          // Handle different response formats
          let sessionsList: any[] = [];
          if (Array.isArray(backendSessions)) {
            sessionsList = backendSessions;
          } else if (
            backendSessions?.data &&
            Array.isArray(backendSessions.data)
          ) {
            sessionsList = backendSessions.data;
          } else if (
            backendSessions?.sessions &&
            Array.isArray(backendSessions.sessions)
          ) {
            sessionsList = backendSessions.sessions;
          }

          // Filter sessions for this ASN (try both original and normalized format)
          const matchingSessions = sessionsList.filter((s: any) => {
            const sessionASN = s.asn_no || s.advance_shipping_notice || "";
            return (
              normalizeASN(sessionASN) === normalizedASN ||
              sessionASN.toUpperCase().trim() ===
                scannedASN!.toUpperCase().trim()
            );
          });

          // Find the most recent active session (Receiving, Draft, or Open status)
          existingSession = matchingSessions
            .filter(
              (s: any) =>
                s.status === "Receiving" ||
                s.status === "Draft" ||
                s.status === "Open" ||
                !s.status // Handle null/undefined status
            )
            .sort((a: any, b: any) => {
              const dateA = new Date(
                a.started_on || a.created_at || a.updated_at || 0
              );
              const dateB = new Date(
                b.started_on || b.created_at || b.updated_at || 0
              );
              return dateB.getTime() - dateA.getTime(); // Most recent first
            })[0];

          if (existingSession) {
            inboundSessionId =
              existingSession.inbound_session ||
              existingSession.title ||
              generatedSessionId;
            sessionTotalCartons =
              existingSession.total_cartons ||
              existingSession.totalCartons ||
              0;
            sessionCompletedCartons =
              existingSession.completed_cartons ||
              existingSession.completedCartons ||
              0;

            console.warn(`✅ Found existing session in backend:`, {
              session_id: inboundSessionId,
              status: existingSession.status,
              total_cartons: sessionTotalCartons,
              completed_cartons: sessionCompletedCartons,
            });

            // Load unload lines from backend to populate carton statuses
            try {
              const unloadLines = await apiService.getUnloadLines(
                inboundSessionId
              );
              let linesList: any[] = [];
              if (Array.isArray(unloadLines)) {
                linesList = unloadLines;
              } else if (unloadLines?.data && Array.isArray(unloadLines.data)) {
                linesList = unloadLines.data;
              } else if (
                unloadLines?.lines &&
                Array.isArray(unloadLines.lines)
              ) {
                linesList = unloadLines.lines;
              }

              console.warn(
                `📦 Found ${linesList.length} unload line(s) from backend for session ${inboundSessionId}`
              );

              // Populate carton statuses from unload lines
              const db = await getDatabase();
              for (const line of linesList) {
                const cartonId = line.unit_id || line.carton_id;
                if (
                  cartonId &&
                  (line.unit_type === "Carton" || !line.unit_type)
                ) {
                  await dataService.updateCartonStatus({
                    asn_no: scannedASN!, // Use original format
                    inbound_session: inboundSessionId,
                    carton_id: cartonId,
                    status: "Unloaded", // Unload lines indicate cartons were unloaded
                    updated_on:
                      line.scanned_on ||
                      line.created_at ||
                      new Date().toISOString(),
                  });
                }
              }
              console.warn(
                `✅ Populated carton statuses from ${linesList.length} unload line(s)`
              );
            } catch (unloadLinesError: any) {
              console.warn(
                `⚠️ Could not load unload lines from backend:`,
                unloadLinesError.message
              );
              // Continue - this is not critical
            }
          } else {
            console.warn(
              `ℹ️ No existing active session found in backend for ASN ${scannedASN}, creating new session`
            );
          }
        } catch (sessionCheckError: any) {
          console.warn(
            `⚠️ Could not check for existing sessions in backend:`,
            sessionCheckError.message
          );
          // Continue with new session creation
        }
      }

      // Use the existing session ID if found, otherwise use generated one
      // inboundSessionId is already set above

      const db = await getDatabase();
      let cartons: string[] = [];

      // Handle ASN-specific logic
      if (!transferInTitle && normalizedASN) {
        // Cache ASN data
        await db.runAsync(
          "INSERT OR REPLACE INTO asn_cache (asn_no, payload_json, updated_on) VALUES (?, ?, ?)",
          [
            normalizedASN,
            JSON.stringify({
              asn_no: normalizedASN,
              transfer_order: transferOrder,
              dock,
            }),
            new Date().toISOString(),
          ]
        );

        // Initialize carton statuses - get cartons from ASN carton map (synced from desktop)
        let cartonMap = await db.getAllAsync<{ carton_id: string }>(
          "SELECT DISTINCT carton_id FROM asn_carton_map WHERE asn_no = ? ORDER BY carton_id",
          [normalizedASN]
        );

        console.log(
          `📦 Found ${cartonMap.length} cartons in asn_carton_map for ASN: ${normalizedASN}`,
          cartonMap.map((c) => c.carton_id)
        );

        // CRITICAL: If we found an existing session, use its total_cartons to determine cartons
        // This ensures we show the correct count even if asn_carton_map is empty
        if (existingSession && sessionTotalCartons > 0) {
          console.warn(
            `📦 Using total_cartons from existing session: ${sessionTotalCartons}`
          );

          // If we have carton map data, use it
          if (cartonMap.length > 0) {
            cartons = cartonMap.map((c) => c.carton_id);
            console.warn(
              `✅ Using ${cartons.length} carton(s) from carton map (session has ${sessionTotalCartons})`
            );
          } else {
            // If no carton map but session has total_cartons, we need to load from unload lines
            // This will be handled by UnloadScreen loading unload lines
            console.warn(
              `⚠️ No carton map but session has ${sessionTotalCartons} cartons - will load from unload lines`
            );
            cartons = []; // Will be populated from unload lines in UnloadScreen
          }
        } else if (cartonMap.length > 0) {
          // Only use cartons from asn_carton_map (synced from desktop)
          // Do NOT create demo cartons or use fallback - use only real data from desktop
          cartons = cartonMap.map((c) => c.carton_id);
          console.warn(
            `✅ Using ${cartons.length} carton(s) from desktop sync:`,
            cartons
          );
        } else {
          // No cartons found - try to fetch ASN details from backend automatically
          console.log(
            `⚠️ No cartons found in asn_carton_map for ASN ${normalizedASN}. ` +
              `Attempting to fetch ASN details from backend...`
          );

          try {
            // Fetch ASN details from backend API
            const asnDetails = await apiService.getASN(scannedASN!); // Use original format
            console.log(`📥 Fetched ASN details from backend:`, asnDetails);

            // Check if ASN details contain carton information
            if (asnDetails && (asnDetails.details || asnDetails.cartons)) {
              const details = asnDetails.details || [];
              const cartonsData = asnDetails.cartons || [];

              // Populate asn_carton_map from ASN details
              let cartonMapPopulated = false;

              // Handle details array format: [{ carton_id, item_code, shipped_qty }]
              if (details.length > 0) {
                for (const detail of details) {
                  if (detail.carton_id && detail.item_code) {
                    await db.runAsync(
                      `INSERT OR REPLACE INTO asn_carton_map 
                       (asn_no, carton_id, item_code, shipped_qty) 
                       VALUES (?, ?, ?, ?)`,
                      [
                        scannedASN, // Use original ASN format
                        detail.carton_id,
                        detail.item_code,
                        detail.shipped_qty || detail.expected_qty || 0,
                      ]
                    );
                    cartonMapPopulated = true;
                  }
                }
              }

              // Handle cartons array format: [{ carton_id, items: [{ item_code, shipped_qty }] }]
              if (cartonsData.length > 0) {
                for (const carton of cartonsData) {
                  if (
                    carton.carton_id &&
                    carton.items &&
                    Array.isArray(carton.items)
                  ) {
                    for (const item of carton.items) {
                      await db.runAsync(
                        `INSERT OR REPLACE INTO asn_carton_map 
                         (asn_no, carton_id, item_code, shipped_qty) 
                         VALUES (?, ?, ?, ?)`,
                        [
                          scannedASN, // Use original ASN format
                          carton.carton_id,
                          item.item_code,
                          item.shipped_qty || 0,
                        ]
                      );
                      cartonMapPopulated = true;
                    }
                  }
                }
              }

              if (cartonMapPopulated) {
                console.log(
                  `✅ Successfully populated asn_carton_map from backend API`
                );
                // Re-fetch cartons from asn_carton_map using original ASN format (matches how we stored them)
                // Try original format first, then normalized for backward compatibility
                cartonMap = await db.getAllAsync<{ carton_id: string }>(
                  "SELECT DISTINCT carton_id FROM asn_carton_map WHERE asn_no = ? ORDER BY carton_id",
                  [scannedASN] // Use original format (matches storage format)
                );

                // If no results with original format, try normalized format for backward compatibility
                if (cartonMap.length === 0 && scannedASN !== normalizedASN) {
                  cartonMap = await db.getAllAsync<{ carton_id: string }>(
                    "SELECT DISTINCT carton_id FROM asn_carton_map WHERE asn_no = ? ORDER BY carton_id",
                    [normalizedASN]
                  );
                }

                cartons = cartonMap.map((c) => c.carton_id);
                console.log(
                  `✅ Found ${cartons.length} carton(s) after backend sync:`,
                  cartons
                );
              } else {
                console.warn(
                  `⚠️ ASN details fetched but no carton data found in response`
                );
              }
            }
          } catch (fetchError: any) {
            console.error(
              `❌ Failed to fetch ASN details from backend:`,
              fetchError
            );

            // Check if it's a 404 error (endpoint doesn't exist)
            const is404Error =
              fetchError.message?.includes("404") ||
              fetchError.message?.includes("not found") ||
              fetchError.message?.includes("Route");

            console.log(`🔍 Error type check:`, {
              is404: is404Error,
              errorMessage: fetchError.message,
            });

            // Fallback: Check if cartons exist in carton_status_cache (from previous scans)
            console.log(
              `🔄 Checking carton_status_cache for existing cartons...`
            );
            try {
              const existingCartonStatuses = await db.getAllAsync<{
                carton_id: string;
              }>(
                `SELECT DISTINCT carton_id FROM carton_status_cache WHERE asn_no = ? ORDER BY carton_id`,
                [normalizedASN]
              );

              if (existingCartonStatuses.length > 0) {
                console.log(
                  `✅ Found ${existingCartonStatuses.length} carton(s) in carton_status_cache:`,
                  existingCartonStatuses.map((c) => c.carton_id)
                );

                // Populate asn_carton_map with carton IDs (even without item details)
                // This allows the app to proceed with known cartons
                for (const cartonStatus of existingCartonStatuses) {
                  // Insert a placeholder entry so carton is recognized
                  // Item details can be added later when carton is scanned
                  await db.runAsync(
                    `INSERT OR IGNORE INTO asn_carton_map 
                   (asn_no, carton_id, item_code, shipped_qty) 
                   VALUES (?, ?, ?, ?)`,
                    [
                      scannedASN, // Use original ASN format
                      cartonStatus.carton_id,
                      "PLACEHOLDER", // Placeholder item - will be updated when carton is scanned
                      0, // Unknown quantity - will be updated when carton is scanned
                    ]
                  );
                }

                // Re-fetch cartons from asn_carton_map
                cartonMap = await db.getAllAsync<{ carton_id: string }>(
                  "SELECT DISTINCT carton_id FROM asn_carton_map WHERE asn_no = ? ORDER BY carton_id",
                  [normalizedASN]
                );
                cartons = cartonMap.map((c) => c.carton_id);
                console.log(
                  `✅ Using ${cartons.length} carton(s) from carton_status_cache:`,
                  cartons
                );
              } else {
                console.log(
                  `ℹ️ No cartons found in carton_status_cache either`
                );
              }
            } catch (cacheError: any) {
              console.error(
                `❌ Error checking carton_status_cache:`,
                cacheError
              );
            }
          }

          // If still no cartons after all attempts
          if (cartons.length === 0) {
            console.warn(
              `⚠️ No cartons found for ASN ${normalizedASN} after all attempts.`
            );

            // Show alert with option to proceed (backend endpoint doesn't exist - 404 error)
            const proceedWithoutCartons = await new Promise<boolean>(
              (resolve) => {
                Alert.alert(
                  "No Cartons Found",
                  `No cartons found for ASN ${scannedASN}.\n\n` +
                    `The backend API endpoint /api/asn/{asn_no} is not implemented (404 error).\n\n` +
                    `Options:\n` +
                    `1. Scan cartons manually in Unload screen (they will be added automatically)\n` +
                    `2. Sync ASN data from desktop using Sync Center\n` +
                    `3. Ensure backend implements GET /api/asn/{asn_no} endpoint\n\n` +
                    `You can proceed to Unload screen and scan cartons - they will be recognized automatically.`,
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
                      text: "Proceed Anyway",
                      onPress: () => {
                        resolve(true);
                      },
                    },
                  ]
                );
              }
            );

            if (!proceedWithoutCartons) {
              return; // User cancelled
            }

            // Allow proceeding with empty cartons - user can scan them in Unload screen
            cartons = [];
            console.log(
              `ℹ️ Proceeding with empty cartons - user will scan cartons in Unload screen`
            );
          }
        }
      }

      // Handle Transfer In (no cartons needed, items are received directly)
      if (transferInTitle) {
        console.log(
          `📦 Transfer In ${transferInTitle} - items will be received directly (no cartons)`
        );
        cartons = []; // Transfer In doesn't use cartons
      }

      // Initialize carton statuses (only if we have cartons and it's ASN)
      if (cartons.length > 0 && !transferInTitle && normalizedASN) {
        console.log(
          `📦 Initializing ${cartons.length} carton statuses for new session...`
        );

        for (const carton_id of cartons) {
          await dataService.updateCartonStatus({
            asn_no: normalizedASN,
            inbound_session: inboundSessionId,
            carton_id,
            status: "Pending",
            updated_on: new Date().toISOString(),
          });
        }
      } else if (!transferInTitle && normalizedASN) {
        console.log(
          `ℹ️ No cartons to initialize - user will scan cartons in Unload screen`
        );
      }

      // In demo mode, ensure BOXes exist for this ASN (only for ASN)
      if (settings.demo_mode && !transferInTitle && normalizedASN) {
        const existingBoxes = await db.getAllAsync<{ box_id: string }>(
          "SELECT DISTINCT box_id FROM box_cache WHERE asn_no = ?",
          [normalizedASN]
        );

        if (existingBoxes.length === 0) {
          const demoBoxes = [
            { box_id: "BOX-SR01-001", store: "SR-01", status: "Open" },
            { box_id: "BOX-SR02-001", store: "SR-02", status: "Open" },
            { box_id: "BOX-SR03-001", store: "SR-03", status: "Open" },
          ];

          for (const box of demoBoxes) {
            await db.runAsync(
              "INSERT OR REPLACE INTO box_cache (box_id, asn_no, to_no, store, status, updated_on) VALUES (?, ?, ?, ?, ?, ?)",
              [
                box.box_id,
                normalizedASN,
                transferOrder || "TO-00012",
                box.store,
                box.status,
                new Date().toISOString(),
              ]
            );
          }
        }
      }

      // Determine total_cartons: Use session data from backend if available, otherwise use cartons.length
      // This ensures we use the correct count from backend (e.g., 3) even if asn_carton_map is empty
      const finalTotalCartons =
        existingSession && sessionTotalCartons > 0
          ? sessionTotalCartons
          : cartons.length;

      // Determine completed_cartons: Use session data from backend if available
      const finalCompletedCartons = existingSession
        ? sessionCompletedCartons
        : 0;

      console.warn(`📊 Session carton counts:`, {
        from_backend_session: existingSession
          ? {
              total: sessionTotalCartons,
              completed: sessionCompletedCartons,
            }
          : null,
        from_carton_map: cartons.length,
        final_total: finalTotalCartons,
        final_completed: finalCompletedCartons,
      });

      // Save session to local database
      await dataService.saveInboundSession({
        inbound_session: inboundSessionId,
        asn_no: transferInTitle ? null : normalizedASN || null,
        transfer_in: transferInTitle || null,
        transfer_order: transferOrder,
        dock: dock,
        status: existingSession?.status || "Receiving", // Use existing status if found
        total_cartons: finalTotalCartons, // Use backend value if available
        completed_cartons: finalCompletedCartons, // Use backend value if available
        started_by: existingSession?.started_by || userId,
        started_on: existingSession?.started_on || new Date().toISOString(),
        synced: existingSession ? 1 : 0, // Mark as synced if loaded from backend
      });

      // Sync session to backend using /api/inbound/update
      try {
        // Ensure transfer_order is included even if empty string (convert empty to null for clarity)
        const transferOrderValue =
          transferOrder && transferOrder.trim().length > 0
            ? transferOrder
            : undefined;

        const sessionData: any = {
          inbound_session: inboundSessionId,
          status: existingSession?.status || "Receiving", // Use existing status if found
          transfer_order: transferOrderValue,
          dock: dock,
          total_cartons: finalTotalCartons, // Use backend value if available
          completed_cartons: finalCompletedCartons, // Use backend value if available
          user_id: userId,
          device_id: deviceId,
        };

        // Use transfer_in for Transfer In, asn_no for ASN
        if (transferInTitle) {
          sessionData.transfer_in = transferInTitle;
          // Don't set asn_no for Transfer In
        } else if (normalizedASN) {
          sessionData.asn_no = normalizedASN;
        }

        await apiService.updateInboundSession(sessionData);

        console.log(
          `✅ Session synced with transfer_order: ${
            transferOrderValue || "(none)"
          }`
        );
        console.log("✅ Session synced to backend");
      } catch (syncError: any) {
        console.warn(
          "⚠️ Failed to sync session to backend:",
          syncError.message
        );
      }

      // For ASN, use the scanned ASN format (preserve exact format from barcode)
      // For Transfer In, don't set active ASN
      if (!transferInTitle && scannedASN) {
        // Use the scanned ASN format (preserve exact format from barcode)
        // If ASN exists in database, prefer the original format from desktop
        let displayASN = scannedASN; // Default to scanned format
        try {
          const originalASN = await dataService.getOriginalASNFormat(
            normalizedASN!
          );
          if (originalASN && originalASN !== normalizedASN) {
            displayASN = originalASN;
            console.log(
              `📋 Using original ASN format from desktop: ${displayASN} (scanned: ${scannedASN}, normalized: ${normalizedASN})`
            );
          } else {
            // Use scanned format if no original found in database
            displayASN = scannedASN;
            console.log(
              `📋 Using scanned ASN format: ${displayASN} (normalized: ${normalizedASN})`
            );
          }
        } catch (error: any) {
          // Fallback to scanned format if database lookup fails
          displayASN = scannedASN;
          console.warn(
            `⚠️ Could not get original ASN format, using scanned: ${scannedASN}`
          );
        }

        setActiveASN(displayASN);
        // Persist active ASN (preserved format) and session to settings
        await saveSettings({
          active_asn: displayASN,
          active_session: inboundSessionId,
        });
      } else if (transferInTitle) {
        // For Transfer In, don't set active ASN
        await saveSettings({
          active_session: inboundSessionId,
        });
      }

      setActiveSession(inboundSessionId);

      // Auto-navigate to Unload screen
      (navigation as any).replace("Unload");
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to start inbound session");
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async () => {
    if (sourceType === "ASN" && !asnNo.trim()) {
      Alert.alert("Error", "Please scan or enter ASN number");
      return;
    }

    if (sourceType === "TransferIn" && !selectedTransferIn) {
      Alert.alert("Error", "Please select a Transfer In");
      return;
    }

    // NEW: For Transfer In, skip Inbound Session creation and go directly to receiving
    if (sourceType === "TransferIn" && selectedTransferIn) {
      console.log(`✅ Transfer In ${selectedTransferIn} - navigating directly to receiving (no Inbound Session)`);
      (navigation as any).navigate("TransferInReceiving", {
        transferInTitle: selectedTransferIn,
      });
      return;
    }

    // Check if all cartons are completed
    if (sourceType === "ASN" && allCartonsCompleted) {
      Alert.alert(
        "All Cartons Received",
        "All cartons for this ASN have been received. Cannot create a new session.",
        [{ text: "OK" }]
      );
      return;
    }

    const settings = await getSettings();
    const userId = settings.user_id || "USER-AUTO";
    const deviceId = settings.device_id || "DEV-AUTO";

    let scannedASN: string | null = null;
    let normalizedASN: string | null = null;
    let generatedSessionId: string;

    if (sourceType === "ASN") {
      // Preserve original scanned format, but normalize for session ID generation
      scannedASN = asnNo.trim().toUpperCase();
      
      // Validate ASN before creating session
      console.log(`🔍 Validating ASN ${scannedASN} before creating session...`);
      let asnValid = false;

      try {
        // Check if ASN exists locally (in asn_cache or asn_carton_map)
        const db = await getDatabase();
        if (db) {
          // Check asn_cache first
          const asnInCache = await db.getFirstAsync<{ asn_no: string }>(
            `SELECT asn_no FROM asn_cache WHERE asn_no = ? OR asn_no_original = ?`,
            [scannedASN, scannedASN]
          );

          if (asnInCache) {
            console.log(`✅ ASN ${scannedASN} found in local cache`);
            asnValid = true;
          } else {
            // Check asn_carton_map
            const normalizedASNCheck = normalizeASN(scannedASN);
            const cartonsInMap = await db.getFirstAsync<{ carton_id: string }>(
              `SELECT DISTINCT carton_id FROM asn_carton_map WHERE asn_no = ? OR asn_no = ? LIMIT 1`,
              [scannedASN, normalizedASNCheck]
            );

            if (cartonsInMap) {
              console.log(`✅ ASN ${scannedASN} found in local asn_carton_map`);
              asnValid = true;
            }
          }
        }
      } catch (localError: any) {
        console.warn(`⚠️ Error checking local ASN:`, localError.message);
      }

      // If not found locally, check backend
      if (!asnValid) {
        console.log(`🔍 ASN ${scannedASN} not found locally, checking backend...`);
        try {
          if (settings.api_url && settings.demo_mode !== 1) {
            const asnDetails = await apiService.getASN(scannedASN);
            
            if (asnDetails && (asnDetails.asn_no || asnDetails.advance_shipping_notice || asnDetails.details || asnDetails.cartons)) {
              console.log(`✅ ASN ${scannedASN} validated from backend`);
              asnValid = true;
            } else {
              console.log(`❌ ASN ${scannedASN} not found in backend`);
            }
          } else {
            // Demo mode or no API URL - skip backend validation
            console.log(`ℹ️ Demo mode or no API URL - skipping backend validation`);
            // In demo mode, allow proceeding without validation
            asnValid = true;
          }
        } catch (backendError: any) {
          const errorMessage = backendError.message || "";
          const errorCode = backendError.code || "";
          const is404 = 
            errorMessage.includes("404") || 
            errorMessage.includes("not found") ||
            errorCode === "NOT_FOUND";
          
          if (is404) {
            console.log(`❌ ASN ${scannedASN} not found in backend (404/NOT_FOUND)`);
          } else {
            console.error(`❌ Error validating ASN from backend:`, backendError.message);
            // For non-404 errors in demo mode, allow proceeding
            if (settings.demo_mode === 1) {
              asnValid = true;
            }
          }
        }
      }

      // If ASN is invalid, show error and don't create session
      if (!asnValid) {
        Alert.alert(
          "ASN Wrong",
          `ASN ${scannedASN} was not found.\n\nPlease check the ASN number and try again.`,
          [{ text: "OK" }]
        );
        return;
      }

      normalizedASN = normalizeASN(scannedASN);
      generatedSessionId = dataService.generateSessionId(
        normalizedASN,
        deviceId,
        userId
      );
    } else {
      // Transfer In
      generatedSessionId = dataService.generateSessionId(
        selectedTransferIn!,
        deviceId,
        userId
      );
    }

    // Check if session already exists locally
    const existingSession = await dataService.getInboundSession(
      generatedSessionId
    );

    if (existingSession && existingSession.status !== "Completed") {
      // Session exists and is not completed - show options
      Alert.alert(
        "Session Already Exists",
        `A session with ID ${generatedSessionId} already exists.\n\nStatus: ${
          existingSession.status
        }\nStarted: ${
          existingSession.started_on
            ? new Date(existingSession.started_on).toLocaleString()
            : "Unknown"
        }\n\nDo you want to resume this session or create a new one?`,
        [
          {
            text: "Resume Existing",
            onPress: () => {
              handleSelectExistingSession(existingSession);
            },
          },
          {
            text: "Create New",
            style: "destructive",
            onPress: async () => {
              // Create new session (will overwrite existing)
              await createNewSession(
                scannedASN,
                userId,
                deviceId,
                generatedSessionId,
                sourceType === "TransferIn" ? selectedTransferIn : null
              );
            },
          },
        ]
      );
      return;
    }

    // If there are other existing sessions, show list
    if (existingSessions.length > 0) {
      setShowSessionList(true);
      return;
    }

    // No existing session, create new one
    await createNewSession(
      scannedASN,
      userId,
      deviceId,
      generatedSessionId,
      sourceType === "TransferIn" ? selectedTransferIn : null
    );
  };

  const renderSessionItem = ({
    item,
  }: {
    item: (typeof existingSessions)[0];
  }) => (
    <TouchableOpacity
      style={styles.sessionItem}
      onPress={() => handleSelectExistingSession(item)}
    >
      <View style={styles.sessionItemContent}>
        <Text style={styles.sessionIdText}>{item.inbound_session}</Text>
        <Text style={styles.sessionStatusText}>Status: {item.status}</Text>
        <Text style={styles.sessionDateText}>
          Started:{" "}
          {item.started_on
            ? new Date(item.started_on).toLocaleString()
            : "Unknown"}
        </Text>
        <Text style={styles.sessionProgressText}>
          Progress: {item.completed_cartons}/{item.total_cartons} cartons
        </Text>
      </View>
      <Text style={styles.sessionTapHint}>Tap to resume</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: "#F5F5F5",
        paddingBottom: Math.max(insets.bottom - 16, 0),
      }}
      edges={["top"]}
    >
      <ScrollView 
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
      >
        <ProgressIndicator
        currentStep={1}
        totalSteps={6}
        stepName="Start Inbound"
      />
      <View style={styles.content}>
        {/* Source Type Selector */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Source Type</Text>
          <View style={styles.radioGroup}>
            <TouchableOpacity
              style={[
                styles.radioButton,
                sourceType === "ASN" && styles.radioButtonActive,
              ]}
              onPress={() => {
                setSourceType("ASN");
                setSelectedTransferIn(null);
                setAsnNo("");
              }}
            >
              <Text
                style={[
                  styles.radioText,
                  sourceType === "ASN" && styles.radioTextActive,
                ]}
              >
                ASN
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.radioButton,
                sourceType === "TransferIn" && styles.radioButtonActive,
              ]}
              onPress={() => {
                setSourceType("TransferIn");
                setAsnNo("");
                loadTransferIns();
              }}
            >
              <Text
                style={[
                  styles.radioText,
                  sourceType === "TransferIn" && styles.radioTextActive,
                ]}
              >
                Transfer In
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {sourceType === "ASN" ? (
          <>
            <Text style={styles.sectionTitle}>Scan ASN Barcode</Text>
            <BarcodeScanner
              onScan={handleASNScan}
              placeholder="Enter ASN number"
              title="ASN Barcode"
            />
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Scan Transfer In Barcode</Text>
            <BarcodeScanner
              onScan={handleTransferInScan}
              placeholder="Enter Transfer In number"
              title="Transfer In Barcode"
            />
          </>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>
            {sourceType === "ASN" ? "ASN Number" : "Transfer In"}
          </Text>
          <Text style={styles.value}>
            {sourceType === "ASN"
              ? asnNo
                ? asnNo // Display original scanned format (preserve exact format like ASN-00001)
                : "Not scanned"
              : selectedTransferIn || "Not scanned"}
          </Text>
        </View>

        {sessionId && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Session ID</Text>
            <Text style={styles.sessionIdDisplay}>{sessionId}</Text>
            <Text style={styles.hintText}>
              Generated from: ASN + Device ID + User ID
            </Text>
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Dock</Text>
          <TextInput
            style={styles.input}
            value={dock}
            onChangeText={setDock}
            placeholder="DOCK-01"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Transfer Order</Text>
          {loadingTO ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color="#007AFF" />
              <Text style={styles.loadingText}>Loading...</Text>
            </View>
          ) : transferOrder ? (
            <Text style={styles.value}>{transferOrder}</Text>
          ) : asnNo ? (
            <View>
              <Text style={styles.value}>No Transfer Order found</Text>
              <Text style={styles.hintText}>
                You can still proceed without a transfer order
              </Text>
            </View>
          ) : (
            <Text style={styles.value}>Scan ASN to load Transfer Order</Text>
          )}
        </View>

        {allCartonsCompleted && (
          <View style={styles.inputGroup}>
            <View style={styles.disabledMessageContainer}>
              <ScrollView
                style={styles.disabledMessageScroll}
                contentContainerStyle={styles.disabledMessageContent}
                nestedScrollEnabled={true}
                showsVerticalScrollIndicator={true}
                bounces={false}
              >
                <Text style={styles.disabledMessage}>
                  All cartons for this ASN have been received. Please use an existing
                  session or scan a different ASN.
                </Text>
              </ScrollView>
              <View style={styles.disabledMessageBorderBottom} />
            </View>
          </View>
        )}

        {existingSessions.length > 0 && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>
              Existing Sessions ({existingSessions.length})
            </Text>
            <TouchableOpacity
              style={styles.viewSessionsButton}
              onPress={() => setShowSessionList(true)}
            >
              <Text style={styles.viewSessionsButtonText}>
                View Existing Sessions
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.buttonContainer}>
          <View style={styles.buttonBorderTop} />
          <TouchableOpacity
            style={[
              styles.button,
              (loading || allCartonsCompleted) && styles.buttonDisabled,
            ]}
            onPress={handleStart}
            disabled={loading || allCartonsCompleted}
          >
            <Text style={styles.buttonText}>
              {loading
                ? "Starting..."
                : allCartonsCompleted
                ? "All Cartons Received"
                : "Start Inbound Session"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Existing Sessions Modal */}
      <Modal
        visible={showSessionList}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowSessionList(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Existing Sessions</Text>
              <TouchableOpacity
                onPress={() => setShowSessionList(false)}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={existingSessions}
              renderItem={renderSessionItem}
              keyExtractor={(item) => item.inbound_session}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No existing sessions found</Text>
              }
            />
            <TouchableOpacity
              style={[
                styles.createNewButton,
                allCartonsCompleted && styles.buttonDisabled,
              ]}
              onPress={async () => {
                if (allCartonsCompleted) {
                  Alert.alert(
                    "All Cartons Received",
                    "All cartons for this ASN have been received. Cannot create a new session.",
                    [{ text: "OK" }]
                  );
                  return;
                }
                setShowSessionList(false);
                const settings = await getSettings();
                const userId = settings.user_id || "USER-AUTO";
                const deviceId = settings.device_id || "DEV-AUTO";
                const scannedASN = asnNo.trim().toUpperCase();
                const normalizedASN = normalizeASN(scannedASN);
                const generatedSessionId = dataService.generateSessionId(
                  normalizedASN,
                  deviceId,
                  userId
                );
                await createNewSession(
                  scannedASN,
                  userId,
                  deviceId,
                  generatedSessionId
                );
              }}
              disabled={allCartonsCompleted}
            >
              <Text
                style={[
                  styles.createNewButtonText,
                  allCartonsCompleted && styles.buttonDisabledText,
                ]}
              >
                Create New Session
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    padding: 16,
    paddingTop: 16,
    paddingBottom: 0,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 16,
    color: "#333",
  },
  inputGroup: {
    marginBottom: 6,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    color: "#333",
  },
  value: {
    fontSize: 16,
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  sessionIdDisplay: {
    fontSize: 14,
    padding: 12,
    backgroundColor: "#e3f2fd",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2196F3",
    fontWeight: "600",
    color: "#1976D2",
  },
  input: {
    fontSize: 16,
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  buttonContainer: {
    position: "relative",
    marginTop: 4,
    marginBottom: 50, // Space above navigation bar (where the red line is)
  },
  buttonBorderTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "#ddd",
    zIndex: 1,
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 18,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 0,
    marginBottom: 0,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  loadingText: {
    marginLeft: 8,
    fontSize: 16,
    color: "#666",
  },
  hintText: {
    fontSize: 12,
    color: "#999",
    marginTop: 4,
    fontStyle: "italic",
  },
  viewSessionsButton: {
    backgroundColor: "#FF9800",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  viewSessionsButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 12,
    width: "90%",
    maxHeight: "80%",
    padding: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    fontSize: 24,
    color: "#666",
  },
  sessionItem: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  sessionItemContent: {
    marginBottom: 8,
  },
  sessionIdText: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1976D2",
    marginBottom: 4,
  },
  sessionStatusText: {
    fontSize: 14,
    color: "#666",
    marginBottom: 2,
  },
  sessionDateText: {
    fontSize: 12,
    color: "#999",
    marginBottom: 2,
  },
  sessionProgressText: {
    fontSize: 12,
    color: "#999",
  },
  sessionTapHint: {
    fontSize: 12,
    color: "#007AFF",
    fontStyle: "italic",
    textAlign: "right",
  },
  emptyText: {
    textAlign: "center",
    color: "#999",
    padding: 20,
  },
  createNewButton: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  createNewButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  radioGroup: {
    flexDirection: "row",
    gap: 12,
  },
  radioButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#ddd",
    backgroundColor: "#fff",
    alignItems: "center",
  },
  radioButtonActive: {
    borderColor: "#2196F3",
    backgroundColor: "#E3F2FD",
  },
  radioText: {
    fontSize: 16,
    color: "#666",
    fontWeight: "500",
  },
  radioTextActive: {
    color: "#2196F3",
    fontWeight: "bold",
  },
  transferInItem: {
    padding: 16,
    marginBottom: 8,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#ddd",
  },
  transferInItemSelected: {
    borderColor: "#2196F3",
    backgroundColor: "#E3F2FD",
  },
  transferInItemTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#2196F3",
    marginBottom: 4,
  },
  transferInItemSubtitle: {
    fontSize: 14,
    color: "#666",
  },
  emptyContainer: {
    padding: 20,
    alignItems: "center",
  },
  refreshButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  refreshButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  disabledMessageContainer: {
    backgroundColor: "#fff3cd",
    borderRadius: 8,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: "#ffc107",
    maxHeight: 100,
    overflow: "hidden",
    position: "relative",
  },
  disabledMessageScroll: {
    maxHeight: 100,
  },
  disabledMessageContent: {
    flexGrow: 1,
    padding: 0,
  },
  disabledMessage: {
    padding: 12,
    color: "#856404",
    fontSize: 14,
    textAlign: "center",
  },
  disabledMessageBorderBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "#ddd",
  },
  buttonDisabledText: {
    color: "#999",
  },
});
