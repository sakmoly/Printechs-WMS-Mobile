import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { TerritoryBarChart } from "../src/components/TerritoryBarChart";
import { MonthlySalesTrend } from "../src/components/MonthlySalesTrend";

/**
 * Chart Test Screen - Use this to test and debug your charts
 *
 * To access: Navigate to /chart-test in your app
 */

export default function ChartTestScreen() {
  // Territory data
  const territoryData = [
    {
      territory: "Riyadh",
      total_sales: 1051722.0,
      invoice_count: 111,
    },
    {
      territory: "Jeddah",
      total_sales: 763110.28,
      invoice_count: 124,
    },
    {
      territory: "Dammam",
      total_sales: 97642.0,
      invoice_count: 21,
    },
  ];

  // Monthly sales data
  const monthlyLabels = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  const currentYearSales = [
    5471509.21, 3169933.68, 2635202.17, 2012393.0, 2283700.6, 2611126.28,
    2425954.68, 3800397.7, 3140088.65, 1914614.28, 0.0, 0.0,
  ];

  const previousYearSales = [
    1889958.85, 2026053.67, 2520946.96, 2025778.9, 1475708.85, 1972484.73,
    3396110.41, 2278308.46, 2186873.53, 2811700.02, 2774109.13, 3288207.78,
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.pageTitle}>📊 Chart Test Screen</Text>
        <Text style={styles.subtitle}>Test your beautiful charts here</Text>

        {/* Territory Bar Chart */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Territory Bar Chart</Text>
          <TerritoryBarChart
            data={territoryData}
            title="Territory Performance"
          />
        </View>

        {/* Monthly Sales Trend */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>2. Monthly Sales Trend</Text>
          <MonthlySalesTrend
            labels={monthlyLabels}
            current={currentYearSales}
            previous={previousYearSales}
            title="Monthly Sales Trend"
          />
        </View>

        {/* Debug Info */}
        <View style={styles.debugSection}>
          <Text style={styles.debugTitle}>Debug Info</Text>
          <Text style={styles.debugText}>
            Territory Data Points: {territoryData.length}
          </Text>
          <Text style={styles.debugText}>
            Monthly Data Points: {monthlyLabels.length}
          </Text>
          <Text style={styles.debugText}>Charts should render above ☝️</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f3f4f6",
  },
  content: {
    padding: 16,
    paddingTop: 60,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: "900",
    color: "#1f2937",
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#374151",
    marginBottom: 12,
    paddingLeft: 4,
  },
  debugSection: {
    backgroundColor: "#1f2937",
    borderRadius: 12,
    padding: 16,
    marginTop: 24,
    marginBottom: 40,
  },
  debugTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#10b981",
    marginBottom: 12,
  },
  debugText: {
    fontSize: 12,
    color: "#9ca3af",
    fontFamily: "monospace",
    marginBottom: 4,
  },
});
