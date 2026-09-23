import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // src/pwa.tsx registers the worker itself, to pass updateViaCache: "none".
      injectRegister: false,
      registerType: "prompt",
      manifest: {
        name: "Todo",
        short_name: "Todo",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallback: "/index.html",
        // Worker-owned paths: the API, MCP and the OAuth endpoints must always reach the network.
        navigateFallbackDenylist: [/^\/api\//, /^\/mcp/, /^\/authorize/, /^\/connect\//, /^\/token/, /^\/register/, /^\/\.well-known\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
