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
}

const { width } = Dimensions.get("window");

export const TopCustomersChart: React.FC<TopCustomersChartProps> = ({
  data,
  title = "Top 10 Customers",
}) => {
  const [metric, setMetric] = useState<"sales" | "invoices">("sales");

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
    labels: data.map((item, index) => `#${index + 1}`),
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
    decimalPlaces: 0,
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
      fontSize: 10,
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
                {item.customer_name}
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
  customerCard: {
    backgroundColor: "#f9fafb",
    borderRadius: 12,
    padding: 16,
    marginRight: 12,
    width: 220,
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
  customerName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: 12,
    minHeight: 60,
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
