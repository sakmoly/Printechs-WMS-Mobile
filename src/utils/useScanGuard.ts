import { useRef } from "react";

/**
 * Prevents duplicate scan triggers within a time window
 * Useful for barcode scanners that fire onChange + onSubmit events
 * 
 * @param windowMs - Time window in milliseconds (default: 350ms)
 * @returns Function that checks if scan should be allowed
 */
export function useScanGuard(windowMs = 350) {
  const last = useRef<{ v: string; t: number } | null>(null);

  return (valueRaw: string) => {
    const v = (valueRaw ?? "").trim();
    if (!v) return { allow: false };

    const now = Date.now();
    if (last.current && last.current.v === v && now - last.current.t < windowMs) {
      return { allow: false };
    }

    last.current = { v, t: now };
    return { allow: true };
  };
}
