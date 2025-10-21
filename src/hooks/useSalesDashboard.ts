import { useState, useEffect } from "react";
// import { erpApi } from "../api/erp"; // Temporarily disabled for mock data

interface SalesDashboardParams {
  from_date?: string;
  to_date?: string;
  company?: string;
  territory?: string;
  brand?: string;
}

interface SalesDashboardData {
  totalSales: number;
  totalInvoices: number;
  avgInvoiceValue: number;
  costOfGoodsSold: number;
  grossProfit: number;
  grossProfitPercentage: number;
  date: string;
}

export function useSalesDashboard(params: SalesDashboardParams = {}) {
  const [data, setData] = useState<SalesDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // TODO: Replace with actual API call when endpoint is ready
      // const result = await erpApi.getSalesDashboard(params);

      // Mock data for now
      const mockResult = {
        totalSales: 29447614,
        totalInvoices: 3155,
        avgInvoiceValue: 9334,
        costOfGoodsSold: 19769923,
        grossProfit: 9677691,
        grossProfitPercentage: 32.9,
        date: new Date().toLocaleDateString(),
      };

      setData(mockResult);
    } catch (err) {
      console.error("Error fetching sales dashboard data:", err);
      setError(err instanceof Error ? err : new Error("Unknown error"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [
    params.from_date,
    params.to_date,
    params.company,
    params.territory,
    params.brand,
  ]);

  const refetch = () => {
    fetchData();
  };

  return {
    data,
    isLoading,
    error,
    refetch,
  };
}
