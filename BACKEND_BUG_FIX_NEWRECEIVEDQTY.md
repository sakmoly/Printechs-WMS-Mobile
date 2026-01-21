# Backend Bug Fix: `newReceivedQty is not defined`

## Issue

The backend API endpoint `POST /api/transfer-in/{title}/receive-line` is throwing a 500 error with:

```
{
  "code": "DATABASE_ERROR",
  "message": "Failed to receive Transfer In line",
  "details": "newReceivedQty is not defined"
}
```

## Root Cause

The backend code is trying to use a variable `newReceivedQty` that hasn't been defined. This is a **backend programming error**, not a mobile app issue.

## Backend Fix Required

### Problem Location

The error occurs in the `receive-line` API handler when processing the request. The code likely looks something like this (incorrect):

```javascript
// ❌ INCORRECT - newReceivedQty is not defined
async function receiveTransferInLine(
  transferInTitle,
  itemCode,
  receivedQty,
  receivedBy
) {
  // ... get current received_qty ...
  const currentReceivedQty = await getCurrentReceivedQty(
    transferInTitle,
    itemCode
  );

  // ❌ BUG: newReceivedQty is used but never defined
  await updateTransferInLine(transferInTitle, itemCode, {
    received_qty: newReceivedQty, // ❌ Variable not defined!
    received_by: receivedBy,
  });

  // ❌ Also used here without definition
  if (newReceivedQty >= itemQty) {
    status = "Received";
  }
}
```

### Correct Implementation

The backend should **calculate** `newReceivedQty` from the current quantity and the received quantity:

```javascript
// ✅ CORRECT - Calculate newReceivedQty
async function receiveTransferInLine(transferInTitle, data) {
  const { item_code, received_qty, carton_id, received_by } = data;

  // 1. Get current item data
  const item = await getTransferInItem(transferInTitle, item_code);
  if (!item) {
    throw new Error(
      `Item ${item_code} not found in Transfer In ${transferInTitle}`
    );
  }

  // 2. ✅ Calculate new received quantity (ADDITIVE)
  const currentReceivedQty = item.received_qty || 0;
  const newReceivedQty = currentReceivedQty + received_qty; // ✅ Define the variable!

  // 3. Validate new quantity doesn't exceed expected quantity
  if (newReceivedQty > item.qty) {
    throw new Error(
      `Received quantity (${newReceivedQty}) exceeds expected quantity (${item.qty})`
    );
  }

  // 4. Calculate status based on newReceivedQty
  let newStatus;
  if (newReceivedQty === 0) {
    newStatus = "Pending";
  } else if (newReceivedQty >= item.qty) {
    newStatus = "Received";
  } else {
    newStatus = "Picking";
  }

  // 5. Update Transfer In item line
  await updateTransferInLine(transferInTitle, item_code, {
    received_qty: newReceivedQty, // ✅ Use the calculated value
    status: newStatus,
    carton_id: carton_id || item.carton_id,
    received_by: received_by,
  });

  // 6. Save to Transaction History
  await createTransactionHistory({
    transfer_in: transferInTitle,
    item_code: item_code,
    carton_id: carton_id,
    qty: received_qty, // Quantity difference
    qty_before: currentReceivedQty,
    qty_after: newReceivedQty,
    status: newStatus,
    transaction_type: "TransferIn",
    user_id: received_by,
  });

  return {
    success: true,
    item_code: item_code,
    received_qty: newReceivedQty,
    status: newStatus,
  };
}
```

### Alternative: If Using Carton ID Only

If the request only includes `carton_id` (without `item_code` and `received_qty`), the backend should:

```javascript
async function receiveTransferInLine(transferInTitle, data) {
  const { carton_id, received_by } = data;

  if (!carton_id) {
    throw new Error(
      "Either carton_id OR (item_code + received_qty) must be provided"
    );
  }

  // Get all items in the carton
  const cartonItems = await getTransferInItemsByCarton(
    transferInTitle,
    carton_id
  );

  // Update each item in the carton
  for (const item of cartonItems) {
    const currentReceivedQty = item.received_qty || 0;
    const newReceivedQty = currentReceivedQty + 1; // Or use item's shipped_qty from carton

    let newStatus;
    if (newReceivedQty === 0) {
      newStatus = "Pending";
    } else if (newReceivedQty >= item.qty) {
      newStatus = "Received";
    } else {
      newStatus = "Picking";
    }

    await updateTransferInLine(transferInTitle, item.item_code, {
      received_qty: newReceivedQty,
      status: newStatus,
      carton_id: carton_id,
      received_by: received_by,
    });
  }

  return { success: true, items_updated: cartonItems.length };
}
```

## Mobile App Request Format

The mobile app sends requests in this format:

### For Individual Item:

```json
POST /api/transfer-in/INSLIP-123458/receive-line
{
  "item_code": "SKU-HAT-301-BLU-OS",
  "received_qty": 2,
  "received_by": "USER-001"
}
```

### For Carton:

```json
POST /api/transfer-in/INSLIP-123458/receive-line
{
  "carton_id": "CTN-12345",
  "received_by": "USER-001"
}
```

## Backend Validation

The backend should validate:

1. ✅ Either `carton_id` OR (`item_code` + `received_qty`) is provided
2. ✅ `item_code` exists in the Transfer In
3. ✅ `received_qty` is a positive number (for item_code requests)
4. ✅ New `received_qty` doesn't exceed `qty`
5. ✅ Calculate `newReceivedQty` before using it
6. ✅ Update `status` based on `newReceivedQty`

## Testing

After fixing, test with:

1. **Individual item receive**:

   ```bash
   POST /api/transfer-in/INSLIP-123458/receive-line
   {
     "item_code": "SKU-HAT-301-BLU-OS",
     "received_qty": 1,
     "received_by": "USER-001"
   }
   ```

2. **Carton receive**:

   ```bash
   POST /api/transfer-in/INSLIP-123458/receive-line
   {
     "carton_id": "CTN-12345",
     "received_by": "USER-001"
   }
   ```

3. **Verify**:
   - No 500 errors
   - `received_qty` is updated correctly (additive)
   - `status` is updated correctly
   - Transaction History is created

## Summary

**This is a backend bug** where `newReceivedQty` variable is not defined before use. The fix is to:

1. Get current `received_qty` from database
2. Calculate `newReceivedQty = currentReceivedQty + received_qty`
3. Use `newReceivedQty` for updates

The mobile app is working correctly and sending valid requests.
