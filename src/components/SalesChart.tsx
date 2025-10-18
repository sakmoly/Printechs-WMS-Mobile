import React from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import { LineChart } from "react-native-svg-charts";
import * as shape from "d3-shape";
import { DataPoint } from "../api/schemas";

interface SalesChartProps {
  data: DataPoint[];
  title?: string;
}

const { width } = Dimensions.get("window");

export const SalesChart: React.FC<SalesChartProps> = ({
  data,
  title = "Sales Trend",
}) => {
  const values = data.map((d) => d.v);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>

      <View style={styles.chartContainer}>
        {values.length > 0 ? (
          <LineChart
            style={styles.chart}
            data={values}
            svg={{
              stroke: "#667eea",
              strokeWidth: 3,
            }}
            contentInset={{ top: 20, bottom: 20, left: 10, right: 10 }}
            curve={shape.curveNatural}
          ></LineChart>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No data available</Text>
          </View>
        )}
      </View>

      {data.length > 0 && (
        <View style={styles.footer}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Min</Text>
            <Text style={styles.statValue}>
              {Math.min(...values).toLocaleString()}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Avg</Text>
            <Text style={styles.statValue}>
              {Math.round(
                values.reduce((a, b) => a + b, 0) / values.length
              ).toLocaleString()}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Max</Text>
            <Text style={styles.statValue}>
              {Math.max(...values).toLocaleString()}
            </Text>
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
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: 16,
  },
  chartContainer: {
    height: 200,
    marginBottom: 16,
  },
  chart: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    color: "#9ca3af",
    fontSize: 14,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  statItem: {
    alignItems: "center",
  },
  statLabel: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2937",
  },
});
