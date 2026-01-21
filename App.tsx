import "react-native-gesture-handler";
import React, { useEffect, useState } from "react";
import { NavigationContainer, useNavigation } from "@react-navigation/native";
import * as NavigationBar from "expo-navigation-bar";
import { createStackNavigator } from "@react-navigation/stack";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { AppProvider, useApp } from "./src/context/AppContext";
import { getDatabase } from "./src/database/database";
import { syncMasterDataFromDesktop } from "./src/services/master-data-sync.service";
import { syncEvents } from "./src/services/event-queue.service";
import { syncAllUnsyncedSessions } from "./src/services/session-sync.service";

// Screens
import LoginScreen from "./src/screens/LoginScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
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
// Import logger first to suppress all logs except errors
import "./src/utils/logger";

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
import RemainingItemsScreen from "./src/screens/RemainingItemsScreen";
import RelocationHomeScreen from "./src/screens/RelocationHomeScreen";
import RelocationScanFromBinScreen from "./src/screens/RelocationScanFromBinScreen";
import RelocationScanFromCartonScreen from "./src/screens/RelocationScanFromCartonScreen";
import RelocationScanToBinScreen from "./src/screens/RelocationScanToBinScreen";
import RelocationScanToCartonScreen from "./src/screens/RelocationScanToCartonScreen";
import RelocationExecuteScreen from "./src/screens/RelocationExecuteScreen";

const Stack = createStackNavigator();

// Header Sync Button Component (must be inside AppProvider to access context)
const SyncHeaderButton = () => {
  const { refreshPendingEvents, pendingEventsCount } = useApp();
  const [syncing, setSyncing] = useState(false);
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
    if (syncing) {
      return; // Prevent multiple simultaneous syncs
    }

    setSyncing(true);
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
        const masterResult = await syncMasterDataFromDesktop();
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
        // Continue with event sync even if master sync fails
      }

      // Small delay between master data and session sync
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Sync sessions to backend
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
      const result = await syncEvents();
      await refreshPendingEvents();

      Alert.alert(
        "Sync Complete",
        `Events synced: ${result.synced}\nEvents failed: ${result.failed}\n\nMaster data and sessions have been synced.`
      );
    } catch (error: any) {
      Alert.alert("Sync Error", error.message || "Failed to sync data");
    } finally {
      setSyncing(false);
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
        <View style={syncButtonStyles.syncContent}>
          <ActivityIndicator
            size="small"
            color="#fff"
            style={{ marginRight: 6 }}
          />
          <Text style={syncButtonStyles.text}>Syncing...</Text>
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

export default function App() {
  useEffect(() => {
    initializeApp();
  }, []);

  useEffect(() => {
    // Set button style to 'light' for white icons
    NavigationBar.setButtonStyleAsync("light");
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
      <NavigationContainer>
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
            // Add Sync button to all screens except Login and BoxManagement
            headerRight: () => {
              // Don't show on Login (headerShown: false) or BoxManagement (headerShown: false)
              if (route.name === "Login" || route.name === "BoxManagement") {
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
          <Stack.Screen name="Home" component={HomeScreen} />
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
    </AppProvider>
  );
}
