import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { PickingTheme } from "../theme/picking-theme";
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import { apiService } from "../services/api.service";
import { relocationSessionService } from "../services/relocation-session.service";
import {
  BarcodeInput,
  type BarcodeInputHandle,
} from "../components/BarcodeInput";

export default function RelocationScanFromCartonScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const routeParams = (route.params as any) || {};
  const { sessionId, mode, fromBin, binInfo } = routeParams;
  
  // Get fromBin from session if not in params
  const [currentFromBin, setCurrentFromBin] = useState<string | null>(fromBin || null);
  
  useEffect(() => {
    const loadFromBin = async () => {
      if (!fromBin) {
        const session = await relocationSessionService.loadSession();
        if (session?.from_bin) {
          setCurrentFromBin(session.from_bin);
        }
      }
    };
    loadFromBin();
  }, [fromBin]);

  const [cartonId, setCartonId] = useState("");
  const [loading, setLoading] = useState(false);
  const cartonInputRef = useRef<BarcodeInputHandle>(null);
  const lastScanTimeRef = useRef<number>(0);
  const SCAN_DEBOUNCE_MS = 700;

  useEffect(() => {
    // Auto-focus input on mount
    setTimeout(() => {
      cartonInputRef.current?.focus();
    }, 100);
  }, []);

  // Internal function to save carton and navigate (ONLY called after validation passes)
  const saveCartonAndNavigate = async (explicitCarton?: string) => {
    const normalizedCarton = (explicitCarton ?? cartonId).trim().toUpperCase();
    const binToUse = currentFromBin || fromBin;

    if (!normalizedCarton || !binToUse) {
      Alert.alert("Error", "Carton ID and bin location are required");
      return;
    }

    // ✅ NEW APPROACH: Update local session only - NO backend API call
    // Validation will happen when user clicks "Complete"
    await relocationSessionService.updateSession({
      from_carton: normalizedCarton,
      status: "In Progress",
    });

    console.log(`✅ Saved FROM carton to local session: ${normalizedCarton} (no backend call)`);

    // ✅ Only navigate if validation passed - this function is only called after successful validation
    (navigation as any).navigate("RelocationScanToBin", {
      sessionId,
      mode,
      fromBin: binToUse,
      fromCarton: normalizedCarton,
      binInfo,
    });
  };

  // ✅ VALIDATION: Validate carton exists and optionally check location
  // Note: Full location validation will happen when user clicks "Complete"
  const validateCartonLocation = async (cartonId: string, binLocation: string) => {
    if (!cartonId || !cartonId.trim() || !binLocation) {
      return { valid: false, message: "Carton ID and bin location are required" };
    }

    try {
      const normalizedCarton = cartonId.trim().toUpperCase();
      
      console.log(`🔍 [VALIDATION] Validating carton ${normalizedCarton}`);
      
      // ✅ NEW APPROACH: Just validate carton exists (via getCartonContents or local cache)
      // Full location validation will happen when Complete is clicked
      // For now, we just check if carton can be found
      try {
        // Try to get carton contents to verify carton exists
        const contents = await apiService.getCartonContents(normalizedCarton);
        // If we get a response (even if empty), carton exists
        console.log(`✅ [VALIDATION] Carton ${normalizedCarton} exists`);
        return { valid: true };
      } catch (cartonError: any) {
        // Carton not found or API unavailable
        const isNotFound = 
          cartonError.status === 404 || 
          cartonError.code === "NOT_FOUND" ||
          cartonError.code === "CARTON_NOT_FOUND" ||
          cartonError.message?.includes("not found") ||
          cartonError.message?.includes("NOT_FOUND");
        
        if (isNotFound) {
          // Extract error message
          let errorMessage = `Carton ${normalizedCarton} not found`;
          try {
            const errorData = cartonError.data || cartonError.response?.data;
            if (errorData?.message) {
              errorMessage = String(errorData.message);
            } else if (cartonError.message) {
              const jsonMatch = cartonError.message.match(/\{.*\}/);
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                errorMessage = parsed.error?.message || parsed.message || errorMessage;
              }
            }
          } catch {}
          
          return { valid: false, message: errorMessage };
        }
        
        // Other errors (network, etc.) - allow to continue (validation happens on Complete)
        console.warn(`⚠️ [VALIDATION] Carton validation unavailable, will validate on Complete:`, cartonError.message);
        return { valid: true };
      }
    } catch (error: any) {
      // ✅ DEBUG: Log full error details
      console.error(`❌ [VALIDATION] Error validating carton ${cartonId} at bin ${binLocation}:`, {
        error,
        message: error?.message,
        status: error?.status,
        code: error?.code,
        toString: error?.toString(),
        fullError: JSON.stringify(error, null, 2),
      });
      
      // Check if it's a validation error from backend
      const errorMessageStr = error?.message || error?.toString() || String(error) || "";
      const errorStatus = error?.status || error?.response?.status || (() => {
        // Try to extract status from error message format: "API error (400): ..."
        const statusMatch = errorMessageStr.match(/API error \((\d+)\)/);
        return statusMatch ? parseInt(statusMatch[1]) : null;
      })();
      
      // Parse error structure - handle nested error objects
      let errorCode = error?.code || error?.response?.data?.code || error?.data?.code;
      let errorResponse = error?.response?.data || error?.data;
      
      // Try to parse JSON from error message if errorResponse is not available
      if (!errorResponse) {
        try {
          const jsonMatch = errorMessageStr.match(/\{.*\}/);
          if (jsonMatch) {
            errorResponse = JSON.parse(jsonMatch[0]);
            // Handle nested error structure: {"ok": false, "error": {"code": "...", "message": "..."}}
            if (errorResponse?.error) {
              errorCode = errorResponse.error.code || errorCode;
              errorResponse = errorResponse.error;
            }
          }
        } catch (parseErr) {
          console.warn(`⚠️ [VALIDATION] Failed to parse error JSON:`, parseErr);
        }
      } else {
        // Handle nested error structure: {"ok": false, "error": {"code": "...", "message": "..."}}
        if (errorResponse?.error) {
          errorCode = errorResponse.error.code || errorCode;
          errorResponse = errorResponse.error;
        }
      }
      
      console.log(`🔍 [VALIDATION] Error details:`, {
        errorMessageStr,
        errorStatus,
        errorCode,
        errorResponse,
        errorObject: error,
        includesValidation: errorMessageStr.includes("VALIDATION_ERROR"),
        includesLocation: errorMessageStr.includes("currently located at") || errorMessageStr.includes("not at"),
        includesNotFound: errorMessageStr.includes("not found") || errorCode === "NOT_FOUND",
      });
      
      // ✅ Show alert for validation errors AND not found errors (carton doesn't exist)
      const isValidationError = 
        errorStatus === 400 || 
        errorStatus === 404 ||
        errorCode === "VALIDATION_ERROR" ||
        errorCode === "NOT_FOUND" ||
        errorCode === "CARTON_NOT_FOUND" ||
        errorResponse?.code === "VALIDATION_ERROR" ||
        errorResponse?.code === "NOT_FOUND" ||
        errorResponse?.code === "CARTON_NOT_FOUND" ||
        errorMessageStr.includes("VALIDATION_ERROR") ||
        errorMessageStr.includes("CARTON_NOT_FOUND") ||
        errorMessageStr.includes("currently located at") ||
        errorMessageStr.includes("not at") ||
        errorMessageStr.includes("not found") ||
        errorMessageStr.toLowerCase().includes("carton") && errorMessageStr.toLowerCase().includes("not found");
      
      if (isValidationError) {
        // Extract error message from backend response
        let errorMessage = "Invalid carton location";
        
        try {
          // ✅ Priority 1: Try to get message from errorResponse object (parsed from nested structure)
          if (errorResponse?.message) {
            errorMessage = String(errorResponse.message);
            console.log(`✅ [VALIDATION] Extracted message from errorResponse: ${errorMessage}`);
          } 
          // ✅ Priority 2: Try to get message from error.data or error.response.data
          else if (error?.data?.message) {
            errorMessage = String(error.data.message);
            console.log(`✅ [VALIDATION] Extracted message from error.data: ${errorMessage}`);
          }
          // ✅ Priority 3: Try to parse JSON from error message string
          else if (typeof errorMessageStr === 'string') {
            // Format: "API error (400): {"code":"VALIDATION_ERROR","message":"Carton CTN-555445 is currently located at..."}"
            // OR: "API error (404): {"ok":false,"error":{"code":"NOT_FOUND","message":"Carton not found"}}"
            const jsonMatch = errorMessageStr.match(/\{.*\}/);
            if (jsonMatch) {
              try {
                const errorData = JSON.parse(jsonMatch[0]);
                // Handle nested error structure
                if (errorData?.error?.message) {
                  errorMessage = String(errorData.error.message);
                } else if (errorData?.message) {
                  errorMessage = String(errorData.message);
                } else {
                  errorMessage = errorMessage || "Invalid carton location";
                }
                console.log(`✅ [VALIDATION] Extracted message from JSON: ${errorMessage}`);
              } catch (parseError) {
                console.warn(`⚠️ [VALIDATION] Failed to parse JSON:`, parseError);
                // Fall through to regex extraction
              }
            }
            
            // ✅ Priority 4: Try to extract message using regex if JSON parsing failed
            if (errorMessage === "Invalid carton location") {
              const messageMatch = errorMessageStr.match(/message["\s:]+"([^"]+)"/);
              if (messageMatch && messageMatch[1]) {
                errorMessage = messageMatch[1];
                console.log(`✅ [VALIDATION] Extracted message from regex: ${errorMessage}`);
              } else {
                // Remove "API error (400):" prefix and try to clean up
                errorMessage = errorMessageStr.replace(/^API error \(\d+\):\s*/, "").trim();
                // Remove JSON wrapper if present
                if (errorMessage.startsWith("{") && errorMessage.endsWith("}")) {
                  try {
                    const parsed = JSON.parse(errorMessage);
                    errorMessage = parsed.error?.message || parsed.message || errorMessage;
                  } catch {}
                }
                if (!errorMessage || errorMessage === "") {
                  errorMessage = "Invalid carton location";
                }
                console.log(`✅ [VALIDATION] Extracted message from cleaned string: ${errorMessage}`);
              }
            }
          }
        } catch (parseError) {
          console.error(`❌ [VALIDATION] Error parsing error message:`, parseError);
          errorMessage = errorMessageStr.replace(/^API error \(\d+\):\s*/, "").trim() || "Invalid carton location";
        }
        
        console.log(`❌ [VALIDATION] Validation failed - returning error: ${errorMessage}`);
        
        // ❌ VALIDATION FAILED - DO NOT ALLOW NAVIGATION
        return { valid: false, message: errorMessage };
      }
      
      // ❌ STRICT MODE: If backend is unavailable or returns any error, block navigation
      // User must scan correct carton at correct location - no fallback
      console.error("❌ [VALIDATION] Backend validation failed - blocking navigation:", errorMessageStr);
      return { 
        valid: false, 
        message: `Cannot validate carton location. Please ensure carton ${cartonId} is at bin ${binLocation} and try again. Error: ${errorMessageStr.substring(0, 100)}` 
      };
    }
  };

  // Handle when user submits carton ID (Enter key or scanner) - validates immediately
  const handleCartonSubmit = async (
    scannedValue?: string
  ): Promise<boolean> => {
    const effectiveCarton = (scannedValue !== undefined ? scannedValue : cartonId).trim();
    console.log(`🔍 [SUBMIT] handleCartonSubmit called with cartonId: "${effectiveCarton}"`);
    
    if (!effectiveCarton) {
      console.warn(`⚠️ [SUBMIT] Empty carton ID`);
      Alert.alert("Error", "Please scan or enter a carton ID");
      return false;
    }

    // ✅ Client-side validation: Check if user accidentally scanned a bin code instead of carton ID
    const normalizedCarton = effectiveCarton.toUpperCase();
    // Bin codes typically match pattern like "A1-R01-L3-B1" (alphanumeric with dashes)
    // Carton IDs typically start with "CTN-" or have different pattern
    // Simple check: If it looks like a bin code (matches bin location pattern), warn user
    const binCodePattern = /^[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+$/i;
    if (binCodePattern.test(normalizedCarton) && !normalizedCarton.startsWith("CTN")) {
      Alert.alert(
        "Invalid Input",
        `"${normalizedCarton}" looks like a bin location code, not a carton ID.\n\n` +
        `Carton IDs typically start with "CTN-" prefix.\n\n` +
        `Please scan a valid carton ID (e.g., CTN-12345).`,
        [{ text: "OK" }]
      );
      setCartonId("");
      setTimeout(() => {
        cartonInputRef.current?.focus();
      }, 100);
      return false;
    }

    // Debounce: prevent duplicate processing
    const now = Date.now();
    if (now - lastScanTimeRef.current < SCAN_DEBOUNCE_MS) {
      console.log("⏭️ Debounced duplicate scan");
      return true;
    }
    lastScanTimeRef.current = now;

    const binToUse = currentFromBin || fromBin;
    if (!binToUse) {
      console.warn(`⚠️ [SUBMIT] No bin location available`);
      Alert.alert("Error", "Bin location is required");
      return false;
    }

    console.log(`🔍 [SUBMIT] Starting validation - cartonId: "${effectiveCarton}", bin: "${binToUse}"`);

    setLoading(true);
    try {
      // ✅ IMMEDIATE VALIDATION: Validate carton location right away with backend
      console.log(`🔍 [SUBMIT] Starting validation for carton: "${effectiveCarton}" at bin: "${binToUse}"`);
      const validation = await validateCartonLocation(effectiveCarton, binToUse);
      
      console.log(`🔍 [SUBMIT] Validation result:`, {
        valid: validation.valid,
        message: validation.message,
        hasMessage: !!validation.message,
      });
      
      // ✅ Always check validation result and show Alert if invalid
      if (!validation.valid) {
        // Show validation error immediately - don't proceed
        const errorMessage = validation.message || "Invalid carton location";
        console.log(`❌ [SUBMIT] Validation failed - showing alert: "${errorMessage}"`);
        console.log(`❌ [SUBMIT] Validation object:`, JSON.stringify(validation, null, 2));
        
        // ✅ Ensure loading is set to false before showing alert
        setLoading(false);
        
        // ✅ CRITICAL: Show Alert immediately - use requestAnimationFrame to ensure UI is ready
        requestAnimationFrame(() => {
          Alert.alert(
            "Validation Error",
            errorMessage,
            [{ 
              text: "OK",
              onPress: () => {
                console.log(`✅ [SUBMIT] User dismissed validation error alert`);
                // Clear the input so user can scan again
                setCartonId("");
                setTimeout(() => {
                  cartonInputRef.current?.focus();
                }, 100);
              }
            }],
            { cancelable: false } // Prevent dismissing by tapping outside
          );
        });
        
        return false;
      }
      
      if (validation.valid) {
        console.log(`✅ [SUBMIT] Validation passed - navigating to next screen`);
      } else {
        console.warn(`⚠️ [SUBMIT] Validation returned invalid but no message - this shouldn't happen`);
      }
      
      // ✅ Validation passed - save to session and navigate
      await saveCartonAndNavigate(effectiveCarton);
      return true;
    } catch (error: any) {
      setLoading(false);
      console.error("❌ [SUBMIT] Error in handleCartonSubmit:", error);
      Alert.alert("Error", `Failed to validate carton: ${error.message || error.toString()}`);
      return false;
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerSection}>
        <Text style={styles.headerTitle}>Relocation / Bin Transfer</Text>
        <Text style={styles.headerSubtitle}>Scan FROM Carton ID</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <View style={styles.scanCard}>
          <Text style={styles.scanCardIcon}>📦</Text>
          <View style={styles.scanCardContent}>
            <Text style={styles.scanCardTitle}>Scan FROM Carton ID</Text>
            <Text style={styles.scanCardSubtitle}>
              Scan or enter the carton ID where items are currently located
            </Text>
          </View>
        </View>

        <View style={styles.inputSection}>
          <Text style={styles.inputLabel}>Carton ID</Text>
          <BarcodeInput
            ref={cartonInputRef}
            autoFocus
            placeholder="Scan or enter carton ID"
            onChangeText={(t) => setCartonId(t.toUpperCase())}
            onBarcodeScanned={async (raw) =>
              handleCartonSubmit(raw.trim().toUpperCase())
            }
            containerStyle={{ alignSelf: "stretch" }}
            inputStyle={styles.input}
          />
        </View>

        {cartonId.trim() && !loading && (
          <TouchableOpacity
            style={styles.continueButton}
            onPress={() => {
              void handleCartonSubmit();
            }}
            disabled={loading}
          >
            <Text style={styles.continueButtonText}>Continue to Scan TO Bin</Text>
          </TouchableOpacity>
        )}

        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={PickingTheme.colors.headerOrange} />
            <Text style={styles.loadingText}>Processing...</Text>
          </View>
        )}
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
  content: {
    flex: 1,
    backgroundColor: PickingTheme.colors.headerOrange,
    borderTopLeftRadius: PickingTheme.borderRadius.xlarge,
    borderTopRightRadius: PickingTheme.borderRadius.xlarge,
    marginTop: PickingTheme.spacing.xs,
  },
  contentContainer: {
    padding: PickingTheme.spacing.md,
  },
  scanCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: PickingTheme.borderRadius.medium,
    padding: PickingTheme.spacing.md,
    marginBottom: PickingTheme.spacing.md,
  },
  scanCardIcon: {
    fontSize: 32,
    marginRight: PickingTheme.spacing.md,
  },
  scanCardContent: {
    flex: 1,
  },
  scanCardTitle: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.textWhite,
    marginBottom: 4,
  },
  scanCardSubtitle: {
    ...PickingTheme.typography.caption,
    color: PickingTheme.colors.textWhite,
    opacity: 0.9,
  },
  inputSection: {
    marginBottom: PickingTheme.spacing.md,
  },
  inputLabel: {
    ...PickingTheme.typography.body,
    color: PickingTheme.colors.textWhite,
    marginBottom: PickingTheme.spacing.sm,
    fontWeight: "600",
  },
  input: {
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
    ...PickingTheme.shadows.button,
  },
  continueButtonText: {
    ...PickingTheme.typography.h2,
    color: PickingTheme.colors.headerOrange,
    fontWeight: "600",
  },
});
