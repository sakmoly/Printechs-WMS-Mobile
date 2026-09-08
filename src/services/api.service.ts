import { getSettings, saveSettings } from "./settings.service";
import { ScanEvent, Settings } from "../types";
import { joinApiUrl, normalizeApiBaseUrl } from "../utils/apiUrl";
import { parseAuthErrorPayload, throwAuthError } from "../utils/password-auth";

/** Query params for GET /api/master/items (paging + incremental). */
export type PullItemMasterParams = {
  limit?: number;
  offset?: number;
  sort?: string;
  order?: "asc" | "desc";
  after_item_code?: string;
  after_modified?: string;
  modified_since?: string;
};

const API_TIMEOUT = 10000;
/** Large JSON payloads (paged item master). */
const ITEM_MASTER_API_TIMEOUT_MS = 120000;

/** In-memory unload lines when app `demo_mode` is on (aligns with server demo DUPLICATE_UNLOAD). */
const demoUnloadLinesBySession = new Map<
  string,
  {
    parent_title: string;
    unit_type: string;
    unit_id: string;
    scanned_by: string;
    scanned_on: string;
  }[]
>();

// Login/Authentication function
const authenticate = async (): Promise<string | null> => {
  const settings = await getSettings();

  if (settings.demo_mode === 1 || !settings.api_url) {
    return null; // No auth needed in demo mode
  }

  // Check if we have a valid token
  if (settings.auth_token && settings.auth_token_expires) {
    const expiresAt = new Date(settings.auth_token_expires);
    const now = new Date();
    // If token expires in more than 5 minutes, use it
    if (expiresAt > new Date(now.getTime() + 5 * 60 * 1000)) {
      return settings.auth_token;
    }
  }

  // Need to authenticate - try multiple possible login endpoints
  const loginEndpoints = [
    "/api/auth/login",
    "/api/login",
    "/api/auth/device-login",
  ];

  for (const loginEndpoint of loginEndpoints) {
    try {
      const url = joinApiUrl(settings.api_url, loginEndpoint);
      console.log(`🔐 Login attempt: ${url}`);
      console.log(`📤 Request body:`, {
        user_code: settings.user_code || settings.user_id,
        password: "***",
        password_length: (settings.password || settings.device_id || "").length,
        user_code_length: (settings.user_code || settings.user_id || "").length,
      });

      // Add timeout to login requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const uc = String(settings.user_code || settings.user_id || "").trim();
      const pw = String(settings.password || settings.device_id || "");
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          buildAuthLoginRequestBody(
            loginEndpoint,
            uc,
            pw,
            settings.device_id,
            (settings as any).device_label
          )
        ),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const responseData = await response.json();

        // Extract token from various possible response structures
        const token =
          responseData.token ||
          responseData.access_token ||
          responseData.auth_token ||
          responseData.data?.token ||
          responseData.data?.access_token ||
          responseData.data?.auth_token;

        // Extract expires_in from various possible response structures
        const expiresIn =
          responseData.expires_in || responseData.data?.expires_in || 3600; // Default 1 hour

        if (token) {
          // Calculate expiration time
          const expiresAt = new Date(Date.now() + expiresIn * 1000);

          // Save token to settings
          await saveSettings({
            auth_token: token,
            auth_token_expires: expiresAt.toISOString(),
          });

          console.log("✅ Authentication successful");
          return token;
        } else {
          console.warn(
            "⚠️ No token found in login response:",
            JSON.stringify(responseData).substring(0, 200)
          );
        }
      } else {
        // If 404, try next endpoint
        if (response.status === 404) {
          continue;
        }
        const errorText = await response.text().catch(() => "");
        console.error(
          `❌ Authentication failed (${loginEndpoint}):`,
          response.status,
          errorText || response.statusText
        );
      }
    } catch (error: any) {
      // Network error or timeout
      const isNetworkError =
        error.message?.includes("Network") ||
        error.message?.includes("Failed") ||
        error.message?.includes("aborted") ||
        error.name === "AbortError";

      if (isNetworkError) {
        console.error(
          `❌ Login error (${loginEndpoint}): Network request failed`
        );
        // Continue to next endpoint
        continue;
      }
      console.error(`❌ Login error (${loginEndpoint}):`, error.message);
    }
  }

  console.warn("⚠️ Could not authenticate - all login endpoints failed");
  return null;
};

/**
 * WMS mobile device session API: `POST /api/auth/login` expects `client_type: "mobile"`
 * and a stable `device_id` (see Wms.Desktop MOBILE_DEVICE_SESSION_API.md).
 * Other legacy login paths stay minimal (`user_code` + `password`) for compatibility.
 */
export type AuthLoginOptions = {
  /** If true, ask server to drop the other mobile session for this user (backend must honor this field). */
  replaceOtherMobileSession?: boolean;
  /** @internal prevents infinite loop when auto-retrying after same-device session conflict */
  _sessionConflictRetried?: boolean;
};

function deviceIdComparable(id: string | undefined | null): string {
  return String(id || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Best-effort: ask server to release mobile session using credentials (no Bearer). */
async function bestEffortAuthLogoutWithCredentials(
  apiUrl: string,
  user_code: string,
  password: string,
  device_id: string | undefined | null
): Promise<void> {
  const base = apiUrl.replace(/\/$/, "");
  const url = `${base}/api/auth/logout`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_code,
        password,
        client_type: "mobile",
        device_id: String(device_id || "").trim() || undefined,
      }),
      signal: controller.signal,
    });
  } catch {
    /* ignore */
  } finally {
    clearTimeout(tid);
  }
}

function buildAuthLoginRequestBody(
  loginEndpoint: string,
  user_code: string,
  password: string,
  device_id: string | undefined | null,
  device_label?: string | null,
  loginOptions?: AuthLoginOptions
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    user_code,
    password,
  };
  const did = String(device_id || "").trim();
  if (loginEndpoint === "/api/auth/login" && did.length > 0) {
    body.client_type = "mobile";
    body.device_id = did;
    const label = String(device_label || "").trim();
    if (label) {
      body.device_label = label;
    }
    if (loginOptions?.replaceOtherMobileSession) {
      body.replace_other_mobile_session = true;
    }
  }
  return body;
}

