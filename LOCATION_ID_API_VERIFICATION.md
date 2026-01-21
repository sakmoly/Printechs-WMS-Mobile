# Location ID API Verification

## Issue
User reported: **"is the location id sending to backend with API, the items Location wise not showing location ID"**

## Current Implementation Analysis

### ✅ Location ID IS Being Sent to Backend

#### 1. **Putaway Operations**

**`scanTransferCarton` API Call** (`src/services/api.service.ts:3004-3023`):
- ✅ **`location_id`** is included in the request interface
- ✅ The `rack` field is deprecated and removed before sending
- ✅ Request includes: `location_id`, `warehouse_id`, `tc_id`, `carton_id`, etc.

**`completePutaway` API Call** (`src/services/api.service.ts:3025-3041`):
- ✅ **`location_id`** is included at the header level
- ✅ **`location_id`** is also included in each item in the `items` array
- ✅ Request structure:
  ```typescript
  {
    putaway_task: string;
    location_id: string; // ✅ Header level
    items: [
      {
        item_code: string;
        qty: number;
        location_id: string; // ✅ Item level
        carton_id?: string;
        target_bin: string;
      }
    ]
  }
  ```

**`handleLocationScan` in PutAwayScreen** (`src/screens/PutAwayScreen.tsx:2266-2560`):
- ✅ Sets `selectedLocationId` from scanned location
- ✅ Extracts `warehouse_id` from location or settings
- ✅ Calls `apiService.scanTransferCarton` with:
  ```typescript
  {
    location_id: locationIdUpper, // ✅ Full location ID (e.g., "A1-R02-L1-B2")
    warehouse_id: warehouseId,     // ✅ Warehouse ID
    tc_id: selectedTC,             // ✅ Transfer Carton ID
    // ... other fields
  }
  ```

**`handleCompletePutAway` in PutAwayScreen** (`src/screens/PutAwayScreen.tsx:1580-1900`):
- ✅ Always includes `location_id` in request:
  ```typescript
  {
    putaway_task: putawayTask,
    location_id: locationId, // ✅ Always included
    items: items.map(item => ({
      item_code: item.item_code,
      qty: item.qty,
      location_id: locationId || item.location_id, // ✅ Per item
      carton_id: item.carton_id,
      target_bin: locationId,
    }))
  }
  ```

### 2. **Stock Ledger APIs**

**`getStockLedgerByLocation`** (`src/services/api.service.ts:3068-3102`):
- ✅ Uses `bin_location` parameter (which is the location_id)
- ✅ Endpoint: `GET /api/stock/ledger?bin_location={location_id}&...`

**`getItemLocations`** (`src/services/api.service.ts:2806-2856`):
- ✅ Fetches item locations from backend
- ✅ Endpoints: `/api/stock/item/:item_code/warehouse/:warehouse` or `/api/stock-ledger/:item_code/:warehouse`
- ⚠️ **Issue**: This API may not return `location_id` in the response

## ❌ Potential Issues

### 1. **Backend API Response May Not Include `location_id`**

The user's image shows an "Item Location Breakdown" pop-up that displays:
- Location ID: `A1-R02-L1-B2`
- Zone, Aisle, Rack, Level, Bin (individual components)

**Problem**: The backend API responses for stock/item queries may not be returning `location_id` in the response, even though:
- ✅ The mobile app is sending `location_id` to the backend
- ✅ The backend stores location data (as shown in the desktop UI)

### 2. **Stock Ledger Response Format**

The `getStockLedgerByLocation` API may return items without `location_id` field, even though the query filters by `bin_location`.

**Expected Response Format**:
```json
[
  {
    "item_code": "SKU-HAT-301-GRN-OS",
    "qty": 5.00,
    "location_id": "A1-R02-L1-B2", // ❌ May be missing
    "bin_location": "A1-R02-L1-B2",
    "carton_id": null,
    "warehouse": "WH-MAIN"
  }
]
```

## Required Backend Changes

### 1. **Stock Ledger API Response**

**Endpoint**: `GET /api/stock/ledger?bin_location={location_id}`

