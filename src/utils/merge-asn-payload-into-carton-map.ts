/**
 * Merge GET /api/asn (or equivalent) JSON into `asn_carton_map` for one supplier carton.
 * Used by Box Management, Receive/Sort hydration, and any screen that must heal missing local lines.
 */
export async function mergeCartonLinesFromAsnPayload(
  /** expo-sqlite `SQLiteDatabase` — typed loosely for overload compatibility */
  db: any,
  asnOriginal: string,
  normalizedASN: string,
  cartonIdUpper: string,
  payload: Record<string, unknown> | null | undefined
): Promise<boolean> {
  if (!payload) return false;
  const parseMaybeJson = (value: unknown): unknown | null => {
    if (!value) return null;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        return null;
      }
    }
    return typeof value === "object" ? value : null;
  };
  const asObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const rootUnknown = parseMaybeJson(payload) || {};
  const root = asObject(rootUnknown) || {};
  const innerUnknown = parseMaybeJson(root.data);
  const messageUnknown = parseMaybeJson(root.message);
  const resultUnknown = parseMaybeJson(root.result);
  const payloadJsonUnknown = parseMaybeJson(root.payload_json);
  const inner = asObject(innerUnknown);
  const message = asObject(messageUnknown);
  const result = asObject(resultUnknown);
  const payloadJson = asObject(payloadJsonUnknown);
  const p: Record<string, unknown> = inner || message || result || payloadJson || root;
  const norm = (s: string) =>
    String(s || "")
      .trim()
      .toUpperCase();
  const firstString = (
    row: Record<string, unknown>,
    keys: string[],
  ): string => {
    for (const key of keys) {
      const value = row[key];
      if (value != null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }
    return "";
  };
  const firstNumber = (
    row: Record<string, unknown>,
    keys: string[],
  ): number => {
    for (const key of keys) {
      const value = row[key];
      if (value != null && String(value).trim() !== "") {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
      }
    }
    return 0;
  };

  const rows: { item_code: string; shipped_qty: number }[] = [];
  const pushLine = (row: Record<string, unknown>, cartonOverride?: string) => {
    const rowCarton = cartonOverride || firstString(row, [
      "carton_id",
      "carton",
      "carton_no",
      "carton_number",
      "cartonId",
      "supplier_carton",
      "supplier_carton_id",
      "source_carton",
      "source_carton_id",
      "ctn",
      "ctn_no",
      "box_id",
    ]);
    if (norm(rowCarton) !== cartonIdUpper) return;

    const itemCode = firstString(row, [
      "item_code",
      "item",
      "item_id",
      "sku",
      "barcode",
    ]);
    if (!itemCode) return;

    rows.push({
      item_code: itemCode,
      shipped_qty: firstNumber(row, [
        "shipped_qty",
        "expected_qty",
        "qty",
        "quantity",
        "total_qty",
        "pcs",
        "pieces",
      ]),
    });
  };

  const detailArrays = [
      "details",
      "items",
      "lines",
      "asn_items",
      "asn_lines",
      "carton_lines",
      "item_lines",
      "advance_shipping_notice_items",
      "advance_shipping_notice_item",
      "records",
      "rows",
      "results",
    ];

  const cartonKeys = [
    "carton_id",
    "carton",
    "carton_no",
    "carton_number",
    "cartonId",
    "supplier_carton",
    "source_carton",
    "ctn",
    "ctn_no",
  ];

  const scanArrays = (source: Record<string, unknown>) => {
    const sourceCartonId = firstString(source, cartonKeys);

    for (const key of detailArrays) {
      const value = source[key];
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry && typeof entry === "object") {
            pushLine(
              entry as Record<string, unknown>,
              norm(sourceCartonId) === cartonIdUpper ? sourceCartonId : undefined
            );
            scanArrays(entry as Record<string, unknown>);
          }
        }
      }
    }

    const cartonsData = (source.cartons as unknown[]) || [];
    for (const c of cartonsData) {
      if (!c || typeof c !== "object") continue;
      const carton = c as Record<string, unknown>;
      const cartonId = firstString(carton, cartonKeys);
      if (norm(cartonId) !== cartonIdUpper) continue;
      for (const key of detailArrays) {
        const cartonLines = carton[key];
        if (Array.isArray(cartonLines)) {
          for (const item of cartonLines) {
            if (item && typeof item === "object") {
              pushLine(item as Record<string, unknown>, cartonId);
            }
          }
        }
      }
    }
  };

  const scanUnknown = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry && typeof entry === "object") {
          pushLine(entry as Record<string, unknown>);
          scanArrays(entry as Record<string, unknown>);
        }
      }
      return;
    }
    const objectValue = asObject(value);
    if (objectValue) scanArrays(objectValue);
  };

  scanUnknown(rootUnknown);
  if (innerUnknown) scanUnknown(innerUnknown);
  if (messageUnknown) scanUnknown(messageUnknown);
  if (resultUnknown) scanUnknown(resultUnknown);
  if (payloadJsonUnknown) scanUnknown(payloadJsonUnknown);
  if (p !== root && p !== inner && p !== message && p !== result && p !== payloadJson) scanArrays(p);

  if (rows.length === 0) return false;

  await db.runAsync(
    `DELETE FROM asn_carton_map WHERE UPPER(TRIM(carton_id)) = ? AND (asn_no = ? OR asn_no = ?)`,
    [cartonIdUpper, asnOriginal, normalizedASN]
  );

  for (const r of rows) {
    await db.runAsync(
      `INSERT OR REPLACE INTO asn_carton_map (asn_no, carton_id, item_code, shipped_qty) VALUES (?, ?, ?, ?)`,
      [asnOriginal, cartonIdUpper, r.item_code, r.shipped_qty]
    );
  }
  return true;
}
