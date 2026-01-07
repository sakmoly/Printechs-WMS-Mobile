# Material Request Workflow Guide - Stock Transfer to Showroom

## 📋 Overview

This guide explains how to use the Material Request feature in the mobile app to transfer stock from warehouse to showroom.

## 🚀 Getting Started

### Step 1: Launch the App

1. **Start the development server:**
   ```bash
   npm start
   ```

2. **Open the app on your device/emulator:**
   - Scan QR code with Expo Go (physical device)
   - Press `a` for Android emulator
   - Press `i` for iOS simulator

3. **Login/Setup:**
   - If using Demo Mode: Enable it in Settings
   - If using Backend: Enter API URL, User Code, and Password

### Step 2: Navigate to Material Requests

1. From the **Home Screen**, tap on **"Material Request"** menu item
2. This opens the **Material Request List Screen**

## 📦 Material Request Workflow

### Phase 1: View Material Requests

**Screen: Material Request List**

1. **View Available Material Requests:**
   - The screen shows all Material Requests with their status
   - Status badges: Draft, Submitted, In Progress, Picked, Dispatched, Completed

2. **Filter by Status (if needed):**
   - Material Requests are automatically loaded from backend
   - If backend is unavailable, cached data is shown

3. **Select a Material Request:**
   - Tap on any Material Request card to view details
   - This opens the **Material Request Detail Screen**

### Phase 2: Review Material Request Details

**Screen: Material Request Detail**

1. **View Request Information:**
   - **Title**: Material Request number (e.g., MR-0001)
   - **From Warehouse**: Source warehouse (e.g., WH-MAIN)
   - **To Showroom**: Destination showroom (e.g., SHOWROOM-001)
   - **Request Date**: When the request was created
   - **Required Date**: When items are needed
   - **Requested By**: User who created the request

2. **Review Items:**
   - See list of items with:
     - **Item Code**: SKU code
     - **Requested Qty**: Quantity requested
     - **Picked Qty**: Quantity already picked
     - **Remaining Qty**: Quantity still needed
   - Progress bars show completion status

3. **Check Status:**
   - Only **"Submitted"** or **"In Progress"** Material Requests can be picked
   - Other statuses will show a message if you try to start picking

4. **Start Picking:**
   - Tap **"Start Picking"** button (if status is Submitted or In Progress)
   - This navigates to **Material Request Packing Screen**

### Phase 3: Packing Process

**Screen: Material Request Packing**

#### Step 1: Create Transfer Carton

1. **Review Material Request Info:**
   - Confirm From Warehouse and To Showroom
   - Check total items and quantities

