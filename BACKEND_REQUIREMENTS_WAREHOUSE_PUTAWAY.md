# Backend Requirements: Warehouse Box Direct Putaway

## Overview

When **ANY box** (Transfer Order boxes, Putaway boxes, or regular boxes) is closed in Box Management and the destination store has `warehouse_type = 'Warehouse'` in `tabwarehouse` table, the box should skip the Packing screen and go directly to Putaway. The backend needs to support this workflow.

## Critical Requirements Summary

### 1. Box Type Agnostic

- ✅ Applies to **ALL box types**: TO boxes, Putaway boxes, regular boxes
- ✅ Not limited to specific box ID formats
- ✅ Works for any box as long as destination store has `warehouse_type = 'Warehouse'`

### 2. Warehouse Detection (MANDATORY)

- ✅ **MUST use ONLY `tabwarehouse`.`warehouse_type = 'Warehouse'`**
- ❌ **DO NOT use hardcoded values** like "WH-", "WAREHOUSE", or code pattern matching
- ❌ **DO NOT use fallback logic** based on store code format
- ✅ If store not found in `tabwarehouse`, treat as non-warehouse
- ✅ If `warehouse_type != 'Warehouse'`, treat as non-warehouse

### 3. Workflow

1. User closes box → Backend checks `warehouse_type = 'Warehouse'` → If yes, create putaway task
2. User scans location → Backend validates warehouse → Update/create putaway task with location
3. User completes putaway → Backend updates location and stock

---

## 1. API: `/api/boxes/close` - Enhanced for Warehouse Boxes

### Current Behavior

- Closes a box and updates status to "Closed"

### Required Enhancement

**When ANY box (TO box, Putaway box, or regular box) is closed and the destination store has `warehouse_type = 'Warehouse'`, automatically create a Putaway Task**

### Request Format

```json
POST /api/boxes/close
{
  "box_id": "BOX-WHMAIN-12345"
}
```

### Backend Logic Required

1. **Check if box exists and get box details:**

   ```sql
   SELECT box_id, advance_shipping_notice as asn_no, store, status, purpose
   FROM tabSortBox (or your box table)
   WHERE box_id = ?
   ```

   **⚠️ CRITICAL:** The database column is `advance_shipping_notice`, NOT `asn_no`. Always use `advance_shipping_notice` in SQL queries (UPDATE, INSERT, WHERE clauses). The alias `as asn_no` is only for SELECT queries to return a friendly field name.

2. **Check if store is a Warehouse (MANDATORY - use ONLY warehouse_type):**

   ```sql
   SELECT warehouse_type
   FROM tabwarehouse
   WHERE code = ? -- box.store
   ```

   - **CRITICAL:** Use ONLY `warehouse_type = 'Warehouse'` to determine if store is warehouse
   - **DO NOT** use hardcoded values like "WH-", "WAREHOUSE", or any code pattern matching
   - If `warehouse_type = 'Warehouse'`, proceed with putaway task creation
   - If `warehouse_type != 'Warehouse'` or store not found, just close the box (existing behavior)

3. **If Warehouse Box (warehouse_type = 'Warehouse'):**

   - Close the box (update status to "Closed")
   - **Create Putaway Task automatically**
   - Get all items in the box from `tabScannedItems` (or your scanned items table)
   - Create putaway task with:
     - `putaway_task`: Auto-generated (e.g., `PUT-YYYYMMDD-XXXX`)
     - `box_id`: The closed box ID (works for TO boxes, Putaway boxes, or regular boxes)
     - `asn_no`: From box
     - `status`: "Open"
     - `source_type`: "Box" (to distinguish from Transfer Carton)
     - Items: All items from the box with their quantities
   - **Note:** This applies to ALL box types (TO boxes, Putaway boxes, regular boxes) as long as destination store has `warehouse_type = 'Warehouse'`

4. **Response Format:**
   ```json
   {
     "success": true,
     "box_id": "BOX-WHMAIN-12345",
     "status": "Closed",
     "putaway_task": "PUT-20251230-0001", // Only if warehouse box
     "message": "Box closed successfully. Putaway task created."
   }
   ```

### Database Tables Required

