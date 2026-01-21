# Transfer In Putaway Complete Process - Mobile App

## Date: 2026-01-20
## Status: ✅ **COMPLETE DOCUMENTATION**

---

## 📋 Overview

This document provides a complete guide to the Transfer In Putaway process in the mobile app, including:
- Full process flow
- API endpoints and URLs
- Sample JSON requests and responses
- Stock update mechanism
- Key differences from ASN Putaway

---

## 🔄 Complete Transfer In Putaway Process Flow

### Step 1: Load Putaway Tasks

**Screen:** Putaway List Screen  
**Action:** User opens Putaway screen or refreshes list

**API Call:**
```
GET /api/putaway/tasks?status=Draft,In Progress&source_type=TransferIn
```

**Sample Request:**
```http
GET http://192.168.103.219:3000/api/putaway/tasks?status=Draft,In%20Progress&source_type=TransferIn
Authorization: Bearer {auth_token}
```

**Sample Response:**
```json
{
  "ok": true,
  "message": "Found 2 putaway task(s)",
  "data": [
    {
      "title": "PUT-20260120-0001",
      "status": "Draft",
      "source_type": "TransferIn",
      "transfer_in": "INSLIP-123457",
      "box_id": "CTN-TI-123457-20260120-230244-356",
      "carton_id": "CTN-TI-123457-20260120-230244-356",
      "warehouse": "WH-MAIN",
      "location_id": null,
      "items": [
        {
          "item_code": "SKU-HAT-301-BLU-OS",
          "qty": 10,
          "carton_id": "CTN-TI-123457-20260120-230244-356"
        }
      ]
    }
  ]
}
```

**Key Differences from ASN:**
- ✅ `source_type`: "TransferIn" (not "ASN")
- ✅ `transfer_in`: Transfer In number (e.g., "INSLIP-123457")
- ✅ `box_id`: Carton ID format (`CTN-TI-...`) instead of `BOX-...` or `PAW-...`
- ✅ `carton_id`: Same as `box_id` for Transfer In

**Mobile App Code:**
```typescript
// src/screens/PutAwayScreen.tsx
const transferInTasksResponse = await apiService.getPutawayTasks({
  status: "Draft,In Progress",
  source_type: "TransferIn",
});
```

---

### Step 2: Select Putaway Task

**Screen:** Putaway List Screen  
**Action:** User taps on a Transfer In putaway task from the list

**Mobile App Action:**
- Store selected task details
- Extract `carton_id` (which is the `box_id` for Transfer In)
- Navigate to Putaway Detail Screen
- Load task items and box information

**No API Call** (uses data from Step 1)

**Key Data Extracted:**
- `carton_id`: `CTN-TI-123457-20260120-230244-356` (used as `box_id`)
- `transfer_in`: `INSLIP-123457`
- `putaway_task`: `PUT-20260120-0001`

---

### Step 3: Scan Location ID

**Screen:** Putaway Detail Screen  
**Action:** User scans or enters location ID (e.g., "A1-R02-L1-B2")

**Mobile App Action:**
1. Store location in text input (editable)
2. User clicks "Submit Location" button
3. Show confirmation dialog
4. Validate location exists

**Location Validation:**
- Check local `location_cache` table
- If not found, sync from backend
- Verify location is available (`is_available = 1`)

**No API Call Yet** (validation happens in Step 4)

---

### Step 4: Submit Location (Validate and Assign)

**Screen:** Putaway Detail Screen  
**Action:** User confirms location assignment

**API Call:**
```
POST /api/putaway/scan-transfer-carton
```

**Sample Request:**
```json
{
  "putaway_task": "PUT-20260120-0001",
  "box_id": "CTN-TI-123457-20260120-230244-356",
  "carton_id": "CTN-TI-123457-20260120-230244-356",
  "location_id": "A1-R02-L1-B2",
  "user_id": "USER-402498",
  "warehouse_id": "WH-MAIN"
}
```

**Key Differences from ASN:**
- ✅ `box_id`: Carton ID format (`CTN-TI-...`) instead of `BOX-...` or `PAW-...`
- ✅ `carton_id`: Same as `box_id` (required for Transfer In)
- ✅ `tc_id`: `null` (not used for Transfer In)

