@echo off
echo 🚀 Starting ERPNext Mobile App...
echo.
echo 📱 Make sure you have:
echo    - Node.js installed
echo    - Expo Go app on your phone
echo    - Phone and computer on same WiFi
echo.
echo 🔄 Starting Expo development server...
echo.

cd /d "%~dp0"
npx expo start

echo.
echo ✅ Expo server started!
echo 📱 Scan the QR code with Expo Go app
echo.
pause
