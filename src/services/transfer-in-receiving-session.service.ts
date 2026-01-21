/**
 * Transfer In Receiving Session Storage Service
 * Manages local storage of receiving sessions for Resume Receiving functionality
 * Uses SQLite database (transfer_in_receiving_sessions table)
 */

import { getDatabase } from "../database/database";

export interface TransferInReceivingSession {
  session_id: string;
  transfer_in_no: string;
  transaction_no: string | null;
  active_carton_id: string | null;
  status: "Draft" | "In Progress" | "Completed";
  started_by: string;
  started_at: string;
  updated_at: string;
  is_dirty?: boolean; // For offline queue tracking
  scanned_total?: number; // Total items scanned
}

export const transferInReceivingSessionService = {
  /**
   * Save receiving session to SQLite database
   */
  saveSession: async (session: TransferInReceivingSession): Promise<void> => {
    try {
      const db = await getDatabase();
      await db.runAsync(
        `INSERT OR REPLACE INTO transfer_in_receiving_sessions 
         (session_id, transfer_in_no, transaction_no, active_carton_id, status, started_by, started_at, updated_at, scanned_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.session_id,
          session.transfer_in_no,
          session.transaction_no || null,
          session.active_carton_id || null,
          session.status,
          session.started_by,
          session.started_at,
          session.updated_at,
          session.scanned_total || 0,
        ]
      );
      console.log(`✅ Saved Transfer In receiving session: ${session.session_id}`);
    } catch (error: any) {
      console.error("❌ Error saving Transfer In receiving session:", error);
      throw error;
    }
  },

  /**
   * Load receiving session from SQLite database
   */
  loadSession: async (transferInNo: string): Promise<TransferInReceivingSession | null> => {
    try {
      const db = await getDatabase();
      const session = await db.getFirstAsync<any>(
        `SELECT * FROM transfer_in_receiving_sessions 
         WHERE transfer_in_no = ? 
         ORDER BY updated_at DESC LIMIT 1`,
        [transferInNo]
      );

      if (session) {
        // Check if there are unsynced events to determine is_dirty
        const unsyncedCount = await db.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) as count FROM event_queue 
           WHERE transfer_in = ? AND synced = 0`,
          [transferInNo]
        );
        
        const receivingSession: TransferInReceivingSession = {
          session_id: session.session_id,
          transfer_in_no: session.transfer_in_no,
          transaction_no: session.transaction_no,
          active_carton_id: session.active_carton_id,
          status: session.status,
          started_by: session.started_by,
          started_at: session.started_at,
          updated_at: session.updated_at,
          scanned_total: session.scanned_total || 0,
          is_dirty: (unsyncedCount?.count || 0) > 0,
        };
        console.log(`✅ Loaded Transfer In receiving session: ${receivingSession.session_id}`);
        return receivingSession;
      }
      return null;
    } catch (error: any) {
      console.error("❌ Error loading Transfer In receiving session:", error);
      return null;
    }
  },

  /**
   * Delete receiving session
   */
  deleteSession: async (transferInNo: string): Promise<void> => {
    try {
      const db = await getDatabase();
      await db.runAsync(
        `DELETE FROM transfer_in_receiving_sessions 
         WHERE transfer_in_no = ?`,
        [transferInNo]
      );
      console.log(`✅ Deleted Transfer In receiving session for: ${transferInNo}`);
    } catch (error: any) {
      console.error("❌ Error deleting Transfer In receiving session:", error);
    }
  },

  /**
   * Update active carton ID
   */
  updateActiveCarton: async (
    transferInNo: string,
    cartonId: string
  ): Promise<void> => {
    try {
      const db = await getDatabase();
      await db.runAsync(
        `UPDATE transfer_in_receiving_sessions 
         SET active_carton_id = ?, updated_at = ?
         WHERE transfer_in_no = ?`,
        [cartonId, new Date().toISOString(), transferInNo]
      );
      console.log(`✅ Updated active carton for ${transferInNo}: ${cartonId}`);
    } catch (error: any) {
      console.error("❌ Error updating active carton:", error);
    }
  },

  /**
   * Update scanned total
   */
  updateScannedTotal: async (
    transferInNo: string,
    scannedTotal: number
  ): Promise<void> => {
    try {
      const db = await getDatabase();
      await db.runAsync(
        `UPDATE transfer_in_receiving_sessions 
         SET scanned_total = ?, updated_at = ?
         WHERE transfer_in_no = ?`,
        [scannedTotal, new Date().toISOString(), transferInNo]
      );
    } catch (error: any) {
      console.error("❌ Error updating scanned total:", error);
    }
  },
};
