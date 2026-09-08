/**
 * Load Transfer Order + store allocations for an ASN.
 * Priority: local cache → GET /api/transfer-order/by-asn (fast) → ASN header fallback.
 * Does NOT use /live (that endpoint is for per-scan metrics and large TOs).
 */
import { getDatabase } from "../database/database";
import { apiService } from "./api.service";
import { dataService } from "./data.service";
import { getASNFormatVariations, normalizeASN } from "../utils/asn";
import {
  itemCodeFromAllocationRow,
  storeFieldFromAllocationRow,
} from "../utils/allocation-row-fields";
import { canonicalStoreForToLine } from "../utils/to-store-master";

export type TransferOrderAllocationRow = {
  to_no?: string;
  store: string;
  item_code: string;
  allocated_qty: number;
};

export type TransferOrderLoadResult = {
  toNo: string | null;
  allocations: TransferOrderAllocationRow[];
  source: "local" | "api" | "asn_fallback" | "none";
};

function extractToNumber(obj: any): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v =
    obj.to_no ||
    obj.transfer_order ||
    obj.to_number ||
    obj.transfer_order_no ||
    obj.linked_to ||
    obj.linked_transfer_order ||
    obj.document_name ||
    obj.name ||
    obj.title ||
    obj.id;
  if (v != null && typeof v === "object") return null;
  const s = String(v ?? "").trim();
  return s.length > 0 ? s : null;
}

function extractAllocationsFromPayload(
  toResponse: any
): TransferOrderAllocationRow[] {
  const toData =
    toResponse?.data ||
    (typeof toResponse?.transfer_order === "object"
      ? toResponse?.transfer_order
      : null) ||
    toResponse;

  const raw =
    toData?.allocations ||
    toData?.items ||
    toData?.item_lines ||
    toData?.allocation ||
    toData?.line_items ||
    toData?.lines ||
    toResponse?.allocations ||
    toResponse?.items ||
    [];

  if (!Array.isArray(raw)) return [];

  const rows: TransferOrderAllocationRow[] = [];
  for (const line of raw) {
    const store = storeFieldFromAllocationRow(line);
    const item_code = itemCodeFromAllocationRow(line);
    if (!store || !item_code) continue;
    rows.push({
      store,
      item_code,
      allocated_qty: Number(
        line.allocated_qty ?? line.to_qty ?? line.qty ?? 0
      ),
    });
  }
  return rows;
}

function allocationsFromLocalCache(
  rows: Array<{
    to_no?: string;
    store?: string;
    item_code?: string;
    allocated_qty?: number;
  }>
): TransferOrderAllocationRow[] {
  return rows
    .map((row) => ({
      to_no: row.to_no,
      store: String(row.store || "").trim(),
      item_code: String(row.item_code || "").trim(),
      allocated_qty: Number(row.allocated_qty || 0),
    }))
    .filter((r) => r.store && r.item_code);
}

async function persistAllocationsToCache(
  asn: string,
  toNo: string,
  allocations: TransferOrderAllocationRow[]
): Promise<void> {
  if (allocations.length === 0) return;
  const db = await getDatabase();
  if (!db) return;

  const normalizedASN = normalizeASN(asn);
  let masterRows: { code: string; name?: string }[] = [];
  try {
    masterRows = await dataService.getWarehouseStoreMasterRows();
  } catch {
    masterRows = [];
  }

  const rowsToSave: Array<[string, string, string, string, number]> = [];
  for (const alloc of allocations) {
    const rawStore = alloc.store;
    const lineItem = alloc.item_code;
    if (!rawStore || !lineItem) continue;
    const resolved = canonicalStoreForToLine(rawStore, masterRows);
    const storeToSave = resolved.storeToPersist || rawStore;
    rowsToSave.push([toNo, normalizedASN, storeToSave, lineItem, alloc.allocated_qty]);
  }
  if (rowsToSave.length === 0) return;

  const writeAll = async () => {
    await db.runAsync(
      `DELETE FROM transfer_order_cache WHERE asn_no = ? OR asn_no = ?`,
      [asn, normalizedASN]
    );
    const CHUNK = 150;
    for (let i = 0; i < rowsToSave.length; i += CHUNK) {
      const chunk = rowsToSave.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?)").join(", ");
      const params = chunk.flat();
      await db.runAsync(
        `INSERT OR REPLACE INTO transfer_order_cache
           (to_no, asn_no, store, item_code, allocated_qty)
           VALUES ${placeholders}`,
        params
      );
    }
  };

  if (typeof db.withTransactionAsync === "function") {
    await db.withTransactionAsync(writeAll);
  } else {
    await writeAll();
  }

  console.log(
    `📦 TO cache: saved ${rowsToSave.length} allocation(s) for ${asn} (${toNo})`
  );
}

/** Persist TO lines in background (batched). Safe to call without awaiting on UI thread. */
export function persistTransferOrderAllocationsToCache(
  asn: string,
  toNo: string,
  allocations: TransferOrderAllocationRow[]
): Promise<void> {
  return persistAllocationsToCache(asn, toNo, allocations);
}

