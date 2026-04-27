/**
 * Stock Upload Utility Script
 * 
 * This script allows you to upload item stock data by location.
 * It can be used to:
 * - Import stock data from CSV/JSON files
 * - Bulk update stock quantities by location
 * - Initialize stock data for testing
 * 
 * Usage:
 * 1. Import this script in your code
 * 2. Prepare stock data in the required format
 * 3. Call uploadStockData() with your data
 * 
 * Example:
 * ```typescript
 * import { uploadStockData } from './utils/upload-stock-by-location';
 * 
 * const stockData = [
 *   {
 *     item_code: "SKU-HAT-301-BLU-OS",
 *     warehouse: "WH-MAIN",
 *     location_id: "A1-R01-L1-B1",
 *     bin_location: "A1-R01-L1-B1",
 *     qty: 15
 *   },
 *   {
 *     item_code: "SKU-HAT-301-BLU-OS",
 *     warehouse: "WH-MAIN",
 *     location_id: "B2-R02-L2-B3",
 *     bin_location: "B2-R02-L2-B3",
 *     qty: 10
 *   }
 * ];
 * 
 * await uploadStockData(stockData);
 * ```
 */

import { apiService } from "../services/api.service";
import { getSettings } from "../services/settings.service";

export interface StockLocationData {
  item_code: string;
  warehouse: string;
  location_id: string;
  bin_location?: string;
  qty: number;
  uom?: string;
  batch_no?: string;
  expiry_date?: string;
  serial_no?: string;
}

/**
 * Upload stock data by location
 * @param stockData Array of stock location data
 * @param options Upload options
 * @returns Upload result with success/failure details
 */