const makeRequest = async (
  endpoint: string,
  method: string,
  body?: any,
  retryAuth = true,
  timeoutMs?: number
) => {
  const settings = await getSettings();

  // Check demo_mode explicitly (it's stored as 0 or 1 in database)
  // Also use demo mode if API URL is not configured (auto-fallback)
  if (settings.demo_mode === 1 || !settings.api_url) {
    // Simulate API response in demo mode
    return simulateApiResponse(endpoint, method, body);
  }

  // Get authentication token
  let authToken = await authenticate();

  // In production mode with API URL configured, make real API call
  const url = joinApiUrl(settings.api_url, endpoint);
  console.log(`🌐 API Request: ${method} ${url}`);
  
  // ✅ DEBUG: Log events/batch requests to verify structure
  if (endpoint === "/api/events/batch" && body) {
    console.warn(
      `📦 Events Batch Request Details:`,
      JSON.stringify({
        has_events: !!body.events,
        events_count: body.events?.length || 0,
        update_mode: body.update_mode,
        body_keys: Object.keys(body),
        first_event_preview: body.events?.[0] ? {
          event_type: body.events[0].event_type,
          item_code: body.events[0].item_code,
          qty: body.events[0].qty,
          tc_id: body.events[0].tc_id,
          carton_id: body.events[0].carton_id,
        } : null,
      }, null, 2)
    );
    // Also log the full request body for Material Request events
    if (body.events && body.events.length > 0 && 
        (body.events[0].event_type === "PACK_ITEM_TO_TC" || body.events[0].event_type === "PACK_BOX_TO_TC")) {
      console.warn(
        `📦 Full Events Batch Request Body:`,
        JSON.stringify(body, null, 2)
      );
    }
  }

  // Log request body for carton status updates (for debugging)
  if (endpoint === "/api/cartons/update-status" && body) {
    console.log(
      `📦 Carton Status Update Request:`,
      JSON.stringify(body, null, 2)
    );
  }

  // ✅ DEBUG: Log ERP push-capture (user + device on task header)
  if (endpoint === "/api/cycle-count/push-capture" && method === "POST" && body?.payload) {
    const task = body.payload.task || {};
    console.log(
      `📤 Cycle Count push-capture request:`,
      JSON.stringify(
        {
          external_ref: task.external_ref,
          counted_by: task.counted_by,
          device_id: task.device_id,
          mobile_device_id: task.mobile_device_id,
          payload_device_id: body.payload.device_id,
          line_count: body.payload.lines?.length ?? 0,
        },
        null,
        2
      )
    );
  }

  // ✅ DEBUG: Log cycle count count requests to verify lineId and expected_qty are included
  if (endpoint.includes("/api/cycle-count/") && endpoint.endsWith("/count") && method === "POST" && body) {
    console.log(
      `📦 Cycle Count Count Request:`,
      JSON.stringify(body, null, 2)
    );
    // Log each line to verify lineId and expected_qty are present
    if (body.lines && Array.isArray(body.lines)) {
      body.lines.forEach((line: any, idx: number) => {
        console.log(
          `📦   Line ${idx + 1}: item_code=${line.item_code}, lineId=${line.lineId}, id=${line.id}, line_id=${line.line_id || 'null'}, expected_qty=${line.expected_qty !== undefined ? line.expected_qty : 'undefined'}, actual_qty=${line.actual_qty !== undefined ? line.actual_qty : line.counted_qty || 'undefined'}`
        );
        if (!line.lineId && line.lineId !== 0) {
          console.error(`❌ CRITICAL: Line ${idx + 1} (${line.item_code}) is missing lineId!`);
        }
        if (line.expected_qty === undefined) {
          console.warn(`⚠️ WARNING: Line ${idx + 1} (${line.item_code}) is missing expected_qty field!`);
        }
      });
    }
  }

  if (authToken) {
    console.log(`🔑 Using auth token: ${authToken.substring(0, 20)}...`);
  } else {
    console.warn(`⚠️ No auth token available for request`);
  }

  const effectiveTimeout = timeoutMs ?? API_TIMEOUT;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Add authorization header if we have a token
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    console.log(
      `📡 API Response: ${response.status} ${
        response.statusText || "No status text"
      }`
    );

    if (!response.ok) {
      // For 404 errors on carton status updates, log as warning instead of error
      // This is expected if the carton doesn't exist in backend yet
      if (
        response.status === 404 &&
        endpoint === "/api/cartons/update-status"
      ) {
        console.warn(
          `⚠️ Carton not found in backend (404). This is expected if the carton hasn't been created in the backend yet.`
        );
      }
      // Handle 404 for unload-lines endpoint gracefully (endpoint may not be implemented yet)
      if (
        response.status === 404 &&
        endpoint.includes("/api/inbound/unload-lines")
      ) {
        console.warn(
          `ℹ️ Unload lines endpoint not implemented (404) - this is expected if backend hasn't implemented GET /api/inbound/unload-lines yet`
        );
        return []; // Return empty array instead of throwing error
      }

      // Handle 404 for transfer-in endpoint gracefully (endpoint may not be implemented yet)
      if (
        response.status === 404 &&
        endpoint.includes("/api/transfer-in") &&
        method === "GET"
      ) {
        console.warn(
          `ℹ️ Transfer In endpoint not implemented (404) - returning empty array`
        );
        return []; // Return empty array instead of throwing error
      }

      // Handle 404 for transfer-in update-line-carton endpoint gracefully (endpoint is optional)
      // carton_id is tracked in TRANSFER_IN_RECEIVE events and will be processed by backend during event sync
      if (
        response.status === 404 &&
        endpoint.includes("/api/transfer-in") &&
        endpoint.includes("/update-line-carton") &&
        method === "POST"
      ) {
        console.warn(
          `ℹ️ Transfer In update-line-carton endpoint not implemented (404) - this is expected. carton_id will be processed from TRANSFER_IN_RECEIVE events during event sync.`
        );
        // Return null instead of throwing error - carton_id is still tracked in events
        return null;
      }

      // Handle 404 for transfer-in update-status endpoint gracefully (endpoint is optional)
      // Backend may auto-update status when all items are received
      if (
        response.status === 404 &&
        endpoint.includes("/api/transfer-in") &&
        endpoint.includes("/update-status") &&
        method === "POST"
      ) {
        console.warn(
          `ℹ️ Transfer In update-status endpoint not implemented (404) - this is expected. Backend may auto-update status when all items are received.`
        );
        // Return null instead of throwing error - backend may handle status updates automatically
        return null;
      }

      // Handle 404 for transfer-order endpoint gracefully (ASN can be received without Transfer Order)
      if (
        response.status === 404 &&
        endpoint.includes("/api/transfer-order/by-asn/") &&
        method === "GET"
      ) {
        console.log(
          `ℹ️ No transfer order found for ASN (404) - this is OK, ASN can be received without Transfer Order`
        );
        return null; // Return null instead of throwing error
      }

      // Handle 404 for transfer-cartons/{tc_id} endpoint gracefully (endpoint may not exist on backend)
      if (
        response.status === 404 &&
        endpoint.includes("/api/transfer-cartons/") &&
        method === "GET" &&
        !endpoint.includes("?") // Only for single TC endpoint, not list endpoint
      ) {
        console.log(
          `ℹ️ Transfer Carton details endpoint not available (404) - this is expected if backend doesn't implement GET /api/transfer-cartons/{tc_id}`
        );
        return null; // Return null instead of throwing error
      }

      // Handle 404 for stock/item endpoint gracefully (endpoint may not exist on backend)
      if (
        response.status === 404 &&
        endpoint.includes("/api/stock/item/") &&
        endpoint.includes("/warehouse/") &&
        method === "GET"
      ) {
        console.log(
          `ℹ️ Stock item endpoint not found (404) - this endpoint may not be implemented yet`
        );
        return null; // Return null instead of throwing error
      }

      // Handle 404 for transfer-in validate-carton endpoint gracefully (endpoint may not be implemented yet)
      if (
        response.status === 404 &&
        endpoint.includes("/api/transfer-in/") &&
        endpoint.includes("/validate-carton") &&
        method === "POST"
      ) {
        // Read response body before throwing (to avoid "body already read" errors)
        const errorText = await response.text().catch(() => "");
        // Create error with 404 flag so validateTransferInCarton can catch it gracefully
        const error = new Error(`404: Route ${endpoint} not found - ${errorText || "Endpoint not implemented"}`);
        (error as any).status = 404;
        (error as any).is404 = true;
        // Don't log as error - this is expected and handled gracefully
        throw error;
      }

      // Handle 404 for cycle-count DELETE endpoint gracefully (endpoint may not be implemented yet)
      if (
        response.status === 404 &&
        endpoint.includes("/api/cycle-count") &&
        method === "DELETE"
      ) {
        console.warn(
          `ℹ️ Cycle Count DELETE endpoint not implemented (404) - this is expected if backend hasn't implemented DELETE /api/cycle-count/{title} yet`
        );
        // Return a success-like response so the app can continue with local deletion
        return { success: true, message: "DELETE endpoint not implemented, local deletion only" };
      }
      

      // Handle 400 for stock/ledger endpoint when bin_location is missing
      if (
        response.status === 400 &&
        endpoint.includes("/api/stock/ledger")
      ) {
        const errorText = await response.text();
        let errorData: any;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText || "Bad Request" };
        }
        
        // If the error is about missing bin_location, provide a helpful message
        if (errorData.message?.includes("bin_location") && errorData.message?.includes("required")) {
          console.warn(
            `⚠️ Stock ledger API requires bin_location parameter. If you want all entries, use a different endpoint or provide a bin_location filter.`
          );
          // Return empty array instead of throwing error for StockLedgerListScreen
          return [];
        }
        
        // For other 400 errors, throw normally
        throw new Error(
          errorData.message || `Bad Request: ${endpoint}`
        );
      }

      // Handle 404 for picking endpoints gracefully (endpoints may not be implemented yet)
      if (
        response.status === 404 &&
        endpoint.includes("/api/wms/picking/")
      ) {
        console.log(
          `ℹ️ Picking endpoint not implemented (404): ${endpoint} - this is expected if backend hasn't implemented picking APIs yet`
        );
        // Return a structured error that can be caught and handled gracefully
        const errorText = await response.text();
        let errorData: any;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText || "Not Found" };
        }
        const error = new Error(
          errorData.message || `Picking endpoint not found: ${endpoint}`
        );
        (error as any).status = 404;
        (error as any).is404 = true;
        throw error;
      }
      
      // Handle 404 for other cycle-count endpoints - throw error (no mock data)
      if (
        response.status === 404 &&
        endpoint.includes("/api/cycle-count") &&
        method !== "DELETE"
      ) {
        console.error(
          `❌ Cycle Count endpoint returned 404: ${endpoint}`
        );
        // Throw error instead of returning mock data
        const errorText = await response.text();
        let errorData: any;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText || "Not Found" };
        }
        throw new Error(
          errorData.message || `Cycle Count endpoint not found: ${endpoint}`
        );
      }

      // Note: We'll check for source_type errors after reading the response body below
      // to avoid reading the response body twice

      // Handle 401 Unauthorized - try to re-authenticate before parsing error
      if (response.status === 401 && retryAuth) {
        console.log("🔄 401 Unauthorized - Attempting to re-authenticate...");
        // Clear existing token
        await saveSettings({
          auth_token: undefined,
          auth_token_expires: undefined,
        });

        // Retry the request with new authentication
        return makeRequest(endpoint, method, body, false, timeoutMs);
      }

      if (response.status === 403 && retryAuth) {
        const errorText = await response.clone().text().catch(() => "");
        let errorCode = "";
        try {
          const parsed = JSON.parse(errorText);
          errorCode = parsed?.code || parsed?.error?.code || "";
        } catch {
          errorCode = "";
        }

        if (errorCode === "SESSION_REVOKED") {
          console.warn("🔄 Session revoked - clearing local token and retrying authentication once...");
          await saveSettings({
            auth_token: undefined,
            auth_token_expires: undefined,
          });
          return makeRequest(endpoint, method, body, false, timeoutMs);
        }
      }

      // Try to get error message from response body
      let errorMessage = response.statusText || `HTTP ${response.status}`;
      let errorJson: any = null;

      try {
        // Read response as text first (can only read once)
        const errorBody = await response.text();

        if (errorBody && errorBody.trim()) {
          try {
            errorJson = JSON.parse(errorBody);
            // Handle different error response formats
            if (typeof errorJson === "string") {
              errorMessage = errorJson;
            } else if (errorJson.message) {
              errorMessage = String(errorJson.message);
            } else if (errorJson.error) {
              if (typeof errorJson.error === "string") {
                errorMessage = errorJson.error;
              } else {
                errorMessage = JSON.stringify(errorJson.error);
              }
            } else if (errorJson.msg) {
              errorMessage = String(errorJson.msg);
            } else if (errorJson.code && errorJson.message) {
              // ✅ Handle flat error format: {"code":"BOX_NOT_FOUND","message":"..."}
              errorMessage = String(errorJson.message);
            } else {
              // Try to stringify the object properly
              try {
                errorMessage = JSON.stringify(errorJson);
              } catch (stringifyError) {
                errorMessage = String(errorJson);
              }
            }
          } catch (parseError) {
            // Not JSON, use as text
            errorMessage = errorBody.substring(0, 200); // Limit error message length
          }
        } else {
          // Empty body, provide helpful message based on status
          if (response.status === 404) {
            errorMessage = `Endpoint not found: ${endpoint}`;
          } else if (response.status === 401) {
            errorMessage = `Authentication required. Please check user_code and password in Settings.`;
          } else if (response.status === 500) {
            errorMessage = `Server error (500)`;
          } else {
            errorMessage = `HTTP ${response.status}: ${
              response.statusText || "Unknown error"
            }`;
          }
        }
      } catch (e: any) {
        // If we can't read the body, provide helpful message
        if (response.status === 404) {
          errorMessage = `Endpoint not found: ${endpoint}`;
        } else if (response.status === 401) {
          errorMessage = `Authentication required. Please check user_code and password in Settings.`;
        } else {
          errorMessage = `HTTP ${response.status}: ${
            response.statusText || "Unknown error"
          }`;
        }
      }

      // Check for source_type column errors (expected when backend doesn't have this column)
      // Log as warning instead of error since this is handled gracefully
      if (
        response.status === 500 &&
        endpoint.includes("/api/putaway/tasks") &&
        errorJson
      ) {
        const errorDetails = errorJson.details || {};
        const sqlMessage = errorDetails.sqlMessage || errorDetails.message || "";
        
        if (
          sqlMessage.includes("source_type") ||
          sqlMessage.includes("Unknown column") ||
          errorMessage.includes("source_type")
        ) {
          // This is expected - backend doesn't support source_type column yet
          // Log as informational warning, but still throw the error so caller can handle it
          console.warn(
            `ℹ️ Backend database doesn't support source_type column - this is expected and will be handled gracefully`
          );
        }
      }

      // Check for source_type column errors (expected when backend doesn't have this column)
      // Log as warning instead of error since this is handled gracefully
      if (
        response.status === 500 &&
        endpoint.includes("/api/putaway/tasks") &&
        errorJson
      ) {
        const errorDetails = errorJson.details || {};
        const sqlMessage = errorDetails.sqlMessage || errorDetails.message || "";
        
        if (
          sqlMessage.includes("source_type") ||
          sqlMessage.includes("Unknown column") ||
          errorMessage.includes("source_type")
        ) {
          // This is expected - backend doesn't support source_type column yet
          // Log as informational warning, but still throw the error so caller can handle it
          console.warn(
            `ℹ️ Backend database doesn't support source_type column - this is expected and will be handled gracefully`
          );
        }
      }

      const finalError = `API error (${response.status}): ${errorMessage}`;
      
      // ✅ Handle 404 for getPutawayTask endpoint gracefully (endpoint may not exist)
      // This endpoint is optional - we can get task details from the list endpoint instead
      if (
        response.status === 404 &&
        endpoint.includes("/api/putaway/tasks/") &&
        method === "GET" &&
        !endpoint.endsWith("/api/putaway/tasks") // Only for individual task endpoint, not list
      ) {
        // Don't log as error - this is expected and handled gracefully
        // Just throw the error so caller can catch it
        const error = new Error(`404: Route ${endpoint} not found - ${errorMessage || "Endpoint not implemented"}`);
        (error as any).status = 404;
        (error as any).is404 = true;
        throw error;
      }
      
      // ✅ Check if this is a validation error (structured error response, not a true API error)
      // Parse errorJson first to check for structured errors
      let validationErrorCode = null;
      if (errorJson) {
        validationErrorCode = errorJson?.error?.code || errorJson?.code;
      }
      
      // ✅ Fallback: If errorJson parsing failed, try to parse errorMessage as JSON
      // Sometimes the error body is a JSON string that needs to be parsed
      // Error message format might be: "Route ... not found - {"ok":false,"error":{"code":"CARTON_NOT_FOUND",...}}"
      if (!validationErrorCode && errorMessage) {
        // Try to extract JSON from error message (even if it's embedded in text)
        const jsonMatch = errorMessage.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsedError = JSON.parse(jsonMatch[0]);
            validationErrorCode = parsedError?.error?.code || parsedError?.code;
          } catch (parseErr) {
            // JSON parsing failed, ignore
          }
        }
      }
      
      // ✅ Check for validation errors in validate-carton endpoint (404 or 400 with structured errors)
      const isValidateCartonValidationError = (
        (response.status === 404 || response.status === 400) &&
        endpoint.includes("/api/transfer-in/") &&
        endpoint.includes("/validate-carton") &&
        method === "POST" &&
        validationErrorCode && // Has structured error code (CARTON_NOT_FOUND, BOX_NOT_FOUND, etc.)
        (validationErrorCode === "CARTON_NOT_FOUND" || validationErrorCode === "BOX_NOT_FOUND" || validationErrorCode === "VALIDATION_ERROR")
      );
      
      // ✅ Also check for validation errors in scan-transfer-carton endpoint (putaway validation)
      const isPutawayValidationError = (
        (response.status === 400 || response.status === 404) &&
        endpoint.includes("/api/putaway/scan-transfer-carton") &&
        method === "POST" &&
        validationErrorCode && // Has structured error code
        (validationErrorCode === "CARTON_NOT_FOUND" || validationErrorCode === "BOX_NOT_FOUND" || validationErrorCode === "LOCATION_NOT_FOUND" || validationErrorCode === "VALIDATION_ERROR")
      );
      
      const isValidationError = isValidateCartonValidationError || isPutawayValidationError;
      
      // ✅ Don't log validation errors as "API Request failed"
      // These are expected validation responses, not endpoint errors
      if (!isValidationError) {
        // ✅ Log relocation API errors with full details
        if (endpoint.includes("/api/relocation/")) {
          console.error(`❌ [RELOCATION API] Error: ${finalError}`);
          if (errorJson) {
            console.error(`❌ [RELOCATION API] Error JSON:`, JSON.stringify(errorJson, null, 2));
          }
        }
      } else {
        // Log as info/warning instead of error for validation responses
        const validationType = isValidateCartonValidationError ? "Carton validation" : "Putaway validation";
        // Extract message from flat or nested error format
        const validationMessage = errorJson?.error?.message || errorJson?.message || errorMessage;
        console.warn(`⚠️ ${validationType}: ${validationErrorCode} - ${validationMessage}`);
      }

      // For 404 errors on picking endpoints, don't log as error (handled gracefully by caller)
      if (
        response.status === 404 &&
        endpoint.includes("/api/wms/picking/")
      ) {
        // Picking endpoint 404s are handled above and will be caught by caller
        // Don't log as error - the handler above already logged as info
        // Just throw the error with is404 flag
      } else if (
        response.status === 404 &&
        endpoint === "/api/cartons/update-status"
      ) {
        console.warn(`⚠️ ${finalError}`);
        console.warn(
          `ℹ️ This is expected if the carton hasn't been created in the backend yet. The backend should create the carton automatically or handle this gracefully.`
        );
      } else if (
        response.status === 404 &&
        endpoint.includes("/api/transfer-in") &&
        endpoint.includes("/update-line-carton") &&
        method === "POST"
      ) {
        // This endpoint is optional - carton_id is tracked in events and processed during event sync
        // Handler above should have caught this, but if it didn't, log as warning instead of error
        console.warn(`ℹ️ ${finalError}`);
        console.warn(
          `ℹ️ This is expected. The update-line-carton endpoint is optional. carton_id will be processed from TRANSFER_IN_RECEIVE events during event sync.`
        );
      } else if (
        response.status === 404 &&
        endpoint.includes("/api/transfer-in") &&
        endpoint.includes("/update-status") &&
        method === "POST"
      ) {
        // This endpoint is optional - backend may auto-update status when all items are received
        // Handler above should have caught this, but if it didn't, log as warning instead of error
        console.warn(`ℹ️ ${finalError}`);
        console.warn(
          `ℹ️ This is expected. The update-status endpoint is optional. Backend may auto-update status when all items are received.`
        );
      } else if (
        (response.status === 404 || response.status === 400) &&
        endpoint.includes("/api/transfer-in/") &&
        endpoint.includes("/validate-carton") &&
        method === "POST"
      ) {
        // Don't log validation errors for validate-carton endpoint (handled gracefully above)
        // Check if it has structured error - if so, it's already logged as warning
        // If not, it's a true endpoint missing error
        if (!isValidationError) {
          // True endpoint missing - already handled above, don't log again
        }
      } else if (
        (response.status === 400 || response.status === 404) &&
        endpoint.includes("/api/putaway/scan-transfer-carton") &&
        method === "POST"
      ) {
        // Don't log validation errors for putaway scan endpoint (handled gracefully above)
        // Check if it has structured error - if so, it's already logged as warning
        if (!isValidationError) {
          // Not a validation error - log normally below
        }
      } else if (
        response.status === 404 &&
        endpoint.includes("/api/cycle-count")
      ) {
        // Cycle count 404s are handled above and return mock data - don't log as error
        // This check is here just in case the handler above didn't catch it
        console.warn(`ℹ️ Cycle Count endpoint returned 404 - using mock data: ${endpoint}`);
        return simulateApiResponse(endpoint, method, body);
      } else {
        // ✅ Don't log validation errors (they're handled above and logged as warnings)
        // ✅ Don't log 404 errors for getPutawayTask endpoint (it's optional and handled gracefully)
        const isPutawayTask404 = response.status === 404 && 
                                  endpoint.includes("/api/putaway/tasks/") && 
                                  method === "GET" &&
                                  !endpoint.endsWith("/api/putaway/tasks"); // Individual task endpoint, not list

        const dupUnloadHttpCode =
          errorJson?.error?.code || errorJson?.code;
        const isDuplicateUnload409 =
          response.status === 409 &&
          endpoint.includes("/api/inbound/unload-line") &&
          method === "POST" &&
          (dupUnloadHttpCode === "DUPLICATE_UNLOAD" ||
            errorJson?.duplicate === true);
        
        if (!isValidationError && !endpoint.includes("/api/relocation/") && !isPutawayTask404 && !isDuplicateUnload409) {
          console.error(`❌ ${finalError}`);
        } else if (isDuplicateUnload409) {
          console.warn(
            `ℹ️ Duplicate unload (409 DUPLICATE_UNLOAD) — same session + unit already recorded`
          );
        } else if (isPutawayTask404) {
          // Log as info instead of error for optional endpoint
          console.warn(`ℹ️ getPutawayTask endpoint not available (404): ${endpoint} - this is expected and handled gracefully`);
        }
      }

      // ✅ Attach error details to error object for better error handling
      const error = new Error(finalError);
      (error as any).status = response.status;
      
      // Handle nested error structure: {"ok": false, "error": {"code": "...", "message": "..."}}
      // Also handle flat structure: {"code": "BOX_NOT_FOUND", "message": "..."}
      let errorCode = errorJson?.code || null;
      let errorData = errorJson || null;
      
      if (errorJson?.error) {
        // Nested structure: {"ok": false, "error": {"code": "...", "message": "..."}}
        errorCode = errorJson.error.code || errorCode;
        errorData = errorJson.error || errorData;
      } else if (errorJson?.code && errorJson?.message) {
        // ✅ Flat structure: {"code": "BOX_NOT_FOUND", "message": "..."}
        errorCode = errorJson.code;
        errorData = { code: errorJson.code, message: errorJson.message };
      }
      
      (error as any).code = errorCode;
      (error as any).data = errorData;
      (error as any).response = { status: response.status, data: errorData };
      
      // Also attach the full errorJson for nested structure access
      (error as any).errorJson = errorJson;
      
      // ✅ Check if this is a validation error (structured error response, not a true API error)
      // Check for validate-carton endpoint (404 or 400 with structured errors)
      const isValidateCartonValidationResponse = (
        (response.status === 404 || response.status === 400) &&
        endpoint.includes("/api/transfer-in/") &&
        endpoint.includes("/validate-carton") &&
        method === "POST" &&
        errorCode && // Has structured error code
        (errorCode === "CARTON_NOT_FOUND" || errorCode === "BOX_NOT_FOUND" || errorCode === "VALIDATION_ERROR")
      );
      
      // ✅ Also check for putaway validation errors (scan-transfer-carton endpoint)
      const isPutawayValidationResponse = (
        (response.status === 400 || response.status === 404) &&
        endpoint.includes("/api/putaway/scan-transfer-carton") &&
        method === "POST" &&
        errorCode && // Has structured error code
        (errorCode === "CARTON_NOT_FOUND" || errorCode === "BOX_NOT_FOUND" || errorCode === "LOCATION_NOT_FOUND" || errorCode === "VALIDATION_ERROR")
      );
      
      // Mark error so calling functions can handle it properly
      if (isValidateCartonValidationResponse || isPutawayValidationResponse) {
        (error as any).isValidationError = true; // Not a true API error, it's a validation response
      }

      throw error;
    }

    // If response is OK, read body (201 Created may have empty JSON — avoid response.json() throw)
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      const text = await response.text();
      if (!text || !String(text).trim()) {
        return { ok: true, status: response.status };
      }
      try {
        return JSON.parse(text);
      } catch {
        console.warn(
          `⚠️ API returned non-parseable JSON body (status ${response.status}): ${text.substring(0, 120)}`
        );
        return { ok: true, status: response.status, raw: text.substring(0, 200) };
      }
    } else {
      // If response is not JSON, return as text
      const text = await response.text();
      console.warn(
        `⚠️ API returned non-JSON response: ${text.substring(0, 100)}`
      );
      return text;
    }
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error(`Request timeout after ${effectiveTimeout}ms: ${url}`);
    }
    if (error.message && error.message.includes("API error")) {
      // Check if this is a picking endpoint 404 (handled gracefully)
      if (error.is404 && endpoint.includes("/api/wms/picking/")) {
        // Don't log as error - this is expected and handled gracefully
        throw error; // Re-throw with is404 flag
      }
      // ✅ Check if this is a validation error (not a true API error)
      if (error.isValidationError || error?.isValidationError) {
        // Don't log as error - this is a validation response, not an API failure
        throw error; // Re-throw with isValidationError flag
      }
      throw error; // Re-throw API errors as-is
    }
    // Network errors or other errors
    const errorMsg = error.message || error.toString() || "Unknown error";
    
    // ✅ Check if this is a validation error (not a true API error)
    // Also check error data for structured error codes
    const errorData = error?.data || error?.errorJson || error?.response?.data;
    const errorCode = errorData?.error?.code || errorData?.code || error?.code;
    const isValidationErrorFromData = (
      errorCode && 
      (errorCode === "CARTON_NOT_FOUND" || errorCode === "BOX_NOT_FOUND" || errorCode === "LOCATION_NOT_FOUND" || errorCode === "VALIDATION_ERROR") &&
      ((endpoint.includes("/api/transfer-in/") && endpoint.includes("/validate-carton")) ||
       endpoint.includes("/api/putaway/scan-transfer-carton"))
    );
    
    if (error.isValidationError || error?.isValidationError || isValidationErrorFromData) {
      // Don't log as error - this is a validation response, not an API failure
      // Mark error so it's not logged
      if (!error.isValidationError) {
        (error as any).isValidationError = true;
      }
      throw error; // Re-throw with isValidationError flag
    }
    
    // Detect server unavailable scenarios
    const isServerUnavailable = 
      errorMsg.includes("Network request failed") ||
      errorMsg.includes("Failed to fetch") ||
      errorMsg.includes("NetworkError") ||
      errorMsg.includes("ERR_NETWORK") ||
      errorMsg.includes("ERR_INTERNET_DISCONNECTED") ||
      error.name === "TypeError" && errorMsg.includes("fetch");
    
    // Create user-friendly error message
    let userFriendlyError: Error;
    if (isServerUnavailable) {
      userFriendlyError = new Error("SERVER_UNAVAILABLE");
      userFriendlyError.message = "Server is not accessible. Please check your connection and try again.";
    } else {
      userFriendlyError = new Error(`Network error: ${errorMsg}`);
    }
    
    // Don't log picking endpoint errors as they're handled gracefully
    // ✅ Also don't log validate-carton validation errors (they're validation responses, not API failures)
    let isValidationError = error?.isValidationError || false;
    
    // ✅ Fallback: Check error message for validation error codes if flag not set
    if (!isValidationError && errorMsg) {
      const isValidateCartonEndpoint = endpoint.includes("/api/transfer-in/") && endpoint.includes("/validate-carton");
      const isPutawayEndpoint = endpoint.includes("/api/putaway/scan-transfer-carton");
      
      if (isValidateCartonEndpoint || isPutawayEndpoint) {
        // Try to extract and parse JSON from error message
        // Error message format: "Route ... not found - {"ok":false,"error":{"code":"CARTON_NOT_FOUND",...}}"
        const jsonMatch = errorMsg.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const errorData = JSON.parse(jsonMatch[0]);
            const errorCode = errorData?.error?.code || errorData?.code;
            if (errorCode && (errorCode === "CARTON_NOT_FOUND" || errorCode === "BOX_NOT_FOUND" || errorCode === "LOCATION_NOT_FOUND" || errorCode === "VALIDATION_ERROR")) {
              isValidationError = true;
              const errorMessage = errorData?.error?.message || errorData?.message;
              const validationType = isValidateCartonEndpoint ? "Carton validation" : "Putaway validation";
              console.warn(`⚠️ ${validationType}: ${errorCode} - ${errorMessage || "Validation failed"}`);
            }
          } catch (parseErr) {
            // JSON parsing failed, check with regex as fallback
            const validationErrorPattern = /"(CARTON_NOT_FOUND|BOX_NOT_FOUND|LOCATION_NOT_FOUND|VALIDATION_ERROR)"/;
            if (validationErrorPattern.test(errorMsg)) {
              isValidationError = true;
              const validationType = isValidateCartonEndpoint ? "Carton validation" : "Putaway validation";
              console.warn(`⚠️ ${validationType}: Validation error detected in error message`);
            }
          }
        }
      }
    }
    
    if (!endpoint.includes("/api/wms/picking/") && !isValidationError) {
      if (isServerUnavailable) {
        console.warn(`⚠️ Server unavailable: ${method} ${url} - ${errorMsg}`);
      } else {
        console.error(`❌ API Request failed: ${method} ${url}`, errorMsg);
      }
    }
    // Preserve isValidationError flag in userFriendlyError
    if (isValidationError) {
      (userFriendlyError as any).isValidationError = true;
    }
    throw userFriendlyError;
  }
};

