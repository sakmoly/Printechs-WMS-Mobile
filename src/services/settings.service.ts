import { getDatabase } from "../database/database";
import { runDbWrite } from "../database/dbQueue";
import { Settings } from "../types";
import * as SQLite from "expo-sqlite";
import { File, Paths } from "expo-file-system";
import { v4 as uuidv4 } from "uuid";
import { DEFAULT_API_URL, DEFAULT_DEMO_MODE } from "../config/default-settings";

/** Persists across app restarts so device_id does not change if SQLite row is recreated. */
const INSTALL_DEVICE_ID_FILE = "printechs_wms_install_device_id.txt";

const DEV_ID_PATTERN = /^DEV-[A-Z0-9]{4}-[A-Z0-9]{6}$/i;

function formatStableDevIdFromUuidHex(hexNoHyphens: string): string {
  const h = hexNoHyphens.replace(/-/g, "").toUpperCase();
  if (h.length < 10) {
    const pad = `${h}00000000000000000000000000000000`.slice(0, 32);
    return `DEV-${pad.slice(0, 4)}-${pad.slice(-6)}`;
  }
  return `DEV-${h.slice(0, 4)}-${h.slice(-6)}`;
}

function installDeviceIdFile(): File {
  return new File(Paths.document, INSTALL_DEVICE_ID_FILE);
}

async function readInstallDeviceIdFile(): Promise<string | null> {
  try {
    const file = installDeviceIdFile();
    if (!file.exists) return null;
    const txt = (await file.text()).trim();
    if (DEV_ID_PATTERN.test(txt)) return txt.toUpperCase();
  } catch {
    /* ignore */
  }
  return null;
}

async function writeInstallDeviceIdFile(id: string): Promise<void> {
  try {
    const file = installDeviceIdFile();
    if (!file.exists) {
      file.create({ intermediates: true });
    }
    file.write(id);
  } catch {
    /* ignore */
  }
}

/** Prefer on-disk backup (e.g. SQLite row cleared); else new UUID-based DEV id (file written after DB save). */
async function loadOrCreateStableInstallDeviceId(): Promise<string> {
  const fromFile = await readInstallDeviceIdFile();
  if (fromFile) return fromFile;
  return formatStableDevIdFromUuidHex(uuidv4().replace(/-/g, ""));
}

let deviceIdBootstrapPromise: Promise<string> | null = null;

/**
 * When settings have no device_id, assign one stable value, persist to DB (awaited), and
 * dedupe concurrent callers so two parallel getSettings() cannot create two IDs.
 */
async function ensureStableDeviceIdPersisted(): Promise<string> {
  if (!deviceIdBootstrapPromise) {
    deviceIdBootstrapPromise = (async () => {
      try {
        const db = await getDatabase();
        const row = await db.getFirstAsync<Settings>(
          "SELECT device_id FROM settings LIMIT 1"
        );
        const existing = String(row?.device_id ?? "").trim();
        if (existing) return existing;
        const stable = await loadOrCreateStableInstallDeviceId();
        await saveSettings({ device_id: stable });
        await writeInstallDeviceIdFile(stable);
        return stable;
      } finally {
        deviceIdBootstrapPromise = null;
      }
    })();
  }
  return deviceIdBootstrapPromise;
}

// Fallback only for flows that run before a user logs in.
const generateUserId = (): string => {
  const timestamp = Date.now().toString().slice(-6);
  return `USER-${timestamp}`;
};

export const getSettings = async (): Promise<Settings> => {
  // Read operations don't need to be queued (WAL mode allows concurrent reads)
  // But we'll use the queue for consistency and to prevent read-write conflicts
  const db = await getDatabase();
  
  // Wait a moment to ensure database is fully initialized
  await new Promise((resolve) => setTimeout(resolve, 50));
  
  let result = await db.getFirstAsync<Settings>(
    "SELECT * FROM settings LIMIT 1"
  );

  console.log("📥 getSettings: Raw database result:", {
    api_url: result?.api_url || "(null/undefined)",
    device_id: result?.device_id || "(null/undefined)",
    user_id: result?.user_id || "(null/undefined)",
    has_result: !!result,
  });

  if (!result) {
    console.log("ℹ️ No settings found in database, creating default");
    result = { 
      demo_mode: DEFAULT_DEMO_MODE,
      api_url: DEFAULT_API_URL || undefined, // Only set if DEFAULT_API_URL is configured
    };
    // Save default settings if API URL is configured
    if (DEFAULT_API_URL) {
      saveSettings({ 
        api_url: DEFAULT_API_URL,
        demo_mode: DEFAULT_DEMO_MODE,
      }).catch((err) => {
        console.warn("⚠️ Failed to save default API URL:", err);
      });
    }
  } else {
    console.log("✅ Settings retrieved from database successfully");
  }

  // Stable device_id: single-flight + await persist (avoids duplicate DEV rows on server)
  if (!String(result.device_id ?? "").trim()) {
    try {
      result.device_id = await ensureStableDeviceIdPersisted();
    } catch (err) {
      console.warn("⚠️ Failed to assign stable device_id:", err);
    }
  }

  // The backend user master uses the login name, not a separate mobile-generated id.
  // Keep user_id available for older API payloads, but make it the same as user_code.
  const userCode = String(result.user_code ?? "").trim();
  const userId = String(result.user_id ?? "").trim();
  if (userCode && userId !== userCode) {
    result.user_id = userCode;
    saveSettings({ user_id: userCode }).catch((err) => {
      console.warn("⚠️ Failed to align user_id with user_code:", err);
    });
  } else if (!userId) {
    result.user_id = userCode || generateUserId();
    saveSettings({ user_id: result.user_id }).catch((err) => {
      console.warn("⚠️ Failed to save fallback user_id:", err);
    });
  }

  return result;
};

