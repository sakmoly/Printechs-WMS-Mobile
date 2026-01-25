# Putaway List - Exclude Completed Tasks

## Objective

Exclude Completed putaway tasks from the Putaway List screen in the React Native Mobile App.
Only active putaway tasks (Open / In Progress) should be shown to the user.

## Current Problem

The Putaway List screen currently displays putaway boxes regardless of completion state.
This causes:

- Closed / Completed putaway boxes to still appear
- User confusion during scanning and selection
- **ASN putaway boxes showing after completion** (while Transfer In correctly hides them)

## Expected Behavior

Completed putaway tasks must NOT appear in:

- **All tab** - Should only show Open/In Progress tasks
- **ASN tab** - Should only show Open/In Progress ASN putaway tasks
- **Transfer In tab** - Should only show Open/In Progress Transfer In putaway tasks

Only Open / Pending / In Progress tasks should be visible.

## Analysis: Why Transfer In Works But ASN Doesn't

### Transfer In Putaway (Working Correctly)

**API Request:**
```typescript
status: "Draft,Open,In Progress"  // ✅ Includes Open status
```

**Filter Function (Line ~832):**
```typescript
// ✅ CRITICAL: Explicitly exclude Completed tasks
const isCompleted = taskStatus === "COMPLETED";
if (isCompleted) {
  return false;
}
// Only include Draft, Open, or In Progress
const isDraftOpenOrInProgress = taskStatus === "DRAFT" || taskStatus === "OPEN" || taskStatus === "IN PROGRESS";
return isDraftOpenOrInProgress && (hasTransferIn || isTransferInSource);
```

**Task Conversion Loop (Line ~972):**
```typescript
// ✅ CRITICAL: Explicitly exclude Completed tasks
const isCompleted = taskStatus === "COMPLETED";
if (isCompleted) {
  console.warn(`⚠️ Skipped Transfer In putaway task ${taskId} - status is "Completed"`);
  continue;
}
// Only include Draft, Open, or In Progress
if (!isDraft && !isOpen && !isInProgress) {
  continue;
}
```

**Result:** Transfer In has **TWO layers** of completed filtering:
1. In the filter function
2. In the task conversion loop

### ASN Putaway (Previously Broken)

**API Request (Before Fix):**
```typescript
status: "Draft,In Progress"  // ❌ Missing "Open" status
```

**Filter Function (Line ~257):**
```typescript
// ✅ Had completed check
const isCompleted = taskStatus === "COMPLETED";
if (isCompleted) {
  return false;
}
// ❌ But didn't check for Draft/Open/In Progress status
return hasASN || isASNSource;
```

**Task Conversion Loop (Line ~377):**
```typescript
// ❌ Only checked for "OPEN" status, not Draft or In Progress
if (taskStatus !== "OPEN") {
  continue;
}
// ❌ No explicit completed check
```

**Result:** ASN had **incomplete filtering**:
1. Filter function excluded completed but didn't check status
2. Task conversion only allowed "OPEN" (not Draft/In Progress)
3. No explicit completed check in conversion loop

## Implementation Fixes

### 1. Updated ASN API Request

**Location:** `src/screens/PutAwayScreen.tsx` (Line ~203, ~242)

**Before:**
```typescript
status: "Draft,In Progress"
```

**After:**
```typescript
status: "Draft,Open,In Progress"  // ✅ Include Open status (same as Transfer In)
```

### 2. Enhanced ASN Filter Function

**Location:** `src/screens/PutAwayScreen.tsx` (Line ~257)

**Added:**
```typescript
// ✅ Include only Draft, Open, or In Progress status (same as Transfer In)
const isDraftOpenOrInProgress = taskStatus === "DRAFT" || taskStatus === "OPEN" || taskStatus === "IN PROGRESS" || taskStatus === "INPROGRESS";
if (!isDraftOpenOrInProgress) {
  return false;
}
```

### 3. Enhanced ASN Task Conversion Loop

**Location:** `src/screens/PutAwayScreen.tsx` (Line ~377)

**Before:**
```typescript
if (taskStatus !== "OPEN") {
  continue;
}
```

**After:**
```typescript
// ✅ CRITICAL: Explicitly exclude Completed tasks (same as Transfer In)
const isCompleted = taskStatus === "COMPLETED";
if (isCompleted) {
  console.warn(`⚠️ PutAwayScreen: Skipped ASN putaway task ${taskId} - status is "Completed"`);
  continue;
}

const isDraft = taskStatus === "DRAFT";
const isOpen = taskStatus === "OPEN";
const isInProgress = taskStatus === "IN PROGRESS" || taskStatus === "INPROGRESS";

if (!isDraft && !isOpen && !isInProgress) {
  console.warn(`⚠️ PutAwayScreen: Skipped ASN putaway task ${taskId} - status is "${task.status}" (expected "Draft", "Open", or "In Progress")`);
  continue;
}
```

### 4. Additional Filtering Layers (Already Implemented)

- **SQL Query Filter:** Case-insensitive `UPPER(status) != "COMPLETED"`
- **TC Status Check:** Case-insensitive check for completed TCs
- **Completed Tasks API Fetch:** Fetches completed tasks to build exclusion set
- **Location Assignment Check:** Filters boxes with assigned locations
- **PUTAWAY_TO_RACK Events Check:** Filters boxes with completed putaway events

## Summary of Changes

ASN putaway now matches Transfer In putaway filtering:

1. ✅ API requests include "Open" status
2. ✅ Filter functions explicitly exclude completed and check status
3. ✅ Task conversion loops explicitly exclude completed
4. ✅ Both accept Draft, Open, and In Progress statuses
5. ✅ Multiple layers of filtering for redundancy

## Testing Checklist

- [ ] Completed ASN putaway boxes do NOT appear in "All" tab
- [ ] Completed ASN putaway boxes do NOT appear in "ASN" tab  
- [ ] Completed Transfer In boxes do NOT appear in "Transfer In" tab
- [ ] Only Open/In Progress/Draft tasks are visible
- [ ] Boxes with assigned locations are filtered out
- [ ] Boxes with PUTAWAY_TO_RACK events are filtered out
- [ ] Case-insensitive status matching works (Completed, COMPLETED, completed)
- [ ] ASN and Transfer In behave consistently

## Related Files

- `src/screens/PutAwayScreen.tsx` - Main implementation file
- `src/services/api.service.ts` - API service for putaway tasks
