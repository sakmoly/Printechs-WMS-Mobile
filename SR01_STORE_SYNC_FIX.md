# SR-01 Store Sync Fix

**Date**: 2026-01-17  
**Issue**: Storage location SR-01 showing "0 boxes • 0 Open • 0 Closed" when boxes should exist

---

## Problem Analysis

### Root Causes Identified:

1. **Box Counting Logic Issue:**
   - `boxesByStore` was filtering out Closed boxes
   - Display tried to count both Open and Closed from filtered list
   - Result: Closed boxes never counted, counts always showed 0 Closed

2. **Missing Backend Sync:**
   - Boxes were only loaded from local database
   - No sync from backend API when screen loads
   - If boxes were created on desktop/backend, mobile wouldn't see them

3. **Store Code Format Mismatch:**
   - Backend might use "STORE-001" format
   - Mobile expects "SR-01" format
   - Case-insensitive matching helps, but format differences can cause issues

---

## Fixes Implemented

### ✅ 1. Fixed Box Counting Logic

**File:** `src/screens/BoxManagementScreen.tsx`

**Problem:**
- `boxesByStore` excluded Closed boxes (line 1948)
- Display counted Open/Closed from filtered list (always 0 Closed)

**Solution:**
- Include **both Open and Closed boxes** in `boxesByStore` for accurate counting
- Create separate `boxesByStoreForDisplay` that only shows Open boxes in the list
- Counts now accurately reflect both Open and Closed boxes

**Code Changes:**
```typescript
// ✅ NEW: Include ALL boxes (Open and Closed) for accurate counting
const boxesByStore = useMemo(() => {
  return stores.reduce((acc, store) => {
    const storeUpper = String(store).trim().toUpperCase();
    // Include ALL boxes (Open and Closed) - don't filter by status
    acc[store] = boxes.filter((b) => {
      if (!b.store) return false;
      if (b.purpose === "PUTAWAY") return false;
      // ... other filters ...
      const boxStoreUpper = String(b.store).trim().toUpperCase();
      return boxStoreUpper === storeUpper;
    });
    return acc;
  }, {} as Record<string, any[]>);
}, [stores, boxes, boxToTCMap, dispatchedTCSet]);

// Separate: Filter for display (only show Open boxes in list)
const boxesByStoreForDisplay = useMemo(() => {
  return stores.reduce((acc, store) => {
    acc[store] = (boxesByStore[store] || []).filter((b) => {
      return b.status === "Open" || b.status === "OPEN" || b.status === "open";
    });
    return acc;
  }, {} as Record<string, any[]>);
}, [stores, boxesByStore]);
```

---

### ✅ 2. Added Backend Box Sync

**File:** `src/screens/BoxManagementScreen.tsx`

**Problem:**
- Boxes only loaded from local database
- No sync from backend when screen opens
- Boxes created on desktop/backend not visible on mobile

**Solution:**
- Added backend sync in `loadBoxes()` function
- Syncs boxes from backend API for each store before loading from local cache
- Ensures boxes created on desktop/backend are visible on mobile

**Code Changes:**
```typescript
const loadBoxes = async () => {
  if (!activeASN) return;
  
  // ✅ SYNC: First try to sync boxes from backend API for each store
  try {
    const currentStores = distributionStores.length > 0 ? distributionStores : [];
    if (currentStores.length > 0) {
      console.log(`🔄 Syncing boxes from backend for ${currentStores.length} store(s)...`);
      for (const store of currentStores) {
        try {
          const backendBoxes = await apiService.getBoxes({ asn: activeASN, store });
          // Handle different response formats
          let boxesArray: any[] = [];
          if (Array.isArray(backendBoxes)) {
            boxesArray = backendBoxes;
          } else if (backendBoxes && typeof backendBoxes === 'object') {
            boxesArray = backendBoxes.data || backendBoxes.boxes || backendBoxes.items || [];
          }
          
          if (Array.isArray(boxesArray) && boxesArray.length > 0) {
            // Save boxes to local cache
            for (const box of boxesArray) {
              if (box.box_id && box.store) {
                await dataService.saveBox({...});
              }
            }
            console.log(`✅ Synced ${boxesArray.length} box(es) from backend for store ${store}`);
          }
        } catch (error: any) {
          console.warn(`⚠️ Could not sync boxes from backend for store ${store}:`, error.message);
        }
      }
    }
  } catch (error: any) {
    console.warn(`⚠️ Error syncing boxes from backend:`, error.message);
  }
  
  // Load boxes from local cache (now synced with backend)
  const boxList = await dataService.getBoxes(activeASN);
  // ... rest of loading logic
};
```

