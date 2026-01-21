# Troubleshooting: No Changes on Mobile App

## Issue
Code changes are not taking effect on the mobile app.

## Immediate Steps

### 1. **Clear Metro Bundler Cache**
```bash
# Stop the current Metro bundler (Ctrl+C)
# Then restart with cache cleared:
npx expo start --clear
```

Or:
```bash
# Clear cache manually
rm -rf node_modules/.cache
npx expo start --clear
```

### 2. **Reload App Completely**
- **Android**: Shake device → "Reload" OR press `r` in Metro terminal
- **iOS**: Shake device → "Reload" OR press `r` in Metro terminal
- Or close app completely and reopen

### 3. **Check Console Logs**
Look for these debug messages when loading Transfer In:

```
🔍 Status Check: backend_status="...", backendCompleted=..., sessionCompleted=..., finalCompleted=...
   Backend fields: completed_at=..., is_completed=..., completed_by=...
   Session: status=..., active_carton_id=...
   ✅ isCompleted set ONLY from explicit flags, NOT from status text or qty match
```

**If you don't see these logs:**
- Code changes might not be loaded
- App might be using cached version
- Try full restart with `--clear` flag

### 4. **Verify isCompleted State**

Check what `isCompleted` is set to:
- Look for console log: `finalCompleted=false` or `finalCompleted=true`
- If `finalCompleted=true` when it shouldn't be, check:
  - Does backend return `completed_at`?
  - Does backend return `is_completed=1`?
  - Is session status "Completed"?

### 5. **Check Edit Button State**

**Expected:**
- Edit button should be **ENABLED** when `isCompleted=false`
- Edit button should be **DISABLED** when `isCompleted=true`

**To verify:**
- Check console: `🔍 Edit button pressed: isCompleted=...`
- If Edit button is disabled but `isCompleted=false`, there's a UI binding issue

### 6. **Check Scanning State**

**Expected:**
- Scanning should be **ENABLED** when `isCompleted=false`
- Scanning should be **DISABLED** when `isCompleted=true`

**To verify:**
- Check if barcode input is `editable={!isCompleted}`
- Check if scan handler blocks when `isCompleted=true`

## Common Issues

### Issue 1: App Using Cached Code
**Symptom:** Changes not appearing even after save

**Solution:**
1. Stop Metro bundler completely
2. Run: `npx expo start --clear`
3. Reload app (shake device → Reload)

### Issue 2: Backend Returning Completion Flags
**Symptom:** `isCompleted=true` even though Complete not clicked

**Check:**
- Console log: `Backend fields: completed_at=...`
- If `completed_at` exists, backend is setting it incorrectly
- **This is a backend issue** - backend should not set `completed_at` until Complete endpoint called

### Issue 3: Session Status is "Completed"
**Symptom:** `isCompleted=true` from session

**Check:**
- Console log: `Session: status=Completed`
- If session status is "Completed", it will set `isCompleted=true`
- **Solution:** Delete session or create new one

### Issue 4: Code Not Executing
**Symptom:** No console logs appearing

**Check:**
- Are there any syntax errors?
- Is Metro bundler showing errors?
- Try adding a simple `console.log("TEST")` at the top of `loadTransferIn()` to verify code runs

## Debug Checklist

- [ ] Metro bundler restarted with `--clear`?
- [ ] App completely reloaded (not just refreshed)?
- [ ] Console shows `🔍 Status Check` logs?
- [ ] `finalCompleted` value is correct?
- [ ] Edit button state matches `isCompleted`?
- [ ] Scanning state matches `isCompleted`?
- [ ] No errors in Metro bundler console?
- [ ] No errors in app console?

## Force Reset (If Nothing Works)

### Option 1: Clear All Caches
```bash
# Stop Metro
# Clear all caches
rm -rf node_modules/.cache
rm -rf .expo
npx expo start --clear
```

### Option 2: Rebuild App
```bash
# For Android
npx expo run:android

# For iOS
npx expo run:ios
```

### Option 3: Check File Actually Saved
- Verify file was saved (check timestamp)
- Check if there are unsaved changes
- Try making a small visible change (like adding a console.log) to verify file is being used

## Verify Code is Running

Add a test log at the very top of `loadTransferIn()`:

```typescript
const loadTransferIn = async () => {
  console.log("🧪 TEST: loadTransferIn called - code is running!");
  try {
    // ... rest of code
```

If you don't see this log, the code is not executing.

## Still Not Working?

If after all steps the issue persists:

1. **Share console logs** - Copy all `🔍 Status Check` messages
2. **Share backend response** - What does `getTransferIn()` return? (check `completed_at`, `is_completed` fields)
3. **Share session data** - What does `loadSession()` return?
4. **Check for errors** - Any red error messages in console?

The debug logs will show exactly what's happening and why `isCompleted` is being set.
