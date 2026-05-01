import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json";
import { fileURLToPath } from "node:url";

export default defineConfig(({ command }) => {
  const isDev = command === "serve";
  const appBase = isDev ? "/" : "/offline/";
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';"
    : "script-src 'self' 'wasm-unsafe-eval';";
  const csp = [
    "default-src 'self';",
    "connect-src 'self' blob: data:;",
    "img-src 'self' blob: data:;",
    "media-src 'self' blob: data:;",
    scriptSrc,
    "style-src 'self' 'unsafe-inline';",
    "worker-src 'self' blob:;",
    "font-src 'self' data:;",
  ].join(" ");

  return {
    base: appBase,
    server: {
      port: 5174,
      strictPort: true,
    },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    plugins: [
      {
        name: "pwa-csp",
        transformIndexHtml(html) {
          return html.replace("__PWA_CSP__", csp);
        },
      },
      react(),
      VitePWA({
        injectRegister: null,
        // Avoid forced app reloads during long-running analysis/playback.
        // Updates are applied on next launch/reload instead of mid-session.
        registerType: "prompt",
        includeAssets: ["favicon.png", "favicon-512.png", "worker.js", "madmom/**"],
        devOptions: {
          enabled: command === "serve",
          suppressWarnings: command === "serve",
        },
        manifest: {
          name: "The Forever Jukebox",
          short_name: "The Forever Jukebox",
          description: "Offline-first Forever Jukebox for local audio.",
          id: appBase,
          start_url: appBase,
          scope: appBase,
          display: "standalone",
          background_color: "#0c0f14",
          theme_color: "#0c0f14",
          icons: [
            {
              src: `${appBase}favicon.png`,
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: `${appBase}favicon-512.png`,
              sizes: "512x512",
              type: "image/png",
            },
          ],
        },
        workbox: {
          mode: "development",
          navigateFallback: `${appBase}index.html`,
          ...(isDev
            ? {}
            : {
                maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
                globPatterns: ["**/*.{js,css,html,wasm,json,webmanifest,png,svg,ico,ttf,woff,woff2,wav}"],
                runtimeCaching: [
                  {
                    urlPattern: ({ request }) =>
                      request.mode === "navigate" ||
                      ["script", "style", "worker", "image", "font", "audio"].includes(request.destination),
                    handler: "CacheOnly",
                  },
                ],
              }),
        },
      }),
    ],
    build: {
      target: "es2021",
    },
    test: {
      environment: "jsdom",
    },
  };
});
