import React from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from "react-native";
import { useApprovalsList } from "../../src/hooks/useOptimizedApis";
import { LoadingScreen } from "../../src/components/LoadingScreen";
import { Ionicons } from "@expo/vector-icons";

export default function ApprovalsScreen() {
  const { data: approvals, isLoading, error, refetch } = useApprovalsList();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading && !approvals) {
    return <LoadingScreen message="Loading approvals..." />;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor="#667eea"
        />
      }
    >
      <Text style={styles.title}>Pending Approvals</Text>

      {approvals && approvals.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="checkmark-circle-outline" size={64} color="#10b981" />
          <Text style={styles.emptyTitle}>All caught up!</Text>
          <Text style={styles.emptyMessage}>
            No pending approvals at the moment
          </Text>
        </View>
      ) : (
        approvals?.map((approval) => (
          <TouchableOpacity
            key={`${approval.doctype}-${approval.name}`}
            style={styles.card}
          >
            <View style={styles.cardHeader}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{approval.doctype}</Text>
              </View>
              <Text style={styles.agingText}>{approval.aging_days}d ago</Text>
            </View>

            <Text style={styles.cardTitle}>{approval.title}</Text>
            <Text style={styles.cardId}>{approval.name}</Text>

            {approval.amount && (
              <Text style={styles.amount}>
                {approval.currency} {approval.amount.toLocaleString()}
              </Text>
            )}

            <View style={styles.stateContainer}>
              <View style={styles.stateDot} />
              <Text style={styles.stateText}>{approval.workflow_state}</Text>
            </View>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  content: {
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1f2937",
    marginBottom: 16,
  },
  card: {
    backgroundColor: "#ffffff",
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  badge: {
    backgroundColor: "#e0e7ff",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    color: "#667eea",
    fontSize: 12,
    fontWeight: "600",
  },
  agingText: {
    fontSize: 12,
    color: "#ef4444",
    fontWeight: "500",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: 4,
  },
  cardId: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 8,
  },
  amount: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#059669",
    marginBottom: 12,
  },
  stateContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#f59e0b",
  },
  stateText: {
    fontSize: 14,
    color: "#f59e0b",
    fontWeight: "500",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 64,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1f2937",
    marginTop: 16,
    marginBottom: 8,
  },
  emptyMessage: {
    fontSize: 14,
    color: "#6b7280",
  },
});
