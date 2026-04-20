/**
 * Automated test: verifies the local DB/event path for sorting one unit into a Putaway box (PAW-*).
 * Run from Home (demo mode) when you have an active ASN + inbound session from a real inbound flow.
 * Does not replace physical scanning in Receive + Sort — it proves the DB layer accepts putaway scans.
 */

import { getDatabase } from "../database/database";
import { dataService } from "../services/data.service";
import { addEvent } from "../services/event-queue.service";
import { getSettings } from "../services/settings.service";
import { normalizeASN } from "./asn";

export type PutawayScanTestProgress = {
  step: string;
  status: "completed" | "failed";
  message: string;
};

export async function runPutawayBoxScanAutomatedTest(): Promise<
  PutawayScanTestProgress[]
> {
  const progress: PutawayScanTestProgress[] = [];

  const log = (
    step: string,
    status: PutawayScanTestProgress["status"],
    message: string
  ) => {
    progress.push({ step, status, message });
    console.log(`🧪 [PutawayScanTest/${step}] ${status}: ${message}`);
  };

  try {
    const settings = await getSettings();
    const asnRaw = settings.active_asn?.trim();
    const session = settings.active_session?.trim();

    if (!asnRaw || !session) {
      log(
        "preflight",
        "failed",
        "No active ASN or inbound session in settings. Start inbound (unload cartons), then open Home again."
      );
      return progress;
    }

    const normalizedASN = normalizeASN(asnRaw);
    const db = await getDatabase();

    /** Match ReceiveSort fallback when no WH-* row exists */
    let warehouseStore = "WAREHOUSE";
    try {
      const whRows = await db.getAllAsync<{ code: string }>(
        `SELECT code FROM warehouse_store_cache WHERE code IS NOT NULL AND TRIM(code) != '' ORDER BY code LIMIT 5`
      );
      const whLike = whRows.find(
        (r) =>
          String(r.code).toUpperCase().startsWith("WH-") ||
          String(r.code).toUpperCase() === "WAREHOUSE"
      );
      if (whLike?.code) warehouseStore = whLike.code;
    } catch {
      /* ignore */
    }

    let cartonId: string | null = null;
    try {
      const cartonRow = await db.getFirstAsync<{ carton_id: string }>(
        `SELECT carton_id FROM carton_status_cache 
         WHERE (asn_no = ? OR asn_no = ?) AND inbound_session = ?
         ORDER BY carton_id LIMIT 1`,
        [asnRaw, normalizedASN, session]
      );
      cartonId = cartonRow?.carton_id ?? null;
    } catch {
      cartonId = null;
    }

    if (!cartonId) {
      try {
        const cartons = await dataService.getASNCartons(normalizedASN);
        cartonId = cartons[0] ?? null;
      } catch {
        cartonId = null;
      }
    }

    if (!cartonId) {
      log(
        "carton",
        "failed",
        "No carton found for this ASN/session. Complete unload (or ensure carton_status_cache has rows)."
      );
      return progress;
    }
    log("carton", "completed", `Using carton ${cartonId}`);

    let itemCode: string | null = null;
    const itemFromCarton = await db.getFirstAsync<{ item_code: string }>(
      `SELECT item_code FROM asn_carton_map 
       WHERE (asn_no = ? OR asn_no = ?) AND carton_id = ?
       LIMIT 1`,
      [asnRaw, normalizedASN, cartonId]
    );
    itemCode = itemFromCarton?.item_code ?? null;

    if (!itemCode) {
      const anyItem = await db.getFirstAsync<{ item_code: string }>(
        `SELECT item_code FROM asn_carton_map 
         WHERE (asn_no = ? OR asn_no = ?)
         LIMIT 1`,
        [asnRaw, normalizedASN]
      );
      itemCode = anyItem?.item_code ?? null;
    }

    if (!itemCode) {
      log(
        "item",
        "failed",
        "No rows in asn_carton_map for this ASN. Sync ASN data / master data first."
      );
      return progress;
    }
    log("item", "completed", `Using item_code ${itemCode}`);

    const ts = Date.now();
    /** Prefix avoids mixing with real putaway boxes; delete from Box Management after testing */
    const pawId = `PAW-TEST-${normalizedASN.replace(/[^A-Z0-9]/gi, "")}-${ts}`;

    await dataService.saveBox({
      box_id: pawId,
      asn_no: normalizedASN,
      to_no: "Putaway",
      store: warehouseStore,
      status: "Open",
      purpose: "PUTAWAY",
      updated_on: new Date().toISOString(),
    });
    log(
      "box_cache",
      "completed",
      `Saved putaway box ${pawId} (store=${warehouseStore}, purpose=PUTAWAY)`
    );

    const deviceId = settings.device_id ?? "";
    const userId = settings.user_id ?? "";

    await addEvent({
      event_type: "RECEIVE_ITEM_SCAN",
      asn_no: normalizedASN,
      inbound_session: session,
      carton_id: cartonId,
      item_code: itemCode,
      device_id: deviceId,
      user_id: userId,
    });

    await addEvent({
      event_type: "SORT_TO_BOX",
      asn_no: normalizedASN,
      inbound_session: session,
      carton_id: cartonId,
      item_code: itemCode,
      box_id: pawId,
      store: warehouseStore,
      device_id: deviceId,
      user_id: userId,
    });
    log("events", "completed", "Queued RECEIVE_ITEM_SCAN + SORT_TO_BOX in event_queue");

    const scannedOn = new Date().toISOString();
    await db.runAsync(
      `INSERT OR REPLACE INTO scanned_items (
         asn_no, inbound_session, carton_id, item_code, box_id, store,
         scanned_qty, scanned_on, device_id, user_id
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        normalizedASN,
        session,
        cartonId,
        itemCode,
        pawId,
        warehouseStore,
        scannedOn,
        deviceId,
        userId,
      ]
    );

    const verify = await db.getFirstAsync<{ n: number; qty: number }>(
      `SELECT COUNT(*) as n, COALESCE(SUM(scanned_qty),0) as qty 
       FROM scanned_items WHERE box_id = ? AND item_code = ?`,
      [pawId, itemCode]
    );

    if (!verify || verify.n < 1) {
      log(
        "verify",
        "failed",
        "scanned_items insert did not persist (COUNT=0). Check DB / constraints."
      );
      return progress;
    }

    log(
      "verify",
      "completed",
      `OK: scanned_items rows=${verify.n}, qty_sum=${verify.qty} for ${pawId}. Local putaway pipeline accepts data.`
    );

    log(
      "hint",
      "completed",
      "This used a disposable PAW-TEST-* box (not a user putaway box). Delete it in Box Management if you do not need it. For live scans: Receive + Sort → warehouse/putaway or scan your real PAW-* barcode."
    );

    return progress;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log("error", "failed", msg);
    return progress;
  }
}
