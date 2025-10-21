import { http, encodeFilters, encodeFields } from "./http";
import {
  EmployeeListItemSchema,
  EmployeeDetailSchema,
  KpiResponseSchema,
  ApprovalInboxItemSchema,
  type EmployeeListItem,
  type EmployeeDetail,
  type KpiResponse,
  type ApprovalInboxItem,
} from "./schemas";
import { z } from "zod";

export interface ListParams {
  fields?: string[];
  filters?: any[];
  limit?: number;
  orderBy?: string;
}

export interface KpiParams {
  company?: string;
  from_date?: string;
  to_date?: string;
  territory?: string;
  brand?: string;
}

export const erpApi = {
  // ========== Employee APIs ==========

  async listEmployees(params: ListParams = {}): Promise<EmployeeListItem[]> {
    try {
      // Import http and auth store to get configured server URL
      const { http } = await import("./http");
      const { useAuthStore } = await import("../store/auth");

      // Get the configured server URL from auth store
      const serverConfig = useAuthStore.getState().serverConfig;
      if (serverConfig.serverUrl) {
        http.setBaseUrl(serverConfig.serverUrl);
        console.log("Updated HTTP base URL to:", serverConfig.serverUrl);
      }

      console.log(
        "Calling employees API endpoint:",
        "/api/method/printechs_utility.employee.get_employees"
      );

      const response = await http.post<any>(
        "/api/method/printechs_utility.employee.get_employees",
        params
      );

      console.log("Employees API Response:", JSON.stringify(response, null, 2));

      // Handle nested message structure from API
      const apiData = response.message?.data || response.data || [];
      console.log("Extracted Employee Data:", JSON.stringify(apiData, null, 2));

      // Transform image URLs to absolute paths
      const transformedData = apiData.map((emp: any) => {
        let imageUrl = emp.photo_url || emp.image;

        // If image exists and is a relative path, make it absolute
        if (imageUrl && imageUrl.startsWith("/")) {
          imageUrl = `${serverConfig.serverUrl}${imageUrl}`;
          console.log("Transformed image URL:", imageUrl);
        }

        return {
          ...emp,
          image: imageUrl,
          photo_url: imageUrl,
        };
      });

      const parsed = z.array(EmployeeListItemSchema).parse(transformedData);
      console.log(
        "Parsed Employee Data with images:",
        JSON.stringify(parsed, null, 2)
      );
      return parsed;
    } catch (error) {
      console.error("Employee API Error Details:", error);
      throw error;
    }
  },

  async getEmployee(name: string): Promise<EmployeeDetail> {
    const response = await http.get<any>(`/api/resource/Employee/${name}`);
    const parsed = EmployeeDetailSchema.parse(response.data);
    return parsed;
  },

  async getCurrentUserEmployee(): Promise<EmployeeListItem | null> {
    try {
      // Import http and auth store to get configured server URL
      const { http } = await import("./http");
      const { useAuthStore } = await import("../store/auth");

      // Get the configured server URL from auth store
      const serverConfig = useAuthStore.getState().serverConfig;
      if (serverConfig.serverUrl) {
        http.setBaseUrl(serverConfig.serverUrl);
        console.log("Updated HTTP base URL to:", serverConfig.serverUrl);
      }

      // Get current user
      const user = useAuthStore.getState().user;
      if (!user || !user.email) {
        console.log("No user email found");
        return null;
      }

      console.log("Fetching employee for user email:", user.email);
      console.log(
        "Calling API endpoint:",
        "/api/method/printechs_utility.employee.get_employees"
      );

      const response = await http.post<any>(
        "/api/method/printechs_utility.employee.get_employees",
        {}
      );

      console.log(
        "Current User Employee API Response:",
        JSON.stringify(response, null, 2)
      );

      // Handle nested message structure from API
      const apiData = response.message?.data || response.data || [];
      console.log(
        "Extracted Current User Employee Data:",
        JSON.stringify(apiData, null, 2)
      );

      if (apiData.length === 0) {
        console.log("No employee found for current user");
        return null;
      }

      // Filter by user email (case-insensitive)
      const userEmail = user.email?.toLowerCase();
      const employee = apiData.find(
        (emp: any) => emp.company_email?.toLowerCase() === userEmail
      );

      if (!employee) {
        console.log("No employee match found for email:", user.email);
        return null;
      }

      console.log("Found matching employee:", employee.employee_name);

      // Transform image URLs to absolute paths
      let imageUrl = employee.photo_url || employee.image;

      // If image exists and is a relative path, make it absolute
      if (imageUrl && imageUrl.startsWith("/")) {
        imageUrl = `${serverConfig.serverUrl}${imageUrl}`;
        console.log("Transformed image URL:", imageUrl);
      }

      const transformedEmployee = {
        ...employee,
        image: imageUrl,
        photo_url: imageUrl,
      };

      const parsed = EmployeeListItemSchema.parse(transformedEmployee);
      console.log(
        "Parsed Current User Employee Data:",
        JSON.stringify(parsed, null, 2)
      );
      return parsed;
    } catch (error) {
      console.error("Current User Employee API Error Details:", error);
      return null;
    }
  },

  // ========== KPI / Analytics APIs ==========

  async getKpis(params: KpiParams = {}): Promise<KpiResponse> {
    try {
      // Import http and auth store to get configured server URL
      const { http } = await import("./http");
      const { useAuthStore } = await import("../store/auth");

      // Get the configured server URL from auth store
      const serverConfig = useAuthStore.getState().serverConfig;
      if (serverConfig.serverUrl) {
        http.setBaseUrl(serverConfig.serverUrl);
        console.log("Updated HTTP base URL to:", serverConfig.serverUrl);
      }

      console.log("Current HTTP base URL:", http.getBaseUrl());
      console.log(
        "Calling API endpoint:",
        "/api/method/printechs_utility.sales_kpis.get_dashboard_kpis"
      );
      console.log("With params:", params);

      const response = await http.post<any>(
        "/api/method/printechs_utility.sales_kpis.get_dashboard_kpis",
        params
      );

      // Debug logging
      console.log("API Response:", JSON.stringify(response, null, 2));
      console.log("Response Message:", response.message);

      // Handle nested message structure from API
      const apiData = response.message?.message || response.message || response;
      console.log("Extracted API Data:", JSON.stringify(apiData, null, 2));

      const parsed = KpiResponseSchema.parse(apiData);
      console.log("Parsed Data:", JSON.stringify(parsed, null, 2));
      return parsed;
    } catch (error) {
      console.error("API Error Details:", error);
      throw error;
    }
  },

  async getSalesDashboard(
    params: {
      from_date?: string;
      to_date?: string;
      company?: string;
      territory?: string;
      brand?: string;
    } = {}
  ): Promise<{
    totalSales: number;
    totalInvoices: number;
    avgInvoiceValue: number;
    costOfGoodsSold: number;
    grossProfit: number;
    grossProfitPercentage: number;
    date: string;
  }> {
    try {
      // Import http and auth store to get configured server URL
      const { http } = await import("./http");
      const { useAuthStore } = await import("../store/auth");

      // Get the configured server URL from auth store
      const serverConfig = useAuthStore.getState().serverConfig;
      if (serverConfig.serverUrl) {
        http.setBaseUrl(serverConfig.serverUrl);
        console.log("Updated HTTP base URL to:", serverConfig.serverUrl);
      }

      console.log("Current HTTP base URL:", http.getBaseUrl());
      console.log(
        "Calling API endpoint:",
        "/api/method/printechs_utility.sales_kpis.get_sales_dashboard"
      );
      console.log("With params:", params);

      const response = await http.post<any>(
        "/api/method/printechs_utility.sales_kpis.get_sales_dashboard",
        params
      );

      // Debug logging
      console.log(
        "Sales Dashboard API Response:",
        JSON.stringify(response, null, 2)
      );
      console.log("Response Message:", response.message);

      // Handle nested message structure from API
      const apiData = response.message?.message || response.message || response;
      console.log(
        "Extracted Sales Dashboard Data:",
        JSON.stringify(apiData, null, 2)
      );

      // Transform API response to match our interface
      const salesData = {
        totalSales: apiData.total_sales || 0,
        totalInvoices: apiData.total_invoices || 0,
        avgInvoiceValue: apiData.avg_invoice_value || 0,
        costOfGoodsSold: apiData.cost_of_goods_sold || 0,
        grossProfit: apiData.gross_profit || 0,
        grossProfitPercentage: apiData.gross_profit_percentage || 0,
        date: apiData.date || new Date().toLocaleDateString(),
      };

      console.log(
        "Transformed Sales Dashboard Data:",
        JSON.stringify(salesData, null, 2)
      );
      return salesData;
    } catch (error) {
      console.error("Sales Dashboard API Error Details:", error);
      throw error;
    }
  },

  // ========== Approvals APIs ==========

  async getApprovalsInbox(): Promise<ApprovalInboxItem[]> {
    const response = await http.post<any>(
      "/api/method/printechs.mobile.approvals.inbox"
    );

    const parsed = z
      .array(ApprovalInboxItemSchema)
      .parse(response.message || response);
    return parsed;
  },

  async applyApproval(params: {
    doctype: string;
    name: string;
    action: string;
    comment?: string;
  }): Promise<{ ok: boolean; state: string }> {
    const response = await http.post<any>(
      "/api/method/printechs.mobile.approvals.apply",
      params
    );

    return response.message || response;
  },

  // ========== Generic Resource APIs ==========

  async getList<T>(doctype: string, params: ListParams = {}): Promise<T[]> {
    const { fields = ["*"], filters = [], limit = 20, orderBy } = params;

    const response = await http.get<any>(`/api/resource/${doctype}`, {
      fields: encodeFields(fields),
      filters: encodeFilters(filters),
      limit_page_length: limit,
      ...(orderBy && { order_by: orderBy }),
    });

    return response.data;
  },

  async getDoc<T>(doctype: string, name: string): Promise<T> {
    const response = await http.get<any>(`/api/resource/${doctype}/${name}`);
    return response.data;
  },

  async createDoc<T>(doctype: string, doc: any): Promise<T> {
    const response = await http.post<any>(`/api/resource/${doctype}`, doc);
    return response.data;
  },

  async updateDoc<T>(doctype: string, name: string, doc: any): Promise<T> {
    const response = await http.put<any>(
      `/api/resource/${doctype}/${name}`,
      doc
    );
    return response.data;
  },
};
