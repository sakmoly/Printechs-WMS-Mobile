# Backend Putaway API: Remove 'rack' Field Fix

**Date**: 2026-01-17  
**Issue**: Backend database error when mobile app sends `rack` field in putaway request

---

## Problem

### Error:
```
API error (500): {
  "code": "DATABASE_ERROR",
  "message": "Failed to process transfer carton for putaway",
  "details": {
    "message": "Unknown column 'rack' in 'field list'",
    "type": "Error",
    "code": "ER_BAD_FIELD_ERROR",
    "sqlMessage": "Unknown column 'rack' in 'field list'",
    "sqlState": "42S22"
  }
}
```

### Root Cause:
- Mobile app was sending `rack` field in putaway request
- Backend database table doesn't have a `rack` column
- Backend SQL query fails when trying to insert/update `rack` field

### Request Being Sent:
```json
{
  "location_id": "A1-R02-L2-B2",
  "rack": "A1-R02-L2-B2",  // ❌ This field doesn't exist in backend DB
  "bin": "B2",
  "user_id": "USER-294226",
  "box_id": "PAW-ASN365425473-1768809777376",
  "tc_id": "PAW-ASN365425473-1768809777376"
}
```

---

## Mobile App Fix

### ✅ Changes Made:

1. **`src/services/api.service.ts`** - `scanTransferCarton` function:
   - Removed `rack` field from request before sending to backend
   - Added warning log when `rack` is provided (for debugging)
   - Kept `rack` in TypeScript interface for backward compatibility (marked as deprecated)

2. **`src/screens/PutAwayScreen.tsx`** - Putaway location scan:
   - Removed `rack` field from request body
   - Added comment explaining why it was removed

### Code Changes:

**Before:**
```typescript
const requestBody: any = {
  location_id: locationIdUpper,
  rack: rack, // Backward compatibility: also send rack
  bin: bin,
  user_id: settings.user_id || settings.user_code || undefined,
};
```

**After:**
```typescript
const requestBody: any = {
  location_id: locationIdUpper, // Primary: send location_id
  // ❌ REMOVED: rack field - backend database doesn't have 'rack' column
  bin: bin, // Backward compatibility: also send bin (if available)
  user_id: settings.user_id || settings.user_code || undefined,
};
```

**API Service:**
```typescript
scanTransferCarton: async (data: {
  // ... other fields
  rack?: string; // ❌ DEPRECATED: Backend doesn't support 'rack' column
}) => {
  // Remove 'rack' field from request
  const { rack, ...requestData } = data;
  if (rack) {
    console.warn(`⚠️ Removed 'rack' field from putaway request (backend doesn't support it). Using location_id instead.`);
  }
  return makeRequest("/api/putaway/scan-transfer-carton", "POST", requestData);
}
```

---

## Impact

### ✅ Benefits:
1. **No more 500 errors** - Request won't fail due to missing `rack` column
2. **Cleaner API** - Only sends fields that backend supports
3. **Event fallback still works** - If API fails for other reasons, event-based tracking continues to work

### ⚠️ Note:
- Mobile app was already handling this gracefully with event-based fallback
- Events are being saved successfully (`PUTAWAY_TO_RACK` event synced)
- This fix prevents the API error, but event-based tracking will still work as backup

---

## Backend Requirements (Optional)

If backend wants to support `rack` field in the future:

1. **Add `rack` column to database table:**
   ```sql
   ALTER TABLE tabputaway_task 
   ADD COLUMN rack VARCHAR(255) NULL;
   ```

2. **Update API endpoint** to accept and store `rack` field:
   ```javascript
   // In backend: POST /api/putaway/scan-transfer-carton
   if (req.body.rack) {
     putawayTask.rack = req.body.rack;
   }
   ```

3. **For now**: Backend can safely ignore `rack` field (mobile app no longer sends it)

---

## Testing

### Test Scenarios:

1. **Putaway with location scan:**
   - Scan putaway box: `PAW-ASN365425473-1768809777376`
   - Scan location: `A1-R02-L2-B2`
   - ✅ Should NOT see 500 error
   - ✅ Should see success message
   - ✅ Event should be saved (`PUTAWAY_TO_RACK`)

2. **Check console logs:**
   - Should NOT see: `Unknown column 'rack' in 'field list'`
   - Should see: `✅ Putaway API call succeeded` (if API works)
   - OR: `⚠️ Putaway API database error - using event-based approach` (if API fails for other reasons)

3. **Verify event sync:**
   - Check that `PUTAWAY_TO_RACK` event is synced to backend
   - Event should contain `location_id` (not `rack`)

---

## Files Modified

1. **`src/services/api.service.ts`**
   - Removed `rack` field from request in `scanTransferCarton`

2. **`src/screens/PutAwayScreen.tsx`**
   - Removed `rack` field from request body
   - Added comment explaining removal

---

## Status

✅ **FIXED** - Mobile app no longer sends `rack` field to backend

The putaway operation will now:
- ✅ Send only `location_id` (not `rack`)
- ✅ Not cause 500 database errors
- ✅ Continue using event-based fallback if API fails for other reasons
- ✅ Successfully sync `PUTAWAY_TO_RACK` events to backend
