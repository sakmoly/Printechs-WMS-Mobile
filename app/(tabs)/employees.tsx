import React from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Image,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { router } from "expo-router";
import { useEmployeesList } from "../../src/hooks/useOptimizedApis";
import { LoadingScreen } from "../../src/components/LoadingScreen";
import { Ionicons } from "@expo/vector-icons";

export default function EmployeesScreen() {
  const { data: employees, isLoading, refetch } = useEmployeesList();
  const [refreshing, setRefreshing] = React.useState(false);

  // Debug: Log employee data
  React.useEffect(() => {
    if (employees) {
      console.log("Employees data:", JSON.stringify(employees, null, 2));
      console.log("First employee image:", employees[0]?.image);
    }
  }, [employees]);

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
          <TouchableOpacity
            style={styles.card}
            onPress={() => router.push(`/employee-profile/${item.name}`)}
          >
            <View style={styles.avatar}>
              {item.image ? (
                <Image
                  source={{ uri: item.image }}
                  style={styles.avatarImage}
                  resizeMode="cover"
                  onError={(error) => console.log("Image load error:", error)}
                  onLoad={() => console.log("Image loaded:", item.image)}
                />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarText}>
                    {item.employee_name?.charAt(0) || "?"}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.info}>
              <Text style={styles.name}>{item.employee_name}</Text>
              <Text style={styles.designation}>
                {item.designation || "N/A"}
              </Text>
              <Text style={styles.department}>{item.department || "N/A"}</Text>
              {item.cell_number && (
                <Text style={styles.contact}>{item.cell_number}</Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
          </TouchableOpacity>
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
  avatarPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#667eea",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "600",
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
    marginBottom: 2,
  },
  contact: {
    fontSize: 11,
    color: "#9ca3af",
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