export async function uploadStockData(
  stockData: StockLocationData[],
  options?: {
    batchSize?: number;
    continueOnError?: boolean;
    validateBeforeUpload?: boolean;
  }
): Promise<{
  success: boolean;
  total: number;
  uploaded: number;
  failed: number;
  errors: { item_code: string; location_id: string; error: string }[];
}> {
  const batchSize = options?.batchSize || 100;
  const continueOnError = options?.continueOnError ?? true;
  const validateBeforeUpload = options?.validateBeforeUpload ?? true;

  console.log(`📤 Starting stock upload: ${stockData.length} records`);

  // Validate data before upload
  if (validateBeforeUpload) {
    const validationErrors = validateStockData(stockData);
    if (validationErrors.length > 0) {
      console.error("❌ Validation errors found:");
      validationErrors.forEach((error) => console.error(`  - ${error}`));
      throw new Error(`Validation failed: ${validationErrors.join(", ")}`);
    }
    console.log("✅ Data validation passed");
  }

  // Check authentication
  const settings = await getSettings();
  if (!settings.api_url) {
    throw new Error("API URL not configured. Please set API URL in settings.");
  }

  const errors: { item_code: string; location_id: string; error: string }[] = [];
  let uploaded = 0;
  let failed = 0;

  // Process in batches
  for (let i = 0; i < stockData.length; i += batchSize) {
    const batch = stockData.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(stockData.length / batchSize);

    console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} records)...`);

    try {
      let batchFailed = 0;
      for (const row of batch) {
        try {
          await apiService.updateStockByLocation({
            location_id: row.location_id,
            item_code: row.item_code,
            qty: row.qty,
          });
          uploaded += 1;
        } catch (rowErr: any) {
          batchFailed += 1;
          failed += 1;
          errors.push({
            item_code: row.item_code,
            location_id: row.location_id,
            error: rowErr?.message || String(rowErr),
          });
        }
      }

      if (batchFailed === 0) {
        console.log(
          `✅ Batch ${batchNumber} completed: ${batch.length} uploaded, 0 failed`
        );
      } else {
        console.warn(
          `⚠️ Batch ${batchNumber} partial: ${batch.length - batchFailed} ok, ${batchFailed} failed`
        );
      }
    } catch (error: any) {
      console.error(`❌ Batch ${batchNumber} failed:`, error.message);

      if (!continueOnError) {
        throw error;
      }

      // Try individual uploads for this batch
      for (const record of batch) {
        try {
          await apiService.updateStockByLocation(record);
          uploaded++;
        } catch (recordError: any) {
          failed++;
          errors.push({
            item_code: record.item_code,
            location_id: record.location_id,
            error: recordError.message || "Unknown error",
          });
        }
      }
    }
  }

  const result = {
    success: failed === 0,
    total: stockData.length,
    uploaded,
    failed,
    errors,
  };

  console.log(`\n📊 Upload Summary:`);
  console.log(`   Total: ${result.total}`);
  console.log(`   Uploaded: ${result.uploaded}`);
  console.log(`   Failed: ${result.failed}`);
  if (result.errors.length > 0) {
    console.log(`\n❌ Errors:`);
    result.errors.forEach((error) => {
      console.log(`   - ${error.item_code} @ ${error.location_id}: ${error.error}`);
    });
  }

  return result;
}

/**
 * Validate stock data before upload
 */
function validateStockData(stockData: StockLocationData[]): string[] {
  const errors: string[] = [];

  stockData.forEach((record, index) => {
    if (!record.item_code || record.item_code.trim() === "") {
      errors.push(`Record ${index + 1}: item_code is required`);
    }
    if (!record.warehouse || record.warehouse.trim() === "") {
      errors.push(`Record ${index + 1}: warehouse is required`);
    }
    if (!record.location_id || record.location_id.trim() === "") {
      errors.push(`Record ${index + 1}: location_id is required`);
    }
    if (typeof record.qty !== "number" || record.qty < 0) {
      errors.push(`Record ${index + 1}: qty must be a non-negative number`);
    }
  });

  return errors;
}

/**
 * Parse CSV file content to stock data
 * Expected CSV format:
 * item_code,warehouse,location_id,bin_location,qty,uom,batch_no,expiry_date,serial_no
 */
export function parseCSVToStockData(csvContent: string): StockLocationData[] {
  const lines = csvContent.split("\n").filter((line) => line.trim() !== "");
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());

  const stockData: StockLocationData[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    const record: any = {};

    headers.forEach((header, index) => {
      const value = values[index] || "";
      if (header === "qty") {
        record[header] = parseFloat(value) || 0;
      } else if (value !== "") {
        record[header] = value;
      }
    });

    // Map CSV headers to our data structure
    stockData.push({
      item_code: record.item_code || record["item code"] || "",
      warehouse: record.warehouse || "",
      location_id: record.location_id || record["location id"] || record["location"] || "",
      bin_location: record.bin_location || record["bin location"] || record.location_id || "",
      qty: record.qty || 0,
      uom: record.uom || undefined,
      batch_no: record.batch_no || record["batch no"] || undefined,
      expiry_date: record.expiry_date || record["expiry date"] || undefined,
      serial_no: record.serial_no || record["serial no"] || undefined,
    });
  }

  return stockData;
}

/**
 * Example stock data for testing
 */
export const exampleStockData: StockLocationData[] = [
  {
    item_code: "SKU-HAT-301-BLU-OS",
    warehouse: "WH-MAIN",
    location_id: "A1-R01-L1-B1",
    bin_location: "A1-R01-L1-B1",
    qty: 15,
  },
  {
    item_code: "SKU-HAT-301-BLU-OS",
    warehouse: "WH-MAIN",
    location_id: "B2-R02-L2-B3",
    bin_location: "B2-R02-L2-B3",
    qty: 10,
  },
  {
    item_code: "SKU-HAT-301-BLU-OS",
    warehouse: "WH-MAIN",
    location_id: "C3-R03-L3-B5",
    bin_location: "C3-R03-L3-B5",
    qty: 5,
  },
  {
    item_code: "SKU-JACKET-201-BLK-L",
    warehouse: "WH-MAIN",
    location_id: "A1-R01-L1-B1",
    bin_location: "A1-R01-L1-B1",
    qty: 20,
  },
  {
    item_code: "SKU-SHIRT-003-GRY-M",
    warehouse: "WH-MAIN",
    location_id: "B2-R02-L2-B3",
    bin_location: "B2-R02-L2-B3",
    qty: 25,
  },
];

/**
 * Generate sample stock data for multiple items across multiple locations
 */
export function generateSampleStockData(
  itemCodes: string[],
  warehouse: string,
  locations: string[],
  minQty: number = 5,
  maxQty: number = 50
): StockLocationData[] {
  const stockData: StockLocationData[] = [];

  itemCodes.forEach((itemCode) => {
    // Randomly assign 1-3 locations per item
    const numLocations = Math.floor(Math.random() * 3) + 1;
    const selectedLocations = locations
      .sort(() => Math.random() - 0.5)
      .slice(0, numLocations);

    selectedLocations.forEach((location) => {
      const qty = Math.floor(Math.random() * (maxQty - minQty + 1)) + minQty;
      stockData.push({
        item_code: itemCode,
        warehouse: warehouse,
        location_id: location,
        bin_location: location,
        qty: qty,
      });
    });
  });

  return stockData;
}

