import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { useAuthStore } from "../../src/store/auth";
import { Ionicons } from "@expo/vector-icons";
import { env } from "../../src/config/env";
import { ServerConfig } from "../../src/components/ServerConfig";

export default function SettingsScreen() {
  const { user, logout, serverConfig } = useAuthStore();
  const [showServerConfig, setShowServerConfig] = useState(false);

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  const getCurrentServerDisplay = () => {
    return serverConfig.serverUrl || "No server configured";
  };

  return (
    <ScrollView style={styles.container}>
      {/* User Info */}
      <View style={styles.userCard}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={40} color="#667eea" />
        </View>
        <Text style={styles.userName}>
          {user?.full_name || user?.username || "User"}
        </Text>
        <Text style={styles.userEmail}>{user?.username}</Text>
      </View>

      {/* Server Configuration */}
      <ServerConfig onSave={() => setShowServerConfig(false)} />

      {/* Settings Options */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Current Configuration</Text>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Server URL:</Text>
          <Text style={styles.infoValue}>{getCurrentServerDisplay()}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Environment:</Text>
          <Text style={styles.infoValue}>
            {env.BUILD_VARIANT.toUpperCase()}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.editButton}
          onPress={() => setShowServerConfig(!showServerConfig)}
        >
          <Ionicons name="settings-outline" size={20} color="#667eea" />
          <Text style={styles.editButtonText}>Configure Server</Text>
        </TouchableOpacity>
      </View>

      {/* Logout Button */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={24} color="#ef4444" />
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>

      {/* Version */}
      <Text style={styles.version}>Version 2.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
    padding: 16,
  },
  userCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#e0e7ff",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  userName: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1f2937",
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 14,
    color: "#6b7280",
  },
  section: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: 16,
  },
  infoRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  infoLabel: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 14,
    color: "#1f2937",
    fontWeight: "500",
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: "#fee2e2",
  },
  logoutText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ef4444",
  },
  editButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    gap: 8,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#667eea",
  },
  version: {
    textAlign: "center",
    color: "#9ca3af",
    fontSize: 12,
    marginTop: 24,
  },
});
