# Backend Requirements: Carton ID and Status Updates for Transfer In

## Problem Summary

The mobile app is correctly sending `carton_id` in `TRANSFER_IN_RECEIVE` events, but:
1. **Carton IDs are not appearing in the desktop view** - The `carton_id` field in `transfer_in_line` table remains empty
2. **Status is updating incorrectly** - Status changes to "Received" when `received_qty >= expected_qty`, but should only change when user clicks "Complete"

---

## Mobile App Behavior (Current Implementation)

### ✅ Carton ID in Events

The mobile app **correctly includes `carton_id`** in all `TRANSFER_IN_RECEIVE` events:

```typescript
// Example event structure sent to backend:
{
  "event_type": "TRANSFER_IN_RECEIVE",
  "transfer_in": "INSLIP-0001",
  "carton_id": "CTN-TI-0001-20250125-143022-123",  // ✅ Carton ID included
  "item_code": "SKU-HAT-301-BLU-OS",
  "qty": 1,
  "device_id": "DEV-LEH5-150526",
  "user_id": "USER-150526"
}
```

**Event Creation Points:**
1. **Item Scanning** (`handleItemScan`): Creates event with `carton_id` when user scans an item
2. **Quantity Editing** (`handleSaveEditQty`): Creates event with `carton_id` when user edits quantity

**Event Sync:**
- Events are synced immediately after creation
- Events are sent to `/api/events/batch` endpoint
- Backend confirms receipt with `ok: true, inserted_count: 1`

### ✅ Status Control

The mobile app **correctly controls status**:
- Status remains "Receiving" until user clicks "Complete"
- Only when "Complete" is clicked, the app calls `/api/transfer-in/{title}/complete-receiving` (or fallback to `update-status`)
- Status is determined by explicit backend flags (`completed_at`, `is_completed`, `completed_by`), NOT by `received_qty == expected_qty`

---

## Backend Requirements

### 1. Update `carton_id` on Transfer In Line Items

**When processing `TRANSFER_IN_RECEIVE` events, the backend MUST:**

```sql
-- Pseudo-code for event processing:
UPDATE transfer_in_line
SET 
  carton_id = event.carton_id,  -- ✅ CRITICAL: Update carton_id from event
  received_qty = received_qty + event.qty,
  status = CASE 
    WHEN (received_qty + event.qty) >= qty THEN 'Received'
    WHEN (received_qty + event.qty) > 0 THEN 'Picking'
    ELSE 'Pending'
  END
WHERE 
  transfer_in = event.transfer_in
  AND item_code = event.item_code;
```

**Important Notes:**
- `carton_id` should be updated **every time** a `TRANSFER_IN_RECEIVE` event is processed
- If multiple events have different `carton_id` values for the same item, the **last event's `carton_id`** should be used (or implement multi-carton support if needed)
- The `carton_id` field in `transfer_in_line` table should be populated from the event's `carton_id` field

### 2. Status Recalculation Logic

**The backend MUST implement status recalculation:**

```sql
-- Function: recalculate_transfer_in_status(transfer_in_no)
-- Called after processing each TRANSFER_IN_RECEIVE event

CREATE FUNCTION recalculate_transfer_in_status(transfer_in_no VARCHAR(255))
RETURNS VOID
BEGIN
  DECLARE total_received DECIMAL(10,2);
  DECLARE total_required DECIMAL(10,2);
  DECLARE is_completed_flag BOOLEAN;
  
  -- Calculate totals
  SELECT 
    SUM(received_qty) INTO total_received,
    SUM(qty) INTO total_required
  FROM transfer_in_line
  WHERE transfer_in = transfer_in_no;
  
  -- Check completion flag (from completed_at or is_completed field)
  SELECT 
    CASE 
      WHEN completed_at IS NOT NULL THEN TRUE
      WHEN is_completed = 1 THEN TRUE
      ELSE FALSE
    END INTO is_completed_flag
  FROM transfer_in
  WHERE title = transfer_in_no;
  
  -- Update status based on completion flag, NOT just qty match
  UPDATE transfer_in
  SET status = CASE
    WHEN is_completed_flag = TRUE THEN 'Received'  -- ✅ Only if explicitly completed
    WHEN total_received > 0 THEN 'Receiving'        -- ✅ Partial receive = Receiving
    ELSE 'Submitted'                                -- ✅ No receive = Submitted
  END
  WHERE title = transfer_in_no;
END;
```

**Status Rules:**
- ✅ `status = "Receiving"` when `total_received > 0` AND `completed_at IS NULL`
- ✅ `status = "Received"` ONLY when `completed_at IS NOT NULL` (user clicked Complete)
- ❌ **DO NOT** set status to "Received" just because `received_qty >= expected_qty`

### 3. Complete Receiving Endpoint

**When `/api/transfer-in/{title}/complete-receiving` is called:**

```sql
-- Pseudo-code for complete-receiving endpoint:
UPDATE transfer_in
SET 
  completed_at = NOW(),
  completed_by = current_user_id,
  is_completed = 1,
  status = 'Received'  -- ✅ Set status to Received only when Complete is clicked
WHERE title = transfer_in_no;

-- Recalculate status (should now be "Received")
CALL recalculate_transfer_in_status(transfer_in_no);
```

**Response:**
```json
{
  "ok": true,
  "status": "Received",
  "completed_at": "2025-01-25T14:30:22Z",
  "completed_by": "USER-150526"
}
```

---

## Verification Checklist

