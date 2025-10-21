import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { MonthlySalesTrend } from "./MonthlySalesTrend";

/**
 * Demo component showing how to use MonthlySalesTrend with your API data
 *
 * To integrate this into your app:
 * 1. Import this component in your sales-dashboard.tsx
 * 2. Replace the mock data with your actual API call
 * 3. Pass the data to the MonthlySalesTrend component
 */

export const MonthlySalesTrendDemo: React.FC = () => {
  // Example: Transform your API response to the format expected by the chart
  const apiResponse = {
    message: {
      message: {
        labels: [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ],
        current: [
          5471509.21, 3169933.68, 2635202.17, 2012393.0, 2283700.6, 2611126.28,
          2425954.68, 3800397.7, 3140088.65, 1914614.28, 0.0, 0.0,
        ],
        previous: [
          1889958.85, 2026053.67, 2520946.96, 2025778.9, 1475708.85, 1972484.73,
          3396110.41, 2278308.46, 2186873.53, 2811700.02, 2774109.13,
          3288207.78,
        ],
      },
    },
  };

  // Extract the data from the nested structure
  const { labels, current, previous } = apiResponse.message.message;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <MonthlySalesTrend
          labels={labels}
          current={current}
          previous={previous}
          title="Monthly Sales Trend"
        />
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
