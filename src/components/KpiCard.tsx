import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

interface KpiCardProps {
  label: string;
  value: number;
  delta?: number | null;
  format?: "currency" | "number" | "percentage";
  colors?: string[];
}

const formatValue = (value: number, format: string = "number"): string => {
  switch (format) {
    case "currency":
      return `SAR ${value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    case "percentage":
      return `${value.toFixed(1)}%`;
    default:
      return value.toLocaleString("en-US");
  }
};

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  delta,
  format = "number",
  colors = ["#667eea", "#764ba2"],
}) => {
  const isPositive = delta && delta > 0;
  const deltaColor = isPositive ? "#10b981" : "#ef4444";
  const deltaIcon = isPositive ? "trending-up" : "trending-down";

  return (
    <LinearGradient
      colors={colors}
      style={styles.card}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <View style={styles.content}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{formatValue(value, format)}</Text>

        {delta !== null && delta !== undefined && (
          <View style={styles.deltaContainer}>
            <Ionicons name={deltaIcon} size={16} color={deltaColor} />
            <Text style={[styles.delta, { color: deltaColor }]}>
              {Math.abs(delta).toFixed(1)}%
            </Text>
            <Text style={styles.deltaLabel}>vs last period</Text>
          </View>
        )}
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    minHeight: 140,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  content: {
    flex: 1,
    justifyContent: "space-between",
  },
  label: {
    color: "rgba(255, 255, 255, 0.9)",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  value: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 8,
  },
  deltaContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  delta: {
    fontSize: 14,
    fontWeight: "700",
  },
  deltaLabel: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: 12,
    marginLeft: 4,
  },
});
