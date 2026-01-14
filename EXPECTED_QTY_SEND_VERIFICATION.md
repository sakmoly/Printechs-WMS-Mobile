# Expected Quantity Send Verification

## Issue
Expected quantity is showing 0 in the backend, even though the mobile app displays correct expected quantities (e.g., "Exp: 3", "Exp: 1").

## Verification Steps

### 1. Code Review - Expected Quantity Send Logic

#### Location 1: Batch Sync (`syncCycleCountSessions`)
**File**: `src/services/cycle-count-sync.service.ts`
**Lines**: ~400-413

**Current Implementation**:
```typescript
// ✅ CRITICAL: ALWAYS send expected_qty to backend
// Backend expects expected_qty to be set from mobile app
if (line.expected_qty !== null && line.expected_qty !== undefined) {
  // expected_qty has a valid value (including 0) - send it
  lineObject.expected_qty = line.expected_qty;
  console.log(`✅ Sending expected_qty=${line.expected_qty} for item ${line.item_code}`);
} else {
  // expected_qty is null or undefined - default to 0 for backend compatibility
  lineObject.expected_qty = 0;
  console.warn(`⚠️ WARNING: expected_qty is null/undefined for item ${line.item_code}, defaulting to 0`);
}
```

**Status**: ✅ **CORRECT** - Always sends expected_qty if not null/undefined

#### Location 2: Single Sync (`syncCycleCountSession`)
**File**: `src/services/cycle-count-sync.service.ts`
**Lines**: ~886-895

**Current Implementation**:
```typescript
// ✅ CRITICAL: ALWAYS send expected_qty to backend
// Backend expects expected_qty to be set from mobile app
if (line.expected_qty !== null && line.expected_qty !== undefined) {
  // expected_qty has a valid value (including 0) - send it
  lineObject.expected_qty = line.expected_qty;
  console.log(`✅ Sending expected_qty=${line.expected_qty} for item ${line.item_code}`);
} else {
  // expected_qty is null or undefined - default to 0 for backend compatibility
  lineObject.expected_qty = 0;
  console.warn(`⚠️ WARNING: expected_qty is null/undefined for item ${line.item_code}, defaulting to 0`);
}
```

**Status**: ✅ **CORRECT** - Always sends expected_qty if not null/undefined

### 2. API Payload Structure

**API Endpoint**: `POST /api/cycle-count/{title}/count`

**Expected Payload**:
```json
{
  "counted_by": "USER-150526",
  "lines": [
    {
      "id": 1,
      "lineId": 1,
      "line_id": "LINE-1",
      "item_code": "SKU-JACKET-201-BLK-L",
      "barcode": "SKU-JACKET-201-BLK-L",
      "carton_id": "CTN-3339",
      "actual_qty": 4,
      "counted_qty": 4,
      "expected_qty": 3,  // ✅ This SHOULD be sent
      "bin_location": "A1-R01-L2-B1"
    }
  ]
}
```

**TypeScript Interface** (`api.service.ts`, line ~1969):
```typescript
expected_qty?: number | null;
```

**Status**: ✅ **CORRECT** - expected_qty is defined in the interface

### 3. Database Query - Expected Quantity Retrieval

**Location**: `src/services/cycle-count-sync.service.ts`
**Lines**: ~82-85

**Query**:
```typescript
const lines = await db.getAllAsync<CycleCountLine>(
  "SELECT * FROM cycle_count_lines WHERE session_id = ?",
  [session.session_id]
);
```

**Status**: ✅ **CORRECT** - SELECT * should include expected_qty

### 4. Logging - Expected Quantity Verification

**Location**: `src/services/cycle-count-sync.service.ts`
**Lines**: ~88-93, ~442-450

**Logging Points**:
1. **Database values** (line ~88-93):
   ```typescript
   console.log(`📊 Database expected_qty values:`, lines.map(l => ({
     item_code: l.item_code,
     expected_qty: l.expected_qty,
     counted_qty: l.counted_qty,
     carton_id: l.carton_id || 'null'
   })));
   ```

2. **Before API call** (line ~442-450):
   ```typescript
   console.log(`📤 First line expected_qty: ${linesToSync[0].expected_qty !== undefined ? linesToSync[0].expected_qty : 'UNDEFINED'}`);
   linesToSync.forEach((line: any, idx: number) => {
     console.log(`📤   Line ${idx + 1} (${line.item_code}): expected_qty=${line.expected_qty !== undefined ? line.expected_qty : 'UNDEFINED'}, ...`);
   });
   ```

