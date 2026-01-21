/**
 * Logger utility - Only shows errors
 * All console.log, console.warn, console.info, and console.debug statements are suppressed
 * Only console.error will be displayed
 */

// Store original console methods
const originalLog = console.log;
const originalWarn = console.warn;
const originalInfo = console.info;
const originalDebug = console.debug;

// Override console.log to do nothing (suppress info logs)
console.log = () => {};

// Override console.warn to do nothing (suppress warning logs)
console.warn = () => {};

// Override console.info to do nothing (suppress info logs)
console.info = () => {};

// Override console.debug to do nothing (suppress debug logs)
console.debug = () => {};

// Keep console.error as-is (only errors will show)

// Export a function to restore logging if needed (for debugging)
export const enableVerboseLogging = () => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.info = originalInfo;
  console.debug = originalDebug;
};

// Export a function to disable logging again
export const disableVerboseLogging = () => {
  console.log = () => {};
  console.warn = () => {};
  console.info = () => {};
  console.debug = () => {};
};

