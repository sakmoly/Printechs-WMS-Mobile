# Stock Upload by Location - User Guide

This guide explains how to upload item stock data by location using the stock upload utility script.

## Overview

The stock upload utility allows you to:
- Upload stock quantities for items at specific warehouse locations
- Bulk import stock data from CSV files
- Update stock data programmatically
- Initialize stock data for testing

## API Endpoints

The following API endpoints are used for stock upload:

### Bulk Upload
```
POST /api/stock-ledger/upload
Content-Type: application/json

{
  "stock_data": [
    {
      "item_code": "SKU-HAT-301-BLU-OS",
      "warehouse": "WH-MAIN",
      "location_id": "A1-R01-L1-B1",
      "bin_location": "A1-R01-L1-B1",
      "qty": 15,
      "uom": "PCS",
      "batch_no": "BATCH-001",
      "expiry_date": "2025-12-31",
      "serial_no": "SN-12345"
    }
  ]
}
```

### Single Update
```
POST /api/stock-ledger/update
Content-Type: application/json

{
  "item_code": "SKU-HAT-301-BLU-OS",
  "warehouse": "WH-MAIN",
  "location_id": "A1-R01-L1-B1",
  "bin_location": "A1-R01-L1-B1",
  "qty": 15
}
```

## Data Structure

### Required Fields
- `item_code`: Item code/SKU
- `warehouse`: Warehouse code
- `location_id`: Location identifier (e.g., "A1-R01-L1-B1")
- `qty`: Quantity (non-negative number)

### Optional Fields
- `bin_location`: Bin location (defaults to `location_id` if not provided)
- `uom`: Unit of measure (e.g., "PCS", "BOX", "KG")
- `batch_no`: Batch number
- `expiry_date`: Expiry date (ISO format: "YYYY-MM-DD")
- `serial_no`: Serial number

## Usage Examples

### 1. Basic Upload (TypeScript/JavaScript)

```typescript
import { uploadStockData, StockLocationData } from './utils/upload-stock-by-location';

const stockData: StockLocationData[] = [
  {
    item_code: "SKU-HAT-301-BLU-OS",
    warehouse: "WH-MAIN",
    location_id: "A1-R01-L1-B1",
    bin_location: "A1-R01-L1-B1",
    qty: 15
  },
  {
    item_code: "SKU-HAT-301-BLU-OS",
    warehouse: "WH-MAIN",
    location_id: "B2-R02-L2-B3",
    bin_location: "B2-R02-L2-B3",
    qty: 10
  }
];

const result = await uploadStockData(stockData);
console.log(`Uploaded: ${result.uploaded}/${result.total}`);
```

### 2. Upload with Options

```typescript
const result = await uploadStockData(stockData, {
  batchSize: 50,              // Upload 50 records per batch
  continueOnError: true,       // Continue even if some records fail
  validateBeforeUpload: true   // Validate data before uploading
});
```

### 3. Parse CSV File

```typescript
import { parseCSVToStockData, uploadStockData } from './utils/upload-stock-by-location';
import * as FileSystem from 'expo-file-system';

// Read CSV file
const csvContent = await FileSystem.readAsStringAsync('stock-data.csv');

// Parse CSV to stock data
const stockData = parseCSVToStockData(csvContent);

// Upload
await uploadStockData(stockData);
```

### 4. Generate Sample Data

```typescript
import { generateSampleStockData, uploadStockData } from './utils/upload-stock-by-location';

const itemCodes = [
  "SKU-HAT-301-BLU-OS",
  "SKU-JACKET-201-BLK-L",
  "SKU-SHIRT-003-GRY-M"
];

const locations = [
  "A1-R01-L1-B1",
  "B2-R02-L2-B3",
  "C3-R03-L3-B5"
];

const sampleData = generateSampleStockData(
  itemCodes,
  "WH-MAIN",
  locations,
  5,   // min qty
  50   // max qty
);

await uploadStockData(sampleData);
```

## CSV Format

### Expected CSV Structure

