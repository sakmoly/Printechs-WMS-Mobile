/**
 * Relocation Session Storage Service
 * Manages local storage of relocation sessions for Resume functionality
 * Uses SQLite database (relocation_sessions table)
 */

import { getDatabase } from "../database/database";
import { getSettings } from "./settings.service";

export type RelocationMode = "FULL_CARTON" | "PARTIAL_ITEMS" | "CARTON_TO_CARTON";
export type RelocationPolicy = "BLIND" | "VERIFIED";

export interface RelocationSession {
  session_id: string;
  mode: RelocationMode;
  policy?: RelocationPolicy; // For FULL_CARTON mode
  from_bin: string | null;
  from_carton: string | null;
  to_bin: string | null;
  to_carton: string | null;
  scanned_lines: Array<{
    item_code: string;
    item_name?: string;
    barcode?: string;
    available_qty: number; // Source carton qty
    move_qty: number; // Quantity to move
    remaining_qty: number; // available_qty - move_qty
  }>;
  status: "Draft" | "In Progress" | "Completed";
  started_by: string;
  started_at: string;
  updated_at: string;
  warehouse?: string;
  user_id?: string;
}

export const relocationSessionService = {
  /**
   * Save relocation session to SQLite database
   */
  saveSession: async (session: RelocationSession): Promise<void> => {
    try {
      const db = await getDatabase();
      await db.runAsync(
        `INSERT OR REPLACE INTO relocation_sessions 
         (session_id, mode, policy, from_bin, from_carton, to_bin, to_carton, 
          scanned_lines_json, status, started_by, started_at, updated_at, warehouse, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.session_id,
          session.mode,
          session.policy || null,
          session.from_bin || null,
          session.from_carton || null,
          session.to_bin || null,
          session.to_carton || null,
          JSON.stringify(session.scanned_lines || []),
          session.status,
          session.started_by,
          session.started_at,
          session.updated_at,
          session.warehouse || null,
          session.user_id || null,
        ]
      );
      console.log(`✅ Saved relocation session: ${session.session_id}`);
    } catch (error: any) {
      console.error("❌ Error saving relocation session:", error);
      throw error;
    }
  },

  /**
   * Load relocation session from SQLite database
   */
  loadSession: async (): Promise<RelocationSession | null> => {
    try {
      const db = await getDatabase();
      const session = await db.getFirstAsync<any>(
        `SELECT * FROM relocation_sessions 
         WHERE status = 'In Progress' 
         ORDER BY updated_at DESC LIMIT 1`
      );

      if (session) {
        const relocationSession: RelocationSession = {
          session_id: session.session_id,
          mode: session.mode,
          policy: session.policy || undefined,
          from_bin: session.from_bin,
          from_carton: session.from_carton,
          to_bin: session.to_bin,
          to_carton: session.to_carton,
          scanned_lines: session.scanned_lines_json ? JSON.parse(session.scanned_lines_json) : [],
          status: session.status,
          started_by: session.started_by,
          started_at: session.started_at,
          updated_at: session.updated_at,
          warehouse: session.warehouse,
          user_id: session.user_id,
        };
        console.log(`✅ Loaded relocation session: ${relocationSession.session_id}`);
        return relocationSession;
      }
      return null;
    } catch (error: any) {
      console.error("❌ Error loading relocation session:", error);
      return null;
    }
  },

  /**
   * Delete relocation session
   */
  deleteSession: async (): Promise<void> => {
    try {
      const db = await getDatabase();
      await db.runAsync(
        `DELETE FROM relocation_sessions WHERE status = 'In Progress'`
      );
      console.log(`✅ Deleted relocation session`);
    } catch (error: any) {
      console.error("❌ Error deleting relocation session:", error);
    }
  },

  /**
   * Check if there's an active (In Progress) session
   */
  hasActiveSession: async (): Promise<boolean> => {
    const session = await relocationSessionService.loadSession();
    return session !== null && session.status === "In Progress";
  },

  /**
   * Update session fields (partial update)
   */
  updateSession: async (updates: Partial<RelocationSession>): Promise<void> => {
    const session = await relocationSessionService.loadSession();
    if (session) {
      const updatedSession: RelocationSession = {
        ...session,
        ...updates,
        updated_at: new Date().toISOString(),
      };
      await relocationSessionService.saveSession(updatedSession);
    }
  },
};
