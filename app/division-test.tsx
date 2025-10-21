import React from "react";
import { View, StyleSheet, ScrollView, Text } from "react-native";
import { DivisionPieChart } from "../src/components/DivisionPieChart";

export default function DivisionTestScreen() {
  const divisionData = [
    {
      division: "Industrial",
      total_sales: 15977578.27,
      margin_percentage: 25.5,
    },
    {
      division: "Retail",
      total_sales: 13419874.84,
      margin_percentage: 18.2,
    },
    {
      division: "Software",
      total_sales: 99536.8,
      margin_percentage: 45.8,
    },
    {
      division: "Service",
      total_sales: -23414.66,
      margin_percentage: -12.3,
    },
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Division Pie Chart Test</Text>
        <DivisionPieChart data={divisionData} title="Division Performance" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  content: {
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1f2937",
    marginBottom: 20,
    textAlign: "center",
  },
});
