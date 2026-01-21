# Backend Transaction History `qty_before` Error Fix

**Date**: 2026-01-21  
**Status**: ⚠️ **BACKEND FIX REQUIRED**

---

## 🚨 Problem

When completing Transfer In Putaway, the backend is failing to insert audit trail records into `tabTransactionHistory`:

```
[ERROR] [Putaway Event] ⚠️ Could not insert audit trail (tabTransactionHistory) for SKU-HAT-301-BLU-OS
{
  "error": "Field 'qty_before' doesn't have a default value",
  "item_code": "SKU-HAT-301-BLU-OS"
}
```

**Root Cause**: The backend code is inserting into `tabTransactionHistory` without providing the required `qty_before` field.

---

## ✅ Mobile App Status

**The mobile app is NOT responsible for this error.**

The mobile app sends the following data to `POST /api/putaway/complete`:

```json
{
  "box_id": "CTN-TI-123457-20260121-123436-487",
  "carton_id": "CTN-TI-123457-20260121-123436-487",
  "location_id": "A1-R01-L4-B1",
  "warehouse": "WH-MAIN",
  "warehouse_id": "WH-MAIN",
  "items": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "qty": 2,
      "carton_id": "CTN-TI-123457-20260121-123436-487",
      "location_id": "A1-R01-L4-B1",
      "source_bin": "DOCK-01",
      "target_bin": "A1-R01-L4-B1"
    },
    {
      "item_code": "SKU-HAT-301-GRN-OS",
      "qty": 2,
      "carton_id": "CTN-TI-123457-20260121-123436-487",
      "location_id": "A1-R01-L4-B1",
      "source_bin": "DOCK-01",
      "target_bin": "A1-R01-L4-B1"
    }
  ]
}
```

**The mobile app does NOT send:**
- ❌ `qty_before` (this must be calculated by backend from current stock)
- ❌ `qty_after` (this must be calculated by backend)
- ❌ Transaction history data (this is backend's responsibility)

---

## 🔧 Backend Fix Required

The backend must fix the `tabTransactionHistory` insertion in the putaway completion handler.

### Required Changes

**Location**: `putawayController.js` (or equivalent) - Transaction history insertion logic

**Issue**: The backend is inserting transaction history without calculating `qty_before`.

**Fix**: Before inserting into `tabTransactionHistory`, the backend must:

1. **Query current stock** for each item:
   ```javascript
   // Get current stock quantity BEFORE putaway
   const currentStock = await db.query(
     `SELECT stock_qty FROM tabItem WHERE item_code = ?`,
     [item_code]
   );
   const qtyBefore = currentStock?.stock_qty || 0;
   ```

2. **Calculate `qty_after`**:
   ```javascript
   const qtyAfter = qtyBefore + item.qty; // For putaway, stock increases
   ```

3. **Insert transaction history with all required fields**:
   ```javascript
   await db.insert('tabTransactionHistory', {
     item_code: item.item_code,
     transaction_type: 'Putaway',
     reference_doc: putaway_task_title,
     warehouse: warehouse_code,
     qty_before: qtyBefore, // ✅ REQUIRED: Must be provided
     qty_after: qtyAfter,   // ✅ REQUIRED: Must be provided
     qty_change: item.qty,
     location_id: location_id,
     created_by: user_id,
     created_on: new Date(),
     // ... other required fields
   });
   ```

### Alternative: Use Stock Ledger

If the backend already updates `tabStockLedger`, it can query from there:

```javascript
// Get current stock from ledger
const ledgerEntry = await db.query(
  `SELECT SUM(qty) as total_qty 
   FROM tabStockLedger 
   WHERE item_code = ? AND warehouse = ?`,
  [item_code, warehouse]
);
const qtyBefore = ledgerEntry?.total_qty || 0;
```

---

## 📋 Complete Transaction History Record Format

When inserting into `tabTransactionHistory`, ensure all required fields are provided:

```javascript
{
  item_code: "SKU-HAT-301-BLU-OS",
  transaction_type: "Putaway",
  reference_doc: "PUT-20260121-0001",
  warehouse: "WH-MAIN",
  qty_before: 0,        // ✅ REQUIRED: Current stock before putaway
  qty_after: 2,         // ✅ REQUIRED: Stock after putaway (qty_before + qty)
  qty_change: 2,       // ✅ REQUIRED: Quantity change (+2 for putaway)
  location_id: "A1-R01-L4-B1",
  bin_location: "A1-R01-L4-B1",
  carton_id: "CTN-TI-123457-20260121-123436-487",
  created_by: "USER-402498",
  created_on: "2026-01-21T09:51:31.444Z",
  // ... other fields as per schema
}
```

---

## ✅ Verification

After the backend fix, verify:

1. ✅ Transaction history records are created successfully
2. ✅ `qty_before` is populated with correct value (current stock before putaway)
3. ✅ `qty_after` is populated with correct value (stock after putaway)
4. ✅ No more "Field 'qty_before' doesn't have a default value" errors

---

## 📝 Summary

- **Issue**: Backend missing `qty_before` field when inserting transaction history
- **Mobile App**: ✅ No changes required - mobile app correctly sends putaway completion data
- **Backend Fix**: Must calculate `qty_before` from current stock before inserting transaction history
- **Impact**: Transaction history audit trail is incomplete (but stock updates are working correctly)

---

**END**
