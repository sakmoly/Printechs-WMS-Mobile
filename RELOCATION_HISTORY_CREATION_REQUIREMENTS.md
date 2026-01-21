# Relocation History Creation Requirements

## Business Rule

**Relocation History should ONLY be created AFTER successful completion of the relocation move/bin transfer.**

### Key Requirements:

1. ✅ **History is NOT created when:**

   - User starts a relocation session
   - User scans FROM bin location
   - User scans FROM carton ID
   - User scans TO bin location
   - User scans TO carton ID
   - User scans items to move
   - User navigates through screens

2. ✅ **History IS created ONLY when:**

   - User clicks "Complete Relocation" button
   - Backend commit API (`commit-full` or `commit-partial`) succeeds
   - Stock ledger is successfully updated
   - All validations pass

3. ✅ **If commit fails:**
   - No history should be created
   - Session remains in "In Progress" state
   - User can retry or cancel

---

## Current Implementation Analysis

### Mobile App Flow:

1. **Session Creation** (`RelocationHomeScreen.tsx`):

   - Creates local session with status "Draft" or "In Progress"
   - ✅ **Correct**: No history created here

2. **Location Scanning** (`RelocationScanFromBinScreen`, `RelocationScanFromCartonScreen`, etc.):

   - Updates session with locations
   - ✅ **Correct**: No history created here

3. **Complete Relocation** (`RelocationExecuteScreen.tsx`):
   - Calls backend `commitRelocationFull` or `commitRelocationPartial`
   - **⚠️ ISSUE**: If backend API fails, mobile creates `RELOCATION_MOVE` events as fallback
   - **⚠️ ISSUE**: Events are created even if commit API fails
   - **⚠️ ISSUE**: Events will be synced to backend, which might create history prematurely

### Backend Flow (Expected):

1. **Session Start** (`POST /api/relocation/session/start`):

   - Creates session record in `relocation_sessions` table
   - Status: "IN_PROGRESS"
   - ✅ **Correct**: No history created here

2. **Set Locations** (`PUT /api/relocation/session/:id/from`, `/to`):

   - Updates session with locations
   - ✅ **Correct**: No history created here

3. **Commit Relocation** (`POST /api/relocation/session/:id/commit-full` or `/commit-partial`):

   - Validates session and locations
   - Updates stock ledger
   - **✅ SHOULD CREATE HISTORY HERE** (only if all steps succeed)
   - Marks session as "COMPLETED"

4. **Event Processing** (`POST /api/events/batch`):
   - Processes `RELOCATION_MOVE` events
   - **⚠️ ISSUE**: Should NOT create history if commit API already created it
   - **⚠️ ISSUE**: Should only create history if commit API was never called (offline mode)

---

## Required Changes

### Mobile App Changes:

1. **Only create events if commit API succeeds:**

   ```typescript
   // Current (WRONG):
   try {
     await apiService.commitRelocationFull(sessionId, lines);
   } catch (error) {
     // Fallback: create events anyway
     await addEvent({ event_type: "RELOCATION_MOVE", ... });
   }

   // Fixed (CORRECT):
   let commitSuccess = false;
   try {
     await apiService.commitRelocationFull(sessionId, lines);
     commitSuccess = true;
   } catch (error) {
     // If commit fails, DO NOT create events
     Alert.alert("Error", "Failed to complete relocation. Please try again.");
     return; // Stop here - don't create events
   }

   // Only create events if commit succeeded (for offline sync backup)
   if (commitSuccess) {
     for (const line of lines) {
       await addEvent({ event_type: "RELOCATION_MOVE", ... });
     }
   }
   ```

2. **Alternative: Don't create events if commit API succeeds:**
   - If backend commit API succeeds, history is already created
   - Events are only needed for offline mode
   - If commit succeeds, events are redundant

### Backend Changes:

1. **Create history ONLY in commit endpoints:**

   ```sql
   -- In commit-full or commit-partial endpoint:
   -- 1. Validate session
   -- 2. Update stock ledger
   -- 3. Create relocation history record
   -- 4. Mark session as COMPLETED
   ```

2. **Event processing should check for existing history:**

   ```sql
   -- When processing RELOCATION_MOVE events:
   -- 1. Check if relocation history already exists for this session
   -- 2. If exists, skip history creation (idempotent)
   -- 3. If not exists, create history (offline mode fallback)
   ```

3. **History table structure:**
   ```sql
   CREATE TABLE relocation_history (
     id INT PRIMARY KEY AUTO_INCREMENT,
     session_id VARCHAR(100) UNIQUE,
     from_bin VARCHAR(100),
     from_carton VARCHAR(100),
     to_bin VARCHAR(100),
     to_carton VARCHAR(100),
     mode VARCHAR(50),
     status VARCHAR(50) DEFAULT 'COMPLETED',
     completed_at DATETIME,
     completed_by VARCHAR(100),
     items_json TEXT, -- JSON array of moved items
     created_at DATETIME DEFAULT CURRENT_TIMESTAMP
   );
   ```

---

## Implementation Priority

### High Priority (Mobile):

1. ✅ Fix `RelocationExecuteScreen.tsx` to only create events after successful commit
2. ✅ Show error if commit fails and prevent event creation
3. ✅ Keep session in "In Progress" if commit fails

### High Priority (Backend):

1. ✅ Create relocation history in commit endpoints (commit-full, commit-partial)
2. ✅ Only create history if commit succeeds (all validations pass)
3. ✅ Mark session as "COMPLETED" only after history is created

### Medium Priority (Backend):

1. ⚠️ Event processing: Check for existing history before creating
2. ⚠️ Idempotent history creation (prevent duplicates)

---

## Testing Checklist

### Mobile App:

- [ ] Start relocation session → Verify no history created
- [ ] Scan locations → Verify no history created
- [ ] Click "Complete Relocation" with valid data → Verify commit API called
- [ ] Commit API succeeds → Verify events created (optional)
- [ ] Commit API fails → Verify NO events created, session remains "In Progress"
- [ ] Retry after failure → Verify can complete successfully

### Backend:

- [ ] Session start → Verify no history created
- [ ] Set locations → Verify no history created
- [ ] Commit with valid data → Verify history created
- [ ] Commit with invalid data → Verify NO history created
- [ ] Process RELOCATION_MOVE events → Verify checks for existing history first

---

## Summary

**Answer to User's Question:**

> "Is it required backend changes or mobile can manage?"

**Answer: BOTH are required:**

1. **Mobile App**: Must be fixed to only create events after successful commit
2. **Backend**: Must create history in commit endpoints, not in event processing (unless offline fallback)

**Current Issue:**

- Mobile creates events even if commit fails
- Backend might create history from events even if commit didn't succeed

**Solution:**

- Mobile: Only create events if commit succeeds (or don't create events at all if commit succeeds)
- Backend: Create history in commit endpoints, use events only as offline fallback