**Sample Response:**
```json
{
  "ok": true,
  "message": "Location ID 'A1-R02-L1-B2' assigned to all items in putaway task PUT-20260120-0001",
  "data": {
    "putaway_task": "PUT-20260120-0001",
    "box_id": "CTN-TI-123457-20260120-230244-356",
    "carton_id": "CTN-TI-123457-20260120-230244-356",
    "location_id": "A1-R02-L1-B2",
    "rack": "A1-R02-L1",
    "bin": "B2",
    "items_count": 2,
    "items": [
      {
        "item_code": "SKU-HAT-301-BLU-OS",
        "carton_id": "CTN-TI-123457-20260120-230244-356",
        "qty": 10,
        "rack": "A1-R02-L1",
        "bin": "B2",
        "location_id": "A1-R02-L1-B2"
      }
    ]
  }
}
```

**Mobile App Code:**
```typescript
// src/screens/PutAwayScreen.tsx
const response = await apiService.scanTransferCarton({
  putaway_task: putawayTaskId,
  box_id: boxId, // CTN-TI-... format for Transfer In
  carton_id: cartonId, // Same as box_id for Transfer In
  location_id: locationIdUpper,
  user_id: settings.user_id,
  warehouse_id: warehouseId,
});
```

**What This Does:**
- Validates `box_id` (carton_id) exists in `tabSortBox`
- Validates `location_id` exists in `tabLocation`
- Updates putaway task with location
- Updates all task items with location
- **Does NOT update stock yet** (stock update happens in Step 5)

---

### Step 5: Complete Putaway (Stock Update)

**Screen:** Putaway Detail Screen  
**Action:** User clicks "Complete Putaway" button

**API Call:**
```
POST /api/putaway/complete
```

**Sample Request:**
```json
{
  "putaway_task": "PUT-20260120-0001",
  "box_id": "CTN-TI-123457-20260120-230244-356",
  "carton_id": "CTN-TI-123457-20260120-230244-356",
  "location_id": "A1-R02-L1-B2",
  "warehouse": "WH-MAIN",
  "warehouse_id": "WH-MAIN",
  "completed_by": "USER-402498",
  "performed_by": "USER-402498",
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 10,
      "carton_id": "CTN-TI-123457-20260120-230244-356",
      "location_id": "A1-R02-L1-B2",
      "source_bin": "DOCK-01",
      "target_bin": "B2",
      "completed": true
    }
  ]
}
```

**Key Differences from ASN:**
- ✅ `box_id`: Carton ID format (`CTN-TI-...`) instead of `BOX-...` or `PAW-...`
- ✅ `carton_id`: Same as `box_id` (required for Transfer In)
- ✅ `warehouse`: From `tabTransferIn.to_warehouse` (not from location/settings)
- ✅ `tc_id`: `null` (not used for Transfer In)

**Sample Response:**
```json
{
  "ok": true,
  "message": "Putaway task PUT-20260120-0001 completed successfully",
  "data": {
    "putaway_task": "PUT-20260120-0001",
    "box_id": "CTN-TI-123457-20260120-230244-356",
    "location_id": "A1-R02-L1-B2",
    "warehouse": "WH-MAIN",
    "items_processed": 2,
    "stock_updated": true,
    "stock_ledger_entries": 2,
    "transaction_history_entries": 2
  }
}
```

**Mobile App Code:**
```typescript
// src/screens/PutAwayScreen.tsx
// ✅ CRITICAL: Get warehouse from Transfer In details
const transferInDetails = await apiService.getTransferIn(transferInNo);
const warehouseId = transferInDetails?.to_warehouse || transferInDetails?.data?.to_warehouse;

const response = await apiService.completePutaway({
  putaway_task: putawayTaskId,
  box_id: boxId, // CTN-TI-... format
  carton_id: cartonId, // Same as box_id
  location_id: selectedLocationId,
  warehouse: warehouseId, // From tabTransferIn.to_warehouse
  warehouse_id: warehouseId,
  completed_by: settings.user_id,
  performed_by: settings.user_id,
  items: items, // Array of items with qty, carton_id, etc.
});
```

---

## 📊 Stock Update Mechanism

### How Stock is Updated in Transfer In Putaway

When `POST /api/putaway/complete` is called, the backend performs the following stock updates:

#### 1. Stock Ledger Update (MOVE Pattern)

**Table:** `tabStockLedger`

**Process:**
1. **Decrease stock at FROM location** (staging area, e.g., "DOCK-01")
   ```sql
   UPDATE tabStockLedger 
   SET qty = qty - {item_qty}
   WHERE item_code = '{item_code}'
     AND location_id = 'DOCK-01'
     AND warehouse = 'WH-MAIN'
   ```

2. **Increase stock at TO location** (target location, e.g., "A1-R02-L1-B2")
   ```sql
   INSERT INTO tabStockLedger (item_code, location_id, warehouse, qty, ...)
   VALUES ('{item_code}', 'A1-R02-L1-B2', 'WH-MAIN', {item_qty}, ...)
   ON DUPLICATE KEY UPDATE qty = qty + {item_qty}
   ```

