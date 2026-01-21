# Backend Fix: Transfer In Status Recalculation

## Problem

Transfer In header status remains "Submitted" even after partial receiving (received_qty > 0).
Example: `INSLIP-123463` has `Received Qty = 1.00` but header status remains "Submitted".

## Required Behavior

1. **When ANY line has `received_qty > 0` AND transfer is NOT completed:**

   - Status must be **"Receiving"**

2. **When user clicks Complete (finalize):**

   - Status becomes **"Received"**

3. **Status must NOT remain "Submitted" once partial receiving started.**

---

## Backend Implementation

### Step 1: Add Completion Marker Fields

Add these fields to the `transfer_in` table (if not already present):

```sql
ALTER TABLE transfer_in
ADD COLUMN completed_at DATETIME NULL,
ADD COLUMN completed_by VARCHAR(255) NULL,
ADD COLUMN is_completed TINYINT DEFAULT 0;
```

**Note:** If you already have `completed_at`, you can use that. `is_completed` is optional if `completed_at` is used.

### Step 2: Create Status Recalculation Function

Create a backend function: `recalculate_transfer_in_status(transfer_in_no)`

#### Pseudo-code Logic:

```javascript
function recalculate_transfer_in_status(transfer_in_no) {
  // 1. Get Transfer In header
  const transferIn = getTransferIn(transfer_in_no);

  // 2. Calculate totals from lines
  const lines = getTransferInLines(transfer_in_no);
  const total_received = lines.reduce(
    (sum, line) => sum + (line.received_qty || 0),
    0
  );
  const total_required = lines.reduce((sum, line) => sum + (line.qty || 0), 0);

  // 3. Check if completed
  const is_completed =
    transferIn.completed_at != null || transferIn.is_completed == 1;

  // 4. Determine status
  let new_status;
  if (is_completed) {
    new_status = "Received";
  } else if (total_received > 0) {
    new_status = "Receiving"; // ✅ Any partial receive = Receiving
  } else {
    new_status = "Submitted"; // No items received yet
  }

  // 5. Update status if changed
  if (transferIn.status !== new_status) {
    updateTransferInStatus(transfer_in_no, new_status);
    console.log(
      `✅ Updated Transfer In ${transfer_in_no} status: ${transferIn.status} → ${new_status}`
    );
  }

  return new_status;
}
```

#### SQL Implementation Example:

```sql
-- Function to recalculate Transfer In status
CREATE OR REPLACE FUNCTION recalculate_transfer_in_status(p_transfer_in_no VARCHAR)
RETURNS VARCHAR AS $$
DECLARE
  v_total_received DECIMAL(18,2);
  v_total_required DECIMAL(18,2);
  v_is_completed BOOLEAN;
  v_new_status VARCHAR(50);
  v_current_status VARCHAR(50);
BEGIN
  -- Get current status and completion flag
  SELECT status,
         CASE WHEN completed_at IS NOT NULL OR is_completed = 1 THEN TRUE ELSE FALSE END
  INTO v_current_status, v_is_completed
  FROM transfer_in
  WHERE title = p_transfer_in_no;

  -- Calculate totals from lines
  SELECT
    COALESCE(SUM(received_qty), 0),
    COALESCE(SUM(qty), 0)
  INTO v_total_received, v_total_required
  FROM transfer_in_line
  WHERE transfer_in = p_transfer_in_no;

  -- Determine new status
  IF v_is_completed THEN
    v_new_status := 'Received';
  ELSIF v_total_received > 0 THEN
    v_new_status := 'Receiving';  -- ✅ Any partial receive = Receiving
  ELSE
    v_new_status := 'Submitted';   -- No items received yet
  END IF;

  -- Update status if changed
  IF v_current_status != v_new_status THEN
    UPDATE transfer_in
    SET status = v_new_status,
        updated_on = NOW()
    WHERE title = p_transfer_in_no;

    RAISE NOTICE 'Updated Transfer In % status: % → %', p_transfer_in_no, v_current_status, v_new_status;
  END IF;

  RETURN v_new_status;
END;
$$ LANGUAGE plpgsql;
```