- `tabSortBox` (or your box table) - to get box details
- `tabwarehouse` - to check `warehouse_type`
- `tabScannedItems` (or your scanned items table) - to get items in box
- `tabPutawayTask` (or your putaway task table) - to create putaway task
- `tabPutawayTaskLines` (or your putaway task lines table) - to create putaway task lines

---

## 2. API: `/api/putaway/scan-transfer-carton` - Support Regular Warehouse Boxes

### Current Behavior

- Accepts `tc_id` (Transfer Carton ID) or `box_id` (for PAW-\* Putaway boxes)
- Creates/updates putaway task with location

### Required Enhancement

**Accept ANY warehouse box ID (TO boxes, Putaway boxes, or regular boxes) when box is closed and destination store has `warehouse_type = 'Warehouse'`**

### Request Format

```json
POST /api/putaway/scan-transfer-carton
{
  "box_id": "BOX-WHMAIN-12345",  // Any warehouse box (TO box, Putaway box, or regular box)
  "rack": "A1-R01-L1-B1",        // Location ID scanned from mobile
  "bin": "B1",                   // Optional: bin from location
  "user_id": "USER-786249"       // Optional: user performing putaway
}
```

**Note:** `box_id` can be:

- TO box (e.g., `BOX-STORE-001-12345`)
- Putaway box (e.g., `PAW-ASN12225-1767`)
- Regular warehouse box (e.g., `BOX-WHMAIN-12345`)
- Any box format as long as destination store has `warehouse_type = 'Warehouse'`

**OR** (if putaway task already exists):

```json
{
  "putaway_task": "PUT-20251230-0001",
  "rack": "A1-R01-L1-B1",
  "bin": "B1",
  "user_id": "USER-786249"
}
```

### Backend Logic Required

1. **If `putaway_task` is provided:**

   - Update existing putaway task with location
   - Update `rack` and `bin` fields
   - Keep existing items

