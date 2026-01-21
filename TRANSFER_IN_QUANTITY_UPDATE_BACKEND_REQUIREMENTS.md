# Transfer In Quantity Update - Backend Requirements

## Issue Summary

When users edit item quantities in the mobile app, the changes are not being reflected in the backend, even though events are successfully saved to the backend database.

## Status Field Implementation

The backend has implemented a `status` field for Transfer In items with the following values:
- **Pending**: `received_qty = 0` (not started)
- **Picking**: `0 < received_qty < qty` (in progress)
- **Received**: `received_qty >= qty` (complete)

### Status Behavior
- Status is automatically set to "Picking" when receiving starts
- Status is automatically set to "Received" when fully received or carton is closed
- Status updates in the same transaction as `received_qty`
- Status is included in GET endpoint responses
- Status is updated when processing events

### Mobile App Support
The mobile app has been updated to:
- Accept and display `status` field in Transfer In item responses
- Show status badges in Transfer In detail and receiving screens
- Fallback to calculating status from `received_qty` if status is not provided

## Mobile App Behavior

### When User Edits Quantity:

1. **API Call Attempt**: The mobile app tries to update via `POST /api/transfer-in/{title}/receive-line` with:
   ```json
   {
     "item_code": "SKU-JACKET-201-BLK-M",
     "received_qty": 2,  // Quantity difference (positive for increase)
     "received_by": "USER-001"
   }
   ```

2. **API May Fail**: If the item already has a `carton_id`, the backend returns:
   ```json
   {
     "code": "NOT_FOUND",
     "message": "Item SKU-JACKET-201-BLK-M not found in Transfer In INSLIP-123458 (or item has carton_id)"
   }
   ```
   This is **expected behavior** - the backend doesn't allow updating items with `carton_id` via the `receive-line` API.

3. **Event Creation**: The mobile app **always** creates a `TRANSFER_IN_RECEIVE` event:
   ```json
   {
     "event_type": "TRANSFER_IN_RECEIVE",
     "transfer_in": "INSLIP-123458",
     "item_code": "SKU-JACKET-201-BLK-M",
     "carton_id": "CTN-12345",  // Current carton ID (if set)
     "qty": 2,  // Quantity difference (can be positive or negative)
     "device_id": "DEV-001",
     "user_id": "USER-001",
     "event_time": "2025-01-25T10:30:00.000Z"
   }
   ```

4. **Immediate Event Sync**: Events are synced immediately via `POST /api/events/batch`:
   ```json
   {
     "events": [
       {
         "event_type": "TRANSFER_IN_RECEIVE",
         "transfer_in": "INSLIP-123458",
         "item_code": "SKU-JACKET-201-BLK-M",
         "carton_id": "CTN-12345",
         "qty": 2,
         "device_id": "DEV-001",
         "user_id": "USER-001",
         "event_time": "2025-01-25T10:30:00.000Z"
       }
     ],
     "update_mode": "append"
   }
   ```

5. **Backend Response**: Backend confirms events are saved:
   ```json
   {
     "ok": true,
     "inserted_count": 1,
     "events_saved_to_backend": true,
     "failed_count": 0
   }
   ```

## Backend Processing Requirements

### Critical: Process TRANSFER_IN_RECEIVE Events for Quantity Updates

The backend **MUST** process `TRANSFER_IN_RECEIVE` events to update item quantities, **especially when items already have `carton_id`**.

### Current Backend Logic (Expected)

When processing `/api/events/batch` for `TRANSFER_IN_RECEIVE` events:

