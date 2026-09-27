import { readFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { EMBLEM_QUADRANT_PATH, EMBLEM_TILT } from "./src/lib/tf2-emblem";

const host = process.env.TAURI_DEV_HOST;
// Keep this in sync with `build.devUrl` in src-tauri/tauri.conf.json: the Tauri
// config is static JSON and cannot read the environment. See README.
const devPort = Number(process.env.EXECS_DEV_PORT ?? 1420);
const desktopPackage = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
) as { version: string };

/** index.html's startup emblem uses the same geometry as the in-app spinner. */
function bootEmblem(): Plugin {
  const quadrants = [0, 90, 180, 270]
    .map((turn) => `<path d="${EMBLEM_QUADRANT_PATH}" transform="rotate(${turn})"/>`)
    .join("");
  const svg = `<svg viewBox="-12 -12 24 24" aria-hidden="true" focusable="false"><g transform="rotate(${EMBLEM_TILT})" fill="currentColor">${quadrants}</g></svg>`;
  return {
    name: "execs-boot-emblem",
    transformIndexHtml: (html) => html.replace("<!--boot-emblem-->", svg),
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(desktopPackage.version),
  },
  plugins: [react(), tailwindcss(), bootEmblem()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // Prevent Vite from obscuring Rust errors during `tauri dev`.
  clearScreen: false,
  server: {
    port: devPort,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
