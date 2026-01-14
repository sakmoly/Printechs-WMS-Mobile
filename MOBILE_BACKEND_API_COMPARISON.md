# Mobile App ↔ Backend API Comparison

## ✅ Verification: Mobile App Implementation vs Backend APIs

### 1. POST /api/material-requests/{title}/pick-items

#### Backend Implementation:
- **Always increments** `picked_qty` (adds to existing, never sets absolute)
- Sets `scan_qty = picked_qty` (if column exists)
- Supports multiple scans of the same item
- SQL: `UPDATE tabMaterialRequestItem SET picked_qty = picked_qty + ?, scan_qty = picked_qty + ? WHERE parent_title = ? AND item_code = ?`

#### Mobile App Implementation:
**File:** `src/screens/MaterialRequestPackingScreen.tsx` (lines 3051-3062)

```typescript
await apiService.pickMaterialRequestItems(
  materialRequestTitle,
  [
    {
      item_code: itemCode,
      picked_qty: 1, // ✅ Sends 1 for each scan (backend will increment)
      source_bin: normalizedLocation,
      carton_id: normalizedCartonId,
    },
  ],
  materialRequest?.from_warehouse
);
```

**File:** `src/services/api.service.ts` (lines 2015-2033)

```typescript
pickMaterialRequestItems: async (
  title: string,
  items: Array<{
    item_code: string;
    picked_qty: number;
    source_bin: string;
    carton_id?: string;
  }>,
  warehouse?: string
) => {
  return makeRequest(
    `/api/material-requests/${title}/pick-items`,
    "POST",
    {
      items,
      warehouse,
    }
  );
}
```

**✅ Status: MATCHES**
- Mobile sends `picked_qty: 1` for each scan
- Backend increments existing `picked_qty` by the provided value
- Both support `source_bin` and `carton_id`
- Both support `warehouse` parameter

---

### 2. POST /api/transfer-cartons/{tc_id}/add-items

#### Backend Implementation:
- Creates `PACK_ITEM_TO_TC` events for items
- Validates transfer carton exists and status
- Validates carton existence (if carton-level inventory enabled)
- Dynamically handles optional columns (`material_request`, `source_bin`)

**Request Format:**
```json
POST /api/transfer-cartons/{tc_id}/add-items
{
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 2.0,
      "carton_id": "PAW-ASN365425473-1768138301111",
      "source_bin": "A1-R02-L1-B2"
    }
  ],
  "user_id": "USER-150526"
}
```

#### Mobile App Implementation:
**File:** `src/services/api.service.ts` (lines 2035-2053)

```typescript
addItemsToTransferCarton: async (
  tc_id: string,
  items: Array<{
    item_code: string;
    qty: number;
    carton_id?: string;
    source_bin?: string;
  }>,
  user_id: string
) => {
  return makeRequest(
    `/api/transfer-cartons/${tc_id}/add-items`,
    "POST",
    {
      items,
      user_id,
    }
  );
}
```

**File:** `src/screens/MaterialRequestPackingScreen.tsx` (lines 1254-1295)

```typescript
// Get items with picked_qty > 0 from Material Request
const itemsToAdd: Array<{
  item_code: string;
  qty: number;
  carton_id?: string;
  source_bin?: string;
}> = [];

if (materialRequest?.items && Array.isArray(materialRequest.items)) {
  for (const item of materialRequest.items) {
    const pickedQty = item.picked_qty || 0;
    if (pickedQty > 0) {
      // Get carton_id and source_bin from scanned_items table
      const scannedItem = await db.getFirstAsync<{
        box_id: string | null;
        location_id: string | null;
      }>(
        `SELECT box_id, location_id FROM scanned_items 
         WHERE asn_no = ? AND item_code = ? 
         ORDER BY scanned_on DESC LIMIT 1`,
        [materialRequestTitle, item.item_code]
      );

      itemsToAdd.push({
        item_code: item.item_code,
        qty: pickedQty, // Total picked quantity
        carton_id: scannedItem?.box_id || undefined,
        source_bin: scannedItem?.location_id || undefined,
      });
    }
  }
}

// Add items to Transfer Carton
await apiService.addItemsToTransferCarton(
  createdTCId,
  itemsToAdd,
  settings.user_id
);
```

**✅ Status: MATCHES**
- Mobile sends `items` array with `item_code`, `qty`, `carton_id`, `source_bin`
- Mobile sends `user_id` in request body
- Backend expects same format
- Both support optional `carton_id` and `source_bin`

---

## Workflow Comparison

### Backend Workflow (Expected):
1. User scans item → Mobile calls `pick-items` API → Backend increments `picked_qty`
2. User clicks Submit → Mobile creates Transfer Carton → Mobile calls `add-items` API → Backend creates events

### Mobile App Workflow (Implemented):
1. ✅ User scans item → `handleItemScan()` → Calls `pick-items` API → Updates Material Request
2. ✅ User clicks Submit → `createTransferCarton()` → Creates TC → Calls `add-items` API → Adds items to TC

**✅ Status: MATCHES**

---

## Potential Issues & Recommendations

### 1. ✅ Carton ID Source
**Current:** Mobile gets `carton_id` from `scanned_items.box_id` (last scanned)
**Recommendation:** Consider getting from Material Request items if backend stores it there

### 2. ✅ Source Bin Source
**Current:** Mobile gets `source_bin` from `scanned_items.location_id` (last scanned)
**Recommendation:** Consider getting from Material Request items if backend stores it there

### 3. ✅ Multiple Cartons per Item
**Current:** Mobile only sends the last scanned carton/location for each item
**Recommendation:** If an item can be scanned from multiple cartons/locations, backend should handle aggregation, or mobile should send all combinations

### 4. ⚠️ Offline Support
**Current:** Mobile shows alert if offline during scan
**Recommendation:** Implement offline queue for `pick-items` API calls (similar to event queue)

---

## Summary

✅ **All APIs match backend expectations**
✅ **Workflow is correctly implemented**
✅ **Request formats are compatible**

**Ready for testing!**
