import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { getDatabase } from "../database/database";
import { apiService } from "../services/api.service";
import { getSettings } from "../services/settings.service";

interface DraftSession {
  session_id: string;
  bin_code: string;
  count_type: string;
  started_at: string;
  status: string;
  is_blind_count: number;
  server_session_id?: string | null; // Backend task title
  item_count?: number;
}

export default function CycleCountDraftsScreen() {
  const navigation = useNavigation();
  const [draftSessions, setDraftSessions] = useState<DraftSession[]>([]);
  const [loading, setLoading] = useState(false);

  const loadDraftSessions = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDatabase();
      
      // Get all draft sessions
      const sessions = await db.getAllAsync<DraftSession>(
        `SELECT 
          session_id, 
          bin_code, 
          count_type, 
          started_at, 
          status, 
          is_blind_count,
          server_session_id
        FROM cycle_count_sessions 
        WHERE status = 'Draft' 
        ORDER BY started_at DESC`
      );

      // Get item count for each session
      const sessionsWithCounts = await Promise.all(
        sessions.map(async (session) => {
          const countResult = await db.getFirstAsync<{ count: number }>(
            "SELECT COUNT(*) as count FROM cycle_count_lines WHERE session_id = ?",
            [session.session_id]
          );
          return {
            ...session,
            item_count: countResult?.count || 0,
          };
        })
      );

      setDraftSessions(sessionsWithCounts);
    } catch (error: any) {
      console.error("Error loading draft sessions:", error);
      Alert.alert("Error", `Failed to load drafts: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadDraftSessions();
    }, [loadDraftSessions])
  );

  const handleContinueDraft = async (session: DraftSession) => {
    try {
      const db = await getDatabase();
      
      // Get bin info for this session
      const binInfo = await db.getFirstAsync<any>(
        "SELECT * FROM bin_master_cache WHERE bin_code = ?",
        [session.bin_code]
      );

      // Navigate to counting screen with session data
      (navigation as any).navigate("CycleCountBinCounting", {
        sessionId: session.session_id,
        binCode: session.bin_code,
        binInfo: binInfo || { bin_code: session.bin_code },
        isBlindCount: session.is_blind_count === 1,
      });
    } catch (error: any) {
      console.error("Error continuing draft:", error);
      Alert.alert("Error", `Failed to continue draft: ${error.message}`);
    }
  };

  const handleDeleteDraft = (session: DraftSession) => {
    Alert.alert(
      "Delete Draft",
      `Are you sure you want to delete the draft for bin ${session.bin_code}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              const db = await getDatabase();
              const settings = await getSettings();
              
              // If session has a backend task (server_session_id), delete from backend first
              if (session.server_session_id && settings.api_url && settings.demo_mode !== 1) {
                try {
                  console.log(`🗑️ Deleting cycle count task ${session.server_session_id} from backend...`);
                  await apiService.deleteCycleCount(session.server_session_id);
                  console.log(`✅ Successfully deleted task ${session.server_session_id} from backend`);
                } catch (backendError: any) {
                  const errorMsg = backendError.message || backendError.toString() || "Unknown error";
                  // Check if it's a 404 (endpoint not implemented) - this is OK, just log info
                  if (errorMsg.includes("404") || errorMsg.includes("not found") || errorMsg.includes("NOT_FOUND")) {
                    console.log(`ℹ️ Backend DELETE endpoint not implemented (404) - skipping backend deletion for ${session.server_session_id}`);
                  } else {
                    // For other errors, log warning but continue with local deletion
                    console.warn(`⚠️ Failed to delete from backend: ${errorMsg}`);
                  }
                  // Still proceed with local deletion - backend endpoint may not be implemented yet
                }
              }
              
              // Delete session and all its lines (cascade) from local database
              await db.runAsync(
                "DELETE FROM cycle_count_sessions WHERE session_id = ?",
                [session.session_id]
              );
              
              console.log(`✅ Deleted draft session ${session.session_id} from local database`);
              
              // Reload drafts
              loadDraftSessions();
              Alert.alert("Success", "Draft deleted successfully");
            } catch (error: any) {
              console.error("Error deleting draft:", error);
              Alert.alert("Error", `Failed to delete draft: ${error.message}`);
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateString;
    }
  };

  const renderDraftItem = ({ item }: { item: DraftSession }) => {
    return (
      <View style={styles.draftCard}>
        <View style={styles.draftHeader}>
          <View style={styles.draftInfo}>
            <Text style={styles.binCode}>{item.bin_code}</Text>
            {item.server_session_id && (
              <Text style={styles.taskTitle}>Task: {item.server_session_id}</Text>
            )}
            <Text style={styles.draftMeta}>
              {item.count_type} • {item.item_count} item(s) • {formatDate(item.started_at)}
            </Text>
            {item.is_blind_count === 1 && (
              <View style={styles.blindBadge}>
                <Text style={styles.blindBadgeText}>Blind Count</Text>
              </View>
            )}
          </View>
        </View>
        <View style={styles.draftActions}>
          <TouchableOpacity
            style={styles.continueButton}
            onPress={() => handleContinueDraft(item)}
          >
            <Text style={styles.continueButtonText}>Continue</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDeleteDraft(item)}
          >
            <Text style={styles.deleteButtonText}>Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Drafts</Text>
        <View style={styles.placeholder} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#9C27B0" />
          <Text style={styles.loadingText}>Loading drafts...</Text>
        </View>
      ) : draftSessions.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📝</Text>
          <Text style={styles.emptyTitle}>No Draft Sessions</Text>
          <Text style={styles.emptyText}>
            You don't have any saved draft sessions. Start a new count to create one.
          </Text>
        </View>
      ) : (
        <FlatList
          data={draftSessions}
          keyExtractor={(item) => item.session_id}
          renderItem={renderDraftItem}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.headerInfo}>
              <Text style={styles.headerInfoText}>
                {draftSessions.length} draft session(s) found
              </Text>
            </View>
          }
        />
      )}
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
    padding: 16,
    paddingTop: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    padding: 8,
  },
  backButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#FFF",
  },
  placeholder: {
    width: 60,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  listContent: {
    padding: 16,
  },
  headerInfo: {
    marginBottom: 16,
  },
  headerInfoText: {
    fontSize: 14,
    color: "#666",
  },
  draftCard: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  draftHeader: {
    marginBottom: 12,
  },
  draftInfo: {
    flex: 1,
  },
  binCode: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#9C27B0",
    marginBottom: 4,
  },
  draftMeta: {
    fontSize: 12,
    color: "#666",
    marginBottom: 8,
  },
  blindBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#FF9800",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  blindBadgeText: {
    color: "#FFF",
    fontSize: 10,
    fontWeight: "600",
  },
  draftActions: {
    flexDirection: "row",
    gap: 12,
  },
  continueButton: {
    flex: 1,
    backgroundColor: "#9C27B0",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  continueButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
  deleteButton: {
    flex: 1,
    backgroundColor: "#F44336",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  deleteButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "600",
  },
});