/** Lightweight: TO number from ASN header when full by-asn payload is large. */
export async function fetchTransferOrderNumberFromAsnHeader(
  asn: string
): Promise<string | null> {
  const formats = Array.from(
    new Set([asn, normalizeASN(asn), ...getASNFormatVariations(asn)].filter(Boolean))
  );
  for (const asnFormat of formats) {
    try {
      const asnRes = await apiService.getASN(asnFormat);
      const asnData = asnRes?.data || asnRes;
      const toNo =
        extractToNumber(asnData) ||
        extractToNumber({
          transfer_order: asnData?.transfer_order,
          to_no: asnData?.to_no,
          transfer_order_no: asnData?.transfer_order_no,
          linked_to: asnData?.linked_to,
        });
      if (toNo) return toNo;
    } catch {
      /* try next ASN format */
    }
  }
  return null;
}

async function fetchTransferOrderFromStandardApi(
  asn: string
): Promise<{ toNo: string | null; allocations: TransferOrderAllocationRow[] } | null> {
  const formats = Array.from(
    new Set([asn, normalizeASN(asn), ...getASNFormatVariations(asn)].filter(Boolean))
  );

  for (const asnFormat of formats) {
    try {
      const toResponse = await apiService.getTransferOrderByASN(asnFormat);
      if (!toResponse) continue;

      if (toResponse.has_transfer_order === false) {
        continue;
      }

      let toNo = extractToNumber(toResponse);
      let allocations = extractAllocationsFromPayload(toResponse);

      if (!toNo || allocations.length === 0) {
        try {
          const asnRes = await apiService.getASN(asnFormat);
          const asnData = asnRes?.data || asnRes;
          if (!toNo) {
            toNo = extractToNumber(asnData) || extractToNumber({
              transfer_order: asnData?.transfer_order,
              to_no: asnData?.to_no,
            });
          }
          if (allocations.length === 0 && asnData) {
            const fromLines =
              asnData.details ||
              asnData.lines ||
              asnData.items ||
              asnData?.data?.details ||
              [];
            if (Array.isArray(fromLines) && fromLines.length > 0) {
              allocations = extractAllocationsFromPayload({ allocations: fromLines });
            }
          }
        } catch {
          /* ASN fallback optional */
        }
      }

      if (toNo || allocations.length > 0) {
        return { toNo, allocations };
      }
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (
        msg.includes("404") ||
        msg.includes("TRANSFER_ORDER_NOT_FOUND") ||
        msg.includes("not found")
      ) {
        continue;
      }
      throw err;
    }
  }

  return null;
}

/**
 * Load TO allocations: local SQLite first, then standard by-asn API when allowed.
 */
export async function loadTransferOrderForAsn(
  asn: string,
  options?: {
    allowApiRefresh?: boolean;
    forceApiRefresh?: boolean;
    /** When true, return after API parse; write SQLite in background. */
    deferCachePersist?: boolean;
  }
): Promise<TransferOrderLoadResult> {
  const allowApiRefresh = options?.allowApiRefresh !== false;
  const forceApiRefresh = options?.forceApiRefresh === true;
  const deferCachePersist = options?.deferCachePersist === true;

  if (!asn?.trim()) {
    return { toNo: null, allocations: [], source: "none" };
  }

  if (!forceApiRefresh) {
    const localRows = await dataService.getTransferOrderAllocations(asn);
    const localAllocations = allocationsFromLocalCache(localRows);
    if (localAllocations.length > 0) {
      const toNo =
        String(localRows[0]?.to_no || "").trim() ||
        extractToNumber({ to_no: localRows[0]?.to_no }) ||
        null;
      console.log(
        `📦 TO load (${asn}): ${localAllocations.length} allocation(s) from local cache` +
          (toNo ? `, TO=${toNo}` : "")
      );
      return {
        toNo,
        allocations: localAllocations,
        source: "local",
      };
    }
  }

  if (!allowApiRefresh) {
    return { toNo: null, allocations: [], source: "none" };
  }

  const fromApi = await fetchTransferOrderFromStandardApi(asn);
  if (!fromApi) {
    return { toNo: null, allocations: [], source: "none" };
  }

  const { toNo, allocations } = fromApi;
  if (toNo && allocations.length > 0) {
    if (deferCachePersist) {
      void persistAllocationsToCache(asn, toNo, allocations).catch((err) => {
        console.warn(`⚠️ Background TO cache write failed (${asn}):`, err?.message);
      });
    } else {
      await persistAllocationsToCache(asn, toNo, allocations);
    }
  }

  console.log(
    `📦 TO load (${asn}): ${allocations.length} allocation(s) from standard API` +
      (toNo ? `, TO=${toNo}` : "")
  );

  return {
    toNo,
    allocations,
    source: toNo && allocations.length === 0 ? "asn_fallback" : "api",
  };
}

export function sumAllocatedQty(
  allocations: TransferOrderAllocationRow[]
): number {
  return allocations.reduce((sum, row) => sum + (row.allocated_qty || 0), 0);
}

export function uniqueStoreCodesFromAllocations(
  allocations: TransferOrderAllocationRow[]
): string[] {
  return Array.from(
    new Set(
      allocations
        .map((a) => storeFieldFromAllocationRow(a))
        .filter((s) => s && String(s).trim() !== "")
    )
  );
}
