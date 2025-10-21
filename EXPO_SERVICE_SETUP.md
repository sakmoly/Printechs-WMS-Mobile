# Expo Development Server - Auto-Start Setup

This guide shows you how to run Expo as a persistent service so you don't need to manually start it every time.

---

## Option 1: Keep Terminal Running (Simplest)

**Recommended for active development**

1. Start Expo once:

   ```powershell
   cd "D:\New folder\Mobile\mobile"
   npx expo start
   ```

2. **Minimize** (don't close) the terminal window
3. Expo will keep running and auto-reload when you save code changes
4. Your app stays connected and updates instantly

**Tip:** Press `Ctrl+C` in the terminal to stop Expo when you're done for the day.

---

## Option 2: Windows Task Scheduler (Auto-start on Boot)

**Best for daily development - starts automatically when Windows boots**

### Setup Steps:

1. **The batch file has been created**: `mobile/start-expo.bat`

2. **Create Scheduled Task**:

   - Press `Win + R`, type `taskschd.msc`, press Enter
   - Click "Create Basic Task..." in the right panel
   - Name: `Expo Development Server`
   - Description: `Auto-start Expo for Mobile app development`
   - Click "Next"

3. **Trigger**:

   - Select "When I log on"
   - Click "Next"

4. **Action**:

   - Select "Start a program"
   - Click "Next"
   - Browse and select: `D:\New folder\Mobile\mobile\start-expo.bat`
   - Click "Next", then "Finish"

5. **Optional - Run in Background**:
   - Right-click the task → Properties
   - Check "Run whether user is logged on or not"
   - Check "Hidden" (under "Configure for: Windows 10")
   - Click OK

**Now Expo will start automatically when you log in to Windows!**

---

## Option 3: Use PM2 (Process Manager)

**Best for production-like development environment**

### Setup:

```powershell
# Install PM2 globally
npm install -g pm2 pm2-windows-startup

# Setup PM2 to start on Windows boot
pm2-startup install

# Navigate to your project
cd "D:\New folder\Mobile\mobile"

# Start Expo with PM2
pm2 start "npx expo start" --name expo-mobile

# Save the process list
pm2 save
```

### PM2 Commands:

```powershell
# View status
pm2 list

# View logs
pm2 logs expo-mobile

# Restart
pm2 restart expo-mobile

# Stop
pm2 stop expo-mobile

# Remove from startup
pm2 delete expo-mobile
pm2 save
```

---

## Option 4: Quick Desktop Shortcut

**Simple one-click start**

1. Right-click on desktop → New → Shortcut
2. Location: `D:\New folder\Mobile\mobile\start-expo.bat`
3. Name: `Start Expo Mobile`
4. Click Finish

Now double-click the shortcut to start Expo instantly!

---

## Recommended Approach

For your workflow, I recommend **Option 1** (keep terminal minimized) because:

- ✅ Simple and reliable
- ✅ Easy to see logs and errors
- ✅ Easy to stop (Ctrl+C)
- ✅ No additional setup needed
- ✅ Perfect for active development

If you want it to **auto-start every morning**, use **Option 2** (Task Scheduler).

---

## Current Status

Your Expo server is currently running at:

- **URL**: `http://localhost:8081`
- **Status**: Active and waiting for connections

**You can already connect your app** - just scan the QR code or press the appropriate key in the terminal!

---

## Troubleshooting

### Port Already in Use

If you see "Port 8081 is being used", kill existing processes:

```powershell
taskkill /f /im node.exe
```

### Can't Find npx

Make sure Node.js is in your PATH:

```powershell
node --version
npm --version
```

### Expo Not Auto-Reloading

1. Check that "Fast Refresh" is enabled in your app
2. Make sure you saved the file (Ctrl+S)
3. Check terminal for any errors

---

## Notes

- The server needs to stay running while you develop
- It will automatically reload your app when you save changes
- You can have multiple devices connected at once
- Press `r` in the terminal to manually reload
- Press `m` to toggle the menu
