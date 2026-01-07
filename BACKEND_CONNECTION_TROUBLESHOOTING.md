# Backend Connection Troubleshooting Guide

## Issue: All Login Endpoints Return 404

### Symptoms

- All login endpoints return 404 (Not Found)
- Error: "Login failed: All login endpoints returned 404"
- Server is reachable but endpoints don't exist

### Root Cause

The backend server at `http://192.168.103.219:3000` does not have the login endpoint implemented.

### Solution

#### Option 1: Implement Login Endpoint on Backend (Recommended)

The backend must implement the login endpoint as specified in the PDF (section 12.1):

**Endpoint:** `POST /api/auth/login`

**Request Format:**

```json
{
  "user_code": "USER-172188",
  "password": "password123"
}
```

**Response Format:**

```json
{
  "success": true,
  "data": {
    "access_token": "<jwt_token>",
    "expires_in": 604800,
    "user": {
      "user_code": "USER-172188",
      "name": "John Doe"
    }
  }
}
```

**Backend Implementation Example (Node.js/Express):**

```javascript
app.post("/api/auth/login", async (req, res) => {
  const { user_code, password } = req.body;

  // Validate input
  if (!user_code || !password) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "user_code and password are required",
      },
    });
  }

  // Authenticate user (example - replace with your authentication logic)
  const user = await db.query(
    "SELECT * FROM users WHERE user_code = ? AND password = ?",
    [user_code, password]
  );

  if (!user || user.length === 0) {
    return res.status(401).json({
      ok: false,
      error: {
        code: "AUTH_INVALID",
        message: "Invalid credentials",
      },
    });
  }

  // Generate JWT token (example - use your JWT library)
  const token = jwt.sign(
    { user_code: user_code, user_id: user[0].id },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  // Return success response
  res.json({
    success: true,
    data: {
      access_token: token,
      expires_in: 604800, // 7 days in seconds
      user: {
        user_code: user[0].user_code,
        name: user[0].name || user[0].user_code,
      },
    },
  });
});
```

#### Option 2: Use Demo Mode (Temporary)

If the backend is not ready, you can use Demo Mode:

1. Go to Settings
2. Enable "Demo Mode"
3. The app will work with mock data without requiring backend connection

#### Option 3: Bypass Authentication (Development Only)

The mobile app has been updated to continue working even if authentication fails. API calls will proceed without an auth token, but the backend may reject them if authentication is required.

### Testing Server Connection

The mobile app now includes server reachability testing. When you try to login, it will:

1. First test if the server is reachable
2. If reachable, try all login endpoints
3. Provide detailed error messages

### Common Issues

#### 1. Server Not Running

- **Symptom:** Connection timeout or "Network request failed"
- **Solution:** Ensure backend server is running on port 3000

#### 2. Wrong API URL

- **Symptom:** Connection timeout or "Cannot connect"
- **Solution:** Verify API URL in Settings matches your server address

#### 3. Firewall Blocking

- **Symptom:** Connection timeout
- **Solution:** Check firewall settings on both mobile device and server

#### 4. CORS Issues

- **Symptom:** CORS error in console
- **Solution:** Backend must allow CORS from mobile app origin

### Backend Requirements Summary

According to the PDF specification, the backend must implement:

1. **Authentication:**

   - `POST /api/auth/login` - User login

2. **Inbound Session:**

   - `POST /api/inbound/update` - Create/update session
   - `POST /api/inbound/complete` - Complete session

3. **Carton Management:**

   - `POST /api/cartons/update-status` - Update carton status
   - `POST /api/carton/lock` - Lock carton
   - `POST /api/carton/complete` - Complete carton

4. **Receiving:**

   - `POST /api/inbound/receive-lines` - Batch receive lines

5. **Boxes:**

   - `POST /api/boxes/create` - Create box
   - `POST /api/boxes/close` - Close box

6. **Transfer Cartons:**

   - `POST /api/transfer-cartons/create` - Create TC
   - `POST /api/transfer-cartons/seal` - Seal TC
   - `POST /api/transfer-cartons/dispatch` - Dispatch TC

7. **Events:**

   - `POST /api/events/batch` - Batch sync events

8. **Master Data:**
   - `GET /api/master/asns` - List ASNs
   - `GET /api/asn/{asn_no}` - Get ASN details
   - `GET /api/transfer-order/by-asn/{asn_no}` - Get transfer order

See `BACKEND_API_SERVER_UPDATE_REQUIRED.md` for complete implementation details.

### Next Steps

1. **Check Backend Server:**

   - Verify server is running: `http://192.168.103.219:3000`
   - Test with browser or Postman

2. **Implement Login Endpoint:**

   - Follow the example above
   - Test with Postman first
   - Then try from mobile app

3. **Verify Other Endpoints:**

   - Check if other endpoints are implemented
   - See `BACKEND_API_SERVER_UPDATE_REQUIRED.md` for requirements

4. **Test Connection:**
   - Use Settings > Test Connection
   - Check console logs for detailed diagnostics

### Debugging Tips

1. **Enable Console Logging:**

   - Check React Native debugger console
   - Look for detailed error messages

2. **Test with Postman:**

   - Test endpoints manually first
   - Verify request/response formats

3. **Check Network:**

   - Ensure mobile device and server are on same network
   - Test with browser on mobile device

4. **Review Backend Logs:**
   - Check backend server logs
   - Look for incoming requests

### Error: "Unknown column 'title' in 'where clause'" (500 Error)

**Symptom:**

```
ERROR ❌ API error (500): {"code":"DATABASE_ERROR","message":"Failed to update inbound session","details":"Unknown column 'title' in 'where clause'"}
```

**Cause:**
The backend is trying to use a column called `title` in the `inbound_sessions` table, but this column doesn't exist. The correct column name is `inbound_session` (which is the PRIMARY KEY).

**Solution:**
The backend must use `inbound_session` instead of `title` in all SQL queries for the `inbound_sessions` table.

**Correct Database Schema:**

```sql
CREATE TABLE IF NOT EXISTS inbound_sessions (
  inbound_session TEXT PRIMARY KEY,  -- ⚠️ Use 'inbound_session', NOT 'title'
  asn_no TEXT NOT NULL,
  transfer_order TEXT,
  dock TEXT,
  status TEXT DEFAULT 'Active',
  completed_cartons INTEGER DEFAULT 0,
  total_cartons INTEGER DEFAULT 0,
  started_by TEXT,
  started_on TEXT,
  completed_on TEXT,
  updated_on TEXT,
  user_id TEXT,
  device_id TEXT
);
```

**Backend Fix Required:**
In the `POST /api/inbound/update` endpoint, ensure all queries use `inbound_session`:

```javascript
// ❌ WRONG - Don't use 'title'
SELECT * FROM inbound_sessions WHERE title = ?

// ✅ CORRECT - Use 'inbound_session'
SELECT * FROM inbound_sessions WHERE inbound_session = ?
```

**Reference:**
See `BACKEND_API_SERVER_UPDATE_REQUIRED.md` section 2 for the complete implementation.

### Support

If issues persist:

1. Check `BACKEND_API_SERVER_UPDATE_REQUIRED.md` for API specifications
2. Review `API_REVIEW_SUMMARY.md` for mobile app API usage
3. Enable Demo Mode to test app functionality without backend
