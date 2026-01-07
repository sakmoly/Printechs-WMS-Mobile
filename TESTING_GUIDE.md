# Inbound Workflow Testing Guide

## 🧪 Complete End-to-End Test Suite

A comprehensive test suite has been created to verify all API endpoints in the inbound workflow.

### Test File
- **Location**: `src/utils/test-inbound-workflow.ts`
- **Function**: `runInboundWorkflowTest()`

### How to Run Tests

#### Option 1: Via Sync Center Screen (Recommended)
1. Open the app
2. Navigate to **Sync Center** screen
3. In development mode, you'll see a purple button: **"🧪 Test Inbound Workflow APIs"**
4. Tap the button and confirm to run the test
5. Check console logs for detailed results

#### Option 2: Auto-run on App Start (Development Only)
Uncomment the test code in `App.tsx` (lines 48-55) to automatically run tests when the app starts:

```typescript
// Run inbound workflow test (optional - uncomment to enable)
setTimeout(async () => {
  try {
    const { runInboundWorkflowTest } = await import("./src/utils/test-inbound-workflow");
    await runInboundWorkflowTest();
  } catch (testError: any) {
    console.warn("⚠️ Inbound workflow tests failed:", testError.message);
  }
}, 10000); // Wait 10 seconds after app start
```

#### Option 3: Manual Import
```typescript
import { runInboundWorkflowTest } from "./src/utils/test-inbound-workflow";
await runInboundWorkflowTest();
```

## 📋 Test Coverage

The test suite covers all 7 steps of the inbound workflow:

### Step 0: Authentication ✅
- Tests login API
- Verifies token extraction from `data.access_token`
- Checks token expiration handling

### Step 1: Master Data Sync ✅
- `GET /api/master/asns` - Fetch ASNs
- `GET /api/master/items` - Fetch items (optional)
- `GET /api/master/warehouses-stores` - Fetch warehouses/stores

### Step 2: Create Inbound Session ✅
- `POST /api/inbound/update` - Create/update session
- `GET /api/inbound/sessions` - Get all sessions

### Step 3: Unload Cartons ✅
- `POST /api/cartons/update-status` - Mark carton as "Unloaded"
- `POST /api/inbound/unload-line` - Create unload line
- `UNLOAD_SCAN` event creation

### Step 4: Receive Items ✅
- `POST /api/cartons/update-status` - Lock carton (status: "Receiving")
- `POST /api/inbound/receive-lines` - Create receive lines
- `RECEIVE_ITEM_SCAN` event creation
- `POST /api/cartons/update-status` - Complete carton (status: "Received")

### Step 5: Sort Items to Boxes ✅
- `GET /api/boxes` - Fetch boxes
- `SORT_TO_BOX` event creation

### Step 6: Pack Boxes to Transfer Cartons ✅
- `POST /api/transfer-cartons/create` - Create transfer carton
- `GET /api/transfer-cartons` - Fetch transfer cartons
- `PACK_BOX_TO_TC` event creation
- `POST /api/transfer-cartons/seal` - Seal transfer carton
- `POST /api/transfer-cartons/dispatch` - Dispatch transfer carton

### Step 7: Complete Inbound Session ✅
- `POST /api/inbound/complete` - Complete session

## 📊 Test Results

The test provides detailed results for each step:

- ✅ **PASS** - Test passed successfully
- ❌ **FAIL** - Test failed (check error message)
- ⏭️ **SKIP** - Test skipped (e.g., no API URL configured, no ASNs available)

### Example Output

```
🧪 Starting Complete Inbound Workflow Test...
============================================================

🔐 Step 0: Testing Authentication...
✅ Authentication: Authentication successful (token valid or obtained)

📦 Step 1: Testing Master Data Sync...
✅ GET /api/master/asns: Fetched 5 ASNs
✅ GET /api/master/items: Fetched 120 items
✅ GET /api/master/warehouses-stores: Fetched warehouses/stores

🚀 Step 2: Testing Inbound Session Creation...
✅ POST /api/inbound/update: Session created: TEST-SESSION-1234567890
✅ GET /api/inbound/sessions: Fetched inbound sessions

...

============================================================
📊 Test Summary
============================================================
✅ Passed: 25
❌ Failed: 0
⏭️  Skipped: 2
📊 Total: 27

✅ Test completed!
```

## 🔍 What Gets Tested

### API Endpoints
- All endpoints from the API document are tested
- Field name flexibility is verified (asn_no/advance_shipping_notice, etc.)
- Response format handling is tested

### Event Types
- `UNLOAD_SCAN` - Carton unloaded
- `RECEIVE_ITEM_SCAN` - Item received
- `SORT_TO_BOX` - Item sorted to box
- `PACK_BOX_TO_TC` - Box packed to transfer carton
- `TC_DISPATCH` - Transfer carton dispatched

### Error Handling
- Network errors
- 404 errors (optional endpoints)
- 500 errors
- Validation errors

## ⚠️ Important Notes

1. **Test Data**: The test creates test data (sessions, cartons, etc.) with "TEST-" prefix
2. **API URL Required**: Tests require API URL to be configured in settings
3. **ASN Required**: Some tests require at least one ASN in the database
4. **Non-Destructive**: Tests create test data but don't delete existing data
5. **Development Mode**: Test button only appears in `__DEV__` mode

## 🐛 Troubleshooting

### Tests Skipped
- **No API URL**: Configure API URL in Settings screen
- **No ASNs**: Sync master data first to get ASNs
- **No Credentials**: Configure user_code and password in Settings

### Tests Failed
- **Network Error**: Check API server is running and reachable
- **Authentication Error**: Verify credentials in Settings
- **404 Errors**: Some endpoints may not be implemented on backend (marked as optional)
- **500 Errors**: Check backend server logs

### Console Logs
All test results are logged to console with detailed information:
- Request/response data
- Error messages
- Test status for each step

## 📝 Next Steps

After running tests:

1. **Review Results**: Check console for detailed test results
2. **Fix Issues**: Address any failed tests
3. **Verify Backend**: Ensure all endpoints are implemented on backend
4. **Manual Testing**: Test actual workflow in the app
5. **Production Ready**: Once all tests pass, app is ready for production

## 🔗 Related Documents

- `INBOUND_WORKFLOW_API_REVIEW.md` - Complete API implementation review
- API Document - Complete inbound workflow API specification

