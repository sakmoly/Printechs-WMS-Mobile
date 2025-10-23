import { http } from "./http";
import { storage } from "./storage";

export interface OTPRequest {
  identifier: string;
  client_id: string;
  channel: "email" | "sms";
}

export interface OTPResponse {
  message: {
    token_type: "Bearer";
    access_token: string;
    expires_in: number;
    refresh_token: string;
    scope: string;
    user: string;
  };
}

export interface OTPExchangeRequest {
  identifier: string;
  otp: string;
  client_id: string;
}

export interface TokenData {
  token_type: "Bearer";
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  user: string;
  expires_at: number; // Timestamp when token expires
}

export const oauthApi = {
  /**
   * Request OTP for authentication
   */
  async requestOTP(
    identifier: string,
    channel: "email" | "sms" = "email"
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log("📧 Requesting OTP for:", identifier);

      const requestData: OTPRequest = {
        identifier,
        client_id: "55d4241f3a", // Your client ID
        channel,
      };

      // Create a simple unauthenticated HTTP client for OTP request
      const serverConfig = await storage.getItem("serverConfig");
      const baseUrl = serverConfig
        ? JSON.parse(serverConfig).serverUrl
        : "https://printechs.com";

      console.log("🌐 Using base URL:", baseUrl);

      // Use axios directly without authentication
      const axios = (await import("axios")).default;
      const response = await axios.post(
        `${baseUrl}/api/method/printechs_utility.auth_otp.request_otp`,
        requestData,
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 10000,
        }
      );

      console.log("✅ OTP request successful");
      return { success: true };
    } catch (error: any) {
      console.error("❌ OTP request failed:", error);
      console.error("❌ Error details:", {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });

      let errorMessage = "Failed to send OTP";
      if (error.response?.status === 401) {
        errorMessage =
          "Authentication failed. Please check your server configuration.";
      } else if (error.response?.status === 400) {
        errorMessage = "Invalid email address or request format.";
      } else if (error.response?.status === 500) {
        errorMessage = "Server error. Please try again later.";
      } else if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  },

  /**
   * Exchange OTP for access token
   */
  async exchangeOTPForToken(
    identifier: string,
    otp: string
  ): Promise<{ success: boolean; data?: TokenData; error?: string }> {
    try {
      console.log("🔐 Exchanging OTP for token...");
      console.log("📧 Identifier:", identifier);
      console.log("🔢 OTP:", otp);

      const requestData: OTPExchangeRequest = {
        identifier,
        otp,
        client_id: "55d4241f3a", // Your client ID
      };

      console.log("📤 Request data:", requestData);

      // Use unauthenticated HTTP client for OTP exchange
      const serverConfig = await storage.getItem("serverConfig");
      const baseUrl = serverConfig
        ? JSON.parse(serverConfig).serverUrl
        : "https://printechs.com";

      console.log("🌐 Using base URL for OTP exchange:", baseUrl);

      // Use axios directly without authentication
      const axios = (await import("axios")).default;
      const response = await axios.post<OTPResponse>(
        `${baseUrl}/api/method/printechs_utility.auth_otp.exchange_otp_for_token`,
        requestData,
        {
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          timeout: 10000,
        }
      );

      console.log("📥 Response received:", response);

      if (response.data.message) {
        const tokenData: TokenData = {
          ...response.data.message,
          expires_at: Date.now() + response.data.message.expires_in * 1000, // Convert to timestamp
        };

        console.log("🔑 Token data created:", tokenData);

        // Store token data securely
        await storage.setToken(tokenData.access_token);
        await storage.setItem("refresh_token", tokenData.refresh_token);
        await storage.setItem("token_data", JSON.stringify(tokenData));
        await storage.setItem("user_identifier", identifier);

        console.log("💾 Token data stored successfully");
        console.log("✅ Token exchange successful");
        return { success: true, data: tokenData };
      }

      console.error("❌ No message in response:", response);
      throw new Error("Invalid response format - no message field");
    } catch (error: any) {
      console.error("❌ Token exchange failed:", error);
      console.error("❌ Error details:", {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });

      // Handle specific error cases
      let errorMessage = "Invalid OTP";
      if (error.response?.status === 417) {
        const serverMessage = error.response?.data?._server_messages;
        if (serverMessage && serverMessage.length > 0) {
          try {
            const parsedMessage = JSON.parse(serverMessage[0]);
            errorMessage = parsedMessage.message || "Invalid or expired OTP";
          } catch (e) {
            errorMessage = "Invalid or expired OTP";
          }
        } else {
          errorMessage = "Invalid or expired OTP";
        }
      } else if (error.response?.status === 400) {
        errorMessage = "Invalid OTP format";
      } else if (error.response?.status === 500) {
        errorMessage = "Server error. Please try again.";
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  },

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(): Promise<{
    success: boolean;
    data?: TokenData;
    error?: string;
  }> {
    try {
      const refreshToken = await storage.getItem("refresh_token");
      if (!refreshToken) {
        throw new Error("No refresh token available");
      }

      console.log("🔄 Refreshing access token...");

      // Get server config for base URL
      const serverConfig = await storage.getItem("serverConfig");
      const baseUrl = serverConfig
        ? JSON.parse(serverConfig).serverUrl
        : "https://printechs.com";

      console.log("🌐 Using base URL for token refresh:", baseUrl);

      // Use axios directly for OAuth2 token refresh with x-www-form-urlencoded
      const axios = (await import("axios")).default;

      // Prepare form data for x-www-form-urlencoded
      const formData = new URLSearchParams();
      formData.append("grant_type", "refresh_token");
      formData.append("refresh_token", refreshToken);
      formData.append("client_id", "55d4241f3a");

      const response = await axios.post(
        `${baseUrl}/api/method/frappe.integrations.oauth2.get_token`,
        formData,
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          timeout: 10000,
        }
      );

      console.log("📥 Token refresh response:", response.data);

      // Handle direct OAuth2 response (no nested message field)
      if (response.data.access_token) {
        const tokenData: TokenData = {
          token_type: response.data.token_type || "Bearer",
          access_token: response.data.access_token,
          expires_in: response.data.expires_in,
          refresh_token: response.data.refresh_token,
          scope: response.data.scope || "all",
          user: "", // Will be populated from stored user identifier
          expires_at: Date.now() + response.data.expires_in * 1000,
        };

        // Get stored user identifier
        const userIdentifier = await storage.getItem("user_identifier");
        if (userIdentifier) {
          tokenData.user = userIdentifier;
        }

        // Update stored token data
        await storage.setToken(tokenData.access_token);
        await storage.setItem("refresh_token", tokenData.refresh_token);
        await storage.setItem("token_data", JSON.stringify(tokenData));

        console.log("✅ Token refreshed successfully");
        return { success: true, data: tokenData };
      }

      throw new Error("Invalid refresh response format - no access_token");
    } catch (error: any) {
      console.error("❌ Token refresh failed:", error);
      console.error("❌ Error details:", {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });

      let errorMessage = "Token refresh failed";
      if (error.response?.status === 400) {
        errorMessage = "Invalid refresh token or client ID";
      } else if (error.response?.status === 401) {
        errorMessage = "Refresh token expired or invalid";
      } else if (error.response?.status === 500) {
        errorMessage = "Server error during token refresh";
      } else if (error.response?.data?.error_description) {
        errorMessage = error.response.data.error_description;
      }

      return {
        success: false,
        error: errorMessage,
      };
    }
  },

  /**
   * Check if token is valid and not expired
   */
  async isTokenValid(): Promise<boolean> {
    try {
      const tokenDataStr = await storage.getItem("token_data");
      if (!tokenDataStr) return false;

      const tokenData: TokenData = JSON.parse(tokenDataStr);
      const now = Date.now();

      // Check if token expires in the next 5 minutes (300000 ms)
      return tokenData.expires_at > now + 300000;
    } catch (error) {
      console.error("❌ Error checking token validity:", error);
      return false;
    }
  },

  /**
   * Get current access token for API calls
   */
  async getValidToken(): Promise<string | null> {
    try {
      // Get access token for API calls
      const accessToken = await storage.getToken();

      if (accessToken) {
        console.log("🔑 Using access token for API calls");
        return accessToken;
      }

      console.log("⚠️ No valid access token found");
      return null;
    } catch (error) {
      console.error("❌ Error getting valid token:", error);
      return null;
    }
  },

  /**
   * Logout - clear all stored tokens
   */
  async logout(): Promise<void> {
    try {
      // Clear all stored authentication data
      await storage.clear();
      await storage.removeItem("refresh_token");
      await storage.removeItem("token_data");
      await storage.removeItem("user_identifier");

      console.log("✅ OAuth logout completed");
    } catch (error) {
      console.error("❌ Logout error:", error);
    }
  },

  /**
   * Get current user identifier
   */
  async getCurrentUser(): Promise<string | null> {
    return await storage.getItem("user_identifier");
  },
};
