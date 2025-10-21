/**
 * HTTP Debug Utilities
 * ===================
 *
 * This file provides debugging utilities to help identify HTTP-related issues
 * and the "Cannot read property 'origin' of undefined" error.
 */

import { http } from "../api/http";
import { env } from "../config/env";

export const debugHttp = {
  /**
   * Log current HTTP client configuration
   */
  logHttpConfig() {
    console.log("🔍 HTTP Client Debug Information:");
    console.log("=====================================");

    try {
      console.log("✅ Environment ERP_BASE_URL:", env.ERP_BASE_URL);
      console.log("✅ HTTP Client baseURL:", http.getBaseUrl());
      console.log("✅ HTTP Client defaults:", {
        baseURL: http.getBaseUrl(),
        timeout: 30000,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });
    } catch (error) {
      console.error("❌ Error getting HTTP config:", error);
    }
  },

  /**
   * Test a simple HTTP request
   */
  async testHttpConnection() {
    console.log("🧪 Testing HTTP Connection...");

    try {
      // Test with a simple endpoint that should always work
      const response = await fetch(`${env.ERP_BASE_URL}/api/method/ping`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      console.log("✅ HTTP Connection Test Result:", {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        url: response.url,
      });

      return response.ok;
    } catch (error) {
      console.error("❌ HTTP Connection Test Failed:", error);
      return false;
    }
  },

  /**
   * Test the optimized APIs
   */
  async testOptimizedApis() {
    console.log("🧪 Testing Optimized APIs...");

    const testEndpoints = [
      "/api/method/printechs_utility.dashboard.get_complete_dashboard_data",
      "/api/method/printechs_utility.employee.get_complete_employees_data",
      "/api/method/printechs_utility.approvals.get_complete_approvals_data",
      "/api/method/printechs_utility.profile.get_complete_profile_data",
    ];

    for (const endpoint of testEndpoints) {
      try {
        console.log(`🔍 Testing endpoint: ${endpoint}`);

        const response = await fetch(`${env.ERP_BASE_URL}${endpoint}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({}),
        });

        console.log(`✅ Endpoint ${endpoint}:`, {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
        });
      } catch (error) {
        console.error(`❌ Endpoint ${endpoint} failed:`, error);
      }
    }
  },

  /**
   * Check for common issues
   */
  checkCommonIssues() {
    console.log("🔍 Checking for Common Issues...");

    const issues = [];

    // Check if baseURL is valid
    if (!env.ERP_BASE_URL) {
      issues.push("❌ ERP_BASE_URL is not defined");
    }

    if (!env.ERP_BASE_URL.startsWith("http")) {
      issues.push("❌ ERP_BASE_URL doesn't start with http/https");
    }

    // Check if HTTP client is initialized
    if (!http.getBaseUrl()) {
      issues.push("❌ HTTP client baseURL is not set");
    }

    // Check for CORS issues
    if (
      env.ERP_BASE_URL.includes("localhost") ||
      env.ERP_BASE_URL.includes("127.0.0.1")
    ) {
      issues.push("⚠️ Using localhost - make sure CORS is configured");
    }

    if (issues.length === 0) {
      console.log("✅ No common issues found");
    } else {
      console.log("🚨 Issues found:");
      issues.forEach((issue) => console.log(issue));
    }

    return issues;
  },

  /**
   * Run all debug checks
   */
  async runAllChecks() {
    console.log("🚀 Running All HTTP Debug Checks...");
    console.log("====================================");

    this.logHttpConfig();
    this.checkCommonIssues();
    await this.testHttpConnection();
    await this.testOptimizedApis();

    console.log("====================================");
    console.log("🏁 HTTP Debug Checks Complete");
  },
};

// Export for easy access
export default debugHttp;
