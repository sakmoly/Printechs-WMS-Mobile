# Transfer In Carton ID Backend Requirements

## Problem Statement

The mobile app is receiving Transfer In items with `carton_id` tracking, but the `carton_id` is not being saved to Transfer In item lines in the backend database. The Carton ID field remains empty in the desktop application's Transfer In Details screen.

## Current Mobile App Implementation

### API Call Structure

The mobile app uses the `/api/transfer-in/{title}/receive-line` endpoint with the following constraint:

**Backend API Validation Rule:**

```
Either (carton_id) OR (item_code + received_qty) must be provided, but not both
```

**Current Mobile App Behavior:**

1. **Item Scanning:** Sends only `item_code + received_qty` (without `carton_id`) to avoid validation error
2. **Event Creation:** Creates `TRANSFER_IN_RECEIVE` events that **include** `carton_id`
3. **Event Sync:** Events are synced via `/api/events/batch` with `carton_id` included

### Event Structure

When items are scanned, the mobile app creates events with this structure:

```json
{
  "event_type": "TRANSFER_IN_RECEIVE",
  "transfer_in": "INSLIP-123462",
  "carton_id": "CTN-12345",
  "item_code": "SKU-HAT-301-RED-OS",
  "qty": 1,
  "device_id": "DEV-001",
  "user_id": "USER-001",
  "event_time": "2025-01-25T10:30:00.000Z",
  "offline_uuid": "uuid-here"
}
```

**Key Fields:**

- `transfer_in`: Transfer In document number (e.g., "INSLIP-123462")
- `carton_id`: Carton ID that the item was received in (e.g., "CTN-12345")
- `item_code`: Item code that was received
- `qty`: Quantity received (incremental, typically 1 per scan)

## Backend Requirements

### 1. Event Processing Logic

When processing `TRANSFER_IN_RECEIVE` events from `/api/events/batch`, the backend MUST:

1. **Extract `carton_id` from each event**
2. **Update the corresponding Transfer In item line** with the `carton_id`
3. **Save `carton_id` to Transaction History** for audit trail

### 2. Implementation Approach

#### Option A: Process During Event Sync (Recommended)

When `/api/events/batch` receives `TRANSFER_IN_RECEIVE` events:

```javascript
// Pseudo-code for event processing
for (const event of events) {
  if (event.event_type === "TRANSFER_IN_RECEIVE") {
    // 1. Update received_qty (existing logic)
    await updateTransferInLine(event.transfer_in, event.item_code, {
      received_qty: event.qty,
    });

    // 2. ✅ NEW: Update carton_id if present
    if (event.carton_id) {
      await updateTransferInLineCartonId(
        event.transfer_in,
        event.item_code,
        event.carton_id
      );
    }

    // 3. ✅ NEW: Save to Transaction History with carton_id
    await createTransactionHistory({
      transfer_in: event.transfer_in,
      item_code: event.item_code,
      carton_id: event.carton_id, // ✅ Include carton_id
      qty: event.qty,
      transaction_type: "TransferIn",
      // ... other fields
    });
  }
}
```

#### Option B: Separate Update Endpoint (Alternative)

If Option A is not feasible, implement a separate endpoint:

```
POST /api/transfer-in/{title}/update-line-carton
```

**Request Body:**

```json
{
  "item_code": "SKU-HAT-301-RED-OS",
  "carton_id": "CTN-12345"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Carton ID updated successfully"
}
```

**Note:** The mobile app already attempts to call this endpoint, but it currently returns 404. If you implement this endpoint, the mobile app will use it automatically.

### 3. Database Update Logic

When processing events, update the Transfer In item lines:

```sql
-- Update carton_id for a specific item in Transfer In
UPDATE tabTransferInItem
SET carton_id = ?
WHERE parent = ? -- Transfer In document name
  AND item_code = ?
  AND carton_id IS NULL; -- Only update if not already set (or use your logic)
```

**Important Considerations:**

- Handle multiple cartons for the same item (if items can be received in different cartons)
- Preserve existing `carton_id` if already set (or update based on latest event)
- Ensure `carton_id` is saved to Transaction History table

### 4. Transaction History

