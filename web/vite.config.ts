import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const API = process.env.VITE_API_TARGET ?? "http://localhost:8000";
const proxy = { "/api": API, "/health": API };

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon-180x180.png"],
      manifest: {
        name: "Pocket Apothecary",
        short_name: "Apothecary",
        description: "Scan your medications, catch conflicts, understand them in your language.",
        theme_color: "#3a3f49",
        background_color: "#eeecea",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      workbox: {
        // Include the bundled font files so text keeps its typeface offline.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // API calls must hit the network, never fall back to the cached app shell.
        navigateFallbackDenylist: [/^\/api/, /^\/health/],
        runtimeCaching: [
          {
            // FDA label text rarely changes, so reuse the last copy when offline.
            urlPattern: ({ url, request }) => request.method === "GET" && url.pathname.startsWith("/api/label/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "fda-labels",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: true, // lets your phone reach the dev server over Wi-Fi
    proxy,
  },
  preview: {
    host: true, // `npm run preview` runs the real service worker; test the PWA here
    allowedHosts: [".trycloudflare.com"], // HTTPS tunnel for phone testing (see README)
    proxy,
  },
});
