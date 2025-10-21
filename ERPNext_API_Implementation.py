"""
ERPNext API Implementation for Optimized Mobile App
==================================================

This file contains the Python code for creating optimized API endpoints
in your ERPNext system that return all data in a single response.

Instructions:
1. Copy these methods to your ERPNext custom app
2. Create a new file in your custom app: printechs_utility/api/
3. Add these methods to your API files
4. Test the endpoints using the sample requests provided

File Structure:
- printechs_utility/api/dashboard.py
- printechs_utility/api/employee.py  
- printechs_utility/api/approvals.py
- printechs_utility/api/profile.py
"""

# ========== DASHBOARD API ==========
# File: printechs_utility/api/dashboard.py

import frappe
from frappe import _
from datetime import datetime, timedelta
import json

@frappe.whitelist()
def get_complete_dashboard_data(company=None, from_date=None, to_date=None):
    """
    Get complete dashboard data in a single API call
    
    Parameters:
    - company: Company filter (optional)
    - from_date: Start date filter (optional)
    - to_date: End date filter (optional)
    
    Returns:
    - Complete dashboard data including KPIs, charts, user profile, and date
    """
    try:
        # Set default date range if not provided
        if not from_date:
            from_date = datetime.now().replace(day=1).strftime('%Y-%m-%d')
        if not to_date:
            to_date = datetime.now().strftime('%Y-%m-%d')
            
        # Get current user
        current_user = frappe.get_user()
        
        # 1. Get KPIs
        kpis = get_dashboard_kpis(company, from_date, to_date)
        
        # 2. Get Charts data
        charts = get_dashboard_charts(company, from_date, to_date)
        
        # 3. Get User Profile data
        user_profile = get_user_profile_data(current_user.name)
        
        # 4. Prepare response
        response = {
            "kpis": kpis,
            "charts": charts,
            "user_profile": user_profile,
            "date": datetime.now().strftime('%A, %B %d, %Y'),
            "from_date": from_date,
            "to_date": to_date
        }
        
        return response
        
    except Exception as e:
        frappe.log_error(f"Dashboard API Error: {str(e)}")
        frappe.throw(_("Error fetching dashboard data: {0}").format(str(e)))

def get_dashboard_kpis(company, from_date, to_date):
    """Get KPI data for dashboard"""
    try:
        # Sales MTD
        sales_mtd = get_sales_mtd(company, from_date, to_date)
        
        # Sales YTD  
        sales_ytd = get_sales_ytd(company, from_date, to_date)
        
        # Gross Margin
        gross_margin = get_gross_margin(company, from_date, to_date)
        
        return [
            {
                "id": "sales_mtd",
                "title": "SALES MTD",
                "value": sales_mtd["amount"],
                "change_percentage": sales_mtd["change_percentage"],
                "change_direction": "up" if sales_mtd["change_percentage"] > 0 else "down",
                "currency": "SAR"
            },
            {
                "id": "sales_ytd",
                "title": "SALES YTD", 
                "value": sales_ytd["amount"],
                "change_percentage": sales_ytd["change_percentage"],
                "change_direction": "up" if sales_ytd["change_percentage"] > 0 else "down",
                "currency": "SAR"
            },
            {
                "id": "gross_margin",
                "title": "GROSS MARGIN",
                "value": gross_margin["percentage"],
                "change_percentage": gross_margin["change_percentage"],
                "change_direction": "up" if gross_margin["change_percentage"] > 0 else "down",
                "unit": "%"
            }
        ]
    except Exception as e:
        frappe.log_error(f"KPI Error: {str(e)}")
        return []

