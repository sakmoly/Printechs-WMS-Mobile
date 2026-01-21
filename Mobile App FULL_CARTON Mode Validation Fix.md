# Mobile App FULL_CARTON Mode Validation Fix

## Issue

The backend was rejecting `FULL_CARTON` mode relocations when users attempted to move items to a different carton ID, returning:

```
ERROR ❌ API error (400): {
  "code": "INVALID_MODE",
  "message": "FULL_CARTON mode is for bin relocation only. Use CARTON_TO_CARTON mode for carton-to-carton merge."
}
```

## Root Cause

`FULL_CARTON` mode is designed to move an **entire carton** from one bin location to another. The business rule requires:

- ✅ **Same carton ID** (from_carton === to_carton)
- ✅ **Different bin locations** (from_bin !== to_bin)

If a user tries to use `FULL_CARTON` mode with different carton IDs, it's actually a carton-to-carton merge operation, which requires `CARTON_TO_CARTON` mode instead.

## Solution

Added client-side validation to prevent this error before it reaches the backend, providing clear guidance to users.

## Implementation

### 1. Validation in RelocationScanToCartonScreen.tsx

**Location:** When user scans/enters the destination carton ID

**Validation Logic:**

```typescript
// Validation: FULL_CARTON mode requires same carton ID
if (
  mode === "FULL_CARTON" &&
  fromCarton &&
  normalizedCarton !== fromCarton.toUpperCase()
) {
  Alert.alert(
    "Invalid Carton ID",
    "FULL_CARTON mode is for moving a carton from one bin to another.\n\n" +
      "The destination carton ID must be the same as the source carton ID.\n\n" +
      "If you want to move items to a different carton, please use 'Carton → Carton' mode instead.",
    [
      { text: "Cancel", style: "cancel" },
      { text: "Use Same Carton", onPress: () => handleKeepSameCarton() },
    ]
  );
  return;
}
```

**User Experience:**

- Shows clear error message explaining the rule
- Offers "Use Same Carton" button to automatically correct the carton ID
- Provides guidance to use "Carton → Carton" mode if different carton is intended

### 2. Backup Validation in RelocationExecuteScreen.tsx

**Location:** Before committing the relocation

**Validation Logic:**

```typescript
// Validation: Check if FULL_CARTON mode is being used for carton-to-carton merge
if (
  mode === "FULL_CARTON" &&
  fromCarton &&
  toCarton &&
  fromCarton !== toCarton
) {
  Alert.alert(
    "Invalid Mode",
    "FULL_CARTON mode is for moving a carton from one bin to another (same carton ID).\n\n" +
      "You are trying to move items from one carton to a different carton, which requires CARTON_TO_CARTON mode.\n\n" +
      "Please start a new relocation session and select 'Carton → Carton' mode.",
    [{ text: "OK" }]
  );
  return;
}
```

**Error Handling:**

```typescript
try {
  await apiService.commitRelocationFull(sessionId, lines);
} catch (error: any) {
  // Check if it's the INVALID_MODE error
  if (
    error.message?.includes("INVALID_MODE") ||
    error.message?.includes("FULL_CARTON mode is for bin relocation only")
  ) {
    Alert.alert(
      "Invalid Mode",
      "FULL_CARTON mode can only be used to move a carton from one bin to another (same carton ID).\n\n" +
        "For carton-to-carton operations, please use CARTON_TO_CARTON mode.",
      [{ text: "OK" }]
    );
  } else {
    console.warn(
      "⚠️ Backend commit-relocation-full API not available, using events"
    );
  }
}
```

## Business Rules Summary

### FULL_CARTON Mode

- **Purpose:** Move entire carton from one bin to another
- **Requirements:**
  - ✅ Same carton ID (from_carton === to_carton)
  - ✅ Different bin locations (from_bin !== to_bin)
- **Use Case:** Relocating a complete carton to a new storage location

### PARTIAL_ITEMS Mode

- **Purpose:** Move specific items from a carton to a bin
- **Requirements:**
  - ✅ Can move partial quantities
  - ✅ Items go to a bin (to_carton is null or same as from_carton)
- **Use Case:** Picking specific items from a carton

### CARTON_TO_CARTON Mode

- **Purpose:** Move items from one carton to another carton
- **Requirements:**
  - ✅ Different carton IDs (from_carton !== to_carton)
  - ✅ Used for merging/splitting cartons
- **Use Case:** Consolidating items from multiple cartons or splitting a carton

## User Flow

### Correct Flow for FULL_CARTON:

1. User selects "Move Full Carton" mode
2. Scans FROM bin location
3. Scans FROM carton ID (e.g., "CTN-123")
4. Scans TO bin location
5. **Either:**
   - Taps "Keep Same Carton" button (recommended)
   - Scans the **same** carton ID (e.g., "CTN-123")
6. Completes relocation

### Incorrect Flow (Now Prevented):

1. User selects "Move Full Carton" mode
2. Scans FROM bin location
3. Scans FROM carton ID (e.g., "CTN-123")
4. Scans TO bin location
5. ❌ Scans **different** carton ID (e.g., "CTN-456")
6. **Validation triggers:** Shows error dialog
7. User can:
   - Tap "Use Same Carton" to correct
   - Or cancel and start new session with "Carton → Carton" mode

## Files Modified

1. **src/screens/RelocationScanToCartonScreen.tsx**

   - Added validation before navigating to Execute screen
   - Shows user-friendly error dialog with correction options

2. **src/screens/RelocationExecuteScreen.tsx**

   - Added backup validation before committing
   - Added error handling for backend INVALID_MODE response

3. **BACKEND_RELOCATION_DATABASE_SCHEMA.md**
   - Added business rules section explaining the three modes
   - Documented validation requirements

## Testing

### Test Case 1: Valid FULL_CARTON Relocation

1. Start relocation with "Move Full Carton" mode
2. Scan FROM bin: "A1-R02-L1-B2"
3. Scan FROM carton: "CTN-123"
4. Scan TO bin: "A1-R02-L1-B3"
5. Tap "Keep Same Carton" or scan "CTN-123"
6. ✅ Should proceed to Execute screen without errors

### Test Case 2: Invalid FULL_CARTON (Different Carton)

1. Start relocation with "Move Full Carton" mode
2. Scan FROM bin: "A1-R02-L1-B2"
3. Scan FROM carton: "CTN-123"
4. Scan TO bin: "A1-R02-L1-B3"
5. Scan different carton: "CTN-456"
6. ✅ Should show "Invalid Carton ID" dialog
7. Tap "Use Same Carton"
8. ✅ Should proceed with CTN-123 as destination

### Test Case 3: Carton-to-Carton Merge

1. Start relocation with "Carton → Carton" mode
2. Scan FROM bin: "A1-R02-L1-B2"
3. Scan FROM carton: "CTN-123"
4. Scan TO bin: "A1-R02-L1-B3"
5. Scan different carton: "CTN-456"
6. ✅ Should proceed without validation errors

## Benefits

1. **Prevents Backend Errors:** Catches invalid mode usage before API call
2. **Better UX:** Clear error messages guide users to correct action
3. **Reduces Confusion:** Explains business rules directly in the UI
4. **Faster Workflow:** "Use Same Carton" button provides quick correction
5. **Consistent Validation:** Both client-side and server-side validation

## Related Issues

- Backend API Error: `INVALID_MODE` - FULL_CARTON mode validation
- Backend API Error: `DATABASE_ERROR` - movedItems/cartonItems not defined
- See: `BACKEND_RELOCATION_DATABASE_SCHEMA.md` for backend requirements