**Result:**
- Stock decreases at staging location
- Stock increases at target location
- Total stock remains the same (MOVE operation)

#### 2. Stock Transaction History

**Table:** `tabStockTransaction`

**Process:**
```sql
INSERT INTO tabStockTransaction (
  item_code,
  transaction_type,
  reference_doc,
  warehouse,
  location_id,
  qty_before,
  qty_after,
  qty_change,
  transaction_date,
  created_by,
  ...
) VALUES (
  '{item_code}',
  'Putaway',
  'PUT-20260120-0001',
  'WH-MAIN',
  'A1-R02-L1-B2',
  {qty_before},
  {qty_after},
  {qty_change},
  NOW(),
  'USER-402498',
  ...
)
```

**Fields:**
- `transaction_type`: "Putaway"
- `reference_doc`: Putaway task title (e.g., "PUT-20260120-0001")
- `warehouse`: Warehouse code from `tabTransferIn.to_warehouse` (normalized)
- `location_id`: Target location
- `qty_before`: Stock quantity before putaway
- `qty_after`: Stock quantity after putaway
- `qty_change`: Change in quantity (positive for increase)

#### 3. Carton Stock Update (If Enabled)

**Table:** `tabCartonStock`

**Process:**
1. **Decrease carton stock at FROM location**
   ```sql
   UPDATE tabCartonStock 
   SET qty = qty - {item_qty}
   WHERE carton_id = 'CTN-TI-123457-20260120-230244-356'
     AND location_id = 'DOCK-01'
     AND warehouse = 'WH-MAIN'
   ```

2. **Increase carton stock at TO location**
   ```sql
   INSERT INTO tabCartonStock (carton_id, location_id, warehouse, qty, ...)
   VALUES ('CTN-TI-123457-20260120-230244-356', 'A1-R02-L1-B2', 'WH-MAIN', {item_qty}, ...)
   ON DUPLICATE KEY UPDATE qty = qty + {item_qty}
   ```

**Result:**
- Carton-level inventory is tracked at both locations
- Enables carton-level inventory management
- Uses `CTN-TI-...` format carton IDs

#### 4. Item Bin Location Update

**Table:** `tabItemBinLocation` (if exists)

**Process:**
```sql
UPDATE tabItemBinLocation
SET location_id = 'A1-R02-L1-B2',
    rack = 'A1-R02-L1',
    bin = 'B2',
    updated_on = NOW()
WHERE item_code = '{item_code}'
  AND carton_id = 'CTN-TI-123457-20260120-230244-356'
  AND warehouse = 'WH-MAIN'
```

**Result:**
- Item location is updated to target location
- Enables location-based item lookup
- Uses `CTN-TI-...` format carton IDs

---

## 🔑 Key API Endpoints

### 1. Get Putaway Tasks (Transfer In)

**Endpoint:** `GET /api/putaway/tasks`

**Query Parameters:**
- `status`: Task status filter (e.g., "Draft,In Progress")
- `source_type`: "TransferIn" (required for Transfer In tasks)
- `transfer_in`: Transfer In number filter (optional)
- `warehouse`: Warehouse filter (optional)

**Example:**
```
GET /api/putaway/tasks?status=Draft,In%20Progress&source_type=TransferIn
```

**Response:**
```json
{
  "ok": true,
  "data": [
    {
      "title": "PUT-20260120-0001",
      "source_type": "TransferIn",
      "transfer_in": "INSLIP-123457",
      "box_id": "CTN-TI-123457-20260120-230244-356",
      "carton_id": "CTN-TI-123457-20260120-230244-356"
    }
  ]
}
```

---

### 2. Validate Transfer In Carton (Optional - During Receiving)

**Endpoint:** `POST /api/transfer-in/:title/validate-carton`

**Purpose:** Validate carton ID during Transfer In receiving (before putaway)

**Request:**
```http
POST /api/transfer-in/INSLIP-123457/validate-carton
```

**Request Body:**
```json
{
  "carton_id": "CTN-TI-123457-20260120-230244-356"
}
```

**Response:**
```json
{
  "ok": true,
  "validated": {
    "carton_id": "CTN-TI-123457-20260120-230244-356",
    "box_id": "CTN-TI-123457-20260120-230244-356",
    "putaway_task": "PUT-20260120-0001",
    "ready_for_putaway": true
  }
}
```

**Note:** This endpoint is used during receiving, not during putaway. It validates that the carton exists and is ready for putaway.

---

