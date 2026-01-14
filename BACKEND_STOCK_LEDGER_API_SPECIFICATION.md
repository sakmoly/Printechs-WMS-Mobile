# Backend API Specification: Enhanced Stock Ledger API for Cycle Count

## 📋 Overview

This document specifies the required backend API changes to support fetching stock ledger data filtered by **Location ID (bin_location)** and **Carton ID (carton_id)** for the Cycle Count mobile application.

**Purpose:** Enable mobile users to see expected items immediately when creating an Ad-hoc cycle count task with Blind Count unchecked, improving user experience and decision-making.

---

## 🎯 Business Requirement

### **User Story:**

As a mobile user, when I create a Cycle Count task with **Blind Count unchecked**, I want to see the expected items (from stock ledger) for the specified **Location ID** and optional **Carton ID** immediately, so I can:

- Review what items should be in the bin/carton before counting
- Make informed decisions about whether to proceed with the count
- Start counting/scanning immediately without waiting for sync

### **Current Limitation:**

- Mobile app only loads from local cache (`stock_ledger_cache` table)
- Local cache may be empty or outdated
- No support for carton-level filtering
- Items only visible after task creation and navigation

### **Proposed Solution:**

- Fetch stock ledger directly from backend API
- Filter by `bin_location` (required) and `carton_id` (optional)
- Return real-time stock data
- Support both bin-level and carton-level counting

---

## 🔌 API Specification

### **Option 1: Enhance Existing Stock Ledger API (Recommended)**

#### **Endpoint:** `GET /api/stock/ledger`

#### **Current Implementation:**

```
GET /api/stock/ledger?item_code=ITEM-001&warehouse=WH-001&location=A1-R01-L2-B1
```

**Current Query Parameters:**

- `item_code` (optional): Filter by item code
- `warehouse` (optional): Filter by warehouse code
- `location` (optional): Filter by location code

#### **Proposed Enhanced Implementation:**

**New Query Parameters:**

- `bin_location` (required): Filter by bin code or location ID (e.g., `A1-R01-L2-B1`)
  - **Alias:** `bin_code`, `bin_id`, `location_id`
  - **Validation:** Must not be empty
  - **Format:** String, case-insensitive matching recommended
- `carton_id` (optional): Filter by carton ID for carton-level inventory (e.g., `CTN-001`)
  - **Purpose:** Enable carton-level stock filtering
  - **Validation:** If provided, must not be empty
  - **Format:** String, case-insensitive matching recommended
- `warehouse` (optional): Filter by warehouse code (keep existing)
- `item_code` (optional): Filter by specific item code (keep existing)
- `location` (optional): Filter by location code (keep existing, for backward compatibility)

**Parameter Priority:**

1. If `bin_location` is provided, it takes priority over `location`
2. If both `bin_location` and `location` are provided, use `bin_location`
3. `carton_id` is only applied when `bin_location` is also provided

---

### **Request Examples:**

#### **Example 1: Bin-Level Stock (No Carton)**

```
GET /api/stock/ledger?bin_location=A1-R01-L2-B1
```

**Expected Response:**

```json
{
  "data": [
    {
      "item_code": "SKU-JACKET-201-BLK-L",
      "item_name": "Jacket Black Large",
      "barcode": "100000000001",
      "qty": 5,
      "bin_location": "A1-R01-L2-B1",
      "carton_id": null,
      "warehouse": "WH-001",
      "warehouse_id": "WH-001",
      "uom": "EA",
      "last_updated": "2025-01-27T10:00:00Z",
      "batch_no": null,
      "serial_no": null
    },
    {
      "item_code": "SKU-SHIRT-001-WHT-M",
      "item_name": "Shirt White Medium",
      "barcode": "100000000002",
      "qty": 3,
      "bin_location": "A1-R01-L2-B1",
      "carton_id": null,
      "warehouse": "WH-001",
      "warehouse_id": "WH-001",
      "uom": "EA",
      "last_updated": "2025-01-27T10:00:00Z",
      "batch_no": null,
      "serial_no": null
    }
  ],
  "total": 2,
  "bin_location": "A1-R01-L2-B1",
  "carton_id": null
}
```

#### **Example 2: Carton-Level Stock (With Carton ID)**

```
GET /api/stock/ledger?bin_location=A1-R01-L2-B1&carton_id=CTN-001
```

**Expected Response:**

