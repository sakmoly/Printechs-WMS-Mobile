import { http } from "./http";
import { storage } from "./storage";
import { LoginResponseSchema } from "./schemas";

export interface LoginCredentials {
  usr: string;
  pwd: string;
}

export interface ApiKeyCredentials {
  apiKey: string;
  apiSecret: string;
}

export const authApi = {
  /**
   * Login with username and password
   */
  async login(credentials: LoginCredentials) {
    try {
      // Always use real authentication - never mock login
      // This ensures proper credential validation
      const response = await http.post<any>("/api/method/login", {
        usr: credentials.usr,
        pwd: credentials.pwd,
      });

      // Frappe returns user data on successful login
      const parsed = LoginResponseSchema.parse(response);

      // Store user info
      await storage.setUser({
        username: credentials.usr,
        full_name: parsed.full_name,
        home_page: parsed.home_page,
      });

      return { success: true, data: parsed };
    } catch (error: any) {
      console.error("Login error:", error);
      return {
        success: false,
        error: error.response?.data?.message || error.message || "Login failed",
      };
    }
  },

  /**
   * Set API Key/Secret for token-based auth
   */
  async setApiToken(credentials: ApiKeyCredentials) {
    const token = `${credentials.apiKey}:${credentials.apiSecret}`;
    await storage.setToken(token);
  },

  /**
   * Logout - clear all stored data
   */
  async logout() {
    try {
      // Always attempt real logout
      await http.post("/api/method/logout");
    } catch (error) {
      // Ignore errors during logout
      console.warn("Logout error:", error);
    } finally {
      // Always clear local storage
      await storage.clear();
    }
  },

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const token = await storage.getToken();
    const user = await storage.getUser();
    return !!(token || user);
  },

  /**
   * Get current user data
   */
  async getCurrentUser() {
    return await storage.getUser();
  },
};
