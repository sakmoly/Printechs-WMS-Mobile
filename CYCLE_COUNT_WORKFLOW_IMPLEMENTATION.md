# Cycle Count Complete Workflow Implementation

This document describes the complete cycle count workflow implementation, ensuring all required API endpoints are called in the correct order.

## Workflow Overview

The cycle count workflow follows these steps:

1. **Start Task**: `POST /api/cycle-count/{title}/start`
2. **Submit Count Lines** (multiple times): `POST /api/cycle-count/{title}/count` with body `{ "lines": [...] }`
3. **Submit Task**: `POST /api/cycle-count/{title}/submit`
4. **Complete Task**: `POST /api/cycle-count/{title}/complete`

## Implementation Details

### 1. Start Task - `POST /api/cycle-count/{title}/start`

**Location**: `src/screens/CycleCountScanBinScreen.tsx`

**When Called**: 
- When a user starts a cycle count session by clicking "Start Count"
- Only called if a task title (`server_session_id`) exists in the session
- Called after the session is created/loaded in the database

**Implementation**:
```typescript
// After session is created/loaded
if (sessionData?.server_session_id) {
  const taskTitle = sessionData.server_session_id;
  const online = await isDeviceOnline();
  if (online) {
    await apiService.startCycleCount(taskTitle, {
      started_by: settings.user_id || settings.user_code || "USER-AUTO",
    });
  }
}
```

**Notes**:
- If device is offline, the start call will be made when syncing
- If no task title exists, the start call will be made when a backend task is found and synced

### 2. Submit Count Lines - `POST /api/cycle-count/{title}/count`

**Location**: `src/services/cycle-count-sync.service.ts`

**When Called**:
- Automatically when items are scanned (real-time sync if online)
- When quantity is edited
- When screen loses focus (navigation)
- During manual sync operations
- Multiple times as items are counted

**Implementation**:
```typescript
// In syncCycleCountSession function
await apiService.submitCycleCountCounts(title, {
  counted_by: countedBy,
  lines: linesToSync, // Array of count lines with item_code, counted_qty, etc.
});
```

**Request Body Format**:
```json
{
  "counted_by": "USER-001",
  "lines": [
    {
      "id": 1,
      "item_code": "SKU-HAT-301-BLU-OS",
      "barcode": "100000000001",
      "carton_id": "CTN-001", // Optional
      "actual_qty": 18,
      "counted_qty": 18,
      "bin_location": "BIN-A1-01",
      "expected_qty": 20,
      "discrepancy_reason": null
    }
  ]
}
```

**Notes**:
- Called multiple times during counting (not just once)
- Only sends items with `counted_qty > 0`
- Supports both bin-level and carton-level counting
- Works offline (queued for sync when online)

### 3. Submit Task - `POST /api/cycle-count/{title}/submit`

**Location**: `src/screens/CycleCountBinCountingScreen.tsx`

**When Called**:
- When user clicks "Submit Bin" button
- Only called after all counts have been synced
- Only called if a task title exists

**Implementation**:
```typescript
// In handleSubmitBinCount function
// First sync all counts
await syncCycleCountSession(sessionId);

// Then submit the task
if (taskTitle) {
  await apiService.submitCycleCount(taskTitle);
}
```

**Notes**:
- Called only once per cycle count session
- Ensures all count lines are synced before submission
- If submission fails, counts are still synced (non-blocking)

### 4. Complete Task - `POST /api/cycle-count/{title}/complete`

**Location**: `src/screens/CycleCountBinCountingScreen.tsx`

**When Called**:
- Immediately after successful task submission
- Only called if task submission succeeds
- Finalizes the cycle count task and updates stock

**Implementation**:
```typescript
// After successful submission
await apiService.submitCycleCount(taskTitle);

// Then complete the task
await apiService.completeCycleCount(taskTitle);
```

**Notes**:
- Called only once per cycle count session
- Finalizes the task and updates stock levels
- If completion fails, task is still submitted (non-blocking, may need manual completion)

## Complete Flow Example

### Scenario: User counts items in a bin

1. **User scans bin code** → Session created/loaded
   - If task title exists → `POST /api/cycle-count/{title}/start` ✅

2. **User scans items** (multiple times)
   - Each scan → `POST /api/cycle-count/{title}/count` with new counts ✅
   - Can be called multiple times as items are scanned

3. **User clicks "Submit Bin"**
   - Sync all counts → `POST /api/cycle-count/{title}/count` (final sync) ✅
   - Submit task → `POST /api/cycle-count/{title}/submit` ✅
   - Complete task → `POST /api/cycle-count/{title}/complete` ✅

## Error Handling

- **Offline Mode**: All API calls are queued and will be made when device comes online
- **Missing Task Title**: If no task title exists, calls are skipped and will be made when backend task is found
- **API Failures**: Non-blocking - errors are logged but don't prevent workflow continuation
- **Sync Retries**: Failed syncs are retried automatically when device comes online

## API Endpoints Summary

| Step | Endpoint | Method | When Called | Frequency |
|------|----------|--------|-------------|-----------|
| 1 | `/api/cycle-count/{title}/start` | POST | When starting count | Once per session |
| 2 | `/api/cycle-count/{title}/count` | POST | During counting | Multiple times |
| 3 | `/api/cycle-count/{title}/submit` | POST | When submitting | Once per session |
| 4 | `/api/cycle-count/{title}/complete` | POST | After submission | Once per session |

## Files Modified

1. **src/screens/CycleCountScanBinScreen.tsx**
   - Added `POST /api/cycle-count/{title}/start` call when starting count

2. **src/screens/CycleCountBinCountingScreen.tsx**
   - Added `POST /api/cycle-count/{title}/complete` call after submission
   - Added taskTitle loading from session

3. **src/services/cycle-count-sync.service.ts**
   - Already implements `POST /api/cycle-count/{title}/count` (no changes needed)

## Testing Checklist

- [x] Start task API is called when starting a count session
- [x] Count lines API is called multiple times during counting
- [x] Submit task API is called when submitting bin count
- [x] Complete task API is called after successful submission
- [x] All APIs work in offline mode (queued for sync)
- [x] Error handling doesn't block workflow
- [x] Task title is properly loaded and used

## Notes

- All API calls require a valid task title (`server_session_id`)
- If no task title exists, the workflow continues locally and APIs are called when task is found
- The count endpoint can be called multiple times with different line sets
- The complete endpoint finalizes the task and updates stock levels in the backend