```json
{
  "data": [
    {
      "item_code": "SKU-JACKET-201-BLK-L",
      "item_name": "Jacket Black Large",
      "barcode": "100000000001",
      "qty": 5,
      "bin_location": "A1-R01-L2-B1",
      "carton_id": "CTN-001",
      "warehouse": "WH-001",
      "warehouse_id": "WH-001",
      "uom": "EA",
      "last_updated": "2025-01-27T10:00:00Z",
      "batch_no": "BATCH-001",
      "serial_no": null
    }
  ],
  "total": 1,
  "bin_location": "A1-R01-L2-B1",
  "carton_id": "CTN-001"
}
```

#### **Example 3: With Additional Filters**

```
GET /api/stock/ledger?bin_location=A1-R01-L2-B1&carton_id=CTN-001&warehouse=WH-001
```

**Expected Response:**
Same format as Example 2, but filtered by warehouse as well.

---

### **Response Schema:**

#### **Success Response (200 OK):**

```json
{
  "data": Array<StockLedgerEntry>,
  "total": number,
  "bin_location": string,
  "carton_id": string | null
}
```

#### **StockLedgerEntry Object:**

```typescript
interface StockLedgerEntry {
  // Required Fields
  item_code: string; // Item code (e.g., "SKU-JACKET-201-BLK-L")
  qty: number; // Current quantity in stock (always a number, can be 0)

  // Location Fields
  bin_location: string; // Bin code or location ID (e.g., "A1-R01-L2-B1")
  carton_id: string | null; // Carton ID if carton-level inventory (e.g., "CTN-001" or null)
  warehouse: string; // Warehouse code (e.g., "WH-001")
  warehouse_id: string; // Warehouse ID (e.g., "WH-001")

  // Item Details (Optional but Recommended)
  item_name?: string; // Item name (e.g., "Jacket Black Large")
  barcode?: string; // Item barcode (e.g., "100000000001")
  uom?: string; // Unit of measure (e.g., "EA", "PC", "BOX")

  // Additional Metadata (Optional)
  batch_no?: string | null; // Batch number if applicable
  serial_no?: string | null; // Serial number if applicable
  last_updated?: string; // ISO 8601 timestamp (e.g., "2025-01-27T10:00:00Z")
  expiry_date?: string | null; // Expiry date if applicable (ISO 8601 format)
}
```

#### **Error Response (400 Bad Request):**

```json
{
  "error": {
    "code": "INVALID_PARAMETER",
    "message": "bin_location parameter is required",
    "details": {
      "parameter": "bin_location",
      "value": null,
      "expected": "string (non-empty)"
    }
  }
}
```

#### **Error Response (404 Not Found):**

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "No stock found for bin_location: A1-R01-L2-B1",
    "details": {
      "bin_location": "A1-R01-L2-B1",
      "carton_id": null
    }
  }
}
```

**Note:** Return `200 OK` with empty `data: []` array instead of `404` if no stock found (preferred approach for mobile apps).

#### **Error Response (500 Internal Server Error):**

```json
{
  "error": {
    "code": "DATABASE_ERROR",
    "message": "Failed to query stock ledger",
    "details": {
      "error": "Connection timeout"
    }
  }
}
```

---

## 🔍 Database Query Logic

### **SQL Query Structure:**

#### **Case 1: Bin-Level Stock (No Carton ID)**

```sql
SELECT
  sl.item_code,
  sl.qty,
  sl.bin_location,
  sl.carton_id,
  sl.warehouse,
  sl.warehouse_id,
  im.item_name,
  im.barcode,
  im.uom,
  sl.batch_no,
  sl.serial_no,
  sl.last_updated,
  sl.expiry_date
FROM stock_ledger sl
LEFT JOIN item_master im ON sl.item_code = im.item_code
WHERE
  UPPER(TRIM(sl.bin_location)) = UPPER(TRIM(:bin_location))
  AND (sl.carton_id IS NULL OR sl.carton_id = '')
  AND (:warehouse IS NULL OR UPPER(TRIM(sl.warehouse)) = UPPER(TRIM(:warehouse)))
  AND (:item_code IS NULL OR UPPER(TRIM(sl.item_code)) = UPPER(TRIM(:item_code)))
  AND sl.qty > 0  -- Only show items with stock > 0 (optional: can include 0 for complete view)
ORDER BY sl.item_code ASC;
```

#### **Case 2: Carton-Level Stock (With Carton ID)**

```sql
SELECT
  sl.item_code,
  sl.qty,
  sl.bin_location,
  sl.carton_id,
  sl.warehouse,
  sl.warehouse_id,
  im.item_name,
  im.barcode,
  im.uom,
  sl.batch_no,
  sl.serial_no,
  sl.last_updated,
  sl.expiry_date