```csv
item_code,warehouse,location_id,bin_location,qty,uom,batch_no,expiry_date,serial_no
SKU-HAT-301-BLU-OS,WH-MAIN,A1-R01-L1-B1,A1-R01-L1-B1,15,PCS,BATCH-001,2025-12-31,SN-12345
SKU-HAT-301-BLU-OS,WH-MAIN,B2-R02-L2-B3,B2-R02-L2-B3,10,PCS,BATCH-002,2025-12-31,
SKU-JACKET-201-BLK-L,WH-MAIN,A1-R01-L1-B1,A1-R01-L1-B1,20,PCS,,,
```

### CSV Headers (Case Insensitive)
- `item_code` or `item code`
- `warehouse`
- `location_id` or `location id` or `location`
- `bin_location` or `bin location`
- `qty`
- `uom`
- `batch_no` or `batch no`
- `expiry_date` or `expiry date`
- `serial_no` or `serial no`

## Error Handling

The upload function returns a result object with error details:

```typescript
const result = await uploadStockData(stockData);

if (!result.success) {
  console.error(`Failed to upload ${result.failed} records`);
  result.errors.forEach(error => {
    console.error(`${error.item_code} @ ${error.location_id}: ${error.error}`);
  });
}
```

## Backend Requirements

### Database Schema

The backend should have a stock ledger table with the following structure:

```sql
CREATE TABLE tabstock_ledger (
  name VARCHAR(140) PRIMARY KEY,
  item_code VARCHAR(140) NOT NULL,
  warehouse VARCHAR(140) NOT NULL,
  location_id VARCHAR(140) NOT NULL,
  bin_location VARCHAR(140),
  qty DECIMAL(18, 2) NOT NULL DEFAULT 0,
  uom VARCHAR(20),
  batch_no VARCHAR(140),
  expiry_date DATE,
  serial_no VARCHAR(140),
  created_on DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_on DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_item_warehouse (item_code, warehouse),
  INDEX idx_location (location_id),
  INDEX idx_bin_location (bin_location)
);
```

### API Implementation

The backend should implement:

1. **POST /api/stock-ledger/upload** - Bulk upload endpoint
   - Accepts array of stock data
   - Validates all records
   - Returns success/failure for each record
   - Supports transaction rollback on critical errors

2. **POST /api/stock-ledger/update** - Single record update
   - Updates or inserts stock record
   - Validates data
   - Returns updated record

### Validation Rules

- `item_code` must exist in item master
- `warehouse` must exist in warehouse master
- `location_id` must exist in location master
- `qty` must be >= 0
- `expiry_date` must be valid date (if provided)

## Testing

### Test with Sample Data

```typescript
import { exampleStockData, uploadStockData } from './utils/upload-stock-by-location';

// Upload example data
const result = await uploadStockData(exampleStockData);
console.log(result);
```

### Verify Upload

After uploading, verify stock using the stock API:

```typescript
import { apiService } from './services/api.service';

// Get stock for an item
const stock = await apiService.getStockByItemAndWarehouse(
  "SKU-HAT-301-BLU-OS",
  "WH-MAIN"
);

console.log("Stock locations:", stock);
```

## Troubleshooting

### Common Issues

1. **"API URL not configured"**
   - Set API URL in app settings
   - Ensure backend is running

2. **"Validation failed"**
   - Check that all required fields are present
   - Verify data types (qty must be number)
   - Ensure no empty required fields

3. **"Item not found"**
   - Verify item_code exists in item master
   - Check warehouse code is correct

4. **"Location not found"**
   - Verify location_id exists in location master
   - Check location format matches backend

### Debug Mode

Enable detailed logging:

```typescript
// The upload function logs detailed progress
// Check console for:
// - Batch processing status
// - Individual record success/failure
// - Final summary with error details
```

## Best Practices

1. **Validate Before Upload**: Always enable `validateBeforeUpload` option
2. **Use Batches**: For large datasets, use appropriate batch sizes (50-100 records)
3. **Error Handling**: Always check the result and handle errors appropriately
4. **Data Backup**: Backup existing stock data before bulk updates
5. **Incremental Updates**: For large datasets, consider incremental updates rather than full replacement

## Support

For issues or questions:
1. Check console logs for detailed error messages
2. Verify backend API endpoints are implemented
3. Ensure database schema matches requirements
4. Test with sample data first before production uploads

