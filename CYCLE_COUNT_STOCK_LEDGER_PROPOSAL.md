# Cycle Count - Stock Ledger Direct Fetch Proposal

## 📋 User's Proposal

**Request:** When creating a cycle count task with **Blind Count unchecked**, fetch items directly from backend stock ledger filtered by **Location ID (bin_code)** and **Carton ID**, list them immediately so users can:
- See expected items before starting to count
- Make decisions quickly
- Start counting/scanning immediately
- Take informed decisions

---

## 🔍 Current Implementation Analysis

### **Current Flow:**

**Step 1: Create Task (CycleCountDashboardScreen)**
```typescript
// Current: Loads from LOCAL stock_ledger_cache
if (!taskForm.is_blind_count) {
  const expectedItems = await db.getAllAsync(
    "SELECT item_code, qty FROM stock_ledger_cache WHERE bin_location = ?",
    [binCodeUpper]
  );
  // Creates initial lines and sends to backend
}
```

**Step 2: Navigate to Counting Screen**
- Expected items are loaded from local cache or backend task lines
- User sees items only after navigating to counting screen
- If local cache is empty, no items shown

### **Issues with Current Approach:**

1. ❌ **Dependent on Local Cache**: If `stock_ledger_cache` is not synced, no expected items shown
2. ❌ **Delayed Visibility**: Items only visible after task creation and navigation
3. ❌ **No Carton ID Filtering**: Current stock ledger API doesn't filter by `carton_id`
4. ❌ **Manual Sync Required**: User must manually sync stock ledger from backend first

---

## ✅ Proposed Solution

### **New Flow:**

**Step 1: Create Task (Before Submission)**
1. User scans bin code: `A1-R01-L2-B1`
2. User selects count type: `Ad-hoc` or `Directed`
3. User toggles **Blind Count: OFF**
4. User optionally scans/enters **Carton ID** (if carton-level counting)
5. **NEW**: System fetches items from backend stock ledger:
   - **API**: `GET /api/stock/ledger?location=A1-R01-L2-B1&carton_id=CTN-001` (if carton provided)
   - **OR**: `GET /api/stock/ledger?location=A1-R01-L2-B1` (if bin-level only)
6. **NEW**: System displays expected items in a list/preview:
   - Item Code | Item Name | Expected Qty | Bin Location | Carton ID
   - User can review before creating task
7. User clicks "Create Task" → Task created with these items as initial lines

**Step 2: Navigate to Counting Screen**
- Items already loaded and visible immediately
- User can start counting/scanning right away

---

## 🔧 Implementation Requirements

### **Backend API Changes Required:**

#### **1. Enhanced Stock Ledger API**

**Current API:**
```
GET /api/stock/ledger?item_code=ITEM-001&warehouse=WH-001&location=A1-R01-L2-B1
```

**Proposed Enhanced API:**
```
GET /api/stock/ledger?bin_location=A1-R01-L2-B1&carton_id=CTN-001&warehouse=WH-001
```

**Query Parameters:**
- `bin_location` (required): Bin code or location ID (e.g., `A1-R01-L2-B1`)
- `carton_id` (optional): Carton ID for carton-level filtering (e.g., `CTN-001`)
- `warehouse` (optional): Warehouse code for additional filtering
- `item_code` (optional): Filter by specific item code

**Response Format:**
```json
{
  "data": [
    {
      "item_code": "SKU-JACKET-201-BLK-L",
      "item_name": "Jacket Black Large",
      "barcode": "100000000001",
      "qty": 5,
      "bin_location": "A1-R01-L2-B1",
      "carton_id": "CTN-001",
      "warehouse": "WH-001",
      "uom": "EA",
      "last_updated": "2025-01-27T10:00:00Z"
    },
    {
      "item_code": "SKU-SHIRT-001-WHT-M",
      "item_name": "Shirt White Medium",
      "barcode": "100000000002",
      "qty": 3,
      "bin_location": "A1-R01-L2-B1",
      "carton_id": "CTN-001",
      "warehouse": "WH-001",
      "uom": "EA",
      "last_updated": "2025-01-27T10:00:00Z"
    }
  ],
  "total": 2,
  "bin_location": "A1-R01-L2-B1",
  "carton_id": "CTN-001"
}
```

#### **2. Alternative: Dedicated Cycle Count Stock Query API**

If modifying stock ledger API is not preferred, create a dedicated endpoint:

**New API:**
```
GET /api/cycle-count/stock-by-location?bin_location=A1-R01-L2-B1&carton_id=CTN-001
```

**Purpose:** 
- Optimized for cycle count workflow
- Returns only items relevant for cycle counting
- Includes expected_qty formatted for cycle count task lines

