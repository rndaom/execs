import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { buildPromoBackpack, promoArtFile } from "./backpack";

/**
 * Serves the desktop app's browser preview the way a release build looks, for
 * promo and README captures. It changes nothing in apps/desktop:
 *
 * - Development-only surfaces ("Preview data" labels, Files catalog gaps) are
 *   compiled out, as `vite build` does for the packaged app. Inventory stays:
 *   it ships in 0.2.0.
 * - Class emblems come from `EXECS_CLASS_ICONS` (default: the gitignored
 *   `capture/class-icons.local.json`), a JSON dump of the owner's own
 *   `get_class_icons` result. Without it every class falls back to its name,
 *   exactly as the normal preview does.
 * - Inventory shows a promo backpack built from the owner's Inventory art cache
 *   (see backpack.ts) in the app's own simulator, with the release app's live
 *   wording instead of the simulator's labels. Without a cache it keeps the
 *   preview's test backpack.
 *
 * Emblems and item art reach only rendered media, never the repository.
 */
const desktop = path.resolve(__dirname, "../../../apps/desktop");
const desktopPackage = JSON.parse(readFileSync(path.join(desktop, "package.json"), "utf8")) as {
  version: string;
};
const dataDir =
  process.env.EXECS_DATA_DIR ??
  (process.platform === "win32"
    ? path.join(process.env.APPDATA ?? "", "execs")
    : path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local/share"), "execs"));

const CLASS_ICONS = "virtual:execs-capture-class-icons";
const BACKPACK = "virtual:execs-capture-backpack";
const ART_ROUTE = "/__promo-art";

/** Exact source edits by file; a missing anchor fails loudly instead of capturing the wrong UI. */
const EDITS: Record<string, [string, string][]> = {
  "src/FilesPane.tsx": [["import.meta.env.DEV", "false"]],
  "src/SettingsHost.tsx": [
    ["previewData={import.meta.env.DEV && !isTauri()}", "previewData={false}"],
  ],
  "src/lib/preview-bridge.ts": [
    [
      "async getClassIcons() {\n      return {};\n    }",
      `async getClassIcons() {\n      return (await import("${CLASS_ICONS}")).default;\n    }`,
    ],
    // Steam already has the profile's launch options, the usual state, so the
    // header carries no sample-data warning.
    ['const steamOptions = "-novid";', "const steamOptions = launchOptions;"],
    // The sample crosshair pack was built by this version, so Crosshair shows
    // no legacy-pack notice.
    [
      'state: crosshair ? ("unverified" as const) : ("none" as const)',
      'state: crosshair ? ("current" as const) : ("none" as const)',
    ],
    // Sounds starts from TF2's default hit sound, not a retired catalog sound
    // with its legacy notice.
    [
      'state === "settings-sounds" ? { hit: { name: "quack", source: "community" } } : null;',
      "null;",
    ],
    // comfig.app sounds are back in the app; the preview's saver still refused them.
    [
      '["community", "comfig"].includes(change.pick.kind)',
      '["community"].includes(change.pick.kind)',
    ],
    [
      `? { name: pick.name, source: "file", boost }
              : next[slot]`,
      `? { name: pick.name, source: "file", boost }
              : pick.kind === "comfig"
                ? { name: pick.name, source: "comfig", hash: pick.hash, boost }
                : next[slot]`,
    ],
  ],
  "src/lib/inventory-simulation.ts": [
    [
      "export function inventoryFixture(): InventorySnapshot {",
      `import PROMO_BACKPACK from "${BACKPACK}";
if (PROMO_BACKPACK) {
  // Seed the account's saved protections once, as the app would have them.
  const key = "execs:inventory-preferences:v1:" + encodeURIComponent(PROMO_BACKPACK.snapshot.steamId);
  try {
    if (!localStorage.getItem(key))
      localStorage.setItem(key, JSON.stringify({ version: 1, account: PROMO_BACKPACK.snapshot.steamId, protectedIds: PROMO_BACKPACK.protectedIds, favoriteIds: [], searches: [], layouts: [], history: [] }));
  } catch {}
}
export function inventoryFixture(): InventorySnapshot {
  if (PROMO_BACKPACK) return structuredClone(PROMO_BACKPACK.snapshot);`,
    ],
    [
      "export function inventorySteamFixture(snapshot: InventorySnapshot): SteamItems {",
      `export function inventorySteamFixture(snapshot: InventorySnapshot): SteamItems {
  if (PROMO_BACKPACK) {
    const items: SteamItems["items"] = {};
    for (const item of snapshot.items) {
      const known = PROMO_BACKPACK.steam[item.id];
      const definition = snapshot.definitions[item.definition];
      const image = PROMO_BACKPACK.artByDefinition[item.definition];
      if (known) items[item.id] = known;
      else if (image && definition)
        items[item.id] = {
          image,
          name: definition.name,
          marketName: definition.name,
          nameColor: "#7D6D00",
          typeLine: \`Level \${item.level} \${definition.kind}\`,
          lines: [],
          originalName: null,
        };
    }
    return { status: "ready", message: null, items };
  }`,
    ],
    [
      `    async getInventorySteamImage(): Promise<ArrayBuffer> {
      throw new BridgeError("Preview data has no Steam item art.", "InventoryUnavailable");
    },`,
      `    async getInventorySteamImage(image: string, size: number): Promise<ArrayBuffer> {
      const response = await fetch(\`${ART_ROUTE}?size=\${size}&image=\${encodeURIComponent(image)}\`);
      if (!response.ok)
        throw new BridgeError("Preview data has no Steam item art.", "InventoryUnavailable");
      return response.arrayBuffer();
    },`,
    ],
    [
      `\`Simulated \${request.moves.length} moves. Steam was not changed.\``,
      `\`Applied \${request.moves.length} moves.\``,
    ],
  ],
  "src/lib/inventory-crafting.ts": [
    // The random hat is one of the backpack's own hats, and every craft repeats exactly.
    [
      "const MAX_ITEM_ID = 18446744073709551615n;",
      `if (PROMO_BACKPACK?.hat) {
  for (const key of Object.keys(SIMULATED_HATS)) delete SIMULATED_HATS[Number(key)];
  SIMULATED_HATS[PROMO_BACKPACK.hat.definition] = PROMO_BACKPACK.hat.name;
}
const MAX_ITEM_ID = 18446744073709551615n;`,
    ],
    ["Math.random()", "0.37"],
    [
      `\`Simulation complete: created \${created}. Steam items were not changed.\``,
      `\`Crafted \${created}.\``,
    ],
  ],
  "src/lib/inventory-deletion.ts": [
    ['"Deleted the selected fixture item. Steam was not changed."', '"Deleted the selected item."'],
  ],
  // The simulator's labels become the release app's live wording.
  "src/InventoryOrganizer.tsx": [
    [
      '"Test backpack. Steam is never contacted."',
      '"Applies these exact positions to your Steam backpack."',
    ],
    [': "Apply simulation"}', ': "Apply to Steam"}'],
  ],
  "src/InventoryCrafting.tsx": [
    [
      '"Test backpack only; Steam is not changed. Crafting has no Undo."',
      '"Consumes these exact items from your Steam backpack. Crafting has no Undo."',
    ],
    [`\${capability === "live" ? "Crafted" : "Simulated"}`, "Crafted"],
    [`\${capability === "live" ? "" : " Steam items were not changed."}`, ""],
    [`? \`Simulate \${count} crafts\``, `? \`Craft \${count} times permanently\``],
    [': "Simulate craft"}', ': "Craft items permanently"}'],
  ],
  "src/InventoryDeletion.tsx": [
    [
      '"Test backpack only; Steam is not changed. Deletion cannot be undone."',
      '"Permanently removes this item from your Steam backpack. Deletion cannot be undone."',
    ],
    ['? "Simulate deletion"', '? "Delete item permanently"'],
  ],
  "src/InventoryPolish.tsx": [
    ['simulated: "Simulated · Steam unchanged",', 'simulated: "Confirmed",'],
  ],
  "src/InventoryPane.tsx": [
    [
      '"Test backpack. Steam is never contacted."',
      '"Your signed-in Steam backpack. Applied changes affect this Steam account, not a customization profile."',
    ],
  ],
};

function releaseLook(): Plugin {
  const backpack = buildPromoBackpack(dataDir);
  return {
    name: "execs-release-look",
    enforce: "pre",
    resolveId(id) {
      return id === CLASS_ICONS || id === BACKPACK ? `\0${id}` : null;
    },
    load(id) {
      if (id === `\0${CLASS_ICONS}`) {
        const dump =
          process.env.EXECS_CLASS_ICONS ?? path.join(__dirname, "class-icons.local.json");
        return `export default ${existsSync(dump) ? readFileSync(dump, "utf8") : "{}"};`;
      }
      if (id === `\0${BACKPACK}`) return `export default ${JSON.stringify(backpack)};`;
      return null;
    },
    configureServer(server) {
      server.middlewares.use(ART_ROUTE, (request, response) => {
        const url = new URL(request.url ?? "", "http://capture");
        const file = promoArtFile(
          dataDir,
          url.searchParams.get("image") ?? "",
          Number(url.searchParams.get("size")),
        );
        if (!file) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.setHeader("Content-Type", "image/png");
        response.end(readFileSync(file));
      });
    },
    transform(code, id) {
      const file = id.split("?")[0].replaceAll("\\", "/");
      const edits = Object.entries(EDITS).find(([suffix]) => file.endsWith(suffix))?.[1];
      if (!edits) return null;
      let next = code;
      for (const [from, to] of edits) {
        if (!next.includes(from))
          throw new Error(
            `${file} changed near ${JSON.stringify(from.slice(0, 60))}; update the capture config.`,
          );
        next = next.replaceAll(from, to);
      }
      if (file.endsWith("src/lib/inventory-crafting.ts")) {
        next = `import PROMO_BACKPACK from "${BACKPACK}";\n${next}`;
      }
      return next;
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
