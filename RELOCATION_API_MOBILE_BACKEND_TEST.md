# Relocation API Mobile App to Backend Testing Guide

## Overview
This document provides comprehensive testing scenarios for the Relocation/Bin Transfer module, covering all API endpoints from mobile app to backend.

---

## API Endpoints Summary

### 1. Start Relocation Session
**Endpoint:** `POST /api/relocation/session/start`

### 2. Set FROM Location
**Endpoint:** `PUT /api/relocation/session/:session_id/from`

### 3. Set TO Location
**Endpoint:** `PUT /api/relocation/session/:session_id/to`

### 4. Get Carton Contents (Optional)
**Endpoint:** `GET /api/relocation/carton/:carton_id/contents`

### 5. Commit Relocation - FULL_CARTON
**Endpoint:** `POST /api/relocation/session/:session_id/commit-full`

### 6. Commit Relocation - PARTIAL/CARTON_TO_CARTON
**Endpoint:** `POST /api/relocation/session/:session_id/commit-partial`

---

## Test Scenarios

### Test Case 1: FULL_CARTON Mode - Complete Flow

#### Step 1: Start Session
**Mobile App Action:** User selects "Move Full Carton" mode

**API Call:**
```http
POST /api/relocation/session/start
Content-Type: application/json

{
  "mode": "FULL_CARTON",
  "warehouse_id": "WH-MAIN",
  "user_id": "USER-150526"
}
```

**Expected Response:**
```json
{
  "ok": true,
  "session_id": "RL-20260116-123456"
}
```

**Validation:**
- ✅ Status code: 200
- ✅ Response contains `session_id`
- ✅ Session created in backend with mode = "FULL_CARTON"

---

#### Step 2: Set FROM Bin
**Mobile App Action:** User scans FROM bin location

**API Call:**
```http
PUT /api/relocation/session/RL-20260116-123456/from
Content-Type: application/json

{
  "from_bin": "A1-R02-L1-B2",
  "from_carton": null
}
```

**Expected Response:**
```json
{
  "ok": true,
  "message": "FROM location set successfully"
}
```

**Validation:**
- ✅ Status code: 200
- ✅ Session `from_bin` updated in backend

---

#### Step 3: Set FROM Carton
**Mobile App Action:** User scans FROM carton ID

**API Call:**
```http
PUT /api/relocation/session/RL-20260116-123456/from
Content-Type: application/json

{
  "from_bin": "A1-R02-L1-B2",
  "from_carton": "CTN-123456"
}
```

**Expected Response:**
```json
{
  "ok": true,
  "message": "FROM location updated successfully"
}
```

**Validation:**
- ✅ Status code: 200
- ✅ Session `from_carton` updated in backend

---

#### Step 4: Set TO Bin
**Mobile App Action:** User scans TO bin location

**API Call:**
```http
PUT /api/relocation/session/RL-20260116-123456/to
Content-Type: application/json

{
  "to_bin": "A1-R02-L3-B2",
  "to_carton": null
}
```

**Expected Response:**
```json
{
  "ok": true,
  "message": "TO location set successfully"
}
```

**Validation:**
- ✅ Status code: 200
- ✅ Session `to_bin` updated in backend

---

#### Step 5: Set TO Carton (Same as FROM)
**Mobile App Action:** User taps "Keep Same Carton" or scans same carton ID

**API Call:**
```http
PUT /api/relocation/session/RL-20260116-123456/to
Content-Type: application/json

{
  "to_bin": "A1-R02-L3-B2",
  "to_carton": "CTN-123456"
}
```

**Expected Response:**
```json
{
  "ok": true,
  "message": "TO location updated successfully"
}
```

**Validation:**
- ✅ Status code: 200
- ✅ Session `to_carton` = `from_carton` (same carton ID)
- ✅ Backend validates: `from_carton === to_carton` for FULL_CARTON mode

---

#### Step 6: Commit Relocation (FULL_CARTON)
**Mobile App Action:** User taps "Complete Relocation"

**API Call:**
```http
POST /api/relocation/session/RL-20260116-123456/commit-full
Content-Type: application/json

{
  "lines": []
}
```

**Expected Response:**
```json
{
  "ok": true,
  "message": "Relocation committed successfully",
  "session_id": "RL-20260116-123456"
}
```

