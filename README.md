# Printechs WMS Mobile - Inbound Application

A React Native mobile application for warehouse inbound operations, built with offline-first architecture and barcode scanning capabilities.

## Features

- ✅ **Offline-First Design**: All operations work offline with automatic sync when online
- ✅ **Barcode Scanning**: Hardware scanner support with manual input fallback
- ✅ **Complete Inbound Workflow**: Unload → Receive + Sort → Packing → Dispatch
- ✅ **Demo Mode**: Full functionality with mock data for testing
- ✅ **SQLite Database**: Local caching for fast performance
- ✅ **Event Queue**: Reliable event tracking with sync center

## Tech Stack

- React Native (Expo)
- TypeScript
- SQLite (expo-sqlite)
- React Navigation
- Expo Camera (for barcode scanning)

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the development server:**
   ```bash
   npm start
   ```

3. **Run on device/emulator:**
   - Press `a` for Android
   - Press `i` for iOS
   - Scan QR code with Expo Go app

## Setup

### First Launch

1. **Login/Setup Screen:**
   - Enable **Demo Mode** for testing without backend
   - Or configure:
     - API URL (e.g., `https://api.example.com`)
     - Device ID (e.g., `DEVICE-001`)
     - User ID (e.g., `USER-001`)

### Demo Mode

When Demo Mode is enabled:
- Pre-loaded with mock data (ASN-00045, cartons, items, boxes)
- All API calls are simulated
- Perfect for testing the complete workflow

## Demo Data

### ASN
- **ASN Number**: `ASN-00045`
- **Transfer Order**: `TO-00012`

### Supplier Cartons
- `CTN-001`
- `CTN-002`
- `CTN-003`
- `CTN-004`

### Items (with Barcodes)
| Item Code | Barcode | Name |
|-----------|---------|------|
| ITEM-0001 | 100000000001 | Product 1 |
| ITEM-0002 | 100000000002 | Product 2 |
| ITEM-0003 | 100000000003 | Product 3 |
| ITEM-0004 | 100000000004 | Product 4 |
| ITEM-0005 | 100000000005 | Product 5 |
| ITEM-0006 | 100000000006 | Product 6 |

### Stores
- `SR-01`
- `SR-02`
- `SR-03`

### Pre-created BOXes
- `BOX-SR01-001` (SR-01)
- `BOX-SR02-001` (SR-02)
- `BOX-SR03-001` (SR-03)

## Test Flow

### 1. Start Inbound Session
1. Navigate to **Start Inbound**
2. Scan or enter: `ASN-00045`
3. Enter dock: `DOCK-01`
4. Click **Start Inbound Session**

### 2. Unload Cartons
1. Navigate to **Unload**
2. Scan each supplier carton:
   - `CTN-001`
   - `CTN-002`
   - `CTN-003`
   - `CTN-004`
3. Verify all cartons show "Unloaded" status

### 3. Receive + Sort
1. Navigate to **Receive + Sort**
2. **Step 1**: Scan a carton (e.g., `CTN-001`)
3. **Step 2**: Scan items from the carton:
   - Scan barcode: `100000000001` (ITEM-0001)
   - Scan barcode: `100000000002` (ITEM-0002)
4. **Step 3**: For each item, scan destination BOX:
   - `BOX-SR01-001` (for SR-01 items)
   - `BOX-SR02-001` (for SR-02 items)
   - `BOX-SR03-001` (for SR-03 items)
5. Click **Finish Carton** when done
6. Repeat for other cartons

### 4. BOX Management
1. Navigate to **BOX Management**
2. Select store (SR-01, SR-02, or SR-03)
3. Click **Create BOX** to create new boxes
4. Close boxes when ready for packing

### 5. Packing
1. Navigate to **Packing**
2. Select store
3. Click **Create Transfer Carton**
4. Scan closed BOXes to pack into TC
5. Click **Seal Transfer Carton** when done

### 6. Dispatch
1. Navigate to **Dispatch**
2. Scan sealed Transfer Carton barcode
3. TC is dispatched automatically

### 7. Sync Center
1. Navigate to **Sync Center**
2. View all unsynced events
3. Click **Sync Now** to push events to backend
4. Events are automatically synced when online

