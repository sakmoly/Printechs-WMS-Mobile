import * as SQLite from "expo-sqlite";
import { ALL_MIGRATIONS } from "./schema";

/**
 * Run schema migrations to add new columns to existing tables
 * SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we check first
 */
export async function runSchemaMigrations(db: SQLite.SQLiteDatabase) {
  try {
    // Check if settings table exists and has active_asn column
    const settingsColumns = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(settings)"
    );

    if (settingsColumns.length === 0) {
      // Table doesn't exist yet, will be created by CREATE_SETTINGS_TABLE
      console.log(
        "📝 Settings table does not exist yet, will be created by migration."
      );
      return;
    }

    const hasActiveAsn = settingsColumns.some(
      (col) => col.name === "active_asn"
    );
    const hasActiveSession = settingsColumns.some(
      (col) => col.name === "active_session"
    );
    const hasAuthToken = settingsColumns.some(
      (col) => col.name === "auth_token"
    );
    const hasAuthTokenExpires = settingsColumns.some(
      (col) => col.name === "auth_token_expires"
    );
    const hasUserCode = settingsColumns.some((col) => col.name === "user_code");
    const hasPassword = settingsColumns.some((col) => col.name === "password");

    if (!hasActiveAsn) {
      console.log("📝 Adding active_asn column to settings table...");
      try {
        await db.execAsync("ALTER TABLE settings ADD COLUMN active_asn TEXT");
        console.log("✅ Added active_asn column");
      } catch (error: any) {
        if (error?.message?.includes("duplicate column")) {
          console.log("ℹ️ active_asn column already exists");
        } else {
          throw error;
        }
      }
    }

    if (!hasActiveSession) {
      console.log("📝 Adding active_session column to settings table...");
      try {
        await db.execAsync("ALTER TABLE settings ADD COLUMN active_session TEXT");
        console.log("✅ Added active_session column");
      } catch (error: any) {
        if (error?.message?.includes("duplicate column")) {
          console.log("ℹ️ active_session column already exists");
        } else {
          throw error;
        }
      }
    }

    if (!hasAuthToken) {
      console.log("📝 Adding auth_token column to settings table...");
      try {
        await db.execAsync("ALTER TABLE settings ADD COLUMN auth_token TEXT");
        console.log("✅ Added auth_token column");
      } catch (error: any) {
        if (error?.message?.includes("duplicate column")) {
          console.log("ℹ️ auth_token column already exists");
        } else {
          throw error;
        }
      }
    }

    if (!hasAuthTokenExpires) {
      console.log("📝 Adding auth_token_expires column to settings table...");
      try {
        await db.execAsync(
          "ALTER TABLE settings ADD COLUMN auth_token_expires TEXT"
        );
        console.log("✅ Added auth_token_expires column");
      } catch (error: any) {
        if (error?.message?.includes("duplicate column")) {
          console.log("ℹ️ auth_token_expires column already exists");
        } else {
          throw error;
        }
      }
    }

    if (!hasUserCode) {
      console.log("📝 Adding user_code column to settings table...");
      try {
        await db.execAsync("ALTER TABLE settings ADD COLUMN user_code TEXT");
        console.log("✅ Added user_code column");
      } catch (error: any) {
        if (error?.message?.includes("duplicate column")) {
          console.log("ℹ️ user_code column already exists");
        } else {
          throw error;
        }
      }
    }

    if (!hasPassword) {
      console.log("📝 Adding password column to settings table...");
      try {
        await db.execAsync("ALTER TABLE settings ADD COLUMN password TEXT");
        console.log("✅ Added password column");
      } catch (error: any) {
        if (error?.message?.includes("duplicate column")) {
          console.log("ℹ️ password column already exists");
        } else {
          throw error;
        }
      }
    }

    const hasItemMasterSyncMode = settingsColumns.some(
      (col) => col.name === "item_master_sync_mode"
    );
    const hasItemMasterPageSize = settingsColumns.some(
      (col) => col.name === "item_master_page_size"
    );
    const hasItemMasterWatermark = settingsColumns.some(
      (col) => col.name === "item_master_modified_watermark"
    );

    if (!hasItemMasterSyncMode) {
      console.log("📝 Adding item_master_sync_mode column to settings...");
      try {
        await db.execAsync(
          "ALTER TABLE settings ADD COLUMN item_master_sync_mode TEXT DEFAULT 'full'"
        );
        console.log("✅ Added item_master_sync_mode column");
      } catch (error: any) {
        if (error?.message?.includes("duplicate column")) {
          console.log("ℹ️ item_master_sync_mode column already exists");
        } else {
          throw error;
        }
      }
    }

    if (!hasItemMasterPageSize) {
      console.log("📝 Adding item_master_page_size column to settings...");
      try {
        await db.execAsync(
          "ALTER TABLE settings ADD COLUMN item_master_page_size INTEGER DEFAULT 5000"
        );
        console.log("✅ Added item_master_page_size column");
      } catch (error: any) {
        if (error?.message?.includes("duplicate column")) {
          console.log("ℹ️ item_master_page_size column already exists");
        } else {
          throw error;
        }
      }
    }

    if (!hasItemMasterWatermark) {
      console.log("📝 Adding item_master_modified_watermark column to settings...");
      try {
        await db.execAsync(
          "ALTER TABLE settings ADD COLUMN item_master_modified_watermark TEXT"
        );
        console.log("✅ Added item_master_modified_watermark column");
      } catch (error: any) {
        if (error?.message?.includes("duplicate column")) {
          console.log("ℹ️ item_master_modified_watermark column already exists");
        } else {
          throw error;
        }
      }
    }

    // Check if event_queue table exists and has material_request column
    const eventQueueColumns = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(event_queue)"
    );

    if (eventQueueColumns.length > 0) {
      const hasMaterialRequest = eventQueueColumns.some(
        (col) => col.name === "material_request"
      );
      const hasTransferIn = eventQueueColumns.some(
        (col) => col.name === "transfer_in"
      );
      const hasCycleCountTitle = eventQueueColumns.some(
        (col) => col.name === "cycle_count_title"
      );

      if (!hasMaterialRequest) {
        console.log("📝 Adding material_request column to event_queue table...");
        try {
          await db.execAsync("ALTER TABLE event_queue ADD COLUMN material_request TEXT");
          console.log("✅ Added material_request column");
        } catch (error: any) {
          if (error?.message?.includes("duplicate column")) {
            console.log("ℹ️ material_request column already exists");
          } else {
            throw error;
          }
        }
      }

      if (!hasTransferIn) {
        console.log("📝 Adding transfer_in column to event_queue table...");
        try {
          await db.execAsync("ALTER TABLE event_queue ADD COLUMN transfer_in TEXT");
          console.log("✅ Added transfer_in column");
        } catch (error: any) {
          if (error?.message?.includes("duplicate column")) {
            console.log("ℹ️ transfer_in column already exists");
          } else {
            throw error;
          }
        }
      }

      if (!hasCycleCountTitle) {
        console.log("📝 Adding cycle_count_title column to event_queue table...");
        try {
          await db.execAsync("ALTER TABLE event_queue ADD COLUMN cycle_count_title TEXT");
          console.log("✅ Added cycle_count_title column");
        } catch (error: any) {
          if (error?.message?.includes("duplicate column")) {
            console.log("ℹ️ cycle_count_title column already exists");
          } else {
            throw error;
          }
        }
      }

      // Check if event_queue table has source_bin column
      const hasSourceBin = eventQueueColumns.some(
        (col) => col.name === "source_bin"
      );
      if (!hasSourceBin) {
        console.log("📝 Adding source_bin column to event_queue table...");
        try {
          await db.execAsync("ALTER TABLE event_queue ADD COLUMN source_bin TEXT");
          console.log("✅ Added source_bin column");
        } catch (error: any) {
          if (error?.message?.includes("duplicate column")) {
            console.log("ℹ️ source_bin column already exists");
          } else {
            throw error;
          }
        }
      }

      // Check if event_queue table has location_id column
      const hasLocationId = eventQueueColumns.some(
        (col) => col.name === "location_id"
      );
      if (!hasLocationId) {
        console.log("📝 Adding location_id column to event_queue table...");
        try {
          await db.execAsync("ALTER TABLE event_queue ADD COLUMN location_id TEXT");
          console.log("✅ Added location_id column");
        } catch (error: any) {
          if (error?.message?.includes("duplicate column")) {
            console.log("ℹ️ location_id column already exists");
          } else {
            throw error;
          }
        }
      }
    }

    // Check if cycle_count_lines table exists and has carton_id column
    try {
      const cycleCountLinesColumns = await db.getAllAsync<{ name: string }>(
        "PRAGMA table_info(cycle_count_lines)"
      );
      if (cycleCountLinesColumns.length > 0) {
        const hasCartonId = cycleCountLinesColumns.some(
          (col) => col.name === "carton_id"
        );
        if (!hasCartonId) {
          console.log("📝 Adding carton_id column to cycle_count_lines table...");
          try {
            await db.execAsync("ALTER TABLE cycle_count_lines ADD COLUMN carton_id TEXT");
            console.log("✅ Added carton_id column to cycle_count_lines");
          } catch (error: any) {
            if (error?.message?.includes("duplicate column")) {
              console.log("ℹ️ carton_id column already exists in cycle_count_lines");
            } else {
              throw error;
            }
          }
        }
      }
    } catch (error: any) {
      if (!error?.message?.includes("no such table")) {
        console.error(
          "❌ Error checking/adding carton_id column to cycle_count_lines:",
          error
        );
      }
    }

    // cycle_count_sessions: count_mode + erp_batch for ERP push/sync
    try {
      const sessionColumns = await db.getAllAsync<{ name: string }>(
        "PRAGMA table_info(cycle_count_sessions)"
      );
      if (sessionColumns.length > 0) {
        if (!sessionColumns.some((col) => col.name === "count_mode")) {
          console.log("📝 Adding count_mode column to cycle_count_sessions...");
          await db.execAsync(
            "ALTER TABLE cycle_count_sessions ADD COLUMN count_mode TEXT"
          );
        }
        if (!sessionColumns.some((col) => col.name === "erp_batch")) {
          console.log("📝 Adding erp_batch column to cycle_count_sessions...");
          await db.execAsync(
            "ALTER TABLE cycle_count_sessions ADD COLUMN erp_batch TEXT"
          );
        }
        if (!sessionColumns.some((col) => col.name === "erp_locked_carton_id")) {
          console.log(
            "📝 Adding erp_locked_carton_id column to cycle_count_sessions..."
          );
          await db.execAsync(
            "ALTER TABLE cycle_count_sessions ADD COLUMN erp_locked_carton_id TEXT"
          );
        }
      }
    } catch (error: any) {
      if (!error?.message?.includes("no such table")) {
        console.error(
          "❌ Error checking/adding cycle count session columns:",
          error
        );
      }
    }

    // stock_ledger_carton_cache table
    try {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS stock_ledger_carton_cache (
          item_code TEXT NOT NULL,
          warehouse TEXT NOT NULL,
          bin_location TEXT NOT NULL,
          carton_id TEXT NOT NULL DEFAULT '',
          qty REAL DEFAULT 0,
          reserved_qty REAL DEFAULT 0,
          updated_on TEXT,
          PRIMARY KEY (item_code, warehouse, bin_location, carton_id)
        );
      `);
    } catch (error: any) {
      console.error("❌ Error creating stock_ledger_carton_cache:", error);
    }

    if (
      hasActiveAsn &&
      hasActiveSession &&
      hasAuthToken &&
      hasAuthTokenExpires &&
      hasUserCode &&
      hasPassword
    ) {
      console.log("✅ Settings table already has all required columns.");
    }

    // Check if scanned_items table exists, create if not
    try {
      const scannedItemsColumns = await db.getAllAsync<{ name: string }>(
        "PRAGMA table_info(scanned_items)"
      );
      if (scannedItemsColumns.length === 0) {
        console.log("📝 Creating scanned_items table...");
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS scanned_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asn_no TEXT,
            inbound_session TEXT,
            carton_id TEXT,
            item_code TEXT,
            box_id TEXT,
            store TEXT,
            scanned_qty INTEGER DEFAULT 1,
            scanned_on TEXT,
            device_id TEXT,
            user_id TEXT,
            UNIQUE(asn_no, inbound_session, carton_id, item_code, box_id)
          );
        `);
        console.log("✅ Created scanned_items table");
      } else {
        console.log("✅ scanned_items table already exists.");
      }
    } catch (error: any) {
      if (!error?.message?.includes("no such table")) {
        console.error("❌ Error checking/creating scanned_items table:", error);
      }
    }

    // Check if box_cache table has purpose column
    try {
      const boxCacheColumns = await db.getAllAsync<{ name: string }>(
        "PRAGMA table_info(box_cache)"
      );
      if (boxCacheColumns.length > 0) {
        const hasPurpose = boxCacheColumns.some(
          (col) => col.name === "purpose"
        );
        if (!hasPurpose) {
          console.log("📝 Adding purpose column to box_cache table...");
          await db.execAsync(
            "ALTER TABLE box_cache ADD COLUMN purpose TEXT DEFAULT 'STORE'"
          );
          console.log("✅ Added purpose column to box_cache");
        }
        const hasCreatedBy = boxCacheColumns.some(
          (col) => col.name === "created_by"
        );
        if (!hasCreatedBy) {
          console.log("📝 Adding created_by column to box_cache table...");
          await db.execAsync(
            "ALTER TABLE box_cache ADD COLUMN created_by TEXT"
          );
          console.log("✅ Added created_by column to box_cache");
        }
      }
    } catch (error: any) {
      if (
        !error?.message?.includes("no such table") &&
        !error?.message?.includes("duplicate column")
      ) {
        console.error(
          "❌ Error checking/adding purpose/created_by column to box_cache:",
          error
        );
      }
    }

    // carton_status_cache: who recorded dock unload (for Unload UI + sync)
    try {
      const cartonStatusCols = await db.getAllAsync<{ name: string }>(
        "PRAGMA table_info(carton_status_cache)"
      );
      if (cartonStatusCols.length > 0) {
        const hasUnloadedBy = cartonStatusCols.some(
          (col) => col.name === "unloaded_by"
        );
        if (!hasUnloadedBy) {
          console.log(
            "📝 Adding unloaded_by column to carton_status_cache table..."
          );
          await db.execAsync(
            "ALTER TABLE carton_status_cache ADD COLUMN unloaded_by TEXT"
          );
          console.log("✅ Added unloaded_by column to carton_status_cache");
        }
      }
    } catch (error: any) {
      if (
        !error?.message?.includes("no such table") &&
        !error?.message?.includes("duplicate column")
      ) {
        console.error(
          "❌ Error checking/adding unloaded_by to carton_status_cache:",
          error
        );
      }
    }

    // Check if inbound_sessions table has transfer_in column
    try {
      const inboundSessionsColumns = await db.getAllAsync<{ name: string }>(
        "PRAGMA table_info(inbound_sessions)"
      );
      if (inboundSessionsColumns.length > 0) {
        const hasTransferIn = inboundSessionsColumns.some(
          (col) => col.name === "transfer_in"
        );
        if (!hasTransferIn) {
          console.log("📝 Adding transfer_in column to inbound_sessions table...");
          try {
            await db.execAsync(
              "ALTER TABLE inbound_sessions ADD COLUMN transfer_in TEXT"
            );
            console.log("✅ Added transfer_in column to inbound_sessions");
          } catch (error: any) {
            if (error?.message?.includes("duplicate column")) {
              console.log("ℹ️ transfer_in column already exists");
            } else {
              throw error;
            }
          }
        }
      }
    } catch (error: any) {
      if (!error?.message?.includes("no such table")) {
        console.error(
          "❌ Error checking/adding transfer_in column to inbound_sessions:",
          error
        );
      }
    }

    // Check if item_master table exists, create if not
    try {
      const itemMasterColumns = await db.getAllAsync<{ name: string }>(
        "PRAGMA table_info(item_master)"
      );
      if (itemMasterColumns.length === 0) {
        console.log("📝 Creating item_master table...");
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS item_master (
            item_code TEXT PRIMARY KEY,
            barcode TEXT UNIQUE NOT NULL,
            item_name TEXT,
            updated_on TEXT
          );
        `);
        console.log("✅ Created item_master table");
      } else {
        console.log("✅ item_master table already exists.");
      }
    } catch (error: any) {
      if (!error?.message?.includes("no such table")) {
        console.error("❌ Error checking/creating item_master table:", error);
      }
    }

    // Check if users table exists, create if not
    try {
      const usersColumns = await db.getAllAsync<{ name: string }>(
        "PRAGMA table_info(users)"
      );
      if (usersColumns.length === 0) {
        console.log("📝 Creating users table...");
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS users (
            user_code TEXT PRIMARY KEY,
            user_name TEXT,
            password TEXT,
            device_id TEXT,
            is_active INTEGER DEFAULT 1,
            updated_on TEXT
          );
        `);
        console.log("✅ Created users table");
      } else {
        console.log("✅ users table already exists.");
      }
    } catch (error: any) {
      if (!error?.message?.includes("no such table")) {
        console.error("❌ Error checking/creating users table:", error);
      }
    }

    // Check if warehouse_cache table exists, create if not
    try {
      const warehouseCacheColumns = await db.getAllAsync<{ name: string }>(
        "PRAGMA table_info(warehouse_cache)"
      );
      if (warehouseCacheColumns.length === 0) {
        console.log("📝 Creating warehouse_cache table...");
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS warehouse_cache (
            warehouse_id TEXT PRIMARY KEY,
            warehouse_name TEXT,
            location TEXT,
            is_active INTEGER DEFAULT 1,
            updated_on TEXT
          );
        `);
        console.log("✅ Created warehouse_cache table");
      } else {
        console.log("✅ warehouse_cache table already exists.");
      }
    } catch (error: any) {
      if (!error?.message?.includes("no such table")) {
        console.error(
          "❌ Error checking/creating warehouse_cache table:",
          error
        );
      }
    }

    // Check if location_cache table exists, create if not
    try {
      const locationCacheColumns = await db.getAllAsync<{ name: string }>(
        "PRAGMA table_info(location_cache)"
      );
      if (locationCacheColumns.length === 0) {
        console.log("📝 Creating location_cache table...");
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS location_cache (
            location_id TEXT PRIMARY KEY,
            warehouse TEXT,
            zone TEXT,
            aisle TEXT,
            parent_rack TEXT,
            level TEXT,
            bin_id TEXT,
            location_type TEXT,
            location_type_detailed TEXT,
            is_available INTEGER DEFAULT 1,
            capacity_volume_weight REAL,
            updated_on TEXT
          );
        `);
        console.log("✅ Created location_cache table");
      } else {
        console.log("✅ location_cache table already exists.");
      }
    } catch (error: any) {
      if (!error?.message?.includes("no such table")) {
        console.error(
          "❌ Error checking/creating location_cache table:",
          error
        );
      }
    }

    // Check if inbound_sessions table exists, create if not
    try {
      // Use sqlite_master to check if table exists (safer than PRAGMA)
      const tableCheck = await db.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='inbound_sessions'"
      );
      if (tableCheck.length === 0) {
        console.log("📝 Creating inbound_sessions table...");
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS inbound_sessions (
            inbound_session TEXT PRIMARY KEY,
            asn_no TEXT,
            transfer_order TEXT,
            dock TEXT,
            status TEXT DEFAULT 'Active',
            completed_cartons INTEGER DEFAULT 0,
            total_cartons INTEGER DEFAULT 0,
            started_by TEXT,
            started_on TEXT,
            completed_on TEXT,
            synced INTEGER DEFAULT 0,
            updated_on TEXT
          );
        `);
        console.log("✅ Created inbound_sessions table");
      } else {
        console.log("✅ inbound_sessions table already exists.");
      }
    } catch (error: any) {
      console.error(
        "❌ Error checking/creating inbound_sessions table:",
        error
      );
      // Try to create the table anyway
      try {
        console.log(
          "📝 Attempting to create inbound_sessions table despite error..."
        );
        await db.execAsync(`
          CREATE TABLE IF NOT EXISTS inbound_sessions (
            inbound_session TEXT PRIMARY KEY,
            asn_no TEXT,
            transfer_order TEXT,
            dock TEXT,
            status TEXT DEFAULT 'Active',
            completed_cartons INTEGER DEFAULT 0,
            total_cartons INTEGER DEFAULT 0,
            started_by TEXT,
            started_on TEXT,
            completed_on TEXT,
            synced INTEGER DEFAULT 0,
            updated_on TEXT
          );
        `);
        console.log("✅ Created inbound_sessions table (fallback)");
      } catch (createError: any) {
        console.error(
          "❌ Failed to create inbound_sessions table:",
          createError
        );
      }
    }

    // Check if asn_cache table has new columns, add if missing
    try {
      const asnCacheColumns = await db.getAllAsync<{ name: string }>(
        "PRAGMA table_info(asn_cache)"
      );
      if (asnCacheColumns.length > 0) {
        const columnNames = asnCacheColumns.map((col) => col.name);
        const newColumns = [
          { name: "asn_no_original", type: "TEXT" },
          { name: "status", type: "TEXT" },
          { name: "purchase_order", type: "TEXT" },
          { name: "supplier", type: "TEXT" },
          { name: "shipment_date", type: "TEXT" },
          { name: "expected_arrival_date", type: "TEXT" },
          { name: "total_shipped_qty", type: "REAL" },
          { name: "total_carton_count", type: "INTEGER" },
          { name: "airway_bill_no", type: "TEXT" },
          { name: "shipment_type", type: "TEXT" },
        ];

        for (const newCol of newColumns) {
          if (!columnNames.includes(newCol.name)) {
            console.log(
              `📝 Adding ${newCol.name} column to asn_cache table...`
            );
            await db.execAsync(
              `ALTER TABLE asn_cache ADD COLUMN ${newCol.name} ${newCol.type}`
            );
            console.log(`✅ Added ${newCol.name} column to asn_cache`);
            // Update columnNames array to reflect the new column
            columnNames.push(newCol.name);
          }
        }

        // If asn_no_original column exists (was already there or just added), try to populate it for existing records
        // Extract original format from payload_json if available
        if (columnNames.includes("asn_no_original")) {
          try {
            const existingASNs = await db.getAllAsync<{
              asn_no: string;
              asn_no_original: string | null;
              payload_json: string | null;
            }>(
              "SELECT asn_no, asn_no_original, payload_json FROM asn_cache WHERE asn_no_original IS NULL"
            );

            if (existingASNs.length > 0) {
              console.log(
                `📝 Found ${existingASNs.length} ASNs without asn_no_original, attempting to populate...`
              );

              for (const existingASN of existingASNs) {
                let originalFormat: string | null = null;

                // Try to extract from payload_json
                if (existingASN.payload_json) {
                  try {
                    const payload = JSON.parse(existingASN.payload_json);
                    // Check if payload has the original ASN format
                    if (
                      payload.asn_no &&
                      payload.asn_no !== existingASN.asn_no
                    ) {
                      originalFormat = payload.asn_no;
                    } else if (
                      payload.title &&
                      payload.title !== existingASN.asn_no
                    ) {
                      originalFormat = payload.title;
                    }
                  } catch (e) {
                    // Ignore parse errors
                  }
                }

                // If we couldn't extract from payload, try to reverse-normalize
                // This is a best-effort attempt - we can't know the exact original format
                // But we can try common formats
                if (!originalFormat) {
                  // Try to extract number and create a shorter format
                  const match = existingASN.asn_no.match(/ASN-0*(\d+)/i);
                  if (match) {
                    const numberPart = match[1];
                    // Try ASN-XXX format (no leading zeros)
                    const num = parseInt(numberPart, 10);
                    originalFormat = `ASN-${num}`;
                  }
                }

                if (originalFormat && originalFormat !== existingASN.asn_no) {
                  await db.runAsync(
                    "UPDATE asn_cache SET asn_no_original = ? WHERE asn_no = ?",
                    [originalFormat, existingASN.asn_no]
                  );
                  console.log(
                    `✅ Updated ASN ${existingASN.asn_no} with original format: ${originalFormat}`
                  );
                }
              }
            }
          } catch (updateError: any) {
            console.warn(
              "⚠️ Failed to update existing ASN records with asn_no_original:",
              updateError
            );
            // Don't throw - this is a best-effort update
          }
        }
      }
    } catch (error: any) {
      if (!error?.message?.includes("no such table")) {
        console.error("❌ Error checking/adding columns to asn_cache:", error);
      }
    }
  } catch (error: any) {
    // If table doesn't exist yet, that's fine - it will be created by CREATE_SETTINGS_TABLE
    if (error?.message?.includes("no such table")) {
      console.log(
        "📝 Settings table does not exist yet, will be created by migration."
      );
    } else {
      console.error("❌ Error running schema migrations:", error);
      throw error;
    }
  }
}

let db: SQLite.SQLiteDatabase | null = null;
let isInitializing = false;
let initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// Track if database is fully initialized (including PRAGMA settings)
let isFullyInitialized = false;

// Export function to check if database is ready
export const isDatabaseReady = (): boolean => {
  return db !== null && !isInitializing && isFullyInitialized;
};

export const getDatabase = async (): Promise<SQLite.SQLiteDatabase> => {
  // If database is already open and initialized, return it immediately
  if (db && !isInitializing && isFullyInitialized) {
    return db;
  }

  // If initialization is in progress, wait for it to complete
  if (isInitializing && initPromise) {
    try {
      const result = await initPromise;
      isFullyInitialized = true;
      return result;
    } catch (error) {
      // If initialization failed, reset and try again
      console.warn("⚠️ Database initialization failed, retrying...");
      isInitializing = false;
      isFullyInitialized = false;
      db = null;
      initPromise = null;
    }
  }

  // Start initialization
  isInitializing = true;
  initPromise = (async () => {
    try {
      console.log("📦 Opening database...");
      db = await SQLite.openDatabaseAsync("wms.db");

      if (!db) {
        throw new Error("Failed to open database");
      }

      // Configure database for better concurrency (run once after opening)
      console.log("📦 Configuring database (WAL mode, busy timeout)...");
      try {
        // Enable Write-Ahead Logging (WAL) mode for better concurrency
        // WAL allows multiple readers and one writer simultaneously
        // Note: WAL mode must be set before any transactions
        const walResult = await db.getFirstAsync<{ journal_mode: string }>(
          "PRAGMA journal_mode = WAL"
        );
        const journalMode = walResult?.journal_mode || "unknown";
        console.log(`✅ Journal mode set to: ${journalMode}`);
        
        if (journalMode !== "wal") {
          console.warn(`⚠️ WAL mode not enabled, got: ${journalMode}. This may cause locking issues.`);
        }
        
        // Set busy timeout to 5 seconds (waits up to 5s if database is locked)
        await db.execAsync("PRAGMA busy_timeout = 5000");
        const timeoutResult = await db.getFirstAsync<{ busy_timeout: number }>(
          "PRAGMA busy_timeout"
        );
        console.log(`✅ Busy timeout set to: ${timeoutResult?.busy_timeout || 0}ms`);
      } catch (pragmaError: any) {
        console.warn("⚠️ Failed to set PRAGMA settings:", pragmaError.message);
        // Continue even if PRAGMA fails (some SQLite versions may not support all PRAGMAs)
      }

      console.log("📦 Running migrations...");
      // Run migrations - these are write operations, but they happen during initialization
      // which is serialized by the initPromise mechanism
      for (const migration of ALL_MIGRATIONS) {
        try {
          await db.execAsync(migration);
        } catch (migrationError: any) {
          // Some migrations might fail if tables/columns already exist
          // Log but continue (schema migrations will handle column additions)
          if (!migrationError.message?.includes("already exists") && 
              !migrationError.message?.includes("duplicate column")) {
            console.warn("⚠️ Migration warning:", migrationError.message);
          }
        }
      }

      // Run schema migrations (add columns to existing tables)
      await runSchemaMigrations(db);

      console.log("✅ Database initialized successfully");
      isInitializing = false;
      isFullyInitialized = true;
      return db;
    } catch (error) {
      console.error("❌ Database initialization failed:", error);
      isInitializing = false;
      isFullyInitialized = false;
      db = null;
      initPromise = null;
      throw error;
    }
  })();

  const result = await initPromise;
  isFullyInitialized = true;
  return result;
};

export const closeDatabase = async () => {
  if (db) {
    await db.closeAsync();
    db = null;
  }
};
