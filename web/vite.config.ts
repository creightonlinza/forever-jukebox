import legacy from "@vitejs/plugin-legacy";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import pkg from "./package.json";

export default defineConfig(() => {
  const enableLan = process.env.VITE_LAN === "1";
  return {
    define: {
      // Reported in feedback submissions; the date distinguishes deploys
      // that share a package version.
      __APP_VERSION__: JSON.stringify(
        `${pkg.version} (${new Date().toISOString().slice(0, 10)})`,
      ),
    },
    plugins: [
      react(),
      legacy({
        targets: ["chrome 63"],
        // Loaded only by the nomodule bundle; main.ts loads the AbortController polyfill.
        additionalLegacyPolyfills: [
          "core-js/es/promise",
          "core-js/es/array/includes",
          "core-js/es/object/assign",
          "core-js/es/set",
          "core-js/es/map",
          "core-js/es/symbol",
          "core-js/web/url",
          "core-js/web/url-search-params",
          "regenerator-runtime/runtime",
        ],
      }),
    ],
    server: {
      port: 5173,
      host: enableLan ? true : "localhost",
      ...(enableLan ? { allowedHosts: ["c-macbook.local"] } : {}),
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
        },
        "/sitemap.xml": {
          target: "http://localhost:8000",
        },
        "/robots.txt": {
          target: "http://localhost:8000",
        },
      },
    },
    test: {
      environment: "node",
      environmentMatchGlobs: [["**/*.test.tsx", "jsdom"] as [string, "jsdom"]],
      exclude: ["e2e/**", "node_modules/**", "dist/**"],
    },
  };
});
