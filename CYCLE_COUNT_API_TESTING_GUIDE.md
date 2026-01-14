# Cycle Count API Testing Guide

## 🔍 Issues Found

1. **Expected qty = 0.00** - Task lines should have `expected_qty` from stock ledger
2. **Empty line (id 329)** - One line created without `item_code`
3. **actual_qty = NULL** - Scanned items not updating in database
4. **⚠️ No backend line match** - `GET /api/cycle-count/{title}` not returning lines properly

---

## 📋 Correct APIs to Test

### ✅ **1. Get Task Details (GET) - Check if lines are returned**

**URL:** `GET /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q`

**Query Parameters (Optional):**
- `carton_id` - Filter by carton (e.g., `?carton_id=CTN-433`)
- `counted_by` - Filter by user (e.g., `?counted_by=USER-001`)

**Full URL Examples:**
```
GET /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q
GET /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q?carton_id=CTN-433
GET /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q?counted_by=USER-001
GET /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q?carton_id=CTN-433&counted_by=USER-001
```

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Expected Response:**
```json
{
  "title": "CC-A1-R01-L1-B1-MK82UT3Q",
  "status": "In Progress",
  "warehouse": "WH-001",
  "bin_code": "A1-R01-L1-B1",
  "count_type": "Directed",
  "count_date": "2025-01-27",
  "lines": [
    {
      "id": 329,  // ✅ REQUIRED: Database ID (must match tabcyclecountline.id)
      "line_id": "LINE-329",  // Optional: String format
      "item_code": null,  // ⚠️ Empty line - why was this created?
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 0.00,  // ⚠️ Should NOT be 0 (should come from stock ledger)
      "actual_qty": null,
      "carton_id": null,
      "counted_by": null
    },
    {
      "id": 330,  // ✅ REQUIRED: Database ID - Mobile app uses this as lineId
      "line_id": "LINE-330",
      "item_code": "SKU-JACKET-201-BLK-L",  // ✅ REQUIRED: For matching
      "barcode": "SKU-JACKET-201-BLK-L",  // Optional: Also for matching
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 10.00,  // ⚠️ Should come from stock ledger (NOT 0)
      "actual_qty": null,  // Will be set when POST /count is called
      "carton_id": "CTN-433",
      "counted_by": null
    },
    {
      "id": 331,
      "line_id": "LINE-331",
      "item_code": "SKU-HAT-301-BLU-OS",
      "barcode": "SKU-HAT-301-BLU-OS",
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 15.00,  // ⚠️ Should NOT be 0
      "actual_qty": null,
      "carton_id": "CTN-433",
      "counted_by": null
    }
  ]
}
```

**⚠️ CRITICAL:** If this endpoint doesn't return `lines` array or lines don't have `id` field, mobile app **CANNOT match items**!

**Check:**
- ✅ Does response have `lines` array? (Should have at least 3 items based on your database)
- ✅ Do lines have `id` field? (Must match database IDs: 329, 330, 331)
- ✅ Do lines have `item_code` matching scanned items? (SKU-JACKET-201-BLK-L, SKU-HAT-301-BLU-OS)
- ❌ Is `expected_qty` = 0.00? (Should come from stock ledger, NOT 0)

---

### ✅ **2. Submit Count (POST) - Update actual_qty**

**⚠️ IMPORTANT:** This is **POST**, NOT GET!

**URL:** `POST /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q/count`

