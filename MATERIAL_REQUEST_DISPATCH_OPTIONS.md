# Material Request Transfer Carton Dispatch - Implementation Options

## Current State

### Existing Dispatch Implementation
- **Location**: `src/screens/DispatchScreen.tsx`
- **API Endpoint**: `POST /api/transfer-cartons/dispatch`
- **Current Behavior**:
  - Only shows Transfer Cartons from ASN-based workflows (filters by `activeASN`)
  - Only displays "Sealed" status Transfer Cartons
  - Supports barcode scanning and double-tap to dispatch
  - Handles warehouse TCs differently (moves to Putaway instead of dispatching)

### API Service
- **Location**: `src/services/api.service.ts` (Line 1561)
- **Method**: `dispatchTransferCarton(data: { tc_id: string; dispatched_by?: string })`
- **Backend Endpoint**: `POST /api/transfer-cartons/dispatch`
- **Request Body**: 
  ```json
  {
    "tc_id": "TC-MR-123456-1767539596500",
    "dispatched_by": "USER-150526"
  }
  ```

---

## Implementation Options

### Option 1: Extend DispatchScreen to Support Material Requests ⭐ **RECOMMENDED**

**Pros:**
- Centralized dispatch functionality
- Reuses existing UI and logic
- Consistent user experience
- Single place to manage all dispatches

**Cons:**
- Requires filtering logic to show both ASN and MR TCs
- May need to handle different contexts (ASN vs MR)

**Implementation Steps:**

1. **Modify `loadTransferCartons()` in DispatchScreen.tsx**:
   ```typescript
   const loadTransferCartons = async () => {
     const allTCs: any[] = [];
     
     // Load ASN-based TCs (existing logic)
     if (activeASN) {
       const asnTCs = await dataService.getTransferCartons(activeASN);
       allTCs.push(...asnTCs);
     }
     
     // Load Material Request TCs (new logic)
     const db = await getDatabase();
     if (db) {
       const mrTCs = await db.getAllAsync<any>(`
         SELECT DISTINCT tc_id, status, store, updated_on, material_request
         FROM tc_cache
         WHERE material_request IS NOT NULL
           AND material_request != ''
           AND status = 'Sealed'
         ORDER BY updated_on DESC
       `);
       allTCs.push(...mrTCs);
     }
     
     // Filter to only Sealed TCs and remove duplicates
     const sealedTCs = allTCs.filter(tc => tc.status === 'Sealed');
     const uniqueTCs = Array.from(
       new Map(sealedTCs.map(tc => [tc.tc_id, tc])).values()
     );
     setTransferCartons(uniqueTCs);
   };
   ```

2. **Update UI to show TC type**:
   - Add indicator for ASN vs MR TCs
   - Show Material Request number if available

3. **No changes needed to `dispatchTC()` function** - it already works with any TC ID

---

### Option 2: Add Dispatch Button to MaterialRequestPackingScreen

**Pros:**
- Dispatch available immediately after sealing
- Context-aware (user is already working with MR)
- No navigation required

**Cons:**
- Duplicates dispatch logic
- Only works for current MR being viewed
- Can't see all MR TCs in one place

**Implementation Steps:**

1. **Add dispatch button after sealing**:
   ```typescript
   // In MaterialRequestPackingScreen.tsx
   const dispatchTransferCarton = async () => {
     if (!transferCarton) {
       Alert.alert("Error", "No Transfer Carton to dispatch");
       return;
     }
     
     // Check if TC is sealed
     if (!hasSealedTC) {
       Alert.alert("Error", "Transfer Carton must be sealed before dispatch");
       return;
     }
     
     try {
       const settings = await getSettings();
       await apiService.dispatchTransferCarton({
         tc_id: transferCarton,
         dispatched_by: settings.user_id,
       });
       
       Alert.alert("Success", `Transfer Carton ${transferCarton} dispatched`);
       // Refresh data
       await loadMaterialRequest();
     } catch (error: any) {
       Alert.alert("Error", error.message || "Failed to dispatch Transfer Carton");
     }
   };
   ```

2. **Add UI button**:
   - Show "Dispatch Transfer Carton" button after TC is sealed
   - Disable if already dispatched

---

### Option 3: Create Separate Material Request Dispatch Screen

**Pros:**
- Dedicated screen for MR dispatches
- Can show all MR TCs across all Material Requests
- Clean separation of concerns

**Cons:**
- More code to maintain
- Additional navigation step
- Duplicates dispatch logic

**Implementation Steps:**

1. **Create new screen**: `src/screens/MaterialRequestDispatchScreen.tsx`
2. **Similar structure to DispatchScreen** but:
   - Load TCs from `tc_cache` filtered by `material_request IS NOT NULL`
   - Show Material Request number in UI
   - Same dispatch logic

---

### Option 4: Add Dispatch to Material Request Detail Screen

**Pros:**
- Shows all TCs for a specific Material Request
- Context-aware
- Can dispatch multiple TCs for one MR

**Cons:**
- Requires navigation to Detail screen
- Only shows TCs for one MR at a time

**Implementation Steps:**

1. **In MaterialRequestDetailScreen.tsx**:
   - Add section showing sealed TCs for this MR
   - Add dispatch button for each sealed TC
   - Use same `dispatchTransferCarton` API call

---

## Recommended Approach: **Option 1** (Extend DispatchScreen)

