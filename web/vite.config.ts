import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const API = process.env.VITE_API_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Pocket Apothecary",
        short_name: "Apothecary",
        description: "Scan your medications, catch conflicts, understand them in your language.",
        theme_color: "#274690",
        background_color: "#F6F7F9",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
    }),
  ],
  server: {
    host: true, // lets your phone reach the dev server over Wi-Fi
    proxy: { "/api": API, "/health": API },
  },
});
