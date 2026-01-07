# Cycle Count Sync - Request Format for Backend Testing

This document shows the exact JSON format and URLs that the mobile app sends when syncing cycle count data.

## Base URL

All requests use the base API URL from settings, typically:

```
https://your-api.com/api
```

## Authentication

All requests include Bearer token in header:

```
Authorization: Bearer <token>
```

---

## 1. Check for Existing Tasks (Before Sync)

**URL:**

```
GET /api/cycle-count?status=Draft,In Progress
```

**Request Headers:**

```
Authorization: Bearer <token>
Content-Type: application/json
```

**Expected Response:**

```json
{
  "ok": true,
  "data": [
    {
      "title": "CC-0001",
      "status": "In Progress",
      "count_type": "Directed",
      "warehouse_id": "WH-MAIN",
      "bin_code": "A1-R01-L1-B1",
      "bin_id": "A1-R01-L1-B1",
      "started_at": "2024-01-15T10:30:00Z",
      "started_by": "USER-001",
      "is_blind_count": false
    }
  ]
}
```

**Note:** Mobile app searches for a task where `bin_code` or `bin_id` matches the session's bin code.

---

## 2. Submit Cycle Count Lines (Main Sync Action)

**URL:**

```
POST /api/cycle-count/{title}/count
```

**Example:**

```
POST /api/cycle-count/CC-0001/count
```

**Request Headers:**

```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**

```json
{
  "counted_by": "USER-001",
  "lines": [
    {
      "id": 1,
      "item_code": "SKU-HAT-301-BLU-OS",
      "barcode": "1234567890123",
      "actual_qty": 5,
      "counted_qty": 5,
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 5,
      "discrepancy_reason": null
    },
    {
      "id": 2,
      "item_code": "SKU-JEANS-001-BLK-32",
      "barcode": "1234567890124",
      "actual_qty": 3,
      "counted_qty": 3,
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 3,
      "discrepancy_reason": null
    },
    {
      "id": 3,
      "item_code": "SKU-SHIRT-001-WHT-M",
      "barcode": "1234567890125",
      "actual_qty": 0,
      "counted_qty": 0,
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 3,
      "discrepancy_reason": "Damaged"
    }
  ]
}
```

**Field Details:**

- `counted_by`: User ID who performed the count (from `started_by` or settings)
- `lines`: Array of count line updates
  - `id`: Sequential line number (1, 2, 3, ...) - Optional, for reference only
  - **`item_code`**: ✅ **REQUIRED** - Item code for backend matching (primary method)
  - `barcode`: Optional - Also accepted by backend (maps to item_code)
  - `actual_qty`: Counted quantity (same as `counted_qty`)
  - `counted_qty`: Counted quantity (duplicate of `actual_qty` for compatibility)
  - `bin_location`: Bin location code - Helps backend match by bin + item
  - `expected_qty`: Expected quantity - Optional, for new lines
  - `discrepancy_reason`: Reason code or notes if variance exists (can be null)
  - `reason_code`: Alternative field for discrepancy reason
  - `notes`: Alternative field for discrepancy reason

**Expected Response:**

```json
{
  "ok": true,
  "message": "Successfully updated lines",
  "data": {
    "title": "CC-0001",
    "updated_count": 3
  }
}
```

---

## 3. Submit Cycle Count Task (If Status is "Submitted")

**URL:**

```
POST /api/cycle-count/{title}/submit
```

**Example:**

```
POST /api/cycle-count/CC-0001/submit
```

**Request Headers:**

```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**

```json
{}
```

**Expected Response:**

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

## Complete Sync Flow Example

### Step 1: Mobile app checks for existing task

```
GET /api/cycle-count?status=Draft,In Progress
```

### Step 2: Mobile app finds task "CC-0001" for bin "A1-R01-L1-B1"

### Step 3: Mobile app submits count lines

```
POST /api/cycle-count/CC-0001/count
Content-Type: application/json
Authorization: Bearer <token>

{
  "counted_by": "USER-001",
  "lines": [
    {
      "id": 1,
      "actual_qty": 5,
      "counted_qty": 5,
      "discrepancy_reason": null
    },
    {
      "id": 2,
      "actual_qty": 3,
      "counted_qty": 3,
      "discrepancy_reason": null
    }
  ]
}
```

### Step 4: If session status is "Submitted", also submit task

