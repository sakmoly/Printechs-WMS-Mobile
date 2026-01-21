import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { PickingTheme } from "../theme/picking-theme";
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import { relocationSessionService, RelocationMode } from "../services/relocation-session.service";
import { getSettings } from "../services/settings.service";
import { apiService } from "../services/api.service";

export default function RelocationHomeScreen() {
  const navigation = useNavigation();
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkActiveSession();
  }, []);

  const checkActiveSession = async () => {
    try {
      const active = await relocationSessionService.hasActiveSession();
      setHasActiveSession(active);
    } catch (error: any) {
      console.error("❌ Error checking active session:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartRelocation = async (mode: RelocationMode) => {
    try {
      const settings = await getSettings();
      
      // ✅ NEW APPROACH: Store data locally only - NO backend API call
      // Session will be created only when user clicks "Complete"
      const sessionId = `RL-${Date.now()}`; // Local session ID for tracking
      
      // Create new local session (stored in SQLite, not on backend)
      const session = {
        session_id: sessionId,
        mode,
        from_bin: null,
        from_carton: null,
        to_bin: null,
        to_carton: null,
        scanned_lines: [],
        status: "Draft" as const,
        started_by: settings.user_id || settings.user_code || "USER",
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        warehouse: settings.warehouse || settings.warehouse_id || "DEFAULT",
        user_id: settings.user_id || settings.user_code || "USER",
      };

      // ✅ Save to local SQLite only (for resume functionality)
      await relocationSessionService.saveSession(session);

      console.log(`✅ Started relocation locally (no backend call): mode=${mode}, sessionId=${sessionId}`);

      // Navigate to first step: Scan From Bin
      (navigation as any).navigate("RelocationScanFromBin", {
        sessionId,
        mode,
      });
    } catch (error: any) {
      console.error("❌ Error starting relocation:", error);
      Alert.alert("Error", `Failed to start relocation: ${error.message}`);
    }
  };

  const handleResumeRelocation = async () => {
    try {
      const session = await relocationSessionService.loadSession();
      if (!session) {
        Alert.alert("Error", "No active session found");
        return;
      }

      // Determine which screen to navigate to based on session state
      let targetScreen = "RelocationScanFromBin";
      let params: any = { sessionId: session.session_id, mode: session.mode };

      if (session.from_bin && !session.from_carton) {
        targetScreen = "RelocationScanFromCarton";
      } else if (session.from_bin && session.from_carton && !session.to_bin) {
        targetScreen = "RelocationScanToBin";
      } else if (session.from_bin && session.from_carton && session.to_bin && !session.to_carton && session.mode !== "FULL_CARTON") {
        targetScreen = "RelocationScanToCarton";
      } else if (session.from_bin && session.from_carton && session.to_bin && (session.to_carton || session.mode === "FULL_CARTON")) {
        targetScreen = "RelocationExecute";
      }

      (navigation as any).navigate(targetScreen, params);
    } catch (error: any) {
      console.error("❌ Error resuming relocation:", error);
      Alert.alert("Error", `Failed to resume relocation: ${error.message}`);
    }
  };

  const handleClearSession = async () => {
    Alert.alert(
      "Clear Session",
      "Are you sure you want to clear the active relocation session?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await relocationSessionService.deleteSession();
            await checkActiveSession();
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerSection}>
        <Text style={styles.headerTitle}>Relocation / Bin Transfer</Text>
        <Text style={styles.headerSubtitle}>Move inventory between bins and cartons</Text>
      </View>

      <ScrollView 
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
      >
        {/* Resume Session Card */}
        {hasActiveSession && (
          <View style={styles.resumeCard}>
            <Text style={styles.resumeTitle}>📋 Active Session</Text>
            <Text style={styles.resumeText}>
              You have an active relocation session. Tap Resume to continue.
            </Text>
            <View style={styles.resumeButtons}>
              <TouchableOpacity
                style={[styles.button, styles.resumeButton]}
                onPress={handleResumeRelocation}
              >
                <Text style={styles.buttonText}>▶️ Resume Relocation</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.clearButton]}
                onPress={handleClearSession}
              >
                <Text style={styles.buttonText}>🗑️ Clear Session</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Mode Selection Cards */}
        <Text style={styles.sectionTitle}>Select Relocation Mode</Text>

        {/* Mode 1: Move Full Carton */}
        <TouchableOpacity
          style={styles.modeCard}
          onPress={() => handleStartRelocation("FULL_CARTON")}
        >
          <View style={styles.modeCardHeader}>
            <Text style={styles.modeIcon}>📦</Text>
            <View style={styles.modeCardContent}>
              <Text style={styles.modeTitle}>Move Full Carton</Text>
              <Text style={styles.modeDescription}>
                Move entire carton from one bin to another. Supports blind move or item verification.
              </Text>
            </View>
          </View>
          <Text style={styles.modeArrow}>→</Text>
        </TouchableOpacity>

        {/* Mode 2: Move Partial Items */}
        <TouchableOpacity
          style={styles.modeCard}
          onPress={() => handleStartRelocation("PARTIAL_ITEMS")}
        >
          <View style={styles.modeCardHeader}>
            <Text style={styles.modeIcon}>📋</Text>
            <View style={styles.modeCardContent}>
              <Text style={styles.modeTitle}>Move Partial Items</Text>
              <Text style={styles.modeDescription}>
                Move specific items from source carton to destination bin/carton. Scan items individually.
              </Text>
            </View>
          </View>
          <Text style={styles.modeArrow}>→</Text>
        </TouchableOpacity>

        {/* Mode 3: Carton to Carton */}
        <TouchableOpacity
          style={styles.modeCard}
          onPress={() => handleStartRelocation("CARTON_TO_CARTON")}
        >
          <View style={styles.modeCardHeader}>
            <Text style={styles.modeIcon}>🔄</Text>
            <View style={styles.modeCardContent}>
              <Text style={styles.modeTitle}>Carton → Carton (Merge/Split)</Text>
              <Text style={styles.modeDescription}>
                Move items between cartons. Useful for merging or splitting cartons.
              </Text>
            </View>
          </View>
          <Text style={styles.modeArrow}>→</Text>
        </TouchableOpacity>

        {/* Instructions */}
        <View style={styles.instructionsCard}>
          <Text style={styles.instructionsTitle}>📋 How It Works:</Text>
          <Text style={styles.instructionsText}>
            1. Select a relocation mode{'\n'}
            2. Scan FROM Bin Location{'\n'}
            3. Scan FROM Carton ID{'\n'}
            4. Scan TO Bin Location{'\n'}
            5. Scan TO Carton ID (if required){'\n'}
            6. Execute relocation{'\n'}
            7. Confirm completion
          </Text>
        </View>
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
  },
  contentContainer: {
    padding: PickingTheme.spacing.md,
  },
  resumeCard: {
    backgroundColor: PickingTheme.colors.backgroundCard,
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    marginBottom: PickingTheme.spacing.lg,
    ...PickingTheme.shadows.card,
  },
  resumeTitle: {
    ...PickingTheme.typography.h3,
    color: PickingTheme.colors.textPrimary,
    marginBottom: PickingTheme.spacing.sm,
  },
  resumeText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textSecondary,
    marginBottom: PickingTheme.spacing.md,
  },
  resumeButtons: {
    flexDirection: "row",
    gap: PickingTheme.spacing.sm,
  },
  button: {
    flex: 1,
    padding: PickingTheme.spacing.md,
    borderRadius: PickingTheme.borderRadius.medium,
    alignItems: "center",
    ...PickingTheme.shadows.button,
  },
  resumeButton: {
    backgroundColor: PickingTheme.colors.buttonGreen,
  },
  clearButton: {
    backgroundColor: "#F44336",
  },
  buttonText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
  },
  sectionTitle: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.textPrimary,
    marginBottom: PickingTheme.spacing.md,
  },
  modeCard: {
    backgroundColor: PickingTheme.colors.backgroundCard,
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    marginBottom: PickingTheme.spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    ...PickingTheme.shadows.card,
  },
  modeCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  modeIcon: {
    fontSize: 32,
    marginRight: PickingTheme.spacing.md,
  },
  modeCardContent: {
    flex: 1,
  },
  modeTitle: {
    ...PickingTheme.typography.h3,
    color: PickingTheme.colors.textPrimary,
    marginBottom: 4,
  },
  modeDescription: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textSecondary,
    lineHeight: 20,
  },
  modeArrow: {
    fontSize: 24,
    color: PickingTheme.colors.textSecondary,
    marginLeft: PickingTheme.spacing.sm,
  },
  instructionsCard: {
    backgroundColor: "rgba(142, 36, 170, 0.1)",
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    marginTop: PickingTheme.spacing.lg,
  },
  instructionsTitle: {
    ...PickingTheme.typography.h3,
    color: PickingTheme.colors.headerPurple,
    marginBottom: PickingTheme.spacing.sm,
  },
  instructionsText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textPrimary,
    lineHeight: 24,
  },
});
