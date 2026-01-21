# ASN Putaway Complete Process - Mobile App

## Date: 2026-01-20
## Status: ✅ **COMPLETE DOCUMENTATION**

---

## 📋 Overview

This document provides a complete guide to the ASN Putaway process in the mobile app, including:
- Full process flow
- API endpoints and URLs
- Sample JSON requests and responses
- Stock update mechanism

---

## 🔄 Complete ASN Putaway Process Flow

### Step 1: Load Putaway Tasks

**Screen:** Putaway List Screen  
**Action:** User opens Putaway screen or refreshes list

**API Call:**
```
GET /api/putaway/tasks?status=Draft,In Progress&source_type=ASN&asn_no={asn_no}
```

**Sample Request:**
```http
GET http://192.168.103.219:3000/api/putaway/tasks?status=Draft,In%20Progress&source_type=ASN&asn_no=ASN-12345
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
      "source_type": "ASN",
      "asn_no": "ASN-12345",
      "box_id": "BOX-20260120-0001",
      "tc_id": "TC-20260120-0001",
      "warehouse": "WH-MAIN",
      "location_id": null,
      "items": [
        {
          "item_code": "SKU-HAT-301-BLU-OS",
          "qty": 10,
          "carton_id": "CTN-001"
        }
      ]
    }
  ]
}
```

**Mobile App Code:**
```typescript
// src/screens/PutAwayScreen.tsx
const putawayTasksResponse = await apiService.getPutawayTasks({
  status: "Draft,In Progress",
  source_type: "ASN",
  asn_no: activeASN || undefined,
});
```

---

### Step 2: Select Putaway Task

**Screen:** Putaway List Screen  
**Action:** User taps on a putaway task from the list

**Mobile App Action:**
- Store selected task details
- Navigate to Putaway Detail Screen
- Load task items and box information

