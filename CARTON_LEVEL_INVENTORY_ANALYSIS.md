# Carton-Level Inventory Implementation - Analysis & Review

## 📋 Executive Summary

This document analyzes the backend API documentation for **Carton-Level Inventory** support and provides a comprehensive review of required mobile app changes before implementation.

**Status:** ⚠️ **READY FOR REVIEW** - Analysis complete, awaiting approval before implementation

---

## 🔍 Current State Analysis

### 1. **Putaway Operations** ✅ Partially Compatible

**Current Implementation:**
- `completePutaway` API method exists in `src/services/api.service.ts` (line 1968)
- Current request structure:
  ```typescript
  {
    putaway_task: string;
    performed_by?: string;
    location_id?: string;
    items?: Array<{
      item_code: string;
      qty: number;
      location_id?: string;
      source_bin?: string;
      target_bin?: string;
      completed?: boolean;
    }>;
  }
  ```

**Required Changes:**
- ✅ Add `carton_id` field to `items` array in `completePutaway` request
- ✅ Handle `carton_id` in putaway task list responses (`GET /api/putaway/tasks`)
- ⚠️ Display carton information in Putaway UI (if available)

**Backward Compatibility:** ✅ **YES** - `carton_id` is optional, existing code will continue to work

---

### 2. **Picking/Takeaway Operations** ⚠️ Needs Implementation

**Current Implementation:**
- ❌ `pickMaterialRequestItems` method **DOES NOT EXIST** in `api.service.ts`
- Current picking uses **event-based approach** (offline support)
- `MaterialRequestPackingScreen.tsx` calls `apiService.pickMaterialRequestItems()` but method is missing

**Required Changes:**
- ❌ **CRITICAL:** Create `pickMaterialRequestItems` method in `api.service.ts`
- ✅ Add `carton_id` field to pick items request
- ✅ Handle new error responses:
  - `CARTON_NOT_FOUND` (400)
  - `CARTON_BIN_MISMATCH` (400)
  - `INSUFFICIENT_CARTON_STOCK` (400)
- ✅ Display `carton_stock_updated` flag in response
- ⚠️ Add carton validation UI (scan carton before picking)

**Backward Compatibility:** ✅ **YES** - `carton_id` is optional, existing event-based picking will continue to work

---

### 3. **Cycle Count Operations** ⚠️ Needs Updates

**Current Implementation:**
- `submitCycleCountCounts` method exists in `src/services/cycle-count-sync.service.ts` (line 180)
- Current request structure:
  ```typescript
  {
    counted_by: string;
    lines: Array<{
      item_code: string;
      barcode?: string;
      actual_qty: number;
      counted_qty: number;
      bin_location: string;
      expected_qty?: number;
      // ... other fields
    }>;
  }
  ```

**Required Changes:**
- ✅ Add `carton_id` field to `lines` array in `submitCycleCountCounts` request
- ✅ Update `CycleCountLine` interface to include `carton_id`
- ✅ Update database schema to store `carton_id` in `cycle_count_lines` table
- ✅ Handle `carton_id` in cycle count line responses
- ⚠️ Add carton scanning UI in `CycleCountBinCountingScreen.tsx` (optional, for carton-level mode)

**Backward Compatibility:** ✅ **YES** - `carton_id` is optional, existing bin-level counting will continue to work

---

### 4. **Stock Transaction Queries** ✅ No Changes Needed

**Current Implementation:**
- No stock transaction query API exists in mobile app
- Backend will include `carton_id` in responses automatically

**Required Changes:**
- ✅ None - mobile app doesn't query stock transactions currently
- ✅ If future implementation is needed, ensure `carton_id` is displayed in UI

**Backward Compatibility:** ✅ **YES** - No breaking changes

---

## 📊 Database Schema Changes Required

### 1. **Cycle Count Lines Table** ⚠️ Migration Needed

**Current Schema:**
```sql
CREATE TABLE cycle_count_lines (
  line_id TEXT PRIMARY KEY,
  session_id TEXT,
  item_code TEXT,
  barcode TEXT,
  -- ... other fields
  -- ❌ NO carton_id field
);
```

**Required Change:**
```sql
ALTER TABLE cycle_count_lines 
ADD COLUMN carton_id TEXT;
```

**Migration Strategy:**
- Add `carton_id` column (nullable, for backward compatibility)
- Existing records will have `carton_id = NULL` (bin-level mode)
- New records can include `carton_id` (carton-level mode)

---

### 2. **Event Queue Table** ✅ Already Compatible

