/**
 * Automated Screen Capture Script for React Native/Expo App
 * 
 * This script automates screenshot capture for your app screens.
 * 
 * Usage:
 *   1. Start your app: npm start (in one terminal)
 *   2. Run this script: node capture-screens.js (in another terminal)
 * 
 * Requirements:
 *   - App must be running on emulator/device
 *   - For Android: adb must be in PATH
 *   - For iOS: xcrun simctl must be available (Mac only)
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
const SCREENS_TO_CAPTURE = [
  { name: 'login', route: '/login', waitTime: 2000 },
  { name: 'home', route: '/', waitTime: 2000 },
  { name: 'dashboard', route: '/sales-dashboard', waitTime: 3000 },
  { name: 'settings', route: '/settings', waitTime: 2000 },
  { name: 'employees', route: '/employees', waitTime: 2000 },
  { name: 'approvals', route: '/approvals', waitTime: 2000 },
];

// Platform detection
const platform = process.platform;
const isWindows = platform === 'win32';
const isMac = platform === 'darwin';
const isLinux = platform === 'linux';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Create screenshots directory
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  log(`✅ Created screenshots directory: ${SCREENSHOTS_DIR}`, 'green');
}

/**
 * Get ADB path (checks common locations)
 */
function getAdbPath() {
  const possiblePaths = [
    'adb', // In PATH
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    'C:\\Users\\sakee\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe', // Your specific path
  ];
  
  for (const adbPath of possiblePaths) {
    try {
      execSync(`"${adbPath}" version`, { stdio: 'ignore' });
      return adbPath;
    } catch (error) {
      continue;
    }
  }
  return null;
}

/**
 * Check if ADB is available (for Android)
 */
function checkAdbAvailable() {
  return getAdbPath() !== null;
}

/**
 * Check if iOS simulator tools are available (Mac only)
 */
