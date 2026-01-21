# Putaway Validation Analysis: Current Implementation vs Requirements

**Date**: 2026-01-17  
**Reference**: `End-to-End Putaway Validation.md`

---

## Executive Summary

This document analyzes the current mobile app putaway implementation against the validation requirements specified in `End-to-End Putaway Validation.md`.

### Current Status:

- ✅ **Basic putaway workflow works** (scan TC/box → scan location → complete)
- ⚠️ **Missing `from_location_id` tracking** (staging location not captured)
- ⚠️ **Stock ledger/history validation** depends on backend implementation
- ❌ **No validation endpoints** implemented in mobile app
- ✅ **Event-based tracking** works as fallback

---

## Requirements vs Current Implementation

### 1. ✅ Move Inventory from Staging → Final Bin

**Requirement:**

- Move inventory from Receiving/Staging location (`LOC-STAGE-01`) to Final Bin (`LOC-A1-R1-B1`)

**Current Implementation:**

- ✅ Mobile app sends `location_id` (target location) to backend
- ✅ `PUTAWAY_TO_RACK` event includes `location_id`
- ⚠️ **Missing**: `from_location_id` (staging location) is NOT captured
- ⚠️ **Missing**: No explicit tracking of "staging" location

**Gap:**

```typescript
// Current event structure (PUTAWAY_TO_RACK):
{
  event_type: "PUTAWAY_TO_RACK",
  location_id: "A1-R02-L2-B2", // ✅ Target location
  // ❌ Missing: from_location_id (staging location)
}
```

**Recommendation:**

- Backend should determine `from_location_id` from carton's current location
- OR: Mobile app should include `from_location_id` if known (from carton metadata)

---

### 2. ✅ Preserve carton_id and item_id

**Requirement:**

- Preserve `carton_id` and `item_id` during putaway

**Current Implementation:**

- ✅ `PUTAWAY_TO_RACK` event includes `carton_id` (if scanned)
- ✅ `PUTAWAY_TO_RACK` event includes `item_code` (if scanned for loose items)
- ✅ `tc_id` is preserved (Transfer Carton ID)

**Status:** ✅ **COMPLIANT**

---

### 3. ⚠️ Update Location-wise Inventory

**Requirement:**

- Update inventory by location correctly
- `LOC-STAGE-01` qty = 0 (after putaway)
- `LOC-A1-R1-B1` qty = received qty (after putaway)

**Current Implementation:**

- ✅ Mobile app sends `location_id` to backend
- ⚠️ **Backend responsibility**: Backend must update inventory by location
- ❌ **Mobile app cannot validate**: No API endpoints to check inventory by location

**Gap:**

- Missing: `GET /api/inventory/by-location` endpoint
- Missing: `GET /api/inventory/by-carton` endpoint

**Recommendation:**

- Backend must implement inventory update logic
- Mobile app should call validation endpoints after putaway (if available)

---

### 4. ⚠️ Create Stock Ledger MOVE Entries

**Requirement:**

- Create stock ledger entries with:
  - `movement_type = "MOVE"` (or "TRANSFER")
  - `qty_in = received_qty`
  - `qty_out = received_qty`
  - `from_location_id = LOC-STAGE-01`
  - `to_location_id = LOC-A1-R1-B1`
  - `carton_id` preserved
  - `reference_doctype = "PUTAWAY"`
  - `reference_id = putaway_task_id`
  - ❌ **NO new "IN" ledger entries** (only MOVE entries)

**Current Implementation:**

- ✅ Mobile app sends putaway data to backend
- ⚠️ **Backend responsibility**: Backend must create stock ledger entries
- ❌ **Mobile app cannot validate**: No API to check stock ledger

**Gap:**

- Missing: `GET /api/stock-ledger` endpoint
- Missing: Validation that no duplicate MOVE entries are created
- Missing: Validation that no new "IN" entries are created

**Recommendation:**

- Backend must implement stock ledger creation
- Mobile app should validate ledger entries after putaway (if API available)

---

### 5. ⚠️ Create Stock History Entries

**Requirement:**

- Create stock history entries with:
  - `action = "PUTAWAY"`
  - `item_id`
  - `carton_id`
  - `from_location_id`
  - `to_location_id`
  - `qty`
  - `user_id`
  - `device_id`
  - `timestamp`

**Current Implementation:**

