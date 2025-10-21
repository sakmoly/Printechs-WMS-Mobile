# Monthly Sales Trend Chart - Integration Guide

## ✨ Features

This component provides a beautiful monthly sales trend visualization with:

- 📊 **Toggle View** - Switch between Line Chart and Bar Chart
- 📈 **Year Comparison** - Current vs Previous Year side-by-side
- 💹 **YoY Growth** - Year over Year growth percentage indicator
- 🏆 **Top Performers** - Shows top 3 performing months
- 📱 **Responsive** - Adapts to any screen size
- 🎨 **Beautiful Design** - Modern UI with smooth animations

## 🚀 Quick Start

### Option 1: Standalone Usage (Demo)

```tsx
import { MonthlySalesTrendDemo } from "../../src/components/MonthlySalesTrendDemo";

// In your render:
<MonthlySalesTrendDemo />;
```

### Option 2: With Your API Data

```tsx
import { MonthlySalesTrend } from "../../src/components/MonthlySalesTrend";

// In your component:
const apiResponse = {
  message: {
    message: {
      labels: [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ],
      current: [
        5471509.21, 3169933.68, 2635202.17, 2012393.0, 2283700.6, 2611126.28,
        2425954.68, 3800397.7, 3140088.65, 1914614.28, 0.0, 0.0,
      ],
      previous: [
        1889958.85, 2026053.67, 2520946.96, 2025778.9, 1475708.85, 1972484.73,
        3396110.41, 2278308.46, 2186873.53, 2811700.02, 2774109.13, 3288207.78,
      ],
    },
  },
};

const { labels, current, previous } = apiResponse.message.message;

// In your render:
<MonthlySalesTrend
  labels={labels}
  current={current}
  previous={previous}
  title="Monthly Sales Trend"
/>;
```

### Option 3: Add to Sales Dashboard

Add this to your `sales-dashboard.tsx` inside the `<ScrollView>` (before the closing tag):

```tsx
{
  /* Monthly Sales Trend Chart */
}
<View style={styles.chartContainer}>
  <MonthlySalesTrend
    labels={[
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]}
    current={[
      5471509.21, 3169933.68, 2635202.17, 2012393.0, 2283700.6, 2611126.28,
      2425954.68, 3800397.7, 3140088.65, 1914614.28, 0.0, 0.0,
    ]}
    previous={[
      1889958.85, 2026053.67, 2520946.96, 2025778.9, 1475708.85, 1972484.73,
      3396110.41, 2278308.46, 2186873.53, 2811700.02, 2774109.13, 3288207.78,
    ]}
    title="Monthly Sales Trend"
  />
</View>;
```

Don't forget to import at the top of `sales-dashboard.tsx`:

```tsx
import { MonthlySalesTrend } from "../../src/components/MonthlySalesTrend";
```

## 📊 Data Format

The component expects data in this format:

```typescript
interface MonthlySalesTrendProps {
  labels: string[]; // e.g., ["Jan", "Feb", "Mar", ...]
  current: number[]; // Current year sales data
  previous: number[]; // Previous year sales data
  title?: string; // Optional chart title
}
```

## 🎨 What You Get

1. **Interactive Chart Toggle**

   - Line Chart for trends
   - Bar Chart for comparisons

2. **Legend**

   - Blue line/bars for Current Year
   - Purple line/bars for Previous Year

3. **Statistics Cards**

   - Current Year total and average
   - Previous Year total and average

4. **Growth Badge**

   - Shows Year over Year growth percentage
   - Green for positive growth
   - Red for negative growth

5. **Top Performing Months**
   - Displays top 3 months by sales
   - Ranked with badges

## 🔧 Customization

You can customize:

1. **Chart Type** - Users can toggle between line and bar charts
2. **Colors** - Modify the color schemes in the component
3. **Title** - Pass custom title via props
4. **Height** - Adjust chart height in the component

## 📱 Example Integration in Sales Dashboard

Here's a complete example of adding it to your existing sales dashboard:

```tsx
// At the top of sales-dashboard.tsx
import { MonthlySalesTrend } from "../../src/components/MonthlySalesTrend";

// Inside your component, after fetching data
const [monthlySalesData, setMonthlySalesData] = useState({
  labels: [],
  current: [],
  previous: [],
});

// In your ScrollView, after the existing cards:
<MonthlySalesTrend
  labels={monthlySalesData.labels}
  current={monthlySalesData.current}
  previous={monthlySalesData.previous}
  title="Monthly Sales Trend"
/>;
```

## 🎯 Key Benefits

- ✅ **Easy Year Comparison** - See current vs previous year at a glance
- ✅ **Interactive** - Toggle between chart types
- ✅ **Comprehensive Stats** - Totals, averages, and growth metrics
- ✅ **Beautiful UI** - Matches your app's design system
- ✅ **Performance Insights** - Top performing months highlighted
- ✅ **Responsive Design** - Works on all screen sizes

Enjoy your new monthly sales trend chart! 📊✨
