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
        additionalLegacyPolyfills: ["regenerator-runtime/runtime"],
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
