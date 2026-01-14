# Material Request Packing - Required API Endpoints

## Overview
This document lists all API endpoints required for the Material Request Packing screen redesign, following the Cycle Count workflow pattern.

---

## 1. Transfer Carton Creation (Immediate)

### Endpoint: `POST /api/transfer-cartons/create`

**Purpose:** Create Transfer Carton immediately when "Start Picking" is clicked.

**Request:**
```json
{
  "tc_id": "TC-MR-123460-1768157787512",
  "material_request": "MR-123460",
  "store": "STORE-002",
  "user_id": "USER-150526",
  "created_by": "USER-150526"
}
```

**Response (Success - 200/201):**
```json
{
  "tc_id": "TC-MR-123460-1768157787512",
  "status": "Created",
  "material_request": "MR-123460",
  "store": "STORE-002",
  "created_at": "2026-01-11T21:30:00.000Z",
  "created_by": "USER-150526"
}
```

**Response (Error - 400/500):**
```json
{
  "code": "VALIDATION_ERROR",
  "message": "Missing required field: store",
  "details": {}
}
```

**Notes:**
- ✅ **Already exists** (confirmed in codebase)
- Mobile app generates `tc_id` if not provided
- Backend may also generate `tc_id` if not provided
- Must work offline (create locally, sync later)

---

## 2. Bin Location Validation

### Endpoint: `GET /api/bin-master/{bin_code}`

**Purpose:** Validate bin location ID when user scans it.

**Request:**
```
GET /api/bin-master/A1-R01-L3-B1
Authorization: Bearer {token}
```

**Response (Success - 200):**
```json
{
  "bin_code": "A1-R01-L3-B1",
  "bin_id": "A1-R01-L3-B1",
  "bin_barcode": "A1-R01-L3-B1",
  "warehouse": "WH-MAIN",
  "warehouse_id": "WH-MAIN",
  "zone": "Zone A",
  "aisle": "Aisle 01",
  "rack": "Rack 01",
  "level": "Level 3",
  "bin": "Bin 1",
  "status": "Active"
}
```

**Response (Not Found - 404):**
```json
{
  "code": "NOT_FOUND",
  "message": "Bin location not found: A1-R01-L3-B1"
}
```

**Alternative:** Use local `bin_master_cache` table first, then backend if not found.

**Notes:**
- ⚠️ **May not exist** - need to confirm with backend
- Mobile app can use local `bin_master_cache` as fallback
- Should support case-insensitive search

---

## 3. Update Bin Location (Optional)

### Endpoint: `POST /api/material-request/{mr_title}/update-location`

**Purpose:** Update backend with current bin location being picked from.

**Request:**
```
POST /api/material-request/MR-123460/update-location
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "bin_location": "A1-R01-L3-B1",
  "tc_id": "TC-MR-123460-1768157787512",
  "user_id": "USER-150526",
  "device_id": "DEVICE-001"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Bin location updated",
  "bin_location": "A1-R01-L3-B1",
  "tc_id": "TC-MR-123460-1768157787512"
}
```

**Response (Error - 400/404):**
```json
{
  "code": "VALIDATION_ERROR",
  "message": "Invalid bin location or Material Request not found"
}
```

**Notes:**
- ⚠️ **May not exist** - need to confirm with backend
- **Alternative:** Include `bin_location` in packing events (no separate endpoint needed)
- If not implemented, mobile app will include location in events

---

## 4. Update Carton ID (Optional)

### Endpoint: `POST /api/material-request/{mr_title}/update-carton`

**Purpose:** Update backend with current carton ID being picked from.

**Request:**
```
POST /api/material-request/MR-123460/update-carton
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "carton_id": "CTN-A1-R01-L4-B1",
  "bin_location": "A1-R01-L3-B1",
  "tc_id": "TC-MR-123460-1768157787512",
  "user_id": "USER-150526",
  "device_id": "DEVICE-001"
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "message": "Carton ID updated",
  "carton_id": "CTN-A1-R01-L4-B1",
  "bin_location": "A1-R01-L3-B1",
  "tc_id": "TC-MR-123460-1768157787512"
}
```

**Response (Error - 400/404):**
```json
{
  "code": "VALIDATION_ERROR",
  "message": "Invalid carton ID or Material Request not found"
}
```

**Notes:**
- ⚠️ **May not exist** - need to confirm with backend
- **Alternative:** Include `carton_id` in packing events (already implemented)
- If not implemented, mobile app will include carton in events

