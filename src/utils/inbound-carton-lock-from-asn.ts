import { apiService } from "../services/api.service";

export type BackendCartonLockInfo = {
  locked: boolean;
  locked_by?: string | null;
  device_id?: string | null;
  status?: string;
};

function pickCartonId(row: Record<string, unknown>): string {
  return String(row.carton_id ?? row.cartonId ?? "").trim().toUpperCase();
}

function pickStatus(row: Record<string, unknown>): string {
  return String(
    row.carton_status ?? row.status ?? row.receiving_status ?? ""
  ).trim();
}

function pickLockedBy(row: Record<string, unknown>): string {
  const v =
    row.locked_by ??
    row.lockedBy ??
    row.lock_user ??
    row.locking_user ??
    row.user_id ??
    row.scanned_by;
  if (v == null || v === undefined) return "";
  return String(v).trim();
}

function pickLockDeviceId(row: Record<string, unknown>): string {
  const v =
    row.locked_device_id ??
    row.locking_device_id ??
    row.lock_device_id ??
    row.device_id ??
    row.scanned_by_device ??
    row.mobile_device_id;
  if (v == null || v === undefined) return "";
  return String(v).trim();
}

export function rowLooksReceiving(statusRaw: string): boolean {
  const s = statusRaw.toLowerCase();
  return (
    s === "receiving" ||
    s === "in receiving" ||
    s === "locked" ||
    s.includes("receiving")
  );
}

/**
 * Reads GET /api/asn/:asn payload (cartons + details) for this carton's server-side lock.
 * Returns null if the carton is not listed or the response cannot be interpreted.
 */
export function parseAsnPayloadForCartonLock(
  asnRes: unknown,
  cartonIdUpper: string
): BackendCartonLockInfo | null {
  if (!asnRes || typeof asnRes !== "object") return null;
  const root = asnRes as Record<string, unknown>;
  const data = (root.data as Record<string, unknown>) || {};
  const detailsList = (root.details ?? data.details ?? []) as unknown[];
  const cartonsList = (root.cartons ?? data.cartons ?? []) as unknown[];
  const want = String(cartonIdUpper || "").trim().toUpperCase();
  if (!want) return null;

  const scanList = (list: unknown[]) => {
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      if (pickCartonId(row) !== want) continue;
      const st = pickStatus(row);
      const lockedBy = pickLockedBy(row);
      const deviceId = pickLockDeviceId(row);
      if (rowLooksReceiving(st)) {
        if (lockedBy || deviceId) {
          return {
            locked: true,
            locked_by: lockedBy || null,
            device_id: deviceId || null,
            status: st,
          };
        }
        return {
          locked: true,
          locked_by: null,
          device_id: null,
          status: st,
        };
      }
      return { locked: false, locked_by: null, device_id: null, status: st };
    }
    return null;
  };

  const fromCartons = scanList(Array.isArray(cartonsList) ? cartonsList : []);
  if (fromCartons) return fromCartons;
  const fromDetails = scanList(Array.isArray(detailsList) ? detailsList : []);
  return fromDetails;
}

export async function fetchBackendCartonLockFromASN(
  asnNo: string,
  cartonIdUpper: string
): Promise<BackendCartonLockInfo | null> {
  const asnRes = await apiService.getASN(asnNo.trim());
  return parseAsnPayloadForCartonLock(asnRes, cartonIdUpper);
}

/** True when another user/device holds the lock (not this handset). */
export function isOtherScannerLock(
  info: BackendCartonLockInfo,
  currentUserId: string,
  currentDeviceId: string
): boolean {
  if (!info.locked) return false;
  const u = String(currentUserId || "").trim();
  const d = String(currentDeviceId || "").trim();
  const bu = String(info.locked_by || "").trim();
  const bd = String(info.device_id || "").trim();
  if (!bu && !bd) return false;
  const userSame = bu && u && bu.toUpperCase() === u.toUpperCase();
  const devSame = bd && d && bd.toUpperCase() === d.toUpperCase();
  if (bd && bu) return !(userSame && devSame);
  if (bd) return !devSame;
  if (bu) return !userSame;
  return false;
}