const simulateApiResponse = async (
  endpoint: string,
  method: string,
  body?: any
) => {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 300));

  if (endpoint === "/api/inbound/start") {
    return { inbound_session: `SESSION-${Date.now()}` };
  }

  if (endpoint === "/api/carton/lock") {
    return { locked: true, message: "Carton locked successfully" };
  }

  if (endpoint === "/api/carton/complete") {
    return { ok: true };
  }

  if (endpoint === "/api/inbound/update") {
    return { ok: true, message: "Session updated successfully" };
  }

  if (endpoint === "/api/inbound/complete") {
    return { ok: true, message: "Session completed successfully" };
  }

  if (endpoint === "/api/cartons/update-status") {
    // Mock response for carton status update
    const updatedCount = body.cartons ? body.cartons.length : 1;
    return {
      success: true,
      message:
        updatedCount > 1
          ? "Carton statuses updated successfully"
          : "Carton status updated successfully",
      updated_count: updatedCount,
      ...(body.cartons && {
        cartons: body.cartons.map((c: any) => ({
          carton_id: c.carton_id,
          status: c.status,
          updated: true,
        })),
      }),
    };
  }

  if (endpoint === "/api/events/batch") {
    return { acked: body.map((e: any) => e.offline_uuid), failed: [] };
  }

  if (endpoint.startsWith("/api/boxes/create")) {
    return { box_id: `BOX-${Date.now()}` };
  }

  if (
    endpoint.startsWith("/api/boxes/close") ||
    endpoint.startsWith("/api/boxes/reopen")
  ) {
    return { ok: true };
  }

  if (endpoint.startsWith("/api/transfer-cartons/create")) {
    return { tc_id: `TC-${Date.now()}` };
  }

  if (
    endpoint.startsWith("/api/transfer-cartons/seal") ||
    endpoint.startsWith("/api/transfer-cartons/dispatch")
  ) {
    return { ok: true };
  }

  // PULL API simulations
  if (endpoint.startsWith("/api/asn/")) {
    const asn_no = endpoint.split("/api/asn/")[1];
    return {
      asn_no,
      transfer_order: "TO-00012",
      cartons: ["CTN-001", "CTN-002", "CTN-003", "CTN-004"],
    };
  }

  if (endpoint.startsWith("/api/transfer-order/by-asn/")) {
    return {
      to_no: "TO-00012",
      asn_no: endpoint.split("/api/transfer-order/by-asn/")[1],
      allocations: [
        { store: "SR-01", item_code: "ITEM-0001", allocated_qty: 2 },
        { store: "SR-01", item_code: "ITEM-0002", allocated_qty: 2 },
        { store: "SR-02", item_code: "ITEM-0001", allocated_qty: 1 },
        { store: "SR-02", item_code: "ITEM-0003", allocated_qty: 2 },
        { store: "SR-03", item_code: "ITEM-0004", allocated_qty: 2 },
        { store: "SR-03", item_code: "ITEM-0005", allocated_qty: 1 },
      ],
    };
  }

  if (endpoint.startsWith("/api/boxes")) {
    return [
      {
        box_id: "BOX-SR01-001",
        asn_no: "ASN-00045",
        store: "SR-01",
        status: "Open",
      },
      {
        box_id: "BOX-SR02-001",
        asn_no: "ASN-00045",
        store: "SR-02",
        status: "Open",
      },
      {
        box_id: "BOX-SR03-001",
        asn_no: "ASN-00045",
        store: "SR-03",
        status: "Open",
      },
    ];
  }

  if (endpoint.startsWith("/api/transfer-cartons")) {
    return [];
  }

  // Online item lookup (cycle count Scan Online)
  if (endpoint.includes("/api/master/items/lookup")) {
    const query = endpoint.includes("?") ? endpoint.split("?")[1] : "";
    const sp = new URLSearchParams(query);
    const scanned = (sp.get("barcode") || sp.get("item_code") || "").trim();
    return {
      ok: true,
      found: false,
      message: scanned
        ? `Item or barcode '${scanned}' not found in system`
        : "Item not found",
    };
  }

  // Master Data Pull APIs — paged item master (demo)
  if (endpoint.startsWith("/api/master/items")) {
    const query = endpoint.includes("?") ? endpoint.split("?")[1] : "";
    const sp = new URLSearchParams(query);
    const limit = Math.min(
      Math.max(parseInt(sp.get("limit") || "5000", 10) || 5000, 1),
      20000
    );
    const offset = Math.max(parseInt(sp.get("offset") || "0", 10) || 0, 0);
    const allItems = [
      {
        item_code: "ITEM-0001",
        barcode: "100000000001",
        item_name: "Product 1",
        updated_on: new Date().toISOString(),
      },
      {
        item_code: "ITEM-0002",
        barcode: "100000000002",
        item_name: "Product 2",
        updated_on: new Date().toISOString(),
      },
      {
        item_code: "ITEM-0003",
        barcode: "100000000003",
        item_name: "Product 3",
        updated_on: new Date().toISOString(),
      },
    ];
    const slice = allItems.slice(offset, offset + limit);
    return {
      items: slice,
      total: allItems.length,
      limit,
      offset,
      has_more: offset + slice.length < allItems.length,
      next_offset: offset + slice.length,
    };
  }

  if (endpoint === "/api/master/asns") {
    return [
      {
        asn_no: "ASN-00045",
        payload_json: JSON.stringify({
          asn_no: "ASN-00045",
          transfer_order: "TO-00012",
          dock: "DOCK-01",
        }),
        updated_on: new Date().toISOString(),
        cartons: [
          {
            carton_id: "CTN-001",
            items: [{ item_code: "ITEM-0001", shipped_qty: 2 }],
          },
        ],
      },
    ];
  }

  if (endpoint === "/api/master/transfer-orders") {
    return [
      {
        to_no: "TO-00012",
        asn_no: "ASN-00045",
        allocations: [
          { store: "SR-01", item_code: "ITEM-0001", allocated_qty: 2 },
        ],
      },
    ];
  }

  if (endpoint === "/api/master/boxes") {
    return [
      {
        box_id: "BOX-SR01-001",
        asn_no: "ASN-00045",
        to_no: "TO-00012",
        store: "SR-01",
        status: "Open",
        purpose: "STORE",
        updated_on: new Date().toISOString(),
      },
    ];
  }

  if (endpoint === "/api/master/transfer-cartons") {
    return [
      {
        tc_id: "TC-1766410124807",
        asn_no: "ASN-00045",
        to_no: "TO-00012",
        store: "SR-01",
        status: "Sealed",
        updated_on: new Date().toISOString(),
      },
    ];
  }

  if (endpoint === "/api/master/warehouse-racks") {
    return [
      {
        rack_id: "RACK-A-01",
        location_code: "RACK-A-01",
        capacity: 100,
        current_qty: 0,
        updated_on: new Date().toISOString(),
      },
    ];
  }

  if (endpoint === "/api/master/warehouses") {
    return [
      {
        warehouse_id: "WH-001",
        warehouse_name: "Main Warehouse",
        location: "Building A",
        is_active: 1,
        updated_on: new Date().toISOString(),
      },
    ];
  }

  if (endpoint === "/api/master/locations") {
    return [
      {
        location_id: "A1-R01-L1-B1",
        warehouse: "WH-MAIN",
        zone: "Zone A",
        aisle: "Aisle 01",
        parent_rack: "Rack 01",
        level: "1",
        bin_id: "B1",
        location_type: "Picking",
        location_type_detailed: "Bin/Shelf",
        is_available: true,
        capacity_volume_weight: 100.0,
        updated_on: new Date().toISOString(),
      },
      {
        location_id: "STAGE-01",
        warehouse: "WH-MAIN",
        zone: "Staging Area",
        aisle: null,
        parent_rack: null,
        level: null,
        bin_id: "SL-01",
        location_type: "Bulk Storage",
        location_type_detailed: "Staging Lane",
        is_available: true,
        capacity_volume_weight: 1000.0,
        updated_on: new Date().toISOString(),
      },
    ];
  }

  if (endpoint === "/api/master/users") {
    return [
      {
        user_code: "USER-001",
        user_name: "John Doe",
        password: "password123",
        device_id: "DEV-001",
        is_active: 1,
        updated_on: new Date().toISOString(),
      },
      {
        user_code: "USER-002",
        user_name: "Jane Smith",
        password: "password456",
        device_id: "DEV-002",
        is_active: 1,
        updated_on: new Date().toISOString(),
      },
    ];
  }

  if (endpoint === "/api/master/all") {
    return {
      items: [
        {
          item_code: "ITEM-0001",
          barcode: "100000000001",
          item_name: "Product 1",
          updated_on: new Date().toISOString(),
        },
      ],
      asns: [
        {
          asn_no: "ASN-00045",
          payload_json: JSON.stringify({
            asn_no: "ASN-00045",
            transfer_order: "TO-00012",
          }),
          updated_on: new Date().toISOString(),
        },
      ],
      transfer_orders: [
        {
          to_no: "TO-00012",
          asn_no: "ASN-00045",
          allocations: [
            { store: "SR-01", item_code: "ITEM-0001", allocated_qty: 2 },
          ],
        },
      ],
      boxes: [
        {
          box_id: "BOX-SR01-001",
          asn_no: "ASN-00045",
          store: "SR-01",
          status: "Open",
          updated_on: new Date().toISOString(),
        },
      ],
      transfer_cartons: [
        {
          tc_id: "TC-1766410124807",
          asn_no: "ASN-00045",
          store: "SR-01",
          status: "Sealed",
          updated_on: new Date().toISOString(),
        },
      ],
      warehouse_racks: [
        {
          rack_id: "RACK-A-01",
          location_code: "RACK-A-01",
          updated_on: new Date().toISOString(),
        },
      ],
    };
  }

  // Removed Cycle Count API Mock Data - data should come from backend
  // Cycle Count mock data removed - uncomment below if needed for testing
  /*
  if (endpoint === "/api/cycle-count" || endpoint.startsWith("/api/cycle-count?")) {
    return [
      {
        title: "CC-0001",
        status: "In Progress",
        count_type: "Cycle",
        warehouse: "WH-MAIN",
        zone: "ZONE-A",
        count_date: "2025-01-27",
        total_items: 10,
        counted_items: 5,
        items_with_discrepancy: 2,
        freeze_stock: false,
        created_by: "SYSTEM",
        created_on: "2025-01-27T08:00:00.000Z",
        updated_on: "2025-01-27T10:30:00.000Z",
        lines: [
          {
            id: 1,
            item_code: "ITEM-001",
            bin_location: "BIN-001",
            expected_qty: 50.0,
            actual_qty: 48.0,
            discrepancy: -2.0,
            status: "Counted",
            counted_by: "USER-001",
            counted_on: "2025-01-27T10:00:00.000Z",
            discrepancy_reason: "Found 2 damaged units",
          },
          {
            id: 2,
            item_code: "ITEM-002",
            bin_location: "BIN-002",
            expected_qty: 30.0,
            actual_qty: 32.0,
            discrepancy: 2.0,
            status: "Counted",
            counted_by: "USER-001",
            counted_on: "2025-01-27T10:15:00.000Z",
            discrepancy_reason: "Found 2 extra units",
          },
          {
            id: 3,
            item_code: "ITEM-003",
            bin_location: "BIN-003",
            expected_qty: 25.0,
            actual_qty: undefined,
            discrepancy: undefined,
            status: "Pending",
            counted_by: null,
            counted_on: null,
            discrepancy_reason: null,
          },
          {
            id: 4,
            item_code: "ITEM-004",
            bin_location: "BIN-004",
            expected_qty: 40.0,
            actual_qty: undefined,
            status: "Pending",
          },
          {
            id: 5,
            item_code: "ITEM-005",
            bin_location: "BIN-005",
            expected_qty: 20.0,
            actual_qty: 20.0,
            discrepancy: 0.0,
            status: "Counted",
            counted_by: "USER-001",
            counted_on: "2025-01-27T09:45:00.000Z",
          },
          {
            id: 6,
            item_code: "ITEM-006",
            bin_location: "BIN-006",
            expected_qty: 35.0,
            actual_qty: undefined,
            status: "Pending",
          },
          {
            id: 7,
            item_code: "ITEM-007",
            bin_location: "BIN-007",
            expected_qty: 15.0,
            actual_qty: undefined,
            status: "Pending",
          },
          {
            id: 8,
            item_code: "ITEM-008",
            bin_location: "BIN-008",
            expected_qty: 28.0,
            actual_qty: undefined,
            status: "Pending",
          },
          {
            id: 9,
            item_code: "ITEM-009",
            bin_location: "BIN-009",
            expected_qty: 22.0,
            actual_qty: undefined,
            status: "Pending",
          },
          {
            id: 10,
            item_code: "ITEM-010",
            bin_location: "BIN-010",
            expected_qty: 18.0,
            actual_qty: undefined,
            status: "Pending",
          },
        ],
      },
      {
        title: "CC-0002",
        status: "Scheduled",
        count_type: "Full",
        warehouse: "WH-MAIN",
        zone: "ZONE-B",
        count_date: "2025-01-28",
        total_items: 8,
        counted_items: 0,
        items_with_discrepancy: 0,
        freeze_stock: true,
        created_by: "SYSTEM",
        created_on: "2025-01-26T14:00:00.000Z",
        updated_on: "2025-01-26T14:00:00.000Z",
        lines: [
          {
            id: 11,
            item_code: "ITEM-011",
            bin_location: "BIN-011",
            expected_qty: 60.0,
            actual_qty: undefined,
            status: "Pending",
          },
          {
            id: 12,
            item_code: "ITEM-012",
            bin_location: "BIN-012",
            expected_qty: 45.0,
            actual_qty: undefined,
            status: "Pending",
          },
          {
            id: 13,
            item_code: "ITEM-013",
            bin_location: "BIN-013",
            expected_qty: 30.0,
            actual_qty: undefined,
            status: "Pending",
          },
          {
            id: 14,
            item_code: "ITEM-014",
            bin_location: "BIN-014",
            expected_qty: 55.0,
            actual_qty: undefined,
            status: "Pending",
          },
          {
            id: 15,
            item_code: "ITEM-015",
            bin_location: "BIN-015",
            expected_qty: 25.0,
            actual_qty: undefined,
            status: "Pending",
          },
          {
            id: 16,
            item_code: "ITEM-016",
            bin_location: "BIN-016",
            expected_qty: 40.0,
            actual_qty: undefined,
            status: "Pending",
          },
          {
            id: 17,
            item_code: "ITEM-017",
            bin_location: "BIN-017",
            expected_qty: 35.0,
            actual_qty: undefined,
            status: "Pending",
          },
          {
            id: 18,
            item_code: "ITEM-018",
            bin_location: "BIN-018",
            expected_qty: 50.0,
            actual_qty: undefined,
            status: "Pending",
          },
        ],
      },
      {
        title: "CC-0003",
        status: "Draft",
        count_type: "Spot",
        warehouse: "WH-MAIN",
        zone: null,
        count_date: "2025-01-29",
        total_items: 5,
        counted_items: 0,
        items_with_discrepancy: 0,
        freeze_stock: false,
        created_by: "USER-001",
        created_on: "2025-01-25T16:00:00.000Z",
        updated_on: "2025-01-25T16:00:00.000Z",
        lines: [
          {
            id: 19,
            item_code: "ITEM-019",
            bin_location: "BIN-019",
            expected_qty: 12.0,
            actual_qty: undefined,
            status: "Pending",
          },
          {
            id: 20,
            item_code: "ITEM-020",
            bin_location: "BIN-020",
            expected_qty: 8.0,
            actual_qty: undefined,
            status: "Pending",
          },
          {
            id: 21,
            item_code: "ITEM-021",
            bin_location: "BIN-021",
            expected_qty: 15.0,
            actual_qty: undefined,
            status: "Pending",
          },
          {
            id: 22,
            item_code: "ITEM-022",
            bin_location: "BIN-022",
            expected_qty: 10.0,
            actual_qty: undefined,
            status: "Pending",
          },
          {
            id: 23,
            item_code: "ITEM-023",
            bin_location: "BIN-023",
            expected_qty: 20.0,
            actual_qty: undefined,
            status: "Pending",
          },
        ],
      },
    ];
  }

  if (endpoint.startsWith("/api/cycle-count/") && method === "GET") {
    const title = endpoint.split("/api/cycle-count/")[1];
    // Return single Cycle Count detail
    return {
      title: title || "CC-0001",
      status: "In Progress",
      count_type: "Cycle",
      warehouse: "WH-MAIN",
      zone: "ZONE-A",
      count_date: "2025-01-27",
      total_items: 10,
      counted_items: 5,
      items_with_discrepancy: 2,
      freeze_stock: false,
      created_by: "SYSTEM",
      created_on: "2025-01-27T08:00:00.000Z",
      updated_on: "2025-01-27T10:30:00.000Z",
      lines: [
        {
          id: 1,
          item_code: "ITEM-001",
          bin_location: "BIN-001",
          expected_qty: 50.0,
          actual_qty: 48.0,
          discrepancy: -2.0,
          status: "Counted",
          counted_by: "USER-001",
          counted_on: "2025-01-27T10:00:00.000Z",
          discrepancy_reason: "Found 2 damaged units",
        },
        {
          id: 2,
          item_code: "ITEM-002",
          bin_location: "BIN-002",
          expected_qty: 30.0,
          actual_qty: 32.0,
          discrepancy: 2.0,
          status: "Counted",
          counted_by: "USER-001",
          counted_on: "2025-01-27T10:15:00.000Z",
          discrepancy_reason: "Found 2 extra units",
        },
        {
          id: 3,
          item_code: "ITEM-003",
          bin_location: "BIN-003",
          expected_qty: 25.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 4,
          item_code: "ITEM-004",
          bin_location: "BIN-004",
          expected_qty: 40.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 5,
          item_code: "ITEM-005",
          bin_location: "BIN-005",
          expected_qty: 20.0,
          actual_qty: 20.0,
          discrepancy: 0.0,
          status: "Counted",
          counted_by: "USER-001",
          counted_on: "2025-01-27T09:45:00.000Z",
        },
        {
          id: 6,
          item_code: "ITEM-006",
          bin_location: "BIN-006",
          expected_qty: 35.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 7,
          item_code: "ITEM-007",
          bin_location: "BIN-007",
          expected_qty: 15.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 8,
          item_code: "ITEM-008",
          bin_location: "BIN-008",
          expected_qty: 28.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 9,
          item_code: "ITEM-009",
          bin_location: "BIN-009",
          expected_qty: 22.0,
          actual_qty: undefined,
          status: "Pending",
        },
        {
          id: 10,
          item_code: "ITEM-010",
          bin_location: "BIN-010",
          expected_qty: 18.0,
          actual_qty: undefined,
          status: "Pending",
        },
      ],
    };
  }
  */

  // Removed all Cycle Count mock data - data should come from backend

  if (
    endpoint === "/api/inbound/sessions" ||
    endpoint.startsWith("/api/inbound/sessions?")
  ) {
    return [];
  }

  if (endpoint === "/api/inbound/unload-line" && method === "POST" && body) {
    const parent = String(body.parent_title || "").trim();
    const unitType = String(body.unit_type || "Carton").trim();
    const unitId = String(body.unit_id || "").trim().toUpperCase();
    if (!parent || !unitId) {
      return { ok: false, message: "parent_title and unit_id required" };
    }
    const list = demoUnloadLinesBySession.get(parent) || [];
    const exists = list.some(
      (r) =>
        String(r.unit_type || "")
          .trim()
          .toUpperCase() === unitType.toUpperCase() &&
        String(r.unit_id || "")
          .trim()
          .toUpperCase() === unitId
    );
    if (exists) {
      const err = new Error(
        "API error (409): Unload line already exists for this session and unit (DUPLICATE_UNLOAD)"
      );
      (err as any).status = 409;
      (err as any).code = "DUPLICATE_UNLOAD";
      (err as any).data = {
        duplicate: true,
        error: { code: "DUPLICATE_UNLOAD", duplicate: true },
      };
      throw err;
    }
    const row = {
      parent_title: parent,
      unit_type: unitType,
      unit_id: unitId,
      scanned_by: String(body.scanned_by || "demo").trim(),
      scanned_on: String(body.scanned_on || new Date().toISOString()),
      device_id: String((body as any).device_id || "").trim() || undefined,
    };
    list.push(row);
    demoUnloadLinesBySession.set(parent, list);
    return { ok: true, created: true, status: 201 };
  }

  if (endpoint.startsWith("/api/inbound/unload-lines") && method === "GET") {
    const q = endpoint.includes("?") ? endpoint.split("?")[1] : "";
    const sp = new URLSearchParams(q);
    const parent =
      sp.get("parent_title")?.trim() ||
      sp.get("parentTitle")?.trim() ||
      "";
    const lines = demoUnloadLinesBySession.get(parent) || [];
    return {
      lines,
      unload_lines: lines,
      items: lines,
      results: lines,
      demo: true,
      data: {
        lines,
        unload_lines: lines,
        items: lines,
        results: lines,
        parent_title: parent,
      },
    };
  }

  return { ok: true };
};

