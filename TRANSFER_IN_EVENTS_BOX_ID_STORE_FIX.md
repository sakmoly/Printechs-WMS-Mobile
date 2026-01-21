# Transfer In Events: box_id and store NULL Fix

## Date: 2026-01-20
## Status: ✅ **FIXED**

---

## 🚨 Problem

**Issue 1:** `box_id` and `store` are NULL in `tabwmsscanevent` for Transfer In events

**Issue 2:** `warehouse` showing as `false` in putaway task creation logs

---

## 📋 Root Cause

### Issue 1: Missing `box_id` and `store` in TRANSFER_IN_RECEIVE Events

**Problem:**
- `TRANSFER_IN_RECEIVE` events were not including `box_id` and `store` fields
- This caused `tabwmsscanevent.box_id` and `tabwmsscanevent.store` to be NULL

**Location:**
- `src/screens/TransferInReceivingScanItemsScreen.tsx`
- Lines 668-676: `TRANSFER_IN_RECEIVE` event creation (item scan)
- Lines 942-950: `TRANSFER_IN_RECEIVE` event creation (quantity edit)

**Fix:**
- ✅ Added `box_id` field (using `cartonId` for Transfer In)
- ✅ Added `store` field (using `to_warehouse` from Transfer In)

### Issue 2: `warehouse=false` in Putaway Task Creation

**Problem:**
- Backend log shows `warehouse=false` when creating putaway task
- This is a backend issue, not a mobile app issue

**Location:**
- Backend: `transferInController.js` (putaway task creation)
- The backend is checking if `warehouse` column exists in `tabPutawayTask` table
- If column doesn't exist, it logs `warehouse=false`

**Status:**
- ⚠️ This is a backend issue
- Mobile app is not involved in putaway task creation (backend creates it automatically)
- Backend needs to ensure `warehouse` column exists or handle it correctly

---

## ✅ Fixes Implemented

### Fix 1: Added `box_id` and `store` to TRANSFER_IN_RECEIVE Events

**File:** `src/screens/TransferInReceivingScanItemsScreen.tsx`

**Change 1: Item Scan Event (lines 667-677)**
```typescript
// ✅ CRITICAL: Get warehouse/store from Transfer In details for events
// For Transfer In, warehouse = to_warehouse from Transfer In
const transferInWarehouse = transferIn?.to_warehouse || transferIn?.warehouse || "WH-MAIN";

// ✅ CRITICAL: Get box_id (carton_id) for Transfer In events
// For Transfer In, box_id = carton_id (CTN-TI-* format)
const eventBoxId = boxId || cartonId;

// Also create TRANSFER_IN_RECEIVE event for backend processing
await addEvent({
  event_type: "TRANSFER_IN_RECEIVE",
  transfer_in: transferInNo,
  carton_id: cartonId,
  box_id: eventBoxId, // ✅ CRITICAL: Include box_id (carton_id for Transfer In)
  item_code: finalItemCode,
  qty: 1,
  store: transferInWarehouse, // ✅ CRITICAL: Include store (to_warehouse for Transfer In)
  device_id: settings.device_id ?? undefined,
  user_id: settings.user_id || settings.user_code || "USER",
});
```

**Change 2: Quantity Edit Event (lines 942-950)**
```typescript
// ✅ CRITICAL: Get warehouse/store from Transfer In details for events
const transferInWarehouse = transferIn?.to_warehouse || transferIn?.warehouse || "WH-MAIN";
const eventBoxId = boxId || cartonId;

await addEvent({
  event_type: "TRANSFER_IN_RECEIVE",
  transfer_in: transferInNo,
  carton_id: cartonId,
  box_id: eventBoxId, // ✅ CRITICAL: Include box_id
  item_code: editModal.item.item_code,
  qty: qtyDifference,
  store: transferInWarehouse, // ✅ CRITICAL: Include store
  device_id: settings.device_id ?? undefined,
  user_id: settings.user_id || settings.user_code || "USER",
});
```

---

## 📋 Event Format (After Fix)

### TRANSFER_IN_RECEIVE Event

**Before (❌ Missing fields):**
```json
{
  "event_type": "TRANSFER_IN_RECEIVE",
  "transfer_in": "INSLIP-123457",
  "carton_id": "CTN-TI-123457-20260120-221653-755",
  "item_code": "SKU-HAT-301-BLU-OS",
  "qty": 1,
  "box_id": null,  // ❌ Missing
  "store": null    // ❌ Missing
}
```

