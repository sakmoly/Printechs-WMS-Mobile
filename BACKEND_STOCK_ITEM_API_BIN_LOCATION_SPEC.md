# Backend API Specification: Stock Item by Warehouse - Bin Location Format

## Issue
The mobile app is displaying "Rack 02-B2" instead of the full location ID "A1-R02-L1-B2" that is shown in the desktop application.

## API Endpoint
```
GET /api/stock/item/{item_code}/warehouse/{warehouse}
```

**Alias:**
```
GET /api/stock-ledger/{item_code}/{warehouse}
```

## Expected Response Format

The mobile app expects the **grouped format** with `bin_location` field containing the **full location ID**.

### Required Response Format

```json
[
  {
    "bin_location": "A1-R02-L1-B2",
    "cartons": [
      {
        "carton_id": "PAW-ASN365425473-1768138301111",
        "qty": 10
      }
    ],
    "total_qty": 10
  }
]
```

### Critical Requirement: `bin_location` Field

The `bin_location` field **MUST** contain the **full location ID** in the format:
- **Format**: `{Zone}{Aisle}-{Rack}-L{Level}-B{Bin}`
- **Example**: `A1-R02-L1-B2`
  - Zone: `A`
  - Aisle: `1` (or `01`)
  - Rack: `02`
  - Level: `1`
  - Bin: `B2`

**NOT acceptable formats:**
- ❌ `Rack 02-B2` (missing Zone-Aisle and Level)
- ❌ `R02-B2` (missing Zone-Aisle and Level)
- ❌ `Rack02-B2` (missing Zone-Aisle and Level)
- ❌ Only `rack` and `bin` fields without `bin_location`

### Current Issue

The backend is currently returning a `bin_location` value like "Rack 02-B2" or constructing it incorrectly from individual fields (rack, bin) instead of using the actual `bin_location` from the database.

### Database Field Reference

The backend should use the `bin_location` field from the stock ledger or carton stock table, which should contain the full location ID format: `A1-R02-L1-B2`.

If the database stores location components separately (zone, aisle, rack, level, bin), they should be concatenated in the correct format:
```
{zone}{aisle}-{rack}-L{level}-B{bin}
```

For example:
- Zone: `A` + Aisle: `1` → `A1`
- Rack: `02`
- Level: `1` → `L1`
- Bin: `B2`
- **Result**: `A1-R02-L1-B2`

## Implementation Check

The backend should verify:
1. ✅ The `bin_location` field contains the full location ID (e.g., "A1-R02-L1-B2")
2. ✅ NOT just "Rack 02-B2" or any partial format
3. ✅ Matches the format shown in the desktop application's "Item Location Breakdown"
4. ✅ The format is consistent across all location entries

## Testing

Test the API endpoint:
```bash
GET /api/stock/item/SKU-HAT-301-GRN-OS/warehouse/WH-MAIN
```

Expected response should have:
```json
{
  "bin_location": "A1-R02-L1-B2",  // ✅ Full location ID
  "cartons": [...],
  "total_qty": 10
}
```

NOT:
```json
{
  "bin_location": "Rack 02-B2",  // ❌ Incorrect format
  ...
}
```

## Impact

- **Mobile App**: Material Request Detail Screen → Stock Locations Modal
- **Display**: Shows bin location ID in the stock locations list
- **User Experience**: Users need to see the full location ID to match with desktop application

## Resolution

The backend team should:
1. Verify the database contains the full `bin_location` in the correct format
2. Ensure the API response includes `bin_location` with the full location ID (e.g., "A1-R02-L1-B2")
3. NOT construct `bin_location` from individual fields unless concatenated correctly
4. Match the format shown in the desktop application
