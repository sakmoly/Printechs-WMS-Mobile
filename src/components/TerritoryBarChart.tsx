import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
} from "react-native";
import { BarChart } from "react-native-chart-kit";

interface TerritoryData {
  territory: string;
  total_sales: number;
  invoice_count: number;
}

interface TerritoryBarChartProps {
  data: TerritoryData[];
  title?: string;
}

const { width } = Dimensions.get("window");

export const TerritoryBarChart: React.FC<TerritoryBarChartProps> = ({
  data,
  title = "Territory Performance",
}) => {
  const [showSales, setShowSales] = useState(true);

  // Format currency with K/M suffixes
  const formatCurrency = (value: number): string => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(0)}K`;
    }
    return value.toFixed(0);
  };

  // Prepare chart data with safety check
  const displayData = showSales
    ? data.map((item) => item.total_sales)
    : data.map((item) => item.invoice_count);

  // Ensure we have at least one value to prevent chart errors
  const chartData = {
    labels: data.map((item) => item.territory),
    datasets: [
      {
        data: displayData.length > 0 ? displayData : [0],
      },
    ],
  };

  // Calculate statistics
  const totalSales = data.reduce((sum, item) => sum + item.total_sales, 0);
  const totalInvoices = data.reduce((sum, item) => sum + item.invoice_count, 0);
  const avgSales = totalSales / data.length;

  return (
    <View style={styles.container}>
      {/* Header with toggle */}
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              showSales && styles.toggleButtonActive,
            ]}
            onPress={() => setShowSales(true)}
          >
            <Text
              style={[styles.toggleText, showSales && styles.toggleTextActive]}
            >
              Sales
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              !showSales && styles.toggleButtonActive,
            ]}
            onPress={() => setShowSales(false)}
          >
            <Text
              style={[styles.toggleText, !showSales && styles.toggleTextActive]}
            >
              Invoices
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Chart */}
      <View style={styles.chartContainer}>
        {data.length > 0 ? (
          <BarChart
            data={chartData}
            width={width - 80}
            height={240}
            yAxisLabel=""
            yAxisSuffix=""
            chartConfig={{
              backgroundColor: "#ffffff",
              backgroundGradientFrom: "#ffffff",
              backgroundGradientTo: "#f9fafb",
              decimalPlaces: 0,
              color: (opacity = 1) => `rgba(102, 126, 234, ${opacity})`,
              labelColor: (opacity = 1) => `rgba(55, 65, 81, ${opacity})`,
              style: {
                borderRadius: 16,
              },
              propsForBackgroundLines: {
                strokeDasharray: "",
                stroke: "#e5e7eb",
                strokeWidth: 1,
              },
              propsForLabels: {
                fontSize: 10,
              },
              barPercentage: 0.7,
              fillShadowGradient: "#667eea",
              fillShadowGradientOpacity: 1,
            }}
            style={styles.chart}
            showValuesOnTopOfBars={false}
            withInnerLines={true}
            fromZero={true}
            segments={4}
          />
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No data available</Text>
          </View>
        )}
      </View>

      {/* Data Cards */}
      {data.length > 0 && (
        <View style={styles.cardsContainer}>
          {data.map((item, index) => (
            <View
              key={item.territory}
              style={[
                styles.dataCard,
                { borderLeftColor: getColorForIndex(index) },
              ]}
            >
              <Text style={styles.territoryName}>{item.territory}</Text>
              <View style={styles.cardContent}>
                <View style={styles.cardStat}>
                  <Text style={styles.cardLabel}>Sales</Text>
                  <Text style={styles.cardValue}>
                    SAR {formatCurrency(item.total_sales)}
                  </Text>
                </View>
                <View style={styles.cardStat}>
                  <Text style={styles.cardLabel}>Invoices</Text>
                  <Text style={styles.cardValue}>{item.invoice_count}</Text>
                </View>
                <View style={styles.cardStat}>
                  <Text style={styles.cardLabel}>Avg/Invoice</Text>
                  <Text style={styles.cardValue}>
                    {formatCurrency(item.total_sales / item.invoice_count)}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Summary Footer */}
      {data.length > 0 && (
        <View style={styles.footer}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Total Sales</Text>
            <Text style={styles.statValue}>
              SAR {formatCurrency(totalSales)}
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Total Invoices</Text>
            <Text style={styles.statValue}>{totalInvoices}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Avg Sales</Text>
            <Text style={styles.statValue}>SAR {formatCurrency(avgSales)}</Text>
          </View>
        </View>
      )}
    </View>
  );
};

// Helper function to get consistent colors for bars
const getColorForIndex = (index: number): string => {
  const colors = ["#667eea", "#764ba2", "#f093fb"];
  return colors[index % colors.length];
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1f2937",
  },
  toggleContainer: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 2,
  },
  toggleButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  toggleButtonActive: {
    backgroundColor: "#667eea",
  },
  toggleText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6b7280",
  },
  toggleTextActive: {
    color: "#ffffff",
  },
  chartContainer: {
    marginVertical: 8,
    alignItems: "center",
  },
  chart: {
    borderRadius: 16,
    marginVertical: 8,
  },
  emptyState: {
    height: 240,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    color: "#9ca3af",
    fontSize: 14,
  },
  cardsContainer: {
    marginTop: 16,
    gap: 12,
  },
  dataCard: {
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
  },
  territoryName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: 12,
  },
  cardContent: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  cardStat: {
    flex: 1,
  },
  cardLabel: {
    fontSize: 11,
    color: "#6b7280",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1f2937",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingTop: 20,
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  statItem: {
    alignItems: "center",
    flex: 1,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: "#e5e7eb",
  },
  statLabel: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#667eea",
  },
});
