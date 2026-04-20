import legacy from "@vitejs/plugin-legacy";
import { defineConfig } from "vite";

const castRewritePlugin = () => ({
  name: "cast-rewrite",
  configureServer(server: { middlewares: { use: Function } }) {
    server.middlewares.use((req: { url?: string }, _res: unknown, next: () => void) => {
      const url = req.url || "";
      if (url === "/cast" || url.startsWith("/cast/")) {
        req.url = "/cast-receiver.html";
      }
      next();
    });
  },
});

export default defineConfig(() => {
  const enableLan = process.env.VITE_LAN === "1";
  return {
    plugins: [
      legacy({
        targets: ["chrome 63"],
        additionalLegacyPolyfills: ["regenerator-runtime/runtime"],
      }),
      castRewritePlugin(),
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
    build: {
      rollupOptions: {
        input: {
          main: "index.html",
          cast: "cast-receiver.html",
        },
      },
    },
  };
});
