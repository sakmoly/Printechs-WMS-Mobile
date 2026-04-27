import { apiService } from "./api.service";
import { dataService } from "./data.service";
import { normalizeASN } from "../utils/asn";
import {
  isLikelyNetworkConnectionFailure,
  SERVER_CONNECTION_LOST_MESSAGE,
} from "../utils/server-connection";

export type PushCartonStatusResult =
  | { ok: true }
  | { ok: false; kind: "network" | "api"; message: string };

/**
 * POST carton status to the server first, then persist to SQLite so all devices
 * converge on the same source of truth when online.
 */
export async function pushReceivingCartonStatusServerThenLocal(options: {
  asnNoOriginal: string;
  inboundSession: string;
  cartonId: string;
  userId: string;
  deviceId?: string | null;
  lockedOnIso: string;
}): Promise<PushCartonStatusResult> {
  const normalizedAsn = normalizeASN(options.asnNoOriginal);
  try {
    await apiService.updateCartonStatus({
      asn_no: options.asnNoOriginal,
      inbound_session: options.inboundSession,
      carton_id: options.cartonId,
      status: "Receiving",
      locked_by: options.userId,
      locked_on: options.lockedOnIso,
      user_id: options.userId,
      device_id: options.deviceId ?? undefined,
    });
  } catch (e: unknown) {
    if (isLikelyNetworkConnectionFailure(e)) {
      return { ok: false, kind: "network", message: SERVER_CONNECTION_LOST_MESSAGE };
    }
    const msg = String((e as Error)?.message || e || "");
    if (msg.includes("404")) {
      return {
        ok: false,
        kind: "api",
        message:
          msg ||
          `Carton ${options.cartonId} was not found on the server. Local Receiving status was not saved.`,
      };
    }
    return {
      ok: false,
      kind: "api",
      message: msg || "Failed to update carton status on server",
    };
  }

  try {
    await dataService.updateCartonStatus({
      asn_no: normalizedAsn,
      inbound_session: options.inboundSession,
      carton_id: options.cartonId,
      status: "Receiving",
      locked_by: options.userId,
      locked_on: options.lockedOnIso,
      updated_on: new Date().toISOString(),
    });
  } catch (dbErr: unknown) {
    return {
      ok: false,
      kind: "api",
      message: String((dbErr as Error)?.message || "Local database update failed"),
    };
  }

  return { ok: true };
}

export async function pushReceivedCartonStatusServerThenLocal(options: {
  asnNoOriginal: string;
  inboundSession: string;
  cartonId: string;
  userId: string;
  deviceId?: string | null;
  status?: "Received" | "Received with Shortage";
}): Promise<PushCartonStatusResult> {
  const normalizedAsn = normalizeASN(options.asnNoOriginal);
  const receivedStatus: "Received" | "Received with Shortage" =
    options.status || "Received";
  try {
    await apiService.updateCartonStatus({
      asn_no: options.asnNoOriginal,
      inbound_session: options.inboundSession,
      carton_id: options.cartonId,
      status: receivedStatus,
      user_id: options.userId,
      device_id: options.deviceId ?? undefined,
    });
  } catch (e: unknown) {
    if (isLikelyNetworkConnectionFailure(e)) {
      return { ok: false, kind: "network", message: SERVER_CONNECTION_LOST_MESSAGE };
    }
    const msg = String((e as Error)?.message || e || "");
    if (msg.includes("404")) {
      return {
        ok: false,
        kind: "api",
        message:
          msg ||
          `Carton ${options.cartonId} was not found on the server. Local Received status was not saved.`,
      };
    }
    return {
      ok: false,
      kind: "api",
      message: msg || "Failed to mark carton received on server",
    };
  }

  try {
    await dataService.updateCartonStatus({
      asn_no: normalizedAsn,
      inbound_session: options.inboundSession,
      carton_id: options.cartonId,
      status: receivedStatus,
      locked_by: "",
      locked_on: "",
      updated_on: new Date().toISOString(),
    });
  } catch (dbErr: unknown) {
    return {
      ok: false,
      kind: "api",
      message: String((dbErr as Error)?.message || "Local database update failed"),
    };
  }

  return { ok: true };
}
