import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { apiService } from "../services/api.service";
import { getDatabase } from "../database/database";
import { getSettings } from "../services/settings.service";

export default function CycleCountDashboardScreen() {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({
    pendingBins: 0,
    completedToday: 0,
    variancesPendingApproval: 0,
    draftSessions: 0,
  });

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDatabase();
      
      // Count draft sessions
      const draftSessions = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM cycle_count_sessions WHERE status = 'Draft'"
      );
      
      // Count completed today
      const today = new Date().toISOString().split("T")[0];
      const completedToday = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM cycle_count_sessions WHERE status = 'Completed' AND DATE(completed_at) = ?",
        [today]
      );

      setStats({
        pendingBins: 0, // TODO: Get from API
        completedToday: completedToday?.count || 0,
        variancesPendingApproval: 0, // TODO: Get from API
        draftSessions: draftSessions?.count || 0,
      });
    } catch (error: any) {
      console.error("Error loading stats:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [loadStats])
  );

  const handleStartDirectedCount = () => {
    // TODO: Navigate to Directed Count List when implemented
    Alert.alert(
      "Coming Soon",
      "Directed Count feature will be available soon. For now, please use Ad-hoc Count."
    );
    // (navigation as any).navigate("CycleCountDirectedList");
  };

  const handleStartAdhocCount = () => {
    (navigation as any).navigate("CycleCountScanBin", {
      countType: "Adhoc",
    });
  };

  const handleViewDrafts = () => {
    (navigation as any).navigate("CycleCountDrafts");
  };

  const handleViewVariances = () => {
    // TODO: Navigate to Variances List when implemented
    Alert.alert(
      "Coming Soon",
      "Variances approval will be available soon."
    );
    // (navigation as any).navigate("CycleCountVariances");
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Cycle Count</Text>
        <Text style={styles.headerSubtitle}>Bin-Based Fast Scanning</Text>
      </View>

      {/* Action Buttons */}
      <View style={styles.actionsSection}>
        <TouchableOpacity
          style={[styles.actionButton, styles.primaryButton]}
          onPress={handleStartDirectedCount}
        >
          <Text style={styles.actionButtonIcon}>📋</Text>
          <Text style={styles.actionButtonText}>Start Directed Count</Text>
          <Text style={styles.actionButtonSubtext}>
            Count assigned bins from plan
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.secondaryButton]}
          onPress={handleStartAdhocCount}
        >
          <Text style={styles.actionButtonIcon}>🔍</Text>
          <Text style={styles.actionButtonText}>Start Ad-hoc Count</Text>
          <Text style={styles.actionButtonSubtext}>
            Scan any bin to count
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, styles.infoButton]}
          onPress={handleViewDrafts}
        >
          <Text style={styles.actionButtonIcon}>📝</Text>
          <Text style={styles.actionButtonText}>My Drafts</Text>
          <Text style={styles.actionButtonSubtext}>
            {stats.draftSessions} draft session(s)
          </Text>
        </TouchableOpacity>
      </View>

      {/* Summary Cards */}
      <View style={styles.summarySection}>
        <Text style={styles.sectionTitle}>Summary</Text>

        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{stats.pendingBins}</Text>
            <Text style={styles.summaryLabel}>Pending Bins</Text>
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.summaryValue}>{stats.completedToday}</Text>
            <Text style={styles.summaryLabel}>Completed Today</Text>
          </View>

          <TouchableOpacity
            style={styles.summaryCard}
            onPress={handleViewVariances}
          >
            <Text style={[styles.summaryValue, styles.varianceValue]}>
              {stats.variancesPendingApproval}
            </Text>
            <Text style={styles.summaryLabel}>Variances Pending</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Sync Status */}
      <View style={styles.syncSection}>
        <Text style={styles.sectionTitle}>Sync Status</Text>
        <View style={styles.syncCard}>
          <Text style={styles.syncText}>🟢 Online</Text>
          <Text style={styles.syncSubtext}>All data synced</Text>
        </View>
      </View>

      {/* Removed Mock Data Info - data should come from backend sync */}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  header: {
    backgroundColor: "#9C27B0",
    padding: 24,
    paddingTop: 40,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#FFF",
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: "#E1BEE7",
  },
  actionsSection: {
    padding: 16,
    gap: 12,
  },
  actionButton: {
    backgroundColor: "#FFF",
    padding: 20,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  primaryButton: {
    borderLeftWidth: 4,
    borderLeftColor: "#9C27B0",
  },
  secondaryButton: {
    borderLeftWidth: 4,
    borderLeftColor: "#2196F3",
  },
  infoButton: {
    borderLeftWidth: 4,
    borderLeftColor: "#FF9800",
  },
  actionButtonIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  actionButtonText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  actionButtonSubtext: {
    fontSize: 14,
    color: "#666",
  },
  summarySection: {
    padding: 16,
    paddingTop: 0,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 12,
  },
  summaryGrid: {
    flexDirection: "row",
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  summaryValue: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#9C27B0",
    marginBottom: 4,
  },
  varianceValue: {
    color: "#FF9800",
  },
  summaryLabel: {
    fontSize: 12,
    color: "#666",
    textAlign: "center",
  },
  syncSection: {
    padding: 16,
    paddingTop: 0,
  },
  syncCard: {
    backgroundColor: "#FFF",
    padding: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  syncText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#4CAF50",
    marginBottom: 4,
  },
  syncSubtext: {
    fontSize: 14,
    color: "#666",
  },
  infoSection: {
    padding: 16,
    paddingTop: 0,
  },
  infoCard: {
    backgroundColor: "#E3F2FD",
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#2196F3",
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#1976D2",
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: "#333",
    marginBottom: 4,
  },
  infoSubtext: {
    fontSize: 12,
    color: "#666",
    marginTop: 8,
    fontStyle: "italic",
  },
});