**Validation:**
- ✅ Status code: 200
- ✅ Backend validates session mode is "FULL_CARTON"
- ✅ Stock ledger updated: decrease qty from `from_bin`, increase qty to `to_bin`
- ✅ Carton location updated: `CTN-123456` moved from `A1-R02-L1-B2` to `A1-R02-L3-B2`
- ✅ Session status = "Completed"

**Backend Checks:**
- [ ] Session exists
- [ ] Session mode = "FULL_CARTON"
- [ ] `from_bin` and `to_bin` are set
- [ ] `from_carton === to_carton` (validation)
- [ ] Stock ledger has sufficient qty in `from_bin`
- [ ] All items in carton moved to `to_bin`

---

### Test Case 2: FULL_CARTON Mode - Invalid (Different Carton IDs)

#### Steps 1-4: Same as Test Case 1

#### Step 5: Set TO Carton (Different from FROM) - Should be Rejected by Mobile App
**Mobile App Action:** User tries to scan different carton ID (e.g., "CTN-789012")

**Expected Behavior:**
- ✅ Mobile app shows validation error before API call
- ✅ Error message: "FULL_CARTON mode is for moving a carton from one bin to another. The destination carton ID must be the same as the source carton ID."
- ✅ User can tap "Use Same Carton" to correct

**If Validation Bypassed (Should Not Happen):**
```http
PUT /api/relocation/session/RL-20260116-123456/to
Content-Type: application/json

{
  "to_bin": "A1-R02-L3-B2",
  "to_carton": "CTN-789012"  // Different from CTN-123456
}
```

**Expected Backend Response:**
```json
{
  "code": "VALIDATION_ERROR",
  "message": "FULL_CARTON mode requires from_carton === to_carton"
}
```

**Validation:**
- ✅ Backend rejects different carton IDs for FULL_CARTON mode
- ✅ Status code: 400

---

### Test Case 3: PARTIAL_ITEMS Mode - Complete Flow

#### Step 1: Start Session
**API Call:**
```http
POST /api/relocation/session/start
Content-Type: application/json

{
  "mode": "PARTIAL_ITEMS",
  "warehouse_id": "WH-MAIN",
  "user_id": "USER-150526"
}
```

**Expected Response:**
```json
{
  "ok": true,
  "session_id": "RL-20260116-789012"
}
```

---

#### Steps 2-4: Set FROM/TO Locations (Same as Test Case 1)

#### Step 5: Commit Relocation (PARTIAL_ITEMS)
**Mobile App Action:** User scans items and taps "Complete Relocation"

**API Call:**
```http
POST /api/relocation/session/RL-20260116-789012/commit-partial
Content-Type: application/json

{
  "lines": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 2
    },
    {
      "item_code": "SKU-HAT-301-GRN-OS",
      "qty": 5
    }
  ]
}
```

**Expected Response:**
```json
{
  "ok": true,
  "message": "Relocation committed successfully",
  "lines_processed": 2
}
```

**Validation:**
- ✅ Status code: 200
- ✅ Backend validates session mode is "PARTIAL_ITEMS"
- ✅ Stock ledger updated for each item:
  - Decrease qty from `from_bin` (and `from_carton` if specified)
  - Increase qty to `to_bin` (and `to_carton` if specified)
- ✅ Session status = "Completed"

**Backend Checks:**
- [ ] Session exists
- [ ] Session mode = "PARTIAL_ITEMS"
- [ ] `from_bin` and `to_bin` are set
- [ ] Stock ledger has sufficient qty for each item in `from_bin`
- [ ] Quantities moved correctly for each item

---

### Test Case 4: CARTON_TO_CARTON Mode - Complete Flow

#### Step 1: Start Session
**API Call:**
```http
POST /api/relocation/session/start
Content-Type: application/json

{
  "mode": "CARTON_TO_CARTON",
  "warehouse_id": "WH-MAIN",
  "user_id": "USER-150526"
}
```

**Expected Response:**
```json
{
  "ok": true,
  "session_id": "RL-20260116-345678"
}
```

---

#### Steps 2-3: Set FROM Bin and FROM Carton (Same as Test Case 1)

#### Step 4: Set TO Bin

#### Step 5: Set TO Carton (Different from FROM)
**API Call:**
```http
PUT /api/relocation/session/RL-20260116-345678/to
Content-Type: application/json

{
  "to_bin": "A1-R02-L3-B2",
  "to_carton": "CTN-789012"  // Different from CTN-123456
}
```

