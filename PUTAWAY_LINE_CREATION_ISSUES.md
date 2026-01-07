# Putaway Line Creation Issues - Field Name & Value Analysis

## Problem

Putaway task header is created, but putaway task lines (items) are NOT being created in the backend.

## Root Cause Analysis

### Backend Query for Items (from BACKEND_PUTAWAY_TASK_REQUIREMENTS.md)

```sql
-- Backend should query:
SELECT item_code, SUM(qty) as total_qty, carton_id, box_id
FROM tabWmsScanEvent
WHERE box_id = ?
  AND event_type = 'SORT_TO_BOX'
  AND item_code IS NOT NULL
GROUP BY item_code, carton_id, box_id
HAVING total_qty > 0
```

### Backend Insert for Lines

```sql
INSERT INTO tabPutawayLine (
  parent_title,              -- putaway_task ID
  item_code,
  carton_id,                -- Use box_id as carton_id for warehouse boxes
  qty,
  rack,                     -- NULL initially
  bin                       -- NULL initially
) VALUES (?, ?, ?, ?, NULL, NULL)
```

## Potential Issues

### ⚠️ Issue 1: `carton_id` Field in SORT_TO_BOX Events

**Problem:** Backend query expects `carton_id` in `tabWmsScanEvent`, but mobile app may not be setting it correctly.

**Check:**

1. Does `tabWmsScanEvent` table have `carton_id` column?
2. Is `carton_id` being set when creating `SORT_TO_BOX` events?
3. Is `carton_id` NULL or empty for warehouse boxes?

**Mobile App Code (ReceiveSortScreen.tsx):**

```typescript
await addEvent({
  event_type: "SORT_TO_BOX",
  asn_no: normalizedASN,
  inbound_session: activeSession,
  carton_id: lockedCarton,  // ← This should be set
  item_code: currentItem,
  box_id: boxId,
  qty: qty,
  ...
});
```

**Potential Fix:**

- If `carton_id` is NULL for warehouse boxes, backend should use `box_id` as `carton_id`
- Backend query should handle NULL `carton_id`:
  ```sql
  SELECT
    item_code,
    SUM(qty) as total_qty,
    COALESCE(carton_id, box_id) as carton_id,  -- Use box_id if carton_id is NULL
    box_id
  FROM tabWmsScanEvent
  WHERE box_id = ?
    AND event_type = 'SORT_TO_BOX'
    AND item_code IS NOT NULL
  GROUP BY item_code, COALESCE(carton_id, box_id), box_id
  HAVING total_qty > 0
  ```

### ⚠️ Issue 2: `qty` Field Name

**Problem:** Backend expects `qty` but mobile app might be using different field name.

**Check:**

- Mobile app uses `qty` in `addEvent()` ✅
- Backend table `tabWmsScanEvent` should have `qty` column
- Verify field name matches exactly (case-sensitive)

### ⚠️ Issue 3: `box_id` Matching

**Problem:** Backend query uses `box_id = ?` but the value might not match exactly.

**Check:**

- Case sensitivity: `BOX-WHMAIN-220010` vs `box-whmain-220010`
- Whitespace: `BOX-WHMAIN-220010` vs `BOX-WHMAIN-220010 ` (trailing space)
- Format: Ensure box_id format is consistent

**Potential Fix:**

```sql
WHERE UPPER(TRIM(box_id)) = UPPER(TRIM(?))
```

### ⚠️ Issue 4: `event_type` Value

**Problem:** Backend expects `'SORT_TO_BOX'` exactly.

**Check:**

- Mobile app uses `"SORT_TO_BOX"` ✅
- Backend should use exact match: `event_type = 'SORT_TO_BOX'`
- No case sensitivity issues

### ⚠️ Issue 5: Events Not Synced Before Box Close

**Problem:** If `SORT_TO_BOX` events are not synced to backend before box is closed, they won't be in `tabWmsScanEvent` when backend queries.

**Check:**

1. Are events synced to backend before box is closed?
2. Does backend sync events when box is closed?
3. Are events in `tabWmsScanEvent` table when box close is called?

**Solution:**

- Backend should sync events for the box before querying
- Or backend should query from both `tabWmsScanEvent` AND `tabScannedItems` as fallback

### ⚠️ Issue 6: GROUP BY Clause Issue

**Problem:** Backend query groups by `item_code, carton_id, box_id` but if `carton_id` is NULL, grouping might fail.

**Check:**

- MySQL strict mode might reject NULL in GROUP BY
- Need to handle NULL `carton_id` properly

**Fix:**

```sql
GROUP BY item_code, COALESCE(carton_id, box_id), box_id
```

