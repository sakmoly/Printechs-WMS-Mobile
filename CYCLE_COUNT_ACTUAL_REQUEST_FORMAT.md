# Cycle Count Sync - Actual Request Format (Verified)

## ✅ Confirmed: Mobile App Sends This Format

Based on the code in `src/services/cycle-count-sync.service.ts`, the mobile app sends:

### Request URL
```
POST /api/cycle-count/{title}/count
```

### Request Headers
```
Authorization: Bearer <token>
Content-Type: application/json
```

### Request Body (Actual Format)

```json
{
  "counted_by": "USER-001",
  "lines": [
    {
      "id": 1,
      "item_code": "SKU-HAT-301-BLU-OS",
      "barcode": "1234567890123",
      "actual_qty": 5,
      "counted_qty": 5,
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 5,
      "discrepancy_reason": null,
      "reason_code": null,
      "notes": null
    }
  ]
}
```

### Minimal Format (What Backend Actually Needs)

The backend **requires** `item_code`. All other fields are optional:

```json
{
  "counted_by": "USER-001",
  "lines": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",  // ✅ REQUIRED
      "actual_qty": 5,
      "counted_qty": 5
    }
  ]
}
```

### Field Details

| Field | Required | Source | Notes |
|-------|----------|--------|-------|
| `item_code` | ✅ **YES** | `line.item_code` | Backend uses this for matching |
| `barcode` | No | `line.barcode` | Optional, also accepted |
| `actual_qty` | ✅ **YES** | `line.counted_qty` | Counted quantity |
| `counted_qty` | No | `line.counted_qty` | Duplicate of actual_qty |
| `bin_location` | No | `session.bin_code` | Helps backend match |
| `expected_qty` | No | `line.expected_qty` | For new lines |
| `discrepancy_reason` | No | `line.reason_code` or `line.notes` | Variance reason |
| `reason_code` | No | `line.reason_code` | Alternative field |
| `notes` | No | `line.notes` | Alternative field |
| `id` | No | Sequential (1, 2, 3...) | For reference only |

### Code Reference

From `src/services/cycle-count-sync.service.ts` lines 136-147:

```typescript
.map((line, index) => ({
  id: index + 1, // Sequential ID for backend (optional, for reference)
  item_code: line.item_code, // ✅ REQUIRED - Backend uses this for matching
  barcode: line.barcode || null, // Optional - Also accepted by backend
  actual_qty: line.counted_qty,
  counted_qty: line.counted_qty,
  bin_location: session.bin_code, // Help backend match by bin + item
  expected_qty: line.expected_qty || null, // Optional - For new lines
  discrepancy_reason: line.reason_code || line.notes || null,
  reason_code: line.reason_code || null, // Alternative field
  notes: line.notes || null, // Alternative field
}))
```

### Verification

✅ **Confirmed**: The mobile app sends `item_code` in every line  
✅ **Confirmed**: The mobile app sends `actual_qty` and `counted_qty`  
✅ **Confirmed**: The mobile app includes optional fields (barcode, bin_location, etc.)  
✅ **Confirmed**: The format matches backend requirements

### Example with Null Values Removed

If the backend filters out null values, the request would look like:

```json
{
  "counted_by": "USER-001",
  "lines": [
    {
      "id": 1,
      "item_code": "SKU-HAT-301-BLU-OS",
      "barcode": "1234567890123",
      "actual_qty": 5,
      "counted_qty": 5,
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 5
    }
  ]
}
```

### Backend Should Accept

The backend should accept the full format with all fields, including null values. The backend can ignore null/optional fields but must use `item_code` for matching.

