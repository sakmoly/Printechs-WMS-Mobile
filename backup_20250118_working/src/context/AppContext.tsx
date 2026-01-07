import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getSettings } from '../services/settings.service';
import { getEventCount } from '../services/event-queue.service';
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
  };

  const refreshPendingEvents = async () => {
    const count = await getEventCount();
    setPendingEventsCount(count);
  };

  useEffect(() => {
    refreshSettings();
    refreshPendingEvents();
    
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