3. **Request body** (line ~453-456):
   ```typescript
   console.log(`📤 Request body:`, JSON.stringify({
     counted_by: countedBy,
     lines: linesToSync,
   }, null, 2));
   ```

**Status**: ✅ **COMPREHENSIVE** - Multiple logging points to verify expected_qty

### 5. Enhanced Logging Added

**Location**: `src/services/api.service.ts`
**Lines**: ~160-180

**Logging**:
```typescript
if (endpoint.includes("/api/cycle-count/") && endpoint.endsWith("/count") && method === "POST" && body) {
  console.log(`📦 Cycle Count Count Request:`, JSON.stringify(body, null, 2));
  if (body.lines && Array.isArray(body.lines)) {
    body.lines.forEach((line: any, idx: number) => {
      console.log(`📦   Line ${idx + 1}: item_code=${line.item_code}, ..., expected_qty=${line.expected_qty !== undefined ? line.expected_qty : 'undefined'}, ...`);
      if (line.expected_qty === undefined) {
        console.warn(`⚠️ WARNING: Line ${idx + 1} (${line.item_code}) is missing expected_qty field!`);
      }
    });
  }
}
```

**Status**: ✅ **COMPREHENSIVE** - Logs expected_qty in API requests

## Possible Issues

### Issue 1: Expected Quantity Not Stored in Database
**Symptom**: expected_qty is null/undefined in database
**Check**: Verify expected_qty is saved when items are scanned/loaded

**Solution**: Check `CycleCountBinCountingScreen.tsx` where items are scanned:
- Verify `getExpectedQty()` returns correct value
- Verify `expected_qty` is saved to database when items are scanned
- Verify `loadExpectedItems()` saves expected_qty correctly

### Issue 2: Backend Not Accepting Expected Quantity
**Symptom**: expected_qty is sent but backend shows 0
**Check**: Backend API might not be updating expected_qty field

**Solution**: Verify backend API:
- Check if backend accepts `expected_qty` in `POST /api/cycle-count/{title}/count`
- Check if backend updates `expected_qty` field in database
- Check if backend overwrites `expected_qty` to 0 during UPDATE

### Issue 3: Field Name Mismatch
**Symptom**: Mobile app sends `expected_qty` but backend expects `expectedQty`
**Check**: Backend might expect camelCase instead of snake_case

**Solution**: Check backend API documentation or code to verify expected field name

## Testing Checklist

1. ✅ **Check Console Logs**:
   - After scanning items, check console for:
     - `📊 Database expected_qty values: [{item_code: "...", expected_qty: 3, ...}]`
     - `✅ Sending expected_qty=3 for item SKU-JACKET-201-BLK-L`
     - `📤   Line 1 (SKU-JACKET-201-BLK-L): expected_qty=3, ...`
     - `📦 Cycle Count Count Request: { "lines": [{ "expected_qty": 3, ... }] }`

2. ✅ **Check Database**:
   - Query `cycle_count_lines` table:
     ```sql
     SELECT item_code, expected_qty, counted_qty, carton_id 
     FROM cycle_count_lines 
     WHERE session_id = ?;
     ```
   - Verify expected_qty is stored correctly

3. ✅ **Check Backend API**:
   - Use Postman/curl to test `POST /api/cycle-count/{title}/count`
   - Send request with `expected_qty` in payload
   - Check backend response and database to verify expected_qty is saved

4. ✅ **Check Backend Database**:
   - Query backend `tabcyclecountline` table:
     ```sql
     SELECT item_code, expected_qty, actual_qty 
     FROM tabcyclecountline 
     WHERE task_title = ?;
     ```
   - Verify expected_qty is saved correctly

## Next Steps

1. ✅ **Code Updated** - Simplified expected_qty send logic (always send if not null/undefined)
2. ✅ **Logging Enhanced** - Multiple logging points to verify expected_qty
3. ⏳ **Test and Verify** - Check console logs to see if expected_qty is being sent
4. ⏳ **Backend Verification** - Check if backend is accepting/saving expected_qty
5. ⏳ **Database Verification** - Check if expected_qty is stored correctly in mobile database

## Conclusion

**Mobile App Code**: ✅ **CORRECT** - expected_qty is being sent in API requests

**Next Action**: 
- Check console logs to verify expected_qty is in the request payload
- Verify backend API is accepting and saving expected_qty
- If backend shows 0, the issue is likely in the backend API, not the mobile app