### Step 3: Call Recalculation Function

Call `recalculate_transfer_in_status()` in these places:

#### 1. After Processing TRANSFER_IN_RECEIVE Event

```javascript
// In event processing handler
async function processTransferInReceiveEvent(event) {
  // ... existing code to update received_qty ...

  // ✅ Recalculate status after updating quantity
  await recalculate_transfer_in_status(event.transfer_in);
}
```

#### 2. After Processing TRANSFER_IN_RECEIVE_ADJUST Event (if exists)

```javascript
async function processTransferInReceiveAdjustEvent(event) {
  // ... existing code to adjust received_qty ...

  // ✅ Recalculate status after adjusting quantity
  await recalculate_transfer_in_status(event.transfer_in);
}
```

#### 3. When User Clicks Complete

```javascript
// In complete-receiving endpoint
POST /api/transfer-in/{title}/complete-receiving
async function completeTransferInReceiving(transfer_in_no, user_id) {
  // 1. Set completion markers
  await db.update('transfer_in', {
    completed_at: new Date(),
    completed_by: user_id,
    is_completed: 1
  }, { title: transfer_in_no });

  // 2. Recalculate status (will set to "Received")
  await recalculate_transfer_in_status(transfer_in_no);

  // 3. Return updated status
  const updated = await getTransferIn(transfer_in_no);
  return {
    ok: true,
    status: updated.status,
    completed_at: updated.completed_at
  };
}
```

#### 4. After Direct API Calls (if any)

If you have direct API endpoints that update `received_qty`:

```javascript
POST /api/transfer-in/{title}/receive-line
async function receiveTransferInLine(transfer_in_no, data) {
  // ... update received_qty ...

  // ✅ Recalculate status
  await recalculate_transfer_in_status(transfer_in_no);
}
```

---

## Complete Endpoint Implementation

### Endpoint: `POST /api/transfer-in/{title}/complete-receiving`

**Request:**

```json
{
  "transfer_in": "INSLIP-123463"
}
```

**Response:**

```json
{
  "ok": true,
  "status": "Received",
  "completed_at": "2026-01-15T12:00:00Z",
  "completed_by": "USER-001"
}
```

**Implementation:**

```javascript
async function completeTransferInReceiving(transfer_in_no, user_id) {
  // 1. Validate Transfer In exists
  const transferIn = await getTransferIn(transfer_in_no);
  if (!transferIn) {
    throw new Error(`Transfer In ${transfer_in_no} not found`);
  }

  // 2. Set completion markers
  await db.update(
    "transfer_in",
    {
      completed_at: new Date().toISOString(),
      completed_by: user_id,
      is_completed: 1,
      updated_on: new Date().toISOString(),
    },
    { title: transfer_in_no }
  );

  // 3. Recalculate status (will set to "Received")
  const new_status = await recalculate_transfer_in_status(transfer_in_no);

  // 4. Return updated Transfer In
  const updated = await getTransferIn(transfer_in_no);
  return {
    ok: true,
    status: updated.status, // Should be "Received"
    completed_at: updated.completed_at,
    completed_by: updated.completed_by,
  };
}
```

---

## Status Flow Examples

### Example 1: Partial Receive

1. **Initial State:**

   - Status: "Submitted"
   - Total received: 0
   - Total required: 10

2. **After receiving 1 item:**

   - Total received: 1
   - Total required: 10
   - **Status: "Receiving"** ✅ (changed from "Submitted")

3. **After receiving 5 more items:**

   - Total received: 6
   - Total required: 10
   - **Status: "Receiving"** ✅ (still "Receiving")

4. **After user clicks Complete:**
   - `completed_at` set
   - **Status: "Received"** ✅ (changed from "Receiving")

### Example 2: Complete Receive Then Complete

1. **After receiving all 10 items:**

   - Total received: 10
   - Total required: 10
   - **Status: "Receiving"** ✅ (NOT "Received" yet)

