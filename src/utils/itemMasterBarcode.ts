/**
 * item_master.barcode is NOT NULL. When the API omits barcode, use item_code
 * so inserts succeed and lookups behave like resolveItemFromBarcode.
 */
export function normalizeItemMasterBarcode(
  barcode: unknown,
  itemCode: string
): string {
  const b = barcode != null ? String(barcode).trim() : "";
  if (b !== "") return b;
  return itemCode.trim();
}
