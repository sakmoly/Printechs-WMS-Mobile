# Cycle Count API Integration Guide

This document provides the expected JSON formats for Cycle Count API integration between the mobile app and backend.

## Current Status

- **Mobile App**: Currently stores cycle count data locally in SQLite database
- **Backend API**: ✅ Updated and ready - All endpoints implemented with flexible field formats
- **API Integration**: Ready for live integration - Mobile app will call these endpoints when backend is available
- **Offline Support**: Mobile app works offline and will sync when backend is available

## Backend Updates (Latest)

The backend has been updated with the following changes:

✅ **Response Format**: All responses wrapped in `{ ok: true, data: ... }`  
✅ **Error Format**: All errors use `{ ok: false, error: { code, message } }`  
✅ **Field Mapping**: Backend includes both old and new field names for compatibility  
✅ **Flexible Requests**: Backend accepts multiple field name formats in requests  
✅ **Array Fields**: Responses include both `items` and `lines` arrays  
✅ **Status Filter**: Supports comma-separated values: `?status=Draft,In Progress`

## Base URL

All endpoints are relative to the base API URL configured in settings.
Example: `https://your-api.com/api/cycle-count`

## Authentication

All requests require Bearer token authentication:

```
Authorization: Bearer <token>
```

---

## 1. GET /api/cycle-count

**Get list of cycle count tasks**

### Request

```
GET /api/cycle-count?status=In Progress
```

**Query Parameters:**

- `status` (optional): Filter by status (e.g., "In Progress", "Scheduled", "Draft", "Review", "Completed")
- Multiple statuses can be comma-separated: `status=Draft,In Progress`
- Backend supports comma-separated status values for filtering multiple statuses at once

### Expected Response (from Backend)

