# Material Request Packing Screen - Redesign Analysis

## Overview
Redesign Material Request Packing screen to follow Cycle Count design patterns and workflow, with immediate backend updates.

---

## Current State vs. Proposed State

### Current Material Request Packing Flow:
1. User navigates to Material Request Detail
2. Clicks "Start Packing"
3. Screen shows: Location scan → Box ID scan → Item scan
4. Transfer Carton created when needed (not immediately)
5. Events queued locally, synced later

### Proposed Material Request Packing Flow:
1. **"Start Picking" Button** → Creates Transfer Carton **immediately** (backend or local)
2. **Scan Bin Location ID** → Validate from backend → Update to backend → On success
3. **Scan Carton ID** → Update to backend → On success
4. **List Requested Items** (similar to Cycle Count) with:
   - Requested quantity
   - Location ID icon (to show where items are located)
   - Scanned quantity
5. **"Change Carton" button** on top (similar to Cycle Count)

---

## Design Similarities with Cycle Count

### 1. Screen Layout Structure

#### Cycle Count Bin Counting Screen:
```
┌─────────────────────────────────────┐
│ Header (Blue) - Title, Online, Sync │
├─────────────────────────────────────┤
│ [Mark Bin] [Submit Bin] Buttons     │
├─────────────────────────────────────┤
│ Purple Section:                     │
│   Bin: A1-R01-L3-B1                 │
│   Carton: A1-R01-L4-B1 [Change]     │
│   Task: CC-1-MKASJJGY               │
│   0 item(s) scanned                 │
├─────────────────────────────────────┤
│ Orange Card: Scan Carton ID          │
│   [Input] [Scan] [Generate]         │
├─────────────────────────────────────┤
│ Blue Card: Scan Item Barcode        │
│   [Input] [Submit]                  │
├─────────────────────────────────────┤
│ White Section: Expected Items        │
│   - Item list with location icons   │
└─────────────────────────────────────┘
```

#### Proposed Material Request Packing Screen:
```
┌─────────────────────────────────────┐
│ Header (Blue) - Title, Online, Sync │
├─────────────────────────────────────┤
│ [Mark Bin] [Submit Bin] Buttons     │
├─────────────────────────────────────┤
│ Purple Section:                     │
│   Material Request: MR-123460       │
│   Bin: [Scanned Location]           │
│   Carton: [Scanned Carton] [Change] │
│   Transfer Carton: TC-MR-123460-...  │
│   X item(s) scanned                 │
├─────────────────────────────────────┤
│ Orange Card: Scan Bin Location ID   │
│   [Input] [Scan]                    │
├─────────────────────────────────────┤
│ Blue Card: Scan Carton ID           │
│   [Input] [Scan] [Generate]          │
├─────────────────────────────────────┤
│ Green Card: Scan Item Barcode       │
│   [Input] [Submit]                  │
├─────────────────────────────────────┤
│ White Section: Requested Items       │
│   - Item list with location icons   │
│   - Requested Qty | Scanned Qty      │
└─────────────────────────────────────┘
```

---

## Detailed Workflow

### Step 1: Start Picking
**Action:** User clicks "Start Picking" button

**Backend Operations:**
1. **Create Transfer Carton immediately:**
   ```typescript
   POST /api/transfer-cartons/create
   {
     "tc_id": "TC-MR-{MR_TITLE}-{TIMESTAMP}",
     "material_request": "MR-123460",
     "store": "STORE-002",
     "user_id": "USER-150526",
     "created_by": "USER-150526"
   }
   ```
2. **If online:** Create in backend, save response to local `tc_cache`
3. **If offline:** Create locally in `tc_cache`, sync when online

**UI Changes:**
- Button changes to "Picking in Progress"
- Transfer Carton ID displayed in purple section
- Enable location scanning

---

### Step 2: Scan Bin Location ID
**Action:** User scans or enters bin location ID (e.g., "A1-R01-L3-B1")

**Backend Operations:**
1. **Validate bin location from backend:**
   ```typescript
   GET /api/bin-master/{bin_code}
   // OR check local bin_master_cache first, then backend
   ```
