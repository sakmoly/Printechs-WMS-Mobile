import { getDatabase } from "../database/database";
import { Settings } from "../types";

// Mutex to prevent concurrent saveSettings calls
let saveSettingsQueue: Array<{
  settings: Partial<Settings>;
  resolve: () => void;
  reject: (error: any) => void;
}> = [];
let isSavingSettings = false;

// Process saveSettings queue
const processSaveSettingsQueue = async () => {
  if (isSavingSettings || saveSettingsQueue.length === 0) {
    return;
  }

  isSavingSettings = true;
  const { settings, resolve, reject } = saveSettingsQueue.shift()!;

  try {
    await executeSaveSettings(settings);
    resolve();
  } catch (error) {
    reject(error);
  } finally {
    isSavingSettings = false;
    // Process next item in queue (use setTimeout to defer to next event loop)
    if (saveSettingsQueue.length > 0) {
      setTimeout(() => processSaveSettingsQueue(), 0);
    }
  }
};

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
    "SELECT * FROM settings LIMIT 1"
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

// Internal function that actually performs the save operation
const executeSaveSettings = async (settings: Partial<Settings>) => {
  const db = await getDatabase();

  // Get existing settings without auto-generation to avoid recursion
  const existing = await db.getFirstAsync<Settings>(
    "SELECT * FROM settings LIMIT 1"
  );

  // Merge existing with new settings
  // Preserve demo_mode: use new value if provided, otherwise keep existing, or default to 0
  const demoModeValue =
    settings.demo_mode !== undefined
      ? settings.demo_mode
      : existing?.demo_mode !== undefined
      ? existing.demo_mode
      : 0;

  const updated: Settings = {
    demo_mode: demoModeValue,
    ...existing,
    ...settings,
  };

  // Preserve values - use new value if provided, otherwise keep existing, or use null
  const apiUrlValue =
    settings.api_url !== undefined
      ? settings.api_url && settings.api_url.trim()
        ? settings.api_url.trim()
        : null
      : existing?.api_url || null;
  const deviceIdValue =
    settings.device_id !== undefined
      ? settings.device_id && settings.device_id.trim()
        ? settings.device_id.trim()
        : null
      : existing?.device_id || null;
  const userIdValue =
    settings.user_id !== undefined
      ? settings.user_id && settings.user_id.trim()
        ? settings.user_id.trim()
        : null
      : existing?.user_id || null;
  const activeAsnValue =
    settings.active_asn !== undefined
      ? settings.active_asn || null
      : existing?.active_asn || null;
  const activeSessionValue =
    settings.active_session !== undefined
      ? settings.active_session || null
      : existing?.active_session || null;
  const userCodeValue =
    settings.user_code !== undefined
      ? settings.user_code && settings.user_code.trim()
        ? settings.user_code.trim()
        : null
      : existing?.user_code || null;
  const passwordValue =
    settings.password !== undefined
      ? settings.password || null
      : existing?.password || null;

  const authTokenValue =
    settings.auth_token !== undefined
      ? settings.auth_token || null
      : existing?.auth_token || null;
  const authTokenExpiresValue =
    settings.auth_token_expires !== undefined
      ? settings.auth_token_expires || null
      : existing?.auth_token_expires || null;

  // Only log fields that are being updated or are relevant
  const logData: any = {
    api_url: apiUrlValue || "(null)",
    device_id: deviceIdValue || "(null)",
    user_id: userIdValue || "(null)",
  };

  // Only include demo_mode if it's being explicitly set or changed
  if (settings.demo_mode !== undefined) {
    logData.demo_mode = `${updated.demo_mode} (${
      updated.demo_mode === 1 ? "ON" : "OFF"
    })`;
  }

  // Include other fields if they're being set
  if (settings.user_code !== undefined) {
    logData.user_code = userCodeValue || "(null)";
  }
  if (settings.password !== undefined) {
    logData.password = passwordValue ? "***" : "(null)";
  }
  if (settings.active_asn !== undefined) {
    logData.active_asn = activeAsnValue || "(null)";
  }
  if (settings.active_session !== undefined) {
    logData.active_session = activeSessionValue || "(null)";
  }

  console.log("saveSettings - Saving to database:", logData);

  // Since settings table has no primary key, we need to delete and insert
  // Or use a rowid-based approach
  // First, check if a row exists
  const rowExists = existing !== null;

  if (rowExists) {
    // Update existing row
    await db.runAsync(
      "UPDATE settings SET api_url = ?, device_id = ?, user_id = ?, user_code = ?, password = ?, demo_mode = ?, active_asn = ?, active_session = ?, auth_token = ?, auth_token_expires = ?",
      [
        apiUrlValue,
        deviceIdValue,
        userIdValue,
        userCodeValue,
        passwordValue,
        updated.demo_mode,
        activeAsnValue,
        activeSessionValue,
        authTokenValue,
        authTokenExpiresValue,
      ]
    );
  } else {
    // Insert new row
    await db.runAsync(
      "INSERT INTO settings (api_url, device_id, user_id, user_code, password, demo_mode, active_asn, active_session, auth_token, auth_token_expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        apiUrlValue,
        deviceIdValue,
        userIdValue,
        userCodeValue,
        passwordValue,
        updated.demo_mode,
        activeAsnValue,
        activeSessionValue,
        authTokenValue,
        authTokenExpiresValue,
      ]
    );
  }

  // Verify the save
  const verify = await db.getFirstAsync<Settings>(
    "SELECT * FROM settings LIMIT 1"
  );
  console.log("saveSettings - Verified saved values:", {
    api_url: verify?.api_url || "(null)",
    device_id: verify?.device_id || "(null)",
    user_id: verify?.user_id || "(null)",
    demo_mode: verify?.demo_mode,
  });
};

// Public API - queues the save operation
export const saveSettings = async (settings: Partial<Settings>) => {
  return new Promise<void>((resolve, reject) => {
    saveSettingsQueue.push({ settings, resolve, reject });
    processSaveSettingsQueue();
  });
};
