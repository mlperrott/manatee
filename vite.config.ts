import solid from "@solidjs/vite-plugin";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// Keep precise clocks in browser tests, including cached worker responses.
// Vite's server.headers are applied to 200 responses but not early 304s.
const browserTestTiming: Plugin = {
  name: "manatee-browser-test-timing",
  apply: "serve",
  configureServer(server) {
    if (process.env.MANATEE_BROWSER_TESTS !== "1") return;
    server.middlewares.use((_request, response, next) => {
      response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      next();
    });
  },
};

export default defineConfig(({ command, isPreview }) => ({
  // The RC client-start development middleware currently returns 404 for its
  // own base path. Keep start mode for static production/preview builds and
  // use Vite's normal SPA entry during local development.
  base: command === "serve" && !isPreview ? "/" : "/manatee/",
  plugins: [
    solid({ start: command === "build" || isPreview === true }),
    browserTestTiming,
  ],
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
}));
