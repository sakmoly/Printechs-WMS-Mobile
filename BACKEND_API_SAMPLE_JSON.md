# Backend API Sample JSON - Warehouse Box Direct Putaway (CORRECTED)

This document provides **corrected** sample JSON requests and responses for all API endpoints related to the Warehouse Box Direct Putaway feature, based on the actual backend implementation.

---

## ⚠️ Important Corrections

1. **Response Format:** Backend uses `"ok": true/false` (not `"success": true/false`)
2. **Table Names:**
   - `tabPutawayLine` (not `tabPutawayTaskLines`)
   - `tabStockLedger` (not `tabStockLocation`)
   - Items come from `tabWmsScanEvent` with `event_type = 'SORT_TO_BOX'` (not `tabScannedItems`)
3. **Response Structure:** Some fields are at root level, not nested in `data` object

---

## 1. API: `/api/boxes/close`

### Request: Close TO Box (Warehouse Destination)

```json
POST /api/boxes/close
Content-Type: application/json
Authorization: Bearer <token>

{
  "box_id": "BOX-STORE-001-12345",
  "closed_by": "USER-786249"
}
```

### Response: Success (Warehouse Box - Putaway Task Created)

```json
{
  "ok": true,
  "box_id": "BOX-STORE-001-12345",
  "status": "Closed",
  "putaway_task": "PUT-20251230-0001",
  "message": "Box closed successfully. Putaway task created."
}
```

### Response: Success (Non-Warehouse Box - No Putaway Task)

```json
{
  "ok": true,
  "box_id": "BOX-STORE-002-12345",
  "status": "Closed",
  "message": "Box closed successfully"
}
```

### Response: Error - Box Not Found

```json
{
  "ok": false,
  "error": {
    "code": "BOX_NOT_FOUND",
    "message": "Box BOX-STORE-001-12345 not found"
  }
}
```

### Response: Error - Database Error

```json
{
  "ok": false,
  "error": {
    "code": "DATABASE_ERROR",
    "message": "Failed to close box",
    "details": "Error details (only in development mode)"
  }
}
```

---

## 2. API: `/api/putaway/scan-transfer-carton`

### Request: Scan Location for Warehouse Box (New Task)

```json
POST /api/putaway/scan-transfer-carton
Content-Type: application/json
Authorization: Bearer <token>

{
  "box_id": "BOX-STORE-001-12345",
  "rack": "A1-R01-L1-B1",
  "bin": "B1",
  "user_id": "USER-786249"
}
```

### Request: Scan Location for Putaway Box (PAW-\*)

```json
POST /api/putaway/scan-transfer-carton
Content-Type: application/json
Authorization: Bearer <token>

{
  "box_id": "PAW-ASN12225-1767",
  "rack": "A1-R01-L1-B1",
  "bin": "B1",
  "user_id": "USER-786249"
}
```

### Request: Scan Location for Regular Warehouse Box

```json
POST /api/putaway/scan-transfer-carton
Content-Type: application/json
Authorization: Bearer <token>

{
  "box_id": "BOX-WHMAIN-12345",
  "rack": "A1-R01-L1-B1",
  "bin": "B1",
  "user_id": "USER-786249"
}
```

### Request: Update Existing Putaway Task with Location

```json
POST /api/putaway/scan-transfer-carton
Content-Type: application/json
Authorization: Bearer <token>

{
  "putaway_task": "PUT-20251230-0001",
  "rack": "A1-R01-L1-B1",
  "bin": "B1",
  "user_id": "USER-786249"
}
```

### Request: Scan Location for Transfer Carton (TC)

```json
POST /api/putaway/scan-transfer-carton
Content-Type: application/json
Authorization: Bearer <token>

{
  "tc_id": "TC-ASN12225-001",
  "rack": "A1-R01-L1-B1",
  "bin": "B1",
  "user_id": "USER-786249"
}
```

### Response: Success (New Task Created)

