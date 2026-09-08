import { getSettings } from "../services/settings.service";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    if (typeof globalThis.atob === "function") {
      return JSON.parse(globalThis.atob(padded));
    }
    return null;
  } catch {
    return null;
  }
}

export function roleFromUserIdentity(
  userCode?: string | null,
  role?: string | null
): string {
  return String(role ?? "").trim();
}

export function isAdminRole(role: string, userCode?: string | null): boolean {
  const code = String(userCode ?? "")
    .trim()
    .toLowerCase();
  if (code === "sysadmin" || code === "administrator") return true;
  const r = String(role ?? "").toLowerCase();
  return r.includes("admin") || r.includes("system");
}

/** Matches wms-api `isSupervisorOrAdminUser` — supervisor or admin may override carton finish. */
export function isSupervisorOrAdminRole(
  role: string,
  userCode?: string | null
): boolean {
  if (isAdminRole(role, userCode)) return true;
  const r = String(role ?? "").toLowerCase();
  return r.includes("supervisor") || r.includes("manager");
}

export async function getCurrentUserRole(): Promise<{
  role: string;
  userCode: string;
  isSupervisorOrAdmin: boolean;
}> {
  const settings = await getSettings();
  const userCode = String(settings.user_code || settings.user_id || "").trim();
  let role = String((settings as { user_role?: string }).user_role || "").trim();
  if (!role && settings.auth_token) {
    const payload = decodeJwtPayload(settings.auth_token);
    role = String(payload?.role ?? "").trim();
  }
  return {
    role,
    userCode,
    isSupervisorOrAdmin: isSupervisorOrAdminRole(role, userCode),
  };
}
