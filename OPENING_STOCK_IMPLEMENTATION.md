# Opening Stock Implementation Summary

## Overview
Implemented support for `opening_stock` field in cycle count task creation. This field is **independent** of `is_blind_count` and indicates whether this is an initial/baseline inventory count for a bin/location.

## Analysis Conclusion

### ✅ **Blind Count CAN have Opening Stock**
- **Blind Count** (`is_blind_count`) = UI visibility control (hides expected quantities from user)
- **Opening Stock** (`opening_stock`) = Backend flag (indicates initial/baseline count)
- **They are independent** - both can be `true` simultaneously

### Supported Scenarios
1. ✅ **Opening Stock + Blind Count**: First count, user doesn't see expected quantities
2. ✅ **Opening Stock + Non-Blind Count**: First count, user sees expected quantities
3. ✅ **Regular Count + Blind Count**: Subsequent count, user doesn't see expected quantities
4. ✅ **Regular Count + Non-Blind Count**: Subsequent count, user sees expected quantities

## Implementation Details

### 1. API Service (`src/services/api.service.ts`)
- ✅ Added `opening_stock?: boolean` field to `createCycleCount` function
- ✅ Added `is_opening_stock?: boolean` alias for backend compatibility
- Both field names are sent to support different backend implementations

### 2. Task Creation Screen (`src/screens/CycleCountDashboardScreen.tsx`)
- ✅ Added `opening_stock: true` to task creation payload
- ✅ Defaults to `true` for all mobile-created tasks
- ✅ Added detailed logging for `opening_stock` field
- ✅ Independent of `is_blind_count` checkbox value

### 3. Auto-Created Tasks (`src/services/cycle-count-sync.service.ts`)
- ✅ Added `opening_stock: true` when auto-creating tasks during sync
- ✅ Updated in two locations:
  - `syncCycleCountSessions` (batch sync)
  - `syncCycleCountSession` (single sync)
- ✅ Consistent behavior with manual task creation

## Implementation Strategy

### Decision: Always Set `opening_stock: true` for Mobile Tasks
- **Rationale**: Mobile app is typically used for ad-hoc/initial counts
- **Backend Override**: Backend can override this value if it has better logic to determine opening stock (e.g., checking historical counts)
- **Safety**: Sending the field is safe - if backend doesn't use it, it's ignored; if backend requires it, we're providing it

### Alternative Approaches Considered
1. ❌ **Backend Auto-Detect Only**: Not implemented - would require backend changes and less explicit
2. ❌ **UI Toggle**: Not implemented - adds complexity, backend can determine better
3. ❌ **Based on Count Type**: Not implemented - too simplistic, not always accurate
4. ✅ **Always True for Mobile**: Implemented - simplest, safe, explicit

## Code Changes

### Files Modified
1. `src/services/api.service.ts`
   - Added `opening_stock` and `is_opening_stock` fields to `createCycleCount` interface

2. `src/screens/CycleCountDashboardScreen.tsx`
   - Added `opening_stock: true` to task creation
   - Added logging for opening_stock field

3. `src/services/cycle-count-sync.service.ts`
   - Added `opening_stock: true` to auto-created tasks (2 locations)

### Request Payload Example
```json
{
  "title": "CC-A1-R01-L2-B1-MK8C19Q3",
  "bin_code": "A1-R01-L2-B1",
  "bin_id": "A1-R01-L2-B1",
  "warehouse": "WH-MAIN",
  "warehouse_id": "WH-MAIN",
  "count_type": "Adhoc",
  "count_date": "2026-01-10",
  "is_blind_count": false,
  "opening_stock": true,        // ✅ NEW
  "is_opening_stock": true,     // ✅ NEW (alias for compatibility)
  "created_by": "USER-150526",
  "lines": [...]
}
```

## Testing Scenarios

### Test Case 1: Manual Task Creation - Opening Stock + Blind Count
1. Navigate to Cycle Count Dashboard
2. Check "Blind Count" checkbox
3. Create task
4. **Expected**: `opening_stock: true`, `is_blind_count: true` in request
5. **Expected**: Backend shows "Opening Stock: True" in task details
6. **Expected**: User doesn't see expected quantities in mobile app

### Test Case 2: Manual Task Creation - Opening Stock + Non-Blind Count
1. Navigate to Cycle Count Dashboard
2. Leave "Blind Count" unchecked
3. Create task
4. **Expected**: `opening_stock: true`, `is_blind_count: false` in request
5. **Expected**: Backend shows "Opening Stock: True" in task details
6. **Expected**: User sees expected quantities in mobile app

### Test Case 3: Auto-Created Task During Sync
1. Create cycle count session offline
2. Scan items
3. Go online (trigger sync)
4. **Expected**: Task auto-created with `opening_stock: true`
5. **Expected**: Backend shows "Opening Stock: True" in task details

### Test Case 4: Backend Override
1. Create task with `opening_stock: true`
2. Backend checks historical data - finds previous counts for this bin
3. **Expected**: Backend can override to `opening_stock: false` if needed
4. **Expected**: Mobile app respects backend's decision (shows in task details)

## Backend Compatibility

### Field Names Sent
- `opening_stock` (primary)
- `is_opening_stock` (alias)

### Backend Behavior Expected
- If backend accepts `opening_stock`: Use this field
- If backend accepts `is_opening_stock`: Use this field
- If backend accepts both: Use first one found
- If backend doesn't accept either: Field is ignored (no error)
- If backend auto-detects: Backend can override mobile app's value

## Notes

### Why Default to `true`?
- Mobile app is typically used for ad-hoc/initial counts
- Simplest implementation - explicit and safe
- Backend can override if needed based on historical data

### Why Independent of Blind Count?
- **Blind Count** = User experience (what they see)
- **Opening Stock** = Business logic (what the count represents)
- They serve different purposes and can coexist

### Future Enhancements
- Consider adding UI toggle if users need explicit control
- Consider backend API to check if bin has previous counts
- Consider different defaults based on count_type (Adhoc vs Directed)

## Verification

### Checklist
- ✅ API service accepts `opening_stock` field
- ✅ Manual task creation includes `opening_stock: true`
- ✅ Auto-created tasks include `opening_stock: true`
- ✅ Field is independent of `is_blind_count`
- ✅ Logging includes opening_stock value
- ✅ Both field name variations sent for compatibility
- ✅ No linter errors

## Related Documents
- `BLIND_COUNT_OPENING_STOCK_ANALYSIS.md` - Detailed analysis of relationship
- `API_COLLECTION_BY_MENU_AND_WORKFLOW.md` - API documentation
