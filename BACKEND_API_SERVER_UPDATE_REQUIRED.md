# Backend API Server - Complete Update Requirements

## Overview

This document contains **all required changes** for the backend API server to work correctly with the mobile app. Please implement all changes listed below.

---

## 7. Warehouses and Stores Master API (NEW - For Mobile App)

### Endpoint: `GET /api/master/warehouses-stores`

**Purpose:** Fetch all warehouses and stores from the `tabwarehouse` master table for use in box creation and store selection.

### Request Format

No parameters required. Returns all warehouses and stores.

```
GET /api/master/warehouses-stores
```

### Response Format

**Success:**

```json
[
  {
    "code": "STORE-001",
    "name": "Downtown Store",
    "warehouse_type": "Store",
    "is_group": 0,
    "parent_warehouse": null,
    "created_at": "2025-12-23T11:32:15.000Z",
    "updated_at": "2025-12-23T11:32:15.000Z"
  },
  {
    "code": "STORE-002",
    "name": "Mall Store",
    "warehouse_type": "Store",
    "is_group": 0,
    "parent_warehouse": null,
    "created_at": "2025-12-23T11:32:15.000Z",
    "updated_at": "2025-12-23T11:32:15.000Z"
  },
  {
    "code": "STORE-003",
    "name": "Airport Store",
    "warehouse_type": "Store",
    "is_group": 0,
    "parent_warehouse": null,
    "created_at": "2025-12-23T11:32:15.000Z",
    "updated_at": "2025-12-23T11:32:15.000Z"
  },
  {
    "code": "WH-MAIN",
    "name": "Main Warehouse",
    "warehouse_type": "Warehouse",
    "is_group": 0,
    "parent_warehouse": null,
    "created_at": "2025-12-23T11:32:15.000Z",
    "updated_at": "2025-12-23T11:32:15.000Z"
  }
]
```

**Alternative Response Format (if wrapped in object):**

```json
{
  "data": [
    {
      "code": "STORE-001",
      "name": "Downtown Store",
      "warehouse_type": "Store",
      "is_group": 0,
      "parent_warehouse": null
    }
  ]
}
```

### Backend Implementation (Node.js/Express)

```javascript
app.get("/api/master/warehouses-stores", authenticate, async (req, res) => {
  try {
    // Fetch all warehouses and stores from tabwarehouse table
    const warehousesStores = await db.query(
      `SELECT 
        code,
        name,
        warehouse_type,
        is_group,
        parent_warehouse,
        created_at,
        updated_at
      FROM tabwarehouse
      ORDER BY warehouse_type DESC, code ASC`
    );

    res.json(warehousesStores);
  } catch (error) {
    console.error("Error fetching warehouses/stores:", error);
    res.status(500).json({
      code: "DATABASE_ERROR",
      message: "Failed to fetch warehouses and stores",
      details: error.message,
    });
  }
});
```

### Backend Implementation (Python/Flask)

```python
@app.route('/api/master/warehouses-stores', methods=['GET'])
@authenticate
def get_warehouses_stores():
    try:
        # Fetch all warehouses and stores from tabwarehouse table
        warehouses_stores = db.execute(
            """SELECT
                code,
                name,
                warehouse_type,
                is_group,
                parent_warehouse,
                created_at,
                updated_at
            FROM tabwarehouse
            ORDER BY warehouse_type DESC, code ASC"""
        ).fetchall()

        # Convert to list of dictionaries
        result = []
        for row in warehouses_stores:
            result.append({
                'code': row['code'],
                'name': row['name'],
                'warehouse_type': row['warehouse_type'],
                'is_group': row['is_group'],
                'parent_warehouse': row['parent_warehouse'],
                'created_at': row['created_at'].isoformat() if row['created_at'] else None,
                'updated_at': row['updated_at'].isoformat() if row['updated_at'] else None,
            })

        return jsonify(result)
    except Exception as error:
        print(f'Error fetching warehouses/stores: {error}')
        return jsonify({
            'code': 'DATABASE_ERROR',
            'message': 'Failed to fetch warehouses and stores',
            'details': str(error)
        }), 500
```

### Mobile App Behavior

1. **Fetches warehouses/stores** on screen load
2. **Filters by Transfer Order:**
   - If TO exists: Only shows stores whose `code` matches stores in TO allocations
   - If no TO: Only shows warehouses (`warehouse_type = "Warehouse"`)
