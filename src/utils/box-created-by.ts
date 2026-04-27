/**
 * Normalize `created_by` from API / ERP box payloads (field names vary).
 */
export function createdByFromApiBox(
  row: Record<string, unknown> | null | undefined
): string {
  if (!row || typeof row !== "object") return "";
  const v =
    row.created_by ??
    row.createdBy ??
    row.owner ??
    row.user_id ??
    row.userId ??
    row.user_code ??
    row.userCode ??
    "";
  return String(v || "").trim();
}

export function createdByFromSettings(settings: {
  user_id?: string | null;
  user_code?: string | null;
}): string {
  return (
    String(settings.user_id || "").trim() ||
    String(settings.user_code || "").trim() ||
    ""
  );
}
