# Putaway Task Lines Not Created - Debugging Guide

## Issue
Putaway task header is created successfully, but putaway task lines (items) are not being created in the backend.

## Expected Flow

1. **Items are sorted to boxes** → Mobile app creates `SORT_TO_BOX` events
2. **Events are synced to backend** → Events stored in `tabWmsScanEvent` table
3. **Box is closed** → Backend creates putaway task header
4. **Backend queries events** → Gets items from `tabWmsScanEvent` for the box
5. **Backend creates lines** → Creates `tabPutawayLine` records for each item

## Backend Requirements (from BACKEND_PUTAWAY_TASK_REQUIREMENTS.md)

When closing a box, the backend should:

### Step 1: Create Putaway Task Header
```sql
INSERT INTO tabPutawayTask (
  title,                    -- putaway_task ID (e.g., PUT-20260101-0001)
  box_id,                   -- The closed box ID
  advance_shipping_notice,  -- ASN from box
  status,                   -- "Open"
  source_type,              -- "Box"
  created_on,
  created_by
) VALUES (?, ?, ?, ?, ?, NOW(), ?)
```

### Step 2: Get Items from Events
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

### Step 3: Create Putaway Task Lines
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

## Common Issues to Check

### Issue 1: Events Not Synced Before Box Close
**Symptom:** Box is closed, but `SORT_TO_BOX` events are not yet in `tabWmsScanEvent`

**Check:**
```sql
-- Check if events exist in tabWmsScanEvent for the box
SELECT event_type, item_code, qty, box_id, carton_id
FROM tabWmsScanEvent
WHERE box_id = 'BOX-WHMAIN-220010'
  AND event_type = 'SORT_TO_BOX'
ORDER BY event_time DESC;
```

**Solution:**
- Ensure events are synced to backend BEFORE closing the box
- Or modify backend to sync events when box is closed (if not already synced)

### Issue 2: Backend Query Not Finding Events
**Symptom:** Events exist in `tabWmsScanEvent`, but backend query returns no results

**Check:**
1. Verify `box_id` matches exactly (case-sensitive)
2. Verify `event_type` is exactly `'SORT_TO_BOX'` (not `'Sort to Box'` or other variations)
3. Verify `item_code` is NOT NULL
4. Verify `qty > 0` after GROUP BY

**Debug Query:**
```sql
-- Check all events for the box (not filtered)
SELECT event_type, item_code, qty, box_id, carton_id, event_time
FROM tabWmsScanEvent
WHERE box_id = 'BOX-WHMAIN-220010'
ORDER BY event_time DESC;

-- Check if GROUP BY is working correctly
SELECT item_code, SUM(qty) as total_qty, carton_id, box_id
FROM tabWmsScanEvent
WHERE box_id = 'BOX-WHMAIN-220010'
  AND event_type = 'SORT_TO_BOX'
  AND item_code IS NOT NULL
GROUP BY item_code, carton_id, box_id
HAVING total_qty > 0;
```

### Issue 3: Backend Logic Not Executing
**Symptom:** Backend creates task header but doesn't execute line creation logic

**Check:**
1. Verify backend code executes the query for items
2. Verify backend code creates lines after finding items
3. Check backend logs for errors during line creation
4. Verify transaction is committed (not rolled back)

### Issue 4: Column Name Mismatch
**Symptom:** Backend query fails due to wrong column names

**Check:**
- Verify `tabWmsScanEvent` table has columns: `event_type`, `item_code`, `qty`, `box_id`, `carton_id`
- Verify `tabPutawayLine` table has columns: `parent_title`, `item_code`, `carton_id`, `qty`, `rack`, `bin`

### Issue 5: Box ID Mismatch
**Symptom:** Events have different `box_id` than the closed box

**Check:**
```sql
-- Check what box_id is in the putaway task
SELECT title, box_id, advance_shipping_notice
FROM tabPutawayTask
WHERE title = 'PUT-20260101-0001';

-- Check what box_id is in events
SELECT DISTINCT box_id
FROM tabWmsScanEvent
WHERE event_type = 'SORT_TO_BOX'
  AND advance_shipping_notice = 'ASN-12225';
```

## Mobile App Verification

### Check if Events are Created
The mobile app creates `SORT_TO_BOX` events when items are sorted. Verify:
1. Events are created in local `event_queue` table
2. Events are synced to backend (check `synced = 1` in event_queue)
3. Events appear in backend `tabWmsScanEvent` table

### Check Event Sync Status
```sql
-- In mobile app database (SQLite)
SELECT event_type, item_code, qty, box_id, synced, error_msg
FROM event_queue
WHERE box_id = 'BOX-WHMAIN-220010'
  AND event_type = 'SORT_TO_BOX'
ORDER BY event_time DESC;
```

## Recommended Backend Fix

If events are not synced before box close, the backend should:

1. **Option A:** Sync events when box is closed (if not already synced)
   ```javascript
   // Pseudo-code
   async function closeBox(boxId) {
     // 1. Sync any pending events for this box
     await syncEventsForBox(boxId);
     
     // 2. Close the box
     await updateBoxStatus(boxId, 'Closed');
     
     // 3. Create putaway task (if warehouse box)
     if (isWarehouseBox(boxId)) {
       await createPutawayTask(boxId);
     }
   }
   ```

2. **Option B:** Query from both `tabWmsScanEvent` AND `tabScannedItems` as fallback
   ```sql
   -- Try tabWmsScanEvent first
   SELECT item_code, SUM(qty) as total_qty, carton_id, box_id
   FROM tabWmsScanEvent
   WHERE box_id = ? AND event_type = 'SORT_TO_BOX'
   GROUP BY item_code, carton_id, box_id
   HAVING total_qty > 0
   
   UNION ALL
   
   -- Fallback to tabScannedItems if no events found
   SELECT item_code, SUM(scanned_qty) as total_qty, carton_id, box_id
   FROM tabScannedItems
   WHERE box_id = ? AND store LIKE 'WH-%'
   GROUP BY item_code, carton_id, box_id
   HAVING total_qty > 0;
   ```

## Testing Steps

1. **Create test scenario:**
   - Sort items to box `BOX-WHMAIN-220010`
   - Verify `SORT_TO_BOX` events are created in mobile app
   - Sync events to backend
   - Verify events appear in `tabWmsScanEvent`
   - Close the box
   - Verify putaway task is created
   - Verify putaway task lines are created

2. **Check backend logs:**
   - Look for SQL queries executed
   - Look for errors during line creation
   - Verify number of items found vs. lines created

3. **Verify data:**
   ```sql
   -- Check putaway task
   SELECT * FROM tabPutawayTask WHERE box_id = 'BOX-WHMAIN-220010';
   
   -- Check putaway lines
   SELECT * FROM tabPutawayLine WHERE parent_title = 'PUT-20260101-0001';
   
   -- Check source events
   SELECT * FROM tabWmsScanEvent WHERE box_id = 'BOX-WHMAIN-220010' AND event_type = 'SORT_TO_BOX';
   ```

## Expected Result

After closing box `BOX-WHMAIN-220010`:
- ✅ Putaway task `PUT-20260101-0001` created
- ✅ Putaway task lines created (one line per item_code)
- ✅ Lines have correct `item_code`, `qty`, and `carton_id` (box_id)

