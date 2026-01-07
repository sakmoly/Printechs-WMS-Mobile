# Mobile App Putaway Workflow Review

## Workflow Comparison: Mobile App vs Backend

### ✅ Step 1: Box Closed → Putaway Task Created

**Backend Implementation:**
- ✅ Automatically creates putaway task when box is closed
- ✅ Creates putaway task lines from `SORT_TO_BOX` events
- ✅ Sets status to `'Open'`
- ✅ Returns `putaway_task` in response

**Mobile App Implementation:**
- ✅ **Does NOT create putaway tasks** - relies on backend
- ✅ Box closing is handled in `PackingScreen.tsx` or `BoxManagementScreen.tsx`
- ✅ Calls `POST /api/boxes/close` which triggers backend to create putaway task
- ✅ Mobile app does NOT create tasks directly in mobile database

**✅ Status:** **CORRECT** - Mobile app correctly relies on backend to create tasks

---

### ✅ Step 2: Get Putaway Tasks (List View)

**Backend Implementation:**
- ✅ `GET /api/putaway/tasks` returns tasks from backend database
- ✅ Includes items from `tabPutawayLine`
- ✅ Supports filtering by `status`, `advance_shipping_notice`, `source_type`

**Mobile App Implementation:**
- ✅ **Fetches tasks from backend API** (line 329 in `PutAwayScreen.tsx`)
- ✅ Calls `apiService.getPutawayTasks({ status: "Open", advance_shipping_notice: activeASN })`
- ✅ Also loads from local database as fallback (for offline support)
- ✅ Merges backend tasks with local TCs/boxes
- ✅ **Does NOT create tasks in mobile table** - only reads from backend

**Code Reference:**
```typescript
// PutAwayScreen.tsx line 329
putawayTasksResponse = await apiService.getPutawayTasks({
  status: "Open",
  advance_shipping_notice: activeASN || undefined,
});
```

**✅ Status:** **CORRECT** - Mobile app correctly fetches from backend, not creating in mobile table

---

### ✅ Step 3: User Scans/Selects Putaway → Scan Location ID

**Backend Implementation:**
- ✅ `POST /api/putaway/scan-transfer-carton` accepts `putaway_task` or `box_id`
- ✅ Updates putaway task with location (rack, bin, location_id)
- ✅ Updates all putaway task lines with location
- ✅ **Changes status to `'In Progress'`** (line 2569 in backend)

**Mobile App Implementation:**
- ✅ **Calls backend API** when location is scanned (line 1317)
- ✅ `handleLocationScan()` function calls `apiService.scanTransferCarton()`
- ✅ Sends `location_id`, `rack`, `bin`, and `putaway_task` or `box_id`
- ✅ Stores `putaway_task` from response for completion step
- ✅ Records `PUTAWAY_TO_RACK` event for local tracking (offline support)

**Code Reference:**
```typescript
// PutAwayScreen.tsx line 1283-1317
const requestBody: any = {
  location_id: locationIdUpper,
  rack: rack,
  bin: bin,
  user_id: settings.user_id || undefined,
};

if (putawayTask) {
  requestBody.putaway_task = putawayTask;
} else {
  requestBody.box_id = selectedTC; // or tc_id
}

response = await apiService.scanTransferCarton(requestBody);
```

**✅ Status:** **CORRECT** - Mobile app correctly calls backend API to update location and status

---

### ✅ Step 4: User Clicks Complete → Change Status to Complete

**Backend Implementation:**
- ✅ `POST /api/putaway/complete` accepts `putaway_task` and `items` array
- ✅ Accepts `location_id` at header level or item level
- ✅ Validates all items have location
- ✅ **Updates status to `'Completed'`** (line 881 in backend)
- ✅ Updates stock ledger at location
- ✅ Creates stock transactions

**Mobile App Implementation:**
- ✅ **Calls backend API** when user clicks complete (line 1659)
- ✅ `handleCompletePutAway()` function calls `apiService.completePutaway()`
- ✅ Sends `putaway_task`, `location_id` (header level), `items` array with `location_id`
- ✅ Includes `performed_by` (user_id)
- ✅ Syncs master data after completion to update status

**Code Reference:**
```typescript
// PutAwayScreen.tsx line 1605-1659
const requestBody: any = {
  putaway_task: putawayTask,
  performed_by: settings.user_id || undefined,
  location_id: selectedLocationId, // Header level
};

if (items.length > 0) {
  const itemsWithLocation = items.map(item => ({
    ...item,
    location_id: locationIdToUse, // Item level
    completed: true,
  }));
  requestBody.items = itemsWithLocation;
}

const response = await apiService.completePutaway(requestBody);
```

