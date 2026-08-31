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
import {
  CommonActions,
  useNavigation,
  useFocusEffect,
  useRoute,
} from "@react-navigation/native";
import ScreenFooterFrame from "../components/ScreenFooterFrame";
import { getSettings, saveSettings } from "../services/settings.service";
import { apiService } from "../services/api.service";
import { validatePasswordPair } from "../utils/password-auth";
import { useApp } from "../context/AppContext";

type SetupPasswordRouteParams = {
  userCode?: string;
};

export default function SetupPasswordScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { refreshSettings, refreshDeviceSessionStatus } = useApp();
  const routeUserCode =
    (route.params as SetupPasswordRouteParams | undefined)?.userCode || "";

  const [userCode, setUserCode] = useState(routeUserCode);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (routeUserCode) return;
      getSettings().then((settings) => {
        const code = (settings.user_code || "").trim();
        if (code) setUserCode(code);
      });
    }, [routeUserCode])
  );

  const completeLogin = async (loginUser: string, loginPassword: string) => {
    const settings = await getSettings();
    await saveSettings({
      user_code: loginUser,
      ...(settings.user_id ? {} : { user_id: loginUser }),
      password: loginPassword,
      auth_token: undefined,
      auth_token_expires: undefined,
    });

    const token = await apiService.login(loginUser, loginPassword);
    if (!token) {
      throw new Error("Sign-in failed after password was created");
    }

    await refreshSettings();
    await refreshDeviceSessionStatus();
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: "Home" as never }],
      })
    );
  };

  const handleSubmit = async () => {
    const loginUser = userCode.trim();
    if (!loginUser) {
      Alert.alert("Error", "Please enter your User Code");
      return;
    }

    const validationError = validatePasswordPair(newPassword, confirmPassword);
    if (validationError) {
      Alert.alert("Error", validationError);
      return;
    }

    const settings = await getSettings();
    if (!settings.api_url) {
      Alert.alert(
        "Configuration Required",
        "Please configure API URL in Settings first"
      );
      return;
    }

    setSubmitting(true);
    try {
      await apiService.setupInitialPassword(
        loginUser,
        newPassword.trim(),
        confirmPassword.trim()
      );
      await completeLogin(loginUser, newPassword.trim());
    } catch (error: any) {
      if ((error as { code?: string }).code === "PASSWORD_ALREADY_SET") {
        Alert.alert(
          "Password already set",
          "This account already has a password. Sign in instead.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Go to Login",
              onPress: () => navigation.navigate("Login" as never),
            },
          ]
        );
        return;
      }
      Alert.alert("Setup failed", error.message || "Could not set password");
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
          Create a WMS password for your synced user account. You only need to do
          this once before your first sign-in.
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>User code</Text>
          <TextInput
            style={styles.input}
            value={userCode}
            onChangeText={setUserCode}
            placeholder="Enter user code"
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

          <Text style={styles.label}>Confirm password</Text>
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
              <Text style={styles.primaryButtonText}>Creating password...</Text>
            </View>
          ) : (
            <Text style={styles.primaryButtonText}>Create password & sign in</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => navigation.goBack()}
          disabled={submitting}
        >
          <Text style={styles.cancelButtonText}>Back to login</Text>
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
