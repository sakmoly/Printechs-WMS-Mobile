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
  total_quantity: number;
  total_cost: number;
  gross_profit_amount: number;
  gross_profit_percent: number;
  invoice_count: number;
}

interface TopBrandsChartProps {
  data: BrandData[];
  title?: string;
}

const { width } = Dimensions.get("window");

export const TopBrandsChart: React.FC<TopBrandsChartProps> = ({
  data,
  title = "Top 10 Brands",
}) => {
  const [metric, setMetric] = useState<"sales" | "profit" | "margin">("sales");

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
        return item.gross_profit_amount;
      case "margin":
        return item.gross_profit_percent;
      default:
        return item.total_sales;
    }
  };

  const chartData = {
    labels: data.map((item) => item.brand.substring(0, 8)),
    datasets: [
      {
        data: data.map((item) => getMetricValue(item)),
      },
    ],
  };

  const chartConfig = {
    backgroundColor: "#ffffff",
    backgroundGradientFrom: "#ffffff",
    backgroundGradientTo: "#f9fafb",
    decimalPlaces: metric === "margin" ? 1 : 0,
    color: (opacity = 1) => {
      const gradientColors = [
        "#4338ca", // Dark Indigo
        "#6b21a8", // Dark Purple
        "#be185d", // Dark Pink
        "#b91c1c", // Dark Red
        "#1e40af", // Dark Blue
        "#0e7490", // Dark Cyan
        "#047857", // Dark Green
        "#0f766e", // Dark Teal
      ];
      const colorIndex = Math.floor(Math.random() * gradientColors.length);
      return gradientColors[colorIndex];
    },
    labelColor: (opacity = 1) => `rgba(55, 65, 81, ${opacity})`,
    strokeWidth: 2,
    barPercentage: 0.7,
    fillShadowGradient: "#4338ca",
    fillShadowGradientOpacity: 0.9,
    propsForLabels: {
      fontSize: 9,
    },
  };

  const totalSales = data.reduce((sum, item) => sum + item.total_sales, 0);
  const totalProfit = data.reduce(
    (sum, item) => sum + item.gross_profit_amount,
    0
  );
  const avgMargin =
    data.reduce((sum, item) => sum + item.gross_profit_percent, 0) /
    data.length;

  const getColor = (value: number): string => {
    if (metric === "margin" || metric === "profit") {
      return value >= 0 ? "#10b981" : "#ef4444";
    }
    return "#667eea";
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
              width={Math.max(width - 60, data.length * 60)}
              height={220}
              chartConfig={chartConfig}
              showValuesOnTopOfBars={true}
              fromZero
              withInnerLines={true}
              style={styles.chart}
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
                      { color: getColor(item.gross_profit_amount) },
                    ]}
                  >
                    {formatCurrency(item.gross_profit_amount)}
                  </Text>
                </View>
                <View style={styles.cardStat}>
                  <Text style={styles.cardLabel}>Margin</Text>
                  <Text
                    style={[
                      styles.cardValue,
                      { color: getColor(item.gross_profit_percent) },
                    ]}
                  >
                    {item.gross_profit_percent.toFixed(1)}%
                  </Text>
                </View>
                <View style={styles.cardStat}>
                  <Text style={styles.cardLabel}>Qty</Text>
                  <Text style={styles.cardValue}>
                    {item.total_quantity.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.cardStat}>
                  <Text style={styles.cardLabel}>Invoices</Text>
                  <Text style={styles.cardValue}>{item.invoice_count}</Text>
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
    fontWeight: "700",
    color: "#1f2937",
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
    borderLeftColor: "#667eea",
  },
  rankBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "#667eea",
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
    fontSize: 16,
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: 12,
    minHeight: 40,
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
    fontSize: 11,
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardValue: {
    fontSize: 13,
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
