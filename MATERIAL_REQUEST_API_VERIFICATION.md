# Material Request API Integration Verification - Updated

## ✅ Fixed Issues

### 1. Added `transfer_order` Field to Events
- **Issue**: Events were missing `transfer_order` field required by backend
- **Fix**: Added `to_no: materialRequestTitle` to all `MATERIAL_REQUEST_PICK` events
- **Location**: `src/screens/MaterialRequestPackingScreen.tsx`
- **Status**: ✅ Fixed

### 2. Added `store` Field to Events
- **Issue**: Events were missing `store` field
- **Fix**: Added `store: selectedStore || materialRequest?.to_showroom || ""` to events
- **Location**: `src/screens/MaterialRequestPackingScreen.tsx`
- **Status**: ✅ Fixed

### 3. Added `pick-items` API Endpoint
- **Issue**: Direct API endpoint `/api/material-requests/:title/pick-items` was not implemented
- **Fix**: Added `pickMaterialRequestItems` method to `api.service.ts`
- **Location**: `src/services/api.service.ts`
- **Status**: ✅ Implemented (available but not currently used - events are used instead)

### 4. Updated Material Request Interface for Item-Level Status
- **Issue**: API now returns `status` and `pending_qty` fields for each item
- **Fix**: Updated `MaterialRequest` interface to include:
  - `status?: "Pending" | "In Progress" | "Picked"` for items
  - `pending_qty?: number` for items
  - Added "Picked" and "Dispatched" to Material Request header status
- **Location**: `src/types/index.ts`
- **Status**: ✅ Fixed

### 5. Updated Screens to Display Item Status
- **Issue**: Screens were not displaying item-level status from API
- **Fix**: 
  - Updated `MaterialRequestDetailScreen` to use item `status` field
  - Changed "Remaining" label to "Pending" to match API
  - Updated `calculatePickedQuantities` to calculate status if not provided
  - Updated `StatusBadge` to support "Pending", "In Progress", "Picked" statuses
- **Location**: `src/screens/MaterialRequestDetailScreen.tsx`, `src/components/StatusBadge.tsx`
- **Status**: ✅ Fixed

## 📋 Current API Implementation Status

### ✅ Correctly Implemented

1. **GET Material Requests (List)**
   - Endpoint: `GET /api/material-requests`
   - Method: `apiService.getMaterialRequests(filters)`
   - Query Params: `status`, `from_warehouse`, `to_showroom`
   - Status: ✅ Working
   - **Response Fields**: Now handles `status` and `pending_qty` for items

2. **GET Single Material Request**
   - Endpoint: `GET /api/material-requests/:title`
   - Method: `apiService.getMaterialRequest(title)`
   - Status: ✅ Working
   - **Response Fields**: Now handles `status` and `pending_qty` for items

3. **POST Create Material Request**
   - Endpoint: `POST /api/material-requests`
   - Method: `apiService.createMaterialRequest(data)`
   - Status: ✅ Working

4. **POST Pick Material Request Items**
   - Endpoint: `POST /api/material-requests/:title/pick-items`
   - Method: `apiService.pickMaterialRequestItems(title, items, warehouse)`
   - Status: ✅ Implemented (available but not used - events are used instead)
   - **Request Body**: 
     ```json
     {
       "items": [
         {
           "item_code": "SKU-HAT-301-RED-OS",
           "picked_qty": 20.00,
           "source_bin": "A1-R01-L1-B1"
         }
       ],
       "warehouse": "WH-MAIN"
     }
     ```

5. **POST Update Material Request Status**
   - Endpoint: `POST /api/material-requests/:title/update-status`
   - Method: `apiService.updateMaterialRequestStatus(title, status, additionalData)`
   - Status: ✅ Working
   - **Request Body**: 
     ```json
     {
       "status": "Submitted"
     }
     ```

6. **POST Create Transfer Carton**
   - Endpoint: `POST /api/transfer-cartons/create`
   - Method: `apiService.createTransferCarton(data)`
   - Status: ✅ Working
   - **Note**: Sends `asn_no: null` and `to_no: materialRequestTitle` for Material Requests

7. **POST Seal Transfer Carton**
   - Endpoint: `POST /api/transfer-cartons/seal`
   - Method: `apiService.sealTransferCarton(data)`
   - Status: ✅ Working
   - **Note**: Backend should update Material Request status to "Picked" if all items are picked

