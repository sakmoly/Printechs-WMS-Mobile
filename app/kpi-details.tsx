import React from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useKpis } from "../src/hooks/useKpis";

const { width } = Dimensions.get("window");

export default function KpiDetailsScreen() {
  const { kpiId } = useLocalSearchParams<{ kpiId: string }>();
  const { data: kpiData } = useKpis();

  // Find the specific KPI
  const kpi = kpiData?.kpis?.find((k) => k.id === kpiId);

  if (!kpi) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle" size={64} color="#ef4444" />
        <Text style={styles.errorText}>KPI not found</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isPositive = kpi.change_direction === "up";
  const gradientColors = isPositive
    ? ["#10b981", "#059669"]
    : ["#ef4444", "#dc2626"];

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={["#667eea", "#764ba2"]}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <TouchableOpacity
          style={styles.headerBackButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{kpi.title}</Text>
        <View style={styles.headerPlaceholder} />
      </LinearGradient>

      <ScrollView style={styles.content}>
        {/* Main KPI Value */}
        <LinearGradient
          colors={gradientColors}
          style={styles.mainCard}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <Text style={styles.mainCardLabel}>Current Value</Text>
          <Text style={styles.mainCardValue}>
            {kpi.currency || ""}
            {kpi.value?.toLocaleString() || kpi.value}
            {kpi.unit || ""}
          </Text>
          <View style={styles.changeContainer}>
            <Ionicons
              name={isPositive ? "trending-up" : "trending-down"}
              size={20}
              color="#ffffff"
            />
            <Text style={styles.changeText}>
              {kpi.change_percentage}% {kpi.change_period || "vs last period"}
            </Text>
          </View>
        </LinearGradient>

        {/* Statistics Grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Ionicons name="calendar" size={24} color="#667eea" />
            <Text style={styles.statLabel}>Period</Text>
            <Text style={styles.statValue}>
              {kpiId.includes("mtd") ? "Month to Date" : "Year to Date"}
            </Text>
          </View>

          <View style={styles.statCard}>
            <Ionicons name="trending-up" size={24} color="#10b981" />
            <Text style={styles.statLabel}>Change</Text>
            <Text style={styles.statValue}>
              {isPositive ? "+" : ""}
              {kpi.change_percentage}%
            </Text>
          </View>

          <View style={styles.statCard}>
            <Ionicons name="analytics" size={24} color="#f59e0b" />
            <Text style={styles.statLabel}>Type</Text>
            <Text style={styles.statValue}>
              {kpi.unit === "%" ? "Percentage" : "Currency"}
            </Text>
          </View>

          <View style={styles.statCard}>
            <Ionicons name="pulse" size={24} color="#ef4444" />
            <Text style={styles.statLabel}>Status</Text>
            <Text style={styles.statValue}>
              {isPositive ? "Growing" : "Declining"}
            </Text>
          </View>
        </View>

        {/* Insights */}
        <View style={styles.insightsCard}>
          <Text style={styles.sectionTitle}>📊 Key Insights</Text>

          <View style={styles.insightItem}>
            <View style={styles.insightIcon}>
              <Ionicons
                name={isPositive ? "checkmark-circle" : "alert-circle"}
                size={24}
                color={isPositive ? "#10b981" : "#ef4444"}
              />
            </View>
            <View style={styles.insightContent}>
              <Text style={styles.insightTitle}>Performance Trend</Text>
              <Text style={styles.insightText}>
                {isPositive
                  ? `${kpi.title} is showing positive growth of ${kpi.change_percentage}% compared to the previous period.`
                  : `${kpi.title} has decreased by ${kpi.change_percentage}% compared to the previous period.`}
              </Text>
            </View>
          </View>

          <View style={styles.insightItem}>
            <View style={styles.insightIcon}>
              <Ionicons name="bar-chart" size={24} color="#667eea" />
            </View>
            <View style={styles.insightContent}>
              <Text style={styles.insightTitle}>Current Value</Text>
              <Text style={styles.insightText}>
                The current {kpi.title.toLowerCase()} is {kpi.currency || ""}
                {kpi.value?.toLocaleString() || kpi.value}
                {kpi.unit || ""}, showing {isPositive ? "strong" : "declining"}{" "}
                performance.
              </Text>
            </View>
          </View>

          <View style={styles.insightItem}>
            <View style={styles.insightIcon}>
              <Ionicons name="bulb" size={24} color="#f59e0b" />
            </View>
            <View style={styles.insightContent}>
              <Text style={styles.insightTitle}>Recommendation</Text>
              <Text style={styles.insightText}>
                {isPositive
                  ? "Continue current strategies to maintain this positive trend. Monitor closely to identify success factors."
                  : "Review current strategies and identify areas for improvement. Consider analyzing competitor performance and market trends."}
              </Text>
            </View>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionButtons}>
          <TouchableOpacity style={styles.actionButton}>
            <Ionicons name="download" size={20} color="#667eea" />
            <Text style={styles.actionButtonText}>Export Report</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton}>
            <Ionicons name="share" size={20} color="#667eea" />
            <Text style={styles.actionButtonText}>Share</Text>
          </TouchableOpacity>
        </View>

        {/* Note */}
        <View style={styles.noteCard}>
          <Ionicons name="information-circle" size={20} color="#667eea" />
          <Text style={styles.noteText}>
            This is a detailed view showing analytics for {kpi.title}. More
            detailed charts and historical data will be available once the
            backend APIs are fully integrated.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 20,
  },
  headerBackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#ffffff",
    flex: 1,
    textAlign: "center",
  },
  headerPlaceholder: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  mainCard: {
    margin: 20,
    marginTop: -20,
    padding: 30,
    borderRadius: 20,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  mainCardLabel: {
    fontSize: 14,
    color: "rgba(255,255,255,0.8)",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  mainCardValue: {
    fontSize: 48,
    fontWeight: "800",
    color: "#ffffff",
    marginBottom: 12,
  },
  changeContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  changeText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
    marginLeft: 8,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  statCard: {
    width: (width - 60) / 2,
    backgroundColor: "#ffffff",
    padding: 20,
    borderRadius: 16,
    margin: 5,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statLabel: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 8,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2937",
    textAlign: "center",
  },
  insightsCard: {
    backgroundColor: "#ffffff",
    margin: 20,
    marginTop: 0,
    padding: 20,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: 16,
  },
  insightItem: {
    flexDirection: "row",
    marginBottom: 20,
  },
  insightIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  insightContent: {
    flex: 1,
  },
  insightTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: 4,
  },
  insightText: {
    fontSize: 13,
    color: "#6b7280",
    lineHeight: 18,
  },
  actionButtons: {
    flexDirection: "row",
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginHorizontal: 5,
    borderWidth: 1,
    borderColor: "#667eea",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#667eea",
    marginLeft: 8,
  },
  noteCard: {
    flexDirection: "row",
    backgroundColor: "#eff6ff",
    margin: 20,
    marginTop: 0,
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#667eea",
  },
  noteText: {
    flex: 1,
    fontSize: 13,
    color: "#1e40af",
    marginLeft: 12,
    lineHeight: 18,
  },
  errorContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1f2937",
    marginTop: 16,
    marginBottom: 24,
  },
  backButton: {
    backgroundColor: "#667eea",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
});
