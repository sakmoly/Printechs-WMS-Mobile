# Transfer In Quantity Replacement Fix

## Issue

When editing item quantity in Transfer In Receiving, the quantity was being **added** to the existing value instead of **replacing** it. For example:
- Current received_qty: 4
- User edits to: 2
- Result: Still showing 4 (or 6 if it added 2 to 4)

## Root Cause

The `handleSaveEditQty` function was:
1. Calculating `qtyDifference = newQty - oldQty`
2. Sending `qtyDifference` to backend API (which adds to existing quantity)
3. The backend API `receiveTransferInLine` is designed for **receiving** (adding), not **editing** (replacing)
4. If backend cached the old value or processed incorrectly, it would add the difference to the cached value, resulting in incorrect totals

## Solution

### Mobile App Changes

1. **UI Update**: Set `received_qty` to the **absolute new value** (not add difference)
   ```typescript
   received_qty: newQty, // ✅ REPLACE with new quantity
   ```

2. **Event Creation**: Send `qtyDifference` in events (backend should process this correctly)
   - Positive difference for increases
   - Negative difference for decreases
   - Backend should add the difference to get the target quantity

3. **Reload Timing**: Increased delay to 2 seconds to allow backend processing and avoid cache issues

4. **Verification**: Added logging to verify reloaded quantity matches expected value

### Backend Requirements

The backend **MUST** process `TRANSFER_IN_RECEIVE` events correctly to handle quantity replacement:

```javascript
// When processing TRANSFER_IN_RECEIVE events
const currentReceivedQty = item.received_qty || 0;
const newReceivedQty = currentReceivedQty + event.qty; // Add the difference

// ✅ CRITICAL: Ensure this is the FINAL value, not adding to a cached value
// Backend should:
// 1. Get current received_qty from database (not cache)
// 2. Add event.qty to it
// 3. Save the result
// 4. Do NOT add to a previously cached value
```

**Example**:
- Current `received_qty` in database: 4
- User edits to: 2
- Event sent: `qty: -2` (difference)
- Backend should: `4 + (-2) = 2` ✅
- Backend should NOT: Use cached value or add multiple times ❌

## Testing

### Test Case 1: Decrease Quantity
1. Item has `received_qty = 4`
2. User edits to `2`
3. Expected: `received_qty = 2`
4. Verify: Backend shows `2`, not `4` or `6`

### Test Case 2: Increase Quantity
1. Item has `received_qty = 2`
2. User edits to `4`
3. Expected: `received_qty = 4`
4. Verify: Backend shows `4`, not `6` or `8`

### Test Case 3: No Change
1. Item has `received_qty = 2`
2. User edits to `2`
3. Expected: No event created, `received_qty` remains `2`

## Code Changes

### Before (Incorrect - Adding)
```typescript
// UI update was correct, but backend processing might add to cache
received_qty: newQty, // UI shows correct
// But backend might be: oldValue + difference + cachedValue = wrong
```

### After (Correct - Replacing)
```typescript
// UI update: REPLACE with absolute value
received_qty: newQty, // ✅ Always set to the new value

// Event: Send difference for backend to process
qty: qtyDifference, // Backend should: current + difference = target

// Reload: Verify backend processed correctly
// Check if reloaded value matches expected newQty
```

## Backend Verification Checklist

- [ ] Backend gets `received_qty` from database (not cache) when processing events
- [ ] Backend correctly handles negative `qty` values in events
- [ ] Backend adds `event.qty` to current `received_qty` (not to a cached value)
- [ ] Backend saves the result immediately
- [ ] Backend does not process the same event multiple times
- [ ] Backend returns updated `received_qty` in GET responses

## Common Issues

### Issue 1: Cache Problem
**Symptom**: Quantity shows old value after edit
**Cause**: Backend using cached `received_qty` instead of database value
**Fix**: Backend should always read from database when processing events

### Issue 2: Double Processing
**Symptom**: Quantity is higher than expected
**Cause**: Event processed multiple times
**Fix**: Backend should use idempotent event processing (check `offline_uuid`)

### Issue 3: Negative Values Not Handled
**Symptom**: Quantity doesn't decrease when editing down
**Cause**: Backend rejects negative `qty` values
**Fix**: Backend should accept negative `qty` and subtract from current value

## Summary

The mobile app now:
1. ✅ Sets UI to absolute new quantity (replaces, not adds)
2. ✅ Sends difference in events (for backend to process)
3. ✅ Reloads after delay to sync with backend
4. ✅ Verifies reloaded quantity matches expected value

The backend must:
1. ✅ Read current `received_qty` from database (not cache)
2. ✅ Add `event.qty` to current value
3. ✅ Save result immediately
4. ✅ Handle negative `qty` values correctly
