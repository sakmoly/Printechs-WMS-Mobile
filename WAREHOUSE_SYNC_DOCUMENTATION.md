# Warehouse Sync Documentation

## Overview

The mobile app syncs warehouse data from the backend `tabwarehouse` table to the local `warehouse_cache` table for offline access.

## Backend API Endpoint

**Endpoint:** `GET /api/master/warehouses`

**Method:** GET

**Authentication:** Bearer token required

**Expected Response Format:**

```json
[
  {
    "warehouse_id": "WH-001",
    "warehouse_name": "Main Warehouse",
    "location": "Building A",
    "is_active": 1,
    "updated_on": "2025-01-15T10:30:00Z"
  },
  {
    "warehouse_id": "WH-002",
    "warehouse_name": "Secondary Warehouse",
    "location": "Building B",
    "is_active": 1,
    "updated_on": "2025-01-15T10:30:00Z"
  }
]
```

**Alternative Response Formats (also supported):**

```json
{
  "data": [
    {
      "warehouse_id": "WH-001",
      "warehouse_name": "Main Warehouse",
      ...
    }
  ]
}
```

or

```json
{
  "items": [
    {
      "warehouse_id": "WH-001",
      "warehouse_name": "Main Warehouse",
      ...
    }
  ]
}
```

## Field Mapping

| Backend Field (tabwarehouse) | Mobile App Field (warehouse_cache) | Required |
|------------------------------|-----------------------------------|----------|
| `warehouse_id` or `name` or `code` | `warehouse_id` | Yes |
| `warehouse_name` or `name` | `warehouse_name` | No |
| `location` | `location` | No |
| `is_active` or `active` | `is_active` (0 or 1) | No (defaults to 1) |
| `updated_on` or `updated_at` or `updatedAt` | `updated_on` | No (defaults to current time) |

## Mobile App Database Schema

The synced data is stored in the `warehouse_cache` table:

```sql
CREATE TABLE IF NOT EXISTS warehouse_cache (
  warehouse_id TEXT PRIMARY KEY,
  warehouse_name TEXT,
  location TEXT,
  is_active INTEGER DEFAULT 1,
  updated_on TEXT
);
```

## Sync Process

1. **Trigger:** Warehouse sync is triggered when:
   - User clicks "Sync" button in Sync Center
   - Master data sync is performed
   - App starts and auto-sync is enabled

2. **Process:**
   - Mobile app calls `GET /api/master/warehouses`
   - Backend returns array of warehouses from `tabwarehouse` table
   - Mobile app inserts/updates records in `warehouse_cache` table
   - Uses `INSERT OR REPLACE` to handle updates

3. **Logging:**
   - Success: `✅ Successfully synced X warehouses from tabwarehouse to warehouse_cache table`
   - Error: `❌ Failed to pull warehouses from tabwarehouse: [error message]`
   - Missing endpoint: `⚠️ Warehouses endpoint (/api/master/warehouses) not implemented (404)`

## Additional Warehouse/Store Sync

The mobile app also syncs warehouses and stores with `warehouse_type` information via:

**Endpoint:** `GET /api/warehouses/stores`

This syncs to the `warehouse_store_cache` table which includes:
- `code` (warehouse/store code)
- `name` (warehouse/store name)
- `warehouse_type` ("Warehouse" or "Store")
- `is_group`
- `parent_warehouse`

This is used for cycle count task creation where the user can select a warehouse of type "Store".

## Backend Implementation Requirements

To ensure `tabwarehouse` data syncs to the mobile app:

1. **Implement the endpoint:**
   ```python
   # Example Flask/FastAPI endpoint
   @app.get("/api/master/warehouses")
   def get_warehouses():
       warehouses = db.query("SELECT * FROM tabwarehouse WHERE is_active = 1")
       return jsonify(warehouses)
   ```

2. **Return the correct format:**
   - Array of warehouse objects
   - Include all required fields: `warehouse_id`, `warehouse_name`, `location`, `is_active`, `updated_on`

3. **Handle authentication:**
   - Require Bearer token in Authorization header
   - Return 401 if token is invalid

4. **Error handling:**
   - Return 404 if endpoint not implemented (mobile app will skip gracefully)
   - Return 500 with error message for other errors

## Verification

To verify warehouse sync is working:

1. Check mobile app logs for:
   - `🔄 Syncing warehouses from tabwarehouse...`
   - `✅ Successfully synced X warehouses from tabwarehouse...`

2. Check mobile app database:
   ```sql
   SELECT * FROM warehouse_cache;
   ```

3. Check Sync Center screen - should show "Warehouses: X synced, 0 failed"

## Troubleshooting

**Issue: No warehouses syncing**
- Check backend endpoint is implemented: `GET /api/master/warehouses`
- Check backend returns data from `tabwarehouse` table
- Check authentication token is valid
- Check mobile app logs for error messages

**Issue: Some warehouses missing**
- Check `is_active` field - mobile app syncs all warehouses, but backend may filter
- Check `updated_on` field - ensure it's included in response
- Check field mapping - ensure backend fields match expected format

**Issue: Warehouse sync fails with 404**
- Backend endpoint not implemented
- Mobile app will skip gracefully and log warning
- Implement the endpoint to enable sync

