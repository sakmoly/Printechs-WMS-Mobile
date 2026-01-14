# Cycle Count Expected Items Fix

## 🔴 Issue Found

**Problem:** When scanning the same location and carton (e.g., A1-R01-L2-B1) again after creating a new ad-hoc cycle count task, no expected items are listed.

**Steps to Reproduce:**
1. Scan location A1-R01-L2-B1
2. Select Ad-hoc, blind count unchecked
3. Create task → Start counting
4. Scan the same bin again (A1-R01-L2-B1)
5. **Expected:** Items with expected_qty should be listed
6. **Actual:** No items are listed

---

## 🔍 Root Cause

**Issue:** `loadExpectedItems()` function was only loading expected items from local `stock_ledger_cache` table, which might be empty or not synced. It wasn't checking the backend task lines for the same bin/carton.

**Additional Issue:** `taskTitle` was being loaded AFTER `loadExpectedItems()` was called, so the backend task check wasn't working.

---

## ✅ Fix Applied

### **File: `src/screens/CycleCountBinCountingScreen.tsx`**

### **Fix 1: Load taskTitle BEFORE loadExpectedItems**

**Before (Incorrect Order):**
```typescript
await loadSessionWithCartonId(cartonIdToUse);
loadExpectedItems(); // ❌ Called before taskTitle is loaded
// Load taskTitle later...
```

**After (Correct Order):**
```typescript
// ✅ Load taskTitle FIRST
const session = await db.getFirstAsync<{ server_session_id: string | null }>(...);
const loadedTaskTitle = session?.server_session_id;
setTaskTitle(loadedTaskTitle);

await loadSessionWithCartonId(cartonIdToUse);
// ✅ Then call loadExpectedItems with taskTitle
await loadExpectedItems(loadedTaskTitle);
```

---

### **Fix 2: Load Expected Items from Backend Task Lines First**

**Updated `loadExpectedItems()` function:**

**Priority 1: Check Backend Task Lines (NEW)**
- If `taskTitle` is available, fetch task lines from backend using `GET /api/cycle-count/{title}`
- Use task lines as expected items
- This allows loading expected items from the current task if it has lines

**Priority 2: Search for Other Backend Tasks for Same Bin (NEW)**
- If current task has no lines, search for other backend tasks for the same bin
- Find matching tasks by `bin_code`, `bin_location`, or `bin_id`
- Sort by most recent first (`updated_on` or `created_on`)
- Try each task until finding one with task lines
- Use that task's lines as expected items
- Save the task title to session for future use

**Priority 3: Fallback to Stock Ledger Cache (EXISTING)**
- If no backend task lines found, fall back to local `stock_ledger_cache`
- This maintains backward compatibility

---

## 🔄 New Workflow

### **When Scanning Same Bin/Carton Again:**

**Step 1: Load taskTitle**
- Load `server_session_id` from session
- Set `taskTitle` state

**Step 2: Load Expected Items**
1. **Check Current Task:**
   - If `taskTitle` exists, fetch task lines from `GET /api/cycle-count/{title}`
   - If task has lines, use them as expected items ✅

2. **Search Previous Tasks:**
   - If current task has no lines, search for other backend tasks for same bin
   - Use `GET /api/cycle-count?status=Draft,In Progress,Review,Completed,Submitted`
   - Filter tasks by `bin_code` matching current bin
   - Sort by most recent first
   - Fetch task lines from each task until finding one with lines
   - Use that task's lines as expected items ✅

3. **Fallback to Stock Ledger:**
   - If no backend task lines found, load from local `stock_ledger_cache`
   - This maintains backward compatibility

**Step 3: Create Local Lines**
- Create `cycle_count_lines` entries for expected items
- Set `expected_qty` from task lines
- Set `counted_qty` to 0 (ready for counting)

---

## 📋 Example Scenario

### **Scenario: Scanning Same Bin Again**

**Previous Task (Completed):**
- Task: `CC-A1-R01-L2-B1-MK6SK143`
- Bin: `A1-R01-L2-B1`
- Lines:
  - `SKU-JACKET-201-BLK-L`, expected_qty: 5
  - `SKU-SHIRT-001-WHT-M`, expected_qty: 3
  - `TEST-ITEM-002`, expected_qty: 2

**New Ad-hoc Task:**
- Scan bin: `A1-R01-L2-B1`
- Create new task: `CC-A1-R01-L2-B1-MK82UT3Q`
- **Expected:** Items should be loaded from previous task
- **Actual (Before Fix):** No items listed ❌
- **Actual (After Fix):** Items loaded from previous task ✅

**Workflow (After Fix):**
1. ✅ Load taskTitle: `CC-A1-R01-L2-B1-MK82UT3Q`
2. ✅ Check current task: No task lines (new task)
3. ✅ Search previous tasks: Find `CC-A1-R01-L2-B1-MK6SK143` for same bin
4. ✅ Fetch task lines: Found 3 items with expected_qty
5. ✅ Create local lines:
   - `SKU-JACKET-201-BLK-L`, expected_qty: 5, counted_qty: 0
   - `SKU-SHIRT-001-WHT-M`, expected_qty: 3, counted_qty: 0
   - `TEST-ITEM-002`, expected_qty: 2, counted_qty: 0
6. ✅ Items are now listed and ready for counting

---

## ✅ Benefits

1. **Reuse Expected Items** - When scanning the same bin again, expected items are loaded from previous task
2. **Better User Experience** - Users don't need to manually re-enter expected items
3. **Accurate Counting** - Expected quantities are preserved from previous counts
4. **Backward Compatible** - Still falls back to stock_ledger_cache if no backend tasks found
5. **Handles Multiple Tasks** - Uses the most recent task if multiple tasks exist for the same bin

---

## 🧪 Testing

### **Test 1: Scan Same Bin with Previous Task**
1. Create and complete a cycle count task for bin A1-R01-L2-B1
2. Create a new ad-hoc task for the same bin A1-R01-L2-B1
3. Navigate to counting screen
4. **Expected:** ✅ Items with expected_qty should be listed from previous task

### **Test 2: Scan Same Bin with No Previous Task**
1. Create a new ad-hoc task for a bin that has never been counted
2. Navigate to counting screen
3. **Expected:** ✅ Items should be loaded from stock_ledger_cache (if synced)

### **Test 3: Scan Same Bin with Multiple Previous Tasks**
1. Create multiple tasks for bin A1-R01-L2-B1 (at different times)
2. Create a new ad-hoc task for the same bin
3. Navigate to counting screen
4. **Expected:** ✅ Items should be loaded from the most recent previous task

---

## 📊 Summary

**Issue:** Expected items not loading when scanning the same bin/carton again

**Root Cause:**
1. `taskTitle` was loaded after `loadExpectedItems()` was called
2. `loadExpectedItems()` only checked local `stock_ledger_cache`, not backend task lines

**Fix:**
1. ✅ Load `taskTitle` BEFORE calling `loadExpectedItems()`
2. ✅ Check backend task lines first (current task)
3. ✅ Search for other backend tasks for same bin if current task has no lines
4. ✅ Use most recent task's lines as expected items
5. ✅ Fallback to stock_ledger_cache if no backend tasks found

**Status:** ✅ **FIXED**

Expected items should now be loaded when scanning the same location and carton again.