```javascript
for (const event of events) {
  if (event.event_type === "TRANSFER_IN_RECEIVE") {
    // ✅ CRITICAL: Validate required fields
    if (!event.transfer_in || !event.item_code) {
      console.warn(`⚠️ Skipping TRANSFER_IN_RECEIVE event - missing required fields`);
      continue;
    }

    // ✅ CRITICAL: Update received_qty (ADDITIVE - add qty to existing received_qty)
    // The event.qty is the DIFFERENCE, not the total
    // If user changes quantity from 5 to 7, event.qty = 2 (increase)
    // If user changes quantity from 7 to 5, event.qty = -2 (decrease)
    await updateTransferInLineReceivedQty(
      event.transfer_in,
      event.item_code,
      event.qty  // Add this to existing received_qty
    );

    // ✅ Update carton_id if present (if not already set, or based on your business logic)
    if (event.carton_id) {
      await updateTransferInLineCartonId(
        event.transfer_in,
        event.item_code,
        event.carton_id
      );
    }

    // ✅ Save to Transaction History
    await createTransactionHistory({
      transfer_in: event.transfer_in,
      item_code: event.item_code,
      carton_id: event.carton_id,
      qty: event.qty,  // Quantity difference
      transaction_type: "TransferIn",
      user_id: event.user_id,
      device_id: event.device_id,
      event_time: event.event_time
    });
  }
}
```

### Key Points for Backend Implementation

1. **Quantity Update Logic**:
   - `event.qty` is the **DIFFERENCE** (change amount), not the total
   - For increases: `event.qty` is positive (e.g., `+2`)
   - For decreases: `event.qty` is negative (e.g., `-2`)
   - Backend should **ADD** `event.qty` to existing `received_qty`:
     ```sql
     UPDATE tabTransferInItem
     SET received_qty = received_qty + ?
     WHERE parent = ? AND item_code = ?
     ```

2. **Handle Items with carton_id**:
   - The `receive-line` API may reject items that already have `carton_id`
   - Events are the **primary mechanism** for updating these items
   - Backend **MUST** process events even if the item has `carton_id`

3. **Required Event Fields**:
   - `transfer_in`: Transfer In document name (REQUIRED)
   - `item_code`: Item code (REQUIRED)
   - `qty`: Quantity difference (REQUIRED)
   - `carton_id`: Carton ID (optional, but should be processed if present)
   - `user_id`: User who made the change
   - `device_id`: Device ID
   - `event_time`: Timestamp

4. **Validation**:
   - Backend should validate that `transfer_in` and `item_code` exist
   - Backend should handle negative quantities (decreases) correctly
   - Backend should not skip events if item already has `carton_id`

## Backend Verification Checklist

Please verify the following in your backend code:

- [ ] **Event Processing**: Does `/api/events/batch` process `TRANSFER_IN_RECEIVE` events?
- [ ] **Quantity Update**: Does it update `received_qty` by **adding** `event.qty` to existing quantity?
- [ ] **Items with carton_id**: Does it process events for items that already have `carton_id`?
- [ ] **Negative Quantities**: Does it handle negative `qty` values (decreases) correctly?
- [ ] **Required Fields**: Does it validate `transfer_in` and `item_code` are present?
- [ ] **Transaction History**: Does it save quantity changes to Transaction History/Stock Ledger?

## Testing

To test if the backend is processing events correctly:

1. **Edit an item quantity** in the mobile app (e.g., change from 5 to 7)
2. **Check backend logs** for event processing
3. **Query Transfer In item** to verify `received_qty` was updated:
   ```sql
   SELECT item_code, received_qty, carton_id 
   FROM tabTransferInItem 
   WHERE parent = 'INSLIP-123458' AND item_code = 'SKU-JACKET-201-BLK-M'
   ```
4. **Check Transaction History** to verify the change was logged

## Expected Behavior

After editing quantity in mobile app:

1. ✅ Event is created with `transfer_in`, `item_code`, `qty` (difference)
2. ✅ Event is synced to backend via `/api/events/batch`
3. ✅ Backend saves event to database (`inserted_count: 1`)
4. ✅ **Backend processes event and updates `received_qty`** (ADD `qty` to existing)
5. ✅ Backend saves to Transaction History
6. ✅ Mobile app reloads Transfer In and shows updated quantity

## Current Issue

**Step 4 is failing** - Events are being saved, but `received_qty` is not being updated in the Transfer In item lines.

## Solution

The backend needs to ensure that `TRANSFER_IN_RECEIVE` events are processed to update `received_qty`, especially for items that already have `carton_id` (since the `receive-line` API rejects these items).
