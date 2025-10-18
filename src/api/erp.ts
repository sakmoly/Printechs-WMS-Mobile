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
    const {
      fields = [
        "name",
        "employee_name",
        "designation",
        "image",
        "department",
        "company",
      ],
      filters = [],
      limit = 20,
    } = params;

    const response = await http.get<any>("/api/resource/Employee", {
      fields: encodeFields(fields),
      filters: encodeFilters(filters),
      limit_page_length: limit,
    });

    const parsed = z.array(EmployeeListItemSchema).parse(response.data);
    return parsed;
  },

  async getEmployee(name: string): Promise<EmployeeDetail> {
    const response = await http.get<any>(`/api/resource/Employee/${name}`);
    const parsed = EmployeeDetailSchema.parse(response.data);
    return parsed;
  },

  // ========== KPI / Analytics APIs ==========

  async getKpis(params: KpiParams = {}): Promise<KpiResponse> {
    const response = await http.post<any>(
      "/api/method/printechs_utility.sales_kpis.get_dashboard_kpis",
      params
    );

    const parsed = KpiResponseSchema.parse(response.message || response);
    return parsed;
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
