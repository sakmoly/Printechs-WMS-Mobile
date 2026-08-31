import { getDatabase } from "../database/database";
import { getSettings } from "./settings.service";

export type CycleCountMode = "Reconciliation" | "Adhoc Add";

export function countModeToApiValue(mode: CycleCountMode | string | null | undefined): string {
  const normalized = String(mode || "Reconciliation").trim().toLowerCase();
  if (
    normalized === "adhoc add" ||
    normalized === "adhoc" ||
    normalized === "adhoc_add" ||
    normalized === "add_stock"
  ) {
    return "Adhoc Add";
  }
  return "Reconciliation";
}

export function isAdhocAddMode(mode: CycleCountMode | string | null | undefined): boolean {
  return countModeToApiValue(mode) === "Adhoc Add";
}

export function unwrapFrappeMessage<T = any>(response: any): T {
  if (response == null) return response as T;
  if (response.message !== undefined && typeof response.message === "object") {
    return response.message as T;
  }
  return response as T;
}

const DEFAULT_ERP_COMPANY =
  "Mohammed Abdullah Almousa Trading Company";

/** ERPNext warehouse doc names often include company suffix (e.g. "Main Warehouse - MAATC"). */
function resolveErpWarehouseName(code: string, cachedName: string): string {
  const name = String(cachedName || code).trim();
  if (name.includes(" - ")) {
    return name;
  }
  if (
    code.toUpperCase() === "WH-MAIN" ||
    name.toLowerCase() === "main warehouse"
  ) {
    return "Main Warehouse - MAATC";
  }
  return name;
}

export async function getCycleCountWarehouseContext(
  warehouseCode?: string | null
): Promise<{ warehouse_code: string; warehouse_name: string; company: string }> {
  const settings = await getSettings();
  const code = String(
    warehouseCode || settings.warehouse_id || settings.warehouse || "WH-MAIN"
  ).trim();

  let warehouse_name = code;
  try {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ code: string; name: string | null }>(
      "SELECT code, name FROM warehouse_store_cache WHERE code = ? LIMIT 1",
      [code]
    );
    if (row?.name) {
      warehouse_name = row.name;
    }
  } catch {
    /* use code */
  }

  return {
    warehouse_code: code,
    warehouse_name: resolveErpWarehouseName(code, warehouse_name),
    company: DEFAULT_ERP_COMPANY,
  };
}

export type CycleCountPushIdentity = {
  counted_by: string;
  device_id: string;
};

/** User + device for ERP push-capture task header (ensures stable device_id exists). */
export async function getCycleCountPushIdentity(): Promise<CycleCountPushIdentity> {
  const settings = await getSettings();
  const counted_by =
    String(settings.user_code || settings.user_id || "").trim() || "USER-AUTO";
  let device_id = String(settings.device_id || "").trim();
  if (!device_id) {
    const refreshed = await getSettings();
    device_id = String(refreshed.device_id || "").trim();
  }
  if (!device_id) {
    throw new Error(
      "Device ID is missing. Open Settings, confirm Device ID is set, then push again."
    );
  }
  return { counted_by, device_id };
}
