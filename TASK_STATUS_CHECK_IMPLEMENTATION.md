# Task Status Check Implementation

## Issue
The backend was returning an error when trying to start a task that's already in "In Progress" status:
```
ERROR ❌ API error (400): {"code":"INVALID_STATUS","message":"Cannot start Cycle Count Task. Current status: In Progress"}
```

## Solution
Implemented status check before attempting to start the task. The task is only started if it's in "Draft" or "Pending" status. If already "In Progress" or "Started", the start API call is skipped.

## Implementation

### Helper Function: `ensureTaskStarted`
Created a helper function that:
1. **Checks task status first** via `GET /api/cycle-count/{title}`
2. **Only starts if status is "Draft" or "Pending"** - calls `POST /api/cycle-count/{title}/start`
3. **Skips starting if already "In Progress"** - logs a message and continues
4. **Handles errors gracefully** - catches "already started" errors and treats them as success

### Code Flow

#### When Carton ID is Scanned (`handleCartonIdScan`)
1. User scans/enters carton ID
2. `ensureTaskStarted(taskTitle)` is called
3. Status is checked - if "Draft", task is started; if "In Progress", skipped
4. Expected items are loaded
5. User can scan items (task is already in correct status)

#### When Screen Loads with Existing Carton ID (`useFocusEffect`)
1. Carton ID is restored from database (if exists)
2. `ensureTaskStarted(loadedTaskTitle)` is called
3. Status is checked - if "Draft", task is started; if "In Progress", skipped
4. Expected items are loaded
5. User can continue counting

### Status Handling

| Current Status | Action | Result |
|---------------|--------|--------|
| **Draft** | Start task | ✅ Task started, status → "In Progress" |
| **Pending** | Start task | ✅ Task started, status → "In Progress" |
| **In Progress** | Skip starting | ℹ️ Log message: "already in In Progress - no need to start again" |
| **Started** | Skip starting | ℹ️ Log message: "already started - no action needed" |
| **Submitted** | Skip starting | ℹ️ Log message: "already submitted - no action needed" |
| **Unknown/Error** | Try to start | ⚠️ Attempts to start (backend will handle validation) |

### Error Handling

#### Case 1: Status Check Fails
- If `getCycleCount` fails, attempts to start anyway (might be new task)
- If start fails with "already started" error, treats as success (task is already started)

#### Case 2: Start Fails with "Already Started" Error
- Error message is checked for:
  - `INVALID_STATUS`
  - `Cannot start`
  - `status: In Progress`
  - `status: Started`
- If match, logs informational message (not an error)
- If other error, logs warning (task will be started during sync/submission)

### Console Logs

#### Task Already Started (Success Case)
```
📋 Task CC-A1-R01-L2-B1-MK8K4A6R current status: In Progress
ℹ️ Task CC-A1-R01-L2-B1-MK8K4A6R is already in "In Progress" status - no need to start again
```

#### Task Needs to be Started (Success Case)
```
📋 Task CC-A1-R01-L2-B1-MK8K4A6R current status: Draft
📤 Starting cycle count task CC-A1-R01-L2-B1-MK8K4A6R (status: Draft)...
✅ Successfully started task CC-A1-R01-L2-B1-MK8K4A6R - status changed to Started/In Progress
```

#### Task Already Started (Error Caught)
```
⚠️ Could not check task status: Network error - attempting to start anyway...
ℹ️ Task CC-A1-R01-L2-B1-MK8K4A6R is already started/in progress - no action needed
```

## Benefits

1. ✅ **No more "Cannot start... status: In Progress" errors**
2. ✅ **Efficient** - Only starts task when needed
3. ✅ **Robust** - Handles various error scenarios gracefully
4. ✅ **User-friendly** - No errors shown to user for already-started tasks
5. ✅ **Logging** - Clear console messages for debugging

## Testing

### Test Case 1: New Task (Draft Status)
1. Create a new cycle count task (status: "Draft")
2. Scan carton ID
3. ✅ Expected: Task is started, status changes to "In Progress"

### Test Case 2: Already Started Task
1. Create and start a cycle count task (status: "In Progress")
2. Scan carton ID again (or return to screen)
3. ✅ Expected: Task is not started again, no errors, just log message

### Test Case 3: Offline Mode
1. Create a cycle count task
2. Go offline
3. Scan carton ID
4. ✅ Expected: Task will be started when synced (no error)

### Test Case 4: Status Check Failure
1. Create a cycle count task
2. Backend `getCycleCount` API fails (network error, etc.)
3. Scan carton ID
4. ✅ Expected: Attempts to start anyway, catches "already started" error gracefully

## Files Modified

- `src/screens/CycleCountBinCountingScreen.tsx`
  - Added `ensureTaskStarted` helper function (line ~830)
  - Updated `handleCartonIdScan` to use `ensureTaskStarted` (line ~968)
  - Updated `useFocusEffect` to use `ensureTaskStarted` (line ~202)

## Next Steps

1. ✅ **Status check implemented** - Task status is checked before starting
2. ✅ **Error handling improved** - "Already started" errors are handled gracefully
3. ✅ **Logging enhanced** - Clear console messages for debugging
4. ⏳ **Test in production** - Verify behavior with real backend responses
