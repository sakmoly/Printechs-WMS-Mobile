import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  FlatList,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useApp } from "../context/AppContext";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { StatusBadge } from "../components/StatusBadge";
import { addEvent } from "../services/event-queue.service";
import { dataService } from "../services/data.service";
import { getSettings } from "../services/settings.service";
import { normalizeASN } from "../utils/asn";
import { apiService } from "../services/api.service";
import { ProgressIndicator } from "../components/ProgressIndicator";
import { getDatabase } from "../database/database";
import {
  fetchBackendCartonUnloadBlockedFromASN,
  getServerUnloadLineForCarton,
  isDuplicateUnloadLinePostError,
  parseUnloadLinesResponse,
} from "../utils/inbound-unload-server-check";
import {
  collectCartonRowsFromAsnPayload,
  reconcileCartonStatusesFromBackendAsn,
} from "../utils/reconcile-carton-status-from-asn";
import { settingsMatchUnloadedActor } from "../utils/unload-actor-match";
import {
  parseAsnPayloadForReceiveSortServerBlock,
  fetchBackendReceiveSortBlockedFromASN,
} from "../utils/asn-carton-receive-server-gate";
import {
  parseAsnPayloadForCartonLock,
  isOtherScannerLock,
} from "../utils/inbound-carton-lock-from-asn";
import { getCurrentUserRole } from "../utils/user-role";

function actorFromUnloadLine(line: Record<string, unknown> | null | undefined): string {
  if (!line) return "";
  const v =
    line.scanned_by ??
    line.scannedBy ??
    line.user_name ??
    line.userName ??
    line.user_code ??
    line.userCode ??
    line.user_id ??
    line.userId ??
    line.owner ??
    line.owner_name ??
    line.created_by ??
    line.createdBy ??
    line.modified_by ??
    line.modifiedBy ??
    line.operator ??
    line.operator_name ??
    line.full_name ??
    line.fullName ??
    "";
  return String(v).trim();
}

/** GET unload-lines: device on the line or session hint from API. */
function deviceFromUnloadLine(line: Record<string, unknown> | null | undefined): string {
  if (!line) return "";
  const v =
    line.device_id ??
    line.deviceId ??
    line.device_hint_from_session ??
    line.deviceHintFromSession ??
    line.scanned_device_id ??
    line.scannedDeviceId ??
    "";
  return String(v).trim();
}

function unloadLineTimestampMs(line: Record<string, unknown>): number {
  const raw = String(
    line.scanned_on ??
      line.scannedOn ??
      line.creation ??
      line.created_at ??
      line.createdAt ??
      line.modified ??
      line.modified_on ??
      ""
  ).trim();
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
}

function currentUserDisplayForUnload(settings: {
  user_code?: string | null;
  user_id?: string | null;
}): string {
  return (
    String(settings.user_code || "").trim() ||
    String(settings.user_id || "").trim() ||
    ""
  );
}