- ✅ Mobile app sends `user_id` and `device_id` in events
- ⚠️ **Backend responsibility**: Backend must create stock history entries
- ❌ **Mobile app cannot validate**: No API to check stock history

**Gap:**

- Missing: `GET /api/stock-history` endpoint
- Missing: `from_location_id` in event (only `location_id` for target)

**Recommendation:**

- Backend must implement stock history creation
- Mobile app should include `from_location_id` if available

---

### 6. ✅ Total Inventory Quantity Unchanged

**Requirement:**

- Total inventory quantity must NOT change after putaway
- `inventory_before_putaway == inventory_after_putaway`

**Current Implementation:**

- ✅ Mobile app doesn't modify inventory directly (backend handles it)
- ⚠️ **Backend responsibility**: Backend must ensure no quantity changes
- ❌ **Mobile app cannot validate**: No API to check total inventory

**Recommendation:**

- Backend must ensure MOVE entries have `qty_in = qty_out`
- Mobile app should validate total inventory (if API available)

---

## Required API Endpoints Status

### Putaway Flow Endpoints:

| Endpoint                          | Status      | Current Usage                                        |
| --------------------------------- | ----------- | ---------------------------------------------------- |
| `POST /api/putaway/tasks/create`  | ❌ Not used | Mobile uses `POST /api/putaway/scan-transfer-carton` |
| `POST /api/putaway/tasks/assign`  | ❌ Not used | Mobile uses `POST /api/putaway/scan-transfer-carton` |
| `POST /api/putaway/tasks/confirm` | ❌ Not used | Mobile uses event-based approach                     |

**Current Mobile Implementation:**

- Uses: `POST /api/putaway/scan-transfer-carton` (creates/updates task + assigns location)
- Falls back to: `PUTAWAY_TO_RACK` events if API fails

### Read/Validation Endpoints:

| Endpoint                         | Status             | Purpose                          |
| -------------------------------- | ------------------ | -------------------------------- |
| `GET /api/inventory/by-location` | ❌ Not implemented | Validate location-wise inventory |
| `GET /api/inventory/by-carton`   | ❌ Not implemented | Validate carton location updates |
| `GET /api/stock-ledger`          | ❌ Not implemented | Validate MOVE ledger entries     |
| `GET /api/stock-history`         | ❌ Not implemented | Validate stock history entries   |

**Gap:** Mobile app cannot validate putaway results without these endpoints.

---

## Current Event Structure

### PUTAWAY_TO_RACK Event:

```typescript
{
  event_type: "PUTAWAY_TO_RACK",
  asn_no: string,
  inbound_session: string,
  tc_id: string,              // ✅ Transfer Carton ID
  carton_id?: string,         // ✅ Carton ID (if scanned)
  item_code?: string,         // ✅ Item code (if scanned for loose items)
  location_id: string,        // ✅ Target location (to_location_id)
  rack?: string,              // ⚠️ Deprecated (removed from API request)
  bin?: string,               // ⚠️ Optional bin
  device_id: string,          // ✅ Device ID
  user_id: string,            // ✅ User ID
  event_time: string,         // ✅ Timestamp
  // ❌ Missing: from_location_id (staging location)
}
```

### What's Missing:

1. **`from_location_id`**: Staging location not captured

   - **Solution**: Backend should determine from carton's current location
   - **OR**: Mobile app should include if available from carton metadata

2. **`putaway_task_id`**: Not included in event
   - **Current**: Only in API response (if API succeeds)
   - **Solution**: Include in event if available

---

## Critical Assertions (Validation Requirements)

### 1. ✅ SUM(inventory_by_location) = inventory_summary

- **Status**: ⚠️ **Backend responsibility**
- **Mobile**: Cannot validate (no API endpoint)

### 2. ✅ inventory_before_putaway == inventory_after_putaway

- **Status**: ⚠️ **Backend responsibility**
- **Mobile**: Cannot validate (no API endpoint)

### 3. ✅ No duplicate MOVE ledger entries

- **Status**: ⚠️ **Backend responsibility**
- **Mobile**: Cannot validate (no API endpoint)

### 4. ✅ No negative inventory in staging bin

- **Status**: ⚠️ **Backend responsibility**
- **Mobile**: Cannot validate (no API endpoint)

### 5. ✅ Carton cannot exist in multiple locations

- **Status**: ⚠️ **Backend responsibility**
- **Mobile**: Cannot validate (no API endpoint)

---

## Edge Cases Validation

