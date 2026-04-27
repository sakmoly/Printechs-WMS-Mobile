/**
 * Normalize TO / ASN allocation rows from different backend payload shapes.
 */

/** Store / warehouse column from a TO allocation line (field names vary by ERP export). */
export function storeFieldFromAllocationRow(row: any): string {
  if (row == null || typeof row !== "object") return "";
  const v =
    row.store ??
    row.store_code ??
    row.target_warehouse ??
    row.target_warehouse_code ??
    row.target_store ??
    row.to_store ??
    row.destination_store ??
    row.destination ??
    row.warehouse ??
    row.warehouse_code ??
    row.t_warehouse ??
    row.branch;
  return String(v ?? "").trim();
}

/** Item code from a TO allocation line. */
export function itemCodeFromAllocationRow(row: any): string {
  if (row == null || typeof row !== "object") return "";
  const v =
    row.item_code ??
    row.item_code_sku ??
    row.item ??
    row.sku ??
    row.item_no ??
    row.item_id;
  return String(v ?? "").trim();
}

/** Case-insensitive item code match for TO lines vs scanned master item_code. */
export function itemCodesMatchForAllocation(
  a: string | number | null | undefined,
  b: string | number | null | undefined
): boolean {
  const sa = String(a ?? "").trim();
  const sb = String(b ?? "").trim();
  if (!sa || !sb) return false;
  return sa.toUpperCase() === sb.toUpperCase();
}
