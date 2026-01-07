# Backend Requirements: Putaway Task Generation and Management

## Overview

**Current Issue:** Putaway tasks are being generated locally in the mobile app. The backend should generate putaway tasks when boxes are closed, and the mobile app should read them from the backend.

**Required Changes:**

1. Backend must create putaway tasks automatically when warehouse boxes are closed
2. Mobile app must read putaway tasks from backend API (not local database)
3. When location is scanned, backend must update putaway task status and stock

---

## 1. API: `/api/boxes/close` - Create Putaway Task

### Current Issue

- Box is closed in backend, but putaway task is NOT created
- Mobile app creates putaway task locally (incorrect behavior)

### Required Behavior

**When ANY box is closed and destination store has `warehouse_type = 'Warehouse'`:**

- ✅ Close the box (update status to "Closed")
- ✅ **Automatically create Putaway Task in backend**
- ✅ Return `putaway_task` in response

### Request Format

```json
POST /api/boxes/close
Content-Type: application/json
Authorization: Bearer <token>

{
  "box_id": "BOX-WHMAIN-306647",
  "closed_by": "USER-786249"
}
```

### Backend Logic Required

1. **Get box details:**

   ```sql
   SELECT box_id, advance_shipping_notice as asn_no, store, status, purpose, to_no
   FROM tabSortBox
   WHERE box_id = ?
   ```

   **⚠️ CRITICAL:** Use `advance_shipping_notice` (not `asn_no`) in SQL queries.

2. **Check if store is warehouse:**

   ```sql
   SELECT warehouse_type
   FROM tabwarehouse
   WHERE code = ? -- box.store
   ```

   - **MANDATORY:** Use ONLY `warehouse_type = 'Warehouse'` (no hardcoded values)
   - If `warehouse_type = 'Warehouse'` → Create putaway task
   - If `warehouse_type != 'Warehouse'` → Just close box (no putaway task)

3. **If warehouse box, create putaway task:**

   ```sql
   -- Generate putaway task ID (e.g., PUT-20260101-0001)
   INSERT INTO tabPutawayTask (
     title,                    -- putaway_task ID (e.g., PUT-20260101-0001)
     box_id,                   -- The closed box ID
     advance_shipping_notice,  -- ASN from box (use advance_shipping_notice column)
     status,                   -- "Open"
     source_type,              -- "Box"
     created_on,
     created_by
   ) VALUES (?, ?, ?, ?, ?, NOW(), ?)
   ```

4. **Get items from box and create putaway task lines:**

   ```sql
   -- Get items from tabWmsScanEvent (not tabScannedItems)
   SELECT item_code, SUM(qty) as total_qty, carton_id, box_id
   FROM tabWmsScanEvent
   WHERE box_id = ?
     AND event_type = 'SORT_TO_BOX'
     AND item_code IS NOT NULL
   GROUP BY item_code, carton_id, box_id
   HAVING total_qty > 0
   ```

5. **Create putaway task lines:**
   ```sql
   INSERT INTO tabPutawayLine (
     parent_title,              -- putaway_task ID
     item_code,
     carton_id,                -- Use box_id as carton_id for warehouse boxes
     qty,
     rack,                     -- NULL initially (will be set when location scanned)
     bin                       -- NULL initially (will be set when location scanned)
   ) VALUES (?, ?, ?, ?, NULL, NULL)
   ```

### Response Format

**Success (Warehouse Box - Putaway Task Created):**

```json
{
  "ok": true,
  "box_id": "BOX-WHMAIN-306647",
  "status": "Closed",
  "putaway_task": "PUT-20260101-0001",
  "message": "Box closed successfully. Putaway task created."
}
```

**Success (Non-Warehouse Box - No Putaway Task):**

```json
{
  "ok": true,
  "box_id": "BOX-STORE-002-12345",
  "status": "Closed",
  "message": "Box closed successfully"
}
```

---

## 2. API: `GET /api/putaway/tasks` - List Putaway Tasks

### Current Issue

- Mobile app loads putaway tasks from local database
- Should read from backend API instead

### Required Behavior

**Return all open putaway tasks from backend database**

### Request Format

```json
GET /api/putaway/tasks?status=Open&advance_shipping_notice=ASN-12225
Content-Type: application/json
Authorization: Bearer <token>
```

**Query Parameters:**

- `status` (optional): Filter by status (e.g., "Open", "In Progress", "Completed")
- `advance_shipping_notice` (optional): Filter by ASN
- `source_type` (optional): Filter by source type (e.g., "Box", "TransferCarton")