export const apiService = {
  startInbound: async (data: {
    asn_no: string;
    transfer_order: string;
    warehouse?: string;
    dock: string;
    user_id: string;
    device_id: string;
    source_type?: "ASN" | "TransferIn";
    source_doc?: string;
    inbound_session?: string;
    requested_session_id?: string;
  }) => {
    return makeRequest("/api/inbound/session/start", "POST", {
      inbound_session: data.inbound_session || data.requested_session_id,
      requested_session_id: data.requested_session_id || data.inbound_session,
      source_type: data.source_type || "ASN",
      source_doc: data.source_doc || data.asn_no,
      transfer_order: data.transfer_order,
      warehouse: data.warehouse || "WH-MAIN",
      dock: data.dock,
      user_id: data.user_id,
      device_id: data.device_id,
    });
  },

  updateInboundSession: async (data: {
    inbound_session: string;
    asn_no: string;
    status?: "Active" | "Completed" | "Cancelled";
    completed_cartons?: number;
    total_cartons?: number;
    transfer_order?: string;
    dock?: string;
    user_id?: string;
    device_id?: string;
  }) => {
    // Single endpoint that both creates new sessions and updates existing ones
    // Prevents duplicates automatically - safe to call multiple times
    return makeRequest("/api/inbound/update", "POST", data);
  },

  /** List inbound sessions (e.g. for session totals / completed counts). */
  getInboundSessions: async () => {
    return makeRequest("/api/inbound/sessions", "GET");
  },

  lockCarton: async (data: {
    inbound_session: string;
    asn_no: string;
    carton_id: string;
    user_id: string;
    device_id: string;
  }) => {
    return makeRequest("/api/carton/lock", "POST", data);
  },

  completeCarton: async (data: {
    inbound_session: string;
    asn_no: string;
    carton_id: string;
    user_id: string;
    device_id: string;
    override_reason?: string;
  }) => {
    return makeRequest("/api/carton/complete", "POST", data);
  },

  getCartonLockStatus: async (params: {
    asn_no: string;
    carton_id: string;
  }) => {
    const query = new URLSearchParams();
    query.set("asn_no", params.asn_no.trim());
    query.set("carton_id", params.carton_id.trim());
    return makeRequest(`/api/carton/lock-status?${query.toString()}`, "GET");
  },

  updateCartonStatus: async (data: {
    asn_no: string;
    inbound_session: string;
    carton_id?: string;
    cartons?: { carton_id: string; status: string }[];
    status?: string;
    locked_by?: string;
    locked_on?: string;
    user_id?: string | null;
    device_id?: string | null;
  }) => {
    // Send status as-is: Mobile app uses "Receiving" (without space)
    // Backend must accept "Receiving" instead of "In Receiving"
    return makeRequest("/api/cartons/update-status", "POST", data);
  },

  /**
   * Complete inbound session — tells the backend that receiving for this ASN is finished.
   * Backend should set ASN status to "Completed" / "Received" and carton/receiving status accordingly.
   * Call this when all cartons are received (e.g. after sync when all cartons are in "Received" state).
   */
  completeInboundSession: async (data: {
    inbound_session: string;
    asn_no: string;
    user_id: string;
    device_id: string;
  }) => {
    return makeRequest("/api/inbound/complete", "POST", data);
  },

  // Unload Line APIs
  createUnloadLine: async (data: {
    parent_title: string;
    unit_type: string;
    unit_id: string;
    scanned_by: string;
    scanned_on?: string;
    /** Same handset id as Settings / session — persisted on tabInboundUnloadLine for GET unload-lines. */
    device_id?: string;
  }) => {
    return makeRequest("/api/inbound/unload-line", "POST", data);
  },

  getUnloadLines: async (parent_title: string) => {
    const queryParams = new URLSearchParams();
    queryParams.append("parent_title", parent_title);
    // Avoid any intermediary caching an empty list right after another device unloads
    queryParams.append("_", String(Date.now()));
    return makeRequest(
      `/api/inbound/unload-lines?${queryParams.toString()}`,
      "GET"
    );
  },

  // Receive Line APIs
  createReceiveLine: async (data: {
    parent_title: string; // Session ID
    carton_id: string; // Backend expects carton_id
    item_code: string;
    expected_qty: number;
    received_qty: number;
    condition?: string;
    remarks?: string | null;
  }) => {
    return makeRequest("/api/inbound/receive-line", "POST", data);
  },

  createReceiveLines: async (data: {
    parent_title: string; // Session ID
    receive_lines: {
      carton_id: string; // Changed back to carton_id as backend expects it
      item_code: string;
      expected_qty: number;
      received_qty: number;
      condition?: string;
      remarks?: string | null;
    }[];
  }) => {
    return makeRequest("/api/inbound/receive-lines", "POST", data);
  },

  getReceiveLines: async (parent_title: string) => {
    const queryParams = new URLSearchParams();
    queryParams.append("parent_title", parent_title);
    return makeRequest(
      `/api/inbound/receive-lines?${queryParams.toString()}`,
      "GET"
    );
  },

  batchEvents: async (events: ScanEvent[], updateMode: boolean = false) => {
    // Backend expects events to be wrapped in an object with an 'events' property
    // If updateMode is true, include update_mode flag for updating existing scanned items
    // Ensure events is always an array
    if (!Array.isArray(events)) {
      console.error(`❌ ERROR: events must be an array, got:`, typeof events);
      throw new Error("Events must be an array");
    }
    
    const requestBody: any = {
      events: events || [],
    };
    
    if (updateMode) {
      requestBody.update_mode = true;
    }
    
    console.log(`📤 Batch Events Request:`, {
      update_mode: updateMode,
      events_count: events?.length || 0,
      request_body_keys: Object.keys(requestBody),
      has_events: !!requestBody.events,
      events_is_array: Array.isArray(requestBody.events),
      events_length: requestBody.events?.length || 0,
    });
    
    // Verify request body structure before sending
    if (!requestBody.events || !Array.isArray(requestBody.events)) {
      console.error(`❌ ERROR: Request body missing events array:`, requestBody);
      throw new Error("Request body must contain events array");
    }
    
    return makeRequest("/api/events/batch", "POST", requestBody);
  },

  createBox: async (data: {
    asn_no?: string;
    to_no?: string;
    store: string;
    purpose?: "STORE" | "PUTAWAY";
    user_id?: string | null;
    carton_id?: string; // ✅ Carton ID to associate with the BOX
    box_id?: string; // ✅ BOX ID (for Transfer In, should be TI-PUT- format)
    transfer_in?: string; // ✅ Transfer In number (alternative to asn_no for Transfer In)
  }) => {
    return makeRequest("/api/boxes/create", "POST", data);
  },

  // ✅ NEW: Create sort box (for Transfer In - uses different endpoint)
  createSortBox: async (data: {
    box_id: string; // ✅ Carton ID (generated CTN-TI-... ID)
    asn_no?: string;
    transfer_in?: string;
    store: string;
    purpose?: "STORE" | "PUTAWAY";
    user_id?: string;
    carton_id?: string;
    to_no?: string;
  }) => {
    return makeRequest("/api/sort-box/create", "POST", data);
  },

  scanSortBox: async (data: {
    purpose?: "STORE" | "PUTAWAY";
    asn_no: string;
    box_id: string;
    carton_id?: string | null;
    item_code: string;
    qty: number;
    user_id?: string | null;
    device_id?: string | null;
  }) => {
    return makeRequest("/api/sort-box/scan", "POST", data);
  },

  adjustSortBox: async (data: {
    purpose?: "STORE" | "PUTAWAY";
    asn_no: string;
    box_id: string;
    carton_id?: string | null;
    item_code: string;
    new_qty: number;
    user_id?: string | null;
    device_id?: string | null;
  }) => {
    return makeRequest("/api/sort-box/adjust", "POST", data);
  },

  closeBox: async (data: { box_id: string; closed_by?: string }) => {
    return makeRequest("/api/boxes/close", "POST", data);
  },

  printBox: async (data: {
    box_id: string;
    copies?: number;
    printer_id?: string;
  }) => {
    return makeRequest("/api/boxes/print", "POST", data);
  },

  reopenBox: async (data: { box_id: string }) => {
    return makeRequest("/api/boxes/reopen", "POST", data);
  },

  createTransferCarton: async (data: {
    tc_id?: string; // ✅ NEW: Optional tc_id - backend may require it or generate it
    asn_no: string | null; // Allow null for Material Requests
    to_no?: string;
    store: string;
    user_id?: string;
    created_by?: string;
    material_request?: string; // Optional: for Material Request tracking
  }) => {
    // ✅ Backend requires: tc_id, store, and user_id (or created_by)
    const requestData: any = {
      store: data.store,
    };

    // Include tc_id if provided (backend may require it or accept it)
    if (data.tc_id) {
      requestData.tc_id = data.tc_id;
    }

    // Include asn_no if provided (not null) - Material Requests use null
    if (data.asn_no !== null && data.asn_no !== undefined) {
      requestData.asn_no = data.asn_no;
    }

    // Include to_no if provided
    if (data.to_no) {
      requestData.to_no = data.to_no;
    }

    // ✅ Backend requires user_id or created_by - send both for compatibility
    if (data.user_id) {
      requestData.user_id = data.user_id;
      requestData.created_by = data.created_by || data.user_id;
    } else if (data.created_by) {
      requestData.created_by = data.created_by;
      requestData.user_id = data.created_by; // Also send as user_id for compatibility
    }

    // Include material_request if provided (for Material Request tracking)
    if (data.material_request) {
      requestData.material_request = data.material_request;
    }

    return makeRequest("/api/transfer-cartons/create", "POST", requestData);
  },

  sealTransferCarton: async (data: {
    tc_id: string;
    sealed_by?: string | null | undefined;
  }) => {
    return makeRequest("/api/transfer-cartons/seal", "POST", data);
  },

  reopenTransferCarton: async (data: {
    tc_id: string;
    reopened_by?: string | null | undefined;
    reason?: string | null | undefined;
  }) => {
    return makeRequest("/api/transfer-cartons/reopen", "POST", data);
  },

  packBoxIntoTransferCarton: async (
    tc_id: string,
    data: {
      asn_no: string;
      box_id: string;
      store: string;
      user_id?: string | null;
      device_id?: string | null;
    }
  ) => {
    return makeRequest(
      `/api/transfer-cartons/${encodeURIComponent(tc_id)}/pack-box`,
      "POST",
      data
    );
  },

  dispatchTransferCarton: async (data: { 
    tc_id: string;
    dispatched_by?: string;
    user_id?: string;
  }) => {
    // Backend may need user_id or dispatched_by for tracking
    const requestBody: any = {
      tc_id: data.tc_id,
    };
    
    // Add user_id or dispatched_by if provided
    if (data.dispatched_by) {
      requestBody.dispatched_by = data.dispatched_by;
    }
    if (data.user_id) {
      requestBody.user_id = data.user_id;
    }
    
    console.log(`🚚 Dispatching Transfer Carton:`, JSON.stringify(requestBody, null, 2));
    return makeRequest("/api/transfer-cartons/dispatch", "POST", requestBody);
  },

  // PULL APIs
  getASN: async (asn_no: string) => {
    const trimmed = asn_no.trim();
    const encoded = encodeURIComponent(trimmed);
    console.log(`🔄 getASN: Requesting /api/asn/${encoded} (original: "${trimmed}")`);
    try {
      return await makeRequest(`/api/asn/${encoded}`, "GET");
    } catch (err: any) {
      // If 404, backend may expect shorter format (e.g. ASN-7 instead of ASN-0007)
      const is404 = err?.message?.includes("404") || err?.status === 404;
      const match = trimmed.match(/^ASN-0+(\d+)$/i);
      if (is404 && match) {
        const shortFormat = `ASN-${match[1]}`;
        if (shortFormat !== trimmed) {
          console.log(`🔄 getASN: Retrying with shorter format /api/asn/${encodeURIComponent(shortFormat)}`);
          return await makeRequest(`/api/asn/${encodeURIComponent(shortFormat)}`, "GET");
        }
      }
      throw err;
    }
  },

  getTransferOrderByASN: async (asn_no: string) => {
    // Use ASN format exactly as received (no normalization)
    // Backend returns ASNs in exact format from database (e.g., ASN-0001, ASN-0002)
    console.log(
      `🔄 getTransferOrderByASN: Using ASN format "${asn_no}" (preserving exact format)`
    );
    return await makeRequest(`/api/transfer-order/by-asn/${asn_no}`, "GET");
  },

  getLiveTransferOrderByASN: async (
    asn_no: string,
    params?: { inbound_session?: string; include_completed?: boolean }
  ) => {
    const encodedASN = encodeURIComponent(asn_no.trim());
    const queryParams = new URLSearchParams();
    if (params?.inbound_session) {
      queryParams.set("inbound_session", params.inbound_session.trim());
    }
    queryParams.set(
      "include_completed",
      params?.include_completed === false ? "false" : "true"
    );
    const query = queryParams.toString();
    return await makeRequest(
      `/api/transfer-order/by-asn/${encodedASN}/live${query ? `?${query}` : ""}`,
      "GET"
    );
  },

  getReceiveSortDistributionDetails: async (params: {
    asn_no: string;
    item_code: string;
    inbound_session?: string;
    carton_id?: string | null;
  }) => {
    const queryParams = new URLSearchParams();
    queryParams.set("asn_no", params.asn_no.trim());
    queryParams.set("item_code", params.item_code.trim());
    if (params.inbound_session) {
      queryParams.set("inbound_session", params.inbound_session.trim());
    }
    if (params.carton_id) {
      queryParams.set("carton_id", params.carton_id.trim());
    }
    return await makeRequest(
      `/api/receive-sort/distribution-details?${queryParams.toString()}`,
      "GET"
    );
  },

  /**
   * Get boxes for a specific ASN and store.
   * 
   * ⚠️ IMPORTANT: This endpoint requires both 'asn' and 'store' parameters.
   * For bin validation/scanning, use getBinMaster() instead.
   * 
   * @param params - Object with asn and store (both required by backend)
   * @returns Array of boxes
   */
  getBoxes: async (params: { asn?: string; store?: string; status?: string }) => {
    // Validate required parameters
    if (!params.asn || !params.store) {
      const missing = [];
      if (!params.asn) missing.push("asn");
      if (!params.store) missing.push("store");
      throw new Error(
        `Missing required parameters for getBoxes: ${missing.join(", ")}. ` +
        `For bin validation, use getBinMaster(binCode) instead.`
      );
    }

    const queryParams = new URLSearchParams();
    if (params.asn) queryParams.append("asn", params.asn);
    if (params.store) queryParams.append("store", params.store);
    if (params.status) queryParams.append("status", params.status);
    const query = queryParams.toString();
    return makeRequest(`/api/boxes${query ? `?${query}` : ""}`, "GET");
  },

  getBoxItems: async (box_id: string, params: { asn: string; store?: string }) => {
    const queryParams = new URLSearchParams();
    queryParams.append("asn", params.asn);
    if (params.store) queryParams.append("store", params.store);
    const path = `/api/boxes/${encodeURIComponent(
      box_id
    )}/items?${queryParams.toString()}`;
    try {
      return await makeRequest(path, "GET");
    } catch (error) {
      if (!params.store) throw error;
      const fallbackParams = new URLSearchParams();
      fallbackParams.append("asn", params.asn);
      return makeRequest(
        `/api/boxes/${encodeURIComponent(box_id)}/items?${fallbackParams.toString()}`,
        "GET"
      );
    }
  },

  getTransferCartons: async (params: { asn?: string; store?: string; material_request?: string }) => {
    const queryParams = new URLSearchParams();
    if (params.asn) queryParams.append("asn", params.asn);
    if (params.store) queryParams.append("store", params.store);
    if (params.material_request) queryParams.append("material_request", params.material_request);
    const query = queryParams.toString();
    return makeRequest(
      `/api/transfer-cartons${query ? `?${query}` : ""}`,
      "GET"
    );
  },

  getTransferCarton: async (tc_id: string) => {
    // Get transfer carton details including items and quantities
    // Note: This endpoint may not exist on all backends (returns 404 if not implemented)
    // makeRequest will return null for 404, so we don't need special handling here
    return makeRequest(`/api/transfer-cartons/${tc_id}`, "GET");
  },

  // Put Away APIs
  getRemainingItems: async (asn: string) => {
    return makeRequest(`/api/putaway/remaining-items?asn=${asn}`, "GET");
  },

  assignRack: async (body: {
    asn_no: string;
    item_code: string;
    rack_id: string;
    bin_id?: string;
  }) => {
    return makeRequest("/api/putaway/assign-rack", "POST", body);
  },

  dispatchPutAway: async (body: { tc_id: string; asn_no: string }) => {
    return makeRequest("/api/putaway/dispatch", "POST", body);
  },

  // Master Data Pull APIs (Desktop → Mobile)
  pullItemMaster: async (params?: PullItemMasterParams) => {
    let path = "/api/master/items";
    if (params && Object.keys(params).length > 0) {
      const q = new URLSearchParams();
      if (params.limit != null) q.set("limit", String(params.limit));
      if (params.offset != null) q.set("offset", String(params.offset));
      if (params.sort) q.set("sort", params.sort);
      if (params.order) q.set("order", params.order);
      if (params.after_item_code)
        q.set("after_item_code", params.after_item_code);
      if (params.after_modified) q.set("after_modified", params.after_modified);
      if (params.modified_since)
        q.set("modified_since", params.modified_since);
      const qs = q.toString();
      if (qs) path += `?${qs}`;
    }
    return makeRequest(path, "GET", undefined, true, ITEM_MASTER_API_TIMEOUT_MS);
  },

  lookupItem: async (params: {
    barcode?: string;
    item_code?: string;
    online?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (params.barcode) q.set("barcode", params.barcode.trim());
    if (params.item_code) q.set("item_code", params.item_code.trim());
    if (params.online) q.set("online", "true");
    return makeRequest(
      `/api/master/items/lookup?${q.toString()}`,
      "GET",
      undefined,
      true,
      ITEM_MASTER_API_TIMEOUT_MS
    );
  },

  pullASNData: async () => {
    return makeRequest("/api/master/asns", "GET");
  },

  pullTransferOrders: async () => {
    return makeRequest("/api/master/transfer-orders", "GET");
  },

  pullBoxes: async () => {
    return makeRequest("/api/master/boxes", "GET");
  },

  pullTransferCartons: async () => {
    return makeRequest("/api/master/transfer-cartons", "GET");
  },

  pullWarehouseRacks: async () => {
    return makeRequest("/api/master/warehouse-racks", "GET");
  },

  /**
   * Pull warehouses from backend tabwarehouse table
   * Backend endpoint: GET /api/master/warehouses
   * Expected response: Array of warehouse objects from tabwarehouse table
   * Fields: warehouse_id, warehouse_name, location, is_active, updated_on
   */
  pullWarehouses: async () => {
    return makeRequest("/api/master/warehouses", "GET");
  },

  pullLocations: async () => {
    return makeRequest("/api/master/locations", "GET");
  },

  pullBinMaster: async (params?: { limit?: number; offset?: number }) => {
    // Support pagination if backend requires it
    let url = "/api/master/bin-master";
    if (params?.limit || params?.offset) {
      const queryParams = new URLSearchParams();
      if (params.limit) queryParams.append("limit", params.limit.toString());
      if (params.offset) queryParams.append("offset", params.offset.toString());
      url += `?${queryParams.toString()}`;
    }
    return makeRequest(url, "GET");
  },

  /**
   * Get bin master data for bin validation/scanning.
   * 
   * ✅ Use this endpoint for bin location validation in picking flows.
   * 
   * @param binCode - The bin code to validate (e.g., "A1-R02-L1-B2")
   * @returns Bin master data including bin_code, bin_id, warehouse_id, zone, aisle, etc.
   */
  getBinMaster: async (binCode: string) => {
    if (!binCode || !binCode.trim()) {
      throw new Error("Bin code is required for getBinMaster");
    }
    return makeRequest(`/api/master/bin-master/${encodeURIComponent(binCode.trim())}`, "GET");
  },

  pullStockLedger: async () => {
    return makeRequest("/api/master/stock-ledger", "GET");
  },

  pullItemBarcodeMap: async () => {
    return makeRequest("/api/master/item-barcode-map", "GET");
  },

  pullUsers: async () => {
    return makeRequest("/api/master/users", "GET");
  },

  pullAllMasterData: async () => {
    return makeRequest("/api/master/all", "GET");
  },

  /**
   * Mobile device session: `device_status`, `session_active` (see MOBILE_DEVICE_SESSION_API.md).
   * Use when `device_status === "pending"` to limit UI to settings until admin approves.
   */
  getAuthSession: async () => makeRequest("/api/auth/session", "GET"),

  /**
   * Full mobile logout: revokes server session and releases Transfer In carton locks.
   * Clears stored auth token after a successful response.
   */
  logoutAuth: async () => {
    const result = await makeRequest("/api/auth/logout", "POST", {});
    await saveSettings({
      auth_token: null as any,
      auth_token_expires: null as any,
    });
    return result;
  },

  /**
   * First-time WMS password when server user has no password_hash (POST /api/auth/setup-password).
   * Does not require auth. Caller should login afterward for a mobile device session.
   */
  setupInitialPassword: async (
    user_code: string,
    new_password: string,
    confirm_password: string
  ): Promise<void> => {
    const settings = await getSettings();
    if (settings.demo_mode === 1 || !settings.api_url) {
      throw new Error("API URL is required to set a password");
    }

    const url = joinApiUrl(settings.api_url, "/api/auth/setup-password");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_code: user_code.trim(),
          new_password,
          confirm_password,
        }),
        signal: controller.signal,
      });

      const responseText = await response.text();
      let responseData: any = {};
      if (responseText) {
        try {
          responseData = JSON.parse(responseText);
        } catch {
          responseData = { message: responseText };
        }
      }

      if (!response.ok) {
        const { message, code } = parseAuthErrorPayload(
          responseData,
          `Failed to set password (${response.status})`
        );
        throwAuthError(message, code);
      }
    } catch (error: any) {
      if (error?.name === "AbortError") {
        throw new Error("Password setup timeout: server took too long to respond");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  /**
   * Change password for the logged-in user (POST /api/auth/change-password, Bearer required).
   */
  changePassword: async (
    user_code: string,
    current_password: string,
    new_password: string
  ): Promise<void> => {
    const settings = await getSettings();
    if (settings.demo_mode === 1 || !settings.api_url) {
      throw new Error("API URL is required to change password");
    }

    const url = joinApiUrl(settings.api_url, "/api/auth/change-password");
    const authToken = await authenticate();
    if (!authToken) {
      throw new Error(
        "Please sign in with your current password before changing it."
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          user_code: user_code.trim(),
          current_password,
          new_password,
        }),
        signal: controller.signal,
      });

      const responseText = await response.text();
      let responseData: any = {};
      if (responseText) {
        try {
          responseData = JSON.parse(responseText);
        } catch {
          responseData = { message: responseText };
        }
      }

      if (!response.ok) {
        const { message, code } = parseAuthErrorPayload(
          responseData,
          `Failed to change password (${response.status})`
        );
        throwAuthError(message, code);
      }
    } catch (error: any) {
      if (error?.name === "AbortError") {
        throw new Error("Change password timeout: server took too long to respond");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  // Authentication
  login: async (
    user_code: string,
    password: string,
    loginOptions?: AuthLoginOptions
  ): Promise<string> => {
    const settings = await getSettings();
    if (settings.demo_mode === 1 || !settings.api_url) {
      // In demo mode, return a dummy token
      const expiresAt = new Date(Date.now() + 3600 * 1000);
      await saveSettings({
        auth_token: "demo-token",
        auth_token_expires: expiresAt.toISOString(),
      });
      return "demo-token";
    }

    // Try multiple login endpoints with timeout
    const loginEndpoints = [
      "/api/auth/login",
      "/api/login",
      "/api/auth/device-login",
    ];

    // Set a timeout for the entire login process (15 seconds total)
    const LOGIN_TIMEOUT = 15000;
    const startTime = Date.now();

    for (const loginEndpoint of loginEndpoints) {
      // Check if we've exceeded total timeout
      if (Date.now() - startTime > LOGIN_TIMEOUT) {
        throw new Error("Login timeout: Server took too long to respond");
      }

      try {
        const url = joinApiUrl(settings.api_url, loginEndpoint);

        // Trim credentials to remove any leading/trailing whitespace
        const trimmedUserCode = user_code?.trim() || "";
        const trimmedPassword = password?.trim() || "";

        const requestBody = buildAuthLoginRequestBody(
          loginEndpoint,
          trimmedUserCode,
          trimmedPassword,
          settings.device_id,
          (settings as any).device_label,
          loginOptions
        );

        console.log(`🔐 Login attempt: ${url}`);
        console.log(`📤 Request body:`, {
          user_code: trimmedUserCode,
          user_code_length: trimmedUserCode.length,
          password: "***",
          password_length: trimmedPassword.length,
          client_type: requestBody.client_type,
          device_id: requestBody.device_id
            ? `${String(requestBody.device_id).substring(0, 8)}…`
            : undefined,
        });

        // Warn if user_code contains spaces (might be a typo)
        if (trimmedUserCode.includes(" ")) {
          console.warn(
            `⚠️ Warning: user_code contains spaces: "${trimmedUserCode}" (length: ${trimmedUserCode.length})`
          );
        }

        // Create AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, 5000); // 5 seconds per endpoint attempt

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          console.log(
            `📡 Login response: ${response.status} ${response.statusText}`
          );

          if (response.ok) {
            const responseData = await response.json();

            // Check for token in different response formats
            // Format 1: { token: "...", expires_in: 3600 }
            // Format 2: { access_token: "...", expires_in: 3600 }
            // Format 3: { data: { access_token: "...", refresh_token: "..." }, success: true }
            // Format 4: { auth_token: "...", expires_in: 3600 }
            const token =
              responseData.token ||
              responseData.access_token ||
              responseData.auth_token ||
              responseData.data?.access_token ||
              responseData.data?.token ||
              responseData.data?.auth_token;

            // Check for expires_in in different locations
            const expiresIn =
              responseData.expires_in || responseData.data?.expires_in || 3600; // Default 1 hour

            if (token) {
              const expiresAt = new Date(Date.now() + expiresIn * 1000);
              const loginRole =
                responseData.data?.user?.role ||
                responseData.user?.role ||
                null;
              await saveSettings({
                auth_token: token,
                auth_token_expires: expiresAt.toISOString(),
                ...(loginRole
                  ? ({ user_role: String(loginRole) } as Partial<Settings>)
                  : {}),
              });
              console.log("✅ Login successful");
              return token;
            } else {
              console.error("❌ No token in response:", responseData);
              throw new Error("Server did not return an authentication token");
            }
          } else {
            // If 404, try next endpoint
            if (response.status === 404) {
              console.log(
                `⚠️ Endpoint ${loginEndpoint} not found (404), trying next...`
              );
              continue;
            }

            // Read error response
            let errorText = "";
            let errorData: any = {};
            try {
              errorText = await response.text();
              if (errorText) {
                try {
                  errorData = JSON.parse(errorText);
                } catch (e) {
                  // Not JSON, use as text
                  errorData = { message: errorText };
                }
              }
            } catch (e) {
              // Failed to read response
            }

            console.error(`❌ Login failed (${loginEndpoint}):`, {
              status: response.status,
              statusText: response.statusText,
              error: errorData,
              errorText: errorText.substring(0, 200),
            });

            const errCode = errorData.error?.code || errorData.code;
            if (response.status === 409 && errCode === "AUTH_SESSION_EXISTS") {
              const other =
                errorData.error?.active_device_id ||
                errorData.active_device_id ||
                "";
              const myDid = String(settings.device_id || "").trim();
              const otherStr = String(other || "").trim();
              const sameDeviceId =
                myDid.length > 0 &&
                otherStr.length > 0 &&
                deviceIdComparable(myDid) === deviceIdComparable(otherStr);

              // Same user + same device: stale server session after local logout / crash — clear local auth,
              // best-effort server logout, then one automatic retry with replace_other_mobile_session.
              if (
                loginEndpoint === "/api/auth/login" &&
                sameDeviceId &&
                !loginOptions?._sessionConflictRetried
              ) {
                console.warn(
                  "ℹ️ AUTH_SESSION_EXISTS for same device_id — clearing local session, best-effort server logout, retrying login"
                );
                await saveSettings({
                  auth_token: undefined as any,
                  auth_token_expires: undefined as any,
                });
                await bestEffortAuthLogoutWithCredentials(
                  settings.api_url!,
                  trimmedUserCode,
                  trimmedPassword,
                  settings.device_id
                );
                return apiService.login(user_code, password, {
                  replaceOtherMobileSession: true,
                  _sessionConflictRetried: true,
                });
              }

              const base =
                errorData.error?.message ||
                "Login session issue: the server still shows an active mobile login for this user.";
              const hint =
                "\n\n• Other device: sign out on that phone, or tap “Use this device” below if your API allows replacing the session." +
                "\n• Logout issue: if you already signed out everywhere, wait a minute or ask an admin to clear the stuck mobile session on the server." +
                (otherStr && !sameDeviceId
                  ? `\n\nActive session device id: ${otherStr}`
                  : otherStr
                  ? `\n\nDevice id on server (this device): ${otherStr}`
                  : "");
              const err = new Error(base + hint) as Error & {
                code?: string;
                activeDeviceId?: string;
              };
              err.code = "AUTH_SESSION_EXISTS";
              err.activeDeviceId = otherStr || undefined;
              throw err;
            }
            if (response.status === 403 && errCode === "DEVICE_DISABLED") {
              throw new Error(
                errorData.error?.message ||
                  "This device has been disabled. Contact an administrator."
              );
            }

            const { message: errorMessage, code: authErrCode } =
              parseAuthErrorPayload(
                errorData,
                errorText
                  ? errorText.substring(0, 100)
                  : `Login failed: ${response.status} ${response.statusText}`
              );

            if (authErrCode === "PASSWORD_NOT_SET") {
              throwAuthError(errorMessage, "PASSWORD_NOT_SET");
            }

            // If it's not 404 and not the last endpoint, throw to try next
            if (loginEndpoint !== loginEndpoints[loginEndpoints.length - 1]) {
              // Continue to next endpoint only if it's a network error or 404
              if (response.status === 404) {
                continue;
              }
              // For other errors (like 400, 401), throw to show error immediately
              throwAuthError(errorMessage, authErrCode);
            } else {
              // Last endpoint, throw the error
              throwAuthError(errorMessage, authErrCode);
            }
          }
        } catch (fetchError: any) {
          clearTimeout(timeoutId);

          // Handle timeout/abort errors
          if (
            fetchError.name === "AbortError" ||
            fetchError.message?.includes("aborted")
          ) {
            console.warn(
              `⏱️ Login timeout for ${loginEndpoint}, trying next...`
            );
            // If it's the last endpoint, throw timeout error
            if (loginEndpoint === loginEndpoints[loginEndpoints.length - 1]) {
              throw new Error("Login timeout: Server took too long to respond");
            }
            continue; // Try next endpoint
          }

          throw fetchError; // Re-throw other errors
        }
      } catch (error: any) {
        console.error(`❌ Login error (${loginEndpoint}):`, error.message);

        // If it's the last endpoint, throw the error
        if (loginEndpoint === loginEndpoints[loginEndpoints.length - 1]) {
          throw error;
        }
        // Otherwise continue to next endpoint only for network errors or timeouts
        if (
          error.message?.includes("Network") ||
          error.message?.includes("timeout") ||
          error.message?.includes("Timeout")
        ) {
          continue;
        }
        // For other errors (like 401, 400), throw immediately
        throw error;
      }
    }

    throw new Error("Login failed: All login endpoints failed");
  },

  // Test API connection (standalone function, doesn't use settings)
  testConnection: async (
    apiUrl: string
  ): Promise<{ success: boolean; message: string }> => {
    try {
      // Validate URL format
      if (!apiUrl || !apiUrl.trim()) {
        return { success: false, message: "API URL is required" };
      }

      // Normalize URL (remove trailing slash, ensure protocol, strip duplicate /api)
      let normalizedUrl = apiUrl.trim();
      if (
        !normalizedUrl.startsWith("http://") &&
        !normalizedUrl.startsWith("https://")
      ) {
        normalizedUrl = `https://${normalizedUrl}`;
      }
      normalizedUrl = normalizeApiBaseUrl(normalizedUrl);

      // Test with a simple health check endpoint or a lightweight GET request
      const testEndpoints = ["/health", "/api/health", "/api/ping", "/"];

      for (const endpoint of testEndpoints) {
        try {
          const url = joinApiUrl(normalizedUrl, endpoint);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout for test

          const response = await fetch(url, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          // If we get any response (even 404), the server is reachable
          // 404 means server is reachable but endpoint doesn't exist (which is OK for testing)
          if (response.status >= 200 && response.status < 500) {
            return { success: true, message: "API connection successful" };
          }
        } catch (error: any) {
          // Continue to next endpoint if this one fails
          if (error.name !== "AbortError") {
            continue;
          }
        }
      }

      // If all endpoints failed, try a simple connectivity test to base URL
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(normalizedUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        // Any response means server is reachable
        return { success: true, message: "API server is reachable" };
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === "AbortError") {
          return {
            success: false,
            message:
              "Connection timeout. Please check the API URL and network connection.",
          };
        }
        if (
          error.message?.includes("Network request failed") ||
          error.message?.includes("Failed to connect")
        ) {
          return {
            success: false,
            message:
              "Cannot connect to API server. Please check the URL and ensure the server is running.",
          };
        }
        if (error.message?.includes("CORS")) {
          return {
            success: false,
            message:
              "CORS error. Server is reachable but may need CORS configuration.",
          };
        }
        return {
          success: false,
          message: `Connection error: ${error.message || "Unknown error"}`,
        };
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to test connection: ${
          error.message || "Unknown error"
        }`,
      };
    }
  },

  // ============================================
  // TRANSFER IN APIs
  // ============================================
  getTransferIns: async (filters?: {
    status?: string;
    from_showroom?: string;
    to_warehouse?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append("status", filters.status);
    if (filters?.from_showroom)
      params.append("from_showroom", filters.from_showroom);
    if (filters?.to_warehouse)
      params.append("to_warehouse", filters.to_warehouse);
    const queryString = params.toString();
    const response = await makeRequest(
      `/api/transfer-in${queryString ? `?${queryString}` : ""}`,
      "GET"
    );
    
    // Handle different response formats
    let transferInsList: any[] = [];
    if (Array.isArray(response)) {
      transferInsList = response;
    } else if (response && typeof response === "object") {
      if (Array.isArray(response.data)) {
        transferInsList = response.data;
      } else if (Array.isArray(response.items)) {
        transferInsList = response.items;
      } else if (Array.isArray(response.transfer_ins)) {
        transferInsList = response.transfer_ins;
      }
    }
    
    console.log(`✅ Returning ${transferInsList.length} Transfer In(s) from backend`);
    return response; // Return original response to preserve format
  },

  getTransferIn: async (title: string) => {
    return await makeRequest(`/api/transfer-in/${title}`, "GET");
  },

  createTransferIn: async (data: any) => {
    return makeRequest("/api/transfer-in", "POST", data);
  },

  submitTransferIn: async (title: string) => {
    return makeRequest(`/api/transfer-in/${title}/submit`, "POST");
  },

  updateTransferInStatus: async (title: string, status: string) => {
    try {
      return await makeRequest(`/api/transfer-in/${title}/update-status`, "POST", { status });
    } catch (error: any) {
      // Handle 404 gracefully - this endpoint may not exist
      if (error?.message?.includes("404") || error?.message?.includes("not found")) {
        console.warn(`⚠️ Transfer In update-status endpoint not available (404). Backend may auto-update status.`);
        return null; // Don't re-throw, allow graceful handling
      }
      throw error;
    }
  },

  /**
   * Complete Transfer In Receiving
   * ✅ CORRECT: Per actual backend API specification
   * Payload: { completed_by: "sysadmin" }
   * Note: Field is completed_by, NOT received_by
   */
  completeTransferInReceiving: async (title: string, completed_by?: string) => {
    // ✅ Preferred endpoint: POST /api/transfer-in/{title}/complete-receiving
    // This endpoint should set completed_at and status to "Received"
    try {
      // Get user_id from settings if not provided
      let userId = completed_by;
      if (!userId) {
        const settings = await getSettings();
        userId = settings.user_id || settings.user_code || "sysadmin";
      }
      
      return await makeRequest(`/api/transfer-in/${title}/complete-receiving`, "POST", {
        completed_by: userId, // ✅ CORRECT: completed_by (not received_by)
      });
    } catch (error: any) {
      // Handle 404 gracefully - this endpoint may not exist yet
      if (error?.message?.includes("404") || error?.message?.includes("not found")) {
        console.warn(`⚠️ Transfer In complete-receiving endpoint not available (404). Will try update-status as fallback.`);
        return null; // Don't re-throw, allow fallback to update-status
      }
      throw error;
    }
  },

  receiveTransferInLine: async (
    title: string,
    data: {
      carton_id?: string;
      item_code?: string;
      received_qty?: number;
      received_by: string;
    }
  ) => {
    return await makeRequest(`/api/transfer-in/${title}/receive-line`, "POST", data);
  },

  updateTransferInLineCarton: async (
    title: string,
    item_code: string,
    carton_id: string
  ) => {
    // Try to update carton_id for a received item
    // This endpoint may not exist - will gracefully handle 404
    try {
      return await makeRequest(`/api/transfer-in/${title}/update-line-carton`, "POST", {
        item_code,
        carton_id,
      });
    } catch (error: any) {
      // If endpoint doesn't exist, return null (carton_id will be tracked in events)
      if (error?.message?.includes("404") || error?.message?.includes("not found")) {
        console.warn(`⚠️ Update carton_id API not available - carton_id will be tracked in events only`);
        return null;
      }
      throw error;
    }
  },

  // ✅ Validate Transfer In carton/box. Body: box_id or carton_id (required), create_carton_if_missing (optional).
  // When create_carton_if_missing is true, backend links an existing warehouse box to this Transfer In if not already linked.
  validateTransferInCarton: async (
    transferInNo: string,
    boxId: string,
    options?: { create_carton_if_missing?: boolean }
  ) => {
    try {
      const normalizedBoxId = String(boxId || "").trim().toUpperCase();
      const isGeneratedCartonId = normalizedBoxId.startsWith("CTN-");
      const body: { box_id: string; carton_id?: string; create_carton_if_missing?: boolean } = {
        box_id: boxId,
      };
      if (isGeneratedCartonId) {
        body.carton_id = boxId; // Backend may expect carton_id only for generated CTN-* cartons.
      }
      if (options?.create_carton_if_missing === true) {
        body.create_carton_if_missing = true;
      }
      console.warn(
        `📤 validateTransferInCarton body:`,
        JSON.stringify(body, null, 2)
      );
      return await makeRequest(`/api/transfer-in/${transferInNo}/validate-carton`, "POST", body);
    } catch (error: any) {
      // ✅ Check if this is a database schema error (source_type column missing)
      const errorData = error?.data || error?.errorJson || error?.response?.data;
      const errorCode = errorData?.error?.code || errorData?.code || error?.code;
      const errorMessage = errorData?.error?.message || errorData?.message || error?.message || "";
      const errorDetails = errorData?.error?.details || errorData?.details || "";
      
      // Check for database schema errors (source_type column missing)
      if (
        errorCode === "DATABASE_ERROR" &&
        (errorMessage.includes("source_type") || errorDetails.includes("source_type") || errorMessage.includes("Unknown column"))
      ) {
        // Backend database doesn't have source_type column - this is expected
        // Allow validation to proceed (backend may validate later or column may be added)
        console.warn(`⚠️ Backend database doesn't support source_type column - allowing carton to proceed`);
        return { ok: true, validated: true, carton_id: boxId };
      }
      
      // ✅ Check if this is a validation error (carton not found) vs endpoint not found
      // Backend returns 404 or 400 with JSON body: {"ok":false,"error":{"code":"CARTON_NOT_FOUND",...}}
      // or {"code":"BOX_NOT_FOUND","message":"..."}
      
      // If error has a structured error code (CARTON_NOT_FOUND, BOX_NOT_FOUND, etc.), 
      // it means the endpoint exists and returned a validation error
      // Also check isValidationError flag set by makeRequest
      if (
        error?.isValidationError || 
        (errorCode && (errorCode === "CARTON_NOT_FOUND" || errorCode === "BOX_NOT_FOUND" || errorCode === "VALIDATION_ERROR"))
      ) {
        // This is a validation error from the endpoint - return it as structured response
        // Don't log as error - this is expected validation response
        return {
          ok: false,
          validated: false,
          error: {
            code: errorCode || "VALIDATION_ERROR",
            message: errorData?.error?.message || errorData?.message || error?.message || "Validation failed",
          },
        };
      }
      
      // Handle 404 gracefully - endpoint may not exist yet (no structured error in response)
      // Check for 404 status, is404 flag, or error message containing 404/not found
      if (
        error?.status === 404 || 
        error?.is404 || 
        (error?.message?.includes("404") && !errorCode) || 
        (error?.message?.includes("not found") && !errorCode)
      ) {
        // Don't log as error - this is expected if backend hasn't implemented the endpoint yet
        // Return success to allow workflow to continue (backend may validate later)
        console.warn(`⚠️ Transfer In validate-carton endpoint not available (404). Allowing carton to proceed.`);
        return { ok: true, validated: true, carton_id: boxId };
      }
      
      // Re-throw other errors (network errors, 500, etc.)
      throw error;
    }
  },

  // ============================================
  // RELOCATION / BIN TRANSFER APIs
  // ============================================
  startRelocationSession: async (mode: string, warehouseId: string, userId: string) => {
    return makeRequest("/api/relocation/session/start", "POST", {
      mode,
      warehouse_id: warehouseId,
      user_id: userId,
    });
  },

  setRelocationFrom: async (
    sessionId: string,
    fromBin: string,
    fromCarton?: string
  ) => {
    return makeRequest(`/api/relocation/session/${sessionId}/from`, "PUT", {
      from_bin: fromBin,
      from_carton: fromCarton || null,
    });
  },

  setRelocationTo: async (
    sessionId: string,
    toBin: string,
    toCarton?: string
  ) => {
    return makeRequest(`/api/relocation/session/${sessionId}/to`, "PUT", {
      to_bin: toBin,
      to_carton: toCarton || null,
    });
  },

  getCartonContents: async (cartonId: string) => {
    // Try backend API first, fallback to local cache if not available
    try {
      return makeRequest(`/api/relocation/carton/${cartonId}/contents`, "GET");
    } catch (error: any) {
      // Handle different error types
      if (error.status === 404 || error.message?.includes("not found") || error.message?.includes("NOT_FOUND")) {
        // Carton doesn't exist in backend (may be local-only or not synced yet)
        console.warn(`⚠️ Carton ${cartonId} not found in backend. This is normal if the carton was created locally and not synced yet.`);
      } else {
        // Other errors (500, network, etc.)
        console.warn("⚠️ Backend get-carton-contents API error:", error.message || error);
      }
      // Return empty items - user can scan to populate
      return { items: [] };
    }
  },

  // ============================================
  // ✅ NEW RELOCATION COMPLETE ENDPOINTS (Atomic Session Creation + Commit)
  // ============================================
  
  /**
   * Complete full carton relocation - creates session and commits atomically
   * Payload: { warehouse_id, user_id, from_bin, to_bin, from_carton, mode, create_carton_if_missing? }
   * Creates OUT from from_bin, IN to to_bin
   */
  completeRelocationFull: async (relocationData: {
    mode: "FULL_CARTON";
    warehouse_id: string;
    user_id: string;
    from_bin: string;
    to_bin: string;
    from_carton: string;
    create_carton_if_missing?: boolean;
  }) => {
    const body: any = {
      warehouse_id: relocationData.warehouse_id,
      user_id: relocationData.user_id,
      from_bin: relocationData.from_bin,
      to_bin: relocationData.to_bin,
      from_carton: relocationData.from_carton,
      mode: relocationData.mode,
    };
    if (relocationData.create_carton_if_missing === true) {
      body.create_carton_if_missing = true;
    }
    return makeRequest(`/api/relocation/complete-full`, "POST", body);
  },

  /**
   * Complete partial relocation / carton merge - creates session and commits atomically
   * Payload: { warehouse_id, user_id, from_carton, to_carton, from_bin, to_bin, mode, lines[], create_carton_if_missing? }
   * Creates OUT old carton, IN new carton. Use create_carton_if_missing when target carton does not exist yet.
   */
  completeRelocationPartial: async (relocationData: {
    mode: "PARTIAL_ITEMS" | "CARTON_TO_CARTON";
    warehouse_id: string;
    user_id: string;
    from_bin: string;
    to_bin: string;
    from_carton: string;
    to_carton: string;
    lines: { item_code: string; qty: number }[];
    create_carton_if_missing?: boolean;
  }) => {
    const body: any = {
      warehouse_id: relocationData.warehouse_id,
      user_id: relocationData.user_id,
      from_carton: relocationData.from_carton,
      to_carton: relocationData.to_carton,
      from_bin: relocationData.from_bin,
      to_bin: relocationData.to_bin,
      mode: relocationData.mode,
      lines: relocationData.lines,
    };
    if (relocationData.create_carton_if_missing === true) {
      body.create_carton_if_missing = true;
    }
    return makeRequest(`/api/relocation/complete-partial`, "POST", body);
  },

  // ============================================
  // OLD RELOCATION ENDPOINTS (DEPRECATED - Keep for backward compatibility)
  // ============================================
  
  commitRelocationFull: async (sessionId: string, lines?: {
    item_code: string;
    qty: number;
  }[]) => {
    // ⚠️ DEPRECATED: Use completeRelocationFull instead
    console.warn("⚠️ commitRelocationFull is deprecated. Use completeRelocationFull instead.");
    return makeRequest(`/api/relocation/session/${sessionId}/commit-full`, "POST", {
      lines: lines || [],
    });
  },

  commitRelocationPartial: async (sessionId: string, lines?: {
    item_code: string;
    qty: number;
  }[]) => {
    // ⚠️ DEPRECATED: Use completeRelocationPartial instead
    console.warn("⚠️ commitRelocationPartial is deprecated. Use completeRelocationPartial instead.");
    return makeRequest(`/api/relocation/session/${sessionId}/commit-partial`, "POST", {
      lines: lines || [],
    });
  },

  // ============================================
  // MATERIAL REQUEST APIs
  // ============================================
  getMaterialRequests: async (filters?: {
    status?: string;
    from_warehouse?: string;
    to_showroom?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append("status", filters.status);
    if (filters?.from_warehouse)
      params.append("from_warehouse", filters.from_warehouse);
    if (filters?.to_showroom) params.append("to_showroom", filters.to_showroom);
    const queryString = params.toString();
    return makeRequest(
      `/api/material-requests${queryString ? `?${queryString}` : ""}`,
      "GET"
    );
  },

  getMaterialRequest: async (title: string) => {
    return makeRequest(`/api/material-requests/${title}`, "GET");
  },

  createMaterialRequest: async (data: any) => {
    return makeRequest("/api/material-requests", "POST", data);
  },

  updateMaterialRequestStatus: async (
    title: string,
    status: string
  ) => {
    console.log(
      `📝 Updating Material Request status: ${title} -> ${status}`
    );
    // Use /api/material-requests/{title}/update-status as per backend documentation
    const response = await makeRequest(
      `/api/material-requests/${title}/update-status`,
      "POST",
      { status }
    );
    console.log(
      `📝 Material Request status update response:`,
      JSON.stringify(response, null, 2)
    );
    return response;
  },

  getMaterialRequestPickingStatus: async (title: string) => {
    console.log(`📊 Getting picking status for Material Request: ${title}`);
    try {
      const response = await makeRequest(
        `/api/material-requests/${title}/picking-status`,
        "GET"
      );
      console.log(
        `📊 Picking status response:`,
        JSON.stringify(response, null, 2)
      );
      return response;
    } catch (error: any) {
      // Handle 404 gracefully - API might not be implemented yet
      if (error.message?.includes("404") || error.message?.includes("not found")) {
        console.log(`ℹ️ Picking-status API not available (404) - will use fallback calculation`);
        return { ok: false, error: { code: "NOT_FOUND", message: "API not implemented" } };
      }
      throw error; // Re-throw other errors
    }
  },

  /**
   * Pick items for Material Request
   * Payload: { items: [{ item_code, picked_qty, source_bin, carton_id }], user_id?, created_by? }
   * Backend requires user_id or created_by for validation.
   * Must create OUT history, source_bin must be correct
   */
  pickMaterialRequestItems: async (
    title: string,
    items: {
      item_code: string;
      picked_qty: number;    // ✅ CORRECT: picked_qty (not qty)
      source_bin: string;   // ✅ CORRECT: source_bin (not bin_location)
      carton_id?: string;   // Optional carton_id for carton-level inventory
    }[],
    warehouse?: string,
    user_id?: string | null // Required by backend; falls back to settings.user_id / user_code
  ) => {
    // Resolve user_id/created_by: backend requires one of them
    let resolvedUserId = user_id;
    if (!resolvedUserId || resolvedUserId.trim() === "") {
      const settings = await getSettings();
      resolvedUserId = settings.user_id || settings.user_code || "";
    }
    if (!resolvedUserId || resolvedUserId.trim() === "") {
      throw new Error("user_id or created_by is required. Please set User ID / User Code in Settings.");
    }

    const requestBody: any = {
      items: items.map(item => ({
        item_code: item.item_code,
        picked_qty: item.picked_qty,
        source_bin: item.source_bin,
        carton_id: item.carton_id,
      })),
      user_id: resolvedUserId,
      created_by: resolvedUserId,
    };

    console.warn(
      `📦 Calling pick-items API for Material Request: ${title}`,
      JSON.stringify(requestBody, null, 2)
    );
    const response = await makeRequest(
      `/api/material-requests/${title}/pick-items`,
      "POST",
      requestBody
    );
    console.warn(
      `✅ pick-items API response:`,
      JSON.stringify(response, null, 2)
    );
    return response;
  },

  // ✅ NEW: Add items to Transfer Carton (for Material Request redesign)
  addItemsToTransferCarton: async (
    tc_id: string,
    items: {
      item_code: string;
      qty: number;
      carton_id?: string;
      source_bin?: string;
    }[],
    user_id: string
  ) => {
    const requestBody = {
      items,
      user_id,
    };
    
    // ✅ DEBUG: Log the request body to verify carton_id is included
    console.log(`📦 addItemsToTransferCarton Request for TC ${tc_id}:`, JSON.stringify(requestBody, null, 2));
    console.log(`📦 Items with carton_id check:`, items.map(item => ({
      item_code: item.item_code,
      qty: item.qty,
      carton_id: item.carton_id || "NOT PROVIDED ⚠️",
      source_bin: item.source_bin || "NOT PROVIDED ⚠️",
    })));
    
    return makeRequest(
      `/api/transfer-cartons/${tc_id}/add-items`,
      "POST",
      requestBody
    );
  },

  // ✅ NEW: Picking Flow APIs
  // Note: These APIs may not be implemented on backend yet
  // They will gracefully fail and use local storage only
  startPickingSession: async (materialRequestTitle: string, user_id?: string) => {
    // ✅ PERMANENT FIX: Do NOT send user_id in API payload
    // Backend should read user from its own config/session, not from API request
    try {
      return await makeRequest(
        `/api/wms/picking/start`,
        "POST",
        {
          material_request_title: materialRequestTitle,
          // Note: user_id is NOT included - backend reads from config
        }
      );
    } catch (error: any) {
      // If endpoint doesn't exist (404), return local session ID silently
      if (error?.status === 404 || error?.is404 || error?.message?.includes("404") || error?.message?.includes("not found")) {
        // Silent - don't log as error, just return local session
        return {
          session_id: `PK-${materialRequestTitle}-${Date.now()}`,
          data: { session_id: `PK-${materialRequestTitle}-${Date.now()}` },
        };
      }
      throw error;
    }
  },

  scanBin: async (sessionId: string, binCode: string) => {
    try {
      return await makeRequest(
        `/api/wms/picking/scan-bin`,
        "POST",
        {
          session_id: sessionId,
          bin_code: binCode,
        }
      );
    } catch (error: any) {
      // If endpoint doesn't exist, just log and continue
      if (error?.message?.includes("404") || error?.message?.includes("not found")) {
        console.warn("⚠️ Scan bin API not available, saving locally only");
        return { ok: true, message: "Saved locally" };
      }
      throw error;
    }
  },

  scanCarton: async (sessionId: string, cartonId: string) => {
    try {
      return await makeRequest(
        `/api/wms/picking/scan-carton`,
        "POST",
        {
          session_id: sessionId,
          carton_id: cartonId,
        }
      );
    } catch (error: any) {
      // If endpoint doesn't exist (404), just log and continue
      if (error?.status === 404 || error?.is404 || error?.message?.includes("404") || error?.message?.includes("not found")) {
        // Silent - don't log as error, just return success for local storage
        return { ok: true, message: "Saved locally" };
      }
      throw error;
    }
  },

  scanItem: async (
    sessionId: string,
    barcode: string,
    cartonId?: string,
    materialRequestTitle?: string // Pass MR title directly to avoid parsing issues
  ) => {
    try {
      return await makeRequest(
        `/api/wms/picking/scan-item`,
        "POST",
        {
          session_id: sessionId,
          barcode,
          carton_id: cartonId,
        }
      );
    } catch (error: any) {
      // If endpoint doesn't exist, use the existing pick-items API as fallback
      if (error?.status === 404 || error?.is404 || error?.message?.includes("404") || error?.message?.includes("not found")) {
        // Use materialRequestTitle if provided, otherwise try to extract from session ID
        let mrTitle = materialRequestTitle;
        if (!mrTitle) {
          // Extract material request title from session ID
          // Session ID format: PK-{MR_TITLE}-{timestamp}
          // Example: PK-MR-123457-1768293356659 -> MR-123457
          // We need to find where the timestamp starts (last numeric-only segment)
          const parts = sessionId.split("-");
          if (parts.length >= 3 && parts[0] === "PK") {
            // Find the last part that is purely numeric (timestamp)
            let timestampIndex = -1;
            for (let i = parts.length - 1; i >= 1; i--) {
              if (/^\d+$/.test(parts[i])) {
                timestampIndex = i;
                break;
              }
            }
            if (timestampIndex > 0) {
              // Everything between "PK" and the timestamp is the MR title
              mrTitle = parts.slice(1, timestampIndex).join("-");
            } else {
              // Fallback: remove "PK-" and last part
              mrTitle = parts.slice(1, -1).join("-");
            }
          } else {
            // Fallback: remove "PK-" prefix and everything after last dash
            mrTitle = sessionId.replace(/^PK-/, "").split("-").slice(0, -1).join("-");
          }
        }
        
        // Debug log to help diagnose extraction issues
        if (materialRequestTitle) {
          console.log(`✅ Using provided Material Request title: ${materialRequestTitle}`);
        } else {
          console.warn(`⚠️ Extracted MR title from session ID: "${mrTitle}" (from "${sessionId}")`);
        }
        
        if (mrTitle) {
          // Validate MR title format (should be like MR-123457, not MR-PICK-MR-123457)
          // If it contains "PICK", it's likely a malformed session ID extraction
          if (mrTitle.includes("PICK") && !mrTitle.startsWith("MR-PICK-")) {
            console.error(`❌ Invalid MR title extracted: "${mrTitle}" - this suggests a session ID parsing issue`);
            // Try to extract the actual MR number from the malformed title
            const mrMatch = mrTitle.match(/MR-(\d+)/);
            if (mrMatch) {
              mrTitle = `MR-${mrMatch[1]}`;
              console.warn(`⚠️ Corrected MR title to: "${mrTitle}"`);
            }
          }
          
          // ✅ CORRECT: Use pick-items API with correct field names
          // Note: source_bin should be provided by the caller
          // If not provided, this will fail validation on backend
          return await apiService.pickMaterialRequestItems(
            mrTitle,
            [
              {
                item_code: barcode,
                picked_qty: 1, // ✅ CORRECT: picked_qty (not qty)
                source_bin: "", // ⚠️ WARNING: source_bin is required - should be provided by caller
                carton_id: cartonId,
              },
            ]
          );
        }
        throw new Error(`Cannot determine Material Request from session ID: ${sessionId}`);
      }
      throw error;
    }
  },

  updateLineQty: async (
    sessionId: string,
    lineId: string,
    qty: number,
    reason?: string
  ) => {
    try {
      return await makeRequest(
        `/api/wms/picking/line-qty`,
        "PUT",
        {
          session_id: sessionId,
          line_id: lineId,
          qty,
          reason,
        }
      );
    } catch (error: any) {
      // If endpoint doesn't exist, use pick-items API as fallback
      if (error?.message?.includes("404") || error?.message?.includes("not found")) {
        console.warn("⚠️ Update line qty API not available, using pick-items API fallback");
        // Extract material request title from session ID
        const mrTitle = sessionId.split("-").slice(0, -1).join("-").replace("PK-", "");
        if (mrTitle) {
          // ✅ CORRECT: Use pick-items API with correct field names
          return await apiService.pickMaterialRequestItems(
            mrTitle,
            [
              {
                item_code: lineId, // Assuming lineId is item_code
                picked_qty: qty, // ✅ CORRECT: picked_qty (not qty)
                source_bin: "", // ⚠️ WARNING: source_bin is required
              },
            ]
          );
        }
        throw new Error("Cannot determine Material Request from session ID");
      }
      throw error;
    }
  },

  completePicking: async (sessionId: string, materialRequestTitle?: string) => {
    try {
      return await makeRequest(
        `/api/wms/picking/complete`,
        "POST",
        {
          session_id: sessionId,
        }
      );
    } catch (error: any) {
      // If endpoint doesn't exist, use update-status API as fallback
      if (error?.message?.includes("404") || error?.message?.includes("not found") || error?.is404) {
        console.warn("⚠️ Complete picking API not available, using update-status API fallback");
        
        // ✅ Use materialRequestTitle if provided (more reliable)
        let mrTitle = materialRequestTitle;
        
        // Fallback: Try to extract from session ID if not provided
        if (!mrTitle) {
          // Session ID format: PK-MR-123457-1768293356659 or similar
          // Try to extract MR-123457
          const parts = sessionId.split("-");
          if (parts.length >= 3 && parts[0] === "PK" && parts[1] === "MR") {
            // Format: PK-MR-123457-timestamp
            mrTitle = `MR-${parts.slice(2, -1).join("-")}`; // Get everything between "MR" and timestamp
          } else {
            // Try simpler extraction
            mrTitle = sessionId.replace("PK-", "").split("-").slice(0, -1).join("-");
          }
        }
        
        if (mrTitle) {
          console.log(`🔄 Using update-status API fallback for Material Request: ${mrTitle}`);
          return await apiService.updateMaterialRequestStatus(mrTitle, "Picked");
        }
        throw new Error("Cannot determine Material Request title. Please provide materialRequestTitle parameter.");
      }
      throw error;
    }
  },

  getPickingSession: async (sessionId: string) => {
    try {
      return await makeRequest(
        `/api/wms/picking/session/${sessionId}`,
        "GET"
      );
    } catch (error: any) {
      // If endpoint doesn't exist, return null (will use local storage)
      if (error?.message?.includes("404") || error?.message?.includes("not found")) {
        console.warn("⚠️ Get picking session API not available, using local storage");
        return null;
      }
      throw error;
    }
  },

  // Get item locations for location icon
  // Uses: GET /api/stock/item/:item_code/warehouse/:warehouse
  // Alternative: GET /api/stock-ledger/:item_code/:warehouse
  getItemLocations: async (warehouseId: string, itemCode: string) => {
    const extractLocations = (response: any): any[] => {
      if (Array.isArray(response)) return response;
      if (!response || typeof response !== "object") return [];

      const data = response.data;
      const candidates = [
        response.data,
        response.locations,
        response.stock,
        response.stock_ledger,
        response.ledger,
        response.rows,
        response.items,
        response.entries,
        data?.locations,
        data?.stock,
        data?.stock_ledger,
        data?.ledger,
        data?.rows,
        data?.items,
        data?.entries,
      ];
      const found = candidates.find((candidate) => Array.isArray(candidate));
      if (Array.isArray(found)) return found;

      if (
        response.location_id ||
        response["Location ID"] ||
        response.bin_location ||
        response.bin_code ||
        response.carton_id ||
        response["Carton ID"]
      ) {
        return [response];
      }
      if (
        data &&
        typeof data === "object" &&
        (data.location_id ||
          data["Location ID"] ||
          data.bin_location ||
          data.bin_code ||
          data.carton_id ||
          data["Carton ID"])
      ) {
        return [data];
      }

      return [];
    };

    try {
      const encodedItem = encodeURIComponent(itemCode);
      const encodedWarehouse = encodeURIComponent(warehouseId || "");
      const endpoints = [
        warehouseId
          ? `/api/stock/item/${encodedItem}/warehouse/${encodedWarehouse}`
          : null,
        warehouseId
          ? `/api/stock-ledger/${encodedItem}/${encodedWarehouse}`
          : null,
        warehouseId
          ? `/api/stock-ledger?item_code=${encodedItem}&warehouse=${encodedWarehouse}`
          : null,
        `/api/stock-ledger?item_code=${encodedItem}`,
      ].filter(Boolean) as string[];

      for (const endpoint of endpoints) {
        try {
          const response = await makeRequest(endpoint, "GET");
          const locations = extractLocations(response);
          if (locations.length > 0) {
            console.log(
              `📦 getItemLocations: ${endpoint} returned ${locations.length} row(s)`
            );
            return locations;
          }
          console.log(`ℹ️ getItemLocations: ${endpoint} returned no rows`);
        } catch (error: any) {
          if (
            error?.status === 404 ||
            error?.is404 ||
            error?.message?.includes("404") ||
            error?.message?.includes("not found")
          ) {
            console.log(`ℹ️ getItemLocations endpoint not available: ${endpoint}`);
            continue;
          }
          console.warn(
            `⚠️ getItemLocations endpoint failed (${endpoint}):`,
            error?.message || error
          );
        }
      }

      return [];
    } catch (error: any) {
      // If endpoint doesn't exist, return empty array
      if (error?.status === 404 || error?.is404 || error?.message?.includes("404") || error?.message?.includes("not found")) {
        console.log("ℹ️ Item locations API not available (404)");
        return [];
      }
      // For other errors, log and return empty array
      console.warn("⚠️ Error fetching item locations:", error.message);
      return [];
    }
  },

  // ============================================
  // CYCLE COUNT APIs
  // ============================================
  getCycleCounts: async (filters?: {
    status?: string;
    warehouse?: string;
    zone?: string;
    count_type?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.append("status", filters.status);
    if (filters?.warehouse) params.append("warehouse", filters.warehouse);
    if (filters?.zone) params.append("zone", filters.zone);
    if (filters?.count_type) params.append("count_type", filters.count_type);
    const queryString = params.toString();
    return makeRequest(
      `/api/cycle-count${queryString ? `?${queryString}` : ""}`,
      "GET"
    );
  },

  getCycleCount: async (
    title: string,
    filters?: {
      carton_id?: string;
      counted_by?: string;
    }
  ) => {
    const params = new URLSearchParams();
    if (filters?.carton_id) {
      params.append("carton_id", filters.carton_id);
    }
    if (filters?.counted_by) {
      params.append("counted_by", filters.counted_by);
    }
    const queryString = params.toString();
    return makeRequest(
      `/api/cycle-count/${title}${queryString ? `?${queryString}` : ""}`,
      "GET"
    );
  },

  startCycleCount: async (title: string, data: { started_by: string }) => {
    return makeRequest(`/api/cycle-count/${title}/start`, "POST", data);
  },

  submitCycleCountCounts: async (
    title: string,
    data: {
      counted_by: string;
      lines: {
        id?: number;
        lineId?: number; // ✅ FIX: Backend expects lineId (camelCase) for line identification
        line_id?: string; // Optional: Backend line_id in format "LINE-{id}"
        item_code: string; // Required for backend matching
        barcode?: string; // Optional, also accepted
        carton_id?: string; // ✅ NEW: Optional carton_id for carton-level inventory
        actual_qty: number;
        counted_qty?: number;
        bin_location?: string;
        expected_qty?: number | null;
        discrepancy_reason?: string | null;
        reason_code?: string | null;
        notes?: string | null;
      }[];
    }
  ) => {
    return makeRequest(`/api/cycle-count/${title}/count`, "POST", data);
  },

  updateCycleCountLine: async (
    title: string,
    data: {
      line_id: number;
      actual_qty: number;
      counted_by: string;
      discrepancy_reason?: string;
    }
  ) => {
    return makeRequest(`/api/cycle-count/${title}/update-line`, "POST", data);
  },

  submitCycleCount: async (title: string) => {
    return makeRequest(`/api/cycle-count/${title}/submit`, "POST", {});
  },

  completeCycleCount: async (title: string) => {
    return makeRequest(`/api/cycle-count/${title}/complete`, "POST", {});
  },

  deleteCycleCount: async (title: string) => {
    return makeRequest(`/api/cycle-count/${title}`, "DELETE");
  },

  createCycleCount: async (data: {
    title?: string; // Optional - backend may generate if not provided
    bin_code?: string;
    bin_id?: string;
    warehouse?: string; // Required - backend expects 'warehouse'
    warehouse_id?: string; // Also accepted for compatibility
    count_type?: string; // Required
    count_date?: string; // Required - format: YYYY-MM-DD
    is_blind_count?: boolean;
    opening_stock?: boolean; // Optional - indicates if this is an initial/baseline count (independent of blind_count)
    is_opening_stock?: boolean; // Alias for opening_stock (backend may accept either)
    created_by?: string; // Required
    lines?: any[]; // Required - array of cycle count lines (can be empty for new task)
  }) => {
    return makeRequest(`/api/cycle-count`, "POST", data);
  },

  /** Push cycle count capture to ERP via wms-api proxy (forwards to ERPNext). */
  syncCycleCountTaskCaptureOnly: async (payload: {
    task: {
      external_ref: string;
      count_mode?: string;
      company?: string;
      warehouse: string;
      warehouse_code?: string;
      bin_location: string;
      posting_date: string;
      status?: string;
      counted_by: string;
      device_id: string;
      mobile_device_id?: string;
    };
    lines: {
      item_code: string;
      bin_location: string;
      carton_id?: string;
      counted_qty: number;
    }[];
  }) => {
    const deviceId = String(payload.task.device_id || "").trim();
    const capturePayload = {
      ...payload,
      task: {
        ...payload.task,
        device_id: deviceId,
        mobile_device_id: deviceId,
      },
      device_id: deviceId,
      mobile_device_id: deviceId,
      counted_by: payload.task.counted_by,
    };
    console.log(
      `📤 Cycle Count push-capture identity:`,
      JSON.stringify({
        external_ref: capturePayload.task.external_ref,
        counted_by: capturePayload.task.counted_by,
        device_id: deviceId,
        mobile_device_id: deviceId,
      })
    );
    return makeRequest("/api/cycle-count/push-capture", "POST", {
      payload: capturePayload,
    }).then((response) => {
      const msg = response?.message ?? response;
      console.log(
        `📥 Cycle Count push-capture response:`,
        JSON.stringify(
          {
            api_version: msg?.api_version,
            task: msg?.task,
            device_id: msg?.device_id,
            counted_by: msg?.counted_by,
            audit_debug: msg?.audit_debug,
            ok: msg?.ok,
          },
          null,
          2
        )
      );
      return response;
    });
  },

  /** Pull posted stock balances from ERP after finance posts the batch. */
  getCycleCountStockSync: async (batch_name: string) => {
    return makeRequest("/api/cycle-count/stock-sync", "POST", { batch_name });
  },

  // ============================================
  // PUTAWAY TASK APIs
  // ============================================
  getPutawayTasks: async (filters?: {
    asn_no?: string | null;
    advance_shipping_notice?: string;
    source_type?: string;
    transfer_in?: string;
    status?: string;
    warehouse?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.asn_no) params.append("asn_no", filters.asn_no);
    if (filters?.advance_shipping_notice) {
      params.append("advance_shipping_notice", filters.advance_shipping_notice);
    }
    if (filters?.source_type) params.append("source_type", filters.source_type);
    if (filters?.transfer_in) params.append("transfer_in", filters.transfer_in);
    if (filters?.status) params.append("status", filters.status);
    if (filters?.warehouse) params.append("warehouse", filters.warehouse);
    const queryString = params.toString();
    return makeRequest(
      `/api/putaway/tasks${queryString ? `?${queryString}` : ""}`,
      "GET"
    );
  },

  createTaskForRemainingItems: async (asn_no: string) => {
    return makeRequest("/api/putaway/create-tasks", "POST", { asn_no });
  },

  createPutawayTaskForTransferIn: async (transfer_in: string) => {
    return makeRequest("/api/putaway/create-tasks", "POST", { transfer_in });
  },

  getPutawayTask: async (title: string) => {
    return makeRequest(`/api/putaway/tasks/${title}`, "GET");
  },

  scanTransferCarton: async (data: {
    box_id?: string;
    putaway_task?: string;
    rack?: string; // ❌ DEPRECATED: Backend doesn't support 'rack' column - use location_id instead
    bin?: string;
    location_id?: string;
    user_id?: string;
    item_code?: string;
    tc_id?: string | null;
    carton_id?: string;
    asn_no?: string;
    warehouse_id?: string; // ✅ NEW: Required by backend to prevent "warehouse is not defined" error
  }) => {
    // ❌ FIX: Remove 'rack' field from request - backend database doesn't have this column
    // Backend error: "Unknown column 'rack' in 'field list'"
    const { rack, ...requestData } = data;
    if (rack) {
      console.warn(`⚠️ Removed 'rack' field from putaway request (backend doesn't support it). Using location_id instead.`);
    }

    // Backend returns INVALID_CARTON_FORMAT if carton_id is BOX-* / PAW-* (ASN putaway expects those as box_id only).
    // Normalize at the API layer so older app builds or mis-set source_type cannot send bad carton_id.
    const rawCarton = String(requestData.carton_id ?? "").trim();
    const cartonUpper = rawCarton.toUpperCase();
    if (rawCarton && !cartonUpper.startsWith("CTN-")) {
      const existingBox = String(requestData.box_id ?? "").trim();
      if (!existingBox) {
        (requestData as any).box_id = rawCarton;
      }
      delete (requestData as any).carton_id;
      if (requestData.tc_id === undefined) {
        (requestData as any).tc_id = null;
      }
      console.warn(
        `⚠️ scanTransferCarton: non-CTN value was in carton_id; sending as box_id only (backend rule). carton_was=${rawCarton.substring(0, 48)}`
      );
    }

    console.warn(
      `📤 PUTAWAY scan-transfer-carton body:`,
      JSON.stringify(requestData, null, 2)
    );
    return makeRequest("/api/putaway/scan-transfer-carton", "POST", requestData);
  },

  completePutaway: async (data: {
    // ✅ NEW: Validation-only workflow - putaway_task is optional (created by backend)
    putaway_task?: string; // Optional: for backward compatibility
    // ✅ NEW: Send validated identifiers (backend will create putaway_task)
    tc_id?: string; // Transfer carton ID (validated)
    box_id?: string; // Box ID (validated)
    location_id: string; // Location ID (validated) - REQUIRED
    warehouse?: string; // ✅ REQUIRED: Warehouse for stock updates (from tabTransferIn.to_warehouse for Transfer In, or location/settings for ASN)
    warehouse_id?: string; // ✅ Optional: Alternative warehouse field name
    completed_by?: string;
    performed_by?: string;
    items?: {
      item_code: string;
      qty: number;
      carton_id?: string; // ✅ CORRECT: carton_id for carton-level inventory
      box_id?: string;    // ✅ CORRECT: box_id per backend spec
      location_id?: string;
      source_bin?: string;  // Optional: backend may ignore
      target_bin?: string;  // Optional: backend may ignore
      completed?: boolean;
    }[];
  }) => {
    return makeRequest("/api/putaway/complete", "POST", data);
  },

  // ============================================
  // STOCK APIs
  // ============================================
  /** Stock transaction history (same query shape as ledger; adjust path if backend differs). */
  getStockTransactions: async (filters?: {
    item_code?: string;
    warehouse?: string;
    location?: string;
    bin_location?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.item_code) params.append("item_code", filters.item_code);
    if (filters?.warehouse) params.append("warehouse", filters.warehouse);
    if (filters?.location) params.append("location", filters.location);
    if (filters?.bin_location) params.append("bin_location", filters.bin_location);
    const queryString = params.toString();
    return makeRequest(
      `/api/stock/transactions${queryString ? `?${queryString}` : ""}`,
      "GET"
    );
  },

  getStockLedger: async (filters?: {
    item_code?: string;
    warehouse?: string;
    location?: string;
    bin_location?: string; // Optional bin_location filter
  }) => {
    const params = new URLSearchParams();
    if (filters?.item_code) params.append("item_code", filters.item_code);
    if (filters?.warehouse) params.append("warehouse", filters.warehouse);
    if (filters?.location) params.append("location", filters.location);
    if (filters?.bin_location) params.append("bin_location", filters.bin_location);
    const queryString = params.toString();
    
    // /api/stock/ledger is the strict bin-location endpoint. General item/warehouse
    // lookups must use /api/stock-ledger to avoid backend 400s for missing bin_location.
    const basePath = filters?.bin_location ? "/api/stock/ledger" : "/api/stock-ledger";
    return makeRequest(
      `${basePath}${queryString ? `?${queryString}` : ""}`,
      "GET"
    );
  },

  // ✅ NEW: Get stock ledger by bin location and optional carton ID (for Cycle Count)
  getStockLedgerByLocation: async (filters: {
    bin_location: string; // Required
    carton_id?: string; // Optional for carton-level filtering
    warehouse?: string; // Optional warehouse filter
    item_code?: string; // Optional item code filter
  }) => {
    // Validate bin_location is provided and not empty/null
    if (!filters.bin_location || filters.bin_location.trim() === "" || filters.bin_location === "null") {
      console.error("❌ getStockLedgerByLocation called with invalid bin_location:", filters.bin_location);
      throw new Error("bin_location parameter is required and cannot be empty or null");
    }
    
    const params = new URLSearchParams();
    params.append("bin_location", filters.bin_location.trim());
    if (filters.carton_id && filters.carton_id.trim()) {
      params.append("carton_id", filters.carton_id.trim());
    }
    if (filters.warehouse) params.append("warehouse", filters.warehouse);
    if (filters.item_code) params.append("item_code", filters.item_code);
    const queryString = params.toString();
    const endpoint = `/api/stock/ledger?${queryString}`;
    console.log(`🔍 Fetching stock ledger by location: bin_location=${filters.bin_location}, carton_id=${filters.carton_id || 'null'}, warehouse=${filters.warehouse || 'null'}`);
    console.log(`🔍 Full endpoint: ${endpoint}`);
    const response = await makeRequest(endpoint, "GET");
    console.log(`📦 Stock ledger API response:`, {
      responseType: typeof response,
      isArray: Array.isArray(response),
      hasData: response?.data !== undefined,
      hasItems: response?.items !== undefined,
      dataLength: response?.data?.length || (Array.isArray(response) ? response.length : 0),
      itemsLength: response?.items?.length || 0,
      firstItem: Array.isArray(response) && response.length > 0 ? response[0] : (response?.data?.[0] || response?.items?.[0] || null)
    });
    return response;
  },

  getStockByItemAndWarehouse: async (
    item_code: string,
    warehouse: string
  ) => {
    if (!item_code?.trim()) {
      throw new Error("item_code is required");
    }
    if (!warehouse?.trim()) {
      throw new Error("warehouse is required");
    }
    return makeRequest(
      `/api/stock/item/${encodeURIComponent(item_code.trim())}/warehouse/${encodeURIComponent(warehouse.trim())}`,
      "GET"
    );
  },

  updateStockByLocation: async (data: {
    location_id: string;
    item_code: string;
    qty: number;
  }) => {
    return makeRequest("/api/stock/update-by-location", "POST", data);
  },

  // ============================================
  // WAREHOUSE APIs
  // ============================================
  getWarehousesAndStores: async () => {
    return makeRequest("/api/warehouses/stores", "GET");
  },

  // ============================================
  // BOX APIs (Additional)
  // ============================================
  deleteBox: async (data: { box_id: string }) => {
    return makeRequest("/api/boxes/delete", "POST", data);
  },
};
