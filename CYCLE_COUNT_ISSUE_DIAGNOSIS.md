# Cycle Count Issue Diagnosis

## 🔍 Issues Identified

Based on your screenshot showing database results:
1. **Expected qty is 0.00** for all items (should have values from stock ledger)
2. **One extra line created** with empty `item_code` (id 329)
3. **actual_qty is NULL** for scanned items (id 330, 331)

---

## 📋 APIs Used by Mobile App

### ✅ **Task Creation API (if backend supports it)**
**URL:** `POST /api/cycle-count`

**Request Body:**
```json
{
  "title": "CC-A1-R01-L1-B1-MK6SK143",  // Optional - backend may generate
  "bin_code": "A1-R01-L1-B1",
  "bin_id": "BIN-001",
  "warehouse": "WH-001",
  "warehouse_id": "WH-001",  // Also accepted
  "count_type": "Directed",  // or "Ad-hoc"
  "count_date": "2025-01-27",  // Format: YYYY-MM-DD
  "is_blind_count": false,
  "created_by": "USER-001",
  "lines": [
    {
      "item_code": "SKU-JACKET-201-BLK-L",
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 10  // ⚠️ Should come from stock ledger
    },
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 15  // ⚠️ Should come from stock ledger
    }
  ]
}
```

**⚠️ ISSUE:** If `expected_qty` is 0.00, this API might not be:
   - Querying stock ledger to get expected quantities
   - Accepting `expected_qty` in request body
   - Setting `expected_qty` from lines array

**Note:** Mobile app has this API but doesn't usually call it. Tasks are typically created by backend/desktop.

---

### Mobile app workflow APIs:

### 1. Start Cycle Count Task
**URL:** `POST /api/cycle-count/{title}/start`

**Example:** `POST /api/cycle-count/CC-A1-R01-L1-B1-MK6SK143/start`

**Request Body:**
```json
{
  "started_by": "USER-001"
}
```

**When:** Called when user clicks "Start Count" button
**Purpose:** Marks task as "In Progress" - does NOT create lines

---

### 2. Submit Count Lines (THIS IS WHERE ACTUAL_QTY SHOULD BE UPDATED)
**URL:** `POST /api/cycle-count/{title}/count`

**Example:** `POST /api/cycle-count/CC-A1-R01-L1-B1-MK6SK143/count`

**Request Body:**
```json
{
  "counted_by": "USER-001",
  "lines": [
    {
      "id": 1,
      "lineId": 330,
      "line_id": "LINE-330",
      "item_code": "SKU-JACKET-201-BLK-L",
      "barcode": "SKU-JACKET-201-BLK-L",
      "carton_id": "CTN-433",
      "actual_qty": 1,
      "counted_qty": 1,
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 0,
      "discrepancy_reason": null
    },
    {
      "id": 2,
      "lineId": 331,
      "line_id": "LINE-331",
      "item_code": "SKU-HAT-301-BLU-OS",
      "barcode": "SKU-HAT-301-BLU-OS",
      "carton_id": "CTN-433",
      "actual_qty": 1,
      "counted_qty": 1,
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 0,
      "discrepancy_reason": null
    }
  ]
}
```

**When:** Called during sync (when device is online) or when user manually syncs
**Purpose:** Updates `actual_qty` and `counted_by` in database
**⚠️ ISSUE:** If `actual_qty` is NULL, this API was either:
   - Not called yet (still pending sync)
   - Called but failed to update database
   - Called with wrong `lineId` and couldn't match existing lines

---

### 3. Get Cycle Count Details
**URL:** `GET /api/cycle-count/{title}`

**Query Parameters:**
- `carton_id` (optional) - Filter by carton
- `counted_by` (optional) - Filter by user

**Example:** `GET /api/cycle-count/CC-A1-R01-L1-B1-MK6SK143?carton_id=CTN-433&counted_by=USER-001`

**Response:**
```json
{
  "title": "CC-A1-R01-L1-B1-MK6SK143",
  "status": "In Progress",
  "lines": [
    {
      "id": 330,
      "item_code": "SKU-JACKET-201-BLK-L",
      "expected_qty": 0.00,  // ⚠️ This should NOT be 0
      "actual_qty": null,    // ⚠️ This should have value after scan
      "bin_location": "A1-R01-L1-B1",
      "carton_id": "CTN-433"
    }
  ]
}
```

**Purpose:** Fetches task details including lines - used to get `lineId` for matching

---

### 4. Submit Task
**URL:** `POST /api/cycle-count/{title}/submit`

**Request Body:** `{}`

**When:** Called when user clicks "Submit Bin" button
**Purpose:** Marks task as ready for completion

---

### 5. Complete Task
**URL:** `POST /api/cycle-count/{title}/complete`

**Request Body:** `{}`

**When:** Called after task is submitted
**Purpose:** Finalizes task and updates stock

---

## 🔴 Issue Analysis

