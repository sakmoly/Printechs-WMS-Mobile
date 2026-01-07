# Transfer Order API Response Format

## Endpoint
`GET /api/transfer-order/by-asn/:asn_no`

## Expected Response Format

The backend should return a Transfer Order object with allocations. The mobile app can handle multiple response formats:

### Format 1: Direct Object (Recommended)
```json
{
  "to_no": "TO-0002",
  "transfer_order": "TO-0002",
  "asn_no": "ASN-0002",
  "allocations": [
    {
      "store": "SR-01",
      "store_code": "SR-01",
      "item_code": "ITEM-0001",
      "allocated_qty": 10,
      "qty": 10
    },
    {
      "store": "SR-02",
      "store_code": "SR-02",
      "item_code": "ITEM-0002",
      "allocated_qty": 5,
      "qty": 5
    }
  ]
}
```

### Format 2: Wrapped in `data`
```json
{
  "data": {
    "to_no": "TO-0002",
    "transfer_order": "TO-0002",
    "asn_no": "ASN-0002",
    "allocations": [...]
  }
}
```

### Format 3: Wrapped in `transfer_order`
```json
{
  "transfer_order": {
    "to_no": "TO-0002",
    "asn_no": "ASN-0002",
    "allocations": [...]
  }
}
```

## Required Fields

### Transfer Order Object
- `to_no` OR `transfer_order` (string): The Transfer Order number (e.g., "TO-0002")
- `asn_no` (string, optional): The ASN number (e.g., "ASN-0002")

### Allocations Array
The `allocations` field should be an array of objects, each containing:
- `store` OR `store_code` (string, **REQUIRED**): Store code (e.g., "SR-01", "SR-02", "WH-MAIN")
- `item_code` (string, **REQUIRED**): Item code
- `allocated_qty` OR `qty` (number): Allocated quantity

## Alternative Field Names Supported

The mobile app will check for allocations in these fields (in order):
1. `allocations` (preferred)
2. `items`
3. `allocation`
4. `line_items`
5. `lines`

## Store Field Names Supported

For each allocation, the app checks for store in this order:
1. `store` (preferred)
2. `store_code`

## Example: Complete Response

```json
{
  "to_no": "TO-0002",
  "transfer_order": "TO-0002",
  "asn_no": "ASN-0002",
  "allocations": [
    {
      "store": "SR-01",
      "item_code": "SKU-JEANS-021-BLU-32",
      "allocated_qty": 50
    },
    {
      "store": "SR-01",
      "item_code": "SKU-SHIRT-001-WHT-M",
      "allocated_qty": 30
    },
    {
      "store": "SR-02",
      "item_code": "SKU-JEANS-021-BLU-34",
      "allocated_qty": 20
    },
    {
      "store": "WH-MAIN",
      "item_code": "SKU-SHIRT-001-WHT-L",
      "allocated_qty": 10
    }
  ]
}
```

## What the Mobile App Does

1. **Fetches TO from API**: Calls `GET /api/transfer-order/by-asn/ASN-0002`
2. **Extracts TO Number**: Gets `to_no` or `transfer_order` from response
3. **Extracts Allocations**: Gets `allocations` array (or `items`, `allocation`, etc.)
4. **Extracts Store Codes**: Gets unique store codes from `store` or `store_code` field in each allocation
5. **Saves to Database**: Saves allocations to `transfer_order_cache` table for future queries
6. **Displays Stores**: Shows each store as a separate section in BoxManagement screen

## Current Issue

If stores are not showing, check:
1. ✅ Is the API returning 200 OK?
2. ✅ Does the response contain `to_no` or `transfer_order`?
3. ✅ Does the response contain an `allocations` array (or `items`, `allocation`, etc.)?
4. ✅ Does each allocation have a `store` or `store_code` field?
5. ✅ Are the store codes valid (e.g., "SR-01", "SR-02", not empty strings)?

## Debugging

The mobile app now logs:
- Full API response (raw and stringified)
- Response type and keys
- Extracted `toData` structure
- Allocations array details
- Store codes extracted from allocations

Check the logs for:
- `📋 Transfer Order API Response (raw):`
- `📦 Extracted allocations:`
- `📦 Store codes from TO allocations:`

