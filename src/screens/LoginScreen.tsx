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
import { getSettings } from "../services/settings.service";
import { apiService } from "../services/api.service";

export default function LoginScreen() {
  const navigation = useNavigation();
  const { refreshSettings } = useApp();
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

  const handleLogin = async () => {
    if (demoMode) {
      // In demo mode, go directly to home
      await refreshSettings();
      navigation.navigate("Home" as never);
      return;
    }

    if (!userCode || !password) {
      Alert.alert("Error", "Please enter User Code and Password");
      return;
    }

    setLoggingIn(true);
    try {
      // Get settings once (reuse from loadSettings if possible, but ensure we have latest)
      const settings = await getSettings();

      if (!settings.api_url) {
        Alert.alert(
          "Configuration Required",
          "Please configure API URL in Settings first"
        );
        setLoggingIn(false);
        return;
      }

      // Combine both saveSettings calls into one to reduce database writes
      const { saveSettings } = await import("../services/settings.service");

      // Update user_code, password, and clear token in a single database operation
      await saveSettings({
        user_code: userCode.trim(),
        password: password,
        auth_token: undefined,
        auth_token_expires: undefined,
      });

      // Try to authenticate - this will use the updated user_code and password
      const token = await apiService.login(userCode.trim(), password);

      if (token) {
        // Refresh settings to update context (this is quick, just one DB read)
        await refreshSettings();
        navigation.navigate("Home" as never);
      } else {
        Alert.alert("Login Failed", "Invalid credentials or server error");
      }
    } catch (error: any) {
      console.error("Login error:", error);

      // Provide more helpful error messages
      let errorMessage = error.message || "Failed to login";

      if (
        errorMessage.includes("Invalid credentials") ||
        errorMessage.includes("AUTH_FAILED")
      ) {
        errorMessage = `Invalid credentials.\n\nPlease verify:\n1. User Code: "${userCode}"\n2. Password is correct (case-sensitive)\n3. User exists on the server\n\nCommon issues:\n• Password might be different on server\n• User might not be created yet\n• Check server logs for authentication errors\n\nTip: If this is a new setup, ensure the user exists in the server database with the correct password.`;
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
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Printechs WMS</Text>
        <Text style={styles.subtitle}>Login</Text>
      </View>

      <View style={styles.form}>
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

        <TouchableOpacity
          style={styles.settingsLink}
          onPress={() => navigation.navigate("Settings" as never)}
        >
          <Text style={styles.settingsLinkText}>⚙️ Settings</Text>
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
  header: {
    backgroundColor: "#007AFF",
    padding: 48,
    alignItems: "center",
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
});
