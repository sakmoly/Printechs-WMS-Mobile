import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { GaugeChart } from "../GaugeChart";

interface YTDMetrics {
  netSales: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
  };
  totalInvoices: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
  };
  avgInvoice: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
  };
  grossProfitMargin: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
  };
  costOfGoods: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
  };
  grossProfit: {
    current: number;
    previous: number;
    change: number;
    changePercent: number;
  };
}

interface OverviewTabProps {
  ytdMetrics: YTDMetrics | null;
  formatCurrency: (value: number) => string;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  ytdMetrics,
  formatCurrency,
}) => {
  // Show no data state if metrics is null or missing
  if (!ytdMetrics) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>No YTD metrics available</Text>
        <Text style={styles.subText}>
          Year-to-date data is not available for comparison
        </Text>
      </View>
    );
  }

  const getChangeIcon = (changePercent: number) => {
    if (changePercent > 0) return "trending-up";
    if (changePercent < 0) return "trending-down";
    return "remove";
  };

  const getChangeColor = (changePercent: number) => {
    if (changePercent > 0) return "#10b981";
    if (changePercent < 0) return "#ef4444";
    return "#6b7280";
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.headerSection}>
        <Text style={styles.headerTitle}>Year-to-Date vs Last Year</Text>
        <Text style={styles.headerSubtitle}>Performance Comparison</Text>
      </View>

      {/* Net Sales */}
      <View style={styles.metricCard}>
        <View style={styles.metricHeader}>
          <Text style={styles.metricTitle}>Net Sales</Text>
          <View style={styles.changeContainer}>
            <Ionicons
              name={getChangeIcon(ytdMetrics.netSales.changePercent)}
              size={16}
              color={getChangeColor(ytdMetrics.netSales.changePercent)}
            />
            <Text
              style={[
                styles.changeText,
                { color: getChangeColor(ytdMetrics.netSales.changePercent) },
              ]}
            >
              {Math.abs(ytdMetrics.netSales.changePercent).toFixed(1)}%
            </Text>
          </View>
        </View>
        <View style={styles.metricValues}>
          <View style={styles.valueColumn}>
            <Text style={styles.valueLabel}>Current YTD</Text>
            <Text style={styles.valueNumber}>
              {formatCurrency(ytdMetrics.netSales.current)}
            </Text>
          </View>
          <View style={styles.valueColumn}>
            <Text style={styles.valueLabel}>Last Year</Text>
            <Text style={styles.valueNumber}>
              {formatCurrency(ytdMetrics.netSales.previous)}
            </Text>
          </View>
        </View>
      </View>

      {/* Total Invoices */}
      <View style={styles.metricCard}>
        <View style={styles.metricHeader}>
          <Text style={styles.metricTitle}>Total Invoices</Text>
          <View style={styles.changeContainer}>
            <Ionicons
              name={getChangeIcon(ytdMetrics.totalInvoices.changePercent)}
              size={16}
              color={getChangeColor(ytdMetrics.totalInvoices.changePercent)}
            />
            <Text
              style={[
                styles.changeText,
                {
                  color: getChangeColor(ytdMetrics.totalInvoices.changePercent),
                },
              ]}
            >
              {Math.abs(ytdMetrics.totalInvoices.changePercent).toFixed(1)}%
            </Text>
          </View>
        </View>
        <View style={styles.metricValues}>
          <View style={styles.valueColumn}>
            <Text style={styles.valueLabel}>Current YTD</Text>
            <Text style={styles.valueNumber}>
              {ytdMetrics.totalInvoices.current.toLocaleString()}
            </Text>
          </View>
          <View style={styles.valueColumn}>
            <Text style={styles.valueLabel}>Last Year</Text>
            <Text style={styles.valueNumber}>
              {ytdMetrics.totalInvoices.previous.toLocaleString()}
            </Text>
          </View>
        </View>
      </View>

      {/* Average Invoice */}
      <View style={styles.metricCard}>
        <View style={styles.metricHeader}>
          <Text style={styles.metricTitle}>Average Invoice</Text>
          <View style={styles.changeContainer}>
            <Ionicons
              name={getChangeIcon(ytdMetrics.avgInvoice.changePercent)}
              size={16}
              color={getChangeColor(ytdMetrics.avgInvoice.changePercent)}
            />
            <Text
              style={[
                styles.changeText,
                { color: getChangeColor(ytdMetrics.avgInvoice.changePercent) },
              ]}
            >
              {Math.abs(ytdMetrics.avgInvoice.changePercent).toFixed(1)}%
            </Text>
          </View>
        </View>
        <View style={styles.metricValues}>
          <View style={styles.valueColumn}>
            <Text style={styles.valueLabel}>Current YTD</Text>
            <Text style={styles.valueNumber}>
              {formatCurrency(ytdMetrics.avgInvoice.current)}
            </Text>
          </View>
          <View style={styles.valueColumn}>
            <Text style={styles.valueLabel}>Last Year</Text>
            <Text style={styles.valueNumber}>
              {formatCurrency(ytdMetrics.avgInvoice.previous)}
            </Text>
          </View>
        </View>
      </View>

      {/* Gross Profit Margin */}
      <View style={styles.metricCard}>
        <View style={styles.metricHeader}>
          <Text style={styles.metricTitle}>Gross Profit Margin</Text>
          <View style={styles.changeContainer}>
            <Ionicons
              name={getChangeIcon(ytdMetrics.grossProfitMargin.changePercent)}
              size={16}
              color={getChangeColor(ytdMetrics.grossProfitMargin.changePercent)}
            />
            <Text
              style={[
                styles.changeText,
                {
                  color: getChangeColor(
                    ytdMetrics.grossProfitMargin.changePercent
                  ),
                },
              ]}
            >
              {Math.abs(ytdMetrics.grossProfitMargin.changePercent).toFixed(1)}%
            </Text>
          </View>
        </View>
        <View style={styles.metricValues}>
          <View style={styles.valueColumn}>
            <Text style={styles.valueLabel}>Current YTD</Text>
            <Text style={styles.valueNumber}>
              {ytdMetrics.grossProfitMargin.current.toFixed(1)}%
            </Text>
          </View>
          <View style={styles.valueColumn}>
            <Text style={styles.valueLabel}>Last Year</Text>
            <Text style={styles.valueNumber}>
              {ytdMetrics.grossProfitMargin.previous.toFixed(1)}%
            </Text>
          </View>
        </View>
      </View>

      {/* Cost of Goods */}
      <View style={styles.metricCard}>
        <View style={styles.metricHeader}>
          <Text style={styles.metricTitle}>Cost of Goods</Text>
          <View style={styles.changeContainer}>
            <Ionicons
              name={getChangeIcon(ytdMetrics.costOfGoods.changePercent)}
              size={16}
              color={getChangeColor(ytdMetrics.costOfGoods.changePercent)}
            />
            <Text
              style={[
                styles.changeText,
                { color: getChangeColor(ytdMetrics.costOfGoods.changePercent) },
              ]}
            >
              {Math.abs(ytdMetrics.costOfGoods.changePercent).toFixed(1)}%
            </Text>
          </View>
        </View>
        <View style={styles.metricValues}>
          <View style={styles.valueColumn}>
            <Text style={styles.valueLabel}>Current YTD</Text>
            <Text style={styles.valueNumber}>
              {formatCurrency(ytdMetrics.costOfGoods.current)}
            </Text>
          </View>
          <View style={styles.valueColumn}>
            <Text style={styles.valueLabel}>Last Year</Text>
            <Text style={styles.valueNumber}>
              {formatCurrency(ytdMetrics.costOfGoods.previous)}
            </Text>
          </View>
        </View>
      </View>

      {/* Gross Profit */}
      <View style={styles.metricCard}>
        <View style={styles.metricHeader}>
          <Text style={styles.metricTitle}>Gross Profit</Text>
          <View style={styles.changeContainer}>
            <Ionicons
              name={getChangeIcon(ytdMetrics.grossProfit.changePercent)}
              size={16}
              color={getChangeColor(ytdMetrics.grossProfit.changePercent)}
            />
            <Text
              style={[
                styles.changeText,
                { color: getChangeColor(ytdMetrics.grossProfit.changePercent) },
              ]}
            >
              {Math.abs(ytdMetrics.grossProfit.changePercent).toFixed(1)}%
            </Text>
          </View>
        </View>
        <View style={styles.metricValues}>
          <View style={styles.valueColumn}>
            <Text style={styles.valueLabel}>Current YTD</Text>
            <Text style={styles.valueNumber}>
              {formatCurrency(ytdMetrics.grossProfit.current)}
            </Text>
          </View>
          <View style={styles.valueColumn}>
            <Text style={styles.valueLabel}>Last Year</Text>
            <Text style={styles.valueNumber}>
              {formatCurrency(ytdMetrics.grossProfit.previous)}
            </Text>
          </View>
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
  metricCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  metricHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  metricTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1f2937",
  },
  changeContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  changeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  metricValues: {
    flexDirection: "row",
    gap: 20,
  },
  valueColumn: {
    flex: 1,
    alignItems: "center",
  },
  valueLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6b7280",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  valueNumber: {
    fontSize: 20,
    fontWeight: "800",
    color: "#1f2937",
    textAlign: "center",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
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
