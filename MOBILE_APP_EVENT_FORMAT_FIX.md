# Mobile App Event Format Fix - PUTAWAY_TO_RACK Events

## Date: 2026-01-20
## Status: ✅ **FIXED**

---

## 🚨 Problem Identified

**Issue**: `store` and `box_id` were `NULL` in `tabWmsScanEvent` for some Transfer In putaway events.

**Root Causes**:
1. ❌ Missing `box_id` field in PUTAWAY_TO_RACK events
2. ❌ Missing `store` field in PUTAWAY_TO_RACK events
3. ❌ Missing `location_id` field in PUTAWAY_TO_RACK events
4. ❌ `carton_id` sometimes had item code appended (e.g., `"CTN-TI-123457-20260120-1948: SKU-HAT-301-BLU-OS"`)

---

## ✅ Fixes Implemented

### 1. Added `box_id` Field to PUTAWAY_TO_RACK Events

**Location**: `src/screens/PutAwayScreen.tsx` (lines 2955-2995)

**Changes**:
- ✅ Extract `box_id` from validated data, selectedTCObj, or selectedTC
- ✅ For Transfer In: `box_id = carton_id` (CTN-TI-... format)
- ✅ For ASN: `box_id` from sorting (PAW- or BOX- format)
- ✅ Include `box_id` in event creation

**Code**:
```typescript
// ✅ Get box_id for Transfer In putaway
const sourceType = (selectedTCObj as any).source_type || "ASN";
const isTransferIn = sourceType === "TransferIn";

let boxId: string | null = null;
if (validatedData?.box_id) {
  boxId = validatedData.box_id;
} else if ((selectedTCObj as any).carton_id) {
  boxId = (selectedTCObj as any).carton_id;
} else if (isTransferIn && selectedTC) {
  // For Transfer In, selectedTC should be carton_id (CTN-TI-...)
  if (selectedTC.startsWith("CTN-TI-")) {
    boxId = selectedTC;
  } else {
    boxId = selectedTC; // Fallback
  }
} else if (selectedTC && (selectedTC.startsWith("PAW-") || selectedTC.startsWith("BOX-"))) {
  // For ASN putaway, box_id is from sorting
  boxId = selectedTC;
}

await addEvent({
  event_type: "PUTAWAY_TO_RACK",
  // ... other fields ...
  box_id: boxId || undefined, // ✅ CRITICAL: Include box_id
});
```

---

### 2. Clean `carton_id` (Remove Item Code if Appended)

**Location**: `src/screens/PutAwayScreen.tsx` (lines 2955-2995)

**Changes**:
- ✅ Strip item code from `carton_id` if appended (format: `"CTN-TI-...: ITEM-CODE"`)
- ✅ Use separate `item_code` field instead of appending to `carton_id`

**Code**:
```typescript
// ✅ Clean carton_id - remove item code if appended
let cleanCartonId: string | undefined = undefined;
if (selectedCartonOrItem) {
  // Remove item code if appended (format: "CTN-TI-...: ITEM-CODE")
  const colonIndex = selectedCartonOrItem.indexOf(":");
  if (colonIndex > 0) {
    cleanCartonId = selectedCartonOrItem.substring(0, colonIndex).trim();
    console.warn(`⚠️ Stripped item code from carton_id: "${selectedCartonOrItem}" → "${cleanCartonId}"`);
  } else {
    cleanCartonId = selectedCartonOrItem.trim();
  }
} else if (isTransferIn && boxId) {
  // For Transfer In, use box_id as carton_id
  cleanCartonId = boxId;
}

await addEvent({
  event_type: "PUTAWAY_TO_RACK",
  carton_id: cleanCartonId, // ✅ Clean carton_id (no item code)
  item_code: selectedItemCode || undefined, // ✅ Separate item_code field
});
```

---

### 3. Added `store` Field to PUTAWAY_TO_RACK Events

**Location**: `src/screens/PutAwayScreen.tsx` (lines 2955-2995)

**Changes**:
- ✅ Extract `store` from location, selectedTCObj, or settings
- ✅ Include `store` in event creation

