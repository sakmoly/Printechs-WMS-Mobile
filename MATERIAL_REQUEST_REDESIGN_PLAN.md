# Material Request Packing Workflow Redesign

## Current Workflow vs. Proposed Workflow

### Current Workflow ❌
1. Scan item barcode
2. Create event → Send to `/api/events/batch` immediately
3. Backend creates/updates Transfer Carton in real-time
4. Poll backend for quantities

**Issues:**
- Transfer Carton created before all items are scanned
- Real-time sync complexity
- Multiple API calls per scan

---

### Proposed Workflow ✅
1. **Scan item barcode** → List item from Material Request (same design)
2. **Immediately update Material Request** → `POST /api/material-requests/{title}/pick-items` (scan_qty = pick_qty)
3. **After completing all items** → Click "Submit" → Insert/Update Transfer Carton

**Benefits:**
- Simpler workflow
- Material Request is updated immediately (scan_qty = pick_qty)
- Transfer Carton created only when all items are complete
- Single API call per scan (update MR)
- Batch create/update Transfer Carton at the end

---

## Implementation Plan

### Phase 1: Update Scan Handler ✅

**Current:** `handleItemScan()` → Creates event → Sends to `/api/events/batch`

**New:** `handleItemScan()` → Updates Material Request → `POST /api/material-requests/{title}/pick-items`

**Changes:**
1. Remove event creation for Material Request packing
2. Call `apiService.pickMaterialRequestItems()` after each scan
3. Update local state with scanned quantities
4. Reload Material Request to get updated `picked_qty`

**API Call:**
```typescript
await apiService.pickMaterialRequestItems(materialRequestTitle, [
  {
    item_code: itemCode,
    picked_qty: scannedQty, // Increment by 1 for each scan
    source_bin: activeBinLocation,
    carton_id: activeCartonId
  }
]);
```

---

### Phase 2: Add Submit Button ✅

**Location:** After "Requested Items" list, before Transfer Carton actions

**Functionality:**
1. Validate all items are scanned (or allow partial)
2. Create/Update Transfer Carton with all scanned items
3. Use `POST /api/transfer-cartons/create` or update endpoint
4. Show success/error message

**Button States:**
- **Enabled:** When at least one item is scanned
- **Disabled:** When no items scanned or Transfer Carton already created
- **Loading:** While creating/updating Transfer Carton

---

### Phase 3: Transfer Carton Creation/Update ✅

**When:** User clicks "Submit" after completing all items

**Process:**
1. Collect all scanned items with quantities
2. Create Transfer Carton if doesn't exist
3. Update Transfer Carton with all items
4. Show success message
5. Reload Material Request and Transfer Carton

**API Calls:**
```typescript
// 1. Create Transfer Carton (if not exists)
await apiService.createTransferCarton({
  tc_id: transferCarton || generateTCId(),
  to_no: materialRequestTitle,
  store: selectedStore,
  material_request: materialRequestTitle
});

// 2. Update Transfer Carton with items (if needed)
// OR use pick-items API which might create TC automatically
```

---

## API Endpoints Required

### ✅ Already Available

1. **POST /api/material-requests/{title}/pick-items**
   - Updates Material Request items with `picked_qty`
   - Can be called after each scan
   - Request: `{ items: [{ item_code, picked_qty, source_bin, carton_id }] }`

2. **POST /api/transfer-cartons/create**
   - Creates Transfer Carton
   - Request: `{ tc_id, to_no, store, material_request }`

3. **GET /api/material-requests/{title}**
   - Gets Material Request with updated `picked_qty`
   - Used to reload after scan

### ⚠️ May Need Backend Changes

1. **PUT /api/transfer-cartons/{tc_id}** (Update Transfer Carton)
   - May need to add items to existing Transfer Carton
   - Or use pick-items API which might handle this

2. **POST /api/transfer-cartons/{tc_id}/add-items**
   - Alternative: Add items to existing Transfer Carton
   - Request: `{ items: [{ item_code, quantity, carton_id }] }`

---

## UI Changes

### 1. Remove Real-time Transfer Carton Display
- Remove Transfer Carton ID from header (until Submit is clicked)
- Show "Scanning in progress..." or similar

### 2. Add Submit Button
- Location: After "Requested Items" list
- Style: Large, prominent button
- Text: "Submit & Create Transfer Carton" or "Complete Picking"

