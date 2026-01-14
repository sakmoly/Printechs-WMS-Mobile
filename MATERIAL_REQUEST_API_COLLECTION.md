# Material Request API Collection

This document lists all APIs used for Material Request functionality in the mobile app. Use this to test in Postman.

## Base URL

```
{your_api_url}/api
```

## Authentication

All APIs require Bearer token authentication:

```
Authorization: Bearer {token}
Content-Type: application/json
```

---

## 1. Material Request APIs

### 1.1 GET - List Material Requests

**Endpoint:** `GET /api/material-requests`

**Query Parameters (Optional):**

- `status` - Filter by status (e.g., "Draft", "Submitted", "Picked", "Dispatched")
- `from_warehouse` - Filter by source warehouse (e.g., "WH-MAIN")
- `to_showroom` - Filter by destination showroom (e.g., "STORE-001")

**Example Request:**

```
GET /api/material-requests?status=Submitted&from_warehouse=WH-MAIN
```

**Example Response:**

```json
[
  {
    "title": "MR-123459",
    "status": "Submitted",
    "from_warehouse": "WH-MAIN",
    "to_showroom": "STORE-002",
    "request_date": "2026-01-11",
    "items": [
      {
        "item_code": "SKU-HAT-301-BLU-OS",
        "item_name": "Baseball Cap Blue One Size",
        "requested_qty": 2,
        "picked_qty": 0
      }
    ]
  }
]
```

---

### 1.2 GET - Get Material Request Details

**Endpoint:** `GET /api/material-requests/{title}`

**Path Parameters:**

- `title` - Material Request title (e.g., "MR-123459")

**Example Request:**

```
GET /api/material-requests/MR-123459
```

**Example Response:**

```json
{
  "title": "MR-123459",
  "status": "Submitted",
  "from_warehouse": "WH-MAIN",
  "to_showroom": "STORE-002",
  "request_date": "2026-01-11",
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "item_name": "Baseball Cap Blue One Size",
      "requested_qty": 2,
      "picked_qty": 0
    }
  ]
}
```

---

### 1.3 POST - Create Material Request

**Endpoint:** `POST /api/material-requests`

**Request Body:**

```json
{
  "title": "MR-123460",
  "from_warehouse": "WH-MAIN",
  "to_showroom": "STORE-002",
  "request_date": "2026-01-11",
  "requested_by": "USER-150526",
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "requested_qty": 2
    }
  ]
}
```

**Required Fields:**

- `title` - Material Request title (e.g., "MR-123460") - **REQUIRED**
- `from_warehouse` - Source warehouse (e.g., "WH-MAIN") - **REQUIRED**
- `to_showroom` - Destination showroom (e.g., "STORE-002") - **REQUIRED**
- `request_date` - Request date (e.g., "2026-01-11") - **REQUIRED**
- `requested_by` - User who requested (e.g., "USER-150526") - **REQUIRED**
- `items` - Array of items with `item_code` and `requested_qty` - **REQUIRED**

**Example Response:**

```json
{
  "title": "MR-123460",
  "status": "Draft",
  "message": "Material Request created successfully"
}
```

---

### 1.4 POST - Update Material Request Status

**⚠️ IMPORTANT:** This endpoint may return 404 if not implemented on the backend. Check with your backend team for the correct endpoint.

**Endpoint:** `POST /api/material-requests/{title}/status`

**Path Parameters:**

- `title` - Material Request title (e.g., "MR-123459")

**Request Body:**

```json
{
  "status": "Picked"
}
```

**Status Values:**

- `Draft`
- `Submitted`
- `In Progress`
- `Picked`
- `Dispatched`
- `Cancelled`

**Alternative Endpoints (if above returns 404):**

- `PUT /api/material-requests/{title}` - Update entire Material Request (including status field)
- `PATCH /api/material-requests/{title}` - Partial update
- `POST /api/material-requests/{title}/update` - Alternative update endpoint
- Status may be updated automatically when packing events are synced via `/api/events/batch`

**Example Request:**

```
POST /api/material-requests/MR-123459/status
```

**Example Response (if implemented):**

```json
{
  "title": "MR-123459",
  "status": "Picked",
  "message": "Status updated successfully"
}
```

**Error Response (if not implemented):**

```json
{
  "code": "NOT_FOUND",
  "message": "Route POST /api/material-requests/MR-123459/status not found"
}
```

---

### 1.5 POST - Pick Material Request Items

**Endpoint:** `POST /api/material-requests/{title}/pick-items`

**Path Parameters:**

- `title` - Material Request title (e.g., "MR-123459")

**Request Body:**

