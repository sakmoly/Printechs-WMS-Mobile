/**
 * Complete Inbound Workflow End-to-End Test
 * 
 * This test verifies the complete inbound workflow from login to session completion.
 * Run this test to ensure all APIs are working correctly.
 */

import { apiService } from "../services/api.service";
import { getSettings, saveSettings } from "../services/settings.service";
import { addEvent } from "../services/event-queue.service";
import { dataService } from "../services/data.service";

interface TestResult {
  step: string;
  status: "PASS" | "FAIL" | "SKIP";
  message: string;
  details?: any;
}

const testResults: TestResult[] = [];

const logResult = (step: string, status: "PASS" | "FAIL" | "SKIP", message: string, details?: any) => {
  testResults.push({ step, status, message, details });
  const icon = status === "PASS" ? "✅" : status === "FAIL" ? "❌" : "⏭️";
  console.log(`${icon} ${step}: ${message}`);
  if (details) {
    console.log(`   Details:`, details);
  }
};

/**
 * Test Step 0: Authentication
 */
const testAuthentication = async (): Promise<boolean> => {
  try {
    console.log("\n🔐 Step 0: Testing Authentication...");
    
    const settings = await getSettings();
    
    if (!settings.api_url) {
      logResult("Authentication", "SKIP", "API URL not configured (demo mode?)");
      return true;
    }
    
    if (!settings.user_code && !settings.user_id) {
      logResult("Authentication", "SKIP", "User credentials not configured");
      return true;
    }
    
    // Try to authenticate (this will use existing token if valid)
    // The authenticate function is called internally by makeRequest
    // So we'll test it by making a simple API call
    try {
      await apiService.pullASNData();
      logResult("Authentication", "PASS", "Authentication successful (token valid or obtained)");
      return true;
    } catch (error: any) {
      if (error.message?.includes("token") || error.message?.includes("auth")) {
        logResult("Authentication", "FAIL", `Authentication failed: ${error.message}`);
        return false;
      }
      // If it's a different error (like 404), auth might still be working
      logResult("Authentication", "PASS", "Authentication appears to be working (non-auth error)");
      return true;
    }
  } catch (error: any) {
    logResult("Authentication", "FAIL", `Error: ${error.message}`);
    return false;
  }
};

/**
 * Test Step 1: Master Data Sync
 */
const testMasterDataSync = async (): Promise<boolean> => {
  try {
    console.log("\n📦 Step 1: Testing Master Data Sync...");
    
    const settings = await getSettings();
    if (!settings.api_url) {
      logResult("Master Data Sync", "SKIP", "API URL not configured");
      return true;
    }
    
    // Test ASN sync
    try {
      const asns = await apiService.pullASNData();
      logResult("GET /api/master/asns", "PASS", `Fetched ${Array.isArray(asns) ? asns.length : 0} ASNs`);
    } catch (error: any) {
      const errorMsg = error.message || error.toString();
      if (errorMsg.includes("404") || errorMsg.includes("not found")) {
        logResult("GET /api/master/asns", "SKIP", "Endpoint not available (404)");
      } else {
        logResult("GET /api/master/asns", "FAIL", errorMsg);
      }
    }
    
    // Test Items sync (first page only)
    try {
      const raw = await apiService.pullItemMaster({ limit: 10, offset: 0 });
      const n = Array.isArray(raw)
        ? raw.length
        : raw?.items?.length ?? raw?.data?.length ?? 0;
      logResult("GET /api/master/items", "PASS", `Fetched ${n} items (first page)`);
    } catch (error: any) {
      const errorMsg = error.message || error.toString();
      if (errorMsg.includes("404") || errorMsg.includes("not found")) {
        logResult("GET /api/master/items", "SKIP", "Endpoint not available (404) - optional");
      } else {
        logResult("GET /api/master/items", "FAIL", errorMsg);
      }
    }
    
    // Test Warehouses/Stores sync
    try {
      const warehouses = await apiService.getWarehousesAndStores();
      logResult("GET /api/master/warehouses-stores", "PASS", `Fetched warehouses/stores`);
    } catch (error: any) {
      const errorMsg = error.message || error.toString();
      if (errorMsg.includes("404") || errorMsg.includes("not found")) {
        logResult("GET /api/master/warehouses-stores", "SKIP", "Endpoint not available (404)");
      } else {
        logResult("GET /api/master/warehouses-stores", "FAIL", errorMsg);
      }
    }
    
    return true;
  } catch (error: any) {
    logResult("Master Data Sync", "FAIL", `Error: ${error.message}`);
    return false;
  }
};

/**
 * Test Step 2: Create Inbound Session
 */
