import React from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import Svg, { Circle, Path, Text as SvgText, G } from "react-native-svg";

interface GaugeChartProps {
  value: number;
  maxValue: number;
  title: string;
  subtitle?: string;
  unit?: string;
  colors?: {
    low: string;
    medium: string;
    high: string;
  };
}

const { width } = Dimensions.get("window");
const GAUGE_SIZE = 200;
const STROKE_WIDTH = 20;
const RADIUS = (GAUGE_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export const GaugeChart: React.FC<GaugeChartProps> = ({
  value,
  maxValue,
  title,
  subtitle,
  unit = "%",
  colors = {
    low: "#ef4444",
    medium: "#f59e0b",
    high: "#10b981",
  },
}) => {
  const percentage = Math.min((value / maxValue) * 100, 100);
  const strokeDasharray = CIRCUMFERENCE;
  const strokeDashoffset = CIRCUMFERENCE - (percentage / 100) * CIRCUMFERENCE;

  // Determine color based on percentage
  const getColor = () => {
    if (percentage >= 70) return colors.high;
    if (percentage >= 40) return colors.medium;
    return colors.low;
  };

  // Calculate angle for the gauge (180 degrees = half circle)
  const angle = (percentage / 100) * 180;
  const x =
    GAUGE_SIZE / 2 +
    (GAUGE_SIZE / 2 - STROKE_WIDTH / 2) *
      Math.cos(((angle - 90) * Math.PI) / 180);
  const y =
    GAUGE_SIZE / 2 +
    (GAUGE_SIZE / 2 - STROKE_WIDTH / 2) *
      Math.sin(((angle - 90) * Math.PI) / 180);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

      <View style={styles.gaugeContainer}>
        <Svg
          width={GAUGE_SIZE}
          height={GAUGE_SIZE / 2 + 40}
          viewBox={`0 0 ${GAUGE_SIZE} ${GAUGE_SIZE / 2 + 40}`}
        >
          {/* Background arc */}
          <Path
            d={`M ${STROKE_WIDTH / 2} ${
              GAUGE_SIZE / 2
            } A ${RADIUS} ${RADIUS} 0 0 1 ${GAUGE_SIZE - STROKE_WIDTH / 2} ${
              GAUGE_SIZE / 2
            }`}
            stroke="#e5e7eb"
            strokeWidth={STROKE_WIDTH}
            fill="none"
            strokeLinecap="round"
          />

          {/* Progress arc */}
          <Path
            d={`M ${STROKE_WIDTH / 2} ${
              GAUGE_SIZE / 2
            } A ${RADIUS} ${RADIUS} 0 0 1 ${GAUGE_SIZE - STROKE_WIDTH / 2} ${
              GAUGE_SIZE / 2
            }`}
            stroke={getColor()}
            strokeWidth={STROKE_WIDTH}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={strokeDasharray}
            strokeDashoffset={strokeDashoffset}
          />

          {/* Needle */}
          <G>
            <Circle
              cx={GAUGE_SIZE / 2}
              cy={GAUGE_SIZE / 2}
              r={8}
              fill={getColor()}
              stroke="#ffffff"
              strokeWidth={2}
            />
            <Path
              d={`M ${GAUGE_SIZE / 2} ${GAUGE_SIZE / 2} L ${x} ${y}`}
              stroke={getColor()}
              strokeWidth={4}
              strokeLinecap="round"
            />
          </G>

          {/* Value text */}
          <SvgText
            x={GAUGE_SIZE / 2}
            y={GAUGE_SIZE / 2 + 20}
            fontSize="32"
            fontWeight="900"
            textAnchor="middle"
            fill={getColor()}
          >
            {value.toFixed(1)}
            {unit}
          </SvgText>

          {/* Min/Max labels */}
          <SvgText
            x={STROKE_WIDTH / 2}
            y={GAUGE_SIZE / 2 + 25}
            fontSize="12"
            fontWeight="600"
            textAnchor="middle"
            fill="#6b7280"
          >
            0%
          </SvgText>
          <SvgText
            x={GAUGE_SIZE - STROKE_WIDTH / 2}
            y={GAUGE_SIZE / 2 + 25}
            fontSize="12"
            fontWeight="600"
            textAnchor="middle"
            fill="#6b7280"
          >
            100%
          </SvgText>
        </Svg>
      </View>

      {/* Status indicator */}
      <View style={styles.statusContainer}>
        <View style={[styles.statusDot, { backgroundColor: getColor() }]} />
        <Text style={[styles.statusText, { color: getColor() }]}>
          {percentage >= 70
            ? "Excellent"
            : percentage >= 40
            ? "Good"
            : "Needs Improvement"}
        </Text>
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
    alignItems: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: 4,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 20,
    textAlign: "center",
  },
  gaugeContainer: {
    alignItems: "center",
    marginBottom: 20,
  },
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#f9fafb",
    borderRadius: 20,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
  },
});
