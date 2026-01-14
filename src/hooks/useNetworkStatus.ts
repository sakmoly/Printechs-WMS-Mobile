import { useState, useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';

/**
 * Hook to detect online/offline status
 * Uses a simple approach: tries to fetch a small resource to check connectivity
 */
export const useNetworkStatus = () => {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [isChecking, setIsChecking] = useState<boolean>(false);

  const checkNetworkStatus = async () => {
    setIsChecking(true);
    try {
      // Try to fetch a small resource (Google's favicon is a good choice)
      // This is a lightweight check that works across platforms
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

      const response = await fetch('https://www.google.com/favicon.ico', {
        method: 'HEAD',
        mode: 'no-cors',
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timeoutId);
      setIsOnline(true);
    } catch (error: any) {
      // Network error means offline
      setIsOnline(false);
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    // Check immediately
    checkNetworkStatus();

    // Check periodically (every 10 seconds)
    const interval = setInterval(checkNetworkStatus, 10000);

    // Check when app comes to foreground
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        checkNetworkStatus();
      }
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  return { isOnline, isChecking };
};
