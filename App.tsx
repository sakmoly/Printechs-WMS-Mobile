import "react-native-gesture-handler";
/** Patch console before any other app modules load (reduces Metro / JS thread noise). */
import "./src/utils/logger";
import React, { useEffect, useState, useRef } from "react";
import {
  NavigationContainer,
  useNavigationContainerRef,
} from "@react-navigation/native";
import * as NavigationBar from "expo-navigation-bar";
import { createStackNavigator } from "@react-navigation/stack";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { AppProvider, useApp } from "./src/context/AppContext";
import { getDatabase } from "./src/database/database";
import {
  syncMasterDataFromDesktop,
  type MasterSyncProgress,
} from "./src/services/master-data-sync.service";
import { resendReceiveLinesToBackend } from "./src/services/receive-lines-resend.service";
import { syncEvents } from "./src/services/event-queue.service";
import { syncAllUnsyncedSessions } from "./src/services/session-sync.service";

// Screens
import LoginScreen from "./src/screens/LoginScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import ChangePasswordScreen from "./src/screens/ChangePasswordScreen";
import SetupPasswordScreen from "./src/screens/SetupPasswordScreen";
import HomeScreen from "./src/screens/HomeScreen";
import StartInboundScreen from "./src/screens/StartInboundScreen";
import UnloadScreen from "./src/screens/UnloadScreen";
import ReceiveSortScreen from "./src/screens/ReceiveSortScreen";
import BoxManagementScreen from "./src/screens/BoxManagementScreen";
import PackingScreen from "./src/screens/PackingScreen";
import DispatchScreen from "./src/screens/DispatchScreen";
import SyncCenterScreen from "./src/screens/SyncCenterScreen";
import PutAwayScreen from "./src/screens/PutAwayScreen";
import ASNListScreen from "./src/screens/ASNListScreen";

import TransferInListScreen from "./src/screens/TransferInListScreen";
import TransferInDetailScreen from "./src/screens/TransferInDetailScreen";
import TransferInReceivingScreen from "./src/screens/TransferInReceivingScreen";
import TransferInReceivingScanCartonScreen from "./src/screens/TransferInReceivingScanCartonScreen";
import TransferInReceivingScanItemsScreen from "./src/screens/TransferInReceivingScanItemsScreen";
import StockLedgerListScreen from "./src/screens/StockLedgerListScreen";
import StockDetailScreen from "./src/screens/StockDetailScreen";
import StockTransactionHistoryScreen from "./src/screens/StockTransactionHistoryScreen";
import MaterialRequestListScreen from "./src/screens/MaterialRequestListScreen";
import MaterialRequestDetailScreen from "./src/screens/MaterialRequestDetailScreen";
import MaterialRequestScanLocationScreen from "./src/screens/MaterialRequestScanLocationScreen";
import MaterialRequestPackingScreen from "./src/screens/MaterialRequestPackingScreen";
import PickingScanBinScreen from "./src/screens/PickingScanBinScreen";
import PickingScanCartonScreen from "./src/screens/PickingScanCartonScreen";
import PickingScanItemsScreen from "./src/screens/PickingScanItemsScreen";
import CycleCountListScreen from "./src/screens/CycleCountListScreen";
import CycleCountDetailScreen from "./src/screens/CycleCountDetailScreen";
import CycleCountCountingScreen from "./src/screens/CycleCountCountingScreen";
import CycleCountDashboardScreen from "./src/screens/CycleCountDashboardScreen";
import CycleCountScanBinScreen from "./src/screens/CycleCountScanBinScreen";
import CycleCountBinCountingScreen from "./src/screens/CycleCountBinCountingScreen";
import CycleCountDraftsScreen from "./src/screens/CycleCountDraftsScreen";
import CycleCountHistoryScreen from "./src/screens/CycleCountHistoryScreen";
import RemainingItemsScreen from "./src/screens/RemainingItemsScreen";
import RelocationHomeScreen from "./src/screens/RelocationHomeScreen";
import RelocationScanFromBinScreen from "./src/screens/RelocationScanFromBinScreen";
import RelocationScanFromCartonScreen from "./src/screens/RelocationScanFromCartonScreen";
import RelocationScanToBinScreen from "./src/screens/RelocationScanToBinScreen";
import RelocationScanToCartonScreen from "./src/screens/RelocationScanToCartonScreen";
import RelocationExecuteScreen from "./src/screens/RelocationExecuteScreen";

const Stack = createStackNavigator();

// Header Sync Button Component (must be inside AppProvider to access context)
const formatHeaderSyncProgress = (p: MasterSyncProgress) =>
  `${p.phase} (${p.step}/${p.totalSteps})${p.detail ? ` — ${p.detail}` : ""}`;

