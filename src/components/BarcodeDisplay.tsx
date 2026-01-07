import React from "react";
import { View, Text, StyleSheet } from "react-native";

interface BarcodeDisplayProps {
  value: string;
  format?: "CODE128" | "CODE39" | "EAN13";
  width?: number;
  height?: number;
}

/**
 * Simple barcode display component
 * For actual barcode printing, you would use a barcode library or printer SDK
 * This component shows the barcode value in a format suitable for display/printing
 */
export const BarcodeDisplay: React.FC<BarcodeDisplayProps> = ({
  value,
  format = "CODE128",
  width = 300,
  height = 100,
}) => {
  // For now, display as text-based barcode representation
  // In production, you would use a barcode library to generate actual barcode image
  // or integrate with a printer SDK

  // Guard against null/undefined/empty values
  if (!value || value === null || value === "") {
    return (
      <View style={[styles.container, { width, minHeight: height }]}>
        <Text style={styles.errorText}>Invalid barcode value</Text>
      </View>
    );
  }

  const safeValue = String(value);

  return (
    <View style={[styles.container, { width, minHeight: height }]}>
      <View style={styles.barcodeContainer}>
        <Text style={styles.barcodeText}>{safeValue}</Text>
        <View style={styles.barcodeLines}>
          {/* Simple visual representation - in production use actual barcode library */}
          {safeValue.split("").map((char, index) => (
            <View
              key={index}
              style={[
                styles.barcodeLine,
                {
                  width: Math.random() * 3 + 1, // Random width for visual effect
                  height: height * 0.6,
                },
              ]}
            />
          ))}
        </View>
      </View>
      <Text style={styles.formatLabel}>{format}</Text>
      <Text style={styles.valueLabel}>{safeValue}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    alignItems: "center",
    marginVertical: 8,
  },
  barcodeContainer: {
    width: "100%",
    alignItems: "center",
    marginBottom: 8,
  },
  barcodeText: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 8,
    letterSpacing: 2,
  },
  barcodeLines: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-end",
    height: 60,
    width: "100%",
    paddingHorizontal: 8,
  },
  barcodeLine: {
    backgroundColor: "#000",
    marginHorizontal: 1,
  },
  formatLabel: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  valueLabel: {
    fontSize: 14,
    color: "#333",
    marginTop: 4,
    fontFamily: "monospace",
  },
  errorText: {
    fontSize: 14,
    color: "#F44336",
    textAlign: "center",
    padding: 8,
  },
});
