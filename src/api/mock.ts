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
      value: 1245678.5,
      currency: "SAR",
      change_percentage: 8.2,
      change_direction: "up",
      change_period: "vs last period",
      background_gradient: ["#667eea", "#8e74e8"],
    },
    {
      id: "sales_ytd",
      title: "SALES YTD",
      value: 8945000.0,
      currency: "SAR",
      change_percentage: 12.5,
      change_direction: "up",
      change_period: "vs last period",
      background_gradient: ["#ff6b81", "#ff4757"],
    },
    {
      id: "receivable",
      title: "RECEIVABLE",
      value: 567890.0,
      currency: "SAR",
      change_percentage: 5.3,
      change_direction: "down",
      change_period: "vs last period",
      background_gradient: ["#2ed573", "#7bed9f"],
    },
    {
      id: "inventory_value",
      title: "INVENTORY VALUE",
      value: null,
      currency: "SAR",
      background_gradient: ["#ffa502", "#ffc048"],
    },
  ],
};

export const mockEmployees: EmployeeListItem[] = [
  {
    name: "EMP-001",
    employee_name: "Sakeer",
    designation: "Sales Manager",
    image: "http://printechs.com/files/Sakeer.png",
    department: "Sales",
    company: "Printechs",
    cell_number: "+966501234567",
    company_email: "sakeer@printechs.com",
  },
  {
    name: "EMP-002",
    employee_name: "Fatima Al-Zahrani",
    designation: "Finance Controller",
    image:
      "https://images.unsplash.com/photo-1494790108755-2616b612b786?w=400&h=400&fit=crop&crop=face",
    department: "Finance",
    company: "Printechs",
    cell_number: "+966507654321",
    company_email: "fatima.zahrani@printechs.com",
  },
  {
    name: "EMP-003",
    employee_name: "Mohammed Al-Mutairi",
    designation: "Operations Manager",
    image:
      "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop&crop=face",
    department: "Operations",
    company: "Printechs",
    cell_number: "+966509876543",
    company_email: "mohammed.mutairi@printechs.com",
  },
  {
    name: "EMP-004",
    employee_name: "Sara Al-Qahtani",
    designation: "HR Manager",
    image:
      "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=400&fit=crop&crop=face",
    department: "Human Resources",
    company: "Printechs",
    cell_number: "+966501112233",
    company_email: "sara.qahtani@printechs.com",
  },
  {
    name: "EMP-005",
    employee_name: "Omar Al-Shehri",
    designation: "IT Manager",
    image:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop&crop=face",
    department: "IT",
    company: "Printechs",
    cell_number: "+966505556677",
    company_email: "omar.shehri@printechs.com",
  },
  {
    name: "EMP-006",
    employee_name: "Noura Al-Dosari",
    designation: "Marketing Specialist",
    image:
      "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&h=400&fit=crop&crop=face",
    department: "Marketing",
    company: "Printechs",
    cell_number: "+966508889990",
    company_email: "noura.dosari@printechs.com",
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
 * Note: Both Dashboard and Employees now use LIVE data
 */
export const USE_MOCK_DATA = false; // Set to false to use real API data (API should be whitelisted now)