### Issue 1: Expected Qty = 0.00
**Root Cause:** **BACKEND ISSUE**
- The mobile app does NOT set `expected_qty`
- `expected_qty` should be set when the task is **created on the backend/desktop**
- The task creation should populate `expected_qty` from the stock ledger (bin location + item_code)
- **Fix:** Backend task creation logic needs to set `expected_qty` from stock ledger

**Test API (if backend has task creation endpoint):**
```
POST /api/cycle-count/create
{
  "title": "CC-A1-R01-L1-B1-MK6SK143",
  "bin_location": "A1-R01-L1-B1",
  "items": [
    {
      "item_code": "SKU-JACKET-201-BLK-L",
      "expected_qty": 10  // Should come from stock ledger
    }
  ]
}
```

---

### Issue 2: Extra Line with Empty Item Code (id 329)
**Root Cause:** **MOST LIKELY BACKEND ISSUE**

**Possible causes:**
1. **Backend creates placeholder line** when task is started without items
2. **Mobile app creates session locally** with empty line (check mobile database)
3. **Backend creates line** when `/count` API receives item without matching existing line

**To diagnose:**
- Check if mobile app's local database has this empty line
- Check backend logs when task was started
- Check if backend creates a default/placeholder line when starting task

**Test:** Check if line 329 exists before mobile app starts:
```sql
SELECT * FROM tabcyclecountline 
WHERE parent_title = 'CC-A1-R01-L1-B1-MK82UT3Q' 
ORDER BY id;
```

---

### Issue 3: Actual Qty = NULL (Items Scanned but Not Saved)
**Root Cause:** **NEEDS INVESTIGATION**

**Possible causes:**
1. **Sync not happened yet** - Items are saved locally, waiting for sync
2. **Sync failed** - `POST /api/cycle-count/{title}/count` failed
3. **Backend couldn't match lines** - Wrong `lineId` or `item_code` mismatch
4. **Backend update failed** - API returned success but database update failed

**To diagnose:**
- Check mobile app logs for sync status
- Check if `/count` API was called
- Check backend logs for update errors
- Verify `lineId` matches database IDs (330, 331)

