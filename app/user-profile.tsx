import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  Linking,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import { useAuthStore } from "../src/store/auth";
import {
  useUserInfo,
  useEmployeeInfo,
  useProfileQRData,
} from "../src/hooks/useOptimizedApis";

const { width } = Dimensions.get("window");

export default function UserProfileScreen() {
  const { user, logout } = useAuthStore();
  const {
    data: userInfo,
    isLoading: userLoading,
    error: userError,
  } = useUserInfo();
  const {
    data: employeeInfo,
    isLoading: employeeLoading,
    error: employeeError,
  } = useEmployeeInfo();
  const {
    data: qrData,
    isLoading: qrLoading,
    error: qrError,
  } = useProfileQRData();

  const loading = userLoading || employeeLoading || qrLoading;
  const hasError = userError || employeeError || qrError;

  // Debug: Log user data and API responses
  useEffect(() => {
    console.log("=== USER PROFILE DEBUG ===");
    console.log("User:", JSON.stringify(user, null, 2));
    console.log("UserInfo:", JSON.stringify(userInfo, null, 2));
    console.log("EmployeeInfo:", JSON.stringify(employeeInfo, null, 2));
    console.log("QRData:", qrData);
    console.log("Loading:", { userLoading, employeeLoading, qrLoading });
    console.log("Errors:", { userError, employeeError, qrError });
    console.log("=========================");
  }, [
    user,
    userInfo,
    employeeInfo,
    qrData,
    userLoading,
    employeeLoading,
    qrLoading,
    userError,
    employeeError,
    qrError,
  ]);

  if (!user) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="person-outline" size={64} color="#9ca3af" />
        <Text style={styles.errorText}>No user information available</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Show error state if there are API errors
  if (hasError) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="warning-outline" size={64} color="#ef4444" />
        <Text style={styles.errorText}>Failed to load profile data</Text>
        <Text style={styles.errorSubtext}>
          {userError?.message ||
            employeeError?.message ||
            qrError?.message ||
            "Unknown error"}
        </Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Use API data if available, otherwise fall back to user data
  // Add safety checks to prevent undefined errors
  const displayData = employeeInfo || userInfo || user;
  const displayName =
    employeeInfo?.employee_name ||
    userInfo?.full_name ||
    user?.full_name ||
    user?.username ||
    "Unknown User";
  const displayEmail =
    employeeInfo?.company_email || userInfo?.email || user?.email || "";
  const displayPhone =
    employeeInfo?.cell_number || userInfo?.mobile_no || user?.mobile_no || "";
  const displayDesignation =
    employeeInfo?.designation ||
    userInfo?.designation ||
    user?.designation ||
    "";
  const displayDepartment =
    employeeInfo?.department || userInfo?.department || user?.department || "";
  const displayCompany =
    employeeInfo?.company || userInfo?.company || user?.company || "Printechs";
  const displayImage =
    employeeInfo?.photo_url || userInfo?.image_url || user?.image || "";
  const displayBranch = employeeInfo?.branch || "";
  const displayAddress = employeeInfo?.current_address || "";

  // Generate vCard data for QR code
  const generateVCard = () => {
    // Use pre-generated QR data if available, otherwise generate from current data
    if (qrData && typeof qrData === "string" && qrData.length > 0) {
      return qrData;
    }

    // Clean address for vCard (remove extra newlines and format)
    const cleanAddress = displayAddress
      ? displayAddress.replace(/\n+/g, ", ").replace(/,\s*,/g, ",").trim()
      : "";

    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `FN:${displayName || "Unknown User"}`,
      displayEmail ? `EMAIL:${displayEmail}` : "",
      displayPhone ? `TEL:${displayPhone}` : "",
      displayDesignation ? `TITLE:${displayDesignation}` : "",
      displayCompany ? `ORG:${displayCompany}` : "",
      cleanAddress ? `ADR:;;${cleanAddress}` : "",
      "END:VCARD",
    ]
      .filter((line) => line !== "")
      .join("\n");

    return vcard;
  };

  const handleCall = () => {
    if (displayPhone) {
      Linking.openURL(`tel:${displayPhone}`);
    } else {
      Alert.alert("No Phone Number", "Phone number not available.");
    }
  };

  const handleEmail = () => {
    if (displayEmail) {
      Linking.openURL(`mailto:${displayEmail}`);
    } else {
      Alert.alert("No Email", "Email address not available.");
    }
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

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBackButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Profile</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Profile Card */}
        <View style={styles.profileCard}>
          <LinearGradient
            colors={["#667eea", "#764ba2"]}
            style={styles.profileGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            {/* Profile Photo */}
            <View style={styles.photoContainer}>
              {loading ? (
                <View style={styles.photoPlaceholder}>
                  <ActivityIndicator size="large" color="#ffffff" />
                </View>
              ) : displayImage ? (
                <Image
                  source={{ uri: displayImage }}
                  style={styles.profilePhoto}
                />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Text style={styles.photoInitials}>
                    {displayName?.charAt(0) || "U"}
                  </Text>
                </View>
              )}
              <View style={styles.onlineIndicator} />
            </View>

            {/* User Info */}
            <View style={styles.userInfo}>
              <Text style={styles.userName}>{displayName}</Text>
              {displayDesignation && (
                <Text style={styles.userDesignation}>{displayDesignation}</Text>
              )}
              {displayDepartment && (
                <Text style={styles.userDepartment}>{displayDepartment}</Text>
              )}
              <Text style={styles.userCompany}>{displayCompany}</Text>
            </View>
          </LinearGradient>
        </View>

        {/* Contact Actions */}
        <View style={styles.actionsContainer}>
          {displayPhone && (
            <TouchableOpacity style={styles.actionButton} onPress={handleCall}>
              <LinearGradient
                colors={["#10b981", "#059669"]}
                style={styles.actionGradient}
              >
                <Ionicons name="call" size={20} color="#ffffff" />
                <Text style={styles.actionText}>Call</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          {displayEmail && (
            <TouchableOpacity style={styles.actionButton} onPress={handleEmail}>
              <LinearGradient
                colors={["#3b82f6", "#2563eb"]}
                style={styles.actionGradient}
              >
                <Ionicons name="mail" size={20} color="#ffffff" />
                <Text style={styles.actionText}>Email</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.actionButton} onPress={handleLogout}>
            <LinearGradient
              colors={["#ef4444", "#dc2626"]}
              style={styles.actionGradient}
            >
              <Ionicons name="log-out" size={20} color="#ffffff" />
              <Text style={styles.actionText}>Logout</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* QR Code Section */}
        <View style={styles.qrSection}>
          <View style={styles.qrHeader}>
            <Ionicons name="qr-code-outline" size={24} color="#667eea" />
            <Text style={styles.qrTitle}>My Contact Card</Text>
          </View>

          <View style={styles.qrContainer}>
            <View style={styles.qrCodeWrapper}>
              <QRCode
                value={generateVCard()}
                size={width * 0.6}
                color="#1f2937"
                backgroundColor="#ffffff"
                logoSize={30}
                logoMargin={2}
                logoBorderRadius={15}
                quietZone={10}
              />
            </View>

            <Text style={styles.qrDescription}>
              Scan this QR code to add my contact information
            </Text>
          </View>
        </View>

        {/* Contact Information */}
        <View style={styles.contactSection}>
          <Text style={styles.sectionTitle}>Contact Information</Text>

          <View style={styles.contactItem}>
            <Ionicons name="person-outline" size={20} color="#667eea" />
            <Text style={styles.contactLabel}>Name</Text>
            <Text style={styles.contactValue}>{displayName}</Text>
          </View>

          {displayEmail && (
            <View style={styles.contactItem}>
              <Ionicons name="mail-outline" size={20} color="#667eea" />
              <Text style={styles.contactLabel}>Email</Text>
              <Text style={styles.contactValue}>{displayEmail}</Text>
            </View>
          )}

          {displayPhone && (
            <View style={styles.contactItem}>
              <Ionicons name="call-outline" size={20} color="#667eea" />
              <Text style={styles.contactLabel}>Phone</Text>
              <Text style={styles.contactValue}>{displayPhone}</Text>
            </View>
          )}

          {displayDepartment && (
            <View style={styles.contactItem}>
              <Ionicons name="business-outline" size={20} color="#667eea" />
              <Text style={styles.contactLabel}>Department</Text>
              <Text style={styles.contactValue}>{displayDepartment}</Text>
            </View>
          )}

          {displayDesignation && (
            <View style={styles.contactItem}>
              <Ionicons name="briefcase-outline" size={20} color="#667eea" />
              <Text style={styles.contactLabel}>Position</Text>
              <Text style={styles.contactValue}>{displayDesignation}</Text>
            </View>
          )}

          {displayCompany && (
            <View style={styles.contactItem}>
              <Ionicons name="flag-outline" size={20} color="#667eea" />
              <Text style={styles.contactLabel}>Company</Text>
              <Text style={styles.contactValue}>{displayCompany}</Text>
            </View>
          )}

          {displayBranch && (
            <View style={styles.contactItem}>
              <Ionicons name="location-outline" size={20} color="#667eea" />
              <Text style={styles.contactLabel}>Branch</Text>
              <Text style={styles.contactValue}>{displayBranch}</Text>
            </View>
          )}

          {displayAddress && (
            <View style={styles.contactItem}>
              <Ionicons name="map-outline" size={20} color="#667eea" />
              <Text style={styles.contactLabel}>Address</Text>
              <Text style={styles.contactValue}>{displayAddress}</Text>
            </View>
          )}
        </View>

        {/* Settings Button */}
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => router.push("/(tabs)/settings")}
        >
          <Ionicons name="settings-outline" size={20} color="#667eea" />
          <Text style={styles.settingsButtonText}>Settings</Text>
          <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: "#667eea",
  },
  headerBackButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#ffffff",
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  profileCard: {
    margin: 20,
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  profileGradient: {
    padding: 30,
    alignItems: "center",
  },
  photoContainer: {
    position: "relative",
    marginBottom: 20,
  },
  profilePhoto: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    borderColor: "#ffffff",
  },
  photoPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 4,
    borderColor: "#ffffff",
  },
  photoInitials: {
    fontSize: 48,
    fontWeight: "700",
    color: "#ffffff",
  },
  onlineIndicator: {
    position: "absolute",
    bottom: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#10b981",
    borderWidth: 4,
    borderColor: "#ffffff",
  },
  userInfo: {
    alignItems: "center",
  },
  userName: {
    fontSize: 28,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 8,
    textAlign: "center",
  },
  userDesignation: {
    fontSize: 18,
    color: "rgba(255, 255, 255, 0.9)",
    marginBottom: 4,
    textAlign: "center",
  },
  userDepartment: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.8)",
    marginBottom: 4,
    textAlign: "center",
  },
  userCompany: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.7)",
    textAlign: "center",
  },
  actionsContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 20,
    marginBottom: 30,
  },
  actionButton: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  actionGradient: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  qrSection: {
    backgroundColor: "#ffffff",
    marginHorizontal: 20,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  qrHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  qrTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1f2937",
    marginLeft: 8,
  },
  qrContainer: {
    alignItems: "center",
  },
  qrCodeWrapper: {
    backgroundColor: "#ffffff",
    padding: 20,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 16,
  },
  qrDescription: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 20,
  },
  contactSection: {
    backgroundColor: "#ffffff",
    marginHorizontal: 20,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: 16,
  },
  contactItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  contactLabel: {
    fontSize: 14,
    color: "#6b7280",
    marginLeft: 12,
    width: 90,
  },
  contactValue: {
    fontSize: 14,
    color: "#1f2937",
    fontWeight: "500",
    flex: 1,
  },
  settingsButton: {
    backgroundColor: "#ffffff",
    marginHorizontal: 20,
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 30,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  settingsButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2937",
    flex: 1,
    marginLeft: 12,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: "#f9fafb",
  },
  errorText: {
    fontSize: 18,
    color: "#6b7280",
    marginTop: 16,
    marginBottom: 8,
  },
  errorSubtext: {
    fontSize: 14,
    color: "#9ca3af",
    textAlign: "center",
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  backButton: {
    backgroundColor: "#667eea",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