```json
{
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "picked_qty": 2,
      "source_bin": "A1-R02-L1-B2",
      "carton_id": "PAW-ASN365425473-1768138301111"
    }
  ],
  "warehouse": "WH-MAIN"
}
```

**Example Request:**

```
POST /api/material-requests/MR-123459/pick-items
```

**Example Response:**

```json
{
  "message": "Items picked successfully",
  "picked_count": 1
}
```

---

## 2. Transfer Carton APIs (for Material Request)

### 2.1 POST - Create Transfer Carton

**Endpoint:** `POST /api/transfer-cartons/create`

**Request Body:**

```json
{
  "tc_id": "TC-MR-123459-1768157787512",
  "asn_no": null,
  "to_no": "MR-123459",
  "store": "STORE-002",
  "user_id": "USER-150526",
  "created_by": "USER-150526",
  "material_request": "MR-123459"
}
```

**Note:**

- `asn_no` should be `null` for Material Requests
- `to_no` should be the Material Request title (e.g., "MR-123459")
- `material_request` field is optional but recommended for tracking

**Example Response:**

```json
{
  "tc_id": "TC-MR-123459-1768157787512",
  "status": "Created",
  "message": "Transfer Carton created successfully"
}
```

---

### 2.2 GET - Get Transfer Cartons

**Endpoint:** `GET /api/transfer-cartons`

**Query Parameters (Optional):**

- `asn` - Filter by ASN number
- `store` - Filter by store (e.g., "STORE-002")
- `material_request` - Filter by Material Request title (e.g., "MR-123459")

**Example Request:**

```
GET /api/transfer-cartons?material_request=MR-123459&store=STORE-002
```

**Example Response:**

```json
[
  {
    "tc_id": "TC-MR-123459-1768157787512",
    "asn_no": null,
    "to_no": "MR-123459",
    "store": "STORE-002",
    "status": "Created",
    "created_by": "USER-150526",
    "created_on": "2026-01-11T21:56:00Z"
  }
]
```

---

### 2.3 POST - Seal Transfer Carton

**Endpoint:** `POST /api/transfer-cartons/seal`

**Request Body:**

```json
{
  "tc_id": "TC-MR-123459-1768157787512",
  "sealed_by": "USER-150526"
}
```

**Example Response:**

```json
{
  "tc_id": "TC-MR-123459-1768157787512",
  "status": "Sealed",
  "message": "Transfer Carton sealed successfully"
}
```

---

### 2.4 POST - Dispatch Transfer Carton

**Endpoint:** `POST /api/transfer-cartons/dispatch`

**Request Body:**

```json
{
  "tc_id": "TC-MR-123459-1768157787512"
}
```

**Example Response:**

```json
{
  "tc_id": "TC-MR-123459-1768157787512",
  "status": "Dispatched",
  "message": "Transfer Carton dispatched successfully"
}
```

---

## 3. Stock & Location APIs

### 3.1 GET - Get Stock by Item and Warehouse

**Endpoint:** `GET /api/stock/item/{item_code}/warehouse/{warehouse}`

**Path Parameters:**

- `item_code` - Item code (e.g., "SKU-HAT-301-BLU-OS")
- `warehouse` - Warehouse code (e.g., "WH-MAIN")

**Example Request:**

```
GET /api/stock/item/SKU-HAT-301-BLU-OS/warehouse/WH-MAIN
```

**Example Response (Grouped Format):**

```json
[
  {
    "bin_location": "A1-R01-L3-B1",
    "total_qty": 146,
    "cartons": [
      {
        "carton_id": "CTN-A1-R01-L3-B1-20260111-162835-760",
        "qty": 146
      }
    ]
  },
  {
    "bin_location": "A1-R02-L1-B2",
    "total_qty": 10,
    "cartons": [
      {
        "carton_id": "PAW-ASN365425473-1768138301111",
        "qty": 10
      }
    ]
  }
]
```

---

### 3.2 GET - Get Bin Master (Validate Bin Location)

**Endpoint:** `GET /api/master/bin-master/{bin_code}`

**Path Parameters:**

- `bin_code` - Bin location code (e.g., "A1-R02-L1-B2")

**Example Request:**

```
GET /api/master/bin-master/A1-R02-L1-B2
```

**Example Response:**

```json
{
  "bin_code": "A1-R02-L1-B2",
  "bin_id": "A1-R02-L1-B2",
  "warehouse_id": "WH-MAIN",
  "zone": "Zone A",
  "aisle": "Aisle 01",
  "rack": "Rack 02",
  "level": "Level 1",
  "bin": "Bin B2"
}
```

---

## 4. Event Sync API

### 4.1 POST - Batch Sync Events

**Endpoint:** `POST /api/events/batch`

