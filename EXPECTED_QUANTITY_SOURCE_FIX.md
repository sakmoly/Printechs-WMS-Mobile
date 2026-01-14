# Expected Quantity Source Issue - Fixed

## Problem
User cleared all data from backend database and mobile app, but still seeing "Exp: 74" (expected quantity: 74) in the mobile app when counting items.

## Root Cause
The **`stock_ledger_cache`** table in the local SQLite database was **NOT being cleared** when the user cleared data. This table stores cached stock ledger data from the backend and is used as a fallback source for expected quantities.

### Data Flow (Expected Quantity Sources - Priority Order):
1. **Priority 1**: Backend task lines (from `GET /api/cycle-count/:title`)
2. **Priority 2**: Backend stock ledger API (from `GET /api/stock/ledger?bin_location=...`)
3. **Priority 3**: Local `stock_ledger_cache` table ← **THIS WAS THE ISSUE**

When backend was cleared:
- Priority 1: Empty (backend cleared) ✅
- Priority 2: Empty (backend cleared) ✅
- Priority 3: **STILL HAD DATA** (qty: 74) ❌ **NOT CLEARED**

## Code Location
The expected quantity loading logic is in `src/screens/CycleCountBinCountingScreen.tsx`:
- **Line 706**: Queries `stock_ledger_cache` table as fallback
- **Line 702-723**: Falls back to `stock_ledger_cache` if backend API fails or returns empty

## Solution
Added missing tables to all clear functions:

### 1. `clearAllCacheData` (data-cleanup.service.ts)
**Added tables:**
- ✅ `stock_ledger_cache` - Sources expected quantities
- ✅ `stock_transaction_cache` - Stock transaction cache
- ✅ `cycle_count_sessions` - Cycle count sessions
- ✅ `cycle_count_lines` - Cycle count lines (contains expected_qty)
- ✅ `cycle_count_cache` - Cycle count cache

### 2. `clearAllTransactionData` (data.service.ts)
**Added section 9 & 10:**
- ✅ Cycle count data (sessions, lines, cache)
- ✅ Stock ledger cache
- ✅ Stock transaction cache

### 3. `clearAllData` (data.service.ts)
**Added clearing for:**
- ✅ Cycle count data (sessions, lines, cache)
- ✅ Stock ledger cache (with explicit comment: "this was the source of 'Exp: 74'")
- ✅ Stock transaction cache

## How to Verify Fix

### Step 1: Clear Data Again
1. Go to **Settings** screen
2. Click **"Clear ALL Database Data"**
3. Confirm the action

### Step 2: Check Logs
The console should now show:
```
🗑️ Clearing all local cache data...
✅ Cleared stock_ledger_cache: X rows
✅ Cleared cycle_count_sessions: X rows
✅ Cleared cycle_count_lines: X rows
✅ Cleared cycle_count_cache: X rows
✅ Cleared stock_transaction_cache: X rows
```

### Step 3: Test Cycle Count
1. Create a new cycle count task
2. Scan a carton ID
3. **Expected**: No expected quantities should be shown (all caches cleared)
4. **Expected**: Items list should be empty until you scan items

## Manual Clear Command (If Needed)

If you need to manually clear these tables, you can run this SQL in the database:

```sql
DELETE FROM stock_ledger_cache;
DELETE FROM cycle_count_lines;
DELETE FROM cycle_count_sessions;
DELETE FROM cycle_count_cache;
DELETE FROM stock_transaction_cache;
```

## Related Tables That Store Expected Quantities

### Tables That Store `expected_qty`:
1. **`cycle_count_lines`** - Stores `expected_qty` for each item in a cycle count session
   - **Source**: Loaded from backend task or stock ledger, or set during item scan
   - **Status**: ✅ Now cleared in all clear functions

2. **`stock_ledger_cache`** - Caches stock ledger data (bin_location, item_code, qty)
   - **Source**: Synced from backend stock ledger API or demo data
   - **Status**: ✅ Now cleared in all clear functions

3. **`cycle_count_cache`** - Caches cycle count task data
   - **Status**: ✅ Now cleared in all clear functions

### Tables That DON'T Store expected_qty (but related):
- `cycle_count_sessions` - Stores session metadata (doesn't have expected_qty, but should be cleared for consistency)
- `stock_transaction_cache` - Stores stock transactions (related to stock ledger)

## Prevention

To prevent this issue in the future:
1. ✅ All clear functions now include cycle count and stock ledger tables
2. ✅ Clear functions use try-catch to handle missing tables gracefully
3. ✅ Explicit logging indicates which tables were cleared

## Testing Checklist

After fix:
- [x] `clearAllCacheData` includes `stock_ledger_cache`
- [x] `clearAllTransactionData` includes `stock_ledger_cache`
- [x] `clearAllData` includes `stock_ledger_cache`
- [x] All cycle count tables are cleared
- [x] No linter errors
- [ ] User should test: Clear data → Create cycle count → Verify no expected quantities shown

## Summary

**Issue**: `stock_ledger_cache` table was not being cleared, causing old expected quantities (74) to persist even after clearing backend and mobile data.

**Fix**: Added `stock_ledger_cache`, `cycle_count_sessions`, `cycle_count_lines`, `cycle_count_cache`, and `stock_transaction_cache` to all clear functions.

**Result**: When user clears data now, all sources of expected quantities will be cleared, preventing stale data from appearing.
