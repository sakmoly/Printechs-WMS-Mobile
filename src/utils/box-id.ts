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

/** True if two store strings refer to the same TO / box store (strict or compact). */
export function storeCodesMatchForTO(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const sa = String(a ?? "").trim();
  const sb = String(b ?? "").trim();
  if (!sa || !sb) return false;
  if (sa.toUpperCase() === sb.toUpperCase()) return true;
  return compactStoreCodeKey(sa) === compactStoreCodeKey(sb);
}