**Expected Response:**
```json
{
  "ok": true,
  "message": "TO location updated successfully"
}
```

**Validation:**
- ✅ Status code: 200
- ✅ Backend accepts different carton IDs for CARTON_TO_CARTON mode
- ✅ Session `to_carton` updated

---

#### Step 6: Commit Relocation (CARTON_TO_CARTON)
**Mobile App Action:** All items from source carton are auto-loaded (blind mode), user taps "Complete Relocation"

**API Call:**
```http
POST /api/relocation/session/RL-20260116-345678/commit-partial
Content-Type: application/json

{
  "lines": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 4
    },
    {
      "item_code": "SKU-HAT-301-GRN-OS",
      "qty": 6
    }
  ]
}
```

**Expected Response:**
```json
{
  "ok": true,
  "message": "Relocation committed successfully",
  "lines_processed": 2
}
```

**Validation:**
- ✅ Status code: 200
- ✅ Backend validates session mode is "CARTON_TO_CARTON"
- ✅ Uses `commit-partial` endpoint (NOT `commit-full`)
- ✅ Stock ledger updated:
  - Decrease qty from `from_bin` + `from_carton` (CTN-123456)
  - Increase qty to `to_bin` + `to_carton` (CTN-789012)
- ✅ Items moved from source carton to destination carton

**Backend Checks:**
- [ ] Session exists
- [ ] Session mode = "CARTON_TO_CARTON"
- [ ] `from_carton !== to_carton` (validation)
- [ ] Stock ledger has sufficient qty for each item in source carton
- [ ] Items correctly moved to destination carton

---

## Error Scenarios

### Error Test 1: Wrong Commit Endpoint for Mode

#### Scenario: CARTON_TO_CARTON mode using commit-full endpoint
**Mobile App Action:** (Should not happen after fix, but test backend rejection)

**API Call:**
```http
POST /api/relocation/session/RL-20260116-345678/commit-full
Content-Type: application/json

{
  "lines": [...]
}
```

**Expected Backend Response:**
```json
{
  "code": "INVALID_MODE",
  "message": "Session RL-20260116-345678 is not in FULL_CARTON mode (current mode: CARTON_TO_CARTON). Use /api/relocation/session/RL-20260116-345678/commit-partial endpoint for CARTON_TO_CARTON mode."
}
```

**Validation:**
- ✅ Status code: 400
- ✅ Error message includes current mode
- ✅ Error message suggests correct endpoint

---

### Error Test 2: FULL_CARTON mode using commit-partial endpoint
**API Call:**
```http
POST /api/relocation/session/RL-20260116-123456/commit-partial
Content-Type: application/json

{
  "lines": []
}
```

**Expected Backend Response:**
```json
{
  "code": "INVALID_MODE",
  "message": "Session RL-20260116-123456 is in FULL_CARTON mode. Use /api/relocation/session/RL-20260116-123456/commit-full endpoint for FULL_CARTON mode."
}
```

**Validation:**
- ✅ Status code: 400
- ✅ Error message suggests correct endpoint

---

### Error Test 3: Missing Required Fields

#### Missing warehouse_id or user_id in start session
**API Call:**
```http
POST /api/relocation/session/start
Content-Type: application/json

{
  "mode": "FULL_CARTON"
}
```

**Expected Backend Response:**
```json
{
  "code": "VALIDATION_ERROR",
  "message": "mode, warehouse_id, and user_id are required"
}
```

**Validation:**
- ✅ Status code: 400
- ✅ Clear validation error message

---

### Error Test 4: Invalid Session ID

**API Call:**
```http
PUT /api/relocation/session/INVALID-SESSION/from
Content-Type: application/json

{
  "from_bin": "A1-R02-L1-B2",
  "from_carton": null
}
```

**Expected Backend Response:**
```json
{
  "code": "NOT_FOUND",
  "message": "Relocation session not found: INVALID-SESSION"
}
```

**Validation:**
- ✅ Status code: 404
- ✅ Clear error message

---

## Mobile App Validation Tests

### Test 1: FULL_CARTON Mode Validation (Client-Side)
**Scenario:** User scans different carton ID in TO carton screen

