# Backend Error Fix: "taskRack is not defined"

## Error Details
- **Error Code:** `DATABASE_ERROR`
- **Message:** "Failed to get putaway tasks"
- **Details:** "taskRack is not defined"
- **Endpoint:** `GET /api/putaway/tasks`

## Root Cause

The backend code is trying to use a variable `taskRack` that hasn't been defined. This is likely in the SQL query or response building logic.

## Likely Issues

### Issue 1: SQL Query Using Undefined Variable

**Problem:** Backend code might be trying to use `taskRack` in SQL query or variable assignment, but it's not defined.

**Common Causes:**
1. Variable name typo (should be `rack` or `pt.rack`)
2. Missing column in SELECT statement
3. Variable not initialized before use

### Issue 2: Response Building Using Undefined Variable

**Problem:** Backend might be trying to build response object with `taskRack` field that doesn't exist.

**Example (WRONG):**
```javascript
const task = {
  putaway_task: row.title,
  box_id: row.box_id,
  rack: taskRack,  // ❌ taskRack is not defined
  ...
};
```

**Should Be:**
```javascript
const task = {
  putaway_task: row.title,
  box_id: row.box_id,
  rack: row.rack || null,  // ✅ Use row.rack from query result
  ...
};
```

## Expected SQL Query Structure

Based on requirements, the backend should query:

```sql
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
  pt.rack,                    -- ✅ Get rack from tabPutawayTask
  pt.bin,                     -- ✅ Get bin from tabPutawayTask
  COUNT(pl.id) as lines_count
FROM tabPutawayTask pt
LEFT JOIN tabPutawayLine pl ON pl.parent_title = pt.title
WHERE pt.status = ?
  AND (pt.advance_shipping_notice = ? OR ? IS NULL)
GROUP BY 
  pt.title, pt.box_id, pt.tc_id, pt.advance_shipping_notice, 
  pt.status, pt.location_id, pt.source_type, 
  pt.created_at, pt.updated_at, pt.created_by, pt.inbound_session,
  pt.rack, pt.bin              -- ✅ Include rack and bin in GROUP BY
ORDER BY pt.created_at DESC
```

## Backend Code Fix

### Correct Variable Usage

```javascript
// ✅ CORRECT: Use row.rack from query result
const tasks = rows.map(row => ({
  putaway_task: row.putaway_task || row.title,
  box_id: row.box_id,
  tc_id: row.tc_id,
  asn_no: row.asn_no || row.advance_shipping_notice,
  status: row.status,
  location_id: row.location_id || null,
  source_type: row.source_type || null,
  created_on: row.created_on || row.created_at,
  updated_on: row.updated_on || row.updated_at,
  created_by: row.created_by,
  rack: row.rack || null,        // ✅ Use row.rack (from pt.rack)
  bin: row.bin || null,          // ✅ Use row.bin (from pt.bin)
  lines_count: row.lines_count || 0
}));
```

### Common Mistakes to Avoid

**❌ WRONG:**
```javascript
// Variable not defined
const taskRack = ...;  // Missing initialization
const task = { rack: taskRack };  // Error: taskRack is not defined
```

**❌ WRONG:**
```javascript
// Using wrong variable name
const task = { rack: task.rack };  // task doesn't exist yet
```

**❌ WRONG:**
```javascript
// Missing in SELECT but trying to use
// SQL: SELECT pt.title, pt.box_id ... (no pt.rack)
const task = { rack: row.rack };  // row.rack is undefined
```

**✅ CORRECT:**
```javascript
// Use row.rack from query result
const task = { 
  rack: row.rack || null  // row.rack comes from SQL SELECT pt.rack
};
```

## Backend Checklist

### 1. Verify SQL SELECT Includes rack and bin
```sql
SELECT 
  pt.rack,    -- ✅ Must be in SELECT
  pt.bin,     -- ✅ Must be in SELECT
  ...
FROM tabPutawayTask pt
```

### 2. Verify GROUP BY Includes rack and bin
```sql
GROUP BY 
  pt.title, pt.box_id, ..., 
  pt.rack, pt.bin  -- ✅ Must be in GROUP BY if in SELECT
```

### 3. Verify Variable Usage in JavaScript
```javascript
// ✅ Use row.rack (from query result)
const rack = row.rack || null;

// ❌ Don't use undefined variable
const rack = taskRack;  // taskRack is not defined
```

### 4. Verify Response Object Building
```javascript
// ✅ Map from row object
const task = {
  rack: row.rack || null,
  bin: row.bin || null,
  ...
};
```

## Debugging Steps for Backend Developer

1. **Check SQL Query:**
   - Verify `pt.rack` and `pt.bin` are in SELECT clause
   - Verify they're in GROUP BY clause
   - Test query directly in database

2. **Check JavaScript Code:**
   - Search for `taskRack` in backend code
   - Replace with `row.rack` or `pt.rack` from query
   - Ensure variable is defined before use

3. **Check Response Building:**
   - Verify response object uses `row.rack` not `taskRack`
   - Ensure all fields come from query result

## Expected API Response Format

```json
{
  "ok": true,
  "data": [
    {
      "putaway_task": "PUT-20260101-0001",
      "box_id": "BOX-WHMAIN-220010",
      "asn_no": "ASN-12225",
      "status": "Open",
      "location_id": "A1-R01-L1-B1",
      "rack": null,           // ✅ Should be null initially (set when location scanned)
      "bin": null,            // ✅ Should be null initially (set when location scanned)
      "created_on": "2026-01-01T10:00:00.000Z",
      "updated_on": "2026-01-01T10:00:00.000Z",
      "lines_count": 2
    }
  ]
}
```

## Quick Fix

**Find this in backend code:**
```javascript
// Look for taskRack variable
const taskRack = ...;  // ❌ This is causing the error
```

**Replace with:**
```javascript
// Use row.rack from query result
const rack = row.rack || null;  // ✅ Correct
```

**Or if building response:**
```javascript
const task = {
  ...
  rack: row.rack || null,  // ✅ Use row.rack, not taskRack
  bin: row.bin || null,
  ...
};
```

## Summary

**Error:** `taskRack is not defined`

**Cause:** Backend code uses undefined variable `taskRack`

**Fix:** 
1. Include `pt.rack` and `pt.bin` in SQL SELECT
2. Include them in GROUP BY
3. Use `row.rack` and `row.bin` in JavaScript (not `taskRack`)
4. Map from query result: `rack: row.rack || null`

**Location:** Backend `GET /api/putaway/tasks` endpoint implementation