FROM stock_ledger sl
LEFT JOIN item_master im ON sl.item_code = im.item_code
WHERE
  UPPER(TRIM(sl.bin_location)) = UPPER(TRIM(:bin_location))
  AND UPPER(TRIM(sl.carton_id)) = UPPER(TRIM(:carton_id))
  AND (:warehouse IS NULL OR UPPER(TRIM(sl.warehouse)) = UPPER(TRIM(:warehouse)))
  AND (:item_code IS NULL OR UPPER(TRIM(sl.item_code)) = UPPER(TRIM(:item_code)))
  AND sl.qty > 0  -- Only show items with stock > 0 (optional: can include 0 for complete view)
ORDER BY sl.item_code ASC;
```

### **Notes on Query:**

- Use case-insensitive matching for `bin_location` and `carton_id`
- Trim whitespace from parameters
- Join with `item_master` to get item details (item_name, barcode, uom)
- Filter `qty > 0` to show only items with stock (optional: backend can decide)
- Include `qty = 0` items if complete view is needed for cycle count
- Order by `item_code` for consistent results

---

## 🔄 Alternative: Dedicated Cycle Count Stock API

### **Option 2: New Dedicated Endpoint (Alternative Approach)**

If modifying the existing stock ledger API is not preferred, create a dedicated endpoint optimized for cycle count workflow.

#### **Endpoint:** `GET /api/cycle-count/stock-by-location`

#### **Query Parameters:**

- `bin_location` (required): Bin code or location ID
- `carton_id` (optional): Carton ID for carton-level filtering
- `warehouse` (optional): Warehouse code for additional filtering

#### **Request Example:**

```
GET /api/cycle-count/stock-by-location?bin_location=A1-R01-L2-B1&carton_id=CTN-001
```

#### **Response Format:**

```json
{
  "bin_location": "A1-R01-L2-B1",
  "carton_id": "CTN-001",
  "warehouse": "WH-001",
  "items": [
    {
      "item_code": "SKU-JACKET-201-BLK-L",
      "item_name": "Jacket Black Large",
      "barcode": "100000000001",
      "expected_qty": 5,
      "uom": "EA",
      "bin_location": "A1-R01-L2-B1",
      "carton_id": "CTN-001"
    }
  ],
  "total_items": 1,
  "total_qty": 5,
  "last_updated": "2025-01-27T10:00:00Z"
}
```

**Advantages:**

- ✅ Optimized specifically for cycle count workflow
- ✅ Returns formatted data with `expected_qty` (same as `qty`)
- ✅ Doesn't modify existing stock ledger API
- ✅ Can add cycle count-specific logic if needed

**Disadvantages:**

- ❌ Additional endpoint to maintain
- ❌ Duplicate logic if stock ledger API already exists
- ❌ Requires separate documentation

---

## ✅ Recommendation

**Recommended Approach: Option 1 (Enhance Existing Stock Ledger API)**

**Reasons:**

1. ✅ Reuses existing infrastructure
2. ✅ More flexible for other use cases
3. ✅ Single source of truth for stock data
4. ✅ Easier to maintain
5. ✅ Backward compatible (existing parameters still work)

**Implementation Priority:**

1. **High**: Add `bin_location` filter
2. **High**: Add `carton_id` filter
3. **Medium**: Include `carton_id` in response
4. **Low**: Optimize query performance (indexes)

---

## 🔒 Security & Authorization

### **Authentication:**

- ✅ Requires valid JWT token (Bearer token)
- ✅ Token must be valid and not expired
- ✅ Token must have appropriate permissions

### **Authorization:**

- ✅ User must have access to the warehouse specified in `warehouse` filter
- ✅ User must have "View Stock" or "Cycle Count" permissions
- ✅ Restrict access to stock data based on user's warehouse access

### **Validation:**

- ✅ Validate `bin_location` format (must not be empty, max length check)
- ✅ Validate `carton_id` format if provided (must not be empty, max length check)
- ✅ Validate `warehouse` format if provided (must match user's accessible warehouses)
- ✅ Sanitize inputs to prevent SQL injection

---

## ⚡ Performance Considerations

### **Database Indexes:**

Ensure the following indexes exist for optimal performance:

```sql
-- Index for bin_location queries
CREATE INDEX idx_stock_ledger_bin_location ON stock_ledger(bin_location);

