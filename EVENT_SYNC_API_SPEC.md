# Event Sync API Specification

## API Endpoint

**URL:** `POST /api/events/batch`

**Full URL Example:** `http://192.168.1.6:3000/api/events/batch`

**Headers:**
```
Content-Type: application/json
Authorization: Bearer {auth_token}
```

## Request Format

The request body should contain an `events` array with all events to sync:

```json
{
  "events": [
    {
      "offline_uuid": "string (UUID)",
      "event_type": "PACK_BOX_TO_TC",
      "asn_no": "ASN-0004",
      "to_no": "TO-00012",
      "inbound_session": "SESSION-ASN0004-DEVICE001-USER172188",
      "carton_id": null,
      "item_code": null,
      "qty": null,
      "store": "WAREHOUSE",
      "box_id": "BOX-WHMAIN-391259",
      "tc_id": "TC-1766775570711",
      "rack": null,
      "bin": null,
      "device_id": "DEVICE-001",
      "user_id": "USER-172188",
      "event_time": "2025-12-26T19:02:32.337Z"
    }
  ]
}
```

## PACK_BOX_TO_TC Event Example

For Transfer Carton contents, the app sends `PACK_BOX_TO_TC` events. **One event is created per item in the box**, with `carton_id`, `item_code`, and `qty` included. Here's a complete example:

```json
{
  "events": [
    {
      "offline_uuid": "550e8400-e29b-41d4-a716-446655440001",
      "event_type": "PACK_BOX_TO_TC",
      "asn_no": "ASN-0004",
      "to_no": "TO-00012",
      "inbound_session": "SESSION-ASN0004-DEVICE001-USER172188",
      "carton_id": "CTN-0101",
      "item_code": "ITEM-001",
      "qty": 25.00,
      "store": "WAREHOUSE",
      "box_id": "BOX-WHMAIN-391259",
      "tc_id": "TC-1766775570711",
      "rack": null,
      "bin": null,
      "device_id": "DEVICE-001",
      "user_id": "USER-172188",
      "event_time": "2025-12-26T19:02:32.337Z"
    },
    {
      "offline_uuid": "550e8400-e29b-41d4-a716-446655440002",
      "event_type": "PACK_BOX_TO_TC",
      "asn_no": "ASN-0004",
      "to_no": "TO-00012",
      "inbound_session": "SESSION-ASN0004-DEVICE001-USER172188",
      "carton_id": "CTN-0101",
      "item_code": "ITEM-002",
      "qty": 15.00,
      "store": "WAREHOUSE",
      "box_id": "BOX-WHMAIN-391259",
      "tc_id": "TC-1766775570711",
      "rack": null,
      "bin": null,
      "device_id": "DEVICE-001",
      "user_id": "USER-172188",
      "event_time": "2025-12-26T19:02:33.450Z"
    }
  ]
}
```

**Important:** When a box is packed to a Transfer Carton, the app:
1. Queries all items in that box from `scanned_items` table
2. Creates one `PACK_BOX_TO_TC` event per item
3. Each event includes: `carton_id`, `item_code`, `qty`, `box_id`, and `tc_id`

## Expected Response Format

The backend should return a response with `acked` and optionally `failed` arrays:

```json
{
  "acked": [
    "550e8400-e29b-41d4-a716-446655440000",
    "550e8400-e29b-41d4-a716-446655440001"
  ],
  "failed": []
}
```

Or if some events failed:

```json
{
  "acked": [
    "550e8400-e29b-41d4-a716-446655440000"
  ],
  "failed": [
    {
      "uuid": "550e8400-e29b-41d4-a716-446655440001",
      "message": "Error message here"
    }
  ]
}
```

## Field Descriptions

