# Item Search Strategy Update

## ✅ Changes Applied

Updated the item search strategy to **search local database first, then backend** as requested.

---

## 🔄 New Search Flow

### **Priority 1: Search Local Database** (Faster, Works Offline)
1. Check `item_barcode_map` table (most specific mapping)
2. Check `item_master` table by barcode
3. Check `item_master` table by item_code

### **Priority 2: Search Backend API** (If not found locally)
1. Fetch all items from backend API (`GET /api/item-master` or equivalent)
2. Search for item by barcode or item_code
3. Cache the result in local database (`item_master` table)

### **Result**
- Return `ItemMaster` object if found
- Return `null` if not found anywhere

---

## 📋 Files Changed

### **1. `src/services/item-master.service.ts`**

**Function:** `resolveItemFromBarcode(barcode: string): Promise<ItemMaster | null>`

**Changes:**
- ✅ **Priority 1:** Search local database first (`item_barcode_map`, `item_master`)
- ✅ **Priority 2:** If not found locally, search backend API
- ✅ **Cache:** Results from backend are automatically cached in local database
- ✅ **Offline Support:** Works offline if item exists in local database

**Search Order:**
1. `item_barcode_map` table (barcode → item_code mapping)
2. `item_master` table (by barcode)
3. `item_master` table (by item_code)
4. Backend API (if not found locally)
5. Cache backend result in `item_master` table

---

### **2. `src/screens/CycleCountBinCountingScreen.tsx`**

**Function:** `handleItemScan(barcode: string)`

**Changes:**
- ✅ Now uses `resolveItemFromBarcode()` service instead of manual database queries
- ✅ Automatically searches local database first, then backend
- ✅ Creates `item_barcode_map` entry if missing
- ✅ Simplified logic - uses centralized item resolution service

**Before:**
- Manually checked `item_barcode_map`
- Manually checked `item_master`
- Showed error if not found

**After:**
- Uses `resolveItemFromBarcode()` service
- Automatically searches local DB → backend → caches result
- Shows error only if item truly not found

---

## 🔍 How It Works

### **Example: Scanning "SKU-SHIRT-001-WHT-M"**

**Step 1: Search Local Database**
```sql
-- Check item_barcode_map
SELECT item_code, barcode, uom, pack_size 
FROM item_barcode_map 
WHERE barcode = 'SKU-SHIRT-001-WHT-M'

-- If not found, check item_master by barcode
SELECT item_code, barcode, item_name 
FROM item_master 
WHERE barcode = 'SKU-SHIRT-001-WHT-M'

-- If not found, check item_master by item_code
SELECT item_code, barcode, item_name 
FROM item_master 
WHERE item_code = 'SKU-SHIRT-001-WHT-M'
```

**Step 2: If Not Found Locally, Search Backend**
```javascript
// Fetch all items from backend
const response = await apiService.pullItemMaster();

// Search for item in response
const foundItem = items.find(item => 
  item.barcode === 'SKU-SHIRT-001-WHT-M' || 
  item.item_code === 'SKU-SHIRT-001-WHT-M'
);

// If found, cache in local database
await db.runAsync(
  `INSERT OR REPLACE INTO item_master (item_code, barcode, item_name, updated_on) 
   VALUES (?, ?, ?, ?)`,
  [foundItem.item_code, foundItem.barcode, foundItem.item_name, new Date().toISOString()]
);
```

**Step 3: Use Result**
```javascript
if (item) {
  // Item found - use it for counting
  await addOrIncrementItem(item.item_code, barcode, uom, increment);
} else {
  // Item not found - show error
  Alert.alert("Item Not Found", `Barcode "${barcode}" not found in system`);
}
```

---

## ✅ Benefits

1. **Faster Lookups** - Local database searches are instant (no network latency)
2. **Offline Support** - Works offline if item exists in local database
3. **Automatic Caching** - Backend results are cached for future use
4. **Centralized Logic** - All item resolution happens in one service
5. **Better Performance** - Reduces unnecessary backend calls
6. **Consistent Behavior** - Same search strategy across all screens

