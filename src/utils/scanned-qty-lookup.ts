import { itemCodesMatchForAllocation } from "./allocation-row-fields";

/** Canonical key for aggregating scanned_quantities (must match refresh + UI lookup). */
export function qtyKeyForScannedState(
  itemCode: string | number | null | undefined
): string {
  return String(itemCode ?? "").trim().toUpperCase();
}

export function scannedQtyLookup(
  quantities: Record<string, number>,
  itemCode: string | number | null | undefined
): number {
  if (itemCode == null || String(itemCode).trim() === "") return 0;
  const k = qtyKeyForScannedState(itemCode);
  if (Object.prototype.hasOwnProperty.call(quantities, k)) {
    return quantities[k] || 0;
  }
  for (const [key, v] of Object.entries(quantities)) {
    if (itemCodesMatchForAllocation(key, itemCode)) {
      return v || 0;
    }
  }
  return 0;
}
