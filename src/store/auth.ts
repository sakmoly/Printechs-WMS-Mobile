import { create } from "zustand";
import { authApi, type LoginCredentials } from "../api/auth";
import { oauthApi } from "../api/oauth";
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
    console.log("🏪 AUTH STORE - Login called with:", credentials);
    set({ isLoading: true, error: null });

    // Update HTTP client with server configuration before login
    const currentConfig = get().serverConfig;
    console.log("🔧 Current server config:", currentConfig);

    if (currentConfig.serverUrl) {
      // Import http dynamically to avoid circular dependency
      const { http } = await import("../api/http");
      http.setBaseUrl(currentConfig.serverUrl);
      console.log(
        "🌐 HTTP client base URL updated to:",
        currentConfig.serverUrl
      );
    }

    // For OAuth, we don't need to call authApi.login since OAuth handles authentication
    // Just create user data from the email/username
    const userEmail = credentials.usr.includes("@")
      ? credentials.usr
      : `${credentials.usr}@printechs.com`;

    // Format user image URL
    const serverUrl = get().serverConfig.serverUrl;
    let userImage = `${serverUrl}/files/Sakeer.png`; // Default fallback

    console.log("=== AUTH STORE - OAuth Login ===");
    console.log("User email:", userEmail);
    console.log("Server URL:", serverUrl);
    console.log("User image:", userImage);
    console.log("==========================================");

    const enrichedUser = {
      username: credentials.usr,
      full_name: credentials.usr.split("@")[0], // Use part before @ as name
      email: userEmail,
      mobile_no: null,
      designation: "User",
      department: "General",
      company: "Printechs",
      image: userImage,
      user_image: userImage,
      photo_url: userImage,
      home_page: "/app",
    };

    console.log("👤 Enriched user data:", enrichedUser);

    set({ isAuthenticated: true, user: enrichedUser, isLoading: false });

    console.log("✅ AUTH STORE - Login completed successfully");
    return true;
  },

  logout: async () => {
    set({ isLoading: true });
    await oauthApi.logout();
    set({ isAuthenticated: false, user: null, isLoading: false, error: null });
  },

  checkAuth: async () => {
    set({ isLoading: true });
    const isAuth = await oauthApi.isTokenValid();

    if (isAuth) {
      const userEmail = await oauthApi.getCurrentUser();
      if (userEmail) {
        const user = {
          username: userEmail,
          full_name: userEmail.split("@")[0],
          email: userEmail,
          mobile_no: null,
          designation: "User",
          department: "General",
          company: "Printechs",
          image: `${get().serverConfig.serverUrl}/files/Sakeer.png`,
          user_image: `${get().serverConfig.serverUrl}/files/Sakeer.png`,
          photo_url: `${get().serverConfig.serverUrl}/files/Sakeer.png`,
          home_page: "/app",
        };
        set({ isAuthenticated: true, user, isLoading: false });
      } else {
        set({ isAuthenticated: false, user: null, isLoading: false });
      }
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
