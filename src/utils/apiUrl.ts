/**
 * Mobile endpoints always start with `/api/...`. Some deployments store the base URL
 * with a trailing `/api` (e.g. Desktop `ApiEndpointUrl`). Strip that segment so we
 * never request `/api/api/...`.
 */
export function normalizeApiBaseUrl(apiUrl: string): string {
  let base = String(apiUrl || "").trim().replace(/\/+$/, "");
  if (!base) {
    return "";
  }
  if (/\/api$/i.test(base)) {
    base = base.replace(/\/api$/i, "");
  }
  return base.replace(/\/+$/, "");
}

export function joinApiUrl(apiUrl: string, endpoint: string): string {
  const base = normalizeApiBaseUrl(apiUrl);
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${base}${path}`;
}
