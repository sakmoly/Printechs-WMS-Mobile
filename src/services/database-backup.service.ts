import type { SQLiteDatabase } from "expo-sqlite";
import * as DocumentPicker from "expo-document-picker";
import { Directory } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  cacheDirectory,
  documentDirectory,
  writeAsStringAsync,
  readAsStringAsync,
} from "expo-file-system/legacy";
import { Platform } from "react-native";
import { getDatabase } from "../database/database";
import { getAppVersionDetails } from "../utils/appVersion";

function writableAppDirectory(): string {
  const dir = documentDirectory ?? cacheDirectory;
  if (!dir) {
    throw new Error(
      "No app document or cache folder (file system unavailable on this platform)."
    );
  }
  return dir;
}

export const BACKUP_FORMAT = "printechs-wms-sqlite-backup" as const;
export const BACKUP_FORMAT_VERSION = 1;

/** Insert order respects foreign keys when constraints are enabled after restore. */
export const BACKUP_TABLE_INSERT_ORDER: readonly string[] = [
  "settings",
  "asn_cache",
  "asn_carton_map",
  "transfer_order_cache",
  "box_cache",
  "tc_cache",
  "carton_status_cache",
  "event_queue",
  "workflow_state_cache",
  "scanned_items",
  "putaway_items_cache",
  "warehouse_rack_cache",
  "item_master",
  "users",
  "warehouse_cache",
  "warehouse_store_cache",
  "location_cache",
  "inbound_sessions",
  "transfer_in_cache",
  "material_request_cache",
  "cycle_count_cache",
  "cycle_count_sessions",
  "cycle_count_lines",
  "bin_master_cache",
  "item_barcode_map",
  "stock_ledger_cache",
  "stock_transaction_cache",
  "material_request_picking_sessions",
  "transfer_in_receiving_sessions",
  "relocation_sessions",
] as const;

export type BackupTablePayload = {
  columns: string[];
  rows: (string | number | null)[][];
};

export type SqliteBackupPayload = {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  createdAt: string;
  appVersion?: string;
  tables: Record<string, BackupTablePayload>;
};

function assertSafeTableName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid table name: ${name}`);
  }
}

function sortTablesForInsert(tableNames: string[]): string[] {
  const set = new Set(tableNames);
  const ordered: string[] = [];
  for (const t of BACKUP_TABLE_INSERT_ORDER) {
    if (set.has(t)) ordered.push(t);
  }
  const rest = tableNames
    .filter((t) => !BACKUP_TABLE_INSERT_ORDER.includes(t))
    .sort();
  return [...ordered, ...rest];
}

function normalizeExportValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return Number(value);
  return String(value);
}

export async function listUserTables(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  );
  return rows.map((r) => r.name);
}

async function getTableColumnNamesInOrder(
  db: SQLiteDatabase,
  table: string
): Promise<string[]> {
  assertSafeTableName(table);
  const rows = await db.getAllAsync<{ name: string; cid: number }>(
    `PRAGMA table_info("${table}")`
  );
  return [...rows]
    .sort((a, b) => a.cid - b.cid)
    .map((r) => r.name);
}

export async function exportDatabasePayload(): Promise<SqliteBackupPayload> {
  const db = await getDatabase();
  const names = await listUserTables(db);
  const tables: SqliteBackupPayload["tables"] = {};

  for (const name of names) {
    const columns = await getTableColumnNamesInOrder(db, name);
    assertSafeTableName(name);
    const rowsObj = await db.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM "${name}"`
    );
    tables[name] = {
      columns,
      rows: rowsObj.map((r) =>
        columns.map((c) => normalizeExportValue(r[c]))
      ),
    };
  }

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: getAppVersionDetails(),
    tables,
  };
}

export function parseBackupPayload(jsonText: string): SqliteBackupPayload {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new Error("Invalid JSON file.");
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("Backup file is not a valid object.");
  }
  const o = raw as Record<string, unknown>;
  if (o.format !== BACKUP_FORMAT) {
    throw new Error(
      "This file is not a Printechs WMS database backup (wrong format)."
    );
  }
  if (typeof o.formatVersion !== "number" || o.formatVersion < 1) {
    throw new Error("Unsupported backup format version.");
  }
  if (!o.tables || typeof o.tables !== "object") {
    throw new Error("Backup is missing table data.");
  }
  return o as unknown as SqliteBackupPayload;
}

/**
 * Clears all user tables and inserts rows from the backup (full replace).
 */
