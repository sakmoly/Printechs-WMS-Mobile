import { apiService } from "../services/api.service";
import { dataService } from "../services/data.service";
import {
  isLikelyNetworkConnectionFailure,
  SERVER_CONNECTION_LOST_MESSAGE,
} from "./server-connection";
import { rowLooksReceiving } from "./inbound-carton-lock-from-asn";

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
    row.user_id;
  if (v == null || v === undefined) return "";
  return String(v).trim();
}

function pickLockedOn(row: Record<string, unknown>): string | null {
  const v =
    row.locked_on ??
    row.lockedOn ??
    row.lock_time ??
    row.receiving_started_on;
  if (v == null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** ERP / WMS "Opened By" on ASN item lines — per-carton dock actor. */
function pickUnloadedActorFromAsnRow(row: Record<string, unknown>): string {
  const v =
    row.opened_by ??
    row.openedBy ??
    row.unloaded_by ??
    row.unloadedBy ??
    row.scanned_by ??
    row.scannedBy ??
    row.user_name ??
    row.userName ??
    row.user_code ??
    row.userCode ??
    row.user_id ??
    row.userId ??
    "";
  return String(v).trim();
}

/**
 * Merge cartons + details rows; later lists override earlier (details win over cartons).
 */
export function collectCartonRowsFromAsnPayload(
  asnRes: unknown
): Map<
  string,
  {
    statusRaw: string;
    locked_by: string;
    locked_on: string | null;
    unloaded_actor: string;
  }
> {
  const map = new Map<
    string,
    {
      statusRaw: string;
      locked_by: string;
      locked_on: string | null;
      unloaded_actor: string;
    }
  >();
  if (!asnRes || typeof asnRes !== "object") return map;

  const root = asnRes as Record<string, unknown>;
  const data = (root.data as Record<string, unknown>) || {};
  const detailsList = (root.details ?? data.details ?? []) as unknown[];
  const cartonsList = (root.cartons ?? data.cartons ?? []) as unknown[];

  const absorb = (list: unknown[]) => {
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const id = pickCartonId(row);
      if (!id) continue;
      map.set(id, {
        statusRaw: pickStatus(row),
        locked_by: pickLockedBy(row),
        locked_on: pickLockedOn(row),
        unloaded_actor: pickUnloadedActorFromAsnRow(row),
      });
    }
  };

  absorb(Array.isArray(cartonsList) ? cartonsList : []);
  absorb(Array.isArray(detailsList) ? detailsList : []);
  return map;
}

function mapRowToCacheUpdate(row: {
  statusRaw: string;
  locked_by: string;
  locked_on: string | null;
  unloaded_actor: string;
}): {
  status: string;
  locked_by: string | null;
  locked_on: string | null;
  unloaded_by?: string;
} {
  const st = row.statusRaw;
  const lower = st.toLowerCase();
  const receiving = rowLooksReceiving(st);

  const looksReceived =
    /\breceived\b/i.test(st) ||
    (/\bcomplete/i.test(st) && !/\bincomplete\b/i.test(st));
  if (looksReceived) {
    return {
      status: "Received",
      locked_by: null,
      locked_on: null,
    };
  }
  if (receiving) {
    return {
      status: "Receiving",
      locked_by: row.locked_by || null,
      locked_on: row.locked_on,
    };
  }
  if (lower.includes("unload")) {
    const who = String(row.unloaded_actor || "").trim();
    return {
      status: "Unloaded",
      locked_by: null,
      locked_on: null,
      ...(who ? { unloaded_by: who } : {}),
    };
  }
  if (lower === "pending" || lower.includes("pending")) {
    return {
      status: "Pending",
      locked_by: null,
      locked_on: null,
    };
  }
  if (st) {
    const norm = st === "In Receiving" ? "Receiving" : st;
    return {
      status: norm,
      locked_by: null,
      locked_on: null,
    };
  }
  return {
    status: "Pending",
    locked_by: null,
    locked_on: null,
  };
}

export type ReconcileCartonStatusesResult =
  | { ok: true; updated: number }
  | { ok: false; networkError: boolean; message: string };

/**
 * GET /api/asn/:asn then upsert matching rows into local carton_status_cache so all
 * devices show the same Receiving / locked_by as the server.
 */
export async function reconcileCartonStatusesFromBackendAsn(options: {
  asnNoOriginal: string;
  inboundSession: string;
  cartonIds: Set<string>;
}): Promise<ReconcileCartonStatusesResult> {
  let asnRes: unknown;
  try {
    asnRes = await apiService.getASN(options.asnNoOriginal.trim());
  } catch (e: unknown) {
    if (isLikelyNetworkConnectionFailure(e)) {
      return {
        ok: false,
        networkError: true,
        message: SERVER_CONNECTION_LOST_MESSAGE,
      };
    }
    return {
      ok: false,
      networkError: false,
      message: String((e as Error)?.message || e || "Failed to load ASN from server"),
    };
  }

  const byCarton = collectCartonRowsFromAsnPayload(asnRes);
  const asnForDb = options.asnNoOriginal;
  let updated = 0;

  for (const cid of options.cartonIds) {
    const key = String(cid || "").trim().toUpperCase();
    if (!key) continue;
    const row = byCarton.get(key);
    if (!row) continue;
    // Do not treat missing/blank ASN line status as authoritative (would map to Pending).
    if (!String(row.statusRaw || "").trim()) continue;

    const existing = await dataService.getCartonStatus(
      asnForDb,
      options.inboundSession,
      key
    );
    const u = mapRowToCacheUpdate(row);

    // GET /api/asn often lags dock unload: local row is already Unloaded/Received but ERP
    // details still show Pending. Never downgrade from dock-completed states on stale ASN.
    if (existing) {
      const ex = String(existing.status || "").toLowerCase();
      if (
        (ex === "unloaded" || ex === "received") &&
        u.status === "Pending"
      ) {
        continue;
      }
    }

    await dataService.updateCartonStatus({
      asn_no: asnForDb,
      inbound_session: options.inboundSession,
      carton_id: key,
      status: u.status as "Pending" | "Unloaded" | "Receiving" | "Received",
      locked_by: u.locked_by ? u.locked_by : "",
      locked_on: u.locked_on ?? "",
      ...(u.unloaded_by ? { unloaded_by: u.unloaded_by } : {}),
      updated_on: new Date().toISOString(),
    });
    updated += 1;
  }

  return { ok: true, updated };
}
