import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { PickingTheme } from "../theme/picking-theme";
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import { apiService } from "../services/api.service";
import { relocationSessionService } from "../services/relocation-session.service";

export default function RelocationScanToCartonScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const routeParams = (route.params as any) || {};
  const { sessionId, mode, fromBin, fromCarton, toBin, toBinInfo } = routeParams;

  const [cartonId, setCartonId] = useState("");
  const [loading, setLoading] = useState(false);
  const cartonInputRef = useRef<TextInput>(null);
  const lastScanTimeRef = useRef<number>(0);
  const SCAN_DEBOUNCE_MS = 700;

  useEffect(() => {
    // Auto-focus input on mount
    setTimeout(() => {
      cartonInputRef.current?.focus();
    }, 100);
  }, []);

  const handleKeepSameCarton = async () => {
    if (!fromCarton) {
      Alert.alert("Error", "No source carton ID available");
      return;
    }

    setLoading(true);
    try {
      // ✅ NEW APPROACH: Update local session only - NO backend API call
      await relocationSessionService.updateSession({
        to_carton: fromCarton,
        status: "In Progress",
      });

      console.log(`✅ Saved TO carton (same as FROM) to local session: ${fromCarton} (no backend call)`);

      // Navigate to Execute screen
      (navigation as any).navigate("RelocationExecute", {
        sessionId,
        mode,
        fromBin,
        fromCarton,
        toBin,
        toCarton: fromCarton,
      });
    } catch (error: any) {
      setLoading(false);
      console.error("❌ Error saving carton:", error);
      Alert.alert("Error", `Failed to save carton: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    if (!cartonId || !cartonId.trim()) {
      Alert.alert("Error", "Please scan or enter a carton ID");
      return;
    }

    // Debounce: prevent duplicate processing
    const now = Date.now();
    if (now - lastScanTimeRef.current < SCAN_DEBOUNCE_MS) {
      console.log("⏭️ Debounced duplicate scan");
      return;
    }
    lastScanTimeRef.current = now;

    setLoading(true);
    try {
      const normalizedCarton = cartonId.trim().toUpperCase();

      // Validation: FULL_CARTON mode requires same carton ID
      if (mode === "FULL_CARTON" && fromCarton && normalizedCarton !== fromCarton.toUpperCase()) {
        setLoading(false);
        Alert.alert(
          "Invalid Carton ID",
          "FULL_CARTON mode is for moving a carton from one bin to another.\n\n" +
          "The destination carton ID must be the same as the source carton ID.\n\n" +
          "If you want to move items to a different carton, please use 'Carton → Carton' mode instead.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Use Same Carton", onPress: () => handleKeepSameCarton() }
          ]
        );
        return;
      }

      // ✅ NEW APPROACH: Update local session only - NO backend API call
      // Validation will happen when user clicks "Complete"
      
      // Update session locally (SQLite only)
      await relocationSessionService.updateSession({
        to_carton: normalizedCarton,
        status: "In Progress",
      });

      console.log(`✅ Saved TO carton to local session: ${normalizedCarton} (no backend call)`);

      // Navigate to Execute screen
      (navigation as any).navigate("RelocationExecute", {
        sessionId,
        mode,
        fromBin,
        fromCarton,
        toBin,
        toCarton: normalizedCarton,
      });
    } catch (error: any) {
      setLoading(false);
      console.error("❌ Error saving to carton:", error);
      Alert.alert("Error", `Failed to save carton ID: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (text: string) => {
    setCartonId(text.toUpperCase());
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerSection}>
        <Text style={styles.headerTitle}>Relocation / Bin Transfer</Text>
        <Text style={styles.headerSubtitle}>Scan TO Carton ID</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <View style={styles.scanCard}>
          <Text style={styles.scanCardIcon}>📦</Text>
          <View style={styles.scanCardContent}>
            <Text style={styles.scanCardTitle}>Scan TO Carton ID</Text>
            <Text style={styles.scanCardSubtitle}>
              {mode === "FULL_CARTON"
                ? "Scan a new carton ID or keep the same carton"
                : "Scan or enter the destination carton ID"}
            </Text>
          </View>
        </View>

        {/* Keep Same Carton button (only for FULL_CARTON mode) */}
        {mode === "FULL_CARTON" && fromCarton && (
          <TouchableOpacity
            style={styles.keepSameButton}
            onPress={handleKeepSameCarton}
            disabled={loading}
          >
            <Text style={styles.keepSameButtonText}>
              ✅ Keep Same Carton ({fromCarton})
            </Text>
          </TouchableOpacity>
        )}

        <View style={styles.inputSection}>
          <Text style={styles.inputLabel}>TO Carton ID</Text>
          <TextInput
            ref={cartonInputRef}
            style={styles.input}
            value={cartonId}
            onChangeText={handleInputChange}
            placeholder="Scan or enter carton ID"
            autoCapitalize="characters"
            autoFocus={true}
            showSoftInputOnFocus={false}
            onSubmitEditing={() => {
              // Only submit if carton ID is not empty
              if (cartonId && cartonId.trim()) {
                handleContinue();
              }
            }}
            blurOnSubmit={false}
          />
        </View>

        {cartonId.trim() && !loading && (
          <TouchableOpacity
            style={styles.continueButton}
            onPress={handleContinue}
            disabled={loading}
          >
            <Text style={styles.continueButtonText}>Continue to Execute</Text>
          </TouchableOpacity>
        )}

        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={PickingTheme.colors.headerOrange} />
            <Text style={styles.loadingText}>Processing...</Text>
          </View>
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
  keepSameButton: {
    backgroundColor: PickingTheme.colors.buttonGreen,
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    marginBottom: PickingTheme.spacing.md,
    alignItems: "center",
    ...PickingTheme.shadows.button,
  },
  keepSameButtonText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
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