### Backend Logic Required

```sql
SELECT
  pt.title as putaway_task,
  pt.box_id,
  pt.tc_id,
  pt.advance_shipping_notice as asn_no,
  pt.rack,
  pt.bin,
  pt.status,
  pt.source_type,
  pt.created_on,
  pt.created_by,
  COUNT(pl.id) as lines_count
FROM tabPutawayTask pt
LEFT JOIN tabPutawayLine pl ON pl.parent_title = pt.title
WHERE pt.status = 'Open'  -- or filter by query parameter
  AND (pt.advance_shipping_notice = ? OR ? IS NULL)  -- ASN filter
  AND (pt.source_type = ? OR ? IS NULL)  -- source_type filter
GROUP BY pt.title, pt.box_id, pt.tc_id, pt.advance_shipping_notice, pt.rack, pt.bin, pt.status, pt.source_type, pt.created_on, pt.created_by
ORDER BY pt.created_on DESC
```

**⚠️ CRITICAL:** Use `advance_shipping_notice` (not `asn_no`) in SQL queries.

### Response Format

```json
{
  "ok": true,
  "data": [
    {
      "putaway_task": "PUT-20260101-0001",
      "box_id": "BOX-WHMAIN-306647",
      "tc_id": null,
      "asn_no": "ASN-12225",
      "rack": null,
      "bin": null,
      "status": "Open",
      "source_type": "Box",
      "created_on": "2026-01-01T10:26:00Z",
      "created_by": "USER-786249",
      "lines_count": 2,
      "items": [
        {
          "item_code": "SKU-HAT-301-BLU-OS",
          "carton_id": "BOX-WHMAIN-306647",
          "qty": 75.0
        },
        {
          "item_code": "SKU-SHOE-202-RED-42",
          "carton_id": "BOX-WHMAIN-306647",
          "qty": 50.0
        }
      ]
    }
  ]
}
```

---

## 3. API: `/api/putaway/scan-transfer-carton` - Update Location and Status

### Current Issue

- Mobile app creates/updates putaway task locally
- Should update backend putaway task with location and update stock

### Required Behavior

**When location is scanned:**

1. Update putaway task with location (rack, bin)
2. Update putaway task status to "In Progress"
3. Update stock at location (if applicable)

### Request Format

```json
POST /api/putaway/scan-transfer-carton
Content-Type: application/json
Authorization: Bearer <token>

{
  "putaway_task": "PUT-20260101-0001",
  "rack": "A1-R01-L1-B1",
  "bin": "B1",
  "user_id": "USER-786249"
}
```

**OR** (if putaway task not known, use box_id):

```json
{
  "box_id": "BOX-WHMAIN-306647",
  "rack": "A1-R01-L1-B1",
  "bin": "B1",
  "user_id": "USER-786249"
}
```

### Backend Logic Required

1. **If `putaway_task` provided:**

   - Get putaway task from database
   - Update `rack` and `bin` fields
   - Update `status` to "In Progress"
   - Update `updated_on` timestamp

2. **If `box_id` provided (and no `putaway_task`):**

   - Find putaway task by `box_id`:
     ```sql
     SELECT title as putaway_task
     FROM tabPutawayTask
     WHERE box_id = ?
       AND status = 'Open'
     ORDER BY created_on DESC
     LIMIT 1
     ```
   - If found, update with location
   - If not found, return error: "Putaway task not found for this box"

3. **Update putaway task:**

   ```sql
   UPDATE tabPutawayTask
   SET rack = ?,
       bin = ?,
       status = 'In Progress',
       updated_on = NOW()
   WHERE title = ?
   ```

4. **Update putaway task lines with location:**

   ```sql
   UPDATE tabPutawayLine
   SET rack = ?,
       bin = ?
   WHERE parent_title = ?
   ```

5. **Update stock at location (if required):**
   - This depends on your stock management logic
   - May need to update `tabStockLedger` or similar table
   - Stock should be updated when putaway is **completed**, not when location is scanned

### Response Format

