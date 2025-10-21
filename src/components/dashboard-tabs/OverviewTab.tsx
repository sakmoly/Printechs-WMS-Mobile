import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { GaugeChart } from "../GaugeChart";

interface OverviewTabProps {
  salesMetrics: {
    totalSales: number;
    totalInvoices: number;
    avgInvoiceValue: number;
    costOfGoodsSold: number;
    grossProfit: number;
    grossProfitPercentage: number;
  } | null;
  formatCurrency: (value: number) => string;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  salesMetrics,
  formatCurrency,
}) => {
  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Total Sales - Hero Card */}
      <LinearGradient
        colors={["#667eea", "#764ba2"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroCard}
      >
        <Text style={styles.heroLabel}>TOTAL SALES</Text>
        <Text style={styles.heroValue}>
          {formatCurrency(salesMetrics?.totalSales || 0)}
        </Text>
        <View style={styles.heroSubtextContainer}>
          <Ionicons
            name="trending-up"
            size={14}
            color="rgba(255, 255, 255, 0.95)"
          />
          <Text style={styles.heroSubtext}>YTD vs LY</Text>
        </View>
      </LinearGradient>

      {/* Two Column Layout - Invoices & Avg Invoice */}
      <View style={styles.twoColumnRow}>
        <LinearGradient
          colors={["#3b82f6", "#2563eb"]}
          style={styles.compactCard}
        >
          <Text style={styles.compactLabel}>TOTAL INVOICES</Text>
          <Text style={styles.compactValue}>
            {(salesMetrics?.totalInvoices || 0).toLocaleString("en-US")}
          </Text>
          <View style={styles.compactBadge}>
            <Ionicons name="receipt-outline" size={14} color="#ffffff" />
          </View>
        </LinearGradient>

        <LinearGradient
          colors={["#8b5cf6", "#7c3aed"]}
          style={styles.compactCard}
        >
          <Text style={styles.compactLabel}>AVG INVOICE</Text>
          <Text style={styles.compactValue}>
            SAR{" "}
            {(salesMetrics?.avgInvoiceValue || 0).toLocaleString("en-US", {
              maximumFractionDigits: 0,
            })}
          </Text>
          <View style={styles.compactBadge}>
            <Ionicons name="cash-outline" size={14} color="#ffffff" />
          </View>
        </LinearGradient>
      </View>

      {/* Gross Profit Analysis - Gauge Chart */}
      <GaugeChart
        value={salesMetrics?.grossProfitPercentage || 0}
        maxValue={100}
        title="Gross Profit Margin"
        subtitle={`${formatCurrency(
          salesMetrics?.grossProfit || 0
        )} profit from ${formatCurrency(salesMetrics?.totalSales || 0)} sales`}
        unit="%"
        colors={{
          low: "#ef4444",
          medium: "#f59e0b",
          high: "#10b981",
        }}
      />

      {/* Cost of Goods & Gross Profit Details */}
      <View style={styles.profitDetailsContainer}>
        <View style={styles.profitDetailCard}>
          <Text style={styles.profitDetailLabel}>Cost of Goods Sold</Text>
          <Text style={styles.profitDetailValue}>
            {formatCurrency(salesMetrics?.costOfGoodsSold || 0)}
          </Text>
        </View>
        <View style={styles.profitDetailCard}>
          <Text style={styles.profitDetailLabel}>Gross Profit</Text>
          <Text style={[styles.profitDetailValue, { color: "#10b981" }]}>
            {formatCurrency(salesMetrics?.grossProfit || 0)}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#f8fafc",
  },
  heroCard: {
    marginBottom: 20,
    padding: 28,
    borderRadius: 20,
    alignItems: "center",
    shadowColor: "#667eea",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  heroLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: "rgba(255, 255, 255, 0.95)",
    marginBottom: 12,
    letterSpacing: 2,
  },
  heroValue: {
    fontSize: 48,
    fontWeight: "900",
    color: "#ffffff",
    marginBottom: 8,
    textShadowColor: "rgba(0, 0, 0, 0.25)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  heroSubtextContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  heroSubtext: {
    fontSize: 11,
    fontWeight: "700",
    color: "rgba(255, 255, 255, 0.95)",
    letterSpacing: 1,
  },
  twoColumnRow: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 20,
  },
  compactCard: {
    flex: 1,
    padding: 20,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
    minHeight: 120,
    justifyContent: "space-between",
  },
  compactLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "rgba(255, 255, 255, 0.9)",
    marginBottom: 8,
    letterSpacing: 1.2,
  },
  compactValue: {
    fontSize: 26,
    fontWeight: "900",
    color: "#ffffff",
    textShadowColor: "rgba(0, 0, 0, 0.2)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  compactBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    padding: 8,
    borderRadius: 10,
  },
  profitDetailsContainer: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  profitDetailCard: {
    flex: 1,
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  profitDetailLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6b7280",
    marginBottom: 8,
    textAlign: "center",
  },
  profitDetailValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1f2937",
    textAlign: "center",
  },
});
