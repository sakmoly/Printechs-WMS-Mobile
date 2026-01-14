# ScreenFooterFrame Component

## Component Name
**`ScreenFooterFrame`**

## Description
A reusable React Native component that provides a consistent bottom frame/separator for all screens in the application. This component creates a visual boundary at the bottom of screens with a customizable height and color.

## Design Pattern
**Bottom Visual Separator / Footer Frame Pattern**

## File Location
`src/components/ScreenFooterFrame.tsx`

## Usage

### Basic Usage
```tsx
import ScreenFooterFrame from '../components/ScreenFooterFrame';

export default function MyScreen() {
  return (
    <View style={styles.container}>
      {/* Your screen content */}
      <ScreenFooterFrame />
    </View>
  );
}
```

### Custom Height
```tsx
<ScreenFooterFrame height={60} />
```

### Custom Colors
```tsx
<ScreenFooterFrame 
  height={40}
  backgroundColor="#8E24AA"  // Purple
  borderColor="#E0E0E0"      // Light gray border
/>
```

## Default Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `height` | `number` | `40` | Height of the footer frame in pixels |
| `backgroundColor` | `string` | `#1E88E5` | Background color (buttonBlue) |
| `borderColor` | `string` | `#E0E0E0` | Top border color (borderLight) |

## Design Specifications

- **Height**: 40px (default, customizable)
- **Background Color**: Blue (#1E88E5) - matches scan card color
- **Border**: 1px top border in light gray (#E0E0E0)
- **Purpose**: Visual separation and consistent bottom spacing

## Benefits

1. **Consistency**: Same footer frame across all screens
2. **Reusability**: Single component, easy to maintain
3. **Customizable**: Height and colors can be adjusted per screen if needed
4. **Clean Design**: Provides visual boundary without taking up too much space

## Implementation in Project

To apply this component to all screens:

1. Import the component:
   ```tsx
   import ScreenFooterFrame from '../components/ScreenFooterFrame';
   ```

2. Add it at the bottom of your screen's JSX (after ScrollView or main content):
   ```tsx
   <View style={styles.container}>
     <ScrollView>
       {/* Content */}
     </ScrollView>
     <ScreenFooterFrame />
   </View>
   ```

3. Remove any existing footer styles or components

## For Future Projects

This component can be easily copied to any React Native project:

1. Copy `src/components/ScreenFooterFrame.tsx` to your project
2. Adjust default colors to match your project's theme
3. Import and use in any screen that needs a bottom frame

## Theme Integration

The component uses theme colors by default but accepts custom colors:
- Default background: `#1E88E5` (buttonBlue)
- Default border: `#E0E0E0` (borderLight)

You can integrate it with your theme system by passing theme colors as props.
