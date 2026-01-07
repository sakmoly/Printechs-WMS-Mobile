# Android Deployment Guide

This guide covers all methods to deploy the Printechs WMS Mobile app to Android devices.

## Prerequisites

- Node.js and npm installed
- Expo CLI installed (`npm install -g expo-cli` or use `npx expo`)
- For local builds: Android Studio with Android SDK installed
- For EAS Build: Expo account (free tier available)

---

## Option 1: EAS Build (Recommended - Cloud Build)

EAS Build is Expo's cloud-based build service. No local Android Studio setup required.

### Step 1: Install EAS CLI

```bash
npm install -g eas-cli
```

### Step 2: Login to Expo

```bash
eas login
```

### Step 3: Configure EAS Build

```bash
eas build:configure
```

This will create an `eas.json` file with build profiles.

### Step 4: Build APK (for direct installation)

```bash
# Development build
eas build --platform android --profile development

# Production APK
eas build --platform android --profile production
```

### Step 5: Build AAB (for Google Play Store)

```bash
eas build --platform android --profile production --type app-bundle
```

### Step 6: Download and Install

After the build completes:

1. Download the APK/AAB from the EAS dashboard
2. Transfer to Android device
3. Enable "Install from Unknown Sources" in Android settings
4. Install the APK

---

## Option 2: Local Development Build

Build the app locally using Android Studio.

### Step 1: Install Android Studio

1. Download from [developer.android.com/studio](https://developer.android.com/studio)
2. Install Android SDK (API level 33 or higher recommended)
3. Set up Android Virtual Device (AVD) or connect physical device

### Step 2: Install Expo Dev Client

```bash
npx expo install expo-dev-client
```

### Step 3: Build and Run

```bash
# Build and install on connected device/emulator
npx expo run:android
```

This will:

- Build the native Android app
- Install it on your connected device/emulator
- Start Metro bundler

---

## Option 3: Generate APK Locally (Advanced)

### Step 1: Prebuild Native Code

```bash
npx expo prebuild --platform android
```

### Step 2: Build APK with Gradle

```bash
cd android
./gradlew assembleRelease
```

The APK will be at: `android/app/build/outputs/apk/release/app-release.apk`

---

## Option 4: Expo Go (Development Only)

For quick testing during development (not for production):

```bash
npx expo start
```

Then scan QR code with Expo Go app from Play Store.

**Note:** Expo Go has limitations and may not support all native modules.

---

## Configuration Updates Needed

### 1. Update app.json

The following Android-specific settings should be added:

```json
{
  "expo": {
    "android": {
      "package": "com.printechs.wmsmobile",
      "versionCode": 1,
      "adaptiveIcon": {
        "backgroundColor": "#007AFF"
      },
      "permissions": [
        "CAMERA",
        "READ_EXTERNAL_STORAGE",
        "WRITE_EXTERNAL_STORAGE"
      ]
    }
  }
}
```

### 2. Create eas.json (for EAS Build)

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "android": {
        "buildType": "apk"
      }
    }
  }
}
```

---

## Version Management

### Update Version for New Builds

1. **Update version in app.json:**

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

2. **Version Code Rules:**
   - Must be an integer
   - Must increment for each new build
   - Used by Google Play Store

---

## Signing the APK (Production)

### For EAS Build (Automatic)

EAS handles signing automatically. You'll be prompted to set up credentials:

```bash
eas credentials
```

### For Local Build (Manual)

1. Generate keystore:

   ```bash
   keytool -genkeypair -v -storetype PKCS12 -keystore my-release-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Configure in `android/app/build.gradle`:
   ```gradle
   android {
     signingConfigs {
       release {
         storeFile file('my-release-key.keystore')
         storePassword 'your-password'
         keyAlias 'my-key-alias'
         keyPassword 'your-password'
       }
     }
   }
   ```

---

## Testing the Build

### Install on Device

1. **Via ADB (Android Debug Bridge):**

   ```bash
   adb install app-release.apk
   ```

2. **Via USB:**

   - Transfer APK to device
   - Enable "Install from Unknown Sources"
   - Open APK file to install

3. **Via Google Play Internal Testing:**
   - Upload AAB to Play Console
   - Add testers
   - Share testing link

---

## Troubleshooting

### Expo Cannot Connect to Device

If Expo Go cannot connect to your device, see the comprehensive guide:
**[EXPO_DEVICE_CONNECTION_TROUBLESHOOTING.md](./EXPO_DEVICE_CONNECTION_TROUBLESHOOTING.md)**

**Quick fixes to try first:**

1. **Check same WiFi network:**

   - Computer and device must be on the same WiFi
   - Avoid guest networks or corporate networks with isolation

2. **Configure Windows Firewall:**

   ```powershell
   # Allow port 8081 through firewall (run as Administrator)
   New-NetFirewallRule -DisplayName "Expo Metro Bundler" -Direction Inbound -LocalPort 8081 -Protocol TCP -Action Allow
   ```

3. **Use tunnel mode:**

   ```bash
   npx expo start --tunnel
   ```

4. **For Android USB connection:**
   ```bash
   # Enable USB debugging on device, then:
   adb reverse tcp:8081 tcp:8081
   npx expo start
   ```

### Build Fails

1. **Clear cache:**

   ```bash
   npx expo start --clear
   rm -rf node_modules
   npm install
   ```

2. **Check Android SDK:**

   - Ensure Android SDK is installed
   - Set `ANDROID_HOME` environment variable

3. **Check Java Version:**
   - Android requires Java 11 or 17
   - Verify: `java -version`

### App Crashes on Launch

1. Check device logs:

   ```bash
   adb logcat | grep -i error
   ```

2. Verify all native modules are compatible
3. Check if device meets minimum requirements

### Permission Issues

Ensure all required permissions are in `app.json`:

- Camera (for barcode scanning)
- Storage (for SQLite database)

---

## Quick Start Commands

### EAS Build (Fastest)

```bash
eas build --platform android --profile production
```

### Local Development

```bash
npx expo run:android
```

### Development Testing

```bash
npx expo start
# Then scan QR with Expo Go
```

---

## Next Steps After Deployment

1. **Test on multiple devices**
2. **Set up crash reporting** (e.g., Sentry)
3. **Configure app updates** (OTA updates with EAS Update)
4. **Submit to Google Play Store** (if applicable)

---

## Additional Resources

- [Expo EAS Build Docs](https://docs.expo.dev/build/introduction/)
- [Android App Signing](https://developer.android.com/studio/publish/app-signing)
- [Google Play Console](https://play.google.com/console)
