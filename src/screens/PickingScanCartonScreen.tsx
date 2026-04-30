import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { PickingTheme } from "../theme/picking-theme";
// Camera not needed - using handheld scanner device
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import { apiService } from "../services/api.service";
import { pickingSessionService, PickingSession } from "../services/picking-session.service";
import { getDatabase } from "../database/database";
import { isDeviceOnline } from "../utils/network-check";
import {
  BarcodeInput,
  type BarcodeInputHandle,
} from "../components/BarcodeInput";

export default function PickingScanCartonScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const routeParams = (route.params as any) || {};
  const { materialRequestTitle, sessionId, binLocation, binInfo } = routeParams;

  const [cartonId, setCartonId] = useState("");
  const [loading, setLoading] = useState(false);
  const [cartonValidated, setCartonValidated] = useState(false);
  const [cartonInfo, setCartonInfo] = useState<any>(null);
  const cartonInputRef = useRef<BarcodeInputHandle>(null);
  const lastScanTimeRef = useRef<number>(0);
  const SCAN_DEBOUNCE_MS = 700;

  useEffect(() => {
    // Auto-focus input on mount
    setTimeout(() => {
      cartonInputRef.current?.focus();
    }, 100);
  }, []);

  const extractRows = (response: any): any[] => {
    if (Array.isArray(response)) return response;
    if (!response || typeof response !== "object") return [];
    const data = response.data;
    const candidates = [
      response.data,
      response.stock,
      response.locations,
      response.stock_ledger,
      response.ledger,
      response.rows,
      response.items,
      response.entries,
      data?.stock,
      data?.locations,
      data?.stock_ledger,
      data?.ledger,
      data?.rows,
      data?.items,
      data?.entries,
    ];
    const found = candidates.find((candidate) => Array.isArray(candidate));
    if (Array.isArray(found)) return found;
    return [];
  };

  const getLocationId = (entry: any): string =>
    String(
      entry?.location_id ||
        entry?.["Location ID"] ||
        entry?.Location_ID ||
        entry?.bin_location ||
        entry?.Bin_Location ||
        entry?.binLocation ||
        entry?.bin_code ||
        entry?.Bin_Code ||
        entry?.location ||
        entry?.Location ||
        ""
    )
      .trim()
      .toUpperCase();

  const getCartonId = (entry: any): string =>
    String(
      entry?.carton_id ||
        entry?.carton_ID ||
        entry?.Carton_ID ||
        entry?.cartonId ||
        entry?.["Carton ID"] ||
        entry?.["Carton_ID"] ||
        ""
    )
      .trim()
      .toUpperCase();

  const getQty = (entry: any): number => {
    const balance =
      entry?.balance_qty ??
      entry?.balance_Qty ??
      entry?.Balance_Qty ??
      entry?.["Balance Qty"] ??
      entry?.["Balance_Qty"] ??
      entry?.balanceQty;
    if (balance !== undefined && balance !== null && !Number.isNaN(Number(balance))) {
      return Number(balance);
    }

    const inQty =
      entry?.in_qty ??
      entry?.in_Qty ??
      entry?.In_Qty ??
      entry?.["In Qty"] ??
      entry?.["In_Qty"];
    const outQty =
      entry?.out_qty ??
      entry?.out_Qty ??
      entry?.Out_Qty ??
      entry?.["Out Qty"] ??
      entry?.["Out_Qty"];
    if (inQty !== undefined || outQty !== undefined) {
      return (Number(inQty) || 0) - (Number(outQty) || 0);
    }

    return Number(
      entry?.qty ??
        entry?.quantity ??
        entry?.available_qty ??
        entry?.availableQty ??
        entry?.actual_qty ??
        entry?.on_hand_qty ??
        entry?.stock_qty ??
        entry?.total_qty ??
        entry?.["Qty"] ??
        entry?.["Quantity"] ??
        0
    );
  };

  const validateCartonAtBin = async (normalizedCarton: string) => {
    const normalizedBin = String(binLocation || "").trim().toUpperCase();
    if (!normalizedBin) {
      return {
        valid: false,
        message: "Bin location is missing. Please scan the bin again.",
      };
    }

    if (!(await isDeviceOnline())) {
      return {
        valid: false,
        message:
          "Cannot validate carton without a live server connection.\n\nPlease connect WiFi/mobile data and scan the carton again.",
      };
    }

    const mrResponse = await apiService.getMaterialRequest(materialRequestTitle);
    const mr = mrResponse?.data || mrResponse;
    const warehouse = String(
      mr?.from_warehouse || binInfo?.warehouse_id || binInfo?.warehouse || ""
    ).trim();
    const requestedItems = Array.isArray(mr?.items)
      ? mr.items
      : Array.isArray(mr?.details)
        ? mr.details
        : Array.isArray(mr?.material_request_items)
          ? mr.material_request_items
          : Array.isArray(mr?.data?.items)
            ? mr.data.items
            : Array.isArray(mr?.data?.details)
              ? mr.data.details
              : Array.isArray(mr?.data?.material_request_items)
                ? mr.data.material_request_items
                : [];
    const pendingItemCodes = new Set(
      requestedItems
        .filter((item: any) => {
          const requestedQty = Number(item.requested_qty ?? item.qty ?? 0);
          const pickedQty = Number(item.picked_qty ?? 0);
          return requestedQty <= 0 || pickedQty < requestedQty;
        })
        .map((item: any) => String(item.item_code || "").trim().toUpperCase())
        .filter(Boolean)
    );

    const rowMatches = (row: any): boolean => {
      const locationMatches = getLocationId(row) === normalizedBin;
      const cartonMatches = getCartonId(row) === normalizedCarton;
      const qty = getQty(row);
      const itemCode = String(row?.item_code || row?.itemCode || "").trim().toUpperCase();
      const itemMatches =
        pendingItemCodes.size === 0 || !itemCode || pendingItemCodes.has(itemCode);
      return locationMatches && cartonMatches && qty > 0 && itemMatches;
    };

    const groupedRowMatches = (row: any): boolean => {
      if (getLocationId(row) !== normalizedBin || !Array.isArray(row?.cartons)) {
        return false;
      }
      return row.cartons.some((carton: any) => {
        const cartonId = getCartonId(carton);
        const qty = getQty(carton);
        return cartonId === normalizedCarton && qty > 0;
      });
    };

    const scannedCartonLocations = new Map<string, number>();
    const availableCartonsAtBin = new Map<string, number>();
    const addLocationHint = (locationId: string, qty: number) => {
      if (!locationId || locationId === "UNKNOWN" || qty <= 0) return;
      scannedCartonLocations.set(
        locationId,
        (scannedCartonLocations.get(locationId) || 0) + qty
      );
    };
    const addAvailableCartonHint = (cartonId: string, qty: number) => {
      if (!cartonId || cartonId === "UNKNOWN" || qty <= 0) return;
      availableCartonsAtBin.set(
        cartonId,
        (availableCartonsAtBin.get(cartonId) || 0) + qty
      );
    };
    const inspectRowForHints = (row: any) => {
      const rowLocation = getLocationId(row);
      const rowCarton = getCartonId(row);
      const rowQty = getQty(row);

      if (rowCarton === normalizedCarton && rowQty > 0) {
        addLocationHint(rowLocation, rowQty);
      }
      if (rowLocation === normalizedBin && rowCarton && rowQty > 0) {
        addAvailableCartonHint(rowCarton, rowQty);
      }

      if (Array.isArray(row?.cartons)) {
        row.cartons.forEach((carton: any) => {
          const cartonId = getCartonId(carton);
          const qty = getQty(carton);
          if (cartonId === normalizedCarton && qty > 0) {
            addLocationHint(rowLocation, qty);
          }
          if (rowLocation === normalizedBin && cartonId && qty > 0) {
            addAvailableCartonHint(cartonId, qty);
          }
        });
      }
    };

    try {
      const ledger = await apiService.getStockLedgerByLocation({
        bin_location: normalizedBin,
        carton_id: normalizedCarton,
        warehouse: warehouse || undefined,
      });
      const rows = extractRows(ledger);
      rows.forEach(inspectRowForHints);
      if (rows.some((row) => rowMatches(row) || groupedRowMatches(row))) {
        return { valid: true, warehouse, rows };
      }
    } catch (error: any) {
      console.warn(
        "⚠️ Direct carton/bin stock validation failed, trying item fallback:",
        error?.message || error
      );
    }

    try {
      const binLedger = await apiService.getStockLedgerByLocation({
        bin_location: normalizedBin,
        warehouse: warehouse || undefined,
      });
      const rows = extractRows(binLedger);
      rows.forEach(inspectRowForHints);
      if (rows.some((row) => rowMatches(row) || groupedRowMatches(row))) {
        return { valid: true, warehouse, rows };
      }
    } catch (error: any) {
      console.warn(
        "⚠️ Bin stock validation failed, trying item fallback:",
        error?.message || error
      );
    }

    for (const itemCode of pendingItemCodes) {
      const locations = await apiService.getItemLocations(warehouse, itemCode);
      const rows = extractRows(locations);
      for (const row of rows) {
        inspectRowForHints(row);
        if (rowMatches(row) || groupedRowMatches(row)) {
          return { valid: true, warehouse, rows: [row] };
        }
      }
    }

    const scannedCartonHint =
      scannedCartonLocations.size > 0
        ? `\n\nScanned carton was found at:\n${Array.from(
            scannedCartonLocations.entries()
          )
            .slice(0, 4)
            .map(([location, qty]) => `- ${location} (qty ${qty})`)
            .join("\n")}`
        : "";
    const availableAtBinHint =
      availableCartonsAtBin.size > 0
        ? `\n\nCartons available at ${normalizedBin}:\n${Array.from(
            availableCartonsAtBin.entries()
          )
            .slice(0, 4)
            .map(([carton, qty]) => `- ${carton} (qty ${qty})`)
            .join("\n")}`
        : "";

    return {
      valid: false,
      message:
        `Carton "${normalizedCarton}" is not available at bin "${normalizedBin}" for this Material Request.\n\n` +
        "Please scan the correct carton from this bin." +
        scannedCartonHint +
        availableAtBinHint,
    };
  };

  // Validate carton ID when entered (for handheld scanner)
  const validateCarton = async (carton: string): Promise<boolean> => {
    if (!carton || !carton.trim()) {
      setCartonValidated(false);
      setCartonInfo(null);
      return false;
    }

    // Debounce: prevent duplicate processing
    const now = Date.now();
    if (now - lastScanTimeRef.current < SCAN_DEBOUNCE_MS) {
      console.log("⏭️ Debounced duplicate carton validation");
      return true;
    }
    lastScanTimeRef.current = now;

    setLoading(true);
    try {
      const db = await getDatabase();
      const normalizedCarton = carton.trim().toUpperCase();
      const serverValidation = await validateCartonAtBin(normalizedCarton);

      if (!serverValidation.valid) {
        Alert.alert("Invalid Carton", serverValidation.message);
        setCartonId("");
        setCartonInfo(null);
        setCartonValidated(false);
        setLoading(false);
        setTimeout(() => cartonInputRef.current?.focus(), 100);
        return false;
      }

      // Check local database first (box_cache, carton_status_cache, asn_carton_map)
      // Try box_cache first (box_id)
      let localCarton = await db.getFirstAsync<any>(
        `SELECT box_id, asn_no, to_no, store, status FROM box_cache WHERE box_id = ? LIMIT 1`,
        [normalizedCarton]
      );

      if (localCarton) {
        console.log(`✅ Carton found in box_cache: ${localCarton.box_id}`);
        setCartonId(localCarton.box_id);
        setCartonInfo({
          carton_id: localCarton.box_id,
          box_id: localCarton.box_id,
          asn_no: localCarton.asn_no,
        });
        setCartonValidated(true);
        setLoading(false);
        return true;
      }

      // Try carton_status_cache (carton_id)
      localCarton = await db.getFirstAsync<any>(
        `SELECT carton_id, asn_no FROM carton_status_cache WHERE carton_id = ? LIMIT 1`,
        [normalizedCarton]
      );

      if (localCarton) {
        console.log(`✅ Carton found in carton_status_cache: ${localCarton.carton_id}`);
        setCartonId(localCarton.carton_id);
        setCartonInfo({
          carton_id: localCarton.carton_id,
          box_id: localCarton.carton_id,
          asn_no: localCarton.asn_no,
        });
        setCartonValidated(true);
        setLoading(false);
        return true;
      }

      // Try asn_carton_map (carton_id)
      localCarton = await db.getFirstAsync<any>(
        `SELECT DISTINCT carton_id, asn_no FROM asn_carton_map WHERE carton_id = ? LIMIT 1`,
        [normalizedCarton]
      );

      if (localCarton) {
        console.log(`✅ Carton found in asn_carton_map: ${localCarton.carton_id}`);
        setCartonId(localCarton.carton_id);
        setCartonInfo({
          carton_id: localCarton.carton_id,
          box_id: localCarton.carton_id,
          asn_no: localCarton.asn_no,
        });
        setCartonValidated(true);
        setLoading(false);
        return true;
      }

      console.log("✅ Carton validated against backend stock/bin. Accepting even if local cache is missing.");
      setCartonId(normalizedCarton);
      setCartonInfo({
        carton_id: normalizedCarton,
        box_id: normalizedCarton,
        asn_no: null,
        warehouse: serverValidation.warehouse,
      });
      setCartonValidated(true);
      setLoading(false);
      return true;
    } catch (error: any) {
      setLoading(false);
      console.error("❌ Error validating carton:", error);
      Alert.alert("Error", `Failed to validate carton: ${error.message}`);
      setCartonInfo(null);
      setCartonValidated(false);
      return false;
    }
  };

  // Navigate to next screen after carton is validated
  const handleContinue = async () => {
    if (!cartonId || !cartonId.trim()) {
      Alert.alert("Error", "Please enter a carton ID");
      return;
    }

    if (!cartonValidated || !cartonInfo) {
      Alert.alert("Error", "Please scan a valid carton ID first");
      return;
    }

    // Debounce: prevent duplicate processing
    const now = Date.now();
    if (now - lastScanTimeRef.current < SCAN_DEBOUNCE_MS) {
      console.log("⏭️ Debounced duplicate scan");
      return;
    }
    lastScanTimeRef.current = now;

    const normalizedCarton = cartonId.trim().toUpperCase();

    setLoading(true);
    try {
      // Save carton to backend (API may not exist yet - that's OK)
      try {
        await apiService.scanCarton(sessionId, normalizedCarton);
      } catch (error: any) {
        // Error already handled in API service, queue for offline sync
        await pickingSessionService.addToQueue(materialRequestTitle, {
          type: "SCAN_CARTON",
          payload: {
            session_id: sessionId,
            carton_id: normalizedCarton,
          },
        });
      }

      // Update session locally
      const session = await pickingSessionService.loadSession(materialRequestTitle);
      if (session) {
        const updatedSession: PickingSession = {
          ...session,
          carton_id: normalizedCarton,
          updated_at: new Date().toISOString(),
          is_dirty: true,
        };
        await pickingSessionService.saveSession(updatedSession);
      }

      // Navigate to Scan Items screen
      (navigation as any).navigate("PickingScanItems", {
        materialRequestTitle,
        sessionId,
        binLocation,
        binInfo,
        cartonId: normalizedCarton,
      });
    } catch (error: any) {
      setLoading(false);
      console.error("❌ Error scanning carton:", error);
      Alert.alert("Error", `Failed to scan carton: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Generate Carton button removed - not needed for picking process (cartons should already exist)

  const taskId = `PK-${binLocation?.replace(/-/g, "") || "UNKNOWN"}-${sessionId?.slice(-8) || "XXXX"}`;

  return (
    <View style={styles.container}>
      <View style={styles.headerSection}>
        <Text style={styles.headerTitle}>Material Request Picking</Text>
        <Text style={styles.headerSubtitle}>Scan Carton ID</Text>
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.binText}>Bin: {binLocation || "N/A"}</Text>
        <View style={styles.taskBadge}>
          <Text style={styles.taskText}>Task: {taskId}</Text>
        </View>
        <Text style={styles.scannedText}>0 item(s) scanned</Text>
      </View>

      <ScrollView 
        style={styles.cartonSection}
        contentContainerStyle={styles.cartonSectionContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.cartonHeader}>
          <Text style={styles.cartonIcon}>📦</Text>
          <View style={styles.cartonHeaderText}>
            <Text style={styles.cartonTitle}>Scan Carton ID</Text>
            <Text style={styles.cartonSubtitle}>
              One bin can have multiple cartons. Please scan the carton ID first.
            </Text>
          </View>
        </View>
        <View style={styles.cartonInputRow}>
          <BarcodeInput
            ref={cartonInputRef}
            autoFocus
            placeholder="Scan or enter carton ID"
            onBarcodeScanned={async (raw) =>
              validateCarton(raw.trim().toUpperCase())
            }
            containerStyle={styles.cartonInputStack}
            inputStyle={styles.cartonInput}
            actionsContainerStyle={styles.cartonInputActions}
            submitButtonStyle={styles.cartonSubmitButton}
            submitTextStyle={styles.cartonSubmitButtonText}
            showSoftInputOnFocus={false}
            showKeyboardButton
            keyboardButtonStyle={styles.keyboardButton}
            keyboardButtonTextStyle={styles.keyboardButtonText}
            keyboardButtonLabel="Keyboard"
          />
        </View>
        
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={PickingTheme.colors.headerOrange} />
            <Text style={styles.loadingText}>Validating carton...</Text>
          </View>
        )}

        {cartonInfo && !loading && (
          <View style={styles.cartonInfoCard}>
            <Text style={styles.cartonInfoTitle}>Carton Information</Text>
            <View style={styles.cartonInfoRow}>
              <Text style={styles.cartonInfoLabel}>Carton ID:</Text>
              <Text style={styles.cartonInfoValue}>{cartonInfo.carton_id}</Text>
            </View>
            {cartonInfo.asn_no && (
              <View style={styles.cartonInfoRow}>
                <Text style={styles.cartonInfoLabel}>ASN:</Text>
                <Text style={styles.cartonInfoValue}>{cartonInfo.asn_no}</Text>
              </View>
            )}
          </View>
        )}
        
        {cartonValidated && !loading && (
          <TouchableOpacity
            style={styles.continueButton}
            onPress={handleContinue}
            disabled={loading}
          >
            <Text style={styles.continueButtonText}>Continue to Item Scanning</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <ScreenFooterFrame />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PickingTheme.colors.backgroundLight,
  },
  headerSection: {
    backgroundColor: PickingTheme.colors.headerPurple,
    padding: PickingTheme.spacing.lg,
    paddingTop: 40,
  },
  headerTitle: {
    ...PickingTheme.typography.h1,
    color: PickingTheme.colors.textWhite,
    marginBottom: 4,
  },
  headerSubtitle: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textLight,
  },
  infoSection: {
    backgroundColor: PickingTheme.colors.headerPurple,
    paddingHorizontal: PickingTheme.spacing.lg,
    paddingBottom: PickingTheme.spacing.md,
  },
  binText: {
    ...PickingTheme.typography.h1,
    color: PickingTheme.colors.textWhite,
    marginBottom: PickingTheme.spacing.sm,
  },
  taskBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: PickingTheme.borderRadius.small,
    padding: PickingTheme.spacing.sm,
    marginBottom: PickingTheme.spacing.sm,
    alignSelf: "flex-start",
  },
  taskText: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textWhite,
  },
  scannedText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    opacity: 0.9,
  },
  cartonSection: {
    flex: 1,
    backgroundColor: PickingTheme.colors.headerOrange,
    borderTopLeftRadius: PickingTheme.borderRadius.xlarge,
    borderTopRightRadius: PickingTheme.borderRadius.xlarge,
    marginTop: PickingTheme.spacing.xs,
  },
  cartonSectionContent: {
    padding: PickingTheme.spacing.md,
    paddingTop: PickingTheme.spacing.sm,
    paddingBottom: PickingTheme.spacing.lg,
  },
  cartonHeaderText: {
    flex: 1,
  },
  cartonHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: PickingTheme.spacing.sm,
  },
  cartonIcon: {
    fontSize: 32,
    marginRight: PickingTheme.spacing.sm,
  },
  cartonTitle: {
    ...PickingTheme.typography.h1,
    color: PickingTheme.colors.textWhite,
    marginBottom: 2,
    fontSize: 20,
  },
  cartonSubtitle: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textWhite,
    opacity: 0.9,
    fontSize: 12,
  },
  cartonInputRow: {
    marginTop: PickingTheme.spacing.sm,
  },
  cartonInputStack: {
    alignSelf: "stretch",
    flexDirection: "column",
    alignItems: "stretch",
    gap: PickingTheme.spacing.sm,
  },
  cartonInput: {
    alignSelf: "stretch",
    backgroundColor: PickingTheme.colors.backgroundWhite,
    borderRadius: PickingTheme.borderRadius.small,
    padding: PickingTheme.spacing.md,
    minHeight: 60,
    ...PickingTheme.typography.body,
  },
  cartonInputActions: {
    alignSelf: "stretch",
    flexDirection: "row",
    gap: PickingTheme.spacing.sm,
  },
  keyboardButton: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderColor: "rgba(255,255,255,0.7)",
    paddingHorizontal: PickingTheme.spacing.md,
    borderRadius: PickingTheme.borderRadius.small,
  },
  keyboardButtonText: {
    color: PickingTheme.colors.headerPurple,
    fontWeight: "700",
  },
  cartonSubmitButton: {
    flex: 1,
    backgroundColor: PickingTheme.colors.buttonBlue,
    borderColor: PickingTheme.colors.buttonBlue,
    borderRadius: PickingTheme.borderRadius.small,
    paddingHorizontal: PickingTheme.spacing.md,
  },
  cartonSubmitButtonText: {
    color: PickingTheme.colors.textWhite,
    fontWeight: "700",
  },
  cartonScanButton: {
    backgroundColor: PickingTheme.colors.buttonBlue,
    paddingHorizontal: PickingTheme.spacing.lg,
    paddingVertical: PickingTheme.spacing.md,
    borderRadius: PickingTheme.borderRadius.small,
    justifyContent: "center",
  },
  cartonScanButtonText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
  },
  loadingContainer: {
    marginTop: PickingTheme.spacing.md,
    alignItems: "center",
  },
  cartonInfoCard: {
    backgroundColor: "rgba(255,255,255,0.15)",
    marginTop: PickingTheme.spacing.sm,
    padding: PickingTheme.spacing.sm,
    borderRadius: PickingTheme.borderRadius.medium,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  cartonInfoTitle: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.textWhite,
    marginBottom: PickingTheme.spacing.xs,
    fontWeight: "bold",
    fontSize: 14,
  },
  cartonInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: PickingTheme.spacing.xs,
  },
  cartonInfoLabel: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    opacity: 0.9,
  },
  cartonInfoValue: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
  },
  loadingText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    marginTop: PickingTheme.spacing.sm,
  },
  continueButton: {
    backgroundColor: PickingTheme.colors.buttonBlue,
    marginTop: PickingTheme.spacing.md,
    padding: PickingTheme.spacing.md,
    borderRadius: PickingTheme.borderRadius.medium,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    marginBottom: PickingTheme.spacing.sm,
  },
  continueButtonText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    fontWeight: "bold",
    fontSize: 16,
  },
});