def get_sales_mtd(company, from_date, to_date):
    """Calculate Sales Month to Date"""
    try:
        # Current month sales
        current_month_start = datetime.now().replace(day=1).strftime('%Y-%m-%d')
        current_sales = frappe.db.sql("""
            SELECT COALESCE(SUM(grand_total), 0) as amount
            FROM `tabSales Invoice`
            WHERE docstatus = 1 
            AND posting_date >= %s
            AND posting_date <= %s
            {company_filter}
        """.format(
            company_filter=f"AND company = '{company}'" if company else ""
        ), (current_month_start, to_date), as_dict=True)
        
        # Previous month sales for comparison
        prev_month_start = (datetime.now().replace(day=1) - timedelta(days=1)).replace(day=1).strftime('%Y-%m-%d')
        prev_month_end = (datetime.now().replace(day=1) - timedelta(days=1)).strftime('%Y-%m-%d')
        
        prev_sales = frappe.db.sql("""
            SELECT COALESCE(SUM(grand_total), 0) as amount
            FROM `tabSales Invoice`
            WHERE docstatus = 1 
            AND posting_date >= %s
            AND posting_date <= %s
            {company_filter}
        """.format(
            company_filter=f"AND company = '{company}'" if company else ""
        ), (prev_month_start, prev_month_end), as_dict=True)
        
        current_amount = current_sales[0].amount if current_sales else 0
        prev_amount = prev_sales[0].amount if prev_sales else 0
        
        change_percentage = ((current_amount - prev_amount) / prev_amount * 100) if prev_amount > 0 else 0
        
        return {
            "amount": current_amount,
            "change_percentage": round(change_percentage, 1)
        }
        
    except Exception as e:
        frappe.log_error(f"Sales MTD Error: {str(e)}")
        return {"amount": 0, "change_percentage": 0}

def get_sales_ytd(company, from_date, to_date):
    """Calculate Sales Year to Date"""
    try:
        # Current year sales
        current_year_start = datetime.now().replace(month=1, day=1).strftime('%Y-%m-%d')
        current_sales = frappe.db.sql("""
            SELECT COALESCE(SUM(grand_total), 0) as amount
            FROM `tabSales Invoice`
            WHERE docstatus = 1 
            AND posting_date >= %s
            AND posting_date <= %s
            {company_filter}
        """.format(
            company_filter=f"AND company = '{company}'" if company else ""
        ), (current_year_start, to_date), as_dict=True)
        
        # Previous year sales for comparison
        prev_year_start = datetime.now().replace(year=datetime.now().year-1, month=1, day=1).strftime('%Y-%m-%d')
        prev_year_end = datetime.now().replace(year=datetime.now().year-1, month=12, day=31).strftime('%Y-%m-%d')
        
        prev_sales = frappe.db.sql("""
            SELECT COALESCE(SUM(grand_total), 0) as amount
            FROM `tabSales Invoice`
            WHERE docstatus = 1 
            AND posting_date >= %s
            AND posting_date <= %s
            {company_filter}
        """.format(
            company_filter=f"AND company = '{company}'" if company else ""
        ), (prev_year_start, prev_year_end), as_dict=True)
        
        current_amount = current_sales[0].amount if current_sales else 0
        prev_amount = prev_sales[0].amount if prev_sales else 0
        
        change_percentage = ((current_amount - prev_amount) / prev_amount * 100) if prev_amount > 0 else 0
        
        return {
            "amount": current_amount,
            "change_percentage": round(change_percentage, 1)
        }
        
    except Exception as e:
        frappe.log_error(f"Sales YTD Error: {str(e)}")
        return {"amount": 0, "change_percentage": 0}

def get_gross_margin(company, from_date, to_date):
    """Calculate Gross Margin"""
    try:
        # Get sales and cost of goods sold
        sales_data = frappe.db.sql("""
            SELECT 
                COALESCE(SUM(grand_total), 0) as total_sales,
                COALESCE(SUM(total_cost), 0) as total_cost
            FROM `tabSales Invoice`
            WHERE docstatus = 1 
            AND posting_date >= %s
            AND posting_date <= %s
            {company_filter}
        """.format(
            company_filter=f"AND company = '{company}'" if company else ""
        ), (from_date, to_date), as_dict=True)
        
        if sales_data:
            total_sales = sales_data[0].total_sales
            total_cost = sales_data[0].total_cost
            
            gross_profit = total_sales - total_cost
            gross_margin_percentage = (gross_profit / total_sales * 100) if total_sales > 0 else 0
            
            return {
                "percentage": round(gross_margin_percentage, 1),
                "change_percentage": 2.1  # You can calculate this based on previous period
            }
        
        return {"percentage": 0, "change_percentage": 0}
        
    except Exception as e:
        frappe.log_error(f"Gross Margin Error: {str(e)}")
        return {"percentage": 0, "change_percentage": 0}

