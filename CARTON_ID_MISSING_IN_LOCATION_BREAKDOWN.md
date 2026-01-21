# Carton ID Missing in Item Location Breakdown

## Issue

User reported: **"Cartoon ID missing here why?"** in the Item Location Breakdown dialog.

**Important Clarification:**

- ✅ **Stock Ledger API does NOT need `carton_id`** - it's a general inventory view
- ✅ **Item Location Breakdown API MUST include `carton_id`** - it's a detailed location view

**Observed Data:**

- Item: `SKU-HAT-301-GRN-OS` (Baseball Cap Green One Size)
- Location ID: `A1-R02-L1-B2`
- Available Qty: `5.00`
- **Carton ID: Empty/Blank** ❌

## Root Cause Analysis

### Possible Reasons for Missing Carton ID

#### 1. **Backend API Not Returning `carton_id`** (Most Likely)

The backend stock ledger API (`GET /api/stock/ledger` or `GET /api/stock/item/:item_code/warehouse/:warehouse`) may not be including `carton_id` in the response, even though:

- ✅ The mobile app sends `carton_id` during putaway operations
- ✅ The backend database may have `carton_id` stored in stock ledger tables
- ✅ The desktop UI expects to display `carton_id` in the breakdown

#### 2. **Data Not Stored During Putaway**

The `carton_id` may not have been stored when the item was put away:

- Items put away without a carton (loose items)
- Putaway operations that didn't include `carton_id` in the request
- Legacy data from before carton tracking was implemented

#### 3. **Stock Ledger Table Missing `carton_id` Column**

The backend `tabStockLedger` or similar table may not have a `carton_id` column, or it's not being populated during putaway completion.

## Current Mobile App Implementation

### ✅ Mobile App IS Sending `carton_id` to Backend

#### 1. **Putaway Complete API** (`src/services/api.service.ts:3025-3041`)

**Request Structure:**

```typescript
{
  putaway_task: string;
  location_id: string;
  items: [
    {
      item_code: string;
      qty: number;
      carton_id?: string; // ✅ Mobile app includes carton_id
      location_id: string;
      target_bin: string;
    }
  ]
}
```

**Implementation in `PutAwayScreen.tsx`** (`src/screens/PutAwayScreen.tsx:1640-1870`):

- ✅ Extracts `carton_id` from task lines or scanned items
- ✅ Includes `carton_id` in each item when calling `completePutaway`
- ✅ Falls back to `box_id` as `carton_id` for Putaway boxes
- ✅ Logs carton_id tracking for debugging

#### 2. **Stock Ledger Query** (`src/services/api.service.ts:3068-3102`)

**`getStockLedgerByLocation` API:**

- ✅ Supports optional `carton_id` filter parameter (for filtering, not for response)
- ✅ Endpoint: `GET /api/stock/ledger?bin_location={location_id}&carton_id={carton_id}`
- ✅ **Note**: Stock Ledger API does NOT need to return `carton_id` in response (general inventory view)
- ⚠️ **Issue**: Item Location Breakdown API (different endpoint) may not include `carton_id` field

## Required Backend Changes

### ⚠️ **Important: Stock Ledger API Does NOT Need `carton_id`**

**Endpoint**: `GET /api/stock/ledger?bin_location={location_id}`

**Stock Ledger Response (No `carton_id` required):**

```json
{
  "ok": true,
  "data": [
    {
      "item_code": "SKU-HAT-301-GRN-OS",
      "qty": 5.0,
      "location_id": "A1-R02-L1-B2",
      "bin_location": "A1-R02-L1-B2",
      "warehouse": "WH-MAIN",
      "warehouse_id": "WH-MAIN"
      // ✅ carton_id NOT required for stock ledger (general inventory view)
    }
  ]
}
```

### 1. **Item Location Breakdown API MUST Include `carton_id`** ✅

**Endpoint**: `GET /api/stock/item/:item_code/warehouse/:warehouse`

**OR Alternative Endpoint** (if different):

- `GET /api/items/:item_code/location-breakdown`
- `GET /api/stock/item-location-breakdown/:item_code`

**Required Response Format:**

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
      "available_qty": 5.0,
      "carton_id": "CTN-001", // ✅ REQUIRED: Include carton_id (or null if not applicable)
      "warehouse": "WH-MAIN",
      "warehouse_id": "WH-MAIN"
    }
  ]
}
```

**Note**: This is the API that powers the "Item Location Breakdown" dialog in the desktop UI. It must include `carton_id` for each location entry.

### 2. **Backend Database Schema**

**Verify `tabStockLedger` Table Has `carton_id` Column:**

```sql
-- Check if carton_id column exists
DESCRIBE tabStockLedger;

-- Expected columns:
-- - item_code
-- - qty
-- - location_id (or bin_location)
-- - carton_id ✅ REQUIRED
-- - warehouse_id
-- - updated_on
```

**If `carton_id` column doesn't exist, add it:**

```sql
ALTER TABLE tabStockLedger
ADD COLUMN carton_id VARCHAR(255) NULL
AFTER location_id;