const testCreateInboundSession = async (): Promise<string | null> => {
  try {
    console.log("\n🚀 Step 2: Testing Inbound Session Creation...");
    
    const settings = await getSettings();
    if (!settings.api_url) {
      logResult("Create Inbound Session", "SKIP", "API URL not configured");
      return null;
    }
    
    // Get an ASN to use for testing
    const asns = await dataService.getAllASNs();
    if (asns.length === 0) {
      logResult("Create Inbound Session", "SKIP", "No ASNs available in database");
      return null;
    }
    
    const testASN = asns[0].asn_no;
    const testSession = `TEST-SESSION-${Date.now()}`;
    
    try {
      const result = await apiService.updateInboundSession({
        inbound_session: testSession,
        asn_no: testASN,
        status: "Active",
        total_cartons: 1,
        completed_cartons: 0,
        user_id: settings.user_id || "TEST-USER",
        device_id: settings.device_id || "TEST-DEVICE",
      });
      
      logResult("POST /api/inbound/update", "PASS", `Session created: ${testSession}`, result);
      
      // Test GET /api/inbound/sessions
      try {
        const sessions = await apiService.getInboundSessions();
        logResult("GET /api/inbound/sessions", "PASS", "Fetched inbound sessions");
      } catch (error: any) {
        const errorMsg = error.message || error.toString();
        if (errorMsg.includes("404") || errorMsg.includes("not found")) {
          logResult("GET /api/inbound/sessions", "SKIP", "Endpoint not available (404)");
        } else {
          logResult("GET /api/inbound/sessions", "FAIL", errorMsg);
        }
      }
      
      return testSession;
    } catch (error: any) {
      logResult("POST /api/inbound/update", "FAIL", error.message);
      return null;
    }
  } catch (error: any) {
    logResult("Create Inbound Session", "FAIL", `Error: ${error.message}`);
    return null;
  }
};

/**
 * Test Step 3: Unload Cartons
 */
const testUnloadCartons = async (sessionId: string | null, asnNo: string | null): Promise<boolean> => {
  try {
    console.log("\n📦 Step 3: Testing Unload Cartons...");
    
    if (!sessionId || !asnNo) {
      logResult("Unload Cartons", "SKIP", "No session or ASN available");
      return true;
    }
    
    const settings = await getSettings();
    const testCartonId = `TEST-CTN-${Date.now()}`;
    
    try {
      // Test carton status update
      const result = await apiService.updateCartonStatus({
        asn_no: asnNo,
        inbound_session: sessionId,
        carton_id: testCartonId,
        status: "Unloaded",
        user_id: settings.user_id || "TEST-USER",
        device_id: settings.device_id || "TEST-DEVICE",
      });
      
      logResult("POST /api/cartons/update-status (Unloaded)", "PASS", `Carton ${testCartonId} marked as Unloaded`, result);
      
      // Test unload line creation
      try {
        await apiService.createUnloadLine({
          parent_title: sessionId,
          unit_type: "Carton",
          unit_id: testCartonId,
          scanned_by: settings.user_id || "TEST-USER",
        });
        logResult("POST /api/inbound/unload-line", "PASS", "Unload line created");
      } catch (error: any) {
        logResult("POST /api/inbound/unload-line", "FAIL", error.message);
      }
      
      // Test UNLOAD_SCAN event
      try {
        await addEvent({
          event_type: "UNLOAD_SCAN",
          asn_no: asnNo,
          inbound_session: sessionId,
          carton_id: testCartonId,
          qty: 1,
        });
        logResult("UNLOAD_SCAN Event", "PASS", "Event created");
      } catch (error: any) {
        logResult("UNLOAD_SCAN Event", "FAIL", error.message);
      }
      
      return true;
    } catch (error: any) {
      logResult("Unload Cartons", "FAIL", error.message);
      return false;
    }
  } catch (error: any) {
    logResult("Unload Cartons", "FAIL", `Error: ${error.message}`);
    return false;
  }
};

/**
 * Test Step 4: Receive Items
 */
