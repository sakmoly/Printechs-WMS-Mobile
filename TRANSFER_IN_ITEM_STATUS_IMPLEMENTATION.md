# Transfer In Item Status Implementation

## Overview

The backend has implemented a `status` field for Transfer In items to track the receiving progress at the item level. This document describes the implementation, status values, and how the mobile app handles this field.

## Status Values

The `status` field can have three values:

1. **Pending**: Item has not been received yet (`received_qty = 0`)
2. **Picking**: Item is partially received (`0 < received_qty < qty`)
3. **Received**: Item is fully received (`received_qty >= qty`)

## Backend Implementation

### Database Migration

A migration script (`wms-api/add-status-column-to-transfer-in-item.js`) adds the `status` column to the Transfer In items table and updates existing records based on `received_qty`.

### Status Calculation Logic

```javascript
// Status is automatically calculated based on received_qty
if (received_qty === 0) {
  status = "Pending";
} else if (received_qty >= qty) {
  status = "Received";
} else {
  status = "Picking";
}
```

### Status Updates

Status is automatically updated in the following scenarios:

1. **When receiving items via `receive-line` API**:
   - Status changes from "Pending" to "Picking" when first item is received
   - Status changes from "Picking" to "Received" when `received_qty >= qty`

2. **When processing `TRANSFER_IN_RECEIVE` events**:
   - Status is updated in the same transaction as `received_qty`
   - Status calculation happens after `received_qty` is updated

3. **When creating new Transfer In items**:
   - Status is set to "Pending" for all new items

4. **When carton is closed**:
   - Items in the carton may be marked as "Received" if fully received

### API Response Format

All GET endpoints that return Transfer In items now include the `status` field:

```json
{
  "title": "INSLIP-123458",
  "items": [
    {
      "item_code": "SKU-JACKET-201-BLK-M",
      "qty": 10,
      "received_qty": 5,
      "status": "Picking",
      "carton_id": "CTN-12345"
    }
  ]
}
```

## Mobile App Implementation

### Type Definitions

The `TransferIn` interface has been updated to include `status` in items:

```typescript
export interface TransferIn {
  // ... other fields
  items: Array<{
    item_code: string;
    qty: number;
    received_qty?: number;
    carton_id?: string;
    status?: "Pending" | "Picking" | "Received"; // ✅ New field
    line_id?: string | number;
  }>;
}
```

### UI Display

#### TransferInDetailScreen

The detail screen displays status badges for each item:

- **Pending**: Gray badge (#9E9E9E)
- **Picking**: Orange badge (#FF9800)
- **Received**: Green badge (#4CAF50)

If the backend doesn't provide `status`, the mobile app calculates it from `received_qty` as a fallback.

#### TransferInReceivingScanItemsScreen

The receiving screen accepts and stores the `status` field from backend responses, allowing for future UI enhancements to show status during receiving.

### Status Color Mapping

```typescript
function getItemStatusColor(status?: string, receivedQty: number = 0, qty: number = 0): string {
  if (status) {
    switch (status) {
      case "Pending": return "#9E9E9E";
      case "Picking": return "#FF9800";
      case "Received": return "#4CAF50";
      default: return "#9E9E9E";
    }
  }
  // Fallback calculation
  if (receivedQty === 0) return "#9E9E9E"; // Pending
  if (receivedQty >= qty) return "#4CAF50"; // Received
  return "#FF9800"; // Picking
}
```

## Backend Requirements for Event Processing

When processing `TRANSFER_IN_RECEIVE` events, the backend **MUST** update both `received_qty` and `status`:

```javascript
// Pseudo-code for event processing
for (const event of events) {
  if (event.event_type === "TRANSFER_IN_RECEIVE") {
    // 1. Update received_qty (ADDITIVE)
    const currentReceivedQty = await getCurrentReceivedQty(event.transfer_in, event.item_code);
    const newReceivedQty = currentReceivedQty + event.qty;
    
    await updateTransferInLineReceivedQty(
      event.transfer_in,
      event.item_code,
      event.qty  // Add this to existing received_qty
    );

    // 2. ✅ CRITICAL: Update status based on new received_qty
    const itemQty = await getItemQty(event.transfer_in, event.item_code);
    let newStatus;
    if (newReceivedQty === 0) {
      newStatus = "Pending";
    } else if (newReceivedQty >= itemQty) {
      newStatus = "Received";
    } else {
      newStatus = "Picking";
    }
    
    await updateTransferInLineStatus(
      event.transfer_in,
      event.item_code,
      newStatus
    );

    // 3. Update carton_id if present
    if (event.carton_id) {
      await updateTransferInLineCartonId(
        event.transfer_in,
        event.item_code,
        event.carton_id
      );
    }

    // 4. Save to Transaction History
    await createTransactionHistory({
      transfer_in: event.transfer_in,
      item_code: event.item_code,
      carton_id: event.carton_id,
      qty: event.qty,
      status: newStatus, // ✅ Include status in transaction history
      transaction_type: "TransferIn",
      user_id: event.user_id,
      device_id: event.device_id,
      event_time: event.event_time
    });
  }
}
```

## Status Update Rules

### When Receiving Items

1. **First item received** (`received_qty` changes from 0 to > 0):
   - Status: "Pending" → "Picking"

2. **Item fully received** (`received_qty >= qty`):
   - Status: "Picking" → "Received"

3. **Quantity decreased** (if allowed):
   - If `received_qty` becomes 0: Status → "Pending"
   - If `received_qty` becomes < qty: Status → "Picking"
   - If `received_qty` remains >= qty: Status → "Received"

### Transaction Safety

Status updates **MUST** happen in the same database transaction as `received_qty` updates to ensure data consistency:

```sql
BEGIN TRANSACTION;

UPDATE tabTransferInItem
SET 
  received_qty = received_qty + ?,
  status = CASE
    WHEN received_qty + ? = 0 THEN 'Pending'
    WHEN received_qty + ? >= qty THEN 'Received'
    ELSE 'Picking'
  END
WHERE parent = ? AND item_code = ?;

COMMIT;
```

## Testing Checklist

- [ ] Status is set to "Pending" for new Transfer In items
- [ ] Status changes to "Picking" when first item is received
- [ ] Status changes to "Received" when item is fully received
- [ ] Status is included in GET endpoint responses
- [ ] Status is updated when processing `TRANSFER_IN_RECEIVE` events
- [ ] Status updates happen in the same transaction as `received_qty`
- [ ] Status is saved to Transaction History
- [ ] Mobile app displays status correctly in detail screen
- [ ] Mobile app calculates status from `received_qty` if status is missing

## Migration Notes

For existing Transfer In items without status:

1. Run the migration script to add the `status` column
2. Update existing records based on `received_qty`:
   ```sql
   UPDATE tabTransferInItem
   SET status = CASE
     WHEN received_qty = 0 THEN 'Pending'
     WHEN received_qty >= qty THEN 'Received'
     ELSE 'Picking'
   END
   WHERE status IS NULL;
   ```

## Benefits

1. **Better Progress Tracking**: Users can quickly see which items are pending, in progress, or complete
2. **Improved UI**: Status badges provide visual feedback on receiving progress
3. **Data Consistency**: Status is always in sync with `received_qty`
4. **Audit Trail**: Status changes are tracked in Transaction History
5. **Reporting**: Status can be used for reporting and analytics
