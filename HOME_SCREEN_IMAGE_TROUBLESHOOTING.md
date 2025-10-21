# Home Screen Profile Image Troubleshooting

## 🔍 Issue: Profile image shows in profile screen but not on home screen

### ✅ **What I've Fixed:**

1. **Enhanced Image Detection** - Now checks both `user.image` AND `user.user_image`
2. **Added Debug Logging** - Console logs to see what's happening
3. **Added Error Handlers** - Logs any image loading errors
4. **Added ResizeMode** - Ensures proper image fitting

---

## 🛠️ **Changes Made to Home Screen**

### **File: `app/(tabs)/index.tsx`**

#### **1. Enhanced Image Check:**

```typescript
// Before:
{user?.image ? (

// After:
{user?.image || user?.user_image ? (
  <Image
    source={{ uri: user.image || user.user_image }}
```

#### **2. Added Debug Logging:**

```typescript
useEffect(() => {
  if (user) {
    console.log("=== User Image Debug ===");
    console.log("user.image:", user.image);
    console.log("user.user_image:", user.user_image);
    console.log("user object keys:", Object.keys(user));
  }
}, [user]);
```

#### **3. Added Image Error Handling:**

```typescript
<Image
  source={{ uri: user.image || user.user_image }}
  style={styles.profilePhoto}
  resizeMode="cover"
  onError={(error) => {
    console.log("Image load error:", error);
    console.log("Image URI:", user.image || user.user_image);
  }}
  onLoad={() => {
    console.log("Image loaded successfully:", user.image || user.user_image);
  }}
/>
```

---

## 🔎 **How to Debug**

### **Step 1: Check Console Logs**

After logging in, open your Expo dev tools console and look for:

```
=== User Image Debug ===
user.image: https://your-server.com/files/user_photo.jpg
user.user_image: /files/user_photo.jpg
user object keys: ['username', 'full_name', 'email', 'image', 'user_image', ...]
```

### **Step 2: Check Image Loading**

You should see one of these:

- ✅ `Image loaded successfully: https://...` - Image is working!
- ❌ `Image load error: ...` - There's an issue with the image URL

### **Step 3: Common Issues & Solutions**

#### **Issue 1: Image URL is relative (doesn't start with http)**

**Console shows:**

```
user.image: /files/photo.jpg
```

**Solution:**
The auth store should automatically convert this. Check if the server URL is set correctly:

```typescript
// In Settings screen, verify server URL is configured
console.log("Server URL:", serverConfig.serverUrl);
```

#### **Issue 2: Image URL is undefined or null**

**Console shows:**

```
user.image: undefined
user.user_image: undefined
```

**Solution:**

1. Check if user has an image uploaded in ERPNext
2. Re-login to fetch latest user data
3. Check ERPNext user document:
   ```bash
   # In ERPNext console
   frappe.db.get_value('User', 'your@email.com', 'user_image')
   ```

#### **Issue 3: Image exists but shows broken icon**

**Console shows:**

```
Image load error: [Error details]
```

**Solutions:**

1. **Check CORS**: ERPNext might be blocking image requests
   - Add your mobile app to ERPNext CORS allowed origins
2. **Check File Permissions**: Image file might not be publicly accessible
   - In ERPNext, go to File List
   - Find your image file
   - Check "Is Public" checkbox
3. **Check Authentication**: Image might require authentication

   - ERPNext cookies should handle this automatically
   - Try logging out and back in

4. **Check URL Format**:

   ```typescript
   // Should be:
   https://your-server.com/files/photo.jpg

   // NOT:
   /files/photo.jpg (missing domain)
   your-server.com/files/photo.jpg (missing https://)
   ```

---

## 🔧 **Manual Testing Steps**

### **Test 1: Verify User Object**

Add this temporarily to see the full user object:

```typescript
useEffect(() => {
  console.log("Full user object:", JSON.stringify(user, null, 2));
}, [user]);
```

### **Test 2: Test Image URL Directly**

Copy the image URL from console and open it in a browser:

```
https://your-server.com/files/user_photo.jpg
```

If it doesn't load in browser, the issue is with:

- File permissions
- File doesn't exist
- Server configuration

### **Test 3: Force Re-fetch User Data**

```typescript
// In your code, trigger user data refresh
const { checkAuth } = useAuthStore();
await checkAuth();
```

---

## 📝 **Expected Console Output (Success)**

When everything works correctly, you should see:

```
=== User Image Debug ===
user.image: https://erp.example.com/files/john_doe.jpg
user.user_image: https://erp.example.com/files/john_doe.jpg
user object keys: ['username', 'full_name', 'email', 'mobile_no', 'image', 'user_image', ...]

Image loaded successfully: https://erp.example.com/files/john_doe.jpg
```

---

## 🎯 **Quick Fixes**

### **Fix 1: Clear App Cache**

```bash
# In terminal
cd mobile
npx expo start -c
```

### **Fix 2: Force Logout and Re-login**

1. Tap logout button
2. Clear app data (if on physical device)
3. Login again

### **Fix 3: Check ERPNext File Settings**

In ERPNext:

1. Go to **File List**
2. Find your user image file
3. Click on it
4. Enable **"Is Public"** checkbox
5. Save

### **Fix 4: Verify Server URL in App**

1. Go to Settings tab in app
2. Check Server URL is correct:
   - Should include `https://` or `http://`
   - Should NOT have trailing slash
   - Example: `https://erp.example.com`

---

## 🚀 **Test After Changes**

1. **Save all files**
2. **Reload the app** (shake device → Reload)
3. **Check console** for debug logs
4. **Check if image appears** in top-right corner
5. **If still not showing**: Follow troubleshooting steps above

---

## 📞 **Still Not Working?**

Share these details for further help:

1. **Console logs** - Copy the "User Image Debug" output
2. **Image URL** - What does `user.image` show?
3. **Server URL** - What is your ERPNext server URL?
4. **ERPNext Version** - Which version are you running?
5. **App Platform** - iOS or Android?
6. **Error Messages** - Any errors in console?

---

## ✅ **Success Checklist**

- [ ] Image URL starts with `http://` or `https://`
- [ ] Image URL includes server domain
- [ ] Image file exists in ERPNext
- [ ] Image file is marked as "Public" in ERPNext
- [ ] Server URL is configured in app settings
- [ ] User has logged in after configuring server
- [ ] Console shows "Image loaded successfully"
- [ ] Image appears in profile screen
- [ ] Image appears in home screen top-right

---

## 🎉 **Expected Result**

After applying these fixes, you should see:

```
┌─────────────────────────────────┐
│  📊 Dashboard            [👤][🚪] │
│                          ↑         │
│                    Your Photo!    │
│  Monday, October 21, 2024        │
└─────────────────────────────────┘
```

With a beautiful circular profile photo in the top-right corner! 🎨✨