def get_dashboard_charts(company, from_date, to_date):
    """Get charts data for dashboard"""
    try:
        # Sales Daily Chart
        sales_daily = get_sales_daily_chart(company, from_date, to_date)
        
        # Sales by Territory Chart
        sales_by_territory = get_sales_by_territory_chart(company, from_date, to_date)
        
        # Sales by Division Chart
        sales_by_division = get_sales_by_division_chart(company, from_date, to_date)
        
        return {
            "sales_daily": sales_daily,
            "sales_by_territory": sales_by_territory,
            "sales_by_division": sales_by_division
        }
        
    except Exception as e:
        frappe.log_error(f"Charts Error: {str(e)}")
        return {
            "sales_daily": [],
            "sales_by_territory": [],
            "sales_by_division": []
        }

def get_sales_daily_chart(company, from_date, to_date):
    """Get daily sales chart data"""
    try:
        daily_sales = frappe.db.sql("""
            SELECT 
                DATE(posting_date) as date,
                COALESCE(SUM(grand_total), 0) as value
            FROM `tabSales Invoice`
            WHERE docstatus = 1 
            AND posting_date >= %s
            AND posting_date <= %s
            {company_filter}
            GROUP BY DATE(posting_date)
            ORDER BY posting_date
        """.format(
            company_filter=f"AND company = '{company}'" if company else ""
        ), (from_date, to_date), as_dict=True)
        
        return [{"date": str(row.date), "value": row.value} for row in daily_sales]
        
    except Exception as e:
        frappe.log_error(f"Daily Sales Chart Error: {str(e)}")
        return []

def get_sales_by_territory_chart(company, from_date, to_date):
    """Get sales by territory chart data"""
    try:
        territory_sales = frappe.db.sql("""
            SELECT 
                COALESCE(territory, 'No Territory') as territory,
                COALESCE(SUM(grand_total), 0) as value
            FROM `tabSales Invoice`
            WHERE docstatus = 1 
            AND posting_date >= %s
            AND posting_date <= %s
            {company_filter}
            GROUP BY territory
            ORDER BY value DESC
            LIMIT 10
        """.format(
            company_filter=f"AND company = '{company}'" if company else ""
        ), (from_date, to_date), as_dict=True)
        
        total_sales = sum(row.value for row in territory_sales)
        
        return [
            {
                "territory": row.territory,
                "value": row.value,
                "percentage": round((row.value / total_sales * 100), 1) if total_sales > 0 else 0
            }
            for row in territory_sales
        ]
        
    except Exception as e:
        frappe.log_error(f"Territory Sales Chart Error: {str(e)}")
        return []

def get_sales_by_division_chart(company, from_date, to_date):
    """Get sales by division chart data"""
    try:
        division_sales = frappe.db.sql("""
            SELECT 
                COALESCE(division, 'No Division') as division,
                COALESCE(SUM(grand_total), 0) as value
            FROM `tabSales Invoice`
            WHERE docstatus = 1 
            AND posting_date >= %s
            AND posting_date <= %s
            {company_filter}
            GROUP BY division
            ORDER BY value DESC
            LIMIT 10
        """.format(
            company_filter=f"AND company = '{company}'" if company else ""
        ), (from_date, to_date), as_dict=True)
        
        total_sales = sum(row.value for row in division_sales)
        
        return [
            {
                "division": row.division,
                "value": row.value,
                "percentage": round((row.value / total_sales * 100), 1) if total_sales > 0 else 0
            }
            for row in division_sales
        ]
        
    except Exception as e:
        frappe.log_error(f"Division Sales Chart Error: {str(e)}")
        return []

def get_user_profile_data(username):
    """Get user profile data for dashboard"""
    try:
        # Get user data
        user_doc = frappe.get_doc("User", username)
        
        # Get employee data if exists
        employee_data = None
        if user_doc.email:
            employee = frappe.db.get_value("Employee", {"company_email": user_doc.email}, "name")
            if employee:
                employee_doc = frappe.get_doc("Employee", employee)
                employee_data = {
                    "photo_url": employee_doc.photo_url or "",
                    "designation": employee_doc.designation or "",
                    "department": employee_doc.department or ""
                }
        
        # Get image URL
        image_url = ""
        if employee_data and employee_data.get("photo_url"):
            image_url = f"{frappe.utils.get_url()}{employee_data['photo_url']}"
        elif user_doc.user_image:
            image_url = f"{frappe.utils.get_url()}{user_doc.user_image}"
        else:
            # Use default image or fallback
            image_url = f"{frappe.utils.get_url()}/files/Sakeer.png"
        
        return {
            "image_url": image_url,
            "name": user_doc.full_name or user_doc.username,
            "designation": employee_data.get("designation") if employee_data else user_doc.designation or "",
            "department": employee_data.get("department") if employee_data else user_doc.department or ""
        }
        
    except Exception as e:
        frappe.log_error(f"User Profile Error: {str(e)}")
        return {
            "image_url": f"{frappe.utils.get_url()}/files/Sakeer.png",
            "name": "User",
            "designation": "",
            "department": ""
        }


