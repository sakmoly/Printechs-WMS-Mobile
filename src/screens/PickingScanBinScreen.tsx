import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { PickingTheme } from "../theme/picking-theme";
// Camera not needed - using handheld scanner device
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import { apiService } from "../services/api.service";
import { getSettings } from "../services/settings.service";
import { getDatabase } from "../database/database";
import { pickingSessionService, PickingSession } from "../services/picking-session.service";
import {
  BarcodeInput,
  type BarcodeInputHandle,
} from "../components/BarcodeInput";

export default function PickingScanBinScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const routeParams = (route.params as any) || {};
  const { materialRequestTitle, sessionId } = routeParams;

  const [binCode, setBinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [binInfo, setBinInfo] = useState<any>(null);
  const binInputRef = useRef<BarcodeInputHandle>(null);
  const lastScanTimeRef = useRef<number>(0);
  const SCAN_DEBOUNCE_MS = 700;

  useEffect(() => {
    // Auto-focus input on mount
    setTimeout(() => {
      binInputRef.current?.focus();
    }, 100);
  }, []);

  const validateBin = async (bin: string): Promise<boolean> => {
    if (!bin || !bin.trim()) return false;

    // Debounce: prevent duplicate processing
    const now = Date.now();
    if (now - lastScanTimeRef.current < SCAN_DEBOUNCE_MS) {
      console.log("⏭️ Debounced duplicate scan");
      return true;
    }
    lastScanTimeRef.current = now;

    setLoading(true);
    try {
      const db = await getDatabase();
      const normalizedBin = bin.trim().toUpperCase();

      // Check local database first
      const localBin = await db.getFirstAsync<any>(
        "SELECT * FROM bin_master_cache WHERE bin_code = ? OR bin_barcode = ? OR bin_id = ?",
        [normalizedBin, normalizedBin, normalizedBin]
      );

      if (localBin) {
        console.log(`✅ Bin found in local database: ${localBin.bin_code}`);
        setBinInfo(localBin);
        setBinCode(localBin.bin_code);
        setLoading(false);
        return true;
      }

      // If not found locally, try backend
      try {
        const backendBin = await apiService.getBinMaster(normalizedBin);
        if (backendBin && (backendBin.bin_code || backendBin.bin_id)) {
          const binData = {
            bin_code: backendBin.bin_code || backendBin.bin_id || normalizedBin,
            bin_id: backendBin.bin_id || backendBin.bin_code || normalizedBin,
            bin_barcode: backendBin.bin_barcode || normalizedBin,
            warehouse_id: backendBin.warehouse_id || "",
            zone: backendBin.zone || "",
            aisle: backendBin.aisle || "",
          };

          // Save to local cache
          await db.runAsync(
            `INSERT OR REPLACE INTO bin_master_cache 
             (bin_code, bin_id, bin_barcode, warehouse_id, zone, aisle, updated_on)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              binData.bin_code,
              binData.bin_id,
              binData.bin_barcode,
              binData.warehouse_id,
              binData.zone,
              binData.aisle || "",
              new Date().toISOString(),
            ]
          );

          setBinInfo(binData);
          setBinCode(binData.bin_code);
          setLoading(false);
          return true;
        }
        throw new Error("Bin not found");
      } catch (backendError: any) {
        setLoading(false);
        Alert.alert(
          "Bin Not Found",
          `Bin location "${normalizedBin}" not found.\n\nPlease scan a valid bin location.`
        );
        setBinInfo(null);
        setBinCode("");
        return false;
      }
    } catch (error: any) {
      setLoading(false);
      console.error("❌ Error validating bin:", error);
      Alert.alert("Error", `Failed to validate bin: ${error.message}`);
      return false;
    }
  };

  const handleStartPicking = async () => {
    if (!binInfo || !binCode) {
      Alert.alert("Error", "Please scan a valid bin location first");
      return;
    }

    setLoading(true);
    try {
      const settings = await getSettings();
      let currentSessionId = sessionId;

      // If no session, create one
      if (!currentSessionId) {
        try {
          const response = await apiService.startPickingSession(
            materialRequestTitle,
            settings.user_id || ""
          );
          currentSessionId = response.session_id || response.data?.session_id;
        } catch (error: any) {
          // If backend fails, create local session
          currentSessionId = `PK-${materialRequestTitle}-${Date.now()}`;
          console.warn("⚠️ Backend session creation failed, using local session:", currentSessionId);
        }
      }

      // Save bin to session (API may not exist yet - that's OK)
      try {
        await apiService.scanBin(currentSessionId, binCode);
      } catch (error: any) {
        // Error already handled in API service, just continue
      }

      // Save session locally
      const session: PickingSession = {
        session_id: currentSessionId,
        material_request_title: materialRequestTitle,
        bin_location: binCode,
        carton_id: null,
        status: "In Progress",
        started_by: settings.user_id || "",
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await pickingSessionService.saveSession(session);

      // Navigate to Scan Carton screen
      (navigation as any).navigate("PickingScanCarton", {
        materialRequestTitle,
        sessionId: currentSessionId,
        binLocation: binCode,
        binInfo,
      });
    } catch (error: any) {
      setLoading(false);
      console.error("❌ Error starting picking:", error);
      Alert.alert("Error", `Failed to start picking: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Material Request Picking</Text>
        <Text style={styles.headerSubtitle}>Scan or Enter Bin Code</Text>
      </View>

      <View style={styles.inputSection}>
        <Text style={styles.inputLabel}>Bin Code</Text>
        <BarcodeInput
          ref={binInputRef}
          autoFocus
          placeholder="Scan or enter bin code"
          showSoftInputOnFocus
          onBarcodeScanned={async (raw) =>
            validateBin(raw.trim().toUpperCase())
          }
          containerStyle={styles.barcodeInputWrap}
          inputStyle={styles.input}
          submitButtonStyle={styles.submitButton}
          submitTextStyle={styles.submitButtonText}
          submitLabel="Submit"
        />
      </View>

      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={PickingTheme.colors.headerPurple} />
          <Text style={styles.loadingText}>Validating bin...</Text>
        </View>
      )}

      {binInfo && !loading && (
        <View style={styles.binInfoCard}>
          <Text style={styles.binInfoTitle}>Bin Information</Text>
          <View style={styles.binInfoRow}>
            <Text style={styles.binInfoLabel}>Bin Code:</Text>
            <Text style={styles.binInfoValue}>{binInfo.bin_code}</Text>
          </View>
          {binInfo.warehouse_id && (
            <View style={styles.binInfoRow}>
              <Text style={styles.binInfoLabel}>Warehouse:</Text>
              <Text style={styles.binInfoValue}>{binInfo.warehouse_id}</Text>
            </View>
          )}
          {binInfo.zone && (
            <View style={styles.binInfoRow}>
              <Text style={styles.binInfoLabel}>Zone:</Text>
              <Text style={styles.binInfoValue}>{binInfo.zone}</Text>
            </View>
          )}
          {binInfo.aisle && (
            <View style={styles.binInfoRow}>
              <Text style={styles.binInfoLabel}>Aisle:</Text>
              <Text style={styles.binInfoValue}>{binInfo.aisle}</Text>
            </View>
          )}
        </View>
      )}

      {binInfo && !loading && (
        <TouchableOpacity
          style={styles.startButton}
          onPress={handleStartPicking}
          disabled={loading}
        >
          <Text style={styles.startButtonText}>Start Picking</Text>
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
  header: {
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
  inputSection: {
    paddingHorizontal: PickingTheme.spacing.md,
    paddingTop: PickingTheme.spacing.sm,
    paddingBottom: PickingTheme.spacing.sm,
  },
  inputLabel: {
    ...PickingTheme.typography.h3,
    color: PickingTheme.colors.textPrimary,
    marginBottom: PickingTheme.spacing.sm,
  },
  barcodeInputWrap: {
    alignSelf: "stretch",
    width: "100%",
  },
  input: {
    flex: 1,
    backgroundColor: PickingTheme.colors.backgroundWhite,
    borderWidth: 2,
    borderColor: PickingTheme.colors.borderPurple,
    borderRadius: PickingTheme.borderRadius.small,
    padding: PickingTheme.spacing.md,
    ...PickingTheme.typography.body,
    minHeight: 60,
  },
  submitButton: {
    backgroundColor: PickingTheme.colors.headerPurple,
    borderColor: PickingTheme.colors.headerPurple,
    borderRadius: PickingTheme.borderRadius.small,
    minWidth: 80,
    paddingHorizontal: 14,
    minHeight: 60,
  },
  submitButtonText: {
    color: PickingTheme.colors.textWhite,
    fontWeight: "700",
    fontSize: 15,
  },
  loadingContainer: {
    padding: PickingTheme.spacing.lg,
    alignItems: "center",
  },
  loadingText: {
    marginTop: PickingTheme.spacing.md,
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textSecondary,
  },
  binInfoCard: {
    backgroundColor: PickingTheme.colors.backgroundCard,
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    marginTop: PickingTheme.spacing.md,
    marginHorizontal: PickingTheme.spacing.md,
    borderWidth: 1,
    borderColor: PickingTheme.colors.borderLight,
    ...PickingTheme.shadows.card,
  },
  binInfoTitle: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.textPrimary,
    marginBottom: PickingTheme.spacing.md,
  },
  binInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: PickingTheme.spacing.sm,
  },
  binInfoLabel: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textSecondary,
  },
  binInfoValue: {
    ...PickingTheme.typography.caption,
    fontWeight: "600",
    color: PickingTheme.colors.textPrimary,
  },
  startButton: {
    backgroundColor: PickingTheme.colors.buttonPurple,
    marginHorizontal: PickingTheme.spacing.md,
    marginTop: PickingTheme.spacing.lg,
    marginBottom: PickingTheme.spacing.xl,
    paddingVertical: 16,
    borderRadius: PickingTheme.borderRadius.medium,
    alignItems: "center",
    ...PickingTheme.shadows.button,
  },
  startButtonText: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.textWhite,
  },
});