---

## 5. Get Stock by Item and Warehouse (Existing)

### Endpoint: `GET /api/stock/item/{item_code}/warehouse/{warehouse}`

**Purpose:** Get stock locations for items to show location icons in requested items list.

**Request:**
```
GET /api/stock/item/SKU-HAT-301-GRN-OS/warehouse/WH-MAIN
Authorization: Bearer {token}
```

**Response (Success - 200):**
```json
[
  {
    "bin_location": "A1-R01-L3-B1",
    "cartons": [
      {
        "carton_id": "CTN-A1-R01-L4-B1",
        "qty": 10
      },
      {
        "carton_id": "CTN-A1-R01-L5-B2",
        "qty": 5
      }
    ],
    "total_qty": 15
  },
  {
    "bin_location": "A1-R02-L1-B1",
    "cartons": [
      {
        "carton_id": "CTN-A1-R02-L1-B1",
        "qty": 3
      }
    ],
    "total_qty": 3
  }
]
```

**Response (Not Found - 404):**
```json
{
  "code": "NOT_FOUND",
  "message": "Stock not found for item SKU-HAT-301-GRN-OS in warehouse WH-MAIN"
}
```

**Notes:**
- ✅ **Already exists** (confirmed in codebase)
- Returns grouped format: `bin_location` → `cartons` → `qty`
- Mobile app uses this to show location icons

---

## 6. Get Material Request Details (Existing)

### Endpoint: `GET /api/material-request/{mr_title}`

**Purpose:** Get Material Request details including requested items.

**Request:**
```
GET /api/material-request/MR-123460
Authorization: Bearer {token}
```

**Response (Success - 200):**
```json
{
  "title": "MR-123460",
  "from_warehouse": "WH-MAIN",
  "to_showroom": "STORE-002",
  "status": "Open",
  "items": [
    {
      "item_code": "SKU-HAT-301-GRN-OS",
      "item_name": "Hat Green One Size",
      "requested_qty": 10,
      "picked_qty": 0,
      "status": "Pending"
    },
    {
      "item_code": "SKU-JACKET-201-BLK-L",
      "item_name": "Jacket Black Large",
      "requested_qty": 5,
      "picked_qty": 0,
      "status": "Pending"
    }
  ]
}
```

**Notes:**
- ✅ **Already exists** (confirmed in codebase)
- Used to display requested items list

---

## 7. Batch Events Sync (Existing)

### Endpoint: `POST /api/events/batch`

**Purpose:** Sync packing events to backend immediately.

**Request:**
```
POST /api/events/batch
Authorization: Bearer {token}
Content-Type: application/json
```

```json
{
  "events": [
    {
      "offline_uuid": "550e8400-e29b-41d4-a716-446655440001",
      "event_type": "PACK_ITEM_TO_TC",
      "event_time": "2026-01-11T21:56:00.000Z",
      "device_id": "DEVICE-001",
      "user_id": "USER-150526",
      "item_code": "SKU-HAT-301-GRN-OS",
      "qty": 2.00,
      "carton_id": "CTN-A1-R01-L4-B1",
      "tc_id": "TC-MR-123460-1768157787512",
      "transfer_order": "MR-123460",
      "material_request": "MR-123460",
      "store": "STORE-002",
      "bin_location": "A1-R01-L3-B1",
      "rack": "A1-R01-L3-B1",
      "bin": "A1-R01-L3-B1",
      "source_bin": "A1-R01-L3-B1",
      "location_id": "A1-R01-L3-B1"
    }
  ]
}
```

**Response (Success - 200):**
```json
{
  "acked": [
    "550e8400-e29b-41d4-a716-446655440001"
  ],
  "failed": [],
  "inserted_count": 1,
  "total_count": 1
}
```

**Response (Partial Success - 200):**
```json
{
  "acked": [
    "550e8400-e29b-41d4-a716-446655440001"
  ],
  "failed": [
    {
      "uuid": "550e8400-e29b-41d4-a716-446655440002",
      "message": "Invalid item code"
    }
  ],
  "inserted_count": 1,
  "total_count": 2
}
```

**Notes:**
- ✅ **Already exists** (confirmed in codebase)
- Events are sent immediately after scanning
- Backend processes events and updates `tabWmsScanEvent` table
- Desktop app queries `tabWmsScanEvent WHERE tc_id = 'TC-MR-123460-...'` to show items

