# 🔒 HTTP 403 Error Fix Guide

## Error: "Request failed with status code 403"

A **403 Forbidden** error means the server received your request but is refusing to authorize it. This is different from a 401 (unauthorized) error.

## 🚨 Common Causes

1. **Not Logged In** - No authentication token present
2. **Expired Token** - Your session has expired
3. **Invalid Token** - Token format is incorrect
4. **Missing Permissions** - User doesn't have access to the resource
5. **CORS Issues** - Cross-Origin Request Blocked
6. **ERPNext API Key Issues** - API key not configured properly

## ✅ Quick Fixes

### Fix 1: Check if You're Logged In

The most common cause is not being logged in. Check your authentication status:

```typescript
import { storage } from "./src/api/storage";

// Check if token exists
const token = await storage.getToken();
console.log("Token exists:", !!token);
console.log("Token:", token);
```

**Solution:** If no token exists, you need to log in first.

### Fix 2: Clear Cache and Re-login

Sometimes the token gets corrupted:

1. **Log out** of the app
2. **Clear app storage**: Settings → Apps → Your App → Clear Storage
3. **Restart the app**
4. **Log in again**

### Fix 3: Check ERPNext API Permissions

Make sure your ERPNext user has the correct permissions:

1. **Log into ERPNext** as Administrator
2. **Go to User List** (Search for "User" in the search bar)
3. **Click on your user**
4. **Check Role Permissions** - Make sure user has access to:
   - Employee
   - Dashboard
   - ToDo
   - Sales Invoice
   - etc.

### Fix 4: Enable Guest Access for Public APIs

If you want some APIs to work without authentication, add this to your ERPNext API:

```python
@frappe.whitelist(allow_guest=True)  # Add allow_guest=True
def get_complete_dashboard_data(company=None, from_date=None, to_date=None):
    # Your API code here
    pass
```

**⚠️ Warning:** Only use `allow_guest=True` for truly public data!

### Fix 5: Update Authentication Header Format

ERPNext expects a specific token format. Update the HTTP client:

```typescript
// In src/api/http.ts
config.headers.Authorization = `token ${api_key}:${api_secret}`;
// OR
config.headers.Authorization = `Bearer ${token}`;
```

## 🔍 Debugging Steps

### Step 1: Check Your Token

```typescript
import { storage } from "./src/api/storage";

const token = await storage.getToken();
if (!token) {
  console.log("❌ No token found - You need to log in");
} else {
  console.log("✅ Token exists:", token.substring(0, 20) + "...");
}
```

### Step 2: Test with Postman/curl

Test the same API endpoint with curl to verify it works:

```bash
# Replace YOUR_API_KEY and YOUR_API_SECRET with actual values
curl -X POST "https://printechs.com/api/method/printechs_utility.dashboard.get_complete_dashboard_data" \
  -H "Content-Type: application/json" \
  -H "Authorization: token YOUR_API_KEY:YOUR_API_SECRET" \
  -d '{}'
```

If this works, the issue is with your mobile app's authentication.

### Step 3: Check ERPNext Logs

Check the ERPNext server logs for more details:

1. **SSH into your server**
2. **Check error logs**: `tail -f sites/your-site/logs/error.log`
3. **Look for 403 errors** and the reason

### Step 4: Verify API Method is Whitelisted

Make sure your API methods have the `@frappe.whitelist()` decorator:

```python
import frappe

@frappe.whitelist()  # This is required!
def get_complete_dashboard_data(company=None, from_date=None, to_date=None):
    # Your code here
    return {...}
```

## 🛠️ ERPNext Configuration

### Option 1: Use API Key/Secret (Recommended)

1. **Create an API Key in ERPNext:**

   - Go to User → API Access → Generate Keys
   - Save the API Key and API Secret
   - Use them in your app

2. **Update your login to use API Key:**

```typescript
// In your login function
const credentials = {
  api_key: "your_api_key",
  api_secret: "your_api_secret",
};
```

3. **Update HTTP client:**

```typescript
// In src/api/http.ts
config.headers.Authorization = `token ${api_key}:${api_secret}`;
```

### Option 2: Use Session-Based Auth

If you're using username/password login:

1. **Make sure cookies are enabled**
2. **Use `withCredentials: true`** in axios config
3. **Session should persist** across requests

## 🔧 Code Fixes

### Fix HTTP Client Authentication

Update `mobile/src/api/http.ts`:

```typescript
private setupInterceptors() {
  this.client.interceptors.request.use(
    async (config) => {
      try {
        const token = await storage.getToken();
        if (token) {
          config.headers = config.headers || {};

          // Try different auth formats based on your ERPNext setup
          // Option 1: API Key format
          config.headers.Authorization = `token ${token}`;

          // Option 2: Bearer token format
          // config.headers.Authorization = `Bearer ${token}`;

          // Option 3: API Key:Secret format
          // const [key, secret] = token.split(':');
          // config.headers.Authorization = `token ${key}:${secret}`;

          console.log('🔑 Auth header added:', config.headers.Authorization.substring(0, 30) + '...');
        } else {
          console.log('⚠️ No token found - request may fail');
        }

        return config;
      } catch (error) {
        console.error("❌ Request interceptor error:", error);
        return Promise.reject(error);
      }
    }
  );
}
```

### Add Better 403 Error Handling

```typescript
this.client.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 403) {
      console.log("🚫 403 Forbidden - Check authentication and permissions");
      console.log("URL:", error.config?.url);
      console.log("Headers:", error.config?.headers);

      // Optionally trigger re-login
      // this.onUnauthorized?.();
    }
    return Promise.reject(error);
  }
);
```

## 🎯 Most Likely Solutions

Based on your setup, try these in order:

### 1. **Re-Login** (Most Common)

- Log out of the app
- Clear app data
- Log in again

### 2. **Check Token Format**

- Verify token is being sent correctly
- Check authorization header format

### 3. **Verify API Permissions**

- Make sure user has required roles
- Check API method is whitelisted

### 4. **Enable API Access**

- Generate API Keys in ERPNext
- Use API Key/Secret instead of session

## 📝 Testing Checklist

- [ ] User is logged in
- [ ] Token exists in storage
- [ ] Token is being sent in requests
- [ ] Authorization header format is correct
- [ ] User has required permissions in ERPNext
- [ ] API methods are whitelisted with `@frappe.whitelist()`
- [ ] CORS is configured correctly
- [ ] API endpoints exist in ERPNext

## 🚀 Next Steps

1. **Check if you're logged in** - Most likely cause
2. **Re-login if needed**
3. **Verify token is being sent** - Check console logs
4. **Test API with curl** - Confirm endpoint works
5. **Check ERPNext permissions** - Verify user access

The 403 error is almost always an authentication/permission issue, not a code problem! 🎉
