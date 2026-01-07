import { apiService } from "./api.service";
import { dataService } from "./data.service";
import { getSettings } from "./settings.service";

/**
 * Sync session data to backend
 */
export const syncSessionToBackend = async (
  inbound_session: string
): Promise<boolean> => {
  try {
    console.log(`🔍 Looking up session: ${inbound_session}`);
    const session = await dataService.getInboundSession(inbound_session);
    if (!session) {
      console.warn(`⚠️ Session ${inbound_session} not found locally`);
      return false;
    }
    console.log(`✅ Found session:`, {
      inbound_session: session.inbound_session,
      asn_no: session.asn_no,
      status: session.status,
      completed_cartons: session.completed_cartons,
      total_cartons: session.total_cartons,
      synced: session.synced,
    });

    // If already synced, we still need to sync if data has changed (e.g., completed_cartons updated)
    // Reset synced flag to force sync when session data changes
    if (session.synced === 1) {
      console.log(
        `🔄 Session ${inbound_session} already synced, but forcing re-sync to update progress`
      );
      // Reset synced flag to allow re-sync
      await dataService.markSessionUnsynced(inbound_session);
      // Reload session to get latest data
      const updatedSession = await dataService.getInboundSession(
        inbound_session
      );
      if (updatedSession) {
        Object.assign(session, updatedSession);
      }
    }

    const settings = await getSettings();
    // ✅ REMOVED: Demo mode check - session sync always goes to backend
    if (!settings.api_url) {
      console.warn("⚠️ API URL not configured - skipping session sync");
      await dataService.markSessionSynced(inbound_session);
      return true;
    }

    // Use single endpoint: POST /api/inbound/update
    // This endpoint both creates new sessions and updates existing ones
    // It prevents duplicates automatically - safe to call multiple times
    const syncData: any = {
      inbound_session: session.inbound_session,
      asn_no: session.asn_no,
      status: session.status || "Active",
    };

    // Always include completed_cartons and total_cartons if available
    // These are critical for tracking progress
    if (
      session.completed_cartons !== undefined &&
      session.completed_cartons !== null
    ) {
      syncData.completed_cartons = session.completed_cartons;
      console.log(
        `📊 Including completed_cartons in sync: ${session.completed_cartons}`
      );
    }
    if (session.total_cartons !== undefined && session.total_cartons !== null) {
      syncData.total_cartons = session.total_cartons;
      console.log(
        `📊 Including total_cartons in sync: ${session.total_cartons}`
      );
    }
    // Always include transfer_order if it exists (even if empty string, but not null/undefined)
    if (
      session.transfer_order !== null &&
      session.transfer_order !== undefined
    ) {
      syncData.transfer_order = session.transfer_order;
      console.log(
        `📋 Including transfer_order in sync: ${session.transfer_order}`
      );
    } else {
      console.log(`ℹ️ Session has no transfer_order to sync`);
    }
    if (session.dock) {
      syncData.dock = session.dock;
    }
    if (settings.user_id) {
      syncData.user_id = settings.user_id;
    }
    if (settings.device_id) {
      syncData.device_id = settings.device_id;
    }

    // Single endpoint handles both create and update
    await apiService.updateInboundSession(syncData);
    console.log(
      `✅ Session ${inbound_session} synced to backend (${
        session.status || "Active"
      })`
    );

    // Mark as synced
    await dataService.markSessionSynced(inbound_session);
    console.log(`✅ Session ${inbound_session} synced to backend`);
    return true;
  } catch (error: any) {
    const errorMsg = error.message || error.toString() || "Unknown error";
    console.error(`❌ Failed to sync session ${inbound_session}:`, errorMsg);

    // Provide specific guidance for common backend errors
    if (errorMsg.includes("Unknown column 'title'")) {
      console.error(
        `⚠️ Backend Database Error: The backend is using column 'title' instead of 'inbound_session'.\n` +
          `   Please update the backend to use 'inbound_session' as the PRIMARY KEY.\n` +
          `   See BACKEND_CONNECTION_TROUBLESHOOTING.md for details.`
      );
    } else if (errorMsg.includes("500")) {
      console.error(
        `⚠️ Backend Server Error (500): The backend encountered an error processing the request.\n` +
          `   Check backend logs for details. Common issues:\n` +
          `   - Database schema mismatch (e.g., 'title' vs 'inbound_session')\n` +
          `   - Missing required columns in inbound_sessions table\n` +
          `   - Database connection issues`
      );
    }

    return false;
  }
};

/**
 * Sync all unsynced sessions to backend
 */
export const syncAllUnsyncedSessions = async (): Promise<{
  synced: number;
  failed: number;
}> => {
  try {
    console.log("🔄 Starting session sync...");

    // Add a small delay to ensure database is ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    const unsyncedSessions = await dataService.getUnsyncedSessions();
    console.log(
      `🔄 Found ${unsyncedSessions.length} unsynced session(s) to sync`
    );

    if (unsyncedSessions.length === 0) {
      console.log("✅ No unsynced sessions to sync");
      return { synced: 0, failed: 0 };
    }

    let synced = 0;
    let failed = 0;

    for (let i = 0; i < unsyncedSessions.length; i++) {
      const session = unsyncedSessions[i];
      try {
        console.log(
          `🔄 Syncing session ${i + 1}/${unsyncedSessions.length}: ${
            session.inbound_session
          }`
        );
        const success = await syncSessionToBackend(session.inbound_session);
        if (success) {
          synced++;
          console.log(
            `✅ Session ${session.inbound_session} synced successfully`
          );
        } else {
          failed++;
          console.warn(`⚠️ Session ${session.inbound_session} sync failed`);
        }

        // Small delay to allow UI to update (every 5 sessions or on last)
        if ((i + 1) % 5 === 0 || i === unsyncedSessions.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } catch (error: any) {
        failed++;
        console.error(
          `❌ Error syncing session ${session.inbound_session}:`,
          error.message
        );
      }
    }

    console.log(`✅ Session sync complete: ${synced} synced, ${failed} failed`);
    return { synced, failed };
  } catch (error: any) {
    console.error("❌ Failed to sync sessions:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    return { synced: 0, failed: 0 };
  }
};