---

## 🧪 Testing

### **Test 1: Item in Local Database (Should Work Fast)**
1. Item "SKU-JACKET-201-BLK-L" exists in `item_master` table
2. Scan "SKU-JACKET-201-BLK-L"
3. **Expected:** ✅ Item found instantly (no backend call)
4. **Log:** `✅ Item found in local database by barcode: item_code="SKU-JACKET-201-BLK-L"`

### **Test 2: Item Not in Local Database, But in Backend (Should Fetch and Cache)**
1. Item "SKU-SHIRT-001-WHT-M" NOT in local database
2. Item "SKU-SHIRT-001-WHT-M" exists in backend
3. Scan "SKU-SHIRT-001-WHT-M"
4. **Expected:** ✅ Item found from backend, cached in local database
5. **Log:** `✅ Item found in backend: item_code="SKU-SHIRT-001-WHT-M", barcode="SKU-SHIRT-001-WHT-M"`
6. **Log:** `💾 Cached item in local database: item_code="SKU-SHIRT-001-WHT-M", barcode="SKU-SHIRT-001-WHT-M"`
7. **Next Scan:** Item found instantly from local database (cached)

### **Test 3: Item Not Found Anywhere (Should Show Error)**
1. Item "INVALID-ITEM-123" doesn't exist in local database or backend
2. Scan "INVALID-ITEM-123"
3. **Expected:** ❌ Error: "Item Not Found: Barcode 'INVALID-ITEM-123' not found in system"
4. **Log:** `❌ Item not found: INVALID-ITEM-123`

### **Test 4: Offline Mode (Should Work with Local Items)**
1. Disable network connection
2. Item "SKU-JACKET-201-BLK-L" exists in local database
3. Scan "SKU-JACKET-201-BLK-L"
4. **Expected:** ✅ Item found from local database (no backend call)
5. **Log:** `✅ Item found in local database by barcode: item_code="SKU-JACKET-201-BLK-L"`

---

## 📊 Summary

| Scenario | Local DB | Backend | Result | Performance |
|----------|----------|---------|--------|-------------|
| **Item in local DB** | ✅ Found | N/A | ✅ Return immediately | **Instant** (0ms) |
| **Item not in local DB, in backend** | ❌ Not found | ✅ Found | ✅ Return + cache | **Network call** (~100-500ms) |
| **Item not found anywhere** | ❌ Not found | ❌ Not found | ❌ Return null | **Network call + local search** (~100-500ms) |
| **Offline, item in local DB** | ✅ Found | N/A (offline) | ✅ Return immediately | **Instant** (0ms) |
| **Offline, item not in local DB** | ❌ Not found | N/A (offline) | ❌ Return null | **Local search only** (~1-5ms) |

---

## 🔧 Implementation Details

### **Item Master Service**
- **File:** `src/services/item-master.service.ts`
- **Function:** `resolveItemFromBarcode(barcode: string): Promise<ItemMaster | null>`
- **Search Order:**
  1. `item_barcode_map` table
  2. `item_master` table (by barcode)
  3. `item_master` table (by item_code)
  4. Backend API (if not found locally)
  5. Cache result in `item_master` table

### **Cycle Count Screen**
- **File:** `src/screens/CycleCountBinCountingScreen.tsx`
- **Function:** `handleItemScan(barcode: string)`
- **Uses:** `resolveItemFromBarcode()` service
- **Additional Logic:**
  - Creates `item_barcode_map` entry if missing
  - Uses `pack_size` and `uom` from `item_barcode_map` if available
  - Falls back to defaults ("EA", 1) if not available

---

## ✅ Status

**Implementation:** ✅ **COMPLETE**

- ✅ Local database search implemented (Priority 1)
- ✅ Backend API search implemented (Priority 2)
- ✅ Automatic caching of backend results
- ✅ Cycle count screen updated to use new service
- ✅ Offline support maintained
- ✅ Error handling improved
- ✅ No breaking changes

**Ready for Testing:** ✅ **YES**
