import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { MonthlySalesTrend } from "../MonthlySalesTrend";
import { TerritoryPieChart } from "../TerritoryPieChart";
import { DivisionPieChart } from "../DivisionPieChart";

export const TrendsTab: React.FC = () => {
  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Monthly Sales Trend Chart */}
      <MonthlySalesTrend
        labels={[
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
        ]}
        current={[
          5471509.21, 3169933.68, 2635202.17, 2012393.0, 2283700.6, 2611126.28,
          2425954.68, 3800397.7, 3140088.65, 1914614.28, 0.0, 0.0,
        ]}
        previous={[
          1889958.85, 2026053.67, 2520946.96, 2025778.9, 1475708.85, 1972484.73,
          3396110.41, 2278308.46, 2186873.53, 2811700.02, 2774109.13,
          3288207.78,
        ]}
        title="Monthly Sales Trend"
      />

      {/* Territory Performance Chart - Pie Chart */}
      <TerritoryPieChart
        data={[
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
        ]}
        title="Territory Performance"
      />

      {/* Division Performance Chart - Pie Chart */}
      <DivisionPieChart
        data={[
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
        ]}
        title="Division Performance"
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#f8fafc",
  },
});
