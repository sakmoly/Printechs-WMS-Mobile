import { Platform } from 'react-native';
import * as Linking from 'expo-linking';

/**
 * Handle hardware scanner intent (Android PDT devices)
 * Many PDT scanners send barcode data via intents
 */
export const handleScannerIntent = (url: string, callback: (barcode: string) => void) => {
  if (Platform.OS === 'android') {
    // Common intent schemes for barcode scanners
    const intentPatterns = [
      /barcode[=:]([^&]+)/i,
      /data[=:]([^&]+)/i,
      /code[=:]([^&]+)/i,
      /scan[=:]([^&]+)/i,
    ];

    for (const pattern of intentPatterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        const barcode = decodeURIComponent(match[1]);
        callback(barcode);
        return true;
      }
    }

    // Some scanners send barcode as path
    const pathMatch = url.match(/\/barcode\/(.+)$/i);
    if (pathMatch && pathMatch[1]) {
      const barcode = decodeURIComponent(pathMatch[1]);
      callback(barcode);
      return true;
    }
  }

  return false;
};

/**
 * Setup deep link listener for scanner intents
 */
export const setupScannerIntentListener = (callback: (barcode: string) => void) => {
  if (Platform.OS === 'android') {
    // Listen for initial URL (app opened via intent)
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleScannerIntent(url, callback);
      }
    });

    // Listen for URL changes (intent received while app is running)
    const subscription = Linking.addEventListener('url', (event) => {
      handleScannerIntent(event.url, callback);
    });

    return () => {
      subscription.remove();
    };
  }

  return () => {};
};