**No API Call** (uses data from Step 1)

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
  "box_id": "BOX-20260120-0001",
  "location_id": "A1-R02-L1-B2",
  "user_id": "USER-402498",
  "warehouse_id": "WH-MAIN"
}
```

**Sample Response:**
```json
{
  "ok": true,
  "message": "Location ID 'A1-R02-L1-B2' assigned to all items in putaway task PUT-20260120-0001",
  "data": {
    "putaway_task": "PUT-20260120-0001",
    "box_id": "BOX-20260120-0001",
    "location_id": "A1-R02-L1-B2",
    "rack": "A1-R02-L1",
    "bin": "B2",
    "items_count": 2,
    "items": [
      {
        "item_code": "SKU-HAT-301-BLU-OS",
        "carton_id": "CTN-001",
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
  box_id: boxId,
  location_id: locationIdUpper,
  user_id: settings.user_id,
  warehouse_id: warehouseId,
});
```

**What This Does:**
- Validates box_id exists in `tabSortBox`
- Validates location_id exists in `tabLocation`
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
  "box_id": "BOX-20260120-0001",
  "location_id": "A1-R02-L1-B2",
  "warehouse": "WH-MAIN",
  "warehouse_id": "WH-MAIN",
  "completed_by": "USER-402498",
  "performed_by": "USER-402498",
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 10,
      "carton_id": "CTN-001",
      "location_id": "A1-R02-L1-B2",
      "source_bin": "DOCK-01",
      "target_bin": "B2",
      "completed": true
    }
  ]
}
```

**Sample Response:**
```json
{
  "ok": true,
  "message": "Putaway task PUT-20260120-0001 completed successfully",
  "data": {
    "putaway_task": "PUT-20260120-0001",
    "box_id": "BOX-20260120-0001",
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
const response = await apiService.completePutaway({
  putaway_task: putawayTaskId,
  box_id: boxId,
  location_id: selectedLocationId,
  warehouse: warehouse, // From location or settings
  warehouse_id: warehouseId,
  completed_by: settings.user_id,
  performed_by: settings.user_id,
  items: items, // Array of items with qty, carton_id, etc.
});
```

---

## 📊 Stock Update Mechanism

### How Stock is Updated in ASN Putaway

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
- `warehouse`: Warehouse code (normalized)
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
   WHERE carton_id = '{carton_id}'
     AND location_id = 'DOCK-01'
     AND warehouse = 'WH-MAIN'
   ```

2. **Increase carton stock at TO location**
   ```sql
   INSERT INTO tabCartonStock (carton_id, location_id, warehouse, qty, ...)
   VALUES ('{carton_id}', 'A1-R02-L1-B2', 'WH-MAIN', {item_qty}, ...)
   ON DUPLICATE KEY UPDATE qty = qty + {item_qty}
   ```

**Result:**
- Carton-level inventory is tracked at both locations
- Enables carton-level inventory management

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
  AND carton_id = '{carton_id}'
  AND warehouse = 'WH-MAIN'
```

**Result:**
- Item location is updated to target location
- Enables location-based item lookup

---

## 🔑 Key API Endpoints

### 1. Get Putaway Tasks

**Endpoint:** `GET /api/putaway/tasks`

**Query Parameters:**
- `status`: Task status filter (e.g., "Draft,In Progress")
- `source_type`: Source type filter (e.g., "ASN", "TransferIn")
- `asn_no`: ASN number filter
- `warehouse`: Warehouse filter

**Example:**
```
GET /api/putaway/tasks?status=Draft,In%20Progress&source_type=ASN&asn_no=ASN-12345
```

---

### 2. Scan Transfer Carton (Assign Location)

**Endpoint:** `POST /api/putaway/scan-transfer-carton`

**Purpose:** Validate and assign location to putaway task

**Request Body:**
```json
{
  "putaway_task": "PUT-20260120-0001",
  "box_id": "BOX-20260120-0001",
  "location_id": "A1-R02-L1-B2",
  "user_id": "USER-402498",
  "warehouse_id": "WH-MAIN"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Location assigned successfully",
  "data": {
    "putaway_task": "PUT-20260120-0001",
    "location_id": "A1-R02-L1-B2",
    "items_count": 2
  }
}
```

**What It Does:**
- ✅ Validates box_id exists
- ✅ Validates location_id exists
- ✅ Updates putaway task with location
- ✅ Updates all task items with location
- ❌ **Does NOT update stock** (stock update happens in complete endpoint)

---

### 3. Complete Putaway (Stock Update)

**Endpoint:** `POST /api/putaway/complete`

**Purpose:** Complete putaway and update stock

**Request Body:**
```json
{
  "putaway_task": "PUT-20260120-0001",
  "box_id": "BOX-20260120-0001",
  "location_id": "A1-R02-L1-B2",
  "warehouse": "WH-MAIN",
  "warehouse_id": "WH-MAIN",
  "completed_by": "USER-402498",
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 10,
      "carton_id": "CTN-001",
      "location_id": "A1-R02-L1-B2",
      "source_bin": "DOCK-01",
      "target_bin": "B2"
    }
  ]
}
```

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

## 📝 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: Load Putaway Tasks                                  │
│ GET /api/putaway/tasks?source_type=ASN&asn_no=ASN-12345    │
│ → Returns list of putaway tasks                             │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 2: Select Putaway Task                                 │
│ User taps on task from list                                 │
│ → Navigate to Putaway Detail Screen                         │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 3: Scan Location ID                                    │
│ User scans/enters location (e.g., "A1-R02-L1-B2")          │
│ → Store in text input (editable)                            │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 4: Submit Location                                     │
│ User clicks "Submit Location" button                        │
│ → Show confirmation dialog                                  │
│ → POST /api/putaway/scan-transfer-carton                    │
│ → Assigns location to putaway task                          │
│ → Does NOT update stock yet                                 │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Step 5: Complete Putaway                                    │
│ User clicks "Complete Putaway" button                       │
│ → POST /api/putaway/complete                                │
│ → Updates stock ledger (MOVE pattern)                       │
│ → Creates stock transaction history                         │
│ → Updates carton stock (if enabled)                         │
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

### Stock Transaction History

**Fields Recorded:**
- `item_code`: Item code
- `transaction_type`: "Putaway"
- `reference_doc`: Putaway task title
- `warehouse`: Warehouse code
- `location_id`: Target location
- `qty_before`: Stock before putaway
- `qty_after`: Stock after putaway
- `qty_change`: Change in quantity
- `created_by`: User who completed putaway
- `transaction_date`: Timestamp

### Warehouse Field

**Source Priority:**
1. `location.warehouse_id` (from location master data)
2. `location.warehouse` (from location master data)
3. `settings.warehouse_id` (from app settings)
4. `settings.warehouse` (from app settings)

**Usage:**
- Required for stock updates
- Normalized to warehouse CODE
- Used in stock ledger, transaction history, and carton stock

---

## ✅ Summary

**ASN Putaway Process:**
1. ✅ Load putaway tasks from backend
2. ✅ Select task from list
3. ✅ Scan/enter location ID
4. ✅ Submit location (assigns location, no stock update)
5. ✅ Complete putaway (updates stock)

**Stock Update:**
- ✅ Uses MOVE pattern (decrease FROM, increase TO)
- ✅ Updates stock ledger
- ✅ Creates transaction history
- ✅ Updates carton stock (if enabled)
- ✅ Updates item bin location

**Key APIs:**
- `GET /api/putaway/tasks` - Load tasks
- `POST /api/putaway/scan-transfer-carton` - Assign location
- `POST /api/putaway/complete` - Complete and update stock

---

**Last Updated:** 2026-01-20