```json
{
  "ok": true,
  "message": "Putaway task created and items assigned successfully",
  "data": {
    "putaway_task": "PUT-20251230-0001",
    "transfer_carton": null,
    "box_id": "BOX-STORE-001-12345",
    "asn_no": "ASN-12225",
    "status": "In Progress",
    "stock_updated": true,
    "warehouse": "Main Warehouse",
    "rack": "A1-R01-L1-B1",
    "bin": "B1",
    "items_count": 2,
    "items": [
      {
        "item_code": "SKU-HAT-301-BLU-OS",
        "box_id": "BOX-STORE-001-12345",
        "carton_id": "BOX-STORE-001-12345",
        "qty": 75.0,
        "rack": "A1-R01-L1-B1",
        "bin": "B1"
      },
      {
        "item_code": "SKU-SHOE-202-RED-42",
        "box_id": "BOX-STORE-001-12345",
        "carton_id": "BOX-STORE-001-12345",
        "qty": 50.0,
        "rack": "A1-R01-L1-B1",
        "bin": "B1"
      }
    ],
    "stock_updates": [
      {
        "item_code": "SKU-HAT-301-BLU-OS",
        "location": "A1-R01-L1-B1-B1",
        "qty_added": 75.0,
        "qty_before": 100.0,
        "qty_after": 175.0
      },
      {
        "item_code": "SKU-SHOE-202-RED-42",
        "location": "A1-R01-L1-B1-B1",
        "qty_added": 50.0,
        "qty_before": 0.0,
        "qty_after": 50.0
      }
    ],
    "is_new_task": true
  }
}
```

### Response: Success (Existing Task Updated)

```json
{
  "ok": true,
  "message": "Putaway task updated and items assigned successfully",
  "data": {
    "putaway_task": "PUT-20251230-0001",
    "transfer_carton": null,
    "box_id": "BOX-STORE-001-12345",
    "asn_no": "ASN-12225",
    "status": "In Progress",
    "stock_updated": true,
    "warehouse": "Main Warehouse",
    "rack": "A1-R01-L1-B1",
    "bin": "B1",
    "items_count": 2,
    "items": [
      {
        "item_code": "SKU-HAT-301-BLU-OS",
        "box_id": "BOX-STORE-001-12345",
        "carton_id": "BOX-STORE-001-12345",
        "qty": 75.0,
        "rack": "A1-R01-L1-B1",
        "bin": "B1"
      }
    ],
    "stock_updates": [...],
    "is_new_task": false
  }
}
```

### Response: Error - Box Not Found

```json
{
  "ok": false,
  "error": {
    "code": "BOX_NOT_FOUND",
    "message": "Box BOX-STORE-001-12345 not found"
  }
}
```

### Response: Error - Box Not Closed

```json
{
  "ok": false,
  "error": {
    "code": "BOX_NOT_CLOSED",
    "message": "Box BOX-STORE-001-12345 must be closed before putaway. Current status: Open"
  }
}
```

### Response: Error - Not a Warehouse Box

```json
{
  "ok": false,
  "error": {
    "code": "NOT_WAREHOUSE_BOX",
    "message": "Box destination store does not have warehouse_type = 'Warehouse'. Use Packing screen instead."
  }
}
```

### Response: Error - Location Not Found

```json
{
  "ok": false,
  "error": {
    "code": "LOCATION_NOT_FOUND",
    "message": "Location A1-R01-L1-B1 not found"
  }
}
```

### Response: Error - Location Not Available

```json
{
  "ok": false,
  "error": {
    "code": "LOCATION_NOT_AVAILABLE",
    "message": "Location A1-R01-L1-B1 is not available"
  }
}
```

---

## 3. API: `/api/putaway/complete`

### Request: Complete Putaway Task (Single Item)

**⚠️ IMPORTANT:** Do NOT include `box_id` in the items array. The backend table `tabPutawayLine` uses `carton_id`, not `box_id`. The backend should get `box_id` from the `putaway_task` record and map it to `carton_id` when saving.

