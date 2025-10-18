import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../store/auth";

interface ServerConfigProps {
  onSave?: () => void;
}

export const ServerConfig: React.FC<ServerConfigProps> = ({ onSave }) => {
  const { serverConfig, updateServerConfig } = useAuthStore();
  const [serverUrl, setServerUrl] = useState(serverConfig.serverUrl || "");

  useEffect(() => {
    setServerUrl(serverConfig.serverUrl || "");
  }, [serverConfig.serverUrl]);

  const handleSave = () => {
    if (!serverUrl.trim()) {
      Alert.alert("Error", "Please enter a valid server URL");
      return;
    }

    // Basic URL validation
    const trimmedUrl = serverUrl.trim();
    if (
      !trimmedUrl.startsWith("http://") &&
      !trimmedUrl.startsWith("https://")
    ) {
      Alert.alert(
        "Invalid URL",
        "URL must start with http:// or https://\n\nExamples:\n• https://erp.example.com\n• http://192.168.1.100:8000"
      );
      return;
    }

    updateServerConfig({
      serverUrl: trimmedUrl,
      hostname: "",
      port: 0,
      isHttps: trimmedUrl.startsWith("https://"),
    });

    Alert.alert("Success", "Server configuration saved successfully!");
    onSave?.();
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.keyboardView}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Ionicons name="server-outline" size={28} color="#667eea" />
            <Text style={styles.title}>ERPNext Server</Text>
          </View>

          <View style={styles.infoCard}>
            <Ionicons
              name="information-circle-outline"
              size={20}
              color="#667eea"
            />
            <Text style={styles.infoText}>
              Enter your complete ERPNext server URL. Include port number if
              needed.
            </Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Server URL</Text>
            <TextInput
              style={styles.input}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="https://erp.example.com:8000"
              placeholderTextColor="#9ca3af"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.helpText}>
              Examples:{"\n"}• https://erp.example.com{"\n"}•
              https://erp.example.com:443{"\n"}• http://192.168.1.100:8000
            </Text>
          </View>

          {serverConfig.serverUrl && (
            <View style={styles.currentServer}>
              <Text style={styles.currentServerLabel}>Current Server:</Text>
              <Text style={styles.currentServerValue}>
                {serverConfig.serverUrl}
              </Text>
            </View>
          )}

          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <Ionicons name="save-outline" size={20} color="#ffffff" />
            <Text style={styles.saveButtonText}>Save Configuration</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 24,
    margin: 16,
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
    fontSize: 20,
    fontWeight: "700",
    color: "#1f2937",
    marginLeft: 12,
  },
  infoCard: {
    flexDirection: "row",
    backgroundColor: "#eff6ff",
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: "#1e40af",
    marginLeft: 8,
    lineHeight: 18,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    backgroundColor: "#f9fafb",
    color: "#1f2937",
  },
  helpText: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 8,
    lineHeight: 18,
  },
  currentServer: {
    backgroundColor: "#f0fdf4",
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#86efac",
  },
  currentServerLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#15803d",
    marginBottom: 4,
  },
  currentServerValue: {
    fontSize: 14,
    color: "#166534",
    fontWeight: "500",
  },
  saveButton: {
    backgroundColor: "#667eea",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#667eea",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    marginLeft: 8,
  },
});
