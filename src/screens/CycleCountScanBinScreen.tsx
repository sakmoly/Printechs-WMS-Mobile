import { useEffect } from "react";
import { ActivityIndicator, View, StyleSheet } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";

/** Legacy route — forwards to CycleCountBinCounting (bin scan happens there). */
export default function CycleCountScanBinScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const routeParams = (route.params as any) || {};
  const {
    countType = "Directed",
    openingStock = false,
    preCreatedTaskTitle,
    preCreatedBinCode,
    preCreatedSessionId,
  } = routeParams;

  useEffect(() => {
    const binCode = preCreatedBinCode?.trim() || undefined;
    (navigation as any).replace("CycleCountBinCounting", {
      ...(preCreatedSessionId ? { sessionId: preCreatedSessionId } : {}),
      ...(binCode
        ? {
            binCode,
            binInfo: { bin_code: binCode, bin_id: binCode },
          }
        : {}),
      countType,
      countMode: "Reconciliation",
      isBlindCount: false,
      scanOnline: false,
      openingStock,
      preCreatedTaskTitle,
      preCreatedSessionId,
    });
  }, [navigation, countType, openingStock, preCreatedTaskTitle, preCreatedBinCode, preCreatedSessionId]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#9C27B0" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F5F5F5",
  },
});