**Headers:**
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
      "id": 330,  // Optional: Sequential ID (for reference)
      "lineId": 330,  // ✅ REQUIRED: Must match database id field from GET response
      "line_id": "LINE-330",  // Optional: String format
      "item_code": "SKU-JACKET-201-BLK-L",  // ✅ REQUIRED: For matching if lineId doesn't match
      "barcode": "SKU-JACKET-201-BLK-L",  // Optional: Also accepted for matching
      "carton_id": "CTN-433",  // Optional: Carton ID
      "actual_qty": 1,  // ✅ REQUIRED: Counted quantity
      "counted_qty": 1,  // Also send counted_qty (duplicate for compatibility)
      "bin_location": "A1-R01-L1-B1",  // Help backend match by bin + item
      "expected_qty": 0,  // Optional: Expected quantity (will use 0 if not set)
      "discrepancy_reason": null,  // Optional: Reason for variance
      "reason_code": null,  // Optional: Alternative field
      "notes": null  // Optional: Alternative field
    },
    {
      "id": 331,
      "lineId": 331,  // ✅ REQUIRED: Must match database id
      "item_code": "SKU-HAT-301-BLU-OS",
      "actual_qty": 1,
      "counted_qty": 1,
      "carton_id": "CTN-433",
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 0
    }
  ]
}
```

**Expected Response:**
```json
{
  "ok": true,
  "message": "Successfully updated 2 lines",
  "data": {
    "title": "CC-A1-R01-L1-B1-MK82UT3Q",
    "updated_count": 2
  }
}
```

**After API call, verify database:**
```sql
SELECT id, item_code, expected_qty, actual_qty, counted_by, carton_id
FROM tabcyclecountline
WHERE parent_title = 'CC-A1-R01-L1-B1-MK82UT3Q'
ORDER BY id;
```

**Expected Results:**
- id 330: `actual_qty = 1`, `counted_by = USER-001` ✅
- id 331: `actual_qty = 1`, `counted_by = USER-001` ✅

---

### ✅ **3. Start Cycle Count (POST)**

**URL:** `POST /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q/start`

**Request Body:**
```json
{
  "started_by": "USER-001"
}
```

**Expected Response:**
```json
{
  "ok": true,
  "message": "Cycle count task started successfully",
  "data": {
    "title": "CC-A1-R01-L1-B1-MK82UT3Q",
    "status": "In Progress",
    "started_by": "USER-001",
    "started_on": "2025-01-27T12:00:00.000Z"
  }
}
```

**⚠️ Check:** This should NOT create any empty lines. If line 329 (empty item_code) is created here, that's the issue.

---

### ✅ **4. Get Cycle Count List (GET)**

**URL:** `GET /api/cycle-count`

**Query Parameters (Optional):**
- `status` - Filter by status (e.g., `?status=In Progress`)
- `warehouse` - Filter by warehouse (e.g., `?warehouse=WH-001`)
- `zone` - Filter by zone (e.g., `?zone=ZONE-A`)
- `count_type` - Filter by type (e.g., `?count_type=Directed`)

**Example:** `GET /api/cycle-count?status=In Progress&warehouse=WH-001`

**Expected Response:**
```json
[
  {
    "title": "CC-A1-R01-L1-B1-MK82UT3Q",
    "status": "In Progress",
    "warehouse": "WH-001",
    "bin_code": "A1-R01-L1-B1",
    "count_type": "Directed",
    "total_items": 3,
    "counted_items": 0,
    "items_with_discrepancy": 0
  }
]
```

---

### ✅ **5. Submit Task (POST)**

**URL:** `POST /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q/submit`

**Request Body:**
```json
{}
```

**Expected Response:**
```json
{
  "ok": true,
  "message": "Cycle count task submitted successfully",
  "data": {
    "title": "CC-A1-R01-L1-B1-MK82UT3Q",
    "status": "Submitted"
  }
}
```

---

### ✅ **6. Complete Task (POST)**

**URL:** `POST /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q/complete`

**Request Body:**
```json
{}
```

**Expected Response:**
```json
{
  "ok": true,
  "message": "Cycle count task completed successfully",
  "data": {
    "title": "CC-A1-R01-L1-B1-MK82UT3Q",
    "status": "Completed",
    "stock_updated": true
  }
}
```

---

## 🔴 Current Issues Diagnosis

### Issue 1: "No backend line match found" Error

**Error:** `⚠️ No backend line match found for SKU-JACKET-201-BLK-L`

**Root Cause:** When mobile app calls `GET /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q`, the response either:
1. Doesn't include `lines` array
2. `lines` array is empty
3. Lines don't have `id` field (required for `lineId` matching)
4. Lines have different `item_code` format (case sensitivity, whitespace)

**Test:**
```bash
GET /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q
```

**Check Response:**
- Does it have `lines` array? ✅/❌
- Are lines present? (Should be 3 based on your database) ✅/❌
- Do lines have `id` field? (Should be: 329, 330, 331) ✅/❌
- Do lines have `item_code` matching: `SKU-JACKET-201-BLK-L` and `SKU-HAT-301-BLU-OS`? ✅/❌

**If lines are missing or don't have `id`:**
- Backend GET endpoint needs to return lines from `tabcyclecountline` table
- Must include `id` field (primary key from database)
- Must include `item_code` field (for matching)

---

### Issue 2: Expected Qty = 0.00

**Root Cause:** Task creation doesn't populate `expected_qty` from stock ledger.

**Fix:** When creating task (either via `POST /api/cycle-count` or backend/desktop), backend should:
1. Query stock ledger: 
   ```sql
   SELECT item_code, qty 
   FROM stock_ledger 
   WHERE bin_location = 'A1-R01-L1-B1' AND qty > 0
   ```
2. Set `expected_qty` when creating task lines:
   ```sql
   INSERT INTO tabcyclecountline (parent_title, item_code, bin_location, expected_qty)
   VALUES ('CC-A1-R01-L1-B1-MK82UT3Q', 'SKU-JACKET-201-BLK-L', 'A1-R01-L1-B1', 10)
   ```

**Test Task Creation API (if available):**
```bash
POST /api/cycle-count
{
  "bin_code": "A1-R01-L1-B1",
  "warehouse": "WH-001",
  "count_type": "Directed",
  "count_date": "2025-01-27",
  "created_by": "USER-001"
}
```

**Then check database:**
```sql
SELECT item_code, expected_qty 
FROM tabcyclecountline 
WHERE parent_title = 'CC-A1-R01-L1-B1-MK82UT3Q';
```

**Expected:** `expected_qty` should NOT be 0.00 ✅

---

### Issue 3: Empty Line (id 329)

**Root Cause:** Either:
1. Backend task creation creates placeholder line
2. Backend `/start` API creates empty line
3. Backend `/count` API creates new line when item doesn't match

**Check:**
1. **When was line 329 created?**
   ```sql
   SELECT id, parent_title, item_code, created_on, updated_on
   FROM tabcyclecountline
   WHERE id = 329;
   ```

2. **Is it created before or after mobile app starts?**
   - If before: Task creation issue (backend)
   - If after: `/start` or `/count` API issue (backend)

3. **Check backend logs when task was created/started**

**Fix:** Backend should NOT create placeholder/empty lines. Only create lines:
- When items are scanned (for ad-hoc counts)
- When task is created with expected items from stock ledger (for directed counts)

---

### Issue 4: Actual Qty = NULL

**Root Cause:** `POST /api/cycle-count/{title}/count` either:
1. Not called yet (items still pending sync)
2. Called but failed to update database
3. Called with wrong `lineId` (couldn't match line)
4. Backend update failed silently

**Check Mobile App Logs:**
Look for:
- `📤 Submitting X lines to backend for task...`
- `✅ Successfully synced session...`
- `❌ API call failed...`

**Check Backend Logs:**
Look for:
- `POST /api/cycle-count/{title}/count` requests
- Database update queries
- Any errors during update

**Test Manually:**
```bash
POST /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q/count
{
  "counted_by": "USER-001",
  "lines": [
    {
      "lineId": 330,  // Must match database id
      "item_code": "SKU-JACKET-201-BLK-L",
      "actual_qty": 1,
      "counted_qty": 1,
      "carton_id": "CTN-433",
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 0
    }
  ]
}
```

**Then verify:**
```sql
SELECT actual_qty, counted_by 
FROM tabcyclecountline 
WHERE id = 330;
```

Should show: `actual_qty = 1`, `counted_by = USER-001` ✅

---

## 📝 Postman Collection Updates

### Fix 1: Change GET to POST for /count endpoint

In Postman, change:
- ❌ `GET /api/cycle-count/{title}/count` (Wrong - this endpoint doesn't exist)
- ✅ `POST /api/cycle-count/{title}/count` (Correct - this updates counts)

### Fix 2: Use correct GET endpoint to fetch task lines

Use:
- ✅ `GET /api/cycle-count/{title}` (Correct - gets task details with lines)

NOT:
- ❌ `GET /api/cycle-count/{title}/count` (Wrong - /count is POST endpoint)

---

## ✅ Correct Workflow Order

1. **Get Task:** `GET /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q`
   - Verify lines are returned with `id` field
   - Verify `expected_qty` is set (should NOT be 0)

2. **Start Task:** `POST /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q/start`
   - Should NOT create empty lines

3. **Submit Counts (Multiple Times):** `POST /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q/count`
   - Updates `actual_qty` for scanned items
   - Can be called multiple times as items are scanned

4. **Submit Task:** `POST /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q/submit`
   - Marks task as ready for completion

5. **Complete Task:** `POST /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q/complete`
   - Finalizes task and updates stock

---

## 🔧 Backend Fixes Required

### Fix 1: GET /api/cycle-count/{title} Must Return Lines

```javascript
// Backend code should:
GET /api/cycle-count/{title} {
  // Query database
  const task = await db.query(`
    SELECT * FROM tabcyclecounttask WHERE title = ?
  `, [title]);
  
  // ✅ CRITICAL: Must return lines from tabcyclecountline
  const lines = await db.query(`
    SELECT 
      id,  // ✅ REQUIRED: Database ID (used as lineId)
      item_code,  // ✅ REQUIRED: For matching
      barcode,  // Optional: Also for matching
      bin_location,
      expected_qty,  // Should come from stock ledger (NOT 0)
      actual_qty,
      carton_id,
      counted_by
    FROM tabcyclecountline
    WHERE parent_title = ?
  `, [title]);
  
  return {
    ...task,
    lines: lines  // ✅ MUST include lines array
  };
}
```

### Fix 2: Task Creation Must Set Expected Qty from Stock Ledger

```javascript
// When creating task, populate expected_qty from stock ledger:
POST /api/cycle-count {
  // For each bin location, query stock ledger
  const stockItems = await db.query(`
    SELECT item_code, qty
    FROM stock_ledger
    WHERE bin_location = ? AND qty > 0
  `, [bin_location]);
  
  // Create lines with expected_qty from stock
  for (const item of stockItems) {
    await db.query(`
      INSERT INTO tabcyclecountline (
        parent_title, item_code, bin_location, expected_qty
      ) VALUES (?, ?, ?, ?)
    `, [title, item.item_code, bin_location, item.qty]);  // ✅ Use qty from stock ledger
  }
}
```

---

## 📊 Testing Checklist

### GET /api/cycle-count/{title}
- [ ] Returns `lines` array
- [ ] Lines have `id` field (database ID)
- [ ] Lines have `item_code` field
- [ ] `expected_qty` is NOT 0 (comes from stock ledger)
- [ ] Lines match scanned items (SKU-JACKET-201-BLK-L, SKU-HAT-301-BLU-OS)

### POST /api/cycle-count/{title}/count
- [ ] Updates `actual_qty` in database
- [ ] Updates `counted_by` in database
- [ ] Matches lines by `lineId` (database id)
- [ ] Falls back to matching by `item_code` if `lineId` doesn't match
- [ ] Returns success response

### POST /api/cycle-count/{title}/start
- [ ] Does NOT create empty lines
- [ ] Only updates task status to "In Progress"

---

**Document Version:** 1.0  
**Last Updated:** 2025-01-27  
**Issue:** Expected qty = 0.00, Empty line created, Actual qty = NULL, No backend line match
