import React, { useState, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  Image,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { KpiCard } from "../../src/components/KpiCard";
import { LoadingScreen } from "../../src/components/LoadingScreen";
import { useAuthStore } from "../../src/store/auth";
import { Ionicons } from "@expo/vector-icons";
import { useDashboardData } from "../../src/hooks/useOptimizedApis";

const { width } = Dimensions.get("window");

export default function DashboardScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const { user, logout } = useAuthStore();

  // 🎯 SINGLE API CALL - Gets ALL dashboard data in one request
  const { data: dashboardData, isLoading, error, refetch } = useDashboardData();

  // Animation values
  const headerFadeAnim = useRef(new Animated.Value(0)).current;
  const headerSlideAnim = useRef(new Animated.Value(-20)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(headerFadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(headerSlideAnim, {
        toValue: 0,
        tension: 40,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  if (isLoading && !dashboardData) {
    return <LoadingScreen message="Loading dashboard..." />;
  }

  if (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle" size={64} color="#ef4444" />
        <Text style={styles.errorTitle}>Failed to Load Dashboard</Text>
        <Text style={styles.errorMessage}>{errorMessage}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Ionicons name="refresh-outline" size={20} color="#ffffff" />
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Gradient Background */}
      <LinearGradient
        colors={["#f9fafb", "#ffffff", "#f3f4f6"]}
        style={styles.backgroundGradient}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#667eea"
            colors={["#667eea", "#764ba2"]}
          />
        }
      >
        {/* Header with Animation */}
        <Animated.View
          style={[
            styles.header,
            {
              opacity: headerFadeAnim,
              transform: [{ translateY: headerSlideAnim }],
            },
          ]}
        >
          <View style={styles.headerContent}>
            <View style={styles.headerLeft}>
              <Text style={styles.greeting}>📊 Dashboard</Text>
              <Text style={styles.date}>
                {dashboardData?.date ||
                  new Date().toLocaleDateString("en-US", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
              </Text>
            </View>

            <View style={styles.headerRight}>
              {/* User Profile Photo - Data comes from single API */}
              <TouchableOpacity
                style={styles.profileButton}
                onPress={() => router.push("/user-profile")}
              >
                <View style={styles.profilePhotoContainer}>
                  {dashboardData?.user_profile?.image_url ? (
                    <Image
                      source={{ uri: dashboardData.user_profile.image_url }}
                      style={styles.profilePhoto}
                      resizeMode="cover"
                      onError={(error) => {
                        console.log(
                          "❌ Profile image load error:",
                          error.nativeEvent?.error
                        );
                      }}
                      onLoad={() => {
                        console.log("✅ Profile image loaded successfully!");
                      }}
                      defaultSource={require("../../assets/icon.png")}
                    />
                  ) : (
                    <View style={styles.profilePhotoPlaceholder}>
                      <Text style={styles.profileInitials}>
                        {dashboardData?.user_profile?.name?.charAt(0) ||
                          user?.username?.charAt(0) ||
                          "U"}
                      </Text>
                    </View>
                  )}
                  <View style={styles.onlineIndicator} />
                </View>
              </TouchableOpacity>

              {/* Logout Button */}
              <TouchableOpacity
                style={styles.logoutButton}
                onPress={handleLogout}
              >
                <LinearGradient
                  colors={["#ef4444", "#dc2626"]}
                  style={styles.logoutGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Ionicons name="log-out-outline" size={20} color="#ffffff" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>

        {/* Section Header */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Key Metrics</Text>
          <TouchableOpacity style={styles.filterButton}>
            <Text style={styles.filterButtonText}>This Month</Text>
            <Ionicons name="chevron-down" size={16} color="#60a5fa" />
          </TouchableOpacity>
        </View>

        {/* KPI Cards - Data comes from single API */}
        <View style={styles.kpiGrid}>
          {dashboardData?.kpis.map((kpi, index) => (
            <View key={kpi.id} style={styles.kpiCardWrapper}>
              <KpiCard
                label={kpi.title}
                value={kpi.value}
                delta={kpi.change_percentage}
                format={kpi.unit ? "percentage" : "currency"}
                currency={kpi.currency}
                unit={kpi.unit}
                changeDirection={kpi.change_direction}
                colors={["#3b82f6", "#2563eb"]}
                onPress={() => {
                  console.log("KPI tapped:", kpi.id, kpi.title);

                  // Navigate to Sales Dashboard for SALES MTD KPI
                  if (
                    kpi.title?.toUpperCase().includes("SALES MTD") ||
                    kpi.id?.toLowerCase().includes("sales_mtd")
                  ) {
                    router.push("/sales-dashboard");
                  }
                }}
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  backgroundGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 24,
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  greeting: {
    fontSize: 32,
    fontWeight: "800",
    color: "#1f2937",
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  date: {
    fontSize: 14,
    color: "#6b7280",
    fontWeight: "500",
  },
  profileButton: {
    position: "relative",
  },
  profilePhotoContainer: {
    position: "relative",
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: "#ffffff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  profilePhoto: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  profilePhotoPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "#667eea",
    justifyContent: "center",
    alignItems: "center",
  },
  profileInitials: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
  },
  onlineIndicator: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#10b981",
    borderWidth: 2,
    borderColor: "#ffffff",
  },
  logoutButton: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#ef4444",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  logoutGradient: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1f2937",
  },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  filterButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#667eea",
  },
  kpiGrid: {
    marginTop: 8,
  },
  kpiCardWrapper: {
    marginBottom: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: "#f9fafb",
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#1f2937",
    marginTop: 16,
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: "#667eea",
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