### ⚠️ Issue 7: `parent_title` Value

**Problem:** Backend inserts `parent_title` (putaway_task ID) but if task creation fails silently, lines won't be created.

**Check:**

- Is putaway task created successfully before lines?
- Is `parent_title` value correct format (e.g., "PUT-20260101-0001")?

### ⚠️ Issue 8: Transaction Rollback

**Problem:** If line creation fails, transaction might rollback silently.

**Check:**

- Are errors being caught and logged?
- Is transaction committed after both task and lines are created?

## Database Structure Verification

### tabWmsScanEvent Table (Expected Structure)

```sql
CREATE TABLE tabWmsScanEvent (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(50),        -- 'SORT_TO_BOX'
  box_id VARCHAR(50),            -- BOX-WHMAIN-220010
  carton_id VARCHAR(50),         -- CTN-001 or NULL
  item_code VARCHAR(50),         -- SKU-HAT-301-BLU-OS
  qty DECIMAL(10, 2),           -- 25.00
  asn_no VARCHAR(50),            -- ASN-12225
  inbound_session VARCHAR(100),  -- SESSION-ASN12225-...
  event_time DATETIME,
  ...
);
```

### tabPutawayLine Table (Actual Structure from Images)

```sql
CREATE TABLE tabPutawayLine (
  id INT AUTO_INCREMENT PRIMARY KEY,
  parent_title VARCHAR(50),      -- PUT-20260101-0001 (FK to tabPutawayTask.title)
  carton_id VARCHAR(50),         -- BOX-WHMAIN-220010 or CTN-001
  item_code VARCHAR(50),         -- SKU-HAT-301-BLU-OS
  qty DECIMAL(10, 2),           -- 25.00
  rack VARCHAR(100),            -- NULL initially, set when location scanned
  bin VARCHAR(50),               -- NULL initially, set when location scanned
  created_at DATETIME,
  updated_at DATETIME
);
```

## Backend Code Checklist

### When Box is Closed (`POST /api/boxes/close`)

1. ✅ Check if box store is warehouse
2. ✅ Create putaway task header
3. ⚠️ **Query items from tabWmsScanEvent:**
   - [ ] Verify `carton_id` is handled (NULL or value)
   - [ ] Verify `box_id` matches exactly
   - [ ] Verify `event_type = 'SORT_TO_BOX'` exactly
   - [ ] Verify `qty > 0` after GROUP BY
4. ⚠️ **Create putaway lines:**
   - [ ] Verify `parent_title` is correct (putaway_task ID)
   - [ ] Verify `carton_id` is set (use box_id if NULL)
   - [ ] Verify `item_code` is not NULL
   - [ ] Verify `qty` is positive
   - [ ] Verify transaction commits

## Debugging Queries for Backend

### Query 1: Check if events exist for box

```sql
SELECT
  event_type,
  item_code,
  qty,
  carton_id,
  box_id,
  event_time
FROM tabWmsScanEvent
WHERE box_id = 'BOX-WHMAIN-220010'
  AND event_type = 'SORT_TO_BOX'
ORDER BY event_time DESC;
```

### Query 2: Check grouped items (what backend should find)

```sql
SELECT
  item_code,
  SUM(qty) as total_qty,
  COALESCE(carton_id, box_id) as carton_id,
  box_id
FROM tabWmsScanEvent
WHERE box_id = 'BOX-WHMAIN-220010'
  AND event_type = 'SORT_TO_BOX'
  AND item_code IS NOT NULL
GROUP BY item_code, COALESCE(carton_id, box_id), box_id
HAVING total_qty > 0;
```

### Query 3: Check if putaway task exists

```sql
SELECT title, box_id, status, created_at
FROM tabPutawayTask
WHERE box_id = 'BOX-WHMAIN-220010';
```

### Query 4: Check if lines were created

```sql
SELECT
  pl.id,
  pl.parent_title,
  pl.item_code,
  pl.carton_id,
  pl.qty,
  pl.rack,
  pl.bin
FROM tabPutawayLine pl
WHERE pl.parent_title = (
  SELECT title FROM tabPutawayTask WHERE box_id = 'BOX-WHMAIN-220010'
);
```

## Most Likely Issues

### 1. **carton_id is NULL in tabWmsScanEvent**

- **Solution:** Backend should use `COALESCE(carton_id, box_id)` in query and insert

### 2. **Events not synced before box close**

- **Solution:** Backend should sync events or query from both sources

### 3. **box_id case/whitespace mismatch**

- **Solution:** Use `UPPER(TRIM())` for comparison

### 4. **GROUP BY fails with NULL carton_id**

