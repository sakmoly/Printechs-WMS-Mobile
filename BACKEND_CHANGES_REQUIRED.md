# Backend Changes Required for Material Request Redesign

## Summary

**Yes, backend changes are REQUIRED** for the Material Request packing workflow redesign. The current backend APIs need to be enhanced to support the new workflow.

---

## Required Backend Changes

### 1. ✅ CRITICAL: Enhance `POST /api/material-requests/{title}/pick-items`

**Current Behavior (Assumed):**
- May set `picked_qty` to the provided value (not increment)
- May not support multiple calls for the same item

**Required Behavior:**
- **MUST support incremental updates** (add to existing `picked_qty`)
- **MUST handle multiple scans** of the same item
- **MUST set `scan_qty = picked_qty`** in Material Request items table

**Implementation Options:**

#### Option A: Add `increment` flag (Recommended)
```json
POST /api/material-requests/MR-123459/pick-items
{
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "picked_qty": 1,  // Quantity to add (not total)
      "increment": true,  // ✅ NEW: If true, add to existing picked_qty
      "source_bin": "A1-R02-L1-B2",
      "carton_id": "PAW-ASN365425473-1768138301111"
    }
  ],
  "warehouse": "WH-MAIN"
}
```

**Backend Logic:**
```sql
-- If increment = true:
UPDATE tabMaterialRequestItems 
SET picked_qty = picked_qty + ?,  -- Add to existing
    scan_qty = picked_qty + ?      -- Keep scan_qty = picked_qty
WHERE material_request = ? AND item_code = ?;

-- If increment = false (or not provided):
UPDATE tabMaterialRequestItems 
SET picked_qty = ?,  -- Set to provided value
    scan_qty = ?      -- Keep scan_qty = picked_qty
WHERE material_request = ? AND item_code = ?;
```

#### Option B: Always increment (Simpler)
```json
POST /api/material-requests/MR-123459/pick-items
{
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "picked_qty": 1,  // Always treated as increment
      "source_bin": "A1-R02-L1-B2",
      "carton_id": "PAW-ASN365425473-1768138301111"
    }
  ],
  "warehouse": "WH-MAIN"
}
```

**Backend Logic:**
```sql
-- Always increment
UPDATE tabMaterialRequestItems 
SET picked_qty = picked_qty + ?,
    scan_qty = picked_qty + ?
WHERE material_request = ? AND item_code = ?;
```

**Recommendation:** Use **Option B** (always increment) - simpler and clearer.

---

### 2. ✅ CRITICAL: Add `POST /api/transfer-cartons/{tc_id}/add-items`

**Current Status:** ❌ **NOT AVAILABLE** - This endpoint doesn't exist

**Required Endpoint:**
```
POST /api/transfer-cartons/{tc_id}/add-items
```

**Request Body:**
```json
{
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "quantity": 2,  // Total quantity for this item
      "source_carton": "PAW-ASN365425473-1768138301111",
      "source_bin": "A1-R02-L1-B2"
    }
  ]
}
```

**Response:**
```json
{
  "message": "Items added to transfer carton successfully",
  "items_added": 1,
  "tc_id": "TC-MR-123459-1768157787512"
}
```

**Backend Logic:**
```sql
-- Insert or update items in Transfer Carton
INSERT INTO tabTransferCartonItems (tc_id, item_code, quantity, source_carton, source_bin, ...)
VALUES (?, ?, ?, ?, ?, ...)
ON CONFLICT(tc_id, item_code) 
DO UPDATE SET 
  quantity = quantity + ?,  -- Or set to new value
  source_carton = ?,
  source_bin = ?,
  updated_on = CURRENT_TIMESTAMP;
```

**Alternative:** If Transfer Carton items are derived from Material Request `picked_qty`, this endpoint might not be needed. The backend could automatically create Transfer Carton items from Material Request when Transfer Carton is created.

---

### 3. ⚠️ OPTIONAL: Enhance `POST /api/transfer-cartons/create`

**Current Behavior:**
- Creates empty Transfer Carton
- Does not add items

**Option A: Add items during creation (Recommended)**
```json
POST /api/transfer-cartons/create
{
  "tc_id": "TC-MR-123459-1768157787512",
  "to_no": "MR-123459",
  "store": "STORE-002",
  "material_request": "MR-123459",
  "items": [  // ✅ NEW: Optional items array
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "quantity": 2,
      "source_carton": "PAW-ASN365425473-1768138301111",
      "source_bin": "A1-R02-L1-B2"
    }
  ]
}
```

