/**
 * ScreenFooterFrame Component
 * 
 * A reusable bottom frame component that provides visual separation
 * at the bottom of screens. This component maintains consistent
 * styling across all screens in the application.
 * 
 * Usage:
 * import ScreenFooterFrame from '../components/ScreenFooterFrame';
 * 
 * export default function MyScreen() {
 *   return (
 *     <View style={styles.container}>
 *       <ScreenFooterFrame />
 *     </View>
 *   );
 * }
 * 
 * Component Name: ScreenFooterFrame
 * Design Pattern: Bottom Visual Separator / Footer Frame
 * Reusable: Yes - Can be used in any React Native project
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';

interface ScreenFooterFrameProps {
  height?: number;
  backgroundColor?: string;
  borderColor?: string;
}

export default function ScreenFooterFrame({
  height = 40,
  backgroundColor = '#1E88E5', // buttonBlue color
  borderColor = '#E0E0E0', // borderLight color
}: ScreenFooterFrameProps) {
  return (
    <View
      style={[
        styles.footerFrame,
        {
          height,
          backgroundColor,
          borderTopColor: borderColor,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  footerFrame: {
    borderTopWidth: 1,
    width: '100%',
    // Ensure solid background, no transparency
    opacity: 1,
  },
});
