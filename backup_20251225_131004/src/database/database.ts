import * as SQLite from "expo-sqlite";
import { ALL_MIGRATIONS } from "./schema";

/**
 * Run schema migrations to add new columns to existing tables
 * SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we check first
 */
async function runSchemaMigrations(db: SQLite.SQLiteDatabase) {
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
      await db.execAsync("ALTER TABLE settings ADD COLUMN active_asn TEXT");
      console.log("✅ Added active_asn column");
    }

    if (!hasActiveSession) {
      console.log("📝 Adding active_session column to settings table...");
      await db.execAsync("ALTER TABLE settings ADD COLUMN active_session TEXT");
      console.log("✅ Added active_session column");
    }

    if (!hasAuthToken) {
      console.log("📝 Adding auth_token column to settings table...");
      await db.execAsync("ALTER TABLE settings ADD COLUMN auth_token TEXT");
      console.log("✅ Added auth_token column");
    }

    if (!hasAuthTokenExpires) {
      console.log("📝 Adding auth_token_expires column to settings table...");
      await db.execAsync(
        "ALTER TABLE settings ADD COLUMN auth_token_expires TEXT"
      );
      console.log("✅ Added auth_token_expires column");
    }

    if (!hasUserCode) {
      console.log("📝 Adding user_code column to settings table...");
      await db.execAsync("ALTER TABLE settings ADD COLUMN user_code TEXT");
      console.log("✅ Added user_code column");
    }

    if (!hasPassword) {
      console.log("📝 Adding password column to settings table...");
      await db.execAsync("ALTER TABLE settings ADD COLUMN password TEXT");
      console.log("✅ Added password column");
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
      }
    } catch (error: any) {
      if (!error?.message?.includes("no such table")) {
        console.error(
          "❌ Error checking/adding purpose column to box_cache:",
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

export const getDatabase = async (): Promise<SQLite.SQLiteDatabase> => {
  // If database is already open, return it
  if (db) {
    return db;
  }

  // If initialization is in progress, wait for it
  if (isInitializing && initPromise) {
    return await initPromise;
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

      console.log("📦 Running migrations...");
      // Run migrations
      for (const migration of ALL_MIGRATIONS) {
        await db.execAsync(migration);
      }

      // Run schema migrations (add columns to existing tables)
      await runSchemaMigrations(db);

      console.log("✅ Database initialized successfully");
      isInitializing = false;
      return db;
    } catch (error) {
      console.error("❌ Database initialization failed:", error);
      isInitializing = false;
      db = null;
      initPromise = null;
      throw error;
    }
  })();

  return await initPromise;
};

export const closeDatabase = async () => {
  if (db) {
    await db.closeAsync();
    db = null;
  }
};