### PACK_BOX_TO_TC Event Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `offline_uuid` | string | Yes | Unique identifier for the event (UUID format) |
| `event_type` | string | Yes | Must be `"PACK_BOX_TO_TC"` |
| `asn_no` | string | Optional | Advance Shipping Notice number (e.g., "ASN-0004") |
| `to_no` | string | Optional | Transfer Order number (e.g., "TO-00012") |
| `inbound_session` | string | Optional | Inbound session identifier |
| `store` | string | Optional | Store code (e.g., "WAREHOUSE", "WH-MAIN") |
| `carton_id` | string | **Required** | Original carton ID where the item came from (e.g., "CTN-0101") |
| `item_code` | string | **Required** | Item code (e.g., "ITEM-001") |
| `qty` | number | **Required** | Quantity of items (e.g., 25.00) |
| `box_id` | string | Optional | Box identifier that was packed (e.g., "BOX-WHMAIN-391259") |
| `tc_id` | string | Optional | Transfer Carton identifier (e.g., "TC-1766775570711") |
| `device_id` | string | Optional | Device identifier |
| `user_id` | string | Optional | User identifier |
| `event_time` | string | Yes | ISO 8601 timestamp when event occurred |

**Note:** 
- `carton_id`, `item_code`, and `qty` are **required** for PACK_BOX_TO_TC events
- These values come from the `scanned_items` table when a box is packed
- One event is created per item in the box
- Fields like `rack`, `bin` are sent as `null` if not applicable

## Backend Processing

The backend should:
1. Accept the batch of events
2. Process `PACK_BOX_TO_TC` events to populate Transfer Carton contents
3. Return the `offline_uuid` of successfully processed events in the `acked` array
4. Return any failed events in the `failed` array with error messages

## Transfer Carton Contents Query

After events are synced, the backend should return Transfer Carton contents when queried:

**GET** `/api/transfer-cartons/{tc_id}`

**Expected Response:**
```json
{
  "ok": true,
  "data": {
    "tc_id": "TC-1766775570711",
    "status": "Sealed",
    "asn_no": "ASN-0004",
    "to_no": "TO-00012",
    "store": "WAREHOUSE",
    "contents": [
      {
        "item_code": "ITEM-001",
        "source_carton": "BOX-WHMAIN-391259",
        "quantity": 10,
        "packed_by": "USER-172188",
        "packed_on": "2025-12-26T19:02:32.337Z"
      }
    ]
  }
}
```

## Testing with Postman/cURL

### cURL Example

```bash
curl -X POST http://192.168.1.6:3000/api/events/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "events": [
      {
        "offline_uuid": "550e8400-e29b-41d4-a716-446655440001",
        "event_type": "PACK_BOX_TO_TC",
        "asn_no": "ASN-0004",
        "to_no": "TO-00012",
        "inbound_session": "SESSION-ASN0004-DEVICE001-USER172188",
        "carton_id": "CTN-0101",
        "item_code": "ITEM-001",
        "qty": 25.00,
        "store": "WAREHOUSE",
        "box_id": "BOX-WHMAIN-391259",
        "tc_id": "TC-1766775570711",
        "device_id": "DEVICE-001",
        "user_id": "USER-172188",
        "event_time": "2025-12-26T19:02:32.337Z"
      }
    ]
  }'
```

### Postman Setup

1. **Method:** POST
2. **URL:** `http://192.168.1.6:3000/api/events/batch`
3. **Headers:**
   - `Content-Type: application/json`
   - `Authorization: Bearer {your_token}`
4. **Body (raw JSON):** Use the example JSON above

## Current Issue

The app is sending events but the backend is returning empty `contents: []` for Transfer Cartons. Please check:

1. Is the `/api/events/batch` endpoint receiving the events?
2. Are `PACK_BOX_TO_TC` events being processed correctly?
3. Is the backend storing the box-to-TC relationship?
4. When querying `/api/transfer-cartons/{tc_id}`, is the backend deriving contents from `PACK_BOX_TO_TC` events?

## Debugging Tips

1. Check backend logs when events are received
2. Verify that `PACK_BOX_TO_TC` events are being stored/processed
3. Check if the backend is filtering events by `event_type`
4. Verify that `tc_id` and `box_id` are being extracted correctly
5. Check if the backend requires additional fields or validation

