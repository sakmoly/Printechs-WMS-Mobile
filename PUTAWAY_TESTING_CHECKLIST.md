# Putaway Workflow Testing Checklist

## Backend Updates Applied

✅ Backend has been updated to fix putaway line creation issues

## Testing Steps

### 1. Test Box Close → Putaway Task Creation

**Steps:**

1. Go to Box Management or Packing screen
2. Close a warehouse box (destination store = WH-MAIN or warehouse)
3. Verify backend creates putaway task with lines

**Expected Results:**

- ✅ Box status changes to "Closed"
- ✅ Backend creates putaway task (e.g., PUT-20260101-0001)
- ✅ Backend creates putaway task lines (one per item_code)
- ✅ Putaway task status = "Open"
- ✅ Response includes `putaway_task` field

**Check Backend Database:**

```sql
-- Check if task was created
SELECT title, box_id, status, created_at
FROM tabPutawayTask
WHERE box_id = 'BOX-WHMAIN-220010';

-- Check if lines were created
SELECT id, parent_title, item_code, carton_id, qty
FROM tabPutawayLine
WHERE parent_title = (SELECT title FROM tabPutawayTask WHERE box_id = 'BOX-WHMAIN-220010');
```

**Mobile App Check:**

- Check console logs for: `✅ PutAwayScreen: Found X putaway task(s) from backend`
- Verify task appears in PutAway screen list

---

### 2. Test Get Putaway Tasks (List View)

**Steps:**

1. Open PutAway screen
2. Verify tasks are loaded from backend API

**Expected Results:**

- ✅ Mobile app calls `GET /api/putaway/tasks?status=Open&advance_shipping_notice=ASN-12225`
- ✅ Backend returns tasks with correct field names:
  - `putaway_task` (not `title`)
  - `asn_no` (not `advance_shipping_notice`)
  - `created_on` (not `created_at`)
  - `updated_on` (not `updated_at`)
- ✅ Tasks appear in mobile app list
- ✅ Tasks show putaway_task ID
- ✅ Tasks show correct status ("Open")

**Check Console Logs:**

- Look for: `✅ PutAwayScreen: Found X putaway task(s) from backend`
- Look for: `✅ PutAwayScreen: Added backend task PUT-...`
- No SQL syntax errors

**Verify Field Mapping:**

- Task ID should display correctly
- ASN should display correctly
- Status should be "Open"

---

### 3. Test Scan Location → Status to "In Progress"

**Steps:**

1. Select a putaway task from list (or scan box ID)
2. Scan a location ID (e.g., "A1-R01-L1-B1")
3. Verify backend updates location and status

**Expected Results:**

- ✅ Mobile app calls `POST /api/putaway/scan-transfer-carton`
- ✅ Request includes:
  - `putaway_task` or `box_id`
  - `location_id`
  - `rack` and `bin` (optional)
- ✅ Backend updates putaway task with location
- ✅ Backend updates all putaway task lines with location
- ✅ Backend changes status to "In Progress"
- ✅ Response includes updated task info

**Check Backend Database:**

```sql
-- Check if location was updated
SELECT title, status, location_id, rack, bin
FROM tabPutawayTask
WHERE title = 'PUT-20260101-0001';

-- Check if lines were updated
SELECT id, parent_title, item_code, rack, bin
FROM tabPutawayLine
WHERE parent_title = 'PUT-20260101-0001';
```

**Mobile App Check:**

- Check console logs for: `✅ Putaway API call succeeded`
- Verify putaway_task is stored for completion step
- Status should show "In Progress" if backend returns it

---

### 4. Test Complete Putaway → Status to "Completed"

**Steps:**

1. After scanning location, click "Complete Put Away"
2. Verify backend completes task and updates stock

**Expected Results:**

- ✅ Mobile app calls `POST /api/putaway/complete`
- ✅ Request includes:
  - `putaway_task`
  - `location_id` (header level)
  - `items` array with `location_id` (item level)
  - `performed_by`
- ✅ Backend validates all items have location
- ✅ Backend updates status to "Completed"
- ✅ Backend updates stock ledger at location
- ✅ Backend creates stock transactions
- ✅ No validation errors

**Check Backend Database:**

```sql
-- Check if status was updated
SELECT title, status, updated_at
FROM tabPutawayTask
WHERE title = 'PUT-20260101-0001';
-- Status should be "Completed"

-- Check stock ledger
SELECT * FROM tabStockLedger
WHERE location_id = 'A1-R01-L1-B1'
  AND item_code = 'SKU-HAT-301-BLU-OS';
```

**Mobile App Check:**

