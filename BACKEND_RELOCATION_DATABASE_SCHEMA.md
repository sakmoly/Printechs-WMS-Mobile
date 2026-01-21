# Backend Relocation Database Schema Requirements

## Business Rules

### Mode Definitions
1. **FULL_CARTON**: Move an entire carton from one bin to another
   - ✅ Same carton ID (from_carton === to_carton)
   - ✅ Different bin locations (from_bin !== to_bin)
   - ❌ Cannot use different carton IDs (that's CARTON_TO_CARTON mode)

2. **PARTIAL_ITEMS**: Move specific items from a carton to a bin
   - ✅ Can move partial quantities
   - ✅ Items go to a bin (to_carton is null or same as from_carton)

3. **CARTON_TO_CARTON**: Move items from one carton to another carton
   - ✅ Different carton IDs (from_carton !== to_carton)
   - ✅ Used for merging/splitting cartons

### Validation Rules
- If `mode === "FULL_CARTON"` and `from_carton !== to_carton` → **INVALID_MODE** error
- Backend will reject with: `"FULL_CARTON mode is for bin relocation only. Use CARTON_TO_CARTON mode for carton-to-carton merge."`

## Issues Fixed

### Issue 1: Database Schema Missing Columns
The backend was returning a 500 error when committing relocation:
```
ERROR: Unknown column 'from_bin' in 'field list'
```

This indicates the backend database table for relocation sessions or relocation moves is missing required columns.

## Mobile App Data Flow

### 1. Start Session
**Endpoint:** `POST /api/relocation/session/start`

**Request Body:**
```json
{
  "mode": "FULL_CARTON" | "PARTIAL_ITEMS" | "CARTON_TO_CARTON",
  "warehouse_id": "WH-MAIN",
  "user_id": "USER-150526"
}
```

**Expected Response:**
```json
{
  "ok": true,
  "session_id": "RL-1768550687696"
}
```

### 2. Set FROM Location
**Endpoint:** `PUT /api/relocation/session/:session_id/from`

**Request Body:**
```json
{
  "from_bin": "A1-R02-L1-B2",
  "from_carton": "CTN-555445" // or null if not applicable
}
```

### 3. Set TO Location
**Endpoint:** `PUT /api/relocation/session/:session_id/to`

**Request Body:**
```json
{
  "to_bin": "A1-R02-L1-B3",
  "to_carton": "CTN-555446" // or null if not applicable
}
```

### 4. Commit Relocation
**Endpoint:** `POST /api/relocation/session/:session_id/commit-full`

**Request Body:**
```json
{
  "lines": [
    {
      "item_code": "SKU-HAT-301-RED-OS",
      "qty": 2
    },
    {
      "item_code": "SKU-SHOE-501-BLUE-42",
      "qty": 5
    }
  ]
}
```

**Note:** The session context (from_bin, from_carton, to_bin, to_carton) should already be stored in the session from steps 2 and 3. The commit endpoint should read these values from the session, not from the request body.

**⚠️ Backend Bug Fix Required:**

The backend is currently throwing errors due to undefined variables. The mobile app sends the correct data structure, but the backend code references variables that don't exist.

### Error 1: `"movedItems is not defined"`
### Error 2: `"cartonItems is not defined"`

**What the mobile app sends:**
```json
{
  "lines": [
    {
      "item_code": "SKU-HAT-301-RED-OS",
      "qty": 2
    }
  ]
}
```

**What the backend should do:**
1. Read `lines` from `request.body.lines` (not `movedItems` or `cartonItems`)
2. Process each line in the `lines` array
3. Use the session data (from_bin, from_carton, to_bin, to_carton) that was set via PUT endpoints

**Example Backend Implementation:**
```javascript
// ✅ CORRECT: Read from request.body.lines
const { lines } = request.body;

// ❌ WRONG: Don't reference movedItems or cartonItems (don't exist)
// const items = movedItems; // Error: "movedItems is not defined"
// const items = cartonItems; // Error: "cartonItems is not defined"

// Validate request
if (!lines || !Array.isArray(lines)) {
  return res.status(400).json({
    code: "VALIDATION_ERROR",
    message: "lines array is required"
  });
}

// Load session to get from_bin, from_carton, to_bin, to_carton
const session = await getRelocationSession(sessionId);
if (!session) {
  return res.status(404).json({
    code: "NOT_FOUND",
    message: "Relocation session not found"
  });
}

// Validate session has required data
if (!session.from_bin || !session.to_bin) {
  return res.status(400).json({
    code: "VALIDATION_ERROR",
    message: "Session missing from_bin or to_bin"
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
    moved_at: new Date()
  });

  // Update stock ledger (decrease from_bin, increase to_bin)
  await updateStockLedger({
    item_code: line.item_code,
    from_bin: session.from_bin,
    from_carton: session.from_carton,
    to_bin: session.to_bin,
    to_carton: session.to_carton,
    qty: line.qty
  });
}

// Mark session as completed
await updateRelocationSession(sessionId, {
  status: "Completed",
  completed_at: new Date()
});

return res.json({
  ok: true,
  message: "Relocation committed successfully",
  lines_processed: lines.length
});
```

## Required Backend Database Schema

### Option 1: Single Relocation Sessions Table
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
```

### Option 2: Separate Relocation Moves Table
If you use a separate table for relocation moves:

```sql
CREATE TABLE IF NOT EXISTS relocation_moves (
  move_id INT AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(50),
  from_bin VARCHAR(50),        -- ✅ REQUIRED
  from_carton VARCHAR(50),     -- ✅ REQUIRED (nullable)
  to_bin VARCHAR(50),          -- ✅ REQUIRED
  to_carton VARCHAR(50),        -- ✅ REQUIRED (nullable)
  item_code VARCHAR(50),
  qty DECIMAL(10, 2),
  moved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES relocation_sessions(session_id)
);
```

## Backend Implementation Requirements

### Commit Endpoint Logic
When `POST /api/relocation/session/:session_id/commit-full` is called:

1. **Load session from database:**
   ```sql
   SELECT from_bin, from_carton, to_bin, to_carton, mode, status
   FROM relocation_sessions
   WHERE session_id = ?
   ```

2. **Validate session exists and is in progress:**
   - If session not found → return 404
   - If status = 'Completed' → return error (already completed)

3. **For each line in request.lines:**
   - Insert into relocation_moves table (or update stock ledger directly)
   - Include: session_id, from_bin, from_carton, to_bin, to_carton, item_code, qty

4. **Update session status:**
   ```sql
   UPDATE relocation_sessions
   SET status = 'Completed',
       completed_at = NOW(),
       updated_at = NOW()
   WHERE session_id = ?
   ```

5. **Update stock ledger:**
   - Decrease qty in `from_bin` (and `from_carton` if applicable)
   - Increase qty in `to_bin` (and `to_carton` if applicable)

## Verification Checklist

- [ ] `relocation_sessions` table has `from_bin` column
- [ ] `relocation_sessions` table has `from_carton` column (nullable)
- [ ] `relocation_sessions` table has `to_bin` column
- [ ] `relocation_sessions` table has `to_carton` column (nullable)
- [ ] `PUT /api/relocation/session/:session_id/from` updates `from_bin` and `from_carton`
- [ ] `PUT /api/relocation/session/:session_id/to` updates `to_bin` and `to_carton`
- [ ] `POST /api/relocation/session/:session_id/commit-full` reads session data (including from_bin) before committing
- [ ] Stock ledger is updated correctly (decrease from_bin, increase to_bin)

## Mobile App Fallback

The mobile app will continue to work even if the backend commit endpoint fails:
- It creates `RELOCATION_MOVE` events in the event queue
- Events are synced to backend via `/api/events/batch`
- Backend can process relocation moves from events if direct commit fails

However, for better performance and immediate feedback, the backend should implement the commit endpoint correctly.
