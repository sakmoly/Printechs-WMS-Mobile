# Expected Quantity API Verification

## Issue
Mobile app shows "Exp: 2" but backend shows "Expected Qty: 0.00" for all items.

## Verification Steps

### 1. Check Mobile App Database
The mobile app stores `expected_qty` in `cycle_count_lines` table. Verify it's stored correctly:
```sql
SELECT item_code, expected_qty, counted_qty, carton_id 
FROM cycle_count_lines 
WHERE session_id = ?;
```

### 2. Check What's Being Sent to Backend
The mobile app sends `expected_qty` in the `POST /api/cycle-count/{title}/count` request.

**Current Payload Structure:**
```json
{
  "counted_by": "USER-150526",
  "lines": [
    {
      "id": 1,
      "lineId": 1,
      "item_code": "SKU-JACKET-201-BLK-L",
      "actual_qty": 2,
      "counted_qty": 2,
      "expected_qty": 2,  // ✅ This SHOULD be sent
      "carton_id": "A1-R01-L2-B1",
      "bin_location": "A1-R01-L2-B1"
    }
  ]
}
```

### 3. Code Verification

#### Mobile App Code (cycle-count-sync.service.ts):
- **Line 391-395**: Checks if `expected_qty` exists and sends it, otherwise defaults to 0
- **Line 1115**: When scanning items, saves `expected_qty` from `getExpectedQty()` function
- **Line 769**: When loading expected items, saves `expected_qty` from stock ledger

#### API Service Code (api.service.ts):
- **Line 1966**: `expected_qty?: number | null` is defined in the TypeScript interface
- **Line 1973**: Makes POST request to `/api/cycle-count/${title}/count`

### 4. Enhanced Logging Added
✅ Added detailed logging to verify `expected_qty` is being sent:
- Logs `expected_qty` value from database
- Logs `expected_qty` value in each line object before sending
- Logs complete request body with `expected_qty` values
- Warns if `expected_qty` is undefined/null

## Expected Behavior

### When Item is Scanned:
1. If **NOT blind count**: `getExpectedQty()` is called → should return value from stock ledger or cycle_count_lines
2. `expected_qty` is saved to database (line 1115)
3. When syncing: `expected_qty` is retrieved from database and sent to backend (line 391-395)

### When Expected Items are Loaded:
1. `loadExpectedItems()` loads from stock ledger API or cache
2. Creates `cycle_count_lines` with `expected_qty` from stock ledger (line 796)
3. When syncing: `expected_qty` is sent to backend

## Troubleshooting

### Check Console Logs:
After scanning items and syncing, check console for:
```
📊 Database expected_qty values: [{item_code: "...", expected_qty: 2, ...}]
✅ Including expected_qty=2 for item SKU-JACKET-201-BLK-L
📤   Line 1 (SKU-JACKET-201-BLK-L): expected_qty=2, actual_qty=2, counted_qty=2
📦 Cycle Count Count Request: {
  "lines": [{
    "item_code": "SKU-JACKET-201-BLK-L",
    "expected_qty": 2,  // ✅ Should show value here
    ...
  }]
}
```

### If expected_qty shows as 0 or undefined:
1. Check database: `SELECT expected_qty FROM cycle_count_lines WHERE item_code = '...'`
2. Check if `getExpectedQty()` is returning correct value
3. Check if `loadExpectedItems()` is saving `expected_qty` correctly
4. Check if blind count is enabled (blinds count sets expected_qty to null)

## Backend Verification

### Check Backend API:
1. **Verify endpoint accepts `expected_qty`**: `POST /api/cycle-count/{title}/count`
2. **Check request body**: Backend should receive `expected_qty` in `lines` array
3. **Check database update**: Backend should UPDATE `expected_qty` in `tabcyclecountline` table
4. **Check if backend overwrites**: Backend might be resetting `expected_qty` to 0 during update

### Possible Backend Issues:
1. ✅ **Backend not accepting `expected_qty` field** - Backend ignores the field
2. ✅ **Backend overwriting `expected_qty`** - Backend sets it to 0 during UPDATE
3. ✅ **Backend only accepting `expected_qty` on CREATE** - UPDATE doesn't update `expected_qty`
4. ✅ **Backend field name mismatch** - Backend expects `expectedQty` (camelCase) instead of `expected_qty` (snake_case)

## API Request Format

### Current Mobile App Format:
```json
POST /api/cycle-count/CC-A1-R01-L2-B1-MK8K4A6R/count
{
  "counted_by": "USER-150526",
  "lines": [
    {
      "id": 1,
      "lineId": 1,
      "line_id": "LINE-1",
      "item_code": "SKU-JACKET-201-BLK-L",
      "barcode": "SKU-JACKET-201-BLK-L",
      "carton_id": "A1-R01-L2-B1",
      "actual_qty": 2,
      "counted_qty": 2,
      "expected_qty": 2,  // ✅ Mobile app sends this
      "bin_location": "A1-R01-L2-B1"
    }
  ]
}
```

### Backend Expected Format:
Verify with backend team what format they expect. Possible variations:
- `expected_qty` (snake_case) ✅ Currently sending
- `expectedQty` (camelCase) - Might need to send both
- Only accept on CREATE, not UPDATE - Backend might not update expected_qty on existing lines

## Next Steps

1. ✅ **Enhanced logging added** - Check console logs when syncing
2. ✅ **Verify database values** - Check `cycle_count_lines` table
3. ⏳ **Test sync and check logs** - Run sync and verify `expected_qty` in request
4. ⏳ **Backend verification** - Check backend API to see if it's receiving `expected_qty`
5. ⏳ **Backend database check** - Verify backend `tabcyclecountline` table after update

## Conclusion

**Mobile app IS sending `expected_qty`** based on code review. The issue is likely:
- Backend not accepting/saving the `expected_qty` field
- Backend overwriting `expected_qty` to 0 during UPDATE
- Backend field name mismatch (`expectedQty` vs `expected_qty`)

**Enhanced logging will help verify** what's actually being sent. Check console logs after next sync to see the actual values.
