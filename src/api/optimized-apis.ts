import { http } from "./http";
import { useAuthStore } from "../store/auth";
import { z } from "zod";

// ========== SCHEMAS FOR SINGLE API RESPONSES ==========

// Dashboard Screen - Single API Response Schema
const DashboardResponseSchema = z.object({
  kpis: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      value: z.number(),
      change_percentage: z.number(),
      change_direction: z.enum(["up", "down", "neutral"]),
      currency: z.string().optional(),
      unit: z.string().optional(),
    })
  ),
  charts: z.object({
    sales_daily: z.array(
      z.object({
        date: z.string(),
        value: z.number(),
      })
    ),
    sales_by_territory: z.array(
      z.object({
        territory: z.string(),
        value: z.number(),
        percentage: z.number(),
      })
    ),
    sales_by_division: z.array(
      z.object({
        division: z.string(),
        value: z.number(),
        percentage: z.number(),
      })
    ),
  }),
  user_profile: z.object({
    image_url: z.string(),
    name: z.string(),
    designation: z.string(),
    department: z.string(),
  }),
  date: z.string(),
});

// Employees Screen - Single API Response Schema
const EmployeesResponseSchema = z.object({
  employees: z.array(
    z.object({
      name: z.string(),
      employee_name: z.string(),
      designation: z.string(),
      department: z.string(),
      company: z.string(),
      photo_url: z.string(),
      company_email: z.string(),
      cell_number: z.string(),
      branch: z.string().optional(),
    })
  ),
  total_count: z.number(),
  departments: z.array(z.string()),
  designations: z.array(z.string()),
});

// Approvals Screen - Single API Response Schema
const ApprovalsResponseSchema = z.object({
  approvals: z.array(
    z.object({
      id: z.string(),
      doctype: z.string(),
      name: z.string(),
      title: z.string(),
      status: z.string(),
      priority: z.string(),
      submitted_by: z.string(),
      submitted_on: z.string(),
      description: z.string(),
    })
  ),
  total_pending: z.number(),
  total_approved: z.number(),
  total_rejected: z.number(),
});

// User Profile Screen - Single API Response Schema
const UserProfileResponseSchema = z.object({
  user_info: z.object({
    username: z.string(),
    full_name: z.string(),
    email: z.string(),
    mobile_no: z.string(),
    designation: z.string(),
    department: z.string(),
    company: z.string(),
    image_url: z.string(),
  }),
  employee_info: z
    .object({
      employee_name: z.string(),
      company_email: z.string(),
      cell_number: z.string(),
      designation: z.string(),
      department: z.string(),
      company: z.string(),
      branch: z.string(),
      current_address: z.string(),
      photo_url: z.string(),
    })
    .optional(),
  qr_data: z.string(), // Pre-generated vCard data
});

// ========== OPTIMIZED API FUNCTIONS ==========

export const optimizedApis = {
  /**
   * Dashboard Screen - Single API call for all dashboard data
   * Returns: KPIs, Charts, User Profile, Date - everything in one response
   */
  async getDashboardData(
    params: {
      company?: string;
      from_date?: string;
      to_date?: string;
    } = {}
  ) {
    try {
      const serverConfig = useAuthStore.getState().serverConfig;
      if (serverConfig.serverUrl) {
        http.setBaseUrl(serverConfig.serverUrl);
      }

      console.log("📊 Calling optimized Dashboard API...");
      const response = await http.post<any>(
        "/api/method/printechs_utility.dashboard.get_complete_dashboard_data",
        params
      );

      const apiData = response.message || response;
      const parsed = DashboardResponseSchema.parse(apiData);

      console.log("✅ Dashboard data loaded successfully");
      return parsed;
    } catch (error) {
      console.error("❌ Dashboard API Error:", error);
      throw error;
    }
  },

  /**
   * Employees Screen - Single API call for all employee data
   * Returns: Employee list, counts, departments, designations - everything in one response
   */
  async getEmployeesData(
    params: {
      department?: string;
      designation?: string;
      search?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    try {
      const serverConfig = useAuthStore.getState().serverConfig;
      if (serverConfig.serverUrl) {
        http.setBaseUrl(serverConfig.serverUrl);
      }

      console.log("👥 Calling optimized Employees API...");
      const response = await http.post<any>(
        "/api/method/printechs_utility.employee.get_complete_employees_data",
        params
      );

      const apiData = response.message || response;
      const parsed = EmployeesResponseSchema.parse(apiData);

      console.log("✅ Employees data loaded successfully");
      return parsed;
    } catch (error) {
      console.error("❌ Employees API Error:", error);
      throw error;
    }
  },

  /**
   * Approvals Screen - Single API call for all approval data
   * Returns: Approvals list, counts, status - everything in one response
   */
  async getApprovalsData(
    params: {
      status?: string;
      priority?: string;
      limit?: number;
      offset?: number;
    } = {}
  ) {
    try {
      const serverConfig = useAuthStore.getState().serverConfig;
      if (serverConfig.serverUrl) {
        http.setBaseUrl(serverConfig.serverUrl);
      }

      console.log("✅ Calling optimized Approvals API...");
      const response = await http.post<any>(
        "/api/method/printechs_utility.approvals.get_complete_approvals_data",
        params
      );

      const apiData = response.message || response;
      const parsed = ApprovalsResponseSchema.parse(apiData);

      console.log("✅ Approvals data loaded successfully");
      return parsed;
    } catch (error) {
      console.error("❌ Approvals API Error:", error);
      throw error;
    }
  },

  /**
   * User Profile Screen - Single API call for all user profile data
   * Returns: User info, employee info, QR data - everything in one response
   */
  async getUserProfileData() {
    try {
      const serverConfig = useAuthStore.getState().serverConfig;
      if (serverConfig.serverUrl) {
        http.setBaseUrl(serverConfig.serverUrl);
      }

      console.log("👤 Calling optimized User Profile API...");
      const response = await http.post<any>(
        "/api/method/printechs_utility.profile.get_complete_profile_data"
      );

      const apiData = response.message || response;
      const parsed = UserProfileResponseSchema.parse(apiData);

      console.log("✅ User Profile data loaded successfully");
      return parsed;
    } catch (error) {
      console.error("❌ User Profile API Error:", error);
      throw error;
    }
  },
};

// ========== TYPE EXPORTS ==========
export type DashboardData = z.infer<typeof DashboardResponseSchema>;
export type EmployeesData = z.infer<typeof EmployeesResponseSchema>;
export type ApprovalsData = z.infer<typeof ApprovalsResponseSchema>;
export type UserProfileData = z.infer<typeof UserProfileResponseSchema>;