**Response Format:**
```json
{
  "bin_location": "A1-R01-L2-B1",
  "carton_id": "CTN-001",
  "items": [
    {
      "item_code": "SKU-JACKET-201-BLK-L",
      "item_name": "Jacket Black Large",
      "barcode": "100000000001",
      "expected_qty": 5,
      "uom": "EA",
      "bin_location": "A1-R01-L2-B1",
      "carton_id": "CTN-001"
    }
  ],
  "total_items": 2,
  "total_qty": 8
}
```

---

### **Mobile App Changes Required:**

#### **File: `src/services/api.service.ts`**

**Add New API Method:**
```typescript
getStockLedgerByLocation: async (filters: {
  bin_location: string; // Required
  carton_id?: string; // Optional
  warehouse?: string; // Optional
}) => {
  const params = new URLSearchParams();
  params.append("bin_location", filters.bin_location);
  if (filters.carton_id) params.append("carton_id", filters.carton_id);
  if (filters.warehouse) params.append("warehouse", filters.warehouse);
  return makeRequest(`/api/stock/ledger?${params.toString()}`, "GET");
},

// OR (if using dedicated endpoint):
getCycleCountStockByLocation: async (bin_location: string, carton_id?: string) => {
  const params = new URLSearchParams();
  params.append("bin_location", bin_location);
  if (carton_id) params.append("carton_id", carton_id);
  return makeRequest(`/api/cycle-count/stock-by-location?${params.toString()}`, "GET");
},
```

#### **File: `src/screens/CycleCountDashboardScreen.tsx`**

**Update `handleCreateTaskSubmit` Function:**

```typescript
const handleCreateTaskSubmit = async () => {
  if (!taskForm.bin_code.trim()) {
    Alert.alert("Error", "Please enter a bin code");
    return;
  }

  setCreatingTask(true);
  try {
    const settings = await getSettings();
    const db = await getDatabase();
    const binCodeUpper = taskForm.bin_code.trim().toUpperCase();
    const countDate = new Date().toISOString().split("T")[0];
    const createdBy = settings.user_id || settings.user_code || "MOBILE-USER";
    const timestamp = Date.now().toString(36).toUpperCase();
    const generatedTitle = `CC-${binCodeUpper.replace(/[^A-Z0-9]/g, "-")}-${timestamp}`;
    
    let initialLines: Array<{
      item_code: string;
      bin_location: string;
      expected_qty: number;
      carton_id?: string;
    }> = [];
    
    // ✅ NEW: If Blind Count is unchecked, fetch items from BACKEND stock ledger
    if (!taskForm.is_blind_count) {
      try {
        console.log(`🔍 Fetching stock ledger from backend for bin ${binCodeUpper}...`);
        
        // Option 1: Use enhanced stock ledger API
        const stockResponse = await apiService.getStockLedgerByLocation({
          bin_location: binCodeUpper,
          carton_id: taskForm.carton_id, // If carton-level counting
          warehouse: taskForm.warehouse_id,
        });
        
        // Option 2: OR use dedicated cycle count stock API
        // const stockResponse = await apiService.getCycleCountStockByLocation(
        //   binCodeUpper,
        //   taskForm.carton_id
        // );
        
        const stockItems = stockResponse?.data || stockResponse?.items || stockResponse || [];
        
        if (stockItems && stockItems.length > 0) {
          console.log(`✅ Found ${stockItems.length} items from backend stock ledger`);
          
          initialLines = stockItems.map((item: any, index: number) => ({
            id: index + 1,
            item_code: item.item_code,
            bin_location: item.bin_location || binCodeUpper,
            expected_qty: item.qty || item.expected_qty || 0,
            carton_id: item.carton_id || taskForm.carton_id || null,
            actual_qty: 0,
            counted_qty: 0,
          }));
          
          // ✅ NEW: Show preview to user before creating task
          const itemList = stockItems
            .map((item: any) => `• ${item.item_code} (${item.item_name || 'N/A'}) - Qty: ${item.qty || item.expected_qty || 0}`)
            .join('\n');
          
          Alert.alert(
            "Expected Items Preview",
            `Found ${stockItems.length} item(s) for bin ${binCodeUpper}:\n\n${itemList}\n\nCreate task with these items?`,
            [
              { text: "Cancel", style: "cancel", onPress: () => { setCreatingTask(false); return; } },
              { text: "Create Task", onPress: () => proceedWithTaskCreation() }
            ]
          );
          
          // Wait for user confirmation before proceeding
          return;
        } else {
          Alert.alert(
            "No Items Found",
            `No stock found for bin ${binCodeUpper}. Create task anyway?`,
            [
              { text: "Cancel", style: "cancel", onPress: () => { setCreatingTask(false); return; } },
              { text: "Create Task", onPress: () => proceedWithTaskCreation() }
            ]
          );
          return;
        }
      } catch (error: any) {
        console.error(`❌ Error fetching stock ledger:`, error);
        Alert.alert(
          "Error",
          `Failed to fetch stock ledger: ${error.message}\n\nCreate task anyway?`,
          [
            { text: "Cancel", style: "cancel", onPress: () => { setCreatingTask(false); return; } },
            { text: "Create Task", onPress: () => proceedWithTaskCreation() }
          ]
        );
        return;
      }
    }
    
    // Proceed with task creation (existing logic)
    const proceedWithTaskCreation = async () => {
      // ... existing task creation logic ...
    };
    
    proceedWithTaskCreation();
    
  } catch (error: any) {
    console.error("❌ Error creating task:", error);
    Alert.alert("Error", `Failed to create task: ${error.message}`);
    setCreatingTask(false);
  }
};
```

