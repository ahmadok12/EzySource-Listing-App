import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { buildRoutes } from "./router";
import { previewShells } from "./lib/features";
import { AuthProvider } from "./auth/AuthProvider";
import { createAuthAdapter } from "./auth/adapter";
import "./styles/base.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const authAdapter = createAuthAdapter();
const router = createBrowserRouter(buildRoutes({ previewShells }));

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider adapter={authAdapter}>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