**Test API manually:**
```bash
POST /api/cycle-count/CC-A1-R01-L1-B1-MK6SK143/count
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

---

## 🧪 Testing APIs

### Test 1: Get Task Details (Check if Lines are Returned)
```
GET /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q
```

**⚠️ CRITICAL:** This endpoint MUST return lines array, otherwise mobile app can't match items!

**Expected Response:**
```json
{
  "title": "CC-A1-R01-L1-B1-MK82UT3Q",
  "status": "In Progress",
  "lines": [
    {
      "id": 329,  // ✅ Database ID - required for lineId matching
      "item_code": null,  // ⚠️ Empty line - why was this created?
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 0.00,
      "actual_qty": null,
      "carton_id": null
    },
    {
      "id": 330,  // ✅ Database ID - required for lineId matching
      "item_code": "SKU-JACKET-201-BLK-L",
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 0.00,  // ⚠️ Should NOT be 0 (should come from stock ledger)
      "actual_qty": null,
      "carton_id": "CTN-433"
    },
    {
      "id": 331,  // ✅ Database ID - required for lineId matching
      "item_code": "SKU-HAT-301-BLU-OS",
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 0.00,  // ⚠️ Should NOT be 0
      "actual_qty": null,
      "carton_id": "CTN-433"
    }
  ]
}
```

**⚠️ ISSUE:** If this endpoint returns empty `lines` array or doesn't return `lines` at all, mobile app can't match items!

**Check:**
1. Does response have `lines` array? ✅/❌
2. Do lines have `id` field? ✅/❌
3. Do lines have `item_code` matching scanned items? ✅/❌

**If lines are missing or empty:**
- Backend GET endpoint needs to return lines from `tabcyclecountline` table
- Must include `id` field (database ID) for `lineId` matching

---

### Test 2: Submit Count (Check Actual Qty Update)
**⚠️ IMPORTANT:** This is **POST**, NOT GET!

```
POST /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q/count
```

**Request Body:**
```json
{
  "counted_by": "USER-001",
  "lines": [
    {
      "id": 330,  // Optional: Sequential ID
      "lineId": 330,  // ✅ REQUIRED: Must match database id field
      "line_id": "LINE-330",  // Optional: String format
      "item_code": "SKU-JACKET-201-BLK-L",  // ✅ REQUIRED: For matching if lineId doesn't match
      "barcode": "SKU-JACKET-201-BLK-L",  // Optional: Also accepted
      "actual_qty": 1,  // ✅ REQUIRED: Counted quantity
      "counted_qty": 1,  // Also send counted_qty
      "carton_id": "CTN-433",  // Optional: Carton ID
      "bin_location": "A1-R01-L1-B1",  // Help backend match by bin + item
      "expected_qty": 0,  // Optional: Expected quantity
      "discrepancy_reason": null
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
  "message": "Successfully updated lines",
  "updated_count": 2
}
```

**Then verify database:**
```sql
SELECT id, item_code, expected_qty, actual_qty, counted_by
FROM tabcyclecountline
WHERE parent_title = 'CC-A1-R01-L1-B1-MK82UT3Q'
ORDER BY id;
```

**Expected results:**
- id 330: `actual_qty = 1`, `counted_by = USER-001` ✅
- id 331: `actual_qty = 1`, `counted_by = USER-001` ✅

---

### Test 3: Check if Empty Line Exists Before Mobile Starts
```sql
-- Check if empty line exists in database
SELECT id, parent_title, item_code, expected_qty, actual_qty, carton_id
FROM tabcyclecountline
WHERE parent_title = 'CC-A1-R01-L1-B1-MK82UT3Q'
ORDER BY id;
```

**If line 329 exists before mobile app starts:**
- ✅ Backend issue (task creation creates empty line)

**If line 329 created after mobile app starts:**
- Check mobile app logs
- Check backend logs when `/start` or `/count` API called

---

## 📊 Mobile App Flow

1. **User scans bin** → Creates local session
2. **User clicks "Start Count"** → Calls `POST /api/cycle-count/{title}/start`
3. **User scans items** → Saves to local database (`cycle_count_lines` table)
4. **Sync happens** → Calls `POST /api/cycle-count/{title}/count` with lines
5. **User clicks "Submit Bin"** → Calls `POST /api/cycle-count/{title}/submit`
6. **Task completion** → Calls `POST /api/cycle-count/{title}/complete`

---

## 🔧 Recommended Fixes

### Backend Fixes:

1. **Task Creation:**
   ```sql
   -- When creating cycle count task lines, populate expected_qty from stock ledger
   INSERT INTO tabcyclecountline (parent_title, item_code, bin_location, expected_qty)
   SELECT 
     'CC-A1-R01-L1-B1-MK6SK143',
     sl.item_code,
     'A1-R01-L1-B1',
     sl.qty  -- ✅ Get from stock ledger
   FROM stock_ledger sl
   WHERE sl.bin_location = 'A1-R01-L1-B1'
     AND sl.qty > 0;
   ```

2. **Count API (`/count`):**
   - Must update `actual_qty` when `lineId` matches
   - Must handle `item_code` matching if `lineId` doesn't match
   - Should NOT create new lines (only update existing)
   - Should return error if line not found

3. **Empty Line Prevention:**
   - Don't create placeholder/empty lines
   - Only create lines when items are actually scanned
   - Or create lines with expected items from stock ledger during task creation

### Mobile App Verification:

1. **Check Local Database:**
   ```sql
   -- Check mobile app's cycle_count_lines table
   SELECT * FROM cycle_count_lines 
   WHERE session_id = 'your-session-id'
   ORDER BY created_at;
   ```

2. **Check Sync Logs:**
   - Look for `POST /api/cycle-count/{title}/count` API calls
   - Check if sync succeeded or failed
   - Verify `lineId` sent matches database IDs

---

## ✅ Summary

| Issue | Root Cause | Fix Location |
|-------|------------|--------------|
| Expected qty = 0.00 | Backend task creation doesn't set from stock ledger | **Backend** |
| Empty line (id 329) | Task creation or start API creates placeholder line | **Backend** (most likely) |
| Actual qty = NULL | Sync not called yet OR backend update failed | **Both** - Check mobile logs first, then backend |
| **No backend line match** | **GET /api/cycle-count/{title} not returning lines or lines missing `id` field** | **Backend** - GET endpoint must return lines with `id` |

## 🔴 CRITICAL ISSUE IDENTIFIED

From your terminal logs: `⚠️ No backend line match found for SKU-JACKET-201-BLK-L`

**Root Cause:** The mobile app calls `GET /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q` to get task lines, but:
- Either the endpoint doesn't return lines
- Or lines are returned but don't have `id` field
- Or lines don't have matching `item_code`

**Fix:** Backend `GET /api/cycle-count/{title}` endpoint MUST:
1. Return `lines` array with all task lines
2. Each line MUST have `id` field (database ID from `tabcyclecountline` table)
3. Each line MUST have `item_code` field (for matching)
4. Lines should include `expected_qty` from stock ledger

---

## 📝 APIs to Test in Postman

1. **Get Task:** `GET /api/cycle-count/CC-A1-R01-L1-B1-MK6SK143`
   - Check if `expected_qty` is set correctly

2. **Submit Count:** `POST /api/cycle-count/CC-A1-R01-L1-B1-MK6SK143/count`
   - Test if `actual_qty` gets updated

3. **Start Task:** `POST /api/cycle-count/CC-A1-R01-L1-B1-MK6SK143/start`
   - Check if this creates any empty lines

---

**Note:** Mobile app does NOT create tasks. Task creation should be done by backend/desktop with proper `expected_qty` from stock ledger.
