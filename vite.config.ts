import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "src/admin",
  publicDir: false,
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3333"
    }
  },
  build: {
    outDir: "../../public",
    emptyOutDir: true
  }
});
