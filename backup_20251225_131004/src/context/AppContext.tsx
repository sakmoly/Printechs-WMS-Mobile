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
    
    // Correct ASN format if it exists
    if (s.active_asn) {
      try {
        const normalizedASN = normalizeASN(s.active_asn);
        const originalASN = await dataService.getOriginalASNFormat(normalizedASN);
        // Use original format if available and different from stored value
        if (originalASN && originalASN !== s.active_asn) {
          console.log(`📋 Correcting ASN format: ${s.active_asn} → ${originalASN}`);
          // Update activeASN with correct format
          setActiveASN(originalASN);
          // Also update settings if format is different
          const { saveSettings } = await import('../services/settings.service');
          await saveSettings({ active_asn: originalASN });
        } else {
          setActiveASN(s.active_asn);
        }
      } catch (error: any) {
        console.warn('⚠️ Could not correct ASN format, using stored value:', error.message);
        setActiveASN(s.active_asn);
      }
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

  return (
    <AppContext.Provider
      value={{
        settings,
        refreshSettings,
        pendingEventsCount,
        refreshPendingEvents,
        activeASN,
        activeSession,
        setActiveASN,
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

