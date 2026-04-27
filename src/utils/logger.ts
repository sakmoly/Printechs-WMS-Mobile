/**
 * Console noise control for React Native.
 * - Production: suppress log / info / debug / warn (keep errors).
 * - Dev: suppress log / info / debug / warn (keep errors).
 *
 * Import this module as early as possible in App.tsx (right after gesture-handler).
 */

const originalLog = console.log;
const originalWarn = console.warn;
const originalInfo = console.info;
const originalDebug = console.debug;

const noop = () => {};

const isDev = typeof __DEV__ !== "undefined" && __DEV__;

if (isDev) {
  console.log = noop;
  console.info = noop;
  console.debug = noop;
  console.warn = noop;
} else {
  console.log = noop;
  console.info = noop;
  console.debug = noop;
  console.warn = noop;
}

/** Restore full console (e.g. temporary debugging). */
export const enableVerboseLogging = () => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.info = originalInfo;
  console.debug = originalDebug;
};

/** Re-apply suppression (matches current dev/prod rules). */
export const disableVerboseLogging = () => {
  if (isDev) {
    console.log = noop;
    console.warn = noop;
    console.info = noop;
    console.debug = noop;
  } else {
    console.log = noop;
    console.warn = noop;
    console.info = noop;
    console.debug = noop;
  }
};