export async function importDatabasePayload(
  payload: SqliteBackupPayload
): Promise<void> {
  const db = await getDatabase();
  const existingTables = new Set(await listUserTables(db));

  await db.execAsync("PRAGMA foreign_keys = OFF");

  await db.withTransactionAsync(async () => {
    for (const name of await listUserTables(db)) {
      assertSafeTableName(name);
      await db.execAsync(`DELETE FROM "${name}"`);
    }

    const backupTableNames = sortTablesForInsert(
      Object.keys(payload.tables)
    );

    for (const name of backupTableNames) {
      if (!existingTables.has(name)) {
        console.warn(
          `[backup] Skipping table not in current database: ${name}`
        );
        continue;
      }

      const t = payload.tables[name];
      if (!t?.columns?.length) continue;

      for (const col of t.columns) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(col)) {
          throw new Error(`Invalid column name in backup: ${col}`);
        }
      }

      const colList = t.columns.map((c) => `"${c}"`).join(", ");
      const placeholders = t.columns.map(() => "?").join(", ");
      const sql = `INSERT INTO "${name}" (${colList}) VALUES (${placeholders})`;

      for (const row of t.rows) {
        if (!Array.isArray(row) || row.length !== t.columns.length) {
          throw new Error(
            `Backup row length mismatch for table "${name}" (expected ${t.columns.length} columns).`
          );
        }
        await db.runAsync(sql, row);
      }
    }
  });

  await db.execAsync("PRAGMA foreign_keys = ON");
}

export type ShareBackupResult = {
  uri: string;
  filename: string;
};

/**
 * Writes a JSON backup under the app documents folder (persistent) and opens the OS share sheet
 * so the user can save to Downloads / Drive / Files. Uses `text/plain` on Android so more targets appear.
 */
export async function shareDatabaseBackup(): Promise<ShareBackupResult> {
  const payload = await exportDatabasePayload();
  const json = JSON.stringify(payload);
  const safeTs = payload.createdAt.replace(/[:.]/g, "-");
  const filename = `Printechs-WMS-backup-${safeTs}.json`;

  const root = writableAppDirectory();
  const uri = `${root}${filename}`;
  await writeAsStringAsync(uri, json);

  const available = await Sharing.isAvailableAsync();
  if (!available) {
    if (Platform.OS === "web") {
      throw new Error("Backup sharing is not available in the browser.");
    }
    return { uri, filename };
  }

  // Android: many devices show no "Save" targets for application/json; text/plain still copies the same bytes.
  const mimeType =
    Platform.OS === "android" ? "text/plain" : "application/json";

  await Sharing.shareAsync(uri, {
    mimeType,
    dialogTitle: "Save database backup",
    ...(Platform.OS === "ios" ? { UTI: "public.json" } : {}),
  });

  return { uri, filename };
}

/**
 * Lets the user pick a folder (e.g. Downloads) via the system picker, then writes the backup there.
 * This is the reliable way to get a file onto “local disk” on Android 10+; the share sheet’s
 * “Files / Download” shortcut often opens the folder without importing the shared file.
 */
export async function saveDatabaseBackupToPickedFolder(): Promise<{
  uri: string;
  filename: string;
} | null> {
  if (Platform.OS === "web") {
    throw new Error(
      "Saving to a folder is not supported in the browser. Use an Android or iOS device."
    );
  }

  const payload = await exportDatabasePayload();
  const json = JSON.stringify(payload);
  const safeTs = payload.createdAt.replace(/[:.]/g, "-");
  const filename = `Printechs-WMS-backup-${safeTs}.json`;

  let picked: Directory;
  try {
    picked = await Directory.pickDirectoryAsync();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel|cancell?ed|abort|dismiss|user rejected/i.test(msg)) {
      return null;
    }
    throw e;
  }

  try {
    const file = picked.createFile(filename, "application/json");
    file.write(json);
    return { uri: file.uri, filename };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      msg || "Could not write the backup into the folder you selected."
    );
  }
}

export async function restoreDatabaseFromUri(
  fileUri: string
): Promise<void> {
  const json = await readAsStringAsync(fileUri);
  const payload = parseBackupPayload(json);
  await importDatabasePayload(payload);
}

/**
 * Opens the document picker to choose a `.json` backup and replaces the local DB.
 */
export async function pickAndRestoreDatabase(): Promise<boolean> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "text/plain", "*/*"],
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets?.length) {
    return false;
  }

  const uri = result.assets[0].uri;
  await restoreDatabaseFromUri(uri);
  return true;
}
