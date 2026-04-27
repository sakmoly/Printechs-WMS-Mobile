import { apiService } from "../services/api.service";

export type AsnCartonUnloadGate = {
  /** True if ASN payload shows this carton is past dock unload (unloaded / receiving / received). */
  blocked: boolean;
  serverStatus?: string;
  locked_by?: string | null;
};

const LINE_ARRAY_KEYS = [
  "lines",
  "unload_lines",
  "unloadLines",
  "results",
  "rows",
  "items",
] as const;

function pushLineArraysFromObject(
  target: unknown[][],
  obj: Record<string, unknown> | null | undefined
) {
  if (!obj || typeof obj !== "object") return;
  for (const k of LINE_ARRAY_KEYS) {
    const v = obj[k];
    if (Array.isArray(v)) target.push(v);
  }
}

/**
 * Normalize GET /api/inbound/unload-lines response bodies.
 * Merges every array slot (root + data.*) and dedupes by unit_id / carton_id — earliest scanned_on wins
 * so duplicate keys in the same JSON do not hide rows from other cartons.
 */
export function parseUnloadLinesResponse(resp: unknown): any[] {
  if (Array.isArray(resp)) return resp;
  const o = resp as Record<string, unknown>;
  if (!o || typeof o !== "object") return [];

  const arrays: unknown[][] = [];
  pushLineArraysFromObject(arrays, o);

  const data = o.data;
  if (Array.isArray(data)) {
    arrays.push(data);
  } else if (data && typeof data === "object") {
    pushLineArraysFromObject(arrays, data as Record<string, unknown>);
  }

  const byUnit = new Map<string, Record<string, unknown>>();
  for (const arr of arrays) {
    for (const raw of arr) {
      if (!raw || typeof raw !== "object") continue;
      const line = raw as Record<string, unknown>;
      const unit = String(
        line.unit_id ?? line.carton_id ?? line.unitId ?? ""
      )
        .trim()
        .toUpperCase();
      if (!unit) continue;

      const prev = byUnit.get(unit);
      if (!prev) {
        byUnit.set(unit, line);
        continue;
      }
      const tNew = Date.parse(
        String(line.scanned_on ?? line.created_at ?? line.updated_at ?? "")
      );
      const tOld = Date.parse(
        String(prev.scanned_on ?? prev.created_at ?? prev.updated_at ?? "")
      );
      const preferNew =
        Number.isFinite(tNew) &&
        (!Number.isFinite(tOld) || tNew < tOld);
      if (preferNew) {
        byUnit.set(unit, line);
      }
    }
  }
  return Array.from(byUnit.values());
}

/**
 * Returns whether this inbound session already has an unload line for the carton on the server
 * (e.g. another handset posted unload first). Uses GET /api/inbound/unload-lines.
 */
export async function getServerUnloadLineForCarton(
  parentTitle: string,
  cartonId: string
): Promise<{ line: any | null }> {
  const unloadLinesResp = await apiService.getUnloadLines(parentTitle);
  const linesList = parseUnloadLinesResponse(unloadLinesResp);
  const id = String(cartonId || "").trim().toUpperCase();
  const line =
    linesList.find(
      (l: any) =>
        String(l.unit_id || l.carton_id || "").trim().toUpperCase() === id
    ) ?? null;
  return { line };
}

function pickCartonIdRow(row: Record<string, unknown>): string {
  return String(row.carton_id ?? row.cartonId ?? "").trim().toUpperCase();
}

function pickCartonStatusRow(row: Record<string, unknown>): string {
  return String(
    row.carton_status ?? row.status ?? row.receiving_status ?? ""
  ).trim();
}

function pickLockedByRow(row: Record<string, unknown>): string {
  const v =
    row.locked_by ??
    row.lockedBy ??
    row.unloaded_by ??
    row.unloadedBy ??
    row.scanned_by ??
    row.scannedBy ??
    row.lock_user ??
    row.user_code ??
    row.userCode ??
    row.user_name ??
    row.userName ??
    "";
  if (v == null || v === undefined) return "";
  return String(v).trim();
}

/**
 * Parses GET /api/asn/:asn — if this carton is already Unloaded / Receiving / Received on the server,
 * a second device must not dock-unload again.
 */
export function parseAsnPayloadForUnloadAlreadyDone(
  asnRes: unknown,
  cartonIdUpper: string
): AsnCartonUnloadGate {
  if (!asnRes || typeof asnRes !== "object") return { blocked: false };
  const root = asnRes as Record<string, unknown>;
  const data = (root.data as Record<string, unknown>) || {};
  const detailsList = (root.details ?? data.details ?? []) as unknown[];
  const cartonsList = (root.cartons ?? data.cartons ?? []) as unknown[];
  const want = String(cartonIdUpper || "").trim().toUpperCase();
  if (!want) return { blocked: false };

  const scan = (list: unknown[]): AsnCartonUnloadGate | null => {
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      if (pickCartonIdRow(row) !== want) continue;
      const st = pickCartonStatusRow(row);
      const sl = st.toLowerCase();
      const lockedBy = pickLockedByRow(row) || null;
      if (sl === "pending" || sl === "") return { blocked: false, serverStatus: st };
      if (sl === "unloaded" || sl === "received")
        return { blocked: true, serverStatus: st, locked_by: lockedBy };
      if (
        sl === "receiving" ||
        sl === "in receiving" ||
        sl === "locked" ||
        sl.includes("receiving")
      ) {
        return { blocked: true, serverStatus: st, locked_by: lockedBy };
      }
      return { blocked: false, serverStatus: st };
    }
    return null;
  };

  const a = scan(Array.isArray(cartonsList) ? cartonsList : []);
  if (a) return a;
  const b = scan(Array.isArray(detailsList) ? detailsList : []);
  return b ?? { blocked: false };
}

export async function fetchBackendCartonUnloadBlockedFromASN(
  asnNo: string,
  cartonIdUpper: string
): Promise<AsnCartonUnloadGate> {
  try {
    const asnRes = await apiService.getASN(asnNo.trim());
    return parseAsnPayloadForUnloadAlreadyDone(asnRes, cartonIdUpper);
  } catch {
    return { blocked: false };
  }
}

/** POST /api/inbound/unload-line rejected because the line already exists (another device won the race). */
export function isDuplicateUnloadLinePostError(e: unknown): boolean {
  const code = String((e as any)?.code ?? "").toUpperCase();
  if (code === "DUPLICATE_UNLOAD") return true;
  if ((e as any)?.data?.duplicate === true || (e as any)?.errorJson?.duplicate === true)
    return true;
  const m = String((e as any)?.message ?? (e as any)?.error ?? "").toLowerCase();
  return (
    m.includes("duplicate_unload") ||
    m.includes("409") ||
    m.includes("conflict") ||
    m.includes("duplicate") ||
    m.includes("already been") ||
    m.includes("already exists") ||
    m.includes("already unloaded") ||
    m.includes("unique constraint") ||
    m.includes("not unique") ||
    m.includes("23505") ||
    m.includes("errno 19") ||
    m.includes("sqlite_constraint")
  );
}
