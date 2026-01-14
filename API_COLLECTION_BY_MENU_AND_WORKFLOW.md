# API Collection - Organized by Menu and Workflow Order

This document organizes all API endpoints by menu structure and workflow sequence as used in the Printechs WMS Mobile app.

---

## 📋 Table of Contents

1. [Authentication](#authentication)
2. [Start Inbound (Menu #1)](#start-inbound-menu-1)
3. [Unload Workflow](#unload-workflow)
4. [Receive + Sort Workflow](#receive--sort-workflow)
5. [BOX Management (Menu #2)](#box-management-menu-2)
6. [Packing Workflow](#packing-workflow)
7. [Dispatch Workflow](#dispatch-workflow)
8. [Put Away (Menu #3)](#put-away-menu-3)
9. [ASN List (Menu #4)](#asn-list-menu-4)
10. [Remaining Items (Menu #5)](#remaining-items-menu-5)
11. [Transfer In (Menu #6)](#transfer-in-menu-6)
12. [Stock Ledger (Menu #7)](#stock-ledger-menu-7)
13. [Material Request (Menu #8)](#material-request-menu-8)
14. [Cycle Count (Menu #9)](#cycle-count-menu-9)
15. [Sync Center](#sync-center)
16. [Master Data APIs](#master-data-apis)

---

## 🔐 Authentication

**Menu Order:** N/A (Pre-requisite for all workflows)  
**Workflow Order:** Step 0

### POST /api/auth/login
**Alternative Endpoints:**
- `POST /api/login`
- `POST /api/auth/device-login`

**Description:** Authenticate user and get access token

**Request Body:**
```json
{
  "user_code": "USER-001",
  "password": "password123"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 3600
}
```

**Or:**
```json
{
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expires_in": 3600
  }
}
```

**Headers:**
- `Content-Type: application/json`

---

## 🚚 Start Inbound (Menu #1)

**Menu Order:** 1  
**Workflow Order:** Step 1

### GET /api/master/asns
**Description:** Pull list of ASNs (Advance Shipping Notices) from desktop

**Response:**
```json
[
  {
    "asn_no": "ASN-0001",
    "supplier": "SUPPLIER-001",
    "status": "Pending",
    "expected_date": "2025-01-27"
  }
]
```

### GET /api/asn/{asn_no}
**Description:** Get detailed ASN information

**Example:** `GET /api/asn/ASN-0001`

**Response:**
```json
{
  "asn_no": "ASN-0001",
  "supplier": "SUPPLIER-001",
  "transfer_order": "TO-0001",
  "items": [...],
  "cartons": [...]
}
```

### GET /api/transfer-order/by-asn/{asn_no}
**Description:** Get transfer order details by ASN

**Example:** `GET /api/transfer-order/by-asn/ASN-0001`

**Response:**
```json
{
  "to_no": "TO-0001",
  "asn_no": "ASN-0001",
  "allocations": [...]
}
```

### POST /api/inbound/start
**Description:** Start a new inbound session

**Request Body:**
```json
{
  "asn_no": "ASN-0001",
  "transfer_order": "TO-0001",
  "dock": "DOCK-01",
  "user_id": "USER-001",
  "device_id": "DEVICE-001"
}
```

### POST /api/inbound/update
**Description:** Create or update inbound session (UPSERT - safe to call multiple times)

**Request Body:**
```json
{
  "inbound_session": "SESSION-001",
  "asn_no": "ASN-0001",
  "status": "Active",
  "transfer_order": "TO-0001",
  "dock": "DOCK-01",
  "user_id": "USER-001",
  "device_id": "DEVICE-001",
  "total_cartons": 10,
  "completed_cartons": 0
}
```

**Status Values:**
- `"Active"` - Session is active and ready
- `"Receiving"` - Session is in progress
- `"Completed"` - Session is complete
- `"Cancelled"` - Session was cancelled

### GET /api/inbound/sessions
**Description:** Get list of all inbound sessions

**Response:**
```json
[
  {
    "inbound_session": "SESSION-001",
    "asn_no": "ASN-0001",
    "status": "Active",
    "created_on": "2025-01-27T08:00:00.000Z"
  }
]
```

---

## 📦 Unload Workflow

**Menu Order:** N/A (Sub-workflow of Start Inbound)  
**Workflow Order:** Step 2

### POST /api/cartons/update-status
**Description:** Update carton status (used for Unload, Lock, Complete)

**Request Body (Single Carton):**
```json
{
  "asn_no": "ASN-0001",
  "inbound_session": "SESSION-001",
  "carton_id": "CTN-001",
  "status": "Unloaded",
  "user_id": "USER-001",
  "device_id": "DEVICE-001"
}
```

**Request Body (Batch Update):**
```json
{
  "asn_no": "ASN-0001",
  "inbound_session": "SESSION-001",
  "cartons": [
    {
      "carton_id": "CTN-001",
      "status": "Unloaded"
    },
    {
      "carton_id": "CTN-002",
      "status": "Unloaded"
    }
  ],
  "user_id": "USER-001",
  "device_id": "DEVICE-001"
}
```

**Status Values:**
- `"Pending"` - Carton not yet processed
- `"Unloaded"` - Carton has been unloaded
- `"Receiving"` - Carton is being received (locked)
- `"Received"` - Carton receiving is complete

### POST /api/inbound/unload-line
**Description:** Create unload line record (optional - for tracking)

**Request Body:**
```json
{
  "parent_title": "SESSION-001",
  "unit_type": "CARTON",
  "unit_id": "CTN-001",
  "scanned_by": "USER-001",
  "scanned_on": "2025-01-27T08:00:00.000Z"
}
```

### GET /api/inbound/unload-lines
**Description:** Get unload lines for a session

**Query Parameters:**
- `parent_title` (required) - Session ID

**Example:** `GET /api/inbound/unload-lines?parent_title=SESSION-001`

### POST /api/events/batch
**Description:** Batch sync offline events (includes UNLOAD_SCAN events)

**Request Body:**
```json
{
  "events": [
    {
      "offline_uuid": "uuid-123",
      "event_type": "UNLOAD_SCAN",
      "asn_no": "ASN-0001",
      "carton_id": "CTN-001",
      "event_time": "2025-01-27T08:00:00.000Z",
      "device_id": "DEVICE-001",
      "user_id": "USER-001"
    }
  ]
}
```

**Event Types:**
- `UNLOAD_SCAN` - Carton unload scan
- `RECEIVE_ITEM_SCAN` - Item receiving scan
- `SORT_TO_BOX` - Item sorted to box
- `PACK_BOX_TO_TC` - Box packed to transfer carton
- `TC_DISPATCH` - Transfer carton dispatch

---

## 📥 Receive + Sort Workflow

**Menu Order:** N/A (Sub-workflow of Start Inbound)  
**Workflow Order:** Step 3-4

### POST /api/carton/lock
**Description:** Lock carton for receiving (sets status to "Receiving")

**Request Body:**
```json
{
  "inbound_session": "SESSION-001",
  "asn_no": "ASN-0001",
  "carton_id": "CTN-001",
  "user_id": "USER-001",
  "device_id": "DEVICE-001"
}
```

### POST /api/inbound/receive-line
**Description:** Create single receive line (item received from carton)

**Request Body:**
```json
{
  "parent_title": "SESSION-001",
  "carton_id": "CTN-001",
  "item_code": "ITEM-001",
  "expected_qty": 10,
  "received_qty": 10,
  "condition": "Good",
  "remarks": null
}
```

### POST /api/inbound/receive-lines
**Description:** Batch create receive lines (recommended)

**Request Body:**
```json
{
  "parent_title": "SESSION-001",
  "receive_lines": [
    {
      "carton_id": "CTN-001",
      "item_code": "ITEM-001",
      "expected_qty": 10,
      "received_qty": 10,
      "condition": "Good",
      "remarks": null
    },
    {
      "carton_id": "CTN-001",
      "item_code": "ITEM-002",
      "expected_qty": 5,
      "received_qty": 5,
      "condition": "Good",
      "remarks": null
    }
  ]
}
```

### GET /api/inbound/receive-lines
**Description:** Get receive lines for a session

**Query Parameters:**
- `parent_title` (required) - Session ID

**Example:** `GET /api/inbound/receive-lines?parent_title=SESSION-001`

### POST /api/carton/complete
**Description:** Complete carton receiving (sets status to "Received")

**Request Body:**
```json
{
  "inbound_session": "SESSION-001",
  "asn_no": "ASN-0001",
  "carton_id": "CTN-001",
  "user_id": "USER-001",
  "device_id": "DEVICE-001"
}
```

### GET /api/boxes
**Description:** Get boxes for sorting (used in Receive + Sort screen)

**Query Parameters:**
- `asn` (optional) - Filter by ASN
- `store` (optional) - Filter by store code
- `status` (optional) - Filter by status (Open, Filling, Closed)

**Example:** `GET /api/boxes?asn=ASN-0001&store=SR-01&status=Open`

**Response:**
```json
[
  {
    "box_id": "BOX-001",
    "asn_no": "ASN-0001",
    "store": "SR-01",
    "status": "Open",
    "items": [...]
  }
]
```

---

## 📦 BOX Management (Menu #2)

**Menu Order:** 2  
**Workflow Order:** Step 5

### POST /api/boxes/create
**Description:** Create a new BOX

**Request Body:**
```json
{
  "asn_no": "ASN-0001",
  "to_no": "TO-0001",
  "store": "SR-01"
}
```

**Response:**
```json
{
  "box_id": "BOX-001",
  "asn_no": "ASN-0001",
  "store": "SR-01",
  "status": "Open"
}
```

### POST /api/boxes/close
**Description:** Close a BOX (mark as ready for packing)

**Request Body:**
```json
{
  "box_id": "BOX-001"
}
```

### POST /api/boxes/reopen
**Description:** Reopen a closed BOX

**Request Body:**
```json
{
  "box_id": "BOX-001"
}
```

### GET /api/boxes
**Description:** Get list of boxes (see Receive + Sort section for details)

---

## 📋 Packing Workflow

**Menu Order:** N/A (Sub-workflow)  
**Workflow Order:** Step 6

### POST /api/transfer-cartons/create
**Description:** Create a new Transfer Carton (TC)

**Request Body:**
```json
{
  "asn_no": "ASN-0001",
  "to_no": "TO-0001",
  "store": "SR-01",
  "user_id": "USER-001",
  "created_by": "USER-001"
}
```

**Note:** Both `user_id` and `created_by` are supported for compatibility.

**Response:**
```json
{
  "tc_id": "TC-001",
  "asn_no": "ASN-0001",
  "store": "SR-01",
  "status": "Created"
}
```

**Or:**
```json
{
  "data": {
    "tc_id": "TC-001",
    ...
  }
}
```

### GET /api/transfer-cartons
**Description:** Get list of transfer cartons

**Query Parameters:**
- `asn` (optional) - Filter by ASN
- `store` (optional) - Filter by store

**Example:** `GET /api/transfer-cartons?asn=ASN-0001&store=SR-01`

**Response:**
```json
[
  {
    "tc_id": "TC-001",
    "asn_no": "ASN-0001",
    "store": "SR-01",
    "status": "Created",
    "boxes": [...]
  }
]
```

### POST /api/transfer-cartons/seal
**Description:** Seal a transfer carton (mark as ready for dispatch)

**Request Body:**
```json
{
  "tc_id": "TC-001",
  "sealed_by": "USER-001"
}
```

---

## 🚛 Dispatch Workflow

**Menu Order:** N/A (Sub-workflow)  
**Workflow Order:** Step 7

### POST /api/transfer-cartons/dispatch
**Description:** Dispatch a sealed transfer carton

**Request Body:**
```json
{
  "tc_id": "TC-001"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Transfer carton dispatched successfully",
  "tc_id": "TC-001",
  "status": "Dispatched"
}
```

### POST /api/inbound/complete
**Description:** Complete inbound session (all cartons received)

**Request Body:**
```json
{
  "inbound_session": "SESSION-001",
  "asn_no": "ASN-0001",
  "user_id": "USER-001",
  "device_id": "DEVICE-001"
}
```

---

## 🏠 Put Away (Menu #3)

**Menu Order:** 3  
**Workflow Order:** Parallel workflow (can run independently)

### GET /api/putaway/remaining-items
**Description:** Get remaining items that need to be put away

**Query Parameters:**
- `asn` (required) - ASN number

**Example:** `GET /api/putaway/remaining-items?asn=ASN-0001`

**Response:**
```json
[
  {
    "item_code": "ITEM-001",
    "asn_no": "ASN-0001",
    "qty": 10,
    "bin_location": null,
    "status": "Pending"
  }
]
```

### POST /api/putaway/assign-rack
**Description:** Assign rack/bin location to item for putaway

**Request Body:**
```json
{
  "asn_no": "ASN-0001",
  "item_code": "ITEM-001",
  "rack_id": "RACK-001",
  "bin_id": "BIN-001"
}
```

### POST /api/putaway/dispatch
**Description:** Dispatch putaway items (complete putaway task)

**Request Body:**
```json
{
  "tc_id": "TC-001",
  "asn_no": "ASN-0001"
}
```

---

## 📋 ASN List (Menu #4)

**Menu Order:** 4  
**Workflow Order:** Reference/Query only

### GET /api/master/asns
**Description:** Get list of all ASNs (see Start Inbound section)

### GET /api/asn/{asn_no}
**Description:** Get ASN details (see Start Inbound section)

---

## 📦 Remaining Items (Menu #5)

**Menu Order:** 5  
**Workflow Order:** Query/Reference

### GET /api/putaway/remaining-items
**Description:** Get remaining items (see Put Away section)

---

## 🔄 Transfer In (Menu #6)

**Menu Order:** 6  
**Workflow Order:** Independent workflow

### GET /api/master/transfer-ins
**Description:** Get list of transfer in orders

**Query Parameters:**
- `status` (optional) - Filter by status (e.g., "Submitted", "In Transit")
- `from_showroom` (optional) - Filter by source showroom
- `to_warehouse` (optional) - Filter by destination warehouse

**Example:** `GET /api/master/transfer-ins?status=Submitted&to_warehouse=WH-001`

**Response:**
```json
[
  {
    "transfer_in_id": "TI-001",
    "from_showroom": "SR-01",
    "to_warehouse": "WH-001",
    "status": "Submitted",
    "items": [...]
  }
]
```

### GET /api/transfer-in/{transfer_in_id}
**Description:** Get transfer in details

**Example:** `GET /api/transfer-in/TI-001`

---

## 📊 Stock Ledger (Menu #7)

**Menu Order:** 7  
**Workflow Order:** Query/Reference

### GET /api/master/stock-ledger
**Description:** Pull stock ledger data from desktop

**Response:**
```json
[
  {
    "item_code": "ITEM-001",
    "warehouse": "WH-001",
    "bin_location": "BIN-001",
    "qty": 100,
    "updated_on": "2025-01-27T08:00:00.000Z"
  }
]
```

### GET /api/stock-ledger/{item_code}
**Description:** Get stock ledger for specific item

**Example:** `GET /api/stock-ledger/ITEM-001`

---

## 📝 Material Request (Menu #8)

**Menu Order:** 8  
**Workflow Order:** Independent workflow

### GET /api/master/material-requests
**Description:** Get list of material requests

**Query Parameters:**
- `status` (optional) - Filter by status
- `warehouse` (optional) - Filter by warehouse

**Example:** `GET /api/master/material-requests?status=Pending`

### GET /api/material-request/{request_id}
**Description:** Get material request details

**Example:** `GET /api/material-request/MR-001`

### POST /api/material-request/{request_id}/pack
**Description:** Pack material request items into carton

**Request Body:**
```json
{
  "request_id": "MR-001",
  "carton_id": "CTN-001",
  "items": [
    {
      "item_code": "ITEM-001",
      "qty": 10
    }
  ]
}
```

### POST /api/material-request/{request_id}/dispatch
**Description:** Dispatch material request

**Request Body:**
```json
{
  "request_id": "MR-001",
  "carton_id": "CTN-001"
}
```

---

## 🔢 Cycle Count (Menu #9)

**Menu Order:** 9  
**Workflow Order:** Independent workflow

### GET /api/master/cycle-counts
**Description:** Get list of cycle count tasks

**Query Parameters:**
- `status` (optional) - Filter by status (Draft, In Progress, Completed)
- `count_type` (optional) - Filter by type (Directed, Ad-hoc)

**Example:** `GET /api/master/cycle-counts?status=In Progress`

**Response:**
```json
[
  {
    "title": "CC-0001",
    "status": "In Progress",
    "count_type": "Directed",
    "warehouse": "WH-001",
    "total_items": 10,
    "counted_items": 5
  }
]
```

### GET /api/cycle-count/{title}
**Description:** Get cycle count task details

**Query Parameters:**
- `carton_id` (optional) - Filter lines by carton ID
- `counted_by` (optional) - Filter lines by user who counted

**Example:** `GET /api/cycle-count/CC-0001?carton_id=CTN-001&counted_by=USER-001`

**Response:**
```json
{
  "title": "CC-0001",
  "status": "In Progress",
  "warehouse": "WH-001",
  "bin_code": "BIN-001",
  "lines": [
    {
      "id": 1,
      "item_code": "ITEM-001",
      "bin_location": "BIN-001",
      "expected_qty": 50,
      "actual_qty": 48,
      "counted_by": "USER-001"
    }
  ]
}
```

### POST /api/cycle-count/{title}/start
**Description:** Start a cycle count task

**Request Body:**
```json
{
  "started_by": "USER-001"
}
```

**Example:** `POST /api/cycle-count/CC-0001/start`

### POST /api/cycle-count/{title}/count
**Description:** Submit count lines (can be called multiple times)

**Request Body:**
```json
{
  "counted_by": "USER-001",
  "lines": [
    {
      "id": 1,
      "lineId": 1,
      "item_code": "ITEM-001",
      "barcode": "1234567890123",
      "carton_id": "CTN-001",
      "actual_qty": 48,
      "counted_qty": 48,
      "bin_location": "BIN-001",
      "expected_qty": 50,
      "discrepancy_reason": "Found 2 damaged units"
    }
  ]
}
```

**Note:** `lineId` is required. If not provided, backend will match by `item_code`.

### POST /api/cycle-count/{title}/submit
**Description:** Submit cycle count task (all items counted)

**Request Body:**
```json
{}
```

**Example:** `POST /api/cycle-count/CC-0001/submit`

### POST /api/cycle-count/{title}/complete
**Description:** Complete cycle count task (finalize and update stock)

**Request Body:**
```json
{}
```

**Example:** `POST /api/cycle-count/CC-0001/complete`

---

## 🔄 Sync Center

**Menu Order:** N/A (Accessible from header/settings)  
**Workflow Order:** Continuous background process

### POST /api/events/batch
**Description:** Batch sync offline events (see Unload Workflow section)

**Event Types Supported:**
- `UNLOAD_SCAN`
- `RECEIVE_ITEM_SCAN`
- `SORT_TO_BOX`
- `PACK_BOX_TO_TC`
- `TC_DISPATCH`
- `PUTAWAY_ITEM_SCAN`
- `PUTAWAY_TO_BOX`
- `PUTAWAY_TO_RACK`
- `PUTAWAY_DISPATCH`

---

## 📚 Master Data APIs

**Menu Order:** N/A (Background sync)  
**Workflow Order:** Step 0 (Pre-sync) or Background

### GET /api/master/items
**Description:** Pull item master data from desktop

**Response:**
```json
[
  {
    "item_code": "ITEM-001",
    "item_name": "Product Name",
    "barcode": "1234567890123",
    "uom": "PCS"
  }
]
```

### GET /api/master/warehouses
**Description:** Pull warehouses from `tabwarehouse` table

**Response:**
```json
[
  {
    "warehouse_id": "WH-001",
    "warehouse_name": "Main Warehouse",
    "location": "City",
    "is_active": true,
    "updated_on": "2025-01-27T08:00:00.000Z"
  }
]
```

### GET /api/master/warehouses-stores
**Description:** Get warehouses and stores (combined)

**Response:**
```json
{
  "warehouses": [...],
  "stores": [...]
}
```

### GET /api/master/warehouse-racks
**Description:** Pull warehouse racks/bin locations

**Response:**
```json
[
  {
    "rack_id": "RACK-001",
    "warehouse": "WH-001",
    "bin_id": "BIN-001",
    "bin_code": "A1-R01-L1-B1"
  }
]
```

### GET /api/master/bin-master
**Description:** Get bin master data

**Query Parameters:**
- `limit` (optional) - Pagination limit
- `offset` (optional) - Pagination offset

**Example:** `GET /api/master/bin-master?limit=100&offset=0`

### GET /api/master/bin-master/{binCode}
**Description:** Get specific bin details

**Example:** `GET /api/master/bin-master/A1-R01-L1-B1`

### GET /api/master/locations
**Description:** Pull location master data

### GET /api/master/users
**Description:** Pull user master data

**Response:**
```json
[
  {
    "user_id": "USER-001",
    "user_code": "USER-001",
    "user_name": "John Doe",
    "role": "Warehouse Operator"
  }
]
```

### GET /api/master/item-barcode-map
**Description:** Pull item-to-barcode mapping

**Response:**
```json
[
  {
    "item_code": "ITEM-001",
    "barcode": "1234567890123",
    "primary": true
  }
]
```

### GET /api/master/all
**Description:** Pull all master data in one request

**Response:**
```json
{
  "items": [...],
  "warehouses": [...],
  "stores": [...],
  "racks": [...],
  "users": [...]
}
```

---

## 🔄 Complete Inbound Workflow Order

Here's the complete workflow order for reference:

1. **Authentication** → `POST /api/auth/login`
2. **Master Data Sync** → `GET /api/master/*` (Background)
3. **Start Inbound** → `POST /api/inbound/start` or `POST /api/inbound/update`
4. **Unload Cartons** → `POST /api/cartons/update-status` (status: "Unloaded") + `POST /api/events/batch`
5. **Lock Carton** → `POST /api/carton/lock` (status: "Receiving")
6. **Receive Items** → `POST /api/inbound/receive-lines`
7. **Sort to Boxes** → `POST /api/events/batch` (event_type: "SORT_TO_BOX")
8. **Complete Carton** → `POST /api/carton/complete` (status: "Received")
9. **Create/Manage Boxes** → `POST /api/boxes/create`, `POST /api/boxes/close`
10. **Create Transfer Carton** → `POST /api/transfer-cartons/create`
11. **Pack Boxes** → `POST /api/events/batch` (event_type: "PACK_BOX_TO_TC")
12. **Seal Transfer Carton** → `POST /api/transfer-cartons/seal`
13. **Dispatch Transfer Carton** → `POST /api/transfer-cartons/dispatch` + `POST /api/events/batch` (event_type: "TC_DISPATCH")
14. **Complete Inbound Session** → `POST /api/inbound/complete`

---

## 📝 Notes

### Field Name Flexibility
Many endpoints support multiple field names for compatibility:
- `asn_no` / `advance_shipping_notice`
- `to_no` / `transfer_order`
- `user_id` / `created_by` / `started_by`
- `tc_id` - Always used for transfer carton ID

### Authentication
All endpoints (except login) require:
- Header: `Authorization: Bearer <token>`
- Token obtained from login endpoint

### Offline Support
Events are queued locally when offline and synced via:
- `POST /api/events/batch` - Batch sync queued events

### Error Handling
- 404: Endpoint not implemented (gracefully handled)
- 401: Authentication required (auto-retry login)
- 500: Server error (logged with details)

### Demo Mode
When `demo_mode: 1`, API calls return mock data instead of making real requests.

---

## 📦 Postman Collection Format

This document can be converted to Postman collection format (JSON) using the following structure:

```json
{
  "info": {
    "name": "Printechs WMS Mobile API Collection",
    "description": "API endpoints organized by menu and workflow order",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Authentication",
      "item": [
        {
          "name": "Login",
          "request": {
            "method": "POST",
            "header": [...],
            "body": {...}
          }
        }
      ]
    },
    {
      "name": "Start Inbound",
      "item": [...]
    }
  ]
}
```

Would you like me to generate a complete Postman collection JSON file?

---

**Document Version:** 1.0  
**Last Updated:** 2025-01-27  
**Maintained By:** Printechs WMS Mobile Team
