import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { getDatabase } from "../database/database";

interface HistorySession {
  session_id: string;
  bin_code: string;
  count_type: string;
  count_mode?: string | null;
  started_at: string;
  updated_at: string;
  status: string;
  is_blind_count: number;
  erp_batch?: string | null;
  erp_locked_carton_id?: string | null;
  item_count?: number;
  total_qty?: number;
}

export default function CycleCountHistoryScreen() {
  const navigation = useNavigation();
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(false);

  const loadHistorySessions = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDatabase();
      const rows = await db.getAllAsync<HistorySession>(
        `SELECT
          session_id,
          bin_code,
          count_type,
          count_mode,
          started_at,
          updated_at,
          status,
          is_blind_count,
          erp_batch,
          erp_locked_carton_id
        FROM cycle_count_sessions
        WHERE status IN ('Submitted', 'Completed')
        ORDER BY updated_at DESC`
      );

      const withCounts = await Promise.all(
        rows.map(async (session) => {
          const agg = await db.getFirstAsync<{ items: number; qty: number }>(
            `SELECT
              COUNT(*) as items,
              COALESCE(SUM(counted_qty), 0) as qty
            FROM cycle_count_lines
            WHERE session_id = ? AND counted_qty > 0`,
            [session.session_id]
          );
          return {
            ...session,
            item_count: agg?.items || 0,
            total_qty: agg?.qty || 0,
          };
        })
      );

      setSessions(withCounts);
    } catch (error: any) {
      console.error("Error loading cycle count history:", error);
      Alert.alert("Error", `Failed to load history: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadHistorySessions();
    }, [loadHistorySessions])
  );

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleString("en-US", {
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

  const handleContinue = async (session: HistorySession) => {
    try {
      const db = await getDatabase();
      const binInfo = await db.getFirstAsync<any>(
        "SELECT * FROM bin_master_cache WHERE bin_code = ?",
        [session.bin_code]
      );

      (navigation as any).navigate("CycleCountBinCounting", {
        sessionId: session.session_id,
        countType: session.count_type || "Directed",
        countMode: session.count_mode || "Reconciliation",
        binCode: session.bin_code,
        binInfo: binInfo || { bin_code: session.bin_code },
        isBlindCount: session.is_blind_count === 1,
      });
    } catch (error: any) {
      Alert.alert("Error", error.message || "Could not open session");
    }
  };

  const handleDeleteLocal = (session: HistorySession) => {
    Alert.alert(
      "Remove from Device",
      `Remove local history for bin ${session.bin_code}?\n\nThis does not delete the ERP task or batch. You can still view it in ERPNext.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              const db = await getDatabase();
              await db.runAsync(
                "DELETE FROM cycle_count_sessions WHERE session_id = ?",
                [session.session_id]
              );
              loadHistorySessions();
            } catch (error: any) {
              Alert.alert("Error", error.message || "Could not remove session");
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: HistorySession }) => {
    const isSubmitted = item.status === "Submitted";
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardInfo}>
            <Text style={styles.binCode}>{item.bin_code}</Text>
            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.statusBadge,
                  isSubmitted ? styles.submittedBadge : styles.completedBadge,
                ]}
              >
                <Text style={styles.statusBadgeText}>
                  {isSubmitted ? "Pushed to ERP" : "Completed"}
                </Text>
              </View>
              {item.count_mode ? (
                <View style={styles.modeBadge}>
                  <Text style={styles.modeBadgeText}>{item.count_mode}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.meta}>
              {item.count_type} • {item.item_count} item(s) • Qty {item.total_qty}
            </Text>
            <Text style={styles.meta}>Updated {formatDate(item.updated_at)}</Text>
            {item.erp_locked_carton_id ? (
              <Text style={styles.meta}>Carton: {item.erp_locked_carton_id}</Text>
            ) : null}
            {item.erp_batch ? (
              <Text style={styles.batchText}>Batch: {item.erp_batch}</Text>
            ) : null}
            <Text style={styles.refText} numberOfLines={1}>
              Ref: {item.session_id}
            </Text>
          </View>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.continueButton}
            onPress={() => handleContinue(item)}
          >
            <Text style={styles.continueButtonText}>
              {isSubmitted ? "Continue / Re-push" : "View"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDeleteLocal(item)}
          >
            <Text style={styles.deleteButtonText}>Remove</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pushed / History</Text>
        <View style={styles.placeholder} />
      </View>

      <View style={styles.hintBar}>
        <Text style={styles.hintText}>
          Sessions pushed to ERP appear here. Open one to add items, re-push, or sync stock.
        </Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#9C27B0" />
          <Text style={styles.loadingText}>Loading history...</Text>
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>📤</Text>
          <Text style={styles.emptyTitle}>No Pushed Sessions</Text>
          <Text style={styles.emptyText}>
            After you push a count to ERP it moves here. Drafts stay under My Drafts.
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.session_id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <Text style={styles.listHeader}>{sessions.length} session(s)</Text>
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
  hintBar: {
    backgroundColor: "#F3E5F5",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E1BEE7",
  },
  hintText: {
    fontSize: 13,
    color: "#6A1B9A",
    lineHeight: 18,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
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
  listHeader: {
    fontSize: 14,
    color: "#666",
    marginBottom: 12,
  },
  card: {
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
  cardHeader: {
    marginBottom: 12,
  },
  cardInfo: {
    flex: 1,
  },
  binCode: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  submittedBadge: {
    backgroundColor: "#4CAF50",
  },
  completedBadge: {
    backgroundColor: "#607D8B",
  },
  statusBadgeText: {
    color: "#FFF",
    fontSize: 10,
    fontWeight: "700",
  },
  modeBadge: {
    backgroundColor: "#EDE7F6",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  modeBadgeText: {
    color: "#7B1FA2",
    fontSize: 10,
    fontWeight: "700",
  },
  meta: {
    fontSize: 12,
    color: "#666",
    marginBottom: 2,
  },
  batchText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#2E7D32",
    marginTop: 4,
  },
  refText: {
    fontSize: 10,
    color: "#999",
    marginTop: 4,
  },
  actions: {
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
    fontSize: 15,
    fontWeight: "600",
  },
  deleteButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#F44336",
  },
  deleteButtonText: {
    color: "#F44336",
    fontSize: 14,
    fontWeight: "600",
  },
});