2. **After user clicks Complete:**
   - `completed_at` set
   - **Status: "Received"** ✅ (changed from "Receiving")

---

## Desktop Side Fix

### If Desktop Uses Direct SQL Query

**Current (Wrong):**

```sql
SELECT status FROM transfer_in WHERE title = 'INSLIP-123463';
-- Returns: "Submitted" (even after partial receive)
```

**Fixed:**

- Desktop should display `transfer_in.status` field (updated by backend recalculation)
- Do NOT compute status from lines in desktop code
- Reload header after each receive/save operation

### If Desktop Doesn't Refresh Status

**Option 1: Auto-refresh after save**

```javascript
// After saving receive line
await saveReceiveLine();
await refreshTransferInHeader(); // Reload status
```

**Option 2: Call status API**

```javascript
// After saving receive line
await saveReceiveLine();
const updated = await getTransferIn(transfer_in_no);
setStatus(updated.status); // Update UI
```

---

## Mobile App Compatibility

The mobile app is already compatible with this backend fix:

### Current Mobile Behavior:

- ✅ Mobile UI shows "Receiving" until Complete clicked (independent of backend status)
- ✅ Mobile checks for `completed_at` or `is_completed` flag to determine completion
- ✅ Mobile ignores backend `status` field for UI display (uses `isCompleted` flag)

### After Backend Fix:

- ✅ Backend status will correctly show "Receiving" during partial receive
- ✅ Mobile can optionally display backend status for reference
- ✅ Mobile completion logic remains unchanged (checks `completed_at` flag)

### Mobile Status Display:

```typescript
// Mobile UI status (already implemented)
const uiStatus = isCompleted ? "Received" : "Receiving";

// Backend status (for reference, after fix)
const backendStatus = transferIn.status; // "Submitted" → "Receiving" → "Received"
```

---

## Testing Checklist

### Backend Testing:

- [ ] Status changes from "Submitted" to "Receiving" after first item received
- [ ] Status remains "Receiving" during partial receive
- [ ] Status changes to "Received" only after Complete clicked
- [ ] Status does NOT auto-change to "Received" when qty matches (without Complete)
- [ ] `completed_at` is set when Complete endpoint called
- [ ] Recalculation function called after each receive event
- [ ] Recalculation function called after Complete endpoint

### Mobile Testing:

- [ ] Mobile UI shows "Receiving" until Complete clicked (already working)
- [ ] Mobile can display backend status for reference (optional)
- [ ] Mobile completion logic works with `completed_at` flag (already working)

### Desktop Testing:

- [ ] Desktop shows "Receiving" status after partial receive
- [ ] Desktop shows "Received" status only after Complete
- [ ] Desktop refreshes status after each receive operation

---

## Migration Notes

### For Existing Transfer Ins:

If you have existing Transfer Ins with `received_qty > 0` but status = "Submitted":

```sql
-- Run recalculation for all Transfer Ins
UPDATE transfer_in ti
SET status = CASE
  WHEN ti.completed_at IS NOT NULL OR ti.is_completed = 1 THEN 'Received'
  WHEN EXISTS (
    SELECT 1 FROM transfer_in_line til
    WHERE til.transfer_in = ti.title
    AND til.received_qty > 0
  ) THEN 'Receiving'
  ELSE 'Submitted'
END
WHERE ti.status = 'Submitted';
```

Or call `recalculate_transfer_in_status()` for each Transfer In.

---

## Summary

**Backend Must:**

1. ✅ Add `completed_at` and `completed_by` fields
2. ✅ Create `recalculate_transfer_in_status()` function
3. ✅ Call recalculation after each receive event
4. ✅ Call recalculation in Complete endpoint
5. ✅ Set `completed_at` only when Complete endpoint called

**Status Rules:**

- `received_qty > 0` AND NOT completed → **"Receiving"**
- `completed_at` set → **"Received"**
- `received_qty = 0` AND NOT completed → **"Submitted"**

**Mobile App:**

- ✅ Already compatible (no changes needed)
- ✅ Uses `completed_at` flag for completion detection
- ✅ UI status independent of backend status field
