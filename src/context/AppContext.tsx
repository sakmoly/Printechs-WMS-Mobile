import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getSettings } from '../services/settings.service';
import { getEventCount } from '../services/event-queue.service';
import { dataService } from '../services/data.service';
import { normalizeASN } from '../utils/asn';
import { Settings } from '../types';

interface AppContextType {
  settings: Settings | null;
  refreshSettings: () => Promise<void>;
  pendingEventsCount: number;
  refreshPendingEvents: () => Promise<void>;
  activeASN: string | null;
  activeSession: string | null;
  setActiveASN: (asn: string | null) => void;
  setActiveSession: (session: string | null) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pendingEventsCount, setPendingEventsCount] = useState(0);
  const [activeASN, setActiveASN] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<string | null>(null);

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
    
    if (s.active_session) {
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
    };
    
    initializeApp();
    
    // Refresh pending events every 5 seconds
    const interval = setInterval(refreshPendingEvents, 5000);
    return () => clearInterval(interval);
  }, []);

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