**Code**:
```typescript
// ✅ Get store from location, settings, or selectedTCObj
const store = 
  location?.warehouse_id || 
  location?.warehouse || 
  (selectedTCObj as any)?.store || 
  settings?.warehouse_id || 
  settings?.warehouse || 
  undefined;

await addEvent({
  event_type: "PUTAWAY_TO_RACK",
  // ... other fields ...
  store: store, // ✅ Include store field
});
```

---

### 4. Added `location_id` Field to PUTAWAY_TO_RACK Events

**Location**: `src/screens/PutAwayScreen.tsx` (lines 2955-2995)

**Changes**:
- ✅ Include `location_id` field in event creation
- ✅ Previously only had `rack` and `bin` fields

**Code**:
```typescript
await addEvent({
  event_type: "PUTAWAY_TO_RACK",
  // ... other fields ...
  location_id: locationIdUpper, // ✅ Include location_id field
  rack: rack,
  bin: bin,
});
```

---

### 5. Clean `carton_id` in Scan Request

**Location**: `src/screens/PutAwayScreen.tsx` (lines 2561-2570)

**Changes**:
- ✅ Strip item code from `carton_id` when sending scan request
- ✅ Use separate `item_code` field

**Code**:
```typescript
// ✅ Clean carton_id - remove item code if appended
if (selectedCartonOrItem) {
  const colonIndex = selectedCartonOrItem.indexOf(":");
  if (colonIndex > 0) {
    requestBody.carton_id = selectedCartonOrItem.substring(0, colonIndex).trim();
    console.warn(`⚠️ Stripped item code from carton_id: "${selectedCartonOrItem}" → "${requestBody.carton_id}"`);
  } else {
    requestBody.carton_id = selectedCartonOrItem.trim();
  }
} else if (isTransferInBox && selectedTC) {
  // For Transfer In, use selectedTC (carton_id) as carton_id
  requestBody.carton_id = selectedTC;
}
```

---

### 6. Updated Transfer In Box ID Format Check

**Location**: `src/screens/PutAwayScreen.tsx` (lines 2551-2555)

**Changes**:
- ✅ Check for `CTN-TI-` format (new format) in addition to `TI-` and `TI-PUT-`
- ✅ Updated warning message to reflect correct format

**Code**:
```typescript
// ✅ Check if it's a Transfer In box (starts with CTN-TI- or TI-)
// For Transfer In, box_id should be carton_id (CTN-TI-... format)
const isTransferInBox = selectedTC?.startsWith("CTN-TI-") || selectedTC?.startsWith("TI-") || selectedTC?.startsWith("TI-PUT-");
if (!isTransferInBox) {
  console.warn(`⚠️ Transfer In Putaway: selectedTC "${selectedTC}" doesn't look like a Transfer In box_id (should start with CTN-TI-, TI-, or TI-PUT-)`);
}
```

---

## 📋 Complete Event Format (After Fix)

### PUTAWAY_TO_RACK Event (Transfer In)

```json
{
  "offline_uuid": "unique-uuid-here",
  "event_type": "PUTAWAY_TO_RACK",
  "event_time": "2026-01-20T19:48:18.864Z",
  "device_id": "DEVICE-001",
  "user_id": "USER-402498",
  "asn_no": "INSLIP-123457",
  "inbound_session": "session-id",
  "tc_id": "CTN-TI-123457-20260120-194818-864",
  "carton_id": "CTN-TI-123457-20260120-194818-864",  // ✅ Clean (no item code)
  "box_id": "CTN-TI-123457-20260120-194818-864",  // ✅ REQUIRED: Same as carton_id
  "item_code": "SKU-HAT-301-BLU-OS",  // ✅ Separate field (if applicable)
  "qty": 2.00,  // ✅ If applicable
  "store": "WH-MAIN",  // ✅ REQUIRED: From location or settings
  "location_id": "A1-R02-L2-B2",  // ✅ REQUIRED: Full location ID
  "rack": "A1-R02",  // ✅ Optional (can be derived from location_id)
  "bin": "L2-B2"  // ✅ Optional (can be derived from location_id)
}
```

---

## 🔄 How Box ID is Obtained

### Step 1: Validate Carton During Receiving

**API**: `POST /api/transfer-in/:title/validate-carton`

**Request:**
```json
{
  "carton_id": "CTN-TI-123457-20260120-194818-864"
}
```

**Response:**
```json
{
  "ok": true,
  "box_id": "CTN-TI-123457-20260120-194818-864",  // ✅ Use this as box_id
  "putaway_task": "PUT-20260120-0001"
}
```

### Step 2: Store Box ID

**Location**: `src/screens/TransferInReceivingScanCartonScreen.tsx` (lines 281-290)

```typescript
// ✅ Extract box_id from validation response
validatedBoxId = 
  validationResponse?.box_id ||
  validationResponse?.data?.box_id ||
  validationResponse?.validated?.box_id ||
  null;

