# Material Request Workflow Redesign - Analysis & Requirements

## Current Flow vs. Proposed Flow

### Current Flow
1. Material Request has status: `Draft`, `In Progress`, `Submitted`, `Picked`, `Dispatched`
2. User clicks "Start Picking" → Navigates to packing screen
3. User scans items in packing screen
4. User clicks "Submit" on Detail screen → Creates Transfer Carton, changes status to "Submitted"
5. Transfer Carton can be sealed/dispatched separately

### Proposed New Flow

#### Status Progression:
```
Draft → In Progress → Picked → (TC Created) → (TC Sealed) → Dispatched
```

#### Button Flow:
1. **"Start Picking"** (Status: Draft/Submitted)
   - Click → Status changes to "In Progress"
   - Button renames to "In Picking" or "Picking Progress"

2. **"In Picking" / "Picking Progress"** (Status: In Progress)
   - User continues picking items
   - When all items are picked → Button renames to "Complete Picking"

3. **"Complete Picking"** (Status: In Progress, All items picked)
   - Click → Status changes to "Picked"
   - Button renames to "Create Transfer Carton"

4. **"Create Transfer Carton"** (Status: Picked)
   - Click → Creates Transfer Carton
   - Shows TC ID on screen
   - Button renames to "Seal Transfer Carton"

5. **"Seal Transfer Carton"** (Status: Picked, TC exists)
   - Click → Seals Transfer Carton (updates TC status to "Sealed")
   - Button may rename to "Dispatch" or remain as "Seal Transfer Carton"

6. **No separate Transfer Carton button** - Everything flows through one button

---

## Frontend Changes Required

### 1. MaterialRequestDetailScreen.tsx

#### Button State Logic:
```typescript
const getButtonState = () => {
  const status = materialRequest?.status;
  const totalRequested = totalRequestedQty;
  const totalPicked = totalPickedQty;
  const allItemsPicked = totalPicked >= totalRequested && totalRequested > 0;
  const hasTC = transferCarton !== null;
  const tcStatus = transferCartonStatus; // "Created", "Sealed", "Dispatched"
  
  if (status === "Draft" || status === "Submitted") {
    return { text: "Start Picking", action: "startPicking" };
  }
  
  if (status === "In Progress") {
    if (allItemsPicked) {
      return { text: "Complete Picking", action: "completePicking" };
    }
    return { text: "In Picking", action: null }; // Disabled, just shows status
  }
  
  if (status === "Picked") {
    if (!hasTC) {
      return { text: "Create Transfer Carton", action: "createTC" };
    }
    if (tcStatus === "Created" || tcStatus === "Open") {
      return { text: "Seal Transfer Carton", action: "sealTC" };
    }
    if (tcStatus === "Sealed") {
      return { text: "Dispatch", action: "dispatchTC" }; // Optional
    }
  }
  
  return { text: null, action: null }; // No button shown
};
```

#### New Functions Needed:

1. **handleStartPicking()** - Update status to "In Progress"
   ```typescript
   const handleStartPicking = async () => {
     try {
       await apiService.updateMaterialRequestStatus(
         materialRequest.title,
         "In Progress"
       );
       await loadMaterialRequest();
     } catch (error) {
       Alert.alert("Error", "Failed to start picking");
     }
   };
   ```

2. **handleCompletePicking()** - Update status to "Picked"
   ```typescript
   const handleCompletePicking = async () => {
     // Validate all items are picked
     if (totalPickedQty < totalRequestedQty) {
       Alert.alert(
         "Incomplete Picking",
         "Please pick all items before completing."
       );
       return;
     }
     
     try {
       await apiService.updateMaterialRequestStatus(
         materialRequest.title,
         "Picked"
       );
       await loadMaterialRequest();
     } catch (error) {
       Alert.alert("Error", "Failed to complete picking");
     }
   };
   ```

