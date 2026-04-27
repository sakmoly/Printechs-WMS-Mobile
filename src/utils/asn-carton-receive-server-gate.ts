import { apiService } from "../services/api.service";

function pickCartonId(row: Record<string, unknown>): string {
  return String(row.carton_id ?? row.cartonId ?? "").trim().toUpperCase();
}

function pickLineStatus(row: Record<string, unknown>): string {
  return String(
    row.carton_status ??
      row.receiving_status ??
      row.status ??
      row.line_status ??
      ""
  ).trim();
}

function looksReceivedStatus(st: string): boolean {
  const s = st.toLowerCase();
  return (
    /\breceived\b/i.test(st) ||
    s === "complete" ||
    (s.includes("complete") && !s.includes("incomplete"))
  );
}

function shippedReceivedPair(row: Record<string, unknown>): {
  ship: number;
  rec: number;
} {
  const ship = Number(
    row.shipped_qty ??
      row.expected_qty ??
      row.ship_qty ??
      row.asn_qty ??
      row.qty ??
      0
  );
  const rec = Number(
    row.received_qty ??
      row.recvd_qty ??
      row.recv_qty ??
      row.received ??
      row.receivedQty ??
      0
  );
  return {
    ship: Number.isFinite(ship) ? ship : 0,
    rec: Number.isFinite(rec) ? rec : 0,
  };
}

export type ReceiveSortServerBlock = {
  blocked: boolean;
  reason?: string;
  serverStatus?: string;
};

/**
 * True when this carton must not start Receive+Sort on this handset: server shows
 * Received / complete, or every ASN line for the carton has received_qty >= shipped_qty.
 */
export function parseAsnPayloadForReceiveSortServerBlock(
  asnRes: unknown,
  cartonIdUpper: string
): ReceiveSortServerBlock {
  if (!asnRes || typeof asnRes !== "object") {
    return { blocked: false };
  }
  const want = String(cartonIdUpper || "").trim().toUpperCase();
  if (!want) return { blocked: false };

  const root = asnRes as Record<string, unknown>;
  const data = (root.data as Record<string, unknown>) || {};
  const detailsList = (root.details ?? data.details ?? []) as unknown[];
  const cartonsList = (root.cartons ?? data.cartons ?? []) as unknown[];

  for (const raw of Array.isArray(cartonsList) ? cartonsList : []) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (pickCartonId(row) !== want) continue;
    const st = pickLineStatus(row);
    if (looksReceivedStatus(st)) {
      return {
        blocked: true,
        serverStatus: st,
        reason:
          "Server reports this supplier carton as already received or completed.",
      };
    }
  }

  const linesForCarton: { ship: number; rec: number; st: string }[] = [];
  for (const raw of Array.isArray(detailsList) ? detailsList : []) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (pickCartonId(row) !== want) continue;
    const st = pickLineStatus(row);
    if (looksReceivedStatus(st)) {
      return {
        blocked: true,
        serverStatus: st,
        reason:
          "Server line status shows this carton as already received or completed.",
      };
    }
    const { ship, rec } = shippedReceivedPair(row);
    if (ship > 0) {
      linesForCarton.push({ ship, rec, st });
    }
  }

  if (linesForCarton.length > 0) {
    const allFullyReceived = linesForCarton.every(
      (l) => l.rec >= l.ship && l.ship > 0
    );
    if (allFullyReceived) {
      return {
        blocked: true,
        serverStatus: "qty_complete",
        reason:
          "Server shows received quantity meets or exceeds shipped quantity for every line on this carton (work may have finished on another device or desktop).",
      };
    }
  }

  return { blocked: false };
}

export async function fetchBackendReceiveSortBlockedFromASN(
  asnNo: string,
  cartonId: string
): Promise<ReceiveSortServerBlock> {
  const asnRes = await apiService.getASN(asnNo.trim());
  return parseAsnPayloadForReceiveSortServerBlock(
    asnRes,
    cartonId.trim().toUpperCase()
  );
}
