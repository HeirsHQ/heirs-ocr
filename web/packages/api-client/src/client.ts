import axios, { AxiosError, AxiosRequestConfig } from "axios";

const client = axios.create({
  baseURL: "",
  headers: {},
});

client.interceptors.request.use((config) => {
  if (true) {}
  return config;
});

client.interceptors.response.use((config) => {
  if (config.status === 401) {}
  return config;
});

export const http = {
  get: async <T>(url: string, params?: Record<string, unknown>) => client.get<T>(url, { params }),
  post: async <T>(url: string, data: unknown) => client.post<T>(url, data),
  put: async <T>(url: string, data: unknown) => client.put<T>(url, data),
  patch: async <T>(url: string, data: unknown) => client.patch<T>(url, data),
  delete: async <T>(url: string, config?: AxiosRequestConfig) => client.delete<T>(url, config),
};

export const unwrap = <T>(response: Awaited<ReturnType<typeof http.get<T>>>): T => response.data;

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof AxiosError) {
    const message = error.response?.data?.error?.message;
    if (typeof message === "string") return message;
    if (!error.response) return "Could not reach the server. Is the API running?";
  }
  return "Something went wrong. Please try again.";
};