```json
{
  "ok": true,
  "message": "Putaway task updated with location successfully",
  "data": {
    "putaway_task": "PUT-20260101-0001",
    "box_id": "BOX-WHMAIN-306647",
    "asn_no": "ASN-12225",
    "status": "In Progress",
    "rack": "A1-R01-L1-B1",
    "bin": "B1",
    "items_count": 2,
    "items": [
      {
        "item_code": "SKU-HAT-301-BLU-OS",
        "carton_id": "BOX-WHMAIN-306647",
        "qty": 75.0,
        "rack": "A1-R01-L1-B1",
        "bin": "B1"
      },
      {
        "item_code": "SKU-SHOE-202-RED-42",
        "carton_id": "BOX-WHMAIN-306647",
        "qty": 50.0,
        "rack": "A1-R01-L1-B1",
        "bin": "B1"
      }
    ]
  }
}
```

---

## 4. API: `/api/putaway/complete` - Complete Putaway and Update Stock

### Current Issue

- Mobile app completes putaway locally
- Backend should update stock when putaway is completed

### Required Behavior

**When putaway is completed:**

1. Update putaway task status to "Completed"
2. Update stock at location (add items to location stock)
3. Return stock update details

### Request Format

```json
POST /api/putaway/complete
Content-Type: application/json
Authorization: Bearer <token>

{
  "putaway_task": "PUT-20260101-0001",
  "performed_by": "USER-786249",
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 75.00,
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

**⚠️ IMPORTANT:** Do NOT include `box_id` in items array. Backend gets `box_id` from `putaway_task` record.

### Backend Logic Required

1. **Get putaway task:**

   ```sql
   SELECT title as putaway_task, box_id, advance_shipping_notice as asn_no, rack, bin, status
   FROM tabPutawayTask
   WHERE title = ?
   ```

2. **Validate putaway task:**

   - Check if task exists
   - Check if task is not already completed
   - Check if location (rack, bin) is set

3. **Update putaway task status:**

   ```sql
   UPDATE tabPutawayTask
   SET status = 'Completed',
       completed_on = NOW(),
       performed_by = ?
   WHERE title = ?
   ```

4. **Update stock at location:**

   ```sql
   -- For each item, update stock at target location
   -- Example (adjust based on your stock table structure):
   UPDATE tabStockLedger
   SET qty = qty + ?,
       updated_on = NOW()
   WHERE item_code = ?
     AND bin_location = ?
   ```

   **OR** if stock doesn't exist, insert:

   ```sql
   INSERT INTO tabStockLedger (
     item_code,
     warehouse,
     bin_location,
     qty,
     updated_on
   ) VALUES (?, ?, ?, ?, NOW())
   ```

5. **Return stock updates:**
   - Calculate qty_before and qty_after for each item
   - Return in response

### Response Format

```json
{
  "ok": true,
  "message": "Putaway completed successfully",
  "data": {
    "putaway_task": "PUT-20260101-0001",
    "status": "Completed",
    "stock_updated": true,
    "warehouse": "Main Warehouse",
    "items_updated": 2,
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
    ]
  }
}
```

---

## 5. Database Schema Requirements

### Table: `tabPutawayTask`

```sql
CREATE TABLE tabPutawayTask (
  title VARCHAR(50) PRIMARY KEY,              -- putaway_task ID (e.g., PUT-20260101-0001)
  box_id VARCHAR(50),                        -- Box ID (for warehouse boxes)
  tc_id VARCHAR(50),                         -- Transfer Carton ID (for TCs)
  advance_shipping_notice VARCHAR(50),        -- ASN number (use this column, not asn_no)
  rack VARCHAR(100),                         -- Location ID (set when location scanned)
  bin VARCHAR(50),                           -- Bin ID (set when location scanned)
  status VARCHAR(20),                         -- Open, In Progress, Completed
  source_type VARCHAR(20),                   -- Box, TransferCarton
  created_on DATETIME,
  created_by VARCHAR(50),
  updated_on DATETIME,
  completed_on DATETIME,
  performed_by VARCHAR(50),
  INDEX idx_box_id (box_id),
  INDEX idx_tc_id (tc_id),
  INDEX idx_advance_shipping_notice (advance_shipping_notice),
  INDEX idx_status (status)
);
```

**⚠️ CRITICAL:** Use `advance_shipping_notice` column (not `asn_no`).

### Table: `tabPutawayLine`

```sql
CREATE TABLE tabPutawayLine (
  id INT AUTO_INCREMENT PRIMARY KEY,
  parent_title VARCHAR(50),                   -- putaway_task ID (foreign key to tabPutawayTask.title)
  item_code VARCHAR(50),
  carton_id VARCHAR(50),                     -- Use box_id as carton_id for warehouse boxes
  qty DECIMAL(10, 2),
  rack VARCHAR(100),                         -- Location ID (set when location scanned)
  bin VARCHAR(50),                           -- Bin ID (set when location scanned)
  INDEX idx_parent_title (parent_title),
  INDEX idx_item_code (item_code)
);
```

**⚠️ CRITICAL:** Use `carton_id` column (not `box_id`). For warehouse boxes, use `box_id` value as `carton_id`.

### Table: `tabWmsScanEvent` (for getting items from box)

```sql
-- Items are stored in tabWmsScanEvent with event_type = 'SORT_TO_BOX'
SELECT item_code, SUM(qty) as total_qty, carton_id, box_id
FROM tabWmsScanEvent
WHERE box_id = ?
  AND event_type = 'SORT_TO_BOX'
  AND item_code IS NOT NULL