function normalizeLockOwner(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function settingsMatchCartonLockOwner(
  settings: { user_id?: string | null; user_code?: string | null },
  lockedBy: unknown
): boolean {
  const owner = normalizeLockOwner(lockedBy);
  if (!owner) return false;

  return [settings.user_id, settings.user_code]
    .map(normalizeLockOwner)
    .filter(Boolean)
    .includes(owner);
}

function duplicateUnloadAlertMessage(
  cartonId: string,
  scannedBy: string,
  scannedOnShort: string,
  deviceLabel?: string
): string {
  const who = String(scannedBy || "").trim() || "another user";
  const when = String(scannedOnShort || "").trim();
  const dev = String(deviceLabel || "").trim() || "—";
  return (
    `Carton ${cartonId} was already unloaded on this session by ${who}` +
    (when ? ` at ${when}` : "") +
    ` · device ${dev}` +
    `.\n\nYou cannot unload it again here. If another phone still unloaded the same carton, it may be using a different inbound session id (unload lines use parent_title); use one shared session on all devices, or have the API reject duplicate ASN + carton.`
  );
}

/** Backend can return 500 + MySQL deadlock on busy carton status updates — brief retry. */
async function updateCartonStatusApiWithRetry(
  payload: Parameters<typeof apiService.updateCartonStatus>[0],
  maxAttempts = 4
): Promise<any> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await apiService.updateCartonStatus(payload);
    } catch (e: any) {
      lastErr = e;
      const s = String(e?.message ?? e ?? "");
      const transient =
        e?.status === 500 ||
        s.includes("500") ||
        s.includes("Deadlock") ||
        s.includes("deadlock") ||
        s.includes("DATABASE_ERROR") ||
        s.includes("try restarting transaction");
      if (transient && attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 150 * Math.pow(2, attempt)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

export default function UnloadScreen() {
  const navigation = useNavigation();
  const goToReceiveSort = React.useCallback(
    (cartonId?: string) => {
      if (cartonId) {
        (navigation as any).navigate("ReceiveSort", { cartonId });
      } else {
        (navigation as any).navigate("ReceiveSort");
      }
    },
    [navigation]
  );
  const { activeASN, activeSession } = useApp();
  const [cartons, setCartons] = useState<any[]>([]);
  const [totalCartons, setTotalCartons] = useState<number>(0);
  const [scannedCartons, setScannedCartons] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [currentLockOwner, setCurrentLockOwner] = useState<{
    user_id?: string | null;
    user_code?: string | null;
  }>({});
  const [isSupervisorOrAdmin, setIsSupervisorOrAdmin] = useState(false);

  useEffect(() => {
    loadCartons();
  }, [activeASN, activeSession]);

  const loadCartons = async () => {
    if (!activeASN || !activeSession) return;

    const normalizedASN = normalizeASN(activeASN);
    const currentSettings = await getSettings();
    const roleInfo = await getCurrentUserRole();
    setCurrentLockOwner({
      user_id: currentSettings.user_id,
      user_code: currentSettings.user_code,
    });
    setIsSupervisorOrAdmin(roleInfo.isSupervisorOrAdmin);
    console.log("🔄 UnloadScreen: Loading cartons...", {
      activeASN, // Original format
      normalizedASN, // Normalized format
      activeSession,
    });

    // Get all cartons for this ASN from asn_carton_map (synced from desktop)
    // Try original format first (as cartons are stored with original format from desktop)
    // Then fall back to normalized format for backward compatibility
    const allCartons = await dataService.getASNCartonsForUnload(activeASN);
    
    // DEBUG: Check what ASN formats are actually in the database
    try {
      const db = await getDatabase();
      if (db) {
        const allASNFormatsInDB = await db.getAllAsync<{ asn_no: string; carton_count: number }>(
          `SELECT asn_no, COUNT(DISTINCT carton_id) as carton_count 
           FROM asn_carton_map 
           WHERE UPPER(TRIM(asn_no)) LIKE UPPER(TRIM(?))
           GROUP BY asn_no`,
          [`%${activeASN.replace(/[^A-Z0-9]/g, "")}%`]
        );
        console.warn(`🔍 DEBUG: All ASN formats in database matching "${activeASN}":`, allASNFormatsInDB);
        
        // Also check exact matches
        const exactMatches = await db.getAllAsync<{ asn_no: string; carton_count: number }>(
          `SELECT asn_no, COUNT(DISTINCT carton_id) as carton_count 
           FROM asn_carton_map 
           WHERE asn_no IN (?, ?)
           GROUP BY asn_no`,
          [activeASN, normalizeASN(activeASN)]
        );
        console.warn(`🔍 DEBUG: Exact ASN matches in database:`, exactMatches);
      }
    } catch (debugError: any) {
      console.warn(`⚠️ Debug query failed:`, debugError.message);
    }
    
    // CRITICAL: Load session data from BOTH local database AND backend API
    // This ensures we show the correct count even if data is only in backend
    let sessionTotalCartons = 0;
    let sessionCompletedCartons = 0;
    
    // First, try local database
    try {
      const db = await getDatabase();
      const localSessionData = await db.getFirstAsync<{
        total_cartons: number;
        completed_cartons: number;
      }>(
        "SELECT total_cartons, completed_cartons FROM inbound_sessions WHERE inbound_session = ?",
        [activeSession]
      );
      if (localSessionData && localSessionData.total_cartons > 0) {
        sessionTotalCartons = localSessionData.total_cartons;
        sessionCompletedCartons = localSessionData.completed_cartons || 0;
        console.warn(`📊 UnloadScreen: Found session data from local database:`, {
          total_cartons: sessionTotalCartons,
          completed_cartons: sessionCompletedCartons,
        });
      }
    } catch (localError: any) {
      console.warn(`⚠️ Could not get session data from local database:`, localError.message);
    }
    
    // Always try backend API for session (to get latest completed_cartons so we can show "received" when ASN already received)
    try {
      const settings = await getSettings();
      if (settings.api_url && settings.demo_mode !== 1) {
        const backendSessions = await apiService.getInboundSessions();
        let sessionsList: any[] = [];
        if (Array.isArray(backendSessions)) {
          sessionsList = backendSessions;
        } else if (backendSessions?.data && Array.isArray(backendSessions.data)) {
          sessionsList = backendSessions.data;
        } else if (backendSessions?.sessions && Array.isArray(backendSessions.sessions)) {
          sessionsList = backendSessions.sessions;
        }
        const matchingSession = sessionsList.find((s: any) =>
          (s.inbound_session || s.title) === activeSession
        );
        if (matchingSession) {
          const backendTotal = matchingSession.total_cartons || matchingSession.totalCartons || 0;
          const backendCompleted = matchingSession.completed_cartons || matchingSession.completedCartons || 0;
          if (sessionTotalCartons === 0) {
            sessionTotalCartons = backendTotal;
            sessionCompletedCartons = backendCompleted;
            console.warn(`✅ Session from backend:`, { session_id: activeSession, total_cartons: sessionTotalCartons, completed_cartons: sessionCompletedCartons });
          }
          // Save/update session in local DB
          try {
            const db = await getDatabase();
            if (db) {
              await db.runAsync(
                `INSERT OR REPLACE INTO inbound_sessions 
                 (inbound_session, asn_no, status, total_cartons, completed_cartons, updated_on)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                  activeSession,
                  normalizedASN,
                  matchingSession.status || "Receiving",
                  backendTotal || sessionTotalCartons,
                  backendCompleted || sessionCompletedCartons,
                  new Date().toISOString(),
                ]
              );
            }
          } catch (_) {}
        }
      }
    } catch (backendError: any) {
      console.warn(`⚠️ Could not load session data from backend API:`, backendError.message);
    }

    // Prefer distinct supplier cartons from asn_carton_map (ground truth on device).
    // Session total_cartons can be stale or out of sync with the synced map and look "stuck".
    const mapDistinctCount = allCartons.length;
    const finalTotalCartons =
      mapDistinctCount > 0
        ? mapDistinctCount
        : sessionTotalCartons > 0
          ? sessionTotalCartons
          : 0;
    setTotalCartons(finalTotalCartons);
    
    console.warn(`📦 UnloadScreen: Carton counts:`, {
      distinct_from_map: mapDistinctCount,
      session_total_hint: sessionTotalCartons,
      displayed_total: finalTotalCartons,
    });

    // ALWAYS try to load cartons from backend ASN details to ensure we have the latest data
    // This ensures cartons are synced even if local database is missing them
    // Load from backend if: local count is less than session count, OR local count is 0
    if (allCartons.length < sessionTotalCartons || allCartons.length === 0) {
      console.warn(`⚠️ Carton count mismatch: Local=${allCartons.length}, Session=${sessionTotalCartons}. Loading from backend...`);
      try {
        const asnDetails = await apiService.getASN(activeASN);
        console.warn(`📦 Backend ASN details response structure:`, {
          hasDetails: !!asnDetails?.details,
          hasCartons: !!asnDetails?.cartons,
          hasData: !!asnDetails?.data,
          asn_no: asnDetails?.asn_no || asnDetails?.data?.asn_no,
          detailsLength: Array.isArray(asnDetails?.details) ? asnDetails.details.length : 0,
          cartonsLength: Array.isArray(asnDetails?.cartons) ? asnDetails.cartons.length : 0,
          dataDetailsLength: Array.isArray(asnDetails?.data?.details) ? asnDetails.data.details.length : 0,
          dataCartonsLength: Array.isArray(asnDetails?.data?.cartons) ? asnDetails.data.cartons.length : 0,
        });
        
        // Extract ASN number from response (might be in different locations)
        const backendASN = asnDetails?.asn_no || asnDetails?.data?.asn_no || asnDetails?.advance_shipping_notice || activeASN;
        console.warn(`📦 Using ASN format from backend: "${backendASN}" (original: "${activeASN}")`);
        
        // Handle different response formats
        let details: any[] = [];
        let cartonsData: any[] = [];
        
        if (asnDetails?.details && Array.isArray(asnDetails.details)) {
          details = asnDetails.details;
        } else if (asnDetails?.data?.details && Array.isArray(asnDetails.data.details)) {
          details = asnDetails.data.details;
        }
        
        if (asnDetails?.cartons && Array.isArray(asnDetails.cartons)) {
          cartonsData = asnDetails.cartons;
        } else if (asnDetails?.data?.cartons && Array.isArray(asnDetails.data.cartons)) {
          cartonsData = asnDetails.data.cartons;
        }
        
        if (details.length > 0 || cartonsData.length > 0) {
          const db = await getDatabase();
          if (!db) {
            console.warn(`⚠️ Database not available for carton sync`);
          } else {
            // Use backend ASN format (might be different from activeASN)
            const asnToUse = backendASN;
            let cartonsAdded = 0;
            const uniqueCartonIds = new Set<string>();
            
            // Populate asn_carton_map from ASN details
            for (const detail of details) {
              if (detail.carton_id && detail.item_code) {
                uniqueCartonIds.add(detail.carton_id);
                await db.runAsync(
                  `INSERT OR REPLACE INTO asn_carton_map 
                   (asn_no, carton_id, item_code, shipped_qty) 
                   VALUES (?, ?, ?, ?)`,
                  [
                    asnToUse, // Use ASN format from backend
                    detail.carton_id,
                    detail.item_code,
                    detail.shipped_qty || detail.expected_qty || 0,
                  ]
                );
                cartonsAdded++;
              }
            }
            
            // Handle cartons array format
            for (const carton of cartonsData) {
              if (carton.carton_id) {
                uniqueCartonIds.add(carton.carton_id);
                if (carton.items && Array.isArray(carton.items)) {
                  for (const item of carton.items) {
                    await db.runAsync(
                      `INSERT OR REPLACE INTO asn_carton_map 
                       (asn_no, carton_id, item_code, shipped_qty) 
                       VALUES (?, ?, ?, ?)`,
                      [
                        asnToUse, // Use ASN format from backend
                        carton.carton_id,
                        item.item_code,
                        item.shipped_qty || 0,
                      ]
                    );
                    cartonsAdded++;
                  }
                }
              }
            }
            
            console.warn(`✅ Added ${cartonsAdded} carton entry/entries from backend ASN details`);
            console.warn(`✅ Found ${uniqueCartonIds.size} unique carton(s):`, Array.from(uniqueCartonIds));
            
            // Re-fetch cartons after populating - try both ASN formats
            let reloadedCartons = await dataService.getASNCartonsForUnload(asnToUse);
            if (reloadedCartons.length === 0 && asnToUse !== activeASN) {
              // Also try with original activeASN format
              reloadedCartons = await dataService.getASNCartonsForUnload(activeASN);
            }
            console.warn(`✅ Reloaded ${reloadedCartons.length} distinct carton(s) after backend sync`);
            
            // Update allCartons for use below
            allCartons.length = 0;
            allCartons.push(...reloadedCartons);
          }
        } else {
          console.warn(`⚠️ Backend ASN details response doesn't contain carton data (details=${details.length}, cartons=${cartonsData.length})`);
        }
      } catch (asnError: any) {
        console.warn(`⚠️ Could not load cartons from backend ASN details:`, asnError.message);
      }
    }

    // Create set of valid carton IDs from desktop (for filtering)
    const validCartonIds = new Set(allCartons);

    // CRITICAL: Load unload lines from backend — canonical dock actor is scanned_by + device_id on the line.
    // Every device must show the same user/device (not whoever last wrote local SQLite).
    const serverUnloadByCarton = new Map<
      string,
      { cartonId: string; who: string; ts: string; deviceLabel: string }
    >();
    const serverOwnerByCarton = new Map<
      string,
      { owner: string; lockedOn: string | null }
    >();
    try {
      const unloadLines = await apiService.getUnloadLines(activeSession);
      const linesList = parseUnloadLinesResponse(unloadLines);

      for (const line of linesList) {
        const cartonId = String(line.unit_id || line.carton_id || "").trim();
        if (!cartonId) continue;
        const ut = String(line.unit_type ?? "").trim();
        if (ut && ut.toLowerCase() !== "carton") continue;
        const row = line as Record<string, unknown>;
        const who = actorFromUnloadLine(row);
        const deviceLabel = deviceFromUnloadLine(row);
        const k = cartonId.toUpperCase();
        const ts = String(
          row.scanned_on ??
            row.created_at ??
            row.creation ??
            new Date().toISOString()
        );
        const prev = serverUnloadByCarton.get(k);
        const tNew = unloadLineTimestampMs(row);
        const tOld = prev ? Date.parse(prev.ts) : NaN;
        // Earliest unload wins; on equal time prefer first non-empty scanned_by / device_id.
        if (!prev || !Number.isFinite(tOld) || tNew < tOld) {
          serverUnloadByCarton.set(k, { cartonId, who, ts, deviceLabel });
        } else if (Number.isFinite(tOld) && tNew === tOld) {
          serverUnloadByCarton.set(k, {
            cartonId,
            who: prev.who || who,
            ts,
            deviceLabel: prev.deviceLabel || deviceLabel,
          });
        }
      }

      if (linesList.length > 0) {
        console.warn(
          `📦 Found ${linesList.length} unload line(s) from backend for session ${activeSession} (${serverUnloadByCarton.size} carton(s) with unload line data)`
        );

        for (const { cartonId, who, ts } of serverUnloadByCarton.values()) {
          const existingStatus = await dataService.getCartonStatus(
            activeASN,
            activeSession,
            cartonId
          );

          if (!existingStatus || existingStatus.status === "Pending") {
            await dataService.updateCartonStatus({
              asn_no: activeASN,
              inbound_session: activeSession,
              carton_id: cartonId,
              status: "Unloaded",
              unloaded_by: who || undefined,
              updated_on: ts,
            });
            console.warn(
              `✅ Updated carton ${cartonId} to Unloaded from unload line (by ${who || "(no scanned_by)"})`
            );
          } else if (existingStatus.status === "Unloaded") {
            // Overwrite local unloaded_by so all handsets match server unload-line
            const local = String(existingStatus.unloaded_by || "").trim();
            if (who && local !== who) {
              await dataService.updateCartonStatus({
                asn_no: activeASN,
                inbound_session: activeSession,
                carton_id: cartonId,
                status: "Unloaded",
                unloaded_by: who,
                updated_on: ts || existingStatus.updated_on,
              });
              console.warn(
                `✅ Reconciled unloaded_by for ${cartonId}: "${local}" → "${who}" (server)`
              );
            }
          }
        }

        // Unload lines exist for cartons not in map (no scanned_by): still mark Pending → Unloaded
        for (const line of linesList) {
          const cartonId = String(line.unit_id || line.carton_id || "").trim();
          if (!cartonId) continue;
          const ut = String(line.unit_type ?? "").trim();
          if (ut && ut.toLowerCase() !== "carton") continue;
          if (serverUnloadByCarton.has(cartonId.toUpperCase())) continue;
          const existingStatus = await dataService.getCartonStatus(
            activeASN,
            activeSession,
            cartonId
          );
          if (!existingStatus || existingStatus.status === "Pending") {
            await dataService.updateCartonStatus({
              asn_no: activeASN,
              inbound_session: activeSession,
              carton_id: cartonId,
              status: "Unloaded",
              updated_on:
                line.scanned_on || line.created_at || new Date().toISOString(),
            });
          }
        }

        console.warn(
          `✅ Applied unload lines for session ${activeSession} (server actor reconciled)`
        );
      }
    } catch (unloadLinesError: any) {
      // Not critical - continue with local statuses
      console.warn(`⚠️ Could not load unload lines from backend:`, unloadLinesError.message);
    }

    // Fallback owner source: ASN detail rows expose "Opened By" / locked_by even when
    // unload-lines for this session don't include scanned_by.
    try {
      const settingsOwner = await getSettings();
      if (settingsOwner.api_url && settingsOwner.demo_mode !== 1) {
        const asnRes = await apiService.getASN(activeASN.trim());
        const rowsByCarton = collectCartonRowsFromAsnPayload(asnRes);
        for (const [cartonId, row] of rowsByCarton.entries()) {
          const owner = String(row.unloaded_actor || row.locked_by || "").trim();
          if (owner) {
            serverOwnerByCarton.set(cartonId.toUpperCase(), {
              owner,
              lockedOn: row.locked_on,
            });
          }
        }
      }
    } catch (ownerError: any) {
      console.warn(`⚠️ Could not load ASN owner fields:`, ownerError.message);
    }

    // Sync carton status FROM backend when desktop already marked cartons as Received
    // (Desktop shows "Received" but mobile may still have Pending if receiving was done elsewhere)
    try {
      const asnRes = await apiService.getASN(activeASN);
      const detailsList: any[] = asnRes?.details ?? asnRes?.data?.details ?? [];
      const cartonsList: any[] = asnRes?.cartons ?? asnRes?.data?.cartons ?? [];
      const cartonIdsMarkedReceived = new Set<string>();
      for (const d of detailsList) {
        const cid = d.carton_id ?? d.cartonId;
        const st = (d.carton_status ?? d.receiving_status ?? d.status ?? "").toString().toLowerCase();
        if (cid && (st === "received" || st === "unloaded")) cartonIdsMarkedReceived.add(cid);
      }
      for (const c of cartonsList) {
        const cid = c.carton_id ?? c.cartonId;
        const st = (c.carton_status ?? c.status ?? c.receiving_status ?? "").toString().toLowerCase();
        if (cid && (st === "received" || st === "unloaded")) cartonIdsMarkedReceived.add(cid);
      }
      // Do not expand ASN-level "Received" to every carton — that makes Unload counts jump to
      // total/total with no per-carton scans. Rely on per-carton flags from details/cartons only.
      const asnStatus = (asnRes?.status ?? asnRes?.receiving_status ?? asnRes?.data?.status ?? asnRes?.data?.receiving_status ?? "").toString().toLowerCase();
      if (asnStatus === "received" || asnStatus === "completed") {
        console.warn(
          `ℹ️ ASN-level status is "${asnStatus}" — not auto-marking all cartons (use per-carton status from payload only)`
        );
      }
      if (cartonIdsMarkedReceived.size > 0) {
        for (const cartonId of cartonIdsMarkedReceived) {
          const existing = await dataService.getCartonStatus(activeASN, activeSession, cartonId);
          if (!existing || existing.status === "Pending") {
            await dataService.updateCartonStatus({
              asn_no: activeASN,
              inbound_session: activeSession,
              carton_id: cartonId,
              status: "Unloaded",
              updated_on: new Date().toISOString(),
            });
            console.warn(`✅ Updated carton ${cartonId} to Unloaded from backend ASN status`);
          }
        }
        console.warn(`✅ Synced ${cartonIdsMarkedReceived.size} carton(s) from backend ASN (Received → Unloaded on mobile)`);
      }
    } catch (e: any) {
      console.warn(`⚠️ Could not sync carton status from backend ASN:`, e?.message);
    }

    // Live lock / receiving state: GET ASN from server, then upsert SQLite so every handset matches.
    try {
      const settingsRecon = await getSettings();
      if (settingsRecon.api_url && settingsRecon.demo_mode !== 1) {
        const recon = await reconcileCartonStatusesFromBackendAsn({
          asnNoOriginal: activeASN,
          inboundSession: activeSession,
          cartonIds: validCartonIds,
        });
        if (!recon.ok && recon.networkError) {
          Alert.alert("Server connection lost", recon.message);
        } else if (!recon.ok) {
          console.warn(`⚠️ Carton lock reconcile skipped:`, recon.message);
        } else if (recon.updated > 0) {
          console.log(
            `✅ Reconciled ${recon.updated} carton status row(s) from server ASN (locks / receiving)`
          );
        }
      }
    } catch (reconErr: any) {
      console.warn(`⚠️ Carton status reconcile error:`, reconErr?.message);
    }

    // Do not bulk-mark every carton Unloaded when session counters say "complete" — that freezes
    // Unload at scanned === total with no incremental dock scans.

    // Get carton statuses for this session
    // Use original ASN format first, then normalized for backward compatibility
    const statuses = await dataService.getAllCartonStatuses(
      activeASN, // Use original format first
      activeSession
    );
    console.warn("📦 UnloadScreen: Loaded carton statuses:", {
      activeSession,
      normalizedASN,
      statuses_count: statuses.length,
      statuses: statuses.map((c) => ({
        carton: c.carton_id,
        status: c.status,
        session: c.inbound_session,
        locked_by: c.locked_by,
        locked_on: c.locked_on,
      })),
    });

    // Filter statuses to only include cartons that exist in asn_carton_map (from desktop)
    // This ensures we only show valid cartons, not demo or orphaned cartons
    const filteredStatuses = statuses.filter((status) =>
      validCartonIds.has(status.carton_id)
    );

    /** Prefer GET unload-lines scanned_by + device_id so every handset matches server. */
    const applyServerUnloadActors = <
      T extends {
        carton_id: string;
        status: string;
        unloaded_by?: string | null;
        locked_by?: string | null;
        locked_on?: string | null;
      }
    >(
      list: T[]
    ): T[] =>
      list.map((s) => {
        if (s.status !== "Unloaded") return s;
        const row = serverUnloadByCarton.get(
          String(s.carton_id || "").trim().toUpperCase()
        );
        const asnOwner = serverOwnerByCarton.get(
          String(s.carton_id || "").trim().toUpperCase()
        );
        if (!row && !asnOwner) return s;
        const out = { ...s } as T & { unloaded_device_label?: string };
        const owner = String(row?.who || asnOwner?.owner || "").trim();
        if (owner) (out as { unloaded_by?: string }).unloaded_by = owner;
        if (asnOwner?.owner) {
          (out as { locked_by?: string }).locked_by = asnOwner.owner;
        }
        if (asnOwner?.lockedOn) {
          (out as { locked_on?: string }).locked_on = asnOwner.lockedOn;
        }
        const dev = String(row?.deviceLabel || "").trim();
        if (dev) {
          (out as { unloaded_device_label?: string }).unloaded_device_label =
            dev;
        }
        return out;
      });

    if (filteredStatuses.length !== statuses.length) {
      // Only log if significant number of invalid statuses (more than 1)
      if (statuses.length - filteredStatuses.length > 1) {
        console.warn(
          `⚠️ Filtered out ${statuses.length - filteredStatuses.length} invalid carton status(es). ` +
          `Only showing ${filteredStatuses.length} valid carton(s) from desktop.`
        );
      }
    }

    // Check if there are cartons from desktop that don't have statuses yet
    // Initialize statuses for missing cartons (even if some cartons already have statuses)
    const cartonsWithStatuses = new Set(filteredStatuses.map(s => s.carton_id));
    const missingCartons = allCartons.filter(cartonId => !cartonsWithStatuses.has(cartonId));
    
    if (missingCartons.length > 0) {
      console.log(
        `📦 Found ${missingCartons.length} carton(s) from desktop without statuses. Initializing...`
      );
      const settings = await getSettings();
      // Initialize carton statuses for missing cartons from desktop
      for (const cartonId of missingCartons) {
        await dataService.updateCartonStatus({
          asn_no: activeASN, // Use original format to match carton storage
          inbound_session: activeSession,
          carton_id: cartonId,
          status: "Pending",
          updated_on: new Date().toISOString(),
        });
        
        // Sync "Pending" status to backend so desktop app can see initial status
        try {
          console.log(`📡 Syncing initial Pending status for carton ${cartonId} to backend:`, {
            carton: cartonId,
            asn: activeASN,
            session: activeSession,
            status: "Pending",
          });
          await apiService.updateCartonStatus({
            asn_no: activeASN, // Use original format from desktop
            inbound_session: activeSession,
            carton_id: cartonId,
            status: "Pending",
            user_id: settings.user_id,
            device_id: settings.device_id,
          });
          console.log(`✅ Carton ${cartonId} initial status synced to backend: Pending`);
        } catch (apiError: any) {
          console.warn(
            `⚠️ Failed to sync carton ${cartonId} initial status to backend:`,
            apiError.message
          );
          // Don't block - this is just initialization
        }
      }
      // Reload statuses after initialization
      const reloadedStatuses = await dataService.getAllCartonStatuses(
        activeASN, // Use original format
        activeSession
      );
      const validReloadedStatuses = reloadedStatuses.filter((status) =>
        validCartonIds.has(status.carton_id)
      );
      // Merge with existing filtered statuses
      const allValidStatuses = [...filteredStatuses];
      for (const newStatus of validReloadedStatuses) {
        if (!cartonsWithStatuses.has(newStatus.carton_id)) {
          allValidStatuses.push(newStatus);
        }
      }
      const displayed = applyServerUnloadActors(allValidStatuses);
      setCartons(displayed);
      const scannedCount = displayed.filter(
        (c) =>
          c.status === "Unloaded" ||
          c.status === "Receiving" ||
          c.status === "Received"
      ).length;
      setScannedCartons(scannedCount);
      console.log(
        `✅ Initialized ${missingCartons.length} missing carton status(es). Total cartons: ${displayed.length}`
      );
      return;
    }

    // If no valid statuses found at all, initialize statuses for cartons from desktop
    if (filteredStatuses.length === 0 && allCartons.length > 0) {
      console.log(
        `📦 No statuses found for current session, initializing ${allCartons.length} carton(s) from desktop...`
      );
      const settings = await getSettings();
      // Initialize carton statuses for all cartons from desktop
      for (const cartonId of allCartons) {
        await dataService.updateCartonStatus({
          asn_no: activeASN, // Use original format to match carton storage
          inbound_session: activeSession,
          carton_id: cartonId,
          status: "Pending",
          updated_on: new Date().toISOString(),
        });
        
        // Sync "Pending" status to backend so desktop app can see initial status
        try {
          console.log(`📡 Syncing initial Pending status for carton ${cartonId} to backend:`, {
            carton: cartonId,
            asn: activeASN,
            session: activeSession,
            status: "Pending",
          });
          await apiService.updateCartonStatus({
            asn_no: activeASN, // Use original format from desktop
            inbound_session: activeSession,
            carton_id: cartonId,
            status: "Pending",
            user_id: settings.user_id,
            device_id: settings.device_id,
          });
          console.log(`✅ Carton ${cartonId} initial status synced to backend: Pending`);
        } catch (apiError: any) {
          console.warn(
            `⚠️ Failed to sync carton ${cartonId} initial status to backend:`,
            apiError.message
          );
          // Don't block - this is just initialization
        }
      }
      // Reload statuses after initialization
      const initializedStatuses = await dataService.getAllCartonStatuses(
        activeASN, // Use original format
        activeSession
      );
      const validInitializedStatuses = initializedStatuses.filter((status) =>
        validCartonIds.has(status.carton_id)
      );
      setCartons(applyServerUnloadActors(validInitializedStatuses));
      setScannedCartons(0);
      console.log(
        `✅ Initialized ${validInitializedStatuses.length} carton status(es) from desktop`
      );
      return;
    }

    // If no statuses found, check if there are statuses with empty session (from demo data)
    // But only migrate valid cartons (those in asn_carton_map)
    if (filteredStatuses.length === 0 && statuses.length === 0) {
      console.log(
        "⚠️ No statuses found for current session, checking for statuses with empty session..."
      );
      const allStatuses = await dataService.getAllCartonStatuses(
        activeASN, // Use original format
        ""
      );
      console.log("📦 Found statuses with empty session:", allStatuses.length);
      
      // Filter to only migrate valid cartons (from desktop)
      const validOldStatuses = allStatuses.filter((status) =>
        validCartonIds.has(status.carton_id)
      );
      
      if (validOldStatuses.length > 0) {
        // Migrate only valid old statuses to current session
        console.log(`🔄 Migrating ${validOldStatuses.length} valid statuses to current session...`);
        for (const oldStatus of validOldStatuses) {
          await dataService.updateCartonStatus({
            ...oldStatus,
            inbound_session: activeSession,
          });
        }
        // Reload with current session
        const migratedStatuses = await dataService.getAllCartonStatuses(
          activeASN, // Use original format
          activeSession
        );
        const validMigratedStatuses = migratedStatuses.filter((status) =>
          validCartonIds.has(status.carton_id)
        );
        const displayedM = applyServerUnloadActors(validMigratedStatuses);
        setCartons(displayedM);
        const scannedCount = displayedM.filter(
          (c) =>
            c.status === "Unloaded" ||
            c.status === "Receiving" ||
            c.status === "Received"
        ).length;
        setScannedCartons(scannedCount);
        console.log(
          `✅ Migrated ${validMigratedStatuses.length} valid statuses to session ${activeSession}`
        );
        return;
      }
    }

    // Use filtered statuses (only valid cartons from desktop)
    const displayedMain = applyServerUnloadActors(filteredStatuses);
    setCartons(displayedMain);

    // Count scanned cartons (Unloaded, Receiving, or Received) from filtered statuses
    const scannedCount = displayedMain.filter(
      (c) =>
        c.status === "Unloaded" ||
        c.status === "Receiving" ||
        c.status === "Received"
    ).length;
    setScannedCartons(scannedCount);
    console.log(
      `✅ UnloadScreen: Total cartons from desktop: ${allCartons.length}, ` +
      `Valid statuses: ${filteredStatuses.length}, Scanned: ${scannedCount}`
    );
  };

  // Refresh carton status when screen is focused (e.g., returning from ReceiveSort)
  useFocusEffect(
    useCallback(() => {
      console.log("🔄 UnloadScreen focused, refreshing carton status...");
      loadCartons();
    }, [activeASN, activeSession])
  );

  const handleCartonScan = async (barcode: string) => {
    if (!activeASN || !activeSession) {
      Alert.alert("Error", "No active inbound session");
      return;
    }

    const cartonId = barcode.trim().toUpperCase();
    const normalizedASN = normalizeASN(activeASN);
    
    // Validate that carton belongs to the active ASN
    // Use original ASN format first (cartons are stored with original format)
    const isValidCarton = await dataService.isCartonInASN(
      activeASN, // Use original format first
      cartonId
    );
    if (!isValidCarton) {
      Alert.alert(
        "Invalid Carton",
        `Carton ${cartonId} does not belong to ASN ${activeASN}.\n\nPlease scan a carton from the current shipment.`
      );
      return;
    }

    const okSupplierUnload =
      await dataService.isCartonValidForSupplierUnload(activeASN, cartonId);
    if (!okSupplierUnload) {
      Alert.alert(
        "Not a supplier unload carton",
        `${cartonId} matches a distribution BOX barcode (Receive + Sort) or is only a local placeholder tied to that BOX — it is not listed as a supplier carton for this ASN.\n\nUnload only the cartons shown above, or use Receive + Sort with this BOX ID.`
      );
      return;
    }

    // Always fetch latest carton status from database to ensure accuracy
    const settings = await getSettings();

    console.log(`🔍 Scanning carton ${cartonId}, fetching latest status...`, {
      activeASN, // Original format
      normalizedASN, // Normalized format
      activeSession,
      currentUserId: settings.user_id,
      demoMode: settings.demo_mode,
    });

    // Use original ASN format first for getCartonStatus (matches how cartons are stored)
    const latestStatus = await dataService.getCartonStatus(
      activeASN, // Use original format first
      activeSession,
      cartonId
    );

    console.log(`🔍 Latest status from database:`, {
      status: latestStatus?.status,
      locked_by: latestStatus?.locked_by,
      locked_on: latestStatus?.locked_on,
      has_locked_by: !!latestStatus?.locked_by,
      locked_by_type: typeof latestStatus?.locked_by,
      locked_by_value: JSON.stringify(latestStatus?.locked_by),
      full_status_object: JSON.stringify(latestStatus),
    });

    if (latestStatus) {
      if (latestStatus.status === "Unloaded") {
        const unloadedBy = String(
          (latestStatus as { unloaded_by?: string | null }).unloaded_by || ""
        ).trim();
        if (
          unloadedBy &&
          !settingsMatchUnloadedActor(settings, unloadedBy)
        ) {
          Alert.alert(
            "Already unloaded",
            `This carton was already unloaded by ${unloadedBy}. Only that user can continue to receive and sort.`
          );
          return;
        }
        if (settings.demo_mode !== 1 && settings.api_url) {
          try {
            const recv = await fetchBackendReceiveSortBlockedFromASN(
              activeASN,
              cartonId
            );
            if (recv.blocked) {
              await dataService.updateCartonStatus({
                asn_no: activeASN,
                inbound_session: activeSession,
                carton_id: cartonId,
                status: "Received",
                locked_by: "",
                locked_on: "",
                updated_on: new Date().toISOString(),
              });
              await loadCartons();
              Alert.alert(
                "Carton already completed",
                recv.reason ??
                  "This carton was already received on the server. Your list has been updated."
              );
              return;
            }
          } catch (e: any) {
            Alert.alert(
              "Could not verify with server",
              `${e?.message || "Unknown error"}\n\nCheck your connection and try again.`
            );
            return;
          }
        }
        goToReceiveSort(cartonId);
        return;
      }

      if (latestStatus.status === "Receiving") {
        // Check if locked by current user
        const lockedBy = latestStatus.locked_by
          ? String(latestStatus.locked_by).trim()
          : "";
        const currentUserId = settings.user_id
          ? String(settings.user_id).trim()
          : "";
        const currentUserCode = settings.user_code
          ? String(settings.user_code).trim()
          : "";

        console.log(`🔍 Comparing lock status:`, {
          locked_by: lockedBy,
          locked_by_raw: latestStatus.locked_by,
          current_user: currentUserId,
          current_user_code: currentUserCode,
          current_user_raw: settings.user_id,
          match: settingsMatchCartonLockOwner(settings, lockedBy),
          match_upper: settingsMatchCartonLockOwner(settings, lockedBy),
          locked_by_length: lockedBy.length,
          current_user_length: currentUserId.length,
          both_empty: !lockedBy && !currentUserId,
        });

        const isSameUser = settingsMatchCartonLockOwner(settings, lockedBy);

        if (isSameUser) {
          // Same user - show resume dialog
          console.log(
            `✅ Carton ${cartonId} is locked by current user, showing resume dialog`
          );
          Alert.alert(
            "Carton Already Locked",
            `Carton ${cartonId} is already locked by you.\n\nWould you like to resume work on this carton?`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Resume",
                onPress: () => {
                  console.log(`📦 Resuming work on carton: ${cartonId}`);
                  goToReceiveSort(cartonId);
                },
              },
            ]
          );
          return;
        } else {
          // Locked by different user or no locked_by info
          console.log(
            `⚠️ Carton ${cartonId} is locked by different user or has no lock info`,
            {
              lockedBy,
              currentUserId,
              reason: !lockedBy
                ? "no_locked_by"
                : !currentUserId
                ? "no_current_user"
                : "different_user",
              locked_by_value: JSON.stringify(latestStatus.locked_by),
              user_id_value: JSON.stringify(settings.user_id),
            }
          );

          if (settings.demo_mode !== 1 && settings.api_url) {
            try {
              const asnRes = await apiService.getASN(activeASN.trim());
              const recv = parseAsnPayloadForReceiveSortServerBlock(
                asnRes,
                cartonId
              );
              if (recv.blocked) {
                await dataService.updateCartonStatus({
                  asn_no: activeASN,
                  inbound_session: activeSession,
                  carton_id: cartonId,
                  status: "Received",
                  locked_by: "",
                  locked_on: "",
                  updated_on: new Date().toISOString(),
                });
                await loadCartons();
                Alert.alert(
                  "Carton already completed",
                  recv.reason ??
                    "Server shows this carton as already received. Your list has been updated."
                );
                return;
              }
              const backendLock = parseAsnPayloadForCartonLock(asnRes, cartonId);
              if (
                backendLock &&
                isOtherScannerLock(
                  backendLock,
                  settings.user_id || "",
                  settings.device_id || ""
                )
              ) {
                await dataService.updateCartonStatus({
                  asn_no: activeASN,
                  inbound_session: activeSession,
                  carton_id: cartonId,
                  status: "Receiving",
                  locked_by: backendLock.locked_by || undefined,
                  locked_on: new Date().toISOString(),
                  updated_on: new Date().toISOString(),
                });
                await loadCartons();
                Alert.alert(
                  "Carton in use",
                  `Another device is receiving this carton (per server).\n\nUser: ${
                    backendLock.locked_by || "unknown"
                  }\n\nYou cannot take over this session from here.`
                );
                return;
              }
            } catch (e: any) {
              Alert.alert(
                "Could not verify with server",
                `${e?.message || "Unknown error"}\n\nCheck your connection and try again.`
              );
              return;
            }
          }

          Alert.alert(
            "Carton In Use",
            `Carton ${cartonId} is currently being processed by ${
              lockedBy || "another user"
            }.\n\nPlease select a different carton.`
          );
          return;
        }
      }

      if (latestStatus.status === "Received") {
        Alert.alert("Info", "Carton already received and completed");
        return;
      }
    } else {
      console.log(`⚠️ No status found for carton ${cartonId} in database`);
    }

    // Also check local state as fallback (in case database query fails)
    const existing = cartons.find((c) => c.carton_id === cartonId);
    if (existing) {
      if (existing.status === "Unloaded") {
        const unloadedBy = String(existing.unloaded_by || "").trim();
        if (
          unloadedBy &&
          !settingsMatchUnloadedActor(settings, unloadedBy)
        ) {
          Alert.alert(
            "Already unloaded",
            `This carton was already unloaded by ${unloadedBy}. Only that user can continue to receive and sort.`
          );
          return;
        }
        if (settings.demo_mode !== 1 && settings.api_url) {
          try {
            const recv = await fetchBackendReceiveSortBlockedFromASN(
              activeASN,
              cartonId
            );
            if (recv.blocked) {
              await dataService.updateCartonStatus({
                asn_no: activeASN,
                inbound_session: activeSession,
                carton_id: cartonId,
                status: "Received",
                locked_by: "",
                locked_on: "",
                updated_on: new Date().toISOString(),
              });
              await loadCartons();
              Alert.alert(
                "Carton already completed",
                recv.reason ??
                  "This carton was already received on the server. Your list has been updated."
              );
              return;
            }
          } catch (e: any) {
            Alert.alert(
              "Could not verify with server",
              `${e?.message || "Unknown error"}\n\nCheck your connection and try again.`
            );
            return;
          }
        }
        goToReceiveSort(cartonId);
        return;
      }
      if (existing.status === "Receiving") {
        const lockedBy = (existing.locked_by || "").trim();

        if (lockedBy && settingsMatchCartonLockOwner(settings, lockedBy)) {
          console.log(
            `✅ Carton ${cartonId} is locked by current user (from local state), showing resume dialog`
          );
          Alert.alert(
            "Carton Already Locked",
            `Carton ${cartonId} is already locked by you.\n\nWould you like to resume work on this carton?`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Resume",
                onPress: () => {
                  console.log(`📦 Resuming work on carton: ${cartonId}`);
                  goToReceiveSort(cartonId);
                },
              },
            ]
          );
          return;
        } else {
          Alert.alert(
            "Carton In Use",
            `Carton ${cartonId} is currently being processed by ${
              lockedBy || "another user"
            }.\n\nPlease select a different carton.`
          );
          return;
        }
      }
      if (existing.status === "Received") {
        Alert.alert("Info", "Carton already received and completed");
        return;
      }
    }

    // Server: refuse duplicate unload if another device already posted unload-line for this session
    if (settings.demo_mode !== 1 && settings.api_url) {
      try {
        const { line } = await getServerUnloadLineForCarton(
          activeSession,
          cartonId
        );
        if (line) {
          const lineRec = line as Record<string, unknown>;
          const scannedBy = actorFromUnloadLine(lineRec);
          const scannedOnRaw =
            line.scanned_on || line.created_at || line.modified || "";
          const scannedOn =
            typeof scannedOnRaw === "string" && scannedOnRaw.length > 10
              ? scannedOnRaw.slice(0, 19)
              : "";
          const devHint = deviceFromUnloadLine(lineRec);
          await dataService.updateCartonStatus({
            asn_no: activeASN,
            inbound_session: activeSession,
            carton_id: cartonId,
            status: "Unloaded",
            unloaded_by: scannedBy || undefined,
            updated_on: new Date().toISOString(),
          });
          await loadCartons();
          Alert.alert(
            "Carton already unloaded",
            duplicateUnloadAlertMessage(
              cartonId,
              scannedBy,
              scannedOn,
              devHint
            )
          );
          return;
        }

        const asnGate = await fetchBackendCartonUnloadBlockedFromASN(
          activeASN,
          cartonId
        );
        if (asnGate.blocked) {
          const sl = (asnGate.serverStatus || "").toLowerCase();
          let localStatus: "Unloaded" | "Receiving" | "Received" = "Unloaded";
          if (sl.includes("receiv") || sl === "locked") {
            localStatus = "Receiving";
          } else if (sl === "received") {
            localStatus = "Received";
          }
          const whoAsn = asnGate.locked_by?.trim();
          await dataService.updateCartonStatus({
            asn_no: activeASN,
            inbound_session: activeSession,
            carton_id: cartonId,
            status: localStatus,
            locked_by:
              localStatus === "Receiving"
                ? asnGate.locked_by || undefined
                : undefined,
            locked_on:
              localStatus === "Receiving"
                ? new Date().toISOString()
                : undefined,
            unloaded_by:
              localStatus === "Unloaded" && whoAsn ? whoAsn : undefined,
            updated_on: new Date().toISOString(),
          });
          await loadCartons();
          Alert.alert(
            whoAsn ? `Already unloaded by ${whoAsn}` : "Already unloaded",
            `Server status: ${asnGate.serverStatus || "unknown"}.\n\nYour list has been updated.`
          );
          return;
        }
      } catch (e: any) {
        Alert.alert(
          "Could not verify with server",
          `${e?.message || "Unknown error"}\n\nCheck your connection and try again.`
        );
        return;
      }
    }

    setLoading(true);
    try {
      const settings = await getSettings();
      const userId = settings.user_id || "USER-AUTO";

      // Final server re-check immediately before claim (reduces lost race vs earlier GET)
      if (settings.demo_mode !== 1 && settings.api_url) {
        const { line: lineAgain } = await getServerUnloadLineForCarton(
          activeSession,
          cartonId
        );
        if (lineAgain) {
          const lineRec = lineAgain as Record<string, unknown>;
          const scannedBy = actorFromUnloadLine(lineRec);
          const onRaw =
            lineAgain.scanned_on || lineAgain.created_at || lineAgain.modified || "";
          const onShort =
            typeof onRaw === "string" && onRaw.length > 10
              ? onRaw.slice(0, 19)
              : "";
          const devHint = deviceFromUnloadLine(lineRec);
          await dataService.updateCartonStatus({
            asn_no: activeASN,
            inbound_session: activeSession,
            carton_id: cartonId,
            status: "Unloaded",
            unloaded_by: scannedBy || undefined,
            updated_on: new Date().toISOString(),
          });
          await loadCartons();
          Alert.alert(
            "Carton already unloaded",
            duplicateUnloadAlertMessage(cartonId, scannedBy, onShort, devHint)
          );
          return;
        }
        const gateAgain = await fetchBackendCartonUnloadBlockedFromASN(
          activeASN,
          cartonId
        );
        if (gateAgain.blocked) {
          const sl = (gateAgain.serverStatus || "").toLowerCase();
          let localStatus: "Unloaded" | "Receiving" | "Received" = "Unloaded";
          if (sl.includes("receiv") || sl === "locked") {
            localStatus = "Receiving";
          } else if (sl === "received") {
            localStatus = "Received";
          }
          const who = gateAgain.locked_by?.trim();
          await dataService.updateCartonStatus({
            asn_no: activeASN,
            inbound_session: activeSession,
            carton_id: cartonId,
            status: localStatus,
            locked_by:
              localStatus === "Receiving" ? who || undefined : undefined,
            locked_on:
              localStatus === "Receiving"
                ? new Date().toISOString()
                : undefined,
            unloaded_by:
              localStatus === "Unloaded" && who ? who : undefined,
            updated_on: new Date().toISOString(),
          });
          await loadCartons();
          Alert.alert(
            who ? `Already unloaded by ${who}` : "Already unloaded",
            `Server status: ${gateAgain.serverStatus || "unknown"}.\n\nYour list has been updated.`
          );
          return;
        }
      }

      // Claim unload on server first — two devices cannot both succeed if POST enforces uniqueness
      try {
        console.log(`📡 Calling POST /api/inbound/unload-line for carton ${cartonId}:`, {
          parent_title: activeSession,
          unit_type: "Carton",
          unit_id: cartonId,
          scanned_by: userId,
          device_id: settings.device_id,
        });
        await apiService.createUnloadLine({
          parent_title: activeSession,
          unit_type: "Carton",
          unit_id: cartonId,
          scanned_by: userId,
          scanned_on: new Date().toISOString(),
          device_id: String(settings.device_id || "").trim() || undefined,
        });
        console.log(`✅ Unload line created for carton ${cartonId}`);
      } catch (unloadLineError: any) {
        if (isDuplicateUnloadLinePostError(unloadLineError)) {
          let byName = "";
          let onShort = "";
          let dupDev = "";
          try {
            const { line } = await getServerUnloadLineForCarton(
              activeSession,
              cartonId
            );
            const lr = line as Record<string, unknown> | null;
            byName = actorFromUnloadLine(lr);
            const raw =
              line?.scanned_on || line?.created_at || line?.modified || "";
            onShort =
              typeof raw === "string" && raw.length > 10 ? raw.slice(0, 19) : "";
            if (lr) dupDev = deviceFromUnloadLine(lr);
          } catch {
            /* ignore */
          }
          await dataService.updateCartonStatus({
            asn_no: activeASN,
            inbound_session: activeSession,
            carton_id: cartonId,
            status: "Unloaded",
            unloaded_by: byName || undefined,
            updated_on: new Date().toISOString(),
          });
          await loadCartons();
          Alert.alert(
            "Carton already unloaded",
            duplicateUnloadAlertMessage(cartonId, byName, onShort, dupDev)
          );
          return;
        }
        const msg = String(unloadLineError?.message || "");
        if (msg.includes("404") || msg.includes("not found")) {
          setLoading(false);
          Alert.alert(
            "Unload not confirmed on server",
            "This app requires a working POST /api/inbound/unload-line on your server to stop two devices unloading the same carton. The server returned 404 for that URL.\n\nAsk your backend team to implement unload-line (and ideally GET unload-lines + unique constraint on session + carton).\n\nUnload was cancelled — nothing was saved."
          );
          return;
        }
        throw unloadLineError;
      }

      // Create UNLOAD_SCAN event
      await addEvent({
        event_type: "UNLOAD_SCAN",
        asn_no: normalizedASN,
        inbound_session: activeSession,
        carton_id: cartonId,
        device_id: settings.device_id,
        user_id: userId,
      });

      // Update carton status locally after server accepted unload line
      const selfLabel =
        currentUserDisplayForUnload(settings) || String(userId).trim();
      await dataService.updateCartonStatus({
        asn_no: activeASN,
        inbound_session: activeSession,
        carton_id: cartonId,
        status: "Unloaded",
        unloaded_by: selfLabel || undefined,
        updated_on: new Date().toISOString(),
      });

      // Sync status change to backend immediately for real-time updates
      // Use original ASN format (activeASN) for API calls, not normalized version
      try {
        console.log(`📡 Syncing carton status to backend immediately:`, {
          carton: cartonId,
          asn: activeASN,
          session: activeSession,
          status: "Unloaded",
        });
        await updateCartonStatusApiWithRetry({
          asn_no: activeASN, // Use original format from desktop (e.g., ASN-00002)
          inbound_session: activeSession,
          carton_id: cartonId,
          status: "Unloaded",
          user_id: userId,
          device_id: settings.device_id,
        });
        console.log(`✅ Carton ${cartonId} status synced to backend immediately: Unloaded`);
      } catch (apiError: any) {
        console.warn(
          `⚠️ Failed to sync carton ${cartonId} status to backend:`,
          apiError.message
        );
        // 404 errors are expected if carton doesn't exist in backend yet
        if (apiError.message?.includes("404")) {
          console.log(
            `ℹ️ Carton ${cartonId} not found in backend (404). This is expected if the carton hasn't been created in the backend yet. Will retry in batch sync.`
          );
        }
        // Don't block user flow - status is saved locally and will be retried in batch sync
      }

      await loadCartons();
      Alert.alert("Success", `Carton ${cartonId} unloaded`);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to unload carton");
    } finally {
      setLoading(false);
    }
  };

  if (!activeASN || !activeSession) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No active inbound session</Text>
        <Text style={styles.errorSubtext}>
          Please start an inbound session first
        </Text>
      </View>
    );
  }

  const canProceed = scannedCartons > 0;

  const handleNext = async () => {
    if (!activeASN || !activeSession) {
      Alert.alert("Error", "No active inbound session");
      return;
    }

    const normalizedASN = normalizeASN(activeASN);

    // Get all unloaded cartons for this ASN and session
    const unloadedCartons = cartons.filter((c) => c.status === "Unloaded");

    if (unloadedCartons.length === 0) {
      // No unloaded cartons, just navigate
      goToReceiveSort();
      return;
    }

    // Note: Cartons are already synced individually when scanned (for real-time updates)
    // Batch sync is kept as a safety net in case any individual syncs failed
    // The backend API is idempotent, so duplicate updates are safe
    setLoading(true);
    try {
      const settings = await getSettings();

      // Prepare cartons array for batch update (safety net)
      const cartonsToUpdate = unloadedCartons.map((c) => ({
        carton_id: c.carton_id,
        status: "Unloaded",
      }));

      console.log(
        `🔄 Batch sync (safety net): Updating ${cartonsToUpdate.length} carton(s) status to Unloaded on backend...`
      );
      console.log(
        `📦 Cartons:`,
        cartonsToUpdate.map((c) => c.carton_id).join(", ")
      );
      console.log(`📡 Batch Carton Status Update Request:`, {
        asn: activeASN,
        session: activeSession,
        cartons: cartonsToUpdate,
        user_id: settings.user_id,
        device_id: settings.device_id,
      });

      // Call API to update carton status on backend (safety net for any failed individual syncs)
      // Use original ASN format (activeASN) for API calls, not normalized version
      await updateCartonStatusApiWithRetry({
        asn_no: activeASN, // Use original format from desktop (e.g., ASN-00002)
        inbound_session: activeSession,
        cartons: cartonsToUpdate,
        user_id: settings.user_id,
        device_id: settings.device_id,
      });

      console.log(
        `✅ Batch sync completed: ${cartonsToUpdate.length} carton(s) status verified on backend`
      );

      // Navigate to ReceiveSort screen
      goToReceiveSort();
    } catch (error: any) {
      console.error("❌ Batch sync failed (individual syncs already completed):", error);
      // Still navigate even if batch sync fails (cartons were already synced individually)
      // Individual syncs happened when each carton was scanned
      goToReceiveSort();
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <ProgressIndicator currentStep={2} totalSteps={6} stepName="Unload" />
      <View style={styles.content}>
        <View style={styles.asnInfo}>
          <Text style={styles.asnLabel}>Active ASN:</Text>
          <Text style={styles.asnValue}>{activeASN || "Not set"}</Text>
        </View>

        <View style={styles.summaryContainer}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Number of CTN ASN:</Text>
            <Text style={styles.summaryValue}>{totalCartons}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>
              Total Number of CTN Scanned:
            </Text>
            <Text style={[styles.summaryValue, styles.summaryValueScanned]}>
              {scannedCartons}
            </Text>
          </View>
        </View>
        <Text style={styles.sectionTitle}>Scan Supplier Carton</Text>
        <Text style={styles.hintText}>
          Only cartons from ASN {activeASN || "Not set"} can be unloaded
        </Text>
        {cartons.filter(c => c.status === "Pending").length > 0 && (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              💡 Scan each carton barcode below to change status from "Pending" to "Unloaded"
            </Text>
            <Text style={styles.infoSubtext}>
              {cartons.filter(c => c.status === "Pending").length} carton(s) remaining to scan
            </Text>
          </View>
        )}
        <BarcodeScanner
          onScan={handleCartonScan}
          placeholder="Scan carton barcode"
          title="Carton Barcode"
          scanType="carton"
          autoSubmit
          autoSubmitDelay={450}
        />

        <View style={styles.listContainer}>
          <Text style={styles.listTitle}>Carton Status</Text>
          <FlatList
            data={cartons}
            keyExtractor={(item) => item.carton_id}
            renderItem={({ item }) => {
              const unloadedBy = String(item.unloaded_by || "").trim();
              const lockedBy = String(item.locked_by || "").trim();
              const lockedOn = String(item.locked_on || "").trim();
              const lockDateText = lockedOn
                ? new Date(lockedOn).toLocaleString()
                : "";
              const isUnloadedByCurrentUser =
                item.status === "Unloaded" &&
                unloadedBy.length > 0 &&
                settingsMatchUnloadedActor(currentLockOwner, unloadedBy);
              const isReceivingByCurrentUser =
                item.status === "Receiving" &&
                settingsMatchCartonLockOwner(currentLockOwner, item.locked_by);
              const canTakeOverReceiving =
                item.status === "Receiving" &&
                (isReceivingByCurrentUser || isSupervisorOrAdmin);
              const isActionable =
                isUnloadedByCurrentUser || canTakeOverReceiving;
              const isReadOnlyUnloaded =
                item.status === "Unloaded" && !isUnloadedByCurrentUser;

              return (
                <TouchableOpacity
                style={[
                  styles.cartonItem,
                  isActionable && styles.cartonItemClickable,
                  isReadOnlyUnloaded && styles.cartonItemDisabled,
                ]}
                disabled={
                  (item.status === "Receiving" && !canTakeOverReceiving) ||
                  isReadOnlyUnloaded
                }
                onPress={async () => {
                  const cartonId = item.carton_id;
                  const settingsTap = await getSettings();

                  if (item.status === "Pending") {
                    Alert.alert(
                      "Scan Carton",
                      `Please scan the barcode for carton ${item.carton_id} using the barcode scanner above.`,
                      [{ text: "OK" }]
                    );
                    return;
                  }

                  // Unloaded: only the user who unloaded may open Receive & Sort
                  if (item.status === "Unloaded") {
                    const who = String(item.unloaded_by || "").trim();
                    if (
                      !who ||
                      !settingsMatchUnloadedActor(settingsTap, who)
                    ) {
                      Alert.alert(
                        "Already unloaded",
                        who
                          ? `This carton was already unloaded by ${who}. Only that user can continue to receive and sort.`
                          : "This carton is already unloaded but the unload owner is missing. Please refresh from backend before continuing."
                      );
                      return;
                    }
                    console.log(
                      `📦 Navigating to ReceiveSort with carton: ${cartonId}`
                    );
                    goToReceiveSort(cartonId);
                    return;
                  }

                  // Receiving: owner resume, or supervisor / orphan takeover
                  if (item.status === "Receiving") {
                    const settings = settingsTap;
                    const lockedBy = String(item.locked_by || "").trim();
                    const isLockedByCurrentUser = settingsMatchCartonLockOwner(
                      settings,
                      lockedBy
                    );
                    const roleInfo = await getCurrentUserRole();
                    const canTakeOver =
                      isLockedByCurrentUser ||
                      roleInfo.isSupervisorOrAdmin ||
                      !lockedBy;

                    if (canTakeOver) {
                      if (lockedBy && !isLockedByCurrentUser) {
                        Alert.alert(
                          roleInfo.isSupervisorOrAdmin
                            ? "Take over carton"
                            : "Resume orphaned carton",
                          lockedBy
                            ? `Carton ${cartonId} is locked by ${lockedBy}.\n\nContinue as supervisor?`
                            : `Carton ${cartonId} is Receiving with no lock owner.\n\nContinue and receive on this device?`,
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Continue",
                              onPress: () => goToReceiveSort(cartonId),
                            },
                          ]
                        );
                        return;
                      }
                      goToReceiveSort(cartonId);
                      return;
                    }

                    Alert.alert(
                      "Carton Already Locked",
                      `Carton ${cartonId} is already locked by ${lockedBy}.\n\nYou cannot continue this carton from this device.`
                    );
                    return;
                  }

                  // Received cartons cannot be clicked
                  if (item.status === "Received") {
                    Alert.alert(
                      "Info",
                      "Carton already received and completed"
                    );
                    return;
                  }
                }}
              >
                <View style={styles.cartonInfo}>
                  <View style={styles.cartonHeader}>
                    <Text
                      style={[
                        styles.cartonId,
                        isActionable && styles.cartonIdClickable,
                        isReadOnlyUnloaded && styles.cartonIdDisabled,
                      ]}
                    >
                      {item.carton_id}
                    </Text>
                    <StatusBadge
                      status={item.status}
                      color={isReadOnlyUnloaded ? "#9E9E9E" : undefined}
                    />
                  </View>
                  {item.status === "Unloaded" && (
                    <Text
                      style={[
                        styles.unloadedByHint,
                        isReadOnlyUnloaded && styles.unloadedByHintDisabled,
                      ]}
                      numberOfLines={2}
                      ellipsizeMode="tail"
                    >
                      {lockedBy
                        ? `Locked by ${lockedBy}`
                        : unloadedBy
                          ? `By ${unloadedBy}`
                          : "Owner not available"}
                    </Text>
                  )}
                  {item.status === "Unloaded" && lockedBy && lockDateText && (
                    <Text
                      style={[
                        styles.lockTime,
                        isReadOnlyUnloaded && styles.unloadedByHintDisabled,
                      ]}
                    >
                      {lockDateText}
                    </Text>
                  )}
                  {item.status === "Receiving" && item.locked_by && (
                    <View style={styles.lockInfo}>
                      <Text style={styles.lockText}>
                        🔒 Locked by: {item.locked_by}
                      </Text>
                      {item.locked_on && (
                        <Text style={styles.lockTime}>
                          {new Date(item.locked_on).toLocaleString()}
                        </Text>
                      )}
                    </View>
                  )}
                </View>
                {item.status === "Unloaded" && isUnloadedByCurrentUser && (
                  <Text style={styles.tapHint}>Tap to receive & sort →</Text>
                )}
                {isReadOnlyUnloaded && (
                  <Text style={styles.disabledHint}>Not available on this device</Text>
                )}
                {item.status === "Receiving" && (
                  <Text style={styles.lockedHint}>
                    Currently being processed
                  </Text>
                )}
                </TouchableOpacity>
              );
            }}
            scrollEnabled={false}
          />
        </View>

        <TouchableOpacity
          style={[
            styles.nextButton,
            (!canProceed || loading) && styles.nextButtonDisabled,
          ]}
          onPress={handleNext}
          disabled={!canProceed || loading}
        >
          {loading ? (
            <Text style={styles.nextButtonText}>Syncing...</Text>
          ) : (
            <>
              <Text style={styles.nextButtonText}>Next →</Text>
              <Text style={styles.nextButtonSubtext}>Receive + Sort</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  content: {
    padding: 16,
  },
  asnInfo: {
    backgroundColor: "#E3F2FD",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  asnLabel: {
    fontSize: 14,
    color: "#1976D2",
    fontWeight: "600",
  },
  asnValue: {
    fontSize: 16,
    color: "#1976D2",
    fontWeight: "bold",
  },
  summaryContainer: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
  },
  summaryValue: {
    fontSize: 16,
    color: "#333",
    fontWeight: "bold",
  },
  summaryValueScanned: {
    color: "#4CAF50",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 8,
    color: "#333",
  },
  hintText: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
    fontStyle: "italic",
  },
  infoBox: {
    backgroundColor: "#FFF8E1",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#FFE082",
  },
  infoText: {
    fontSize: 14,
    color: "#5D4037",
    lineHeight: 20,
  },
  infoSubtext: {
    fontSize: 13,
    color: "#795548",
    marginTop: 6,
    fontWeight: "600",
  },
  listContainer: {
    marginTop: 24,
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
    color: "#333",
  },
  cartonItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  cartonItemClickable: {
    backgroundColor: "#E8F5E9",
    borderRadius: 8,
    marginBottom: 4,
    borderBottomWidth: 0,
  },
  cartonItemDisabled: {
    backgroundColor: "#F1F1F1",
    borderRadius: 8,
    marginBottom: 4,
    borderBottomWidth: 0,
    opacity: 0.85,
  },
  cartonInfo: {
    flex: 1,
  },
  cartonHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  lockInfo: {
    marginTop: 4,
    padding: 8,
    backgroundColor: "#FFF3E0",
    borderRadius: 4,
  },
  lockText: {
    fontSize: 12,
    color: "#E65100",
    fontWeight: "600",
  },
  lockTime: {
    fontSize: 11,
    color: "#FF6F00",
    marginTop: 2,
  },
  lockedHint: {
    fontSize: 12,
    color: "#FF9800",
    marginTop: 4,
    fontStyle: "italic",
  },
  cartonId: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  cartonIdClickable: {
    color: "#4CAF50",
  },
  cartonIdDisabled: {
    color: "#757575",
  },
  unloadedByHint: {
    fontSize: 13,
    color: "#558B2F",
    marginTop: 2,
    fontWeight: "600",
    flexShrink: 1,
  },
  unloadedByHintDisabled: {
    color: "#757575",
  },
  tapHint: {
    fontSize: 12,
    color: "#4CAF50",
    marginTop: 4,
    fontStyle: "italic",
  },
  disabledHint: {
    fontSize: 12,
    color: "#757575",
    marginTop: 4,
    fontStyle: "italic",
  },
  errorText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#F44336",
    textAlign: "center",
    marginTop: 100,
  },
  errorSubtext: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginTop: 8,
  },
  nextButton: {
    backgroundColor: "#4CAF50",
    padding: 20,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 24,
    marginBottom: 16,
  },
  nextButtonDisabled: {
    backgroundColor: "#ccc",
    opacity: 0.6,
  },
  nextButtonText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
  },
  nextButtonSubtext: {
    color: "rgba(255, 255, 255, 0.9)",
    fontSize: 14,
    marginTop: 4,
  },
});
