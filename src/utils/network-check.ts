import { getSettings } from "../services/settings.service";

/**
 * Check if device is online and backend is reachable
 * Returns true if:
 * - Not in demo mode
 * - API URL is configured
 * - Backend is reachable (quick check)
 */
export const isDeviceOnline = async (): Promise<boolean> => {
  try {
    const settings = await getSettings();
    
    // If demo mode or no API URL, consider offline
    if (settings.demo_mode === 1 || !settings.api_url) {
      return false;
    }
    
    // Quick check: try to fetch a lightweight endpoint
    // Try multiple endpoints in case one doesn't exist
    const checkEndpoints = [
      "/api/health",
      "/api/cycle-count", // Cycle count endpoint (lightweight GET)
      "/api/warehouses/stores", // Another lightweight endpoint
    ];
    
    for (const endpoint of checkEndpoints) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout for quick check
        
        const response = await fetch(`${settings.api_url.replace(/\/$/, "")}${endpoint}`, {
          method: "GET",
          signal: controller.signal,
          headers: {
            "Accept": "application/json",
          },
        });
        
        clearTimeout(timeoutId);
        
        // If we get any response (even 404 or 401), the backend is reachable
        // Only 500+ errors or network errors mean backend is unreachable
        if (response.status < 500) {
          console.log(`✅ Network check: Backend is reachable (${endpoint} returned ${response.status})`);
          return true;
        }
      } catch (error: any) {
        // Continue to next endpoint if this one fails
        if (error.name === "AbortError") {
          console.log(`⏱️ Network check: Timeout for ${endpoint}`);
        } else {
          console.log(`ℹ️ Network check: ${endpoint} not reachable (${error.message || "error"})`);
        }
        // Continue to next endpoint
        continue;
      }
    }
    
    // If all endpoints failed, backend is not reachable
    console.log(`ℹ️ Network check: Backend not reachable (all endpoints failed)`);
    return false;
  } catch (error: any) {
    console.error("Error checking network status:", error);
    return false;
  }
};