### 1. Partial Putaway (carton split across bins)

- **Status**: ❌ **Not supported**
- **Current**: Mobile app puts away entire TC/box
- **Recommendation**: Backend must handle if needed

### 2. Re-putaway Prevention

- **Status**: ✅ **Partially supported**
- **Current**: Mobile app filters out TCs already assigned to locations
- **Gap**: No backend validation to prevent duplicate putaway

### 3. Putaway without Receiving

- **Status**: ⚠️ **Backend validation required**
- **Current**: Mobile app doesn't validate receiving status
- **Recommendation**: Backend must reject if carton not received

### 4. Wrong Target Location

- **Status**: ⚠️ **Backend validation required**
- **Current**: Mobile app sends any scanned location
- **Recommendation**: Backend must validate location exists and is valid

---

## Recommendations

### Mobile App Improvements:

1. **Add `from_location_id` to PUTAWAY_TO_RACK event:**

   ```typescript
   // If carton metadata includes current location, include it
   if (cartonMetadata?.current_location) {
     event.from_location_id = cartonMetadata.current_location;
   }
   ```

2. **Add validation API calls (if endpoints available):**

   ```typescript
   // After putaway completion, validate results
   if (apiSuccess) {
     const inventory = await apiService.getInventoryByLocation(locationId);
     const ledger = await apiService.getStockLedger({
       reference_id: putawayTaskId,
     });
     // Validate assertions...
   }
   ```

3. **Include `putaway_task_id` in event:**
   ```typescript
   if (putawayTaskId) {
     event.putaway_task_id = putawayTaskId;
   }
   ```

### Backend Requirements:

1. **Implement validation endpoints:**

   - `GET /api/inventory/by-location?location_id={id}`
   - `GET /api/inventory/by-carton?carton_id={id}`
   - `GET /api/stock-ledger?reference_id={putaway_task_id}`
   - `GET /api/stock-history?action=PUTAWAY&reference_id={putaway_task_id}`

2. **Ensure stock ledger MOVE entries:**

   - Create MOVE entries (not IN entries)
   - `qty_in = qty_out` (no quantity change)
   - Include `from_location_id` and `to_location_id`
   - Include `carton_id` and `reference_id`

3. **Validate putaway prerequisites:**

   - Carton must be received before putaway
   - Location must exist and be valid
   - Prevent duplicate putaway

4. **Determine `from_location_id`:**
   - Get carton's current location from inventory/carton table
   - Use staging location if carton is in staging
   - Default to receiving location if not specified

---

## Test Cases Implementation

### TC6: Create Putaway Task

**Current Status:**

- ✅ Mobile app creates/updates putaway task via `POST /api/putaway/scan-transfer-carton`
- ✅ Task includes `carton_id`, `item_code`, `qty`, `location_id`
- ⚠️ Missing: `from_location_id` (backend should determine)

**Validation:**

- Backend must return `putaway_task_id`
- Backend must create task lines with required fields

### TC7: Execute Putaway (Confirm Move)

**Current Status:**

- ✅ Mobile app scans carton_id
- ✅ Mobile app scans target location
- ✅ Mobile app confirms putaway (full carton qty)
- ✅ Event is created and synced

**Validation:**

- Backend must update inventory by location
- Backend must create stock ledger MOVE entries
- Backend must create stock history entries
- Backend must preserve carton_id

---

## Summary

### ✅ What Works:

- Basic putaway workflow (scan TC → scan location → complete)
- Event-based tracking (offline support)
- Carton and item preservation
- User and device tracking

### ⚠️ What's Missing:

- `from_location_id` in events (staging location)
- Validation API endpoints
- Mobile-side validation of putaway results
- Explicit putaway task ID in events

### ❌ What Needs Backend Implementation:

- Stock ledger MOVE entries
- Stock history entries
- Inventory by location updates
- Validation endpoints
- Prerequisite validation (receiving status, location validity)

---

## Next Steps

1. **Backend**: Implement validation endpoints
2. **Backend**: Ensure stock ledger/history creation
3. **Mobile**: Add `from_location_id` to events (if available)
4. **Mobile**: Add validation API calls (if endpoints available)
5. **Both**: Implement E2E test cases (TC6, TC7)

---

**Status**: ⚠️ **PARTIAL COMPLIANCE**

The mobile app implements the basic putaway workflow, but validation depends on backend implementation of stock ledger, history, and validation endpoints.
