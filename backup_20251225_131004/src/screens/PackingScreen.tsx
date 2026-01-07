import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  FlatList,
} from "react-native";
import { useApp } from "../context/AppContext";
import { useNavigation } from "@react-navigation/native";
import { BarcodeScanner } from "../components/BarcodeScanner";
import { StatusBadge } from "../components/StatusBadge";
import { ProgressIndicator } from "../components/ProgressIndicator";
import { dataService } from "../services/data.service";
import { apiService } from "../services/api.service";
import { addEvent } from "../services/event-queue.service";
import { getSettings } from "../services/settings.service";

export default function PackingScreen() {
  const navigation = useNavigation();
  const { activeASN, activeSession } = useApp();
  const [selectedStore, setSelectedStore] = useState("SR-01");
  const [transferCarton, setTransferCarton] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<any[]>([]);
  const [packedBoxes, setPackedBoxes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSealing, setIsSealing] = useState(false);
  const [hasSealedTC, setHasSealedTC] = useState(false);

  useEffect(() => {
    loadBoxes();
    // Check for existing Open TC and Sealed TC when store changes
    const checkExistingTC = async () => {
      if (!activeASN) return;
      const existingTCs = await dataService.getTransferCartons(
        activeASN,
        selectedStore
      );
      const openTC = existingTCs.find(
        (tc) => tc.status === "Open" && tc.store === selectedStore
      );
      const sealedTC = existingTCs.find(
        (tc) => tc.status === "Sealed" && tc.store === selectedStore
      );

      if (openTC) {
        setTransferCarton(openTC.tc_id);
        setHasSealedTC(false);
      } else {
        setTransferCarton(null);
        setHasSealedTC(!!sealedTC);
      }
      setPackedBoxes([]);
    };
    checkExistingTC();
  }, [activeASN, selectedStore]);

  const loadBoxes = async () => {
    if (!activeASN) return;
    const boxList = await dataService.getBoxes(activeASN, selectedStore);
    setBoxes(boxList.filter((b) => b.status === "Closed"));
  };

  const handleCreateTC = async () => {
    // Prevent multiple simultaneous calls
    if (isCreating || loading) {
      return;
    }

    if (!activeASN) {
      Alert.alert("Error", "No active ASN");
      return;
    }

    // Check if there's already an Open TC for this store
    const existingTCs = await dataService.getTransferCartons(
      activeASN,
      selectedStore
    );
    const openTC = existingTCs.find(
      (tc) => tc.status === "Open" && tc.store === selectedStore
    );

    if (openTC) {
      Alert.alert(
        "Transfer Carton Already Exists",
        `An open Transfer Carton (${openTC.tc_id}) already exists for ${selectedStore}.\n\nWould you like to use it?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Use Existing",
            onPress: () => {
              setTransferCarton(openTC.tc_id);
              loadBoxes(); // Refresh boxes
            },
          },
        ]
      );
      return;
    }

    setIsCreating(true);
    setLoading(true);
    try {
      // Get user_id from settings for created_by field
      const settings = await getSettings();

      // Validate that user_id exists (required by backend)
      if (!settings.user_id) {
        Alert.alert(
          "Error",
          "User ID not found. Please configure device settings."
        );
        setLoading(false);
        setIsCreating(false);
        return;
      }

      const response = await apiService.createTransferCarton({
        asn_no: activeASN,
        to_no: "TO-00012",
        store: selectedStore,
        user_id: (settings.user_id || undefined) as string | undefined,
        created_by: (settings.user_id || undefined) as string | undefined, // Backend requires created_by field
      });

      const newTC: any = {
        tc_id: response.tc_id,
        asn_no: activeASN,
        to_no: "TO-00012",
        store: selectedStore,
        status: "Open",
        updated_on: new Date().toISOString(),
      };

      await dataService.saveTransferCarton(newTC);
      setTransferCarton(response.tc_id);
      setPackedBoxes([]);
      Alert.alert("Success", `Transfer Carton ${response.tc_id} created`);
    } catch (error: any) {
      console.error("❌ ERROR: Failed to create Transfer Carton:", error);
      Alert.alert("Error", error.message || "Failed to create Transfer Carton");
    } finally {
      setLoading(false);
      setIsCreating(false);
    }
  };

  const handleBoxScan = async (barcode: string) => {
    if (!transferCarton) {
      Alert.alert("Error", "Please create a Transfer Carton first");
      return;
    }

    const boxId = barcode.trim().toUpperCase();
    const box = boxes.find((b) => b.box_id === boxId);

    if (!box) {
      Alert.alert("Error", "BOX not found or not closed");
      return;
    }

    if (packedBoxes.includes(boxId)) {
      Alert.alert("Info", "BOX already packed");
      return;
    }

    setLoading(true);
    try {
      const settings = await getSettings();

      // Create PACK_BOX_TO_TC event
      await addEvent({
        event_type: "PACK_BOX_TO_TC",
        asn_no: activeASN ?? undefined,
        inbound_session: activeSession ?? undefined,
        box_id: boxId,
        tc_id: transferCarton,
        store: box.store,
        device_id: settings.device_id ?? undefined,
        user_id: settings.user_id ?? undefined,
      });

      setPackedBoxes([...packedBoxes, boxId]);
      Alert.alert("Success", `BOX ${boxId} packed to ${transferCarton}`);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to pack BOX");
    } finally {
      setLoading(false);
    }
  };

  const handleSeal = async () => {
    if (!transferCarton) return;

    // Prevent multiple simultaneous seal operations
    if (isSealing || loading) {
      return;
    }

    // Check if TC is already sealed
    try {
      const existingTCs = await dataService.getTransferCartons(
        activeASN ?? undefined
      );
      const currentTC = existingTCs.find((tc) => tc.tc_id === transferCarton);

      if (currentTC && currentTC.status === "Sealed") {
        Alert.alert(
          "Already Sealed",
          `Transfer Carton ${transferCarton} is already sealed.`,
          [
            {
              text: "OK",
              onPress: () => {
                setTransferCarton(null);
                setPackedBoxes([]);
                loadBoxes();
              },
            },
          ]
        );
        return;
      }
    } catch (error) {
      console.error("Error checking TC status:", error);
    }

    setIsSealing(true);
    setLoading(true);
    try {
      await apiService.sealTransferCarton({ tc_id: transferCarton });
      await dataService.updateTransferCartonStatus(transferCarton, "Sealed");
      setHasSealedTC(true);
      Alert.alert("Success", `Transfer Carton ${transferCarton} sealed`, [
        {
          text: "OK",
          onPress: () => {
            setTransferCarton(null);
            setPackedBoxes([]);
            loadBoxes();
          },
        },
      ]);
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to seal Transfer Carton");
    } finally {
      setLoading(false);
      setIsSealing(false);
    }
  };

  const stores = ["WAREHOUSE", "SR-01", "SR-02", "SR-03", "SR-04"];

  return (
    <ScrollView style={styles.container}>
      <ProgressIndicator currentStep={5} totalSteps={6} stepName="Packing" />
      <View style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Store</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.storeSelector}
            contentContainerStyle={styles.storeSelectorContent}
          >
            {stores.map((store) => (
              <TouchableOpacity
                key={store}
                style={[
                  styles.storeButton,
                  selectedStore === store && styles.storeButtonActive,
                ]}
                onPress={() => {
                  setSelectedStore(store);
                  setTransferCarton(null);
                  setPackedBoxes([]);
                }}
              >
                <Text
                  style={[
                    styles.storeButtonText,
                    selectedStore === store && styles.storeButtonTextActive,
                  ]}
                >
                  {store}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {!transferCarton ? (
          <View style={styles.section}>
            <TouchableOpacity
              style={[
                styles.button,
                (loading || isCreating || hasSealedTC) && styles.buttonDisabled,
              ]}
              onPress={handleCreateTC}
              disabled={loading || isCreating || hasSealedTC}
            >
              <Text style={styles.buttonText}>
                {loading || isCreating
                  ? "Creating..."
                  : hasSealedTC
                  ? "Transfer Carton Sealed"
                  : "Create Transfer Carton"}
              </Text>
            </TouchableOpacity>
            {hasSealedTC && (
              <Text style={styles.disabledHint}>
                A Transfer Carton has already been created and sealed for{" "}
                {selectedStore}. You cannot create another one.
              </Text>
            )}
          </View>
        ) : (
          <>
            <View style={styles.tcInfo}>
              <Text style={styles.tcText}>TC: {transferCarton}</Text>
              <Text style={styles.tcText}>Store: {selectedStore}</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Scan BOX to Pack</Text>
              <BarcodeScanner
                onScan={handleBoxScan}
                placeholder="Scan BOX barcode"
                title="BOX Barcode"
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Packed BOXes</Text>
              {packedBoxes.length === 0 ? (
                <Text style={styles.emptyText}>No BOXes packed yet</Text>
              ) : (
                <FlatList
                  data={packedBoxes}
                  keyExtractor={(item) => item}
                  renderItem={({ item }) => (
                    <View style={styles.packedItem}>
                      <Text style={styles.packedBoxId}>{item}</Text>
                    </View>
                  )}
                  scrollEnabled={false}
                />
              )}
            </View>

            <TouchableOpacity
              style={[
                styles.button,
                styles.sealButton,
                (loading || isSealing) && styles.buttonDisabled,
              ]}
              onPress={handleSeal}
              disabled={loading || isSealing}
            >
              <Text style={styles.buttonText}>
                {loading || isSealing ? "Sealing..." : "Seal Transfer Carton"}
              </Text>
            </TouchableOpacity>
          </>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Available Closed BOXes</Text>
          {boxes.length === 0 ? (
            <Text style={styles.emptyText}>No closed BOXes available</Text>
          ) : (
            <FlatList
              data={boxes}
              keyExtractor={(item) => item.box_id}
              renderItem={({ item }) => (
                <View style={styles.boxItem}>
                  <Text style={styles.boxId}>{item.box_id}</Text>
                  <StatusBadge status={item.status} />
                </View>
              )}
              scrollEnabled={false}
            />
          )}
        </View>

        <TouchableOpacity
          style={styles.nextButton}
          onPress={() => navigation.navigate("Dispatch" as never)}
        >
          <Text style={styles.nextButtonText}>Next →</Text>
          <Text style={styles.nextButtonSubtext}>Dispatch</Text>
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
  section: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 16,
    color: "#333",
  },
  storeSelector: {
    marginBottom: 0,
  },
  storeSelectorContent: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 16,
  },
  storeButton: {
    minWidth: 100,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#ddd",
    backgroundColor: "#fff",
    alignItems: "center",
  },
  storeButtonActive: {
    borderColor: "#007AFF",
    backgroundColor: "#E3F2FD",
  },
  storeButtonText: {
    fontSize: 16,
    color: "#666",
    fontWeight: "600",
  },
  storeButtonTextActive: {
    color: "#007AFF",
  },
  tcInfo: {
    backgroundColor: "#E3F2FD",
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  tcText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1976D2",
    marginBottom: 4,
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 18,
    borderRadius: 8,
    alignItems: "center",
  },
  sealButton: {
    backgroundColor: "#FF9800",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  packedItem: {
    padding: 12,
    backgroundColor: "#E8F5E9",
    borderRadius: 6,
    marginBottom: 8,
  },
  packedBoxId: {
    fontSize: 16,
    fontWeight: "600",
    color: "#4CAF50",
  },
  boxItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  boxId: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  emptyText: {
    color: "#999",
    fontStyle: "italic",
    textAlign: "center",
    padding: 24,
  },
  disabledHint: {
    color: "#FF9800",
    fontSize: 14,
    textAlign: "center",
    marginTop: 12,
    fontStyle: "italic",
  },
  nextButton: {
    backgroundColor: "#4CAF50",
    padding: 20,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 24,
    marginBottom: 16,
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