2. **If `box_id` is provided (and no `putaway_task`):**

   - Check if box exists and is closed:

     ```sql
     SELECT box_id, advance_shipping_notice as asn_no, store, status, to_no, purpose
     FROM tabSortBox
     WHERE box_id = ? AND status = 'Closed'
     ```

     **⚠️ CRITICAL:** Use `advance_shipping_notice` (not `asn_no`) in SQL queries.

   - **Validate box destination is warehouse (MANDATORY):**
     ```sql
     SELECT warehouse_type
     FROM tabwarehouse
     WHERE code = ? -- box.store
     ```
     - **CRITICAL:** Use ONLY `warehouse_type = 'Warehouse'` to validate
     - **DO NOT** use hardcoded values or code pattern matching
     - If `warehouse_type != 'Warehouse'`, return error: "Box destination is not a warehouse"
   - Check if putaway task already exists for this box:
     ```sql
     SELECT putaway_task, status
     FROM tabPutawayTask
     WHERE box_id = ? AND status = 'Open'
     ```
   - **If putaway task exists:**
     - Update it with location (`rack`, `bin`)
   - **If putaway task does NOT exist:**

     - Create new putaway task with:

       - `putaway_task`: Auto-generated
       - `box_id`: From request (works for any box type)
       - `advance_shipping_notice` (or `asn_no` if that's your column name): From box's `advance_shipping_notice` column
       - `rack`: From request
       - `bin`: From request (if provided)
       - `status`: "Open"

       **⚠️ CRITICAL:** Use the actual database column name in SQL queries.

       - `source_type`: "Box"

     - Get items from box and create putaway task lines

3. **Validate location:**

   - Check if location exists in `tablocation`:
     ```sql
     SELECT location_id, is_available
     FROM tablocation
     WHERE location_id = ? -- rack value
     ```
   - If location doesn't exist, return error
   - If `is_available = 0`, return error (location not available)

4. **Response Format:**
   ```json
   {
     "success": true,
     "message": "Putaway task created and items assigned successfully",
     "data": {
       "putaway_task": "PUT-20251230-0001",
       "box_id": "BOX-WHMAIN-12345",
       "asn_no": "ASN-12225",
       "rack": "A1-R01-L1-B1",
       "bin": "B1",
       "items_count": 2,
       "items": [
         {
           "item_code": "SKU-HAT-301-BLU-OS",
           "carton_id": "CTN-001",
           "qty": 75.0,
           "rack": "A1-R01-L1-B1",
           "bin": "B1"
         }
       ],
       "is_new_task": true
     }
   }
   ```

### Database Tables Required

- `tabSortBox` - to get box details
- `tabPutawayTask` - to create/update putaway task
- `tabPutawayTaskLines` - to create putaway task lines
- `tabScannedItems` - to get items from box
- `tablocation` - to validate location

---

## 3. API: `/api/putaway/complete` - Update Location and Stock

### Current Behavior

- Completes putaway task
- Updates status to "Completed"

### Required Enhancement

**Update location in backend and update stock at the location**

### Request Format

```json
POST /api/putaway/complete
{
  "putaway_task": "PUT-20251230-0001",
  "performed_by": "USER-786249",
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 150.00,
      "source_bin": "DOCK-01",
      "target_bin": "B1",
      "completed": true,
      "box_id": "BOX-WHMAIN-12345"  // Optional: for warehouse boxes
    }
  ]
}
```

### Backend Logic Required

1. **Get putaway task details:**

   ```sql
   SELECT putaway_task, box_id, asn_no, rack, bin, status
   FROM tabPutawayTask
   WHERE putaway_task = ?
   ```

2. **Validate task is "Open":**

   - If status is not "Open", return error

3. **For each item in request:**

   - **Update location stock:**

     ```sql
     -- Get current stock at location
     SELECT item_code, qty
     FROM tabStockLocation (or your stock location table)
     WHERE location_id = ? AND item_code = ?

     -- Insert or update stock
     INSERT INTO tabStockLocation (location_id, item_code, qty, updated_on)
     VALUES (?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       qty = qty + ?,
       updated_on = NOW()
     ```

   - **Update putaway task line:**
     ```sql
     UPDATE tabPutawayTaskLines
     SET completed = 1,
         completed_qty = ?,
         completed_on = NOW(),
         performed_by = ?
     WHERE putaway_task = ? AND item_code = ?
     ```

4. **Update putaway task status:**

   ```sql
   UPDATE tabPutawayTask
   SET status = 'Completed',
       completed_on = NOW(),
       performed_by = ?
   WHERE putaway_task = ?
   ```

5. **Update box location (if box_id exists):**

   ```sql
   UPDATE tabSortBox
   SET rack = ?,
       bin = ?,
       updated_on = NOW()
   WHERE box_id = ?
   ```

6. **Update location availability (if needed):**

   ```sql
   UPDATE tablocation
   SET is_available = 1,  -- Or your logic to determine availability
       updated_on = NOW()
   WHERE location_id = ?
   ```

7. **Response Format:**
   ```json
   {
     "ok": true,
     "putaway_task": "PUT-20251230-0001",
     "status": "Completed",
     "stock_updated": true,
     "message": "Putaway completed successfully. Stock updated at location."
   }
   ```

### Database Tables Required

- `tabPutawayTask` - to update task status
- `tabPutawayTaskLines` - to update task lines
- `tabStockLocation` (or your stock location table) - to update stock
- `tabSortBox` - to update box location (if box_id exists)
- `tablocation` - to update location availability

---

## 4. Data Validation Requirements

### Warehouse Detection (MANDATORY)

- **MUST use ONLY `tabwarehouse`.`warehouse_type = 'Warehouse'` to determine if store is warehouse**
- **DO NOT use hardcoded values like "WAREHOUSE", "WH-", or any code pattern matching**
- **DO NOT use fallback logic based on store code format**
- If store is not found in `tabwarehouse` table, treat as non-warehouse
- If `warehouse_type != 'Warehouse'`, treat as non-warehouse

### Box Status Validation

- Box must be "Closed" before it can be put away
- Putaway task can only be created for closed boxes where destination store has `warehouse_type = 'Warehouse'`
- Applies to ALL box types: TO boxes, Putaway boxes, regular boxes

### Location Validation

- Location must exist in `tablocation` table
- Location must have `is_available = 1` (or your equivalent)
- Location must be a valid warehouse location

### Item Validation

- Items must exist in the box (from `tabScannedItems` or your scanned items table)
- Quantities must match scanned quantities
- Items must belong to the same ASN as the box

---

## 5. Error Handling

### Error Responses

**Box Not Found:**

```json
{
  "success": false,
  "error": {
    "code": "BOX_NOT_FOUND",
    "message": "Box BOX-WHMAIN-12345 not found"
  }
}
```

**Box Not Closed:**

```json
{
  "success": false,
  "error": {
    "code": "BOX_NOT_CLOSED",
    "message": "Box must be closed before putaway"
  }
}
```

**Not a Warehouse Box:**

```json
{
  "success": false,
  "error": {
    "code": "NOT_WAREHOUSE_BOX",
    "message": "Box destination store does not have warehouse_type = 'Warehouse'. Use Packing screen instead."
  }
}
```

**Store Not Found in Warehouse Master:**

```json
{
  "success": false,
  "error": {
    "code": "STORE_NOT_FOUND",
    "message": "Store code not found in tabwarehouse table"
  }
}
```

**Location Not Found:**

```json
{
  "success": false,
  "error": {
    "code": "LOCATION_NOT_FOUND",
    "message": "Location A1-R01-L1-B1 not found"
  }
}
```

**Location Not Available:**

```json
{
  "success": false,
  "error": {
    "code": "LOCATION_NOT_AVAILABLE",
    "message": "Location A1-R01-L1-B1 is not available"
  }
}
```

**Putaway Task Already Completed:**

```json
{
  "success": false,
  "error": {
    "code": "TASK_ALREADY_COMPLETED",
    "message": "Putaway task PUT-20251230-0001 is already completed"
  }
}
```

---

## 6. Database Schema Requirements

### Putaway Task Table (if not exists)

```sql
CREATE TABLE tabPutawayTask (
  putaway_task VARCHAR(50) PRIMARY KEY,
  box_id VARCHAR(50),              -- For warehouse boxes
  tc_id VARCHAR(50),               -- For transfer cartons
  asn_no VARCHAR(50),
  rack VARCHAR(100),               -- Location ID
  bin VARCHAR(50),                 -- Bin ID (optional)
  status VARCHAR(20),              -- Open, Completed
  source_type VARCHAR(20),         -- Box, TransferCarton
  created_on DATETIME,
  completed_on DATETIME,
  performed_by VARCHAR(50),
  INDEX idx_box_id (box_id),
  INDEX idx_tc_id (tc_id),
  INDEX idx_asn_no (advance_shipping_notice),  -- Use actual column name
  INDEX idx_status (status)
);
```

### Putaway Task Lines Table (if not exists)

```sql
CREATE TABLE tabPutawayTaskLines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  putaway_task VARCHAR(50),
  item_code VARCHAR(50),
  carton_id VARCHAR(50),
  qty DECIMAL(10,2),
  completed_qty DECIMAL(10,2) DEFAULT 0,
  rack VARCHAR(100),
  bin VARCHAR(50),
  completed TINYINT(1) DEFAULT 0,
  completed_on DATETIME,
  performed_by VARCHAR(50),
  FOREIGN KEY (putaway_task) REFERENCES tabPutawayTask(putaway_task),
  INDEX idx_putaway_task (putaway_task),
  INDEX idx_item_code (item_code)
);
```

### Stock Location Table (if not exists)

```sql
CREATE TABLE tabStockLocation (
  location_id VARCHAR(100),
  item_code VARCHAR(50),
  qty DECIMAL(10,2),
  updated_on DATETIME,
  PRIMARY KEY (location_id, item_code),
  INDEX idx_location_id (location_id),
  INDEX idx_item_code (item_code)
);
```

---

## 7. Summary of Changes

### API Endpoints to Modify:

1. ✅ `/api/boxes/close` - Create putaway task when warehouse box is closed
2. ✅ `/api/putaway/scan-transfer-carton` - Accept regular warehouse box IDs
3. ✅ `/api/putaway/complete` - Update location and stock

### New Database Tables (if not exists):

1. `tabPutawayTask` - Store putaway tasks
2. `tabPutawayTaskLines` - Store putaway task line items
3. `tabStockLocation` - Store stock at locations

### Key Business Logic:

1. **Warehouse Detection (MANDATORY):** Use **ONLY** `tabwarehouse`.`warehouse_type = 'Warehouse'` - **NO hardcoded values**
2. **Box Type Agnostic:** Applies to ALL box types (TO boxes, Putaway boxes, regular boxes) as long as destination store has `warehouse_type = 'Warehouse'`
3. **Auto Task Creation:** Create putaway task when any warehouse box is closed
4. **Location Update:** Update location and stock when putaway is completed
5. **Stock Management:** Increment stock at target location when putaway completes

---

## 8. Testing Scenarios

### Scenario 1: Close Warehouse Box (TO Box)

1. User closes TO box `BOX-STORE-001-12345` in Box Management
2. Backend checks if store has `warehouse_type = 'Warehouse'` in `tabwarehouse` table
3. If yes, backend creates putaway task `PUT-20251230-0001`
4. Response includes `putaway_task` ID

### Scenario 1b: Close Warehouse Box (Putaway Box)

1. User closes Putaway box `PAW-ASN12225-1767` in Box Management
2. Backend checks if store has `warehouse_type = 'Warehouse'` in `tabwarehouse` table
3. If yes, backend creates putaway task `PUT-20251230-0002`
4. Response includes `putaway_task` ID

### Scenario 1c: Close Warehouse Box (Regular Box)

1. User closes regular box `BOX-WHMAIN-12345` in Box Management
2. Backend checks if store has `warehouse_type = 'Warehouse'` in `tabwarehouse` table
3. If yes, backend creates putaway task `PUT-20251230-0003`
4. Response includes `putaway_task` ID

### Scenario 2: Scan Location for Warehouse Box (Any Type)

1. User scans location `A1-R01-L1-B1` in Putaway screen
2. Mobile sends `box_id: "BOX-STORE-001-12345"` (or any box type) and `rack: "A1-R01-L1-B1"`
3. Backend validates box destination has `warehouse_type = 'Warehouse'`
4. Backend finds existing putaway task or creates new one
5. Backend updates putaway task with location
6. Response includes putaway task details

### Scenario 3: Complete Putaway

1. User completes putaway task
2. Mobile sends `putaway_task` and `items` array
3. Backend updates stock at location for each item
4. Backend updates putaway task status to "Completed"
5. Backend updates box location (if box_id exists)
6. Response confirms stock updated

---

## 9. Notes for Backend Team

1. **Box Type Agnostic:** This feature applies to ALL box types:

   - TO boxes (e.g., `BOX-STORE-001-12345`)
   - Putaway boxes (e.g., `PAW-ASN12225-1767`)
   - Regular warehouse boxes (e.g., `BOX-WHMAIN-12345`)
   - Any other box format
   - **As long as destination store has `warehouse_type = 'Warehouse'`**

2. **Warehouse Detection (CRITICAL):**

   - **MUST use ONLY `tabwarehouse`.`warehouse_type = 'Warehouse'`**
   - **DO NOT use hardcoded values like "WH-", "WAREHOUSE", or code pattern matching**
   - **DO NOT use fallback logic based on store code format**
   - If store not found in `tabwarehouse`, treat as non-warehouse

3. **Location Format:** Location ID format is `A1-R01-L1-B1` where `B1` is the bin

4. **Stock Update:** Stock should be incremented (added) at the target location, not replaced

5. **Transaction Safety:** Use database transactions to ensure data consistency when updating stock and task status

6. **Validation Flow:**
   - Always check `tabwarehouse` table for `warehouse_type = 'Warehouse'`
   - Never assume warehouse based on box ID format or store code pattern
   - Return clear error if store not found or `warehouse_type != 'Warehouse'`

---

## 10. Mobile App Integration Points

The mobile app will:

1. Call `/api/boxes/close` when ANY box is closed (TO box, Putaway box, or regular box)
2. Backend will check if destination store has `warehouse_type = 'Warehouse'`
3. If yes, backend will create putaway task and return `putaway_task` in response
4. Mobile app will call `/api/putaway/scan-transfer-carton` with `box_id` when location is scanned
5. Mobile app will call `/api/putaway/complete` with `putaway_task` and `items` when putaway is completed

All API calls will include proper error handling and retry logic.

**Important:** Mobile app will also use `tabwarehouse`.`warehouse_type = 'Warehouse'` to determine warehouse stores (no hardcoded values).