Ensure `carton_id` is saved to the Transaction History/Stock Ledger:

```sql
-- Example: Insert into transaction history
INSERT INTO tabStockTransaction (
  item_code,
  warehouse,
  qty,
  transaction_type,
  reference_doc, -- Transfer In document
  carton_id, -- ✅ CRITICAL: Include carton_id
  created_by,
  created_on
) VALUES (?, ?, ?, 'TransferIn', ?, ?, ?, ?);
```

## Event Sync Flow

### Current Flow (Mobile App)

1. User scans item → Mobile app calls `/api/transfer-in/{title}/receive-line` (without `carton_id`)
2. Mobile app creates `TRANSFER_IN_RECEIVE` event (with `carton_id`)
3. Event is queued locally
4. Event is synced via `/api/events/batch`
5. **❌ Backend processes event but doesn't extract/update `carton_id`**

### Required Flow (Backend)

1. Mobile app calls `/api/transfer-in/{title}/receive-line` (without `carton_id`)
2. Mobile app creates `TRANSFER_IN_RECEIVE` event (with `carton_id`)
3. Event is synced via `/api/events/batch`
4. **✅ Backend processes event and extracts `carton_id`**
5. **✅ Backend updates Transfer In item line with `carton_id`**
6. **✅ Backend saves `carton_id` to Transaction History**

## Testing Checklist

After implementing the backend changes:

- [ ] Scan item with carton_id → Check Transfer In Details → Carton ID field is populated
- [ ] Receive same item in different carton → Carton ID updates correctly
- [ ] Check Transaction History → `carton_id` is present in records
- [ ] Offline mode → Events queue correctly with `carton_id`
- [ ] Event sync → `carton_id` is processed and saved after sync

## Event Payload Example

Here's a complete example of what the mobile app sends in `/api/events/batch`:

```json
{
  "events": [
    {
      "offline_uuid": "550e8400-e29b-41d4-a716-446655440000",
      "event_type": "TRANSFER_IN_RECEIVE",
      "transfer_in": "INSLIP-123462",
      "carton_id": "CTN-12345",
      "item_code": "SKU-HAT-301-RED-OS",
      "qty": 1,
      "device_id": "DEV-001",
      "user_id": "USER-001",
      "event_time": "2025-01-25T10:30:00.000Z"
    }
  ]
}
```

## Multiple Cartons Support

The mobile app supports receiving items from multiple cartons:

- User scans Carton A → Receives items
- User changes carton → Scans Carton B → Receives more items
- Each event includes the `carton_id` for that specific scan

**Backend Handling:**

- If an item can be received in multiple cartons, decide on strategy:
  - **Option 1:** Store the latest `carton_id` (overwrite)
  - **Option 2:** Store all `carton_id`s (comma-separated or separate records)
  - **Option 3:** Store `carton_id` per quantity (if tracking qty per carton)

## Priority

**HIGH PRIORITY** - This is blocking the Carton ID from appearing in Transfer In Details, which is required for proper inventory tracking and audit trail.

## Questions for Backend Team

1. Can items be received in multiple cartons? If yes, how should we handle multiple `carton_id`s?
2. Should `carton_id` overwrite existing value or only set if NULL?
3. Is there a separate Transaction History table, or is it part of Stock Ledger?
4. Should we implement Option A (process from events) or Option B (separate endpoint)?

## Mobile App Code Reference

- **Event Creation:** `src/screens/TransferInReceivingScanItemsScreen.tsx` (lines ~277-285)
- **Event Structure:** `src/types/index.ts` (ScanEvent interface)
- **Event Queue:** `src/services/event-queue.service.ts`
- **API Service:** `src/services/api.service.ts` (receiveTransferInLine, updateTransferInLineCarton)

## Summary

The mobile app is correctly tracking `carton_id` in `TRANSFER_IN_RECEIVE` events. The backend needs to:

1. ✅ Extract `carton_id` from `TRANSFER_IN_RECEIVE` events during event sync
2. ✅ Update Transfer In item lines with the `carton_id`
3. ✅ Save `carton_id` to Transaction History

Once implemented, the Carton ID field in Transfer In Details will be populated correctly.
