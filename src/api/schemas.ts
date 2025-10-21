import { z } from "zod";

// Employee schemas
export const EmployeeListItemSchema = z.object({
  name: z.string(),
  employee_name: z.string(),
  designation: z.string().nullable().optional(),
  photo_url: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  cell_number: z.string().nullable().optional(),
  company_email: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  company: z.string(),
  current_address: z.string().nullable().optional(),
  current_address_display: z.string().nullable().optional(),
});

export const EmployeeDetailSchema = z.object({
  name: z.string(),
  employee_name: z.string(),
  designation: z.string().nullable().optional(),
  photo_url: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  cell_number: z.string().nullable().optional(),
  company_email: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  company: z.string(),
  current_address: z.string().nullable().optional(),
  current_address_display: z.string().nullable().optional(),
});

// KPI schemas
export const KpiCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  value: z.number().nullable(),
  currency: z.string().optional(),
  unit: z.string().optional(),
  change_percentage: z.number().optional(),
  change_direction: z.enum(["up", "down"]).optional(),
  change_period: z.string().optional(),
  background_gradient: z.array(z.string()).length(2),
});

export const DataPointSchema = z.object({
  d: z.string(), // date
  v: z.number(), // value
  label: z.string().optional(),
});

export const KpiResponseSchema = z.object({
  date: z.string(),
  kpis: z.array(KpiCardSchema),
});

// Approval schemas
export const ApprovalInboxItemSchema = z.object({
  doctype: z.string(),
  name: z.string(),
  title: z.string(),
  amount: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  aging_days: z.number(),
  workflow_state: z.string(),
});

// Auth schemas
export const LoginResponseSchema = z.object({
  message: z.string(),
  home_page: z.string().optional(),
  full_name: z.string().optional(),
});

// Export types
export type EmployeeListItem = z.infer<typeof EmployeeListItemSchema>;
export type EmployeeDetail = z.infer<typeof EmployeeDetailSchema>;
export type KpiCard = z.infer<typeof KpiCardSchema>;
export type DataPoint = z.infer<typeof DataPointSchema>;
export type KpiResponse = z.infer<typeof KpiResponseSchema>;
export type ApprovalInboxItem = z.infer<typeof ApprovalInboxItemSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
