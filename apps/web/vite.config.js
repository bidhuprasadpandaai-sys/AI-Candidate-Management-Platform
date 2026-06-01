import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@acmp/chat": fileURLToPath(
        new URL("../../packages/chat/src/index.js", import.meta.url)
      )
    }
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
