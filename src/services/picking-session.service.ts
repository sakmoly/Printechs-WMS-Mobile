/**
 * Picking Session Storage Service
 * Manages local storage of picking sessions for Resume Picking functionality
 * Uses SQLite database (material_request_picking_sessions table)
 */

import { getDatabase } from "../database/database";

export interface PickingSession {
  session_id: string;
  material_request_title: string;
  bin_location: string | null;
  carton_id: string | null;
  status: "Draft" | "In Progress" | "Completed";
  started_by: string;
  started_at: string;
  updated_at: string;
  is_dirty?: boolean; // For offline queue tracking
}

export const pickingSessionService = {
  /**
   * Save picking session to SQLite database
   */
  saveSession: async (session: PickingSession): Promise<void> => {
    try {
      const db = await getDatabase();
      await db.runAsync(
        `INSERT OR REPLACE INTO material_request_picking_sessions 
         (session_id, material_request_title, bin_location, carton_id, status, started_by, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          session.session_id,
          session.material_request_title,
          session.bin_location || null,
          session.carton_id || null,
          session.status,
          session.started_by,
          session.started_at,
          session.updated_at,
        ]
      );
      console.log(`✅ Saved picking session: ${session.session_id}`);
    } catch (error: any) {
      console.error("❌ Error saving picking session:", error);
      throw error;
    }
  },

  /**
   * Load picking session from SQLite database
   */
  loadSession: async (materialRequestTitle: string): Promise<PickingSession | null> => {
    try {
      const db = await getDatabase();
      const session = await db.getFirstAsync<any>(
        `SELECT * FROM material_request_picking_sessions 
         WHERE material_request_title = ? 
         ORDER BY updated_at DESC LIMIT 1`,
        [materialRequestTitle]
      );

      if (session) {
        // Check if there are unsynced events to determine is_dirty
        const unsyncedCount = await db.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) as count FROM event_queue 
           WHERE material_request = ? AND synced = 0`,
          [materialRequestTitle]
        );
        
        const pickingSession: PickingSession = {
          session_id: session.session_id,
          material_request_title: session.material_request_title,
          bin_location: session.bin_location,
          carton_id: session.carton_id,
          status: session.status,
          started_by: session.started_by,
          started_at: session.started_at,
          updated_at: session.updated_at,
          is_dirty: (unsyncedCount?.count || 0) > 0,
        };
        console.log(`✅ Loaded picking session: ${pickingSession.session_id}`);
        return pickingSession;
      }
      return null;
    } catch (error: any) {
      console.error("❌ Error loading picking session:", error);
      return null;
    }
  },

  /**
   * Delete picking session
   */
  deleteSession: async (materialRequestTitle: string): Promise<void> => {
    try {
      const db = await getDatabase();
      await db.runAsync(
        `DELETE FROM material_request_picking_sessions 
         WHERE material_request_title = ?`,
        [materialRequestTitle]
      );
      console.log(`✅ Deleted picking session for: ${materialRequestTitle}`);
    } catch (error: any) {
      console.error("❌ Error deleting picking session:", error);
    }
  },

  /**
   * Add scan event to offline queue (stored in event_queue table)
   */
  addToQueue: async (
    materialRequestTitle: string,
    event: {
      type: "SCAN_ITEM" | "SCAN_BIN" | "SCAN_CARTON";
      payload: any;
    }
  ): Promise<void> => {
    try {
      const db = await getDatabase();
      const eventData = {
        ...event,
        created_at: new Date().toISOString(),
      };
      
      // Store in event_queue table - use existing columns where possible
      const uuid = `picking-${Date.now()}-${Math.random()}`;
      const eventTime = new Date().toISOString();
      
      // Map event type to event_queue structure
      if (event.type === "SCAN_ITEM") {
        await db.runAsync(
          `INSERT INTO event_queue 
           (offline_uuid, event_type, material_request, item_code, qty, carton_id, device_id, user_id, event_time, synced)
           VALUES (?, 'PICK_ITEM', ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            uuid,
            materialRequestTitle,
            event.payload.barcode || event.payload.item_code,
            1, // qty
            event.payload.carton_id || null,
            null, // device_id - will be set by sync
            null, // user_id - will be set by sync
            eventTime,
          ]
        );
      } else if (event.type === "SCAN_CARTON") {
        // Store carton scan as metadata in material_request field
        await db.runAsync(
          `INSERT INTO event_queue 
           (offline_uuid, event_type, material_request, carton_id, event_time, synced)
           VALUES (?, 'PICK_CARTON', ?, ?, ?, 0)`,
          [uuid, materialRequestTitle, event.payload.carton_id, eventTime]
        );
      }
      
      // Also store full payload as JSON in a separate approach
      // We'll use the material_request field to store JSON for complex events
      console.log(`✅ Added event to queue: ${event.type}`);
      console.log(`✅ Added event to queue: ${event.type}`);
    } catch (error: any) {
      console.error("❌ Error adding to queue:", error);
    }
  },

  /**
   * Get offline queue from event_queue table
   */
  getQueue: async (materialRequestTitle: string): Promise<any[]> => {
    try {
      const db = await getDatabase();
      const events = await db.getAllAsync<any>(
        `SELECT * FROM event_queue 
         WHERE material_request = ? AND synced = 0
         ORDER BY event_time ASC`,
        [materialRequestTitle]
      );
      
      // Convert to queue format
      return events.map((e) => ({
        type: e.event_type === "PICK_ITEM" ? "SCAN_ITEM" : e.event_type === "PICK_CARTON" ? "SCAN_CARTON" : e.event_type,
        payload: {
          session_id: e.material_request, // Use material_request as session identifier
          barcode: e.item_code,
          item_code: e.item_code,
          carton_id: e.carton_id,
          qty: e.qty,
        },
        created_at: e.event_time,
      }));
    } catch (error: any) {
      console.error("❌ Error getting queue:", error);
      return [];
    }
  },

  /**
   * Clear offline queue
   */
  clearQueue: async (materialRequestTitle: string): Promise<void> => {
    try {
      const db = await getDatabase();
      await db.runAsync(
        `DELETE FROM event_queue 
         WHERE material_request = ? AND synced = 0`,
        [materialRequestTitle]
      );
      console.log(`✅ Cleared queue for: ${materialRequestTitle}`);
    } catch (error: any) {
      console.error("❌ Error clearing queue:", error);
    }
  },
};