```json
{
  "ok": true,
  "data": [
    {
      "title": "CC-0001",
      "status": "In Progress",
      "count_type": "Directed",
      "warehouse_id": "WH-MAIN",
      "warehouse": "WH-MAIN",
      "bin_code": "BIN-A1-01",
      "bin_id": "BIN-A1-01",
      "zone": "ZONE-A",
      "started_at": "2024-01-15T10:30:00Z",
      "started_by": "USER-001",
      "is_blind_count": false,
      "total_items": 10,
      "counted_items": 7,
      "items_with_discrepancy": 2,
      "created_at": "2024-01-15T09:00:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

**Note:** Backend includes both `warehouse_id` and `warehouse`, both `bin_code`/`bin_id` and `zone` for compatibility.

---

## 2. GET /api/cycle-count/:title

**Get cycle count task details**

### Request

```
GET /api/cycle-count/CC-0001
```

### Expected Response (from Backend)

```json
{
  "ok": true,
  "data": {
    "title": "CC-0001",
    "status": "In Progress",
    "count_type": "Directed",
    "warehouse_id": "WH-MAIN",
    "warehouse": "WH-MAIN",
    "bin_code": "BIN-A1-01",
    "bin_id": "BIN-A1-01",
    "zone": "ZONE-A",
    "started_at": "2024-01-15T10:30:00Z",
    "started_by": "USER-001",
    "is_blind_count": false,
    "total_items": 10,
    "counted_items": 7,
    "items_with_discrepancy": 2,
    "items": [
      {
        "id": 1,
        "line_id": "LINE-1",
        "item_code": "SKU-HAT-301-BLU-OS",
        "barcode": "SKU-HAT-301-BLU-OS",
        "uom": "EA",
        "expected_qty": 20,
        "actual_qty": 18,
        "counted_qty": 18,
        "variance_qty": -2,
        "discrepancy": -2,
        "bin_location": "BIN-A1-01",
        "status": "Counted",
        "is_unexpected_item": false,
        "reason_code": null,
        "discrepancy_reason": null,
        "notes": null
      }
    ],
    "lines": [
      {
        "id": 1,
        "line_id": "LINE-1",
        "item_code": "SKU-HAT-301-BLU-OS",
        "barcode": "SKU-HAT-301-BLU-OS",
        "uom": "EA",
        "expected_qty": 20,
        "actual_qty": 18,
        "counted_qty": 18,
        "variance_qty": -2,
        "discrepancy": -2,
        "bin_location": "BIN-A1-01",
        "status": "Counted",
        "is_unexpected_item": false,
        "reason_code": null,
        "discrepancy_reason": null,
        "notes": null
      }
    ],
    "created_at": "2024-01-15T09:00:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

**Note:**

- Backend includes both `items` and `lines` arrays for compatibility
- Backend includes both `id` (number) and `line_id` (string "LINE-{id}")
- Backend includes both `variance_qty` and `discrepancy` (same value)
- Backend includes both `actual_qty` and `counted_qty` (same value)
- Backend includes both `reason_code`, `discrepancy_reason`, and `notes` fields

---

## 3. POST /api/cycle-count/:title/start

**Start a cycle count task**

### Request

```
POST /api/cycle-count/CC-0001/start
```

**Request Body:**

```json
{
  "started_by": "USER-001"
}
```

### Expected Response (from Backend)

```json
{
  "ok": true,
  "message": "Cycle Count Task started successfully",
  "data": {
    "title": "CC-0001",
    "status": "In Progress",
    "started_at": "2024-01-15T10:30:00Z",
    "started_by": "USER-001"
  }
}
```

---

## 4. POST /api/cycle-count/:title/count

**Submit batch count updates (main counting action)**

### Request

```
POST /api/cycle-count/CC-0001/count
```

**Request Body (Mobile App Sends):**

```json
{
  "counted_by": "USER-001",
  "lines": [
    {
      "id": 1,
      "actual_qty": 18,
      "discrepancy_reason": null
    },
    {
      "id": 2,
      "actual_qty": 15,
      "discrepancy_reason": null
    }
  ]
}
```

**Backend Accepts (Flexible Format):**

The backend accepts multiple field name formats for compatibility:

```json
{
  "lines": [
    {
      "id": 1,
      "line_id": "LINE-1",
      "actual_qty": 18,
      "counted_qty": 18,
      "discrepancy_reason": null,
      "reason_code": null,
      "notes": null
    }
  ]
}
```

**Note:**

- Backend accepts both `id` (number) and `line_id` (string "LINE-{id}")
- Backend accepts both `actual_qty` and `counted_qty` (treated as same value)
- Backend accepts `discrepancy_reason`, `reason_code`, or `notes` for variance reasons

**Note:** This is the main endpoint used for fast scanning. The mobile app sends batches of count updates.

### Expected Response (from Backend)

```json
{
  "ok": true,
  "message": "Successfully updated lines",
  "data": {
    "title": "CC-0001",
    "updated_count": 2
  }
}
```

---

## 5. POST /api/cycle-count/:title/update-line

**Update a single cycle count line**

### Request

```
POST /api/cycle-count/CC-0001/update-line
```

**Request Body (Mobile App Sends):**

```json
{
  "line_id": 1,
  "actual_qty": 20,
  "counted_by": "USER-001",
  "discrepancy_reason": null
}
```

**Backend Accepts (Flexible Format):**

```json
{
  "id": 1,
  "line_id": "LINE-1",
  "actual_qty": 20,
  "counted_qty": 20,
  "counted_by": "USER-001",
  "discrepancy_reason": null,
  "reason_code": null,
  "notes": null
}
```

**Note:**

- Backend accepts both `id` (number) and `line_id` (string "LINE-{id}")
- Backend accepts both `actual_qty` and `counted_qty` (treated as same value)
- Backend accepts `discrepancy_reason`, `reason_code`, or `notes` for variance reasons

### Expected Response (from Backend)

```json
{
  "ok": true,
  "message": "Cycle Count Line updated successfully",
  "data": {
    "line_id": "LINE-001",
    "actual_qty": 20,
    "counted_qty": 20
  }
}
```

---

## 6. POST /api/cycle-count/:title/submit

**Submit cycle count task for review**

### Request

```
POST /api/cycle-count/CC-0001/submit
```

**Request Body:**

```json
{}
```

### Expected Response (from Backend)

```json
{
  "ok": true,
  "message": "Cycle Count Task submitted successfully",
  "data": {
    "title": "CC-0001",
    "status": "Review"
  }
}
```

---

## 7. POST /api/cycle-count/:title/complete

**Complete cycle count task**

### Request

```
POST /api/cycle-count/CC-0001/complete
```

**Request Body:**

```json
{}
```

### Expected Response (from Backend)

```json
{
  "ok": true,
  "message": "Cycle Count Task completed successfully",
  "data": {
    "title": "CC-0001",
    "status": "Completed"
  }
}
```

---

## Field Definitions

### Cycle Count Task Fields

- `title` (string, required): Unique identifier for the cycle count task (e.g., "CC-0001")
- `status` (string, required): Task status - "Scheduled", "In Progress", "Draft", "Review", "Completed"
- `count_type` (string, optional): "Directed" (mapped from "Cycle") or "Adhoc" (mapped from "Full")
- `warehouse_id` (string, optional): Warehouse identifier (backend also includes `warehouse` field)
- `warehouse` (string, optional): Warehouse identifier (alias for warehouse_id)
- `bin_code` (string, required): Bin location code (e.g., "BIN-A1-01")
- `bin_id` (string, optional): Bin identifier (can be same as bin_code)
- `zone` (string, optional): Zone identifier (backend also maps to bin_code/bin_id)
- `started_at` (string, ISO 8601, optional): When counting started
- `started_by` (string, optional): User who started the count
- `is_blind_count` (boolean, optional): Whether expected quantities are hidden
- `total_items` (number, optional): Total number of items to count
- `counted_items` (number, optional): Number of items counted so far
- `items_with_discrepancy` (number, optional): Number of items with variance
- `created_at` (string, ISO 8601, optional): Creation timestamp
- `updated_at` (string, ISO 8601, optional): Last update timestamp

### Cycle Count Line Fields

- `id` (number, optional): Numeric identifier for the count line
- `line_id` (string, required): Unique identifier for the count line (format: "LINE-{id}")
- `item_code` (string, required): Item SKU/code
- `barcode` (string, optional): Item barcode
- `uom` (string, optional): Unit of measure (default: "EA")
- `expected_qty` (number, optional): Expected quantity (null for blind counts)
- `actual_qty` (number, optional): Actual counted quantity (alias for counted_qty)
- `counted_qty` (number, required): Counted quantity (alias for actual_qty)
- `variance_qty` (number, optional): Calculated variance (counted_qty - expected_qty)
- `discrepancy` (number, optional): Same as variance_qty (backend includes both)
- `bin_location` (string, optional): Bin location where item was counted
- `status` (string, optional): Line status - "Pending", "Counted", "Reviewed"
- `is_unexpected_item` (boolean, optional): Whether item was not expected in this bin
- `reason_code` (string, optional): Reason code for variance
- `discrepancy_reason` (string, optional): Reason for variance (alias for reason_code)
- `notes` (string, optional): Additional notes (can also be used for variance reason)

---

## Error Response Format

All endpoints should return errors in this format:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  }
}
```

**Common Error Codes:**

- `NOT_FOUND`: Task or line not found
- `VALIDATION_ERROR`: Invalid input data
- `DATABASE_ERROR`: Database operation failed
- `UNAUTHORIZED`: Authentication required
- `FORBIDDEN`: Insufficient permissions

**Example Error Response:**

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Cycle Count Task CC-0001 not found"
  }
}
```