3. **handleCreateTransferCarton()** - Create TC and show TC ID
   ```typescript
   const handleCreateTransferCarton = async () => {
     try {
       const tcId = await apiService.createTransferCarton({
         to_no: materialRequest.title,
         material_request: materialRequest.title,
         store: materialRequest.to_showroom,
         // ... other fields
       });
       
       // Add items to TC
       await apiService.addItemsToTransferCarton(tcId, {
         items: materialRequest.items
           .filter(item => item.picked_qty > 0)
           .map(item => ({
             item_code: item.item_code,
             qty: item.picked_qty
           }))
       });
       
       setTransferCarton(tcId);
       await loadMaterialRequest();
       
       Alert.alert("Success", `Transfer Carton ${tcId} created successfully`);
     } catch (error) {
       Alert.alert("Error", "Failed to create Transfer Carton");
     }
   };
   ```

4. **handleSealTransferCarton()** - Seal the TC
   ```typescript
   const handleSealTransferCarton = async () => {
     if (!transferCarton) return;
     
     try {
       await apiService.sealTransferCarton(transferCarton);
       await loadMaterialRequest();
       Alert.alert("Success", "Transfer Carton sealed successfully");
     } catch (error) {
       Alert.alert("Error", "Failed to seal Transfer Carton");
     }
   };
   ```

#### UI Changes:
- Remove separate "Submit" button
- Remove separate Transfer Carton creation button
- Single dynamic button that changes based on state
- Display TC ID when TC is created (below button or in status area)

---

## Backend Changes Required

### 1. Status Update API Enhancement

**Endpoint:** `POST /api/material-requests/{title}/update-status` or `/status`

**Required Status Transitions:**
- `Draft` → `In Progress` ✅ (Allowed)
- `Submitted` → `In Progress` ✅ (Allowed)
- `In Progress` → `Picked` ✅ (Allowed, but validate all items are picked)
- `Picked` → `Dispatched` ✅ (Allowed, but requires TC to be sealed)

**Validation Rules:**
```sql
-- When updating to "Picked":
-- 1. Check that all items have picked_qty >= requested_qty
SELECT 
  COUNT(*) as incomplete_items
FROM material_request_items
WHERE material_request_title = ?
  AND (picked_qty IS NULL OR picked_qty < requested_qty);

-- If incomplete_items > 0, reject the status update
```

### 2. Multi-User Picking Support

#### Current Issue:
- Multiple users can pick the same Material Request simultaneously
- Need to merge `picked_qty` from multiple users
- Need to track who picked what

#### Backend Requirements:

**A. Incremental Picking API (Already exists):**
```
POST /api/material-requests/{title}/pick-items
```

**Request Body:**
```json
{
  "items": [
    {
      "item_code": "SKU-001",
      "picked_qty": 2,  // Incremental: adds 2 to existing picked_qty
      "source_bin": "A1-R02-L1-B2",
      "carton_id": "PAW-ASN-123",
      "user_id": "USER-150526"
    }
  ],
  "warehouse": "WH-MAIN"
}
```

**Backend Logic:**
```sql
-- Incremental update (SUM, not REPLACE)
UPDATE material_request_items
SET picked_qty = COALESCE(picked_qty, 0) + ?
WHERE material_request_title = ? AND item_code = ?;

-- Track picking history (optional but recommended)
INSERT INTO material_request_picking_history (
  material_request_title,
  item_code,
  picked_qty,
  user_id,
  picked_at,
  source_bin,
  carton_id
) VALUES (?, ?, ?, ?, NOW(), ?, ?);
```

**B. Real-time Sync (Recommended):**
- Use SignalR/WebSockets to push updates to all connected clients
- When User A picks an item, User B's screen updates automatically
- Fallback to polling every 5-10 seconds if WebSockets unavailable

**C. Conflict Resolution:**
- Last write wins (simple)
- Or: Merge quantities (SUM all picks from all users)
- Backend should handle concurrent updates atomically

