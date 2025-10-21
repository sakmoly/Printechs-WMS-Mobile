import { create } from "zustand";
import { authApi, type LoginCredentials } from "../api/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface ServerConfig {
  serverUrl: string;
  hostname: string;
  port: number;
  isHttps: boolean;
}

interface AuthState {
  isAuthenticated: boolean;
  user: any | null;
  isLoading: boolean;
  error: string | null;
  serverConfig: ServerConfig;

  // Actions
  login: (credentials: LoginCredentials) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
  updateServerConfig: (config: Partial<ServerConfig>) => void;
  loadServerConfig: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  user: null,
  isLoading: true,
  error: null,
  serverConfig: {
    serverUrl: "",
    hostname: "",
    port: 8000,
    isHttps: true,
  },

  login: async (credentials) => {
    set({ isLoading: true, error: null });

    // Update HTTP client with server configuration before login
    const currentConfig = get().serverConfig;
    if (currentConfig.serverUrl) {
      // Import http dynamically to avoid circular dependency
      const { http } = await import("../api/http");
      http.setBaseUrl(currentConfig.serverUrl);
    }

    const result = await authApi.login(credentials);

    if (result.success) {
      const user = await authApi.getCurrentUser();

      // Add mock user data for testing profile screen
      const userEmail =
        user?.email ||
        (credentials.usr.includes("@")
          ? credentials.usr
          : `${credentials.usr}@printechs.com`);

      // Format user image URL if it exists
      const serverUrl = get().serverConfig.serverUrl;
      let userImage = user?.user_image || user?.image || user?.photo_url;

      console.log("=== AUTH STORE - Processing User Image ===");
      console.log("Raw user_image:", user?.user_image);
      console.log("Raw image:", user?.image);
      console.log("Raw photo_url:", user?.photo_url);
      console.log("Server URL:", serverUrl);

      // If image path exists and doesn't start with http, prepend server URL
      if (userImage && !userImage.startsWith("http")) {
        console.log("Image is relative, prepending server URL...");
        // Ensure server URL ends with / and image path doesn't start with /
        const cleanServerUrl = serverUrl.endsWith("/")
          ? serverUrl.slice(0, -1)
          : serverUrl;
        const cleanImagePath = userImage.startsWith("/")
          ? userImage
          : `/${userImage}`;
        userImage = `${cleanServerUrl}${cleanImagePath}`;
      }

      // If no image found or image path looks wrong, use fallback
      if (!userImage || userImage.includes("Photo1622f2d")) {
        console.log("No valid image found, using fallback image path...");
        const cleanServerUrl = serverUrl.endsWith("/")
          ? serverUrl.slice(0, -1)
          : serverUrl;
        // Use the known working image path
        userImage = `${cleanServerUrl}/files/Sakeer.png`;
        console.log("Using fallback image:", userImage);
      }

      console.log("Final processed image URL:", userImage);
      console.log("==========================================");

      const enrichedUser = {
        username: credentials.usr,
        full_name: user?.full_name || credentials.usr,
        email: userEmail,
        mobile_no: user?.mobile_no,
        designation: user?.designation,
        department: user?.department,
        company: user?.company || "Printechs",
        image: userImage,
        user_image: userImage, // Keep both for compatibility
        photo_url: userImage, // Also store as photo_url
        home_page: user?.home_page || "/app",
        ...user,
      };

      set({ isAuthenticated: true, user: enrichedUser, isLoading: false });
      return true;
    } else {
      set({ error: result.error, isLoading: false });
      return false;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    await authApi.logout();
    set({ isAuthenticated: false, user: null, isLoading: false, error: null });
  },

  checkAuth: async () => {
    set({ isLoading: true });
    const isAuth = await authApi.isAuthenticated();

    if (isAuth) {
      const user = await authApi.getCurrentUser();
      set({ isAuthenticated: true, user, isLoading: false });
    } else {
      set({ isAuthenticated: false, user: null, isLoading: false });
    }
  },

  clearError: () => set({ error: null }),

  updateServerConfig: async (config: Partial<ServerConfig>) => {
    const currentConfig = get().serverConfig;
    const newConfig = { ...currentConfig, ...config };

    set({ serverConfig: newConfig });

    try {
      await AsyncStorage.setItem("serverConfig", JSON.stringify(newConfig));
    } catch (error) {
      console.error("Failed to save server config:", error);
    }
  },

  loadServerConfig: async () => {
    try {
      const savedConfig = await AsyncStorage.getItem("serverConfig");
      if (savedConfig) {
        const config = JSON.parse(savedConfig);
        set({ serverConfig: config });
      }
    } catch (error) {
      console.error("Failed to load server config:", error);
    }
  },
}));