**After (✅ Complete):**
```json
{
  "event_type": "TRANSFER_IN_RECEIVE",
  "transfer_in": "INSLIP-123457",
  "carton_id": "CTN-TI-123457-20260120-221653-755",
  "box_id": "CTN-TI-123457-20260120-221653-755",  // ✅ Included
  "item_code": "SKU-HAT-301-BLU-OS",
  "qty": 1,
  "store": "WH-MAIN",  // ✅ Included (from to_warehouse)
  "device_id": "DEVICE-001",
  "user_id": "USER-402498"
}
```

### SORT_TO_BOX Event (Already Correct)

**Current Format (✅ Already includes box_id and store):**
```json
{
  "event_type": "SORT_TO_BOX",
  "transfer_in": "INSLIP-123457",
  "carton_id": "CTN-TI-123457-20260120-221653-755",
  "item_code": "SKU-HAT-301-BLU-OS",
  "box_id": "CTN-TI-123457-20260120-221653-755",  // ✅ Already included
  "store": "WH-MAIN",  // ✅ Already included
  "qty": 1
}
```

---

## ⚠️ Issue 2: warehouse=false in Putaway Task Creation

**Problem:**
Backend log shows:
```
📝 Generated Putaway Task title: PUT-20260120-0001 (columns: source_type=true, transfer_in=true, warehouse=false)
```

**Root Cause:**
- Backend is checking if `warehouse` column exists in `tabPutawayTask` table
- If column doesn't exist, it logs `warehouse=false`
- This is a backend database schema issue

**Impact:**
- Putaway task is still created successfully
- But `warehouse` field may not be set correctly in the database
- This could affect stock updates and location assignments

**Backend Fix Required:**
1. **Option 1:** Add `warehouse` column to `tabPutawayTask` table
2. **Option 2:** Backend should use `to_warehouse` from `tabTransferIn` when creating putaway task
3. **Option 3:** Backend should handle missing `warehouse` column gracefully

**Mobile App Status:**
- ✅ Mobile app is not involved in putaway task creation
- ✅ Mobile app correctly sends `warehouse` in `completePutaway` request
- ⚠️ Backend needs to fix putaway task creation to include `warehouse`

---

## 📝 Files Modified

1. **src/screens/TransferInReceivingScanItemsScreen.tsx**
   - Lines 667-677: Added `box_id` and `store` to `TRANSFER_IN_RECEIVE` event (item scan)
   - Lines 942-950: Added `box_id` and `store` to `TRANSFER_IN_RECEIVE` event (quantity edit)

---

## 🧪 Testing

### Test Case 1: TRANSFER_IN_RECEIVE Event with box_id and store

1. Scan item in Transfer In Receiving
2. ✅ Verify `TRANSFER_IN_RECEIVE` event includes:
   - `box_id`: `CTN-TI-...` (carton_id)
   - `store`: `WH-MAIN` (from to_warehouse)
3. ✅ Verify `tabwmsscanevent` has:
   - `box_id` populated
   - `store` populated

### Test Case 2: Quantity Edit Event

1. Edit item quantity in Transfer In Receiving
2. ✅ Verify `TRANSFER_IN_RECEIVE` event includes:
   - `box_id`: `CTN-TI-...`
   - `store`: `WH-MAIN`
3. ✅ Verify `tabwmsscanevent` has:
   - `box_id` populated
   - `store` populated

---

## ✅ Summary

**Issue 1: box_id and store NULL** ✅ **FIXED**
- Added `box_id` to `TRANSFER_IN_RECEIVE` events
- Added `store` to `TRANSFER_IN_RECEIVE` events
- `box_id` = `cartonId` (CTN-TI-* format)
- `store` = `to_warehouse` from Transfer In

**Issue 2: warehouse=false** ⚠️ **BACKEND ISSUE**
- Backend needs to fix putaway task creation
- Mobile app is not involved
- Backend should ensure `warehouse` column exists or use `to_warehouse` from Transfer In

**Status:**
- ✅ Mobile app fixes complete
- ⚠️ Backend fix needed for `warehouse=false` issue

---

**Last Updated:** 2026-01-20
