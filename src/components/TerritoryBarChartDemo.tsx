import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { TerritoryBarChart } from "./TerritoryBarChart";

/**
 * Demo component showing how to use TerritoryBarChart with your API data
 *
 * To integrate this into your app:
 * 1. Import this component in any of your screen files (e.g., sales-dashboard.tsx)
 * 2. Replace the mock data with your actual API call
 * 3. Pass the data to the TerritoryBarChart component
 */

export const TerritoryBarChartDemo: React.FC = () => {
  // Example: Transform your API response to the format expected by the chart
  const apiResponse = {
    message: {
      message: {
        columns: ["territory", "total_sales", "invoice_count"],
        rows: [
          {
            territory: "Riyadh",
            total_sales: 1051722.0,
            invoice_count: 111,
          },
          {
            territory: "Jeddah",
            total_sales: 763110.28,
            invoice_count: 124,
          },
          {
            territory: "Dammam",
            total_sales: 97642.0,
            invoice_count: 21,
          },
        ],
      },
    },
  };

  // Extract the data from the nested structure
  const territoryData = apiResponse.message.message.rows;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <TerritoryBarChart data={territoryData} title="Territory Performance" />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f3f4f6",
  },
  content: {
    padding: 16,
  },
});
