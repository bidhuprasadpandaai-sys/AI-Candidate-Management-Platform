import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  // Read the shared repo-root .env. Only VITE_-prefixed variables are exposed to browser code;
  // AI keys and other secrets must never use that prefix.
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
  envPrefix: "VITE_",
  resolve: {
    alias: {
      "@acmp/chat": fileURLToPath(
        new URL("../../packages/chat/src/index.js", import.meta.url)
      )
    }
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.js"],
    restoreMocks: true
  },
  server: {
    port: 4410,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://localhost:4310",
        changeOrigin: true
      }
    }
  }
});
