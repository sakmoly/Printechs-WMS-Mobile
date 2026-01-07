import { getDatabase } from "../database/database";

/**
 * Initialize mock data for Cycle Count testing
 */
export const initializeCycleCountMockData = async () => {
  try {
    const db = await getDatabase();

    // Mock Bins
    const mockBins = [
      {
        bin_id: "BIN-A1-01",
        bin_code: "BIN-A1-01",
        bin_barcode: "BIN-A1-01",
        warehouse_id: "WH-MAIN",
        zone: "ZONE-A",
        aisle: "Aisle 1",
        rack: "Rack 01",
        level: "Level 1",
        is_active: 1,
      },
      {
        bin_id: "BIN-A1-02",
        bin_code: "BIN-A1-02",
        bin_barcode: "BIN-A1-02",
        warehouse_id: "WH-MAIN",
        zone: "ZONE-A",
        aisle: "Aisle 1",
        rack: "Rack 02",
        level: "Level 1",
        is_active: 1,
      },
      {
        bin_id: "BIN-B2-01",
        bin_code: "BIN-B2-01",
        bin_barcode: "BIN-B2-01",
        warehouse_id: "WH-MAIN",
        zone: "ZONE-B",
        aisle: "Aisle 2",
        rack: "Rack 01",
        level: "Level 1",
        is_active: 1,
      },
    ];

    for (const bin of mockBins) {
      await db.runAsync(
        `INSERT OR REPLACE INTO bin_master_cache (
          bin_id, bin_code, bin_barcode, warehouse_id, zone, aisle, rack, level, is_active, updated_on
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bin.bin_id,
          bin.bin_code,
          bin.bin_barcode,
          bin.warehouse_id,
          bin.zone,
          bin.aisle,
          bin.rack,
          bin.level,
          bin.is_active,
          new Date().toISOString(),
        ]
      );
    }

    // Mock Item Barcode Mapping
    const mockBarcodes = [
      { barcode: "SKU-HAT-301-BLU-OS", item_code: "SKU-HAT-301-BLU-OS", uom: "EA", pack_size: 1, barcode_type: "Unit" },
      { barcode: "SKU-HAT-301-GRN-OS", item_code: "SKU-HAT-301-GRN-OS", uom: "EA", pack_size: 1, barcode_type: "Unit" },
      { barcode: "SKU-HAT-301-RED-OS", item_code: "SKU-HAT-301-RED-OS", uom: "EA", pack_size: 1, barcode_type: "Unit" },
      { barcode: "SKU-JACKET-201-BLK-L", item_code: "SKU-JACKET-201-BLK-L", uom: "EA", pack_size: 1, barcode_type: "Unit" },
      { barcode: "SKU-JACKET-201-BLK-M", item_code: "SKU-JACKET-201-BLK-M", uom: "EA", pack_size: 1, barcode_type: "Unit" },
      { barcode: "SKU-JACKET-201-BLK-XL", item_code: "SKU-JACKET-201-BLK-XL", uom: "EA", pack_size: 1, barcode_type: "Unit" },
      { barcode: "SKU-JEANS-001-BLK-32", item_code: "SKU-JEANS-001-BLK-32", uom: "EA", pack_size: 1, barcode_type: "Unit" },
    ];

    for (const barcode of mockBarcodes) {
      await db.runAsync(
        `INSERT OR REPLACE INTO item_barcode_map (
          barcode, item_code, uom, pack_size, barcode_type, updated_on
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          barcode.barcode,
          barcode.item_code,
          barcode.uom,
          barcode.pack_size,
          barcode.barcode_type,
          new Date().toISOString(),
        ]
      );
    }

    // Mock Stock Ledger Data
    const mockStock = [
      // BIN-A1-01
      { item_code: "SKU-HAT-301-BLU-OS", warehouse: "WH-MAIN", bin_location: "BIN-A1-01", qty: 25, reserved_qty: 0 },
      { item_code: "SKU-HAT-301-GRN-OS", warehouse: "WH-MAIN", bin_location: "BIN-A1-01", qty: 30, reserved_qty: 0 },
      { item_code: "SKU-HAT-301-RED-OS", warehouse: "WH-MAIN", bin_location: "BIN-A1-01", qty: 20, reserved_qty: 0 },
      // BIN-A1-02
      { item_code: "SKU-JACKET-201-BLK-L", warehouse: "WH-MAIN", bin_location: "BIN-A1-02", qty: 15, reserved_qty: 0 },
      { item_code: "SKU-JACKET-201-BLK-M", warehouse: "WH-MAIN", bin_location: "BIN-A1-02", qty: 18, reserved_qty: 0 },
      { item_code: "SKU-JACKET-201-BLK-XL", warehouse: "WH-MAIN", bin_location: "BIN-A1-02", qty: 12, reserved_qty: 0 },
      // BIN-B2-01
      { item_code: "SKU-JEANS-001-BLK-32", warehouse: "WH-MAIN", bin_location: "BIN-B2-01", qty: 40, reserved_qty: 0 },
    ];

    for (const stock of mockStock) {
      await db.runAsync(
        `INSERT OR REPLACE INTO stock_ledger_cache (
          item_code, warehouse, bin_location, qty, reserved_qty, updated_on
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          stock.item_code,
          stock.warehouse,
          stock.bin_location,
          stock.qty,
          stock.reserved_qty,
          new Date().toISOString(),
        ]
      );
    }

    console.log("✅ Cycle Count mock data initialized");
  } catch (error: any) {
    console.error("❌ Error initializing Cycle Count mock data:", error);
  }
};

