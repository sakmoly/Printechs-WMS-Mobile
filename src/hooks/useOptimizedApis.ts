import { useQuery } from "@tanstack/react-query";
import {
  optimizedApis,
  type DashboardData,
  type EmployeesData,
  type ApprovalsData,
  type UserProfileData,
} from "../api/optimized-apis";
import { USE_MOCK_DATA } from "../api/mock";

// ========== DASHBOARD HOOKS ==========

/**
 * Single hook for Dashboard screen - gets all dashboard data in one API call
 */
export const useDashboardData = (
  params: {
    company?: string;
    from_date?: string;
    to_date?: string;
  } = {}
) => {
  return useQuery({
    queryKey: ["dashboard-complete", params],
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        // Return mock data with same structure
        await new Promise((resolve) => setTimeout(resolve, 800));
        return {
          kpis: [
            {
              id: "sales_mtd",
              title: "SALES MTD",
              value: 1983829,
              change_percentage: 15.5,
              change_direction: "up" as const,
              currency: "SAR",
            },
            {
              id: "sales_ytd",
              title: "SALES YTD",
              value: 29949868,
              change_percentage: 35.4,
              change_direction: "up" as const,
              currency: "SAR",
            },
            {
              id: "gross_margin",
              title: "GROSS MARGIN",
              value: 25.8,
              change_percentage: 2.1,
              change_direction: "up" as const,
              unit: "%",
            },
          ],
          charts: {
            sales_daily: [],
            sales_by_territory: [],
            sales_by_division: [],
          },
          user_profile: {
            image_url: "http://printechs.com/files/Sakeer.png",
            name: "Sakeer",
            designation: "Manager",
            department: "Sales",
          },
          date: new Date().toLocaleDateString(),
        } as DashboardData;
      }
      return optimizedApis.getDashboardData(params);
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 1,
  });
};

// Selector hooks for specific dashboard data
export const useDashboardKpis = (params = {}) => {
  const { data } = useDashboardData(params);
  return data?.kpis || [];
};

export const useDashboardCharts = (params = {}) => {
  const { data } = useDashboardData(params);
  return (
    data?.charts || {
      sales_daily: [],
      sales_by_territory: [],
      sales_by_division: [],
    }
  );
};

export const useDashboardUserProfile = (params = {}) => {
  const { data } = useDashboardData(params);
  return data?.user_profile;
};

// ========== EMPLOYEES HOOKS ==========

/**
 * Single hook for Employees screen - gets all employee data in one API call
 */
export const useEmployeesData = (
  params: {
    department?: string;
    designation?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}
) => {
  return useQuery({
    queryKey: ["employees-complete", params],
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        return {
          employees: [],
          total_count: 0,
          departments: [],
          designations: [],
        } as EmployeesData;
      }
      return optimizedApis.getEmployeesData(params);
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 15 * 60 * 1000, // 15 minutes
    retry: 1,
  });
};

// Selector hooks for specific employee data
export const useEmployeesList = (params = {}) => {
  const { data } = useEmployeesData(params);
  return data?.employees || [];
};

export const useEmployeesFilters = (params = {}) => {
  const { data } = useEmployeesData(params);
  return {
    departments: data?.departments || [],
    designations: data?.designations || [],
    totalCount: data?.total_count || 0,
  };
};

// ========== APPROVALS HOOKS ==========

/**
 * Single hook for Approvals screen - gets all approval data in one API call
 */
export const useApprovalsData = (
  params: {
    status?: string;
    priority?: string;
    limit?: number;
    offset?: number;
  } = {}
) => {
  return useQuery({
    queryKey: ["approvals-complete", params],
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {
          approvals: [],
          total_pending: 0,
          total_approved: 0,
          total_rejected: 0,
        } as ApprovalsData;
      }
      return optimizedApis.getApprovalsData(params);
    },
    staleTime: 2 * 60 * 1000, // 2 minutes (approvals change frequently)
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });
};

// Selector hooks for specific approval data
export const useApprovalsList = (params = {}) => {
  const { data } = useApprovalsData(params);
  return data?.approvals || [];
};

export const useApprovalsStats = (params = {}) => {
  const { data } = useApprovalsData(params);
  return {
    pending: data?.total_pending || 0,
    approved: data?.total_approved || 0,
    rejected: data?.total_rejected || 0,
  };
};

// ========== USER PROFILE HOOKS ==========

/**
 * Single hook for User Profile screen - gets all profile data in one API call
 */
export const useUserProfileData = () => {
  return useQuery({
    queryKey: ["user-profile-complete"],
    queryFn: async () => {
      if (USE_MOCK_DATA) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return {
          user_info: {
            username: "sakeer",
            full_name: "Sakeer",
            email: "sakeer@printechs.com",
            mobile_no: "+966501234567",
            designation: "Manager",
            department: "Sales",
            company: "Printechs",
            image_url: "http://printechs.com/files/Sakeer.png",
          },
          employee_info: {
            employee_name: "Sakeer",
            company_email: "sakeer@printechs.com",
            cell_number: "+966501234567",
            designation: "Manager",
            department: "Sales",
            company: "Printechs",
            branch: "Main Branch",
            current_address: "Riyadh, Saudi Arabia",
            photo_url: "http://printechs.com/files/Sakeer.png",
          },
          qr_data: "BEGIN:VCARD\nVERSION:3.0\nFN:Sakeer\n...",
        } as UserProfileData;
      }
      return optimizedApis.getUserProfileData();
    },
    staleTime: 15 * 60 * 1000, // 15 minutes (profile data changes less frequently)
    gcTime: 30 * 60 * 1000, // 30 minutes
    retry: 1,
  });
};

// Selector hooks for specific profile data
export const useUserInfo = () => {
  const { data } = useUserProfileData();
  return data?.user_info;
};

export const useEmployeeInfo = () => {
  const { data } = useUserProfileData();
  return data?.employee_info;
};

export const useProfileQRData = () => {
  const { data } = useUserProfileData();
  return data?.qr_data || "";
};