#### **File: `src/screens/CycleCountScanBinScreen.tsx`**

**Update Task Creation Flow:**

```typescript
// Add carton_id input field for carton-level counting
const [cartonId, setCartonId] = useState<string>("");

// When user scans/enters carton ID, fetch stock ledger immediately
const handleCartonIdChange = async (cartonIdValue: string) => {
  setCartonId(cartonIdValue);
  
  // If bin code is already entered and blind count is unchecked, fetch items
  if (binInfo && !isBlindCount && cartonIdValue.trim()) {
    try {
      const stockResponse = await apiService.getStockLedgerByLocation({
        bin_location: binInfo.bin_code,
        carton_id: cartonIdValue.trim(),
      });
      
      const stockItems = stockResponse?.data || stockResponse?.items || [];
      
      if (stockItems && stockItems.length > 0) {
        // Show preview of expected items
        console.log(`✅ Found ${stockItems.length} items for bin ${binInfo.bin_code}, carton ${cartonIdValue}`);
        // Display items in UI (new component or modal)
      }
    } catch (error: any) {
      console.warn(`⚠️ Error fetching stock:`, error.message);
    }
  }
};
```

---

## 🎯 Benefits of Proposed Solution

### **1. Immediate Visibility**
- ✅ Users see expected items **before** creating task
- ✅ No need to navigate to counting screen first
- ✅ Better decision making

### **2. Direct Backend Integration**
- ✅ Always fetches latest stock data
- ✅ No dependency on local cache sync
- ✅ Real-time stock information

### **3. Carton-Level Support**
- ✅ Can filter by carton_id when provided
- ✅ Supports both bin-level and carton-level counting
- ✅ More accurate expected quantities

### **4. User Experience**
- ✅ Preview before task creation
- ✅ Can review and decide before committing
- ✅ Faster workflow (no waiting for sync)

### **5. Error Handling**
- ✅ Clear feedback if no items found
- ✅ Can still create task even if API fails
- ✅ Graceful fallback to existing behavior

---

## 📊 Directed vs Ad-hoc Count Types

### **Directed Count:**
- **Definition**: Pre-scheduled, planned cycle count tasks created by desktop/system
- **Purpose**: Systematic inventory audits based on counting plan
- **Characteristics**:
  - Created in advance (e.g., weekly/monthly plan)
  - Assigned to specific users/teams
  - Scheduled for specific dates/times
  - Includes all items in designated bins/locations
  - Part of regular inventory control procedures

**Backend Requirements:**
- ✅ Task already exists in backend (created by desktop)
- ✅ Mobile app fetches existing tasks via `GET /api/cycle-count?status=Draft,In Progress&count_type=Directed`
- ✅ Task lines are already pre-populated with expected items
- ❌ **No backend changes required** - mobile app just needs to display and work with existing tasks

### **Ad-hoc Count:**
- **Definition**: On-demand, immediate cycle count tasks created by mobile users
- **Purpose**: Quick inventory checks, discrepancy investigations, spot checks
- **Characteristics**:
  - Created on-the-spot when needed
  - No pre-planning required
  - User-initiated for immediate counting
  - Can be for specific bins, items, or cartons
  - Flexible and responsive

**Backend Requirements:**
- ✅ Task created by mobile app via `POST /api/cycle-count`
- ✅ Task lines need to be populated with expected items
- ✅ **Backend changes required**: Enhanced stock ledger API to support filtering by `bin_location` and `carton_id`
- ✅ **Current implementation**: Loads from local cache (limited)

### **Key Differences:**

