# Automated Screenshot Capture Guide

## ✅ Created Enhanced Script

I've created an automated `capture-screens.js` script that can:
- ✅ Detect Android devices via ADB
- ✅ Detect iOS simulators (Mac only)
- ✅ Automatically capture screenshots
- ✅ Navigate between screens using deep linking
- ✅ Save screenshots with timestamps
- ✅ Provide manual mode if automation isn't available

## 🚀 How to Use

### Prerequisites

1. **For Android:**
   - Install Android SDK Platform Tools
   - Add ADB to PATH, OR
   - Use full path: `C:\Users\sakee\AppData\Local\Android\Sdk\platform-tools\adb.exe`

2. **For iOS (Mac only):**
   - Install Xcode Command Line Tools
   - Start an iOS simulator

### Quick Start

1. **Start your app:**
   ```bash
   npm start
   # Or: expo start
   ```

2. **Run the capture script:**
   ```bash
   npm run screenshots
   # Or: node capture-screens.js
   ```

3. **Screenshots will be saved to:**
   ```
   screenshots/
   ├── login-2026-01-17T10-30-45-123Z.png
   ├── home-2026-01-17T10-30-47-456Z.png
   ├── dashboard-2026-01-17T10-30-50-789Z.png
   └── ...
   ```

## 📋 Configured Screens

The script is pre-configured to capture:
- Login screen (`/login`)
- Home screen (`/`)
- Dashboard (`/sales-dashboard`)
- Settings (`/settings`)
- Employees (`/employees`)
- Approvals (`/approvals`)

You can modify `SCREENS_TO_CAPTURE` in `capture-screens.js` to add/remove screens.

## 🔧 Troubleshooting

### ADB Not Found

**Option 1: Add ADB to PATH**
1. Open System Properties → Environment Variables
2. Add to PATH: `C:\Users\sakee\AppData\Local\Android\Sdk\platform-tools`

**Option 2: Use Full Path in Script**
Edit `capture-screens.js` and replace:
```javascript
execSync('adb version', ...)
```
With:
```javascript
execSync('C:\\Users\\sakee\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe version', ...)
```

### No Device Detected

1. **Android:**
   - Connect device via USB
   - Enable USB Debugging in Developer Options
   - Run: `adb devices` to verify

2. **iOS:**
   - Open Xcode → Window → Devices and Simulators
   - Start a simulator
   - Or use: `xcrun simctl boot <device-id>`

### Manual Mode

If automation doesn't work, the script will offer manual mode:
- Navigate to each screen manually
- Press Enter when ready to capture
- Screenshot will be taken automatically

## 🎯 Alternative Methods

### Method 1: Expo Screenshots (Recommended for Expo)
```bash
npm install -g @expo/screenshots
npx expo screenshots
```

### Method 2: Android Studio
1. Open Android Studio
2. Run app on emulator
3. Tools → Layout Inspector → Screenshot

### Method 3: Manual Screenshots
1. Run app on emulator/device
2. Use emulator screenshot button
3. Or use device screenshot (Power + Volume Down)

## 📝 Script Features

- ✅ Automatic device detection
- ✅ Platform-specific capture (Android/iOS)
- ✅ Deep linking navigation (Expo)
- ✅ Timestamped filenames
- ✅ Progress tracking
- ✅ Error handling
- ✅ Manual fallback mode

## 🔄 Updating Screen List

Edit `capture-screens.js` and modify:
```javascript
const SCREENS_TO_CAPTURE = [
  { name: 'your-screen', route: '/your-route', waitTime: 2000 },
  // Add more screens...
];
```

## 💡 Tips

1. **Wait Times:** Adjust `waitTime` for screens that load slowly
2. **Multiple Devices:** Script uses first detected device
3. **Batch Capture:** Run script multiple times to capture different states
4. **Organization:** Screenshots are saved with timestamps for easy sorting