**Backend Logic:**
1. Create Transfer Carton
2. If `items` array provided, insert items into `tabTransferCartonItems`
3. Return created Transfer Carton with items

**Option B: Auto-populate from Material Request**
- When creating Transfer Carton for Material Request, automatically populate items from Material Request `picked_qty`
- No need to send items in request

**Recommendation:** Use **Option B** - simpler and ensures consistency.

---

## Backend Implementation Details

### Material Request Items Table

**Required Fields:**
- `picked_qty` - Total picked quantity (incremented on each scan)
- `scan_qty` - Should equal `picked_qty` (for tracking)

**Update Logic:**
```sql
-- On each scan (increment mode)
UPDATE tabMaterialRequestItems 
SET 
  picked_qty = picked_qty + 1,
  scan_qty = picked_qty + 1,
  updated_on = CURRENT_TIMESTAMP
WHERE material_request = ? 
  AND item_code = ?;
```

### Transfer Carton Items Table

**Required Fields:**
- `tc_id` - Transfer Carton ID
- `item_code` - Item code
- `quantity` - Total quantity (sum of all scans)
- `source_carton` - Source carton ID
- `source_bin` - Source bin location

**Creation Logic:**
```sql
-- When Transfer Carton is created, populate from Material Request
INSERT INTO tabTransferCartonItems (tc_id, item_code, quantity, source_carton, source_bin, ...)
SELECT 
  ? as tc_id,
  item_code,
  picked_qty as quantity,  -- Use picked_qty from Material Request
  source_carton,
  source_bin,
  ...
FROM tabMaterialRequestItems
WHERE material_request = ?
  AND picked_qty > 0;
```

---

## API Endpoint Summary

### ✅ Already Available (No Changes Needed)

1. **GET /api/material-requests/{title}**
   - Returns Material Request with `picked_qty`
   - No changes needed

2. **POST /api/transfer-cartons/create**
   - Creates Transfer Carton
   - May need enhancement (see above)

### ⚠️ Requires Changes

1. **POST /api/material-requests/{title}/pick-items**
   - **MUST** support incremental updates
   - **MUST** set `scan_qty = picked_qty`
   - **MUST** handle multiple scans of same item

2. **POST /api/transfer-cartons/{tc_id}/add-items** (NEW)
   - **MUST** be created
   - Adds items to existing Transfer Carton
   - OR enhance `create` endpoint to auto-populate from Material Request

---

## Testing Requirements

### Test Case 1: Incremental Pick Items
```
1. Material Request has item with picked_qty = 0
2. Scan item once → Call pick-items with picked_qty = 1
3. Verify: picked_qty = 1, scan_qty = 1
4. Scan same item again → Call pick-items with picked_qty = 1
5. Verify: picked_qty = 2, scan_qty = 2
```

### Test Case 2: Transfer Carton Creation
```
1. Material Request has items with picked_qty > 0
2. Create Transfer Carton for Material Request
3. Verify: Transfer Carton items match Material Request picked_qty
4. Verify: All items with picked_qty > 0 are included
```

### Test Case 3: Multiple Items
```
1. Scan multiple different items
2. Each scan increments picked_qty for that item
3. Create Transfer Carton
4. Verify: All scanned items are in Transfer Carton with correct quantities
```

---

## Migration Path

### Phase 1: Backend Changes
1. Update `pick-items` API to support incremental updates
2. Add `add-items` endpoint OR enhance `create` endpoint
3. Test incremental updates
4. Test Transfer Carton creation with items

### Phase 2: Mobile App Changes
1. Update `handleItemScan()` to call `pick-items` API
2. Remove event creation for Material Request
3. Add Submit button
4. Implement Transfer Carton creation on Submit

### Phase 3: Testing
1. Test end-to-end workflow
2. Test offline scenarios
3. Test error handling
4. Verify quantities match between Material Request and Transfer Carton

---

## Conclusion

**Backend Changes Required:**
- ✅ **CRITICAL:** Enhance `pick-items` API for incremental updates
- ✅ **CRITICAL:** Add `add-items` endpoint OR enhance `create` endpoint
- ⚠️ **OPTIONAL:** Auto-populate Transfer Carton from Material Request

**Estimated Backend Work:**
- 2-4 hours for API enhancements
- 1-2 hours for testing
- **Total: 3-6 hours**

**Mobile App Changes:**
- Can proceed once backend changes are complete
- Estimated: 4-6 hours
