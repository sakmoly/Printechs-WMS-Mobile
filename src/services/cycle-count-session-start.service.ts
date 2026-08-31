import { Alert } from "react-native";
import { getDatabase } from "../database/database";
import { generateUUID } from "../utils/uuid";
import { apiService } from "./api.service";
import { getSettings } from "./settings.service";
import { isDeviceOnline } from "../utils/network-check";
import type { CycleCountMode } from "./cycle-count-erp.service";

export type CycleCountBinInfo = {
  bin_id: string;
  bin_code: string;
  bin_barcode?: string;
  warehouse_id?: string;
  zone?: string | null;
  aisle?: string | null;
  rack?: string | null;
  level?: string | null;
  is_active?: number;
  updated_on?: string;
};

export type StartCycleCountSessionInput = {
  binInfo: CycleCountBinInfo;
  countType: string;
  countMode: CycleCountMode;
  isBlindCount: boolean;
  preCreatedSessionId?: string | null;
  preCreatedTaskTitle?: string | null;
  /** When true, always create a new session instead of reusing an existing Draft for the bin. */
  forceNewSession?: boolean;
};

export type StartCycleCountSessionResult = {
  sessionId: string;
  taskTitle: string | null;
  binInfo: CycleCountBinInfo;
};

export async function validateCycleCountBin(
  bin: string,
  scanOnline: boolean
): Promise<CycleCountBinInfo | null> {
  if (!bin?.trim()) return null;

  const normalized = bin.trim().toUpperCase();
  const db = await getDatabase();

  let binData = await db.getFirstAsync<any>(
    "SELECT * FROM bin_master_cache WHERE bin_code = ? OR bin_barcode = ? OR bin_id = ?",
    [normalized, normalized, normalized]
  );

  if (!binData && scanOnline) {
    try {
      const online = await isDeviceOnline();
      if (online) {
        const response = await apiService.getBinMaster(normalized);
        const backendBin = response?.data || response?.bin || response;
        const resolvedBinCode =
          backendBin?.bin_code ||
          backendBin?.location_id ||
          backendBin?.bin_id ||
          backendBin?.name ||
          normalized;
        const resolvedBinId =
          backendBin?.bin_id || backendBin?.location_id || resolvedBinCode;

        if (resolvedBinCode && resolvedBinId) {
          binData = {
            bin_id: resolvedBinId,
            bin_code: resolvedBinCode,
            bin_barcode:
              backendBin?.bin_barcode || backendBin?.barcode || resolvedBinCode,
            warehouse_id: backendBin?.warehouse_id || backendBin?.warehouse || "",
            zone: backendBin?.zone || null,
            aisle: backendBin?.aisle || null,
            rack: backendBin?.rack || null,
            level: backendBin?.level || null,
            is_active: backendBin?.is_active === false ? 0 : 1,
            updated_on:
              backendBin?.updated_on ||
              backendBin?.modified ||
              new Date().toISOString(),
          };

          await db.runAsync(
            `INSERT OR REPLACE INTO bin_master_cache (
              bin_id, bin_code, bin_barcode, warehouse_id, zone, aisle, rack, level, is_active, updated_on
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              binData.bin_id,
              binData.bin_code,
              binData.bin_barcode,
              binData.warehouse_id,
              binData.zone,
              binData.aisle,
              binData.rack,
              binData.level,
              binData.is_active,
              binData.updated_on,
            ]
          );
        }
      }
    } catch (backendError: any) {
      console.warn(`Backend bin lookup failed for ${normalized}:`, backendError.message);
    }
  }

  if (!binData) {
    const totalBins = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM bin_master_cache"
    );
    const sampleBins = await db.getAllAsync<{ bin_code: string }>(
      "SELECT bin_code FROM bin_master_cache LIMIT 5"
    );
    const sampleList = sampleBins.map((b) => b.bin_code).join(", ");

    Alert.alert(
      "Bin Not Found",
      `Bin "${normalized}" not found in ${scanOnline ? "local database or backend" : "local database"}.\n\n` +
        `Total bins in database: ${totalBins?.count || 0}\n` +
        (sampleList ? `Sample bins: ${sampleList}` : "") +
        (scanOnline
          ? `\n\nPlease verify the bin code or backend connection.`
          : `\n\nPlease sync bin master data or enable Scan Online on the setup screen.`)
    );
    return null;
  }

  return {
    bin_id: binData.bin_id || binData.bin_code,
    bin_code: binData.bin_code || binData.bin_id || normalized,
    bin_barcode: binData.bin_barcode,
    warehouse_id: binData.warehouse_id,
    zone: binData.zone,
    aisle: binData.aisle,
    rack: binData.rack,
    level: binData.level,
    is_active: binData.is_active,
    updated_on: binData.updated_on,
  };
}

export async function startCycleCountSession(
  input: StartCycleCountSessionInput
): Promise<StartCycleCountSessionResult> {
  const {
    binInfo,
    countType,
    countMode,
    isBlindCount,
    preCreatedSessionId,
    preCreatedTaskTitle,
    forceNewSession = false,
  } = input;

  const settings = await getSettings();
  const db = await getDatabase();
  const now = new Date().toISOString();

  let sessionId: string | undefined;

  if (preCreatedSessionId) {
    const preCreatedSession = await db.getFirstAsync<{ session_id: string }>(
      "SELECT session_id FROM cycle_count_sessions WHERE session_id = ?",
      [preCreatedSessionId]
    );
    if (preCreatedSession) {
      sessionId = preCreatedSessionId;
      await db.runAsync(
        "UPDATE cycle_count_sessions SET bin_code = ?, bin_id = ?, count_mode = ?, is_blind_count = ?, updated_at = ? WHERE session_id = ?",
        [
          binInfo.bin_code,
          binInfo.bin_id || binInfo.bin_code,
          countMode,
          isBlindCount ? 1 : 0,
          now,
          sessionId,
        ]
      );
    }
  }

  if (!sessionId && !forceNewSession) {
    const existingSession = await db.getFirstAsync<{ session_id: string }>(
      `SELECT session_id FROM cycle_count_sessions
       WHERE bin_code = ? AND status = 'Draft'
       ORDER BY updated_at DESC LIMIT 1`,
      [binInfo.bin_code]
    );

    if (existingSession) {
      sessionId = existingSession.session_id;
      await db.runAsync(
        "UPDATE cycle_count_sessions SET count_mode = ?, is_blind_count = ?, updated_at = ? WHERE session_id = ?",
        [countMode, isBlindCount ? 1 : 0, now, sessionId]
      );
    }
  }

  if (!sessionId) {
    sessionId = generateUUID();
    const serverSessionId = preCreatedTaskTitle || null;

    await db.runAsync(
      `INSERT INTO cycle_count_sessions (
        session_id, count_type, count_mode, warehouse_id, bin_id, bin_code,
        started_by, started_at, status, is_blind_count, device_id, synced,
        server_session_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        countType,
        countMode,
        binInfo.warehouse_id || "",
        binInfo.bin_id || "",
        binInfo.bin_code,
        settings.user_id || settings.user_code || "USER-AUTO",
        now,
        "Draft",
        isBlindCount ? 1 : 0,
        settings.device_id || "",
        0,
        serverSessionId,
        now,
        now,
      ]
    );
  }

  const sessionData = await db.getFirstAsync<{ server_session_id: string | null }>(
    "SELECT server_session_id FROM cycle_count_sessions WHERE session_id = ?",
    [sessionId]
  );
  const taskTitle = sessionData?.server_session_id?.trim() || null;

  return {
    sessionId,
    taskTitle,
    binInfo,
  };
}
