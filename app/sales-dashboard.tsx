import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ScrollView,
  RefreshControl,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { OverviewTab } from "../src/components/dashboard-tabs/OverviewTab";
import { PerformanceTab } from "../src/components/dashboard-tabs/PerformanceTab";
import { TrendsTab } from "../src/components/dashboard-tabs/TrendsTab";
import { useSalesDashboard } from "../src/hooks/useSalesDashboard";
import { LoadingScreen } from "../src/components/LoadingScreen";

const { width } = Dimensions.get("window");

type TabType = "overview" | "performance" | "trends";

export default function SalesDashboardScreen() {
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [refreshing, setRefreshing] = useState(false);

  // Calculate YTD date ranges
  const getYTDRanges = () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const lastYear = currentYear - 1;

    // Current YTD: Jan 1 to today
    const currentYTDStart = `${currentYear}-01-01`;
    const currentYTDEnd = now.toISOString().split("T")[0];

    // Last Year YTD: Jan 1 to same date last year
    const lastYearYTDStart = `${lastYear}-01-01`;
    const lastYearYTDEnd = new Date(lastYear, now.getMonth(), now.getDate())
      .toISOString()
      .split("T")[0];

    return {
      currentYTD: { from_date: currentYTDStart, to_date: currentYTDEnd },
      lastYearYTD: { from_date: lastYearYTDStart, to_date: lastYearYTDEnd },
    };
  };

  const ytdRanges = getYTDRanges();

  const {
    data: salesData,
    kpis,
    isLoading,
    error,
    refetch,
  } = useSalesDashboard(ytdRanges.currentYTD);

  // Fetch last year data for comparison
  const {
    data: lastYearData,
    kpis: lastYearKpis,
    isLoading: lastYearLoading,
    error: lastYearError,
  } = useSalesDashboard(ytdRanges.lastYearYTD);

  // Debug: Log the data we're receiving
  console.log("🔍 YTD Sales Dashboard Data:", {
    dateRanges: ytdRanges,
    currentYTD: {
      data: salesData,
      kpis,
      isLoading,
      error: error?.message,
    },
    lastYearYTD: {
      data: lastYearData,
      kpis: lastYearKpis,
      isLoading: lastYearLoading,
      error: lastYearError?.message,
    },
    hasCurrentMetrics: !!salesData?.metrics,
    hasLastYearMetrics: !!lastYearData?.metrics,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const formatCurrency = (value: number) => {
    return `SAR ${value.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  };

  if ((isLoading || lastYearLoading) && (!salesData || !lastYearData)) {
    return <LoadingScreen message="Loading YTD sales data..." />;
  }

  if (error || lastYearError) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle" size={64} color="#ef4444" />
        <Text style={styles.errorTitle}>Failed to Load YTD Sales Data</Text>
        <Text style={styles.errorMessage}>
          {error?.message || lastYearError?.message || "Unknown error"}
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Ionicons name="refresh-outline" size={20} color="#ffffff" />
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Create fallback data when sales_dashboard is not available yet
  const fallbackSalesData = {
    metrics: {
      totalSales: 2018190.53,
      totalInvoices: 150,
      avgInvoiceValue: 13454.6,
      costOfGoodsSold: 1500000.0,
      grossProfit: 518190.53,
      grossProfitPercentage: 25.7,
    },
    top_brands: [
      {
        brand: "Hitachi",
        total_sales: 500000,
        total_quantity: 1200,
        total_cost: 350000,
        gross_profit_amount: 150000,
        gross_profit_percent: 30.0,
        invoice_count: 45,
      },
      {
        brand: "Nedap",
        total_sales: 300000,
        total_quantity: 800,
        total_cost: 200000,
        gross_profit_amount: 100000,
        gross_profit_percent: 33.3,
        invoice_count: 25,
      },
      {
        brand: "Zebra",
        total_sales: 250000,
        total_quantity: 600,
        total_cost: 180000,
        gross_profit_amount: 70000,
        gross_profit_percent: 28.0,
        invoice_count: 30,
      },
    ],
    top_customers: [
      {
        customer: "CUST001",
        customer_name: "Customer A",
        total_sales: 200000,
        invoice_count: 12,
      },
      {
        customer: "CUST002",
        customer_name: "Customer B",
        total_sales: 150000,
        invoice_count: 8,
      },
      {
        customer: "CUST003",
        customer_name: "Customer C",
        total_sales: 100000,
        invoice_count: 5,
      },
    ],
    monthly_trend: {
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
        100000, 150000, 200000, 180000, 220000, 250000, 230000, 280000, 300000,
        201819, 0, 0,
      ],
      previous: [
        90000, 140000, 180000, 160000, 200000, 230000, 210000, 260000, 280000,
        190000, 180000, 200000,
      ],
    },
    territory: [
      { territory: "Riyadh", total_sales: 800000, invoice_count: 50 },
      { territory: "Jeddah", total_sales: 600000, invoice_count: 40 },
      { territory: "Dammam", total_sales: 400000, invoice_count: 30 },
    ],
    division: [
      { division: "Industrial", total_sales: 1200000, margin_percentage: 28.5 },
      { division: "Retail", total_sales: 800000, margin_percentage: 22.0 },
      { division: "Software", total_sales: 200000, margin_percentage: 45.0 },
    ],
  };

  // Use fallback data if sales_dashboard is not available
  const displayData = salesData || fallbackSalesData;
  const isUsingFallback = !salesData;

  // Debug: Log what data we're using for display
  console.log("🔍 Display Data Debug:", {
    hasSalesData: !!salesData,
    isUsingFallback,
    hasMetrics: !!displayData?.metrics,
    hasTopBrands: !!displayData?.top_brands?.length,
    hasTopCustomers: !!displayData?.top_customers?.length,
    hasMonthlyTrend: !!displayData?.monthly_trend?.labels?.length,
    hasTerritory: !!displayData?.territory?.length,
    hasDivision: !!displayData?.division?.length,
  });

  const renderTabContent = () => {
    switch (activeTab) {
      case "overview":
        // Create YTD vs LY metrics from real API data
        const ytdMetrics = (() => {
          if (!displayData?.metrics || !lastYearData?.metrics) return null;

          console.log("🔍 YTD vs LY Data:", {
            currentYTD: {
              totalSales: displayData.metrics.totalSales,
              totalInvoices: displayData.metrics.totalInvoices,
              avgInvoiceValue: displayData.metrics.avgInvoiceValue,
              grossProfitPercentage: displayData.metrics.grossProfitPercentage,
              costOfGoodsSold: displayData.metrics.costOfGoodsSold,
              grossProfit: displayData.metrics.grossProfit,
            },
            lastYearYTD: {
              totalSales: lastYearData.metrics.totalSales,
              totalInvoices: lastYearData.metrics.totalInvoices,
              avgInvoiceValue: lastYearData.metrics.avgInvoiceValue,
              grossProfitPercentage: lastYearData.metrics.grossProfitPercentage,
              costOfGoodsSold: lastYearData.metrics.costOfGoodsSold,
              grossProfit: lastYearData.metrics.grossProfit,
            },
            dateRanges: ytdRanges,
          });

          // Calculate real YTD vs LY comparisons
          const calculateChange = (current: number, previous: number) => {
            const change = current - previous;
            const changePercent = previous > 0 ? (change / previous) * 100 : 0;
            return { change, changePercent };
          };

          const invoicesChange = calculateChange(
            displayData.metrics.totalInvoices,
            lastYearData.metrics.totalInvoices
          );

          const avgInvoiceChange = calculateChange(
            displayData.metrics.avgInvoiceValue,
            lastYearData.metrics.avgInvoiceValue
          );

          const marginChange = calculateChange(
            displayData.metrics.grossProfitPercentage,
            lastYearData.metrics.grossProfitPercentage
          );

          const costChange = calculateChange(
            displayData.metrics.costOfGoodsSold,
            lastYearData.metrics.costOfGoodsSold
          );

          const profitChange = calculateChange(
            displayData.metrics.grossProfit,
            lastYearData.metrics.grossProfit
          );

          const netSalesChange = calculateChange(
            displayData.metrics.totalSales,
            lastYearData.metrics.totalSales
          );

          return {
            netSales: {
              current: displayData.metrics.totalSales,
              previous: lastYearData.metrics.totalSales,
              change: netSalesChange.change,
              changePercent: netSalesChange.changePercent,
            },
            totalInvoices: {
              current: displayData.metrics.totalInvoices,
              previous: lastYearData.metrics.totalInvoices,
              change: invoicesChange.change,
              changePercent: invoicesChange.changePercent,
            },
            avgInvoice: {
              current: displayData.metrics.avgInvoiceValue,
              previous: lastYearData.metrics.avgInvoiceValue,
              change: avgInvoiceChange.change,
              changePercent: avgInvoiceChange.changePercent,
            },
            grossProfitMargin: {
              current: displayData.metrics.grossProfitPercentage,
              previous: lastYearData.metrics.grossProfitPercentage,
              change: marginChange.change,
              changePercent: marginChange.changePercent,
            },
            costOfGoods: {
              current: displayData.metrics.costOfGoodsSold,
              previous: lastYearData.metrics.costOfGoodsSold,
              change: costChange.change,
              changePercent: costChange.changePercent,
            },
            grossProfit: {
              current: displayData.metrics.grossProfit,
              previous: lastYearData.metrics.grossProfit,
              change: profitChange.change,
              changePercent: profitChange.changePercent,
            },
          };
        })();

        return (
          <OverviewTab
            ytdMetrics={ytdMetrics}
            formatCurrency={formatCurrency}
          />
        );
      case "performance":
        // Use YTD data for performance metrics
        console.log("🔍 Performance Tab Data:", {
          currentYTD: {
            topBrands: salesData?.top_brands,
            topCustomers: salesData?.top_customers,
            hasBrands: !!salesData?.top_brands?.length,
            hasCustomers: !!salesData?.top_customers?.length,
          },
          lastYearYTD: {
            topBrands: lastYearData?.top_brands,
            topCustomers: lastYearData?.top_customers,
            hasBrands: !!lastYearData?.top_brands?.length,
            hasCustomers: !!lastYearData?.top_customers?.length,
          },
        });

        return (
          <PerformanceTab
            topBrands={salesData?.top_brands}
            topCustomers={salesData?.top_customers}
            lastYearBrands={lastYearData?.top_brands}
            lastYearCustomers={lastYearData?.top_customers}
          />
        );
      case "trends":
        // Create monthly trend data from YTD data
        const monthlyTrendData = (() => {
          if (!salesData?.monthly_trend || !lastYearData?.monthly_trend) {
            // If no monthly trend data, create it from daily sales data
            if (
              salesData?.charts?.sales_daily &&
              lastYearData?.charts?.sales_daily
            ) {
              const createMonthlyTrend = (dailyData: any[]) => {
                const monthlyData = dailyData.reduce((acc, item) => {
                  const date = new Date(item.date);
                  const monthKey = `${date.getFullYear()}-${String(
                    date.getMonth() + 1
                  ).padStart(2, "0")}`;
                  const monthName = date.toLocaleDateString("en-US", {
                    month: "short",
                  });

                  if (!acc[monthKey]) {
                    acc[monthKey] = { month: monthName, total: 0, count: 0 };
                  }
                  acc[monthKey].total += item.value;
                  acc[monthKey].count += 1;

                  return acc;
                }, {} as Record<string, { month: string; total: number; count: number }>);

                const sortedMonths = Object.keys(monthlyData).sort();
                return {
                  labels: sortedMonths.map((key) => monthlyData[key].month),
                  current: sortedMonths.map((key) => monthlyData[key].total),
                };
              };

              const currentTrend = createMonthlyTrend(
                salesData.charts.sales_daily
              );
              const lastYearTrend = createMonthlyTrend(
                lastYearData.charts.sales_daily
              );

              return {
                labels: currentTrend.labels,
                current: currentTrend.current,
                previous: lastYearTrend.current,
              };
            }
            return null;
          }

          return {
            labels: salesData.monthly_trend.labels,
            current: salesData.monthly_trend.current,
            previous: lastYearData.monthly_trend.current,
          };
        })();

        console.log("🔍 Trends Tab YTD Data:", {
          currentYTD: {
            monthlyTrend: salesData?.monthly_trend,
            territory: salesData?.territory,
            division: salesData?.division,
            hasDailyData: !!salesData?.charts?.sales_daily?.length,
            territorySample: salesData?.territory?.slice(0, 2),
            divisionSample: salesData?.division?.slice(0, 2),
          },
          lastYearYTD: {
            monthlyTrend: lastYearData?.monthly_trend,
            territory: lastYearData?.territory,
            division: lastYearData?.division,
            hasDailyData: !!lastYearData?.charts?.sales_daily?.length,
            territorySample: lastYearData?.territory?.slice(0, 2),
            divisionSample: lastYearData?.division?.slice(0, 2),
          },
          calculatedTrend: monthlyTrendData,
        });

        return (
          <TrendsTab
            monthlyTrend={monthlyTrendData}
            territoryData={salesData?.territory}
            divisionData={salesData?.division}
            lastYearTerritoryData={lastYearData?.territory}
            lastYearDivisionData={lastYearData?.division}
          />
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={["#667eea", "#764ba2"]}
        style={styles.header}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.headerContent}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#ffffff" />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>Sales Dashboard</Text>
            <Text style={styles.headerSubtitle}>
              Year-to-Date vs Last Year {isUsingFallback && "(Demo Data)"}
            </Text>
          </View>
          <TouchableOpacity style={styles.refreshButton} onPress={onRefresh}>
            <Ionicons name="refresh-outline" size={24} color="#ffffff" />
          </TouchableOpacity>
        </View>

        {/* Tab Selector */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === "overview" && styles.activeTab]}
            onPress={() => setActiveTab("overview")}
          >
            <Ionicons
              name="pie-chart"
              size={18}
              color={activeTab === "overview" ? "#667eea" : "#ffffff"}
            />
            <Text
              style={[
                styles.tabText,
                activeTab === "overview" && styles.activeTabText,
              ]}
            >
              Overview
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tab,
              activeTab === "performance" && styles.activeTab,
            ]}
            onPress={() => setActiveTab("performance")}
          >
            <Ionicons
              name="bar-chart"
              size={18}
              color={activeTab === "performance" ? "#667eea" : "#ffffff"}
            />
            <Text
              style={[
                styles.tabText,
                activeTab === "performance" && styles.activeTabText,
              ]}
            >
              Performance
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === "trends" && styles.activeTab]}
            onPress={() => setActiveTab("trends")}
          >
            <Ionicons
              name="trending-up"
              size={18}
              color={activeTab === "trends" ? "#667eea" : "#ffffff"}
            />
            <Text
              style={[
                styles.tabText,
                activeTab === "trends" && styles.activeTabText,
              ]}
            >
              Trends
            </Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      {/* Tab Content */}
      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#667eea"
          />
        }
      >
        {renderTabContent()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  header: {
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: "#667eea",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#ffffff",
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.85)",
    marginTop: 2,
  },
  refreshButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 16,
    padding: 4,
    gap: 6,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  activeTab: {
    backgroundColor: "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  tabText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  activeTabText: {
    color: "#667eea",
  },
  content: {
    flex: 1,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: "#f9fafb",
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1f2937",
    marginTop: 16,
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: "#667eea",
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
