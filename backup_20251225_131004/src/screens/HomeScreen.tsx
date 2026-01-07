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
import { useNavigation } from "@react-navigation/native";
import { useApp } from "../context/AppContext";
import { StatusBadge } from "../components/StatusBadge";
import { runAutomatedTest } from "../utils/automated-test";
import { testAllCartonsInASN } from "../utils/test-all-cartons";
import { runASNFormatCorrectionTest } from "../utils/test-asn-format-correction";
import { dataService } from "../services/data.service";

export default function HomeScreen() {
  const navigation = useNavigation();
  const {
    settings,
    pendingEventsCount,
    activeASN,
    activeSession,
    refreshPendingEvents,
    refreshSettings,
    setActiveASN,
    setActiveSession,
  } = useApp();
  const [runningTest, setRunningTest] = useState(false);
  const [clearingData, setClearingData] = useState(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      refreshPendingEvents();
      // Refresh settings to correct ASN format if needed
      refreshSettings();
    });
    return unsubscribe;
  }, [navigation, refreshSettings]);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.banner}>
        <Text style={styles.bannerTitle}>Active Session</Text>
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

      {activeASN && activeSession ? (
        <View style={styles.menu}>
          <TouchableOpacity
            style={[styles.menuItem, { borderLeftColor: "#007AFF" }]}
            onPress={() => navigation.navigate("StartInbound" as never)}
          >
            <Text style={styles.menuItemText}>Start Inbound</Text>
            <Text style={styles.menuItemArrow}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.menuItem, { borderLeftColor: "#9C27B0" }]}
            onPress={() => navigation.navigate("BoxManagement" as never)}
          >
            <Text style={styles.menuItemText}>BOX Management</Text>
            <Text style={styles.menuItemArrow}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.menuItem, { borderLeftColor: "#795548" }]}
            onPress={() => navigation.navigate("PutAway" as never)}
          >
            <Text style={styles.menuItemText}>Put Away</Text>
            <Text style={styles.menuItemArrow}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.menuItem, { borderLeftColor: "#607D8B" }]}
            onPress={() => navigation.navigate("SyncCenter" as never)}
          >
            <Text style={styles.menuItemText}>Sync Center</Text>
            <Text style={styles.menuItemArrow}>→</Text>
          </TouchableOpacity>
          {settings?.demo_mode === 1 && (
            <TouchableOpacity
              style={[styles.menuItem, { borderLeftColor: "#FF5722" }]}
              onPress={async () => {
                if (runningTest) {
                  Alert.alert(
                    "Test Running",
                    "Automated test is already running. Please wait..."
                  );
                  return;
                }

                Alert.alert(
                  "Run Automated Test",
                  "This will simulate the complete workflow:\n\n1. Start ASN-00045\n2. Unload all cartons\n3. Lock CTN-001 and scan one item\n4. Return to home\n5. Resume and complete scanning\n\nContinue?",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Run Test",
                      onPress: async () => {
                        setRunningTest(true);
                        try {
                          const progress = await runAutomatedTest();

                          // Refresh settings to get updated active ASN and session
                          await refreshSettings();
                          const updatedSettings = await import(
                            "../services/settings.service"
                          ).then((m) => m.getSettings());
                          if (updatedSettings.active_asn) {
                            setActiveASN(updatedSettings.active_asn);
                          }
                          if (updatedSettings.active_session) {
                            setActiveSession(updatedSettings.active_session);
                          }

                          // Show results
                          const completed = progress.filter(
                            (p) => p.status === "completed"
                          ).length;
                          const failed = progress.filter(
                            (p) => p.status === "failed"
                          ).length;

                          Alert.alert(
                            "Test Completed",
                            `Automated test finished!\n\nCompleted: ${completed} steps\nFailed: ${failed} steps\n\nCheck console logs for details.`,
                            [{ text: "OK" }]
                          );
                        } catch (error: any) {
                          Alert.alert(
                            "Test Failed",
                            error.message || "An error occurred during the test"
                          );
                        } finally {
                          setRunningTest(false);
                        }
                      },
                    },
                  ]
                );
              }}
              disabled={runningTest}
            >
              {runningTest ? (
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <ActivityIndicator
                    size="small"
                    color="#FF5722"
                    style={{ marginRight: 10 }}
                  />
                  <Text style={styles.menuItemText}>Running Test...</Text>
                </View>
              ) : (
                <>
                  <Text style={styles.menuItemText}>🧪 Run Automated Test</Text>
                  <Text style={styles.menuItemArrow}>→</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View style={styles.menu}>
          <TouchableOpacity
            style={[styles.menuItem, { borderLeftColor: "#007AFF" }]}
            onPress={() => navigation.navigate("StartInbound" as never)}
          >
            <Text style={styles.menuItemText}>Start Inbound</Text>
            <Text style={styles.menuItemArrow}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.menuItem, { borderLeftColor: "#9C27B0" }]}
            onPress={() => navigation.navigate("BoxManagement" as never)}
          >
            <Text style={styles.menuItemText}>BOX Management</Text>
            <Text style={styles.menuItemArrow}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.menuItem, { borderLeftColor: "#795548" }]}
            onPress={() => navigation.navigate("PutAway" as never)}
          >
            <Text style={styles.menuItemText}>Put Away</Text>
            <Text style={styles.menuItemArrow}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.menuItem, { borderLeftColor: "#607D8B" }]}
            onPress={() => navigation.navigate("SyncCenter" as never)}
          >
            <Text style={styles.menuItemText}>Sync Center</Text>
            <Text style={styles.menuItemArrow}>→</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.menuItem, { borderLeftColor: "#FF9800" }]}
            onPress={() => navigation.navigate("ASNList" as never)}
          >
            <Text style={styles.menuItemText}>ASN List</Text>
            <Text style={styles.menuItemArrow}>→</Text>
          </TouchableOpacity>
          {settings?.demo_mode === 1 && (
            <>
              <TouchableOpacity
                style={[styles.menuItem, { borderLeftColor: "#FF5722" }]}
                onPress={async () => {
                  if (runningTest) {
                    Alert.alert(
                      "Test Running",
                      "Automated test is already running. Please wait..."
                    );
                    return;
                  }

                  Alert.alert(
                    "Run Automated Test",
                    "This will simulate the complete workflow:\n\n1. Start ASN-00045\n2. Unload all cartons\n3. Lock CTN-001 and scan one item\n4. Return to home\n5. Resume and complete scanning\n\nContinue?",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Run Test",
                        onPress: async () => {
                          setRunningTest(true);
                          try {
                            const progress = await runAutomatedTest();

                            // Refresh settings to get updated active ASN and session
                            await refreshSettings();
                            const updatedSettings = await import(
                              "../services/settings.service"
                            ).then((m) => m.getSettings());
                            if (updatedSettings.active_asn) {
                              setActiveASN(updatedSettings.active_asn);
                            }
                            if (updatedSettings.active_session) {
                              setActiveSession(updatedSettings.active_session);
                            }

                            // Show results
                            const completed = progress.filter(
                              (p) => p.status === "completed"
                            ).length;
                            const failed = progress.filter(
                              (p) => p.status === "failed"
                            ).length;

                            Alert.alert(
                              "Test Completed",
                              `Automated test finished!\n\nCompleted: ${completed} steps\nFailed: ${failed} steps\n\nCheck console logs for details.`,
                              [{ text: "OK" }]
                            );
                          } catch (error: any) {
                            Alert.alert(
                              "Test Failed",
                              error.message ||
                                "An error occurred during the test"
                            );
                          } finally {
                            setRunningTest(false);
                          }
                        },
                      },
                    ]
                  );
                }}
                disabled={runningTest}
              >
                {runningTest ? (
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <ActivityIndicator
                      size="small"
                      color="#FF5722"
                      style={{ marginRight: 10 }}
                    />
                    <Text style={styles.menuItemText}>Running Test...</Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.menuItemText}>
                      🧪 Run Automated Test
                    </Text>
                    <Text style={styles.menuItemArrow}>→</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.menuItem, { borderLeftColor: "#9C27B0" }]}
                onPress={async () => {
                  if (runningTest) {
                    Alert.alert(
                      "Test Running",
                      "Test is already running. Please wait..."
                    );
                    return;
                  }

                  Alert.alert(
                    "Test All Cartons",
                    "This will test the complete workflow for ALL cartons in ASN-00045:\n\n1. Start inbound session\n2. Unload all cartons\n3. Process each carton completely\n4. Verify all data is saved\n\nThis may take a few minutes. Continue?",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Run Test",
                        onPress: async () => {
                          setRunningTest(true);
                          try {
                            const results = await testAllCartonsInASN();

                            // Refresh settings
                            await refreshSettings();
                            const updatedSettings = await import(
                              "../services/settings.service"
                            ).then((m) => m.getSettings());
                            if (updatedSettings.active_asn) {
                              setActiveASN(updatedSettings.active_asn);
                            }
                            if (updatedSettings.active_session) {
                              setActiveSession(updatedSettings.active_session);
                            }

                            // Show results
                            const success = results.filter(
                              (r) => r.status === "success"
                            ).length;
                            const failed = results.filter(
                              (r) => r.status === "failed"
                            ).length;

                            const summary = results
                              .filter((r) => r.step.startsWith("4-"))
                              .map(
                                (r) =>
                                  `  ${r.step}: ${
                                    r.status === "success" ? "✅" : "❌"
                                  } ${r.message}`
                              )
                              .join("\n");

                            Alert.alert(
                              "Test All Cartons Completed",
                              `Test finished!\n\nSuccess: ${success} steps\nFailed: ${failed} steps\n\nCarton Results:\n${summary}\n\nCheck console logs for full details.`,
                              [{ text: "OK" }]
                            );
                          } catch (error: any) {
                            Alert.alert(
                              "Test Failed",
                              error.message ||
                                "An error occurred during the test"
                            );
                          } finally {
                            setRunningTest(false);
                          }
                        },
                      },
                    ]
                  );
                }}
                disabled={runningTest}
              >
                {runningTest ? (
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <ActivityIndicator
                      size="small"
                      color="#9C27B0"
                      style={{ marginRight: 10 }}
                    />
                    <Text style={styles.menuItemText}>
                      Testing All Cartons...
                    </Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.menuItemText}>
                      🧪 Test All Cartons in ASN
                    </Text>
                    <Text style={styles.menuItemArrow}>→</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.menuItem, { borderLeftColor: "#4CAF50" }]}
                onPress={async () => {
                  Alert.alert(
                    "Test ASN Format Correction",
                    "This will test that ASN format is automatically corrected when loaded from settings.\n\nThis simulates the bug where ASN shows as 'ASN-2' instead of 'ASN-0002' and verifies the fix.\n\nContinue?",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Run Test",
                        onPress: async () => {
                          try {
                            const { passed, failed, results } = await runASNFormatCorrectionTest();
                            
                            const summary = results
                              .map((r) => `  ${r.step}: ${r.status === 'passed' ? '✅' : '❌'} ${r.message}`)
                              .join('\n');
                            
                            Alert.alert(
                              "ASN Format Correction Test",
                              `Test completed!\n\n✅ Passed: ${passed}\n❌ Failed: ${failed}\n\nResults:\n${summary}\n\nCheck console for detailed logs.`,
                              [{ text: "OK" }]
                            );
                          } catch (error: any) {
                            Alert.alert(
                              "Test Failed",
                              error.message || "An error occurred during the test"
                            );
                          }
                        },
                      },
                    ]
                  );
                }}
              >
                <Text style={styles.menuItemText}>
                  🧪 Test ASN Format Correction
                </Text>
                <Text style={styles.menuItemArrow}>→</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      <View style={styles.info}>
        <Text style={styles.infoText}>
          Mode: {settings?.demo_mode ? "Demo" : "Production"}
        </Text>
        {settings?.user_id && (
          <Text style={styles.infoText}>User: {settings.user_id}</Text>
        )}
        {settings?.device_id && (
          <Text style={styles.infoText}>Device: {settings.device_id}</Text>
        )}
      </View>

      <View style={styles.dangerZone}>
        <Text style={styles.dangerZoneTitle}>⚠️ Data Management</Text>
        <TouchableOpacity
          style={[styles.dangerButton, clearingData && styles.buttonDisabled]}
          onPress={() => {
            Alert.alert(
              "Clear All Transaction Data",
              "This will permanently delete ALL transaction data:\n\n• All events\n• All scanned items\n• All workflow states\n• All carton statuses\n• All boxes\n• All transfer cartons\n• Active ASN and session\n\nThis action cannot be undone!\n\nSettings and demo data structure will be preserved.\n\nAre you sure?",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Clear All Data",
                  style: "destructive",
                  onPress: async () => {
                    setClearingData(true);
                    try {
                      await dataService.clearAllTransactionData();
                      // Clear active session from context
                      setActiveASN(null);
                      setActiveSession(null);
                      // Refresh settings
                      await refreshSettings();
                      await refreshPendingEvents();
                      Alert.alert(
                        "Success",
                        "All transaction data has been cleared successfully.",
                        [{ text: "OK" }]
                      );
                    } catch (error: any) {
                      Alert.alert(
                        "Error",
                        error.message || "Failed to clear transaction data"
                      );
                    } finally {
                      setClearingData(false);
                    }
                  },
                },
              ]
            );
          }}
          disabled={clearingData}
        >
          {clearingData ? (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <ActivityIndicator
                size="small"
                color="#fff"
                style={{ marginRight: 10 }}
              />
              <Text style={styles.dangerButtonText}>Clearing Data...</Text>
            </View>
          ) : (
            <Text style={styles.dangerButtonText}>
              🗑️ Clear All Transaction Data
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  banner: {
    backgroundColor: "#007AFF",
    padding: 20,
    marginBottom: 16,
  },
  bannerTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 8,
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
  info: {
    padding: 16,
    backgroundColor: "#fff",
    margin: 16,
    borderRadius: 8,
  },
  infoText: {
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },
  dangerZone: {
    padding: 16,
    backgroundColor: "#fff",
    margin: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#F44336",
  },
  dangerZoneTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#F44336",
    marginBottom: 12,
    textAlign: "center",
  },
  dangerButton: {
    backgroundColor: "#F44336",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  dangerButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  buttonDisabled: {
    opacity: 0.6,
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