**Expected Mobile App Behavior:**
- ✅ Shows error dialog before API call
- ✅ Error message explains the rule
- ✅ Offers "Use Same Carton" button
- ✅ Prevents navigation to Execute screen

---

### Test 2: Automatic Item Loading (CARTON_TO_CARTON)
**Scenario:** User completes TO carton scan, navigates to Execute screen

**Expected Mobile App Behavior:**
- ✅ Automatically loads all items from source carton
- ✅ Pre-fills `move_qty = available_qty` for all items (blind mode)
- ✅ Shows items in list without requiring manual scan
- ✅ User can still edit quantities if needed

---

### Test 3: Correct Endpoint Selection
**Scenario:** User completes relocation in different modes

**Expected Mobile App Behavior:**
- ✅ FULL_CARTON mode → calls `commit-full` endpoint
- ✅ PARTIAL_ITEMS mode → calls `commit-partial` endpoint
- ✅ CARTON_TO_CARTON mode → calls `commit-partial` endpoint
- ✅ No INVALID_MODE errors from backend

---

## Integration Test Checklist

### Pre-Test Setup
- [ ] Backend API is running
- [ ] Mobile app is connected to backend
- [ ] Test warehouse exists: "WH-MAIN"
- [ ] Test bins exist: "A1-R02-L1-B2", "A1-R02-L3-B2"
- [ ] Test cartons exist: "CTN-123456", "CTN-789012"
- [ ] Stock ledger has test items in source bin/carton

### FULL_CARTON Mode Tests
- [ ] Test Case 1: Complete flow succeeds
- [ ] Test Case 2: Different carton IDs rejected (mobile validation)
- [ ] Error Test 2: commit-partial rejected for FULL_CARTON mode

### PARTIAL_ITEMS Mode Tests
- [ ] Test Case 3: Complete flow succeeds
- [ ] Error Test 1: commit-full rejected for PARTIAL_ITEMS mode

### CARTON_TO_CARTON Mode Tests
- [ ] Test Case 4: Complete flow succeeds
- [ ] Test 2: Automatic item loading works
- [ ] Test 3: Uses commit-partial endpoint (not commit-full)
- [ ] Error Test 1: commit-full rejected for CARTON_TO_CARTON mode

### Error Handling Tests
- [ ] Error Test 3: Missing required fields rejected
- [ ] Error Test 4: Invalid session ID returns 404
- [ ] Backend error messages are clear and helpful

### Stock Ledger Verification
- [ ] Quantities decreased in source bin/carton
- [ ] Quantities increased in destination bin/carton
- [ ] Stock transactions recorded correctly
- [ ] Carton locations updated correctly

---

## Expected API Request/Response Formats

### Start Session Request
```json
{
  "mode": "FULL_CARTON" | "PARTIAL_ITEMS" | "CARTON_TO_CARTON",
  "warehouse_id": "WH-MAIN",
  "user_id": "USER-150526"
}
```

### Set FROM/TO Request
```json
{
  "from_bin": "A1-R02-L1-B2",      // or to_bin
  "from_carton": "CTN-123456"      // or to_carton (nullable)
}
```

### Commit Request (commit-full)
```json
{
  "lines": []  // Empty for FULL_CARTON (all items in carton moved)
}
```

### Commit Request (commit-partial)
```json
{
  "lines": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 2
    }
  ]
}
```

---

## Success Criteria

### Mobile App
- ✅ All API endpoints called correctly
- ✅ Mode validation prevents invalid operations
- ✅ Correct commit endpoint selected based on mode
- ✅ Automatic item loading works for CARTON_TO_CARTON
- ✅ Error messages are user-friendly

### Backend
- ✅ All endpoints return correct status codes
- ✅ Validation errors are clear and helpful
- ✅ Stock ledger updated correctly
- ✅ Session state managed correctly
- ✅ Carton locations updated correctly

---

## Notes

1. **Events Fallback:** If commit endpoint fails, mobile app creates `RELOCATION_MOVE` events that are synced via `/api/events/batch`. Backend should process these events correctly.

2. **Session State:** Backend should maintain session state (from_bin, from_carton, to_bin, to_carton) between PUT calls and use them during commit.

3. **Stock Ledger:** Backend should validate sufficient stock before committing and update quantities atomically.

4. **Error Messages:** All error messages should include:
   - Error code
   - Clear description
   - Suggested action (when applicable)
