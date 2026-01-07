# Troubleshooting Guide

## TurboModuleRegistry Error

If you encounter "TurboModuleRegistry" or "runtime not ready" errors:

### Solution 1: Clear All Caches
```bash
# Stop the Metro bundler (Ctrl+C)
# Then run:
npm start -- --clear

# Or manually clear:
rm -rf node_modules
npm install
npx expo start --clear
```

### Solution 2: Reinstall Dependencies
```bash
rm -rf node_modules
rm package-lock.json
npm install
npx expo start --clear
```

### Solution 3: Reset Expo Cache
```bash
npx expo start --clear
# Or
expo start -c
```

### Solution 4: Check Expo Go Version
- Make sure you're using the latest Expo Go app (SDK 54)
- Update Expo Go from App Store / Play Store
- Uninstall and reinstall Expo Go if needed

### Solution 5: Use Development Build (if issues persist)
If Expo Go continues to have issues, consider creating a development build:
```bash
npx expo install expo-dev-client
npx expo prebuild
```

## Common Issues

### Metro Bundler Issues
- Clear cache: `npx expo start --clear`
- Restart Metro bundler
- Check for port conflicts (default: 8081)

### Native Module Errors
- Ensure all dependencies are compatible with SDK 54
- Check that `react-native-gesture-handler` is imported first in App.tsx
- Verify `react-native-reanimated` plugin is last in babel.config.js

### Database Errors
- Database initializes on first app launch
- If errors persist, clear app data and restart

### Import Errors
- All imports should use full paths (e.g., `../database/database`)
- Check TypeScript paths in tsconfig.json

## Still Having Issues?

1. Check Expo SDK compatibility: https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/
2. Review Expo logs: `npx expo start --clear`
3. Check React Native version compatibility
4. Ensure all peer dependencies are installed