## Barcode Scanning

### Hardware Scanner (PDT)
- **Keyboard Input**: Most hardware scanners send data as keyboard input - automatically handled
- **Android Intents**: Supports scanner intents for Android PDT devices
- **Auto-Submit**: Scanner input automatically submits on Enter/Return key
- Works with USB/Bluetooth barcode scanners
- No special configuration needed for most devices

### Camera Scanner
- Uses device camera for barcode scanning
- Supports: EAN-13, EAN-8, UPC, Code 128, Code 39
- Requires camera permissions

### Manual Input
- Always available as fallback
- Type barcode directly in input field
- Press Enter or Submit button

## Database Schema

The app uses SQLite with the following tables:

- `settings` - App configuration
- `asn_cache` - ASN data cache
- `asn_carton_map` - Carton to item mapping
- `transfer_order_cache` - Transfer order allocations
- `box_cache` - BOX data
- `tc_cache` - Transfer Carton data
- `carton_status_cache` - Carton status tracking
- `event_queue` - Offline event queue

## API Integration

### Control APIs
- `POST /api/inbound/start` - Start inbound session
- `POST /api/carton/lock` - Lock carton for receiving
- `POST /api/carton/complete` - Complete carton receiving

### Event API
- `POST /api/events/batch` - Batch sync events

### PULL APIs
- `GET /api/asn/{asn_no}` - Get ASN data
- `GET /api/transfer-order/by-asn/{asn_no}` - Get Transfer Order by ASN
- `GET /api/boxes?asn=...&store=...` - Get BOXes
- `GET /api/transfer-cartons?asn=...&store=...` - Get Transfer Cartons

### BOX/TC APIs
- `POST /api/boxes/create` - Create BOX
- `POST /api/boxes/close` - Close BOX
- `POST /api/boxes/reopen` - Reopen BOX
- `POST /api/transfer-cartons/create` - Create Transfer Carton
- `POST /api/transfer-cartons/seal` - Seal Transfer Carton
- `POST /api/transfer-cartons/dispatch` - Dispatch Transfer Carton

## Offline-First Architecture

1. **All scans create events immediately** in `event_queue`
2. **Events are queued** if offline (`synced = 0`)
3. **Automatic sync** when online
4. **Manual sync** via Sync Center
5. **Idempotent sync** using `offline_uuid`

## Project Structure

```
├── App.tsx                 # Main app entry
├── src/
│   ├── components/         # Reusable components
│   │   ├── BarcodeScanner.tsx
│   │   └── StatusBadge.tsx
│   ├── context/           # React context
│   │   └── AppContext.tsx
│   ├── database/          # Database layer
│   │   ├── database.ts
│   │   ├── schema.ts
│   │   └── seeder.ts
│   ├── screens/           # App screens
│   │   ├── LoginScreen.tsx
│   │   ├── HomeScreen.tsx
│   │   ├── StartInboundScreen.tsx
│   │   ├── UnloadScreen.tsx
│   │   ├── ReceiveSortScreen.tsx
│   │   ├── BoxManagementScreen.tsx
│   │   ├── PackingScreen.tsx
│   │   ├── DispatchScreen.tsx
│   │   └── SyncCenterScreen.tsx
│   ├── services/          # Business logic
│   │   ├── api.service.ts
│   │   ├── data.service.ts
│   │   ├── event-queue.service.ts
│   │   ├── item-master.service.ts
│   │   └── settings.service.ts
│   ├── types/             # TypeScript types
│   │   └── index.ts
│   └── utils/             # Utilities
│       ├── barcode.ts
│       └── scanner-intent.ts
└── README.md
```

## Troubleshooting

### Camera Permission Issues
- Grant camera permission in device settings
- Use manual input as fallback

### Database Errors
- Clear app data and restart
- Database is auto-created on first launch

### Sync Issues
- Check API URL configuration
- Verify network connectivity
- Check Sync Center for error messages

## Development Notes

- **Demo Mode**: All API calls are simulated
- **Offline Queue**: Events persist until synced
- **Carton Locking**: Only one user can receive a carton at a time
- **Status Tracking**: Real-time status updates in UI

## License

Proprietary - Printechs WMS