### 3. Update Item List Display
- Keep same design (✅ Already done)
- Show `picked_qty` from Material Request (updated after each scan)
- Show "Scanned: X" based on Material Request `picked_qty`

---

## Data Flow

### Scan Flow
```
1. User scans item barcode
   ↓
2. handleItemScan() called
   ↓
3. Update local scannedItems state (for UI)
   ↓
4. Call POST /api/material-requests/{title}/pick-items
   Body: {
     items: [{
       item_code: "SKU-XXX",
       picked_qty: 1,  // Increment
       source_bin: "A1-R02-L1-B2",
       carton_id: "PAW-XXX"
     }]
   }
   ↓
5. Backend updates Material Request table
   - Sets picked_qty = scan_qty (increments)
   ↓
6. Reload Material Request to get updated picked_qty
   ↓
7. Update UI with new quantities
```

### Submit Flow
```
1. User clicks "Submit" button
   ↓
2. Validate scanned items
   ↓
3. Create Transfer Carton
   POST /api/transfer-cartons/create
   Body: {
     tc_id: "TC-MR-123459-{timestamp}",
     to_no: "MR-123459",
     store: "STORE-002",
     material_request: "MR-123459"
   }
   ↓
4. (Optional) Add items to Transfer Carton
   POST /api/transfer-cartons/{tc_id}/add-items
   OR use pick-items API which might handle this
   ↓
5. Show success message
   ↓
6. Reload Material Request and Transfer Carton
   ↓
7. Enable Seal/Dispatch actions
```

---

## Code Changes Required

### 1. Modify `handleItemScan()` Function
- Remove event creation for Material Request
- Call `pickMaterialRequestItems()` instead
- Update local state
- Reload Material Request

### 2. Add `handleSubmitPicking()` Function
- Validate scanned items
- Create/Update Transfer Carton
- Show success/error
- Reload data

### 3. Update UI Components
- Add Submit button
- Remove real-time Transfer Carton display (until Submit)
- Update item list to show Material Request `picked_qty`

### 4. Remove Polling Logic
- Remove polling after scan (no longer needed)
- Keep polling only if needed for Transfer Carton updates

---

## Backend Requirements

### ✅ Must Support

1. **POST /api/material-requests/{title}/pick-items**
   - Must update `picked_qty` in Material Request items table
   - Must handle incremental updates (scan_qty = pick_qty)
   - Must validate item exists in Material Request
   - Must validate source_bin and carton_id

2. **POST /api/transfer-cartons/create**
   - Must create Transfer Carton
   - Must link to Material Request via `to_no` or `material_request`

### ⚠️ May Need

1. **PUT /api/transfer-cartons/{tc_id}** or **POST /api/transfer-cartons/{tc_id}/add-items**
   - To add items to existing Transfer Carton
   - Or pick-items API might handle this automatically

---

## Testing Checklist

- [ ] Scan item → Material Request `picked_qty` updates immediately
- [ ] Multiple scans of same item → `picked_qty` increments correctly
- [ ] UI shows updated quantities from Material Request
- [ ] Submit button creates Transfer Carton
- [ ] Submit button adds all scanned items to Transfer Carton
- [ ] Error handling for failed scans
- [ ] Error handling for failed Transfer Carton creation
- [ ] Offline support (queue updates if offline)

---

## Migration Notes

### Breaking Changes
- Transfer Carton is no longer created immediately
- Events are no longer sent to `/api/events/batch` for Material Request packing
- Real-time sync is replaced with explicit Submit action

### Backward Compatibility
- Existing Material Requests with Transfer Cartons will still work
- Can check if Transfer Carton exists and show Submit button accordingly

---

## Conclusion

✅ **This redesign is POSSIBLE and RECOMMENDED**

**Benefits:**
- Simpler workflow
- Clear separation: Scan → Update MR → Submit → Create TC
- Fewer API calls
- Better user experience (explicit Submit action)

**Implementation:**
- Can be done with existing APIs
- Minimal backend changes required
- UI changes are straightforward

**Next Steps:**
1. Confirm backend supports incremental `picked_qty` updates
2. Implement Phase 1 (Update Scan Handler)
3. Implement Phase 2 (Add Submit Button)
4. Implement Phase 3 (Transfer Carton Creation)
5. Test end-to-end workflow
