import React from "react";
import { View, StyleSheet, ScrollView } from "react-native";
import { DivisionPieChart } from "./DivisionPieChart";

// Sample division data
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

export const DivisionPieChartDemo: React.FC = () => {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <DivisionPieChart data={divisionData} title="Division Performance" />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  content: {
    padding: 16,
  },
});
