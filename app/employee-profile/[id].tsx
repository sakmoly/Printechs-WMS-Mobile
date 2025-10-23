import React from "react";
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
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import QRCode from "react-native-qrcode-svg";
import { useEmployeesList } from "../../src/hooks/useOptimizedApis";

const { width } = Dimensions.get("window");

export default function EmployeeProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: employees } = useEmployeesList();

  const employee = employees?.find((emp) => emp.name === id);

  if (!employee) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="person-outline" size={64} color="#9ca3af" />
        <Text style={styles.errorText}>Employee not found</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Generate vCard data for QR code
  const generateVCard = () => {
    const vcard = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `FN:${employee.employee_name}`,
      `ORG:${employee.company}`,
      `TITLE:${employee.designation}`,
      employee.cell_number ? `TEL:${employee.cell_number}` : "",
      employee.company_email ? `EMAIL:${employee.company_email}` : "",
      "END:VCARD",
    ]
      .filter((line) => line !== "")
      .join("\n");

    return vcard;
  };

  const handleCall = () => {
    if (employee.cell_number) {
      Linking.openURL(`tel:${employee.cell_number}`);
    } else {
      Alert.alert(
        "No Phone Number",
        "Phone number not available for this employee."
      );
    }
  };

  const handleEmail = () => {
    if (employee.company_email) {
      Linking.openURL(`mailto:${employee.company_email}`);
    } else {
      Alert.alert("No Email", "Email address not available for this employee.");
    }
  };

  const handleMap = () => {
    // You can customize this with actual office address
    const address = "Riyadh, Saudi Arabia";
    const encodedAddress = encodeURIComponent(address);
    Linking.openURL(`https://maps.google.com/?q=${encodedAddress}`);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Employee Profile</Text>
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
              {employee.image ? (
                <Image
                  source={{ uri: employee.image }}
                  style={styles.profilePhoto}
                />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Text style={styles.photoInitials}>
                    {employee.employee_name?.charAt(0) || "?"}
                  </Text>
                </View>
              )}
              <View style={styles.onlineIndicator} />
            </View>

            {/* Employee Info */}
            <View style={styles.employeeInfo}>
              <Text style={styles.employeeName}>{employee.employee_name}</Text>
              <Text style={styles.employeeDesignation}>
                {employee.designation}
              </Text>
              <Text style={styles.employeeDepartment}>
                {employee.department}
              </Text>
              <Text style={styles.employeeCompany}>{employee.company}</Text>
            </View>
          </LinearGradient>
        </View>

        {/* Contact Actions */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity style={styles.actionButton} onPress={handleCall}>
            <LinearGradient
              colors={["#10b981", "#059669"]}
              style={styles.actionGradient}
            >
              <Ionicons name="call" size={20} color="#ffffff" />
              <Text style={styles.actionText}>Call</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={handleEmail}>
            <LinearGradient
              colors={["#3b82f6", "#2563eb"]}
              style={styles.actionGradient}
            >
              <Ionicons name="mail" size={20} color="#ffffff" />
              <Text style={styles.actionText}>Email</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton} onPress={handleMap}>
            <LinearGradient
              colors={["#f59e0b", "#d97706"]}
              style={styles.actionGradient}
            >
              <Ionicons name="location" size={20} color="#ffffff" />
              <Text style={styles.actionText}>Map</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* QR Code Section */}
        <View style={styles.qrSection}>
          <View style={styles.qrHeader}>
            <Ionicons name="qr-code-outline" size={24} color="#667eea" />
            <Text style={styles.qrTitle}>Contact Card</Text>
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
              Scan this QR code to add {employee.employee_name} to your contacts
            </Text>
          </View>
        </View>

        {/* Contact Information */}
        <View style={styles.contactSection}>
          <Text style={styles.sectionTitle}>Contact Information</Text>

          {employee.cell_number && (
            <View style={styles.contactItem}>
              <Ionicons name="call-outline" size={20} color="#667eea" />
              <Text style={styles.contactLabel}>Phone</Text>
              <Text style={styles.contactValue}>{employee.cell_number}</Text>
            </View>
          )}

          {employee.company_email && (
            <View style={styles.contactItem}>
              <Ionicons name="mail-outline" size={20} color="#667eea" />
              <Text style={styles.contactLabel}>Email</Text>
              <Text style={styles.contactValue}>{employee.company_email}</Text>
            </View>
          )}

          <View style={styles.contactItem}>
            <Ionicons name="business-outline" size={20} color="#667eea" />
            <Text style={styles.contactLabel}>Department</Text>
            <Text style={styles.contactValue}>{employee.department}</Text>
          </View>

          <View style={styles.contactItem}>
            <Ionicons name="briefcase-outline" size={20} color="#667eea" />
            <Text style={styles.contactLabel}>Position</Text>
            <Text style={styles.contactValue}>{employee.designation}</Text>
          </View>
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: "#667eea",
  },
  backButton: {
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
  employeeInfo: {
    alignItems: "center",
  },
  employeeName: {
    fontSize: 28,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 8,
    textAlign: "center",
  },
  employeeDesignation: {
    fontSize: 18,
    color: "rgba(255, 255, 255, 0.9)",
    marginBottom: 4,
    textAlign: "center",
  },
  employeeDepartment: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.8)",
    marginBottom: 4,
    textAlign: "center",
  },
  employeeCompany: {
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
    marginBottom: 30,
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
    width: 80,
  },
  contactValue: {
    fontSize: 14,
    color: "#1f2937",
    fontWeight: "500",
    flex: 1,
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
    marginBottom: 24,
  },
});
