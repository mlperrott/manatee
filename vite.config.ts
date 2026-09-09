import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(({ command, isPreview }) => ({
  // The RC client-start development middleware currently returns 404 for its
  // own base path. Keep start mode for static production/preview builds and
  // use Vite's normal SPA entry during local development.
  base: command === "serve" && !isPreview ? "/" : "/manatee/",
  plugins: [solid({ start: command === "build" || isPreview === true })],
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