```json
POST /api/putaway/complete
Content-Type: application/json
Authorization: Bearer <token>

{
  "putaway_task": "PUT-20251230-0001",
  "performed_by": "USER-786249",
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 150.00,
      "source_bin": "DOCK-01",
      "target_bin": "A1-R01-L1-B1-B1",
      "completed": true
    }
  ]
}
```

### Request: Complete Putaway Task (Multiple Items)

```json
POST /api/putaway/complete
Content-Type: application/json
Authorization: Bearer <token>

{
  "putaway_task": "PUT-20251230-0001",
  "performed_by": "USER-786249",
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 150.00,
      "source_bin": "DOCK-01",
      "target_bin": "A1-R01-L1-B1-B1",
      "completed": true
    },
    {
      "item_code": "SKU-SHOE-202-RED-42",
      "qty": 50.00,
      "source_bin": "DOCK-01",
      "target_bin": "A1-R01-L1-B1-B1",
      "completed": true
    }
  ]
}
```

**Backend Implementation Note:**

- The `tabPutawayLine` table has a `carton_id` column, NOT `box_id`
- Backend should:
  1. Get `box_id` from `tabPutawayTask` using `putaway_task`
  2. Use `box_id` as the value for `carton_id` when inserting/updating `tabPutawayLine`
  3. Example: `INSERT INTO tabPutawayLine (parent_title, item_code, carton_id, qty, rack, bin) VALUES (?, ?, (SELECT box_id FROM tabPutawayTask WHERE title = ?), ?, ?, ?)`

### Response: Success

```json
{
  "ok": true,
  "message": "Putaway completed successfully",
  "data": {
    "putaway_task": "PUT-20251230-0001",
    "status": "Completed",
    "stock_updated": true,
    "warehouse": "Main Warehouse",
    "items_updated": 2,
    "stock_updates": [
      {
        "item_code": "SKU-HAT-301-BLU-OS",
        "location": "A1-R01-L1-B1-B1",
        "qty_added": 150.0,
        "qty_before": 175.0,
        "qty_after": 325.0
      },
      {
        "item_code": "SKU-SHOE-202-RED-42",
        "location": "A1-R01-L1-B1-B1",
        "qty_added": 50.0,
        "qty_before": 50.0,
        "qty_after": 100.0
      }
    ]
  }
}
```

### Response: Error - Putaway Task Not Found

```json
{
  "ok": false,
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Putaway task PUT-20251230-0001 not found. Similar tasks found: PUT-20251230-0002, PUT-20251230-0003."
  }
}
```

### Response: Error - Putaway Task Already Completed

```json
{
  "ok": false,
  "error": {
    "code": "TASK_ALREADY_COMPLETED",
    "message": "Putaway task PUT-20251230-0001 is already completed. Stock has already been updated."
  }
}
```

---

## 4. Database Query Examples (CORRECTED)

### Check if Store is Warehouse

```sql
SELECT warehouse_type
FROM tabWarehouse
WHERE code = 'WH-MAIN'
```

**Expected Result:**

```json
{
  "warehouse_type": "Warehouse"
}
```

### Get Box Details

**⚠️ IMPORTANT:** The database column is `advance_shipping_notice`, NOT `asn_no`. Use `advance_shipping_notice` in SQL queries.

```sql
SELECT box_id, advance_shipping_notice as asn_no, store, status, purpose, to_no
FROM tabSortBox
WHERE box_id = 'BOX-STORE-001-12345'
```

**Expected Result:**

```json
{
  "box_id": "BOX-STORE-001-12345",
  "asn_no": "ASN-12225",
  "store": "WH-MAIN",
  "status": "Closed",
  "purpose": "STORE",
  "to_no": "TO-00012"
}
```

**Backend Implementation Note:**

