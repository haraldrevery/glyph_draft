import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Tauri expects a fixed dev port and quiet logging; these settings are inert
// for the plain web build, so a single config serves both targets. The `@`
// alias is resolved from import.meta.url (ESM-safe — no __dirname) so it works
// regardless of how the config is loaded.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2020",
    sourcemap: true,
  },
  // Pure-engine unit tests run in plain Node (no DOM needed). See CLAUDE.md.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