### 3. Scan Transfer Carton (Assign Location)

**Endpoint:** `POST /api/putaway/scan-transfer-carton`

**Purpose:** Validate and assign location to Transfer In putaway task

**Request Body:**
```json
{
  "putaway_task": "PUT-20260120-0001",
  "box_id": "CTN-TI-123457-20260120-230244-356",
  "carton_id": "CTN-TI-123457-20260120-230244-356",
  "location_id": "A1-R02-L1-B2",
  "user_id": "USER-402498",
  "warehouse_id": "WH-MAIN"
}
```

**Key Fields:**
- ✅ `box_id`: Carton ID format (`CTN-TI-...`) - **REQUIRED**
- ✅ `carton_id`: Same as `box_id` - **REQUIRED for Transfer In**
- ✅ `location_id`: Target location - **REQUIRED**
- ✅ `putaway_task`: Putaway task title - **REQUIRED**
- ❌ `tc_id`: Not used for Transfer In (set to `null`)

**Response:**
```json
{
  "ok": true,
  "message": "Location assigned successfully",
  "data": {
    "putaway_task": "PUT-20260120-0001",
    "box_id": "CTN-TI-123457-20260120-230244-356",
    "location_id": "A1-R02-L1-B2",
    "items_count": 2
  }
}
```

**What It Does:**
- ✅ Validates `box_id` (carton_id) exists in `tabSortBox`
- ✅ Validates `location_id` exists in `tabLocation`
- ✅ Updates putaway task with location
- ✅ Updates all task items with location
- ❌ **Does NOT update stock** (stock update happens in complete endpoint)

---

### 4. Complete Putaway (Stock Update)

**Endpoint:** `POST /api/putaway/complete`

**Purpose:** Complete Transfer In putaway and update stock

**Request Body:**
```json
{
  "putaway_task": "PUT-20260120-0001",
  "box_id": "CTN-TI-123457-20260120-230244-356",
  "carton_id": "CTN-TI-123457-20260120-230244-356",
  "location_id": "A1-R02-L1-B2",
  "warehouse": "WH-MAIN",
  "warehouse_id": "WH-MAIN",
  "completed_by": "USER-402498",
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 10,
      "carton_id": "CTN-TI-123457-20260120-230244-356",
      "location_id": "A1-R02-L1-B2",
      "source_bin": "DOCK-01",
      "target_bin": "B2"
    }
  ]
}
```

**Key Fields:**
- ✅ `box_id`: Carton ID format (`CTN-TI-...`) - **REQUIRED**
- ✅ `carton_id`: Same as `box_id` - **REQUIRED for Transfer In**
- ✅ `warehouse`: From `tabTransferIn.to_warehouse` - **REQUIRED**
- ✅ `location_id`: Target location - **REQUIRED**
- ✅ `items`: Array of items with `carton_id` - **REQUIRED**
- ❌ `tc_id`: Not used for Transfer In (set to `null`)

**Response:**
```json
{
  "ok": true,
  "message": "Putaway completed successfully",
  "data": {
    "putaway_task": "PUT-20260120-0001",
    "stock_updated": true,
    "stock_ledger_entries": 2,
    "transaction_history_entries": 2
  }
}
```

**What It Does:**
- ✅ Updates stock ledger (MOVE pattern)
- ✅ Creates stock transaction history
- ✅ Updates carton stock (if enabled)
- ✅ Updates item bin location
- ✅ Marks putaway task as completed

---

## 🔄 Differences from ASN Putaway

### 1. Box ID Format

**ASN Putaway:**
- `box_id`: `BOX-...` or `PAW-...` format
- Created during sorting/packing

**Transfer In Putaway:**
- `box_id`: `CTN-TI-...` format (carton ID)
- Created during receiving (when carton is generated)

### 2. Warehouse Source

**ASN Putaway:**
- `warehouse`: From location master data or app settings
- Priority: `location.warehouse_id` > `settings.warehouse_id`

**Transfer In Putaway:**
- `warehouse`: From `tabTransferIn.to_warehouse`
- Priority: `transferIn.to_warehouse` > `location.warehouse_id` > `settings.warehouse_id`

### 3. Carton ID

**ASN Putaway:**
- `carton_id`: Optional (may be null)
- `box_id` is separate from `carton_id`

**Transfer In Putaway:**
- `carton_id`: **REQUIRED** (same as `box_id`)
- `box_id` = `carton_id` = `CTN-TI-...` format

### 4. TC ID

**ASN Putaway:**
- `tc_id`: May be used (Transfer Carton ID from packing)

