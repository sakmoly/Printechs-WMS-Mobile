import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { BarChart } from "react-native-chart-kit";

interface CustomerData {
  customer: string;
  customer_name: string;
  total_sales: number;
  invoice_count: number;
}

interface TopCustomersChartProps {
  data: CustomerData[];
  title?: string;
  lastYearData?: CustomerData[];
}

const { width } = Dimensions.get("window");

export const TopCustomersChart: React.FC<TopCustomersChartProps> = ({
  data,
  title = "Top 10 Customers",
  lastYearData,
}) => {
  const [metric, setMetric] = useState<"sales" | "invoices">("sales");

  // Debug: Log customer data structure
  console.log("🔍 TopCustomersChart Data:", {
    currentData: data?.slice(0, 3).map((item) => ({
      customer: item.customer,
      customer_name: item.customer_name,
      total_sales: item.total_sales,
      invoice_count: item.invoice_count,
    })),
    lastYearData: lastYearData?.slice(0, 3),
    hasCurrentData: !!data?.length,
    hasLastYearData: !!lastYearData?.length,
  });

  const formatCurrency = (value: number): string => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(0)}K`;
    }
    return value.toFixed(0);
  };

  const getMetricValue = (item: CustomerData): number => {
    return metric === "sales" ? item.total_sales : item.invoice_count;
  };

  const chartData = {
    labels: data.map((item, index) => {
      // Show customer names in chart labels for better identification
      // Truncate long names to fit chart
      const name =
        item.customer_name || item.customer || `Customer ${index + 1}`;
      return name.length > 8 ? name.substring(0, 8) + "..." : name;
    }),
    datasets: [
      {
        data: data.map((item) => getMetricValue(item)),
        colors: data.map((item, index) => {
          // Assign consistent darker colors to each bar
          const darkColors = [
            () => "#1e3a8a", // Deep Blue
            () => "#581c87", // Deep Purple
            () => "#9f1239", // Deep Rose
            () => "#065f46", // Deep Emerald
            () => "#991b1b", // Deep Red
            () => "#164e63", // Deep Cyan
            () => "#713f12", // Deep Amber
            () => "#0c4a6e", // Deep Sky
            () => "#4c1d95", // Deep Violet
            () => "#78350f", // Deep Orange
          ];
          return darkColors[index % darkColors.length];
        }),
      },
    ],
  };

  // Format values on top of bars - compact format
  const formatBarValue = (value: number): string => {
    if (Math.abs(value) >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (Math.abs(value) >= 1000) {
      return `${(value / 1000).toFixed(0)}K`;
    }
    return value.toFixed(0);
  };

  const chartConfig = {
    backgroundColor: "#ffffff",
    backgroundGradientFrom: "#ffffff",
    backgroundGradientTo: "#f9fafb",
    decimalPlaces: 0,
    formatTopBarValue: formatBarValue,
    color: (opacity = 1) => {
      // Much darker, richer colors for better visibility
      const darkColors = [
        "#1e3a8a", // Deep Blue
        "#581c87", // Deep Purple
        "#9f1239", // Deep Rose
        "#991b1b", // Deep Red
        "#164e63", // Deep Cyan
        "#065f46", // Deep Emerald
        "#713f12", // Deep Amber
        "#0c4a6e", // Deep Sky
      ];
      const colorIndex = Math.floor(Math.random() * darkColors.length);
      return darkColors[colorIndex];
    },
    labelColor: (opacity = 1) => `rgba(17, 24, 39, ${opacity})`, // Much darker labels
    strokeWidth: 2,
    barPercentage: 0.75,
    fillShadowGradient: "#1e3a8a", // Deep blue gradient
    fillShadowGradientOpacity: 1, // Full opacity for darker bars
    propsForLabels: {
      fontSize: 13, // Larger font for better readability
      fontWeight: "700", // Bolder font weight
      fontFamily: "System",
    },
    propsForBackgroundLines: {
      strokeDasharray: "", // Solid lines
      stroke: "#e5e7eb",
      strokeWidth: 1,
    },
    propsForVerticalLabels: {
      fontSize: 12, // Larger Y-axis labels
      fontWeight: "700",
      fill: "#111827", // Very dark gray for Y-axis
    },
  };

  const totalSales = data.reduce((sum, item) => sum + item.total_sales, 0);
  const totalInvoices = data.reduce((sum, item) => sum + item.invoice_count, 0);
  const avgSales = totalSales / data.length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
      </View>

      {/* Metric Toggle */}
      <View style={styles.toggleContainer}>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            metric === "sales" && styles.toggleButtonActive,
          ]}
          onPress={() => setMetric("sales")}
        >
          <Text
            style={[
              styles.toggleText,
              metric === "sales" && styles.toggleTextActive,
            ]}
          >
            Sales
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            metric === "invoices" && styles.toggleButtonActive,
          ]}
          onPress={() => setMetric("invoices")}
        >
          <Text
            style={[
              styles.toggleText,
              metric === "invoices" && styles.toggleTextActive,
            ]}
          >
            Invoices
          </Text>
        </TouchableOpacity>
      </View>

      {/* Chart */}
      <View style={styles.chartContainer}>
        {data.length > 0 ? (
          <BarChart
            data={chartData}
            width={width - 80}
            height={240}
            chartConfig={chartConfig}
            showValuesOnTopOfBars={true}
            fromZero
            withInnerLines={true}
            style={styles.chart}
            yAxisLabel=""
            yAxisSuffix=""
            withCustomBarColorFromData={true}
            flatColor={true}
            formatYLabel={(value) => {
              const num = parseFloat(value);
              if (metric === "invoices") return num.toFixed(0);
              if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
              if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
              return num.toFixed(0);
            }}
          />
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No data available</Text>
          </View>
        )}
      </View>

      {/* Customer Cards */}
      {data.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.cardsScroll}
        >
          {data.map((item, index) => (
            <View key={item.customer} style={styles.customerCard}>
              <View style={styles.rankBadge}>
                <Text style={styles.rankText}>#{index + 1}</Text>
              </View>
              <Text style={styles.customerName} numberOfLines={3}>
                {item.customer_name || item.customer || `Customer ${index + 1}`}
              </Text>
              <View style={styles.cardStats}>
                <View style={styles.cardStat}>
                  <Text style={styles.cardLabel}>Total Sales</Text>
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
                <View style={styles.cardStat}>
                  <Text style={styles.cardLabel}>% of Total</Text>
                  <Text style={styles.cardValue}>
                    {((item.total_sales / totalSales) * 100).toFixed(1)}%
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
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
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.5,
  },
  toggleContainer: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 2,
    marginBottom: 16,
  },
  toggleButton: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
  },
  toggleButtonActive: {
    backgroundColor: "#4338ca",
  },
  toggleText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#4b5563",
  },
  toggleTextActive: {
    color: "#ffffff",
  },
  chartContainer: {
    alignItems: "center",
    marginVertical: 8,
  },
  chart: {
    borderRadius: 16,
    marginVertical: 8,
  },
  emptyState: {
    height: 220,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    color: "#9ca3af",
    fontSize: 14,
  },
  cardsScroll: {
    marginTop: 16,
  },
  customerCard: {
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    padding: 16,
    marginRight: 12,
    width: 220,
    borderLeftWidth: 4,
    borderLeftColor: "#4338ca",
  },
  rankBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "#4338ca",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  rankText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700",
  },
  customerName: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 12,
    minHeight: 60,
    lineHeight: 20,
    textAlign: "center",
  },
  cardStats: {
    gap: 8,
  },
  cardStat: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardLabel: {
    fontSize: 10,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontWeight: "700",
  },
  cardValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
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
    fontSize: 11,
    color: "#6b7280",
    marginBottom: 4,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 17,
    fontWeight: "800",
    color: "#4338ca",
  },
});
