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
    if (currentConfig.serverUrl || (currentConfig.hostname && currentConfig.port)) {
      let serverUrl: string;
      if (currentConfig.serverUrl) {
        serverUrl = currentConfig.serverUrl;
      } else {
        const protocol = currentConfig.isHttps ? "https" : "http";
        serverUrl = `${protocol}://${currentConfig.hostname}:${currentConfig.port}`;
      }
      
      // Import http dynamically to avoid circular dependency
      const { http } = await import("../api/http");
      http.setBaseUrl(serverUrl);
    }

    const result = await authApi.login(credentials);

    if (result.success) {
      const user = await authApi.getCurrentUser();
      set({ isAuthenticated: true, user, isLoading: false });
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
