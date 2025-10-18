import { KpiResponse, EmployeeListItem, ApprovalInboxItem } from "./schemas";

/**
 * Mock data for development and testing
 * Use this when ERPNext is not available or for demos
 */

export const mockKpiData: KpiResponse = {
  date: "Saturday, October 18, 2025",
  kpis: [
    {
      id: "sales_mtd",
      title: "SALES MTD",
      value: 1245678.50,
      currency: "SAR",
      change_percentage: 8.2,
      change_direction: "up",
      change_period: "vs last period",
      background_gradient: ["#667eea", "#8e74e8"]
    },
    {
      id: "sales_ytd",
      title: "SALES YTD",
      value: 8945000.00,
      currency: "SAR",
      change_percentage: 12.5,
      change_direction: "up",
      change_period: "vs last period",
      background_gradient: ["#ff6b81", "#ff4757"]
    },
    {
      id: "gross_margin",
      title: "GROSS MARGIN",
      value: 22.3,
      unit: "%",
      change_percentage: 1.1,
      change_direction: "down",
      change_period: "vs last period",
      background_gradient: ["#48dbfb", "#1dd1a1"]
    },
    {
      id: "outstanding_ar",
      title: "OUTSTANDING AR",
      value: 567890.00,
      currency: "SAR",
      change_percentage: 5.3,
      change_direction: "down",
      change_period: "vs last period",
      background_gradient: ["#2ed573", "#7bed9f"]
    },
    {
      id: "inventory_value",
      title: "INVENTORY VALUE",
      value: null,
      currency: "SAR",
      background_gradient: ["#ffa502", "#ffc048"]
    }
  ]
};

export const mockEmployees: EmployeeListItem[] = [
  {
    name: "EMP-001",
    employee_name: "Ahmed Al-Rashid",
    designation: "Sales Manager",
    image: null,
    department: "Sales",
    company: "Printechs",
  },
  {
    name: "EMP-002",
    employee_name: "Fatima Al-Zahrani",
    designation: "Finance Controller",
    image: null,
    department: "Finance",
    company: "Printechs",
  },
  {
    name: "EMP-003",
    employee_name: "Mohammed Al-Mutairi",
    designation: "Operations Manager",
    image: null,
    department: "Operations",
    company: "Printechs",
  },
  {
    name: "EMP-004",
    employee_name: "Sara Al-Qahtani",
    designation: "HR Manager",
    image: null,
    department: "Human Resources",
    company: "Printechs",
  },
];

export const mockApprovals: ApprovalInboxItem[] = [
  {
    doctype: "Purchase Order",
    name: "PO-00045",
    title: "Purchase Order for Office Supplies",
    amount: 15000.0,
    currency: "SAR",
    aging_days: 2,
    workflow_state: "Pending Approval",
  },
  {
    doctype: "Leave Application",
    name: "HR-LAP-00123",
    title: "Annual Leave - Ahmed Al-Rashid",
    amount: null,
    currency: null,
    aging_days: 1,
    workflow_state: "Pending",
  },
  {
    doctype: "Expense Claim",
    name: "EXP-00089",
    title: "Client Meeting Expenses",
    amount: 2500.0,
    currency: "SAR",
    aging_days: 3,
    workflow_state: "Draft",
  },
];

/**
 * Toggle to enable/disable mock mode
 * Set to true for development without ERPNext
 */
export const USE_MOCK_DATA = false;
