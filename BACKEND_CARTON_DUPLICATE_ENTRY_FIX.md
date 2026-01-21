# Backend Fix: Duplicate Carton Entry Error

## Problem

When processing `TRANSFER_IN_RECEIVE` events, the backend is trying to insert a carton into `tabTransferInCarton` table, but failing with duplicate entry error:

```
❌ Error processing TRANSFER_IN_RECEIVE event: Error: Duplicate entry 'CTN-555445' for key 'carton_id'
```

**SQL Being Executed:**

```sql
INSERT INTO tabTransferInCarton (name, carton_id, transfer_in, status, created_by, created_at)
VALUES (?, ?, ?, 'Draft', ?, NOW())
```

## Root Cause

The backend is trying to **INSERT** a new carton record every time an event is processed, but the carton already exists from a previous event. The `carton_id` has a UNIQUE constraint, causing the duplicate entry error.

## Solution

The backend should use **INSERT ... ON DUPLICATE KEY UPDATE** or check if carton exists before inserting.

### Option 1: INSERT ... ON DUPLICATE KEY UPDATE (Recommended)

**MySQL:**

```sql
INSERT INTO tabTransferInCarton (name, carton_id, transfer_in, status, created_by, created_at)
VALUES (?, ?, ?, 'Draft', ?, NOW())
ON DUPLICATE KEY UPDATE
  transfer_in = VALUES(transfer_in),
  updated_at = NOW()
```

**Benefits:**

- ✅ Handles both new and existing cartons
- ✅ Updates transfer_in if carton is reused
- ✅ Single SQL statement (atomic)
- ✅ No race conditions

### Option 2: Check Before Insert

**Pseudo-code:**

```javascript
// Check if carton exists
const existingCarton = await db.query(
  "SELECT carton_id FROM tabTransferInCarton WHERE carton_id = ?",
  [carton_id]
);

if (existingCarton.length === 0) {
  // Insert new carton
  await db.query(
    "INSERT INTO tabTransferInCarton (name, carton_id, transfer_in, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, NOW())",
    [name, carton_id, transfer_in, "Draft", created_by]
  );
} else {
  // Update existing carton (if needed)
  await db.query(
    "UPDATE tabTransferInCarton SET transfer_in = ?, updated_at = NOW() WHERE carton_id = ?",
    [transfer_in, carton_id]
  );
}
```

**Benefits:**

- ✅ Explicit control
- ✅ Can handle different update logic

**Drawbacks:**

- ⚠️ Two database queries (less efficient)
- ⚠️ Potential race condition if multiple events processed simultaneously

### Option 3: INSERT IGNORE

**MySQL:**

```sql
INSERT IGNORE INTO tabTransferInCarton (name, carton_id, transfer_in, status, created_by, created_at)
VALUES (?, ?, ?, 'Draft', ?, NOW())
```

**Benefits:**

- ✅ Simple
- ✅ No error on duplicate

**Drawbacks:**

- ⚠️ Doesn't update existing record
- ⚠️ Silently ignores duplicates (may not be desired)

## Recommended Implementation

### File: `src/modules/events/eventController.js`

**Current Code (Line ~1539):**

```javascript
// ❌ Current: Always tries to INSERT
await db.execute(
  `
  INSERT INTO tabTransferInCarton (name, carton_id, transfer_in, status, created_by, created_at)
  VALUES (?, ?, ?, 'Draft', ?, NOW())
`,
  [name, carton_id, transfer_in, created_by]
);
```

**Fixed Code:**

```javascript
// ✅ Fixed: Use ON DUPLICATE KEY UPDATE
await db.execute(
  `
  INSERT INTO tabTransferInCarton (name, carton_id, transfer_in, status, created_by, created_at)
  VALUES (?, ?, ?, 'Draft', ?, NOW())
  ON DUPLICATE KEY UPDATE
    transfer_in = VALUES(transfer_in),
    updated_at = NOW()
`,
  [name, carton_id, transfer_in, created_by]
);
```

## Why This Happens

### Scenario:

1. User scans item with carton `CTN-555445` → Event 1 created
2. Event 1 processed → Carton `CTN-555445` inserted into `tabTransferInCarton` ✅
3. User scans same item again with same carton → Event 2 created
4. Event 2 processed → Tries to insert `CTN-555445` again → ❌ Duplicate entry error

### Expected Behavior:

- Event 1: Insert carton `CTN-555445` ✅
- Event 2: Update carton `CTN-555445` (or skip if already exists) ✅
- Event 3: Update carton `CTN-555445` (or skip if already exists) ✅

## Impact

### Current Impact:

- ❌ Events fail to process when carton already exists
- ❌ `received_qty` not updated in Transfer In lines
- ❌ Mobile app shows events as synced, but backend didn't process them
- ❌ User sees items scanned, but quantities don't update

### After Fix:

- ✅ Events process successfully even if carton exists
- ✅ `received_qty` updates correctly
- ✅ Mobile app and backend stay in sync
- ✅ User can scan multiple items with same carton

## Testing

### Test Case 1: New Carton

1. Scan item with new carton `CTN-NEW-001`
2. **Expected**: Carton inserted, event processed successfully
3. **Result**: ✅ Should work

### Test Case 2: Existing Carton

1. Scan item with carton `CTN-555445` (already exists)
2. **Expected**: Carton updated (or skipped), event processed successfully
3. **Result**: ✅ Should work after fix

### Test Case 3: Multiple Events Same Carton

1. Scan item 1 with carton `CTN-555445` → Event 1
2. Scan item 2 with carton `CTN-555445` → Event 2
3. Scan item 3 with carton `CTN-555445` → Event 3
4. **Expected**: All events process successfully
5. **Result**: ✅ Should work after fix

## Additional Considerations

### Carton Status

If carton status needs to be updated:

```sql
INSERT INTO tabTransferInCarton (name, carton_id, transfer_in, status, created_by, created_at)
VALUES (?, ?, ?, 'Draft', ?, NOW())
ON DUPLICATE KEY UPDATE
  transfer_in = VALUES(transfer_in),
  status = 'Draft',  -- Reset to Draft if needed
  updated_at = NOW()
```

### Carton Name

If carton name might change:

```sql
INSERT INTO tabTransferInCarton (name, carton_id, transfer_in, status, created_by, created_at)
VALUES (?, ?, ?, 'Draft', ?, NOW())
ON DUPLICATE KEY UPDATE
  name = VALUES(name),  -- Update name if provided
  transfer_in = VALUES(transfer_in),
  updated_at = NOW()
```

## Summary

**Issue**: Backend tries to INSERT carton that already exists → Duplicate entry error

**Fix**: Use `INSERT ... ON DUPLICATE KEY UPDATE` to handle both new and existing cartons

**Impact**: Events will process successfully, `received_qty` will update correctly

**Priority**: **HIGH** - This is blocking event processing and quantity updates

---

## Quick Fix

Replace the INSERT statement in `eventController.js` (around line 1539) with:

```javascript
await db.execute(
  `
  INSERT INTO tabTransferInCarton (name, carton_id, transfer_in, status, created_by, created_at)
  VALUES (?, ?, ?, 'Draft', ?, NOW())
  ON DUPLICATE KEY UPDATE
    transfer_in = VALUES(transfer_in),
    updated_at = NOW()
`,
  [name, carton_id, transfer_in, created_by]
);
```

This will fix the duplicate entry error and allow events to process successfully.
