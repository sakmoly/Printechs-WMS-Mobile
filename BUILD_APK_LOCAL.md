# Build APK Locally with Android Studio

Step-by-step guide to build an APK file on your local PC using Android Studio.

## Prerequisites Checklist

- ✅ Android Studio installed
- ✅ Android SDK installed (API level 33 or higher)
- ✅ Java JDK 11 or 17 installed
- ✅ Node.js and npm installed

---

## Step 1: Install Expo Dev Client

First, install the Expo dev client package:

```bash
npx expo install expo-dev-client
```

---

## Step 2: Prebuild Native Android Code

Generate the native Android project files:

```bash
npx expo prebuild --platform android
```

This will:
- Create an `android/` folder in your project
- Generate all necessary Android native code
- Set up Gradle build files

**Note:** If you see a prompt about overwriting files, you can choose to overwrite if this is your first time.

---

## Step 3: Open Project in Android Studio

1. **Open Android Studio**
2. **Click "Open"** (or File → Open)
3. **Navigate to your project folder**
4. **Select the `android` folder** (not the root project folder)
5. **Click "OK"**

Android Studio will:
- Sync Gradle files
- Download dependencies
- Index the project (this may take a few minutes)

---

## Step 4: Wait for Gradle Sync

- Android Studio will automatically start syncing Gradle
- Wait for the sync to complete (check bottom status bar)
- If sync fails, click "Sync Now" or "Try Again"

---

## Step 5: Configure Build Variant (Optional)

1. **Click on "Build Variants"** tab (usually at bottom left)
2. **Select "release"** for the app module
   - This ensures you're building a release APK (optimized, signed)

---

## Step 6: Generate Signed APK

### Method A: Using Android Studio GUI

1. **Go to menu:** `Build` → `Generate Signed Bundle / APK`
2. **Select "APK"** (not Android App Bundle)
3. **Click "Next"**

#### If you have a keystore:
- Select "Choose existing"
- Browse to your keystore file
- Enter keystore password
- Enter key alias
- Enter key password
- Click "Next"

#### If you need to create a keystore:
- Select "Create new"
- Fill in the form:
  - **Key store path:** Choose location (e.g., `android/app/my-release-key.keystore`)
  - **Password:** Create a strong password (save it!)
  - **Key alias:** `printechs-key`
  - **Key password:** Same as keystore password (or different)
  - **Validity:** 25 years (default)
  - **Certificate information:**
    - First and Last Name: Your name or company
    - Organizational Unit: Your department
    - Organization: Your company name
    - City: Your city
    - State: Your state
    - Country Code: Your country code (e.g., US, IN)
- Click "OK"
- Click "Next"

4. **Select build variant:** `release`
5. **Check "V1 (Jar Signature)"** and **"V2 (Full APK Signature)"**
6. **Click "Finish"**

### Method B: Using Gradle Command Line

Open terminal in Android Studio (View → Tool Windows → Terminal) or use PowerShell/CMD:

```bash
cd android
./gradlew assembleRelease
```

**On Windows (PowerShell):**
```powershell
cd android
.\gradlew.bat assembleRelease
```

---

## Step 7: Find Your APK

After the build completes:

1. **Navigate to:** `android/app/build/outputs/apk/release/`
2. **Find the file:** `app-release.apk`

This is your installable APK file!

---

## Step 8: Install APK on Device

### Option A: Via USB (ADB)

1. **Enable USB Debugging** on your Android device:
   - Settings → About Phone → Tap "Build Number" 7 times
   - Settings → Developer Options → Enable "USB Debugging"

2. **Connect device via USB**

3. **Install APK:**
   ```bash
   adb install android/app/build/outputs/apk/release/app-release.apk
   ```

### Option B: Transfer and Install Manually

1. **Copy APK** to your Android device (USB, email, cloud storage)
2. **On device:** Open file manager
3. **Tap the APK file**
4. **Allow installation** from unknown sources if prompted
5. **Install** the app

---

## Troubleshooting

### Error: "SDK location not found"

**Solution:**
1. In Android Studio: File → Project Structure → SDK Location
2. Set Android SDK location (usually `C:\Users\YourName\AppData\Local\Android\Sdk`)
3. Or set environment variable:
   ```powershell
   [System.Environment]::SetEnvironmentVariable('ANDROID_HOME', 'C:\Users\YourName\AppData\Local\Android\Sdk', 'User')
   ```

### Error: "Gradle sync failed"

**Solution:**
1. File → Invalidate Caches → Invalidate and Restart
2. Or: Build → Clean Project, then Build → Rebuild Project

### Error: "Java version mismatch"

**Solution:**
1. File → Project Structure → SDK Location
2. Set JDK location (should be Java 11 or 17)
3. Or install Java 17 from [adoptium.net](https://adoptium.net/)

### Error: "Build failed" or "Gradle build failed"

**Solution:**
1. Check the error message in Build output
2. Common fixes:
   ```bash
   cd android
   ./gradlew clean
   ./gradlew assembleRelease
   ```

### APK is too large

**Solution:**
- This is normal for React Native apps (usually 20-50MB)
- For production, consider enabling ProGuard/R8 for code shrinking
- Or use Android App Bundle (AAB) instead of APK

---

## Quick Command Reference

```bash
# 1. Prebuild
npx expo prebuild --platform android

# 2. Build APK (from project root)
cd android
./gradlew assembleRelease

# 3. Install via ADB
adb install app/build/outputs/apk/release/app-release.apk
```

---

## Next Steps

- **Test the APK** on multiple devices
- **Update version** in `app.json` before next build:
  ```json
  {
    "expo": {
      "version": "1.0.1",
      "android": {
        "versionCode": 2
      }
    }
  }
  ```
- **Save your keystore** securely (needed for future updates)
- **Consider setting up CI/CD** for automated builds

---

## Notes

- **First build takes longer** (10-20 minutes) as it downloads dependencies
- **Subsequent builds are faster** (2-5 minutes)
- **Release APK is optimized** and smaller than debug builds
- **Keep your keystore safe** - you'll need it for app updates on Google Play