```
POST /api/cycle-count/CC-0001/submit
Content-Type: application/json
Authorization: Bearer <token>

{}
```

---

## Test Data Examples

### Example 1: Simple Count (No Variances)

```json
{
  "counted_by": "MOBILE-USER",
  "lines": [
    {
      "id": 1,
      "item_code": "SKU-HAT-301-BLU-OS",
      "barcode": "1234567890123",
      "actual_qty": 10,
      "counted_qty": 10,
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 10,
      "discrepancy_reason": null
    },
    {
      "id": 2,
      "item_code": "SKU-JEANS-001-BLK-32",
      "barcode": "1234567890124",
      "actual_qty": 5,
      "counted_qty": 5,
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 5,
      "discrepancy_reason": null
    }
  ]
}
```

### Example 2: Count with Variances

```json
{
  "counted_by": "USER-001",
  "lines": [
    {
      "id": 1,
      "item_code": "SKU-HAT-301-BLU-OS",
      "barcode": "1234567890123",
      "actual_qty": 8,
      "counted_qty": 8,
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 10,
      "discrepancy_reason": null
    },
    {
      "id": 2,
      "item_code": "SKU-JEANS-001-BLK-32",
      "barcode": "1234567890124",
      "actual_qty": 0,
      "counted_qty": 0,
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 5,
      "discrepancy_reason": "Damaged - Item broken"
    },
    {
      "id": 3,
      "item_code": "SKU-SHIRT-001-WHT-M",
      "barcode": "1234567890125",
      "actual_qty": 12,
      "counted_qty": 12,
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 10,
      "discrepancy_reason": null
    }
  ]
}
```

### Example 3: Blind Count (No Expected Quantities)

```json
{
  "counted_by": "USER-002",
  "lines": [
    {
      "id": 1,
      "item_code": "SKU-HAT-301-BLU-OS",
      "barcode": "1234567890123",
      "actual_qty": 15,
      "counted_qty": 15,
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": null,
      "discrepancy_reason": null
    },
    {
      "id": 2,
      "item_code": "SKU-JEANS-001-BLK-32",
      "barcode": "1234567890124",
      "actual_qty": 7,
      "counted_qty": 7,
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": null,
      "discrepancy_reason": null
    }
  ]
}
```

---

## Important Notes

1. **Task Must Exist First**: The backend task (e.g., "CC-0001") must already exist before the mobile app can sync to it. The mobile app will search for an existing task matching the bin code.

2. **Item Code Required**: ✅ **`item_code` is REQUIRED** in each line. The backend uses `item_code` (or `barcode`) for matching lines, not sequential IDs.

3. **Line Matching**: The backend matches lines by:

   - **Primary**: `item_code` + `bin_location` (if provided)
   - **Alternative**: `barcode` + `bin_location` (if `item_code` not provided)
   - **Fallback**: Database ID (if `line_id` is a valid database ID)

4. **Both Fields Sent**: Mobile app sends both `actual_qty` and `counted_qty` (same value) for backend compatibility.

5. **Filtering**: Only lines with `counted_qty > 0` or `expected_qty > 0` are sent to the backend.

6. **Error Handling**: If the task doesn't exist, the mobile app will log a warning and skip that session. If `item_code` is missing, the backend will return an error.

---

## Backend Requirements

For the sync to work, the backend must:

1. ✅ Accept `GET /api/cycle-count?status=Draft,In Progress` and return tasks with `bin_code` or `bin_id` fields
2. ✅ Accept `POST /api/cycle-count/{title}/count` with the JSON format above
3. ✅ Update the cycle count lines in the database based on the `id` and `actual_qty`/`counted_qty` values
4. ✅ Return success response: `{ "ok": true, "message": "...", "data": {...} }`
5. ✅ Handle errors and return: `{ "ok": false, "error": { "code": "...", "message": "..." } }`

---

## Testing Checklist

- [ ] Test `GET /api/cycle-count?status=Draft,In Progress` returns tasks with bin codes
- [ ] Test `POST /api/cycle-count/CC-0001/count` accepts the JSON format
- [ ] Test that line IDs are correctly matched to database records
- [ ] Test that `actual_qty` and `counted_qty` are both accepted
- [ ] Test that `discrepancy_reason` is stored correctly
- [ ] Test error handling when task doesn't exist (404)
- [ ] Test error handling when line ID doesn't exist
- [ ] Test authentication (Bearer token)
