import "react-native-gesture-handler";
import React, { useEffect, useState } from "react";
import { NavigationContainer, useNavigation } from "@react-navigation/native";
import * as NavigationBar from "expo-navigation-bar";
import { createStackNavigator } from "@react-navigation/stack";
import {
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
// Import logger first to suppress info logs (only show warnings and errors)
import "./src/utils/logger";

import TransferInListScreen from "./src/screens/TransferInListScreen";
import TransferInDetailScreen from "./src/screens/TransferInDetailScreen";
import TransferInReceivingScreen from "./src/screens/TransferInReceivingScreen";
import StockLedgerListScreen from "./src/screens/StockLedgerListScreen";
import StockDetailScreen from "./src/screens/StockDetailScreen";
import StockTransactionHistoryScreen from "./src/screens/StockTransactionHistoryScreen";
import MaterialRequestListScreen from "./src/screens/MaterialRequestListScreen";
import MaterialRequestDetailScreen from "./src/screens/MaterialRequestDetailScreen";
import MaterialRequestPackingScreen from "./src/screens/MaterialRequestPackingScreen";
import CycleCountListScreen from "./src/screens/CycleCountListScreen";
import CycleCountDetailScreen from "./src/screens/CycleCountDetailScreen";
import CycleCountCountingScreen from "./src/screens/CycleCountCountingScreen";
import CycleCountDashboardScreen from "./src/screens/CycleCountDashboardScreen";
import CycleCountScanBinScreen from "./src/screens/CycleCountScanBinScreen";
import CycleCountBinCountingScreen from "./src/screens/CycleCountBinCountingScreen";
import CycleCountDraftsScreen from "./src/screens/CycleCountDraftsScreen";
import RemainingItemsScreen from "./src/screens/RemainingItemsScreen";

const Stack = createStackNavigator();

// Header Sync Button Component (must be inside AppProvider to access context)
const SyncHeaderButton = () => {
  const { refreshPendingEvents } = useApp();
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    if (syncing) {
      return; // Prevent multiple simultaneous syncs
    }

    setSyncing(true);
    try {
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
        <>
          <ActivityIndicator
            size="small"
            color="#fff"
            style={{ marginRight: 6 }}
          />
          <Text style={syncButtonStyles.text}>Syncing...</Text>
        </>
      ) : (
        <>
          <Text style={syncButtonStyles.icon}>🔄</Text>
          <Text style={syncButtonStyles.text}>Sync</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const syncButtonStyles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    marginRight: 10,
    minWidth: 80,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  icon: {
    fontSize: 16,
    marginRight: 4,
  },
  text: {
    color: "#fff",
    fontSize: 14,
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
            name="MaterialRequestPacking"
            component={MaterialRequestPackingScreen}
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
        </Stack.Navigator>
      </NavigationContainer>
    </AppProvider>
  );
}