3. **Uses `code` field** (e.g., "STORE-001", "WH-MAIN") for box creation
4. **Displays `name` field** (e.g., "Downtown Store", "Main Warehouse") in UI if needed

### Database Schema Reference

The `tabwarehouse` table structure:

- `code` (varchar(100), PRIMARY KEY) - Unique identifier (e.g., "STORE-001", "WH-MAIN")
- `name` (varchar(255)) - Display name (e.g., "Downtown Store", "Main Warehouse")
- `warehouse_type` (varchar(50), Nullable) - "Store" or "Warehouse"
- `is_group` (tinyint(1), Nullable) - Whether it's a group
- `parent_warehouse` (varchar(100), Nullable) - Parent warehouse code if hierarchical
- `created_at` (timestamp) - Creation timestamp
- `updated_at` (timestamp) - Last update timestamp

### Testing

```bash
curl -X GET http://your-backend/api/master/warehouses-stores \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Expected Response:**

```json
[
  {
    "code": "STORE-001",
    "name": "Downtown Store",
    "warehouse_type": "Store",
    "is_group": 0,
    "parent_warehouse": null,
    "created_at": "2025-12-23T11:32:15.000Z",
    "updated_at": "2025-12-23T11:32:15.000Z"
  }
]
```

### Notes

- **Authentication:** Requires valid authentication token
- **Ordering:** Results ordered by `warehouse_type DESC` (Warehouse first), then `code ASC`
- **Filtering:** Mobile app filters results based on Transfer Order allocations
- **Code Usage:** The `code` field is used for box creation and store selection

---

## 8. Box Creation API - Warehouse Type Validation (UPDATE REQUIRED)

### Endpoint: `POST /api/boxes/create`

**Issue:** The backend currently validates `to_no` based on hardcoded store name checks (e.g., `store === "WAREHOUSE"`), but the mobile app now uses store codes from the `tabwarehouse` master table (e.g., "WH-MAIN", "STORE-001"). The backend should check the `warehouse_type` from the `tabwarehouse` table instead.

### Current Problem

The backend validation error:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "to_no (or transfer_order) is required for distribution stores"
}
```

This error appears even when creating boxes for warehouses (e.g., "WH-MAIN") because the backend is checking the store code/name instead of the `warehouse_type`.

### Required Backend Update

**The backend MUST:**

1. Look up the store in the `tabwarehouse` table using the `store` field from the request
2. Check the `warehouse_type` column to determine if it's a "Warehouse" or "Store"
3. Only require `to_no` for stores with `warehouse_type = "Store"`
4. Allow empty `to_no` (or NULL) for stores with `warehouse_type = "Warehouse"`

### Backend Implementation (Node.js/Express)