### Why Option 1 is Best:
1. ✅ **Single Source of Truth**: All dispatches in one place
2. ✅ **Reuses Existing Code**: Minimal changes needed
3. ✅ **Better UX**: Users can see all dispatchable TCs (ASN + MR) together
4. ✅ **Maintainability**: One place to update dispatch logic
5. ✅ **Consistency**: Same workflow for all TC types

### Implementation Details for Option 1:

#### Step 1: Update `loadTransferCartons()` in DispatchScreen.tsx

```typescript
const loadTransferCartons = async () => {
  const allTCs: any[] = [];
  
  // Load ASN-based TCs (existing logic)
  if (activeASN) {
    const asnTCs = await dataService.getTransferCartons(activeASN);
    allTCs.push(...asnTCs);
  }
  
  // Load Material Request TCs (new logic)
  const db = await getDatabase();
  if (db) {
    try {
      const mrTCs = await db.getAllAsync<{
        tc_id: string;
        status: string;
        store: string | null;
        updated_on: string;
        material_request: string | null;
      }>(`
        SELECT DISTINCT 
          tc_id, 
          status, 
          store, 
          updated_on, 
          material_request
        FROM tc_cache
        WHERE material_request IS NOT NULL
          AND material_request != ''
          AND status = 'Sealed'
        ORDER BY updated_on DESC
      `);
      
      console.log(`📦 Found ${mrTCs.length} Material Request Transfer Cartons`);
      allTCs.push(...mrTCs);
    } catch (error: any) {
      console.warn(`⚠️ Error loading MR TCs:`, error.message);
    }
  }
  
  // Filter to only Sealed TCs and remove duplicates
  const sealedTCs = allTCs.filter(tc => 
    tc.status === 'Sealed' || tc.status === 'SEALED'
  );
  
  // Remove duplicates by creating a Map with tc_id as key
  const uniqueTCs = Array.from(
    new Map(sealedTCs.map(tc => [tc.tc_id, tc])).values()
  );
  
  setTransferCartons(uniqueTCs);
};
```

#### Step 2: Update UI to Show TC Type

```typescript
// In renderItem of FlatList
<View style={styles.tcItem}>
  <View style={styles.tcHeader}>
    <Text style={styles.tcId}>{item.tc_id}</Text>
    <StatusBadge status={item.status} />
  </View>
  
  {/* Show Material Request if available */}
  {item.material_request && (
    <Text style={styles.tcType}>
      📋 Material Request: {item.material_request}
    </Text>
  )}
  
  <Text style={styles.tcStore}>Store: {item.store}</Text>
  <Text style={styles.tcDate}>
    Updated: {new Date(item.updated_on).toLocaleString()}
  </Text>
  <Text style={styles.tapHint}>Double tap to dispatch</Text>
  {/* ... rest of UI ... */}
</View>
```

#### Step 3: No Changes Needed to `dispatchTC()`
- The existing function already works with any TC ID
- It calls `apiService.dispatchTransferCarton()` which works for both ASN and MR TCs

---

## Testing Checklist

After implementing Option 1:

- [ ] Material Request TCs appear in DispatchScreen
- [ ] ASN TCs still appear (backward compatibility)
- [ ] Can dispatch MR TC via barcode scan
- [ ] Can dispatch MR TC via double-tap
- [ ] Dispatch API is called with correct `tc_id` and `dispatched_by`
- [ ] Stock is reduced in backend after dispatch
- [ ] TC status updates to "Dispatched" after dispatch
- [ ] Dispatched TCs no longer appear in list
- [ ] Warehouse TCs are handled correctly (skip dispatch, go to Putaway)

---

## Alternative: Quick Implementation in MaterialRequestPackingScreen

If you want a quick solution while Option 1 is being implemented:

**Add dispatch button after sealing in MaterialRequestPackingScreen.tsx:**

```typescript
// After sealTransferCarton function
const dispatchTransferCarton = async () => {
  if (!transferCarton || !hasSealedTC) {
    Alert.alert("Error", "Transfer Carton must be sealed before dispatch");
    return;
  }
  
  Alert.alert(
    "Confirm Dispatch",
    `Dispatch Transfer Carton ${transferCarton}?\n\nThis will reduce stock in the backend.`,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Dispatch",
        onPress: async () => {
          try {
            const settings = await getSettings();
            await apiService.dispatchTransferCarton({
              tc_id: transferCarton,
              dispatched_by: settings.user_id,
            });
            
            Alert.alert("Success", `Transfer Carton ${transferCarton} dispatched`);
            await loadMaterialRequest(); // Refresh to show updated status
          } catch (error: any) {
            Alert.alert("Error", error.message || "Failed to dispatch Transfer Carton");
          }
        },
      },
    ]
  );
};

// In UI, add button after seal button:
{hasSealedTC && transferCarton && (
  <TouchableOpacity
    style={styles.dispatchButton}
    onPress={dispatchTransferCarton}
  >
    <Text style={styles.dispatchButtonText}>
      🚚 Dispatch Transfer Carton
    </Text>
  </TouchableOpacity>
)}
```

---

## Summary

**Best Approach**: **Option 1** - Extend DispatchScreen to support Material Request TCs

**Quick Solution**: Add dispatch button to MaterialRequestPackingScreen (can be done immediately)

**API is Ready**: The `dispatchTransferCarton` API method already exists and works for both ASN and MR TCs.

