import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from "react-native";
import { debugHttp } from "../src/utils/debugHttp";
import { env } from "../src/config/env";
import { http } from "../src/api/http";
import { Ionicons } from "@expo/vector-icons";

export default function DebugHttpScreen() {
  const [isLoading, setIsLoading] = useState(false);
  const [debugResults, setDebugResults] = useState<string[]>([]);

  const addDebugResult = (message: string) => {
    setDebugResults((prev) => [
      ...prev,
      `${new Date().toLocaleTimeString()}: ${message}`,
    ]);
  };

  const runDebugChecks = async () => {
    setIsLoading(true);
    setDebugResults([]);

    try {
      addDebugResult("🚀 Starting HTTP Debug Checks...");

      // Log HTTP config
      addDebugResult("🔍 Logging HTTP Configuration...");
      debugHttp.logHttpConfig();

      // Check common issues
      addDebugResult("🔍 Checking for Common Issues...");
      const issues = debugHttp.checkCommonIssues();

      if (issues.length > 0) {
        issues.forEach((issue) => addDebugResult(issue));
      } else {
        addDebugResult("✅ No common issues found");
      }

      // Test HTTP connection
      addDebugResult("🧪 Testing HTTP Connection...");
      const connectionOk = await debugHttp.testHttpConnection();

      if (connectionOk) {
        addDebugResult("✅ HTTP Connection Test Passed");
      } else {
        addDebugResult("❌ HTTP Connection Test Failed");
      }

      // Test optimized APIs
      addDebugResult("🧪 Testing Optimized APIs...");
      await debugHttp.testOptimizedApis();
      addDebugResult("✅ Optimized APIs Test Complete");

      addDebugResult("🏁 All Debug Checks Complete!");
    } catch (error) {
      addDebugResult(`❌ Debug Error: ${error.message}`);
      console.error("Debug error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const testSimpleRequest = async () => {
    setIsLoading(true);
    addDebugResult("🧪 Testing Simple HTTP Request...");

    try {
      const response = await http.get("/api/method/ping");
      addDebugResult(`✅ Simple Request Success: ${JSON.stringify(response)}`);
    } catch (error) {
      addDebugResult(`❌ Simple Request Failed: ${error.message}`);

      if (error.response?.status === 403) {
        addDebugResult("🚫 403 Forbidden - Authentication/Permission Issue");
        addDebugResult("💡 Try: Log out and log in again");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const checkAuthentication = async () => {
    setIsLoading(true);
    addDebugResult("🔑 Checking Authentication Status...");

    try {
      const { storage } = await import("../src/api/storage");
      const token = await storage.getToken();
      const user = await storage.getUser();

      if (token) {
        addDebugResult(`✅ Token exists: ${token.substring(0, 30)}...`);
      } else {
        addDebugResult("❌ No token found - You need to log in");
      }

      if (user) {
        addDebugResult(
          `✅ User exists: ${user.email || user.username || "Unknown"}`
        );
      } else {
        addDebugResult("❌ No user data found");
      }
    } catch (error) {
      addDebugResult(`❌ Auth Check Failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const clearResults = () => {
    setDebugResults([]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>HTTP Debug Console</Text>
        <Text style={styles.subtitle}>Debug HTTP connection issues</Text>
      </View>

      <View style={styles.configInfo}>
        <Text style={styles.configTitle}>Current Configuration:</Text>
        <Text style={styles.configText}>Base URL: {env.ERP_BASE_URL}</Text>
        <Text style={styles.configText}>
          HTTP Client URL: {http.getBaseUrl()}
        </Text>
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={runDebugChecks}
          disabled={isLoading}
        >
          <Ionicons name="bug" size={20} color="#ffffff" />
          <Text style={styles.buttonText}>
            {isLoading ? "Running Checks..." : "Run Debug Checks"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={testSimpleRequest}
          disabled={isLoading}
        >
          <Ionicons name="arrow-forward" size={20} color="#667eea" />
          <Text style={[styles.buttonText, styles.secondaryButtonText]}>
            Test Simple Request
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.authButton]}
          onPress={checkAuthentication}
          disabled={isLoading}
        >
          <Ionicons name="key" size={20} color="#10b981" />
          <Text style={[styles.buttonText, styles.authButtonText]}>
            Check Authentication
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.clearButton]}
          onPress={clearResults}
        >
          <Ionicons name="trash" size={20} color="#ef4444" />
          <Text style={[styles.buttonText, styles.clearButtonText]}>
            Clear Results
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.resultsContainer}>
        <Text style={styles.resultsTitle}>Debug Results:</Text>
        {debugResults.length === 0 ? (
          <Text style={styles.noResults}>
            No debug results yet. Run checks to see output.
          </Text>
        ) : (
          debugResults.map((result, index) => (
            <Text key={index} style={styles.resultItem}>
              {result}
            </Text>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
    padding: 20,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#1f2937",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: "#6b7280",
  },
  configInfo: {
    backgroundColor: "#ffffff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  configTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: 8,
  },
  configText: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 4,
    fontFamily: "monospace",
  },
  buttonContainer: {
    marginBottom: 20,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
  },
  primaryButton: {
    backgroundColor: "#667eea",
  },
  secondaryButton: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#667eea",
  },
  authButton: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#10b981",
  },
  clearButton: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#ef4444",
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
  },
  secondaryButtonText: {
    color: "#667eea",
  },
  authButtonText: {
    color: "#10b981",
  },
  clearButtonText: {
    color: "#ef4444",
  },
  resultsContainer: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  resultsTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: 12,
  },
  noResults: {
    fontSize: 14,
    color: "#6b7280",
    fontStyle: "italic",
  },
  resultItem: {
    fontSize: 12,
    color: "#374151",
    marginBottom: 4,
    fontFamily: "monospace",
    lineHeight: 16,
  },
});