**D. Picking History Table (Optional but Recommended):**
```sql
CREATE TABLE material_request_picking_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_request_title TEXT NOT NULL,
  item_code TEXT NOT NULL,
  picked_qty REAL NOT NULL,
  user_id TEXT NOT NULL,
  picked_at DATETIME NOT NULL,
  source_bin TEXT,
  carton_id TEXT,
  device_id TEXT,
  FOREIGN KEY (material_request_title, item_code) 
    REFERENCES material_request_items(material_request_title, item_code)
);
```

### 3. Transfer Carton Creation API

**Endpoint:** `POST /api/transfer-cartons/create`

**Request Body:**
```json
{
  "tc_id": "TC-MR-123459-{timestamp}",
  "to_no": "MR-123459",
  "material_request": "MR-123459",
  "store": "STORE-002",
  "user_id": "USER-150526",
  "created_by": "USER-150526"
}
```

**Response:**
```json
{
  "tc_id": "TC-MR-123459-1768157787512",
  "status": "Created",
  "message": "Transfer Carton created successfully"
}
```

### 4. Transfer Carton Sealing API

**Endpoint:** `POST /api/transfer-cartons/{tc_id}/seal`

**Request Body:**
```json
{
  "sealed_by": "USER-150526",
  "sealed_at": "2026-01-12T10:30:00Z"
}
```

**Backend Logic:**
```sql
-- Update TC status
UPDATE transfer_cartons
SET status = 'Sealed',
    sealed_by = ?,
    sealed_at = NOW()
WHERE tc_id = ?;

-- Validate all items are added (optional)
-- Check that TC has items
```

**Response:**
```json
{
  "tc_id": "TC-MR-123459-1768157787512",
  "status": "Sealed",
  "message": "Transfer Carton sealed successfully"
}
```

### 5. Get Transfer Carton Status API

**Endpoint:** `GET /api/transfer-cartons/{tc_id}`

**Response:**
```json
{
  "tc_id": "TC-MR-123459-1768157787512",
  "status": "Sealed",
  "to_no": "MR-123459",
  "material_request": "MR-123459",
  "store": "STORE-002",
  "created_at": "2026-01-12T10:00:00Z",
  "sealed_at": "2026-01-12T10:30:00Z",
  "items": [
    {
      "item_code": "SKU-001",
      "qty": 10
    }
  ]
}
```

---

## Multi-User Picking Implementation Strategy

### Option 1: Real-time Sync (Recommended)
- **SignalR/WebSockets**: Push updates to all clients when picking occurs
- **Polling Fallback**: Poll every 5-10 seconds if WebSockets unavailable
- **Mobile App**: Listen for updates and refresh UI automatically

### Option 2: Polling Only
- **Mobile App**: Poll Material Request API every 5-10 seconds
- **Backend**: Return latest `picked_qty` from all users
- **Simple but less efficient**

### Option 3: Event-Based (Current)
- **Mobile App**: Sends events via `/api/events/batch`
- **Backend**: Processes events and updates `picked_qty`
- **Mobile App**: Polls to get updated quantities
- **Works but requires polling**

### Recommended: Hybrid Approach
1. **Immediate Update**: Use `POST /api/material-requests/{title}/pick-items` for real-time updates
2. **Background Sync**: Use `/api/events/batch` for offline support
3. **Real-time Push**: Use SignalR/WebSockets if available (future enhancement)
4. **Polling Fallback**: Poll every 5-10 seconds to ensure consistency

---

## Database Schema Changes (Backend)

### 1. Material Request Items Table
```sql
-- Ensure picked_qty is properly tracked
ALTER TABLE material_request_items
ADD COLUMN picked_qty REAL DEFAULT 0;

-- Add index for faster queries
CREATE INDEX idx_mr_items_picked 
ON material_request_items(material_request_title, item_code);
```

### 2. Picking History Table (Optional)
```sql
CREATE TABLE material_request_picking_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_request_title TEXT NOT NULL,
  item_code TEXT NOT NULL,
  picked_qty REAL NOT NULL,
  user_id TEXT NOT NULL,
  picked_at DATETIME NOT NULL,
  source_bin TEXT,
  carton_id TEXT,
  device_id TEXT,
  INDEX idx_mr_picking_history (material_request_title, item_code)
);
```

