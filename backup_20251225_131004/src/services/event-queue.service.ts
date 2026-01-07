import { generateUUID } from "../utils/uuid";
import { getDatabase } from "../database/database";
import { ScanEvent } from "../types";
import { apiService } from "./api.service";
import { getSettings } from "./settings.service";

// Debounce sync to prevent rate limiting
let syncTimeout: ReturnType<typeof setTimeout> | null = null;
let isSyncing = false;
const SYNC_DEBOUNCE_MS = 2000; // Wait 2 seconds after last event before syncing
const MAX_BATCH_SIZE = 1000; // Backend limit: max 1000 events per batch

export const addEvent = async (
  event: Omit<ScanEvent, "offline_uuid" | "synced" | "event_time">
): Promise<string> => {
  const db = await getDatabase();
  const settings = await getSettings();

  const offline_uuid = generateUUID();
  const event_time = new Date().toISOString();

  const fullEvent: ScanEvent = {
    ...event,
    offline_uuid,
    event_time,
    synced: 0,
    device_id: event.device_id || settings.device_id || "",
    user_id: event.user_id || settings.user_id || "",
  };

  await db.runAsync(
    `INSERT INTO event_queue (
      offline_uuid, event_type, asn_no, to_no, inbound_session, carton_id,
      item_code, qty, store, box_id, tc_id, rack, bin, device_id, user_id,
      event_time, synced, error_msg
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fullEvent.offline_uuid,
      fullEvent.event_type,
      fullEvent.asn_no ?? null,
      fullEvent.to_no ?? null,
      fullEvent.inbound_session ?? null,
      fullEvent.carton_id ?? null,
      fullEvent.item_code ?? null,
      fullEvent.qty ?? null,
      fullEvent.store ?? null,
      fullEvent.box_id ?? null,
      fullEvent.tc_id ?? null,
      fullEvent.rack ?? null,
      fullEvent.bin ?? null,
      fullEvent.device_id ?? "",
      fullEvent.user_id ?? "",
      fullEvent.event_time,
      fullEvent.synced,
      fullEvent.error_msg ?? null,
    ]
  );

  // Debounced sync: wait a bit before syncing to batch multiple events
  // This prevents rate limiting when adding many events quickly (e.g., manual quantity entry)
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }

  syncTimeout = setTimeout(async () => {
    syncTimeout = null;
    if (!isSyncing) {
      try {
        await syncEvents();
      } catch (error) {
        // Ignore sync errors, will retry later
        console.log("⚠️ Auto-sync failed, will retry later:", error);
      }
    }
  }, SYNC_DEBOUNCE_MS);

  return offline_uuid;
};

export const getUnsyncedEvents = async (): Promise<ScanEvent[]> => {
  const db = await getDatabase();
  const result = await db.getAllAsync<ScanEvent>(
    "SELECT * FROM event_queue WHERE synced = 0 ORDER BY event_time ASC"
  );
  return result;
};

export const markEventSynced = async (offline_uuid: string) => {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE event_queue SET synced = 1, error_msg = NULL WHERE offline_uuid = ?",
    [offline_uuid]
  );
};

export const markEventFailed = async (
  offline_uuid: string,
  error_msg: string
) => {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE event_queue SET error_msg = ? WHERE offline_uuid = ?",
    [error_msg, offline_uuid]
  );
};

export const syncEvents = async (): Promise<{
  synced: number;
  failed: number;
}> => {
  // Prevent concurrent syncs
  if (isSyncing) {
    console.log("⏳ Sync already in progress, skipping...");
    return { synced: 0, failed: 0 };
  }

  const unsynced = await getUnsyncedEvents();

  if (unsynced.length === 0) {
    return { synced: 0, failed: 0 };
  }

  // Clear old error messages before retrying
  await clearErrorMessages();

  isSyncing = true;

  try {
    // Normalize events: ensure qty is a number (SQLite may return it as string)
    const normalizedEvents = unsynced.map((event) => ({
      ...event,
      qty: event.qty != null ? Number(event.qty) : undefined,
    }));

    // Split events into chunks of MAX_BATCH_SIZE to comply with backend limit
    const chunks: ScanEvent[][] = [];
    for (let i = 0; i < normalizedEvents.length; i += MAX_BATCH_SIZE) {
      const chunk = normalizedEvents.slice(i, i + MAX_BATCH_SIZE);
      // Safety check: ensure chunk never exceeds MAX_BATCH_SIZE
      if (chunk.length > MAX_BATCH_SIZE) {
        console.error(
          `❌ ERROR: Chunk size (${chunk.length}) exceeds MAX_BATCH_SIZE (${MAX_BATCH_SIZE})!`
        );
        // Split this chunk further
        for (let j = 0; j < chunk.length; j += MAX_BATCH_SIZE) {
          chunks.push(chunk.slice(j, j + MAX_BATCH_SIZE));
        }
      } else {
        chunks.push(chunk);
      }
    }

    // Validate all chunks are within limit
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].length > MAX_BATCH_SIZE) {
        console.error(
          `❌ ERROR: Chunk ${i + 1} has ${
            chunks[i].length
          } events, exceeds limit of ${MAX_BATCH_SIZE}!`
        );
      }
    }

    console.log(
      `📦 Syncing ${normalizedEvents.length} events in ${chunks.length} batch(es) of max ${MAX_BATCH_SIZE}`
    );

    // Log chunk sizes for debugging
    chunks.forEach((chunk, idx) => {
      console.log(`  Batch ${idx + 1}: ${chunk.length} events`);
    });

    let totalSyncedCount = 0;
    let totalFailedCount = 0;

    // Process each chunk sequentially
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      console.log(
        `📤 Sending batch ${chunkIndex + 1}/${chunks.length} (${
          chunk.length
        } events)...`
      );

      try {
        // Double-check chunk size before sending
        if (chunk.length > MAX_BATCH_SIZE) {
          throw new Error(
            `Chunk size (${chunk.length}) exceeds backend limit (${MAX_BATCH_SIZE}). This should never happen!`
          );
        }

        console.log(
          `📤 Sending batch ${chunkIndex + 1}/${chunks.length} with exactly ${
            chunk.length
          } events (limit: ${MAX_BATCH_SIZE})`
        );

        const response = await apiService.batchEvents(chunk);

        // Mark acked events as synced (this also clears error_msg)
        if (response.acked) {
          for (const uuid of response.acked) {
            await markEventSynced(uuid);
            totalSyncedCount++;
          }
        }

        // Mark failed events
        if (response.failed) {
          for (const failure of response.failed) {
            await markEventFailed(
              failure.uuid,
              failure.message || "Unknown error"
            );
            totalFailedCount++;
          }
        }

        console.log(
          `✅ Batch ${chunkIndex + 1}/${chunks.length} completed: ${
            response.acked?.length || 0
          } synced, ${response.failed?.length || 0} failed`
        );

        // Add a delay between chunks to avoid rate limiting and allow UI updates
        if (chunkIndex < chunks.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        // Yield to UI thread every 3 chunks to prevent hanging
        if ((chunkIndex + 1) % 3 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (chunkError: any) {
        // Handle rate limiting gracefully - don't mark events as failed, they'll retry
        if (
          chunkError.message?.includes("429") ||
          chunkError.message?.includes("RATE_LIMIT") ||
          chunkError.message?.includes("rate limit")
        ) {
          console.log(
            `⚠️ Rate limit hit on batch ${chunkIndex + 1}/${
              chunks.length
            }, remaining events will be synced later`
          );
          // Don't mark as failed, just break - remaining chunks will be retried on next sync
          break;
        }

        // Check if error is about batch size limit
        if (
          chunkError.message?.includes("1000") ||
          chunkError.message?.includes("less than or equal to 1000") ||
          chunkError.message?.includes("VALIDATION_ERROR")
        ) {
          console.error(
            `❌ Batch size validation error on batch ${chunkIndex + 1}/${
              chunks.length
            }:`,
            chunkError.message
          );
          console.error(
            `   Chunk size was: ${chunk.length}, limit is: ${MAX_BATCH_SIZE}`
          );
          // This shouldn't happen if chunking is working correctly
          // But if it does, split this chunk further
          console.log(
            `   Attempting to split chunk ${
              chunkIndex + 1
            } into smaller batches...`
          );
          const subChunks: ScanEvent[][] = [];
          for (let j = 0; j < chunk.length; j += 500) {
            subChunks.push(chunk.slice(j, j + 500));
          }
          // Retry with smaller chunks
          for (const subChunk of subChunks) {
            try {
              const subResponse = await apiService.batchEvents(subChunk);
              if (subResponse.acked) {
                for (const uuid of subResponse.acked) {
                  await markEventSynced(uuid);
                  totalSyncedCount++;
                }
              }
            } catch (subError: any) {
              console.error(`   Sub-chunk also failed:`, subError.message);
              for (const event of subChunk) {
                await markEventFailed(
                  event.offline_uuid,
                  subError.message || "Sync failed"
                );
                totalFailedCount++;
              }
            }
          }
        } else {
          // For other errors, mark this chunk as failed and continue with next chunk
          console.error(
            `❌ Batch ${chunkIndex + 1}/${chunks.length} failed:`,
            chunkError.message
          );
          for (const event of chunk) {
            await markEventFailed(
              event.offline_uuid,
              chunkError.message || "Sync failed"
            );
            totalFailedCount++;
          }
        }
        // Continue with next chunk instead of throwing
      }
    }

    return { synced: totalSyncedCount, failed: totalFailedCount };
  } catch (error: any) {
    // This catch block handles unexpected errors before chunk processing
    console.error("❌ Sync error:", error);
    // Mark all remaining unsynced events as failed
    for (const event of unsynced) {
      await markEventFailed(event.offline_uuid, error.message || "Sync failed");
    }
    throw error;
  } finally {
    isSyncing = false;
  }
};

export const getEventCount = async (): Promise<number> => {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM event_queue WHERE synced = 0"
  );
  return result?.count || 0;
};

export const clearErrorMessages = async (): Promise<void> => {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE event_queue SET error_msg = NULL WHERE synced = 0 AND error_msg IS NOT NULL"
  );
  console.log("✅ Cleared error messages from unsynced events");
};
