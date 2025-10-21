import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
} from "react-native";
import { LineChart, BarChart } from "react-native-chart-kit";
import { Ionicons } from "@expo/vector-icons";

interface MonthlySalesTrendProps {
  labels: string[];
  current: number[];
  previous: number[];
  title?: string;
}

const { width } = Dimensions.get("window");

export const MonthlySalesTrend: React.FC<MonthlySalesTrendProps> = ({
  labels,
  current,
  previous,
  title = "Monthly Sales Trend",
}) => {
  const [chartType, setChartType] = useState<"line" | "bar">("line");

  // Format currency with K/M suffixes
  const formatCurrency = (value: number): string => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(0)}K`;
    }
    return value.toFixed(0);
  };

  // Calculate statistics
  const currentTotal = current.reduce((sum, val) => sum + val, 0);
  const previousTotal = previous.reduce((sum, val) => sum + val, 0);
  const growth =
    previousTotal > 0
      ? ((currentTotal - previousTotal) / previousTotal) * 100
      : 0;

  const currentAvg = currentTotal / current.filter((v) => v > 0).length;
  const previousAvg = previousTotal / previous.filter((v) => v > 0).length;

  // Prepare chart data with darker colors
  const chartData = {
    labels: labels,
    datasets: [
      {
        data: current,
        color: (opacity = 1) => `rgba(30, 64, 175, ${opacity})`, // Darker Blue for current
        strokeWidth: 3,
      },
      {
        data: previous,
        color: (opacity = 1) => `rgba(107, 33, 168, ${opacity})`, // Darker Purple for previous
        strokeWidth: 3,
      },
    ],
    legend: ["Current Year", "Previous Year"],
  };

  // Colorful bar chart data for better visualization
  const barChartData = {
    labels: labels,
    datasets: [
      {
        data: current,
      },
    ],
  };

  // Get color for each bar based on month index - DARKER COLORS
  const getBarColor = (index: number) => {
    const colors = [
      "#1e40af", // Dark Blue - Jan
      "#6b21a8", // Dark Purple - Feb
      "#047857", // Dark Green - Mar
      "#d97706", // Dark Amber - Apr
      "#b91c1c", // Dark Red - May
      "#0e7490", // Dark Cyan - Jun
      "#65a30d", // Dark Lime - Jul
      "#c2410c", // Dark Orange - Aug
      "#be185d", // Dark Pink - Sep
      "#4338ca", // Dark Indigo - Oct
      "#0f766e", // Dark Teal - Nov
      "#7e22ce", // Dark Violet - Dec
    ];
    return colors[index % colors.length];
  };

  const chartConfig = {
    backgroundColor: "#ffffff",
    backgroundGradientFrom: "#ffffff",
    backgroundGradientTo: "#f9fafb",
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(107, 114, 128, ${opacity})`,
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
      fontWeight: "600",
    },
    propsForDots: {
      r: "4",
      strokeWidth: "2",
    },
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.chartTypeToggle}>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              chartType === "line" && styles.toggleButtonActive,
            ]}
            onPress={() => setChartType("line")}
          >
            <Ionicons
              name="trending-up"
              size={16}
              color={chartType === "line" ? "#ffffff" : "#6b7280"}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              chartType === "bar" && styles.toggleButtonActive,
            ]}
            onPress={() => setChartType("bar")}
          >
            <Ionicons
              name="bar-chart"
              size={16}
              color={chartType === "bar" ? "#ffffff" : "#6b7280"}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Statistics Cards - MOVED TO TOP */}
      <View style={styles.statsContainer}>
        {/* Current Year Stats */}
        <View style={[styles.statCard, styles.currentYearCard]}>
          <View style={styles.statHeader}>
            <Ionicons name="calendar" size={16} color="#3b82f6" />
            <Text style={styles.statCardTitle}>Current Year</Text>
          </View>
          <Text style={[styles.statValue, { color: "#3b82f6" }]}>
            SAR {formatCurrency(currentTotal)}
          </Text>
          <Text style={styles.statLabel}>
            Avg: SAR {formatCurrency(currentAvg)}
          </Text>
        </View>

        {/* Previous Year Stats */}
        <View style={[styles.statCard, styles.previousYearCard]}>
          <View style={styles.statHeader}>
            <Ionicons name="calendar-outline" size={16} color="#8b5cf6" />
            <Text style={styles.statCardTitle}>Previous Year</Text>
          </View>
          <Text style={[styles.statValue, { color: "#8b5cf6" }]}>
            SAR {formatCurrency(previousTotal)}
          </Text>
          <Text style={styles.statLabel}>
            Avg: SAR {formatCurrency(previousAvg)}
          </Text>
        </View>
      </View>

      {/* Growth Indicator - MOVED TO TOP */}
      <View style={styles.growthContainer}>
        <View
          style={[
            styles.growthBadge,
            { backgroundColor: growth >= 0 ? "#10b981" : "#ef4444" },
          ]}
        >
          <Ionicons
            name={growth >= 0 ? "trending-up" : "trending-down"}
            size={20}
            color="#ffffff"
          />
          <Text style={styles.growthText}>
            {growth >= 0 ? "+" : ""}
            {growth.toFixed(1)}% YoY
          </Text>
        </View>
        <Text style={styles.growthLabel}>Year over Year Growth</Text>
      </View>

      {/* Monthly Breakdown Summary - MOVED TO TOP */}
      <View style={styles.monthlyHighlights}>
        <Text style={styles.highlightsTitle}>Top Performing Months</Text>
        <View style={styles.highlightsGrid}>
          {current
            .map((value, index) => ({ value, month: labels[index], index }))
            .filter((item) => item.value > 0)
            .sort((a, b) => b.value - a.value)
            .slice(0, 3)
            .map((item, idx) => (
              <View key={idx} style={styles.highlightItem}>
                <Text style={styles.highlightMonth}>{item.month}</Text>
                <Text style={styles.highlightValue}>
                  SAR {formatCurrency(item.value)}
                </Text>
                <View style={styles.highlightBadge}>
                  <Text style={styles.highlightRank}>#{idx + 1}</Text>
                </View>
              </View>
            ))}
        </View>
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#3b82f6" }]} />
          <Text style={styles.legendText}>Current Year</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#8b5cf6" }]} />
          <Text style={styles.legendText}>Previous Year</Text>
        </View>
      </View>

      {/* Chart */}
      <View style={styles.chartContainer}>
        {chartType === "line" ? (
          <LineChart
            data={chartData}
            width={width - 80}
            height={240}
            chartConfig={chartConfig}
            bezier
            style={styles.chart}
            withVerticalLines={false}
            withHorizontalLines={true}
            withDots={true}
            withShadow={false}
            segments={4}
          />
        ) : (
          <BarChart
            data={barChartData}
            width={width - 80}
            height={240}
            yAxisLabel=""
            yAxisSuffix=""
            chartConfig={{
              backgroundColor: "#ffffff",
              backgroundGradientFrom: "#ffffff",
              backgroundGradientTo: "#f8fafc",
              decimalPlaces: 0,
              color: (opacity = 1) => {
                // Beautiful gradient colors for bars
                const gradientColors = [
                  "#667eea", // Blue gradient
                  "#764ba2", // Purple gradient
                  "#f093fb", // Pink gradient
                  "#f5576c", // Red gradient
                  "#4facfe", // Cyan gradient
                  "#00f2fe", // Light blue gradient
                  "#43e97b", // Green gradient
                  "#38f9d7", // Teal gradient
                ];

                // Use a consistent color based on position
                const colorIndex = Math.floor(
                  Math.random() * gradientColors.length
                );
                return gradientColors[colorIndex];
              },
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
                fontWeight: "600",
              },
              barPercentage: 0.8,
              fillShadowGradient: "#667eea",
              fillShadowGradientOpacity: 0.8,
            }}
            style={styles.chart}
            showValuesOnTopOfBars={true}
            withInnerLines={true}
            fromZero={true}
            segments={4}
          />
        )}
      </View>
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
  chartTypeToggle: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 2,
  },
  toggleButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  toggleButtonActive: {
    backgroundColor: "#667eea",
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 24,
    marginBottom: 16,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
  },
  chartContainer: {
    alignItems: "center",
    marginBottom: 20,
  },
  chart: {
    borderRadius: 16,
    marginVertical: 8,
  },
  statsContainer: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
  },
  currentYearCard: {
    backgroundColor: "#eff6ff",
    borderColor: "#3b82f6",
  },
  previousYearCard: {
    backgroundColor: "#f5f3ff",
    borderColor: "#8b5cf6",
  },
  statHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  statCardTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    color: "#6b7280",
  },
  growthContainer: {
    alignItems: "center",
    marginBottom: 20,
  },
  growthBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    marginBottom: 8,
  },
  growthText: {
    fontSize: 18,
    fontWeight: "900",
    color: "#ffffff",
  },
  growthLabel: {
    fontSize: 12,
    color: "#6b7280",
    fontWeight: "600",
  },
  monthlyHighlights: {
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 20,
  },
  highlightsTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: 12,
    textAlign: "center",
  },
  highlightsGrid: {
    flexDirection: "row",
    gap: 8,
  },
  highlightItem: {
    flex: 1,
    backgroundColor: "#f9fafb",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    position: "relative",
  },
  highlightMonth: {
    fontSize: 12,
    fontWeight: "700",
    color: "#667eea",
    marginBottom: 4,
  },
  highlightValue: {
    fontSize: 11,
    fontWeight: "600",
    color: "#1f2937",
    textAlign: "center",
  },
  highlightBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "#667eea",
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  highlightRank: {
    fontSize: 10,
    fontWeight: "900",
    color: "#ffffff",
  },
});