2. **Create Transfer Carton:**
   - If no Transfer Carton exists, tap **"Create Transfer Carton"**
   - A Transfer Carton ID is generated (e.g., `TC-MR-0001-1234567890`)
   - Transfer Carton is created with:
     - `asn_no`: null (Material Requests don't have ASN)
     - `to_no`: null (Material Requests don't have Transfer Order)
     - `store`: Destination showroom
     - `material_request`: Material Request title

3. **Transfer Carton Status:**
   - Status shows as **"Open"** (ready for packing)
   - Once created, you can start packing boxes

#### Step 2: Pack Boxes to Transfer Carton

1. **View Available Boxes:**
   - The screen shows closed boxes from the **source warehouse** (from_warehouse)
   - Only boxes with status **"Closed"** are available for packing
   - Boxes are filtered by the Material Request's source warehouse

2. **Pack a Box:**
   - Tap on any available box card
   - The box is immediately packed to the Transfer Carton
   - A **PACK_BOX_TO_TC** event is created and queued for sync
   - The box shows as **"Packed"** with a green badge

3. **Pack Multiple Boxes:**
   - Continue tapping boxes to pack them
   - All packed boxes are listed in the "Packed Boxes" section
   - You can pack as many boxes as needed

4. **View Packed Boxes:**
   - The "Packed Boxes" section shows all boxes packed to this Transfer Carton
   - Each box ID is displayed

#### Step 3: Seal Transfer Carton

1. **Verify Packing:**
   - Ensure at least one box is packed
   - Review the packed boxes list

2. **Seal Transfer Carton:**
   - Tap **"Seal Transfer Carton"** button
   - The Transfer Carton status changes to **"Sealed"**
   - Material Request status is automatically updated to **"Picked"**

3. **Completion:**
   - A success message confirms the Transfer Carton is sealed
   - The Material Request is marked as "Picked"
   - You can return to the Material Request List

### Phase 4: Dispatch (Optional - Future Enhancement)

After sealing, the Transfer Carton can be:
- Dispatched to the showroom
- Tracked during transit
- Received at the showroom

## 🔄 Complete Workflow Summary

```
1. Home Screen
   ↓
2. Material Request List
   ↓ (Tap on Material Request)
3. Material Request Detail
   ↓ (Tap "Start Picking")
4. Material Request Packing
   ↓
   a. Create Transfer Carton
   ↓
   b. Pack Boxes to Transfer Carton
   ↓
   c. Seal Transfer Carton
   ↓
5. Material Request Status: "Picked"
```

## 📱 Screen Navigation

### From Home Screen:
- Tap **"Material Request"** → Opens Material Request List

### From Material Request List:
- Tap on any Material Request card → Opens Material Request Detail

### From Material Request Detail:
- Tap **"Start Picking"** → Opens Material Request Packing
- Tap **Back** → Returns to Material Request List

### From Material Request Packing:
- Tap **Back** → Returns to Material Request Detail
- After sealing, you can navigate back to see updated status

## ⚠️ Important Notes

### Prerequisites:
1. **Backend Setup:**
   - Material Request table must exist in backend database
   - If table doesn't exist, app will show cached data or empty state

2. **Boxes Must Be Closed:**
   - Only closed boxes can be packed to Transfer Carton
   - Boxes must be from the source warehouse (from_warehouse)

3. **Material Request Status:**
   - Only "Submitted" or "In Progress" status can be picked
   - Other statuses will show an error message

### Offline Support:
- All operations work offline
- Events are queued and synced when online
- Cached Material Requests are available offline

### Event Queue:
- Packing operations create **PACK_BOX_TO_TC** events
- Events are automatically synced to backend
- Check Sync Center to view sync status

## 🐛 Troubleshooting

### Issue: "No Material Requests found"
- **Cause**: Backend database table not set up or no data
- **Solution**: 
  - Check backend database setup
  - Verify Material Request table exists
  - Check if Material Requests are created in backend system

### Issue: "Cannot Start Picking" - Status error
- **Cause**: Material Request status is not "Submitted" or "In Progress"
- **Solution**: 
  - Material Request must be in correct status
  - Contact administrator to update status

### Issue: "No closed boxes available"
- **Cause**: No closed boxes exist in source warehouse
- **Solution**: 
  - Ensure boxes are created and closed in Box Management
  - Verify boxes are from the correct warehouse (from_warehouse)

### Issue: Backend 500 Error
- **Cause**: Backend database error (table missing or schema mismatch)
- **Solution**: 
  - App automatically falls back to cached data
  - Contact backend team to set up Material Request table
  - App will work with cached data until backend is fixed

## 📊 Status Flow

```
Draft → Submitted → In Progress → Picked → Dispatched → Completed
                                    ↑
                          (After sealing Transfer Carton)
```

## 🔍 Key Features

1. **Offline-First**: Works without internet connection
2. **Auto-Sync**: Events automatically sync when online
3. **Cache Fallback**: Uses cached data if backend unavailable
4. **Event Queue**: Reliable event tracking with sync center
5. **Status Tracking**: Real-time status updates

## 📞 Support

For issues or questions:
1. Check Sync Center for event sync status
2. Review backend logs for database errors
3. Verify Material Request table exists in backend
4. Contact backend team for database setup

---

**Last Updated**: 2026-01-03

