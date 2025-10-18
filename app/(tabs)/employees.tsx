import React from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Image,
  RefreshControl,
} from "react-native";
import { useEmployees } from "../../src/hooks/useEmployees";
import { LoadingScreen } from "../../src/components/LoadingScreen";
import { Ionicons } from "@expo/vector-icons";

export default function EmployeesScreen() {
  const { data: employees, isLoading, refetch } = useEmployees();
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  if (isLoading && !employees) {
    return <LoadingScreen message="Loading employees..." />;
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={employees}
        keyExtractor={(item) => item.name}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.avatar}>
              {item.image ? (
                <Image
                  source={{ uri: item.image }}
                  style={styles.avatarImage}
                />
              ) : (
                <Ionicons name="person" size={32} color="#667eea" />
              )}
            </View>
            <View style={styles.info}>
              <Text style={styles.name}>{item.employee_name}</Text>
              <Text style={styles.designation}>
                {item.designation || "N/A"}
              </Text>
              <Text style={styles.department}>{item.department || "N/A"}</Text>
            </View>
          </View>
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#667eea"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={64} color="#9ca3af" />
            <Text style={styles.emptyText}>No employees found</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  list: {
    padding: 16,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#e0e7ff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  avatarImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: 4,
  },
  designation: {
    fontSize: 14,
    color: "#667eea",
    marginBottom: 2,
  },
  department: {
    fontSize: 12,
    color: "#6b7280",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 64,
  },
  emptyText: {
    fontSize: 16,
    color: "#6b7280",
    marginTop: 16,
  },
});
