import { getSettings } from "./settings.service";
import { ScanEvent } from "../types";

const API_TIMEOUT = 10000;

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
      const url = `${settings.api_url.replace(/\/$/, "")}${loginEndpoint}`;
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

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_code: settings.user_code || settings.user_id,
          password: settings.password || settings.device_id || "",
        }),
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
          const { saveSettings } = await import("./settings.service");
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

const makeRequest = async (
  endpoint: string,
  method: string,
  body?: any,
  retryAuth = true
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
  const url = `${settings.api_url.replace(/\/$/, "")}${endpoint}`;
  console.log(`🌐 API Request: ${method} ${url}`);

  // Log request body for carton status updates (for debugging)
  if (endpoint === "/api/cartons/update-status" && body) {
    console.log(
      `📦 Carton Status Update Request:`,
      JSON.stringify(body, null, 2)
    );
  }

  if (authToken) {
    console.log(`🔑 Using auth token: ${authToken.substring(0, 20)}...`);
  } else {
    console.warn(`⚠️ No auth token available for request`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

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

      // Handle 404 for cycle-count endpoints - throw error (no mock data)
      if (
        response.status === 404 &&
        endpoint.includes("/api/cycle-count")
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
        const { saveSettings } = await import("./settings.service");
        await saveSettings({
          auth_token: undefined,
          auth_token_expires: undefined,
        });

        // Retry the request with new authentication
        return makeRequest(endpoint, method, body, false);
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

      // For 404 errors on carton status updates, log as warning (expected if carton doesn't exist yet)
      if (
        response.status === 404 &&
        endpoint === "/api/cartons/update-status"
      ) {
        console.warn(`⚠️ ${finalError}`);
        console.warn(
          `ℹ️ This is expected if the carton hasn't been created in the backend yet. The backend should create the carton automatically or handle this gracefully.`
        );
      } else if (
        response.status === 404 &&
        endpoint.includes("/api/cycle-count")
      ) {
        // Cycle count 404s are handled above and return mock data - don't log as error
        // This check is here just in case the handler above didn't catch it
        console.warn(`ℹ️ Cycle Count endpoint returned 404 - using mock data: ${endpoint}`);
        return simulateApiResponse(endpoint, method, body);
      } else {
        console.error(`❌ ${finalError}`);
      }

      throw new Error(finalError);
    }

    // If response is OK, read as JSON
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      return await response.json();
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
      throw new Error(`Request timeout after ${API_TIMEOUT}ms: ${url}`);
    }
    if (error.message && error.message.includes("API error")) {
      throw error; // Re-throw API errors as-is
    }
    // Network errors or other errors
    const errorMsg = error.message || error.toString() || "Unknown error";
    console.error(`❌ API Request failed: ${method} ${url}`, errorMsg);
    throw new Error(`Network error: ${errorMsg}`);
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

  // Master Data Pull APIs
  if (endpoint === "/api/master/items") {
    return [
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
    ];
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

  return { ok: true };
};

export const apiService = {
  startInbound: async (data: {
    asn_no: string;
    transfer_order: string;
    dock: string;
    user_id: string;
    device_id: string;
  }) => {
    return makeRequest("/api/inbound/start", "POST", data);
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
  }) => {
    return makeRequest("/api/carton/complete", "POST", data);
  },

  updateCartonStatus: async (data: {
    asn_no: string;
    inbound_session: string;
    carton_id?: string;
    cartons?: Array<{ carton_id: string; status: string }>;
    status?: string;
    user_id?: string;
    device_id?: string;
  }) => {
    // Send status as-is: Mobile app uses "Receiving" (without space)
    // Backend must accept "Receiving" instead of "In Receiving"
    return makeRequest("/api/cartons/update-status", "POST", data);
  },

  // Unload Line APIs
  createUnloadLine: async (data: {
    parent_title: string;
    unit_type: string;
    unit_id: string;
    scanned_by: string;
    scanned_on?: string;
  }) => {
    return makeRequest("/api/inbound/unload-line", "POST", data);
  },

  getUnloadLines: async (parent_title: string) => {
    const queryParams = new URLSearchParams();
    queryParams.append("parent_title", parent_title);
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
    receive_lines: Array<{
      carton_id: string; // Changed back to carton_id as backend expects it
      item_code: string;
      expected_qty: number;
      received_qty: number;
      condition?: string;
      remarks?: string | null;
    }>;
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

  batchEvents: async (events: ScanEvent[]) => {
    // Backend expects events to be wrapped in an object with an 'events' property
    return makeRequest("/api/events/batch", "POST", { events });
  },

  createBox: async (data: { asn_no: string; to_no: string; store: string }) => {
    return makeRequest("/api/boxes/create", "POST", data);
  },

  closeBox: async (data: { box_id: string }) => {
    return makeRequest("/api/boxes/close", "POST", data);
  },

  reopenBox: async (data: { box_id: string }) => {
    return makeRequest("/api/boxes/reopen", "POST", data);
  },

  createTransferCarton: async (data: {
    asn_no: string;
    to_no?: string;
    store: string;
    user_id?: string;
    created_by?: string;
  }) => {
    // Include created_by if user_id is provided (backend may expect created_by)
    const requestData: any = {
      asn_no: data.asn_no,
      to_no: data.to_no,
      store: data.store,
    };

    // Backend expects created_by, but we'll send both user_id and created_by
    // to support either field name
    if (data.user_id) {
      requestData.user_id = data.user_id;
      requestData.created_by = data.created_by || data.user_id;
    }

    return makeRequest("/api/transfer-cartons/create", "POST", requestData);
  },

  sealTransferCarton: async (data: { tc_id: string; sealed_by?: string }) => {
    return makeRequest("/api/transfer-cartons/seal", "POST", data);
  },

  dispatchTransferCarton: async (data: { tc_id: string }) => {
    return makeRequest("/api/transfer-cartons/dispatch", "POST", data);
  },

  // PULL APIs
  getASN: async (asn_no: string) => {
    // Use ASN format exactly as received (no normalization)
    // Backend returns ASNs in exact format from database (e.g., ASN-0001, ASN-0002)
    console.log(
      `🔄 getASN: Using ASN format "${asn_no}" (preserving exact format)`
    );
    return await makeRequest(`/api/asn/${asn_no}`, "GET");
  },

  getTransferOrderByASN: async (asn_no: string) => {
    // Use ASN format exactly as received (no normalization)
    // Backend returns ASNs in exact format from database (e.g., ASN-0001, ASN-0002)
    console.log(
      `🔄 getTransferOrderByASN: Using ASN format "${asn_no}" (preserving exact format)`
    );
    return await makeRequest(`/api/transfer-order/by-asn/${asn_no}`, "GET");
  },

  getBoxes: async (params: { asn?: string; store?: string }) => {
    const queryParams = new URLSearchParams();
    if (params.asn) queryParams.append("asn", params.asn);
    if (params.store) queryParams.append("store", params.store);
    const query = queryParams.toString();
    return makeRequest(`/api/boxes${query ? `?${query}` : ""}`, "GET");
  },

  getTransferCartons: async (params: { asn?: string; store?: string }) => {
    const queryParams = new URLSearchParams();
    if (params.asn) queryParams.append("asn", params.asn);
    if (params.store) queryParams.append("store", params.store);
    const query = queryParams.toString();
    return makeRequest(
      `/api/transfer-cartons${query ? `?${query}` : ""}`,
      "GET"
    );
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
  pullItemMaster: async () => {
    return makeRequest("/api/master/items", "GET");
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

  getBinMaster: async (binCode: string) => {
    return makeRequest(`/api/master/bin-master/${encodeURIComponent(binCode)}`, "GET");
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

  // Authentication
  login: async (user_code: string, password: string): Promise<string> => {
    const settings = await getSettings();
    if (settings.demo_mode === 1 || !settings.api_url) {
      // In demo mode, return a dummy token
      const { saveSettings } = await import("./settings.service");
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
        const url = `${settings.api_url.replace(/\/$/, "")}${loginEndpoint}`;

        // Trim credentials to remove any leading/trailing whitespace
        const trimmedUserCode = user_code?.trim() || "";
        const trimmedPassword = password?.trim() || "";

        const requestBody = {
          user_code: trimmedUserCode,
          password: trimmedPassword,
        };

        console.log(`🔐 Login attempt: ${url}`);
        console.log(`📤 Request body:`, {
          user_code: trimmedUserCode,
          user_code_length: trimmedUserCode.length,
          password: "***",
          password_length: trimmedPassword.length,
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
              const { saveSettings } = await import("./settings.service");
              await saveSettings({
                auth_token: token,
                auth_token_expires: expiresAt.toISOString(),
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

            // Create detailed error message
            const errorMessage =
              errorData.error?.message ||
              errorData.message ||
              errorData.error ||
              (errorText ? errorText.substring(0, 100) : null) ||
              `Login failed: ${response.status} ${response.statusText}`;

            // If it's not 404 and not the last endpoint, throw to try next
            if (loginEndpoint !== loginEndpoints[loginEndpoints.length - 1]) {
              // Continue to next endpoint only if it's a network error or 404
              if (response.status === 404) {
                continue;
              }
              // For other errors (like 400, 401), throw to show error immediately
              throw new Error(errorMessage);
            } else {
              // Last endpoint, throw the error
              throw new Error(errorMessage);
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

      // Normalize URL (remove trailing slash, ensure protocol)
      let normalizedUrl = apiUrl.trim();
      if (
        !normalizedUrl.startsWith("http://") &&
        !normalizedUrl.startsWith("https://")
      ) {
        normalizedUrl = `https://${normalizedUrl}`;
      }
      normalizedUrl = normalizedUrl.replace(/\/+$/, ""); // Remove trailing slashes

      // Test with a simple health check endpoint or a lightweight GET request
      // Try /api/health first, fallback to root endpoint
      const testEndpoints = ["/api/health", "/api/ping", "/"];

      for (const endpoint of testEndpoints) {
        try {
          const url = `${normalizedUrl}${endpoint}`;
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
    return makeRequest(`/api/material-requests/${title}/status`, "POST", { status });
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

  getCycleCount: async (title: string) => {
    return makeRequest(`/api/cycle-count/${title}`, "GET");
  },

  startCycleCount: async (title: string, data: { started_by: string }) => {
    return makeRequest(`/api/cycle-count/${title}/start`, "POST", data);
  },

  submitCycleCountCounts: async (
    title: string,
    data: {
      counted_by: string;
      lines: Array<{
        id?: number;
        item_code: string; // Required for backend matching
        barcode?: string; // Optional, also accepted
        actual_qty: number;
        counted_qty?: number;
        bin_location?: string;
        expected_qty?: number | null;
        discrepancy_reason?: string | null;
        reason_code?: string | null;
        notes?: string | null;
      }>;
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

  // ============================================
  // PUTAWAY TASK APIs
  // ============================================
  getPutawayTasks: async (filters?: {
    asn_no?: string;
    source_type?: string;
    transfer_in?: string;
    status?: string;
    warehouse?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.asn_no) params.append("asn_no", filters.asn_no);
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
    rack?: string;
    bin?: string;
    location_id?: string;
    user_id?: string;
    item_code?: string;
  }) => {
    return makeRequest("/api/putaway/scan-transfer-carton", "POST", data);
  },

  completePutaway: async (data: {
    putaway_task: string;
    completed_by?: string;
    performed_by?: string;
    location_id?: string;
    items?: Array<{
      item_code: string;
      qty: number;
      location_id?: string;
      source_bin?: string;
      target_bin?: string;
      completed?: boolean;
    }>;
  }) => {
    return makeRequest("/api/putaway/complete", "POST", data);
  },

  // ============================================
  // STOCK APIs
  // ============================================
  getStockLedger: async (filters?: {
    item_code?: string;
    warehouse?: string;
    location?: string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.item_code) params.append("item_code", filters.item_code);
    if (filters?.warehouse) params.append("warehouse", filters.warehouse);
    if (filters?.location) params.append("location", filters.location);
    const queryString = params.toString();
    return makeRequest(
      `/api/stock/ledger${queryString ? `?${queryString}` : ""}`,
      "GET"
    );
  },

  getStockByItemAndWarehouse: async (
    item_code: string,
    warehouse: string
  ) => {
    return makeRequest(
      `/api/stock/item/${item_code}/warehouse/${warehouse}`,
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
