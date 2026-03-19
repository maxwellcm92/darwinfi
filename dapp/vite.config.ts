import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/darwinfi/",
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3502",
        changeOrigin: true,
      },
    },
  },
});
