# ERPNext Mobile App

A beautiful React Native mobile application for ERPNext with Analytics Dashboard, Employee Management, and Approval Workflows.

## ✨ Features

- 🔐 **Secure Authentication** - Token-based auth with secure storage
- 📊 **Analytics Dashboard** - Real-time KPIs with beautiful visualizations
- 👥 **Employee Profiles** - Browse and view employee information
- ✅ **Approvals** - Manage pending approvals on the go
- 📱 **Cross-Platform** - Works on both iOS and Android
- 🌙 **Beautiful UI** - Modern, gradient-based design
- 🔄 **Pull to Refresh** - Easy data updates
- 💾 **Smart Caching** - Offline-first with React Query

## 🚀 Quick Start

### Prerequisites

1. **Install Node.js** (v20 or higher)

   - Download from: https://nodejs.org/
   - Verify: `node --version` and `npm --version`

2. **Install Expo Go on your phone**
   - **Android**: Download from Google Play Store
   - **iOS**: Download from App Store

### Installation

```bash
# Navigate to project directory
cd mobile

# Install dependencies
npm install

# Start the development server
npm start
```

### Running on Your Phone

1. After running `npm start`, a QR code will appear
2. **Android**: Open Expo Go app and scan the QR code
3. **iOS**: Open Camera app and scan the QR code (opens Expo Go)
4. The app will load on your phone!

### Login Credentials

For demo/testing:

- **Username**: Administrator
- **Password**: admin (or your ERPNext admin password)

## 🔧 Configuration

Edit `src/config/env.ts` to set your ERPNext server URL:

```typescript
return {
  ERP_BASE_URL: "https://your-erpnext-instance.com",
  BUILD_VARIANT: "dev",
};
```

### Mock Data Mode

To test without ERPNext connection, enable mock data in `src/api/mock.ts`:

```typescript
export const USE_MOCK_DATA = true;
```

## 📁 Project Structure

```
mobile/
├── app/                    # Expo Router pages
│   ├── (auth)/            # Authentication screens
│   │   └── login.tsx      # Login screen
│   ├── (tabs)/            # Main app tabs
│   │   ├── index.tsx      # Dashboard
│   │   ├── approvals.tsx  # Approvals list
│   │   ├── employees.tsx  # Employee list
│   │   └── settings.tsx   # Settings
│   └── _layout.tsx        # Root layout
│
├── src/
│   ├── api/               # API layer
│   │   ├── auth.ts        # Authentication
│   │   ├── erp.ts         # ERPNext API client
│   │   ├── http.ts        # HTTP client
│   │   ├── schemas.ts     # Zod schemas
│   │   ├── storage.ts     # Secure storage
│   │   └── mock.ts        # Mock data
│   │
│   ├── components/        # Reusable UI components
│   │   ├── KpiCard.tsx
│   │   ├── SalesChart.tsx
│   │   └── LoadingScreen.tsx
│   │
│   ├── hooks/             # React Query hooks
│   │   ├── useKpis.ts
│   │   ├── useEmployees.ts
│   │   └── useApprovals.ts
│   │
│   ├── store/             # Zustand stores
│   │   └── auth.ts
│   │
│   └── config/            # Configuration
│       └── env.ts
│
└── package.json
```

## 🎨 Screenshots

The app features:

- **Gradient-based KPI cards** with delta indicators
- **Interactive line charts** for sales trends
- **Pull-to-refresh** on all screens
- **Empty states** and error handling
- **Smooth animations** and transitions

## 🛠️ Development

### Available Commands

```bash
npm start          # Start Expo development server
npm run android    # Run on Android emulator
npm run ios        # Run on iOS simulator
npm run web        # Run in web browser
```

### Development Tips

1. **Instant Updates**: Save any file and see changes immediately on your phone (Fast Refresh)
2. **Shake Device**: Open developer menu
3. **Debug**: Enable remote debugging from developer menu
4. **Same Network**: Ensure phone and computer are on same WiFi

### Testing with Mock Data

Set `USE_MOCK_DATA = true` in `src/api/mock.ts` to test without backend:

- Pre-populated KPIs and charts
- Sample employees
- Mock approval items

## 🔌 ERPNext Backend Setup

### Required ERPNext Endpoints

The app expects these endpoints on your ERPNext instance:

1. **Authentication**

   - `POST /api/method/login`
   - Token-based auth with API Key/Secret

2. **KPIs** (Custom endpoint to create)

   - `POST /api/method/printechs.mobile.kpis.sales_summary`

3. **Approvals** (Custom endpoint to create)

   - `POST /api/method/printechs.mobile.approvals.inbox`
   - `POST /api/method/printechs.mobile.approvals.apply`

4. **Employees**
   - `GET /api/resource/Employee`
   - `GET /api/resource/Employee/{name}`

### CORS Configuration

Add your development IP to ERPNext CORS settings:

```
# In site_config.json
"allow_cors": "*",
"cors_allow_credentials": true
```

## 📦 Building for Production

### Android APK

```bash
npm install -g eas-cli
eas build --platform android
```

### iOS App

```bash
eas build --platform ios
```

## 🔒 Security

- ✅ Passwords stored in secure keychain (iOS) / KeyStore (Android)
- ✅ HTTPS-only communication
- ✅ Token-based authentication
- ✅ No sensitive data in logs
- ✅ Input validation with Zod schemas

## 📚 Technologies Used

- **React Native** - Cross-platform mobile framework
- **Expo** - Development platform and build tools
- **Expo Router** - File-based navigation
- **TypeScript** - Type safety
- **Zustand** - Lightweight state management
- **React Query** - Server state management
- **Zod** - Schema validation
- **Axios** - HTTP client
- **React Native SVG Charts** - Data visualization
- **Expo Linear Gradient** - Beautiful gradients
- **Expo Secure Store** - Encrypted storage

## 🤝 Support

For issues or questions:

1. Check ERPNext connection and credentials
2. Verify CORS settings on server
3. Enable mock data mode to test UI
4. Check console logs in Expo

## 📄 License

Proprietary - Printechs © 2025

---

**Built with ❤️ using React Native & Expo**