### 3. Transfer Cartons Table
```sql
-- Ensure status field exists
ALTER TABLE transfer_cartons
ADD COLUMN status TEXT DEFAULT 'Created';

-- Add sealed_by and sealed_at
ALTER TABLE transfer_cartons
ADD COLUMN sealed_by TEXT,
ADD COLUMN sealed_at DATETIME;

-- Add index
CREATE INDEX idx_tc_material_request 
ON transfer_cartons(material_request);
```

---

## Testing Checklist

### Frontend Testing:
- [ ] Button text changes correctly based on status
- [ ] "Start Picking" updates status to "In Progress"
- [ ] Button shows "In Picking" when status is "In Progress"
- [ ] Button shows "Complete Picking" when all items are picked
- [ ] "Complete Picking" updates status to "Picked"
- [ ] Button shows "Create Transfer Carton" when status is "Picked"
- [ ] "Create Transfer Carton" creates TC and shows TC ID
- [ ] Button shows "Seal Transfer Carton" after TC creation
- [ ] "Seal Transfer Carton" seals the TC
- [ ] TC ID is displayed on screen after creation
- [ ] No separate Transfer Carton button exists

### Backend Testing:
- [ ] Status transitions work correctly
- [ ] "In Progress" → "Picked" validates all items are picked
- [ ] Multi-user picking merges quantities correctly
- [ ] Transfer Carton creation works
- [ ] Transfer Carton sealing works
- [ ] TC status is returned correctly
- [ ] Picking history is tracked (if implemented)

### Multi-User Testing:
- [ ] User A picks item → User B sees updated quantity
- [ ] User A and User B pick same item → Quantities are merged
- [ ] User A completes picking → User B sees status change
- [ ] User A creates TC → User B sees TC ID
- [ ] User A seals TC → User B sees TC is sealed

---

## Implementation Priority

### Phase 1: Core Workflow (High Priority)
1. ✅ Button state logic
2. ✅ Status update API calls
3. ✅ Transfer Carton creation
4. ✅ Transfer Carton sealing
5. ✅ UI button renaming

### Phase 2: Multi-User Support (Medium Priority)
1. ✅ Incremental picking API (already exists)
2. ⚠️ Polling mechanism for real-time updates
3. ⚠️ Conflict resolution
4. ⚠️ Picking history (optional)

### Phase 3: Enhancements (Low Priority)
1. ⚠️ SignalR/WebSockets for real-time push
2. ⚠️ Picking history UI
3. ⚠️ User assignment/tracking

---

## Summary

### Frontend Changes:
- ✅ Single dynamic button that changes based on workflow state
- ✅ Remove separate "Submit" and Transfer Carton buttons
- ✅ Add functions: `handleStartPicking`, `handleCompletePicking`, `handleCreateTransferCarton`, `handleSealTransferCarton`
- ✅ Display TC ID when created
- ✅ Polling mechanism for multi-user sync

### Backend Changes:
- ✅ Status update API with validation
- ✅ Transfer Carton creation API
- ✅ Transfer Carton sealing API
- ✅ Get Transfer Carton status API
- ✅ Multi-user picking support (incremental updates)
- ✅ Picking history tracking (optional)
- ✅ Real-time sync mechanism (SignalR/WebSockets or polling)

### Key Points:
1. **Status Flow**: Draft → In Progress → Picked → (TC Created) → (TC Sealed) → Dispatched
2. **Button Flow**: Start Picking → In Picking → Complete Picking → Create Transfer Carton → Seal Transfer Carton
3. **Multi-User**: Backend must merge `picked_qty` from multiple users using SUM
4. **Real-time**: Polling or WebSockets to sync updates across users
5. **Validation**: Backend must validate all items are picked before allowing "Picked" status