-- Index for carton_id queries (if carton-level inventory is supported)
CREATE INDEX idx_stock_ledger_carton_id ON stock_ledger(carton_id);

-- Composite index for bin_location + carton_id queries
CREATE INDEX idx_stock_ledger_bin_carton ON stock_ledger(bin_location, carton_id);

-- Composite index for warehouse + bin_location queries
CREATE INDEX idx_stock_ledger_warehouse_bin ON stock_ledger(warehouse, bin_location);

-- Index for item_code lookups (for item_master join)
CREATE INDEX idx_item_master_item_code ON item_master(item_code);
```

### **Query Optimization:**

- Use `LEFT JOIN` instead of `INNER JOIN` if item_master is optional
- Limit results if needed (e.g., max 1000 items per request)
- Cache frequently accessed bins/cartons if appropriate
- Use pagination if expected result set is large

### **Response Time Targets:**

- ✅ < 500ms for bin-level queries (typical: 10-50 items)
- ✅ < 1000ms for carton-level queries (typical: 5-20 items)
- ✅ < 2000ms for large bins (100+ items)

---

## 📊 Testing Requirements

### **Unit Tests:**

- ✅ Test with valid `bin_location` only
- ✅ Test with valid `bin_location` + `carton_id`
- ✅ Test with non-existent `bin_location` (should return empty array)
- ✅ Test with non-existent `carton_id` (should return bin-level items only)
- ✅ Test with invalid `bin_location` format (should return 400 error)
- ✅ Test with missing `bin_location` (should return 400 error)
- ✅ Test with additional filters (`warehouse`, `item_code`)

### **Integration Tests:**

- ✅ Test with real database data
- ✅ Test with multiple warehouses
- ✅ Test with carton-level inventory
- ✅ Test with bin-level inventory
- ✅ Test with items that have `qty = 0` (verify behavior)
- ✅ Test with items that have `carton_id = null` (should be included in bin-level results)

### **Performance Tests:**

- ✅ Test with bins containing 10 items
- ✅ Test with bins containing 100 items
- ✅ Test with bins containing 1000+ items (if applicable)
- ✅ Test concurrent requests (10+ simultaneous requests)

### **Security Tests:**

- ✅ Test without authentication (should return 401)
- ✅ Test with expired token (should return 401)
- ✅ Test with user without warehouse access (should return 403 or empty results)
- ✅ Test SQL injection attempts (should be sanitized/rejected)

---

## 📝 API Documentation Template

### **OpenAPI/Swagger Specification:**

```yaml
paths:
  /api/stock/ledger:
    get:
      summary: Get stock ledger filtered by bin location and carton ID
      description: |
        Retrieves stock ledger entries filtered by bin location (required) and optional carton ID.
        Designed for Cycle Count mobile workflow to fetch expected items before creating tasks.
      tags:
        - Stock
        - Cycle Count
      security:
        - BearerAuth: []
      parameters:
        - name: bin_location
          in: query
          required: true
          description: Bin code or location ID (e.g., A1-R01-L2-B1)
          schema:
            type: string
            example: "A1-R01-L2-B1"
        - name: carton_id
          in: query
          required: false
          description: Carton ID for carton-level filtering (e.g., CTN-001)
          schema:
            type: string
            example: "CTN-001"
        - name: warehouse
          in: query
          required: false
          description: Warehouse code for additional filtering
          schema:
            type: string
            example: "WH-001"
        - name: item_code
          in: query
          required: false
          description: Item code for specific item filtering
          schema:
            type: string
            example: "SKU-JACKET-201-BLK-L"
      responses:
        "200":
          description: Successful response with stock ledger entries
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/StockLedgerResponse"
        "400":
          description: Bad request (missing or invalid parameters)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "401":
          description: Unauthorized (missing or invalid token)
        "403":
          description: Forbidden (insufficient permissions)
        "500":
          description: Internal server error

