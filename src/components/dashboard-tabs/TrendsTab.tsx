import React from "react";
import { ScrollView, StyleSheet, View, Text } from "react-native";
import { MonthlySalesTrend } from "../MonthlySalesTrend";
import { TerritoryPieChart } from "../TerritoryPieChart";
import { DivisionPieChart } from "../DivisionPieChart";

interface TrendsTabProps {
  monthlyTrend?: {
    labels?: string[];
    current?: number[];
    previous?: number[];
  };
  territoryData?: any[];
  divisionData?: any[];
  lastYearTerritoryData?: any[];
  lastYearDivisionData?: any[];
}

export const TrendsTab: React.FC<TrendsTabProps> = ({
  monthlyTrend,
  territoryData,
  divisionData,
  lastYearTerritoryData,
  lastYearDivisionData,
}) => {
  // Debug: Log what data we're receiving
  console.log("🔍 TrendsTab Data:", {
    hasMonthlyTrend: !!monthlyTrend,
    hasTerritoryData: !!territoryData?.length,
    hasDivisionData: !!divisionData?.length,
    monthlyTrendKeys: monthlyTrend ? Object.keys(monthlyTrend) : [],
    territoryCount: territoryData?.length || 0,
    divisionCount: divisionData?.length || 0,
    monthlyTrendData: monthlyTrend,
    territoryData: territoryData,
    divisionData: divisionData,
    lastYearTerritoryData: lastYearTerritoryData,
    lastYearDivisionData: lastYearDivisionData,
  });

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.headerSection}>
        <Text style={styles.headerTitle}>Sales Trends Analysis</Text>
        <Text style={styles.headerSubtitle}>
          Year-to-Date Performance Trends
        </Text>
      </View>

      {/* Monthly Sales Trend Chart */}
      {monthlyTrend &&
      monthlyTrend.labels &&
      monthlyTrend.current &&
      monthlyTrend.previous ? (
        <MonthlySalesTrend
          labels={monthlyTrend.labels}
          current={monthlyTrend.current}
          previous={monthlyTrend.previous}
          title="Monthly Sales Trend YTD"
        />
      ) : (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>No trend data available</Text>
          <Text style={styles.subText}>
            Monthly sales trend data is not available for the YTD period
          </Text>
        </View>
      )}

      {/* Territory Performance Chart - Pie Chart */}
      {territoryData && territoryData.length > 0 ? (
        <TerritoryPieChart
          data={territoryData}
          title="Territory Performance YTD"
        />
      ) : (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>No territory data available</Text>
          <Text style={styles.subText}>
            Territory performance data is not available for the YTD period
          </Text>
        </View>
      )}

      {/* Division Performance Chart - Pie Chart */}
      {divisionData && divisionData.length > 0 ? (
        <DivisionPieChart
          data={divisionData}
          title="Division Performance YTD"
        />
      ) : (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>No division data available</Text>
          <Text style={styles.subText}>
            Division performance data is not available for the YTD period. This
            may be because the API doesn't return division data or it's empty.
          </Text>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#f8fafc",
  },
  headerSection: {
    marginBottom: 24,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#1f2937",
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: "#6b7280",
    fontWeight: "500",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
    marginVertical: 20,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#6b7280",
    textAlign: "center",
  },
  subText: {
    fontSize: 14,
    color: "#9ca3af",
    textAlign: "center",
    marginTop: 8,
  },
});
