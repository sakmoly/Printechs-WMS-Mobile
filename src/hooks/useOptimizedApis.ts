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
      console.log("🔍 Dashboard Query - USE_MOCK_DATA:", USE_MOCK_DATA);
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
              id: "receivable",
              title: "RECEIVABLE",
              value: 567890.0,
              change_percentage: 5.3,
              change_direction: "down" as const,
              currency: "SAR",
            },
          ],
          user_profile: {
            image_url: "http://printechs.com/files/Sakeer.png",
            name: "Sakeer",
            designation: "Manager",
            department: "Sales",
          },
          sales_dashboard: {
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
                100000, 150000, 200000, 180000, 220000, 250000, 230000, 280000,
                300000, 201819, 0, 0,
              ],
              previous: [
                90000, 140000, 180000, 160000, 200000, 230000, 210000, 260000,
                280000, 190000, 180000, 200000,
              ],
            },
            territory: [
              { territory: "Riyadh", total_sales: 800000, invoice_count: 50 },
              { territory: "Jeddah", total_sales: 600000, invoice_count: 40 },
              { territory: "Dammam", total_sales: 400000, invoice_count: 30 },
            ],
            division: [
              {
                division: "Industrial",
                total_sales: 1200000,
                margin_percentage: 28.5,
              },
              {
                division: "Retail",
                total_sales: 800000,
                margin_percentage: 22.0,
              },
              {
                division: "Software",
                total_sales: 200000,
                margin_percentage: 45.0,
              },
            ],
          },
          date: new Date().toLocaleDateString(),
        } as DashboardData;
      }
      return optimizedApis.getDashboardData(params);
    },
    staleTime: 0, // No stale time - always fetch fresh data
    gcTime: 0, // No cache time - always fetch fresh data
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
          employees: [
            {
              name: "EMP-001",
              employee_name: "Sakeer",
              designation: "Sales Manager",
              department: "Sales",
              company: "Printechs",
              photo_url: "http://printechs.com/files/Sakeer.png",
              company_email: "sakeer@printechs.com",
              cell_number: "+966501234567",
              branch: "Main Branch",
            },
            {
              name: "EMP-002",
              employee_name: "Fatima Al-Zahrani",
              designation: "Finance Controller",
              department: "Finance",
              company: "Printechs",
              photo_url:
                "https://images.unsplash.com/photo-1494790108755-2616b612b786?w=400&h=400&fit=crop&crop=face",
              company_email: "fatima.zahrani@printechs.com",
              cell_number: "+966507654321",
              branch: "Main Branch",
            },
            {
              name: "EMP-003",
              employee_name: "Mohammed Al-Mutairi",
              designation: "Operations Manager",
              department: "Operations",
              company: "Printechs",
              photo_url:
                "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop&crop=face",
              company_email: "mohammed.mutairi@printechs.com",
              cell_number: "+966509876543",
              branch: "Main Branch",
            },
          ],
          total_count: 3,
          departments: ["Sales", "Finance", "Operations", "IT", "HR"],
          designations: [
            "Sales Manager",
            "Finance Controller",
            "Operations Manager",
            "IT Manager",
            "HR Manager",
          ],
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
          approvals: [
            {
              id: "1",
              doctype: "Purchase Order",
              name: "PO-00045",
              title: "Purchase Order for Office Supplies",
              status: "Pending",
              priority: "High",
              submitted_by: "Sakeer",
              submitted_on: "2025-10-20",
              description: "Office supplies for Q4 2025",
            },
            {
              id: "2",
              doctype: "Leave Application",
              name: "HR-LAP-00123",
              title: "Annual Leave - Ahmed Al-Rashid",
              status: "Pending",
              priority: "Medium",
              submitted_by: "Ahmed Al-Rashid",
              submitted_on: "2025-10-19",
              description: "Annual leave request for December 2025",
            },
            {
              id: "3",
              doctype: "Expense Claim",
              name: "EXP-00089",
              title: "Client Meeting Expenses",
              status: "Draft",
              priority: "Low",
              submitted_by: "Fatima Al-Zahrani",
              submitted_on: "2025-10-18",
              description: "Travel and meeting expenses for client visit",
            },
          ],
          total_pending: 2,
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
          qr_data:
            "BEGIN:VCARD\nVERSION:3.0\nFN:Sakeer\nORG:Printechs\nTITLE:Manager\nTEL:+966501234567\nEMAIL:sakeer@printechs.com\nADR:;;Riyadh, Saudi Arabia\nEND:VCARD",
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
  const { data, isLoading, error } = useUserProfileData();
  return {
    data: data?.user_info,
    isLoading,
    error,
  };
};

export const useEmployeeInfo = () => {
  const { data, isLoading, error } = useUserProfileData();
  return {
    data: data?.employee_info,
    isLoading,
    error,
  };
};

export const useProfileQRData = () => {
  const { data, isLoading, error } = useUserProfileData();
  return {
    data: data?.qr_data || "",
    isLoading,
    error,
  };
};