- When closing a box, use `advance_shipping_notice` (not `asn_no`) in UPDATE/INSERT queries
- Example: `UPDATE tabSortBox SET status = 'Closed' WHERE box_id = ? AND advance_shipping_notice = ?`
- The alias `as asn_no` is only for SELECT queries to return a friendly field name

### Get Items from Box (CORRECTED)

**Note:** Items come from `tabWmsScanEvent` with `event_type = 'SORT_TO_BOX'`, NOT from `tabScannedItems`

```sql
SELECT item_code, SUM(qty) as total_qty, carton_id, box_id
FROM tabWmsScanEvent
WHERE box_id = 'BOX-STORE-001-12345'
  AND event_type = 'SORT_TO_BOX'
  AND item_code IS NOT NULL
GROUP BY item_code, carton_id, box_id
HAVING total_qty > 0
```

**Expected Result:**

```json
[
  {
    "item_code": "SKU-HAT-301-BLU-OS",
    "total_qty": 75.0,
    "carton_id": "CTN-001",
    "box_id": "BOX-STORE-001-12345"
  },
  {
    "item_code": "SKU-HAT-301-BLU-OS",
    "total_qty": 75.0,
    "carton_id": "CTN-002",
    "box_id": "BOX-STORE-001-12345"
  },
  {
    "item_code": "SKU-SHOE-202-RED-42",
    "total_qty": 50.0,
    "carton_id": "CTN-003",
    "box_id": "BOX-STORE-001-12345"
  }
]
```

### Get Putaway Task

```sql
SELECT title as putaway_task, box_id, advance_shipping_notice as asn_no, rack, bin, status, source_type
FROM tabPutawayTask
WHERE title = 'PUT-20251230-0001'
```

**Expected Result:**

```json
{
  "putaway_task": "PUT-20251230-0001",
  "box_id": "BOX-STORE-001-12345",
  "asn_no": "ASN-12225",
  "rack": "A1-R01-L1-B1",
  "bin": "B1",
  "status": "Open",
  "source_type": "Box"
}
```

### Get Putaway Task Lines (CORRECTED)

**Note:** Table name is `tabPutawayLine` (not `tabPutawayTaskLines`)

```sql
SELECT id, parent_title as putaway_task, item_code, carton_id, qty, rack, bin
FROM tabPutawayLine
WHERE parent_title = 'PUT-20251230-0001'
```

**Expected Result:**

```json
[
  {
    "id": 1,
    "putaway_task": "PUT-20251230-0001",
    "item_code": "SKU-HAT-301-BLU-OS",
    "carton_id": "BOX-STORE-001-12345",
    "qty": 75.0,
    "rack": "A1-R01-L1-B1",
    "bin": "B1"
  },
  {
    "id": 2,
    "putaway_task": "PUT-20251230-0001",
    "item_code": "SKU-SHOE-202-RED-42",
    "carton_id": "BOX-STORE-001-12345",
    "qty": 50.0,
    "rack": "A1-R01-L1-B1",
    "bin": "B1"
  }
]
```

### Check Location

```sql
SELECT location_id, is_available, warehouse, zone, aisle, parent_rack, level, bin_id
FROM tabLocation
WHERE location_id = 'A1-R01-L1-B1'
```

**Expected Result:**

```json
{
  "location_id": "A1-R01-L1-B1",
  "is_available": 1,
  "warehouse": "WH-MAIN",
  "zone": "A1",
  "aisle": "R01",
  "parent_rack": "A1-R01-L1",
  "level": "L1",
  "bin_id": "B1"
}
```

### Get Stock at Location (CORRECTED)

**Note:** Table name is `tabStockLedger` (not `tabStockLocation`)

```sql
SELECT item_code, warehouse, bin_location, qty, reserved_qty
FROM tabStockLedger
WHERE bin_location = 'A1-R01-L1-B1-B1'
  AND item_code = 'SKU-HAT-301-BLU-OS'
```

**Expected Result (Before Update):**

