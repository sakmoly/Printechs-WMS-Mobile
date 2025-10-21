# 🔧 HTTP Error Fix Guide

## Error: "Cannot read property 'origin' of undefined"

This error typically occurs due to HTTP client configuration issues or CORS problems. Here's how to fix it:

## 🚨 Quick Fixes

### 1. **Check Your Server Configuration**

Make sure your ERPNext server is properly configured:

```bash
# Test if your server is accessible
curl -X GET "https://printechs.com/api/method/ping"
```

### 2. **Verify Environment Configuration**

Check your environment configuration in `mobile/src/config/env.ts`:

```typescript
// Make sure this URL is correct and accessible
ERP_BASE_URL: "https://printechs.com";
```

### 3. **Test with Debug Screen**

I've created a debug screen to help identify the issue:

1. **Add the debug screen to your app** by importing it in your main navigation
2. **Navigate to the debug screen** and run the debug checks
3. **Check the console output** for specific error messages

### 4. **Common Solutions**

#### Solution 1: Update HTTP Client Configuration

The HTTP client has been updated with better error handling. Make sure you're using the latest version.

#### Solution 2: Check CORS Configuration

If you're testing locally, make sure CORS is configured on your ERPNext server:

```python
# In your ERPNext hooks.py
cors = {
    "allow_origins": ["*"],  # For development only
    "allow_methods": ["GET", "POST", "PUT", "DELETE"],
    "allow_headers": ["Content-Type", "Authorization"]
}
```

#### Solution 3: Verify API Endpoints

Make sure the API endpoints exist in your ERPNext system:

```bash
# Test each endpoint
curl -X POST "https://printechs.com/api/method/printechs_utility.dashboard.get_complete_dashboard_data" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## 🔍 Debugging Steps

### Step 1: Use the Debug Screen

1. Navigate to `/debug-http` in your app
2. Run the debug checks
3. Check the console output

### Step 2: Check Console Logs

Look for these specific log messages:

- `🔧 Environment config:` - Shows your environment configuration
- `✅ HTTP Client baseURL updated to:` - Shows the HTTP client configuration
- `🚀 HTTP Request:` - Shows outgoing requests
- `❌ HTTP Error:` - Shows any errors

### Step 3: Test Individual Components

1. **Test Environment Loading**: Check if `env.ERP_BASE_URL` is defined
2. **Test HTTP Client**: Check if `http.getBaseUrl()` returns the correct URL
3. **Test Network Connection**: Use the debug screen to test connectivity

## 🛠️ Manual Testing

### Test 1: Environment Configuration

```typescript
import { env } from "../src/config/env";
console.log("Environment URL:", env.ERP_BASE_URL);
```

### Test 2: HTTP Client Configuration

```typescript
import { http } from "../src/api/http";
console.log("HTTP Client URL:", http.getBaseUrl());
```

### Test 3: Simple HTTP Request

```typescript
import { http } from "../src/api/http";
try {
  const response = await http.get("/api/method/ping");
  console.log("HTTP Test Success:", response);
} catch (error) {
  console.error("HTTP Test Failed:", error);
}
```

## 🚀 Quick Fixes

### Fix 1: Restart the App

Sometimes a simple restart fixes the issue:

1. Stop the Expo server
2. Clear the cache: `npx expo start --clear`
3. Restart the app

### Fix 2: Check Network Connectivity

Make sure you can access your ERPNext server:

1. Open your browser
2. Go to `https://printechs.com`
3. Verify the server is accessible

### Fix 3: Update Dependencies

Make sure all dependencies are up to date:

```bash
npm update
```

## 📞 If Issues Persist

1. **Check the debug screen output** for specific error messages
2. **Verify your ERPNext server** is running and accessible
3. **Check the network tab** in your browser's developer tools
4. **Look for CORS errors** in the console

## 🔧 Advanced Debugging

### Enable Verbose Logging

Add this to your app to get more detailed logs:

```typescript
// Add to your main App.tsx or index.tsx
import { debugHttp } from "./src/utils/debugHttp";

// Run this when the app starts
debugHttp.runAllChecks();
```

### Check Network Requests

Use your browser's developer tools to inspect network requests:

1. Open Developer Tools (F12)
2. Go to Network tab
3. Try to make a request
4. Look for failed requests and error details

## ✅ Success Indicators

You'll know the fix worked when you see:

- ✅ Environment config loaded successfully
- ✅ HTTP Client baseURL updated
- ✅ HTTP Request: GET/POST [endpoint]
- ✅ HTTP Response: 200 [endpoint]

The debug screen will show you exactly what's working and what's not! 🎉
