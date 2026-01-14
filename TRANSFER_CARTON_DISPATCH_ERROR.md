# Transfer Carton Dispatch Error - Backend Issue

## 🐛 Error

**Error Message:**
```
API error (500): {
  "code": "DATABASE_ERROR",
  "message": "Failed to dispatch transfer carton",
  "details": "itemCodes is not defined"
}
```

## ✅ Mobile App Status

**Mobile app is sending correct data:**

**Request:**
```json
POST /api/transfer-cartons/dispatch
{
  "tc_id": "TC-MR-1401263-1768385348746",
  "dispatched_by": "USER-150526"
}
```

**Packing Events Already Sent:**
The mobile app has already sent packing events with `tc_id` linking items to the Transfer Carton:
```json
{
  "events": [
    {
      "event_type": "PACK_ITEM_TO_TC",
      "tc_id": "TC-MR-1401263-1768385348746",
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 2,
      "source_bin": "A1-R01-L3-B1",
      "carton_id": "CTN-555444"
    },
    {
      "event_type": "PACK_ITEM_TO_TC",
      "tc_id": "TC-MR-1401263-1768385348746",
      "item_code": "SKU-SHOES-101-BLK-43",
      "qty": 5,
      "source_bin": "A1-R01-L3-B1",
      "carton_id": "CTN-555444"
    }
  ]
}
```

## ❌ Backend Issue

**Error:** `itemCodes is not defined`

This is a **JavaScript runtime error** in the backend code. The backend is trying to use a variable `itemCodes` that doesn't exist.

### Possible Causes:

1. **Backend trying to extract item codes from request body**
   - Backend may be expecting `itemCodes` in the request
   - But mobile app is only sending `tc_id` and `dispatched_by`

2. **Backend trying to get item codes from Transfer Carton**
   - Backend should query `tabWmsScanEvent` for items with `tc_id`
   - But the code might be trying to use `itemCodes` variable that was never defined

3. **Backend code bug**
   - Variable `itemCodes` was declared but not initialized
   - Or variable name typo (e.g., `itemCodes` vs `item_codes`)

## 🔧 Backend Fix Required

### Option 1: Get Item Codes from Events (Recommended)

The backend should query `tabWmsScanEvent` to get item codes for the Transfer Carton:

```javascript
// Backend code (example)
const getItemCodesFromEvents = async (tc_id) => {
  const events = await db.query(`
    SELECT DISTINCT item_code 
    FROM tabWmsScanEvent 
    WHERE tc_id = ? 
      AND event_type IN ('PACK_ITEM_TO_TC', 'PACK_BOX_TO_TC')
      AND item_code IS NOT NULL
      AND item_code != ''
  `, [tc_id]);
  
  return events.map(e => e.item_code);
};

// In dispatch handler:
const itemCodes = await getItemCodesFromEvents(tc_id);
// Now itemCodes is defined and can be used
```

### Option 2: Get Item Codes from Transfer Carton Items Table

If the backend has a `tabTransferCartonItem` or similar table:

```javascript
const itemCodes = await db.query(`
  SELECT DISTINCT item_code 
  FROM tabTransferCartonItem 
  WHERE tc_id = ?
`, [tc_id]);
```

### Option 3: Accept Item Codes in Request (Not Recommended)

If backend requires `itemCodes` in request, mobile app would need to:
1. Query events to get item codes
2. Send them in dispatch request

But this is redundant since backend can query events directly.

## 🔍 Diagnostic Steps

### Step 1: Check Backend Code

Look for where `itemCodes` is being used in the dispatch handler:
```javascript
// Find this in backend code:
// POST /api/transfer-cartons/dispatch handler

// Look for:
itemCodes.forEach(...)  // ❌ itemCodes is not defined
// or
const result = processItems(itemCodes);  // ❌ itemCodes is not defined
```

### Step 2: Check Backend Logs

Look for:
- Request received: `{ tc_id: "TC-MR-...", dispatched_by: "USER-..." }`
- Error: `itemCodes is not defined`
- Stack trace showing where `itemCodes` is used

### Step 3: Verify Events Exist

Run this SQL query on backend:
```sql
SELECT 
  item_code,
  qty,
  event_time
FROM tabWmsScanEvent
WHERE tc_id = 'TC-MR-1401263-1768385348746'
  AND event_type = 'PACK_ITEM_TO_TC'
ORDER BY event_time DESC;
```

**Expected:** Should return 2 rows (one for each item)

## ✅ Expected Backend Fix

The backend dispatch handler should:

1. **Get `tc_id` from request body** ✅ (already receiving)
2. **Query `tabWmsScanEvent` for items with this `tc_id`** ❌ (missing)
3. **Extract `itemCodes` from events** ❌ (missing)
4. **Process dispatch with item codes** ❌ (failing because itemCodes not defined)

**Fixed Backend Code (pseudo-code):**
```javascript
async function dispatchTransferCarton(req, res) {
  const { tc_id, dispatched_by } = req.body;
  
  // ✅ Get item codes from events
  const events = await db.query(`
    SELECT DISTINCT item_code 
    FROM tabWmsScanEvent 
    WHERE tc_id = ? 
      AND event_type IN ('PACK_ITEM_TO_TC', 'PACK_BOX_TO_TC')
      AND item_code IS NOT NULL
  `, [tc_id]);
  
  const itemCodes = events.map(e => e.item_code);  // ✅ Now itemCodes is defined!
  
  // Now can use itemCodes
  for (const itemCode of itemCodes) {
    // Process dispatch for each item
  }
  
  // Update Transfer Carton status
  await db.update('tabTransferCarton', { 
    status: 'Dispatched',
    dispatched_by: dispatched_by,
    dispatched_on: new Date()
  }, { tc_id });
  
  res.json({ success: true, itemCodes });
}
```

## 📋 Summary

**Status:** ✅ Mobile app is working correctly  
**Issue:** ❌ Backend JavaScript error - `itemCodes is not defined`  
**Action Required:** Backend team needs to:
1. Query `tabWmsScanEvent` to get item codes for the `tc_id`
2. Define `itemCodes` variable before using it
3. Use `itemCodes` to process dispatch

**Date:** 2026-01-14  
**TC ID:** `TC-MR-1401263-1768385348746`
