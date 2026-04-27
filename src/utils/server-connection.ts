/** User-facing copy when the app cannot reach the API. */
export const SERVER_CONNECTION_LOST_MESSAGE =
  "Server connection lost. Check your network and try again.";

/**
 * True for typical offline / transport failures (not HTTP 4xx/5xx from a reachable server).
 */
export function isLikelyNetworkConnectionFailure(error: unknown): boolean {
  const e = error as {
    name?: string;
    message?: string;
    code?: string;
    cause?: { message?: string };
  };
  const name = String(e?.name || "");
  const msg = String(e?.message ?? e ?? "").toLowerCase();
  const code = String(e?.code || "").toUpperCase();
  const causeMsg = String(e?.cause?.message || "").toLowerCase();

  if (name === "AbortError") return true;
  if (code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "ETIMEDOUT")
    return true;
  if (
    msg.includes("network request failed") ||
    msg.includes("failed to fetch") ||
    msg.includes("network error") ||
    msg.includes("load failed") ||
    msg.includes("internet connection appears") ||
    msg.includes("timeout") ||
    causeMsg.includes("network")
  ) {
    return true;
  }
  return false;
}
