import { KpiResponse, EmployeeListItem, ApprovalInboxItem } from "./schemas";

/**
 * Mock data for development and testing
 * Use this when ERPNext is not available or for demos
 */

export const mockKpiData: KpiResponse = {
  period: {
    from: "2025-10-01",
    to: "2025-10-17",
    compare_from: "2024-10-01",
    compare_to: "2024-10-17",
  },
  cards: [
    {
      id: "sales_mtd",
      label: "Sales MTD",
      value: 1245678.5,
      delta: 8.2,
      format: "currency",
    },
    {
      id: "sales_ytd",
      label: "Sales YTD",
      value: 8945000.0,
      delta: 12.5,
      format: "currency",
    },
    {
      id: "gross_margin",
      label: "Gross Margin",
      value: 22.3,
      delta: -1.1,
      format: "percentage",
    },
    {
      id: "outstanding_ar",
      label: "Outstanding AR",
      value: 567890.0,
      delta: -5.3,
      format: "currency",
    },
    {
      id: "inventory_value",
      label: "Inventory Value",
      value: 3456789.0,
      delta: 2.1,
      format: "currency",
    },
    {
      id: "collections",
      label: "Collections",
      value: 890123.0,
      delta: 15.7,
      format: "currency",
    },
  ],
  series: {
    sales_daily: [
      { d: "2025-10-01", v: 65000 },
      { d: "2025-10-02", v: 72000 },
      { d: "2025-10-03", v: 68000 },
      { d: "2025-10-04", v: 78000 },
      { d: "2025-10-05", v: 82000 },
      { d: "2025-10-06", v: 75000 },
      { d: "2025-10-07", v: 88000 },
      { d: "2025-10-08", v: 91000 },
      { d: "2025-10-09", v: 85000 },
      { d: "2025-10-10", v: 89000 },
      { d: "2025-10-11", v: 94000 },
      { d: "2025-10-12", v: 87000 },
      { d: "2025-10-13", v: 92000 },
      { d: "2025-10-14", v: 96000 },
      { d: "2025-10-15", v: 89000 },
      { d: "2025-10-16", v: 93000 },
      { d: "2025-10-17", v: 98000 },
    ],
    sales_by_territory: [
      { d: "Riyadh", v: 550000, label: "Riyadh" },
      { d: "Jeddah", v: 420000, label: "Jeddah" },
      { d: "Dammam", v: 180000, label: "Dammam" },
      { d: "Makkah", v: 95678, label: "Makkah" },
    ],
  },
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
