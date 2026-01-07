import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useApp } from "../context/AppContext";
import { saveSettings, getSettings } from "../services/settings.service";
import { apiService } from "../services/api.service";
import { syncUsers } from "../services/user-sync.service";
import { clearAllCacheData, clearDemoData } from "../services/data-cleanup.service";
import { syncMasterDataFromDesktop } from "../services/master-data-sync.service";

export default function SettingsScreen() {
  const navigation = useNavigation();
  const { refreshSettings } = useApp();
  const [apiUrl, setApiUrl] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [userId, setUserId] = useState("");
  const [userCode, setUserCode] = useState("");
  const [password, setPassword] = useState("");
  // Demo mode removed from UI - always set to 0 in database
  const [testingConnection, setTestingConnection] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  // Also reload settings when screen is focused (e.g., navigating back)
  useFocusEffect(
    React.useCallback(() => {
      console.log("🔄 SettingsScreen focused - reloading settings from database");
      loadSettings();
    }, [])
  );

  const loadSettings = async () => {
    try {
      console.log("📥 Loading settings from database...");
      const settings = await getSettings();
      console.log("📥 Settings loaded from database:", {
        api_url: settings.api_url || "(empty)",
        device_id: settings.device_id || "(empty)",
        user_id: settings.user_id || "(empty)",
        demo_mode: settings.demo_mode,
      });
      
      // Always load from database, even if empty string
      setApiUrl(settings.api_url || "");
      setDeviceId(settings.device_id || "");
      setUserId(settings.user_id || "");
      setUserCode(settings.user_code || "");
      setPassword(settings.password || "");
      // Demo mode is always disabled (removed from UI)
      
      console.log("✅ Settings loaded into UI state");
    } catch (error: any) {
      console.error("❌ Error loading settings:", error);
      // On error, still set empty values to avoid showing stale data
      setApiUrl("");
      setDeviceId("");
      setUserId("");
      setUserCode("");
      setPassword("");
    }
  };

  const handleSave = async () => {
    // API URL is required
    if (!apiUrl.trim()) {
      Alert.alert(
        "API URL Required",
        "Please enter an API URL to continue."
      );
      return;
    }

    // Test API connection if API URL is provided
    if (apiUrl) {
      setTestingConnection(true);
      try {
        const result = await apiService.testConnection(apiUrl);
        setTestingConnection(false);

        if (!result.success) {
          Alert.alert(
            "API Connection Failed",
            result.message + "\n\nDo you want to save settings anyway?",
            [
              {
                text: "Cancel",
                style: "cancel",
              },
              {
                text: "Save Anyway",
                onPress: async () => {
                  await performSave();
                },
              },
            ]
          );
          return;
        } else {
          // Success - proceed automatically
          await performSave();
          return;
        }
      } catch (error: any) {
        setTestingConnection(false);
        Alert.alert(
          "Connection Test Error",
          `Failed to test API connection: ${error.message}\n\nDo you want to save settings anyway?`,
          [
            {
              text: "Cancel",
              style: "cancel",
            },
            {
              text: "Save Anyway",
              onPress: async () => {
                await performSave();
              },
            },
          ]
        );
        return;
      }
    }

    // Save directly
    await performSave();
  };

  const performSave = async () => {
    try {
      // Trim and validate API URL before saving
      const trimmedApiUrl = apiUrl.trim();

      console.log("Saving settings:", {
        api_url: trimmedApiUrl || "(empty)",
        device_id: deviceId.trim(),
        user_id: userId.trim(),
        user_code: userCode.trim(),
        demo_mode: 0, // Always 0 (demo mode disabled)
      });

      await saveSettings({
        api_url: trimmedApiUrl.length > 0 ? trimmedApiUrl : null,
        device_id: deviceId.trim().length > 0 ? deviceId.trim() : null,
        user_id: userId.trim().length > 0 ? userId.trim() : null,
        user_code: userCode.trim().length > 0 ? userCode.trim() : null,
        password: password && password.length > 0 ? password : null,
        demo_mode: 0, // Always set to 0 (demo mode disabled)
      });

      // Verify the save - wait a moment for database write to complete
      await new Promise((resolve) => setTimeout(resolve, 200));
      const savedSettings = await getSettings();
      
      // Verify API URL was saved correctly
      const apiUrlSaved = savedSettings.api_url === trimmedApiUrl || 
                         (trimmedApiUrl.length === 0 && savedSettings.api_url === null);
      
      if (!apiUrlSaved && trimmedApiUrl.length > 0) {
        console.warn("⚠️ API URL verification failed. Retrying save...");
        // Retry once
        await saveSettings({
          api_url: trimmedApiUrl,
          demo_mode: 0, // Always set to 0 (demo mode disabled)
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
        const retrySettings = await getSettings();
        if (retrySettings.api_url !== trimmedApiUrl) {
          Alert.alert(
            "Warning",
            "API URL may not have been saved correctly. Please verify in Settings after closing this screen."
          );
        }
      }
      
      // Only log relevant fields that were changed or are important
      const logData: any = {
        api_url: savedSettings.api_url || "(empty)",
        device_id: savedSettings.device_id,
        user_id: savedSettings.user_id,
      };

      // Only include demo_mode if it's relevant (show as ON/OFF for clarity)
      if (savedSettings.demo_mode !== undefined) {
        logData.demo_mode = `${savedSettings.demo_mode} (${
          savedSettings.demo_mode === 1 ? "ON" : "OFF"
        })`;
      }
      
      console.log("✅ Settings saved and verified:", logData);

      console.log("Settings saved successfully:", logData);

      // Double-check API URL was saved
      const finalCheck = await getSettings();
      if (trimmedApiUrl && finalCheck.api_url !== trimmedApiUrl) {
        console.error("❌ API URL still not saved after reload:", {
          expected: trimmedApiUrl,
          actual: finalCheck.api_url || "(null)",
        });
        Alert.alert(
          "Warning",
          `API URL may not have been saved correctly.\n\nExpected: ${trimmedApiUrl}\nActual: ${finalCheck.api_url || "(empty)"}\n\nPlease try saving again.`
        );
      } else {
        // Show success message first
        Alert.alert("Success", "Settings saved successfully!", [
          {
            text: "OK",
            onPress: async () => {
              // After Alert is dismissed, reload settings and navigate to Login screen
              // Use setTimeout to ensure Alert is fully dismissed before navigation
              setTimeout(async () => {
                try {
                  await loadSettings();
                  await refreshSettings();
                  // Navigate to Login screen after saving settings
                  (navigation as any).navigate("Login");
                } catch (error: any) {
                  console.warn("⚠️ Error refreshing settings after save:", error);
                  // Still navigate to Login even if refresh fails
                  (navigation as any).navigate("Login");
                }
              }, 100);
            },
          },
        ]);
      }
    } catch (error: any) {
      console.error("Error saving settings:", error);
      Alert.alert("Save Error", `Failed to save settings: ${error.message}`);
    }
  };

  const handleSync = async () => {
    if (!apiUrl) {
      Alert.alert("Error", "Please configure API URL first");
      return;
    }

    if (!userCode || !password) {
      Alert.alert(
        "Authentication Required",
        "Please enter User Code and Password in Settings before syncing. Authentication is required to access the API."
      );
      return;
    }

    setSyncing(true);
    try {
      // Try to authenticate first
      try {
        const { apiService } = await import("../services/api.service");
        await apiService.login(userCode.trim(), password);
      } catch (authError: any) {
        Alert.alert(
          "Authentication Failed",
          `Cannot sync users: ${
            authError.message || "Invalid credentials"
          }\n\nPlease check your User Code and Password in Settings.`
        );
        setSyncing(false);
        return;
      }

      // Note: Demo data is not used in production - only real data from desktop API

      // If authentication succeeds, proceed with sync
      const result = await syncUsers();

      if (result.synced > 0 || result.failed === 0) {
        const summary = `Users: ${result.synced} synced${
          result.failed > 0 ? `, ${result.failed} failed` : ""
        }`;
        Alert.alert("Sync Complete", summary);
      } else {
        Alert.alert(
          "Sync Failed",
          `Failed to sync users. Please check:\n1. API URL is correct\n2. User Code and Password are valid\n3. Server endpoint /api/master/users is implemented`
        );
      }
    } catch (error: any) {
      const errorMessage = error.message || "Failed to sync users";

      // Provide more helpful error messages
      if (
        errorMessage.includes("401") ||
        errorMessage.includes("AUTH_REQUIRED")
      ) {
        Alert.alert(
          "Authentication Required",
          "Cannot sync users: Authentication failed.\n\nPlease:\n1. Check your User Code and Password\n2. Ensure the login endpoint is working on the server"
        );
      } else if (errorMessage.includes("404")) {
        Alert.alert(
          "Endpoint Not Found",
          "Cannot sync users: The /api/master/users endpoint is not implemented on the server yet."
        );
      } else {
        Alert.alert("Sync Error", errorMessage);
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Device Settings</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>API URL</Text>
            <TextInput
              style={styles.input}
              value={apiUrl}
              onChangeText={setApiUrl}
              placeholder="https://api.example.com"
              autoCapitalize="none"
              keyboardType="url"
            />

            <Text style={styles.label}>Device ID</Text>
            <TextInput
              style={styles.input}
              value={deviceId}
              onChangeText={setDeviceId}
              placeholder="DEVICE-001"
              autoCapitalize="characters"
            />

            <Text style={styles.label}>User ID</Text>
            <TextInput
              style={styles.input}
              value={userId}
              onChangeText={setUserId}
              placeholder="USER-001"
              autoCapitalize="characters"
            />

            <Text style={styles.label}>User Code</Text>
            <TextInput
              style={styles.input}
              value={userCode}
              onChangeText={setUserCode}
              placeholder="USER-001"
              autoCapitalize="characters"
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter password"
              secureTextEntry
              autoCapitalize="none"
            />

        <TouchableOpacity
          style={[styles.button, testingConnection && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={testingConnection}
        >
          {testingConnection ? (
            <View style={styles.buttonLoading}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.buttonText}>Testing API Connection...</Text>
            </View>
          ) : (
            <Text style={styles.buttonText}>Save Settings</Text>
          )}
        </TouchableOpacity>

        {apiUrl && (
          <TouchableOpacity
            style={[styles.syncButton, syncing && styles.buttonDisabled]}
            onPress={handleSync}
            disabled={syncing}
          >
            {syncing ? (
              <View style={styles.buttonLoading}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.buttonText}>Syncing Users...</Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>🔄 Sync Users</Text>
            )}
          </TouchableOpacity>
        )}

        <View style={styles.dangerZone}>
          <Text style={styles.dangerZoneTitle}>⚠️ Data Management</Text>
          <TouchableOpacity
            style={styles.dangerButton}
            onPress={() => {
              Alert.alert(
                "Clear All Sessions",
                "This will permanently delete ALL inbound sessions from the database:\n\n• All session records\n• Session status and progress\n• Session sync status\n\n⚠️ This action cannot be undone!\n\n⚠️ You will need to create new sessions after clearing.\n\nAre you sure?",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Clear All Sessions",
                    style: "destructive",
                    onPress: async () => {
                      try {
                        const { dataService } = await import(
                          "../services/data.service"
                        );
                        const count = await dataService.deleteAllSessions();
                        // Refresh settings to update the context (clear active session)
                        await refreshSettings();
                        Alert.alert(
                          "Success",
                          `All sessions have been cleared successfully.\n\n${count} session(s) deleted.\n\nActive session has been cleared from settings.`,
                          [{ text: "OK" }]
                        );
                      } catch (error: any) {
                        Alert.alert(
                          "Error",
                          error.message || "Failed to clear sessions"
                        );
                      }
                    },
                  },
                ]
              );
            }}
          >
            <Text style={styles.dangerButtonText}>🗑️ Clear All Sessions</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.dangerButton, styles.dangerButtonCritical]}
            onPress={() => {
              Alert.alert(
                "⚠️ CLEAR ALL DATABASE DATA",
                "This will PERMANENTLY DELETE ALL DATA from the database:\n\n• All ASNs\n• All Transfer Orders\n• All Boxes\n• All Transfer Cartons\n• All Carton Statuses\n• All Scanned Items\n• All Events\n• All Master Data (Items, Users, Warehouses, Locations)\n• All Workflow States\n• All Put Away Items\n\n⚠️ ONLY SETTINGS WILL BE PRESERVED (API URL, Device ID, User ID, etc.)\n\n⚠️ THIS ACTION CANNOT BE UNDONE!\n\n⚠️ You will need to re-sync all data from the desktop API after clearing.\n\nAre you absolutely sure?",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "YES, CLEAR ALL DATA",
                    style: "destructive",
                    onPress: async () => {
                      try {
                        // Clear all cache data and demo data
                        await clearAllCacheData();
                        await clearDemoData();
                        
                        Alert.alert(
                          "✅ Success",
                          "All local cache data has been cleared successfully.\n\nSettings have been preserved.\n\nPlease sync data from backend to load real data.",
                          [
                            {
                              text: "Sync Now",
                              onPress: async () => {
                                setSyncing(true);
                                try {
                                  await syncMasterDataFromDesktop();
                                  Alert.alert(
                                    "Sync Complete",
                                    "Data has been synced from backend."
                                  );
                                } catch (error: any) {
                                  Alert.alert(
                                    "Sync Error",
                                    error.message || "Failed to sync from backend"
                                  );
                                } finally {
                                  setSyncing(false);
                                }
                              },
                            },
                            { text: "OK" },
                          ]
                        );
                      } catch (error: any) {
                        Alert.alert(
                          "Error",
                          error.message || "Failed to clear database"
                        );
                      }
                    },
                  },
                ]
              );
            }}
          >
            <Text style={styles.dangerButtonText}>
              🗑️ Clear ALL Database Data
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  header: {
    backgroundColor: "#007AFF",
    padding: 32,
    alignItems: "center",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 8,
  },
  form: {
    padding: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    color: "#333",
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
  },
  demoInfo: {
    backgroundColor: "#E3F2FD",
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
  },
  demoText: {
    color: "#1976D2",
    fontSize: 14,
    marginBottom: 12,
  },
  refreshButton: {
    backgroundColor: "#1976D2",
    padding: 12,
    borderRadius: 6,
    alignItems: "center",
  },
  refreshButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 18,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
    marginBottom: 16,
  },
  syncButton: {
    backgroundColor: "#4CAF50",
    padding: 18,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dangerZone: {
    padding: 16,
    backgroundColor: "#fff",
    margin: 16,
    marginTop: 24,
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
    marginBottom: 12,
  },
  dangerButtonCritical: {
    backgroundColor: "#D32F2F",
    borderWidth: 2,
    borderColor: "#B71C1C",
  },
  dangerButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});
