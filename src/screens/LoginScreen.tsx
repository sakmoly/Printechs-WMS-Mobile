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
  Image,
} from "react-native";
import {
  CommonActions,
  useNavigation,
  useFocusEffect,
} from "@react-navigation/native";
import { useApp } from "../context/AppContext";
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import { getSettings, saveSettings } from "../services/settings.service";
import { apiService } from "../services/api.service";
import { useNetworkStatus } from "../hooks/useNetworkStatus";

export default function LoginScreen() {
  const navigation = useNavigation();
  const { refreshSettings, refreshDeviceSessionStatus } = useApp();
  const { isOnline, isChecking } = useNetworkStatus();
  const [userCode, setUserCode] = useState("");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  useFocusEffect(
    React.useCallback(() => {
      loadSettings();
    }, [])
  );

  const loadSettings = async () => {
    const settings = await getSettings();
    setUserCode(settings.user_code || "");
    setPassword(settings.password || "");
    setDemoMode(settings.demo_mode === 1);

    // Pre-fill user code if available
    if (settings.user_code) {
      setUserCode(settings.user_code);
    }
  };

  const completeLogin = async (loginUser: string, loginPassword: string) => {
    const settings = await getSettings();
    await saveSettings({
      user_code: loginUser,
      ...(settings.user_id ? {} : { user_id: loginUser }),
      password: loginPassword,
      auth_token: undefined,
      auth_token_expires: undefined,
    });

    const token = await apiService.login(loginUser, loginPassword);
    if (token) {
      await refreshSettings();
      await refreshDeviceSessionStatus();
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: "Home" as never }],
        })
      );
      return true;
    }
    Alert.alert("Login Failed", "Invalid credentials or server error");
    return false;
  };

  const openSetupPassword = () => {
    navigation.navigate(
      "SetupPassword" as never,
      { userCode: userCode.trim() } as never
    );
  };

  const handleLogin = async () => {
    if (demoMode) {
      // In demo mode, go directly to home
      await refreshSettings();
      navigation.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: "Home" as never }],
        })
      );
      return;
    }

    if (!userCode || !password) {
      Alert.alert("Error", "Please enter User Code and Password");
      return;
    }

    setLoggingIn(true);
    try {
      const settings = await getSettings();

      if (!settings.api_url) {
        Alert.alert(
          "Configuration Required",
          "Please configure API URL in Settings first"
        );
        setLoggingIn(false);
        return;
      }

      const loginUser = userCode.trim();
      await completeLogin(loginUser, password);
    } catch (error: any) {
      console.error("Login error:", error);

      const errCode = (error as { code?: string }).code;
      if (errCode === "PASSWORD_NOT_SET") {
        Alert.alert(
          "Create your password",
          "No WMS password is set for this account yet. Create one to continue.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Create password",
              onPress: openSetupPassword,
            },
          ]
        );
        return;
      }

      if (
        errCode === "AUTH_SESSION_EXISTS" ||
        String(error?.message || "").includes("Login session issue") ||
        String(error?.message || "").includes(
          "active mobile login for this user"
        ) ||
        String(error?.message || "").includes(
          "already logged in on another mobile"
        )
      ) {
        Alert.alert(
          "Login session issue",
          error?.message ||
            "The server still shows an active mobile login for this user.",
          [
            { text: "OK", style: "cancel" },
            {
              text: "Use this device",
              onPress: async () => {
                setLoggingIn(true);
                try {
                  const currentSettings = await getSettings();
                  await saveSettings({
                    user_code: userCode.trim(),
                    ...(currentSettings.user_id
                      ? {}
                      : { user_id: userCode.trim() }),
                    password: password,
                    auth_token: undefined,
                    auth_token_expires: undefined,
                  });
                  const token = await apiService.login(
                    userCode.trim(),
                    password,
                    { replaceOtherMobileSession: true }
                  );
                  if (token) {
                    await refreshSettings();
                    await refreshDeviceSessionStatus();
                    navigation.dispatch(
                      CommonActions.reset({
                        index: 0,
                        routes: [{ name: "Home" as never }],
                      })
                    );
                  } else {
                    Alert.alert(
                      "Login Failed",
                      "Invalid credentials or server error"
                    );
                  }
                } catch (e2: any) {
                  Alert.alert(
                    "Login Error",
                    e2?.message || "Could not sign in on this device."
                  );
                } finally {
                  setLoggingIn(false);
                }
              },
            },
          ]
        );
        return;
      }

      // Provide more helpful error messages
      let errorMessage = error.message || "Failed to login";

      if (
        errCode === "AUTH_INVALID" ||
        errorMessage.includes("Invalid credentials") ||
        errorMessage.includes("AUTH_FAILED")
      ) {
        errorMessage = `Invalid credentials.\n\nPlease verify:\n1. User Code: "${userCode}"\n2. Password is correct (case-sensitive)\n3. User exists on the server\n\nIf you recently changed your password, use the new one.\nIf this is a new account with no password yet, tap "First time? Create your password" below.`;
      } else if (errorMessage.includes("401")) {
        errorMessage = `Authentication failed (401).\n\nPlease check:\n1. User Code and Password are correct\n2. User exists in the server database\n3. Server login endpoint is working\n4. Password is not hashed (server should compare plain text or hash the input)`;
      } else if (
        errorMessage.includes("timeout") ||
        errorMessage.includes("Timeout")
      ) {
        const currentSettings = await getSettings();
        errorMessage = `Login timeout.\n\nThe server took too long to respond.\n\nPlease check:\n1. API URL is correct: ${
          currentSettings?.api_url || "Not configured"
        }\n2. Server is running and accessible\n3. Network connection is stable\n4. Firewall is not blocking the connection`;
      } else if (
        errorMessage.includes("Could not load bundle") ||
        errorMessage.includes("Unable to resolve module")
      ) {
        errorMessage =
          "The app could not load a code module (often seen as \"Could not load bundle\").\n\n" +
          "If you are using Expo Go / a development build: the phone must reach your computer's Metro bundler, not only the API server.\n\n" +
          "Try:\n" +
          "• Same Wi‑Fi as the PC, or run: npx expo start --tunnel\n" +
          "• In Expo Dev Tools, switch connection to Tunnel or LAN as appropriate\n" +
          "• For a release APK/AAB, use a production build — dev clients need Metro\n\n" +
          `Details: ${error.message || errorMessage}`;
      } else if (
        errorMessage.includes("Network request failed") ||
        errorMessage.includes("Network") ||
        errorMessage.includes("Failed to connect") ||
        errorMessage.includes("ECONNREFUSED")
      ) {
        const currentSettings = await getSettings();
        const apiUrl = currentSettings?.api_url || "Not configured";
        
        // Detect if this is likely a physical device issue
        const isPhysicalDeviceIssue = 
          !apiUrl.includes("10.0.2.2") && // Not emulator
          !apiUrl.includes("localhost") && // Not localhost
          !apiUrl.includes("127.0.0.1"); // Not localhost
        
        if (isPhysicalDeviceIssue) {
          errorMessage = `Cannot connect to the server (Physical Device).\n\nAPI URL: ${apiUrl}\n\n⚠️ PHYSICAL DEVICE TROUBLESHOOTING:\n\n1. **Same WiFi Network**:\n   - Device and server MUST be on same WiFi\n   - Check WiFi name matches on both\n   - Try disconnecting/reconnecting WiFi\n\n2. **Server Firewall**:\n   - Windows: Allow port 3000 in Firewall\n   - Linux: sudo ufw allow 3000\n   - Check server firewall logs\n\n3. **Server IP Address**:\n   - Verify server IP: ipconfig (Windows) or ifconfig (Linux/Mac)\n   - IP may have changed - check server's current IP\n   - Try accessing ${apiUrl} in device's browser\n\n4. **Router Settings**:\n   - Some routers block device-to-device communication\n   - Check router's AP isolation/client isolation settings\n   - Disable "AP Isolation" if enabled\n\n5. **Alternative Solutions**:\n   - Use server's public IP if on same network\n   - Try mobile hotspot (device as hotspot, server connects)\n   - Use ngrok or similar tunnel service for testing\n\n6. **Quick Test**:\n   - Open ${apiUrl} in device's Chrome browser\n   - If browser can't connect, it's a network issue\n   - If browser connects, it's an app configuration issue`;
        } else {
          errorMessage = `Cannot connect to the server.\n\nAPI URL: ${apiUrl}\n\nTroubleshooting:\n\n1. **Check Server Status**:\n   - Is the backend server running?\n   - Is it listening on port 3000?\n\n2. **Check Network**:\n   - Are device and server on the same network?\n   - Can you ping the server IP?\n\n3. **Android Emulator**:\n   - If using emulator, use: http://10.0.2.2:3000\n   - (10.0.2.2 is the emulator's alias for host machine)\n\n4. **Physical Device**:\n   - Ensure device and server are on same WiFi\n   - Check firewall settings\n   - Try accessing ${apiUrl} in device browser\n\n5. **IP Address**:\n   - Verify server IP hasn't changed\n   - Check server's actual IP: ipconfig (Windows) or ifconfig (Linux/Mac)`;
        }
      }

      Alert.alert("Login Error", errorMessage);
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Image
          source={require("../../assets/printechs-logo.png")}
          style={styles.logo}
        />
        <Text style={styles.title}>Printechs WMS</Text>
        <Text style={styles.subtitle}>Login</Text>
      </View>

      <View style={styles.form}>
        {/* Network Status Indicator */}
        <View style={styles.networkStatusContainer}>
          <View style={[
            styles.networkStatusBadge,
            isOnline ? styles.networkStatusOnline : styles.networkStatusOffline
          ]}>
            {isChecking ? (
              <ActivityIndicator size="small" color="#fff" style={{ marginRight: 6 }} />
            ) : (
              <Text style={styles.networkStatusIcon}>
                {isOnline ? "🟢" : "🔴"}
              </Text>
            )}
            <Text style={styles.networkStatusText}>
              {isChecking ? "Checking..." : (isOnline ? "Online" : "Offline")}
            </Text>
          </View>
        </View>

        {demoMode ? (
          <View style={styles.demoInfo}>
            <Text style={styles.demoText}>
              Demo Mode enabled. Click Login to continue.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.label}>User Code</Text>
            <TextInput
              style={styles.input}
              value={userCode}
              onChangeText={setUserCode}
              placeholder="Enter user code"
              autoCapitalize="characters"
              autoFocus
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
          </>
        )}

        <TouchableOpacity
          style={[styles.button, loggingIn && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loggingIn}
        >
          {loggingIn ? (
            <View style={styles.buttonLoading}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.buttonText}>Logging in...</Text>
            </View>
          ) : (
            <Text style={styles.buttonText}>Login</Text>
          )}
        </TouchableOpacity>

        {!demoMode ? (
          <TouchableOpacity
            style={styles.modeToggleLink}
            onPress={openSetupPassword}
          >
            <Text style={styles.modeToggleLinkText}>
              First time? Create your password
            </Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={styles.settingsLink}
          onPress={() => navigation.navigate("Settings" as never)}
        >
          <Text style={styles.settingsLinkText}>⚙️ Settings</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
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
    padding: 48,
    alignItems: "center",
  },
  logo: {
    width: 128,
    height: 128,
    resizeMode: "contain",
    marginBottom: 16,
  },
  title: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 20,
    color: "#fff",
    opacity: 0.9,
  },
  form: {
    padding: 24,
    flex: 1,
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
    textAlign: "center",
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 18,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 24,
    marginBottom: 16,
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
  settingsLink: {
    padding: 16,
    alignItems: "center",
  },
  settingsLinkText: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "600",
  },
  modeToggleLink: {
    padding: 12,
    alignItems: "center",
  },
  modeToggleLinkText: {
    color: "#5856D6",
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
  networkStatusContainer: {
    alignItems: "center",
    marginBottom: 20,
    marginTop: 8,
  },
  networkStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  networkStatusOnline: {
    backgroundColor: "#4CAF50",
  },
  networkStatusOffline: {
    backgroundColor: "#F44336",
  },
  networkStatusIcon: {
    fontSize: 12,
    marginRight: 8,
  },
  networkStatusText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
});
