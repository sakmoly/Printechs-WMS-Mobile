/**
 * ScreenFooterFrame Component
 *
 * Bottom blue bar + optional safe-area fill so no grey strip shows above
 * the system navigation bar / home indicator.
 */

import React from "react";
import { Platform, View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export const FOOTER_FRAME_BLUE = "#1E88E5";

interface ScreenFooterFrameProps {
  height?: number;
  backgroundColor?: string;
  borderColor?: string;
}

export default function ScreenFooterFrame({
  height = 24,
  backgroundColor = FOOTER_FRAME_BLUE,
  borderColor = "#E0E0E0",
}: ScreenFooterFrameProps) {
  const insets = useSafeAreaInsets();
  // Android nav bar is tinted app-wide; avoid stacking a thick bar + inset fill.
  const bottomInsetFill =
    Platform.OS === "android" ? 0 : Math.min(insets.bottom, 8);

  return (
    <View style={[styles.wrapper, { backgroundColor }]}>
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
      {bottomInsetFill > 0 ? (
        <View style={{ height: bottomInsetFill, backgroundColor }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
  },
  footerFrame: {
    borderTopWidth: 1,
    width: "100%",
    opacity: 1,
  },
});