const SyncHeaderButton = () => {
  const {
    refreshPendingEvents,
    pendingEventsCount,
    activeASN,
    activeSession,
    deviceSessionRestricted,
    deviceSessionBlockReason,
  } = useApp();
  const [syncing, setSyncing] = useState(false);
  const [syncStatusLine, setSyncStatusLine] = useState("");
  const [isOnline, setIsOnline] = useState<boolean | null>(null); // null = checking

  // Check network status periodically
  useEffect(() => {
    const checkNetworkStatus = async () => {
      try {
        const { isDeviceOnline } = await import("./src/utils/network-check");
        const online = await isDeviceOnline();
        setIsOnline(online);
      } catch (error) {
        setIsOnline(false);
      }
    };

    // Check immediately
    checkNetworkStatus();

    // Check every 30 seconds
    const interval = setInterval(checkNetworkStatus, 30000);

    return () => clearInterval(interval);
  }, []);

  const handleSync = async () => {
    if (deviceSessionRestricted) {
      Alert.alert(
        deviceSessionBlockReason === "disabled"
          ? "Device disabled"
          : "Device pending approval",
        deviceSessionBlockReason === "disabled"
          ? "This device was disabled by an administrator. Only Settings is available."
          : "This device is not approved yet. Only Settings is available until an administrator approves it."
      );
      return;
    }
    if (syncing) {
      return; // Prevent multiple simultaneous syncs
    }

    setSyncing(true);
    setSyncStatusLine("Starting…");
    try {
      // Update online status before sync
      try {
        const { isDeviceOnline } = await import("./src/utils/network-check");
        const online = await isDeviceOnline();
        setIsOnline(online);
      } catch (error) {
        setIsOnline(false);
      }

      // First sync master data from desktop (includes all master data: items, ASNs, bins, stock ledger, etc.)
      try {
        setSyncStatusLine("Master: starting…");
        const masterResult = await syncMasterDataFromDesktop({
          onProgress: (p) => {
            setSyncStatusLine(`Master: ${formatHeaderSyncProgress(p)}`);
          },
        });
        console.warn("✅ Master data sync completed:", {
          items: masterResult.items.synced,
          asns: masterResult.asns.synced,
          transferOrders: masterResult.transferOrders.synced,
          boxes: masterResult.boxes.synced,
          transferCartons: masterResult.transferCartons.synced,
          warehouses: masterResult.warehouses.synced,
          locations: masterResult.locations.synced,
          binMaster: masterResult.binMaster.synced,
          stockLedger: masterResult.stockLedger.synced,
          itemBarcodeMap: masterResult.itemBarcodeMap.synced,
        });
      } catch (error: any) {
        console.warn("⚠️ Master data sync error:", error.message);
        setSyncStatusLine("Master: error (continuing)…");
        // Continue with event sync even if master sync fails
      }

      // Small delay between master data and session sync
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Sync sessions to backend
      setSyncStatusLine("Sessions: uploading…");
      try {
        const sessionResult = await syncAllUnsyncedSessions();
        console.warn(
          `✅ Session sync: ${sessionResult.synced} synced, ${sessionResult.failed} failed`
        );
      } catch (error: any) {
        console.warn("⚠️ Session sync error:", error.message);
        // Continue with event sync even if session sync fails
      }

      // Small delay between session sync and event sync
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Then sync events to desktop
      setSyncStatusLine("Events: uploading…");
      const result = await syncEvents();
      await refreshPendingEvents();

      if (activeASN && activeSession) {
        setSyncStatusLine("Receive data: syncing…");
        try {
          await resendReceiveLinesToBackend(activeASN, activeSession);
        } catch (e: any) {
          console.warn("Receive lines resend:", e?.message);
        }
      }

      setSyncStatusLine("");
      Alert.alert(
        "Sync Complete",
        `Events synced: ${result.synced}\nEvents failed: ${result.failed}\n\nMaster data and sessions have been synced.`
      );
    } catch (error: any) {
      setSyncStatusLine("");
      Alert.alert("Sync Error", error.message || "Failed to sync data");
    } finally {
      setSyncing(false);
      setSyncStatusLine("");
    }
  };

  // Determine status indicator color
  const getStatusColor = () => {
    if (syncing) return "#FFA500"; // Orange/Yellow when syncing
    if (isOnline === null) return "#757575"; // Gray when checking
    if (isOnline) return pendingEventsCount > 0 ? "#FFA500" : "#4CAF50"; // Green if online and no pending, Orange if pending
    return "#F44336"; // Red if offline
  };

  const getStatusLabel = () => {
    if (syncing) return "Syncing";
    if (isOnline === null) return "Checking";
    if (isOnline) return "Online";
    return "Offline";
  };

  return (
    <TouchableOpacity
      style={[
        syncButtonStyles.button,
        syncing && syncButtonStyles.buttonDisabled,
      ]}
      onPress={handleSync}
      activeOpacity={0.7}
      disabled={syncing}
    >
      {syncing ? (
        <View style={syncButtonStyles.syncingWrap}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={syncButtonStyles.syncProgressText} numberOfLines={4}>
            {syncStatusLine || "Syncing…"}
          </Text>
        </View>
      ) : (
        <View style={syncButtonStyles.syncContent}>
          {/* Status Indicator with Label */}
          <View style={syncButtonStyles.statusRow}>
            <View
              style={[
                syncButtonStyles.statusDot,
                { backgroundColor: getStatusColor() },
              ]}
            />
            <Text style={syncButtonStyles.statusLabel}>{getStatusLabel()}</Text>
            {pendingEventsCount > 0 && (
              <View style={syncButtonStyles.badge}>
                <Text style={syncButtonStyles.badgeText}>
                  {pendingEventsCount > 99 ? "99+" : pendingEventsCount}
                </Text>
              </View>
            )}
          </View>
          {/* Sync Icon and Text */}
          <View style={syncButtonStyles.syncRow}>
            <Text style={syncButtonStyles.icon}>🔄</Text>
            <Text style={syncButtonStyles.text}>Sync</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
};

const syncButtonStyles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.25)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 10,
    minWidth: 90,
    maxWidth: 280,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  syncContent: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  syncingWrap: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    maxWidth: 260,
    paddingVertical: 2,
  },
  syncProgressText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 4,
    lineHeight: 12,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
    position: "relative",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 4,
  },
  statusLabel: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "500",
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -12,
    backgroundColor: "#F44336",
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  badgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "bold",
  },
  syncRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    fontSize: 14,
    marginRight: 4,
  },
  text: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
});

