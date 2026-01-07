# Material Request List - Backend Requirements

## Overview
The mobile app filters Material Requests by:
1. **Current Month** - Only shows Material Requests from the current month
2. **Status** - Filters by selected status (Submitted, In Progress, Packed, Dispatched)

## Backend API Requirements

### Endpoint
```
GET /api/material-requests
```

### Response Format
The backend should return Material Requests in one of these formats:

**Option 1: Direct Array**
```json
[
  {
    "title": "MR-0001",
    "status": "Submitted",
    "request_date": "2025-01-24T10:00:00Z",
    "from_warehouse": "WH-MAIN",
    "to_showroom": "STORE-001",
    "requested_by": "SYSTEM",
    "items": [...]
  }
]
```

**Option 2: Wrapped in Object**
```json
{
  "data": [
    {
      "title": "MR-0001",
      "status": "Submitted",
      ...
    }
  ]
}
```

**Option 3: Alternative Wrapper**
```json
{
  "items": [...],
  "material_requests": [...]
}
```

## Required Date Fields

The mobile app requires **at least one** of these date fields to filter by current month:

### Priority Order:
1. `request_date` (preferred)
2. `created_on` or `created_at`
3. `updated_on` or `updated_at`

### Date Format Requirements:
- **ISO 8601 format** (recommended): `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss.sssZ`
  - Example: `"2025-01-24T10:00:00Z"` or `"2025-01-24T10:00:00.000Z"`
- **ISO Date format**: `YYYY-MM-DD`
  - Example: `"2025-01-24"`
- **Any format that JavaScript `new Date()` can parse**

### Important Notes:
- If a Material Request has **no date field**, it will be **excluded** from the list
- If a Material Request's date is **outside the current month**, it will be **excluded** from the list
- The mobile app filters to show only Material Requests from the **current month** (first day to last day)

## Status Field Requirements

The backend should return Material Requests with a `status` field that matches one of these values:

- `"Submitted"` (default filter)
- `"In Progress"` or `"Inprogress"`
- `"Picked"` or `"Sealed"` (shown as "Packed" in filter)
- `"Dispatched"`

### Status Filtering Logic:
- **Submitted**: Shows Material Requests with `status === "submitted"`
- **In Progress**: Shows Material Requests with `status === "in progress"` or `"inprogress"`
- **Packed**: Shows Material Requests with `status === "picked"` or `"sealed"`
- **Dispatched**: Shows Material Requests with `status === "dispatched"`

## Example Backend Response

```json
{
  "data": [
    {
      "title": "MR-0001",
      "status": "Submitted",
      "request_date": "2025-01-24T10:00:00Z",
      "created_on": "2025-01-24T10:00:00Z",
      "updated_on": "2025-01-24T10:00:00Z",
      "from_warehouse": "WH-MAIN",
      "to_showroom": "STORE-001",
      "requested_by": "SYSTEM",
      "items": [
        {
          "item_code": "SKU-HAT-301-BLU-OS",
          "requested_qty": 20,
          "picked_qty": 0
        }
      ]
    },
    {
      "title": "MR-0002",
      "status": "In Progress",
      "request_date": "2025-01-25T14:30:00Z",
      "from_warehouse": "WH-MAIN",
      "to_showroom": "STORE-002",
      "requested_by": "USER-001",
      "items": [
        {
          "item_code": "SKU-JACKET-201-BLK-L",
          "requested_qty": 10,
          "picked_qty": 5
        }
      ]
    }
  ]
}
```

## Troubleshooting

### Issue: "No Material Requests found"

**Possible Causes:**

1. **No Material Requests in Current Month**
   - Check if Material Requests have dates in the current month
   - Check console logs for: `📅 MR {title} date {date} is outside current month - excluding`

2. **Missing Date Fields**
   - Check if Material Requests have `request_date`, `created_on`, or `updated_on` fields
   - Check console logs for: `⚠️ MR {title} has no date field - excluding from current month filter`

3. **Invalid Date Format**
   - Check if date fields are in a format JavaScript can parse
   - Check console logs for: `⚠️ MR {title} has invalid date: {date} - excluding`

4. **Status Mismatch**
   - Check if Material Request status matches the selected filter
   - Check console logs for: `🔍 Filtered by status "{status}": {count} Material Request(s)`

5. **Backend Not Returning Data**
   - Check if API endpoint is working: `GET /api/material-requests`
   - Check console logs for: `✅ MaterialRequestListScreen: Loaded {count} Material Request(s) from backend`

### Debugging Steps:

1. **Check Console Logs** - The mobile app logs detailed information:
   - Total Material Requests loaded from backend
   - Date filter range
   - Which Material Requests are excluded and why
   - Status filtering results

2. **Verify Backend Response**:
   - Ensure backend returns Material Requests with date fields
   - Ensure dates are in the current month
   - Ensure status values match expected values

3. **Test Date Filtering**:
   - Check if Material Requests have valid dates
   - Check if dates are within current month range
   - Current month range is logged: `📅 Date filter range: {start} to {end}`

## Backend Changes Required

If Material Requests are not showing, the backend should:

1. **Ensure Date Fields Are Present**:
   - Add `request_date` field to Material Requests (preferred)
   - Or ensure `created_on`/`created_at` or `updated_on`/`updated_at` are present
   - Dates should be in ISO format or JavaScript-parseable format

2. **Ensure Dates Are Current**:
   - Material Requests created in the current month will be shown
   - Material Requests from previous months will be filtered out

3. **Ensure Status Field Matches**:
   - Status should be one of: "Submitted", "In Progress", "Picked", "Sealed", "Dispatched"
   - Status matching is case-insensitive

4. **Optional: Add Date Filtering to Backend**:
   - Backend could filter by current month server-side
   - This would reduce data transfer and improve performance
   - Example: `GET /api/material-requests?month=2025-01`

## Summary

**Key Requirements:**
- ✅ Material Requests must have at least one date field (`request_date`, `created_on`, `updated_on`, etc.)
- ✅ Date must be in the current month to be displayed
- ✅ Status field must match filter values (case-insensitive)
- ✅ Backend should return Material Requests in array format (direct or wrapped)

**If Material Requests are not showing:**
1. Check console logs for filtering details
2. Verify backend returns Material Requests with date fields
3. Verify dates are in current month
4. Verify status matches selected filter

