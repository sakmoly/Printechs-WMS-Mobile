import { useQuery } from "@tanstack/react-query";
import { erpApi, type KpiParams } from "../api/erp";
import { USE_MOCK_DATA, mockKpiData } from "../api/mock";

export const useKpis = (params: KpiParams = {}) => {
  return useQuery({
    queryKey: ["kpis", params],
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 800));
        return mockKpiData;
      }
      return erpApi.getKpis(params);
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    retry: 1,
  });
};

// Selector hooks for specific KPI data
export const useKpiCards = (params: KpiParams = {}) => {
  const { data } = useKpis(params);
  return data?.kpis || [];
};

export const useSalesDailyChart = (params: KpiParams = {}) => {
  const { data } = useKpis(params);
  return data?.series?.sales_daily || [];
};

export const useSalesByTerritory = (params: KpiParams = {}) => {
  const { data } = useKpis(params);
  return data?.series?.sales_by_territory || [];
};
