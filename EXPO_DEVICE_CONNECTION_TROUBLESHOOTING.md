# Expo Device Connection Troubleshooting Guide

This guide helps you resolve issues when Expo cannot connect to your device.

## Quick Diagnosis

First, identify the issue:
- **"Unable to connect"** or **"Connection timeout"** → Network/Firewall issue
- **QR code not scanning** → Camera permissions or network issue
- **"Metro bundler not found"** → Metro not running or port blocked
- **"Tunnel connection failed"** → Internet/VPN issue

---

## Solution 1: Check Network Connection (Most Common)

### Ensure Same Network
1. **Computer and device must be on the same WiFi network**
   - Check WiFi name on both devices
   - Avoid guest networks (they often block device-to-device communication)
   - Avoid corporate networks with client isolation

2. **Verify IP addresses:**
   ```bash
   # On Windows (PowerShell)
   ipconfig
   
   # Look for your WiFi adapter's IPv4 address (e.g., 192.168.1.100)
   ```

3. **Test connectivity from device:**
   - Open browser on your phone
   - Navigate to: `http://YOUR_COMPUTER_IP:8081`
   - If you see Expo DevTools, network is working
   - If not, continue to firewall solutions

---

## Solution 2: Configure Firewall (Windows)

Windows Firewall often blocks Expo's connection.

### Option A: Allow Expo Through Firewall (Recommended)

1. **Open Windows Defender Firewall:**
   - Press `Win + R`, type `wf.msc`, press Enter

2. **Create Inbound Rule:**
   - Click "Inbound Rules" → "New Rule"
   - Select "Port" → Next
   - Select "TCP" and enter port `8081` → Next
   - Select "Allow the connection" → Next
   - Check all profiles (Domain, Private, Public) → Next
   - Name it "Expo Metro Bundler" → Finish

3. **Repeat for Outbound Rules** (same steps)

### Option B: Temporarily Disable Firewall (Testing Only)
```powershell
# Run PowerShell as Administrator
Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False
```
**⚠️ Re-enable after testing!**

---

## Solution 3: Use Tunnel Mode

If same-network connection fails, use Expo's tunnel:

```bash
npx expo start --tunnel
```

**Pros:**
- Works across different networks
- Works through VPNs
- Works on public WiFi

**Cons:**
- Slower than LAN connection
- Requires internet connection
- May have connection delays

---

## Solution 4: Use LAN Mode with Manual IP

Force Expo to use a specific IP address:

```bash
# Replace with your computer's IP address
npx expo start --lan --host tunnel
```

Or set environment variable:
```powershell
# PowerShell
$env:EXPO_DEVTOOLS_LISTEN_ADDRESS = "0.0.0.0"
npx expo start --lan
```

---

## Solution 5: Use USB Connection (Android Only)

For Android devices, you can use USB debugging:

### Step 1: Enable USB Debugging
1. On Android device: Settings → About Phone
2. Tap "Build Number" 7 times to enable Developer Options
3. Go to Settings → Developer Options
4. Enable "USB Debugging"

### Step 2: Connect via USB
```bash
# Connect device via USB
# Verify connection
adb devices

# Start Expo with USB connection
npx expo start --android
```

### Step 3: Use ADB Reverse (Alternative)
```bash
# Forward port from device to computer
adb reverse tcp:8081 tcp:8081

# Then start Expo normally
npx expo start
```

---

## Solution 6: Check Port Conflicts

Port 8081 might be in use by another process:

```powershell
# Check if port 8081 is in use
netstat -ano | findstr :8081

# If port is in use, kill the process (replace PID with actual process ID)
taskkill /PID <PID> /F
```

Or use a different port:
```bash
npx expo start --port 8082
```

---

## Solution 7: VPN/Proxy Issues

### If Using VPN:
1. **Disconnect VPN temporarily** to test
2. **Or use tunnel mode:** `npx expo start --tunnel`
3. **Or configure VPN to allow local network access**

### If Behind Corporate Proxy:
```bash
# Set proxy environment variables
$env:HTTP_PROXY = "http://proxy.company.com:8080"
$env:HTTPS_PROXY = "http://proxy.company.com:8080"
npx expo start --tunnel
```

