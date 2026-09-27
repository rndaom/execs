import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Serves the desktop app's browser preview the way a release build looks, for
 * promo and README captures. It changes nothing in apps/desktop:
 *
 * - Development-only surfaces (Inventory, "Preview data" labels, Files catalog
 *   gaps) are compiled out, as `vite build` does for the packaged app.
 * - Class emblems come from `EXECS_CLASS_ICONS` (default: the gitignored
 *   `capture/class-icons.local.json`), a JSON dump of the owner's own
 *   `get_class_icons` result. Without it every class falls back to its name,
 *   exactly as the normal preview does. The emblems reach only rendered media.
 */
const desktop = path.resolve(__dirname, "../../../apps/desktop");
const desktopPackage = JSON.parse(readFileSync(path.join(desktop, "package.json"), "utf8")) as {
  version: string;
};

const RELEASE_LOOK = ["src/lib/settings-ui.ts", "src/SettingsHost.tsx", "src/FilesPane.tsx"];
const CLASS_ICONS_STUB = "async getClassIcons() {\n      return {};\n    }";
const CLASS_ICONS_MODULE = "virtual:execs-capture-class-icons";

function releaseLook(): Plugin {
  return {
    name: "execs-release-look",
    enforce: "pre",
    resolveId(id) {
      return id === CLASS_ICONS_MODULE ? `\0${CLASS_ICONS_MODULE}` : null;
    },
    load(id) {
      if (id !== `\0${CLASS_ICONS_MODULE}`) return null;
      const dump = process.env.EXECS_CLASS_ICONS ?? path.join(__dirname, "class-icons.local.json");
      return `export default ${existsSync(dump) ? readFileSync(dump, "utf8") : "{}"};`;
    },
    transform(code, id) {
      const file = id.split("?")[0].replaceAll("\\", "/");
      if (RELEASE_LOOK.some((suffix) => file.endsWith(suffix))) {
        return code.replaceAll("import.meta.env.DEV", "false");
      }
      if (file.endsWith("src/lib/preview-bridge.ts")) {
        if (!code.includes(CLASS_ICONS_STUB)) {
          throw new Error("preview-bridge getClassIcons changed; update the capture config.");
        }
        return code.replace(
          CLASS_ICONS_STUB,
          `async getClassIcons() {\n      return (await import("${CLASS_ICONS_MODULE}")).default;\n    }`,
        );
      }
      return null;
    },
  };
}

export default defineConfig({
  root: desktop,
  define: {
    __APP_VERSION__: JSON.stringify(desktopPackage.version),
  },
  plugins: [releaseLook(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.join(desktop, "src"),
    },
  },
  clearScreen: false,
  server: {
    port: Number(process.env.EXECS_CAPTURE_PORT ?? 1433),
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
