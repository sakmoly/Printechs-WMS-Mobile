# Printechs WMS Mobile – Complete API Collection

This document lists **every API endpoint** used by the mobile app (`src/services/api.service.ts`), with HTTP method, path, request/response details, and the corresponding `apiService` method name.

**Base URL:** From app settings (`api_url`). All requests (except login) use header: `Authorization: Bearer <token>`.

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Health / Connection Test](#2-health--connection-test)
3. [Inbound Session](#3-inbound-session)
4. [Cartons & Unload](#4-cartons--unload)
5. [Receive Lines](#5-receive-lines)
6. [Events (Batch Sync)](#6-events-batch-sync)
7. [Boxes](#7-boxes)
8. [Sort Box](#8-sort-box)
9. [Transfer Cartons](#9-transfer-cartons)
10. [ASN & Transfer Order](#10-asn--transfer-order)
11. [Put Away](#11-put-away)
12. [Master Data](#12-master-data)
13. [Transfer In](#13-transfer-in)
14. [Relocation](#14-relocation)
15. [Material Request](#15-material-request)
16. [WMS Picking](#16-wms-picking)
17. [Stock & Stock Ledger](#17-stock--stock-ledger)
18. [Cycle Count](#18-cycle-count)
19. [Warehouses & Stores](#19-warehouses--stores)

---

## 1. Authentication

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| POST | `/api/auth/login` | (internal) | Login – tried first |
| POST | `/api/login` | (internal) | Login – fallback |
| POST | `/api/auth/device-login` | (internal) | Login – fallback |

**Request body (all):**
```json
{
  "user_code": "string",
  "password": "string"
}
```

**Response (any):** Token in one of: `token`, `access_token`, `auth_token`, or `data.token` / `data.access_token` / `data.auth_token`; optional `expires_in` (seconds).

**Exported usage:** `apiService.login(user_code, password)` – uses the same endpoints internally.

---

## 2. Health / Connection Test

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| GET | `/api/health` | (testConnection) | Health check |
| GET | `/api/ping` | (testConnection) | Ping |
| GET | `/` | (testConnection) | Root |

Used when testing server connection; no request body.

---

## 3. Inbound Session

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| POST | `/api/inbound/start` | `startInbound` | Start inbound session |
| POST | `/api/inbound/update` | `updateInboundSession` | Create/update session (UPSERT) |
| POST | `/api/inbound/complete` | (used in flows) | Complete inbound session |

**POST /api/inbound/start**
```json
{
  "asn_no": "string",
  "transfer_order": "string",
  "dock": "string",
  "user_id": "string",
  "device_id": "string"
}
```

**POST /api/inbound/update**
```json
{
  "inbound_session": "string",
  "asn_no": "string",
  "status": "Active" | "Completed" | "Cancelled",
  "completed_cartons": 0,
  "total_cartons": 0,
  "transfer_order": "string",
  "dock": "string",
  "user_id": "string",
  "device_id": "string"
}
```

**POST /api/inbound/complete**
```json
{
  "inbound_session": "string",
  "asn_no": "string",
  "user_id": "string",
  "device_id": "string"
}
```

---

## 4. Cartons & Unload

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| POST | `/api/cartons/update-status` | `updateCartonStatus` | Update carton status(es) |
| POST | `/api/carton/lock` | `lockCarton` | Lock carton (Receiving) |
| POST | `/api/carton/complete` | `completeCarton` | Complete carton (Received) |
| POST | `/api/inbound/unload-line` | `createUnloadLine` | Create one unload line |
| GET | `/api/inbound/unload-lines?parent_title={session}` | `getUnloadLines` | List unload lines for session |

**POST /api/cartons/update-status** – single or batch:
```json
{
  "asn_no": "string",
  "inbound_session": "string",
  "carton_id": "string",
  "status": "Unloaded" | "Receiving" | "Received",
  "user_id": "string",
  "device_id": "string"
}
```
Or batch:
```json
{
  "asn_no": "string",
  "inbound_session": "string",
  "cartons": [ { "carton_id": "string", "status": "string" } ],
  "user_id": "string",
  "device_id": "string"
}
```

**POST /api/carton/lock**
```json
{
  "inbound_session": "string",
  "asn_no": "string",
  "carton_id": "string",
  "user_id": "string",
  "device_id": "string"
}
```

**POST /api/carton/complete** – same body shape as lock.

**POST /api/inbound/unload-line**
```json
{
  "parent_title": "string",
  "unit_type": "CARTON",
  "unit_id": "string",
  "scanned_by": "string",
  "scanned_on": "ISO8601"
}
```

---

## 5. Receive Lines

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| POST | `/api/inbound/receive-line` | `createReceiveLine` | Create one receive line |
| POST | `/api/inbound/receive-lines` | `createReceiveLines` | Batch create receive lines |
| GET | `/api/inbound/receive-lines?parent_title={session}` | `getReceiveLines` | List receive lines for session |

**POST /api/inbound/receive-line**
```json
{
  "parent_title": "string",
  "carton_id": "string",
  "item_code": "string",
  "expected_qty": 0,
  "received_qty": 0,
  "condition": "Good",
  "remarks": null
}
```

**POST /api/inbound/receive-lines**  
Backend should **UPSERT** by (session, carton_id, item_code) and **SET** received_qty (not add).
```json
{
  "parent_title": "string",
  "receive_lines": [
    {
      "carton_id": "string",
      "item_code": "string",
      "expected_qty": 0,
      "received_qty": 0,
      "condition": "Good",
      "remarks": null
    }
  ]
}
```

---

## 6. Events (Batch Sync)

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| POST | `/api/events/batch` | `batchEvents` | Sync offline events |

**Request:**
```json
{
  "events": [
    {
      "offline_uuid": "string",
      "event_type": "UNLOAD_SCAN" | "RECEIVE_ITEM_SCAN" | "SORT_TO_BOX" | "PACK_BOX_TO_TC" | "PACK_ITEM_TO_TC" | "TC_DISPATCH" | "PUTAWAY_ITEM_SCAN" | "PUTAWAY_TO_BOX" | "PUTAWAY_TO_RACK" | "PUTAWAY_DISPATCH" | "TRANSFER_IN_RECEIVE",
      "asn_no": "string",
      "carton_id": "string",
      "event_time": "ISO8601",
      "device_id": "string",
      "user_id": "string",
      "item_code": "string",
      "qty": 0,
      "tc_id": "string"
    }
  ],
  "update_mode": false
}
```

---

## 7. Boxes

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| POST | `/api/boxes/create` | `createBox` | Create box |
| POST | `/api/boxes/close` | `closeBox` | Close box |
| POST | `/api/boxes/reopen` | `reopenBox` | Reopen box |
| POST | `/api/boxes/delete` | `deleteBox` | Delete box |
| GET | `/api/boxes?asn={asn}&store={store}` | `getBoxes` | List boxes (requires `asn` and `store`) |

**POST /api/boxes/create**
```json
{
  "asn_no": "string",
  "to_no": "string",
  "store": "string",
  "purpose": "STORE" | "PUTAWAY",
  "user_id": "string",
  "carton_id": "string",
  "box_id": "string",
  "transfer_in": "string"
}
```

**POST /api/boxes/close** | **/api/boxes/reopen** | **POST /api/boxes/delete**
```json
{ "box_id": "string" }
```

---

## 8. Sort Box

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| POST | `/api/sort-box/create` | `createSortBox` | Create sort box (e.g. Transfer In) |

**Request:**
```json
{
  "box_id": "string",
  "asn_no": "string",
  "transfer_in": "string",
  "store": "string",
  "purpose": "STORE" | "PUTAWAY",
  "user_id": "string",
  "carton_id": "string",
  "to_no": "string"
}
```

---

## 9. Transfer Cartons

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| POST | `/api/transfer-cartons/create` | `createTransferCarton` | Create TC |
| POST | `/api/transfer-cartons/seal` | `sealTransferCarton` | Seal TC |
| POST | `/api/transfer-cartons/dispatch` | `dispatchTransferCarton` | Dispatch TC |
| POST | `/api/transfer-cartons/{tc_id}/add-items` | `addItemsToTransferCarton` | Add items to TC (e.g. MR) |
| GET | `/api/transfer-cartons?asn=&store=&material_request=` | `getTransferCartons` | List TCs |
| GET | `/api/transfer-cartons/{tc_id}` | `getTransferCarton` | Get TC by ID (may 404) |

**POST /api/transfer-cartons/create**
```json
{
  "tc_id": "string",
  "asn_no": "string",
  "to_no": "string",
  "store": "string",
  "user_id": "string",
  "created_by": "string",
  "material_request": "string"
}
```

**POST /api/transfer-cartons/seal**
```json
{ "tc_id": "string", "sealed_by": "string" }
```

**POST /api/transfer-cartons/dispatch**
```json
{ "tc_id": "string", "dispatched_by": "string", "user_id": "string" }
```

**POST /api/transfer-cartons/{tc_id}/add-items**
```json
{
  "items": [
    { "item_code": "string", "qty": 0, "carton_id": "string", "source_bin": "string" }
  ],
  "user_id": "string"
}
```

---

## 10. ASN & Transfer Order

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| GET | `/api/asn/{asn_no}` | `getASN` | ASN details |
| GET | `/api/transfer-order/by-asn/{asn_no}` | `getTransferOrderByASN` | TO by ASN (may 404) |

Path uses exact ASN format (e.g. `ASN-0003`). No body.

---

## 11. Put Away

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| GET | `/api/putaway/remaining-items?asn={asn}` | `getRemainingItems` | Remaining items for putaway |
| POST | `/api/putaway/assign-rack` | `assignRack` | Assign rack/bin to item |
| POST | `/api/putaway/dispatch` | `dispatchPutAway` | Dispatch putaway |
| GET | `/api/putaway/tasks?asn_no=&source_type=&transfer_in=&status=&warehouse=` | `getPutawayTasks` | List putaway tasks |
| POST | `/api/putaway/create-tasks` | `createTaskForRemainingItems` / `createPutawayTaskForTransferIn` | Create tasks (by asn_no or transfer_in) |
| GET | `/api/putaway/tasks/{title}` | `getPutawayTask` | Get task (may 404) |
| POST | `/api/putaway/scan-transfer-carton` | `scanTransferCarton` | Scan carton to location |
| POST | `/api/putaway/complete` | `completePutaway` | Complete putaway |

**POST /api/putaway/assign-rack**
```json
{
  "asn_no": "string",
  "item_code": "string",
  "rack_id": "string",
  "bin_id": "string"
}
```

**POST /api/putaway/dispatch**
```json
{ "tc_id": "string", "asn_no": "string" }
```

**POST /api/putaway/create-tasks**
```json
{ "asn_no": "string" }
```
or
```json
{ "transfer_in": "string" }
```

**POST /api/putaway/scan-transfer-carton**  
(Do not send `rack`; backend uses `location_id`.)
```json
{
  "box_id": "string",
  "putaway_task": "string",
  "bin": "string",
  "location_id": "string",
  "user_id": "string",
  "item_code": "string",
  "tc_id": "string",
  "carton_id": "string",
  "warehouse_id": "string"
}
```

**POST /api/putaway/complete**
```json
{
  "putaway_task": "string",
  "tc_id": "string",
  "box_id": "string",
  "location_id": "string",
  "warehouse": "string",
  "warehouse_id": "string",
  "completed_by": "string",
  "performed_by": "string",
  "items": [
    {
      "item_code": "string",
      "qty": 0,
      "carton_id": "string",
      "box_id": "string",
      "location_id": "string",
      "source_bin": "string",
      "target_bin": "string",
      "completed": true
    }
  ]
}
```

---

## 12. Master Data

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| GET | `/api/master/items` | `pullItemMaster` | Item master |
| GET | `/api/master/asns` | `pullASNData` | ASN list |
| GET | `/api/master/transfer-orders` | `pullTransferOrders` | Transfer orders |
| GET | `/api/master/boxes` | `pullBoxes` | Boxes |
| GET | `/api/master/transfer-cartons` | `pullTransferCartons` | Transfer cartons |
| GET | `/api/master/warehouse-racks` | `pullWarehouseRacks` | Warehouse racks |
| GET | `/api/master/warehouses` | `pullWarehouses` | Warehouses |
| GET | `/api/master/locations` | `pullLocations` | Locations |
| GET | `/api/master/bin-master?limit=&offset=` | `pullBinMaster` | Bin master (paginated) |
| GET | `/api/master/bin-master/{binCode}` | `getBinMaster` | Bin by code |
| GET | `/api/master/stock-ledger` | `pullStockLedger` | Stock ledger snapshot |
| GET | `/api/master/item-barcode-map` | `pullItemBarcodeMap` | Item–barcode map |
| GET | `/api/master/users` | `pullUsers` | Users |
| GET | `/api/master/all` | `pullAllMasterData` | All master in one call |

No request body for GETs. Query params only where shown.

---

## 13. Transfer In

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| GET | `/api/transfer-in?status=&from_showroom=&to_warehouse=` | `getTransferIns` | List transfer ins |
| GET | `/api/transfer-in/{title}` | `getTransferIn` | Get one |
| POST | `/api/transfer-in` | `createTransferIn` | Create |
| POST | `/api/transfer-in/{title}/submit` | `submitTransferIn` | Submit |
| POST | `/api/transfer-in/{title}/update-status` | `updateTransferInStatus` | Update status (may 404) |
| POST | `/api/transfer-in/{title}/complete-receiving` | `completeTransferInReceiving` | Complete receiving |
| POST | `/api/transfer-in/{title}/receive-line` | `receiveTransferInLine` | Receive line |
| POST | `/api/transfer-in/{title}/update-line-carton` | `updateTransferInLineCarton` | Set carton for line (may 404) |
| POST | `/api/transfer-in/{transferInNo}/validate-carton` | `validateTransferInCarton` | Validate carton/box (404/400 with CARTON_NOT_FOUND etc.) |

**POST /api/transfer-in/{title}/update-status**
```json
{ "status": "string" }
```

**POST /api/transfer-in/{title}/complete-receiving**
```json
{ "completed_by": "string" }
```

**POST /api/transfer-in/{title}/receive-line**
```json
{
  "carton_id": "string",
  "item_code": "string",
  "received_qty": 0,
  "received_by": "string"
}
```

**POST /api/transfer-in/{title}/update-line-carton**
```json
{ "item_code": "string", "carton_id": "string" }
```

**POST /api/transfer-in/{transferInNo}/validate-carton**  
`carton_id` = BOX ID (e.g. TI-PUT-...).
```json
{ "carton_id": "string" }
```

---

## 14. Relocation

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| POST | `/api/relocation/session/start` | `startRelocationSession` | Start session |
| PUT | `/api/relocation/session/{sessionId}/from` | `setRelocationFrom` | Set from bin/carton |
| PUT | `/api/relocation/session/{sessionId}/to` | `setRelocationTo` | Set to bin/carton |
| GET | `/api/relocation/carton/{cartonId}/contents` | `getCartonContents` | Carton contents (may 404) |
| POST | `/api/relocation/complete-full` | `completeRelocationFull` | Full carton move |
| POST | `/api/relocation/complete-partial` | `completeRelocationPartial` | Partial/merge move |
| POST | `/api/relocation/session/{sessionId}/commit-full` | `commitRelocationFull` | (Deprecated) Commit full |
| POST | `/api/relocation/session/{sessionId}/commit-partial` | `commitRelocationPartial` | (Deprecated) Commit partial |

**POST /api/relocation/session/start**
```json
{
  "mode": "string",
  "warehouse_id": "string",
  "user_id": "string"
}
```

**PUT from/to**
```json
{
  "from_bin": "string",
  "from_carton": "string"
}
```
```json
{
  "to_bin": "string",
  "to_carton": "string"
}
```

**POST /api/relocation/complete-full**
```json
{
  "mode": "FULL_CARTON",
  "warehouse_id": "string",
  "user_id": "string",
  "from_bin": "string",
  "to_bin": "string",
  "from_carton": "string"
}
```

**POST /api/relocation/complete-partial**
```json
{
  "mode": "PARTIAL_ITEMS" | "CARTON_TO_CARTON",
  "warehouse_id": "string",
  "user_id": "string",
  "from_bin": "string",
  "to_bin": "string",
  "from_carton": "string",
  "to_carton": "string",
  "lines": [ { "item_code": "string", "qty": 0 } ]
}
```

---

## 15. Material Request

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| GET | `/api/material-requests?status=&from_warehouse=&to_showroom=` | `getMaterialRequests` | List MRs |
| GET | `/api/material-requests/{title}` | `getMaterialRequest` | Get one MR |
| POST | `/api/material-requests` | `createMaterialRequest` | Create MR |
| POST | `/api/material-requests/{title}/update-status` | `updateMaterialRequestStatus` | Update status |
| GET | `/api/material-requests/{title}/picking-status` | `getMaterialRequestPickingStatus` | Picking status (may 404) |
| POST | `/api/material-requests/{title}/pick-items` | `pickMaterialRequestItems` | Pick items (do not send user_id) |

**POST /api/material-requests/{title}/update-status**
```json
{ "status": "string" }
```

**POST /api/material-requests/{title}/pick-items**
```json
{
  "items": [
    {
      "item_code": "string",
      "picked_qty": 0,
      "source_bin": "string",
      "carton_id": "string"
    }
  ]
}
```
Backend should read user from its own config/session.

---

## 16. WMS Picking

All of these may 404; app handles gracefully (local-only or fallback).

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| POST | `/api/wms/picking/start` | `startPickingSession` | Start picking session |
| POST | `/api/wms/picking/scan-bin` | `scanBin` | Scan bin |
| POST | `/api/wms/picking/scan-carton` | `scanCarton` | Scan carton |
| POST | `/api/wms/picking/scan-item` | `scanItem` | Scan item |
| PUT | `/api/wms/picking/line-qty` | `updateLineQty` | Update line qty |
| POST | `/api/wms/picking/complete` | `completePicking` | Complete picking |
| GET | `/api/wms/picking/session/{sessionId}` | `getPickingSession` | Get session |

**POST /api/wms/picking/start**
```json
{ "material_request_title": "string" }
```

**POST /api/wms/picking/scan-bin**
```json
{ "session_id": "string", "bin_code": "string" }
```

**POST /api/wms/picking/scan-carton**
```json
{ "session_id": "string", "carton_id": "string" }
```

**POST /api/wms/picking/scan-item**
```json
{
  "session_id": "string",
  "item_code": "string",
  "barcode": "string",
  "qty": 0,
  "bin_code": "string",
  "carton_id": "string"
}
```

**PUT /api/wms/picking/line-qty**
```json
{
  "session_id": "string",
  "line_id": "string",
  "qty": 0,
  "reason": "string"
}
```

**POST /api/wms/picking/complete**
```json
{ "session_id": "string" }
```

---

## 17. Stock & Stock Ledger

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| GET | `/api/stock/ledger?item_code=&warehouse=&location=&bin_location=` | `getStockLedger` | Stock ledger (bin_location optional) |
| GET | `/api/stock/ledger?bin_location=&carton_id=&warehouse=&item_code=` | `getStockLedgerByLocation` | Ledger by location (bin_location required) |
| GET | `/api/stock/item/{item_code}/warehouse/{warehouse}` | `getStockByItemAndWarehouse` | Stock by item + warehouse (may 404) |
| GET | `/api/stock-ledger/{item_code}/{warehouse}` | (used in getItemLocations) | Alternative item locations (fallback) |
| POST | `/api/stock/update-by-location` | `updateStockByLocation` | Update stock by location |

**POST /api/stock/update-by-location**
```json
{
  "location_id": "string",
  "item_code": "string",
  "qty": 0
}
```

**getItemLocations(warehouseId, itemCode):** Tries `/api/stock/item/{item_code}/warehouse/{warehouse}` then `/api/stock-ledger/{item_code}/{warehouse}`; returns array of locations or [].

---

## 18. Cycle Count

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| GET | `/api/cycle-count?status=&warehouse=&zone=&count_type=` | `getCycleCounts` | List cycle counts |
| GET | `/api/cycle-count/{title}?carton_id=&counted_by=` | `getCycleCount` | Get one task |
| POST | `/api/cycle-count/{title}/start` | `startCycleCount` | Start task |
| POST | `/api/cycle-count/{title}/count` | `submitCycleCountCounts` | Submit count lines |
| POST | `/api/cycle-count/{title}/update-line` | `updateCycleCountLine` | Update one line |
| POST | `/api/cycle-count/{title}/submit` | `submitCycleCount` | Submit task |
| POST | `/api/cycle-count/{title}/complete` | `completeCycleCount` | Complete task |
| DELETE | `/api/cycle-count/{title}` | `deleteCycleCount` | Delete task (may 404) |
| POST | `/api/cycle-count` | `createCycleCount` | Create task |

**POST /api/cycle-count/{title}/start**
```json
{ "started_by": "string" }
```

**POST /api/cycle-count/{title}/count**  
Backend expects `lineId` (camelCase) for line identification.
```json
{
  "counted_by": "string",
  "lines": [
    {
      "id": 0,
      "lineId": 0,
      "line_id": "string",
      "item_code": "string",
      "barcode": "string",
      "carton_id": "string",
      "actual_qty": 0,
      "counted_qty": 0,
      "bin_location": "string",
      "expected_qty": 0,
      "discrepancy_reason": "string",
      "reason_code": "string",
      "notes": "string"
    }
  ]
}
```

**POST /api/cycle-count/{title}/update-line**
```json
{
  "line_id": 0,
  "actual_qty": 0,
  "counted_by": "string",
  "discrepancy_reason": "string"
}
```

**POST /api/cycle-count**
```json
{
  "title": "string",
  "bin_code": "string",
  "bin_id": "string",
  "warehouse": "string",
  "warehouse_id": "string",
  "count_type": "string",
  "count_date": "YYYY-MM-DD",
  "is_blind_count": true,
  "opening_stock": true,
  "is_opening_stock": true,
  "created_by": "string",
  "lines": []
}
```

---

## 19. Warehouses & Stores

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| GET | `/api/warehouses/stores` | `getWarehousesAndStores` | Warehouses and stores |

No body. Response typically: `{ "warehouses": [], "stores": [] }` or similar.

---

## Summary Table (All Endpoints)

| # | Method | Path |
|---|--------|------|
| 1 | POST | /api/auth/login |
| 2 | POST | /api/login |
| 3 | POST | /api/auth/device-login |
| 4 | GET | /api/health |
| 5 | GET | /api/ping |
| 6 | GET | / |
| 7 | POST | /api/inbound/start |
| 8 | POST | /api/inbound/update |
| 9 | POST | /api/inbound/complete |
| 10 | POST | /api/cartons/update-status |
| 11 | POST | /api/carton/lock |
| 12 | POST | /api/carton/complete |
| 13 | POST | /api/inbound/unload-line |
| 14 | GET | /api/inbound/unload-lines |
| 15 | POST | /api/inbound/receive-line |
| 16 | POST | /api/inbound/receive-lines |
| 17 | GET | /api/inbound/receive-lines |
| 18 | POST | /api/events/batch |
| 19 | POST | /api/boxes/create |
| 20 | POST | /api/boxes/close |
| 21 | POST | /api/boxes/reopen |
| 22 | POST | /api/boxes/delete |
| 23 | GET | /api/boxes |
| 24 | POST | /api/sort-box/create |
| 25 | POST | /api/transfer-cartons/create |
| 26 | POST | /api/transfer-cartons/seal |
| 27 | POST | /api/transfer-cartons/dispatch |
| 28 | POST | /api/transfer-cartons/{tc_id}/add-items |
| 29 | GET | /api/transfer-cartons |
| 30 | GET | /api/transfer-cartons/{tc_id} |
| 31 | GET | /api/asn/{asn_no} |
| 32 | GET | /api/transfer-order/by-asn/{asn_no} |
| 33 | GET | /api/putaway/remaining-items |
| 34 | POST | /api/putaway/assign-rack |
| 35 | POST | /api/putaway/dispatch |
| 36 | GET | /api/putaway/tasks |
| 37 | POST | /api/putaway/create-tasks |
| 38 | GET | /api/putaway/tasks/{title} |
| 39 | POST | /api/putaway/scan-transfer-carton |
| 40 | POST | /api/putaway/complete |
| 41 | GET | /api/master/items |
| 42 | GET | /api/master/asns |
| 43 | GET | /api/master/transfer-orders |
| 44 | GET | /api/master/boxes |
| 45 | GET | /api/master/transfer-cartons |
| 46 | GET | /api/master/warehouse-racks |
| 47 | GET | /api/master/warehouses |
| 48 | GET | /api/master/locations |
| 49 | GET | /api/master/bin-master |
| 50 | GET | /api/master/bin-master/{binCode} |
| 51 | GET | /api/master/stock-ledger |
| 52 | GET | /api/master/item-barcode-map |
| 53 | GET | /api/master/users |
| 54 | GET | /api/master/all |
| 55 | GET | /api/transfer-in |
| 56 | GET | /api/transfer-in/{title} |
| 57 | POST | /api/transfer-in |
| 58 | POST | /api/transfer-in/{title}/submit |
| 59 | POST | /api/transfer-in/{title}/update-status |
| 60 | POST | /api/transfer-in/{title}/complete-receiving |
| 61 | POST | /api/transfer-in/{title}/receive-line |
| 62 | POST | /api/transfer-in/{title}/update-line-carton |
| 63 | POST | /api/transfer-in/{transferInNo}/validate-carton |
| 64 | POST | /api/relocation/session/start |
| 65 | PUT | /api/relocation/session/{sessionId}/from |
| 66 | PUT | /api/relocation/session/{sessionId}/to |
| 67 | GET | /api/relocation/carton/{cartonId}/contents |
| 68 | POST | /api/relocation/complete-full |
| 69 | POST | /api/relocation/complete-partial |
| 70 | POST | /api/relocation/session/{sessionId}/commit-full |
| 71 | POST | /api/relocation/session/{sessionId}/commit-partial |
| 72 | GET | /api/material-requests |
| 73 | GET | /api/material-requests/{title} |
| 74 | POST | /api/material-requests |
| 75 | POST | /api/material-requests/{title}/update-status |
| 76 | GET | /api/material-requests/{title}/picking-status |
| 77 | POST | /api/material-requests/{title}/pick-items |
| 78 | POST | /api/wms/picking/start |
| 79 | POST | /api/wms/picking/scan-bin |
| 80 | POST | /api/wms/picking/scan-carton |
| 81 | POST | /api/wms/picking/scan-item |
| 82 | PUT | /api/wms/picking/line-qty |
| 83 | POST | /api/wms/picking/complete |
| 84 | GET | /api/wms/picking/session/{sessionId} |
| 85 | GET | /api/stock/ledger |
| 86 | GET | /api/stock/item/{item_code}/warehouse/{warehouse} |
| 87 | GET | /api/stock-ledger/{item_code}/{warehouse} |
| 88 | POST | /api/stock/update-by-location |
| 89 | GET | /api/cycle-count |
| 90 | GET | /api/cycle-count/{title} |
| 91 | POST | /api/cycle-count/{title}/start |
| 92 | POST | /api/cycle-count/{title}/count |
| 93 | POST | /api/cycle-count/{title}/update-line |
| 94 | POST | /api/cycle-count/{title}/submit |
| 95 | POST | /api/cycle-count/{title}/complete |
| 96 | DELETE | /api/cycle-count/{title} |
| 97 | POST | /api/cycle-count |
| 98 | GET | /api/warehouses/stores |

---

**Document version:** 1.0  
**Source:** `src/services/api.service.ts`  
**Last updated:** 2025-01-25
