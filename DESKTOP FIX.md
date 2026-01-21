# Desktop/Backend Fixes Required for Relocation Module

## Overview

This document outlines all backend/desktop fixes required to support the Relocation/Bin Transfer mobile module. The mobile app is complete and ready, but the backend needs these fixes to function properly.

---

## Critical Backend Issues

### Issue 1: Database Schema Missing Columns

**Error:**

```
ERROR: Unknown column 'from_bin' in 'field list'
```

**Root Cause:**
The `relocation_sessions` table (or `relocation_moves` table) is missing required columns.

**Fix Required:**

#### Option 1: Update Existing Table

```sql
ALTER TABLE relocation_sessions
ADD COLUMN from_bin VARCHAR(50) NULL,
ADD COLUMN from_carton VARCHAR(50) NULL,
ADD COLUMN to_bin VARCHAR(50) NULL,
ADD COLUMN to_carton VARCHAR(50) NULL;

-- Update existing sessions if needed
UPDATE relocation_sessions
SET from_bin = NULL, from_carton = NULL, to_bin = NULL, to_carton = NULL
WHERE from_bin IS NULL;
```

#### Option 2: Create New Table (If doesn't exist)

```sql
CREATE TABLE IF NOT EXISTS relocation_sessions (
  session_id VARCHAR(50) PRIMARY KEY,
  mode VARCHAR(20) NOT NULL, -- 'FULL_CARTON', 'PARTIAL_ITEMS', 'CARTON_TO_CARTON'
  warehouse_id VARCHAR(50),
  user_id VARCHAR(50),
  from_bin VARCHAR(50),        -- ✅ REQUIRED
  from_carton VARCHAR(50),     -- ✅ REQUIRED (nullable)
  to_bin VARCHAR(50),          -- ✅ REQUIRED
  to_carton VARCHAR(50),       -- ✅ REQUIRED (nullable)
  status VARCHAR(20) DEFAULT 'Draft', -- 'Draft', 'In Progress', 'Completed'
  started_at DATETIME,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create relocation_moves table for tracking individual moves
CREATE TABLE IF NOT EXISTS relocation_moves (
  move_id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(50),
  from_bin VARCHAR(50),
  from_carton VARCHAR(50) NULL,
  to_bin VARCHAR(50),
  to_carton VARCHAR(50) NULL,
  item_code VARCHAR(50),
  qty DECIMAL(10, 2),
  moved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES relocation_sessions(session_id)
);
```

---

### Issue 2: Backend Code Using Undefined Variables

**Error:**

```
ERROR: movedItems is not defined
ERROR: cartonItems is not defined
```

**Root Cause:**
Backend commit endpoint code is referencing variables that don't exist. Should use `request.body.lines` instead.

**Fix Required:**

#### Commit Endpoint (commit-full and commit-partial)

**Current Code (WRONG):**

```javascript
// ❌ WRONG: References undefined variables
const items = movedItems; // or cartonItems
```

**Fixed Code (CORRECT):**

```javascript
// ✅ CORRECT: Read from request.body.lines
const { lines } = request.body;

// Validate request
if (!lines || !Array.isArray(lines)) {
  return res.status(400).json({
    code: "VALIDATION_ERROR",
    message: "lines array is required",
  });
}

// Load session to get from_bin, from_carton, to_bin, to_carton
const session = await getRelocationSession(sessionId);
if (!session) {
  return res.status(404).json({
    code: "NOT_FOUND",
    message: "Relocation session not found",
  });
}

// Validate session has required data
if (!session.from_bin || !session.to_bin) {
  return res.status(400).json({
    code: "VALIDATION_ERROR",
    message: "Session missing from_bin or to_bin",
  });
}

// Process each line
for (const line of lines) {
  // Validate line
  if (!line.item_code || !line.qty || line.qty <= 0) {
    continue; // Skip invalid lines
  }

  // Create relocation move record
  await createRelocationMove({
    session_id: sessionId,
    from_bin: session.from_bin,
    from_carton: session.from_carton || null,
    to_bin: session.to_bin,
    to_carton: session.to_carton || null,
    item_code: line.item_code,
    qty: line.qty,
    moved_at: new Date(),
  });

  // Update stock ledger (decrease from_bin, increase to_bin)
  await updateStockLedger({
    item_code: line.item_code,
    from_bin: session.from_bin,
    from_carton: session.from_carton,
    to_bin: session.to_bin,
    to_carton: session.to_carton,
    qty: line.qty,
  });
}

// Mark session as completed
await updateRelocationSession(sessionId, {
  status: "Completed",
  completed_at: new Date(),
});

return res.json({
  ok: true,
  message: "Relocation committed successfully",
  lines_processed: lines.length,
});
```

