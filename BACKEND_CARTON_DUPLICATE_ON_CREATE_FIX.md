# Backend: Fix "Duplicate entry for key unique_carton_asn" on Carton Create

## What the logs show

```
ℹ️ Carton CTN-001 not found, creating new record...
❌ Failed to create carton CTN-001: Duplicate entry 'CTN-001-ASN-0003' for key 'unique_carton_asn'
```

The backend logic is:

1. Look up carton by some key (e.g. `carton_id` + `asn_no`).
2. If "not found", run **INSERT** to create the carton.
3. The INSERT fails with **duplicate key** because a row with `(CTN-001, ASN-0003)` already exists.

So either the **lookup** is wrong (different key/format so the existing row is not found), or the flow should **upsert** instead of "insert only when not found".

## Recommended fix on the backend

### Option A: Upsert (preferred)

When creating/updating a carton for an ASN, use a single **upsert** so both create and update are handled without duplicate errors:

- **MySQL:**  
  `INSERT INTO carton_table (carton_id, asn_no, ...) VALUES (?, ?, ...)  
   ON DUPLICATE KEY UPDATE status = VALUES(status), updated_on = VALUES(updated_on), ...`

- **SQL Server:** MERGE or IF EXISTS ... UPDATE ELSE INSERT.

- **PostgreSQL:**  
  `INSERT INTO carton_table (...) VALUES (...)  
   ON CONFLICT (carton_id, asn_no) DO UPDATE SET ...`

Use the same unique key as the one that triggers `unique_carton_asn` (e.g. `(carton_id, asn_no)`).

### Option B: Fix the lookup, then INSERT or UPDATE

1. **Lookup** the carton by the **exact** same columns that define the unique key (e.g. `carton_id` and `asn_no`), using the same format the mobile sends (e.g. `CTN-001`, `ASN-0003`).
2. If a row is **found** → run **UPDATE** (status, timestamps, etc.).
3. If **not found** → run **INSERT**.

Then "Carton not found" will only happen when the carton really does not exist, and you will not get duplicate key on insert.

## Why this happens

- The mobile (or desktop) may send unload/scan or status updates for cartons that were already created (e.g. when the ASN was loaded or in a previous request).
- The backend should treat "create carton" as "ensure carton exists and update its status" (upsert), not "insert only".

## Summary

| Current behavior | Desired behavior |
|------------------|------------------|
| Not found → INSERT → Duplicate key error | Not found → INSERT; Found → UPDATE, or use one UPSERT for both |

After the fix, you should see no more `Duplicate entry 'CTN-xxx-ASN-xxx' for key 'unique_carton_asn'` when processing unload/carton status from the mobile.