- **Solution:** Use `COALESCE(carton_id, box_id)` in GROUP BY

## Recommended Backend Fix

```sql
-- Get items from tabWmsScanEvent with NULL handling
SELECT
  item_code,
  SUM(qty) as total_qty,
  COALESCE(carton_id, box_id) as carton_id,  -- Use box_id if carton_id is NULL
  box_id
FROM tabWmsScanEvent
WHERE UPPER(TRIM(box_id)) = UPPER(TRIM(?))  -- Case-insensitive, trimmed
  AND event_type = 'SORT_TO_BOX'
  AND item_code IS NOT NULL
  AND item_code != ''
GROUP BY item_code, COALESCE(carton_id, box_id), box_id
HAVING SUM(qty) > 0;

-- Insert lines with proper carton_id
INSERT INTO tabPutawayLine (
  parent_title,
  item_code,
  carton_id,  -- Will be box_id if carton_id was NULL
  qty,
  rack,
  bin
) VALUES (?, ?, ?, ?, NULL, NULL);
```

## Mobile App Verification

### Check SORT_TO_BOX Events Created

```sql
-- In mobile app database (SQLite)
SELECT
  event_type,
  box_id,
  carton_id,
  item_code,
  qty,
  synced,
  error_msg
FROM event_queue
WHERE box_id = 'BOX-WHMAIN-220010'
  AND event_type = 'SORT_TO_BOX'
ORDER BY event_time DESC;
```

### Check if Events are Synced

- Events with `synced = 1` are in backend `tabWmsScanEvent`
- Events with `synced = 0` are NOT in backend yet
- Events with `error_msg` failed to sync

## Critical Finding: carton_id Value Issue

### The Problem

**Mobile App Behavior:**

- Mobile app sets `carton_id` to the **original carton ID** (e.g., "CTN-001") in `SORT_TO_BOX` events
- This is correct for tracking which carton items came from

**Backend Requirement:**

- Backend should use `box_id` as `carton_id` when creating putaway lines for warehouse boxes
- But backend query groups by `carton_id` from events, which might be "CTN-001" not "BOX-WHMAIN-220010"

**The Mismatch:**

- Events have: `carton_id = "CTN-001"`, `box_id = "BOX-WHMAIN-220010"`
- Backend needs: `carton_id = "BOX-WHMAIN-220010"` for putaway lines
- Backend query groups by `carton_id` from events, so it groups by "CTN-001"
- But backend should use `box_id` as `carton_id` when inserting lines

### Solution

**Backend should:**

1. Query items grouped by `item_code` and `box_id` (not `carton_id`)
2. Use `box_id` as `carton_id` when inserting into `tabPutawayLine`

**Corrected Backend Query:**

```sql
-- Group by item_code and box_id (not carton_id)
SELECT
  item_code,
  SUM(qty) as total_qty,
  box_id
FROM tabWmsScanEvent
WHERE box_id = ?
  AND event_type = 'SORT_TO_BOX'
  AND item_code IS NOT NULL
GROUP BY item_code, box_id
HAVING total_qty > 0
```

**Corrected Backend Insert:**

```sql
-- Use box_id as carton_id for warehouse boxes
INSERT INTO tabPutawayLine (
  parent_title,
  item_code,
  carton_id,  -- Use box_id value here
  qty,
  rack,
  bin
) VALUES (?, ?, ?, ?, NULL, NULL)
-- Where carton_id parameter = box_id (not carton_id from event)
```

## Summary

**Most Critical Issues:**

1. ⚠️ **CRITICAL:** Backend groups by `carton_id` from events, but should use `box_id` as `carton_id` when inserting lines
2. ⚠️ `carton_id` might be NULL - backend should use `box_id` as fallback
3. ⚠️ Events might not be synced before box close
4. ⚠️ `box_id` case/whitespace mismatch in query
5. ⚠️ GROUP BY should group by `box_id`, not `carton_id` for warehouse boxes

**Recommended Backend Changes:**

1. **Change GROUP BY to use `box_id` instead of `carton_id`:**

   ```sql
   GROUP BY item_code, box_id  -- Not carton_id
   ```

2. **Use `box_id` as `carton_id` when inserting:**

   ```sql
   INSERT INTO tabPutawayLine (parent_title, item_code, carton_id, qty, rack, bin)
   VALUES (?, ?, ?, ?, NULL, NULL)
   -- Where carton_id = box_id (from query result)
   ```

3. Use `COALESCE(carton_id, box_id)` if carton_id might be NULL
4. Use `UPPER(TRIM())` for box_id comparison
5. Sync events before querying OR query from both sources
