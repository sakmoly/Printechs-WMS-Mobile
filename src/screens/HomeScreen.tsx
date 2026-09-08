import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { CommonActions, useNavigation } from "@react-navigation/native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../context/AppContext";
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import { apiService } from "../services/api.service";
import { saveSettings } from "../services/settings.service";
import { getAppVersionDetails } from "../utils/appVersion";

export default function HomeScreen() {
  const navigation = useNavigation();
  const [loggingOut, setLoggingOut] = useState(false);
  const insets = useSafeAreaInsets();
  const {
    settings,
    pendingEventsCount,
    activeASN,
    activeSession,
    setActiveASN,
    setActiveSession,
    refreshPendingEvents,
    refreshSettings,
    refreshDeviceSessionStatus,
    deviceSessionRestricted,
    deviceSessionBlockReason,
  } = useApp();

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      refreshPendingEvents();
      // Refresh settings to correct ASN format if needed
      refreshSettings();
      refreshDeviceSessionStatus();
    });
    return unsubscribe;
  }, [navigation, refreshSettings, refreshDeviceSessionStatus]);

  const goMenu = (route: string) => {
    if (deviceSessionRestricted) {
      Alert.alert(
        deviceSessionBlockReason === "disabled"
          ? "Device disabled"
          : "Device pending approval",
        deviceSessionBlockReason === "disabled"
          ? "This device was disabled. You can open Settings only. Contact an administrator."
          : "This device is not approved yet. You can open Settings only. Ask an administrator to approve this device."
      );
      return;
    }
    navigation.navigate(route as never);
  };

  const handleLogout = () => {
    Alert.alert(
      "Log out",
      "End this session and return to the sign-in screen?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Log out",
          style: "destructive",
          onPress: async () => {
            setLoggingOut(true);
            try {
              try {
                await apiService.logoutAuth();
              } catch {
                await saveSettings({
                  auth_token: null as any,
                  auth_token_expires: null as any,
                });
              }
              setActiveASN(null);
              setActiveSession(null);
              await saveSettings({
                active_asn: null,
                active_session: null,
                auth_token: null as any,
                auth_token_expires: null as any,
              });
              try {
                await refreshSettings();
              } catch {
                /* still leave app auth UI */
              }
              try {
                await refreshDeviceSessionStatus();
              } catch {
                /* ignore */
              }
              navigation.dispatch(
                CommonActions.reset({
                  index: 0,
                  routes: [{ name: "Login" as never }],
                })
              );
            } catch (e: any) {
              Alert.alert(
                "Log out",
                e?.message || "Something went wrong. Try again."
              );
            } finally {
              setLoggingOut(false);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: "#F5F5F5",
        paddingBottom: Math.max(insets.bottom - 16, 0),
      }}
      edges={["top"]}
    >
      <View style={{ flex: 1 }}>
        <ScrollView 
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
        >
        <View style={styles.banner}>
        <View style={styles.bannerHeaderRow}>
          <Text style={styles.bannerTitle}>Active Session</Text>
          <View style={styles.bannerLogoutColumn}>
            <TouchableOpacity
              style={[
                styles.bannerLogoutButton,
                loggingOut && styles.bannerLogoutButtonDisabled,
              ]}
              onPress={handleLogout}
              disabled={loggingOut}
              activeOpacity={0.85}
            >
              {loggingOut ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.bannerLogoutText}>Log out</Text>
              )}
            </TouchableOpacity>
            {(settings?.user_code || settings?.user_id) ? (
              <Text
                style={styles.bannerMetaTiny}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {settings?.user_code || settings?.user_id}
              </Text>
            ) : null}
            {settings?.device_id ? (
              <Text
                style={styles.bannerMetaTiny}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {settings.device_id}
              </Text>
            ) : null}
            <Text style={styles.bannerMetaTiny} numberOfLines={1}>
              v{getAppVersionDetails()}
            </Text>
          </View>
        </View>
        {deviceSessionRestricted && (
          <View style={styles.pendingDeviceBanner}>
            <Text style={styles.pendingDeviceText}>
              {deviceSessionBlockReason === "disabled"
                ? "This device was disabled by an administrator. Only Settings is available."
                : "Device pending administrator approval. Only Settings is available."}
            </Text>
          </View>
        )}
        {activeASN ? (
          <>
            <Text style={styles.bannerText}>ASN: {activeASN}</Text>
            {activeSession && (
              <Text style={styles.bannerText}>Session: {activeSession}</Text>
            )}
          </>
        ) : (
          <Text style={styles.bannerText}>No active session</Text>
        )}
        <View style={styles.pendingBadge}>
          <Text style={styles.pendingText}>
            Pending Events: {pendingEventsCount}
          </Text>
        </View>
      </View>

      <View style={styles.menu}>
        {/* Core menu — disabled until device is approved (server mobile session API). */}
        <TouchableOpacity
          style={[
            styles.menuItem,
            { borderLeftColor: "#007AFF" },
            deviceSessionRestricted && styles.menuItemDisabled,
          ]}
          onPress={() => goMenu("StartInbound")}
          disabled={deviceSessionRestricted}
        >
          <Text
            style={[
              styles.menuItemText,
              deviceSessionRestricted && styles.menuItemTextDisabled,
            ]}
          >
            Start Inbound
          </Text>
          <Text style={styles.menuItemArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.menuItem,
            { borderLeftColor: "#9C27B0" },
            deviceSessionRestricted && styles.menuItemDisabled,
          ]}
          onPress={() => goMenu("BoxManagement")}
          disabled={deviceSessionRestricted}
        >
          <Text
            style={[
              styles.menuItemText,
              deviceSessionRestricted && styles.menuItemTextDisabled,
            ]}
          >
            BOX Management
          </Text>
          <Text style={styles.menuItemArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.menuItem,
            { borderLeftColor: "#4CAF50" },
            deviceSessionRestricted && styles.menuItemDisabled,
          ]}
          onPress={() => goMenu("Dispatch")}
          disabled={deviceSessionRestricted}
        >
          <Text
            style={[
              styles.menuItemText,
              deviceSessionRestricted && styles.menuItemTextDisabled,
            ]}
          >
            Dispatch
          </Text>
          <Text style={styles.menuItemArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.menuItem,
            { borderLeftColor: "#795548" },
            deviceSessionRestricted && styles.menuItemDisabled,
          ]}
          onPress={() => goMenu("PutAway")}
          disabled={deviceSessionRestricted}
        >
          <Text
            style={[
              styles.menuItemText,
              deviceSessionRestricted && styles.menuItemTextDisabled,
            ]}
          >
            Put Away
          </Text>
          <Text style={styles.menuItemArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.menuItem,
            { borderLeftColor: "#FF9800" },
            deviceSessionRestricted && styles.menuItemDisabled,
          ]}
          onPress={() => goMenu("ASNList")}
          disabled={deviceSessionRestricted}
        >
          <Text
            style={[
              styles.menuItemText,
              deviceSessionRestricted && styles.menuItemTextDisabled,
            ]}
          >
            ASN List
          </Text>
          <Text style={styles.menuItemArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.menuItem,
            { borderLeftColor: "#E91E63" },
            deviceSessionRestricted && styles.menuItemDisabled,
          ]}
          onPress={() => goMenu("RemainingItems")}
          disabled={deviceSessionRestricted}
        >
          <Text
            style={[
              styles.menuItemText,
              deviceSessionRestricted && styles.menuItemTextDisabled,
            ]}
          >
            Remaining Items
          </Text>
          <Text style={styles.menuItemArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.menuItem,
            { borderLeftColor: "#2196F3" },
            deviceSessionRestricted && styles.menuItemDisabled,
          ]}
          onPress={() => goMenu("TransferInList")}
          disabled={deviceSessionRestricted}
        >
          <Text
            style={[
              styles.menuItemText,
              deviceSessionRestricted && styles.menuItemTextDisabled,
            ]}
          >
            Transfer In
          </Text>
          <Text style={styles.menuItemArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.menuItem,
            { borderLeftColor: "#4CAF50" },
            deviceSessionRestricted && styles.menuItemDisabled,
          ]}
          onPress={() => goMenu("StockLedgerList")}
          disabled={deviceSessionRestricted}
        >
          <Text
            style={[
              styles.menuItemText,
              deviceSessionRestricted && styles.menuItemTextDisabled,
            ]}
          >
            Stock Ledger
          </Text>
          <Text style={styles.menuItemArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.menuItem,
            { borderLeftColor: "#FF9800" },
            deviceSessionRestricted && styles.menuItemDisabled,
          ]}
          onPress={() => goMenu("MaterialRequestList")}
          disabled={deviceSessionRestricted}
        >
          <Text
            style={[
              styles.menuItemText,
              deviceSessionRestricted && styles.menuItemTextDisabled,
            ]}
          >
            Material Request
          </Text>
          <Text style={styles.menuItemArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.menuItem,
            { borderLeftColor: "#9C27B0" },
            deviceSessionRestricted && styles.menuItemDisabled,
          ]}
          onPress={() => goMenu("CycleCountDashboard")}
          disabled={deviceSessionRestricted}
        >
          <Text
            style={[
              styles.menuItemText,
              deviceSessionRestricted && styles.menuItemTextDisabled,
            ]}
          >
            Cycle Count
          </Text>
          <Text style={styles.menuItemArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.menuItem,
            { borderLeftColor: "#607D8B" },
            deviceSessionRestricted && styles.menuItemDisabled,
          ]}
          onPress={() => goMenu("RelocationHome")}
          disabled={deviceSessionRestricted}
        >
          <Text
            style={[
              styles.menuItemText,
              deviceSessionRestricted && styles.menuItemTextDisabled,
            ]}
          >
            Relocation / Bin Transfer
          </Text>
          <Text style={styles.menuItemArrow}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.menuItem, { borderLeftColor: "#546E7A" }]}
          onPress={() => navigation.navigate("Settings" as never)}
        >
          <Text style={styles.menuItemText}>Settings</Text>
          <Text style={styles.menuItemArrow}>→</Text>
        </TouchableOpacity>
        </View>
      </ScrollView>
      <ScreenFooterFrame />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    // Remove flex: 1 to allow footer to be visible
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40, // Add padding to account for footer frame
  },
  banner: {
    backgroundColor: "#007AFF",
    padding: 20,
    marginBottom: 16,
  },
  bannerHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 10,
  },
  bannerLogoutColumn: {
    alignItems: "flex-end",
    maxWidth: "52%",
  },
  bannerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 0,
  },
  bannerLogoutButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "rgba(183, 28, 28, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.35)",
    minWidth: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  bannerLogoutButtonDisabled: {
    opacity: 0.65,
  },
  bannerLogoutText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  bannerMetaTiny: {
    marginTop: 3,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.82)",
    textAlign: "right",
    alignSelf: "stretch",
  },
  bannerText: {
    fontSize: 14,
    color: "#fff",
    marginBottom: 4,
  },
  pendingBadge: {
    marginTop: 12,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    padding: 8,
    borderRadius: 4,
  },
  pendingText: {
    color: "#fff",
    fontWeight: "600",
  },
  pendingDeviceBanner: {
    marginTop: 10,
    padding: 10,
    backgroundColor: "rgba(255, 193, 7, 0.95)",
    borderRadius: 6,
  },
  pendingDeviceText: {
    color: "#333",
    fontSize: 14,
    fontWeight: "600",
  },
  menu: {
    padding: 16,
  },
  menuItem: {
    backgroundColor: "#fff",
    padding: 20,
    marginBottom: 12,
    borderRadius: 8,
    borderLeftWidth: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  menuItemText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  menuItemArrow: {
    fontSize: 24,
    color: "#999",
  },
  menuItemDisabled: {
    opacity: 0.45,
  },
  menuItemTextDisabled: {
    color: "#999",
  },
  continueButton: {
    backgroundColor: "#4CAF50",
    padding: 24,
    marginBottom: 12,
    borderRadius: 8,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  continueButtonText: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 4,
  },
  continueButtonSubtext: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.9)",
  },
  workflowGroup: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#666",
    marginBottom: 12,
    marginTop: 8,
    paddingLeft: 4,
  },
});
