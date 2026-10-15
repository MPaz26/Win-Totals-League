import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./index.css";
import { AuthProvider } from "./lib/auth";
import { NoticeProvider } from "./lib/notice";
import { isConfigured } from "./lib/supabase";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1 },
  },
});

const root = createRoot(document.getElementById("root")!);

if (!isConfigured) {
  root.render(
    <div className="mx-auto max-w-lg p-8 text-sm">
      <h1 className="mb-2 text-lg font-semibold">Supabase isn't configured</h1>
      <p>
        Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see <code>.env.example</code>) and
        restart the dev server.
      </p>
    </div>,
  );
} else {
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <NoticeProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </NoticeProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