```javascript
app.post("/api/boxes/create", authenticate, async (req, res) => {
  const {
    asn_no,
    to_no, // May be empty string "" for Warehouse boxes
    store, // Store code from tabwarehouse (e.g., "WH-MAIN", "STORE-001")
    purpose,
    user_id,
    created_by,
  } = req.body;

  // Validate required fields
  if (!asn_no || !store || (!user_id && !created_by)) {
    return res.status(400).json({
      code: "VALIDATION_ERROR",
      message:
        "asn_no (or advance_shipping_notice), store, and user_id (or created_by) are required",
    });
  }

  try {
    // Look up store in tabwarehouse table to check warehouse_type
    const storeInfo = await db.query(
      "SELECT warehouse_type FROM tabwarehouse WHERE code = ?",
      [store]
    );

    if (storeInfo.length === 0) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: `Store ${store} not found in warehouse master table`,
      });
    }

    const warehouseType = storeInfo[0].warehouse_type;
    const isWarehouse = warehouseType === "Warehouse";

    // Only validate to_no for stores (warehouse_type = "Store"), not for warehouses
    if (!isWarehouse && (!to_no || to_no.trim() === "")) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message:
          "to_no (or transfer_order) is required for distribution stores",
      });
    }

    // Convert empty string to null for database
    // IMPORTANT: If transfer_order column has NOT NULL constraint, use empty string instead of null
    // Check your database schema - if column allows NULL, use null; otherwise use empty string ""
    const toNoValue = to_no && to_no.trim() !== "" ? to_no.trim() : null;

    // Create box in database
    const boxId = `BOX-${store}-${Date.now()}`; // Or generate as per your logic

    // If transfer_order column has NOT NULL constraint, use empty string instead of null
    const transferOrderValue = toNoValue !== null ? toNoValue : ""; // Use "" if column doesn't allow NULL

    await db.query(
      `INSERT INTO tabBox (
        box_id, advance_shipping_notice, transfer_order, store, 
        purpose, status, created_by, created_on, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        boxId,
        asn_no,
        transferOrderValue, // Empty string for warehouses if column doesn't allow NULL
        store,
        purpose || "STORE",
        "Open",
        user_id || created_by,
        new Date().toISOString(),
        user_id || created_by,
      ]
    );

    res.json({
      box_id: boxId,
      success: true,
      message: "Box created successfully",
    });
  } catch (error) {
    console.error("Error creating box:", error);
    res.status(500).json({
      code: "DATABASE_ERROR",
      message: "Failed to create box",
      details: error.message,
    });
  }
});
```

### Backend Implementation (Python/Flask)

```python
@app.route('/api/boxes/create', methods=['POST'])
@authenticate
def create_box():
    data = request.get_json()

    asn_no = data.get('asn_no') or data.get('advance_shipping_notice')
    to_no = data.get('to_no') or data.get('transfer_order')
    store = data.get('store')  # Store code from tabwarehouse (e.g., "WH-MAIN", "STORE-001")
    purpose = data.get('purpose', 'STORE')
    user_id = data.get('user_id') or data.get('created_by')

    # Validate required fields
    if not asn_no or not store or not user_id:
        return jsonify({
            'code': 'VALIDATION_ERROR',
            'message': 'asn_no (or advance_shipping_notice), store, and user_id (or created_by) are required'
        }), 400

    try:
        # Look up store in tabwarehouse table to check warehouse_type
        store_info = db.execute(
            "SELECT warehouse_type FROM tabwarehouse WHERE code = ?",
            (store,)
        ).fetchone()

        if not store_info:
            return jsonify({
                'code': 'VALIDATION_ERROR',
                'message': f'Store {store} not found in warehouse master table'
            }), 400

        warehouse_type = store_info['warehouse_type']
        is_warehouse = warehouse_type == "Warehouse"

        # Only validate to_no for stores (warehouse_type = "Store"), not for warehouses
        if not is_warehouse and (not to_no or to_no.strip() == ""):
            return jsonify({
                'code': 'VALIDATION_ERROR',
                'message': 'to_no (or transfer_order) is required for distribution stores'
            }), 400

        # Convert empty string to None for database
        # IMPORTANT: If transfer_order column has NOT NULL constraint, use empty string instead of None
        # Check your database schema - if column allows NULL, use None; otherwise use empty string ""
        to_no_value = to_no.strip() if to_no and to_no.strip() else None

        # Create box in database
        box_id = f"BOX-{store}-{int(time.time() * 1000)}"  # Or generate as per your logic

        # If transfer_order column has NOT NULL constraint, use empty string instead of None
        transfer_order_value = to_no_value if to_no_value is not None else ""  # Use "" if column doesn't allow NULL

        db.execute(
            """INSERT INTO tabBox (
                box_id, advance_shipping_notice, transfer_order, store,
                purpose, status, created_by, created_on, user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                box_id,
                asn_no,
                transfer_order_value,  # Empty string for warehouses if column doesn't allow NULL
                store,
                purpose,
                "Open",
                user_id,
                datetime.utcnow().isoformat(),
                user_id,
            )
        )
        db.commit()

        return jsonify({
            'box_id': box_id,
            'success': True,
            'message': 'Box created successfully'
        })
    except Exception as error:
        print(f'Error creating box: {error}')
        return jsonify({
            'code': 'DATABASE_ERROR',
            'message': 'Failed to create box',
            'details': str(error)
        }), 500
```

### Key Changes

1. **Lookup Store in Master Table:**

   ```sql
   SELECT warehouse_type FROM tabwarehouse WHERE code = ?
   ```

2. **Check warehouse_type Instead of Store Name:**

   ```javascript
   const isWarehouse = warehouseType === "Warehouse";
   ```

3. **Only Validate TO for Stores:**
   ```javascript
   if (!isWarehouse && (!to_no || to_no.trim() === "")) {
     // Require TO for stores
   }
   ```

### Mobile App Behavior

- Sends store `code` from master table (e.g., "WH-MAIN", "STORE-001")
- Checks `warehouse_type` from master data before showing alerts
- Sends empty string `""` for `to_no` when creating warehouse boxes
- Backend should validate based on `warehouse_type`, not store code/name

### Testing

**Test Case 1: Create Warehouse Box (No TO Required)**

```bash
curl -X POST http://your-backend/api/boxes/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "asn_no": "ASN-0002",
    "store": "WH-MAIN",
    "to_no": "",
    "user_id": "USER001",
    "purpose": "STORE"
  }'
```

**Expected:** Success (no validation error)

**Test Case 2: Create Store Box (TO Required)**

```bash
curl -X POST http://your-backend/api/boxes/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "asn_no": "ASN-0002",
    "store": "STORE-001",
    "to_no": "",
    "user_id": "USER001",
    "purpose": "STORE"
  }'
```

**Expected:** Validation error (TO required for stores)

### Notes

- **Backend MUST:** Check `warehouse_type` from `tabwarehouse` table, not hardcoded store names
- **Warehouse boxes:** Don't require TO validation (warehouse_type = "Warehouse")
- **Store boxes:** Require TO validation (warehouse_type = "Store")
- **Store codes:** Use codes from master table (e.g., "WH-MAIN", "STORE-001"), not hardcoded values

---

## 9. Database Schema Fixes (CRITICAL - Required for Carton Status and Session Updates)

### Issue 1: Carton Status Update - Unknown Column 'updated_by'

**Error:**

```
{"code":"DATABASE_ERROR","message":"Failed to update carton status","details":"Unknown column 'updated_by' in 'field list'"}
```

**Root Cause:**
The backend is trying to use a column `updated_by` in the carton status table, but this column doesn't exist in the database schema.

**Solution:**
Remove `updated_by` from the UPDATE/INSERT queries for carton status. The carton status table should only use:

- `asn_no`
- `inbound_session`
- `carton_id`
- `status`
- `locked_by`
- `locked_on`
- `updated_on`

**Correct Backend Implementation (Node.js/Express):**

```javascript
app.post("/api/cartons/update-status", authenticate, async (req, res) => {
  const { asn_no, inbound_session, carton_id, status, locked_by, locked_on } =
    req.body;

  try {
    const now = new Date().toISOString();

    // Use INSERT OR REPLACE (or UPDATE if exists)
    await db.query(
      `INSERT OR REPLACE INTO carton_status_cache (
        asn_no, inbound_session, carton_id, status, 
        locked_by, locked_on, updated_on
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        asn_no,
        inbound_session,
        carton_id,
        status,
        locked_by || null,
        locked_on || null,
        now,
      ]
    );

    res.json({
      success: true,
      message: "Carton status updated successfully",
    });
  } catch (error) {
    console.error("Error updating carton status:", error);
    res.status(500).json({
      code: "DATABASE_ERROR",
      message: "Failed to update carton status",
      details: error.message,
    });
  }
});
```

**Correct Backend Implementation (Python/Flask):**

```python
@app.route('/api/cartons/update-status', methods=['POST'])
@authenticate
def update_carton_status():
    data = request.get_json()

    asn_no = data.get('asn_no')
    inbound_session = data.get('inbound_session')
    carton_id = data.get('carton_id')
    status = data.get('status')
    locked_by = data.get('locked_by')
    locked_on = data.get('locked_on')

    try:
        now = datetime.utcnow().isoformat()

        # Use INSERT OR REPLACE (or UPDATE if exists)
        db.execute(
            """INSERT OR REPLACE INTO carton_status_cache (
                asn_no, inbound_session, carton_id, status,
                locked_by, locked_on, updated_on
            ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                asn_no,
                inbound_session,
                carton_id,
                status,
                locked_by or None,
                locked_on or None,
                now,
            )
        )
        db.commit()

        return jsonify({
            'success': True,
            'message': 'Carton status updated successfully'
        })
    except Exception as error:
        print(f'Error updating carton status: {error}')
        return jsonify({
            'code': 'DATABASE_ERROR',
            'message': 'Failed to update carton status',
            'details': str(error)
        }), 500
