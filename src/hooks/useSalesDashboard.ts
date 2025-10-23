import { useDashboardData } from "./useOptimizedApis";

interface SalesDashboardParams {
  from_date?: string;
  to_date?: string;
  company?: string;
  territory?: string;
  brand?: string;
}

export function useSalesDashboard(params: SalesDashboardParams = {}) {
  const {
    data: dashboardData,
    isLoading,
    error,
    refetch,
  } = useDashboardData({
    company: params.company,
    from_date: params.from_date,
    to_date: params.to_date,
  });

  // Debug: Log what we're getting from the dashboard API
  console.log("🔍 Dashboard API Response:", {
    hasDashboardData: !!dashboardData,
    hasSalesDashboard: !!dashboardData?.sales_dashboard,
    hasChartsData: !!dashboardData?.charts,
    hasSalesDaily: !!dashboardData?.charts?.sales_daily?.length,
    hasTerritoryData: !!dashboardData?.charts?.sales_by_territory?.length,
    hasDivisionData: !!dashboardData?.charts?.sales_by_division?.length,
    hasMetrics: !!dashboardData?.sales_dashboard?.metrics,
    hasTopBrands: !!dashboardData?.sales_dashboard?.top_brands?.length,
    hasTopCustomers: !!dashboardData?.sales_dashboard?.top_customers?.length,
  });

  // Extract sales dashboard data from the main dashboard response
  const salesData = dashboardData?.sales_dashboard;
  const chartsData = dashboardData?.charts;

  // Map charts data to sales dashboard format
  const mappedSalesData = salesData
    ? {
        ...salesData,
        // Create metrics from available data if null
        metrics:
          salesData.metrics ||
          (chartsData?.sales_daily?.length
            ? (() => {
                const totalSales = chartsData.sales_daily.reduce(
                  (sum, item) => sum + item.value,
                  0
                );
                const totalInvoices = chartsData.sales_daily.length;
                const avgInvoiceValue = totalSales / totalInvoices;

                console.log("🔍 Calculated Metrics:", {
                  totalSales,
                  totalInvoices,
                  avgInvoiceValue,
                  dailyDataSample: chartsData.sales_daily.slice(0, 3),
                });

                return {
                  totalSales,
                  totalInvoices,
                  avgInvoiceValue,
                  costOfGoodsSold: 0, // Not available in current data
                  grossProfit: 0, // Not available in current data
                  grossProfitPercentage: 0, // Not available in current data
                };
              })()
            : null),
        // Map territory data from charts
        territory:
          chartsData?.sales_by_territory?.map((item) => ({
            territory: item.territory,
            total_sales: item.value,
            invoice_count: item.invoice_count || 0, // Use available data or default to 0
          })) || salesData.territory,
        // Map division data from charts (if available)
        division:
          chartsData?.sales_by_division?.length > 0
            ? chartsData.sales_by_division.map((item) => ({
                division: item.division || item.name,
                total_sales: item.value,
                margin_percentage: item.percentage || 0,
              }))
            : salesData.division || [], // Fallback to empty array if no data
        // Map monthly trend from daily sales data - aggregate by month
        monthly_trend: chartsData?.sales_daily?.length
          ? (() => {
              // Group daily sales by month
              const monthlyData = chartsData.sales_daily.reduce((acc, item) => {
                const date = new Date(item.date);
                const monthKey = `${date.getFullYear()}-${String(
                  date.getMonth() + 1
                ).padStart(2, "0")}`;
                const monthName = date.toLocaleDateString("en-US", {
                  month: "short",
                });

                if (!acc[monthKey]) {
                  acc[monthKey] = {
                    month: monthName,
                    total: 0,
                    count: 0,
                  };
                }
                acc[monthKey].total += item.value;
                acc[monthKey].count += 1;

                return acc;
              }, {} as Record<string, { month: string; total: number; count: number }>);

              // Convert to arrays for chart
              const sortedMonths = Object.keys(monthlyData).sort();
              const labels = sortedMonths.map((key) => monthlyData[key].month);
              const current = sortedMonths.map((key) => monthlyData[key].total);

              console.log("🔍 Monthly Aggregation:", {
                dailyDataCount: chartsData.sales_daily.length,
                monthlyGroups: Object.keys(monthlyData).length,
                monthlyData,
                labels,
                current,
              });

              return {
                labels,
                current,
                previous: [], // Not available in current data
              };
            })()
          : salesData.monthly_trend,
      }
    : null;

  // Debug: Log the mapped sales data
  console.log("🔍 Mapped Sales Data:", {
    hasMappedData: !!mappedSalesData,
    hasMetrics: !!mappedSalesData?.metrics,
    hasTerritory: !!mappedSalesData?.territory?.length,
    hasDivision: !!mappedSalesData?.division?.length,
    hasMonthlyTrend: !!mappedSalesData?.monthly_trend?.labels?.length,
    territoryCount: mappedSalesData?.territory?.length || 0,
    divisionCount: mappedSalesData?.division?.length || 0,
    dailySalesCount: chartsData?.sales_daily?.length || 0,
  });

  // Debug: Log detailed data structure
  console.log("🔍 Detailed Mapped Data:", {
    metrics: mappedSalesData?.metrics,
    territory: mappedSalesData?.territory,
    division: mappedSalesData?.division,
    monthlyTrend: mappedSalesData?.monthly_trend,
    chartsDataKeys: chartsData ? Object.keys(chartsData) : [],
    salesByTerritorySample: chartsData?.sales_by_territory?.slice(0, 2),
    salesByDivisionSample: chartsData?.sales_by_division?.slice(0, 2),
  });

  return {
    data: mappedSalesData,
    kpis: dashboardData?.kpis,
    isLoading,
    error,
    refetch,
  };
}