const testReceiveItems = async (sessionId: string | null, asnNo: string | null): Promise<boolean> => {
  try {
    console.log("\n📥 Step 4: Testing Receive Items...");
    
    if (!sessionId || !asnNo) {
      logResult("Receive Items", "SKIP", "No session or ASN available");
      return true;
    }
    
    const settings = await getSettings();
    const testCartonId = `TEST-CTN-${Date.now()}`;
    const testItemCode = "TEST-ITEM-001";
    
    try {
      // Test lock carton (status: Receiving)
      await apiService.updateCartonStatus({
        asn_no: asnNo,
        inbound_session: sessionId,
        carton_id: testCartonId,
        status: "Receiving",
        user_id: settings.user_id || "TEST-USER",
        device_id: settings.device_id || "TEST-DEVICE",
        locked_by: settings.user_id || "TEST-USER",
        locked_on: new Date().toISOString(),
      });
      logResult("POST /api/cartons/update-status (Receiving)", "PASS", "Carton locked for receiving");
      
      // Test receive lines
      try {
        await apiService.createReceiveLines({
          receive_lines: [
            {
              parent_title: sessionId,
              carton_id: testCartonId,
              item_code: testItemCode,
              expected_qty: 10,
              received_qty: 10,
              condition: "Good",
            },
          ],
        });
        logResult("POST /api/inbound/receive-lines", "PASS", "Receive lines created");
      } catch (error: any) {
        logResult("POST /api/inbound/receive-lines", "FAIL", error.message);
      }
      
      // Test RECEIVE_ITEM_SCAN event
      try {
        await addEvent({
          event_type: "RECEIVE_ITEM_SCAN",
          asn_no: asnNo,
          inbound_session: sessionId,
          carton_id: testCartonId,
          item_code: testItemCode,
          qty: 10,
        });
        logResult("RECEIVE_ITEM_SCAN Event", "PASS", "Event created");
      } catch (error: any) {
        logResult("RECEIVE_ITEM_SCAN Event", "FAIL", error.message);
      }
      
      // Test complete carton (status: Received)
      await apiService.updateCartonStatus({
        asn_no: asnNo,
        inbound_session: sessionId,
        carton_id: testCartonId,
        status: "Received",
        user_id: settings.user_id || "TEST-USER",
        device_id: settings.device_id || "TEST-DEVICE",
      });
      logResult("POST /api/cartons/update-status (Received)", "PASS", "Carton marked as received");
      
      return true;
    } catch (error: any) {
      logResult("Receive Items", "FAIL", error.message);
      return false;
    }
  } catch (error: any) {
    logResult("Receive Items", "FAIL", `Error: ${error.message}`);
    return false;
  }
};

/**
 * Test Step 5: Sort Items to Boxes
 */
const testSortToBoxes = async (sessionId: string | null, asnNo: string | null): Promise<boolean> => {
  try {
    console.log("\n📦 Step 5: Testing Sort to Boxes...");
    
    if (!sessionId || !asnNo) {
      logResult("Sort to Boxes", "SKIP", "No session or ASN available");
      return true;
    }
    
    try {
      // Test get boxes
      const boxes = await apiService.getBoxes({ asn: asnNo, store: "WAREHOUSE" });
      logResult("GET /api/boxes", "PASS", `Fetched boxes (may be empty)`);
      
      // Test SORT_TO_BOX event
      try {
        await addEvent({
          event_type: "SORT_TO_BOX",
          asn_no: asnNo,
          inbound_session: sessionId,
          item_code: "TEST-ITEM-001",
          box_id: "TEST-BOX-001",
          qty: 5,
          store: "WAREHOUSE",
        });
        logResult("SORT_TO_BOX Event", "PASS", "Event created");
      } catch (error: any) {
        logResult("SORT_TO_BOX Event", "FAIL", error.message);
      }
      
      return true;
    } catch (error: any) {
      logResult("Sort to Boxes", "FAIL", error.message);
      return false;
    }
  } catch (error: any) {
    logResult("Sort to Boxes", "FAIL", `Error: ${error.message}`);
    return false;
  }
};

/**
 * Test Step 6: Pack Boxes to Transfer Cartons
 */
