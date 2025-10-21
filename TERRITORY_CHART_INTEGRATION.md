# Territory Bar Chart - Integration Guide

## ✨ Quick Start

### Option 1: Standalone Usage (Demo)

The easiest way to see the chart is to use the demo component:

```tsx
import { TerritoryBarChartDemo } from "../../src/components/TerritoryBarChartDemo";

// In your render:
<TerritoryBarChartDemo />;
```

### Option 2: With Your API Data

```tsx
import { TerritoryBarChart } from "../../src/components/TerritoryBarChart";

// In your component:
const apiResponse = {
  message: {
    message: {
      columns: ["territory", "total_sales", "invoice_count"],
      rows: [
        {
          territory: "Riyadh",
          total_sales: 1051722.0,
          invoice_count: 111,
        },
        {
          territory: "Jeddah",
          total_sales: 763110.28,
          invoice_count: 124,
        },
        {
          territory: "Dammam",
          total_sales: 97642.0,
          invoice_count: 21,
        },
      ],
    },
  },
};

const territoryData = apiResponse.message.message.rows;

// In your render:
<TerritoryBarChart data={territoryData} title="Territory Performance" />;
```

### Option 3: Add to Sales Dashboard

Add this to your `sales-dashboard.tsx` after line 343 (before the closing ScrollView):

```tsx
{
  /* Territory Performance Chart */
}
<View style={styles.chartContainer}>
  <TerritoryBarChart
    data={[
      {
        territory: "Riyadh",
        total_sales: 1051722.0,
        invoice_count: 111,
      },
      {
        territory: "Jeddah",
        total_sales: 763110.28,
        invoice_count: 124,
      },
      {
        territory: "Dammam",
        total_sales: 97642.0,
        invoice_count: 21,
      },
    ]}
    title="Territory Performance"
  />
</View>;
```

Don't forget to import at the top:

```tsx
import { TerritoryBarChart } from "../../src/components/TerritoryBarChart";
```

## 🎨 Features

1. **Toggle View** - Switch between Sales and Invoices visualization
2. **Beautiful Bar Chart** - Powered by `react-native-chart-kit`
3. **Detailed Cards** - Territory breakdown with metrics
4. **Summary Footer** - Total sales, invoices, and averages
5. **Smart Formatting** - Currency formatted with K/M suffixes

## 📊 Data Format

The component expects data in this format:

```typescript
interface TerritoryData {
  territory: string; // e.g., "Riyadh"
  total_sales: number; // e.g., 1051722.0
  invoice_count: number; // e.g., 111
}
```

## 🔧 Customization

You can customize the component by:

1. Changing the title prop
2. Modifying colors in the `getColorForIndex` function
3. Adjusting chart height in the BarChart config
4. Customizing the styling in the StyleSheet

## 📱 Screenshots

The chart includes:

- **Header** with toggle for Sales/Invoices
- **Bar Chart** showing comparative data
- **Territory Cards** with detailed metrics
- **Summary Footer** with aggregated totals
