/**
 * Logger utility - Only shows warnings and errors
 * All console.log statements are suppressed
 */

// Store original console methods
const originalLog = console.log;
const originalInfo = console.info;
const originalDebug = console.debug;

// Override console.log to do nothing (suppress info logs)
console.log = () => {};

// Override console.info to do nothing (suppress info logs)
console.info = () => {};

// Override console.debug to do nothing (suppress debug logs)
console.debug = () => {};

// Keep console.warn and console.error as-is (they will still show)

// Export a function to restore logging if needed (for debugging)
export const enableVerboseLogging = () => {
  console.log = originalLog;
  console.info = originalInfo;
  console.debug = originalDebug;
};

// Export a function to disable logging again
export const disableVerboseLogging = () => {
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
};