components:
  schemas:
    StockLedgerResponse:
      type: object
      properties:
        data:
          type: array
          items:
            $ref: "#/components/schemas/StockLedgerEntry"
        total:
          type: integer
          description: Total number of entries returned
        bin_location:
          type: string
          description: The bin location used in the query
        carton_id:
          type: string
          nullable: true
          description: The carton ID used in the query (null if not provided)

    StockLedgerEntry:
      type: object
      required:
        - item_code
        - qty
        - bin_location
        - warehouse
      properties:
        item_code:
          type: string
          example: "SKU-JACKET-201-BLK-L"
        item_name:
          type: string
          example: "Jacket Black Large"
        barcode:
          type: string
          example: "100000000001"
        qty:
          type: number
          example: 5
        bin_location:
          type: string
          example: "A1-R01-L2-B1"
        carton_id:
          type: string
          nullable: true
          example: "CTN-001"
        warehouse:
          type: string
          example: "WH-001"
        warehouse_id:
          type: string
          example: "WH-001"
        uom:
          type: string
          example: "EA"
        batch_no:
          type: string
          nullable: true
        serial_no:
          type: string
          nullable: true
        last_updated:
          type: string
          format: date-time
          example: "2025-01-27T10:00:00Z"

    ErrorResponse:
      type: object
      properties:
        error:
          type: object
          properties:
            code:
              type: string
              example: "INVALID_PARAMETER"
            message:
              type: string
              example: "bin_location parameter is required"
            details:
              type: object
```

---

## 🔄 Migration Plan

### **Phase 1: Backend Development (Week 1)**

1. ✅ Add `bin_location` parameter to existing Stock Ledger API
2. ✅ Update database query to filter by `bin_location`
3. ✅ Add unit tests for new parameter
4. ✅ Deploy to development environment

### **Phase 2: Add Carton ID Support (Week 2)**

1. ✅ Add `carton_id` parameter to Stock Ledger API
2. ✅ Update database query to filter by `carton_id` when provided
3. ✅ Include `carton_id` in response for each entry
4. ✅ Add integration tests for carton-level filtering
5. ✅ Deploy to staging environment

### **Phase 3: Mobile App Integration (Week 3)**

1. ✅ Mobile team implements API call with new parameters
2. ✅ Mobile team adds preview functionality
3. ✅ End-to-end testing with backend
4. ✅ User acceptance testing

### **Phase 4: Production Deployment (Week 4)**

1. ✅ Backend deployed to production
2. ✅ Mobile app update released
3. ✅ Monitor performance and errors
4. ✅ Gather user feedback

---

## 📞 Contact & Support

### **Backend Team Contact:**

- **API Developer:** [Name/Email]
- **Database Admin:** [Name/Email]
- **Tech Lead:** [Name/Email]

### **Mobile Team Contact:**

- **Mobile Developer:** [Name/Email]
- **Product Owner:** [Name/Email]

### **Questions or Issues:**

- Create ticket in [Issue Tracker]
- Email: [Support Email]
- Slack Channel: #cycle-count-api

---

## ✅ Checklist for Backend Team

### **Development:**

- [ ] Add `bin_location` parameter to Stock Ledger API
- [ ] Add `carton_id` parameter to Stock Ledger API
- [ ] Update database query to support both parameters
- [ ] Include `carton_id` in response for each entry
- [ ] Add proper error handling and validation
- [ ] Add authentication and authorization checks
- [ ] Create/update database indexes for performance

### **Testing:**

- [ ] Write unit tests for new parameters
- [ ] Write integration tests with real database
- [ ] Test with bin-level queries (no carton_id)
- [ ] Test with carton-level queries (with carton_id)
- [ ] Test error cases (invalid parameters, missing data)
- [ ] Test performance with large datasets
- [ ] Test security (authentication, authorization, SQL injection)

### **Documentation:**

- [ ] Update API documentation (Swagger/OpenAPI)
- [ ] Update internal API documentation
- [ ] Create migration guide if needed
- [ ] Update changelog

### **Deployment:**

- [ ] Deploy to development environment
- [ ] Deploy to staging environment
- [ ] Perform smoke tests in staging
- [ ] Coordinate with mobile team for integration testing
- [ ] Deploy to production
- [ ] Monitor production performance and errors

---

## 📋 Summary

### **Required Changes:**

1. ✅ Add `bin_location` query parameter (required)
2. ✅ Add `carton_id` query parameter (optional)
3. ✅ Update database query to filter by both parameters
4. ✅ Include `carton_id` in response for each stock entry
5. ✅ Add proper validation and error handling

### **No Changes Required For:**

- ✅ Existing query parameters (`warehouse`, `item_code`, `location`)
- ✅ Authentication/authorization mechanism
- ✅ Response format structure (only addition of `carton_id` field)
- ✅ Other endpoints

### **Timeline:**

- **Estimated Development Time:** 2-3 days
- **Testing Time:** 1-2 days
- **Total Estimated Time:** 1 week

---

**Status:** ✅ **Ready for Backend Implementation**

**Priority:** 🔴 **High** (Blocks mobile app feature implementation)
