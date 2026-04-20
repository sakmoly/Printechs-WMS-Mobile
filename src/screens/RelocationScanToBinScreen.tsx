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
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import { apiService } from "../services/api.service";
import { getDatabase } from "../database/database";
import { relocationSessionService } from "../services/relocation-session.service";
import {
  BarcodeInput,
  type BarcodeInputHandle,
} from "../components/BarcodeInput";

export default function RelocationScanToBinScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const routeParams = (route.params as any) || {};
  const { sessionId, mode, fromBin, fromCarton, binInfo } = routeParams;

  const [binCode, setBinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [toBinInfo, setToBinInfo] = useState<any>(null);
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
        setToBinInfo(localBin);
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

          setToBinInfo(binData);
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
        setToBinInfo(null);
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

  const handleContinue = async () => {
    if (!toBinInfo || !binCode) {
      Alert.alert("Error", "Please scan a valid bin location first");
      return;
    }

    setLoading(true);
    try {
      // ✅ NEW APPROACH: Update local session only - NO backend API call
      // Validation will happen when user clicks "Complete"
      // Bin validation (existence check) is already done via getBinMaster() in validateBin()
      
      // Update session locally (SQLite only)
      await relocationSessionService.updateSession({
        to_bin: binCode,
        status: "In Progress",
      });

      console.log(`✅ Saved TO bin to local session: ${binCode} (no backend call)`);

      // Determine next screen based on mode
      // FULL_CARTON: to_carton is optional (can keep same carton)
      // PARTIAL_ITEMS and CARTON_TO_CARTON: to_carton is required
      if (mode === "FULL_CARTON") {
        // Navigate directly to Execute screen (user can choose to keep same carton or scan new one)
        (navigation as any).navigate("RelocationScanToCarton", {
          sessionId,
          mode,
          fromBin,
          fromCarton,
          toBin: binCode,
          toBinInfo: toBinInfo,
        });
      } else {
        // PARTIAL_ITEMS or CARTON_TO_CARTON: require to_carton
        (navigation as any).navigate("RelocationScanToCarton", {
          sessionId,
          mode,
          fromBin,
          fromCarton,
          toBin: binCode,
          toBinInfo: toBinInfo,
        });
      }
    } catch (error: any) {
      setLoading(false);
      console.error("❌ Error saving to bin:", error);
      Alert.alert("Error", `Failed to save bin location: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerSection}>
        <Text style={styles.headerTitle}>Relocation / Bin Transfer</Text>
        <Text style={styles.headerSubtitle}>Scan TO Bin Location</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <View style={styles.scanCard}>
          <Text style={styles.scanCardIcon}>📍</Text>
          <View style={styles.scanCardContent}>
            <Text style={styles.scanCardTitle}>Scan TO Bin Location</Text>
            <Text style={styles.scanCardSubtitle}>
              Scan or enter the destination bin location where items will be moved
            </Text>
          </View>
        </View>

        <View style={styles.inputSection}>
          <Text style={styles.inputLabel}>TO Bin Location</Text>
          <BarcodeInput
            ref={binInputRef}
            autoFocus
            placeholder="Scan or enter bin code"
            onBarcodeScanned={async (raw) =>
              validateBin(raw.trim().toUpperCase())
            }
            containerStyle={{ alignSelf: "stretch" }}
            inputStyle={styles.input}
          />
        </View>

        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={PickingTheme.colors.headerOrange} />
            <Text style={styles.loadingText}>Validating bin...</Text>
          </View>
        )}

        {toBinInfo && !loading && (
          <View style={styles.binInfoCard}>
            <Text style={styles.binInfoTitle}>✅ Bin Information</Text>
            <View style={styles.binInfoRow}>
              <Text style={styles.binInfoLabel}>Bin Code:</Text>
              <Text style={styles.binInfoValue}>{toBinInfo.bin_code}</Text>
            </View>
            {toBinInfo.warehouse_id && (
              <View style={styles.binInfoRow}>
                <Text style={styles.binInfoLabel}>Warehouse:</Text>
                <Text style={styles.binInfoValue}>{toBinInfo.warehouse_id}</Text>
              </View>
            )}
            {toBinInfo.zone && (
              <View style={styles.binInfoRow}>
                <Text style={styles.binInfoLabel}>Zone:</Text>
                <Text style={styles.binInfoValue}>{toBinInfo.zone}</Text>
              </View>
            )}
            {toBinInfo.aisle && (
              <View style={styles.binInfoRow}>
                <Text style={styles.binInfoLabel}>Aisle:</Text>
                <Text style={styles.binInfoValue}>{toBinInfo.aisle}</Text>
              </View>
            )}
          </View>
        )}

        {toBinInfo && !loading && (
          <TouchableOpacity
            style={styles.continueButton}
            onPress={handleContinue}
            disabled={loading}
          >
            <Text style={styles.continueButtonText}>
              {mode === "FULL_CARTON" 
                ? "Continue to Carton Selection" 
                : "Continue to Scan TO Carton"}
            </Text>
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
  content: {
    flex: 1,
    backgroundColor: PickingTheme.colors.headerOrange,
    borderTopLeftRadius: PickingTheme.borderRadius.xlarge,
    borderTopRightRadius: PickingTheme.borderRadius.xlarge,
    marginTop: PickingTheme.spacing.xs,
  },
  contentContainer: {
    padding: PickingTheme.spacing.md,
  },
  scanCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    marginBottom: PickingTheme.spacing.md,
  },
  scanCardIcon: {
    fontSize: 32,
    marginRight: PickingTheme.spacing.md,
  },
  scanCardContent: {
    flex: 1,
  },
  scanCardTitle: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.textWhite,
    marginBottom: 4,
  },
  scanCardSubtitle: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textWhite,
    opacity: 0.9,
  },
  inputSection: {
    marginBottom: PickingTheme.spacing.md,
  },
  inputLabel: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    marginBottom: PickingTheme.spacing.sm,
    fontWeight: "600",
  },
  input: {
    backgroundColor: PickingTheme.colors.backgroundLight,
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    ...PickingTheme.typography.body,
    fontSize: 16,
    borderWidth: 2,
    borderColor: PickingTheme.colors.borderLight,
  },
  loadingContainer: {
    alignItems: "center",
    marginTop: PickingTheme.spacing.lg,
  },
  loadingText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    marginTop: PickingTheme.spacing.sm,
  },
  binInfoCard: {
    backgroundColor: PickingTheme.colors.backgroundCard,
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    marginTop: PickingTheme.spacing.md,
    ...PickingTheme.shadows.card,
  },
  binInfoTitle: {
    ...PickingTheme.typography.h3,
    color: PickingTheme.colors.textPrimary,
    marginBottom: PickingTheme.spacing.sm,
  },
  binInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: PickingTheme.spacing.xs,
  },
  binInfoLabel: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textSecondary,
  },
  binInfoValue: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textPrimary,
    fontWeight: "600",
  },
  continueButton: {
    backgroundColor: PickingTheme.colors.backgroundLight,
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    marginTop: PickingTheme.spacing.lg,
    alignItems: "center",
    ...PickingTheme.shadows.button,
  },
  continueButtonText: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.headerOrange,
    fontWeight: "600",
  },
});