GROUP BY item_code, carton_id, box_id
HAVING total_qty > 0
```

---

## 6. Summary of Backend Changes Required

### Priority 1: `/api/boxes/close` - Create Putaway Task

**Current:** Box is closed, but putaway task is NOT created

**Required:**

1. ✅ Check if box store has `warehouse_type = 'Warehouse'`
2. ✅ If yes, create putaway task automatically
3. ✅ Get items from `tabWmsScanEvent` (event_type = 'SORT_TO_BOX')
4. ✅ Create putaway task lines in `tabPutawayLine`
5. ✅ Return `putaway_task` in response

### Priority 2: `GET /api/putaway/tasks` - List Putaway Tasks

**Current:** Mobile app reads from local database

**Required:**

1. ✅ Return all open putaway tasks from `tabPutawayTask`
2. ✅ Include items from `tabPutawayLine`
3. ✅ Support filtering by status, ASN, source_type
4. ✅ Mobile app will read from this API instead of local database

### Priority 3: `/api/putaway/scan-transfer-carton` - Update Location

**Current:** Mobile app creates/updates locally

**Required:**

1. ✅ Update putaway task with location (rack, bin)
2. ✅ Update putaway task status to "In Progress"
3. ✅ Update putaway task lines with location
4. ✅ Return updated putaway task with items

### Priority 4: `/api/putaway/complete` - Complete and Update Stock

**Current:** Mobile app completes locally

**Required:**

1. ✅ Update putaway task status to "Completed"
2. ✅ Update stock at location (add items to `tabStockLedger`)
3. ✅ Return stock update details (qty_before, qty_after)

---

## 7. Mobile App Changes Required

1. **Update `loadSealedTCs` to read from backend:**

   - Call `GET /api/putaway/tasks?status=Open`
   - Display putaway tasks from backend (not local database)

2. **Remove local putaway task creation:**

   - Don't create putaway tasks locally
   - Rely on backend to create when box is closed

3. **Update location scan:**

   - Call `/api/putaway/scan-transfer-carton` with `putaway_task` or `box_id`
   - Backend will update status and location

4. **Update complete putaway:**
   - Call `/api/putaway/complete` with `putaway_task` and items
   - Backend will update stock and status

---

## 8. Testing Checklist

- [ ] Close warehouse box → Putaway task created in backend
- [ ] Close non-warehouse box → No putaway task created
- [ ] `GET /api/putaway/tasks` → Returns open putaway tasks
- [ ] Scan location → Putaway task updated with location, status = "In Progress"
- [ ] Complete putaway → Stock updated, status = "Completed"
- [ ] Verify warehouse detection uses ONLY `warehouse_type = 'Warehouse'`
- [ ] Verify no hardcoded warehouse values

---

## 9. Critical Notes

1. **Column Names:**

   - Use `advance_shipping_notice` (not `asn_no`) in SQL queries
   - Use `carton_id` (not `box_id`) in `tabPutawayLine` table
   - For warehouse boxes, use `box_id` value as `carton_id`

2. **Warehouse Detection:**

   - **MANDATORY:** Use ONLY `tabwarehouse.warehouse_type = 'Warehouse'`
   - **DO NOT** use hardcoded values like "WH-", "WAREHOUSE", etc.
   - **DO NOT** use code pattern matching

3. **Items Source:**

   - Get items from `tabWmsScanEvent` with `event_type = 'SORT_TO_BOX'`
   - **NOT** from `tabScannedItems`

4. **Response Format:**
   - Use `"ok": true/false` (not `"success": true/false`)
   - Putaway task ID in response: `response.putaway_task` (not nested in `data`)
