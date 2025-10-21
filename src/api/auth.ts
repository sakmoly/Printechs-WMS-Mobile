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
   * Get current user data from storage and fetch latest from server
   */
  async getCurrentUser() {
    const storedUser = await storage.getUser();

    // Try to fetch latest user details from server
    // Note: frappe.auth.get_logged_user is often not whitelisted in ERPNext
    // We'll use stored data if the API call fails
    try {
      const response = await http.get<any>(
        "/api/method/frappe.auth.get_logged_user"
      );

      if (response && response.message) {
        const username = response.message;

        // Fetch full user document
        const userDoc = await http.get<any>(
          `/api/resource/User/${username}`,
          {}
        );

        if (userDoc && userDoc.data) {
          const userData = userDoc.data;

          // Merge with stored user data
          const enrichedUser = {
            ...storedUser,
            username: userData.name,
            full_name: userData.full_name,
            email: userData.email,
            mobile_no: userData.mobile_no,
            phone: userData.phone,
            user_image: userData.user_image,
            image: userData.user_image,
            photo_url: userData.user_image,
            bio: userData.bio,
            designation: userData.designation,
            department: userData.department,
            company: userData.company,
            location: userData.location,
            birth_date: userData.birth_date,
          };

          // Update storage
          await storage.setUser(enrichedUser);

          return enrichedUser;
        }
      }
    } catch (error: any) {
      // Silently handle 403 errors (method not whitelisted) - this is expected
      // Only log other errors
      if (error?.response?.status !== 403) {
        console.log("Could not fetch latest user details, using stored data");
      }
    }

    return storedUser;
  },

  /**
   * Fetch logged-in user's full details from ERPNext
   */
  async getUserDetails() {
    try {
      const response = await http.get<any>(
        "/api/method/frappe.desk.form.load.getdoc",
        {
          doctype: "User",
          name: "Administrator", // This will be replaced with the actual logged-in user
        }
      );

      if (response.docs && response.docs.length > 0) {
        const userDoc = response.docs[0];

        // Store extended user info
        await storage.setUser({
          username: userDoc.name,
          full_name: userDoc.full_name,
          email: userDoc.email,
          mobile_no: userDoc.mobile_no,
          phone: userDoc.phone,
          user_image: userDoc.user_image,
          bio: userDoc.bio,
          interest: userDoc.interest,
          location: userDoc.location,
          birth_date: userDoc.birth_date,
          home_page: userDoc.home_page,
        });

        return userDoc;
      }
    } catch (error) {
      console.error("Error fetching user details:", error);
    }

    return await storage.getUser();
  },
};