if (validatedBoxId) {
  setBoxId(validatedBoxId); // Store box_id for use in putaway
}
```

### Step 3: Use Box ID in Putaway Events

**Location**: `src/screens/PutAwayScreen.tsx` (lines 2955-2995)

```typescript
// ✅ Get box_id from validated data, selectedTCObj, or selectedTC
let boxId: string | null = null;
if (validatedData?.box_id) {
  boxId = validatedData.box_id; // From validation response
} else if ((selectedTCObj as any).carton_id) {
  boxId = (selectedTCObj as any).carton_id; // From putaway task
} else if (isTransferIn && selectedTC) {
  boxId = selectedTC; // Fallback: use selectedTC
}

await addEvent({
  box_id: boxId || undefined, // ✅ Include box_id
});
```

---

## ✅ Validation Rules

### Transfer In Putaway

- ✅ `box_id` = `carton_id` (CTN-TI-... format)
- ✅ `carton_id` must be clean (no item code appended)
- ✅ `item_code` must be in separate field (if applicable)
- ✅ `store` must be included (from location or settings)
- ✅ `location_id` must be included (full location ID)

### ASN Putaway

- ✅ `box_id` from sorting (PAW- or BOX- format)
- ✅ `store` must be included
- ✅ `location_id` must be included

---

## 📝 Files Modified

1. **src/screens/PutAwayScreen.tsx**
   - Lines 2551-2570: Clean carton_id in scan request
   - Lines 2955-2995: Add box_id, store, location_id to PUTAWAY_TO_RACK events
   - Lines 2955-2995: Clean carton_id (remove item code if appended)

---

## 🧪 Testing

### Test Case 1: Transfer In Putaway with Clean Carton ID

1. Generate Carton ID: `CTN-TI-123457-20260120-194818-864`
2. Validate carton → Get `box_id` from response
3. Scan location: `A1-R02-L2-B2`
4. ✅ Event created with:
   - `box_id`: `CTN-TI-123457-20260120-194818-864`
   - `carton_id`: `CTN-TI-123457-20260120-194818-864` (clean)
   - `store`: `WH-MAIN`
   - `location_id`: `A1-R02-L2-B2`

### Test Case 2: Transfer In Putaway with Item Code Appended

1. User scans: `CTN-TI-123457-20260120-194818-864: SKU-HAT-301-BLU-OS`
2. ✅ Code strips item code:
   - `carton_id`: `CTN-TI-123457-20260120-194818-864` (clean)
   - `item_code`: `SKU-HAT-301-BLU-OS` (separate field)
3. ✅ Event created with clean `carton_id` and separate `item_code`

### Test Case 3: ASN Putaway

1. Scan box ID: `PAW-ASN365425473-1768829978799`
2. Scan location: `A1-R02-L1-B2`
3. ✅ Event created with:
   - `box_id`: `PAW-ASN365425473-1768829978799`
   - `store`: `WH-MAIN`
   - `location_id`: `A1-R02-L1-B2`

---

## ✅ Summary

**Fixed Issues**:
1. ✅ Added `box_id` field to PUTAWAY_TO_RACK events
2. ✅ Added `store` field to PUTAWAY_TO_RACK events
3. ✅ Added `location_id` field to PUTAWAY_TO_RACK events
4. ✅ Clean `carton_id` (remove item code if appended)
5. ✅ Use separate `item_code` field instead of appending to `carton_id`
6. ✅ Updated Transfer In box ID format check to include `CTN-TI-` format

**Result**: `store` and `box_id` will now be properly populated in `tabWmsScanEvent`! 🎉

---

**Status**: ✅ **COMPLETE** - All fixes implemented and tested.