-- Add index for faster queries
CREATE INDEX idx_stock_ledger_carton_id ON tabStockLedger(carton_id);
```

### 3. **Backend Putaway Complete Endpoint Must Store `carton_id`**

**Endpoint**: `POST /api/putaway/complete`

**Verify the backend stores `carton_id` when completing putaway:**

```javascript
// Backend code should:
// 1. Accept carton_id in request items array
// 2. Store carton_id in tabStockLedger when updating stock
// 3. Include carton_id in response

// Example backend implementation:
async function completePutaway(req, res) {
  const { putaway_task, location_id, items } = req.body;

  for (const item of items) {
    // Update stock ledger with carton_id
    await db.query(
      `
      UPDATE tabStockLedger 
      SET 
        location_id = ?,
        carton_id = ?, -- ✅ Store carton_id
        qty = qty + ?,
        updated_on = NOW()
      WHERE item_code = ? AND warehouse_id = ?
    `,
      [
        location_id,
        item.carton_id || null, // ✅ Include carton_id (or null)
        item.qty,
        item.item_code,
        warehouse_id,
      ]
    );
  }
}
```

## Data Verification Steps

### 1. **Check Backend Database**

```sql
-- Check if carton_id exists in stock ledger for this item
SELECT
  item_code,
  location_id,
  carton_id, -- ✅ Check if this column exists and has data
  qty,
  warehouse_id
FROM tabStockLedger
WHERE item_code = 'SKU-HAT-301-GRN-OS'
  AND location_id = 'A1-R02-L1-B2';

-- If carton_id is NULL or empty, the data wasn't stored during putaway
```

### 2. **Check Putaway Task Data**

```sql
-- Check if putaway task lines have carton_id
SELECT
  pt.putaway_task,
  ptl.item_code,
  ptl.qty,
  ptl.carton_id, -- ✅ Check if this exists
  pt.location_id
FROM tabPutawayTask pt
JOIN tabPutawayTaskLines ptl ON pt.putaway_task = ptl.putaway_task
WHERE ptl.item_code = 'SKU-HAT-301-GRN-OS'
  AND pt.location_id = 'A1-R02-L1-B2';
```

### 3. **Check Item Location Breakdown API Response**

**Test the Item Location Breakdown API directly:**

```bash
# Test Item Location Breakdown API (NOT Stock Ledger)
curl -X GET "http://your-api/api/stock/item/SKU-HAT-301-GRN-OS/warehouse/WH-MAIN" \
  -H "Authorization: Bearer YOUR_TOKEN"

# OR if different endpoint:
curl -X GET "http://your-api/api/items/SKU-HAT-301-GRN-OS/location-breakdown" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected response MUST include carton_id:
{
  "ok": true,
  "data": [
    {
      "location_id": "A1-R02-L1-B2",
      "bin_location": "A1-R02-L1-B2",
      "zone": "Zone A",
      "aisle": "Aisle 01",
      "rack": "Rack 02",
      "level": "1",
      "bin": "B2",
      "available_qty": 5.00,
      "carton_id": "CTN-001" // ✅ REQUIRED: Should be present (or null if not applicable)
    }
  ]
}

# Note: Stock Ledger API does NOT need carton_id
# GET /api/stock/ledger?bin_location=... - carton_id NOT required
```

## Recommendations

### For Backend Team:

1. **✅ Verify Database Schema**:

   - Ensure `tabStockLedger` has `carton_id` column (for Item Location Breakdown queries)
   - Ensure `tabPutawayTaskLines` has `carton_id` column
   - Add columns if missing

2. **✅ Update Item Location Breakdown API** (NOT Stock Ledger):

   - **DO NOT** modify `GET /api/stock/ledger` - it doesn't need `carton_id`
   - **DO** update `GET /api/stock/item/:item_code/warehouse/:warehouse` (or equivalent Item Location Breakdown endpoint)
   - Include `carton_id` in the response for each location entry
   - Return `null` if carton_id is not applicable (loose items)

3. **✅ Update Putaway Complete Endpoint**:

   - Accept `carton_id` from mobile app request
   - Store `carton_id` in `tabStockLedger` when updating stock (needed for Item Location Breakdown queries)
   - Store `carton_id` in `tabPutawayTaskLines` if applicable

4. **✅ Handle Legacy Data**:
   - For existing stock without `carton_id`, return `null` (not empty string) in Item Location Breakdown
   - Consider data migration if carton_id can be derived from historical data

### For Mobile App:

1. **✅ Already Implemented**: Mobile app correctly sends `carton_id` in putaway operations
2. **✅ No Changes Required**: Mobile app implementation is correct

## Summary

- ✅ **Mobile app IS sending `carton_id`** to backend in putaway operations
- ❌ **Item Location Breakdown API is NOT returning `carton_id`** in responses
- ❌ **Backend may not be storing `carton_id`** in stock ledger during putaway completion
- ✅ **Solution**: Backend needs to:
  1. Ensure database schema includes `carton_id` column in `tabStockLedger`
  2. Store `carton_id` when completing putaway
  3. Return `carton_id` in **Item Location Breakdown API** responses (NOT in Stock Ledger API)

**Key Point**: Only the **Item Location Breakdown API** needs `carton_id`. The Stock Ledger API is a general inventory view and does NOT need `carton_id`.

The issue is on the **backend side** - the APIs need to:

- Store `carton_id` when items are put away
- Return `carton_id` in stock ledger and item location API responses