**Request Body:**

```json
{
  "events": [
    {
      "offline_uuid": "550e8400-e29b-41d4-a716-446655440001",
      "event_type": "PACK_ITEM_TO_TC",
      "event_time": "2026-01-11T21:56:00Z",
      "device_id": "DEVICE-001",
      "user_id": "USER-150526",
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 2.0,
      "carton_id": "PAW-ASN365425473-1768138301111",
      "tc_id": "TC-MR-123459-1768157787512",
      "transfer_order": "MR-123459",
      "to_no": "MR-123459",
      "material_request": "MR-123459",
      "source_bin": "A1-R02-L1-B2",
      "bin": "A1-R02-L1-B2",
      "location_id": "A1-R02-L1-B2",
      "rack": "A1-R02-L1-B2",
      "store": "STORE-002"
    }
  ]
}
```

**Event Type:** `PACK_ITEM_TO_TC` (for Material Request Packing)

**Required Fields:**

- `event_type`: "PACK_ITEM_TO_TC"
- `item_code`: Item code being packed
- `qty`: Quantity being packed
- `carton_id`: Source carton ID (REQUIRED for carton-level inventory)
- `tc_id`: Transfer Carton ID (REQUIRED)
- `source_bin`: Source bin location (REQUIRED for validation)
- `material_request`: Material Request title (e.g., "MR-123459")
- `to_no`: Material Request title (same as material_request)
- `transfer_order`: Material Request title (same as material_request)
- `store`: Destination store
- `device_id`: Device identifier
- `user_id`: User identifier

**Example Response:**

```json
{
  "ok": true,
  "message": "Events saved successfully",
  "inserted_count": 1,
  "total_count": 1,
  "acked": ["550e8400-e29b-41d4-a716-446655440001"],
  "errors": []
}
```

**Error Response (if validation fails):**

```json
{
  "ok": true,
  "message": "Events saved successfully",
  "inserted_count": 0,
  "total_count": 1,
  "errors": [
    {
      "offline_uuid": "550e8400-e29b-41d4-a716-446655440001",
      "error": "Carton PAW-ASN365425473-1768138301111 not found in bin A1-R02-L1-B2 for item SKU-HAT-301-BLU-OS. Please verify the carton exists at this location."
    }
  ]
}
```

---

## 5. Authentication API

### 5.1 POST - Login

**Endpoint:** `POST /api/auth/login` (or `/api/login` or `/api/auth/device-login`)

**Request Body:**

```json
{
  "user_code": "USER-150526",
  "password": "your_password"
}
```

