import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "../src/store/auth";
import { LoadingScreen } from "../src/components/LoadingScreen";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

export default function RootLayout() {
  const { isLoading, checkAuth, loadServerConfig } = useAuthStore();

  useEffect(() => {
    const initialize = async () => {
      await loadServerConfig();
      await checkAuth();
    };
    initialize();
  }, []);

  if (isLoading) {
    return <LoadingScreen message="Initializing..." />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </QueryClientProvider>
  );
}
