/**
 * When a transaction (MR, ASN, Transfer In, etc.) is received on mobile,
 * fetch and cache item master rows for its line item_codes so barcode picking works
 * without a full item master sync.
 */
import { getDatabase } from "../database/database";
import { getSettings } from "./settings.service";
import {
  cacheItemMasterRecord,
  lookupAndCacheItemFromApi,
} from "./item-master.service";

const LOOKUP_CONCURRENCY = 5;

export function extractItemCodesFromLines(
  lines: Array<{ item_code?: string; code?: string }> | null | undefined
): string[] {
  if (!Array.isArray(lines)) return [];
  const codes = new Set<string>();
  for (const line of lines) {
    const code = String(line?.item_code || line?.code || "").trim();
    if (code) codes.add(code);
  }
  return Array.from(codes);
}

export function extractItemCodesFromAsnPayload(asn: {
  cartons?: Array<{ items?: Array<{ item_code?: string }> }>;
  details?: Array<{ item_code?: string }>;
}): string[] {
  const codes = new Set<string>();
  if (Array.isArray(asn.cartons)) {
    for (const carton of asn.cartons) {
      for (const item of carton.items || []) {
        const code = String(item?.item_code || "").trim();
        if (code) codes.add(code);
      }
    }
  }
  if (Array.isArray(asn.details)) {
    for (const detail of asn.details) {
      const code = String(detail?.item_code || "").trim();
      if (code) codes.add(code);
    }
  }
  return Array.from(codes);
}

async function itemNeedsCacheRefresh(itemCode: string): Promise<boolean> {
  try {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ item_code: string; barcode: string | null }>(
      `SELECT item_code, barcode FROM item_master WHERE item_code = ? LIMIT 1`,
      [itemCode]
    );
    if (!row) return true;
    const barcode = String(row.barcode || "").trim();
    if (!barcode) return true;
    // Placeholder from old sync: barcode fell back to item_code — refresh for real EAN.
    if (barcode === itemCode) return true;
    return false;
  } catch {
    return true;
  }
}

async function ensureSingleItemCached(
  itemCode: string
): Promise<"cached" | "skipped" | "failed"> {
  const code = String(itemCode || "").trim();
  if (!code) return "skipped";

  if (!(await itemNeedsCacheRefresh(code))) {
    return "skipped";
  }

  const item = await lookupAndCacheItemFromApi({ item_code: code }, code);
  return item ? "cached" : "failed";
}

/**
 * Fetch item master (incl. barcode) for transaction line items via lookup API.
 * Non-blocking friendly — safe to fire-and-forget from list screens.
 */
export async function ensureItemsCachedForCodes(
  itemCodes: string[],
  context?: string
): Promise<{ cached: number; skipped: number; failed: number }> {
  const settings = await getSettings();
  if (!settings.api_url) {
    console.log(
      `ℹ️ Transaction item cache skipped (${context || "transaction"}): no API URL`
    );
    return { cached: 0, skipped: 0, failed: 0 };
  }

  const unique = Array.from(
    new Set(itemCodes.map((c) => String(c || "").trim()).filter(Boolean))
  );
  if (unique.length === 0) {
    return { cached: 0, skipped: 0, failed: 0 };
  }

  console.log(
    `📦 Ensuring item master for ${unique.length} transaction item(s)${context ? ` (${context})` : ""}…`
  );

  let cached = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < unique.length; i += LOOKUP_CONCURRENCY) {
    const batch = unique.slice(i, i + LOOKUP_CONCURRENCY);
    const results = await Promise.all(batch.map((code) => ensureSingleItemCached(code)));
    for (const r of results) {
      if (r === "cached") cached++;
      else if (r === "skipped") skipped++;
      else failed++;
    }
  }

  console.log(
    `✅ Transaction item cache${context ? ` (${context})` : ""}: cached=${cached}, skipped=${skipped}, failed=${failed}`
  );
  return { cached, skipped, failed };
}

export function ensureItemsCachedForTransactionLines(
  lines: Array<{ item_code?: string; code?: string }> | null | undefined,
  context: string
): void {
  const codes = extractItemCodesFromLines(lines);
  if (codes.length === 0) return;
  void ensureItemsCachedForCodes(codes, context).catch((err) => {
    console.warn(`⚠️ Transaction item cache failed (${context}):`, err?.message || err);
  });
}

/** Cache item master for all distinct item_codes on an ASN (from asn_carton_map). */
export async function ensureItemsCachedForAsn(
  asnNo: string,
  context?: string
): Promise<{ cached: number; skipped: number; failed: number }> {
  const asn = String(asnNo || "").trim();
  if (!asn) return { cached: 0, skipped: 0, failed: 0 };

  try {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ item_code: string }>(
      `SELECT DISTINCT item_code FROM asn_carton_map
       WHERE UPPER(TRIM(asn_no)) = UPPER(TRIM(?))
         AND UPPER(TRIM(item_code)) <> 'PLACEHOLDER'
         AND TRIM(item_code) <> ''`,
      [asn]
    );
    const codes = rows.map((r) => String(r.item_code || "").trim()).filter(Boolean);
    if (codes.length === 0) {
      const normalized = asn.replace(/[^A-Z0-9]/gi, "").toUpperCase();
      if (normalized !== asn.toUpperCase()) {
        const altRows = await db.getAllAsync<{ item_code: string }>(
          `SELECT DISTINCT item_code FROM asn_carton_map
           WHERE UPPER(REPLACE(REPLACE(REPLACE(asn_no, '-', ''), ' ', ''), '_', '')) = ?
             AND UPPER(TRIM(item_code)) <> 'PLACEHOLDER'
             AND TRIM(item_code) <> ''`,
          [normalized]
        );
        return ensureItemsCachedForCodes(
          altRows.map((r) => String(r.item_code || "").trim()).filter(Boolean),
          context || `ASN:${asn}`
        );
      }
      return { cached: 0, skipped: 0, failed: 0 };
    }
    return ensureItemsCachedForCodes(codes, context || `ASN:${asn}`);
  } catch (err: any) {
    console.warn(`⚠️ ASN item cache lookup failed (${asn}):`, err?.message || err);
    return { cached: 0, skipped: 0, failed: 0 };
  }
}

export { cacheItemMasterRecord };
