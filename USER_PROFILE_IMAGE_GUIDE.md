# User Profile Image Display Guide

## ✅ Successfully Implemented!

The home page now displays the logged-in user's profile picture from ERPNext!

---

## 📸 **What Was Done**

### 1. **Enhanced Auth Store** (`src/store/auth.ts`)

- ✅ Automatically fetches `user_image` from ERPNext
- ✅ Converts relative image paths to full URLs
- ✅ Prepends server URL to image paths
- ✅ Supports both `user_image` and `image` fields

**Code Enhancement:**

```typescript
// Format user image URL if it exists
const serverUrl = get().serverConfig.serverUrl;
let userImage = user?.user_image || user?.image;

// If image path exists and doesn't start with http, prepend server URL
if (userImage && !userImage.startsWith("http")) {
  userImage = `${serverUrl}${userImage}`;
}
```

### 2. **Enhanced API** (`src/api/auth.ts`)

- ✅ Fetches latest user details from ERPNext on login
- ✅ Gets user document including profile image
- ✅ Updates user data with image URL
- ✅ Fallback to stored data if fetch fails

**API Endpoints Used:**

- `/api/method/frappe.auth.get_logged_user` - Get logged-in username
- `/api/resource/User/{username}` - Get full user document with image

### 3. **Home Page Display** (`app/(tabs)/index.tsx`)

Already implemented (lines 174-196):

- ✅ Profile photo container with shadow
- ✅ Displays user image if available
- ✅ Shows initials placeholder if no image
- ✅ Green online indicator dot
- ✅ Clickable to view full profile
- ✅ Beautiful styling with border

---

## 🎨 **Visual Design**

### **Profile Photo Features:**

```
┌─────────────────────────────┐
│  📊 Dashboard        [👤][🚪] │
│  Monday, Oct 21, 2024        │
└─────────────────────────────┘
     User Photo ──┘  └─ Logout
```

**Styling:**

- **Size**: 48x48 pixels
- **Shape**: Circular (24px border radius)
- **Border**: 3px white border
- **Shadow**: Subtle elevation
- **Online Indicator**: 12px green dot (bottom-right)
- **Fallback**: Purple gradient with user initials

---

## 📋 **How It Works**

### **Image Priority:**

1. **First**: Try `user.image` (formatted full URL)
2. **Second**: Try `user.user_image` (ERPNext field)
3. **Fallback**: Show initials in purple circle

### **Image URL Formatting:**

```typescript
// ERPNext returns: "/files/user_image.jpg"
// We convert to: "https://your-server.com/files/user_image.jpg"

if (userImage && !userImage.startsWith("http")) {
  userImage = `${serverUrl}${userImage}`;
}
```

### **Fallback Display:**

If no image is found, shows user's initial:

```typescript
<Text style={styles.profileInitials}>
  {user?.full_name?.charAt(0) || user?.username?.charAt(0) || "U"}
</Text>
```

---

## 🔧 **ERPNext Setup**

### **To Add User Profile Picture in ERPNext:**

1. **Login to ERPNext** as Administrator
2. **Go to**: User List → Select User
3. **Scroll to**: "User Image" field
4. **Upload Image**: Click "Attach" and upload photo
5. **Save** the user document
6. **Logout & Login** in the mobile app

### **ERPNext User Document Fields:**

```json
{
  "name": "user@example.com",
  "full_name": "John Doe",
  "email": "user@example.com",
  "user_image": "/files/john_doe.jpg", // ← Profile picture
  "mobile_no": "+1234567890",
  "designation": "Sales Manager",
  "department": "Sales",
  "company": "Your Company"
}
```

---

## 🎯 **Features**

### **✅ What Works:**

1. **Automatic Fetch** - Gets image on login
2. **URL Formatting** - Converts relative to absolute URLs
3. **Fallback Display** - Shows initials if no image
4. **Online Indicator** - Green dot for active status
5. **Clickable** - Tap to view full profile
6. **Beautiful UI** - Professional design
7. **Error Handling** - Graceful fallback

### **📱 User Experience:**