---

### ✅ 3. Fixed Load Order

**File:** `src/screens/BoxManagementScreen.tsx`

**Problem:**
- `loadBoxes()` and `loadTransferOrderAndStores()` ran in parallel
- Stores might not be available when sync runs

**Solution:**
- Changed to sequential loading: stores first, then boxes
- Ensures stores are available when syncing boxes

**Code Changes:**
```typescript
useEffect(() => {
  // Load stores first, then boxes (so sync can use stores list)
  const loadData = async () => {
    await loadTransferOrderAndStores();
    await loadWarehousesAndStores();
    // Now load boxes (which will sync from backend using stores)
    await loadBoxes();
    await checkItemsWithoutTO();
    await calculateRemainingItems();
  };
  loadData();
}, [activeASN]);
```

---

## How It Works Now

### Flow:

1. **Screen Opens:**
   - Load Transfer Order and stores (`loadTransferOrderAndStores`)
   - Load warehouses/stores master data (`loadWarehousesAndStores`)

2. **Sync Boxes from Backend:**
   - For each store (SR-01, SR-02, etc.)
   - Call `GET /api/boxes?asn={asn}&store={store}`
   - Save boxes to local `box_cache` table

3. **Load Boxes from Local Cache:**
   - Load all boxes from `box_cache` for current ASN
   - Filter by store, exclude dispatched boxes

4. **Display:**
   - Count **both Open and Closed** boxes for accurate totals
   - Show **only Open boxes** in the list (Closed boxes are counted but not displayed)
   - Display: "X boxes • Y Open • Z Closed"

---

## Testing

### Test Scenarios:

1. **Boxes Created on Desktop:**
   - Create boxes for SR-01 on desktop
   - Open mobile app → Box Management screen
   - ✅ Should see boxes synced from backend
   - ✅ Counts should show correct Open/Closed numbers

2. **Boxes Created on Mobile:**
   - Create boxes for SR-01 on mobile
   - Close and reopen screen
   - ✅ Should see boxes persisted locally
   - ✅ Counts should update correctly

3. **Mixed Status:**
   - Create 3 boxes for SR-01
   - Close 1 box
   - ✅ Should show "3 boxes • 2 Open • 1 Closed"

4. **No Boxes:**
   - SR-01 with no boxes
   - ✅ Should show "0 boxes • 0 Open • 0 Closed"
   - ✅ Should show "No boxes created for SR-01 yet"

---

## Debugging

### Check Console Logs:

Look for these log messages:
- `🔄 Syncing boxes from backend for X store(s)...`
- `✅ Synced X box(es) from backend for store SR-01`
- `📦 All boxes loaded:` (shows all boxes with store info)
- `✅ Filtered boxes:` (shows boxes after filtering)

### Common Issues:

1. **Still showing 0 boxes:**
   - Check if boxes exist in backend: `GET /api/boxes?asn={asn}&store=SR-01`
   - Check console for sync errors
   - Verify store code format matches (SR-01 vs STORE-001)

2. **Boxes not syncing:**
   - Check network connectivity
   - Verify API endpoint is available
   - Check console for API errors

3. **Wrong counts:**
   - Check if boxes are being filtered out (dispatched, putaway, etc.)
   - Verify box status is "Open" or "Closed" (case-insensitive)

---

## Files Modified

1. **`src/screens/BoxManagementScreen.tsx`**
   - Fixed `boxesByStore` to include Closed boxes for counting
   - Added `boxesByStoreForDisplay` for list display (Open only)
   - Added backend sync in `loadBoxes()`
   - Fixed load order to ensure stores are available before sync

---

## Next Steps

1. **Test the fix:**
   - Open Box Management screen
   - Check if SR-01 shows correct box counts
   - Verify boxes created on desktop appear on mobile

2. **If still showing 0 boxes:**
   - Check backend API: `GET /api/boxes?asn={asn}&store=SR-01`
   - Verify store code format in backend matches mobile (SR-01 vs STORE-001)
   - Check console logs for sync errors

3. **Backend Requirements (if needed):**
   - Ensure `GET /api/boxes?asn={asn}&store={store}` endpoint returns boxes
   - Verify store code format matches (SR-01 format)
   - Ensure boxes are returned with correct `store` field

---

**Status**: ✅ **FIXES IMPLEMENTED**

The mobile app now:
- ✅ Syncs boxes from backend when screen opens
- ✅ Counts both Open and Closed boxes accurately
- ✅ Shows correct totals: "X boxes • Y Open • Z Closed"
- ✅ Displays only Open boxes in the list (Closed are counted but not shown)