// Guard to prevent concurrent saveSettings calls
let isSavingSettings = false;

// Internal function that actually performs the save operation
// Note: This is called from within runDbWrite, so operations are serialized
const executeSaveSettings = async (settings: Partial<Settings>) => {
  // Additional guard to prevent double-calls
  if (isSavingSettings) {
    console.warn("⚠️ saveSettings already in progress, skipping duplicate call");
    return;
  }

  isSavingSettings = true;
  
  try {
    // CRITICAL: Ensure database is fully initialized before attempting writes
    // This prevents conflicts with migration execAsync calls
    // Wait for initialization to complete with a timeout
    let db: SQLite.SQLiteDatabase | null = null;
    let initAttempts = 0;
    const maxInitAttempts = 10;
    
    while (!db && initAttempts < maxInitAttempts) {
      try {
        db = await getDatabase();
        // Small delay to ensure initialization is truly complete
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (initError: any) {
        initAttempts++;
        if (initAttempts >= maxInitAttempts) {
          throw new Error(`Database initialization timeout after ${maxInitAttempts} attempts: ${initError.message}`);
        }
        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    
    if (!db) {
      throw new Error("Failed to get database instance after initialization");
    }
    
    // Retry logic if database is still locked
    const maxRetries = 5; // Increased retries
    let lastError: any = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
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
        // Handle both null (explicit clear) and undefined (don't change)
        const apiUrlValue =
          settings.api_url !== undefined
            ? settings.api_url === null
              ? null // Explicitly clear
              : settings.api_url && typeof settings.api_url === 'string' && settings.api_url.trim()
              ? settings.api_url.trim()
              : null // Empty string becomes null
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

        const itemMasterSyncModeValue =
          settings.item_master_sync_mode !== undefined
            ? (settings.item_master_sync_mode || "full").toString()
            : (existing as any)?.item_master_sync_mode || "full";

        const rawPage =
          settings.item_master_page_size !== undefined
            ? settings.item_master_page_size
            : (existing as any)?.item_master_page_size;
        let itemMasterPageSizeValue = 5000;
        if (rawPage != null && rawPage !== "") {
          const n = Number(rawPage);
          if (Number.isFinite(n)) {
            itemMasterPageSizeValue = Math.min(20000, Math.max(500, Math.floor(n)));
          }
        }

        const itemMasterWatermarkValue =
          settings.item_master_modified_watermark !== undefined
            ? settings.item_master_modified_watermark || null
            : (existing as any)?.item_master_modified_watermark ?? null;

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

        // Use transaction to ensure atomicity and prevent locking issues
        // Since settings table has no primary key, use DELETE + INSERT to ensure only one row exists
        // This guarantees the settings are saved correctly
        await db.withTransactionAsync(async () => {
          // Delete all existing rows to ensure only one row exists
          await db.runAsync("DELETE FROM settings");
          
          // Insert new row with all fields - this ensures the API URL is always saved
          await db.runAsync(
            "INSERT INTO settings (api_url, device_id, user_id, user_code, password, demo_mode, active_asn, active_session, auth_token, auth_token_expires, item_master_sync_mode, item_master_page_size, item_master_modified_watermark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
              itemMasterSyncModeValue,
              itemMasterPageSizeValue,
              itemMasterWatermarkValue,
            ]
          );
          // Transaction will COMMIT automatically on success
          // ROLLBACK happens automatically on error
        });

        // Verify the save (outside transaction for read consistency)
        // Wait a moment for transaction to fully commit
        await new Promise((resolve) => setTimeout(resolve, 50));
        const verify = await db.getFirstAsync<Settings>(
          "SELECT * FROM settings LIMIT 1"
        );
        console.log("saveSettings - Verified saved values:", {
          api_url: verify?.api_url || "(null)",
          device_id: verify?.device_id || "(null)",
          user_id: verify?.user_id || "(null)",
          demo_mode: verify?.demo_mode,
        });
        
        // Double-check API URL was saved correctly
        if (apiUrlValue !== null && verify?.api_url !== apiUrlValue) {
          console.error("❌ API URL verification failed after save:", {
            expected: apiUrlValue,
            actual: verify?.api_url || "(null)",
          });
          throw new Error(`API URL was not saved correctly. Expected: ${apiUrlValue}, Got: ${verify?.api_url || "(null)"}`);
        }
        
        // Success - exit retry loop
        return;
      } catch (error: any) {
        lastError = error;
        const isLockedError = 
          error?.message?.includes("database is locked") ||
          error?.message?.includes("locked") ||
          error?.code === "SQLITE_BUSY" ||
          error?.code === "SQLITE_LOCKED" ||
          error?.message?.includes("execAsync");
        
        if (isLockedError && attempt < maxRetries - 1) {
          // Exponential backoff: 50ms, 100ms, 200ms
          const delay = 50 * Math.pow(2, attempt);
          console.warn(
            `⚠️ Database locked during saveSettings (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue; // Retry
        } else {
          // Not a locking error, or max retries reached
          throw error;
        }
      }
    }
    
    // If we get here, all retries failed
    throw lastError || new Error("Failed to save settings after retries");
  } finally {
    isSavingSettings = false;
  }
};

// Public API - queues the save operation using the write queue
export const saveSettings = async (settings: Partial<Settings>) => {
  // Use runDbWrite to serialize all write operations
  return runDbWrite(async () => {
    await executeSaveSettings(settings);
  });
};
