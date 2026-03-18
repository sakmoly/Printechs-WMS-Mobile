# Building APK - Step by Step Guide

## ✅ Fixed Issues:
1. ✅ Updated Gradle from 8.10.2 to 8.13
2. ✅ Created `local.properties` with Android SDK location

## 📋 Next Steps to Build APK:

### Option 1: Build in Android Studio (Recommended)

1. **Open Android Studio**
   - File → Open → Select `d:\Development Project\Printechs Mobile\mobile\android`

2. **Wait for Gradle Sync**
   - Android Studio will automatically sync Gradle
   - Wait until sync completes (check bottom bar)

3. **Build APK**
   - Build → Build Bundle(s) / APK(s) → Build APK(s)
   - Or: Build → Make Project (Ctrl+F9)

4. **Find APK**
   - After build completes, click notification "locate" button
   - Or navigate to: `android/app/build/outputs/apk/debug/app-debug.apk`

---

### Option 2: Build via Command Line

**Before building, ensure dependencies are installed:**

```bash
cd "d:\Development Project\Printechs Mobile\mobile"
npm install
# OR
yarn install
```

**Then build:**

```bash
cd android
.\gradlew.bat assembleDebug
```

**APK Location:**
- Debug: `android/app/build/outputs/apk/debug/app-debug.apk`
- Release: `android/app/build/outputs/apk/release/app-release.apk` (if configured)

---

## 🔧 Current Issue:

The build is failing because React Native native modules aren't properly linked. This is usually resolved by:

1. **Installing dependencies:**
   ```bash
   cd "d:\Development Project\Printechs Mobile\mobile"
   npm install
   ```

2. **Cleaning build:**
   ```bash
   cd android
   .\gradlew.bat clean
   ```

3. **Rebuilding in Android Studio:**
   - Android Studio handles autolinking better than command line
   - Open project in Android Studio → Build → Build APK(s)

---

## 📝 Files Updated:

1. **`gradle-wrapper.properties`** - Updated to Gradle 8.13
2. **`local.properties`** - Created with SDK location: `C:/Users/sakee/AppData/Local/Android/Sdk`
3. **`build.gradle`** - Added release signing configuration
4. **`gradle.properties`** - Added release signing properties (placeholder values)

---

## ⚠️ Important Notes:

- **Debug APK**: Can be built without keystore (uses debug keystore)
- **Release APK**: Requires keystore configuration (see `gradle.properties` for setup)

If build still fails, try building in **Android Studio** - it handles React Native autolinking better than command line.
