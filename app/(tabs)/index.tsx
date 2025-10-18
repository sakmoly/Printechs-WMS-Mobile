import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { useKpis, useSalesDailyChart } from "../../src/hooks/useKpis";
import { KpiCard } from "../../src/components/KpiCard";
import { SalesChart } from "../../src/components/SalesChart";
import { LoadingScreen } from "../../src/components/LoadingScreen";
import { Ionicons } from "@expo/vector-icons";

const GRADIENT_COLORS = [
  ["#667eea", "#764ba2"],
  ["#f093fb", "#f5576c"],
  ["#4facfe", "#00f2fe"],
  ["#43e97b", "#38f9d7"],
  ["#fa709a", "#fee140"],
  ["#30cfd0", "#330867"],
];

export default function DashboardScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const { data: kpiData, isLoading, error, refetch } = useKpis();
  const salesDaily = useSalesDailyChart();

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading && !kpiData) {
    return <LoadingScreen message="Loading analytics..." />;
  }

  if (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const isNetworkError =
      errorMessage.includes("Network Error") ||
      errorMessage.includes("timeout");

    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle" size={64} color="#ef4444" />
        <Text style={styles.errorTitle}>Failed to Load Dashboard</Text>
        <Text style={styles.errorMessage}>{errorMessage}</Text>

        {isNetworkError && (
          <View style={styles.troubleshootCard}>
            <Ionicons name="bulb-outline" size={20} color="#f59e0b" />
            <View style={styles.troubleshootContent}>
              <Text style={styles.troubleshootTitle}>
                Troubleshooting Tips:
              </Text>
              <Text style={styles.troubleshootItem}>
                • Check your server URL in Settings
              </Text>
              <Text style={styles.troubleshootItem}>
                • Ensure your ERPNext server is running
              </Text>
              <Text style={styles.troubleshootItem}>
                • Verify your device has internet access
              </Text>
              <Text style={styles.troubleshootItem}>
                • Try logging out and back in
              </Text>
            </View>
          </View>
        )}

        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Ionicons name="refresh-outline" size={20} color="#ffffff" />
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#667eea"
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>Welcome Back!</Text>
        <Text style={styles.date}>
          {kpiData?.date ||
            new Date().toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
        </Text>
      </View>

      {/* KPI Cards */}
      <View style={styles.kpiGrid}>
        {kpiData?.kpis.map((kpi, index) => (
          <KpiCard
            key={kpi.id}
            label={kpi.title}
            value={kpi.value}
            delta={kpi.change_percentage}
            format={kpi.unit ? "percentage" : "currency"}
            currency={kpi.currency}
            unit={kpi.unit}
            changeDirection={kpi.change_direction}
            colors={kpi.background_gradient}
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 24,
  },
  greeting: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#1f2937",
    marginBottom: 4,
  },
  date: {
    fontSize: 14,
    color: "#6b7280",
  },
  kpiGrid: {
    marginBottom: 8,
  },
  periodCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  periodText: {
    fontSize: 14,
    color: "#4b5563",
    fontWeight: "500",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: "#f9fafb",
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1f2937",
    marginTop: 16,
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 24,
  },
  troubleshootCard: {
    backgroundColor: "#fffbeb",
    borderRadius: 12,
    padding: 16,
    marginVertical: 16,
    maxWidth: "100%",
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  troubleshootContent: {
    flex: 1,
    marginLeft: 12,
  },
  troubleshootTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#92400e",
    marginBottom: 8,
  },
  troubleshootItem: {
    fontSize: 13,
    color: "#78350f",
    marginBottom: 4,
    lineHeight: 18,
  },
  retryButton: {
    backgroundColor: "#667eea",
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
