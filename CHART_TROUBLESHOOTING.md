# Chart Troubleshooting Guide

## Issue: Bar Chart Not Showing

### Quick Fixes I've Applied:

1. **Fixed width calculation** - Changed from `width - 60` to `width - 80` for better margins
2. **Removed yAxisLabel** - Sometimes causes rendering issues with large values
3. **Added data safety checks** - Ensures data is properly formatted
4. **Adjusted bar percentage** - Better spacing for readability
5. **Disabled showValuesOnTopOfBars** - Can cause overlap with large numbers

### Test Your Charts

I've created a dedicated test screen at `mobile/app/chart-test.tsx`

**To access it:**

1. Navigate to `/chart-test` in your app
2. Or import it in your index screen temporarily

```tsx
// In your app/index.tsx or any screen
import ChartTestScreen from "./chart-test";

// Use it:
<ChartTestScreen />;
```

### Common Issues & Solutions

#### 1. Chart Not Rendering At All

**Possible Causes:**

- Missing data
- Window dimensions not ready
- React Native Chart Kit not properly installed

**Solutions:**

```bash
# Reinstall dependencies
cd mobile
npm install react-native-chart-kit react-native-svg
npx expo start -c
```

#### 2. Chart Shows But Bars Are Missing

**Check:**

- Data values are numbers, not strings
- Data array has at least one value
- Values are not all zeros

**Debug Code:**

```tsx
// Add before rendering chart
console.log("Chart Data:", chartData);
console.log("Data length:", data.length);
console.log(
  "Values:",
  data.map((item) => item.total_sales)
);
```

#### 3. Chart Is Cut Off Or Too Small

**Fix width calculation:**

```tsx
import { Dimensions } from 'react-native';
const { width } = Dimensions.get("window");

// In BarChart
width={width - 80}  // Adjust padding as needed
```

#### 4. Labels Overlapping

**Reduce label count or rotate:**

```tsx
// For long labels, use shorter versions
labels: data.map(item => item.territory.substring(0, 3))

// Or in chartConfig:
propsForLabels: {
  fontSize: 9,  // Smaller font
}
```

### Verify Installation

Check that these packages are installed:

```bash
cd mobile
npm list react-native-chart-kit
npm list react-native-svg
```

Expected output:

```
react-native-chart-kit@6.12.0
react-native-svg@15.12.1
```

### Alternative: Custom Bar Chart

If `react-native-chart-kit` continues to have issues, here's a simple custom solution:

```tsx
// Simple custom bars
<View style={{ flexDirection: "row", height: 200, alignItems: "flex-end" }}>
  {data.map((item, index) => (
    <View key={index} style={{ flex: 1, alignItems: "center" }}>
      <View
        style={{
          width: 40,
          height: (item.total_sales / maxSales) * 180,
          backgroundColor: "#667eea",
          borderRadius: 8,
        }}
      />
      <Text style={{ fontSize: 10, marginTop: 4 }}>{item.territory}</Text>
    </View>
  ))}
</View>
```

### Debug Checklist

- [ ] Data is being passed to component correctly
- [ ] Data values are numbers (not strings)
- [ ] Component is imported correctly
- [ ] No console errors in terminal
- [ ] Chart container has proper height
- [ ] `react-native-svg` is installed
- [ ] App restarted after code changes

### Still Not Working?

1. **Clear cache and restart:**

```bash
npx expo start -c
```

2. **Check terminal for errors:**
   Look for red error messages

3. **Try the test screen:**
   Navigate to `/chart-test` to see if charts work in isolation

4. **Simplify the component:**
   Start with minimal props:

```tsx
<TerritoryBarChart
  data={[{ territory: "Test", total_sales: 1000, invoice_count: 10 }]}
/>
```

### Working Example

Here's a minimal working example:

```tsx
import React from "react";
import { View } from "react-native";
import { TerritoryBarChart } from "../src/components/TerritoryBarChart";

export default function TestScreen() {
  return (
    <View style={{ flex: 1, padding: 20, backgroundColor: "#fff" }}>
      <TerritoryBarChart
        data={[
          { territory: "A", total_sales: 100000, invoice_count: 50 },
          { territory: "B", total_sales: 200000, invoice_count: 75 },
          { territory: "C", total_sales: 150000, invoice_count: 60 },
        ]}
      />
    </View>
  );
}
```

### Contact Info

If charts still don't show after trying these fixes:

1. Check the Expo Metro bundler terminal output for errors
2. Look for any warnings in the Expo Go app
3. Try on a different device/simulator

The charts have been updated with fixes. Try accessing `/chart-test` screen to verify!
