import React from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import { BarChart } from "react-native-chart-kit";

interface ColorfulBarChartProps {
  labels: string[];
  data: number[];
  title?: string;
}

const { width } = Dimensions.get("window");

export const ColorfulBarChart: React.FC<ColorfulBarChartProps> = ({
  labels,
  data,
  title = "Monthly Sales",
}) => {
  // Color palette for each month
  const monthColors = [
    "#3b82f6", // Blue - Jan
    "#8b5cf6", // Purple - Feb
    "#10b981", // Green - Mar
    "#f59e0b", // Amber - Apr
    "#ef4444", // Red - May
    "#06b6d4", // Cyan - Jun
    "#84cc16", // Lime - Jul
    "#f97316", // Orange - Aug
    "#ec4899", // Pink - Sep
    "#6366f1", // Indigo - Oct
    "#14b8a6", // Teal - Nov
    "#a855f7", // Violet - Dec
  ];

  // Format currency
  const formatCurrency = (value: number): string => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `${(value / 1000).toFixed(0)}K`;
    }
    return value.toFixed(0);
  };

  // Prepare chart data
  const chartData = {
    labels: labels,
    datasets: [
      {
        data: data,
      },
    ],
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>

      <View style={styles.chartContainer}>
        <BarChart
          data={chartData}
          width={width - 80}
          height={240}
          yAxisLabel=""
          yAxisSuffix=""
          chartConfig={{
            backgroundColor: "#ffffff",
            backgroundGradientFrom: "#ffffff",
            backgroundGradientTo: "#f8fafc",
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
      </View>

      {/* Color Legend */}
      <View style={styles.legendContainer}>
        <Text style={styles.legendTitle}>Monthly Colors</Text>
        <View style={styles.legendGrid}>
          {labels.map((label, index) => (
            <View key={index} style={styles.legendItem}>
              <View
                style={[
                  styles.legendDot,
                  { backgroundColor: monthColors[index % monthColors.length] },
                ]}
              />
              <Text style={styles.legendText}>{label}</Text>
              <Text style={styles.legendValue}>
                {formatCurrency(data[index])}
              </Text>
            </View>
          ))}
        </View>
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
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: 16,
    textAlign: "center",
  },
  chartContainer: {
    alignItems: "center",
    marginBottom: 20,
  },
  chart: {
    borderRadius: 16,
    marginVertical: 8,
  },
  legendContainer: {
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    paddingTop: 16,
  },
  legendTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: 12,
    textAlign: "center",
  },
  legendGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    minWidth: "30%",
    marginBottom: 8,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6b7280",
    flex: 1,
  },
  legendValue: {
    fontSize: 10,
    fontWeight: "700",
    color: "#1f2937",
  },
});
