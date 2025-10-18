import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../store/auth";

interface ServerConfigProps {
  onSave?: () => void;
}

export const ServerConfig: React.FC<ServerConfigProps> = ({ onSave }) => {
  const { serverConfig, updateServerConfig } = useAuthStore();
  const [isUrlMode, setIsUrlMode] = useState(true);
  const [serverUrl, setServerUrl] = useState(serverConfig.serverUrl || "");
  const [hostname, setHostname] = useState(serverConfig.hostname || "");
  const [port, setPort] = useState(serverConfig.port?.toString() || "8000");
  const [isHttps, setIsHttps] = useState(serverConfig.isHttps ?? true);

  const handleSave = () => {
    if (isUrlMode) {
      if (!serverUrl.trim()) {
        Alert.alert("Error", "Please enter a valid server URL");
        return;
      }
      updateServerConfig({
        serverUrl: serverUrl.trim(),
        hostname: "",
        port: 0,
        isHttps: true,
      });
    } else {
      if (!hostname.trim() || !port.trim()) {
        Alert.alert("Error", "Please enter hostname and port");
        return;
      }
      const portNumber = parseInt(port);
      if (isNaN(portNumber) || portNumber <= 0 || portNumber > 65535) {
        Alert.alert("Error", "Please enter a valid port number (1-65535)");
        return;
      }
      updateServerConfig({
        serverUrl: "",
        hostname: hostname.trim(),
        port: portNumber,
        isHttps,
      });
    }
    Alert.alert("Success", "Server configuration saved successfully!");
    onSave?.();
  };

  const getCurrentServerDisplay = () => {
    if (isUrlMode) {
      return serverUrl || "No server configured";
    } else {
      const protocol = isHttps ? "https" : "http";
      return hostname && port
        ? `${protocol}://${hostname}:${port}`
        : "No server configured";
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="server-outline" size={24} color="#667eea" />
        <Text style={styles.title}>Server Configuration</Text>
      </View>

      <View style={styles.switchContainer}>
        <Text style={styles.switchLabel}>Configuration Mode:</Text>
        <View style={styles.switchRow}>
          <Text
            style={[styles.switchText, isUrlMode && styles.activeSwitchText]}
          >
            URL
          </Text>
          <Switch
            value={!isUrlMode}
            onValueChange={(value) => setIsUrlMode(!value)}
            trackColor={{ false: "#e5e7eb", true: "#667eea" }}
            thumbColor="#ffffff"
          />
          <Text
            style={[styles.switchText, !isUrlMode && styles.activeSwitchText]}
          >
            Hostname
          </Text>
        </View>
      </View>

      <View style={styles.form}>
        {isUrlMode ? (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Server URL</Text>
            <TextInput
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="https://your-erpnext-server.com"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.helpText}>
              Enter the complete URL of your ERPNext server
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Hostname</Text>
              <TextInput
                style={styles.input}
                value={hostname}
                onChangeText={setHostname}
                placeholder="your-erpnext-server.com"
                keyboardType="default"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Port</Text>
              <TextInput
                style={styles.input}
                value={port}
                onChangeText={setPort}
                placeholder="8000"
                keyboardType="numeric"
              />
            </View>
            <View style={styles.switchContainer}>
              <Text style={styles.label}>Use HTTPS</Text>
              <Switch
                value={isHttps}
                onValueChange={setIsHttps}
                trackColor={{ false: "#e5e7eb", true: "#667eea" }}
                thumbColor="#ffffff"
              />
            </View>
          </>
        )}
      </View>

      <View style={styles.currentServer}>
        <Text style={styles.currentServerLabel}>Current Server:</Text>
        <Text style={styles.currentServerValue}>
          {getCurrentServerDisplay()}
        </Text>
      </View>

      <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
        <Ionicons name="save-outline" size={20} color="#ffffff" />
        <Text style={styles.saveButtonText}>Save Configuration</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1f2937",
    marginLeft: 12,
  },
  switchContainer: {
    marginBottom: 20,
  },
  switchLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 12,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  switchText: {
    fontSize: 14,
    color: "#6b7280",
    fontWeight: "500",
  },
  activeSwitchText: {
    color: "#667eea",
    fontWeight: "700",
  },
  form: {
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: "#f9fafb",
  },
  helpText: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
  },
  currentServer: {
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  currentServerLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6b7280",
    marginBottom: 4,
  },
  currentServerValue: {
    fontSize: 14,
    color: "#374151",
    fontWeight: "500",
  },
  saveButton: {
    backgroundColor: "#667eea",
    borderRadius: 8,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
});