**Example Response:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 3600
}
```

---

## Material Request Workflow API Sequence

### Complete Workflow:

1. **List Material Requests**

   ```
   GET /api/material-requests?status=Submitted
   ```

2. **Get Material Request Details**

   ```
   GET /api/material-requests/MR-123459
   ```

3. **Get Stock Locations for Items**

   ```
   GET /api/stock/item/SKU-HAT-301-BLU-OS/warehouse/WH-MAIN
   ```

4. **Validate Bin Location**

   ```
   GET /api/master/bin-master/A1-R02-L1-B2
   ```

5. **Create Transfer Carton**

   ```
   POST /api/transfer-cartons/create
   Body: {
     "tc_id": "TC-MR-123459-1768157787512",
     "asn_no": null,
     "to_no": "MR-123459",
     "store": "STORE-002",
     "material_request": "MR-123459",
     "user_id": "USER-150526"
   }
   ```

6. **Sync Packing Events** (after each item scan)

   ```
   POST /api/events/batch
   Body: {
     "events": [
       {
         "event_type": "PACK_ITEM_TO_TC",
         "item_code": "SKU-HAT-301-BLU-OS",
         "qty": 2,
         "carton_id": "PAW-ASN365425473-1768138301111",
         "tc_id": "TC-MR-123459-1768157787512",
         "source_bin": "A1-R02-L1-B2",
         "material_request": "MR-123459",
         "to_no": "MR-123459",
         "store": "STORE-002"
       }
     ]
   }
   ```

7. **Update Material Request Status** (when picking is complete)

   ```
   POST /api/material-requests/MR-123459/update-status
   Body: {
     "status": "Picked"
   }
   ```

8. **Seal Transfer Carton**

   ```
   POST /api/transfer-cartons/seal
   Body: {
     "tc_id": "TC-MR-123459-1768157787512",
     "sealed_by": "USER-150526"
   }
   ```

9. **Dispatch Transfer Carton**

   ```
   POST /api/transfer-cartons/dispatch
   Body: {
     "tc_id": "TC-MR-123459-1768157787512"
   }
   ```

10. **Update Material Request Status** (when dispatched)
    ```
    POST /api/material-requests/MR-123459/update-status
    Body: {
      "status": "Dispatched"
    }
    ```

---

## Important Notes

1. **Carton ID Validation:** The backend validates that the `carton_id` exists at the specified `source_bin` location for the given `item_code`. If validation fails, the event is rejected with an error message.

2. **Event Type:** Use `PACK_ITEM_TO_TC` for Material Request packing events (not `PACK_BOX_TO_TC`).

3. **Transfer Carton:** Must be created before packing events can be synced. The `tc_id` is required in all packing events.

4. **Material Request Field:** The `material_request` field in events should match the Material Request title (e.g., "MR-123459").

5. **Stock API Response:** The stock API returns grouped data by `bin_location` with nested `cartons` array. Each carton has a `carton_id` and `qty`.

6. **Error Handling:** If `inserted_count` is 0 in the batch response, check the `errors` array for validation failures.

7. **⚠️ CRITICAL: Quantity Calculation in Backend:**

   **Mobile App Behavior (After Fix):**

   - Each scan sends an event with `qty: 1` (incremental quantity)
   - Example: 3 scans = 3 events, each with `qty: 1`

   **Backend Must Sum Events:**

   - The backend stores events in `tabwmsscanevent` table
   - When displaying transfer carton contents, the backend MUST sum all events:

   ```sql
   SELECT
     item_code,
     carton_id,
     tc_id,
     SUM(qty) AS total_quantity  -- ✅ Sum all events, not use latest
   FROM tabwmsscanevent
   WHERE event_type = 'PACK_ITEM_TO_TC'
     AND item_code = ?
     AND carton_id = ?
     AND tc_id = ?
   GROUP BY item_code, carton_id, tc_id
   ```

   **Backend Update Required:**

   - If the backend is currently storing cumulative quantities or using the latest event's `qty` value, it needs to be updated to use the SUM query above
   - Each `PACK_ITEM_TO_TC` event represents 1 unit being packed, so all events must be summed to get the total quantity

   **Complete Backend Query for Transfer Carton Contents:**

   The backend API that displays transfer carton details (e.g., `GET /api/transfer-cartons/{tc_id}`) should use this query:

   ```sql
   SELECT
     e.item_code,
     e.carton_id AS source_carton,
     SUM(e.qty) AS quantity,
     MAX(e.user_id) AS packed_by,
     MAX(e.event_time) AS packed_on
   FROM tabwmsscanevent e
   WHERE e.event_type = 'PACK_ITEM_TO_TC'
     AND e.tc_id = ?
     AND e.item_code IS NOT NULL
     AND e.item_code != ''
   GROUP BY e.item_code, e.carton_id
   ORDER BY packed_on DESC
   ```

   **Important Notes:**

   - Use `SUM(e.qty)` to calculate total quantity (each event has `qty: 1`)
   - Group by `item_code` and `carton_id` to show items from different source cartons separately
   - Use `MAX(e.event_time)` for the most recent pack time
   - Use `MAX(e.user_id)` for the user who packed (or use a more sophisticated logic to get the primary packer)
   - Do NOT read from a separate `transfer_carton_items` table if it stores latest values instead of summing

8. **✅ Mobile App Behavior (Verified & Fixed):**

   **Event Flow:**

   - Each item scan creates a `PACK_ITEM_TO_TC` event with `qty: 1` (incremental)
   - Event is saved to local `event_queue` table immediately
   - Event is synced to `/api/events/batch` immediately (no debounce for Material Requests)
   - Backend receives and saves events to `tabwmsscanevent` table
   - Mobile app state is preserved after scanning (not cleared)

   **Verification Steps:**

   1. Check mobile app logs for: `✅ Event synced to backend successfully`
   2. Check backend response: `inserted_count` should be > 0
   3. Events are sent immediately after each scan (no 2-second delay)
   4. Mobile app shows correct scanned quantity (sum of all scans)

   **If Backend Shows Empty:**

   - Verify events exist in `tabwmsscanevent` table with correct `tc_id`
   - Run this query to check:
     ```sql
     SELECT * FROM tabwmsscanevent
     WHERE event_type = 'PACK_ITEM_TO_TC'
       AND tc_id = 'TC-MR-123456-1768218343676'
     ORDER BY event_time DESC
     ```
   - Verify backend API uses SUM query (not latest value)
   - Check that `event_type = 'PACK_ITEM_TO_TC'` in query

---

## Postman Collection Import

You can import this into Postman by creating a new collection and adding these requests. Make sure to:

1. Set the base URL as an environment variable
2. Set the Bearer token in the Authorization header
3. Use the exact field names as shown above
