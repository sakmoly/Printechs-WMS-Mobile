# Backend Field Name Mapping - Putaway Tasks

## Database Structure (Actual)

### `tabPutawayTask` Table
- `title` (primary key, e.g., "PUT-20260101-0001")
- `status` (e.g., "Open", "In Progress", "Completed")
- `advance_shipping_notice` (ASN number)
- `transfer_in` (nullable)
- `inbound_session`
- `created_by`
- `created_at` ⚠️ (NOT `created_on`)
- `updated_at`
- `box_id` (if exists)
- `tc_id` (if exists)
- `location_id` (if exists)
- `source_type` (if exists)

### `tabPutawayLine` Table
- `id`
- `parent_title` (foreign key to `tabPutawayTask.title`)
- `carton_id`
- `item_code`
- `qty`
- `rack` (nullable)
- `bin` (nullable)
- `created_at` ⚠️ (NOT `created_on`)
- `updated_at`

## Required API Response Format

The mobile app expects these field names in the API response:

```json
{
  "putaway_task": "PUT-20260101-0001",  // ← Must alias from `title`
  "asn_no": "ASN-12225",                 // ← Must alias from `advance_shipping_notice`
  "created_on": "2026-01-01T10:00:00Z",  // ← Must alias from `created_at`
  "updated_on": "2026-01-01T10:00:00Z", // ← Must alias from `updated_at`
  "box_id": "BOX-WHMAIN-220010",
  "tc_id": null,
  "status": "Open",
  "location_id": "A1-R01-L1-B1",
  "source_type": "Box"
}
```

## Backend SQL Query Fix

### ❌ INCORRECT (Current - Causes SQL Error)
```sql
SELECT 
  pt.title as putaway_task,
  pt.advance_shipping_notice as asn_no,
  pt.created_on,  -- ❌ WRONG: Database has `created_at`, not `created_on`
  ...
FROM tabPutawayTask pt
```

### ✅ CORRECT (Required Fix)
```sql
SELECT 
  pt.title as putaway_task,                    -- ✅ Alias `title` to `putaway_task`
  pt.box_id,
  pt.tc_id,
  pt.advance_shipping_notice as asn_no,        -- ✅ Alias to `asn_no`
  pt.status,
  pt.location_id,                               -- ✅ Include if column exists
  pt.source_type,
  pt.created_at as created_on,                 -- ✅ Alias `created_at` to `created_on`
  pt.updated_at as updated_on,                 -- ✅ Alias `updated_at` to `updated_on`
  pt.created_by,
  pt.inbound_session,
  COUNT(pl.id) as lines_count
FROM tabPutawayTask pt
LEFT JOIN tabPutawayLine pl ON pl.parent_title = pt.title
WHERE pt.status = ?
  AND (pt.advance_shipping_notice = ? OR ? IS NULL)
GROUP BY pt.title, pt.box_id, pt.tc_id, pt.advance_shipping_notice, 
         pt.status, pt.location_id, pt.source_type, pt.created_at, 
         pt.updated_at, pt.created_by, pt.inbound_session
ORDER BY pt.created_at DESC
```

## Field Name Mapping Table

| Database Column | API Response Field | Mobile App Expects | Notes |
|----------------|-------------------|-------------------|-------|
| `title` | `putaway_task` | `putaway_task` or `task_title` | ✅ Must alias |
| `advance_shipping_notice` | `asn_no` | `asn_no` or `advance_shipping_notice` | ✅ Must alias |
| `created_at` | `created_on` | `created_on` or `created_at` | ✅ Must alias |
| `updated_at` | `updated_on` | `updated_on` or `updated_at` | ✅ Must alias |
| `box_id` | `box_id` | `box_id` | ✅ Direct mapping |
| `tc_id` | `tc_id` | `tc_id` | ✅ Direct mapping |
| `status` | `status` | `status` | ✅ Direct mapping |
| `location_id` | `location_id` | `location_id` | ✅ Direct mapping (if exists) |
| `source_type` | `source_type` | `source_type` | ✅ Direct mapping (if exists) |
| `created_by` | `created_by` | `created_by` | ✅ Direct mapping |
| `inbound_session` | `inbound_session` | `inbound_session` | ✅ Direct mapping |

## Mobile App Code Compatibility

The mobile app already handles both field names as fallback:

```typescript
// Mobile app code (PutAwayScreen.tsx line 394)
const taskId = task.putaway_task || task.task_title || task.id || task.task_id;
const asnNo = task.asn_no || task.advance_shipping_notice;
const updatedOn = task.updated_on || task.created_on || new Date().toISOString();
```

So the backend should:
1. **Primary:** Use aliased names (`putaway_task`, `asn_no`, `created_on`, `updated_on`)
2. **Fallback:** The mobile app will also accept original names if aliases are missing

## Required Backend Changes

### 1. Fix SQL Query in `GET /api/putaway/tasks`

**Change:**
- Use `created_at` (not `created_on`) in SELECT
- Alias `created_at AS created_on` in SELECT
- Alias `updated_at AS updated_on` in SELECT
- Alias `title AS putaway_task` in SELECT
- Alias `advance_shipping_notice AS asn_no` in SELECT

### 2. Fix SQL Query in `POST /api/putaway/complete`

**Check:**
- When updating `tabPutawayTask`, use `updated_at` (not `updated_on`)
- When reading from `tabPutawayTask`, alias fields correctly

### 3. Fix SQL Query in `POST /api/putaway/scan-transfer-carton`

**Check:**
- When updating `tabPutawayTask`, use `updated_at` (not `updated_on`)
- When reading from `tabPutawayTask`, alias fields correctly

## Example Corrected Backend Query

```sql
-- GET /api/putaway/tasks endpoint
SELECT 
  pt.title as putaway_task,
  pt.box_id,
  pt.tc_id,
  pt.advance_shipping_notice as asn_no,
  pt.status,
  pt.location_id,
  pt.source_type,
  pt.created_at as created_on,
  pt.updated_at as updated_on,
  pt.created_by,
  pt.inbound_session,
  COUNT(pl.id) as lines_count
FROM tabPutawayTask pt
LEFT JOIN tabPutawayLine pl ON pl.parent_title = pt.title
WHERE pt.status = ?
  AND (pt.advance_shipping_notice = ? OR ? IS NULL)
GROUP BY 
  pt.title, pt.box_id, pt.tc_id, pt.advance_shipping_notice, 
  pt.status, pt.location_id, pt.source_type, 
  pt.created_at, pt.updated_at, pt.created_by, pt.inbound_session
ORDER BY pt.created_at DESC
```

## Summary

**YES, backend needs to be changed:**

1. ✅ Use `created_at` (not `created_on`) in SQL queries
2. ✅ Alias `created_at AS created_on` in SELECT statements
3. ✅ Alias `updated_at AS updated_on` in SELECT statements
4. ✅ Alias `title AS putaway_task` in SELECT statements
5. ✅ Alias `advance_shipping_notice AS asn_no` in SELECT statements

This ensures the API response matches what the mobile app expects while using the correct database column names.