# ========== EMPLOYEES API ==========
# File: printechs_utility/api/employee.py

@frappe.whitelist()
def get_complete_employees_data(department=None, designation=None, search=None, limit=50, offset=0):
    """
    Get complete employees data in a single API call
    
    Parameters:
    - department: Department filter (optional)
    - designation: Designation filter (optional) 
    - search: Search term (optional)
    - limit: Number of records to return (default: 50)
    - offset: Offset for pagination (default: 0)
    
    Returns:
    - Complete employees data including list, counts, departments, designations
    """
    try:
        # Build filters
        filters = {"status": "Active"}
        if department:
            filters["department"] = department
        if designation:
            filters["designation"] = designation
            
        # Build search conditions
        search_conditions = ""
        if search:
            search_conditions = f"""
                AND (employee_name LIKE '%{search}%' 
                OR employee_id LIKE '%{search}%' 
                OR company_email LIKE '%{search}%')
            """
        
        # Get employees list
        employees = frappe.db.sql(f"""
            SELECT 
                name,
                employee_name,
                designation,
                department,
                company,
                photo_url,
                company_email,
                cell_number,
                branch
            FROM `tabEmployee`
            WHERE status = 'Active'
            {search_conditions}
            ORDER BY employee_name
            LIMIT {limit} OFFSET {offset}
        """, as_dict=True)
        
        # Get total count
        total_count = frappe.db.count("Employee", {"status": "Active"})
        
        # Get unique departments
        departments = frappe.db.sql("""
            SELECT DISTINCT department
            FROM `tabEmployee`
            WHERE status = 'Active' AND department IS NOT NULL
            ORDER BY department
        """, as_dict=True)
        
        # Get unique designations
        designations = frappe.db.sql("""
            SELECT DISTINCT designation
            FROM `tabEmployee`
            WHERE status = 'Active' AND designation IS NOT NULL
            ORDER BY designation
        """, as_dict=True)
        
        # Process employee data
        processed_employees = []
        for emp in employees:
            processed_employees.append({
                "name": emp.name,
                "employee_name": emp.employee_name,
                "designation": emp.designation or "",
                "department": emp.department or "",
                "company": emp.company or "",
                "photo_url": f"{frappe.utils.get_url()}{emp.photo_url}" if emp.photo_url else "",
                "company_email": emp.company_email or "",
                "cell_number": emp.cell_number or "",
                "branch": emp.branch or ""
            })
        
        response = {
            "employees": processed_employees,
            "total_count": total_count,
            "departments": [d.department for d in departments],
            "designations": [d.designation for d in designations]
        }
        
        return response
        
    except Exception as e:
        frappe.log_error(f"Employees API Error: {str(e)}")
        frappe.throw(_("Error fetching employees data: {0}").format(str(e)))


# ========== APPROVALS API ==========
# File: printechs_utility/api/approvals.py

