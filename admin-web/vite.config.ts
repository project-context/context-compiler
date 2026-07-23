import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendOrigin = "http://127.0.0.1:7799";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 7798,
    strictPort: true,
    proxy: {
      "/api": backendOrigin,
      "/docs": backendOrigin,
      "/openapi.json": backendOrigin,
    },
  },
});
