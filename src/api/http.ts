import axios, { AxiosInstance, AxiosError } from "axios";
import { env } from "../config/env";
import { storage } from "./storage";

export class HttpClient {
  private client: AxiosInstance;
  private onUnauthorized?: () => void;

  constructor(baseURL: string) {
    // Validate baseURL
    if (!baseURL || typeof baseURL !== "string") {
      console.error("❌ Invalid baseURL provided to HttpClient:", baseURL);
      throw new Error("Invalid baseURL provided to HttpClient");
    }

    this.client = axios.create({
      baseURL: baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL, // Remove trailing slash
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      // Add CORS configuration
      withCredentials: false,
      maxRedirects: 5,
    });

    this.setupInterceptors();
  }

  setBaseUrl(baseURL: string) {
    if (!baseURL || typeof baseURL !== "string") {
      console.error("❌ Invalid baseURL provided to setBaseUrl:", baseURL);
      return;
    }
    this.client.defaults.baseURL = baseURL.endsWith("/")
      ? baseURL.slice(0, -1)
      : baseURL;
    console.log(
      "✅ HTTP Client baseURL updated to:",
      this.client.defaults.baseURL
    );
  }

  getBaseUrl(): string {
    return this.client.defaults.baseURL || "";
  }

  private setupInterceptors() {
    // Request interceptor - add auth token
    this.client.interceptors.request.use(
      async (config) => {
        try {
          // Validate config
          if (!config || !config.url) {
            console.error("❌ Invalid request config:", config);
            throw new Error("Invalid request configuration");
          }

          const token = await storage.getToken();
          if (token) {
            config.headers = config.headers || {};
            config.headers.Authorization = `token ${token}`;
          }

          console.log(
            `🚀 HTTP Request: ${config.method?.toUpperCase()} ${config.url}`
          );
          return config;
        } catch (error) {
          console.error("❌ Request interceptor error:", error);
          return Promise.reject(error);
        }
      },
      (error) => {
        console.error("❌ Request interceptor setup error:", error);
        return Promise.reject(error);
      }
    );

    // Response interceptor - handle errors
    this.client.interceptors.response.use(
      (response) => {
        console.log(
          `✅ HTTP Response: ${response.status} ${response.config.url}`
        );
        return response;
      },
      (error: AxiosError) => {
        const url = error.config?.url || "";
        const status = error.response?.status;

        // Silently handle expected 403 errors on non-whitelisted ERPNext methods
        const isExpected403 =
          status === 403 &&
          (url.includes("frappe.auth.get_logged_user") ||
            url.includes("get_logged_user"));

        if (!isExpected403) {
          console.error("❌ HTTP Error:", {
            message: error.message,
            status: status,
            url: url,
            data: error.response?.data,
          });
        }

        if (status === 401) {
          // Unauthorized - trigger logout
          console.log("🔒 Unauthorized access - triggering logout");
          this.onUnauthorized?.();
        }

        if (status === 403 && !isExpected403) {
          console.log(
            "🚫 403 Forbidden - Check authentication and permissions"
          );
          console.log("URL:", url);
        }

        // Handle network errors
        if (!error.response) {
          console.error("🌐 Network error - no response received");
          throw new Error("Network error: Unable to connect to server");
        }

        return Promise.reject(error);
      }
    );
  }

  setUnauthorizedHandler(handler: () => void) {
    this.onUnauthorized = handler;
  }

  async get<T>(url: string, params?: any): Promise<T> {
    try {
      if (!url || typeof url !== "string") {
        throw new Error("Invalid URL provided to GET request");
      }
      const response = await this.client.get(url, { params });
      return response.data;
    } catch (error) {
      console.error("❌ GET request failed:", url, error);
      throw error;
    }
  }

  async post<T>(url: string, data?: any): Promise<T> {
    try {
      if (!url || typeof url !== "string") {
        throw new Error("Invalid URL provided to POST request");
      }
      const response = await this.client.post(url, data);
      return response.data;
    } catch (error) {
      console.error("❌ POST request failed:", url, error);
      throw error;
    }
  }

  async put<T>(url: string, data?: any): Promise<T> {
    try {
      if (!url || typeof url !== "string") {
        throw new Error("Invalid URL provided to PUT request");
      }
      const response = await this.client.put(url, data);
      return response.data;
    } catch (error) {
      console.error("❌ PUT request failed:", url, error);
      throw error;
    }
  }

  async delete<T>(url: string): Promise<T> {
    try {
      if (!url || typeof url !== "string") {
        throw new Error("Invalid URL provided to DELETE request");
      }
      const response = await this.client.delete(url);
      return response.data;
    } catch (error) {
      console.error("❌ DELETE request failed:", url, error);
      throw error;
    }
  }
}

// Create singleton instance
export const http = new HttpClient(env.ERP_BASE_URL);

// Helper to encode ERPNext filters
export const encodeFilters = (filters: any[]): string => {
  return JSON.stringify(filters);
};

// Helper to encode fields
export const encodeFields = (fields: string[]): string => {
  return JSON.stringify(fields);
};
