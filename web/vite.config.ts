import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// BASE_PATH is the subpath the app is served from. GitHub Pages project sites live at
// /<repo>/; the deploy workflow gets it from actions/configure-pages.
// envDir: one .env at the repo root serves the web app and the standings job.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  envDir: "..",
  plugins: [react(), tailwindcss()],
});