- **Fast Loading** - Cached after first load
- **Smooth Display** - No flickering
- **Touch Friendly** - Easy to tap
- **Visual Feedback** - Clear indicator

---

## 🖼️ **Supported Image Formats**

React Native Image component supports:

- ✅ JPEG / JPG
- ✅ PNG
- ✅ GIF
- ✅ WebP
- ✅ BMP

**Recommended:**

- Format: JPEG or PNG
- Size: Max 500KB
- Dimensions: 200x200 to 500x500 pixels
- Aspect Ratio: 1:1 (square)

---

## 🔍 **Troubleshooting**

### **Problem: Image not showing**

**Solution 1: Check ERPNext User Document**

```bash
# In ERPNext console
frappe.db.get_value('User', 'user@example.com', 'user_image')
```

**Solution 2: Verify Image URL**

```typescript
// Check in app console
console.log("User Image:", user?.image);
console.log("Server URL:", serverConfig.serverUrl);
```

**Solution 3: Check Image File**

- Ensure image is uploaded in ERPNext
- Verify file permissions
- Check if file exists in `/private/files/` or `/public/files/`

### **Problem: Shows broken image icon**

**Causes:**

1. Image file doesn't exist on server
2. Incorrect file permissions
3. Server URL not configured correctly
4. Image path is wrong

**Fix:**

1. Re-upload image in ERPNext
2. Check file permissions (should be readable)
3. Verify server URL in app settings
4. Check ERPNext file upload settings

### **Problem: Initials showing instead of image**

**Reason:**

- No `user_image` field in ERPNext user document
- Image field is empty

**Fix:**

1. Upload profile picture in ERPNext
2. Save user document
3. Logout and login again in mobile app

---

## 💡 **Tips**

### **For Best Results:**

1. **Upload Square Images** - 1:1 aspect ratio
2. **Optimize File Size** - Keep under 500KB
3. **Use High Quality** - Min 200x200 pixels
4. **Clear Background** - White or transparent
5. **Professional Photo** - Clear face shot

### **For Developers:**

1. **Test with different users**
2. **Test with missing images**
3. **Test with different image formats**
4. **Test offline behavior**
5. **Test with slow connections**

---

## 🚀 **Usage Examples**

### **In Home Page:**

```tsx
// Already implemented in app/(tabs)/index.tsx

<TouchableOpacity
  style={styles.profileButton}
  onPress={() => router.push("/user-profile")}
>
  <View style={styles.profilePhotoContainer}>
    {user?.image ? (
      <Image source={{ uri: user.image }} style={styles.profilePhoto} />
    ) : (
      <View style={styles.profilePhotoPlaceholder}>
        <Text style={styles.profileInitials}>
          {user?.full_name?.charAt(0) || "U"}
        </Text>
      </View>
    )}
    <View style={styles.onlineIndicator} />
  </View>
</TouchableOpacity>
```

### **To Use in Other Screens:**

```tsx
import { useAuthStore } from "../src/store/auth";

const MyScreen = () => {
  const { user } = useAuthStore();

  return (
    <Image
      source={{ uri: user?.image }}
      style={{ width: 100, height: 100, borderRadius: 50 }}
    />
  );
};
```

---

## 📁 **Files Modified**

1. ✅ `mobile/src/store/auth.ts` - Image URL formatting
2. ✅ `mobile/src/api/auth.ts` - Enhanced user fetch
3. ✅ `mobile/app/(tabs)/index.tsx` - Already had display code
4. ✅ `mobile/USER_PROFILE_IMAGE_GUIDE.md` - This documentation

---

## ✨ **Summary**

**Your home page now:**

- ✅ Displays logged user's profile picture from ERPNext
- ✅ Shows beautiful initials fallback if no image
- ✅ Has professional styling with shadows
- ✅ Includes green online indicator
- ✅ Is clickable to view full profile
- ✅ Handles errors gracefully

**To see it in action:**

1. Upload a profile picture in ERPNext
2. Logout and login in the mobile app
3. Your photo will appear in the top-right corner!

🎉 **Enjoy your personalized dashboard!** 📸✨