---

## Important Notes

1. **Field Name Flexibility**:

   - Backend includes both `items` and `lines` arrays in responses
   - Backend includes both `warehouse_id` and `warehouse` fields
   - Backend includes both `bin_code`/`bin_id` and `zone` fields
   - Backend includes both `id` (number) and `line_id` (string "LINE-{id}") for lines
   - Backend includes both `variance_qty` and `discrepancy` fields
   - Backend includes both `actual_qty` and `counted_qty` fields

2. **Count Type Mapping**:

   - Backend maps "Cycle" → "Directed"
   - Backend maps "Full" → "Adhoc"

3. **Quantity Fields**: The mobile app uses both `actual_qty` and `counted_qty` - backend treats them as the same value.

4. **Expected Quantity**: Can be `null` for blind counts. Mobile app will display "Exp: 0" if null.

5. **Batch Updates**: The `/count` endpoint is the primary endpoint for fast scanning. It accepts multiple lines in a single request.

6. **Variance Reason Fields**: Backend accepts `discrepancy_reason`, `reason_code`, or `notes` for variance reasons.

7. **Status Values**:

   - "Draft" - Saved but not started
   - "Scheduled" - Assigned but not started
   - "In Progress" - Currently being counted
   - "Review" - Submitted and awaiting review
   - "Completed" - Finished and approved