---

## 8. Get Transfer Cartons (Existing)

### Endpoint: `GET /api/transfer-cartons?material_request={mr_title}&store={store}`

**Purpose:** Get existing Transfer Cartons for Material Request (check if already created).

**Request:**
```
GET /api/transfer-cartons?material_request=MR-123460&store=STORE-002
Authorization: Bearer {token}
```

**Response (Success - 200):**
```json
[
  {
    "tc_id": "TC-MR-123460-1768157787512",
    "material_request": "MR-123460",
    "store": "STORE-002",
    "status": "Created",
    "created_at": "2026-01-11T21:30:00.000Z",
    "updated_at": "2026-01-11T21:30:00.000Z"
  }
]
```

**Notes:**
- ✅ **Already exists** (confirmed in codebase)
- Used to check if TC already exists before creating new one

---

## Summary Table

| # | Endpoint | Method | Status | Priority | Notes |
|---|----------|--------|--------|----------|-------|
| 1 | `/api/transfer-cartons/create` | POST | ✅ Exists | **Required** | Create TC immediately |
| 2 | `/api/bin-master/{bin_code}` | GET | ⚠️ Unknown | **Required** | Validate bin location |
| 3 | `/api/material-request/{mr_title}/update-location` | POST | ⚠️ Unknown | Optional | Update bin location (can use events instead) |
| 4 | `/api/material-request/{mr_title}/update-carton` | POST | ⚠️ Unknown | Optional | Update carton ID (can use events instead) |
| 5 | `/api/stock/item/{item_code}/warehouse/{warehouse}` | GET | ✅ Exists | **Required** | Get item locations for icons |
| 6 | `/api/material-request/{mr_title}` | GET | ✅ Exists | **Required** | Get MR details and items |
| 7 | `/api/events/batch` | POST | ✅ Exists | **Required** | Sync packing events |
| 8 | `/api/transfer-cartons?material_request={mr_title}&store={store}` | GET | ✅ Exists | **Required** | Check existing TCs |

---

## Required vs. Optional APIs

### ✅ **Required APIs (Must Exist):**
1. `POST /api/transfer-cartons/create` - Create TC immediately
2. `GET /api/bin-master/{bin_code}` - Validate bin location
3. `GET /api/stock/item/{item_code}/warehouse/{warehouse}` - Get item locations
4. `GET /api/material-request/{mr_title}` - Get MR details
5. `POST /api/events/batch` - Sync packing events
6. `GET /api/transfer-cartons?material_request={mr_title}&store={store}` - Check existing TCs

### ⚠️ **Optional APIs (Can Use Alternatives):**
1. `POST /api/material-request/{mr_title}/update-location` - **Alternative:** Include `bin_location` in packing events
2. `POST /api/material-request/{mr_title}/update-carton` - **Alternative:** Include `carton_id` in packing events (already implemented)

---

## Questions for Backend Team

1. **Bin Location Validation:**
   - Does `GET /api/bin-master/{bin_code}` exist?
   - If not, what endpoint should we use to validate bin locations?
   - Should we use local `bin_master_cache` table instead?

2. **Bin/Carton Updates:**
   - Do endpoints `POST /api/material-request/{mr_title}/update-location` and `POST /api/material-request/{mr_title}/update-carton` exist?
   - If not, can we include `bin_location` and `carton_id` in packing events instead?
   - Will backend extract location/carton from events?

3. **Transfer Carton Creation:**
   - Does `POST /api/transfer-cartons/create` accept `material_request` field?
   - Should `tc_id` be generated by mobile app or backend?
   - What is the response format?

4. **Event Processing:**
   - Does backend process `PACK_ITEM_TO_TC` events with `carton_id` and `bin_location` fields?
   - Will backend update stock based on these events?
   - How does backend query events by `tc_id`?

---

## Implementation Notes

### If Optional APIs Don't Exist:
- **Bin Location:** Store in local state, include in packing events
- **Carton ID:** Store in local state, include in packing events (already implemented)
- **Backend Processing:** Backend extracts location/carton from events

### Offline Support:
- All APIs should work offline (queue locally, sync when online)
- Transfer Carton creation: Create locally with status "Pending", sync when online
- Events: Queue in `event_queue` table, sync via `/api/events/batch` when online

---

**Please confirm with backend team which APIs exist and which need to be created!**
