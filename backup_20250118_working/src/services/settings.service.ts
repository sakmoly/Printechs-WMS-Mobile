import { getDatabase } from '../database/database';
import { Settings } from '../types';

// Generate a unique device ID
const generateDeviceId = (): string => {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `DEV-${random}-${timestamp}`;
};

// Generate a unique user ID
const generateUserId = (): string => {
  const timestamp = Date.now().toString().slice(-6);
  return `USER-${timestamp}`;
};

export const getSettings = async (): Promise<Settings> => {
  const db = await getDatabase();
  let result = await db.getFirstAsync<Settings>(
    'SELECT * FROM settings LIMIT 1'
  );
  
  if (!result) {
    result = { demo_mode: 0 };
  }

  // Auto-generate Device ID if not set
  if (!result.device_id) {
    result.device_id = generateDeviceId();
    await saveSettings({ device_id: result.device_id });
  }

  // Auto-generate User ID if not set
  if (!result.user_id) {
    result.user_id = generateUserId();
    await saveSettings({ user_id: result.user_id });
  }
  
  return result;
};

export const saveSettings = async (settings: Partial<Settings>) => {
  const db = await getDatabase();
  
  // Get existing settings without auto-generation to avoid recursion
  const existing = await db.getFirstAsync<Settings>(
    'SELECT * FROM settings LIMIT 1'
  ) || { demo_mode: 0 };
  
  const updated: Settings = {
    ...existing,
    ...settings,
  };

  await db.runAsync(
    'INSERT OR REPLACE INTO settings (api_url, device_id, user_id, demo_mode) VALUES (?, ?, ?, ?)',
    [updated.api_url || null, updated.device_id || null, updated.user_id || null, updated.demo_mode]
  );
};

