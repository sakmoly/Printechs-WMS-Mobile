# Backend Error: Assignment to Constant Variable

## Error Details

**Error Message:**
```
TypeError: Assignment to constant variable.
    at scanTransferCarton (file:///D:/Development%20Project/Printechs%20WMS/Wms.Desktop/wms-api/src/modules/putaway/putawayController.js:4366:24)
```

**Request Body (from Mobile App):**
```json
{
  "tc_id": null,
  "box_id": "CTN-TI-123457-20260120-210842-726",
  "location_id": "A1-R02-L1-B2",
  "user_id": "USER-402498"
}
```

## Root Cause

The backend code in `putawayController.js` at line 4366 is attempting to assign a value to a variable that was declared with `const`. In JavaScript, `const` variables cannot be reassigned after declaration.

## Location

**File:** `wms-api/src/modules/putaway/putawayController.js`  
**Function:** `scanTransferCarton`  
**Line:** ~4366

## Context

The error occurs when:
1. ✅ Mobile app sends correct request with `box_id` in `CTN-TI-*` format
2. ✅ Request includes `location_id`, `user_id`, and `box_id`
3. ❌ Backend tries to reassign a `const` variable at line 4366

**Mobile App Status:**
- ✅ Sending correct `box_id` format (`CTN-TI-123457-20260120-210842-726`)
- ✅ Not sending `tc_id` (correct for Transfer In putaway)
- ✅ Request format is correct

## Required Backend Fix

### Option 1: Change `const` to `let`

If the variable needs to be reassigned:

```javascript
// Before (causing error):
const someVariable = initialValue;
// ... later in code ...
someVariable = newValue; // ❌ Error: Assignment to constant variable

// After (fix):
let someVariable = initialValue;
// ... later in code ...
someVariable = newValue; // ✅ Works
```

### Option 2: Use Different Variable Name

If you need to keep the original value and create a new one:

```javascript
// Before (causing error):
const originalValue = someValue;
originalValue = modifiedValue; // ❌ Error

// After (fix):
const originalValue = someValue;
const modifiedValue = transform(originalValue); // ✅ Create new variable
```

### Option 3: Use Object/Array Mutation (if applicable)

If the variable is an object or array, you can mutate its properties:

```javascript
// Before (causing error):
const obj = { value: 1 };
obj = { value: 2 }; // ❌ Error: Cannot reassign const

// After (fix):
const obj = { value: 1 };
obj.value = 2; // ✅ Works: Mutating property, not reassigning variable
```

## Recommended Solution

Based on the context (putaway validation), the most likely scenario is that a variable needs to be reassigned. Here's the recommended fix:

```javascript
// In scanTransferCarton function, around line 4366:

// ✅ FIX: Change const to let if variable needs to be reassigned
// Find the line that has:
const someVariable = ...;

// Change to:
let someVariable = ...;

// Then the reassignment at line 4366 will work:
someVariable = newValue;
```

## Common Patterns That Cause This Error

### Pattern 1: Reassigning Function Parameters

```javascript
// ❌ WRONG:
async function scanTransferCarton(data) {
  data = transform(data); // Error if data is const
}

// ✅ CORRECT:
async function scanTransferCarton(data) {
  const transformedData = transform(data); // Create new variable
  // Use transformedData
}
```

### Pattern 2: Reassigning Destructured Variables

```javascript
// ❌ WRONG:
const { box_id, location_id } = requestBody;
box_id = normalizeBoxId(box_id); // Error

// ✅ CORRECT:
let { box_id, location_id } = requestBody;
box_id = normalizeBoxId(box_id); // Works
```

### Pattern 3: Reassigning in Conditional Blocks

```javascript
// ❌ WRONG:
const boxId = requestBody.box_id;
if (someCondition) {
  boxId = transformBoxId(boxId); // Error
}

// ✅ CORRECT:
let boxId = requestBody.box_id;
if (someCondition) {
  boxId = transformBoxId(boxId); // Works
}
```

## Verification Steps

After fixing:

1. **Test Putaway Location Scan:**
   - Mobile app sends location scan request
   - Backend validates successfully
   - No "Assignment to constant variable" error

2. **Check Backend Logs:**
   - No TypeError about constant assignment
   - Request is processed successfully

3. **Verify Request Format:**
   - Mobile app sends: `{ "box_id": "CTN-TI-...", "location_id": "...", "user_id": "..." }`
   - Backend accepts and processes correctly

## Related Mobile App Status

✅ **Mobile app is working correctly:**
- Sending correct `box_id` format (`CTN-TI-*`)
- Sending correct request structure
- Not sending `tc_id` for Transfer In putaway (correct)
- All validation and error handling is in place

❌ **Backend needs fix:**
- `const` variable is being reassigned at line 4366
- This is a backend-only issue, no mobile app changes needed

## Summary

- **Issue:** Backend code attempts to reassign a `const` variable
- **Location:** `putawayController.js:4366` in `scanTransferCarton` function
- **Fix:** Change `const` to `let` if variable needs to be reassigned, or use a different approach
- **Impact:** Prevents putaway location validation from completing
- **Mobile App:** No changes needed - mobile app is sending correct request format

## Next Steps

1. **Backend Developer:** Fix the `const` assignment issue in `putawayController.js:4366`
2. **Test:** Verify putaway location scan works after fix
3. **Mobile App:** No changes needed - already working correctly