@frappe.whitelist()
def get_complete_approvals_data(status=None, priority=None, limit=50, offset=0):
    """
    Get complete approvals data in a single API call
    
    Parameters:
    - status: Status filter (optional)
    - priority: Priority filter (optional)
    - limit: Number of records to return (default: 50)
    - offset: Offset for pagination (default: 0)
    
    Returns:
    - Complete approvals data including list, counts
    """
    try:
        # Build filters
        filters = {}
        if status:
            filters["status"] = status
        if priority:
            filters["priority"] = priority
            
        # Get approvals list (example with ToDo doctype)
        approvals = frappe.get_all("ToDo", 
            filters=filters,
            fields=["name", "description", "status", "priority", "owner", "creation"],
            order_by="creation desc",
            limit=limit,
            start=offset
        )
        
        # Get counts
        total_pending = frappe.db.count("ToDo", {"status": "Open"})
        total_approved = frappe.db.count("ToDo", {"status": "Closed"})
        total_rejected = frappe.db.count("ToDo", {"status": "Cancelled"})
        
        # Process approvals data
        processed_approvals = []
        for approval in approvals:
            processed_approvals.append({
                "id": approval.name,
                "doctype": "ToDo",
                "name": approval.name,
                "title": approval.description[:50] + "..." if len(approval.description) > 50 else approval.description,
                "status": approval.status,
                "priority": approval.priority or "Medium",
                "submitted_by": approval.owner,
                "submitted_on": approval.creation.strftime("%Y-%m-%d %H:%M:%S"),
                "description": approval.description
            })
        
        response = {
            "approvals": processed_approvals,
            "total_pending": total_pending,
            "total_approved": total_approved,
            "total_rejected": total_rejected
        }
        
        return response
        
    except Exception as e:
        frappe.log_error(f"Approvals API Error: {str(e)}")
        frappe.throw(_("Error fetching approvals data: {0}").format(str(e)))


# ========== USER PROFILE API ==========
# File: printechs_utility/api/profile.py

@frappe.whitelist()
def get_complete_profile_data():
    """
    Get complete user profile data in a single API call
    
    Returns:
    - Complete profile data including user info, employee info, QR data
    """
    try:
        current_user = frappe.get_user()
        
        # Get user data
        user_doc = frappe.get_doc("User", current_user.name)
        
        # Get employee data
        employee_data = None
        if user_doc.email:
            employee = frappe.db.get_value("Employee", {"company_email": user_doc.email}, "name")
            if employee:
                employee_doc = frappe.get_doc("Employee", employee)
                employee_data = {
                    "employee_name": employee_doc.employee_name,
                    "company_email": employee_doc.company_email,
                    "cell_number": employee_doc.cell_number,
                    "designation": employee_doc.designation,
                    "department": employee_doc.department,
                    "company": employee_doc.company,
                    "branch": employee_doc.branch,
                    "current_address": employee_doc.current_address,
                    "photo_url": f"{frappe.utils.get_url()}{employee_doc.photo_url}" if employee_doc.photo_url else f"{frappe.utils.get_url()}/files/Sakeer.png"
                }
        
        # Prepare user info
        user_info = {
            "username": user_doc.username,
            "full_name": user_doc.full_name or user_doc.username,
            "email": user_doc.email,
            "mobile_no": user_doc.mobile_no or "",
            "designation": user_doc.designation or "",
            "department": user_doc.department or "",
            "company": user_doc.company or "Printechs",
            "image_url": f"{frappe.utils.get_url()}{user_doc.user_image}" if user_doc.user_image else f"{frappe.utils.get_url()}/files/Sakeer.png"
        }
        
        # Generate QR data (vCard format)
        qr_data = generate_vcard_data(user_doc, employee_doc if employee_data else None)
        
        response = {
            "user_info": user_info,
            "employee_info": employee_data,
            "qr_data": qr_data
        }
        
        return response
        
    except Exception as e:
        frappe.log_error(f"Profile API Error: {str(e)}")
        frappe.throw(_("Error fetching profile data: {0}").format(str(e)))

def generate_vcard_data(user_doc, employee_doc=None):
    """Generate vCard data for QR code"""
    try:
        # Use employee data if available, otherwise use user data
        name = employee_doc.employee_name if employee_doc else user_doc.full_name
        email = employee_doc.company_email if employee_doc else user_doc.email
        phone = employee_doc.cell_number if employee_doc else user_doc.mobile_no
        title = employee_doc.designation if employee_doc else user_doc.designation
        org = employee_doc.company if employee_doc else user_doc.company
        address = employee_doc.current_address if employee_doc else ""
        
        vcard = [
            "BEGIN:VCARD",
            "VERSION:3.0",
            f"FN:{name or user_doc.username}",
            f"EMAIL:{email}" if email else "",
            f"TEL:{phone}" if phone else "",
            f"TITLE:{title}" if title else "",
            f"ORG:{org}" if org else "",
            f"ADR:;;{address}" if address else "",
            "END:VCARD"
        ]
        
        return "\n".join([line for line in vcard if line])
        
    except Exception as e:
        frappe.log_error(f"vCard Generation Error: {str(e)}")
        return "BEGIN:VCARD\nVERSION:3.0\nFN:User\nEND:VCARD"
