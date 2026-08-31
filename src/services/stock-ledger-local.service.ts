import { getDatabase } from "../database/database";
import { apiService } from "./api.service";
import { isDeviceOnline } from "../utils/network-check";

export type StockLedgerKey = {
  warehouse: string;
  item_code: string;
  bin_location: string;
  carton_id?: string | null;
};

export type CycleCountStockSyncResponse = {
  ok?: boolean;
  ready?: boolean;
  message?: string;
  batch?: string;
  warehouse?: string;
  cleared_cartons?: {
    item_code: string;
    location: string;
    carton: string;
    qty_after?: number;
  }[];
  balances?: {
    item_code: string;
    location: string;
    carton?: string | null;
    qty: number;
  }[];
};

function normalizeCartonId(cartonId?: string | null): string {
  return String(cartonId || "").trim();
}

function normalizeKey(key: StockLedgerKey) {
  return {
    warehouse: String(key.warehouse || "").trim(),
    item_code: String(key.item_code || "").trim(),
    bin_location: String(key.bin_location || "").trim(),
    carton_id: normalizeCartonId(key.carton_id),
  };
}

export async function getLocalStockQty(key: StockLedgerKey): Promise<number> {
  const { warehouse, item_code, bin_location, carton_id } = normalizeKey(key);
  if (!item_code || !bin_location) return 0;

  const db = await getDatabase();
  const row = await db.getFirstAsync<{ qty: number | null }>(
    `SELECT qty FROM stock_ledger_carton_cache
     WHERE item_code = ? AND warehouse = ? AND bin_location = ? AND carton_id = ?`,
    [item_code, warehouse || "", bin_location, carton_id]
  );
  return row?.qty ?? 0;
}

export async function setLocalStockQty(
  key: StockLedgerKey,
  qty: number
): Promise<void> {
  const { warehouse, item_code, bin_location, carton_id } = normalizeKey(key);
  if (!item_code || !bin_location) return;

  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO stock_ledger_carton_cache (
      item_code, warehouse, bin_location, carton_id, qty, reserved_qty, updated_on
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      item_code,
      warehouse || "",
      bin_location,
      carton_id,
      qty,
      0,
      new Date().toISOString(),
    ]
  );
}

export async function upsertLocalStockQty(
  key: StockLedgerKey,
  qty: number
): Promise<void> {
  await setLocalStockQty(key, qty);
}

/** Expected qty for cycle count = local stock for this carton only (0 if new carton). */
export async function getExpectedQtyForCarton(
  key: StockLedgerKey,
  options?: { fetchOnline?: boolean }
): Promise<number> {
  const normalized = normalizeKey(key);
  let qty = await getLocalStockQty(normalized);

  if (qty === 0 && options?.fetchOnline) {
    try {
      const online = await isDeviceOnline();
      if (online && normalized.bin_location) {
        const response = await apiService.getStockLedgerByLocation({
          bin_location: normalized.bin_location,
          warehouse: normalized.warehouse || undefined,
          item_code: normalized.item_code,
          carton_id: normalized.carton_id || undefined,
        });
        const stockItems =
          response?.data || response?.items || response || [];
        const stockArray = Array.isArray(stockItems) ? stockItems : [stockItems];

        const matched = stockArray.find((entry: any) => {
          const code = String(
            entry?.item_code || entry?.item || entry?.code || ""
          ).trim();
          if (code !== normalized.item_code) return false;
          const entryCarton = normalizeCartonId(
            entry?.carton_id || entry?.carton
          );
          if (normalized.carton_id) {
            return entryCarton === normalized.carton_id;
          }
          return !entryCarton;
        });

        const remoteQty =
          matched?.qty ??
          matched?.actual_qty ??
          matched?.current_qty ??
          matched?.expected_qty;

        if (
          remoteQty !== undefined &&
          remoteQty !== null &&
          !Number.isNaN(Number(remoteQty))
        ) {
          qty = Number(remoteQty);
          await setLocalStockQty(normalized, qty);
        }
      }
    } catch (error: any) {
      console.warn(
        `⚠️ getExpectedQtyForCarton: online lookup failed for ${normalized.item_code}:`,
        error.message
      );
    }
  }

  return qty;
}

export async function listLocalStockForCarton(
  warehouse: string,
  bin_location: string,
  carton_id: string
): Promise<{ item_code: string; qty: number }[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ item_code: string; qty: number }>(
    `SELECT item_code, qty FROM stock_ledger_carton_cache
     WHERE warehouse = ? AND bin_location = ? AND carton_id = ? AND qty > 0
     ORDER BY item_code`,
    [warehouse || "", bin_location, normalizeCartonId(carton_id)]
  );
  return rows;
}

export async function applyCycleCountStockSync(
  response: CycleCountStockSyncResponse
): Promise<{ cleared: number; updated: number }> {
  const warehouse = String(response.warehouse || "").trim();
  let cleared = 0;
  let updated = 0;

  for (const entry of response.cleared_cartons || []) {
    await setLocalStockQty(
      {
        warehouse,
        item_code: entry.item_code,
        bin_location: entry.location,
        carton_id: entry.carton,
      },
      entry.qty_after ?? 0
    );
    cleared++;
  }

  for (const entry of response.balances || []) {
    await upsertLocalStockQty(
      {
        warehouse,
        item_code: entry.item_code,
        bin_location: entry.location,
        carton_id: entry.carton ?? "",
      },
      entry.qty
    );
    updated++;
  }

  return { cleared, updated };
}

export async function upsertCartonStockFromMasterRow(stock: {
  item_code: string;
  warehouse?: string | null;
  bin_location?: string | null;
  carton_id?: string | null;
  qty?: number | null;
}): Promise<void> {
  const cartonId = normalizeCartonId(stock.carton_id);
  const binLocation = String(
    stock.bin_location || (stock as any).bin_code || (stock as any).location || ""
  ).trim();
  const itemCode = String(stock.item_code || "").trim();
  if (!itemCode || !binLocation) return;

  await upsertLocalStockQty(
    {
      warehouse: String(stock.warehouse || (stock as any).warehouse_id || "").trim(),
      item_code: itemCode,
      bin_location: binLocation,
      carton_id: cartonId,
    },
    Number(stock.qty ?? (stock as any).quantity ?? 0) || 0
  );
}