```

**Key Points:**

- ❌ **DO NOT** include `updated_by` in the INSERT/UPDATE query
- ✅ **DO** include only: `asn_no`, `inbound_session`, `carton_id`, `status`, `locked_by`, `locked_on`, `updated_on`

---

### Issue 2: Inbound Session Update - Unknown Column 'title'

**Error:**

```
{"code":"DATABASE_ERROR","message":"Failed to update inbound session","details":"Unknown column 'title' in 'field list'"}
```

**Root Cause:**
The backend is trying to use a column called `title` in the `inbound_sessions` table, but this column doesn't exist. The correct column name is `inbound_session` (which is the PRIMARY KEY).

**Solution:**
Replace all references to `title` with `inbound_session` in all SQL queries for the `inbound_sessions` table.

**Correct Database Schema:**

```sql
CREATE TABLE IF NOT EXISTS inbound_sessions (
  inbound_session TEXT PRIMARY KEY,  -- ⚠️ Use 'inbound_session', NOT 'title'
  asn_no TEXT NOT NULL,
  transfer_order TEXT,
  dock TEXT,
  status TEXT DEFAULT 'Active',
  completed_cartons INTEGER DEFAULT 0,
  total_cartons INTEGER DEFAULT 0,
  started_by TEXT,
  started_on TEXT,
  completed_on TEXT,
  updated_on TEXT,
  user_id TEXT,
  device_id TEXT
);
```

**Correct Backend Implementation (Node.js/Express):**

```javascript
app.post("/api/inbound/update", authenticate, async (req, res) => {
  const {
    inbound_session, // ⚠️ Use 'inbound_session', NOT 'title'
    asn_no,
    transfer_order,
    dock,
    status,
    user_id,
    device_id,
  } = req.body;

  try {
    const now = new Date().toISOString();

    // Check if session exists using 'inbound_session' (NOT 'title')
    const existing = await db.query(
      "SELECT * FROM inbound_sessions WHERE inbound_session = ?",
      [inbound_session]
    );

    if (existing.length > 0) {
      // Update existing session
      await db.query(
        `UPDATE inbound_sessions SET
          asn_no = ?,
          transfer_order = ?,
          dock = ?,
          status = ?,
          updated_on = ?,
          user_id = ?,
          device_id = ?
        WHERE inbound_session = ?`, // ⚠️ Use 'inbound_session', NOT 'title'
        [
          asn_no,
          transfer_order || null,
          dock || null,
          status || "Active",
          now,
          user_id || null,
          device_id || null,
          inbound_session,
        ]
      );
    } else {
      // Insert new session
      await db.query(
        `INSERT INTO inbound_sessions (
          inbound_session,  -- ⚠️ Use 'inbound_session', NOT 'title'
          asn_no,
          transfer_order,
          dock,
          status,
          started_by,
          started_on,
          updated_on,
          user_id,
          device_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          inbound_session,
          asn_no,
          transfer_order || null,
          dock || null,
          status || "Active",
          user_id || null,
          now,
          now,
          user_id || null,
          device_id || null,
        ]
      );
    }

    res.json({
      success: true,
      message: "Inbound session updated successfully",
    });
  } catch (error) {
    console.error("Error updating inbound session:", error);
    res.status(500).json({
      code: "DATABASE_ERROR",
      message: "Failed to update inbound session",
      details: error.message,
    });
  }
});
```

**Correct Backend Implementation (Python/Flask):**

```python
@app.route('/api/inbound/update', methods=['POST'])
@authenticate
def update_inbound_session():
    data = request.get_json()

    inbound_session = data.get('inbound_session')  # ⚠️ Use 'inbound_session', NOT 'title'
    asn_no = data.get('asn_no')
    transfer_order = data.get('transfer_order')
    dock = data.get('dock')
    status = data.get('status', 'Active')
    user_id = data.get('user_id')
    device_id = data.get('device_id')

    try:
        now = datetime.utcnow().isoformat()

        # Check if session exists using 'inbound_session' (NOT 'title')
        existing = db.execute(
            "SELECT * FROM inbound_sessions WHERE inbound_session = ?",
            (inbound_session,)
        ).fetchone()

        if existing:
            # Update existing session
            db.execute(
                """UPDATE inbound_sessions SET
                    asn_no = ?,
                    transfer_order = ?,
                    dock = ?,
                    status = ?,
                    updated_on = ?,
                    user_id = ?,
                    device_id = ?
                WHERE inbound_session = ?""",  # ⚠️ Use 'inbound_session', NOT 'title'
                (
                    asn_no,
                    transfer_order or None,
                    dock or None,
                    status,
                    now,
                    user_id or None,
                    device_id or None,
                    inbound_session,
                )
            )
        else:
            # Insert new session
            db.execute(
                """INSERT INTO inbound_sessions (
                    inbound_session,  -- ⚠️ Use 'inbound_session', NOT 'title'
                    asn_no,
                    transfer_order,
                    dock,
                    status,
                    started_by,
                    started_on,
                    updated_on,
                    user_id,
                    device_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    inbound_session,
                    asn_no,
                    transfer_order or None,
                    dock or None,
                    status,
                    user_id or None,
                    now,
                    now,
                    user_id or None,
                    device_id or None,
                )
            )
        db.commit()

        return jsonify({
            'success': True,
            'message': 'Inbound session updated successfully'
        })
    except Exception as error:
        print(f'Error updating inbound session: {error}')
        return jsonify({
            'code': 'DATABASE_ERROR',
            'message': 'Failed to update inbound session',
            'details': str(error)
        }), 500
```

**Key Changes:**

1. **Replace `title` with `inbound_session`:**

   ```sql
   -- ❌ WRONG
   SELECT * FROM inbound_sessions WHERE title = ?

   -- ✅ CORRECT
   SELECT * FROM inbound_sessions WHERE inbound_session = ?
   ```

2. **Use `inbound_session` as PRIMARY KEY:**

   - The `inbound_session` field is the PRIMARY KEY
   - Use it in WHERE clauses, not `title`

3. **Column Names:**
   - ✅ Use: `inbound_session`, `asn_no`, `status`, `updated_on`, etc.
   - ❌ Don't use: `title`, `updated_by` (for carton status)

### Testing

**Test Carton Status Update:**

```bash
curl -X POST http://your-backend/api/cartons/update-status \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "asn_no": "ASN-0002",
    "inbound_session": "SESSION-ASN0002-DEVICE001-USER172188",
    "carton_id": "CTN-0101",
    "status": "Received",
    "locked_by": null,
    "locked_on": null
  }'
```

**Test Inbound Session Update:**

```bash
curl -X POST http://your-backend/api/inbound/update \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "inbound_session": "SESSION-ASN0002-DEVICE001-USER172188",
    "asn_no": "ASN-0002",
    "status": "Active",
    "user_id": "USER001",
    "device_id": "DEVICE001"
  }'
```

### Notes

- **Carton Status:** Remove `updated_by` from all queries
- **Inbound Session:** Replace `title` with `inbound_session` in all queries
- **PRIMARY KEY:** `inbound_session` is the PRIMARY KEY for `inbound_sessions` table
- **Column Names:** Always use exact column names from the database schema

---

## 10. Inbound Session Update - completed_cartons Tracking (CRITICAL)

### Endpoint: `POST /api/inbound/update`

**Issue:** The backend is not updating `completed_cartons` when cartons are completed. The mobile app sends `completed_cartons` in the update request, but the backend must update this field in the database.

### Current Problem

The backend shows `completed_cartons: 0` even after cartons are completed (e.g., CTN-0101 is "Received" but `completed_cartons` remains 0).

### Required Backend Update

**The backend MUST:**

1. Accept `completed_cartons` and `total_cartons` in the `POST /api/inbound/update` request
2. Update these fields in the `inbound_sessions` table
3. Calculate `completed_cartons` by counting cartons with status "Received" for the session (if not provided)
4. Update session status to "Completed" when `completed_cartons === total_cartons`

### Request Format

The mobile app sends:

```json
{
  "inbound_session": "SESSION-ASN0002-DEVICE001-USER172188",
  "asn_no": "ASN-0002",
  "status": "Active",
  "completed_cartons": 1,
  "total_cartons": 2,
  "transfer_order": null,
  "dock": "DOCK-01",
  "user_id": "USER-172188",
  "device_id": "DEVICE-001"
}
```

### Backend Implementation (Node.js/Express)

```javascript
app.post("/api/inbound/update", authenticate, async (req, res) => {
  const {
    inbound_session, // ⚠️ Use 'inbound_session', NOT 'title'
    asn_no,
    transfer_order,
    dock,
    status,
    completed_cartons, // ⚠️ IMPORTANT: Update this field
    total_cartons, // ⚠️ IMPORTANT: Update this field
    user_id,
    device_id,
  } = req.body;

  try {
    const now = new Date().toISOString();

    // Check if session exists using 'inbound_session' (NOT 'title')
    const existing = await db.query(
      "SELECT * FROM inbound_sessions WHERE inbound_session = ?",
      [inbound_session]
    );

    // Calculate completed_cartons if not provided
    let finalCompletedCartons = completed_cartons;
    if (finalCompletedCartons === undefined || finalCompletedCartons === null) {
      // Count cartons with status "Received" for this session
      const receivedCartons = await db.query(
        `SELECT COUNT(*) as count 
         FROM carton_status_cache 
         WHERE inbound_session = ? AND status = 'Received'`,
        [inbound_session]
      );
      finalCompletedCartons = receivedCartons[0]?.count || 0;
    }

    // Calculate total_cartons if not provided
    let finalTotalCartons = total_cartons;
    if (finalTotalCartons === undefined || finalTotalCartons === null) {
      // Count all cartons for this session
      const allCartons = await db.query(
        `SELECT COUNT(*) as count 
         FROM carton_status_cache 
         WHERE inbound_session = ?`,
        [inbound_session]
      );
      finalTotalCartons = allCartons[0]?.count || 0;
    }

    // Determine final status
    let finalStatus = status || "Active";
    if (
      finalCompletedCartons > 0 &&
      finalCompletedCartons === finalTotalCartons
    ) {
      finalStatus = "Completed";
    }

    if (existing.length > 0) {
      // Update existing session
      await db.query(
        `UPDATE inbound_sessions SET
          asn_no = ?,
          transfer_order = ?,
          dock = ?,
          status = ?,
          completed_cartons = ?,
          total_cartons = ?,
          updated_on = ?,
          user_id = ?,
          device_id = ?,
          completed_on = ?
        WHERE inbound_session = ?`,
        [
          asn_no,
          transfer_order || null,
          dock || null,
          finalStatus,
          finalCompletedCartons, // ⚠️ Update completed_cartons
          finalTotalCartons, // ⚠️ Update total_cartons
          now,
          user_id || null,
          device_id || null,
          finalStatus === "Completed" ? now : null,
          inbound_session,
        ]
      );
    } else {
      // Insert new session
      await db.query(
        `INSERT INTO inbound_sessions (
          inbound_session,
          asn_no,
          transfer_order,
          dock,
          status,
          completed_cartons,
          total_cartons,
          started_by,
          started_on,
          updated_on,
          user_id,
          device_id,
          completed_on
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          inbound_session,
          asn_no,
          transfer_order || null,
          dock || null,
          finalStatus,
          finalCompletedCartons, // ⚠️ Set completed_cartons
          finalTotalCartons, // ⚠️ Set total_cartons
          user_id || null,
          now,
          now,
          user_id || null,
          device_id || null,
          finalStatus === "Completed" ? now : null,
        ]
      );
    }

    res.json({
      success: true,
      message: "Inbound session updated successfully",
      data: {
        inbound_session,
        completed_cartons: finalCompletedCartons,
        total_cartons: finalTotalCartons,
        status: finalStatus,
      },
    });
  } catch (error) {
    console.error("Error updating inbound session:", error);
    res.status(500).json({
      code: "DATABASE_ERROR",
      message: "Failed to update inbound session",
      details: error.message,
    });
  }
});
```

### Backend Implementation (Python/Flask)

```python
@app.route('/api/inbound/update', methods=['POST'])
@authenticate
def update_inbound_session():
    data = request.get_json()

    inbound_session = data.get('inbound_session')  # ⚠️ Use 'inbound_session', NOT 'title'
    asn_no = data.get('asn_no')
    transfer_order = data.get('transfer_order')
    dock = data.get('dock')
    status = data.get('status', 'Active')
    completed_cartons = data.get('completed_cartons')  # ⚠️ IMPORTANT: Update this field
    total_cartons = data.get('total_cartons')           # ⚠️ IMPORTANT: Update this field
    user_id = data.get('user_id')
    device_id = data.get('device_id')

    try:
        now = datetime.utcnow().isoformat()

        # Check if session exists using 'inbound_session' (NOT 'title')
        existing = db.execute(
            "SELECT * FROM inbound_sessions WHERE inbound_session = ?",
            (inbound_session,)
        ).fetchone()

        # Calculate completed_cartons if not provided
        final_completed_cartons = completed_cartons
        if final_completed_cartons is None:
            # Count cartons with status "Received" for this session
            received_cartons = db.execute(
                """SELECT COUNT(*) as count
                   FROM carton_status_cache
                   WHERE inbound_session = ? AND status = 'Received'""",
                (inbound_session,)
            ).fetchone()
            final_completed_cartons = received_cartons['count'] if received_cartons else 0

        # Calculate total_cartons if not provided
        final_total_cartons = total_cartons
        if final_total_cartons is None:
            # Count all cartons for this session
            all_cartons = db.execute(
                """SELECT COUNT(*) as count
                   FROM carton_status_cache
                   WHERE inbound_session = ?""",
                (inbound_session,)
            ).fetchone()
            final_total_cartons = all_cartons['count'] if all_cartons else 0

        # Determine final status
        final_status = status
        if final_completed_cartons > 0 and final_completed_cartons == final_total_cartons:
            final_status = "Completed"

        if existing:
            # Update existing session
            db.execute(
                """UPDATE inbound_sessions SET
                    asn_no = ?,
                    transfer_order = ?,
                    dock = ?,
                    status = ?,
                    completed_cartons = ?,
                    total_cartons = ?,
                    updated_on = ?,
                    user_id = ?,
                    device_id = ?,
                    completed_on = ?
                WHERE inbound_session = ?""",
                (
                    asn_no,
                    transfer_order or None,
                    dock or None,
                    final_status,
                    final_completed_cartons,  # ⚠️ Update completed_cartons
                    final_total_cartons,      # ⚠️ Update total_cartons
                    now,
                    user_id or None,
                    device_id or None,
                    now if final_status == "Completed" else None,
                    inbound_session,
                )
            )
        else:
            # Insert new session
            db.execute(
                """INSERT INTO inbound_sessions (
                    inbound_session,
                    asn_no,
                    transfer_order,
                    dock,
                    status,
                    completed_cartons,
                    total_cartons,
                    started_by,
                    started_on,
                    updated_on,
                    user_id,
                    device_id,
                    completed_on
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    inbound_session,
                    asn_no,
                    transfer_order or None,
                    dock or None,
                    final_status,
                    final_completed_cartons,  # ⚠️ Set completed_cartons
                    final_total_cartons,      # ⚠️ Set total_cartons
                    user_id or None,
                    now,
                    now,
                    user_id or None,
                    device_id or None,
                    now if final_status == "Completed" else None,
                )
            )
        db.commit()

        return jsonify({
            'success': True,
            'message': 'Inbound session updated successfully',
            'data': {
                'inbound_session': inbound_session,
                'completed_cartons': final_completed_cartons,
                'total_cartons': final_total_cartons,
                'status': final_status,
            }
        })
    except Exception as error:
        print(f'Error updating inbound session: {error}')
        return jsonify({
            'code': 'DATABASE_ERROR',
            'message': 'Failed to update inbound session',
            'details': str(error)
        }), 500
```

### Key Points

1. **Accept `completed_cartons` and `total_cartons`:**

   - These fields are sent by the mobile app when cartons are completed
   - Backend must update these fields in the database

2. **Calculate if not provided:**

   - If `completed_cartons` is not in the request, count cartons with status "Received"
   - If `total_cartons` is not in the request, count all cartons for the session

3. **Update status automatically:**

   - If `completed_cartons === total_cartons`, set status to "Completed"
   - Set `completed_on` timestamp when status becomes "Completed"

4. **Always update these fields:**
   - `completed_cartons` - Number of cartons with status "Received"
   - `total_cartons` - Total number of cartons in the session
   - `status` - "Active" or "Completed" based on progress

### Testing

**Test Session Update with completed_cartons:**

```bash
curl -X POST http://your-backend/api/inbound/update \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "inbound_session": "SESSION-ASN0002-DEVICE001-USER172188",
    "asn_no": "ASN-0002",
    "status": "Active",
    "completed_cartons": 1,
    "total_cartons": 2,
    "dock": "DOCK-01",
    "user_id": "USER-172188",
    "device_id": "DEVICE-001"
  }'
```

**Expected Response:**

```json
{
  "success": true,
  "message": "Inbound session updated successfully",
  "data": {
    "inbound_session": "SESSION-ASN0002-DEVICE001-USER172188",
    "completed_cartons": 1,
    "total_cartons": 2,
    "status": "Active"
  }
}
```

**Verify in Database:**

```sql
SELECT inbound_session, completed_cartons, total_cartons, status
FROM inbound_sessions
WHERE inbound_session = 'SESSION-ASN0002-DEVICE001-USER172188';
```

**Expected Result:**

```
inbound_session: SESSION-ASN0002-DEVICE001-USER172188
completed_cartons: 1
total_cartons: 2
status: Active
```

### Notes

- **Mobile app sends:** `completed_cartons` and `total_cartons` when cartons are completed
- **Backend must:** Update these fields in the `inbound_sessions` table
- **Auto-calculation:** Backend can also calculate from `carton_status_cache` if not provided
- **Status update:** Automatically set status to "Completed" when all cartons are received

---

**Last Updated:** 2024-01-XX  
**Version:** 1.0