- Check console logs for: `✅ Putaway task completed via API`
- Verify success message is shown
- Task should disappear from list (status = "Completed" is filtered out)

---

## Common Issues to Watch For

### Issue 1: SQL Syntax Error

**Symptom:** `DATABASE_ERROR: SQL syntax error near 'FROM tabPutawayLine'`

**Cause:** Field name mismatch (created_at vs created_on, etc.)

**Fix:** Backend should alias fields correctly (see BACKEND_FIELD_NAME_MAPPING.md)

### Issue 2: No Lines Created

**Symptom:** Putaway task exists but has 0 lines

**Causes:**

- Events not synced before box close
- GROUP BY using wrong field (carton_id instead of box_id)
- box_id case/whitespace mismatch
- carton_id not set to box_id when inserting

**Fix:** Backend should:

- Group by `box_id` (not `carton_id`)
- Use `box_id` as `carton_id` when inserting
- Sync events before querying

### Issue 3: Validation Error

**Symptom:** `VALIDATION_ERROR: some items are missing location`

**Cause:** Backend validation checks items before applying header-level location_id

**Fix:** Mobile app now sends location_id at both header and item level ✅

### Issue 4: Tasks Not Appearing

**Symptom:** Tasks don't show in mobile app list

**Causes:**

- Network error (backend not reachable)
- Field name mismatch in API response
- Status filter too restrictive

**Fix:** Check console logs for errors, verify API response structure

---

## Debugging Queries

### Check Events for Box

```sql
SELECT
  event_type,
  item_code,
  qty,
  carton_id,
  box_id,
  synced,
  event_time
FROM tabWmsScanEvent
WHERE box_id = 'BOX-WHMAIN-220010'
  AND event_type = 'SORT_TO_BOX'
ORDER BY event_time DESC;
```

### Check Putaway Task

```sql
SELECT
  title as putaway_task,
  box_id,
  status,
  location_id,
  created_at,
  updated_at
FROM tabPutawayTask
WHERE box_id = 'BOX-WHMAIN-220010';
```

### Check Putaway Lines

```sql
SELECT
  id,
  parent_title,
  item_code,
  carton_id,
  qty,
  rack,
  bin
FROM tabPutawayLine
WHERE parent_title = 'PUT-20260101-0001';
```

### Verify Field Mapping

```sql
-- Check if backend query returns correct field names
SELECT
  pt.title as putaway_task,
  pt.advance_shipping_notice as asn_no,
  pt.created_at as created_on,
  pt.updated_at as updated_on,
  pt.status,
  COUNT(pl.id) as lines_count
FROM tabPutawayTask pt
LEFT JOIN tabPutawayLine pl ON pl.parent_title = pt.title
WHERE pt.box_id = 'BOX-WHMAIN-220010'
GROUP BY pt.title, pt.advance_shipping_notice, pt.created_at, pt.updated_at, pt.status;
```

---

## Mobile App Console Logs to Monitor

### When Loading Tasks:

```
✅ PutAwayScreen: Found X putaway task(s) from backend
✅ PutAwayScreen: Added backend task PUT-... for BOX-...
📦 PutAwayScreen: Total X putaway items (X from backend, X from local)
```

### When Scanning Location:

```
🔄 Creating/updating putaway task for warehouse box BOX-... with location A1-R01-L1-B1
✅ Putaway API call succeeded
✅ Putaway task created/updated: PUT-20260101-0001
```

### When Completing:

```
📤 Sending header-level location_id: A1-R01-L1-B1
📤 Sending X unique item(s) in putaway completion request
✅ Putaway task completed via API: PUT-20260101-0001
```

### Error Logs to Watch:

```
❌ API Request failed: GET /api/putaway/tasks...
⚠️ Error fetching putaway tasks from backend: ...
⚠️ Rendering box BOX-... WITHOUT putaway_task
```

---

## Success Criteria

✅ **All tests pass if:**

1. Box close creates putaway task with lines
2. Tasks appear in mobile app list with correct data
3. Location scan updates task and changes status to "In Progress"
4. Complete updates task to "Completed" and updates stock
5. No SQL syntax errors
6. No validation errors
7. All field names match between backend and mobile app

---

## Next Steps After Testing

1. **If lines are still not created:**

   - Check backend logs for errors during line creation
   - Verify events are in `tabWmsScanEvent` before box close
   - Verify GROUP BY and INSERT queries are correct

2. **If field name errors persist:**

   - Verify backend aliases all fields correctly
   - Check API response matches expected format

3. **If validation errors occur:**

   - Verify location_id is sent at both header and item level
   - Check backend validation logic

4. **If tasks don't appear:**
   - Check network connectivity
   - Verify API response structure
   - Check console logs for errors
