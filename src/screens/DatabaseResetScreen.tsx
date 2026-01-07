/**
 * Database Reset Screen
 * 
 * Provides a UI for resetting/recreating the database
 * Useful for testing and troubleshooting
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import {
  recreateDatabase,
  resetDatabase,
  getDatabaseStats,
} from "../database/database-reset";

export default function DatabaseResetScreen() {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{
    tables: string[];
    settingsCount: number;
    eventQueueCount: number;
    asnCacheCount: number;
  } | null>(null);

  const loadStats = async () => {
    try {
      const databaseStats = await getDatabaseStats();
      setStats(databaseStats);
    } catch (error: any) {
      Alert.alert("Error", `Failed to load database stats: ${error.message}`);
    }
  };

  const handleRecreateDatabase = async () => {
    Alert.alert(
      "⚠️ Warning",
      "This will DELETE ALL DATA and recreate the database from scratch.\n\n" +
        "All settings, events, ASNs, and other data will be lost!\n\n" +
        "Are you sure you want to continue?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Yes, Recreate Database",
          style: "destructive",
          onPress: async () => {
            setLoading(true);
            try {
              await recreateDatabase(true);
              Alert.alert("Success", "Database recreated successfully!");
              await loadStats();
            } catch (error: any) {
              Alert.alert("Error", `Failed to recreate database: ${error.message}`);
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  React.useEffect(() => {
    loadStats();
  }, []);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Database Reset Utility</Text>
        <Text style={styles.subtitle}>
          Use this screen to reset or recreate the database
        </Text>

        {stats && (
          <View style={styles.statsContainer}>
            <Text style={styles.statsTitle}>Current Database Stats:</Text>
            <Text style={styles.statsText}>
              Tables: {stats.tables.length} ({stats.tables.join(", ")})
            </Text>
            <Text style={styles.statsText}>
              Settings: {stats.settingsCount} record(s)
            </Text>
            <Text style={styles.statsText}>
              Event Queue: {stats.eventQueueCount} event(s)
            </Text>
            <Text style={styles.statsText}>
              ASN Cache: {stats.asnCacheCount} ASN(s)
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.refreshButton}
          onPress={loadStats}
          disabled={loading}
        >
          <Text style={styles.buttonText}>🔄 Refresh Stats</Text>
        </TouchableOpacity>

        <View style={styles.warningBox}>
          <Text style={styles.warningTitle}>⚠️ Warning</Text>
          <Text style={styles.warningText}>
            Recreating the database will:
            {"\n"}• Delete ALL data
            {"\n"}• Remove all tables
            {"\n"}• Recreate tables with fresh schema
            {"\n"}• Apply all migrations
            {"\n\n"}
            This action cannot be undone!
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.dangerButton, loading && styles.buttonDisabled]}
          onPress={handleRecreateDatabase}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.dangerButtonText}>
              🗑️ Recreate Database
            </Text>
          )}
        </TouchableOpacity>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>ℹ️ Information</Text>
          <Text style={styles.infoText}>
            After recreating the database:
            {"\n"}• You'll need to configure settings again
            {"\n"}• Login credentials will be cleared
            {"\n"}• All cached data will be removed
            {"\n"}• The app will start fresh
          </Text>
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
  content: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 8,
    color: "#333",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 24,
  },
  statsContainer: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  statsTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 12,
    color: "#333",
  },
  statsText: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
  },
  refreshButton: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 16,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  warningBox: {
    backgroundColor: "#fff3cd",
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#ffc107",
  },
  warningTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 8,
    color: "#856404",
  },
  warningText: {
    fontSize: 14,
    color: "#856404",
    lineHeight: 20,
  },
  dangerButton: {
    backgroundColor: "#dc3545",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 16,
  },
  dangerButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  infoBox: {
    backgroundColor: "#d1ecf1",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#bee5eb",
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 8,
    color: "#0c5460",
  },
  infoText: {
    fontSize: 14,
    color: "#0c5460",
    lineHeight: 20,
  },
});

