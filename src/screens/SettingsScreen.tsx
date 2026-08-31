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
import { getAppVersionDetails } from "../utils/appVersion";
import { dataService } from "../services/data.service";
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import BarcodeScanModal from "../components/BarcodeScanModal";
import { saveSettings, getSettings } from "../services/settings.service";
import type { ItemMasterSyncMode } from "../types";
import { apiService } from "../services/api.service";
import { syncUsers } from "../services/user-sync.service";
import { clearAllCacheData, clearDemoData } from "../services/data-cleanup.service";
import {
  syncMasterDataFromDesktop,
  type MasterSyncProgress,
} from "../services/master-data-sync.service";
import { syncEvents } from "../services/event-queue.service";
import { syncAllUnsyncedSessions } from "../services/session-sync.service";
import { resendReceiveLinesToBackend } from "../services/receive-lines-resend.service";
import {
  pickAndRestoreDatabase,
  saveDatabaseBackupToPickedFolder,
  shareDatabaseBackup,
} from "../services/database-backup.service";

export default function SettingsScreen() {
  const navigation = useNavigation();
  const {
    settings,
    refreshSettings,
    refreshPendingEvents,
    refreshDeviceSessionStatus,
    activeASN,
    activeSession,
    setActiveASN,
    setActiveSession,
    deviceSessionRestricted,
    deviceSessionBlockReason,
  } = useApp();

  const [apiUrl, setApiUrl] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [userCode, setUserCode] = useState("");
  const [deviceIdScanVisible, setDeviceIdScanVisible] = useState(false);
  const [clearingTransactionData, setClearingTransactionData] = useState(false);
  /** 0 = Server Setting, 1 = Data Management, 2 = About */
  const [settingsTab, setSettingsTab] = useState<0 | 1 | 2>(0);
  const [password, setPassword] = useState("");
  // Demo mode removed from UI - always set to 0 in database
  const [testingConnection, setTestingConnection] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingFull, setSyncingFull] = useState(false);
  const [fullSyncStatusLine, setFullSyncStatusLine] = useState("");
  const [userSyncStatusLine, setUserSyncStatusLine] = useState("");
  const [itemMasterSyncMode, setItemMasterSyncMode] =
    useState<ItemMasterSyncMode>("full");
  const [itemMasterPageSize, setItemMasterPageSize] = useState("5000");
  const [itemMasterWatermarkPreview, setItemMasterWatermarkPreview] =
    useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupFolderBusy, setBackupFolderBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);

  const formatMasterProgress = (p: MasterSyncProgress) =>
    `${p.phase} (${p.step}/${p.totalSteps})${p.detail ? ` — ${p.detail}` : ""}`;

  useEffect(() => {
    loadSettings();
  }, []);

  // Also reload settings when screen is focused (e.g., navigating back)
  useFocusEffect(
    React.useCallback(() => {
      console.log("🔄 SettingsScreen focused - reloading settings from database");
      loadSettings();
      refreshSettings();
      refreshDeviceSessionStatus();
    }, [refreshDeviceSessionStatus])
  );

  const loadSettings = async () => {
    try {
      console.log("📥 Loading settings from database...");
      const settings = await getSettings();
      console.log("📥 Settings loaded from database:", {
        api_url: settings.api_url || "(empty)",
        device_id: settings.device_id || "(empty)",
        user_id: settings.user_id || settings.user_code || "(empty)",
        demo_mode: settings.demo_mode,
      });
      
      // Always load from database, even if empty string
      setApiUrl(settings.api_url || "");
      setDeviceId(settings.device_id || "");
      {
        const uid = (settings.user_id || "").trim();
        const autoUserId = /^USER-\d{6}$/i.test(uid);
        setUserCode(
          (settings.user_code || "").trim() ||
            (uid && !autoUserId ? uid : "")
        );
      }
      setPassword(settings.password || "");
      // Demo mode is always disabled (removed from UI)

      const mode = (settings.item_master_sync_mode || "full").toString().toLowerCase();
      setItemMasterSyncMode(mode === "incremental" ? "incremental" : "full");
      const pgs = (settings as any).item_master_page_size;
      setItemMasterPageSize(
        pgs != null && pgs !== "" ? String(pgs) : "5000"
      );
      setItemMasterWatermarkPreview(
        (settings as any).item_master_modified_watermark || null
      );
      
      console.log("✅ Settings loaded into UI state");
    } catch (error: any) {
      console.error("❌ Error loading settings:", error);
      // On error, still set empty values to avoid showing stale data
      setApiUrl("");
      setDeviceId("");
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
        user_id: userCode.trim(),
        user_code: userCode.trim(),
        demo_mode: 0, // Always 0 (demo mode disabled)
      });

      const pageSizeNum = parseInt(itemMasterPageSize.trim(), 10);
      const safePageSize =
        Number.isFinite(pageSizeNum) && pageSizeNum >= 500 && pageSizeNum <= 20000
          ? pageSizeNum
          : 5000;

      await saveSettings({
        api_url: trimmedApiUrl.length > 0 ? trimmedApiUrl : null,
        device_id: deviceId.trim().length > 0 ? deviceId.trim() : null,
        user_id: userCode.trim().length > 0 ? userCode.trim() : null,
        user_code: userCode.trim().length > 0 ? userCode.trim() : null,
        password: password && password.length > 0 ? password : null,
        demo_mode: 0, // Always set to 0 (demo mode disabled)
        item_master_sync_mode: itemMasterSyncMode,
        item_master_page_size: safePageSize,
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
        user_id: savedSettings.user_id || savedSettings.user_code,
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

  const openChangePassword = () => {
    if (!apiUrl.trim()) {
      Alert.alert("Error", "Please configure and save API URL first");
      return;
    }
    if (!userCode.trim()) {
      Alert.alert("Error", "Please enter your User Code first");
      return;
    }
    (navigation as any).navigate("ChangePassword");
  };

  const handleSync = async () => {
    if (deviceSessionRestricted) {
      Alert.alert(
        "Device pending approval",
        "Only account and connection settings are available until an administrator approves this device."
      );
      return;
    }
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
    setUserSyncStatusLine("Signing in…");
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
        setUserSyncStatusLine("");
        return;
      }

      // Note: Demo data is not used in production - only real data from desktop API

      // If authentication succeeds, proceed with sync
      setUserSyncStatusLine("Downloading users from server…");
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
      setUserSyncStatusLine("");
      setSyncing(false);
    }
  };

  /** Full sync: master data + sessions + events + resend receive lines (same as Sync Center). */
  const handleSyncNow = async () => {
    if (deviceSessionRestricted) {
      Alert.alert(
        "Device pending approval",
        "Full sync is not available until an administrator approves this device."
      );
      return;
    }
    if (!apiUrl?.trim()) {
      Alert.alert("Error", "Please configure and save API URL first.");
      return;
    }
    setSyncingFull(true);
    setFullSyncStatusLine("Master data: starting…");
    try {
      const masterResult = await syncMasterDataFromDesktop({
        onProgress: (p) => {
          setFullSyncStatusLine(`Master data: ${formatMasterProgress(p)}`);
        },
      });
      await new Promise((r) => setTimeout(r, 100));
      setFullSyncStatusLine("Sessions: uploading…");
      try {
        await syncAllUnsyncedSessions();
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 100));
      setFullSyncStatusLine("Events: uploading…");
      const result = await syncEvents();
      await refreshPendingEvents?.();
      let receiveMsg = "";
      // Use context first; if missing, use stored settings so resend works from Settings too
      const asn = activeASN ?? (await getSettings()).active_asn;
      const session = activeSession ?? (await getSettings()).active_session;
      if (asn && session) {
        setFullSyncStatusLine("Receive data: syncing with backend…");
        try {
          const resend = await resendReceiveLinesToBackend(asn, session);
          if (resend.linesSent > 0) {
            const itemSummary = resend.byItem
              ? "\nItems sent: " + Object.entries(resend.byItem).map(([code, qty]) => `${code} (${qty})`).join(", ")
              : "";
            receiveMsg = `\n\nReceive data resent to backend:\nSession: ${resend.sessionSent}\n${resend.linesSent} line(s) from ${resend.cartonsSent} carton(s).${itemSummary}\n\nIf desktop Recvd Qty still shows 0, the backend must save and sum these by (session, item_code).`;
          } else {
            receiveMsg = `\n\nNo receive lines to resend for session ${session} (no scanned items in DB for this session).`;
          }
        } catch (e: any) {
          receiveMsg = `\n\nReceive data resend failed: ${e?.message || "unknown"}.`;
        }
      } else {
        receiveMsg = "\n\nNo active ASN/session stored – receive data was not resent. Start an inbound and scan items, or use Receive + Sort → Sync receive data.";
      }
      setFullSyncStatusLine("");
      Alert.alert(
        "Sync Complete",
        `Master data synced.\nEvents: ${result.synced} synced, ${result.failed} failed.${receiveMsg}`
      );
    } catch (error: any) {
      setFullSyncStatusLine("");
      Alert.alert("Sync Error", error?.message || "Failed to sync.");
    } finally {
      setSyncingFull(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Device Settings</Text>
      </View>

      {deviceSessionRestricted ? (
        <View style={styles.pendingDeviceBanner}>
          <Text style={styles.pendingDeviceBannerTitle}>
            {deviceSessionBlockReason === "disabled"
              ? "Device disabled"
              : "Device pending approval"}
          </Text>
          <Text style={styles.pendingDeviceBannerText}>
            {deviceSessionBlockReason === "disabled"
              ? "This device was disabled by an administrator. Only Settings is available. Contact support if this is a mistake."
              : "Only Settings (connection, credentials, device ID) is available. Ask an administrator to approve this device; the app rechecks every minute."}
          </Text>
        </View>
      ) : null}

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, settingsTab === 0 && styles.tabItemActive]}
          onPress={() => setSettingsTab(0)}
        >
          <Text
            style={[
              styles.tabItemText,
              settingsTab === 0 && styles.tabItemTextActive,
            ]}
          >
            Server Setting
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabItem, settingsTab === 1 && styles.tabItemActive]}
          onPress={() => setSettingsTab(1)}
        >
          <Text
            style={[
              styles.tabItemText,
              settingsTab === 1 && styles.tabItemTextActive,
            ]}
          >
            Data Management
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabItem, settingsTab === 2 && styles.tabItemActive]}
          onPress={() => setSettingsTab(2)}
        >
          <Text
            style={[
              styles.tabItemText,
              settingsTab === 2 && styles.tabItemTextActive,
            ]}
          >
            About
          </Text>
        </TouchableOpacity>
      </View>

      {settingsTab === 0 ? (
      <View style={styles.form}>
        <Text style={styles.label}>API URL</Text>
        <Text style={styles.hint}>
          Server base only — e.g. http://192.168.5.202:3000 (do not add /api at the end)
        </Text>
            <TextInput
              style={styles.input}
              value={apiUrl}
              onChangeText={setApiUrl}
              placeholder="http://192.168.5.202:3000"
              autoCapitalize="none"
              keyboardType="url"
            />

            <Text style={styles.label}>Device ID (server / Asset ID)</Text>
            <Text style={styles.helpText}>
              Used for mobile login and device approval. Keep the auto-generated value,
              or replace with your printed Asset ID. Scan the label to fill this field.
            </Text>
            <TextInput
              style={styles.input}
              value={deviceId}
              onChangeText={setDeviceId}
              placeholder="DEVICE-001 or scanned Asset ID"
              autoCapitalize="characters"
            />
            <TouchableOpacity
              style={styles.scanAssetButton}
              onPress={() => setDeviceIdScanVisible(true)}
            >
              <Text style={styles.scanAssetButtonText}>
                Scan Asset ID barcode
              </Text>
            </TouchableOpacity>

            <Text style={styles.label}>User code (login name)</Text>
            <Text style={styles.helpText}>
              Same value is stored for login and for activity fields on the server
              (previously shown as User ID + User code).
            </Text>
            <TextInput
              style={styles.input}
              value={userCode}
              onChangeText={setUserCode}
              placeholder="e.g. sysadmin"
              autoCapitalize="none"
            />

            <Text style={styles.label}>Password</Text>
            <Text style={styles.helpText}>
              Saved for automatic sign-in. Leave blank only if you sign in manually each time.
            </Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter password"
              secureTextEntry
              autoCapitalize="none"
            />

            <TouchableOpacity
              style={styles.settingsNavRow}
              onPress={openChangePassword}
            >
              <View style={styles.settingsNavRowTextWrap}>
                <Text style={styles.settingsNavRowTitle}>Change password</Text>
                <Text style={styles.settingsNavRowSubtitle}>
                  Update your WMS server password
                </Text>
              </View>
              <Text style={styles.settingsNavRowChevron}>›</Text>
            </TouchableOpacity>

            <Text style={styles.label}>Item master sync</Text>
            <Text style={styles.helpText}>
              Full: clears local items then downloads all pages. Incremental: only
              rows changed since the watermark (requires API modified_since).
            </Text>
            <View style={styles.itemMasterModeRow}>
              <TouchableOpacity
                style={[
                  styles.modeChip,
                  itemMasterSyncMode === "full" && styles.modeChipSelected,
                ]}
                onPress={() => setItemMasterSyncMode("full")}
              >
                <Text
                  style={[
                    styles.modeChipText,
                    itemMasterSyncMode === "full" && styles.modeChipTextSelected,
                  ]}
                >
                  Full
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modeChip,
                  itemMasterSyncMode === "incremental" && styles.modeChipSelected,
                ]}
                onPress={() => setItemMasterSyncMode("incremental")}
              >
                <Text
                  style={[
                    styles.modeChipText,
                    itemMasterSyncMode === "incremental" &&
                      styles.modeChipTextSelected,
                  ]}
                >
                  Incremental
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.label}>Item master page size (per request)</Text>
            <TextInput
              style={styles.input}
              value={itemMasterPageSize}
              onChangeText={setItemMasterPageSize}
              placeholder="5000"
              keyboardType="number-pad"
            />
            <Text style={styles.helpText}>
              Range 500–20000. Smaller pages use less memory; larger pages mean fewer
              HTTP calls.
            </Text>
            {itemMasterWatermarkPreview ? (
              <Text style={styles.watermarkHint} numberOfLines={2}>
                Incremental watermark: {itemMasterWatermarkPreview}
              </Text>
            ) : (
              <Text style={styles.watermarkHint}>Incremental watermark: (none)</Text>
            )}
            <TouchableOpacity
              style={styles.clearWatermarkButton}
              onPress={async () => {
                try {
                  await saveSettings({ item_master_modified_watermark: null });
                  setItemMasterWatermarkPreview(null);
                  Alert.alert(
                    "Watermark cleared",
                    "Next incremental sync will load changes from the server baseline (no modified_since filter until a new sync completes)."
                  );
                } catch (e: any) {
                  Alert.alert("Error", e?.message || "Failed to clear");
                }
              }}
            >
              <Text style={styles.clearWatermarkText}>
                Clear incremental watermark
              </Text>
            </TouchableOpacity>

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
          <>
            <TouchableOpacity
              style={[
                styles.syncButton,
                (syncing || deviceSessionRestricted) && styles.buttonDisabled,
              ]}
              onPress={handleSync}
              disabled={syncing || deviceSessionRestricted}
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
            {userSyncStatusLine ? (
              <Text style={styles.userSyncStatusText}>{userSyncStatusLine}</Text>
            ) : null}
            <TouchableOpacity
              style={[
                styles.syncNowButton,
                (syncingFull || syncing || deviceSessionRestricted) &&
                  styles.buttonDisabled,
              ]}
              onPress={handleSyncNow}
              disabled={syncingFull || syncing || deviceSessionRestricted}
            >
              {syncingFull ? (
                <View style={styles.buttonLoading}>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={styles.buttonText}>Syncing...</Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>🔄 Sync Now (Master + Events + Receive Data)</Text>
              )}
            </TouchableOpacity>
            {fullSyncStatusLine ? (
              <Text style={styles.fullSyncStatusText}>{fullSyncStatusLine}</Text>
            ) : null}
          </>
        )}
      </View>
      ) : settingsTab === 1 ? (
      <View style={styles.form}>
        <Text style={styles.dataTabSectionTitle}>Transaction data</Text>
        <View style={styles.transactionClearZone}>
          <TouchableOpacity
            style={[
              styles.transactionClearButton,
              clearingTransactionData && styles.buttonDisabled,
              deviceSessionRestricted && styles.buttonDisabled,
            ]}
            disabled={deviceSessionRestricted || clearingTransactionData}
            onPress={() => {
              if (deviceSessionRestricted) {
                Alert.alert(
                  deviceSessionBlockReason === "disabled"
                    ? "Device disabled"
                    : "Device pending approval",
                  "Data management is not available until this device is allowed to use the warehouse app."
                );
                return;
              }
              Alert.alert(
                "Clear All Transaction Data",
                "This will permanently delete ALL transaction data:\n\n• All events\n• All scanned items\n• All workflow states\n• All carton statuses\n• All boxes\n• All transfer cartons\n• All cartons (CTN)\n• All ASN data\n• All transfer orders\n• All transfer in data\n• All material requests\n• All cycle count sessions\n• All cycle count lines\n• All cycle count cache\n• All stock ledger cache\n• All stock transactions\n• All putaway items\n• All inbound sessions\n• Active ASN and session\n\nMaster data will also be cleared:\n• Items, users, warehouses, locations\n• Bins, item barcode maps\n• Warehouse racks\n\n⚠️ Master data will be automatically repopulated from backend during next sync.\n\nThis action cannot be undone!\n\nSettings and demo data structure will be preserved.\n\nAre you sure?",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Clear All Data",
                    style: "destructive",
                    onPress: async () => {
                      setClearingTransactionData(true);
                      try {
                        await dataService.clearAllTransactionData();
                        setActiveASN(null);
                        setActiveSession(null);
                        await refreshSettings();
                        await refreshPendingEvents();
                        await loadSettings();
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
                        setClearingTransactionData(false);
                      }
                    },
                  },
                ]
              );
            }}
          >
            {clearingTransactionData ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <ActivityIndicator
                  size="small"
                  color="#fff"
                  style={{ marginRight: 10 }}
                />
                <Text style={styles.transactionClearButtonText}>
                  Clearing Data...
                </Text>
              </View>
            ) : (
              <Text style={styles.transactionClearButtonText}>
                🗑️ Clear All Transaction Data
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.dataTabSectionTitle}>Backup & database</Text>
        <View style={styles.dangerZone}>
          <TouchableOpacity
            style={[styles.backupButton, backupBusy && styles.buttonDisabled]}
            onPress={async () => {
              if (backupBusy) return;
              setBackupBusy(true);
              try {
                const result = await shareDatabaseBackup();
                Alert.alert(
                  "Backup ready — share sheet",
                  `Created: ${result.filename}\n\nPick Gmail, Drive, etc. if you want to send or upload it.\n\nTip: “Files by Google” with “Download” here often only opens the Downloads folder — it does not save the file. To save on the phone, use “Save backup to folder…” below instead.`,
                  [{ text: "OK" }]
                );
              } catch (error: any) {
                Alert.alert(
                  "Backup failed",
                  error?.message ?? "Could not create backup."
                );
              } finally {
                setBackupBusy(false);
              }
            }}
            disabled={backupBusy}
          >
            {backupBusy ? (
              <View style={styles.buttonLoading}>
                <ActivityIndicator color="#2E7D32" size="small" />
                <Text style={styles.backupButtonText}>Creating backup…</Text>
              </View>
            ) : (
              <Text style={styles.backupButtonText}>
                💾 Backup Full Database
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.backupFolderButton,
              backupFolderBusy && styles.buttonDisabled,
            ]}
            onPress={async () => {
              if (backupFolderBusy) return;
              setBackupFolderBusy(true);
              try {
                const result = await saveDatabaseBackupToPickedFolder();
                if (!result) return;
                Alert.alert(
                  "Saved",
                  `Backup written as:\n${result.filename}\n\nOpen your Files app and browse to the folder you chose (e.g. Downloads on Android).`,
                  [{ text: "OK" }]
                );
              } catch (error: any) {
                Alert.alert(
                  "Save failed",
                  error?.message ?? "Could not save backup to that folder."
                );
              } finally {
                setBackupFolderBusy(false);
              }
            }}
            disabled={backupFolderBusy}
          >
            {backupFolderBusy ? (
              <View style={styles.buttonLoading}>
                <ActivityIndicator color="#1565C0" size="small" />
                <Text style={styles.backupFolderButtonText}>Saving…</Text>
              </View>
            ) : (
              <Text style={styles.backupFolderButtonText}>
                📁 Save backup to folder…
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.restoreButton, restoreBusy && styles.buttonDisabled]}
            onPress={() => {
              if (restoreBusy) return;
              Alert.alert(
                "Restore database",
                "This replaces ALL local data with the chosen backup file, including API URL, device ID, sessions, cache, and queue.\n\nStop scanning or syncing first. This cannot be undone.\n\nContinue?",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Choose backup file…",
                    style: "destructive",
                    onPress: async () => {
                      setRestoreBusy(true);
                      try {
                        const restored = await pickAndRestoreDatabase();
                        if (!restored) {
                          setRestoreBusy(false);
                          return;
                        }
                        await refreshSettings();
                        await refreshPendingEvents();
                        Alert.alert(
                          "Restore complete",
                          "The database was restored from the backup. Verify API URL and credentials, then sync if needed.",
                          [{ text: "OK" }]
                        );
                      } catch (error: any) {
                        Alert.alert(
                          "Restore failed",
                          error?.message ?? "Could not restore backup."
                        );
                      } finally {
                        setRestoreBusy(false);
                      }
                    },
                  },
                ]
              );
            }}
            disabled={restoreBusy}
          >
            {restoreBusy ? (
              <View style={styles.buttonLoading}>
                <ActivityIndicator color="#E65100" size="small" />
                <Text style={styles.restoreButtonText}>Restoring…</Text>
              </View>
            ) : (
              <Text style={styles.restoreButtonText}>
                📂 Restore From Backup
              </Text>
            )}
          </TouchableOpacity>

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
      ) : (
      <View style={styles.form}>
        <Text style={styles.aboutIntro}>
          Read-only device and app details (useful for support).
        </Text>
        <View
          style={[styles.runtimeSummaryCard, styles.runtimeSummaryCardInForm]}
        >
          <Text style={styles.runtimeSummaryTitle}>Device summary</Text>
          <Text style={styles.runtimeSummaryLine}>
            Mode: {settings?.demo_mode ? "Demo" : "Production"}
          </Text>
          {(settings?.user_code || settings?.user_id) && (
            <Text style={styles.runtimeSummaryLine}>
              User: {settings?.user_code || settings?.user_id}
            </Text>
          )}
          {settings?.device_id ? (
            <Text style={styles.runtimeSummaryLine}>
              Device: {settings.device_id}
            </Text>
          ) : null}
          <Text style={styles.runtimeSummaryLine}>
            Version: {getAppVersionDetails()}
          </Text>
        </View>
      </View>
      )}
    </ScrollView>
    <BarcodeScanModal
      visible={deviceIdScanVisible}
      title="Scan Asset / Device ID"
      onClose={() => setDeviceIdScanVisible(false)}
      onScan={(raw) => {
        const v = String(raw || "").trim();
        if (v) {
          setDeviceId(v.toUpperCase());
        }
        setDeviceIdScanVisible(false);
      }}
    />
    <ScreenFooterFrame />
    </View>
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
  pendingDeviceBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    backgroundColor: "#FFF8E1",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FFC107",
  },
  pendingDeviceBannerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#BF360C",
    marginBottom: 6,
  },
  pendingDeviceBannerText: {
    fontSize: 14,
    color: "#5D4037",
    lineHeight: 20,
  },
  aboutIntro: {
    fontSize: 13,
    color: "#666",
    marginBottom: 12,
    lineHeight: 18,
  },
  runtimeSummaryCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  runtimeSummaryTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#333",
    marginBottom: 10,
  },
  runtimeSummaryLine: {
    fontSize: 14,
    color: "#666",
    marginBottom: 4,
  },
  runtimeSummaryCardInForm: {
    marginHorizontal: 0,
    marginTop: 0,
  },
  transactionClearZone: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#FF9800",
  },
  tabBar: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#C5CAE9",
    backgroundColor: "#E8EAF6",
  },
  tabItem: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  tabItemActive: {
    backgroundColor: "#fff",
    borderBottomWidth: 2,
    borderBottomColor: "#007AFF",
  },
  tabItemText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#5C6BC0",
    textAlign: "center",
  },
  tabItemTextActive: {
    color: "#007AFF",
  },
  dataTabSectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#333",
    marginBottom: 10,
    marginTop: 8,
  },
  transactionClearButton: {
    backgroundColor: "#FF9800",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  transactionClearButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
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
  hint: {
    fontSize: 13,
    color: "#666",
    marginTop: -4,
    marginBottom: 8,
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
  settingsNavRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
  },
  settingsNavRowTextWrap: {
    flex: 1,
    paddingRight: 8,
  },
  settingsNavRowTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#007AFF",
    marginBottom: 2,
  },
  settingsNavRowSubtitle: {
    fontSize: 13,
    color: "#666",
  },
  settingsNavRowChevron: {
    fontSize: 24,
    color: "#999",
    fontWeight: "300",
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
  userSyncStatusText: {
    fontSize: 14,
    color: "#333",
    marginTop: 8,
    marginBottom: 4,
  },
  syncNowButton: {
    backgroundColor: "#2196F3",
    padding: 18,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  fullSyncStatusText: {
    fontSize: 14,
    color: "#333",
    marginTop: 10,
    marginBottom: 8,
    lineHeight: 20,
  },
  helpText: {
    fontSize: 13,
    color: "#666",
    marginBottom: 10,
    lineHeight: 18,
  },
  itemMasterModeRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
    flexWrap: "wrap",
  },
  modeChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    backgroundColor: "#f5f5f5",
  },
  modeChipSelected: {
    borderColor: "#007AFF",
    backgroundColor: "#E3F2FD",
  },
  modeChipText: {
    fontSize: 15,
    color: "#333",
  },
  modeChipTextSelected: {
    color: "#007AFF",
    fontWeight: "600",
  },
  watermarkHint: {
    fontSize: 12,
    color: "#666",
    marginBottom: 8,
  },
  clearWatermarkButton: {
    marginBottom: 16,
  },
  clearWatermarkText: {
    fontSize: 14,
    color: "#C62828",
    fontWeight: "600",
  },
  scanAssetButton: {
    alignSelf: "flex-start",
    marginBottom: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "#E3F2FD",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#90CAF9",
  },
  scanAssetButtonText: {
    color: "#1565C0",
    fontSize: 15,
    fontWeight: "600",
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
  backupButton: {
    backgroundColor: "#E8F5E9",
    borderWidth: 2,
    borderColor: "#4CAF50",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  backupButtonText: {
    color: "#2E7D32",
    fontSize: 16,
    fontWeight: "bold",
  },
  backupFolderButton: {
    backgroundColor: "#E3F2FD",
    borderWidth: 2,
    borderColor: "#1976D2",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  backupFolderButtonText: {
    color: "#1565C0",
    fontSize: 16,
    fontWeight: "bold",
  },
  restoreButton: {
    backgroundColor: "#FFF3E0",
    borderWidth: 2,
    borderColor: "#FF9800",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 12,
  },
  restoreButtonText: {
    color: "#E65100",
    fontSize: 16,
    fontWeight: "bold",
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
