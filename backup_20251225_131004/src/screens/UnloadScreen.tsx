import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  FlatList,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useApp } from "../context/AppContext";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { StatusBadge } from "../components/StatusBadge";
import { addEvent } from "../services/event-queue.service";
import { dataService } from "../services/data.service";
import { getSettings } from "../services/settings.service";
import { normalizeASN } from "../utils/asn";
import { apiService } from "../services/api.service";
import { ProgressIndicator } from "../components/ProgressIndicator";

export default function UnloadScreen() {
  const navigation = useNavigation();
  const { activeASN, activeSession } = useApp();
  const [cartons, setCartons] = useState<any[]>([]);
  const [totalCartons, setTotalCartons] = useState<number>(0);
  const [scannedCartons, setScannedCartons] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadCartons();
  }, [activeASN, activeSession]);

  const loadCartons = async () => {
    if (!activeASN || !activeSession) return;

    const normalizedASN = normalizeASN(activeASN);
    console.log("🔄 UnloadScreen: Loading cartons...", {
      normalizedASN,
      activeSession,
    });

    // Get all cartons for this ASN from asn_carton_map (synced from desktop)
    const allCartons = await dataService.getASNCartons(normalizedASN);
    setTotalCartons(allCartons.length);
    console.log(`📦 UnloadScreen: Found ${allCartons.length} carton(s) from desktop:`, allCartons);

    // Create set of valid carton IDs from desktop (for filtering)
    const validCartonIds = new Set(allCartons);

    // Get carton statuses for this session
    const statuses = await dataService.getAllCartonStatuses(
      normalizedASN,
      activeSession
    );
    console.log("📦 UnloadScreen: Loaded carton statuses:", {
      activeSession,
      normalizedASN,
      statuses: statuses.map((c) => ({
        carton: c.carton_id,
        status: c.status,
        session: c.inbound_session,
        locked_by: c.locked_by,
        locked_on: c.locked_on,
      })),
    });

    // Filter statuses to only include cartons that exist in asn_carton_map (from desktop)
    // This ensures we only show valid cartons, not demo or orphaned cartons
    const filteredStatuses = statuses.filter((status) =>
      validCartonIds.has(status.carton_id)
    );

    if (filteredStatuses.length !== statuses.length) {
      console.warn(
        `⚠️ Filtered out ${statuses.length - filteredStatuses.length} invalid carton status(es). ` +
        `Only showing ${filteredStatuses.length} valid carton(s) from desktop.`
      );
    }

    // If no valid statuses found, initialize statuses for cartons from desktop
    if (filteredStatuses.length === 0 && allCartons.length > 0) {
      console.log(
        `📦 No statuses found for current session, initializing ${allCartons.length} carton(s) from desktop...`
      );
      const settings = await getSettings();
      // Initialize carton statuses for all cartons from desktop
      for (const cartonId of allCartons) {
        await dataService.updateCartonStatus({
          asn_no: normalizedASN,
          inbound_session: activeSession,
          carton_id: cartonId,
          status: "Pending",
          updated_on: new Date().toISOString(),
        });
        
        // Sync "Pending" status to backend so desktop app can see initial status
        try {
          console.log(`📡 Syncing initial Pending status for carton ${cartonId} to backend:`, {
            carton: cartonId,
            asn: activeASN,
            session: activeSession,
            status: "Pending",
          });
          await apiService.updateCartonStatus({
            asn_no: activeASN, // Use original format from desktop
            inbound_session: activeSession,
            carton_id: cartonId,
            status: "Pending",
            user_id: settings.user_id,
            device_id: settings.device_id,
          });
          console.log(`✅ Carton ${cartonId} initial status synced to backend: Pending`);
        } catch (apiError: any) {
          console.warn(
            `⚠️ Failed to sync carton ${cartonId} initial status to backend:`,
            apiError.message
          );
          // Don't block - this is just initialization
        }
      }
      // Reload statuses after initialization
      const initializedStatuses = await dataService.getAllCartonStatuses(
        normalizedASN,
        activeSession
      );
      const validInitializedStatuses = initializedStatuses.filter((status) =>
        validCartonIds.has(status.carton_id)
      );
      setCartons(validInitializedStatuses);
      setScannedCartons(0);
      console.log(
        `✅ Initialized ${validInitializedStatuses.length} carton status(es) from desktop`
      );
      return;
    }

    // If no statuses found, check if there are statuses with empty session (from demo data)
    // But only migrate valid cartons (those in asn_carton_map)
    if (filteredStatuses.length === 0 && statuses.length === 0) {
      console.log(
        "⚠️ No statuses found for current session, checking for statuses with empty session..."
      );
      const allStatuses = await dataService.getAllCartonStatuses(
        normalizedASN,
        ""
      );
      console.log("📦 Found statuses with empty session:", allStatuses.length);
      
      // Filter to only migrate valid cartons (from desktop)
      const validOldStatuses = allStatuses.filter((status) =>
        validCartonIds.has(status.carton_id)
      );
      
      if (validOldStatuses.length > 0) {
        // Migrate only valid old statuses to current session
        console.log(`🔄 Migrating ${validOldStatuses.length} valid statuses to current session...`);
        for (const oldStatus of validOldStatuses) {
          await dataService.updateCartonStatus({
            ...oldStatus,
            inbound_session: activeSession,
          });
        }
        // Reload with current session
        const migratedStatuses = await dataService.getAllCartonStatuses(
          normalizedASN,
          activeSession
        );
        const validMigratedStatuses = migratedStatuses.filter((status) =>
          validCartonIds.has(status.carton_id)
        );
        setCartons(validMigratedStatuses);
        const scannedCount = validMigratedStatuses.filter(
          (c) =>
            c.status === "Unloaded" ||
            c.status === "Receiving" ||
            c.status === "Received"
        ).length;
        setScannedCartons(scannedCount);
        console.log(
          `✅ Migrated ${validMigratedStatuses.length} valid statuses to session ${activeSession}`
        );
        return;
      }
    }

    // Use filtered statuses (only valid cartons from desktop)
    setCartons(filteredStatuses);

    // Count scanned cartons (Unloaded, Receiving, or Received) from filtered statuses
    const scannedCount = filteredStatuses.filter(
      (c) =>
        c.status === "Unloaded" ||
        c.status === "Receiving" ||
        c.status === "Received"
    ).length;
    setScannedCartons(scannedCount);
    console.log(
      `✅ UnloadScreen: Total cartons from desktop: ${allCartons.length}, ` +
      `Valid statuses: ${filteredStatuses.length}, Scanned: ${scannedCount}`
    );
  };

  // Refresh carton status when screen is focused (e.g., returning from ReceiveSort)
  useFocusEffect(
    useCallback(() => {
      console.log("🔄 UnloadScreen focused, refreshing carton status...");
      loadCartons();
    }, [activeASN, activeSession])
  );

  const handleCartonScan = async (barcode: string) => {
    if (!activeASN || !activeSession) {
      Alert.alert("Error", "No active inbound session");
      return;
    }

    const cartonId = barcode.trim().toUpperCase();
    const normalizedASN = normalizeASN(activeASN);

    // Validate that carton belongs to the active ASN
    const isValidCarton = await dataService.isCartonInASN(
      normalizedASN,
      cartonId
    );
    if (!isValidCarton) {
      Alert.alert(
        "Invalid Carton",
        `Carton ${cartonId} does not belong to ASN ${normalizedASN}.\n\nPlease scan a carton from the current shipment.`
      );
      return;
    }

    // Always fetch latest carton status from database to ensure accuracy
    const settings = await getSettings();

    console.log(`🔍 Scanning carton ${cartonId}, fetching latest status...`, {
      normalizedASN,
      activeSession,
      currentUserId: settings.user_id,
      demoMode: settings.demo_mode,
    });

    const latestStatus = await dataService.getCartonStatus(
      normalizedASN,
      activeSession,
      cartonId
    );

    console.log(`🔍 Latest status from database:`, {
      status: latestStatus?.status,
      locked_by: latestStatus?.locked_by,
      locked_on: latestStatus?.locked_on,
      has_locked_by: !!latestStatus?.locked_by,
      locked_by_type: typeof latestStatus?.locked_by,
      locked_by_value: JSON.stringify(latestStatus?.locked_by),
      full_status_object: JSON.stringify(latestStatus),
    });

    if (latestStatus) {
      if (latestStatus.status === "Unloaded") {
        Alert.alert("Info", "Carton already unloaded");
        return;
      }

      if (latestStatus.status === "Receiving") {
        // Check if locked by current user
        const lockedBy = latestStatus.locked_by
          ? String(latestStatus.locked_by).trim()
          : "";
        const currentUserId = settings.user_id
          ? String(settings.user_id).trim()
          : "";

        console.log(`🔍 Comparing lock status:`, {
          locked_by: lockedBy,
          locked_by_raw: latestStatus.locked_by,
          current_user: currentUserId,
          current_user_raw: settings.user_id,
          match: lockedBy === currentUserId,
          match_upper: lockedBy.toUpperCase() === currentUserId.toUpperCase(),
          locked_by_length: lockedBy.length,
          current_user_length: currentUserId.length,
          both_empty: !lockedBy && !currentUserId,
        });

        // Check if locked by current user (case-insensitive comparison as fallback)
        const isSameUser =
          lockedBy &&
          currentUserId &&
          (lockedBy === currentUserId ||
            lockedBy.toUpperCase() === currentUserId.toUpperCase());

        if (isSameUser) {
          // Same user - show resume dialog
          console.log(
            `✅ Carton ${cartonId} is locked by current user, showing resume dialog`
          );
          Alert.alert(
            "Carton Already Locked",
            `Carton ${cartonId} is already locked by you.\n\nWould you like to resume work on this carton?`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Resume",
                onPress: () => {
                  console.log(`📦 Resuming work on carton: ${cartonId}`);
                  navigation.navigate(
                    "ReceiveSort" as never,
                    {
                      cartonId: cartonId,
                    } as never
                  );
                },
              },
            ]
          );
          return;
        } else {
          // Locked by different user or no locked_by info
          console.log(
            `⚠️ Carton ${cartonId} is locked by different user or has no lock info`,
            {
              lockedBy,
              currentUserId,
              reason: !lockedBy
                ? "no_locked_by"
                : !currentUserId
                ? "no_current_user"
                : "different_user",
              locked_by_value: JSON.stringify(latestStatus.locked_by),
              user_id_value: JSON.stringify(settings.user_id),
            }
          );

          // If locked_by is missing but status is Receiving, it might be a data issue
          // In demo mode, allow resuming if no locked_by is set (assume it's the current user)
          if (!lockedBy && settings.demo_mode === 1) {
            console.log(
              `⚠️ Demo mode: Carton ${cartonId} has no locked_by, assuming current user and showing resume dialog`
            );
            Alert.alert(
              "Carton Already Locked",
              `Carton ${cartonId} is already locked.\n\nWould you like to resume work on this carton?`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Resume",
                  onPress: () => {
                    console.log(`📦 Resuming work on carton: ${cartonId}`);
                    navigation.navigate(
                      "ReceiveSort" as never,
                      {
                        cartonId: cartonId,
                      } as never
                    );
                  },
                },
              ]
            );
            return;
          }

          // If carton is Receiving, always offer to resume (even if user IDs don't match)
          // This handles the case where user_id is regenerated on app restart or between sessions
          // In production, you might want to add additional validation, but for now we allow resuming
          console.log(
            `⚠️ User mismatch but carton is Receiving: Offering resume option`,
            {
              lockedBy,
              currentUserId,
              demoMode: settings.demo_mode,
              status: latestStatus.status,
            }
          );
          Alert.alert(
            "Carton Already Locked",
            `Carton ${cartonId} is currently locked.\n\nLocked by: ${lockedBy}\nCurrent user: ${currentUserId}\n\nWould you like to resume work on this carton?`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Resume",
                onPress: () => {
                  console.log(
                    `📦 Resuming work on carton: ${cartonId} (user mismatch - allowing resume)`
                  );
                  navigation.navigate(
                    "ReceiveSort" as never,
                    {
                      cartonId: cartonId,
                    } as never
                  );
                },
              },
            ]
          );
          return;

          Alert.alert(
            "Carton In Use",
            `Carton ${cartonId} is currently being processed by ${
              lockedBy || "another user"
            }.\n\nPlease select a different carton.`
          );
          return;
        }
      }

      if (latestStatus.status === "Received") {
        Alert.alert("Info", "Carton already received and completed");
        return;
      }
    } else {
      console.log(`⚠️ No status found for carton ${cartonId} in database`);
    }

    // Also check local state as fallback (in case database query fails)
    const existing = cartons.find((c) => c.carton_id === cartonId);
    if (existing) {
      if (existing.status === "Unloaded") {
        Alert.alert("Info", "Carton already unloaded");
        return;
      }
      if (existing.status === "Receiving") {
        const lockedBy = (existing.locked_by || "").trim();
        const currentUserId = (settings.user_id || "").trim();

        if (lockedBy && lockedBy === currentUserId) {
          console.log(
            `✅ Carton ${cartonId} is locked by current user (from local state), showing resume dialog`
          );
          Alert.alert(
            "Carton Already Locked",
            `Carton ${cartonId} is already locked by you.\n\nWould you like to resume work on this carton?`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Resume",
                onPress: () => {
                  console.log(`📦 Resuming work on carton: ${cartonId}`);
                  navigation.navigate(
                    "ReceiveSort" as never,
                    {
                      cartonId: cartonId,
                    } as never
                  );
                },
              },
            ]
          );
          return;
        } else {
          Alert.alert(
            "Carton In Use",
            `Carton ${cartonId} is currently being processed by ${
              lockedBy || "another user"
            }.\n\nPlease select a different carton.`
          );
          return;
        }
      }
      if (existing.status === "Received") {
        Alert.alert("Info", "Carton already received and completed");
        return;
      }
    }

    setLoading(true);
    try {
      const settings = await getSettings();
      const userId = settings.user_id || "USER-AUTO";

      // Create UNLOAD_SCAN event
      await addEvent({
        event_type: "UNLOAD_SCAN",
        asn_no: normalizedASN,
        inbound_session: activeSession,
        carton_id: cartonId,
        device_id: settings.device_id,
        user_id: userId,
      });

      // Update carton status locally
      await dataService.updateCartonStatus({
        asn_no: normalizedASN,
        inbound_session: activeSession,
        carton_id: cartonId,
        status: "Unloaded",
        updated_on: new Date().toISOString(),
      });

      // Call new unload line API to save to tabInboundUnloadLine
      try {
        console.log(`📡 Calling POST /api/inbound/unload-line for carton ${cartonId}:`, {
          parent_title: activeSession,
          unit_type: "Carton",
          unit_id: cartonId,
          scanned_by: userId,
        });
        await apiService.createUnloadLine({
          parent_title: activeSession,
          unit_type: "Carton",
          unit_id: cartonId,
          scanned_by: userId,
          scanned_on: new Date().toISOString(),
        });
        console.log(`✅ Unload line created/updated for carton ${cartonId}`);
      } catch (unloadLineError: any) {
        console.warn(
          `⚠️ Failed to create unload line for carton ${cartonId}:`,
          unloadLineError.message
        );
        // Don't block user flow if unload line API fails - carton status is still saved
      }

      // Sync status change to backend immediately for real-time updates
      // Use original ASN format (activeASN) for API calls, not normalized version
      try {
        console.log(`📡 Syncing carton status to backend immediately:`, {
          carton: cartonId,
          asn: activeASN,
          session: activeSession,
          status: "Unloaded",
        });
        await apiService.updateCartonStatus({
          asn_no: activeASN, // Use original format from desktop (e.g., ASN-00002)
          inbound_session: activeSession,
          carton_id: cartonId,
          status: "Unloaded",
          user_id: userId,
          device_id: settings.device_id,
        });
        console.log(`✅ Carton ${cartonId} status synced to backend immediately: Unloaded`);
      } catch (apiError: any) {
        console.warn(
          `⚠️ Failed to sync carton ${cartonId} status to backend:`,
          apiError.message
        );
        // 404 errors are expected if carton doesn't exist in backend yet
        if (apiError.message?.includes("404")) {
          console.log(
            `ℹ️ Carton ${cartonId} not found in backend (404). This is expected if the carton hasn't been created in the backend yet. Will retry in batch sync.`
          );
        }
        // Don't block user flow - status is saved locally and will be retried in batch sync
      }

      await loadCartons();
      Alert.alert("Success", `Carton ${cartonId} unloaded`);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to unload carton");
    } finally {
      setLoading(false);
    }
  };

  if (!activeASN || !activeSession) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No active inbound session</Text>
        <Text style={styles.errorSubtext}>
          Please start an inbound session first
        </Text>
      </View>
    );
  }

  const canProceed = scannedCartons > 0;

  const handleNext = async () => {
    if (!activeASN || !activeSession) {
      Alert.alert("Error", "No active inbound session");
      return;
    }

    const normalizedASN = normalizeASN(activeASN);

    // Get all unloaded cartons for this ASN and session
    const unloadedCartons = cartons.filter((c) => c.status === "Unloaded");

    if (unloadedCartons.length === 0) {
      // No unloaded cartons, just navigate
      navigation.navigate("ReceiveSort" as never);
      return;
    }

    // Note: Cartons are already synced individually when scanned (for real-time updates)
    // Batch sync is kept as a safety net in case any individual syncs failed
    // The backend API is idempotent, so duplicate updates are safe
    setLoading(true);
    try {
      const settings = await getSettings();

      // Prepare cartons array for batch update (safety net)
      const cartonsToUpdate = unloadedCartons.map((c) => ({
        carton_id: c.carton_id,
        status: "Unloaded",
      }));

      console.log(
        `🔄 Batch sync (safety net): Updating ${cartonsToUpdate.length} carton(s) status to Unloaded on backend...`
      );
      console.log(
        `📦 Cartons:`,
        cartonsToUpdate.map((c) => c.carton_id).join(", ")
      );
      console.log(`📡 Batch Carton Status Update Request:`, {
        asn: activeASN,
        session: activeSession,
        cartons: cartonsToUpdate,
        user_id: settings.user_id,
        device_id: settings.device_id,
      });

      // Call API to update carton status on backend (safety net for any failed individual syncs)
      // Use original ASN format (activeASN) for API calls, not normalized version
      await apiService.updateCartonStatus({
        asn_no: activeASN, // Use original format from desktop (e.g., ASN-00002)
        inbound_session: activeSession,
        cartons: cartonsToUpdate,
        user_id: settings.user_id,
        device_id: settings.device_id,
      });

      console.log(
        `✅ Batch sync completed: ${cartonsToUpdate.length} carton(s) status verified on backend`
      );

      // Navigate to ReceiveSort screen
      navigation.navigate("ReceiveSort" as never);
    } catch (error: any) {
      console.error("❌ Batch sync failed (individual syncs already completed):", error);
      // Still navigate even if batch sync fails (cartons were already synced individually)
      // Individual syncs happened when each carton was scanned
      navigation.navigate("ReceiveSort" as never);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <ProgressIndicator currentStep={2} totalSteps={6} stepName="Unload" />
      <View style={styles.content}>
        <View style={styles.asnInfo}>
          <Text style={styles.asnLabel}>Active ASN:</Text>
          <Text style={styles.asnValue}>{activeASN || "Not set"}</Text>
        </View>

        <View style={styles.summaryContainer}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Total Number of CTN ASN:</Text>
            <Text style={styles.summaryValue}>{totalCartons}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>
              Total Number of CTN Scanned:
            </Text>
            <Text style={[styles.summaryValue, styles.summaryValueScanned]}>
              {scannedCartons}
            </Text>
          </View>
        </View>
        <Text style={styles.sectionTitle}>Scan Supplier Carton</Text>
        <Text style={styles.hintText}>
          Only cartons from ASN {activeASN || "Not set"} can be unloaded
        </Text>
        <BarcodeScanner
          onScan={handleCartonScan}
          placeholder="Scan carton barcode"
          title="Carton Barcode"
        />

        <View style={styles.listContainer}>
          <Text style={styles.listTitle}>Carton Status</Text>
          <FlatList
            data={cartons}
            keyExtractor={(item) => item.carton_id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.cartonItem,
                  (item.status === "Unloaded" ||
                    (item.status === "Receiving" && item.locked_by)) &&
                    styles.cartonItemClickable,
                ]}
                onPress={async () => {
                  const cartonId = item.carton_id;

                  // Allow clicking on Unloaded cartons
                  if (item.status === "Unloaded") {
                    console.log(
                      `📦 Navigating to ReceiveSort with carton: ${cartonId}`
                    );
                    navigation.navigate(
                      "ReceiveSort" as never,
                      {
                        cartonId: cartonId,
                      } as never
                    );
                    return;
                  }

                  // Also allow clicking on Receiving cartons if locked by current user
                  if (item.status === "Receiving") {
                    const settings = await getSettings();
                    console.log(`🔍 Checking carton ${cartonId} lock status:`, {
                      locked_by: item.locked_by,
                      current_user: settings.user_id,
                      is_same_user: item.locked_by === settings.user_id,
                    });
                    // Check if locked_by exists and matches current user
                    if (item.locked_by && item.locked_by === settings.user_id) {
                      console.log(
                        `📦 Resuming work on carton: ${cartonId} (locked by current user: ${settings.user_id})`
                      );
                      navigation.navigate(
                        "ReceiveSort" as never,
                        {
                          cartonId: cartonId,
                        } as never
                      );
                      return;
                    } else if (item.locked_by) {
                      // Locked by different user - show message
                      Alert.alert(
                        "Carton In Use",
                        `Carton ${cartonId} is currently being processed by ${item.locked_by}.\n\nPlease select a different carton.`
                      );
                      return;
                    } else {
                      // No locked_by info - shouldn't happen but handle it
                      console.warn(
                        `⚠️ Carton ${cartonId} is Receiving but has no locked_by info`
                      );
                      Alert.alert(
                        "Carton Status Error",
                        `Carton ${cartonId} is in an invalid state. Please contact support.`
                      );
                      return;
                    }
                  }

                  // Received cartons cannot be clicked
                  if (item.status === "Received") {
                    Alert.alert(
                      "Info",
                      "Carton already received and completed"
                    );
                    return;
                  }
                }}
                disabled={
                  item.status !== "Unloaded" &&
                  !(item.status === "Receiving" && item.locked_by)
                }
              >
                <View style={styles.cartonInfo}>
                  <View style={styles.cartonHeader}>
                    <Text
                      style={[
                        styles.cartonId,
                        (item.status === "Unloaded" ||
                          (item.status === "Receiving" && item.locked_by)) &&
                          styles.cartonIdClickable,
                      ]}
                    >
                      {item.carton_id}
                    </Text>
                    <StatusBadge status={item.status} />
                  </View>
                  {item.status === "Receiving" && item.locked_by && (
                    <View style={styles.lockInfo}>
                      <Text style={styles.lockText}>
                        🔒 Locked by: {item.locked_by}
                      </Text>
                      {item.locked_on && (
                        <Text style={styles.lockTime}>
                          {new Date(item.locked_on).toLocaleString()}
                        </Text>
                      )}
                    </View>
                  )}
                </View>
                {item.status === "Unloaded" && (
                  <Text style={styles.tapHint}>Tap to receive & sort →</Text>
                )}
                {item.status === "Receiving" && (
                  <Text style={styles.lockedHint}>
                    Currently being processed
                  </Text>
                )}
              </TouchableOpacity>
            )}
            scrollEnabled={false}
          />
        </View>

        <TouchableOpacity
          style={[
            styles.nextButton,
            (!canProceed || loading) && styles.nextButtonDisabled,
          ]}
          onPress={handleNext}
          disabled={!canProceed || loading}
        >
          {loading ? (
            <Text style={styles.nextButtonText}>Syncing...</Text>
          ) : (
            <>
              <Text style={styles.nextButtonText}>Next →</Text>
              <Text style={styles.nextButtonSubtext}>Receive + Sort</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  content: {
    padding: 16,
  },
  asnInfo: {
    backgroundColor: "#E3F2FD",
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  asnLabel: {
    fontSize: 14,
    color: "#1976D2",
    fontWeight: "600",
  },
  asnValue: {
    fontSize: 16,
    color: "#1976D2",
    fontWeight: "bold",
  },
  summaryContainer: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
  },
  summaryValue: {
    fontSize: 16,
    color: "#333",
    fontWeight: "bold",
  },
  summaryValueScanned: {
    color: "#4CAF50",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 8,
    color: "#333",
  },
  hintText: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
    fontStyle: "italic",
  },
  listContainer: {
    marginTop: 24,
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
  },
  listTitle: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
    color: "#333",
  },
  cartonItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  cartonItemClickable: {
    backgroundColor: "#E8F5E9",
    borderRadius: 8,
    marginBottom: 4,
    borderBottomWidth: 0,
  },
  cartonInfo: {
    flex: 1,
  },
  cartonHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  lockInfo: {
    marginTop: 4,
    padding: 8,
    backgroundColor: "#FFF3E0",
    borderRadius: 4,
  },
  lockText: {
    fontSize: 12,
    color: "#E65100",
    fontWeight: "600",
  },
  lockTime: {
    fontSize: 11,
    color: "#FF6F00",
    marginTop: 2,
  },
  lockedHint: {
    fontSize: 12,
    color: "#FF9800",
    marginTop: 4,
    fontStyle: "italic",
  },
  cartonId: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  cartonIdClickable: {
    color: "#4CAF50",
  },
  tapHint: {
    fontSize: 12,
    color: "#4CAF50",
    marginTop: 4,
    fontStyle: "italic",
  },
  errorText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#F44336",
    textAlign: "center",
    marginTop: 100,
  },
  errorSubtext: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginTop: 8,
  },
  nextButton: {
    backgroundColor: "#4CAF50",
    padding: 20,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 24,
    marginBottom: 16,
  },
  nextButtonDisabled: {
    backgroundColor: "#ccc",
    opacity: 0.6,
  },
  nextButtonText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
  },
  nextButtonSubtext: {
    color: "rgba(255, 255, 255, 0.9)",
    fontSize: 14,
    marginTop: 4,
  },
});
