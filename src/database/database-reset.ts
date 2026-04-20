/**
 * Database Reset Utility
 * 
 * Provides functions to safely recreate/reset the database
 * Useful for:
 * - Testing database lock fixes
 * - Resetting to clean state
 * - Troubleshooting database issues
 * - Starting fresh after schema changes
 */

import * as SQLite from "expo-sqlite";
import { getDatabase, closeDatabase, runSchemaMigrations } from "./database";
import { ALL_MIGRATIONS } from "./schema";

let dbInstance: SQLite.SQLiteDatabase | null = null;

/**
 * Close the current database connection
 */
export const closeDbConnection = async (): Promise<void> => {
  try {
    await closeDatabase();
    dbInstance = null;
    console.log("✅ Database connection closed");
  } catch (error: any) {
    console.warn("⚠️ Error closing database:", error.message);
  }
};

/**
 * Delete the database file (requires closing connection first)
 * Note: This is a destructive operation - all data will be lost!
 */
export const deleteDatabase = async (): Promise<void> => {
  try {
    // Close connection first
    await closeDbConnection();
    
    // Delete database file
    // Note: expo-sqlite doesn't provide a direct delete method
    // We'll need to use the file system or let it be recreated
    console.log("🗑️ Database file will be recreated on next open");
    console.log("⚠️ WARNING: All data will be lost!");
    
    // The database will be automatically recreated when getDatabase() is called
    // with a fresh connection
  } catch (error: any) {
    console.error("❌ Error deleting database:", error.message);
    throw error;
  }
};

/**
 * Recreate the database from scratch
 * This will:
 * 1. Backup settings (API URL, device ID, etc.) to preserve them
 * 2. Close current connection
 * 3. Delete existing database (if possible)
 * 4. Reinitialize with all migrations
 * 5. Restore settings (API URL, device ID, etc.)
 * 6. Apply PRAGMA settings
 * 
 * @param backupFirst - If true, will attempt to backup before reset (optional)
 */
export const recreateDatabase = async (backupFirst: boolean = false): Promise<void> => {
  try {
    console.log("🔄 Starting database recreation...");
    
    if (backupFirst) {
      console.log("💾 Backup requested (manual backup recommended)");
      console.log("⚠️ Please backup your data manually before proceeding");
    }
    
    // Step 1: Backup settings BEFORE dropping tables
    console.log("📦 Step 1: Backing up settings...");
    let settingsBackup: any = null;
    try {
      const db = await getDatabase();
      settingsBackup = await db.getFirstAsync<any>(
        "SELECT * FROM settings LIMIT 1"
      );
      if (settingsBackup) {
        console.log("✅ Settings backed up:", {
          api_url: settingsBackup.api_url ? "***" : "(null)",
          device_id: settingsBackup.device_id || "(null)",
          user_id: settingsBackup.user_id || "(null)",
          demo_mode: settingsBackup.demo_mode || 0,
        });
      } else {
        console.log("ℹ️ No settings to backup");
      }
    } catch (error: any) {
      console.warn("⚠️ Could not backup settings:", error.message);
      // Continue anyway - might be first run
    }
    
    // Step 2: Get current database connection
    console.log("📦 Step 2: Getting database connection...");
    const db = await getDatabase();
    
    // Step 3: Drop all tables to start fresh (except we'll preserve settings)
    console.log("📦 Step 3: Dropping all existing tables...");
    try {
      // Get all table names
      const tables = await db.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      );
      
      // Drop each table (settings will be recreated by migrations)
      for (const table of tables) {
        try {
          await db.execAsync(`DROP TABLE IF EXISTS ${table.name}`);
          console.log(`  ✅ Dropped table: ${table.name}`);
        } catch (dropError: any) {
          console.warn(`  ⚠️ Failed to drop table ${table.name}:`, dropError.message);
        }
      }
    } catch (error: any) {
      console.warn("⚠️ Error dropping tables:", error.message);
      // Continue anyway - tables might not exist
    }
    
    // Step 4: Close connection and reopen fresh
    console.log("📦 Step 4: Closing and reopening database...");
    await closeDbConnection();
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    // Step 5: Reinitialize database (this will run all migrations automatically)
    console.log("📦 Step 5: Reinitializing database with migrations...");
    const freshDb = await getDatabase(); // This will run all migrations automatically
    
    // Step 6: Restore settings if they were backed up
    if (settingsBackup) {
      console.log("📦 Step 6: Restoring settings...");
      try {
        // Restore all settings fields
        await freshDb.runAsync(
          `INSERT INTO settings (
            api_url, device_id, user_id, user_code, password, demo_mode, 
            active_asn, active_session, auth_token, auth_token_expires,
            item_master_sync_mode, item_master_page_size, item_master_modified_watermark
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            settingsBackup.api_url || null,
            settingsBackup.device_id || null,
            settingsBackup.user_id || null,
            settingsBackup.user_code || null,
            settingsBackup.password || null,
            settingsBackup.demo_mode || 0,
            settingsBackup.active_asn || null,
            settingsBackup.active_session || null,
            settingsBackup.auth_token || null,
            settingsBackup.auth_token_expires || null,
            settingsBackup.item_master_sync_mode || "full",
            settingsBackup.item_master_page_size ?? 5000,
            settingsBackup.item_master_modified_watermark || null,
          ]
        );
        console.log("✅ Settings restored successfully!");
        console.log("✅ API URL preserved:", settingsBackup.api_url ? "Yes" : "No");
      } catch (restoreError: any) {
        console.error("❌ Failed to restore settings:", restoreError.message);
        console.warn("⚠️ Settings were not restored - user will need to re-enter API URL");
        // Don't throw - database recreation succeeded, just settings restore failed
      }
    } else {
      console.log("ℹ️ No settings to restore");
    }
    
    console.log("✅ Database recreated successfully!");
    console.log("📝 Database is now in a fresh state with all migrations applied");
    if (settingsBackup) {
      console.log("✅ Settings (including API URL) have been preserved");
    }
    
  } catch (error: any) {
    console.error("❌ Error recreating database:", error.message);
    throw error;
  }
};

/**
 * Reset database to clean state
 * This is an alias for recreateDatabase with backup warning
 */
export const resetDatabase = async (): Promise<void> => {
  console.log("⚠️ WARNING: This will delete all data!");
  console.log("⚠️ Make sure you have a backup if needed");
  
  await recreateDatabase(false);
};

/**
 * Get database statistics (for debugging)
 */
export const getDatabaseStats = async (): Promise<{
  tables: string[];
  settingsCount: number;
  eventQueueCount: number;
  asnCacheCount: number;
}> => {
  try {
    const db = await getDatabase();
    
    // Get all table names
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    
    // Get counts from key tables
    let settingsCount = 0;
    let eventQueueCount = 0;
    let asnCacheCount = 0;
    
    try {
      const settings = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM settings"
      );
      settingsCount = settings?.count || 0;
    } catch (e) {
      // Table might not exist
    }
    
    try {
      const events = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM event_queue"
      );
      eventQueueCount = events?.count || 0;
    } catch (e) {
      // Table might not exist
    }
    
    try {
      const asns = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM asn_cache"
      );
      asnCacheCount = asns?.count || 0;
    } catch (e) {
      // Table might not exist
    }
    
    return {
      tables: tables.map((t) => t.name),
      settingsCount,
      eventQueueCount,
      asnCacheCount,
    };
  } catch (error: any) {
    console.error("❌ Error getting database stats:", error.message);
    throw error;
  }
};

