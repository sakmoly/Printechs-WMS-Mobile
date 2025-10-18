import axios, { AxiosInstance, AxiosError } from "axios";
import { env } from "../config/env";
import { storage } from "./storage";

export class HttpClient {
  private client: AxiosInstance;
  private onUnauthorized?: () => void;

  constructor(baseURL: string) {
    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.setupInterceptors();
  }

  setBaseUrl(baseURL: string) {
    this.client.defaults.baseURL = baseURL;
  }

  private setupInterceptors() {
    // Request interceptor - add auth token
    this.client.interceptors.request.use(
      async (config) => {
        const token = await storage.getToken();
        if (token) {
          config.headers.Authorization = `token ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor - handle errors
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          // Unauthorized - trigger logout
          this.onUnauthorized?.();
        }
        return Promise.reject(error);
      }
    );
  }

  setUnauthorizedHandler(handler: () => void) {
    this.onUnauthorized = handler;
  }

  async get<T>(url: string, params?: any): Promise<T> {
    const response = await this.client.get(url, { params });
    return response.data;
  }

  async post<T>(url: string, data?: any): Promise<T> {
    const response = await this.client.post(url, data);
    return response.data;
  }

  async put<T>(url: string, data?: any): Promise<T> {
    const response = await this.client.put(url, data);
    return response.data;
  }

  async delete<T>(url: string): Promise<T> {
    const response = await this.client.delete(url);
    return response.data;
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