```json
{
  "item_code": "SKU-HAT-301-BLU-OS",
  "warehouse": "Main Warehouse",
  "bin_location": "A1-R01-L1-B1-B1",
  "qty": 100.0,
  "reserved_qty": 0.0
}
```

**Expected Result (After Update):**

```json
{
  "item_code": "SKU-HAT-301-BLU-OS",
  "warehouse": "Main Warehouse",
  "bin_location": "A1-R01-L1-B1-B1",
  "qty": 250.0,
  "reserved_qty": 0.0
}
```

---

## 5. Complete Workflow Example

### Step 1: Close TO Box (Warehouse Destination)

**Request:**

```json
POST /api/boxes/close
{
  "box_id": "BOX-STORE-001-12345",
  "closed_by": "USER-786249"
}
```

**Response:**

```json
{
  "ok": true,
  "box_id": "BOX-STORE-001-12345",
  "status": "Closed",
  "putaway_task": "PUT-20251230-0001",
  "message": "Box closed successfully. Putaway task created."
}
```

### Step 2: Scan Location

**Request:**

```json
POST /api/putaway/scan-transfer-carton
{
  "box_id": "BOX-STORE-001-12345",
  "rack": "A1-R01-L1-B1",
  "bin": "B1",
  "user_id": "USER-786249"
}
```

**Response:**

```json
{
  "ok": true,
  "message": "Putaway task updated and items assigned successfully",
  "data": {
    "putaway_task": "PUT-20251230-0001",
    "transfer_carton": null,
    "box_id": "BOX-STORE-001-12345",
    "asn_no": "ASN-12225",
    "status": "In Progress",
    "stock_updated": true,
    "warehouse": "Main Warehouse",
    "rack": "A1-R01-L1-B1",
    "bin": "B1",
    "items_count": 2,
    "items": [...],
    "stock_updates": [...],
    "is_new_task": false
  }
}
```

### Step 3: Complete Putaway

**Request:**

```json
POST /api/putaway/complete
{
  "putaway_task": "PUT-20251230-0001",
  "performed_by": "USER-786249",
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 75.00,
      "source_bin": "DOCK-01",
      "target_bin": "A1-R01-L1-B1-B1",
      "completed": true,
      "box_id": "BOX-STORE-001-12345"
    },
    {
      "item_code": "SKU-SHOE-202-RED-42",
      "qty": 50.00,
      "source_bin": "DOCK-01",
      "target_bin": "A1-R01-L1-B1-B1",
      "completed": true,
      "box_id": "BOX-STORE-001-12345"
    }
  ]
}
```

**Response:**

```json
{
  "ok": true,
  "message": "Putaway completed successfully",
  "data": {
    "putaway_task": "PUT-20251230-0001",
    "status": "Completed",
    "stock_updated": true,
    "warehouse": "Main Warehouse",
    "items_updated": 2,
    "stock_updates": [...]
  }
}
```

---

## 6. Error Response Format

