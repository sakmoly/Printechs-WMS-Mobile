import React from "react";
import { ScrollView, StyleSheet, View, Text } from "react-native";
import { TopBrandsChart } from "../TopBrandsChart";
import { TopCustomersChart } from "../TopCustomersChart";

interface PerformanceTabProps {
  topBrands?: any[];
  topCustomers?: any[];
  lastYearBrands?: any[];
  lastYearCustomers?: any[];
}

export const PerformanceTab: React.FC<PerformanceTabProps> = ({
  topBrands,
  topCustomers,
  lastYearBrands,
  lastYearCustomers,
}) => {
  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.headerSection}>
        <Text style={styles.headerTitle}>Performance Analysis</Text>
        <Text style={styles.headerSubtitle}>
          Year-to-Date Performance Metrics
        </Text>
      </View>

      {/* Top 10 Brands Chart */}
      {topBrands && topBrands.length > 0 ? (
        <TopBrandsChart
          data={topBrands}
          title="Top 10 Brands YTD"
          lastYearData={lastYearBrands}
        />
      ) : (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>No brand data available</Text>
          <Text style={styles.subText}>
            Brand performance data is not available for the YTD period
          </Text>
        </View>
      )}

      {/* Top 10 Customers Chart */}
      {topCustomers && topCustomers.length > 0 ? (
        <TopCustomersChart
          data={topCustomers}
          title="Top 10 Customers YTD"
          lastYearData={lastYearCustomers}
        />
      ) : (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>No customer data available</Text>
          <Text style={styles.subText}>
            Customer performance data is not available for the YTD period
          </Text>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#f8fafc",
  },
  headerSection: {
    marginBottom: 24,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#1f2937",
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#6b7280",
    fontWeight: "500",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
    marginVertical: 20,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#6b7280",
    textAlign: "center",
  },
  subText: {
    fontSize: 14,
    color: "#9ca3af",
    textAlign: "center",
    marginTop: 8,
  },
});