---

## API Endpoint Implementation

### 1. POST /api/relocation/session/start

**Required Implementation:**

```javascript
app.post("/api/relocation/session/start", async (req, res) => {
  try {
    const { mode, warehouse_id, user_id } = req.body;

    // Validate required fields
    if (!mode || !warehouse_id || !user_id) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "mode, warehouse_id, and user_id are required",
      });
    }

    // Validate mode
    const validModes = ["FULL_CARTON", "PARTIAL_ITEMS", "CARTON_TO_CARTON"];
    if (!validModes.includes(mode)) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: `Invalid mode. Must be one of: ${validModes.join(", ")}`,
      });
    }

    // Generate session ID
    const sessionId = `RL-${Date.now()}`;

    // Create session in database
    await db.query(
      `INSERT INTO relocation_sessions 
       (session_id, mode, warehouse_id, user_id, status, started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Draft', NOW(), NOW(), NOW())`,
      [sessionId, mode, warehouse_id, user_id]
    );

    return res.json({
      ok: true,
      session_id: sessionId,
    });
  } catch (error) {
    console.error("Error starting relocation session:", error);
    return res.status(500).json({
      code: "DATABASE_ERROR",
      message: "Failed to start relocation session",
      details: error.message,
    });
  }
});
```

---

### 2. PUT /api/relocation/session/:session_id/from

**Required Implementation:**

```javascript
app.put("/api/relocation/session/:session_id/from", async (req, res) => {
  try {
    const { session_id } = req.params;
    const { from_bin, from_carton } = req.body;

    // Validate session exists
    const session = await db.query(
      "SELECT * FROM relocation_sessions WHERE session_id = ?",
      [session_id]
    );

    if (!session || session.length === 0) {
      return res.status(404).json({
        code: "NOT_FOUND",
        message: `Relocation session not found: ${session_id}`,
      });
    }

    // Validate required field
    if (!from_bin) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "from_bin is required",
      });
    }

    // Update session
    await db.query(
      `UPDATE relocation_sessions 
       SET from_bin = ?, from_carton = ?, updated_at = NOW()
       WHERE session_id = ?`,
      [from_bin, from_carton || null, session_id]
    );

    return res.json({
      ok: true,
      message: "FROM location set successfully",
    });
  } catch (error) {
    console.error("Error setting FROM location:", error);
    return res.status(500).json({
      code: "DATABASE_ERROR",
      message: "Failed to set FROM location",
      details: error.message,
    });
  }
});
```

---

### 3. PUT /api/relocation/session/:session_id/to

**Required Implementation:**

```javascript
app.put("/api/relocation/session/:session_id/to", async (req, res) => {
  try {
    const { session_id } = req.params;
    const { to_bin, to_carton } = req.body;

    // Validate session exists
    const session = await db.query(
      "SELECT * FROM relocation_sessions WHERE session_id = ?",
      [session_id]
    );

    if (!session || session.length === 0) {
      return res.status(404).json({
        code: "NOT_FOUND",
        message: `Relocation session not found: ${session_id}`,
      });
    }

    // Validate required field
    if (!to_bin) {
      return res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "to_bin is required",
      });
    }

    // Update session
    await db.query(
      `UPDATE relocation_sessions 
       SET to_bin = ?, to_carton = ?, updated_at = NOW()
       WHERE session_id = ?`,
      [to_bin, to_carton || null, session_id]
    );

    return res.json({
      ok: true,
      message: "TO location set successfully",
    });
  } catch (error) {
    console.error("Error setting TO location:", error);
    return res.status(500).json({
      code: "DATABASE_ERROR",
      message: "Failed to set TO location",
      details: error.message,
    });
  }
});
```

---

### 4. POST /api/relocation/session/:session_id/commit-full

**Required Implementation:**

```javascript
app.post(
  "/api/relocation/session/:session_id/commit-full",
  async (req, res) => {
    try {
      const { session_id } = req.params;
      const { lines } = req.body || {};

      // Load session
      const session = await db.query(
        "SELECT * FROM relocation_sessions WHERE session_id = ?",
        [session_id]
      );

      if (!session || session.length === 0) {
        return res.status(404).json({
          code: "NOT_FOUND",
          message: `Relocation session not found: ${session_id}`,
        });
      }

      const sessionData = session[0];

      // Validate mode
      if (sessionData.mode !== "FULL_CARTON") {
        return res.status(400).json({
          code: "INVALID_MODE",
          message: `Session ${session_id} is not in FULL_CARTON mode (current mode: ${sessionData.mode}). Use /api/relocation/session/${session_id}/commit-partial endpoint for ${sessionData.mode} mode.`,
        });
      }

      // Validate session has required data
      if (!sessionData.from_bin || !sessionData.to_bin) {
        return res.status(400).json({
          code: "VALIDATION_ERROR",
          message: "Session missing from_bin or to_bin",
        });
      }

      // For FULL_CARTON mode, validate same carton ID
      if (
        sessionData.from_carton &&
        sessionData.to_carton &&
        sessionData.from_carton !== sessionData.to_carton
      ) {
        return res.status(400).json({
          code: "VALIDATION_ERROR",
          message: "FULL_CARTON mode requires from_carton === to_carton",
        });
      }

      // Get all items from source carton/bin
      const sourceItems = await getStockLedgerByLocation({
        bin_location: sessionData.from_bin,
        carton_id: sessionData.from_carton,
      });

      // Process each item (move entire carton)
      for (const item of sourceItems) {
        // Create relocation move record
        await db.query(
          `INSERT INTO relocation_moves 
         (session_id, from_bin, from_carton, to_bin, to_carton, item_code, qty, moved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            session_id,
            sessionData.from_bin,
            sessionData.from_carton || null,
            sessionData.to_bin,
            sessionData.to_carton || null,
            item.item_code,
            item.qty,
          ]
        );

        // Update stock ledger
        await updateStockLedgerMovement({
          item_code: item.item_code,
          from_bin: sessionData.from_bin,
          from_carton: sessionData.from_carton,
          to_bin: sessionData.to_bin,
          to_carton: sessionData.to_carton,
          qty: item.qty,
        });
      }

      // Mark session as completed
      await db.query(
        `UPDATE relocation_sessions 
       SET status = 'Completed', completed_at = NOW(), updated_at = NOW()
       WHERE session_id = ?`,
        [session_id]
      );

      return res.json({
        ok: true,
        message: "Relocation committed successfully",
        items_moved: sourceItems.length,
      });
    } catch (error) {
      console.error("Error committing relocation:", error);
      return res.status(500).json({
        code: "DATABASE_ERROR",
        message: "Failed to commit full carton move",
        details: error.message,
      });
    }
  }
);
```

---

### 5. POST /api/relocation/session/:session_id/commit-partial

**Required Implementation:**

```javascript
app.post(
  "/api/relocation/session/:session_id/commit-partial",
  async (req, res) => {
    try {
      const { session_id } = req.params;
      const { lines } = req.body || {};

      // Validate lines array
      if (!lines || !Array.isArray(lines)) {
        return res.status(400).json({
          code: "VALIDATION_ERROR",
          message: "lines array is required",
        });
      }

      // Load session
      const session = await db.query(
        "SELECT * FROM relocation_sessions WHERE session_id = ?",
        [session_id]
      );

      if (!session || session.length === 0) {
        return res.status(404).json({
          code: "NOT_FOUND",
          message: `Relocation session not found: ${session_id}`,
        });
      }

      const sessionData = session[0];

      // Validate mode
      if (sessionData.mode === "FULL_CARTON") {
        return res.status(400).json({
          code: "INVALID_MODE",
          message: `Session ${session_id} is in FULL_CARTON mode. Use /api/relocation/session/${session_id}/commit-full endpoint for FULL_CARTON mode.`,
        });
      }

      // Validate session has required data
      if (!sessionData.from_bin || !sessionData.to_bin) {
        return res.status(400).json({
          code: "VALIDATION_ERROR",
          message: "Session missing from_bin or to_bin",
        });
      }

      // Process each line
      let processedCount = 0;
      for (const line of lines) {
        // Validate line
        if (!line.item_code || !line.qty || line.qty <= 0) {
          continue; // Skip invalid lines
        }

        // Verify stock availability
        const stock = await getStockLedgerByLocation({
          bin_location: sessionData.from_bin,
          carton_id: sessionData.from_carton,
          item_code: line.item_code,
        });

        if (!stock || stock.length === 0 || stock[0].qty < line.qty) {
          console.warn(`Insufficient stock for item ${line.item_code}`);
          continue; // Skip if insufficient stock
        }

        // Create relocation move record
        await db.query(
          `INSERT INTO relocation_moves 
         (session_id, from_bin, from_carton, to_bin, to_carton, item_code, qty, moved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            session_id,
            sessionData.from_bin,
            sessionData.from_carton || null,
            sessionData.to_bin,
            sessionData.to_carton || null,
            line.item_code,
            line.qty,
          ]
        );

        // Update stock ledger
        await updateStockLedgerMovement({
          item_code: line.item_code,
          from_bin: sessionData.from_bin,
          from_carton: sessionData.from_carton,
          to_bin: sessionData.to_bin,
          to_carton: sessionData.to_carton,
          qty: line.qty,
        });

        processedCount++;
      }

      // Mark session as completed
      await db.query(
        `UPDATE relocation_sessions 
       SET status = 'Completed', completed_at = NOW(), updated_at = NOW()
       WHERE session_id = ?`,
        [session_id]
      );

      return res.json({
        ok: true,
        message: "Relocation committed successfully",
        lines_processed: processedCount,
      });
    } catch (error) {
      console.error("Error committing relocation:", error);
      return res.status(500).json({
        code: "DATABASE_ERROR",
        message: "Failed to commit partial relocation",
        details: error.message,
      });
    }
  }
);
```

---

## Stock Ledger Update Function

**Required Helper Function:**

```javascript
async function updateStockLedgerMovement({
  item_code,
  from_bin,
  from_carton,
  to_bin,
  to_carton,
  qty,
}) {
  // Decrease quantity in source location
  await db.query(
    `UPDATE stock_ledger_cache
     SET qty = qty - ?,
         available_qty = available_qty - ?,
         updated_on = NOW()
     WHERE item_code = ?
       AND bin_location = ?
       AND carton_id = ?
       AND qty >= ?`,
    [qty, qty, item_code, from_bin, from_carton || null, qty]
  );

  // Increase quantity in destination location
  const existingStock = await db.query(
    `SELECT * FROM stock_ledger_cache
     WHERE item_code = ?
       AND bin_location = ?
       AND carton_id = ?`,
    [item_code, to_bin, to_carton || null]
  );

  if (existingStock && existingStock.length > 0) {
    // Update existing stock
    await db.query(
      `UPDATE stock_ledger_cache
       SET qty = qty + ?,
           available_qty = available_qty + ?,
           updated_on = NOW()
       WHERE item_code = ?
         AND bin_location = ?
         AND carton_id = ?`,
      [qty, qty, item_code, to_bin, to_carton || null]
    );
  } else {
    // Create new stock record
    await db.query(
      `INSERT INTO stock_ledger_cache
       (item_code, bin_location, carton_id, qty, available_qty, updated_on)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [item_code, to_bin, to_carton || null, qty, qty]
    );
  }

  // Create stock transaction record
  await db.query(
    `INSERT INTO stock_transaction_cache
     (transaction_id, item_code, warehouse, bin_location, transaction_type, 
      qty_change, before_qty, after_qty, reference_doc, transaction_date, user_id, updated_on)
     VALUES (?, ?, ?, ?, 'RELOCATION', ?, ?, ?, ?, NOW(), ?, NOW())`,
    [
      `REL-${Date.now()}-${item_code}`,
      item_code,
      await getWarehouseFromBin(from_bin),
      from_bin,
      -qty, // Negative for source
      await getStockQty(item_code, from_bin, from_carton),
      (await getStockQty(item_code, from_bin, from_carton)) - qty,
      `RL-${session_id}`,
      user_id,
    ]
  );

  await db.query(
    `INSERT INTO stock_transaction_cache
     (transaction_id, item_code, warehouse, bin_location, transaction_type, 
      qty_change, before_qty, after_qty, reference_doc, transaction_date, user_id, updated_on)
     VALUES (?, ?, ?, ?, 'RELOCATION', ?, ?, ?, ?, NOW(), ?, NOW())`,
    [
      `REL-${Date.now()}-${item_code}`,
      item_code,
      await getWarehouseFromBin(to_bin),
      to_bin,
      qty, // Positive for destination
      await getStockQty(item_code, to_bin, to_carton),
      (await getStockQty(item_code, to_bin, to_carton)) + qty,
      `RL-${session_id}`,
      user_id,
    ]
  );
}
```

---

## Validation Rules Summary

### FULL_CARTON Mode

- ✅ `from_carton === to_carton` (must be same carton ID)
- ✅ `from_bin !== to_bin` (different bin locations)
- ✅ Uses `commit-full` endpoint
- ✅ Moves all items in carton automatically

### PARTIAL_ITEMS Mode

- ✅ Can move partial quantities
- ✅ `lines` array required with item_code and qty
- ✅ Uses `commit-partial` endpoint
- ✅ Items go to bin (to_carton can be null)

### CARTON_TO_CARTON Mode

- ✅ `from_carton !== to_carton` (different carton IDs)
- ✅ `lines` array required with item_code and qty
- ✅ Uses `commit-partial` endpoint
- ✅ Used for merging/splitting cartons

---

## Error Messages

### Standard Error Format

```json
{
  "code": "ERROR_CODE",
  "message": "Human-readable error message",
  "details": "Optional technical details"
}
```

### Error Codes

- `VALIDATION_ERROR` - Missing or invalid request data
- `NOT_FOUND` - Session or resource not found
- `INVALID_MODE` - Mode mismatch (wrong endpoint for mode)
- `DATABASE_ERROR` - Database operation failed

---

## Testing Checklist

### Database

- [ ] `relocation_sessions` table has all required columns
- [ ] `relocation_moves` table exists (optional but recommended)
- [ ] Foreign keys and indexes are set up correctly

### API Endpoints

- [ ] `POST /api/relocation/session/start` - Creates session
- [ ] `PUT /api/relocation/session/:id/from` - Sets FROM location
- [ ] `PUT /api/relocation/session/:id/to` - Sets TO location
- [ ] `POST /api/relocation/session/:id/commit-full` - Commits FULL_CARTON
- [ ] `POST /api/relocation/session/:id/commit-partial` - Commits PARTIAL/CARTON_TO_CARTON

### Validation

- [ ] Mode validation works correctly
- [ ] FULL_CARTON requires same carton ID
- [ ] Wrong endpoint for mode returns proper error
- [ ] Stock ledger updates correctly

### Error Handling

- [ ] All errors return proper status codes
- [ ] Error messages are clear and helpful
- [ ] Database errors are caught and logged

---

## Priority

### High Priority (Blocking)

1. ✅ Fix database schema (add missing columns)
2. ✅ Fix commit endpoint code (use `request.body.lines`)

### Medium Priority

3. ✅ Implement all API endpoints
4. ✅ Add stock ledger update logic
5. ✅ Add proper error messages

### Low Priority

6. ✅ Add transaction logging
7. ✅ Add audit trail
8. ✅ Optimize database queries

---

## Notes

- The mobile app already handles offline scenarios by creating events that sync via `/api/events/batch`
- Backend should process `RELOCATION_MOVE` events if direct commit fails
- All endpoints should validate session exists and is not already completed
- Stock ledger updates should be atomic (use transactions)