All error responses follow this format:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": "Additional details (only in development mode)"
  }
}
```

### Common Error Codes

- `VALIDATION_ERROR` - Missing required fields or invalid input
- `BOX_NOT_FOUND` - Box ID does not exist
- `BOX_NOT_CLOSED` - Box is not in "Closed" status
- `NOT_WAREHOUSE_BOX` - Box destination store does not have `warehouse_type = 'Warehouse'`
- `LOCATION_NOT_FOUND` - Location ID does not exist in `tabLocation`
- `LOCATION_NOT_AVAILABLE` - Location exists but `is_available = 0`
- `TASK_NOT_FOUND` - Putaway task does not exist
- `TASK_ALREADY_COMPLETED` - Putaway task is already completed
- `DATABASE_ERROR` - Database operation failed

---

## 7. Mobile App Integration Notes

### Key Changes for Mobile App:

1. **Response Format:**

   - Use `response.ok` (not `response.success`)
   - Check `response.ok === true` for success
   - Check `response.error.code` for error handling

2. **Close Box Response:**

   - Check for `response.putaway_task` - if present, box is warehouse box and putaway task was created
   - If `putaway_task` is present, navigate to Putaway screen (skip Packing)
   - If `putaway_task` is not present, navigate to Packing screen (normal flow)

3. **Scan Location:**

   - Can send either `box_id` OR `putaway_task` OR `tc_id`
   - Response includes `data.is_new_task` to know if task was just created
   - Response includes `data.items` array with all items in the task

4. **Complete Putaway:**

   - Must include `items` array with `completed: true` and `target_bin` for each item
   - `target_bin` format: `"A1-R01-L1-B1-B1"` (rack-bin combined)
   - **DO NOT include `box_id` in items array** - backend gets `box_id` from `putaway_task` and maps to `carton_id` in `tabPutawayLine`
   - Response includes `data.stock_updates` array showing stock changes

5. **Error Handling:**
   - Handle `NOT_WAREHOUSE_BOX` error - show message to user to use Packing screen instead
   - Handle `BOX_NOT_CLOSED` error - show message that box must be closed first
   - Handle `LOCATION_NOT_FOUND` - show message that location is invalid
   - Handle `LOCATION_NOT_AVAILABLE` - show message that location is not available

### Mobile App Flow:

```
1. User closes box
   → POST /api/boxes/close
   → Check response.putaway_task
   → If present: Navigate to Putaway screen
   → If not present: Navigate to Packing screen

2. User scans location (Putaway screen)
   → POST /api/putaway/scan-transfer-carton
   → Show items from response.data.items
   → Allow user to complete putaway

3. User completes putaway
   → POST /api/putaway/complete
   → Show success message
   → Show stock updates from response.data.stock_updates
```

### Mobile App Code Example:

```javascript
// After POST /api/boxes/close
if (response.ok && response.putaway_task) {
  // Warehouse box - navigate to Putaway screen
  navigateToPutaway(response.putaway_task);
} else if (response.ok) {
  // Non-warehouse box - navigate to Packing screen
  navigateToPacking();
} else {
  // Error handling
  if (response.error.code === "BOX_NOT_FOUND") {
    showError("Box not found");
  } else if (response.error.code === "DATABASE_ERROR") {
    showError("Database error. Please try again.");
  }
}
```

---

## 8. Testing Checklist

- [ ] Close TO box with warehouse destination → Creates putaway task (`putaway_task` in response)
- [ ] Close Putaway box (PAW-\*) with warehouse destination → Creates putaway task
- [ ] Close regular box with warehouse destination → Creates putaway task
- [ ] Close box with non-warehouse destination → No putaway task created (no `putaway_task` in response)
- [ ] Scan location for warehouse box → Updates/creates putaway task
- [ ] Scan location for non-warehouse box → Returns `NOT_WAREHOUSE_BOX` error
- [ ] Scan location for closed box → Returns `BOX_NOT_CLOSED` error
- [ ] Complete putaway task → Updates stock and location
- [ ] Complete already completed task → Returns `TASK_ALREADY_COMPLETED` error
- [ ] Validate warehouse detection uses ONLY `warehouse_type = 'Warehouse'`
- [ ] Validate no hardcoded warehouse detection logic

---

## 9. Summary of Corrections

| Original Document            | Corrected                                             |
| ---------------------------- | ----------------------------------------------------- |
| `"success": true/false`      | `"ok": true/false`                                    |
| `tabPutawayTaskLines`        | `tabPutawayLine`                                      |
| `tabStockLocation`           | `tabStockLedger`                                      |
| `tabScannedItems`            | `tabWmsScanEvent` (with `event_type = 'SORT_TO_BOX'`) |
| `response.data.putaway_task` | `response.putaway_task` (in closeBox)                 |
| `response.data.status`       | `response.data.status` (in scan-transfer-carton)      |

All corrections have been applied to match the actual backend implementation.