function AppNavigation() {
  const navigationRef = useNavigationContainerRef();
  const { deviceSessionRestricted, refreshDeviceSessionStatus } = useApp();
  const redirectGuard = useRef(false);

  useEffect(() => {
    refreshDeviceSessionStatus();
  }, [refreshDeviceSessionStatus]);

  const onNavStateChange = () => {
    if (!deviceSessionRestricted) return;
    const nav = navigationRef as any;
    if (!nav?.getCurrentRoute) return;
    if (redirectGuard.current) return;
    const name = nav.getCurrentRoute()?.name as string | undefined;
    const allowed = new Set(["Login", "Home", "Settings"]);
    if (name && !allowed.has(name)) {
      redirectGuard.current = true;
      nav.navigate("Home" as never);
      setTimeout(() => {
        redirectGuard.current = false;
      }, 300);
    }
  };

  return (
    <NavigationContainer
      ref={navigationRef}
      onStateChange={onNavStateChange}
    >
      <Stack.Navigator
        initialRouteName="Login"
        screenOptions={({ navigation, route }) => ({
          headerStyle: {
            backgroundColor: "#007AFF",
          },
          headerTintColor: "#fff",
          headerTitleStyle: {
            fontWeight: "bold",
          },
          headerRight: () => {
            if (route.name === "Login" || route.name === "BoxManagement") {
              return null;
            }
            if (deviceSessionRestricted) {
              return null;
            }
            return <SyncHeaderButton />;
          },
        })}
      >
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen
          name="ChangePassword"
          component={ChangePasswordScreen}
          options={{ title: "Change Password" }}
        />
        <Stack.Screen
          name="SetupPassword"
          component={SetupPasswordScreen}
          options={{ title: "Create Password" }}
        />
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{
            headerLeft: () => null,
            gestureEnabled: false,
          }}
        />
        <Stack.Screen name="StartInbound" component={StartInboundScreen} />
        <Stack.Screen name="Unload" component={UnloadScreen} />
        <Stack.Screen name="ReceiveSort" component={ReceiveSortScreen} />
        <Stack.Screen
          name="BoxManagement"
          component={BoxManagementScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen name="Packing" component={PackingScreen} />
        <Stack.Screen name="Dispatch" component={DispatchScreen} />
        <Stack.Screen name="PutAway" component={PutAwayScreen} />
        <Stack.Screen name="SyncCenter" component={SyncCenterScreen} />
        <Stack.Screen name="ASNList" component={ASNListScreen} />
        <Stack.Screen
          name="TransferInList"
          component={TransferInListScreen}
        />
        <Stack.Screen
          name="TransferInDetail"
          component={TransferInDetailScreen}
        />
        <Stack.Screen
          name="TransferInReceiving"
          component={TransferInReceivingScreen}
        />
        <Stack.Screen
          name="TransferInReceivingScanCarton"
          component={TransferInReceivingScanCartonScreen}
        />
        <Stack.Screen
          name="TransferInReceivingScanItems"
          component={TransferInReceivingScanItemsScreen}
        />
        <Stack.Screen
          name="StockLedgerList"
          component={StockLedgerListScreen}
        />
        <Stack.Screen name="StockDetail" component={StockDetailScreen} />
        <Stack.Screen
          name="StockTransactions"
          component={StockTransactionHistoryScreen}
        />
        <Stack.Screen
          name="MaterialRequestList"
          component={MaterialRequestListScreen}
        />
        <Stack.Screen
          name="MaterialRequestDetail"
          component={MaterialRequestDetailScreen}
        />
        <Stack.Screen
          name="MaterialRequestScanLocation"
          component={MaterialRequestScanLocationScreen}
        />
        <Stack.Screen
          name="MaterialRequestPacking"
          component={MaterialRequestPackingScreen}
        />
        <Stack.Screen
          name="PickingScanBin"
          component={PickingScanBinScreen}
        />
        <Stack.Screen
          name="PickingScanCarton"
          component={PickingScanCartonScreen}
        />
        <Stack.Screen
          name="PickingScanItems"
          component={PickingScanItemsScreen}
        />
        <Stack.Screen
          name="CycleCountList"
          component={CycleCountListScreen}
        />
        <Stack.Screen
          name="CycleCountDetail"
          component={CycleCountDetailScreen}
        />
        <Stack.Screen
          name="CycleCountCounting"
          component={CycleCountCountingScreen}
        />
        <Stack.Screen
          name="CycleCountDashboard"
          component={CycleCountDashboardScreen}
        />
        <Stack.Screen
          name="CycleCountScanBin"
          component={CycleCountScanBinScreen}
        />
        <Stack.Screen
          name="CycleCountBinCounting"
          component={CycleCountBinCountingScreen}
        />
        <Stack.Screen
          name="CycleCountDrafts"
          component={CycleCountDraftsScreen}
        />
        <Stack.Screen
          name="CycleCountHistory"
          component={CycleCountHistoryScreen}
        />
        <Stack.Screen
          name="RemainingItems"
          component={RemainingItemsScreen}
        />
        <Stack.Screen
          name="RelocationHome"
          component={RelocationHomeScreen}
        />
        <Stack.Screen
          name="RelocationScanFromBin"
          component={RelocationScanFromBinScreen}
        />
        <Stack.Screen
          name="RelocationScanFromCarton"
          component={RelocationScanFromCartonScreen}
        />
        <Stack.Screen
          name="RelocationScanToBin"
          component={RelocationScanToBinScreen}
        />
        <Stack.Screen
          name="RelocationScanToCarton"
          component={RelocationScanToCartonScreen}
        />
        <Stack.Screen
          name="RelocationExecute"
          component={RelocationExecuteScreen}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  useEffect(() => {
    initializeApp();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    // Match ScreenFooterFrame blue so the system nav bar is not grey below the footer.
    NavigationBar.setBackgroundColorAsync("#1E88E5").catch(() => {});
    NavigationBar.setButtonStyleAsync("light").catch(() => {});
  }, []);

  const initializeApp = async () => {
    try {
      // Initialize database
      await getDatabase();

      // Initialize Cycle Count mock data for testing
      try {
        const { initializeCycleCountMockData } = await import("./src/utils/cycle-count-mock-data");
        await initializeCycleCountMockData();
      } catch (error: any) {
        console.warn("⚠️ Failed to initialize Cycle Count mock data:", error.message);
      }

      // Run database lock tests automatically (only in development)
      // DISABLED by default to prevent overwriting user settings
      // Uncomment the block below to enable tests
      if (__DEV__ && false) {
        // Set to true to enable tests
        // Delay test execution to ensure database is fully initialized
        // Increased delay to allow migrations and PRAGMA settings to complete
        setTimeout(async () => {
          try {
            const { runDatabaseLockTests } = await import(
              "./src/utils/test-database-lock"
            );
            await runDatabaseLockTests();
          } catch (testError: any) {
            console.warn("⚠️ Database lock tests failed:", testError.message);
          }
        }, 5000); // Wait 5 seconds after app start to ensure full initialization

        // Run inbound workflow test (optional - uncomment to enable)
        // setTimeout(async () => {
        //   try {
        //     const { runInboundWorkflowTest } = await import("./src/utils/test-inbound-workflow");
        //     await runInboundWorkflowTest();
        //   } catch (testError: any) {
        //     console.warn("⚠️ Inbound workflow tests failed:", testError.message);
        //   }
        // }, 10000); // Wait 10 seconds after app start
      }
    } catch (error) {
      console.error("Failed to initialize app:", error);
    }
  };

  return (
    <AppProvider>
      <AppNavigation />
    </AppProvider>
  );
}
