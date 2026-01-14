# Material Request Sync Pattern Implementation

## Battle-Tested Pattern: "Scan → Immediately Write to Backend → Desktop + Mobile Always Show Same Quantity"

This document describes the implementation of the sync pattern that ensures consistency between mobile and desktop apps.

---

## ✅ Rule A: Every Scan Creates a Server Event (Idempotent)

### Implementation Status: ✅ COMPLETE

**Mobile App:**
- Each scan generates a unique `offline_uuid` (GUID) using `generateUUID()`
- This UUID is stored in the local `event_queue` table
- When syncing, the `offline_uuid` is sent to the backend as part of the event

**Backend Requirements:**
- Backend should accept `offline_uuid` as `client_event_id` (or map it)
- Backend should use `UNIQUE(client_event_id)` constraint in `tabWmsScanEvent` table
- If the same scan is retried (same `client_event_id`), backend should ignore duplicates safely

**Code Location:**
- `src/services/event-queue.service.ts` - `addEvent()` function generates `offline_uuid`
- `src/services/api.service.ts` - `batchEvents()` sends events with `offline_uuid` to `/api/events/batch`

---

## ✅ Rule B: Backend Updates Carton Qty in a Transaction

### Implementation Status: ⚠️ BACKEND REQUIRED

**Backend Must:**
1. Insert event into `tabWmsScanEvent` with `client_event_id` (from `offline_uuid`)
2. Upsert/increment quantity in `tabTransferCartonItem` (or equivalent table)
3. Return the latest totals to the caller in the response

**Backend Transaction Example:**
```sql
BEGIN TRANSACTION;
  -- Insert event (idempotent - ignore if client_event_id exists)
  INSERT INTO tabWmsScanEvent (client_event_id, event_type, item_code, qty, tc_id, ...)
  VALUES (?, 'PACK_ITEM_TO_TC', ?, 1, ?, ...)
  ON CONFLICT(client_event_id) DO NOTHING;
  
  -- Upsert/increment quantity in transfer carton items
  INSERT INTO tabTransferCartonItem (tc_id, item_code, quantity, ...)
  VALUES (?, ?, 1, ...)
  ON CONFLICT(tc_id, item_code) 
  DO UPDATE SET quantity = quantity + 1;
  
  -- Return latest totals
  SELECT item_code, SUM(quantity) as total_qty 
  FROM tabTransferCartonItem 
  WHERE tc_id = ? 
  GROUP BY item_code;
COMMIT;
```

**Mobile App:**
- Mobile app sends events with `qty: 1` (incremental)
- Backend is responsible for summing these events and returning totals

---

## ✅ Rule C: Desktop & Mobile Sync from Backend

### Implementation Status: ✅ COMPLETE (Polling Pattern)

**Mobile App Implementation:**

1. **After Successful Sync:**
   - Starts polling `GET /api/transfer-cartons/{tc_id}` every 1.5 seconds
   - Polls for maximum 10 times (15 seconds total)
   - Updates Material Request state with backend's authoritative quantities

2. **Polling Logic:**
   - Tries Transfer Carton API first (most accurate - sum of all events)
   - Falls back to Material Request API if Transfer Carton API returns 404
   - Stops polling when:
     - Transfer Carton API returns valid data with items
     - Maximum poll count reached (10 attempts)
     - Timeout reached (15 seconds)

3. **State Updates:**
   - Updates `materialRequest.items[].picked_qty` with backend's authoritative quantity
   - Backend quantity is the source of truth (sum of all events in transaction)

**Code Location:**
- `src/screens/MaterialRequestPackingScreen.tsx` - Lines ~3307-3400
- Polling starts after successful event sync
- Uses `pollingIntervalRef` and `pollingTimeoutRef` for cleanup

**Desktop App:**
- Should implement SignalR/WebSocket for real-time updates (best)
- Or use polling `GET /api/transfer-cartons/{tc_id}` every 1-2 seconds (fallback)

---

## Flow Diagram

```
1. User scans item on mobile
   ↓
2. Mobile creates event with offline_uuid (GUID)
   ↓
3. Mobile sends event to /api/events/batch with offline_uuid
   ↓
4. Backend:
   - Inserts event into tabWmsScanEvent (idempotent via client_event_id)
   - Updates tabTransferCartonItem quantity in transaction
   - Returns latest totals
   ↓
5. Mobile starts polling GET /api/transfer-cartons/{tc_id}
   ↓
6. Backend returns authoritative quantities (sum of all events)
   ↓
7. Mobile updates UI with backend's quantities
   ↓
8. Desktop polls same endpoint (or receives SignalR update)
   ↓
9. Both apps show same quantity ✅
```

---

## API Endpoints

### POST /api/events/batch
**Request:**
```json
{
  "events": [
    {
      "offline_uuid": "a41ad582-0b61-49fb-9cc2-6f6a4fab20d6",
      "event_type": "PACK_ITEM_TO_TC",
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 1,
      "tc_id": "TC-MR-123459-1768206191091",
      "carton_id": "PAW-ASN365425473-1768138301111",
      "material_request": "MR-123459",
      ...
    }
  ],
  "update_mode": false  // Optional: true if updating existing scanned items
}
```

**Response:**
```json
{
  "ok": true,
  "inserted_count": 1,
  "total_count": 1,
  "message": "Events saved successfully"
}
```

### GET /api/transfer-cartons/{tc_id}
**Response:**
```json
{
  "tc_id": "TC-MR-123459-1768206191091",
  "status": "Created",
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "quantity": 6,  // ✅ Sum of all events (authoritative)
      "source_carton": "PAW-ASN365425473-1768138301111",
      "packed_by": "USER-150526",
      "packed_on": "2026-01-12T19:27:00Z"
    }
  ]
}
```

---

## Key Points

1. **Never Trust Only Local State**: Mobile app always polls backend for authoritative quantities after sync
2. **Backend is Source of Truth**: Backend sums all events in a transaction and returns totals
3. **Idempotency**: `offline_uuid` ensures duplicate scans are safely ignored
4. **Real-time Sync**: Polling ensures mobile app shows correct quantities within 1-2 seconds
5. **Desktop Sync**: Desktop should use SignalR (best) or polling (fallback) to stay in sync

---

## Testing Checklist

- [x] Mobile sends `offline_uuid` with each event
- [x] Mobile polls backend after successful sync
- [x] Mobile updates UI with backend's authoritative quantities
- [ ] Backend implements idempotency via `client_event_id`
- [ ] Backend updates quantities in transaction
- [ ] Backend returns latest totals in response
- [ ] Desktop implements SignalR or polling
- [ ] Both apps show same quantity after scan

---

## Notes

- The mobile app currently uses polling (Rule C fallback) since SignalR is not yet implemented
- Backend must implement Rule B (transaction-based quantity updates) for this pattern to work correctly
- The `offline_uuid` field serves as `client_event_id` for idempotency