**Current Schema:**
```sql
CREATE TABLE event_queue (
  -- ... existing fields
  carton_id TEXT,  -- ✅ Already exists
  -- ... other fields
);
```

**Required Changes:** ✅ **NONE** - `carton_id` already exists

---

### 3. **Other Tables** ✅ No Changes Needed

- `asn_carton_map` - Already has `carton_id` ✅
- `carton_status_cache` - Already has `carton_id` ✅
- `scanned_items` - Already has `carton_id` ✅

---

## 🎨 UI/UX Changes Required

### 1. **Putaway Screen** (`PutAwayScreen.tsx`)

**Current State:**
- Shows putaway tasks with items
- Displays `item_code`, `qty`, `location_id`
- No carton information displayed

**Required Changes:**
- ⚠️ **Optional:** Display `carton_id` in item list (if available)
- ⚠️ **Optional:** Add carton filter/search (if carton-level mode is enabled)
- ✅ **No breaking changes** - carton info is optional

**Priority:** 🟡 **LOW** - Display only, not critical for functionality

---

### 2. **Material Request Packing Screen** (`MaterialRequestPackingScreen.tsx`)

**Current State:**
- Uses event-based picking (offline support)
- Calls `pickMaterialRequestItems` API (but method doesn't exist)
- No carton validation

**Required Changes:**
- ❌ **CRITICAL:** Implement `pickMaterialRequestItems` API method
- ⚠️ **Optional:** Add carton scanning step before picking (if carton-level mode)
- ✅ Handle new error responses:
  - Show alert for `CARTON_NOT_FOUND`
  - Show alert for `CARTON_BIN_MISMATCH`
  - Show alert for `INSUFFICIENT_CARTON_STOCK`
- ⚠️ Display `carton_stock_updated` flag in success message

**Priority:** 🔴 **HIGH** - API method is missing, will cause runtime errors

---

### 3. **Cycle Count Bin Counting Screen** (`CycleCountBinCountingScreen.tsx`)

**Current State:**
- Scans items and records quantities
- Stores counts in `cycle_count_lines` table
- No carton information

**Required Changes:**
- ⚠️ **Optional:** Add carton scanning input (if carton-level mode)
- ✅ Update `submitCycleCountCounts` to include `carton_id` in request
- ✅ Update database insert to include `carton_id` (if provided)

**Priority:** 🟡 **MEDIUM** - Required for carton-level cycle count, but optional for bin-level

---

## 🔧 Implementation Checklist

### Phase 1: Critical Fixes (Must Do)

- [ ] **CRITICAL:** Create `pickMaterialRequestItems` method in `api.service.ts`
  - Endpoint: `POST /api/material-requests/:title/pick-items`
  - Accept `carton_id` in request items
  - Handle error responses (CARTON_NOT_FOUND, CARTON_BIN_MISMATCH, INSUFFICIENT_CARTON_STOCK)
  - Return `carton_stock_updated` flag

- [ ] **CRITICAL:** Add `carton_id` to `completePutaway` items array
  - Update `api.service.ts` type definition
  - Update `PutAwayScreen.tsx` to include `carton_id` in request (if available)

- [ ] **CRITICAL:** Add `carton_id` to cycle count sync
  - Update `submitCycleCountCounts` type in `api.service.ts`
  - Update `cycle-count-sync.service.ts` to include `carton_id` in lines

### Phase 2: Database Schema Updates

- [ ] Add `carton_id` column to `cycle_count_lines` table
  - Create migration script
  - Test with existing data (should be NULL for old records)

### Phase 3: UI Enhancements (Optional)

- [ ] Display `carton_id` in Putaway screen item list
- [ ] Display `carton_id` in Cycle Count screen
- [ ] Add carton scanning UI for picking (if carton-level mode)
- [ ] Add carton scanning UI for cycle count (if carton-level mode)

### Phase 4: Error Handling

- [ ] Handle `CARTON_NOT_FOUND` error in picking
- [ ] Handle `CARTON_BIN_MISMATCH` error in picking
- [ ] Handle `INSUFFICIENT_CARTON_STOCK` error in picking
- [ ] Show user-friendly error messages

---

## ⚠️ Critical Issues Found

### 1. **Missing API Method** 🔴 **CRITICAL**

**Issue:** `pickMaterialRequestItems` method is called in `MaterialRequestPackingScreen.tsx` but doesn't exist in `api.service.ts`

**Impact:** 
- Runtime error when sealing Transfer Carton
- Picking will fail if API is called

**Fix Required:**
```typescript
// In src/services/api.service.ts
pickMaterialRequestItems: async (
  title: string,
  items: Array<{
    item_code: string;
    picked_qty: number;
    source_bin: string;
    carton_id?: string; // ✅ NEW: Optional carton_id
  }>,
  warehouse?: string
) => {
  return makeRequest(
    `/api/material-requests/${title}/pick-items`,
    "POST",
    {
      items,
      warehouse,
    }
  );
},
```

---

### 2. **Database Schema Missing Column** 🟡 **MEDIUM**

**Issue:** `cycle_count_lines` table doesn't have `carton_id` column

**Impact:**
- Cannot store carton information for cycle count
- Carton-level cycle count will not work

**Fix Required:**
```sql
ALTER TABLE cycle_count_lines 
ADD COLUMN carton_id TEXT;
```

---

## ✅ Backward Compatibility Analysis

### **All Changes Are Backward Compatible** ✅

1. **Carton ID is Optional:**
   - All API requests accept `carton_id` as optional
   - Existing code without `carton_id` will continue to work
   - Backend automatically detects carton-level mode

2. **Database Schema:**
   - `carton_id` column is nullable
   - Existing records will have `carton_id = NULL` (bin-level mode)
   - New records can include `carton_id` (carton-level mode)

3. **UI Changes:**
   - All UI changes are optional/display-only
   - No breaking changes to existing workflows
   - Carton information is shown only if available

---

## 🚀 Implementation Priority

### **Priority 1: Critical Fixes** 🔴
1. Create `pickMaterialRequestItems` API method
2. Add `carton_id` to `completePutaway` items
3. Add `carton_id` to cycle count sync

### **Priority 2: Database Updates** 🟡
1. Add `carton_id` column to `cycle_count_lines` table

### **Priority 3: UI Enhancements** 🟢
1. Display carton information in UI (optional)
2. Add carton scanning UI (optional, for carton-level mode)

---

## 📝 Testing Checklist

### **Putaway Testing:**
- [ ] Test putaway completion with `carton_id` in items
- [ ] Test putaway completion without `carton_id` (backward compatibility)
- [ ] Verify `carton_id` appears in putaway task list responses

### **Picking Testing:**
- [ ] Test picking with `carton_id` in items
- [ ] Test picking without `carton_id` (backward compatibility)
- [ ] Test `CARTON_NOT_FOUND` error handling
- [ ] Test `CARTON_BIN_MISMATCH` error handling
- [ ] Test `INSUFFICIENT_CARTON_STOCK` error handling

### **Cycle Count Testing:**
- [ ] Test cycle count with `carton_id` in lines
- [ ] Test cycle count without `carton_id` (backward compatibility)
- [ ] Verify `carton_id` is stored in database
- [ ] Verify `carton_id` appears in cycle count responses

---

## 🎯 Recommendations

### **Before Implementation:**

1. ✅ **Review this analysis document** - Ensure all changes are understood
2. ✅ **Confirm backend API is ready** - Verify all endpoints are implemented
3. ✅ **Test backward compatibility** - Ensure existing workflows still work
4. ✅ **Plan database migration** - Ensure migration script is tested

### **During Implementation:**

1. ✅ **Implement critical fixes first** - Fix missing API method
2. ✅ **Test incrementally** - Test each change before moving to next
3. ✅ **Maintain backward compatibility** - Ensure existing code continues to work
4. ✅ **Add error handling** - Handle all new error responses

### **After Implementation:**

1. ✅ **Test all workflows** - Putaway, Picking, Cycle Count
2. ✅ **Test error scenarios** - Carton validation errors
3. ✅ **Test offline mode** - Ensure offline support still works
4. ✅ **Update documentation** - Update API documentation if needed

---

## 📞 Questions for Backend Team

1. **Carton-Level Mode Detection:**
   - How does the mobile app know if carton-level mode is enabled?
   - Is there a setting/flag to check?
   - Or should we always send `carton_id` if available?

2. **Carton Validation:**
   - Should the mobile app validate carton exists before picking?
   - Or rely on backend validation only?

3. **Error Handling:**
   - Are all error codes documented?
   - What is the exact error response format?

4. **Stock Transactions:**
   - Will the mobile app need to query stock transactions?
   - Or is this backend-only?

---

## ✅ Approval Status

**Status:** ⚠️ **AWAITING REVIEW**

**Next Steps:**
1. Review this analysis document
2. Confirm backend API is ready
3. Approve implementation plan
4. Begin implementation

---

**Last Updated:** 2026-01-07  
**Document Version:** 1.0  
**Status:** ✅ Analysis Complete - Ready for Review

