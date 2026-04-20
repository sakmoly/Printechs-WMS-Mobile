import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  Share,
  Switch,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { PickingTheme } from "../theme/picking-theme";
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import { apiService } from "../services/api.service";
import { transferInReceivingSessionService, TransferInReceivingSession } from "../services/transfer-in-receiving-session.service";
import { getSettings } from "../services/settings.service";
import {
  BarcodeInput,
  type BarcodeInputHandle,
} from "../components/BarcodeInput";

export default function TransferInReceivingScanCartonScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const routeParams = (route.params as any) || {};
  const { transferInNo, sessionId, transactionNo } = routeParams;
  
  console.log(`📦 TransferInReceivingScanCartonScreen opened: transferInNo=${transferInNo}, sessionId=${sessionId}`);

  const [cartonId, setCartonId] = useState("");
  const [boxId, setBoxId] = useState<string | null>(null); // Store box_id created when generating carton
  const [useExistingBox, setUseExistingBox] = useState(false); // When ON, send create_carton_if_missing: true
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const cartonInputRef = useRef<BarcodeInputHandle>(null);
  const lastScanTimeRef = useRef<number>(0);
  const SCAN_DEBOUNCE_MS = 700;

  useEffect(() => {
    // ✅ Restore carton ID from session if exists (but allow user to change it)
    const restoreCartonId = async () => {
      if (!transferInNo) return;
      
      const session = await transferInReceivingSessionService.loadSession(transferInNo);
      if (session && session.active_carton_id && session.status !== "Completed") {
        console.log(`✅ Restored carton ID from session: ${session.active_carton_id}`);
        setCartonId(session.active_carton_id);
        // Note: box_id is not stored in session, it's passed via route params
        // If user navigates back, they'll need to generate carton again to create a new box
      } else {
        console.log(`ℹ️ No carton ID in session - user can generate or scan new carton`);
      }
    };
    
    restoreCartonId();
    
    // Auto-focus input on mount (after a short delay to allow restoration)
    setTimeout(() => {
      cartonInputRef.current?.focus();
    }, 300);
  }, [transferInNo]);

  // Generate carton ID and create BOX automatically
  const handleGenerateCartonId = async () => {
    console.log(`🔢 Generate Carton ID button pressed for Transfer In: ${transferInNo}`);
    setGenerating(true);
    try {
      if (!transferInNo) {
        Alert.alert("Error", "Transfer In number is missing. Cannot generate carton ID.");
        setGenerating(false);
        return;
      }
      
      const settings = await getSettings();
      
      // ✅ STEP 1: Generate carton ID first (needed for BOX creation)
      const date = new Date();
      const dateStr = date.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
      const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '').substring(0, 6); // HHMMSS
      const randomSuffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      
      // Generate format: CTN-TI-{TRANSFER_IN_NO}-{DATE}-{TIME}-{RANDOM}
      // Example: CTN-TI-INSLIP-123456-20250125-143022-123
      const transferInShort = transferInNo.replace(/^INSLIP-/, ''); // Remove INSLIP- prefix if present
      const generatedCartonId = `CTN-TI-${transferInShort}-${dateStr}-${timeStr}-${randomSuffix}`;
      
      // ✅ STEP 2: Create BOX using /api/boxes/create endpoint
      // Note: For Transfer In, send box_id = Carton ID (CTN-TI-...) as per user requirement
      // The Carton ID will be used as the box_id for putaway operations
      console.log(`📦 Creating BOX for Transfer In: ${transferInNo}`);
      console.log(`   box_id (Carton ID): ${generatedCartonId}`);
      let finalBoxId: string | null = generatedCartonId; // Use Carton ID as box_id (as per user requirement)
      try {
        const boxResponse = await apiService.createBox({
          box_id: generatedCartonId, // ✅ box_id = Carton ID (CTN-TI-...) as per user requirement
          asn_no: transferInNo, // ✅ Backend requires asn_no (or advance_shipping_notice) - use Transfer In as ASN
          store: "WH-MAIN", // Default warehouse store
          purpose: "PUTAWAY",
          user_id: settings.user_id || settings.user_code || "USER",
          carton_id: generatedCartonId, // Also pass carton_id for reference
          to_no: "Putaway", // Set Transfer Order to "Putaway" for Transfer In putaway boxes
        });
        
        // ✅ Extract box_id from response
        // Note: We sent box_id = Carton ID (CTN-TI-...) to /api/boxes/create
        // Backend may return the same box_id or a different one
        const backendBoxId = 
          boxResponse?.box_id ||
          boxResponse?.data?.box_id ||
          boxResponse?.data?.box?.box_id ||
          boxResponse?.id ||
          null;
        
        // Use the box_id from response if available, otherwise use the Carton ID we sent
        // For putaway, we'll use the Carton ID as the box_id (since that's what we sent)
        if (backendBoxId) {
          // Backend returned a box_id - use it (might be the Carton ID we sent or a different one)
          finalBoxId = backendBoxId;
          console.log(`✅ Sort box created successfully. Box ID: ${finalBoxId}`);
        } else {
          // Backend didn't return box_id - use the Carton ID we sent (which was sent as box_id)
          finalBoxId = generatedCartonId;
          console.log(`ℹ️ Backend did not return box_id, using Carton ID (sent as box_id): ${finalBoxId}`);
        }
        
        if (finalBoxId) {
          setBoxId(finalBoxId); // Store for later use (this will be the Carton ID for putaway)
          console.log(`✅ Box ID stored: ${finalBoxId}`);
        } else {
          console.error(`❌ Failed to get box_id from response`);
          Alert.alert(
            "Error",
            "Failed to create sort box. Please try again."
          );
          setGenerating(false);
          return;
        }
      } catch (boxError: any) {
        console.error("❌ Error creating BOX:", boxError);
        Alert.alert(
          "Error",
          `Failed to create BOX: ${boxError.message || "Unknown error"}\n\nPlease try again or contact support.`
        );
        setGenerating(false);
        return;
      }
      
      // ✅ STEP 4: Set carton ID (already generated in STEP 1)
      setCartonId(generatedCartonId);
      console.log(`✅ Generated carton ID: ${generatedCartonId}`);
      if (finalBoxId) {
        console.log(`✅ BOX ID: ${finalBoxId}`);
      }
      
      // ✅ STEP 3: Store carton ID in session (box_id will be passed to next screen via route params)
      const session = await transferInReceivingSessionService.loadSession(transferInNo);
      if (session) {
        const updatedSession: TransferInReceivingSession = {
          ...session,
          active_carton_id: generatedCartonId,
          updated_at: new Date().toISOString(),
        };
        await transferInReceivingSessionService.saveSession(updatedSession);
        console.log(`✅ Stored carton ID in session`);
      }
      
      // Show success message
      if (finalBoxId) {
        Alert.alert(
          "Success",
          `BOX created: ${finalBoxId}\n\nCarton ID: ${generatedCartonId}\n\nYou can now continue to scan items.`,
          [{ text: "OK" }]
        );
      }
      
      // Auto-focus input after generation
      setTimeout(() => {
        cartonInputRef.current?.focus();
      }, 100);
    } catch (error: any) {
      console.error("❌ Error generating carton ID:", error);
      Alert.alert("Error", `Failed to generate carton ID: ${error.message}`);
    } finally {
      setGenerating(false);
    }
  };

  // Print/Share barcode
  const handlePrintBarcode = async () => {
    if (!cartonId || !cartonId.trim()) {
      Alert.alert("Error", "Please generate or enter a carton ID first");
      return;
    }

    try {
      // Use React Native's Share API to share/print barcode
      // In production, you might want to use a dedicated printing library like react-native-thermal-receipt-printer
      const barcodeText = `Carton ID: ${cartonId}\nTransfer In: ${transferInNo}\nDate: ${new Date().toLocaleString()}`;
      
      const result = await Share.share({
        message: barcodeText,
        title: "Carton Barcode",
      });

      if (result.action === Share.sharedAction) {
        console.log("✅ Barcode shared successfully");
      }
    } catch (error: any) {
      console.error("❌ Error printing/sharing barcode:", error);
      // Fallback: Show barcode in alert
      Alert.alert(
        "Carton Barcode",
        `Carton ID: ${cartonId}\n\nTransfer In: ${transferInNo}\n\nYou can copy this ID or use a barcode printer to print it.`,
        [{ text: "OK" }]
      );
    }
  };

  // ✅ NEW: Navigate to next screen after carton is scanned
  // Validate carton from tabsortbox backend (similar to ASN validating from asn_carton_map)
  const handleContinue = async (
    overrideCartonId?: string
  ): Promise<boolean> => {
    const source = overrideCartonId !== undefined ? overrideCartonId : cartonId;
    console.log(`➡️ Continue button pressed with carton ID: "${source}"`);
    
    const trimmedCartonId = source?.trim() || "";
    if (!trimmedCartonId) {
      Alert.alert("Error", "Please enter or generate a carton ID first");
      return false;
    }
    
    // ✅ PERMANENT FIX: Check if user entered a Putaway box ID (PAW-*) instead of Transfer In carton
    // Putaway boxes are not valid for Transfer In receiving - they need CTN-TI-* format
    if (trimmedCartonId.toUpperCase().startsWith("PAW-")) {
      Alert.alert(
        "Invalid Carton ID",
        `The entered ID "${trimmedCartonId}" is a Putaway box (PAW-*), not a Transfer In carton.\n\n` +
        `For Transfer In receiving, please:\n` +
        `• Generate a new carton ID using the "Generate Carton ID" button, OR\n` +
        `• Scan/enter a valid Transfer In carton ID (format: CTN-TI-*)\n\n` +
        `Putaway boxes (PAW-*) are created during ASN receiving and cannot be used for Transfer In.`
      );
      return false;
    }
    
    if (!transferInNo) {
      Alert.alert("Error", "Transfer In number is missing. Cannot continue.");
      return false;
    }

    // Debounce: prevent duplicate processing
    const now = Date.now();
    if (now - lastScanTimeRef.current < SCAN_DEBOUNCE_MS) {
      console.log("⏭️ Debounced duplicate scan");
      return true;
    }
    lastScanTimeRef.current = now;

    const normalizedCarton = trimmedCartonId.toUpperCase();
    setCartonId(normalizedCarton);

    setLoading(true);
    try {
      const settings = await getSettings();

      // ✅ NEW: Validate carton from tabsortbox backend using BOX ID (similar to ASN validation)
      // Note: When validating, we pass the BOX ID (not the Carton ID) as carton_id
      let validatedBoxId: string | null = null;
      try {
        // Use boxId from state (created during generation) or pass carton ID if boxId not available
        // Backend expects BOX ID in carton_id field when validating
        const boxIdToValidate = boxId || normalizedCarton; // Fallback to carton ID if boxId not available
        const validationResponse = await apiService.validateTransferInCarton(transferInNo, boxIdToValidate, {
          create_carton_if_missing: useExistingBox || undefined,
        });
        
        if (validationResponse?.ok === false || validationResponse?.validated === false) {
          const errorCode = validationResponse?.error?.code;
          const errorMessage = validationResponse?.error?.message || "Carton validation failed";
          
          if (errorCode === "BOX_NOT_FOUND") {
            Alert.alert(
              "Box Not Found",
              useExistingBox
                ? errorMessage + "\n\nPlease check the inputs and try again."
                : "Box not found in this Transfer In. To use a box that's already in the warehouse, turn on 'Use existing box' and scan again.",
              [{ text: "OK", style: "cancel" }]
            );
            setLoading(false);
            return false;
          }
          if (errorCode === "CARTON_NOT_FOUND") {
            Alert.alert(
              "Carton Not Found",
              errorMessage + "\n\n" +
              "This carton must exist in tabsortbox before receiving.\n\n" +
              "Please ensure the carton has been created in the backend.",
              [{ text: "OK", style: "cancel" }]
            );
            setLoading(false);
            return false;
          }
          Alert.alert("Validation Error", errorMessage);
          setLoading(false);
          return false;
        }
        
        // ✅ Extract box_id from validation response (backend returns it)
        validatedBoxId = 
          validationResponse?.box_id ||
          validationResponse?.data?.box_id ||
          validationResponse?.validated?.box_id ||
          null;
        
        if (validatedBoxId) {
          console.log(`✅ Carton ${normalizedCarton} validated from tabsortbox. Box ID: ${validatedBoxId}`);
          setBoxId(validatedBoxId); // Store box_id for use in putaway
        } else {
          console.warn(`⚠️ Carton validated but box_id not found in response. Response:`, JSON.stringify(validationResponse, null, 2));
        }
      } catch (validationError: any) {
        // If validation endpoint doesn't exist (404), allow to proceed (backend may validate later)
        if (validationError?.message?.includes("404") || validationError?.message?.includes("not found")) {
          console.warn(`⚠️ Transfer In validate-carton endpoint not available (404). Allowing carton to proceed.`);
          // Continue - backend may validate during receiving
        } else {
          // Other validation errors - show error and stop
          Alert.alert("Validation Error", validationError?.message || "Failed to validate carton from tabsortbox");
          setLoading(false);
          return false;
        }
      }

      // Update session locally with carton ID
      const session = await transferInReceivingSessionService.loadSession(transferInNo);
      if (session) {
        const updatedSession: TransferInReceivingSession = {
          ...session,
          active_carton_id: normalizedCarton,
          updated_at: new Date().toISOString(),
        };
        await transferInReceivingSessionService.saveSession(updatedSession);
      } else {
        // Create new session if doesn't exist
        const newSession: TransferInReceivingSession = {
          session_id: sessionId || `TI-REC-${Date.now()}`,
          transfer_in_no: transferInNo,
          transaction_no: transactionNo || null,
          active_carton_id: normalizedCarton,
          status: "In Progress",
          started_by: settings.user_id || settings.user_code || "USER",
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          scanned_total: 0,
        };
        await transferInReceivingSessionService.saveSession(newSession);
      }

      // Navigate to Scan Items screen
      // ✅ Pass box_id from validation response (or from carton generation if validation didn't return it)
      // Priority: validatedBoxId (from validate-carton) > boxId (from state, created during generation)
      const finalBoxId = validatedBoxId || boxId || null;
      (navigation as any).navigate("TransferInReceivingScanItems", {
        transferInNo,
        sessionId: sessionId || `TI-REC-${Date.now()}`,
        transactionNo,
        cartonId: normalizedCarton,
        boxId: finalBoxId, // Pass box_id from validation (or generation) for use in putaway
      });
      
      if (finalBoxId) {
        console.log(`✅ Passing box_id to Scan Items screen: ${finalBoxId}`);
      } else {
        console.warn(`⚠️ No box_id available to pass to Scan Items screen. Putaway may require manual box selection.`);
      }
      return true;
    } catch (error: any) {
      setLoading(false);
      console.error("❌ Error scanning carton:", error);
      Alert.alert("Error", `Failed to scan carton: ${error.message}`);
      return false;
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerSection}>
        <Text style={styles.headerTitle}>Transfer In Receiving</Text>
        <Text style={styles.headerSubtitle}>Scan Carton ID</Text>
      </View>

      <View style={styles.infoSection}>
        <Text style={styles.transferInText}>Transfer In: {transferInNo || "N/A"}</Text>
        {transactionNo && (
          <View style={styles.taskBadge}>
            <Text style={styles.taskText}>Txn: {transactionNo}</Text>
          </View>
        )}
        <Text style={styles.scannedText}>0 item(s) scanned</Text>
      </View>

      <ScrollView 
        style={styles.cartonSection}
        contentContainerStyle={styles.cartonSectionContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.cartonHeader}>
          <Text style={styles.cartonIcon}>📦</Text>
          <View style={styles.cartonHeaderText}>
            <Text style={styles.cartonTitle}>Scan Carton ID</Text>
            <Text style={styles.cartonSubtitle}>
              Multiple cartons can be received. Scan carton ID first.
            </Text>
          </View>
        </View>
        <View style={styles.cartonInputRow}>
          <BarcodeInput
            ref={cartonInputRef}
            autoFocus
            placeholder="Scan or enter carton ID"
            onBarcodeScanned={async (raw) =>
              handleContinue(raw.trim().toUpperCase())
            }
            containerStyle={{ flex: 1 }}
            inputStyle={styles.cartonInput}
          />
        </View>

        {/* Use existing box – link warehouse box to this Transfer In if not already linked */}
        <View style={styles.useExistingBoxCard}>
          <View style={styles.useExistingBoxRow}>
            <Text style={styles.useExistingBoxLabel}>Use existing box</Text>
            <Switch
              value={useExistingBox}
              onValueChange={setUseExistingBox}
              trackColor={{ false: PickingTheme.colors.borderLight, true: PickingTheme.colors.buttonBlue || "#2196F3" }}
              thumbColor="#FFF"
            />
          </View>
          <Text style={styles.useExistingBoxHint}>
            When on, scanning a box that exists in the system but isn't linked to this Transfer In will link it and allow putaway.
          </Text>
        </View>

        {/* Generate & Print Buttons */}
        <View style={styles.actionButtonsRow}>
          <TouchableOpacity
            style={[styles.generateButton, generating && styles.buttonDisabled]}
            onPress={handleGenerateCartonId}
            disabled={generating || loading}
          >
            <Text style={styles.generateButtonText}>
              {generating ? "Generating..." : "🔢 Generate Carton ID"}
            </Text>
          </TouchableOpacity>
          
          {cartonId.trim() && (
            <TouchableOpacity
              style={styles.printButton}
              onPress={handlePrintBarcode}
              disabled={loading}
            >
              <Text style={styles.printButtonText}>🖨️ Print Barcode</Text>
            </TouchableOpacity>
          )}
        </View>
        
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={PickingTheme.colors.headerOrange} />
            <Text style={styles.loadingText}>Processing carton...</Text>
          </View>
        )}
        
        {cartonId.trim() && !loading && (
          <TouchableOpacity
            style={styles.continueButton}
            onPress={() => {
              void handleContinue();
            }}
            disabled={loading}
          >
            <Text style={styles.continueButtonText}>Continue to Item Scanning</Text>
          </TouchableOpacity>
        )}

        {/* Multiple Carton Instructions */}
        <View style={styles.instructionsCard}>
          <Text style={styles.instructionsTitle}>📋 How to Receive Multiple Cartons:</Text>
          <Text style={styles.instructionsText}>
            1. Generate or scan carton ID{'\n'}
            2. Continue to scan items for this carton{'\n'}
            3. After scanning items, tap "Change Carton" to start a new carton{'\n'}
            4. Repeat steps 1-3 for each additional carton{'\n'}
            5. Complete receiving when all cartons are done
          </Text>
        </View>
      </ScrollView>

      <ScreenFooterFrame />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PickingTheme.colors.backgroundLight,
  },
  headerSection: {
    backgroundColor: PickingTheme.colors.headerPurple,
    padding: PickingTheme.spacing.lg,
    paddingTop: 40,
  },
  headerTitle: {
    ...PickingTheme.typography.h1,
    color: PickingTheme.colors.textWhite,
    marginBottom: 4,
  },
  headerSubtitle: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textLight,
  },
  infoSection: {
    backgroundColor: PickingTheme.colors.headerPurple,
    paddingHorizontal: PickingTheme.spacing.lg,
    paddingBottom: PickingTheme.spacing.md,
  },
  transferInText: {
    ...PickingTheme.typography.h1,
    color: PickingTheme.colors.textWhite,
    marginBottom: PickingTheme.spacing.sm,
  },
  taskBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: PickingTheme.borderRadius.small,
    padding: PickingTheme.spacing.sm,
    marginBottom: PickingTheme.spacing.sm,
    alignSelf: "flex-start",
  },
  taskText: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textWhite,
  },
  scannedText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    opacity: 0.9,
  },
  cartonSection: {
    flex: 1,
    backgroundColor: PickingTheme.colors.headerOrange,
    borderTopLeftRadius: PickingTheme.borderRadius.xlarge,
    borderTopRightRadius: PickingTheme.borderRadius.xlarge,
    marginTop: PickingTheme.spacing.xs,
  },
  cartonSectionContent: {
    padding: PickingTheme.spacing.md,
    paddingTop: PickingTheme.spacing.sm,
    paddingBottom: PickingTheme.spacing.lg,
  },
  cartonHeaderText: {
    flex: 1,
  },
  cartonHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: PickingTheme.spacing.sm,
  },
  cartonIcon: {
    fontSize: 32,
    marginRight: PickingTheme.spacing.sm,
  },
  cartonTitle: {
    ...PickingTheme.typography.h1,
    color: PickingTheme.colors.textWhite,
    marginBottom: 2,
    fontSize: 20,
  },
  cartonSubtitle: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textWhite,
    opacity: 0.9,
    fontSize: 12,
  },
  cartonInputRow: {
    flexDirection: "row",
    gap: PickingTheme.spacing.md,
    marginTop: PickingTheme.spacing.sm,
  },
  cartonInput: {
    flex: 1,
    backgroundColor: PickingTheme.colors.backgroundLight,
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    ...PickingTheme.typography.body,
    fontSize: 16,
    borderWidth: 2,
    borderColor: PickingTheme.colors.borderLight,
  },
  loadingContainer: {
    alignItems: "center",
    marginTop: PickingTheme.spacing.lg,
  },
  loadingText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    marginTop: PickingTheme.spacing.sm,
  },
  continueButton: {
    backgroundColor: PickingTheme.colors.backgroundLight,
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    marginTop: PickingTheme.spacing.lg,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  continueButtonText: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.headerOrange,
    fontWeight: "600",
  },
  actionButtonsRow: {
    flexDirection: "row",
    gap: PickingTheme.spacing.sm,
    marginTop: PickingTheme.spacing.md,
  },
  generateButton: {
    flex: 1,
    backgroundColor: PickingTheme.colors.buttonBlue || "#2196F3",
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  generateButtonText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
    fontSize: 14,
  },
  printButton: {
    flex: 1,
    backgroundColor: PickingTheme.colors.statusDone || "#4CAF50",
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  printButtonText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  instructionsCard: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    marginTop: PickingTheme.spacing.lg,
  },
  instructionsTitle: {
    ...PickingTheme.typography.h3,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
    marginBottom: PickingTheme.spacing.sm,
    fontSize: 16,
  },
  instructionsText: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    fontSize: 13,
    lineHeight: 20,
    opacity: 0.95,
  },
  useExistingBoxCard: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    marginTop: PickingTheme.spacing.md,
  },
  useExistingBoxRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  useExistingBoxLabel: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    fontWeight: "600",
    flex: 1,
  },
  useExistingBoxHint: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textWhite,
    opacity: 0.9,
    marginTop: 4,
    fontSize: 12,
  },
});