| Feature | Directed Count | Ad-hoc Count |
|---------|---------------|--------------|
| **Created By** | Desktop/System | Mobile User |
| **Timing** | Pre-scheduled | On-demand |
| **Task Exists** | Yes (pre-created) | No (created by mobile) |
| **Expected Items** | Pre-populated by desktop | Need to fetch from stock ledger |
| **Backend Changes** | ❌ None required | ✅ Enhanced stock ledger API needed |
| **Mobile Changes** | Display/list existing tasks | Create task + fetch stock ledger |

---

## 🔄 Backend Changes Summary

### **Required Changes:**

#### **1. Enhanced Stock Ledger API (Recommended)**
```typescript
// GET /api/stock/ledger
// Add new query parameters:
- bin_location (required): Filter by bin code/location
- carton_id (optional): Filter by carton ID for carton-level inventory
- Keep existing: item_code, warehouse, location
```

#### **2. OR Dedicated Cycle Count Stock API (Alternative)**
```typescript
// GET /api/cycle-count/stock-by-location
// Purpose: Optimized query for cycle count workflow
// Parameters:
- bin_location (required)
- carton_id (optional)
// Returns: Formatted items with expected_qty
```

### **No Changes Required For:**
- ✅ Directed Count (already works with existing tasks)
- ✅ Task creation API (`POST /api/cycle-count`)
- ✅ Task update/count APIs (`POST /api/cycle-count/{title}/count`)
- ✅ Task submit/complete APIs

---

## ✅ Recommended Implementation Plan

### **Phase 1: Backend API Enhancement (Priority: High)**
1. **Add `bin_location` and `carton_id` filters to Stock Ledger API**
   - Endpoint: `GET /api/stock/ledger`
   - Parameters: `?bin_location=A1-R01-L2-B1&carton_id=CTN-001`
   - Response: Include `carton_id` in each stock entry

### **Phase 2: Mobile App - Direct Backend Fetch (Priority: High)**
1. **Update `CycleCountDashboardScreen`**
   - Fetch stock ledger from backend when Blind Count is unchecked
   - Show preview of expected items before task creation
   - Allow user to confirm before creating task

2. **Update `CycleCountScanBinScreen`**
   - Optionally fetch stock ledger when carton ID is scanned
   - Display expected items in UI

### **Phase 3: Enhanced User Experience (Priority: Medium)**
1. **Add Preview Modal/Component**
   - Display expected items in a nice list format
   - Show item codes, names, expected quantities
   - Allow user to review before creating task

2. **Add Carton ID Input Field**
   - In task creation form
   - Optional field for carton-level counting
   - Auto-fetch stock when carton ID is entered

### **Phase 4: Fallback & Error Handling (Priority: Medium)**
1. **Graceful Degradation**
   - If backend API fails, fall back to local cache
   - If no items found, still allow task creation
   - Clear error messages to user

---

## 📝 Testing Checklist

### **Backend API Testing:**
- [ ] Test `GET /api/stock/ledger?bin_location=A1-R01-L2-B1`
- [ ] Test `GET /api/stock/ledger?bin_location=A1-R01-L2-B1&carton_id=CTN-001`
- [ ] Verify response includes all required fields (item_code, qty, carton_id, bin_location)
- [ ] Test with non-existent bin_location (should return empty array)
- [ ] Test with non-existent carton_id (should return bin-level items only)

### **Mobile App Testing:**
- [ ] Test creating task with Blind Count OFF → should fetch from backend
- [ ] Test creating task with Blind Count ON → should not fetch from backend
- [ ] Test with carton_id → should filter by carton
- [ ] Test without carton_id → should show bin-level items
- [ ] Test with no items found → should show warning but allow task creation
- [ ] Test with API error → should fall back to local cache or show error
- [ ] Test preview modal shows correct items before task creation

---

## 🎯 Summary

### **User's Request:**
✅ **Fetch stock ledger directly from backend when creating task (Blind Count unchecked)**
✅ **Filter by Location ID (bin_code) and Carton ID**
✅ **List items immediately so users can see expected items before counting**

### **Backend Changes Required:**
✅ **Enhanced Stock Ledger API with `bin_location` and `carton_id` filters** (OR dedicated cycle count stock API)

### **Mobile App Changes Required:**
✅ **Fetch stock ledger from backend in task creation flow**
✅ **Show preview of expected items before task creation**
✅ **Add carton_id input field for carton-level counting**

### **Directed vs Ad-hoc:**
✅ **Directed Count**: No backend changes needed (tasks pre-created by desktop)
✅ **Ad-hoc Count**: Backend changes needed (enhanced stock ledger API)

---

**Status:** ✅ **Ready for Implementation**

**Next Steps:**
1. ✅ Backend team: Implement enhanced stock ledger API
2. ✅ Mobile team: Implement direct backend fetch in task creation
3. ✅ Testing: Verify end-to-end workflow
4. ✅ User acceptance: Test with real users
