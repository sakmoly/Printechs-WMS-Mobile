import * as SQLite from "expo-sqlite";
import { apiService, type PullItemMasterParams } from "./api.service";
import { getSettings, saveSettings } from "./settings.service";
import { normalizeItemMasterBarcode } from "../utils/itemMasterBarcode";
import type { ItemMasterSyncMode } from "../types";

/** SQLite bind parameter limit; 4 columns per row for item_master. */
const ROWS_PER_INSERT_BATCH = 200;

export type ItemMasterPageInfo = {
  items: any[];
  hasMore: boolean;
  nextOffset: number;
};

/**
 * Parse API response: plain array, or wrapper { items, has_more, next_offset }.
 */
export function parseItemMasterPageResponse(
  response: any,
  pageSize: number,
  currentOffset: number
): ItemMasterPageInfo {
  let items: any[] = [];
  if (Array.isArray(response)) {
    items = response;
  } else if (response && typeof response === "object") {
    if (Array.isArray(response.items)) items = response.items;
    else if (Array.isArray(response.data)) items = response.data;
    else if (response.data && Array.isArray(response.data.items))
      items = response.data.items;
  }

  let hasMore = false;
  let nextOffset = currentOffset + items.length;

  if (response && typeof response === "object" && !Array.isArray(response)) {
    if (typeof response.has_more === "boolean") hasMore = response.has_more;
    else if (typeof response.hasMore === "boolean") hasMore = response.hasMore;
    if (response.next_offset != null && response.next_offset !== "")
      nextOffset = Number(response.next_offset);
    else if (response.nextOffset != null && response.nextOffset !== "")
      nextOffset = Number(response.nextOffset);
  } else {
    hasMore = pageSize > 0 && items.length === pageSize;
  }

  return { items, hasMore, nextOffset };
}

function compareIsoDate(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return ta - tb;
}

function maxIso(a: string | null | undefined, b: string): string {
  if (!a) return b;
  return compareIsoDate(a, b) >= 0 ? a : b;
}

/**
 * Bulk INSERT OR REPLACE in one transaction, chunked for SQLite variable limits.
 */
export async function bulkUpsertItemMaster(
  db: SQLite.SQLiteDatabase,
  rows: {
    item_code: string;
    barcode: string;
    item_name: string | null;
    updated_on: string;
  }[]
): Promise<void> {
  if (rows.length === 0) return;

  await db.withTransactionAsync(async () => {
    for (let i = 0; i < rows.length; i += ROWS_PER_INSERT_BATCH) {
      const chunk = rows.slice(i, i + ROWS_PER_INSERT_BATCH);
      const placeholders = chunk.map(() => "(?, ?, ?, ?)").join(", ");
      const values: (string | null)[] = [];
      for (const r of chunk) {
        values.push(r.item_code, r.barcode, r.item_name, r.updated_on);
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO item_master (item_code, barcode, item_name, updated_on) VALUES ${placeholders}`,
        values
      );
    }
  });
}

function clampPageSize(n: number): number {
  if (!Number.isFinite(n) || n < 500) return 500;
  if (n > 20000) return 20000;
  return Math.floor(n);
}

export type SyncItemMasterOptions = {
  onProgress?: (detail: string) => void;
};

/**
 * Download all item-master rows for client-side search (resolveItemFromBarcode, etc.).
 * Uses the same paging contract as sync; does not write to SQLite.
 */
export async function fetchAllItemMasterRowsForLookup(): Promise<any[]> {
  const settings = await getSettings();
  const pageSize = clampPageSize(
    Number(settings.item_master_page_size) || 5000
  );
  const out: any[] = [];
  let offset = 0;
  let page = 0;
  const maxPages = 50000;

  while (page < maxPages) {
    page++;
    const params: PullItemMasterParams = {
      limit: pageSize,
      offset,
      sort: "item_code",
      order: "asc",
    };
    const response = await apiService.pullItemMaster(params);
    const { items, hasMore, nextOffset } = parseItemMasterPageResponse(
      response,
      pageSize,
      offset
    );
    out.push(...items);
    if (!hasMore || items.length === 0) break;
    offset = nextOffset;
    await new Promise((r) => setTimeout(r, 10));
  }

  return out;
}

/**
 * Paged item master download + local bulk upsert. Updates watermark after success when incremental.
 */
export async function syncItemMasterPaged(
  db: SQLite.SQLiteDatabase,
  options?: SyncItemMasterOptions
): Promise<{ synced: number; failed: number }> {
  const settings = await getSettings();
  const mode = (settings.item_master_sync_mode || "full").toLowerCase() as
    | ItemMasterSyncMode
    | string;
  const isIncremental = mode === "incremental";
  const pageSize = clampPageSize(
    Number(settings.item_master_page_size) || 5000
  );
  const watermark = settings.item_master_modified_watermark || null;

  const report = (msg: string) => options?.onProgress?.(msg);

  if (!isIncremental) {
    report("Clearing local items (full sync)…");
    await db.runAsync("DELETE FROM item_master");
  }

  let offset = 0;
  let totalSynced = 0;
  let totalFailed = 0;
  let maxModified: string | null = null;
  let pageNum = 0;
  const maxPages = 50000;

  while (pageNum < maxPages) {
    pageNum++;
    const params: PullItemMasterParams = {
      limit: pageSize,
      offset,
      sort: "item_code",
      order: "asc",
    };

    if (isIncremental) {
      if (watermark) {
        params.modified_since = watermark;
      }
    }

    report(
      `Downloading page ${pageNum} (offset ${offset.toLocaleString()}, limit ${pageSize})…`
    );

    let response: any;
    try {
      response = await apiService.pullItemMaster(params);
    } catch (e: any) {
      console.error("Item master page fetch failed:", e?.message || e);
      throw e;
    }

    const { items, hasMore, nextOffset } = parseItemMasterPageResponse(
      response,
      pageSize,
      offset
    );

    const prepared: {
      item_code: string;
      barcode: string;
      item_name: string | null;
      updated_on: string;
    }[] = [];

    for (const item of items) {
      const itemCode = String(item.item_code ?? "").trim();
      if (!itemCode) {
        totalFailed++;
        continue;
      }
      const barcode = normalizeItemMasterBarcode(item.barcode, itemCode);
      const updatedOn =
        item.updated_on ||
        item.updated_at ||
        item.modified ||
        new Date().toISOString();
      const uo = String(updatedOn);
      maxModified = maxIso(maxModified, uo);
      prepared.push({
        item_code: itemCode,
        barcode,
        item_name: item.item_name || null,
        updated_on: uo,
      });
    }

    try {
      await bulkUpsertItemMaster(db, prepared);
      totalSynced += prepared.length;
    } catch (bulkErr: any) {
      console.error("Bulk upsert item_master failed:", bulkErr?.message);
      throw bulkErr;
    }

    report(
      `Saved ${totalSynced.toLocaleString()} items…`
    );

    if (!hasMore || items.length === 0) {
      break;
    }

    offset = nextOffset;

    await new Promise((r) => setTimeout(r, 15));
  }

  if (isIncremental && maxModified) {
    await saveSettings({
      item_master_modified_watermark: maxModified,
    });
  } else if (!isIncremental) {
    if (maxModified) {
      await saveSettings({
        item_master_modified_watermark: maxModified,
      });
    }
  }

  return { synced: totalSynced, failed: totalFailed };
}