function checkIosSimAvailable() {
  if (!isMac) return false;
  try {
    execSync('xcrun simctl list devices', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get connected Android devices
 */
function getAndroidDevices() {
  const adbPath = getAdbPath();
  if (!adbPath) return [];
  
  try {
    const output = execSync(`"${adbPath}" devices`, { encoding: 'utf-8' });
    const lines = output.split('\n').filter(line => line.trim() && !line.includes('List'));
    const devices = lines
      .filter(line => line.includes('\tdevice'))
      .map(line => line.split('\t')[0]);
    return devices;
  } catch (error) {
    return [];
  }
}

/**
 * Get iOS simulators (Mac only)
 */
function getIosSimulators() {
  if (!isMac) return [];
  try {
    const output = execSync('xcrun simctl list devices available', { encoding: 'utf-8' });
    // Parse simulator list (simplified)
    return ['iPhone 15', 'iPhone 15 Pro']; // Default simulators
  } catch (error) {
    return [];
  }
}

/**
 * Capture screenshot on Android using ADB
 */
function captureAndroidScreenshot(deviceId, filename) {
  const adbPath = getAdbPath();
  if (!adbPath) {
    log(`   ❌ ADB not found`, 'red');
    return false;
  }
  
  try {
    const filepath = path.join(SCREENSHOTS_DIR, filename);
    const deviceFlag = deviceId ? `-s ${deviceId}` : '';
    
    // Use ADB screencap and save to file
    const tempFile = path.join(SCREENSHOTS_DIR, `temp_${Date.now()}.raw`);
    execSync(`"${adbPath}" ${deviceFlag} shell screencap -p > "${tempFile}"`, { stdio: 'ignore' });
    
    // Move/rename to final location
    if (fs.existsSync(tempFile)) {
      fs.renameSync(tempFile, filepath);
      log(`   ✅ Captured: ${filename}`, 'green');
      return true;
    }
    return false;
  } catch (error) {
    log(`   ❌ Failed to capture: ${error.message}`, 'red');
    return false;
  }
}

/**
 * Capture screenshot on iOS simulator (Mac only)
 */
function captureIosScreenshot(deviceName, filename) {
  if (!isMac) {
    log('   ⚠️  iOS screenshots only available on macOS', 'yellow');
    return false;
  }
  
  try {
    const filepath = path.join(SCREENSHOTS_DIR, filename);
    // Get booted simulator
    const bootedOutput = execSync('xcrun simctl list devices booted', { encoding: 'utf-8' });
    const bootedMatch = bootedOutput.match(/\(([A-F0-9-]+)\)/);
    
    if (!bootedMatch) {
      log('   ⚠️  No booted iOS simulator found', 'yellow');
      return false;
    }
    
    const deviceId = bootedMatch[1];
    execSync(`xcrun simctl io ${deviceId} screenshot "${filepath}"`, { stdio: 'ignore' });
    
    if (fs.existsSync(filepath)) {
      log(`   ✅ Captured: ${filename}`, 'green');
      return true;
    }
    return false;
  } catch (error) {
    log(`   ❌ Failed to capture: ${error.message}`, 'red');
    return false;
  }
}

/**
 * Navigate to a screen using deep linking (Expo)
 */
function navigateToScreen(route) {
  try {
    // Use Expo deep linking to navigate
    const deepLink = `exp://localhost:8081${route}`;
    log(`   🔗 Navigating to: ${route}`, 'cyan');
    
    // Try to open deep link
    if (isWindows) {
      execSync(`start ${deepLink}`, { stdio: 'ignore' });
    } else if (isMac) {
      execSync(`open ${deepLink}`, { stdio: 'ignore' });
    } else {
      execSync(`xdg-open ${deepLink}`, { stdio: 'ignore' });
    }
    
    return true;
  } catch (error) {
    // Deep linking might not work, that's okay - user can navigate manually
    log(`   ⚠️  Auto-navigation failed, please navigate manually to: ${route}`, 'yellow');
    return false;
  }
}

/**
 * Wait for specified time
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main capture function
 */
async function captureScreenshots() {
  log('\n📸 Automated Screen Capture Script', 'blue');
  log('===================================\n', 'blue');
  
  // Detect platform capabilities
  const adbAvailable = checkAdbAvailable();
  const iosSimAvailable = checkIosSimAvailable();
  
  log('🔍 Detecting capabilities...', 'cyan');
  log(`   Android (ADB): ${adbAvailable ? '✅ Available' : '❌ Not available'}`, adbAvailable ? 'green' : 'red');
  log(`   iOS Simulator: ${iosSimAvailable ? '✅ Available' : '❌ Not available'}`, iosSimAvailable ? 'green' : 'red');
  
  if (!adbAvailable && !iosSimAvailable) {
    log('\n❌ No screenshot capture tools available!', 'red');
    log('   Please install:', 'yellow');
    log('   - Android: Android SDK Platform Tools (adb)', 'yellow');
    log('   - iOS: Xcode Command Line Tools (Mac only)', 'yellow');
    log('\n💡 Alternative: Use manual screenshots or Expo screenshots tool\n', 'cyan');
    return;
  }
  
  // Detect devices
  let deviceType = null;
  let deviceId = null;
  
  if (adbAvailable) {
    const androidDevices = getAndroidDevices();
    if (androidDevices.length > 0) {
      deviceType = 'android';
      deviceId = androidDevices[0];
      log(`\n📱 Found Android device: ${deviceId}`, 'green');
    }
  }
  
  if (!deviceType && iosSimAvailable) {
    const iosSims = getIosSimulators();
    if (iosSims.length > 0) {
      deviceType = 'ios';
      log(`\n📱 Using iOS Simulator`, 'green');
    }
  }
  
  if (!deviceType) {
    log('\n⚠️  No device/simulator detected!', 'yellow');
    log('   Please:', 'yellow');
    log('   - Connect an Android device and enable USB debugging', 'yellow');
    log('   - Or start an iOS simulator (Mac only)', 'yellow');
    log('   - Or use manual screenshot mode\n', 'yellow');
    
    // Offer manual mode
    log('📋 Manual Screenshot Mode', 'cyan');
    log('   Please navigate to each screen manually and press Enter to capture:\n', 'cyan');
    
    for (const screen of SCREENS_TO_CAPTURE) {
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      await new Promise(resolve => {
        readline.question(`Navigate to ${screen.route} and press Enter to capture... `, () => {
          readline.close();
          const filename = `${screen.name}-${Date.now()}.png`;
          if (adbAvailable) {
            captureAndroidScreenshot(null, filename);
          } else if (iosSimAvailable) {
            captureIosScreenshot(null, filename);
          }
          resolve();
        });
      });
    }
    
    return;
  }
  
  // Automated capture
  log(`\n🚀 Starting automated capture for ${deviceType.toUpperCase()}...\n`, 'green');
  
  let successCount = 0;
  let failCount = 0;
  
  for (const screen of SCREENS_TO_CAPTURE) {
    log(`📸 Capturing: ${screen.name}`, 'blue');
    
    // Navigate to screen
    navigateToScreen(screen.route);
    
    // Wait for screen to load
    log(`   ⏳ Waiting ${screen.waitTime}ms for screen to load...`, 'yellow');
    await wait(screen.waitTime);
    
    // Capture screenshot
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${screen.name}-${timestamp}.png`;
    
    let captured = false;
    if (deviceType === 'android') {
      captured = captureAndroidScreenshot(deviceId, filename);
    } else if (deviceType === 'ios') {
      captured = captureIosScreenshot(null, filename);
    }
    
    if (captured) {
      successCount++;
    } else {
      failCount++;
    }
    
    // Small delay between captures
    await wait(1000);
  }
  
  // Summary
  log('\n📊 Capture Summary', 'blue');
  log('==================', 'blue');
  log(`   ✅ Successful: ${successCount}`, 'green');
  log(`   ❌ Failed: ${failCount}`, failCount > 0 ? 'red' : 'green');
  log(`   📁 Location: ${SCREENSHOTS_DIR}\n`, 'cyan');
  
  if (successCount > 0) {
    log('✨ Screenshots saved successfully!\n', 'green');
  }
}

// Run the script
if (require.main === module) {
  captureScreenshots().catch(error => {
    log(`\n❌ Error: ${error.message}`, 'red');
    process.exit(1);
  });
}

module.exports = { captureScreenshots, SCREENSHOTS_DIR };
