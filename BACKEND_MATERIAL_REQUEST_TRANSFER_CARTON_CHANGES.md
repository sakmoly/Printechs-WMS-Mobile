# Backend Changes Required for Material Request Transfer Carton

## Overview

The mobile app now sends Material Request numbers in the `to_no`/`transfer_order` field instead of `null` to help track Material Request transfer outs. The `asn_no`/`advance_shipping_notice` field uses "OutSlip" + Material Request number format (e.g., "OutSlipMR-0001") to ensure uniqueness and avoid duplicate issues. This document outlines the backend changes needed to support this.

## Current Mobile App Behavior

### What the Mobile App Sends:

When creating a Transfer Carton for a Material Request, the mobile app now sends:

```json
{
  "tc_id": "TC-MR-0001-1234567890",
  "advance_shipping_notice": null, // Must be null for Material Requests (backend validation requirement)
  "transfer_order": "MR-0001", // Material Request number (NEW)
  "asn_no": null, // Must be null for Material Requests (backend validation requirement)
  "to_no": "MR-0001", // Material Request number (NEW)
  "store": "SHOWROOM-001",
  "created_by": "USER-003",
  "user_id": "USER-003",
  "material_request": "MR-0001" // Additional field for reference
}
```

### Key Changes:

- ✅ `asn_no` / `advance_shipping_notice`: **`null`** for Material Requests (backend validation requirement)
- ✅ `to_no` / `transfer_order`: **Material Request number** (e.g., "MR-0001") instead of `null`
- ✅ `material_request`: Additional field sent for reference (may not be in backend schema)

### ⚠️ Important Note:

The mobile app sends `null` for `asn_no`/`advance_shipping_notice` to match the backend validation requirements.

**If the database schema doesn't allow NULL:**

- The backend team needs to update the database schema to allow NULL for Material Request transfer cartons
- OR update the validation logic to accept alternative values (like "OutSlipMR-XXXX" format) and handle them appropriately

---

## Backend Changes Required

### 1. Database Schema Updates

#### ✅ `asn_no` Column Solution

**Current Mobile App Behavior**: The mobile app sends `null` for `asn_no`/`advance_shipping_notice` to match backend validation requirements.

**Backend Validation**: The backend validation currently requires `null` for Material Request transfer cartons.

**⚠️ CRITICAL: Database Schema Requirement**

If the database schema has a NOT NULL constraint on `asn_no`/`advance_shipping_notice`, the backend team must:

1. **Update the database schema** to allow NULL for Material Request transfer cartons:

   ```sql
   ALTER TABLE `tabtransfercarton`
   MODIFY COLUMN asn_no VARCHAR(50) NULL;

   -- Or if using advance_shipping_notice column
   ALTER TABLE `tabtransfercarton`
   MODIFY COLUMN advance_shipping_notice VARCHAR(50) NULL;
   ```

2. **Update validation logic** to accept `null` for Material Requests:
   - Current validation expects `null` for Material Requests
   - Database must also allow `null` to avoid constraint errors

**Backend Handling**:

The backend should:

1. **Accept `null`** in `asn_no`/`advance_shipping_notice` fields for Material Requests
2. **Ensure database schema allows NULL** for Material Request transfer cartons
3. **Filter/query logic** should distinguish between:
   - Regular Transfer Orders: `asn_no` is NOT NULL
   - Material Request transfers: `asn_no` IS NULL AND `transfer_order` LIKE 'MR-%'

#### Option A: Use Existing `transfer_order` Field (Recommended)

If your `transfer_cartons` table already has a `transfer_order` or `to_no` column:

- **No schema changes needed** if the column accepts string values
- Ensure the column can store Material Request numbers (e.g., "MR-0001")
- Consider adding a check constraint or validation to distinguish between:
  - Regular Transfer Orders: Format like "TO-123456" or numeric
  - Material Requests: Format like "MR-0001"

#### Option B: Add New Column (If Needed)

If you want to explicitly track Material Requests separately:

```sql
ALTER TABLE transfer_cartons
ADD COLUMN material_request VARCHAR(50) NULL;

-- Add index for faster queries
CREATE INDEX idx_transfer_cartons_material_request
ON transfer_cartons(material_request);
```

### 2. Validation Logic Updates

#### Current Validation (Needs Update):

The backend currently validates that `transfer_order` is required, but may not accept Material Request numbers.

#### Updated Validation Required:

```javascript
// Example validation logic (adjust based on your backend language)

function validateTransferCarton(data) {
  // Required fields
  if (!data.tc_id) {
    throw new Error("tc_id is required");
  }

  if (!data.store) {
    throw new Error("store is required");
  }

  if (!data.created_by && !data.user_id) {
    throw new Error("created_by or user_id is required");
  }

  // For Material Requests:
  // - advance_shipping_notice (asn_no) must be null
  // - transfer_order (to_no) should be Material Request number (format: MR-XXXX)
  if (
    data.material_request ||
    (data.transfer_order && data.transfer_order.startsWith("MR-"))
  ) {
    // This is a Material Request Transfer Carton
    if (
      data.advance_shipping_notice !== null &&
      data.advance_shipping_notice !== undefined
    ) {
      throw new Error(
        "advance_shipping_notice (asn_no) must be null for Material Request transfer cartons"
      );
    }

    if (!data.transfer_order || !data.transfer_order.startsWith("MR-")) {
      throw new Error(
        "transfer_order must be a Material Request number (format: MR-XXXX)"
      );
    }
  } else {
    // Regular Transfer Order - validate as before
    if (!data.advance_shipping_notice && !data.asn_no) {
      // May or may not be required depending on your business logic
    }

    if (!data.transfer_order && !data.to_no) {
      throw new Error("transfer_order is required for regular Transfer Orders");
    }
  }
}
```

### 3. API Endpoint Updates

#### POST `/api/transfer-cartons/create`

**Request Body:**

```json
{
  "tc_id": "TC-MR-0001-1234567890",
  "advance_shipping_notice": "OutSlipMR-0001",
  "transfer_order": "MR-0001",
  "asn_no": "OutSlipMR-0001",
  "to_no": "MR-0001",
  "store": "SHOWROOM-001",
  "created_by": "USER-003",
  "user_id": "USER-003",
  "material_request": "MR-0001" // Optional, for reference
}
```

**Backend Should:**

1. Accept `transfer_order` with Material Request format (e.g., "MR-0001")
2. Validate that `advance_shipping_notice` (asn_no) is `null` for Material Requests
3. Store the Material Request number in `transfer_order`/`to_no` column
4. Optionally store `material_request` field if column exists
5. Ensure database schema allows NULL for `asn_no` column (use SQL: `ALTER TABLE tabtransfercarton MODIFY COLUMN asn_no VARCHAR(50) NULL;`)

### 4. Query/Reporting Updates

#### Identify Material Request Transfer Cartons:

```sql
-- Find all Transfer Cartons for Material Requests
SELECT * FROM `tabtransfercarton`
WHERE transfer_order LIKE 'MR-%'
   OR to_no LIKE 'MR-%';

-- Or if you added material_request column:
SELECT * FROM `tabtransfercarton`
WHERE material_request IS NOT NULL;

-- Or by null asn_no (Material Requests have null asn_no):
SELECT * FROM `tabtransfercarton`
WHERE (advance_shipping_notice IS NULL OR asn_no IS NULL)
   AND transfer_order LIKE 'MR-%';
```

#### Distinguish Transfer Types:

```sql
-- Regular Transfer Orders
SELECT * FROM `tabtransfercarton`
WHERE transfer_order NOT LIKE 'MR-%'
  AND (advance_shipping_notice IS NOT NULL OR asn_no IS NOT NULL);

-- Material Request Transfer Outs
SELECT * FROM `tabtransfercarton`
WHERE transfer_order LIKE 'MR-%'
  AND (advance_shipping_notice IS NULL OR asn_no IS NULL);
```

### 5. Business Logic Considerations

#### Material Request Workflow:

1. **Creation**: Transfer Carton created with `transfer_order = "MR-XXXX"` and `asn_no = "OutSlipMR-XXXX"`
2. **Tracking**: Use `transfer_order` to link back to Material Request
3. **Reporting**: Filter/group by Material Request number
4. **Validation**: Ensure Material Request exists and is valid

#### Example: Link Transfer Carton to Material Request

```sql
-- Join with Material Request table (if exists)
SELECT
  tc.tc_id,
  tc.transfer_order AS material_request_number,
  tc.advance_shipping_notice,
  tc.asn_no,
  mr.title,
  mr.status,
  mr.from_warehouse,
  mr.to_showroom
FROM `tabtransfercarton` tc
LEFT JOIN material_requests mr
  ON tc.transfer_order = mr.title
WHERE tc.transfer_order LIKE 'MR-%';
```

---

## Summary of Required Changes

### ✅ Must Have:

1. **Validation Logic**: Accept Material Request numbers in `transfer_order` field
2. **Database**: Ensure `transfer_order`/`to_no` column can store string values like "MR-0001"
3. **API**: Update validation to accept "OutSlip" prefix in `advance_shipping_notice` when `transfer_order` is a Material Request
4. **Query Logic**: Update queries to filter Material Request transfers by "OutSlip" prefix

### 🔄 Recommended:

1. **Database Index**: Add index on `transfer_order` for faster queries
2. **Reporting**: Update reports to distinguish Material Request transfers
3. **Documentation**: Update API documentation to reflect Material Request support
4. **Extraction Logic**: Add helper function to extract MR number from "OutSlipMR-XXXX" format

### 📋 Optional:

1. **New Column**: Add `material_request` column if you want explicit tracking
2. **Constraints**: Add check constraint to validate Material Request format
3. **Foreign Key**: If Material Request table exists, consider foreign key relationship

---

## Testing Checklist

- [ ] Create Transfer Carton with Material Request number in `transfer_order`
- [ ] Verify `advance_shipping_notice` (asn_no) is `null` for Material Requests
- [ ] Verify `transfer_order` contains Material Request number (e.g., "MR-0001")
- [ ] Query Transfer Cartons by Material Request number
- [ ] Query Transfer Cartons by null `asn_no` (Material Requests)
- [ ] Distinguish between regular TO and Material Request transfers in reports
- [ ] Validate that Material Request number format is correct
- [ ] Test backward compatibility with existing Transfer Orders
- [ ] Verify database schema allows NULL for `asn_no` column

---

## Example Backend Code (Node.js/Express)

```javascript
// POST /api/transfer-cartons/create
app.post("/api/transfer-cartons/create", async (req, res) => {
  const {
    tc_id,
    advance_shipping_notice,
    transfer_order,
    store,
    created_by,
    material_request,
  } = req.body;

  // Validate Material Request Transfer Carton
  const isMaterialRequest =
    material_request || (transfer_order && transfer_order.startsWith("MR-"));

  if (isMaterialRequest) {
    // Material Request validation
    if (
      advance_shipping_notice !== null &&
      advance_shipping_notice !== undefined
    ) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message:
          "advance_shipping_notice (asn_no) must be null for Material Request transfer cartons",
      });
    }

    if (!transfer_order || !transfer_order.match(/^MR-\d+$/)) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message:
          "transfer_order must be a valid Material Request number (format: MR-XXXX)",
      });
    }
  }

  // Create Transfer Carton
  const transferCarton = {
    tc_id,
    advance_shipping_notice: advance_shipping_notice || null,
    transfer_order: transfer_order || null,
    to_no: transfer_order, // Backward compatibility
    store,
    created_by: created_by || req.body.user_id,
    material_request: material_request || null,
  };

  // Save to database
  // ... your database logic here

  res.json({ success: true, tc_id: transferCarton.tc_id });
});
```

---

## Questions for Backend Team

1. Does the `tabtransfercarton` table already support string values in `transfer_order`/`to_no`?
2. Is there a `material_requests` table that we should link to?
3. Should we add a new `material_request` column or use `transfer_order` for both?
4. Are there any existing reports/queries that filter by `transfer_order` that need updating?
5. Should Material Request transfers be treated differently in any business logic?
6. Has the database schema been updated to allow NULL for `asn_no` column? (SQL: `ALTER TABLE tabtransfercarton MODIFY COLUMN asn_no VARCHAR(50) NULL;`)

---

**Last Updated**: 2026-01-XX
**Mobile App Version**: Updated to send `null` for `asn_no`/`advance_shipping_notice` and Material Request number in `to_no`/`transfer_order` for Material Requests

## Summary of Required Backend API Modifications

### ✅ Required Changes:

1. **Database Schema Update**:

   ```sql
   ALTER TABLE `tabtransfercarton`
   MODIFY COLUMN asn_no VARCHAR(50) NULL;
   ```

2. **API Validation Update**:

   - Accept `null` for `advance_shipping_notice`/`asn_no` when `transfer_order` starts with "MR-"
   - Validate that Material Request transfer cartons have `asn_no = null`
   - Reject non-null `asn_no` values for Material Requests

3. **Query/Reporting Updates**:
   - Update queries to identify Material Requests by: `transfer_order LIKE 'MR-%' AND asn_no IS NULL`
   - Update reports to distinguish Material Request transfers from regular Transfer Orders

### 📝 Example Backend Validation Code:

```javascript
// Check if this is a Material Request
const isMaterialRequest =
  material_request || (transfer_order && transfer_order.startsWith("MR-"));

if (isMaterialRequest) {
  // Material Request validation
  if (
    advance_shipping_notice !== null &&
    advance_shipping_notice !== undefined
  ) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message:
        "advance_shipping_notice (asn_no) must be null for Material Request transfer cartons",
    });
  }

  if (!transfer_order || !transfer_order.match(/^MR-\d+$/)) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message:
        "transfer_order must be a valid Material Request number (format: MR-XXXX)",
    });
  }
}
```
