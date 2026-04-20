import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { getSettings } from "../services/settings.service";
import { getDatabase } from "../database/database";
import { apiService } from "../services/api.service";
import { BarcodeScanner } from "../components/BarcodeScanner";
import {
  clearScannerTimer,
  onScannerTextChange,
} from "../utils/hardwareScannerInput";

export default function MaterialRequestScanLocationScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const routeParams = (route.params as any) || {};
  const { materialRequestTitle } = routeParams;

  const [binLocation, setBinLocation] = useState("");
  const [cartonId, setCartonId] = useState("");
  const [loading, setLoading] = useState(false);
  const [binInfo, setBinInfo] = useState<any>(null);
  const [cartonInfo, setCartonInfo] = useState<any>(null);
  const [step, setStep] = useState<"location" | "carton">("location");
  const [checkingSession, setCheckingSession] = useState(true);
  
  const binLocationInputRef = useRef<TextInput>(null);
  const cartonIdInputRef = useRef<TextInput>(null);
  const binScanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cartonScanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showBinScanner, setShowBinScanner] = useState(false);
  const [showCartonScanner, setShowCartonScanner] = useState(false);

  // ✅ Check for existing picking session (location and carton)
  useEffect(() => {
    const checkExistingSession = async () => {
      if (!materialRequestTitle) return;

      try {
        const db = await getDatabase();
        const session = await db.getFirstAsync<{
          bin_location: string | null;
          carton_id: string | null;
        }>(
          `SELECT bin_location, carton_id 
           FROM material_request_picking_sessions 
           WHERE material_request_title = ? 
           ORDER BY updated_at DESC LIMIT 1`,
          [materialRequestTitle]
        );

        if (session) {
          console.log(`📋 Found existing picking session:`, {
            bin_location: session.bin_location,
            carton_id: session.carton_id,
          });

          // If both location and carton exist, go directly to packing screen
          if (session.bin_location && session.carton_id) {
            console.log(`✅ Both location and carton exist - navigating to packing screen`);
            // Get bin info
            const binData = await db.getFirstAsync<any>(
              "SELECT * FROM bin_master_cache WHERE bin_code = ? OR bin_barcode = ? OR bin_id = ?",
              [session.bin_location, session.bin_location, session.bin_location]
            );
            
            (navigation as any).navigate("MaterialRequestPacking", {
              materialRequestTitle,
              binLocation: session.bin_location,
              binInfo: binData,
              cartonId: session.carton_id,
            });
            return;
          }

          // If only location exists, show carton scanning screen
          if (session.bin_location && !session.carton_id) {
            console.log(`✅ Location exists but carton is null - showing carton scan screen`);
            const binData = await db.getFirstAsync<any>(
              "SELECT * FROM bin_master_cache WHERE bin_code = ? OR bin_barcode = ? OR bin_id = ?",
              [session.bin_location, session.bin_location, session.bin_location]
            );
            setBinLocation(session.bin_location);
            setBinInfo(binData);
            setStep("carton");
          }

          // If location exists, restore it
          if (session.bin_location) {
            const binData = await db.getFirstAsync<any>(
              "SELECT * FROM bin_master_cache WHERE bin_code = ? OR bin_barcode = ? OR bin_id = ?",
              [session.bin_location, session.bin_location, session.bin_location]
            );
            setBinLocation(session.bin_location);
            setBinInfo(binData);
          }
        }
      } catch (error: any) {
        console.warn(`⚠️ Error checking picking session:`, error.message);
      } finally {
        setCheckingSession(false);
      }
    };

    checkExistingSession();
  }, [materialRequestTitle]);

  useEffect(() => {
    if (step === "location" && binLocationInputRef.current) {
      setTimeout(() => {
        binLocationInputRef.current?.focus();
      }, 100);
    } else if (step === "carton" && cartonIdInputRef.current) {
      setTimeout(() => {
        cartonIdInputRef.current?.focus();
      }, 100);
    }
  }, [step]);

  const validateBinLocation = async (bin: string) => {
    if (!bin || !bin.trim()) return;

    setLoading(true);
    try {
      const db = await getDatabase();
      const normalizedBin = bin.trim().toUpperCase();

      // Check local database first
      const localBin = await db.getFirstAsync<any>(
        "SELECT * FROM bin_master_cache WHERE bin_code = ? OR bin_barcode = ? OR bin_id = ?",
        [normalizedBin, normalizedBin, normalizedBin]
      );

      if (localBin) {
        console.log(`✅ Bin found in local database: ${localBin.bin_code}`);
        setBinInfo(localBin);
        setBinLocation(localBin.bin_code);
        
        // Validate on backend if online (non-blocking)
        try {
          await apiService.getBinMaster(normalizedBin);
        } catch (backendError: any) {
          console.warn(`⚠️ Backend validation failed (non-blocking):`, backendError.message);
        }

        // ✅ Save bin location to picking session
        try {
          const session = await db.getFirstAsync<{ session_id: string }>(
            `SELECT session_id FROM material_request_picking_sessions 
             WHERE material_request_title = ? 
             ORDER BY updated_at DESC LIMIT 1`,
            [materialRequestTitle]
          );

          if (session) {
            await db.runAsync(
              `UPDATE material_request_picking_sessions 
               SET bin_location = ?, updated_at = ? 
               WHERE session_id = ?`,
              [localBin.bin_code, new Date().toISOString(), session.session_id]
            );
          } else {
            // Create new session if doesn't exist
            const settings = await getSettings();
            const sessionId = `MR-PICK-${materialRequestTitle}-${Date.now()}`;
            await db.runAsync(
              `INSERT INTO material_request_picking_sessions (
                session_id, material_request_title, bin_location, status, 
                started_by, started_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                sessionId,
                materialRequestTitle,
                localBin.bin_code,
                "Draft",
                settings.user_id || "",
                new Date().toISOString(),
                new Date().toISOString(),
              ]
            );
          }
        } catch (error: any) {
          console.warn(`⚠️ Error saving bin location to session:`, error.message);
        }

        setLoading(false);
        setStep("carton");
        return;
      }

      // If not found locally, try backend
      try {
        const backendBin = await apiService.getBinMaster(normalizedBin);
        if (backendBin && (backendBin.bin_code || backendBin.bin_id)) {
          const binData = {
            bin_code: backendBin.bin_code || backendBin.bin_id || normalizedBin,
            bin_id: backendBin.bin_id || backendBin.bin_code || normalizedBin,
            bin_barcode: backendBin.bin_barcode || normalizedBin,
            warehouse_id: backendBin.warehouse_id || "",
            zone: backendBin.zone || "",
          };

          // Save to local cache
          await db.runAsync(
            `INSERT OR REPLACE INTO bin_master_cache 
             (bin_code, bin_id, bin_barcode, warehouse_id, zone, updated_on)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              binData.bin_code,
              binData.bin_id,
              binData.bin_barcode,
              binData.warehouse_id,
              binData.zone,
              new Date().toISOString(),
            ]
          );

        setBinInfo(binData);
        setBinLocation(binData.bin_code);
        setLoading(false);
        
        // ✅ Save bin location to picking session
        try {
          const session = await db.getFirstAsync<{ session_id: string }>(
            `SELECT session_id FROM material_request_picking_sessions 
             WHERE material_request_title = ? 
             ORDER BY updated_at DESC LIMIT 1`,
            [materialRequestTitle]
          );

          if (session) {
            await db.runAsync(
              `UPDATE material_request_picking_sessions 
               SET bin_location = ?, updated_at = ? 
               WHERE session_id = ?`,
              [binData.bin_code, new Date().toISOString(), session.session_id]
            );
          } else {
            // Create new session if doesn't exist
            const settings = await getSettings();
            const sessionId = `MR-PICK-${materialRequestTitle}-${Date.now()}`;
            await db.runAsync(
              `INSERT INTO material_request_picking_sessions (
                session_id, material_request_title, bin_location, status, 
                started_by, started_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                sessionId,
                materialRequestTitle,
                binData.bin_code,
                "Draft",
                settings.user_id || "",
                new Date().toISOString(),
                new Date().toISOString(),
              ]
            );
          }
        } catch (error: any) {
          console.warn(`⚠️ Error saving bin location to session:`, error.message);
        }
        
        setStep("carton");
        } else {
          throw new Error("Bin not found");
        }
      } catch (backendError: any) {
        setLoading(false);
        Alert.alert(
          "Bin Not Found",
          `Bin location "${normalizedBin}" not found.\n\nPlease scan a valid bin location.`
        );
        setBinInfo(null);
        setBinLocation("");
      }
    } catch (error: any) {
      setLoading(false);
      console.error("❌ Error validating bin location:", error);
      Alert.alert("Error", `Failed to validate bin location: ${error.message}`);
    }
  };

  const validateCartonId = async (carton: string) => {
    if (!carton || !carton.trim()) return;

    setLoading(true);
    try {
      const normalizedCarton = carton.trim().toUpperCase();
      
      // For now, just accept any carton ID (can add validation later if needed)
      setCartonInfo({ carton_id: normalizedCarton });
      setCartonId(normalizedCarton);
      setLoading(false);

      // ✅ Save carton ID to picking session
      try {
        const db = await getDatabase();
        const session = await db.getFirstAsync<{ session_id: string }>(
          `SELECT session_id FROM material_request_picking_sessions 
           WHERE material_request_title = ? 
           ORDER BY updated_at DESC LIMIT 1`,
          [materialRequestTitle]
        );

        if (session) {
          await db.runAsync(
            `UPDATE material_request_picking_sessions 
             SET carton_id = ?, updated_at = ? 
             WHERE session_id = ?`,
            [normalizedCarton, new Date().toISOString(), session.session_id]
          );
        }
      } catch (error: any) {
        console.warn(`⚠️ Error saving carton ID to session:`, error.message);
      }

      // Navigate to packing screen with location and carton
      (navigation as any).navigate("MaterialRequestPacking", {
        materialRequestTitle,
        binLocation: binInfo?.bin_code || binLocation,
        binInfo,
        cartonId: normalizedCarton,
      });
    } catch (error: any) {
      setLoading(false);
      console.error("❌ Error validating carton ID:", error);
      Alert.alert("Error", `Failed to validate carton ID: ${error.message}`);
    }
  };

  const handleBinLocationSubmit = () => {
    clearScannerTimer(binScanTimerRef);
    if (binLocation.trim()) {
      validateBinLocation(binLocation.trim());
    }
  };

  const handleCartonIdSubmit = () => {
    clearScannerTimer(cartonScanTimerRef);
    if (cartonId.trim()) {
      validateCartonId(cartonId.trim());
    }
  };

  const handleBinLocationTextChange = (text: string) => {
    onScannerTextChange(
      text,
      (d) => {
        const u = d.toUpperCase();
        setBinLocation(u);
        if (!u.trim()) {
          setBinInfo(null);
        }
      },
      binScanTimerRef,
      (cleaned) => validateBinLocation(cleaned.trim())
    );
  };

  const handleCartonIdTextChange = (text: string) => {
    onScannerTextChange(
      text,
      setCartonId,
      cartonScanTimerRef,
      (cleaned) => void validateCartonId(cleaned.trim())
    );
  };

  const handleBinScan = (barcode: string) => {
    setBinLocation(barcode);
    setShowBinScanner(false);
    validateBinLocation(barcode);
  };

  const handleCartonScan = (barcode: string) => {
    setCartonId(barcode);
    setShowCartonScanner(false);
    validateCartonId(barcode);
  };

  if (checkingSession) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#FF9800" style={styles.loadingContainer} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  // ✅ Show only ONE step at a time - full screen for each step
  if (step === "location") {
    return (
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Material Request Picking</Text>
          <Text style={styles.headerSubtitle}>Scan or Enter Bin Code</Text>
        </View>

        <View style={styles.inputSection}>
          <Text style={styles.inputLabel}>Bin Code</Text>
          <View style={styles.inputRow}>
            <TextInput
              ref={binLocationInputRef}
              style={styles.input}
              value={binLocation}
              onChangeText={handleBinLocationTextChange}
              placeholder="Scan or enter bin code"
              autoCapitalize="characters"
              autoFocus={true}
              showSoftInputOnFocus={false}
              onSubmitEditing={handleBinLocationSubmit}
            />
            <TouchableOpacity
              style={styles.scanButton}
              onPress={() => setShowBinScanner(true)}
            >
              <Text style={styles.scanButtonText}>📷 Scan</Text>
            </TouchableOpacity>
          </View>
          {loading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#9C27B0" />
              <Text style={styles.loadingText}>Validating bin...</Text>
            </View>
          )}
          {binInfo && !loading && (
            <View style={styles.binInfoCard}>
              <Text style={styles.binInfoTitle}>Bin Information</Text>
              <View style={styles.binInfoRow}>
                <Text style={styles.binInfoLabel}>Bin Code:</Text>
                <Text style={styles.binInfoValue}>{binInfo.bin_code}</Text>
              </View>
              {binInfo.warehouse_id && (
                <View style={styles.binInfoRow}>
                  <Text style={styles.binInfoLabel}>Warehouse:</Text>
                  <Text style={styles.binInfoValue}>{binInfo.warehouse_id}</Text>
                </View>
              )}
              {binInfo.zone && (
                <View style={styles.binInfoRow}>
                  <Text style={styles.binInfoLabel}>Zone:</Text>
                  <Text style={styles.binInfoValue}>{binInfo.zone}</Text>
                </View>
              )}
              {binInfo.aisle && (
                <View style={styles.binInfoRow}>
                  <Text style={styles.binInfoLabel}>Aisle:</Text>
                  <Text style={styles.binInfoValue}>{binInfo.aisle}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        <BarcodeScanner
          visible={showBinScanner}
          onScan={handleBinScan}
          onClose={() => setShowBinScanner(false)}
        />
      </ScrollView>
    );
  }

  // ✅ Step 2: Carton ID scanning (full screen orange section)
  return (
    <View style={styles.container}>
      <View style={styles.cartonHeaderSection}>
        <Text style={styles.cartonHeaderTitle}>Material Request Picking</Text>
        <Text style={styles.cartonHeaderSubtitle}>Scan Carton ID</Text>
      </View>
      <View style={styles.cartonSection}>
        <View style={styles.cartonHeader}>
          <Text style={styles.cartonIcon}>📦</Text>
          <View>
            <Text style={styles.cartonTitle}>Scan Carton ID</Text>
            <Text style={styles.cartonSubtitle}>
              One bin can have multiple cartons. Please scan the carton ID first.
            </Text>
          </View>
        </View>
        <View style={styles.cartonInputRow}>
          <TextInput
            ref={cartonIdInputRef}
            style={styles.cartonInput}
            value={cartonId}
            onChangeText={handleCartonIdTextChange}
            placeholder="Scan or enter carton ID"
            autoCapitalize="characters"
            autoFocus={true}
            showSoftInputOnFocus={false}
            onSubmitEditing={handleCartonIdSubmit}
          />
          <TouchableOpacity
            style={styles.cartonScanButton}
            onPress={() => setShowCartonScanner(true)}
          >
            <Text style={styles.cartonScanButtonText}>📷 Scan</Text>
          </TouchableOpacity>
        </View>
        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#FF9800" />
          </View>
        )}
      </View>

      <BarcodeScanner
        visible={showCartonScanner}
        onScan={handleCartonScan}
        onClose={() => setShowCartonScanner(false)}
      />
    </View>
  );

}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  header: {
    backgroundColor: "#9C27B0",
    padding: 24,
    paddingTop: 40,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#FFF",
    marginBottom: 5,
  },
  headerSubtitle: {
    fontSize: 16,
    color: "#E1BEE7",
  },
  inputSection: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: "row",
    gap: 12,
  },
  input: {
    flex: 1,
    backgroundColor: "#FFF",
    borderWidth: 2,
    borderColor: "#9C27B0",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  scanButton: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    justifyContent: "center",
  },
  scanButtonText: {
    color: "#FFF",
    fontWeight: "600",
    fontSize: 16,
  },
  loadingContainer: {
    padding: 20,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: "#666",
  },
  binInfoCard: {
    backgroundColor: "#FFF",
    borderRadius: 8,
    padding: 15,
    marginTop: 15,
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  binInfoTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 10,
  },
  binInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  binInfoLabel: {
    fontSize: 14,
    color: "#666",
  },
  binInfoValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  cartonHeaderSection: {
    backgroundColor: "#9C27B0",
    padding: 24,
    paddingTop: 40,
  },
  cartonHeaderTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#FFF",
    marginBottom: 5,
  },
  cartonHeaderSubtitle: {
    fontSize: 16,
    color: "#E1BEE7",
  },
  cartonSection: {
    flex: 1,
    backgroundColor: "#FF9800",
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  cartonHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  cartonIcon: {
    fontSize: 40,
    marginRight: 15,
  },
  cartonTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#FFF",
    marginBottom: 5,
  },
  cartonSubtitle: {
    fontSize: 14,
    color: "#FFF",
    opacity: 0.9,
  },
  cartonInputRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
  },
  cartonInput: {
    flex: 1,
    backgroundColor: "#FFF",
    borderRadius: 8,
    padding: 15,
    fontSize: 16,
  },
  cartonScanButton: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 8,
    justifyContent: "center",
  },
  cartonScanButtonText: {
    color: "#FFF",
    fontWeight: "600",
    fontSize: 16,
  },
});
