# Cycle Count Quick Test Guide

## 🔴 Critical Issues Found

1. **Wrong HTTP Method:** You tried `GET /api/cycle-count/.../count` - This endpoint doesn't exist!
   - ✅ **Correct:** `POST /api/cycle-count/{title}/count` (for submitting counts)
   - ✅ **Correct:** `GET /api/cycle-count/{title}` (for getting task details with lines)

2. **No Backend Line Match:** Mobile app can't match items because:
   - `GET /api/cycle-count/{title}` doesn't return lines
   - Or lines don't have `id` field
   - Or lines have different `item_code` format

---

## ✅ Correct APIs to Test

### **1. Get Task Details (GET) - MUST return lines with `id` field**

**URL:** `GET /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q`

**⚠️ CRITICAL:** This endpoint MUST return `lines` array with `id` field, otherwise mobile app CANNOT match items!

**Expected Response:**
```json
{
  "title": "CC-A1-R01-L1-B1-MK82UT3Q",
  "status": "In Progress",
  "lines": [
    {
      "id": 330,  // ✅ REQUIRED: Database ID (must match tabcyclecountline.id)
      "item_code": "SKU-JACKET-201-BLK-L",  // ✅ REQUIRED: For matching
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 10.00,  // ⚠️ Should NOT be 0 (from stock ledger)
      "actual_qty": null,
      "carton_id": "CTN-433"
    },
    {
      "id": 331,
      "item_code": "SKU-HAT-301-BLU-OS",
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 15.00,  // ⚠️ Should NOT be 0
      "actual_qty": null,
      "carton_id": "CTN-433"
    }
  ]
}
```

**Test in Postman:**
```
Method: GET
URL: http://localhost:3000/api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q
Headers: Authorization: Bearer <token>
```

**Check:**
- ✅ Does response have `lines` array? (Should have 2-3 items)
- ✅ Do lines have `id` field? (Should be: 329, 330, 331)
- ✅ Do lines have `item_code`? (SKU-JACKET-201-BLK-L, SKU-HAT-301-BLU-OS)
- ❌ Is `expected_qty` = 0.00? (Should come from stock ledger, NOT 0)

---

### **2. Submit Count (POST) - Updates actual_qty**

**⚠️ IMPORTANT:** This is **POST**, NOT GET!

**URL:** `POST /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q/count`

**Request Body:**
```json
{
  "counted_by": "USER-001",
  "lines": [
    {
      "lineId": 330,  // ✅ REQUIRED: Must match database id from GET response
      "item_code": "SKU-JACKET-201-BLK-L",
      "actual_qty": 1,
      "counted_qty": 1,
      "carton_id": "CTN-433",
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 0
    }
  ]
}
```

**Test in Postman:**
```
Method: POST  ⚠️ NOT GET!
URL: http://localhost:3000/api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q/count
Headers: 
  Authorization: Bearer <token>
  Content-Type: application/json
Body: (see above)
```

**After calling, verify database:**
```sql
SELECT id, item_code, actual_qty, counted_by
FROM tabcyclecountline
WHERE id = 330;
```

**Expected:** `actual_qty = 1`, `counted_by = USER-001` ✅

---

### **3. Start Task (POST)**

**URL:** `POST /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q/start`

**Request Body:**
```json
{
  "started_by": "USER-001"
}
```

---

## 🔍 Diagnosis Steps

### Step 1: Check if GET endpoint returns lines

```bash
GET /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q
```

**If response doesn't have `lines` or `lines` is empty:**
- ❌ **Backend issue:** GET endpoint needs to return lines from `tabcyclecountline` table

**If lines don't have `id` field:**
- ❌ **Backend issue:** Lines must include `id` field (database primary key)

**If lines have `id` but `expected_qty` is 0:**
- ❌ **Backend issue:** Task creation should populate `expected_qty` from stock ledger

---

### Step 2: Check if POST /count updates database

```bash
POST /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q/count
{
  "counted_by": "USER-001",
  "lines": [
    {
      "lineId": 330,  // Use id from GET response
      "item_code": "SKU-JACKET-201-BLK-L",
      "actual_qty": 1,
      "counted_qty": 1,
      "carton_id": "CTN-433",
      "bin_location": "A1-R01-L1-B1",
      "expected_qty": 0
    }
  ]
}
```

**Then check database:**
```sql
SELECT actual_qty, counted_by 
FROM tabcyclecountline 
WHERE id = 330;
```

**If `actual_qty` is still NULL:**
- ❌ **Backend issue:** POST /count endpoint failed to update database
- Check backend logs for errors

---

## 📊 Root Cause Summary

| Issue | Root Cause | Location | Test Endpoint |
|-------|------------|----------|---------------|
| **Expected qty = 0.00** | Task creation doesn't query stock ledger | Backend | `POST /api/cycle-count` (task creation) |
| **Empty line (id 329)** | Task creation/start creates placeholder line | Backend | `POST /api/cycle-count/{title}/start` |
| **Actual qty = NULL** | POST /count not called or failed | Both | `POST /api/cycle-count/{title}/count` |
| **No backend match** | GET endpoint doesn't return lines with `id` | **Backend** | `GET /api/cycle-count/{title}` |

---

## ✅ Quick Fix Checklist

### Backend Must Fix:

1. **GET /api/cycle-count/{title}** - Must return `lines` array with `id` field:
   ```sql
   SELECT id, item_code, bin_location, expected_qty, actual_qty, carton_id, counted_by
   FROM tabcyclecountline
   WHERE parent_title = ?
   ```

2. **Task Creation** - Must set `expected_qty` from stock ledger:
   ```sql
   INSERT INTO tabcyclecountline (parent_title, item_code, bin_location, expected_qty)
   SELECT ?, item_code, bin_location, qty
   FROM stock_ledger
   WHERE bin_location = ? AND qty > 0
   ```

3. **POST /api/cycle-count/{title}/count** - Must update `actual_qty`:
   ```sql
   UPDATE tabcyclecountline
   SET actual_qty = ?, counted_by = ?, counted_on = NOW()
   WHERE id = ? AND parent_title = ?
   ```

4. **No Empty Lines** - Don't create placeholder/empty lines

---

## 🧪 Test Sequence

1. **First, get task details:**
   ```
   GET /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q
   ```
   - Verify `lines` array is returned
   - Verify each line has `id` field (329, 330, 331)
   - Note the `id` values for step 2

2. **Then, submit counts:**
   ```
   POST /api/cycle-count/CC-A1-R01-L1-B1-MK82UT3Q/count
   ```
   - Use `lineId` from step 1 (330, 331)
   - Verify response is success

3. **Finally, verify database:**
   ```sql
   SELECT id, item_code, expected_qty, actual_qty, counted_by
   FROM tabcyclecountline
   WHERE parent_title = 'CC-A1-R01-L1-B1-MK82UT3Q'
   ORDER BY id;
   ```
   - Verify `actual_qty` is updated (NOT NULL)
   - Verify `counted_by` is set

---

**Key Point:** The main issue is that `GET /api/cycle-count/{title}` is NOT returning lines with `id` field, so mobile app can't match items. This is a **backend issue** that needs to be fixed first.