8. **Offline Support**: The mobile app stores data locally and syncs when online. Backend should handle duplicate submissions gracefully.

9. **Authentication**: All requests require Bearer token in Authorization header.

---

## Testing Checklist

- [ ] GET /api/cycle-count returns list of tasks
- [ ] GET /api/cycle-count/:title returns task details with items/lines
- [ ] POST /api/cycle-count/:title/start updates status to "In Progress"
- [ ] POST /api/cycle-count/:title/count accepts batch of lines
- [ ] POST /api/cycle-count/:title/update-line updates single line
- [ ] POST /api/cycle-count/:title/submit changes status to "Review"
- [ ] POST /api/cycle-count/:title/complete changes status to "Completed"
- [ ] Error responses follow the standard format
- [ ] Authentication is required for all endpoints

---

## Quick Reference Summary

### Endpoints Overview

| Method | Endpoint                              | Purpose             | Key Fields                        |
| ------ | ------------------------------------- | ------------------- | --------------------------------- |
| GET    | `/api/cycle-count`                    | List tasks          | `status` query param              |
| GET    | `/api/cycle-count/:title`             | Get task details    | Returns `items` or `lines` array  |
| POST   | `/api/cycle-count/:title/start`       | Start counting      | `started_by`                      |
| POST   | `/api/cycle-count/:title/count`       | Batch update counts | `lines[]` with `id`, `actual_qty` |
| POST   | `/api/cycle-count/:title/update-line` | Update single line  | `line_id`, `actual_qty`           |
| POST   | `/api/cycle-count/:title/submit`      | Submit for review   | Empty body                        |
| POST   | `/api/cycle-count/:title/complete`    | Complete task       | Empty body                        |

### Key Data Formats

**Task Status Values:**

- `"Draft"` - Saved locally, not started
- `"Scheduled"` - Assigned but not started
- `"In Progress"` - Currently being counted
- `"Review"` - Submitted, awaiting approval
- `"Completed"` - Finished and approved

**Response Format:**

```json
{
  "ok": true,
  "data": { ... }  // or "items": [...] or "lines": [...]
}
```

**Error Format:**

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Error message"
  }
}
```

### Field Compatibility Notes

1. **Line ID**: Mobile app may send `id` (number) or `line_id` (string) - backend should accept both
2. **Items Array**: Mobile app accepts `items` or `lines` in responses - both are valid
3. **Quantity Fields**: `actual_qty` and `counted_qty` are treated as the same value
4. **Expected Quantity**: Can be `null` for blind counts - mobile app displays as "Exp: 0"

### Priority Endpoints (Implement First)

1. **GET /api/cycle-count** - Required for listing tasks
2. **GET /api/cycle-count/:title** - Required for viewing task details
3. **POST /api/cycle-count/:title/count** - Critical for fast scanning workflow
4. **POST /api/cycle-count/:title/submit** - Required for completing counts

### Optional Endpoints (Can Implement Later)

- POST /api/cycle-count/:title/start (can be skipped if tasks auto-start)
- POST /api/cycle-count/:title/update-line (batch endpoint covers this)
- POST /api/cycle-count/:title/complete (can use submit instead)

---

## Contact & Support

For questions or clarifications about the API integration, please refer to:

- Mobile app code: `src/services/api.service.ts` (lines 1873-1931)
- Mobile app screens: `src/screens/CycleCountBinCountingScreen.tsx`
- Database schema: `src/database/schema.ts` (cycle_count_sessions, cycle_count_lines tables)
