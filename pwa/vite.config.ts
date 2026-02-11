import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "/offline/",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "icons/*.png", "fonts/*", "worker.js", "madmom/**"],
      manifest: {
        name: "The Forever Jukebox",
        short_name: "The Forever Jukebox",
        description: "Offline-first Forever Jukebox for local audio.",
        id: "/offline/",
        start_url: "/offline/",
        scope: "/offline/",
        display: "standalone",
        background_color: "#0c0f14",
        theme_color: "#0c0f14",
        icons: [
          {
            src: "/offline/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/offline/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png"
          }
        ]
      },
      workbox: {
        mode: "development",
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,wasm,json,webmanifest,png,svg,ico,ttf,woff,woff2}"] ,
        navigateFallback: "/offline/index.html",
        runtimeCaching: [
          {
            urlPattern: ({ request }) =>
              request.mode === "navigate" ||
              ["script", "style", "worker", "image", "font"].includes(request.destination),
            handler: "CacheOnly"
          }
        ]
      }
    })
  ],
  build: {
    target: "es2021"
  },
  test: {
    environment: "jsdom"
  }
});
