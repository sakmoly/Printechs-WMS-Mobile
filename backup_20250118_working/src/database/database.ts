import * as SQLite from 'expo-sqlite';
import { ALL_MIGRATIONS } from './schema';

let db: SQLite.SQLiteDatabase | null = null;

export const getDatabase = async (): Promise<SQLite.SQLiteDatabase> => {
  if (db) {
    return db;
  }

  db = await SQLite.openDatabaseAsync('wms.db');
  
  // Run migrations
  for (const migration of ALL_MIGRATIONS) {
    await db.execAsync(migration);
  }

  return db;
};

export const closeDatabase = async () => {
  if (db) {
    await db.closeAsync();
    db = null;
  }
};

