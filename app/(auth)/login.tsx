import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Modal,
  ScrollView,
  Clipboard,
  Linking,
  Image,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useAuthStore, DEMO_SERVER_URL } from "../../src/store/auth";
import { Ionicons } from "@expo/vector-icons";
import { ServerConfig } from "../../src/components/ServerConfig";
import { OTPInput } from "../../src/components/OTPInput";
import { oauthApi } from "../../src/api/oauth";

type LoginStep = "email" | "otp";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [currentStep, setCurrentStep] = useState<LoginStep>("email");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [receivedOTP, setReceivedOTP] = useState<string>("");
  const [displayedOTP, setDisplayedOTP] = useState<string>("");
  const [isMonitoringClipboard, setIsMonitoringClipboard] = useState(false);
  const { serverConfig, loadServerConfig } = useAuthStore();

  // Load server config on component mount
  useEffect(() => {
    loadServerConfig();
  }, []);

  // Monitor clipboard for OTP when on OTP step
  useEffect(() => {
    if (currentStep === "otp") {
      setIsMonitoringClipboard(true);
      const interval = setInterval(async () => {
        try {
          const clipboardContent = await Clipboard.getString();
          // Check if clipboard contains a 6-digit number
          const otpMatch = clipboardContent.match(/\b\d{6}\b/);
          if (otpMatch) {
            const detectedOTP = otpMatch[0];
            console.log("📋 OTP detected from clipboard:", detectedOTP);
            // Update received OTP (this will trigger display)
            setReceivedOTP(detectedOTP);
            setIsMonitoringClipboard(false);
            clearInterval(interval);
            Alert.alert(
              "OTP Detected",
              `OTP ${detectedOTP} detected from clipboard and filled automatically.`
            );
          }
        } catch (error) {
          console.log("Clipboard monitoring error:", error);
        }
      }, 1000);

      // Stop monitoring after 60 seconds
      const timeout = setTimeout(() => {
        setIsMonitoringClipboard(false);
        clearInterval(interval);
      }, 60000);

      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
        setIsMonitoringClipboard(false);
      };
    }
  }, [currentStep]);

  const handleEmailSubmit = async () => {
    console.log("📧 Email submit called with:", email);
    console.log("🔧 Server config:", serverConfig);

    if (!email.trim()) {
      Alert.alert("Error", "Please enter your email address");
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      Alert.alert("Error", "Please enter a valid email address");
      return;
    }

    // Check if server is configured
    if (!serverConfig.serverUrl) {
      console.log("❌ No server URL configured");
      Alert.alert(
        "Server Not Configured",
        "Please configure your ERPNext server in Settings before logging in."
      );
      return;
    }

    console.log("✅ Server configured, requesting OTP...");
    setIsLoading(true);
    setError("");

    try {
      const result = await oauthApi.requestOTP(email, "email");

      console.log("📧 OTP request result:", result);

      if (result.success) {
        // Clear any previous OTP - will be set when received from email
        setDisplayedOTP("");
        setReceivedOTP("");
        setCurrentStep("otp");
        Alert.alert(
          "OTP Sent",
          `A 6-digit code has been sent to ${email}. Please check your email and copy the OTP.`
        );
      } else {
        setError(result.error || "Failed to send OTP");
        Alert.alert("Error", result.error || "Failed to send OTP");
      }
    } catch (error) {
      console.error("❌ OTP request error:", error);
      setError("Network error. Please try again.");
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  /** Dev-only test code; never valid on the server - avoid 417 and noisy logs */
  const DEV_TEST_OTP = "408057";

  const handleOTPSubmit = async (enteredOtp: string) => {
    console.log("🔐 OTP Submit called with:", enteredOtp);

    if (enteredOtp.length !== 6) {
      setError("Please enter a valid 6-digit OTP");
      return;
    }

    if (__DEV__ && enteredOtp === DEV_TEST_OTP) {
      setError("Use the code from your email to log in.");
      Alert.alert(
        "Test code",
        "408057 is for UI testing only and does not work on the server. Use the 6-digit code from your email to log in."
      );
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      console.log("🔄 Calling exchangeOTPForToken...");
      const result = await oauthApi.exchangeOTPForToken(email, enteredOtp);

      console.log("📥 OTP exchange result:", result);

      if (result.success && result.data) {
        console.log("✅ OTP exchange successful, calling auth store login...");

        // Store user info in auth store
        const { login } = useAuthStore.getState();
        const loginResult = await login({ usr: email, pwd: "" }); // OAuth doesn't need password

        console.log("🏪 Auth store login result:", loginResult);

        if (loginResult) {
          console.log("🎉 Login successful, navigating to tabs...");
          Alert.alert("Success", "Login successful!");
          router.replace("/(tabs)");
        } else {
          console.log("❌ Auth store login failed");
          setError("Authentication failed");
          Alert.alert("Error", "Authentication failed");
        }
      } else {
        console.log("❌ OTP exchange failed:", result.error);
        const isExpired = result.error?.toLowerCase().includes("expired");
        setError(
          isExpired
            ? "Code expired. Tap “Resend OTP” to get a new code."
            : result.error || "Invalid OTP"
        );
        if (!isExpired) {
          const alertMessage =
            result.error?.includes("Invalid") || result.error?.includes("invalid")
              ? "Invalid OTP. Please check the code and try again."
              : result.error || "Invalid OTP";
          Alert.alert("OTP Error", alertMessage);
        }
      }
    } catch (error) {
      console.error("❌ OTP submit error:", error);
      setError("Network error. Please try again.");
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setError(""); // Clear expired/invalid message so user can try new code
    setIsLoading(true);

    try {
      const result = await oauthApi.requestOTP(email, "email");

      if (result.success) {
        setDisplayedOTP("");
        setReceivedOTP("");
        Alert.alert(
          "OTP Resent",
          "A new 6-digit code has been sent to your email. Enter it below (expires in 5 minutes)."
        );
      } else {
        setError(result.error || "Failed to resend OTP");
        Alert.alert("Error", result.error || "Failed to resend OTP");
      }
    } catch (error) {
      setError("Network error. Please try again.");
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOTPClick = () => {
    if (displayedOTP) {
      setReceivedOTP(displayedOTP);
      Alert.alert(
        "OTP Filled",
        `OTP ${displayedOTP} has been filled automatically.`
      );
    }
  };

  const handleOpenEmail = async () => {
    try {
      // Try to open default email app
      const emailUrl = `mailto:${email}`;
      const canOpen = await Linking.canOpenURL(emailUrl);

      if (canOpen) {
        await Linking.openURL(emailUrl);
        Alert.alert(
          "Email Opened",
          "Please copy the 6-digit OTP from your email and return to this app. The OTP will be detected automatically.",
          [{ text: "OK", style: "default" }]
        );
      } else {
        Alert.alert(
          "Email App Not Found",
          "Please check your email manually and copy the 6-digit OTP code."
        );
      }
    } catch (error) {
      console.error("Error opening email:", error);
      Alert.alert(
        "Error",
        "Could not open email app. Please check your email manually."
      );
    }
  };

  const handleManualOTPEntry = () => {
    Alert.alert(
      "Manual OTP Entry",
      "Please enter the 6-digit OTP code you received in your email.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "OK",
          style: "default",
          onPress: () => {
            // Focus on first OTP input
            // This will be handled by the OTPInput component
          },
        },
      ]
    );
  };

  const handleBackToEmail = () => {
    setCurrentStep("email");
    setOtp("");
    setError("");
  };

  const getServerDisplay = () => {
    if (!serverConfig.serverUrl) return "No server configured";
    return serverConfig.serverUrl === DEMO_SERVER_URL
      ? "Demo server (Printechs)"
      : serverConfig.serverUrl;
  };

  return (
    <LinearGradient
      colors={["#667eea", "#764ba2"]}
      style={styles.container}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Logo/Title - uses app icon (replace assets/icon.png with Printechs logo) */}
            <View style={styles.header}>
              <View style={styles.logoContainer}>
                <Image
                  source={require("../../assets/icon.png")}
                  style={styles.logoImage}
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.title}>ERPNext Mobile</Text>
              <Text style={styles.subtitle}>Analytics & Approvals</Text>
            </View>

            {/* Login Form */}
            <View style={styles.formContainer}>
              <View style={styles.card}>
              {currentStep === "email" ? (
                <>
                  <Text style={styles.welcomeText}>Welcome Back</Text>
                  <Text style={styles.instructionText}>
                    Enter your email to receive OTP
                  </Text>

                  {/* Email Input */}
                  <View style={styles.inputContainer}>
                    <Ionicons
                      name="mail-outline"
                      size={20}
                      color="#9ca3af"
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Email Address"
                      placeholderTextColor="#9ca3af"
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="email"
                    />
                  </View>

                  {/* Login Button */}
                  <TouchableOpacity
                    style={[
                      styles.loginButton,
                      isLoading && styles.loginButtonDisabled,
                    ]}
                    onPress={handleEmailSubmit}
                    disabled={isLoading}
                  >
                    <LinearGradient
                      colors={["#667eea", "#764ba2"]}
                      style={styles.loginGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                    >
                      <Text style={styles.loginButtonText}>
                        {isLoading ? "Sending OTP..." : "Send OTP"}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.welcomeText}>Enter OTP</Text>
                  <Text style={styles.instructionText}>
                    We've sent a 6-digit code to {email}
                  </Text>

                  {/* Optional: show received OTP for tap-to-fill */}
                  {receivedOTP && (
                    <TouchableOpacity
                      style={styles.otpTapToFill}
                      onPress={handleOTPClick}
                      disabled={isLoading}
                    >
                      <Text style={styles.otpDisplayText}>{receivedOTP}</Text>
                      <Text style={styles.otpDisplayHint}> · Tap to fill</Text>
                    </TouchableOpacity>
                  )}

                  {/* Single compact instruction + clipboard */}
                  <View style={styles.otpInstructionsContainer}>
                    <Text style={styles.otpInstructionsText}>
                      Code expires in 5 minutes
                      {isMonitoringClipboard ? " · Monitoring clipboard…" : ""}
                    </Text>
                    <TouchableOpacity
                      style={styles.refreshButton}
                      onPress={async () => {
                        try {
                          const clipboardContent = await Clipboard.getString();
                          const otpMatch = clipboardContent.match(/\b\d{6}\b/);
                          if (otpMatch) {
                            setReceivedOTP(otpMatch[0]);
                            Alert.alert("OTP Found", "Paste the code in the fields below.");
                          } else {
                            Alert.alert(
                              "No OTP Found",
                              "Copy the 6-digit code from your email first."
                            );
                          }
                        } catch (_) {
                          Alert.alert("Error", "Could not check clipboard.");
                        }
                      }}
                      disabled={isLoading}
                    >
                      <Ionicons name="copy-outline" size={16} color="#007AFF" />
                      <Text style={styles.refreshButtonText}>Check Clipboard</Text>
                    </TouchableOpacity>
                  </View>

                  {/* OTP Input - no duplicate header */}
                  <OTPInput
                    length={6}
                    onComplete={handleOTPSubmit}
                    onResend={handleResendOTP}
                    disabled={isLoading}
                    error={error}
                    receivedOTP={receivedOTP}
                    displayOTP={receivedOTP}
                    hideHeader
                  />

                  {/* Test OTP - dev only (fake code causes "Invalid OTP" in production) */}
                  {__DEV__ && (
                    <TouchableOpacity
                      style={styles.testButton}
                      onPress={() => setReceivedOTP("408057")}
                      disabled={isLoading}
                    >
                      <Text style={styles.testButtonText}>
                        [Dev] Test Auto-fill OTP
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Back to Email */}
                  <TouchableOpacity
                    style={styles.backButton}
                    onPress={handleBackToEmail}
                    disabled={isLoading}
                  >
                    <Ionicons name="arrow-back" size={20} color="#667eea" />
                    <Text style={styles.backButtonText}>Change Email</Text>
                  </TouchableOpacity>
                </>
              )}

              {/* Server Info - Hidden on OTP screen */}
              {currentStep === "email" && (
                <TouchableOpacity
                  style={styles.serverContainer}
                  onPress={() => setShowServerConfig(true)}
                >
                  <View style={styles.serverInfo}>
                    <Ionicons name="server-outline" size={16} color="#667eea" />
                    <View style={styles.serverTextContainer}>
                      <Text style={styles.serverLabel}>Server:</Text>
                      <Text style={styles.serverText} numberOfLines={1}>
                        {getServerDisplay()}
                      </Text>
                    </View>
                  </View>
                  <Ionicons name="settings-outline" size={20} color="#667eea" />
                </TouchableOpacity>
              )}

              {/* Demo Info - Hidden on OTP screen */}
              {currentStep === "email" && (
                <View style={styles.demoContainer}>
                  <Text style={styles.demoText}>
                    Demo: Use your registered email address
                  </Text>
                </View>
              )}
              </View>
            </View>
          </ScrollView>

          {/* Footer - always at bottom, never overlaps content */}
          <View style={styles.footerWrap}>
            <Text style={styles.footer}>Powered by Printechs</Text>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* Server Configuration Modal */}
      <Modal
        visible={showServerConfig}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowServerConfig(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Server Configuration</Text>
            <TouchableOpacity
              onPress={() => setShowServerConfig(false)}
              style={styles.closeButton}
            >
              <Ionicons name="close" size={28} color="#374151" />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <ServerConfig onSave={() => setShowServerConfig(false)} />
          </ScrollView>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 24,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  header: {
    alignItems: "center",
    marginTop: 60,
  },
  logoContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    overflow: "hidden",
  },
  logoImage: {
    width: 80,
    height: 80,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#ffffff",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "rgba(255, 255, 255, 0.9)",
  },
  formContainer: {
    flex: 1,
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 24,
    padding: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1f2937",
    marginBottom: 8,
  },
  instructionText: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 16,
    textAlign: "center",
  },
  otpHelpContainer: {
    backgroundColor: "#f0f8ff",
    padding: 12,
    borderRadius: 8,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: "#007AFF",
  },
  otpHelpText: {
    fontSize: 14,
    color: "#007AFF",
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 4,
  },
  otpHelpSubtext: {
    fontSize: 12,
    color: "#6b7280",
    textAlign: "center",
  },
  otpDisplayContainer: {
    backgroundColor: "#f0f8ff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#007AFF",
    alignItems: "center",
  },
  otpDisplayLabel: {
    fontSize: 14,
    color: "#007AFF",
    fontWeight: "600",
    marginBottom: 8,
  },
  otpTapToFill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  otpDisplayButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#007AFF",
    marginBottom: 8,
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  otpDisplayText: {
    fontSize: 24,
    fontWeight: "700",
    color: "#007AFF",
    letterSpacing: 4,
    marginRight: 8,
  },
  otpDisplayHint: {
    fontSize: 12,
    color: "#6b7280",
    textAlign: "center",
    fontStyle: "italic",
  },
  otpInstructionsContainer: {
    backgroundColor: "#f0f8ff",
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: "#007AFF",
  },
  otpInstructionsText: {
    fontSize: 13,
    color: "#007AFF",
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 8,
  },
  otpInstructionsSubtext: {
    fontSize: 12,
    color: "#6b7280",
    textAlign: "center",
  },
  monitoringText: {
    fontSize: 12,
    color: "#007AFF",
    textAlign: "center",
    marginTop: 8,
    fontStyle: "italic",
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f0f8ff",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#007AFF",
  },
  refreshButtonText: {
    color: "#007AFF",
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 6,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f3f4f6",
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 16,
    height: 56,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: "#1f2937",
  },
  loginButton: {
    borderRadius: 12,
    overflow: "hidden",
    marginTop: 8,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginGradient: {
    paddingVertical: 16,
    alignItems: "center",
  },
  loginButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "bold",
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    paddingVertical: 12,
  },
  backButtonText: {
    color: "#667eea",
    fontSize: 16,
    fontWeight: "600",
    marginLeft: 8,
  },
  testButton: {
    backgroundColor: "#f0f0f0",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginBottom: 12,
    alignItems: "center",
  },
  testButtonText: {
    color: "#007AFF",
    fontSize: 14,
    fontWeight: "600",
  },
  serverContainer: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  serverInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 8,
  },
  serverTextContainer: {
    flex: 1,
  },
  serverLabel: {
    fontSize: 11,
    color: "#6b7280",
    fontWeight: "600",
  },
  serverText: {
    fontSize: 12,
    color: "#374151",
    fontWeight: "500",
    marginTop: 2,
  },
  demoContainer: {
    marginTop: 16,
    alignItems: "center",
  },
  demoText: {
    fontSize: 12,
    color: "#9ca3af",
    textAlign: "center",
  },
  footerWrap: {
    paddingVertical: 16,
    paddingBottom: Platform.OS === "ios" ? 28 : 16,
  },
  footer: {
    textAlign: "center",
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: 14,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1f2937",
  },
  closeButton: {
    padding: 4,
  },
  modalContent: {
    flex: 1,
  },
});