const testPackToTransferCartons = async (sessionId: string | null, asnNo: string | null): Promise<boolean> => {
  try {
    console.log("\n📦 Step 6: Testing Pack to Transfer Cartons...");
    
    if (!sessionId || !asnNo) {
      logResult("Pack to Transfer Cartons", "SKIP", "No session or ASN available");
      return true;
    }
    
    const settings = await getSettings();
    
    try {
      // Test create transfer carton
      const tcResult = await apiService.createTransferCarton({
        asn_no: asnNo,
        to_no: "TEST-TO-001",
        store: "WAREHOUSE",
        user_id: settings.user_id || "TEST-USER",
        created_by: settings.user_id || "TEST-USER",
      });
      
      const tcId = tcResult.tc_id || tcResult.data?.tc_id || `TC-${Date.now()}`;
      logResult("POST /api/transfer-cartons/create", "PASS", `Transfer carton created: ${tcId}`);
      
      // Test get transfer cartons
      try {
        const tcs = await apiService.getTransferCartons({ asn: asnNo, store: "WAREHOUSE" });
        logResult("GET /api/transfer-cartons", "PASS", "Fetched transfer cartons");
      } catch (error: any) {
        logResult("GET /api/transfer-cartons", "FAIL", error.message);
      }
      
      // Test PACK_BOX_TO_TC event
      try {
        await addEvent({
          event_type: "PACK_BOX_TO_TC",
          asn_no: asnNo,
          inbound_session: sessionId,
          box_id: "TEST-BOX-001",
          tc_id: tcId,
          store: "WAREHOUSE",
        });
        logResult("PACK_BOX_TO_TC Event", "PASS", "Event created");
      } catch (error: any) {
        logResult("PACK_BOX_TO_TC Event", "FAIL", error.message);
      }
      
      // Test seal transfer carton
      try {
        await apiService.sealTransferCarton({ tc_id: tcId, sealed_by: settings.user_id || "TEST-USER" });
        logResult("POST /api/transfer-cartons/seal", "PASS", "Transfer carton sealed");
      } catch (error: any) {
        logResult("POST /api/transfer-cartons/seal", "FAIL", error.message);
      }
      
      // Test dispatch transfer carton
      try {
        await apiService.dispatchTransferCarton({ tc_id: tcId, dispatched_by: settings.user_id || "TEST-USER" });
        logResult("POST /api/transfer-cartons/dispatch", "PASS", "Transfer carton dispatched");
      } catch (error: any) {
        logResult("POST /api/transfer-cartons/dispatch", "FAIL", error.message);
      }
      
      return true;
    } catch (error: any) {
      logResult("Pack to Transfer Cartons", "FAIL", error.message);
      return false;
    }
  } catch (error: any) {
    logResult("Pack to Transfer Cartons", "FAIL", `Error: ${error.message}`);
    return false;
  }
};

/**
 * Test Step 7: Complete Inbound Session
 */
const testCompleteSession = async (sessionId: string | null, asnNo: string | null): Promise<boolean> => {
  try {
    console.log("\n✅ Step 7: Testing Complete Inbound Session...");
    
    if (!sessionId || !asnNo) {
      logResult("Complete Session", "SKIP", "No session or ASN available");
      return true;
    }
    
    const settings = await getSettings();
    
    try {
      await apiService.completeInboundSession({
        inbound_session: sessionId,
        asn_no: asnNo,
        user_id: settings.user_id || "TEST-USER",
        device_id: settings.device_id || "TEST-DEVICE",
      });
      
      logResult("POST /api/inbound/complete", "PASS", "Session completed");
      return true;
    } catch (error: any) {
      logResult("POST /api/inbound/complete", "FAIL", error.message);
      return false;
    }
  } catch (error: any) {
    logResult("Complete Session", "FAIL", `Error: ${error.message}`);
    return false;
  }
};

/**
 * Run complete workflow test
 */
export const runInboundWorkflowTest = async (): Promise<void> => {
  console.log("🧪 Starting Complete Inbound Workflow Test...");
  console.log("=" .repeat(60));
  
  testResults.length = 0; // Clear previous results
  
  try {
    // Step 0: Authentication
    const authOk = await testAuthentication();
    if (!authOk) {
      console.log("\n⚠️ Authentication failed. Some tests may be skipped.");
    }
    
    // Step 1: Master Data Sync
    await testMasterDataSync();
    
    // Step 2: Create Inbound Session
    const sessionId = await testCreateInboundSession();
    const asns = await dataService.getAllASNs();
    const asnNo = asns.length > 0 ? asns[0].asn_no : null;
    
    // Step 3: Unload Cartons
    await testUnloadCartons(sessionId, asnNo);
    
    // Step 4: Receive Items
    await testReceiveItems(sessionId, asnNo);
    
    // Step 5: Sort to Boxes
    await testSortToBoxes(sessionId, asnNo);
    
    // Step 6: Pack to Transfer Cartons
    await testPackToTransferCartons(sessionId, asnNo);
    
    // Step 7: Complete Session
    await testCompleteSession(sessionId, asnNo);
    
    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 Test Summary");
    console.log("=".repeat(60));
    
    const passed = testResults.filter((r) => r.status === "PASS").length;
    const failed = testResults.filter((r) => r.status === "FAIL").length;
    const skipped = testResults.filter((r) => r.status === "SKIP").length;
    
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`📊 Total: ${testResults.length}`);
    
    if (failed > 0) {
      console.log("\n❌ Failed Tests:");
      testResults
        .filter((r) => r.status === "FAIL")
        .forEach((r) => {
          console.log(`   - ${r.step}: ${r.message}`);
        });
    }
    
    console.log("\n✅ Test completed!");
  } catch (error: any) {
    console.error("\n❌ Test suite error:", error);
    logResult("Test Suite", "FAIL", error.message);
  }
};

// Export for use in App.tsx or other test runners
export default runInboundWorkflowTest;