2. **Update backend with current location:**
   ```typescript
   POST /api/material-request/{mr_title}/update-location
   {
     "bin_location": "A1-R01-L3-B1",
     "tc_id": "TC-MR-123460-...",
     "user_id": "USER-150526"
   }
   ```
   **OR** (if endpoint doesn't exist):
   - Store in local state
   - Include in packing events

**UI Changes:**
- Display validated bin location in purple section
- Show bin information card (similar to Cycle Count)
- Enable carton ID scanning

**Validation:**
- Check `bin_master_cache` table (local)
- If not found, query backend API
- Show error if invalid bin location

---

### Step 3: Scan Carton ID
**Action:** User scans or enters carton ID

**Backend Operations:**
1. **Update backend with carton ID:**
   ```typescript
   POST /api/material-request/{mr_title}/update-carton
   {
     "carton_id": "CTN-A1-R01-L4-B1",
     "bin_location": "A1-R01-L3-B1",
     "tc_id": "TC-MR-123460-...",
     "user_id": "USER-150526"
   }
   ```
   **OR** (if endpoint doesn't exist):
   - Store in local state
   - Include in packing events

**UI Changes:**
- Display carton ID in purple section
- Show "Change Carton" button (top right, similar to Cycle Count)
- Enable item scanning
- Load expected items for this carton

**Expected Items Loading:**
- Query stock ledger for items in this carton at this location
- Display items with:
  - Item code
  - Item name
  - Expected quantity (from stock ledger)
  - Location icon (showing bin location)

---

### Step 4: List Requested Items
**Display:** Similar to Cycle Count "Expected Items" section

**Item List Structure:**
```
┌─────────────────────────────────────────────┐
│ Requested Items                             │
│ Material Request: MR-123460                │
├─────────────────────────────────────────────┤
│ 📍 A1-R01-L3-B1 (Qty: 10)                  │
│    A1-R02-L1-B1 (Qty: 5)                    │
│ SKU-HAT-301-GRN-OS                         │
│ Hat Green One Size                         │
│ Requested: 15 | Scanned: 3 | Remaining: 12 │
├─────────────────────────────────────────────┤
│ 📍 A1-R01-L3-B1 (Qty: 3)                   │
│ SKU-JACKET-201-BLK-L                       │
│ Jacket Black Large                         │
│ Requested: 5 | Scanned: 0 | Remaining: 5   │
└─────────────────────────────────────────────┘
```

**Features:**
- **Location Icons (📍):** Shows ALL available locations for each item (from stock ledger)
- **Location Details:** Shows bin location and available quantity at that location
- **Multiple Locations:** If item is in multiple locations, show all with quantities
- **Requested Qty:** From Material Request items (total across all locations)
- **Scanned Qty:** From scanned items (real-time, total across all locations)
- **Remaining Qty:** Requested - Scanned
- **Color coding:**
  - Green: Fully scanned (Scanned >= Requested)
  - Yellow: Partially scanned (Scanned > 0 && Scanned < Requested)
  - Gray: Not scanned (Scanned = 0)

**Data Source:**
- Requested items: From Material Request items (ALL items, not filtered)
- Location info: From stock ledger API (`GET /api/stock/item/{item_code}/warehouse/{warehouse}`)
  - Shows all bin locations where item is available
  - Shows quantity at each location
- Scanned items: From local `scanned_items` table and `event_queue`

**Location Display Logic:**
- For each item in Material Request, fetch stock locations
- Display all locations where item is available
- Show quantity at each location
- User can pick from any location (not restricted to scanned location)

---

### Step 5: Scan Items
**Action:** User scans item barcodes

**Backend Operations:**
1. **Immediate event creation:**
   ```typescript
   POST /api/events/batch
   {
     "events": [{
       "event_type": "PACK_ITEM_TO_TC",
       "offline_uuid": "...",
       "item_code": "SKU-HAT-301-GRN-OS",
       "qty": 1,
       "carton_id": "CTN-A1-R01-L4-B1",
       "tc_id": "TC-MR-123460-...",
       "transfer_order": "MR-123460",
       "bin_location": "A1-R01-L3-B1",
       "store": "STORE-002",
       "device_id": "DEVICE-001",
       "user_id": "USER-150526"
     }]
   }
   ```
2. **Update local database:**
   - Save to `event_queue`
   - Save to `scanned_items`
   - Update UI immediately

**UI Updates:**
- Increment scanned quantity for item
- Update remaining quantity
- Show visual feedback (vibration, color change)
- Keep last scanned item at top of list

---

## UI Components to Replicate

### 1. Purple Header Section
- **Background:** Purple gradient (#9C27B0)
- **Text:** White, bold
- **Content:**
  - Material Request title
  - Bin location (after scan)
  - Carton ID (after scan) with "Change Carton" button
  - Transfer Carton ID
  - Scanned items count

### 2. Action Buttons
- **"Mark Bin"** (Purple) - Mark current bin as complete
- **"Submit Bin"** (Green) - Submit all scanned items for this bin

### 3. Colored Cards
- **Orange Card:** Scan Bin Location ID
- **Blue Card:** Scan Carton ID
- **Green Card:** Scan Item Barcode
- **White Section:** Requested Items List

### 4. Location Icon
- **Icon:** 📍 (or custom location icon)
- **Display:** Next to each item in the list
- **Purpose:** Show user where item is located without going back

### 5. Change Carton Button
- **Position:** Top right of purple section (next to carton ID)
- **Functionality:**
  - Clear current carton ID
  - Reset carton input field
  - Show carton ID input card
  - Focus carton input

---

## Backend API Requirements

### 1. Create Transfer Carton (Immediate)
```
POST /api/transfer-cartons/create
Body: {
  "tc_id": "TC-MR-{MR_TITLE}-{TIMESTAMP}",
  "material_request": "MR-123460",
  "store": "STORE-002",
  "user_id": "USER-150526"
}
Response: {
  "tc_id": "TC-MR-123460-1768157787512",
  "status": "Created",
  "created_at": "2026-01-11T..."
}
```

### 2. Validate Bin Location
```
GET /api/bin-master/{bin_code}
Response: {
  "bin_code": "A1-R01-L3-B1",
  "warehouse": "WH-MAIN",
  "zone": "Zone A",
  "aisle": "Aisle 01",
  "rack": "Rack 01",
  "level": "Level 3",
  "bin": "Bin 1"
}
```

### 3. Update Bin Location (Optional)
```
POST /api/material-request/{mr_title}/update-location
Body: {
  "bin_location": "A1-R01-L3-B1",
  "tc_id": "TC-MR-123460-...",
  "user_id": "USER-150526"
}
```

### 4. Update Carton ID (Optional)
```
POST /api/material-request/{mr_title}/update-carton
Body: {
  "carton_id": "CTN-A1-R01-L4-B1",
  "bin_location": "A1-R01-L3-B1",
  "tc_id": "TC-MR-123460-...",
  "user_id": "USER-150526"
}
```

### 5. Get Stock by Item and Warehouse (Existing)
```
GET /api/stock/item/{item_code}/warehouse/{warehouse}
Response: [
  {
    "bin_location": "A1-R01-L3-B1",
    "cartons": [
      { "carton_id": "CTN-A1-R01-L4-B1", "qty": 10 }
    ],
    "total_qty": 10
  }
]
```

---

## Implementation Considerations

### 1. Offline Support
- **Transfer Carton Creation:**
  - If offline, create locally with status "Pending"
  - Sync to backend when online
  - Update local TC with backend response

- **Bin/Carton Updates:**
  - Store in local state
  - Include in packing events
  - Backend can extract from events

### 2. State Management
- **Current Location:** Store in component state
- **Current Carton:** Store in component state
- **Transfer Carton:** Store in component state and `tc_cache`
- **Scanned Items:** Store in `scanned_items` and `event_queue`

### 3. Real-time Updates
- **Immediate UI updates** when items are scanned
- **Backend sync** happens in background (via event queue)
- **Visual feedback** for successful scans

### 4. Error Handling
- **Invalid Bin Location:** Show error, allow retry
- **Invalid Carton ID:** Show error, allow retry or generate new
- **Backend Unavailable:** Continue with local storage, sync later
- **Network Errors:** Queue events, show sync status

### 5. Navigation Flow
```
Material Request Detail
  ↓ [Start Picking]
Material Request Packing (New Design)
  ↓ [Scan Bin Location]
  ↓ [Scan Carton ID]
  ↓ [Scan Items]
  ↓ [Submit Bin]
Material Request Detail (Updated)
```

---

## Questions for Clarification - ✅ ANSWERED

1. **Backend API Endpoints:**
   - Do endpoints `/api/material-request/{mr_title}/update-location` and `/api/material-request/{mr_title}/update-carton` exist?
   - **Answer:** Include location/carton in packing events (no separate endpoints needed)

2. **Bin Location Validation:**
   - Should we validate bin location from backend immediately, or use local `bin_master_cache`?
   - **Answer:** ✅ **Local first, then backend** (if not found locally)

3. **Carton ID:**
   - Can carton ID be generated if not scanned?
   - Should we validate carton ID from backend?
   - **Answer:** Can be generated, no backend validation needed

4. **Expected Items:**
   - Should we show ALL items from Material Request, or only items available at the scanned location?
   - **Answer:** ✅ **Show ALL Material Request items** (not filtered by location)

5. **Location Icon:**
   - Should location icon show the scanned bin location, or the item's actual location from stock ledger?
   - **Answer:** ✅ **Show each item's available locations** (from stock ledger API) - where user can pick from

---

## Next Steps

1. **Confirm backend API endpoints** (or create them)
2. **Design UI mockups** based on Cycle Count patterns
3. **Implement "Start Picking" flow** with immediate TC creation
4. **Implement bin location scanning** with backend validation
5. **Implement carton ID scanning** with backend update
6. **Implement requested items list** with location icons
7. **Implement "Change Carton" button**
8. **Test offline/online scenarios**
9. **Test error handling**

---

## Estimated Implementation Time

- **Backend API endpoints:** 2-4 hours (if needed)
- **UI Redesign:** 4-6 hours
- **Workflow Implementation:** 6-8 hours
- **Testing & Bug Fixes:** 2-4 hours
- **Total:** 14-22 hours

---

**Ready to proceed once you confirm the questions above!**
