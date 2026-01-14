# Transfer Carton Empty - Diagnosis Guide

## 🔍 Issue
Transfer Carton is created but Carton Contents table is empty (no items showing).

## ✅ Mobile App Status
**Mobile app is working correctly:**
- ✅ Packing events are being sent with `tc_id`
- ✅ Events include `item_code` and `qty`
- ✅ Events are sent to `/api/events/batch`

**Example event being sent:**
```json
{
  "offline_uuid": "pack-1768331801091-xehvf1q08",
  "event_type": "PACK_ITEM_TO_TC",
  "tc_id": "TC-MR-123462-1768331800903",
  "item_code": "SKU-HAT-301-BLU-OS",
  "qty": 2,
  "material_request": "MR-123462",
  "to_no": "MR-123462",
  "store": "STORE-001",
  "device_id": "DEV-LEH5-150526",
  "user_id": "USER-150526",
  "event_time": "2026-01-13T19:16:41.091Z",
  "synced": 0
}
```

## ❌ Backend Issue
**The problem is on the backend:**

### Possible Causes:
1. **Events not being saved to database**
   - Backend `/api/events/batch` endpoint may not be inserting events into `tabWmsScanEvent` table
   - Check backend logs for errors during event insertion

2. **Events saved but query not finding them**
   - Backend query for Carton Contents may have incorrect WHERE clause
   - Query should be:
     ```sql
     SELECT 
       item_code,
       carton_id AS source_carton,
       SUM(qty) AS quantity,
       MAX(user_id) AS packed_by,
       MAX(event_time) AS packed_on
     FROM tabWmsScanEvent
     WHERE tc_id = 'TC-MR-123462-1768331800903'
       AND event_type IN ('PACK_BOX_TO_TC', 'PACK_ITEM_TO_TC')
       AND item_code IS NOT NULL
       AND item_code != ''
       AND qty > 0
     GROUP BY item_code, carton_id
     ```

3. **Events being rejected silently**
   - Backend may be returning success but not actually saving events
   - Check batch response for `inserted_count` or `events_saved_to_backend` flag

## 🔍 Diagnostic Steps

### Step 1: Check Backend Logs
Look for:
- `/api/events/batch` request received
- Events being inserted into `tabWmsScanEvent`
- Any errors during insertion

### Step 2: Check Database
Run this SQL query on the backend:
```sql
-- Check if events exist for this TC
SELECT 
  offline_uuid,
  event_type,
  tc_id,
  item_code,
  qty,
  event_time,
  synced
FROM tabWmsScanEvent
WHERE tc_id = 'TC-MR-123462-1768331800903'
  AND event_type = 'PACK_ITEM_TO_TC'
ORDER BY event_time DESC;
```

**Expected:** Should return at least 1 row with the item

**If empty:** Events are not being saved to database (backend issue)

### Step 3: Check Batch Response
Look at mobile app logs for:
```
📥 Batch response received: {...}
✅ Packing events response summary: {...}
```

Check for:
- `inserted_count` > 0
- `events_saved_to_backend: true`
- `acked_count` > 0

**If all are 0 or false:** Backend is not saving events

### Step 4: Verify Backend Endpoint
Test the `/api/events/batch` endpoint directly:
```bash
POST http://YOUR_API_URL/api/events/batch
Content-Type: application/json

{
  "events": [
    {
      "offline_uuid": "test-123",
      "event_type": "PACK_ITEM_TO_TC",
      "tc_id": "TC-MR-123462-1768331800903",
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 2,
      "material_request": "MR-123462",
      "to_no": "MR-123462",
      "store": "STORE-001",
      "device_id": "DEV-LEH5-150526",
      "user_id": "USER-150526",
      "event_time": "2026-01-13T19:16:41.091Z",
      "synced": 0
    }
  ]
}
```

**Expected response:**
```json
{
  "acked_count": 1,
  "failed_count": 0,
  "inserted_count": 1,
  "events_saved_to_backend": true,
  "acked_uuids_preview": ["test-123"]
}
```

## ✅ Backend Fix Required

The backend `/api/events/batch` endpoint must:

1. **Insert events into `tabWmsScanEvent` table**
   - Ensure `tc_id` is saved correctly
   - Ensure `item_code` is saved correctly
   - Ensure `qty` is saved correctly

2. **Return proper response**
   - Include `inserted_count` in response
   - Include `events_saved_to_backend: true` if saved
   - Include `acked_count` matching number of events sent

3. **Query for Carton Contents**
   - Use the SQL query shown above
   - Ensure `tc_id` matching is correct
   - Ensure `event_type` filter includes `'PACK_ITEM_TO_TC'`

## 📋 Summary

**Status:** ✅ Mobile app is working correctly  
**Issue:** ❌ Backend is not saving events or query is incorrect  
**Action Required:** Backend team needs to:
1. Verify events are being inserted into `tabWmsScanEvent`
2. Check Carton Contents query is correct
3. Ensure batch response indicates success

**Date:** 2026-01-13  
**TC ID:** `TC-MR-123462-1768331800903`
