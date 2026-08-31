import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import { getSettings, saveSettings } from "../services/settings.service";
import { apiService } from "../services/api.service";
import { validatePasswordPair } from "../utils/password-auth";
import { useApp } from "../context/AppContext";

export default function ChangePasswordScreen() {
  const navigation = useNavigation();
  const { refreshSettings } = useApp();
  const [userCode, setUserCode] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getSettings().then((settings) => {
        setUserCode((settings.user_code || "").trim());
      });
    }, [])
  );

  const handleSubmit = async () => {
    const loginUser = userCode.trim();
    if (!loginUser) {
      Alert.alert("Error", "User code is not configured. Set it in Settings first.");
      return;
    }
    if (!currentPassword.trim()) {
      Alert.alert("Error", "Please enter your current password");
      return;
    }

    const validationError = validatePasswordPair(newPassword, confirmPassword);
    if (validationError) {
      Alert.alert("Error", validationError);
      return;
    }
    if (currentPassword.trim() === newPassword.trim()) {
      Alert.alert("Error", "New password must be different from the current password");
      return;
    }

    setSubmitting(true);
    try {
      await saveSettings({
        user_code: loginUser,
        password: currentPassword.trim(),
        auth_token: undefined,
        auth_token_expires: undefined,
      });
      await apiService.login(loginUser, currentPassword.trim());
      await apiService.changePassword(
        loginUser,
        currentPassword.trim(),
        newPassword.trim()
      );
      await saveSettings({
        password: newPassword.trim(),
        auth_token: undefined,
        auth_token_expires: undefined,
      });
      await refreshSettings();
      Alert.alert("Password changed", "Your WMS password was updated successfully.", [
        {
          text: "OK",
          onPress: () => navigation.goBack(),
        },
      ]);
    } catch (error: any) {
      Alert.alert("Change password failed", error.message || "Could not change password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          Update the password stored on the WMS server for your account.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>User code</Text>
          <View style={styles.readOnlyField}>
            <Text style={styles.readOnlyText}>{userCode || "Not configured"}</Text>
          </View>

          <Text style={styles.label}>Current password</Text>
          <TextInput
            style={styles.input}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="Enter current password"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>New password</Text>
          <TextInput
            style={styles.input}
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="At least 6 characters"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Confirm new password</Text>
          <TextInput
            style={styles.input}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Re-enter new password"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, submitting && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <View style={styles.buttonLoading}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.primaryButtonText}>Updating...</Text>
            </View>
          ) : (
            <Text style={styles.primaryButtonText}>Update password</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => navigation.goBack()}
          disabled={submitting}
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
      <ScreenFooterFrame />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 32,
  },
  intro: {
    fontSize: 15,
    color: "#555",
    lineHeight: 22,
    marginBottom: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    marginBottom: 20,
  },
  label: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  readOnlyField: {
    backgroundColor: "#F5F5F5",
    borderWidth: 1,
    borderColor: "#E0E0E0",
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
  },
  readOnlyText: {
    fontSize: 16,
    color: "#333",
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 10,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  cancelButton: {
    padding: 16,
    alignItems: "center",
    marginTop: 4,
  },
  cancelButtonText: {
    color: "#007AFF",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
});
