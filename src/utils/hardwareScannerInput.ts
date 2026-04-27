/**
 * Hardware wedge scanners on Android often append \\r \\n or \\t inside
 * TextInput.onChangeText instead of firing key events. Some scanners send no
 * suffix. This helper treats terminator characters as "Enter" and uses a short
 * idle debounce when no terminator is present.
 */

import type { MutableRefObject } from "react";

export const DEFAULT_SCANNER_AUTO_SUBMIT_MS = 280;

export type ScannerTimerRef = MutableRefObject<
  ReturnType<typeof setTimeout> | null
>;

export function clearScannerTimer(ref: ScannerTimerRef): void {
  if (ref.current) {
    clearTimeout(ref.current);
    ref.current = null;
  }
}

export type OnScannerTextChangeOptions = {
  delayMs?: number;
  /** When false, only commit on \\r\\n\\t (no idle debounce). Default true. */
  autoIdleSubmit?: boolean;
  /** If set, idle debounce reads this at fire time instead of the captured `display` (avoids stale closure). */
  getLatestDisplay?: () => string;
};

/**
 * @param setField - Update controlled input (may strip display of control chars)
 * @param commit - Called with trimmed payload when a scan should submit
 */
export function onScannerTextChange(
  text: string,
  setField: (s: string) => void,
  timerRef: ScannerTimerRef,
  commit: (barcode: string) => void,
  options?: OnScannerTextChangeOptions
): void {
  const delayMs = options?.delayMs ?? DEFAULT_SCANNER_AUTO_SUBMIT_MS;
  const autoIdle = options?.autoIdleSubmit !== false;
  clearScannerTimer(timerRef);

  const hasTerm = /[\r\n\t]/.test(text);
  const cleaned = text.replace(/[\r\n\t\u0000]+/g, "").trim();

  if (hasTerm) {
    if (cleaned.length > 0) {
      setField("");
      commit(cleaned);
    } else {
      setField("");
    }
    return;
  }

  const display = text.replace(/[\r\n\t\u0000]+/g, "");
  setField(display);

  if (!autoIdle) {
    return;
  }

  if (display.trim().length > 0) {
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const raw = options?.getLatestDisplay?.() ?? display;
      const v = String(raw).replace(/[\r\n\t\u0000]+/g, "").trim();
      if (v.length > 0) {
        setField("");
        commit(v);
      }
    }, delayMs);
  }
}
