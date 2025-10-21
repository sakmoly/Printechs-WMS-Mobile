import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
} from "react-native";
import { PieChart } from "react-native-chart-kit";

interface DivisionData {
  division: string;
  total_sales: number;
  margin_percentage?: number;
}

interface DivisionPieChartProps {
  data: DivisionData[];
  title?: string;
}

const { width } = Dimensions.get("window");

// Helper function to get consistent colors for pie chart segments and cards
const colors = [
  "#3b82f6",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
];
const getColorForIndex = (index: number): string =>
  colors[index % colors.length];

export const DivisionPieChart: React.FC<DivisionPieChartProps> = ({
  data,
  title = "Division Performance",
}) => {
  const [showSales, setShowSales] = useState(true);

  const formatCurrency = (value: number): string => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(0)}K`;
    }
    return value.toFixed(0);
  };

  const totalValue = data.reduce((sum, item) => sum + item.total_sales, 0);

  const pieData = data.map((item, index) => ({
    name: item.division,
    population: item.total_sales,
    color: getColorForIndex(index),
    legendFontColor: "#7F7F7F",
    legendFontSize: 12,
  }));

  const chartConfig = {
    backgroundColor: "#ffffff",
    backgroundGradientFrom: "#ffffff",
    backgroundGradientTo: "#f9fafb",
    color: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(55, 65, 81, ${opacity})`,
    decimalPlaces: 0,
  };

  const totalSales = data.reduce((sum, item) => sum + item.total_sales, 0);
  const avgSales = totalSales / data.length;

  return (
    <View style={styles.container}>
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
              Revenue
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        {data.map((item, index) => (
          <View key={index} style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: colors[index % colors.length] },
              ]}
            />
            <Text style={styles.legendText}>{item.division}</Text>
            <Text style={styles.legendValue}>
              {formatCurrency(item.total_sales)}
            </Text>
          </View>
        ))}
      </View>

      {/* Pie Chart */}
      <View style={styles.chartContainer}>
        {data.length > 0 ? (
          <PieChart
            data={pieData}
            width={width - 80}
            height={220}
            chartConfig={chartConfig}
            accessor="population"
            backgroundColor="transparent"
            paddingLeft="15"
            center={[10, 10]}
            absolute
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
              key={item.division}
              style={[
                styles.dataCard,
                { borderLeftColor: getColorForIndex(index) },
              ]}
            >
              <Text style={styles.divisionName}>{item.division}</Text>
              <View style={styles.cardContent}>
                <View style={styles.cardStat}>
                  <Text style={styles.cardLabel}>Sales</Text>
                  <Text style={styles.cardValue}>
                    SAR {formatCurrency(item.total_sales)}
                  </Text>
                </View>
                <View style={styles.cardStat}>
                  <Text style={styles.cardLabel}>Margin %</Text>
                  <Text style={styles.cardValue}>
                    {item.margin_percentage?.toFixed(1) ?? "N/A"}%
                  </Text>
                </View>
                <View style={styles.cardStat}>
                  <Text style={styles.cardLabel}>Status</Text>
                  <Text
                    style={[
                      styles.cardValue,
                      { color: item.total_sales >= 0 ? "#10b981" : "#ef4444" },
                    ]}
                  >
                    {item.total_sales >= 0 ? "Positive" : "Negative"}
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
            <Text style={styles.statLabel}>Divisions</Text>
            <Text style={styles.statValue}>{data.length}</Text>
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
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 16,
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f9fafb",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
  },
  legendValue: {
    fontSize: 11,
    fontWeight: "700",
    color: "#667eea",
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
  divisionName: {
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
