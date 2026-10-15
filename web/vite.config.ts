import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// BASE_PATH is the subpath the app is served from. GitLab Pages project sites live at
// /<project>/ unless "unique domain" is on; CI derives it from $CI_PAGES_URL.
// envDir: one .env at the repo root serves the web app and the standings job.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  envDir: "..",
  plugins: [react(), tailwindcss()],
});
