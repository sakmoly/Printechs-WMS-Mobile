import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
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

export default function PickingScanCartonScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const routeParams = (route.params as any) || {};
  const { materialRequestTitle, sessionId, binLocation, binInfo } = routeParams;

  const [cartonId, setCartonId] = useState("");
  const [loading, setLoading] = useState(false);
  const [cartonValidated, setCartonValidated] = useState(false);
  const [cartonInfo, setCartonInfo] = useState<any>(null);
  const cartonInputRef = useRef<TextInput>(null);
  const lastScanTimeRef = useRef<number>(0);
  const SCAN_DEBOUNCE_MS = 700;

  useEffect(() => {
    // Auto-focus input on mount
    setTimeout(() => {
      cartonInputRef.current?.focus();
    }, 100);
  }, []);

  // Validate carton ID when entered (for handheld scanner)
  const validateCarton = async (carton: string) => {
    if (!carton || !carton.trim()) {
      setCartonValidated(false);
      setCartonInfo(null);
      return;
    }

    // Debounce: prevent duplicate processing
    const now = Date.now();
    if (now - lastScanTimeRef.current < SCAN_DEBOUNCE_MS) {
      console.log("⏭️ Debounced duplicate carton validation");
      return;
    }
    lastScanTimeRef.current = now;

    setLoading(true);
    try {
      const db = await getDatabase();
      const normalizedCarton = carton.trim().toUpperCase();

      // Check local database first (box_cache, carton_status_cache, asn_carton_map)
      // Try box_cache first (box_id)
      let localCarton = await db.getFirstAsync<any>(
        `SELECT box_id, asn_no, to_no, store, status FROM box_cache WHERE box_id = ? LIMIT 1`,
        [normalizedCarton]
      );

      if (localCarton) {
        console.log(`✅ Carton found in box_cache: ${localCarton.box_id}`);
        setCartonInfo({
          carton_id: localCarton.box_id,
          box_id: localCarton.box_id,
          asn_no: localCarton.asn_no,
        });
        setCartonValidated(true);
        setLoading(false);
        return;
      }

      // Try carton_status_cache (carton_id)
      localCarton = await db.getFirstAsync<any>(
        `SELECT carton_id, asn_no FROM carton_status_cache WHERE carton_id = ? LIMIT 1`,
        [normalizedCarton]
      );

      if (localCarton) {
        console.log(`✅ Carton found in carton_status_cache: ${localCarton.carton_id}`);
        setCartonInfo({
          carton_id: localCarton.carton_id,
          box_id: localCarton.carton_id,
          asn_no: localCarton.asn_no,
        });
        setCartonValidated(true);
        setLoading(false);
        return;
      }

      // Try asn_carton_map (carton_id)
      localCarton = await db.getFirstAsync<any>(
        `SELECT DISTINCT carton_id, asn_no FROM asn_carton_map WHERE carton_id = ? LIMIT 1`,
        [normalizedCarton]
      );

      if (localCarton) {
        console.log(`✅ Carton found in asn_carton_map: ${localCarton.carton_id}`);
        setCartonInfo({
          carton_id: localCarton.carton_id,
          box_id: localCarton.carton_id,
          asn_no: localCarton.asn_no,
        });
        setCartonValidated(true);
        setLoading(false);
        return;
      }

      // If not found locally, try backend API (if we have required parameters)
      // Note: getBoxes API requires 'asn' and 'store' parameters, so we skip backend validation
      // if we don't have them. The carton will be validated when items are scanned.
      console.log("ℹ️ Carton not found in local cache. Backend validation requires 'asn' and 'store' parameters.");
      console.log("ℹ️ Allowing carton to proceed - validation will occur during item scanning.");
      
      // Accept the carton ID even if not found in cache (offline mode or cache miss)
      // The carton will be validated when items are actually scanned
      setCartonInfo({
        carton_id: normalizedCarton,
        box_id: normalizedCarton,
        asn_no: null,
      });
      setCartonValidated(true);
      setLoading(false);
    } catch (error: any) {
      setLoading(false);
      console.error("❌ Error validating carton:", error);
      Alert.alert("Error", `Failed to validate carton: ${error.message}`);
      setCartonInfo(null);
      setCartonValidated(false);
    }
  };

  // Handle carton input change (for handheld scanner)
  const handleCartonInputChange = (text: string) => {
    setCartonId(text);
    // Auto-validate when text is entered (for handheld scanner that sends Enter)
    if (text.trim().length > 0) {
      // Small delay to allow full barcode to be entered
      setTimeout(() => {
        validateCarton(text.trim());
      }, 300);
    } else {
      setCartonValidated(false);
      setCartonInfo(null);
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
          <TextInput
            ref={cartonInputRef}
            style={styles.cartonInput}
            value={cartonId}
            onChangeText={handleCartonInputChange}
            placeholder="Scan or enter carton ID"
            autoCapitalize="characters"
            autoFocus={true}
            showSoftInputOnFocus={false}
            onSubmitEditing={() => {
              if (cartonId.trim()) {
                validateCarton(cartonId.trim());
              }
            }}
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
    flexDirection: "row",
    gap: PickingTheme.spacing.md,
    marginTop: PickingTheme.spacing.sm,
  },
  cartonInput: {
    flex: 1,
    backgroundColor: PickingTheme.colors.backgroundWhite,
    borderRadius: PickingTheme.borderRadius.small,
    padding: PickingTheme.spacing.md,
    ...PickingTheme.typography.body,
  },
  cartonScanButton: {
    backgroundColor: PickingTheme.colors.buttonBlue,
    paddingHorizontal: PickingTheme.spacing.lg,
    paddingVertical: PickingTheme.spacing.md,
    borderRadius: PickingTheme.borderRadius.small,
    justifyContent: "center",
  },
  cartonScanButtonText: {
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
    ...PickingTheme.typography.body,
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
