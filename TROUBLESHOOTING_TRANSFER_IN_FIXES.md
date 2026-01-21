# Troubleshooting: Transfer In Receiving Fixes

## If fixes show "no effect", check the following:

### 1. **App Reload Required**
The code changes require a **full app reload**:
- Stop the Expo/Metro bundler
- Clear cache: `npx expo start --clear`
- Or restart the app completely

### 2. **Check Console Logs**
Look for these debug messages in the console:

#### When loading Transfer In:
```
🔍 Status Check: backend_status="...", hasCompletedFlag=..., sessionCompleted=..., finalCompleted=...
   Backend fields: completed_at=..., is_completed=..., completed_by=...
   Session: status=..., active_carton_id=...
```

#### When clicking Edit button:
```
🔍 Edit button pressed: isCompleted=..., item=...
```

#### When restoring carton ID:
```
✅ Restored carton ID from session: CTN-...
```

### 3. **Verify Edit Button State**

**Expected Behavior:**
- ✅ Edit button should be **ENABLED** when:
  - `isCompleted === false`
  - Even if `received_qty === 0`
  - Even if backend status is "Received" (but Complete not clicked)

- ❌ Edit button should be **DISABLED** only when:
  - `isCompleted === true` (user clicked Complete)

**Check in console:**
- Look for `🔍 Status Check` log
- Verify `finalCompleted=false` when Edit should be enabled
- Verify `finalCompleted=true` only after Complete clicked

### 4. **Verify Carton ID Restoration**

**Expected Behavior:**
- When you scan a carton and go back, then press "Start Receiving" again:
  - Should navigate **directly to scan items** (skip carton scan)
  - Carton ID should be restored from session

**Check in console:**
- Look for `✅ Restored carton ID from session: ...`
- Check session status in database

### 5. **Check Session Status**

The session status determines if receiving can be resumed:

```typescript
// Session statuses:
"Draft" → Can resume
"In Progress" → Can resume  
"Completed" → Cannot resume (creates new session)
```

**To check session:**
1. Open app console
2. Look for session logs when loading Transfer In
3. Session should have `active_carton_id` if carton was scanned

### 6. **Common Issues**

#### Issue: Edit button still disabled
**Possible causes:**
1. `isCompleted` is being set to `true` incorrectly
   - Check console log: `🔍 Status Check`
   - Verify `hasCompletedFlag` and `sessionCompleted` values
   - Backend might be returning `completed_at` or `is_completed` when it shouldn't

2. Session status is "Completed"
   - Check console: `Session: status=Completed`
   - If completed, Edit will be disabled
   - Solution: Complete button should only set this when user clicks Complete

#### Issue: Carton ID not restored
**Possible causes:**
1. Session not being saved
   - Check if `updateActiveCarton()` is being called
   - Check console for errors when saving session

2. Session not being loaded
   - Check if `loadSession()` returns null
   - Check console for errors when loading session

3. Carton ID not in route params
   - When navigating from Start Receiving, check if `cartonId` is passed
   - Check console: `✅ Restored carton ID from session: ...`

#### Issue: Start Receiving not resuming
**Possible causes:**
1. Session doesn't exist
   - First time starting receiving creates new session
   - Check console for session creation logs

2. Session is "Completed"
   - Completed sessions create new session (by design)
   - Check console: `Session: status=Completed`

3. Navigation not passing carton ID
   - Check `handleStartReceiving()` in `TransferInDetailScreen.tsx`
   - Should navigate with `cartonId` if session has `active_carton_id`

### 7. **Manual Verification Steps**

#### Test Edit Button:
1. Open Transfer In → Start Receiving → Scan carton
2. **Edit button should be ENABLED** (even with 0 scanned)
3. Check console: `🔍 Status Check: finalCompleted=false`
4. Scan some items → Edit still enabled
5. Click Complete → Edit disabled, shows "Completed"

#### Test Carton ID Persistence:
1. Open Transfer In → Start Receiving → Scan carton "CTN-001"
2. Check console: Should save carton to session
3. Go back to Transfer In Detail
4. Press "Start Receiving" again
5. **Should navigate directly to scan items** (not carton scan)
6. Check console: `✅ Restored carton ID from session: CTN-001`

#### Test Resume:
1. Open Transfer In → Start Receiving → Scan carton → Scan some items
2. Go back to Transfer In Detail
3. Press "Start Receiving" again
4. **Should resume** with same carton and items visible
5. Can continue scanning

### 8. **Database Check**

If issues persist, check the SQLite database:

```sql
-- Check receiving sessions
SELECT * FROM transfer_in_receiving_sessions 
WHERE transfer_in_no = 'YOUR_TI_NUMBER';

-- Check if carton ID is saved
SELECT active_carton_id, status FROM transfer_in_receiving_sessions 
WHERE transfer_in_no = 'YOUR_TI_NUMBER';
```

### 9. **Force Reset (If Needed)**

If session is stuck in wrong state:

```typescript
// In console or temporary code:
import { transferInReceivingSessionService } from './services/transfer-in-receiving-session.service';

// Delete session to start fresh
await transferInReceivingSessionService.deleteSession('YOUR_TI_NUMBER');
```

### 10. **Backend Response Check**

The mobile app checks for these fields to determine completion:
- `completed_at`
- `is_completed`
- `completed_by`
- `is_completed_receiving`
- `completed_receiving_at`

**If backend returns any of these when Complete is NOT clicked:**
- Mobile app will mark as completed
- Edit button will be disabled
- This is a **backend issue** - backend should not set these until Complete endpoint is called

**Solution:** Backend should only set completion flags when:
- `POST /api/transfer-in/{title}/complete-receiving` is called
- OR `POST /api/transfer-in/{title}/update-status` with status="Received" is called (and only then)

---

## Quick Debug Checklist

- [ ] App reloaded with `--clear` flag?
- [ ] Console shows `🔍 Status Check` logs?
- [ ] `finalCompleted=false` when Edit should be enabled?
- [ ] Console shows `✅ Restored carton ID` when returning?
- [ ] Session has `active_carton_id` in database?
- [ ] Navigation passes `cartonId` in route params?
- [ ] Backend not returning completion flags prematurely?

---

## Still Not Working?

If fixes still show no effect after checking all above:

1. **Share console logs** - Copy all `🔍` and `✅` log messages
2. **Share session data** - What does `loadSession()` return?
3. **Share backend response** - What fields does `getTransferIn()` return?
4. **Check for errors** - Any red error messages in console?

The debug logs will help identify exactly where the issue is.
