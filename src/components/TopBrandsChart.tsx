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

interface BrandData {
  brand: string;
  total_sales: number;
  total_quantity?: number;
  total_cost?: number;
  gross_profit_amount?: number;
  gross_profit_percent?: number;
  invoice_count?: number;
}

interface TopBrandsChartProps {
  data: BrandData[];
  title?: string;
  lastYearData?: BrandData[];
}

const { width } = Dimensions.get("window");

export const TopBrandsChart: React.FC<TopBrandsChartProps> = ({
  data,
  title = "Top 10 Brands",
  lastYearData,
}) => {
  const [metric, setMetric] = useState<"sales" | "profit" | "margin">("sales");

  // Debug: Log brand data structure
  console.log("🔍 TopBrandsChart Data:", {
    currentData: data?.slice(0, 3).map((item) => ({
      brand: item.brand,
      total_sales: item.total_sales,
      gross_profit_amount: item.gross_profit_amount,
      gross_profit_percent: item.gross_profit_percent,
      total_quantity: item.total_quantity,
      invoice_count: item.invoice_count,
    })),
    lastYearData: lastYearData?.slice(0, 3),
    hasCurrentData: !!data?.length,
    hasLastYearData: !!lastYearData?.length,
  });

  const formatCurrency = (value: number): string => {
    if (Math.abs(value) >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (Math.abs(value) >= 1000) {
      return `${(value / 1000).toFixed(0)}K`;
    }
    return value.toFixed(0);
  };

  const getMetricValue = (item: BrandData): number => {
    switch (metric) {
      case "sales":
        return item.total_sales;
      case "profit":
        return item.gross_profit_amount || 0;
      case "margin":
        return item.gross_profit_percent || 0;
      default:
        return item.total_sales;
    }
  };

  const chartData = {
    labels: data.map((item, index) => {
      // Use rank numbers for cleaner chart display
      // Full names shown in cards below
      return `#${index + 1}`;
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
    if (metric === "margin") {
      return `${value.toFixed(1)}%`;
    }
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
    decimalPlaces: metric === "margin" ? 1 : 0,
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
  const totalProfit = data.reduce(
    (sum, item) => sum + (item.gross_profit_amount || 0),
    0
  );
  const avgMargin =
    data.length > 0
      ? data.reduce((sum, item) => sum + (item.gross_profit_percent || 0), 0) /
        data.length
      : 0;

  const getColor = (value: number): string => {
    if (metric === "margin" || metric === "profit") {
      return value >= 0 ? "#059669" : "#dc2626"; // Darker green/red
    }
    return "#4338ca"; // Darker purple
  };

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
            metric === "profit" && styles.toggleButtonActive,
          ]}
          onPress={() => setMetric("profit")}
        >
          <Text
            style={[
              styles.toggleText,
              metric === "profit" && styles.toggleTextActive,
            ]}
          >
            Profit
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            metric === "margin" && styles.toggleButtonActive,
          ]}
          onPress={() => setMetric("margin")}
        >
          <Text
            style={[
              styles.toggleText,
              metric === "margin" && styles.toggleTextActive,
            ]}
          >
            Margin %
          </Text>
        </TouchableOpacity>
      </View>

      {/* Chart */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.chartContainer}>
          {data.length > 0 ? (
            <BarChart
              data={chartData}
              width={Math.max(width - 60, data.length * 65)}
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
                if (metric === "margin") return `${num.toFixed(0)}%`;
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
      </ScrollView>

      {/* Brand Cards */}
      {data.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.cardsScroll}
        >
          {data.map((item, index) => (
            <View key={item.brand} style={styles.brandCard}>
              <View style={styles.rankBadge}>
                <Text style={styles.rankText}>#{index + 1}</Text>
              </View>
              <Text style={styles.brandName} numberOfLines={2}>
                {item.brand}
              </Text>
              <View style={styles.cardStats}>
                <View style={styles.cardStat}>
                  <Text style={styles.cardLabel}>Sales</Text>
                  <Text style={styles.cardValue}>
                    {formatCurrency(item.total_sales)}
                  </Text>
                </View>
                <View style={styles.cardStat}>
                  <Text style={styles.cardLabel}>Profit</Text>
                  <Text
                    style={[
                      styles.cardValue,
                      { color: getColor(item.gross_profit_amount || 0) },
                    ]}
                  >
                    {formatCurrency(item.gross_profit_amount || 0)}
                  </Text>
                </View>
                <View style={styles.cardStat}>
                  <Text style={styles.cardLabel}>Margin</Text>
                  <Text
                    style={[
                      styles.cardValue,
                      { color: getColor(item.gross_profit_percent || 0) },
                    ]}
                  >
                    {(item.gross_profit_percent || 0).toFixed(1)}%
                  </Text>
                </View>
                <View style={styles.cardStat}>
                  <Text style={styles.cardLabel}>Qty</Text>
                  <Text style={styles.cardValue}>
                    {(item.total_quantity || 0).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.cardStat}>
                  <Text style={styles.cardLabel}>Invoices</Text>
                  <Text style={styles.cardValue}>
                    {item.invoice_count || 0}
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
            <Text style={styles.statLabel}>Total Profit</Text>
            <Text style={[styles.statValue, { color: getColor(totalProfit) }]}>
              SAR {formatCurrency(totalProfit)}
            </Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Avg Margin</Text>
            <Text style={styles.statValue}>{avgMargin.toFixed(1)}%</Text>
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
  brandCard: {
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    padding: 16,
    marginRight: 12,
    width: 200,
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
  brandName: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
    marginBottom: 12,
    minHeight: 40,
    lineHeight: 20,
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