**✅ Status:** **CORRECT** - Mobile app correctly calls backend API to complete task

---

## Status Flow Verification

| Step | Expected Status | Backend Updates | Mobile App Calls |
|------|----------------|-----------------|------------------|
| 1. Box Closed | `Open` | ✅ Backend creates with status 'Open' | ✅ Calls `POST /api/boxes/close` |
| 2. Location Scanned | `In Progress` | ✅ Backend updates to 'In Progress' | ✅ Calls `POST /api/putaway/scan-transfer-carton` |
| 3. Complete Clicked | `Completed` | ✅ Backend updates to 'Completed' | ✅ Calls `POST /api/putaway/complete` |

**✅ Status:** **CORRECT** - All status changes are handled by backend, mobile app calls correct APIs

---

## Mobile App Workflow Summary

### ✅ Correct Implementation

1. **Task Creation:**
   - ✅ Mobile app does NOT create putaway tasks
   - ✅ Backend creates tasks when box is closed
   - ✅ Mobile app only reads tasks from backend

2. **Task Listing:**
   - ✅ Mobile app fetches tasks from `GET /api/putaway/tasks`
   - ✅ Merges with local data for offline support
   - ✅ Does NOT create tasks in mobile database

3. **Location Scanning:**
   - ✅ Mobile app calls `POST /api/putaway/scan-transfer-carton`
   - ✅ Backend updates location and status to 'In Progress'
   - ✅ Mobile app stores putaway_task for completion

4. **Completion:**
   - ✅ Mobile app calls `POST /api/putaway/complete`
   - ✅ Backend updates status to 'Completed'
   - ✅ Mobile app syncs master data to refresh status

---

## API Endpoints Used by Mobile App

| Step | Endpoint | Purpose | Status |
|------|----------|---------|--------|
| 1. Box Close | `POST /api/boxes/close` | Close box (backend creates putaway task) | ✅ Correct |
| 2. List Tasks | `GET /api/putaway/tasks` | Get putaway tasks from backend | ✅ Correct |
| 3. Scan Location | `POST /api/putaway/scan-transfer-carton` | Update location and status | ✅ Correct |
| 4. Complete | `POST /api/putaway/complete` | Complete task and update status | ✅ Correct |

---

## Potential Issues to Watch

### ⚠️ Issue 1: Backend SQL Field Name Mapping

**Problem:** Backend needs to alias database columns to match API response format
- Database has `created_at` but API should return `created_on`
- Database has `updated_at` but API should return `updated_on`
- Database has `title` but API should return `putaway_task`
- Database has `advance_shipping_notice` but API should return `asn_no`

**Solution:** Backend should alias fields in SELECT statements (see `BACKEND_FIELD_NAME_MAPPING.md`)

### ⚠️ Issue 2: Location ID Validation

**Problem:** Backend validation checks items for location before applying header-level location_id

**Solution:** Mobile app now sends `location_id` at both header level AND item level (already fixed)

### ⚠️ Issue 3: Offline Support

**Current:** Mobile app has fallback to event-based tracking if API fails

**Note:** This is correct for offline support, but backend APIs should be primary method

---

## Testing Checklist

To verify mobile app workflow matches backend:

- [x] ✅ Mobile app fetches tasks from backend API (not creating in mobile table)
- [x] ✅ Mobile app calls scan-transfer-carton when location is scanned
- [x] ✅ Mobile app calls complete endpoint when user clicks complete
- [x] ✅ Mobile app does NOT create putaway tasks directly
- [x] ✅ Mobile app handles status changes correctly
- [ ] ⚠️ Backend SQL queries use correct field aliases
- [ ] ⚠️ Backend validation accepts header-level location_id

---

## Conclusion

**✅ Mobile App Implementation is CORRECT**

The mobile app correctly:
1. ✅ Does NOT create putaway tasks (relies on backend)
2. ✅ Fetches tasks from backend API
3. ✅ Calls backend APIs for location scanning and completion
4. ✅ Handles all status transitions through backend APIs

**⚠️ Backend Needs Minor Fixes:**
1. SQL field name aliasing (created_at → created_on, etc.)
2. Ensure validation accepts header-level location_id

**Overall Status:** ✅ **Mobile app workflow matches backend implementation correctly**

