# Expo Connection Fix Script for Windows
# Run this script to diagnose and fix common Expo connection issues

Write-Host "=== Expo Device Connection Diagnostic ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check IP Address
Write-Host "1. Checking your IP address..." -ForegroundColor Yellow
$ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -like "*Wi-Fi*" -or $_.InterfaceAlias -like "*Ethernet*"} | Select-Object -First 1).IPAddress
if ($ipAddress) {
    Write-Host "   Your IP address: $ipAddress" -ForegroundColor Green
    Write-Host "   Use this in Expo Go: exp://$ipAddress:8081" -ForegroundColor Green
} else {
    Write-Host "   Could not detect IP address" -ForegroundColor Red
}
Write-Host ""

# Step 2: Check if port 8081 is in use
Write-Host "2. Checking if port 8081 is available..." -ForegroundColor Yellow
$portCheck = Get-NetTCPConnection -LocalPort 8081 -ErrorAction SilentlyContinue
if ($portCheck) {
    Write-Host "   Port 8081 is in use by process ID: $($portCheck.OwningProcess)" -ForegroundColor Yellow
    $process = Get-Process -Id $portCheck.OwningProcess -ErrorAction SilentlyContinue
    if ($process) {
        Write-Host "   Process: $($process.ProcessName)" -ForegroundColor Yellow
    }
} else {
    Write-Host "   Port 8081 is available" -ForegroundColor Green
}
Write-Host ""

# Step 3: Check firewall rules
Write-Host "3. Checking Windows Firewall..." -ForegroundColor Yellow
$firewallRule = Get-NetFirewallRule -DisplayName "Expo Metro Bundler" -ErrorAction SilentlyContinue
if ($firewallRule) {
    Write-Host "   Firewall rule exists" -ForegroundColor Green
} else {
    Write-Host "   No firewall rule found for Expo" -ForegroundColor Yellow
    Write-Host "   You may need to allow port 8081 through firewall" -ForegroundColor Yellow
}
Write-Host ""

# Step 4: Provide solutions
Write-Host "=== Recommended Solutions ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Option 1: Configure Firewall (Run as Administrator)" -ForegroundColor Yellow
Write-Host "   New-NetFirewallRule -DisplayName 'Expo Metro Bundler' -Direction Inbound -LocalPort 8081 -Protocol TCP -Action Allow" -ForegroundColor White
Write-Host ""
Write-Host "Option 2: Use Tunnel Mode" -ForegroundColor Yellow
Write-Host "   npx expo start --tunnel" -ForegroundColor White
Write-Host ""
Write-Host "Option 3: Use LAN Mode with Manual IP" -ForegroundColor Yellow
if ($ipAddress) {
    Write-Host "   npx expo start --lan --host $ipAddress" -ForegroundColor White
}
Write-Host ""
Write-Host "Option 4: For Android USB Connection" -ForegroundColor Yellow
Write-Host "   adb reverse tcp:8081 tcp:8081" -ForegroundColor White
Write-Host "   npx expo start" -ForegroundColor White
Write-Host ""
Write-Host "For more detailed troubleshooting, see: EXPO_DEVICE_CONNECTION_TROUBLESHOOTING.md" -ForegroundColor Cyan