**Required Response Format**:
```json
{
  "ok": true,
  "data": [
    {
      "item_code": "SKU-HAT-301-GRN-OS",
      "qty": 5.00,
      "location_id": "A1-R02-L1-B2", // ✅ REQUIRED: Full composite location ID
      "bin_location": "A1-R02-L1-B2", // ✅ Also include for backward compatibility
      "zone": "Zone A",
      "aisle": "Aisle 01",
      "rack": "Rack 02",
      "level": "1",
      "bin": "B2",
      "carton_id": "CTN-001", // ✅ REQUIRED: Include carton_id (or null if not applicable)
      "warehouse": "WH-MAIN",
      "warehouse_id": "WH-MAIN"
    }
  ]
}
```

**Note**: `carton_id` should be included even if it's `null` (for loose items not in a carton). The desktop UI expects this field to be present in the response.

### 2. **Item Location API Response**

**Endpoint**: `GET /api/stock/item/:item_code/warehouse/:warehouse`

**Required Response Format**:
```json
{
  "ok": true,
  "data": [
    {
      "location_id": "A1-R02-L1-B2", // ✅ REQUIRED: Full composite location ID
      "bin_location": "A1-R02-L1-B2",
      "zone": "Zone A",
      "aisle": "Aisle 01",
      "rack": "Rack 02",
      "level": "1",
      "bin": "B2",
      "available_qty": 5.00,
      "carton_id": "CTN-001", // ✅ REQUIRED: Include carton_id (or null if not applicable)
      "warehouse": "WH-MAIN"
    }
  ]
}
```

**Note**: `carton_id` should be included even if it's `null` (for loose items not in a carton). The desktop UI expects this field to be present in the response.

### 3. **Putaway Task Response**

**Endpoint**: `GET /api/putaway/tasks`

**Required Response Format**:
```json
{
  "ok": true,
  "data": [
    {
      "putaway_task": "PAW-001",
      "tc_id": "TC-001",
      "box_id": "BOX-001",
      "location_id": "A1-R02-L1-B2", // ✅ REQUIRED: Full composite location ID
      "status": "In Progress",
      "lines": [
        {
          "item_code": "SKU-HAT-301-GRN-OS",
          "qty": 5,
          "location_id": "A1-R02-L1-B2", // ✅ REQUIRED: Per-item location
          "carton_id": "CTN-001"
        }
      ]
    }
  ]
}
```

## Mobile App Verification

### ✅ Confirmed: Mobile App IS Sending `location_id`

1. **Putaway Scan Location**:
   - ✅ `handleLocationScan` sends `location_id` to `scanTransferCarton`
   - ✅ `location_id` is extracted from scanned location code
   - ✅ `warehouse_id` is included to prevent backend errors

2. **Putaway Complete**:
   - ✅ `handleCompletePutAway` sends `location_id` at header level
   - ✅ `location_id` is included in each item in the `items` array
   - ✅ `location_id` is always included (not optional)

3. **Stock Queries**:
   - ✅ `getStockLedgerByLocation` filters by `bin_location` (which is `location_id`)
   - ⚠️ **Issue**: Response may not include `location_id` field

## Recommendations

### For Backend Team:

1. **✅ Verify Stock Ledger API Response**:
   - Ensure `GET /api/stock/ledger?bin_location={location_id}` returns `location_id` in response
   - Include both `location_id` (full composite) and individual components (zone, aisle, rack, level, bin)

2. **✅ Verify Item Location API Response**:
   - Ensure `GET /api/stock/item/:item_code/warehouse/:warehouse` returns `location_id` for each location
   - Match the format shown in the desktop "Item Location Breakdown" pop-up

3. **✅ Verify Putaway Task API Response**:
   - Ensure `GET /api/putaway/tasks` returns `location_id` at both header and line level
   - This is already being sent by mobile app, so backend should return it in responses

### For Mobile App:

1. **✅ Already Implemented**: Mobile app is correctly sending `location_id` to backend
2. **⚠️ Consider**: Add logging to verify backend responses include `location_id`
3. **✅ No Changes Required**: Mobile app implementation is correct

## Summary

- ✅ **Mobile app IS sending `location_id` to backend** in all putaway operations
- ❌ **Backend API responses may NOT be returning `location_id`** in stock/item queries
- ✅ **Solution**: Backend needs to ensure all stock/item/location APIs return `location_id` field in responses

The issue is likely on the **backend side** - the APIs need to return `location_id` in their responses so the mobile app can display location information correctly.