**Transfer In Putaway:**
- `tc_id`: **NOT USED** (set to `null`)
- Uses `box_id` (carton_id) instead

### 5. Source Type

**ASN Putaway:**
- `source_type`: "ASN"
- Filter: `source_type=ASN`

**Transfer In Putaway:**
- `source_type`: "TransferIn"
- Filter: `source_type=TransferIn`

---

## 📝 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: Load Putaway Tasks                                  │
│ GET /api/putaway/tasks?source_type=TransferIn               │
│ → Returns list of Transfer In putaway tasks                 │
│ → box_id format: CTN-TI-...                                 │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 2: Select Putaway Task                                 │
│ User taps on Transfer In task from list                     │
│ → Extract carton_id (which is box_id)                       │
│ → Navigate to Putaway Detail Screen                         │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 3: Scan Location ID                                     │
│ User scans/enters location (e.g., "A1-R02-L1-B2")          │
│ → Store in text input (editable)                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 4: Submit Location                                     │
│ User clicks "Submit Location" button                         │
│ → Show confirmation dialog                                  │
│ → POST /api/putaway/scan-transfer-carton                    │
│ → box_id: CTN-TI-... (carton_id format)                    │
│ → carton_id: CTN-TI-... (same as box_id)                   │
│ → Assigns location to putaway task                          │
│ → Does NOT update stock yet                                 │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 5: Complete Putaway                                    │
│ User clicks "Complete Putaway" button                       │
│ → POST /api/putaway/complete                                │
│ → warehouse: From tabTransferIn.to_warehouse               │
│ → box_id: CTN-TI-... (carton_id format)                    │
│ → carton_id: CTN-TI-... (same as box_id)                   │
│ → Updates stock ledger (MOVE pattern)                       │
│ → Creates stock transaction history                         │
│ → Updates carton stock (if enabled)                        │
│ → Marks task as completed                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔍 Stock Update Details

### MOVE Pattern Explanation

**FROM Location (Staging):**
- Location: `DOCK-01` (or staging area)
- Action: **Decrease** stock
- Stock Ledger: `qty = qty - {item_qty}`

**TO Location (Target):**
- Location: `A1-R02-L1-B2` (scanned location)
- Action: **Increase** stock
- Stock Ledger: `qty = qty + {item_qty}`

**Result:**
- Total stock remains the same
- Stock moves from staging to target location
- Both locations are updated in stock ledger

### Warehouse Field Source

**For Transfer In Putaway:**
1. **Primary Source:** `tabTransferIn.to_warehouse`
   ```typescript
   const transferInDetails = await apiService.getTransferIn(transferInNo);
   const warehouseId = transferInDetails?.to_warehouse;
   ```

2. **Fallback Sources:**
   - `location.warehouse_id` (from location master data)
   - `location.warehouse` (from location master data)
   - `settings.warehouse_id` (from app settings)
   - `settings.warehouse` (from app settings)

**Usage:**
- Required for stock updates
- Normalized to warehouse CODE
- Used in stock ledger, transaction history, and carton stock

### Carton ID Requirement

**For Transfer In Putaway:**
- ✅ `carton_id` is **REQUIRED** in all API calls
- ✅ `box_id` = `carton_id` = `CTN-TI-...` format
- ✅ All items must have `carton_id` in the items array
- ✅ Backend uses `carton_id` for carton-level inventory tracking

---

## ✅ Summary

**Transfer In Putaway Process:**
1. ✅ Load putaway tasks from backend (filter by `source_type=TransferIn`)
2. ✅ Select task from list (extract `carton_id` as `box_id`)
3. ✅ Scan/enter location ID
4. ✅ Submit location (assigns location, no stock update)
5. ✅ Complete putaway (updates stock using `to_warehouse`)

**Stock Update:**
- ✅ Uses MOVE pattern (decrease FROM, increase TO)
- ✅ Updates stock ledger
- ✅ Creates transaction history
- ✅ Updates carton stock (if enabled)
- ✅ Updates item bin location
- ✅ Uses `warehouse` from `tabTransferIn.to_warehouse`

**Key Differences from ASN:**
- ✅ `box_id` format: `CTN-TI-...` (not `BOX-...` or `PAW-...`)
- ✅ `carton_id` is required (same as `box_id`)
- ✅ `warehouse` from `tabTransferIn.to_warehouse`
- ✅ `tc_id` not used (set to `null`)

**Key APIs:**
- `GET /api/putaway/tasks?source_type=TransferIn` - Load tasks
- `POST /api/putaway/scan-transfer-carton` - Assign location
- `POST /api/putaway/complete` - Complete and update stock

---

**Last Updated:** 2026-01-20