### ✅ Carton ID Updates

- [ ] Backend processes `carton_id` from `TRANSFER_IN_RECEIVE` events
- [ ] `transfer_in_line.carton_id` is updated when events are processed
- [ ] Desktop view shows `carton_id` in the "Carton ID" column
- [ ] Multiple events with same `item_code` update `carton_id` correctly

### ✅ Status Updates

- [ ] Status remains "Receiving" when `received_qty > 0` but `completed_at IS NULL`
- [ ] Status changes to "Received" ONLY when `completed_at IS NOT NULL`
- [ ] Status does NOT automatically change to "Received" when `received_qty >= expected_qty`
- [ ] `recalculate_transfer_in_status()` function is called after each event
- [ ] `complete-receiving` endpoint sets `completed_at` and updates status

---

## Testing Steps

### Test 1: Carton ID Update

1. **Mobile App:**
   - Open Transfer In `INSLIP-0001`
   - Generate/scan carton ID: `CTN-TI-0001-20250125-143022-123`
   - Scan item: `SKU-HAT-301-BLU-OS`
   - Wait for event sync

2. **Backend Verification:**
   ```sql
   SELECT item_code, received_qty, carton_id 
   FROM transfer_in_line 
   WHERE transfer_in = 'INSLIP-0001' AND item_code = 'SKU-HAT-301-BLU-OS';
   ```
   **Expected:** `carton_id = 'CTN-TI-0001-20250125-143022-123'`

3. **Desktop View:**
   - Open Transfer In Details for `INSLIP-0001`
   - Check "Carton ID" column
   - **Expected:** Carton ID should be visible (not empty)

### Test 2: Status Control

1. **Mobile App:**
   - Open Transfer In `INSLIP-0001`
   - Scan items until `received_qty = expected_qty` for all items
   - **DO NOT** click "Complete"
   - Check status in mobile app

2. **Backend Verification:**
   ```sql
   SELECT title, status, completed_at, is_completed 
   FROM transfer_in 
   WHERE title = 'INSLIP-0001';
   ```
   **Expected:** 
   - `status = 'Receiving'` (NOT "Received")
   - `completed_at IS NULL`
   - `is_completed = 0`

3. **Mobile App:**
   - Click "Complete" button
   - Wait for API response

4. **Backend Verification:**
   ```sql
   SELECT title, status, completed_at, is_completed 
   FROM transfer_in 
   WHERE title = 'INSLIP-0001';
   ```
   **Expected:**
   - `status = 'Received'`
   - `completed_at IS NOT NULL`
   - `is_completed = 1`

---

## Current Backend Issues (Based on Desktop View)

### Issue 1: Empty Carton IDs

**Symptom:** Desktop view shows empty `carton_id` for items that have been received.

**Root Cause:** Backend is not updating `transfer_in_line.carton_id` when processing `TRANSFER_IN_RECEIVE` events.

**Fix:** Update event processing logic to set `carton_id` from event data.

### Issue 2: Status "Received" Without Completion

**Symptom:** Desktop view shows `status = "Received"` even though user hasn't clicked "Complete" in mobile app.

**Root Cause:** Backend is setting status to "Received" based on `received_qty >= expected_qty`, without checking `completed_at` flag.

**Fix:** Implement `recalculate_transfer_in_status()` function that checks `completed_at` before setting status to "Received".

### Issue 3: Line Item Status "Picking" When Header is "Received"

**Symptom:** Desktop view shows line item `status = "Picking"` even though header status is "Received".

**Root Cause:** Line item status is not being updated correctly, or status calculation logic is inconsistent.

**Fix:** Ensure line item status is updated when processing events:
- `status = "Pending"` when `received_qty = 0`
- `status = "Picking"` when `0 < received_qty < expected_qty`
- `status = "Received"` when `received_qty >= expected_qty`

---

## Event Structure Reference

### TRANSFER_IN_RECEIVE Event

```json
{
  "event_type": "TRANSFER_IN_RECEIVE",
  "transfer_in": "INSLIP-0001",
  "carton_id": "CTN-TI-0001-20250125-143022-123",
  "item_code": "SKU-HAT-301-BLU-OS",
  "qty": 1,
  "device_id": "DEV-LEH5-150526",
  "user_id": "USER-150526",
  "offline_uuid": "7673b772-cc2a-4c7c-8788-85f...",
  "event_time": "2025-01-25T14:30:22Z"
}
```

**Required Fields:**
- ✅ `event_type`: "TRANSFER_IN_RECEIVE"
- ✅ `transfer_in`: Transfer In number (e.g., "INSLIP-0001")
- ✅ `carton_id`: Carton ID (e.g., "CTN-TI-0001-20250125-143022-123")
- ✅ `item_code`: Item code (e.g., "SKU-HAT-301-BLU-OS")
- ✅ `qty`: Quantity (positive for increase, negative for decrease)

---

## Summary

The mobile app is **correctly sending** `carton_id` in events and **correctly controlling** status. The backend needs to:

1. ✅ **Update `carton_id`** on `transfer_in_line` table when processing events
2. ✅ **Implement status recalculation** that checks `completed_at` flag, not just qty match
3. ✅ **Set `completed_at`** when `/api/transfer-in/{title}/complete-receiving` is called

Once these backend changes are implemented, the desktop view will show:
- ✅ Carton IDs populated in the "Carton ID" column
- ✅ Status "Receiving" until Complete is clicked
- ✅ Status "Received" only after Complete is clicked
