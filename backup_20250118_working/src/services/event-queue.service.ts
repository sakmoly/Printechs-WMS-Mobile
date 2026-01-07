import { generateUUID } from '../utils/uuid';
import { getDatabase } from '../database/database';
import { ScanEvent } from '../types';
import { apiService } from './api.service';
import { getSettings } from './settings.service';

export const addEvent = async (event: Omit<ScanEvent, 'offline_uuid' | 'synced' | 'event_time'>): Promise<string> => {
  const db = await getDatabase();
  const settings = await getSettings();
  
  const offline_uuid = generateUUID();
  const event_time = new Date().toISOString();

  const fullEvent: ScanEvent = {
    ...event,
    offline_uuid,
    event_time,
    synced: 0,
    device_id: event.device_id || settings.device_id || '',
    user_id: event.user_id || settings.user_id || '',
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
      fullEvent.asn_no || null,
      fullEvent.to_no || null,
      fullEvent.inbound_session || null,
      fullEvent.carton_id || null,
      fullEvent.item_code || null,
      fullEvent.qty || null,
      fullEvent.store || null,
      fullEvent.box_id || null,
      fullEvent.tc_id || null,
      fullEvent.rack || null,
      fullEvent.bin || null,
      fullEvent.device_id,
      fullEvent.user_id,
      fullEvent.event_time,
      fullEvent.synced,
      fullEvent.error_msg || null,
    ]
  );

  // Try to sync immediately if online
  try {
    await syncEvents();
  } catch (error) {
    // Ignore sync errors, will retry later
  }

  return offline_uuid;
};

export const getUnsyncedEvents = async (): Promise<ScanEvent[]> => {
  const db = await getDatabase();
  const result = await db.getAllAsync<ScanEvent>(
    'SELECT * FROM event_queue WHERE synced = 0 ORDER BY event_time ASC'
  );
  return result;
};

export const markEventSynced = async (offline_uuid: string) => {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE event_queue SET synced = 1, error_msg = NULL WHERE offline_uuid = ?',
    [offline_uuid]
  );
};

export const markEventFailed = async (offline_uuid: string, error_msg: string) => {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE event_queue SET error_msg = ? WHERE offline_uuid = ?',
    [error_msg, offline_uuid]
  );
};

export const syncEvents = async (): Promise<{ synced: number; failed: number }> => {
  const unsynced = await getUnsyncedEvents();
  
  if (unsynced.length === 0) {
    return { synced: 0, failed: 0 };
  }

  try {
    const response = await apiService.batchEvents(unsynced);
    
    let syncedCount = 0;
    let failedCount = 0;

    // Mark acked events as synced
    if (response.acked) {
      for (const uuid of response.acked) {
        await markEventSynced(uuid);
        syncedCount++;
      }
    }

    // Mark failed events
    if (response.failed) {
      for (const failure of response.failed) {
        await markEventFailed(failure.uuid, failure.message || 'Unknown error');
        failedCount++;
      }
    }

    return { synced: syncedCount, failed: failedCount };
  } catch (error: any) {
    // Mark all as failed
    for (const event of unsynced) {
      await markEventFailed(event.offline_uuid, error.message || 'Sync failed');
    }
    throw error;
  }
};

export const getEventCount = async (): Promise<number> => {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM event_queue WHERE synced = 0'
  );
  return result?.count || 0;
};

