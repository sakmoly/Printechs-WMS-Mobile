# Cycle Count API Filtering Implementation

This document describes the implementation of optional query parameters for filtering cycle count lines in the GET `/api/cycle-count/:title` endpoint.

## Issue Identified

The API endpoint `GET /api/cycle-count/:title` was returning all lines where `actual_qty IS NOT NULL` for the task, regardless of:
- Which carton they belong to
- Which user scanned them
- When they were scanned

This caused issues when multiple users scan items in the same task, or when items are scanned with different cartons, as the API would return all items while the mobile app might only need items for the current carton/user session.

## Solution Implemented

### Backend Changes (Already Done)

Added optional query parameters to filter the results:
- `carton_id` (optional): Filter lines by carton ID
- `counted_by` (optional): Filter lines by user who counted them

### API Endpoint Examples

```bash
# Get all lines for task (no filter) - Desktop app view
GET /api/cycle-count/CC-A1-R01-L1-B1-MK7GCNKE

# Get only lines for a specific carton - Mobile app view
GET /api/cycle-count/CC-A1-R01-L1-B1-MK7GCNKE?carton_id=CTN-001

# Get only lines counted by a specific user
GET /api/cycle-count/CC-A1-R01-L1-B1-MK7GCNKE?counted_by=USER-001

# Get lines for specific carton AND user
GET /api/cycle-count/CC-A1-R01-L1-B1-MK7GCNKE?carton_id=CTN-001&counted_by=USER-001
```

## Mobile App Changes

### 1. Updated API Service (`src/services/api.service.ts`)

Modified `getCycleCount` method to accept optional filter parameters:

```typescript
getCycleCount: async (
  title: string,
  filters?: {
    carton_id?: string;
    counted_by?: string;
  }
) => {
  const params = new URLSearchParams();
  if (filters?.carton_id) {
    params.append("carton_id", filters.carton_id);
  }
  if (filters?.counted_by) {
    params.append("counted_by", filters.counted_by);
  }
  const queryString = params.toString();
  return makeRequest(
    `/api/cycle-count/${title}${queryString ? `?${queryString}` : ""}`,
    "GET"
  );
}
```

### 2. Updated CycleCountCountingScreen (`src/screens/CycleCountCountingScreen.tsx`)

**Changes**:
- Added support for `cartonId` in route params
- Filters by `carton_id` if provided
- Filters by `counted_by` (current user) if available
- Logs filter usage for debugging

**Implementation**:
```typescript
// Get current user from settings
const settings = await getSettings();
const currentUser = settings.user_id || settings.user_code || null;

// Build filter object
const filters: { carton_id?: string; counted_by?: string } = {};
if (cartonId) {
  filters.carton_id = cartonId;
}
if (currentUser) {
  filters.counted_by = currentUser;
}

// Call API with filters
const response = await apiService.getCycleCount(
  cycleCountTitle,
  Object.keys(filters).length > 0 ? filters : undefined
);
```

**Behavior**:
- If `cartonId` is provided in route params → filters by carton_id
- If current user is available → filters by counted_by
- If both are available → filters by both (AND condition)
- If neither is available → no filter (shows all items)

### 3. Updated CycleCountDetailScreen (`src/screens/CycleCountDetailScreen.tsx`)

**Changes**:
- Added comment explaining that detail screen shows all items (no filter)
- This provides a desktop-like view showing all items for the task
- Filtering can be added in the future if needed

**Implementation**:
```typescript
// Detail screen shows all items (no filters) for desktop-like view
// If filtering is needed, pass filters as second parameter:
// await apiService.getCycleCount(cycleCountTitle, { carton_id: "...", counted_by: "..." });
const response = await apiService.getCycleCount(cycleCountTitle);
```

**Behavior**:
- Shows all items for the task (no filtering)
- Useful for reviewing all counts across all cartons/users
- Can be updated in the future to support optional filtering

## Usage Scenarios

### Scenario 1: Mobile User Counting Items

**User Flow**:
1. User selects a task and optionally provides a carton ID
2. App navigates to `CycleCountCountingScreen` with `cycleCountTitle` and optional `cartonId`
3. Screen loads cycle count data filtering by:
   - `carton_id` (if provided)
   - `counted_by` (current user)
4. User sees only items for their carton/session

**API Call**:
```bash
GET /api/cycle-count/CC-A1-R01-L1-B1-MK7GCNKE?carton_id=CTN-001&counted_by=USER-001
```

### Scenario 2: Mobile User Counting Without Carton ID

**User Flow**:
1. User selects a task (no carton ID)
2. App navigates to `CycleCountCountingScreen` with only `cycleCountTitle`
3. Screen loads cycle count data filtering by:
   - `counted_by` (current user only)
4. User sees only items they counted

**API Call**:
```bash
GET /api/cycle-count/CC-A1-R01-L1-B1-MK7GCNKE?counted_by=USER-001
```

### Scenario 3: Desktop/Detail View

**User Flow**:
1. User views task details
2. App navigates to `CycleCountDetailScreen` with `cycleCountTitle`
3. Screen loads all cycle count data (no filters)
4. User sees all items for the task (all cartons, all users)

**API Call**:
```bash
GET /api/cycle-count/CC-A1-R01-L1-B1-MK7GCNKE
```

## Benefits

1. **Mobile App Isolation**: Each mobile session sees only its own scanned items
2. **Carton-Level Filtering**: Items can be filtered by carton ID when provided
3. **User-Level Filtering**: Items can be filtered by user to prevent data overlap
4. **Flexible Usage**: Filters can be combined or used independently
5. **Desktop Compatibility**: Detail views can show all items without filters
6. **Backward Compatible**: No filters = show all items (existing behavior)

## Testing Checklist

- [x] API service accepts optional filter parameters
- [x] CycleCountCountingScreen filters by user when available
- [x] CycleCountCountingScreen filters by carton_id when provided
- [x] CycleCountCountingScreen combines both filters when both are available
- [x] CycleCountDetailScreen shows all items (no filters)
- [x] No linting errors
- [ ] Test with real API endpoint (requires backend update)
- [ ] Test filtering by carton_id only
- [ ] Test filtering by counted_by only
- [ ] Test filtering by both parameters
- [ ] Test without filters (show all)

## Files Modified

1. **src/services/api.service.ts**
   - Updated `getCycleCount` method to accept optional filters

2. **src/screens/CycleCountCountingScreen.tsx**
   - Added cartonId support from route params
   - Added filtering by carton_id and counted_by
   - Added logging for filter usage

3. **src/screens/CycleCountDetailScreen.tsx**
   - Added comment explaining no filtering (shows all items)

## Next Steps

1. **Test with Backend**: Test the filtering with the updated backend API
2. **Optional Enhancement**: Add filter toggle in detail screen to show filtered vs. all items
3. **Optional Enhancement**: Add filter UI in counting screen to change filters dynamically
4. **Documentation**: Update API documentation to reflect the new query parameters

## Notes

- Filters are optional - if not provided, all items are returned (existing behavior)
- Filters use AND logic when multiple are provided
- User ID is taken from settings (user_id or user_code)
- Carton ID must be passed via route params or state management
- Detail screen intentionally shows all items for comprehensive review
