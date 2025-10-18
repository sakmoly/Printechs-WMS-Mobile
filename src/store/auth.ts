import { create } from "zustand";
import { authApi, type LoginCredentials } from "../api/auth";

interface AuthState {
  isAuthenticated: boolean;
  user: any | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (credentials: LoginCredentials) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  isLoading: true,
  error: null,

  login: async (credentials) => {
    set({ isLoading: true, error: null });

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
}));
