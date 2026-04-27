import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { getSettings } from "../services/settings.service";
import { getDatabase } from "../database/database";
import { generateUUID } from "../utils/uuid";
import { syncCycleCountSessions } from "../services/cycle-count-sync.service";
import { apiService } from "../services/api.service";
import { isDeviceOnline } from "../utils/network-check";
import {
  BarcodeInput,
  type BarcodeInputHandle,
} from "../components/BarcodeInput";

export default function CycleCountScanBinScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const routeParams = (route.params as any) || {};
  const { countType, preCreatedTaskTitle, preCreatedBinCode, preCreatedSessionId } = routeParams;
  
  const [binCode, setBinCode] = useState(preCreatedBinCode || "");
  const [loading, setLoading] = useState(false);
  const [binInfo, setBinInfo] = useState<any>(null);
  const [isBlindCount, setIsBlindCount] = useState(false);
  const binCodeInputRef = useRef<BarcodeInputHandle>(null);

  // If task was pre-created with a bin code, auto-validate it
  useEffect(() => {
    if (preCreatedBinCode && preCreatedBinCode.trim()) {
      console.log(`🔄 Auto-validating pre-created bin code: ${preCreatedBinCode}`);
      validateBin(preCreatedBinCode.trim());
    }
  }, [preCreatedBinCode]);

  const handleScanButton = () => {
    // Clear the input and focus it for scanning
    setBinCode("");
    setBinInfo(null);
    // Focus the input after a small delay to ensure it's ready
    setTimeout(() => {
      binCodeInputRef.current?.focus();
    }, 100);
  };

  const validateBin = async (bin: string): Promise<boolean> => {
    if (!bin) return false;

    setLoading(true);
    try {
      const db = await getDatabase();
      
      // First, check if we have any bin master data at all
      const totalBins = await db.getFirstAsync<{ count: number }>(
        "SELECT COUNT(*) as count FROM bin_master_cache"
      );
      console.log(`📊 Total bins in local database: ${totalBins?.count || 0}`);
      
      // Specifically check for A1-R01-L1-B1
      if (bin.toUpperCase() === "A1-R01-L1-B1") {
        const specificBin = await db.getFirstAsync<any>(
          "SELECT * FROM bin_master_cache WHERE bin_code = ? OR bin_barcode = ? OR bin_id = ?",
          ["A1-R01-L1-B1", "A1-R01-L1-B1", "A1-R01-L1-B1"]
        );
        console.log(`🔍 Specific check for A1-R01-L1-B1:`, specificBin ? "FOUND" : "NOT FOUND");
        if (specificBin) {
          console.log(`📦 A1-R01-L1-B1 details:`, JSON.stringify(specificBin, null, 2));
        } else {
          // Check all bins to see what we have
          const allBins = await db.getAllAsync<{ bin_code: string; bin_id: string; bin_barcode: string }>(
            "SELECT bin_code, bin_id, bin_barcode FROM bin_master_cache LIMIT 20"
          );
          console.log(`📋 Sample bins in database (first 20):`, allBins);
        }
      }
      
      if (totalBins && totalBins.count === 0) {
        Alert.alert(
          "No Bin Master Data",
          `No bin master data found in local database. Please sync bin master data from backend using the Sync button.`
        );
        setBinInfo(null);
        setLoading(false);
        return false;
      }
      
      // Check for the specific bin
      const binData = await db.getFirstAsync<any>(
        "SELECT * FROM bin_master_cache WHERE bin_code = ? OR bin_barcode = ? OR bin_id = ?",
        [bin, bin, bin]
      );

      // If not found, show helpful error with sample bins
      if (!binData) {
        // Get a few sample bins to show in the error message
        const sampleBins = await db.getAllAsync<{ bin_code: string }>(
          "SELECT bin_code FROM bin_master_cache LIMIT 5"
        );
        const sampleList = sampleBins.map(b => b.bin_code).join(", ");
        
        Alert.alert(
          "Bin Not Found",
          `Bin "${bin}" not found in local database.\n\n` +
          `Total bins in database: ${totalBins?.count || 0}\n` +
          (sampleList ? `Sample bins: ${sampleList}` : "") +
          `\n\nPlease sync bin master data from backend using the Sync button.`
        );
        setBinInfo(null);
        setLoading(false);
        return false;
      }

      console.log(`✅ Found bin in local database:`, {
        bin_code: binData.bin_code,
        bin_id: binData.bin_id,
        bin_barcode: binData.bin_barcode,
        warehouse_id: binData.warehouse_id,
        zone: binData.zone,
        aisle: binData.aisle,
        rack: binData.rack,
        level: binData.level,
      });
      setBinInfo(binData);
      setBinCode(binData.bin_code || binData.bin_id || bin);
      return true;
    } catch (error: any) {
      console.error("Error validating bin:", error);
      Alert.alert("Error", `Failed to validate bin: ${error.message}`);
      setBinInfo(null);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleStartCount = async () => {
    if (!binInfo) {
      Alert.alert("Error", "Please scan or enter a valid bin code");
      return;
    }

    try {
      // Sync any unsynced sessions before starting new count
      console.log("🔄 Syncing cycle count sessions before starting count...");
      await syncCycleCountSessions();

      const settings = await getSettings();
      const db = await getDatabase();
      const now = new Date().toISOString();

      // Check if there's a pre-created session ID (from task creation)
      let sessionId: string | undefined;
      
      if (preCreatedSessionId) {
        // Use the pre-created session from task creation
        const preCreatedSession = await db.getFirstAsync<{
          session_id: string;
          status: string;
        }>(
          "SELECT session_id, status FROM cycle_count_sessions WHERE session_id = ?",
          [preCreatedSessionId]
        );
        
        if (preCreatedSession) {
          sessionId = preCreatedSessionId;
          console.log(`📂 Using pre-created session: ${sessionId} for task ${preCreatedTaskTitle}`);
          
          // Update session timestamp and ensure bin_code matches
          await db.runAsync(
            "UPDATE cycle_count_sessions SET bin_code = ?, bin_id = ?, updated_at = ? WHERE session_id = ?",
            [binInfo.bin_code, binInfo.bin_id || binInfo.bin_code, now, sessionId]
          );
        } else {
          console.warn(`⚠️ Pre-created session ${preCreatedSessionId} not found, creating new session`);
          // Fall through to create new session
        }
      }
      
      // If no pre-created session, check for existing draft session for this bin
      if (!sessionId) {
        const existingSession = await db.getFirstAsync<{
          session_id: string;
          status: string;
        }>(
          `SELECT session_id, status FROM cycle_count_sessions 
           WHERE bin_code = ? AND status = 'Draft' 
           ORDER BY updated_at DESC LIMIT 1`,
          [binInfo.bin_code]
        );

        if (existingSession) {
          // Use existing draft session
          sessionId = existingSession.session_id;
          console.log(`📂 Found existing draft session: ${sessionId} for bin ${binInfo.bin_code}`);
          
          // Update session timestamp
          await db.runAsync(
            "UPDATE cycle_count_sessions SET updated_at = ? WHERE session_id = ?",
            [now, sessionId]
          );
        }
      }
      
      if (!sessionId) {
        // Create new cycle count session
        // Create new cycle count session
        sessionId = generateUUID();
        console.log(`🆕 Creating new session: ${sessionId} for bin ${binInfo.bin_code}`);
        
        // If task was pre-created, save the server_session_id (task title) for sync
        const serverSessionId = preCreatedTaskTitle || null;
        
        await db.runAsync(
          `INSERT INTO cycle_count_sessions (
            session_id, count_type, warehouse_id, bin_id, bin_code,
            started_by, started_at, status, is_blind_count, device_id, synced, 
            server_session_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sessionId,
            countType,
            binInfo.warehouse_id || "",
            binInfo.bin_id || "",
            binInfo.bin_code,
            settings.user_id || settings.user_code || "USER-AUTO",
            now,
            "Draft",
            isBlindCount ? 1 : 0,
            settings.device_id || "",
            0,
            serverSessionId, // Save pre-created task title for immediate sync
            now,
            now,
          ]
        );
        
        if (serverSessionId) {
          console.log(`✅ Saved pre-created task title ${serverSessionId} to session ${sessionId}`);
        }
      }

      // ✅ NEW: Call POST /api/cycle-count/{title}/start when starting a count session
      // Try to find task title from session or backend
      let taskTitle: string | null = null;
      
      // First, check if we have a task title in the session
      const sessionData = await db.getFirstAsync<{ server_session_id: string | null }>(
        "SELECT server_session_id FROM cycle_count_sessions WHERE session_id = ?",
        [sessionId]
      );
      
      if (sessionData?.server_session_id) {
        taskTitle = sessionData.server_session_id;
        console.log(`📋 Found task title in session: ${taskTitle}`);
      } else {
        // Try to find task from backend for this bin
        try {
          const online = await isDeviceOnline();
          if (online) {
            console.log(`🔍 Looking for backend task for bin ${binInfo.bin_code}...`);
            const tasks = await apiService.getCycleCounts({ status: "Draft,In Progress,Review" });
            const taskArray = Array.isArray(tasks) ? tasks : (tasks?.data || []);
            
            // Normalize bin codes for comparison
            const normalizeBinCode = (code: string | null | undefined): string => {
              if (!code) return "";
              return String(code).trim().toUpperCase().replace(/\s+/g, "").replace(/--+/g, "-");
            };
            
            const binCodeNormalized = normalizeBinCode(binInfo.bin_code);
            
            const existingTask = taskArray.find((t: any) => {
              const taskBinCode = normalizeBinCode(t.bin_code);
              const taskBinId = normalizeBinCode(t.bin_id);
              const taskBinLocation = normalizeBinCode(t.bin_location);
              const taskZone = normalizeBinCode(t.zone);
              
              return (
                (taskBinCode && taskBinCode === binCodeNormalized) || 
                (taskBinId && taskBinId === binCodeNormalized) ||
                (taskBinLocation && taskBinLocation === binCodeNormalized) ||
                (taskZone && taskZone === binCodeNormalized)
              );
            });
            
            if (existingTask?.title) {
              taskTitle = existingTask.title;
              console.log(`✅ Found backend task: ${taskTitle} for bin ${binInfo.bin_code}`);
              
              // Save task title to session for future use
              await db.runAsync(
                "UPDATE cycle_count_sessions SET server_session_id = ?, updated_at = ? WHERE session_id = ?",
                [taskTitle, now, sessionId]
              );
            } else {
              console.log(`ℹ️ No backend task found for bin ${binInfo.bin_code}`);
            }
          }
        } catch (error: any) {
          console.warn(`⚠️ Error finding backend task:`, error.message);
        }
      }
      
      // Call start API if we have a task title
      if (taskTitle) {
        try {
          const online = await isDeviceOnline();
          if (online) {
            console.log(`📤 Starting cycle count task ${taskTitle} via API: POST /api/cycle-count/${taskTitle}/start`);
            await apiService.startCycleCount(taskTitle, {
              started_by: settings.user_id || settings.user_code || "USER-AUTO",
            });
            console.log(`✅ Successfully started task ${taskTitle} via API`);
          } else {
            console.log(`ℹ️ Device is offline - task ${taskTitle} will be started when synced`);
          }
        } catch (startError: any) {
          // Log error but don't block navigation - sync will retry later
          console.warn(`⚠️ Failed to start task via API:`, startError.message);
          console.warn(`⚠️ Task will be started when synced`);
        }
      } else {
        console.log(`ℹ️ No task title found - skipping start API call`);
        console.log(`ℹ️ Task will be started when backend task is found and synced`);
      }

      // Prepare navigation params (NO cartonId - it will be scanned in counting screen)
      const navParams = {
        sessionId,
        binCode: binInfo.bin_code,
        binInfo,
        isBlindCount,
        // ✅ REMOVED: cartonId - will be scanned in counting screen instead
      };
      
      // ✅ DEBUG: Log navigation params before navigating
      console.log(`📦 Navigating to CycleCountBinCounting with params:`, {
        sessionId,
        binCode: binInfo.bin_code,
        isBlindCount,
      });
      
      // Navigate to counting screen with the session ID (existing or new)
      (navigation as any).navigate("CycleCountBinCounting", navParams);
    } catch (error: any) {
      console.error("Error starting count:", error);
      Alert.alert("Error", `Failed to start count: ${error.message}`);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {countType === "Directed" ? "Directed Count" : "Ad-hoc Count"}
        </Text>
        <Text style={styles.headerSubtitle}>Scan or Enter Bin Code</Text>
      </View>

      {/* Bin Input Section */}
      <View style={styles.inputSection}>
        <Text style={styles.inputLabel}>Bin Code</Text>
        <View style={styles.inputRow}>
          <BarcodeInput
            ref={binCodeInputRef}
            autoFocus
            placeholder="Scan or enter bin code"
            onBarcodeScanned={async (raw) =>
              validateBin(raw.trim().toUpperCase())
            }
            containerStyle={styles.barcodeInputWrap}
            inputStyle={styles.input}
          />
          <TouchableOpacity
            style={styles.scanButton}
            onPress={handleScanButton}
            accessibilityLabel="Scan with camera"
          >
            <Text style={styles.scanButtonText}>📷</Text>
            <Text style={styles.scanButtonLabel}>Scan</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Bin Info Display */}
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#9C27B0" />
          <Text style={styles.loadingText}>Validating bin...</Text>
        </View>
      )}

      {binInfo && !loading && (
        <>
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

        </>
      )}

      {/* Blind Count Toggle */}
      <View style={styles.toggleSection}>
        <TouchableOpacity
          style={styles.toggleButton}
          onPress={() => setIsBlindCount(!isBlindCount)}
        >
          <View style={[styles.toggleCircle, isBlindCount && styles.toggleCircleActive]}>
            {isBlindCount && <Text style={styles.toggleCheck}>✓</Text>}
          </View>
          <Text style={styles.toggleLabel}>Blind Count</Text>
        </TouchableOpacity>
        <Text style={styles.toggleDescription}>
          Hide expected quantities until submission
        </Text>
      </View>

      {/* Start Count Button */}
      {binInfo && !loading && (
        <TouchableOpacity
          style={styles.startButton}
          onPress={handleStartCount}
        >
          <Text style={styles.startButtonText}>Start Count</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
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
    marginBottom: 4,
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
    alignItems: "stretch",
    gap: 8,
  },
  /** Lets the barcode row shrink correctly so flex:1 fills space beside the Scan chip. */
  barcodeInputWrap: {
    flex: 1,
    minWidth: 0,
  },
  input: {
    flex: 1,
    backgroundColor: "#FFF",
    borderWidth: 2,
    borderColor: "#9C27B0",
    borderRadius: 8,
    padding: 16,
    fontSize: 18,
    fontWeight: "600",
    minWidth: 0,
  },
  scanButton: {
    backgroundColor: "#2196F3",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "stretch",
    flexShrink: 0,
    width: 56,
    minHeight: 60,
  },
  scanButtonText: {
    color: "#FFF",
    fontSize: 16,
    lineHeight: 18,
  },
  scanButtonLabel: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  loadingContainer: {
    padding: 40,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
  },
  binInfoCard: {
    backgroundColor: "#FFF",
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 4,
    padding: 20,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  binInfoTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 16,
  },
  binInfoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
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
  toggleSection: {
    backgroundColor: "#FFF",
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 4,
    padding: 20,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  toggleButton: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  toggleCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#9C27B0",
    marginRight: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  toggleCircleActive: {
    backgroundColor: "#9C27B0",
  },
  toggleCheck: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
  },
  toggleLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
  },
  toggleDescription: {
    fontSize: 12,
    color: "#666",
    marginLeft: 36,
  },
  startButton: {
    backgroundColor: "#9C27B0",
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 16,
    padding: 20,
    borderRadius: 12,
    alignItems: "center",
  },
  startButtonDisabled: {
    backgroundColor: "#CCC",
  },
  startButtonText: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "bold",
  },
});

