import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The backend serves the API on :8000; in dev Vite proxies /api there so the
// browser never deals with CORS. `npm run build` writes frontend/dist, which the
// backend mounts at / when present.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:8000" },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
