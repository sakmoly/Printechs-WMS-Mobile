import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { getSettings } from '../services/settings.service';
import { getEventCount } from '../services/event-queue.service';
import { dataService } from '../services/data.service';
import { normalizeASN } from '../utils/asn';
import { Settings } from '../types';
import { apiService } from '../services/api.service';

function cleanSessionPart(value: unknown): string {
  return String(value ?? "")
    .replace(/[^A-Z0-9]/g, "")
    .toUpperCase();
}

function cleanOwnerCandidates(...values: unknown[]): string[] {
  return Array.from(
    new Set(values.map(cleanSessionPart).filter((value) => value.length > 0))
  );
}

function isSessionFromAnotherUserOrDevice(settings: Settings): boolean {
  const sessionId = settings.active_session;
  if (!sessionId) return false;

  const normalizedSessionId = sessionId.toUpperCase();
  if (!normalizedSessionId.startsWith("SESSION-")) return false;

  const cleanDevice = cleanSessionPart(settings.device_id);
  const userCandidates = cleanOwnerCandidates(settings.user_id, settings.user_code);

  const wrongDevice = cleanDevice
    ? !normalizedSessionId.includes(`-${cleanDevice}-`)
    : false;
  const wrongUser =
    userCandidates.length > 0
      ? !userCandidates.some((user) => normalizedSessionId.includes(`-${user}`))
      : false;

  return wrongDevice || wrongUser;
}

interface AppContextType {
  settings: Settings | null;
  refreshSettings: () => Promise<void>;
  pendingEventsCount: number;
  refreshPendingEvents: () => Promise<void>;
  activeASN: string | null;
  activeSession: string | null;
  setActiveASN: (asn: string | null) => void;
  setActiveSession: (session: string | null) => void;
  /** True when server blocks warehouse use (pending approval or device disabled). */
  deviceSessionRestricted: boolean;
  /** Why access is blocked; null when full access. */
  deviceSessionBlockReason: "pending" | "disabled" | null;
  refreshDeviceSessionStatus: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pendingEventsCount, setPendingEventsCount] = useState(0);
  const [activeASN, setActiveASN] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [deviceSessionRestricted, setDeviceSessionRestricted] = useState(false);
  const [deviceSessionBlockReason, setDeviceSessionBlockReason] = useState<
    "pending" | "disabled" | null
  >(null);

  const refreshDeviceSessionStatus = useCallback(async () => {
    try {
      const s = await getSettings();
      if (s.demo_mode === 1 || !s.api_url || !s.auth_token) {
        setDeviceSessionRestricted(false);
        setDeviceSessionBlockReason(null);
        return;
      }
      try {
        const r: any = await apiService.getAuthSession();
        const data = r?.data ?? r;
        const st = String(data?.device_status ?? "").toLowerCase().trim();
        if (st === "pending") {
          setDeviceSessionRestricted(true);
          setDeviceSessionBlockReason("pending");
        } else {
          setDeviceSessionRestricted(false);
          setDeviceSessionBlockReason(null);
        }
      } catch (e: any) {
        const m = String(e?.message || "");
        if (
          m.includes("DEVICE_PENDING_APPROVAL") ||
          m.includes("pending approval")
        ) {
          setDeviceSessionRestricted(true);
          setDeviceSessionBlockReason("pending");
        } else if (
          m.includes("DEVICE_DISABLED") ||
          m.includes("device has been disabled")
        ) {
          setDeviceSessionRestricted(true);
          setDeviceSessionBlockReason("disabled");
        } else if (m.includes("404") || m.includes("not found")) {
          setDeviceSessionRestricted(false);
          setDeviceSessionBlockReason(null);
        }
        // Other errors: keep current flag (avoid flapping on transient network)
      }
    } catch {
      setDeviceSessionRestricted(false);
      setDeviceSessionBlockReason(null);
    }
  }, []);

  const refreshSettings = async () => {
    const s = await getSettings();
    setSettings(s);
    
    // Always use normalized ASN (e.g. ASN-0003) so API calls and display match backend
    // Fixes 404 "ASN ASN-3 not found" when user scanned ASN-0003 but short form was stored
    if (s.active_asn) {
      const canonical = normalizeASN(s.active_asn);
      if (canonical !== s.active_asn) {
        console.log(`📋 Correcting activeASN format: "${s.active_asn}" → "${canonical}"`);
      }
      setActiveASN(canonical);
    } else {
      setActiveASN(null);
    }
    
    if (s.active_session && isSessionFromAnotherUserOrDevice(s)) {
      console.warn(
        `⚠️ Ignoring active inbound session from another user/device: ${s.active_session}`
      );
      setActiveASN(null);
      setActiveSession(null);
      import('../services/settings.service').then(({ saveSettings }) => {
        saveSettings({ active_asn: null, active_session: null }).catch(() => {});
      });
    } else if (s.active_session) {
      setActiveSession(s.active_session);
    } else {
      setActiveSession(null);
    }
  };

  const refreshPendingEvents = async () => {
    const count = await getEventCount();
    setPendingEventsCount(count);
  };

  useEffect(() => {
    const initializeApp = async () => {
      await refreshPendingEvents();
      await refreshSettings(); // This will also set activeASN and activeSession with correct format
      await refreshDeviceSessionStatus();
    };
    
    initializeApp();
    
    // Refresh pending events every 5 seconds
    const interval = setInterval(refreshPendingEvents, 5000);
    return () => clearInterval(interval);
  }, [refreshDeviceSessionStatus]);

  useEffect(() => {
    if (!deviceSessionRestricted) return;
    const t = setInterval(() => {
      refreshDeviceSessionStatus();
    }, 60000);
    return () => clearInterval(t);
  }, [deviceSessionRestricted, refreshDeviceSessionStatus]);

  // Wrapper for setActiveASN: always store canonical format (ASN-0003) so API never gets ASN-3
  const setActiveASNWrapper = (asn: string | null) => {
    if (asn) {
      const canonical = normalizeASN(asn);
      console.log(`📋 Setting activeASN: "${asn}" → "${canonical}"`);
      setActiveASN(canonical);
      import('../services/settings.service').then(({ saveSettings }) => {
        saveSettings({ active_asn: canonical }).catch(() => {});
      });
    } else {
      setActiveASN(null);
      import('../services/settings.service').then(({ saveSettings }) => {
        saveSettings({ active_asn: null, active_session: null }).catch(() => {});
      });
    }
  };

  return (
    <AppContext.Provider
      value={{
        settings,
        refreshSettings,
        pendingEventsCount,
        refreshPendingEvents,
        activeASN,
        activeSession,
        setActiveASN: setActiveASNWrapper,
        setActiveSession,
        deviceSessionRestricted,
        deviceSessionBlockReason,
        refreshDeviceSessionStatus,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
};