---

## Solution 8: Clear Cache and Restart

Sometimes cached network settings cause issues:

```bash
# Stop Metro bundler (Ctrl+C)
# Clear all caches
npx expo start --clear

# Or full reset
rm -rf .expo
rm -rf node_modules/.cache
npx expo start --clear
```

---

## Solution 9: Update Expo Go App

Ensure Expo Go app is up to date:

1. **Android:** Google Play Store → Update Expo Go
2. **iOS:** App Store → Update Expo Go
3. **Verify SDK version matches:** Should be SDK 54

---

## Solution 10: Use Development Build (Alternative)

If Expo Go continues to fail, use a development build:

```bash
# Install dev client (already installed in your project)
npx expo install expo-dev-client

# Build and run on device
npx expo run:android
```

This creates a custom build with your native modules and doesn't require Expo Go.

---

## Solution 11: Manual Connection via URL

If QR code doesn't work, manually enter URL:

1. **Get your computer's IP address:**
   ```powershell
   ipconfig
   # Look for IPv4 Address under your WiFi adapter
   ```

2. **In Expo Go app:**
   - Tap "Enter URL manually"
   - Enter: `exp://YOUR_IP:8081`
   - Example: `exp://192.168.1.100:8081`

---

## Solution 12: Network Interface Selection

If you have multiple network adapters, specify which to use:

```bash
# List available network interfaces
ipconfig /all

# Start Expo with specific host
npx expo start --host YOUR_IP_ADDRESS
```

---

## Testing Connection

After applying a solution, test the connection:

1. **Start Expo:**
   ```bash
   npx expo start
   ```

2. **Check the output:**
   - Should show QR code
   - Should show "Metro waiting on..."
   - Should show LAN URL (e.g., `exp://192.168.1.100:8081`)

3. **Test in browser:**
   - Open `http://YOUR_IP:8081` on your device's browser
   - Should see Expo DevTools page

4. **Connect via Expo Go:**
   - Scan QR code, or
   - Enter URL manually

---

## Common Error Messages

### "Unable to connect to Metro bundler"
- **Cause:** Network/firewall blocking
- **Fix:** Use Solution 2 (Firewall) or Solution 3 (Tunnel)

### "Tunnel connection failed"
- **Cause:** Internet/VPN issue
- **Fix:** Check internet connection, disable VPN, or use LAN mode

### "Network request failed"
- **Cause:** Device can't reach Metro bundler
- **Fix:** Verify same network, check firewall, use tunnel mode

### "Connection timeout"
- **Cause:** Firewall blocking or wrong IP
- **Fix:** Configure firewall, verify IP address, use tunnel

---

## Recommended Workflow

1. **First try:** `npx expo start` (automatic LAN detection)
2. **If fails:** Configure firewall (Solution 2)
3. **If still fails:** Use tunnel mode (Solution 3)
4. **For Android:** Try USB connection (Solution 5)
5. **Last resort:** Use development build (Solution 10)

---

## Quick Command Reference

```bash
# Standard start (auto-detect network)
npx expo start

# Tunnel mode (works across networks)
npx expo start --tunnel

# LAN mode (same network only)
npx expo start --lan

# Clear cache and start
npx expo start --clear

# Use specific port
npx expo start --port 8082

# Android via USB
npx expo start --android
```

---

## Still Not Working?

1. **Check Expo CLI version:**
   ```bash
   npx expo --version
   # Should be compatible with Expo SDK 54
   ```

2. **Check device logs:**
   ```bash
   # Android
   adb logcat | grep -i expo
   
   # iOS (if using simulator)
   # Check Xcode console
   ```

3. **Try on different device/network:**
   - Test on another phone
   - Test on different WiFi network
   - Test on mobile hotspot

4. **Check Expo status:**
   - Visit: https://status.expo.dev
   - Check for service outages

---

## Additional Resources

- [Expo Connection Troubleshooting](https://docs.expo.dev/workflow/connection-issues/)
- [Expo CLI Commands](https://docs.expo.dev/more/expo-cli/)
- [Development Builds](https://docs.expo.dev/development/introduction/)

