import { dataService } from "./data.service";
import { apiService } from "./api.service";

export type ResendReceiveLinesResult = {
  cartonsSent: number;
  linesSent: number;
  /** Session ID sent (parent_title) */
  sessionSent?: string;
  /** Per-item received qty we sent (for confirmation) */
  byItem?: Record<string, number>;
  error?: string;
};

/**
 * Build receive_lines from local DB for all cartons in the session and send to backend.
 * Use when backend did not persist receive data (e.g. Recvd Qty still 0) or user wants to resync.
 * Call from "Sync" or "Resend receive data" button.
 */
export async function resendReceiveLinesToBackend(
  asn_no: string,
  inbound_session: string
): Promise<ResendReceiveLinesResult> {
  const statuses = await dataService.getAllCartonStatuses(asn_no, inbound_session);
  const allReceiveLines: Array<{
    parent_title: string;
    carton_id: string;
    item_code: string;
    expected_qty: number;
    received_qty: number;
    condition: "Good";
    remarks: null;
  }> = [];

  for (const status of statuses) {
    const cartonId = status.carton_id;
    const scannedItems = await dataService.getScannedItems(
      asn_no,
      inbound_session,
      cartonId
    );
    const cartonItems = await dataService.getCartonItems(asn_no, cartonId);
    if (cartonItems.length === 0) continue;

    const expectedQtyByItem = new Map<string, number>();
    for (const ci of cartonItems) {
      expectedQtyByItem.set(ci.item_code, ci.shipped_qty || 0);
    }

    const receivedQtyByItem = new Map<string, number>();
    for (const row of scannedItems as Array<{ item_code: string; scanned_qty?: number }>) {
      const itemCode = row.item_code;
      const qty = Number(row.scanned_qty || 0);
      if (!itemCode) continue;
      receivedQtyByItem.set(
        itemCode,
        (receivedQtyByItem.get(itemCode) ?? 0) + qty
      );
    }

    // Send one line per carton item (full state). Ensures items like 108228/108230
    // are never missing; backend must UPSERT by (session, carton_id, item_code) to avoid duplicates.
    for (const ci of cartonItems) {
      const itemCode = ci.item_code;
      if (!itemCode) continue;
      const expectedQty = expectedQtyByItem.get(itemCode) ?? 0;
      const receivedQty = receivedQtyByItem.get(itemCode) ?? 0;
      allReceiveLines.push({
        parent_title: inbound_session,
        carton_id: cartonId,
        item_code: itemCode,
        expected_qty: expectedQty,
        received_qty: receivedQty,
        condition: "Good",
        remarks: null,
      });
    }
  }

  if (allReceiveLines.length === 0) {
    return { cartonsSent: 0, linesSent: 0, sessionSent: inbound_session };
  }

  const cartonsSent = new Set(allReceiveLines.map((l) => l.carton_id)).size;
  const byItem: Record<string, number> = {};
  for (const l of allReceiveLines) {
    byItem[l.item_code] = (byItem[l.item_code] ?? 0) + l.received_qty;
  }

  await apiService.createReceiveLines({
    parent_title: inbound_session,
    receive_lines: allReceiveLines.map((l) => ({
      carton_id: l.carton_id,
      item_code: l.item_code,
      expected_qty: l.expected_qty,
      received_qty: l.received_qty,
      condition: l.condition,
      remarks: l.remarks,
    })),
  });

  return { cartonsSent, linesSent: allReceiveLines.length, sessionSent: inbound_session, byItem };
}