8. **POST Events Batch**
   - Endpoint: `POST /api/events/batch`
   - Method: `apiService.batchEvents(events)`
   - Status: ✅ Working
   - **Note**: Events are wrapped in `{ events }` object

## 🔍 Event Field Mapping

### MATERIAL_REQUEST_PICK Events

**Current Event Fields:**
```typescript
{
  event_type: "MATERIAL_REQUEST_PICK",
  material_request: "MR-0001",        // ✅ Material Request number
  to_no: "MR-0001",                   // ✅ transfer_order (Fixed)
  item_code: "SKU-HAT-301-BLU-OS",   // ✅ Item code
  qty: 1,                             // ✅ Quantity (incremental)
  rack: "A1-R01-L1-B1",              // ✅ Source location (rack)
  bin: "A1-R01-L1-B1",                // ✅ Source location (bin)
  store: "STORE-001",                 // ✅ Store (Fixed)
  device_id: "DEVICE-001",            // ✅ Device ID
  user_id: "USER-004",                // ✅ User ID
  event_time: "2025-01-25T10:35:00Z"  // ✅ Event timestamp
}
```

**Backend Expected Fields (per API docs):**
- `transfer_order`: ✅ Mapped from `to_no`
- `item_code`: ✅ Direct match
- `qty`: ✅ Direct match
- `source_bin`: ⚠️ Backend should map from `rack`/`bin` (priority: rack+bin → rack → bin)
- `location_id`: ⚠️ Not in event, but backend can derive from `rack`/`bin`

## 📊 Item Status Handling

### Status Calculation
The app now handles item-level status in two ways:

1. **From API Response**: If the API returns `status` field for items, it's used directly
2. **Calculated**: If `status` is not provided, it's calculated based on `picked_qty`:
   - `picked_qty === 0` → `"Pending"`
   - `picked_qty >= requested_qty` → `"Picked"`
   - `0 < picked_qty < requested_qty` → `"In Progress"`

### Status Display
- **MaterialRequestDetailScreen**: Shows item status badge using `StatusBadge` component
- **StatusBadge**: Supports "Pending" (Orange), "In Progress" (Orange), "Picked" (Green)
- **Label Change**: Changed "Remaining" to "Pending" to match API field name

## ✅ Verification Checklist

- [x] GET Material Requests list works
- [x] GET Single Material Request works
- [x] POST Create Transfer Carton works (with null asn_no for MR)
- [x] POST Seal Transfer Carton works
- [x] POST Events Batch works (events wrapped in { events })
- [x] MATERIAL_REQUEST_PICK events include `to_no` (transfer_order)
- [x] MATERIAL_REQUEST_PICK events include `store`
- [x] MATERIAL_REQUEST_PICK events include `rack` and `bin` (for source_bin mapping)
- [x] Material Request interface includes item `status` field
- [x] Material Request interface includes item `pending_qty` field
- [x] Material Request status includes "Picked" and "Dispatched"
- [x] Screens display item-level status
- [x] StatusBadge supports "Pending", "In Progress", "Picked"
- [ ] Backend correctly maps `rack`/`bin` to `source_bin`
- [ ] Backend correctly maps `to_no` to `transfer_order`
- [ ] Backend updates Material Request `picked_qty` from events
- [ ] Backend updates Material Request item `status` when `picked_qty` changes
- [ ] Backend updates Material Request status to "Picked" when sealed and all items picked
- [ ] Stock reduction happens when events are processed

## 📝 Notes

1. **Events vs Direct API**: The app uses events for picking (offline support), not the direct `pick-items` API. This is fine and provides better offline capabilities.

2. **Field Mapping**: The backend needs to map:
   - `to_no` → `transfer_order`
   - `rack`/`bin` → `source_bin` (via location lookup)

3. **Stock Reduction**: Backend should reduce stock from `source_bin` when processing `MATERIAL_REQUEST_PICK` events.

4. **Status Updates**: Backend should update Material Request status:
   - "Submitted" → "In Progress" when first item is picked
   - "In Progress" → "Picked" when all items are picked AND transfer carton is sealed

5. **Item Status**: Backend should update item-level `status` when `picked_qty` changes:
   - `picked_qty = 0` → `status = "Pending"`
   - `0 < picked_qty < requested_qty` → `status = "In Progress"`
   - `picked_qty >= requested_qty` → `status = "Picked"`

6. **Pending Qty**: Backend should calculate `pending_qty = requested_qty - picked_qty` for each item.
