# Quick Start Guide

## First Time Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start Expo:**
   ```bash
   npm start
   ```

3. **Run on device:**
   - Scan QR code with Expo Go app (iOS/Android)
   - Or press `a` for Android emulator / `i` for iOS simulator

## Demo Mode Testing

1. **Enable Demo Mode:**
   - On first launch, toggle "Demo Mode" ON
   - Click "Save & Continue"

2. **Start Inbound:**
   - Go to "Start Inbound"
   - Enter: `ASN-00045`
   - Dock: `DOCK-01`
   - Click "Start Inbound Session"

3. **Unload Cartons:**
   - Go to "Unload"
   - Scan/enter: `CTN-001`, `CTN-002`, `CTN-003`, `CTN-004`

4. **Receive + Sort:**
   - Go to "Receive + Sort"
   - Scan carton: `CTN-001`
   - Scan item: `100000000001` (ITEM-0001)
   - Scan BOX: `BOX-SR01-001`
   - Repeat for other items
   - Click "Finish Carton"

5. **Packing:**
   - Go to "Packing"
   - Select store: `SR-01`
   - Click "Create Transfer Carton"
   - Scan BOX: `BOX-SR01-001`
   - Click "Seal Transfer Carton"

6. **Dispatch:**
   - Go to "Dispatch"
   - Scan the TC barcode shown after sealing

## Demo Barcodes Reference

### ASN
- `ASN-00045`

### Cartons
- `CTN-001`
- `CTN-002`
- `CTN-003`
- `CTN-004`

### Items (use barcode)
- `100000000001` → ITEM-0001
- `100000000002` → ITEM-0002
- `100000000003` → ITEM-0003
- `100000000004` → ITEM-0004
- `100000000005` → ITEM-0005
- `100000000006` → ITEM-0006

### BOXes
- `BOX-SR01-001`
- `BOX-SR02-001`
- `BOX-SR03-001`

## Hardware Scanner Support

Hardware barcode scanners (USB/Bluetooth) work automatically:
- Scanner input appears as keyboard input
- Just scan into the barcode input field
- No special configuration needed

## Troubleshooting

**Camera not working?**
- Use manual input (always available)
- Grant camera permissions in device settings

**Database errors?**
- Clear app data and restart
- Database auto-creates on first launch

**Sync issues?**
- Check "Sync Center" for errors
- Events queue automatically when offline

