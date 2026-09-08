/**
 * Builds app-generated BOX ids: BOX-{store-slug}-{timestamp}.
 * Keeps hyphens in store codes so labels stay aligned with warehouse master (e.g. 002-UNAIZAH-2),
 * instead of stripping them into ambiguous strings like 002UNAIZAH2.
 */
export function slugifyStoreForBoxIdSegment(store: string): string {
  let s = String(store || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!s) s = "UNKNOWN";
  return s;
}

export function buildAutoBoxIdForStore(
  store: string,
  timestamp: number = Date.now()
): string {
  const slug = slugifyStoreForBoxIdSegment(store);
  return `BOX-${slug}-${timestamp}`;
}

/**
 * Parses `BOX-{storeSlug}-{timestamp}` → store slug (e.g. BOX-004ALRAS-450904 → 004ALRAS).
 * Used when box_cache.store disagrees with the printed segment but TO lines use master codes.
 */
export function parseBoxIdStoreSlug(
  boxId: string | null | undefined
): string | null {
  const s = String(boxId || "").trim().toUpperCase();
  const m = s.match(/^BOX-(.+)-(\d+)$/);
  if (!m || m[1].length < 2) return null;
  return m[1].trim();
}

/**
 * Collapses store codes to A–Z / 0–9 only (uppercase) so TO lines and box_cache
 * still match when hyphenation differs, e.g. ERP "004-Alras" vs label "004ALRAS"
 * from an older BOX id segment or manual entry.
 */
export function compactStoreCodeKey(store: string | null | undefined): string {
  return String(store ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Leading warehouse code from a TO line label, e.g. "006 - Alhfof..." → "006".
 */
export function extractLeadingStoreCode(
  store: string | null | undefined
): string | null {
  const s = String(store ?? "").trim();
  if (!s) return null;
  const match = s.match(/^([A-Za-z0-9]{2,12})\s*[-–—]/);
  return match?.[1]?.trim() ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `long` starts with master/short code `code` (e.g. "006 - Alhfof" vs "006"). */
function storeCodePrefixesLongForm(long: string, code: string): boolean {
  const c = String(code ?? "").trim();
  if (!c) return false;
  const re = new RegExp(`^${escapeRegExp(c)}(\\s*[-–—]|\\s|$)`, "i");
  return re.test(String(long ?? "").trim());
}

/** True if two store strings refer to the same TO / box store (strict or compact). */
export function storeCodesMatchForTO(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const sa = String(a ?? "").trim();
  const sb = String(b ?? "").trim();
  if (!sa || !sb) return false;
  if (sa.toUpperCase() === sb.toUpperCase()) return true;
  if (compactStoreCodeKey(sa) === compactStoreCodeKey(sb)) return true;
  if (storeCodePrefixesLongForm(sa, sb) || storeCodePrefixesLongForm(sb, sa)) {
    return true;
  }
  return false;
}
