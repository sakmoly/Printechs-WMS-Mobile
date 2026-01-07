# Transfer In Putaway Implementation Status

## ✅ Implemented

### API Endpoints (in `src/services/api.service.ts`)

1. **`getPutawayTasks`** - ✅ Enhanced
   - Supports filtering by `source_type`, `transfer_in`, `status`, `warehouse`
   - Can filter Transfer In putaway tasks: `getPutawayTasks({ source_type: "TransferIn" })`

2. **`getPutawayTask`** - ✅ Added
   - `GET /api/putaway/tasks/:title`
   - Get details of a specific putaway task

3. **`scanTransferCarton`** - ✅ Added
   - `POST /api/putaway/scan-transfer-carton`
   - Assign items/cartons to rack/bin locations
   - Supports:
     - `box_id` (carton ID)
     - `putaway_task` (task title)
     - `rack` + `bin` OR `location_id`
     - `user_id`

4. **`completePutaway`** - ✅ Added
   - `POST /api/putaway/complete`
   - Complete putaway task and update stock ledger
   - Requires: `putaway_task`, `completed_by`

### Transfer In Receiving
- ✅ `receiveTransferInLine` - Receives items (cartonized or loose)
- ✅ Events are queued for syncing
- ✅ Auto-creates putaway task (handled by backend when all items received)

---

## ⚠️ Partially Implemented / Needs Enhancement

### PutAwayScreen (`src/screens/PutAwayScreen.tsx`)

**Current State:**
- Designed for ASN-based putaway using Transfer Cartons
- Loads putaway tasks but filters by ASN
- Uses `advance_shipping_notice` filter (ASN-specific)

**Needs Enhancement:**
1. **Add Transfer In Putaway Task Support**
   - Filter putaway tasks by `source_type="TransferIn"`
   - Display Transfer In number instead of ASN
   - Handle `transfer_in` field instead of `asn_no`

2. **Update Task Loading Logic**
   - Currently: `getPutawayTasks({ status: "Open", advance_shipping_notice: activeASN })`
   - Should also support: `getPutawayTasks({ source_type: "TransferIn", status: "Draft,In Progress" })`

3. **Update Task Display**
   - Show "Transfer In: INSLIP-0001" instead of "ASN: ASN-00045"
   - Handle different data structure for Transfer In tasks

4. **Scanning Logic**
   - Currently scans Transfer Carton IDs (TC-xxx)
   - For Transfer In: Should scan `carton_id` (CTN-TI-xxx) or `item_code`
   - Use `scanTransferCarton` API with `box_id` or `putaway_task`

---

## 📋 Required Changes

### 1. Update PutAwayScreen to Support Transfer In Tasks

**File:** `src/screens/PutAwayScreen.tsx`

**Changes Needed:**

#### A. Add Transfer In Task Filtering
```typescript
// In loadSealedTCs or similar function
const loadTransferInPutawayTasks = async () => {
  try {
    const response = await apiService.getPutawayTasks({
      source_type: "TransferIn",
      status: "Draft,In Progress"
    });
    // Process and display Transfer In putaway tasks
  } catch (error) {
    // Handle error
  }
};
```

#### B. Update Task Display
- Show Transfer In number: `task.transfer_in` instead of `task.advance_shipping_notice`
- Display source type badge: "Transfer In" vs "ASN"

#### C. Update Scanning Logic
- For Transfer In tasks, scan `carton_id` or `item_code`
- Call `apiService.scanTransferCarton` with appropriate data:
  ```typescript
  await apiService.scanTransferCarton({
    putaway_task: putawayTaskTitle,
    box_id: cartonId, // or item_code for loose items
    rack: rack,
    bin: bin,
    // OR
    location_id: locationId,
    user_id: settings.user_id
  });
  ```

#### D. Update Completion Logic
- Already uses `apiService.completePutaway` ✅
- Just needs to work with Transfer In putaway tasks

---

## 🎯 Implementation Options

### Option 1: Extend Existing PutAwayScreen (Recommended)
- Add a filter/tab to switch between "ASN Putaway" and "Transfer In Putaway"
- Reuse existing scanning and completion logic
- Minimal code duplication

### Option 2: Create Separate Screen
- Create `TransferInPutawayScreen.tsx`
- Dedicated UI for Transfer In putaway workflow
- More separation but more code to maintain

**Recommendation:** Option 1 - Extend PutAwayScreen with a source type filter

---

## 📝 Example Implementation

### Add to PutAwayScreen:

```typescript
// Add state for source type filter
const [putawaySourceType, setPutawaySourceType] = useState<"ASN" | "TransferIn" | "All">("All");

// Update loadSealedTCs to handle Transfer In tasks
const loadPutawayTasks = async () => {
  if (putawaySourceType === "TransferIn" || putawaySourceType === "All") {
    // Load Transfer In putaway tasks
    const tiTasks = await apiService.getPutawayTasks({
      source_type: "TransferIn",
      status: "Draft,In Progress"
    });
    // Process and add to list
  }
  
  if (putawaySourceType === "ASN" || putawaySourceType === "All") {
    // Existing ASN logic
  }
};

// Update scanning to handle Transfer In cartons
const handleScanForPutaway = async (scannedValue: string) => {
  if (currentTask?.source_type === "TransferIn") {
    // For Transfer In: scannedValue could be carton_id or item_code
    await apiService.scanTransferCarton({
      putaway_task: currentTask.title,
      box_id: scannedValue, // or item_code
      rack: selectedRack,
      bin: selectedBin,
      user_id: settings.user_id
    });
  } else {
    // Existing ASN logic
  }
};
```

---

## ✅ Testing Checklist

- [ ] Can list Transfer In putaway tasks
- [ ] Can view Transfer In putaway task details
- [ ] Can scan carton_id for Transfer In putaway
- [ ] Can scan item_code for loose items
- [ ] Can assign rack/bin location
- [ ] Can complete Transfer In putaway
- [ ] Stock ledger updates correctly
- [ ] Events are queued for offline support

---

## 🔗 Related Files

- `src/services/api.service.ts` - API endpoints ✅
- `src/screens/PutAwayScreen.tsx` - Needs enhancement ⚠️
- `src/screens/TransferInReceivingScreen.tsx` - Receiving ✅
- `src/screens/TransferInListScreen.tsx` - List ✅
- `src/screens/TransferInDetailScreen.tsx` - Details ✅

---

**Status:** API endpoints ready ✅ | UI needs enhancement ⚠️  
**Last Updated:** 2026-01-05

