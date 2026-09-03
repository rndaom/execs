/**
 * The `?preview=` adapter: the same command surface as `bridge.ts`, backed by
 * fixtures instead of Tauri IPC.
 *
 * This module is only ever reached through the `import.meta.env.DEV`-guarded
 * dynamic import in `api.ts`, so none of these fixtures ship in a production
 * bundle. Nothing here may import `@tauri-apps/*`.
 */
import type { Api } from "./api";
import {
  type AbsorbDelta,
  BridgeError,
  type ComfigState,
  type HitsoundRecord,
  type HitsoundSlotChange,
  type HudUiState,
  type ModRecord,
  type OfficialAddon,
  openEmbeddedPage,
  openExternal,
  type PreloaderStatusPayload,
  type ProfileDetail,
  type ProfileLibrary,
  type SwitchProgress,
  type Tf2Install,
} from "./bridge";
import { PREVIEW_COMFIG_STATE } from "./comfig-ui";
import { previewCrosshairRecord } from "./crosshair-ui";
import {
  emptyHudState,
  PREVIEW_HUD_CATALOG,
  PREVIEW_HUD_SCHEMA,
  previewInstalledState,
  schemaSupportedIds,
} from "./hud-ui";
import { recommendedLaunchOptions } from "./launch-ui";
import {
  emptyAbsorbDelta,
  emptyLibrary,
  previewPackDelta,
  previewSavedProfile,
  SWITCH_STEPS,
} from "./library-ui";
import {
  PREVIEW_GAMEBANANA_CATEGORIES,
  PREVIEW_GAMEBANANA_RECORDS,
  PREVIEW_MODS_CATALOG,
  PREVIEW_MODS_STATUS,
  PREVIEW_PARTICLE_SOURCES,
  PREVIEW_PROFILE_MODS,
  sortGameBananaMods,
} from "./mods-ui";
import {
  type PreviewState,
  previewConfirmed,
  previewFirstRunKind,
  previewFirstRunReasons,
  previewInstalls,
  previewLibrary,
  previewLocked,
  previewUpdate,
} from "./preview";
import { previewViewmodelRecord } from "./viewmodel-ui";

const PREVIEW_FILES: { path: string; text: string }[] = [
  {
    path: "tf/cfg/overrides/autoexec.cfg",
    text: "exec execs_binds // execs:managed\nexec execs_gameplay // execs:managed\nhost_writeconfig\n",
  },
  {
    path: "tf/cfg/overrides/danger.cfg",
    text: "unbindall\n",
  },
  {
    path: "tf/cfg/overrides/execs_binds.cfg",
    text: '// execs binds — managed, do not edit by hand\nbind w +forward\nbind s +back\nbind a +moveleft\nbind d +moveright\nbind space +jump\nbind ctrl +duck\nbind e "voicemenu 0 0"\nbind f +use\nbind v +voicerecord\nbind f1 "load_itempreset 0"\nbind f2 "load_itempreset 1"\n',
  },
  {
    path: "tf/cfg/overrides/execs_gameplay.cfg",
    text: "// execs gameplay — managed, do not edit by hand\nfov_desired 90\nviewmodel_fov 70\n",
  },
  {
    path: "tf/cfg/config.cfg",
    text: "bind w +forward\nbind s +back\nbind space +jump\nfov_desired 90\n",
  },
];

/** Non-cfg profile files, so the Comfig pane sees installed packages. */
const PREVIEW_PACKAGES = [
  "tf/custom/mastercomfig-base.vpk",
  "tf/custom/mastercomfig-addon-no-tutorial.vpk",
];

const BROWSED: Tf2Install = {
  path: "/home/user/.local/share/Steam/steamapps/common/Team Fortress 2",
};

function notInPreview(what: string): BridgeError {
  return new BridgeError(`${what} is not available in preview mode.`, "PreviewOnly");
}

export function createPreviewApi(state: PreviewState): Api {
  let installs = previewInstalls(state);
  let library: ProfileLibrary | null = previewLibrary(state);
  let files = PREVIEW_FILES.map((file) => ({ ...file }));
  let comfig: ComfigState = {
    ...PREVIEW_COMFIG_STATE,
    hasBaseVpk: true,
    hasComfigCustom: false,
  };
  let launchOptions = recommendedLaunchOptions();
  let hudState: HudUiState =
    state === "settings-hud-installed" ? previewInstalledState() : emptyHudState();
  let mods: ModRecord[] =
    state === "settings-mods" ? PREVIEW_PROFILE_MODS.map((m) => ({ ...m })) : [];
  let modsPayload: PreloaderStatusPayload = PREVIEW_MODS_STATUS;
  let crosshair = state === "settings-crosshair" ? previewCrosshairRecord() : null;
  let viewmodel = state === "settings-viewmodels" ? previewViewmodelRecord() : null;
  let hitsound: HitsoundRecord | null =
    state === "settings-sounds" ? { hit: { name: "quack", source: "community" } } : null;
  let progressHandler: ((progress: SwitchProgress) => void) | null = null;

  /** Only packs that are still installed can offer particles. */
  function particleSources() {
    return PREVIEW_PARTICLE_SOURCES.filter((source) => mods.some((mod) => mod.id === source.modId));
  }

  function detail(): ProfileDetail | null {
    const active = library?.profiles.find((profile) => profile.id === library?.activeProfileId);
    if (!active) {
      return null;
    }
    return {
      id: active.id,
      name: active.name,
      launchOptions,
      layer: "comfig",
      files: [...files.map((file) => file.path), ...PREVIEW_PACKAGES].map((path) => ({
        path,
        sha256: "",
        storage: "exclusive" as const,
      })),
      hud: hudState.installed,
      crosshair,
      viewmodel,
      hitsound,
      mods,
    };
  }

  function requireDetail(): ProfileDetail {
    const next = detail();
    if (!next) {
      throw notInPreview("This profile action");
    }
    return next;
  }

  function upsert(path: string, text: string) {
    files = files.some((file) => file.path === path)
      ? files.map((file) => (file.path === path ? { path, text } : file))
      : [...files, { path, text }];
  }

  /** Replay the real switch stages through whatever listener is registered. */
  function emitSwitchSteps() {
    for (const step of SWITCH_STEPS) {
      progressHandler?.({ step: step.id, detail: null });
    }
  }

  function addProfile(name: string, activate: boolean): ProfileLibrary {
    const base = library ?? emptyLibrary(BROWSED.path, true);
    const profile = previewSavedProfile(name || "Fresh", base.profiles.length + 1);
    library = {
      ...base,
      initialized: true,
      usable: true,
      activeProfileId: activate ? profile.id : (base.activeProfileId ?? profile.id),
      profiles: [...base.profiles, profile],
    };
    return library;
  }

  const api: Api = {
    // --- finder -------------------------------------------------------------
    async scanTf2Installs() {
      return installs;
    },
    async browseTf2Root() {
      if (!installs.some((item) => item.path === BROWSED.path)) {
        installs = [...installs, BROWSED];
      }
      return BROWSED;
    },
    async confirmTf2Root(path: string) {
      if (!library) {
        library = emptyLibrary(path, true);
      }
      return { path };
    },
    async getTf2Root() {
      return previewConfirmed(state);
    },
    async getTf2WriteLock() {
      return { running: previewLocked(state) };
    },
    async onTf2Running() {
      // The preview never changes lock state; the seed from `getTf2WriteLock`
      // is the whole story.
      return () => {};
    },

    // --- library ------------------------------------------------------------
    async getProfileLibrary() {
      return library ?? emptyLibrary(BROWSED.path, true);
    },
    async initProfileLibrary() {
      library = { ...(library ?? emptyLibrary(BROWSED.path, true)), initialized: true };
      return library;
    },
    async saveCurrentAs(name: string) {
      return addProfile(name, library?.activeProfileId === null);
    },
    async absorbOwned() {
      const delta: AbsorbDelta = state === "absorb" ? previewPackDelta() : emptyAbsorbDelta();
      return {
        library: library ?? emptyLibrary(BROWSED.path, true),
        delta,
        configCfgAbsorbed: false,
        repaired: [],
      };
    },
    async absorbPacks() {
      return library ?? emptyLibrary(BROWSED.path, true);
    },
    async switchProfile(id: string) {
      emitSwitchSteps();
      library = { ...(library ?? emptyLibrary(BROWSED.path, true)), activeProfileId: id };
      return library;
    },
    async onSwitchProgress(handler: (progress: SwitchProgress) => void) {
      progressHandler = handler;
      return () => {
        progressHandler = null;
      };
    },
    async exportProfile() {
      return null;
    },
    async importProfile() {
      return addProfile(`Imported ${(library?.profiles.length ?? 0) + 1}`, false);
    },

    // --- first run ----------------------------------------------------------
    async classifyFirstRun() {
      return {
        kind: previewFirstRunKind(state) ?? "existing",
        reasons: previewFirstRunReasons(state).length
          ? previewFirstRunReasons(state)
          : previewFirstRunReasons("library"),
      };
    },
    async applyUnusedWizard(spec) {
      emitSwitchSteps();
      return addProfile(spec.name, true);
    },
    async createFreshProfile(spec) {
      emitSwitchSteps();
      return addProfile(spec.name, true);
    },

    // --- profile files ------------------------------------------------------
    async getActiveProfileDetail() {
      return detail();
    },
    async readProfileFile(path: string) {
      const found = files.find((file) => file.path === path);
      if (!found) {
        throw notInPreview(`Reading ${path}`);
      }
      return { path, text: found.text, sha256: "", binary: false };
    },
    async writeOwnedFile(path: string, text: string) {
      upsert(path, text);
      return requireDetail();
    },

    // --- comfig -------------------------------------------------------------
    async getComfigState() {
      return comfig;
    },
    async setComfigPreset(preset) {
      comfig = { ...comfig, preset };
      return requireDetail();
    },
    async setComfigModules(modules) {
      comfig = { ...comfig, modules };
      return requireDetail();
    },
    async setComfigAddons(addons: OfficialAddon[]) {
      comfig = { ...comfig, addons };
      return requireDetail();
    },
    async updateComfigVpks() {
      return requireDetail();
    },
    async importComfigCustom() {
      comfig = { ...comfig, hasComfigCustom: true };
      return requireDetail();
    },

    // --- launch -------------------------------------------------------------
    async recommendedLaunchOptions() {
      return recommendedLaunchOptions();
    },
    async getProfileLaunchOptions() {
      return launchOptions;
    },
    async setProfileLaunchOptions(options: string) {
      launchOptions = options;
      return { launchOptions: options, steamWrite: "steam_open" as const };
    },

    // --- HUD ----------------------------------------------------------------
    async getHudCatalog() {
      return PREVIEW_HUD_CATALOG;
    },
    async getHudState() {
      return hudState;
    },
    async getHudAlbum() {
      return [];
    },
    async getHudStats() {
      return {
        rayshud: { updated: "2026-01-11", downloads: 398380, views: 1168295 },
        toonhud: { updated: "2024-03-02" },
      };
    },
    async installHud(id: string) {
      const entry = PREVIEW_HUD_CATALOG.find((item) => item.id === id);
      const supported = schemaSupportedIds().includes(id);
      hudState = {
        installed: { id, hash: entry?.hash ?? null, source: "hudDb", options: {} },
        inferred: false,
        schemaSupported: supported,
        catalogHash: entry?.hash ?? null,
        updateAvailable: false,
      };
      return requireDetail();
    },
    async importHudArchive() {
      throw notInPreview("Importing a HUD archive");
    },
    async importHudFolder() {
      throw notInPreview("Importing a HUD folder");
    },
    async matchHudCatalog(id: string) {
      return api.installHud(id);
    },
    async updateHud() {
      if (hudState.installed) {
        hudState = {
          ...hudState,
          installed: { ...hudState.installed, hash: hudState.catalogHash },
          updateAvailable: false,
        };
      }
      return requireDetail();
    },
    async getHudSchema() {
      return hudState.schemaSupported ? PREVIEW_HUD_SCHEMA : null;
    },
    async applyHudOptions(options: Record<string, string>) {
      if (hudState.installed) {
        hudState = { ...hudState, installed: { ...hudState.installed, options } };
      }
      return requireDetail();
    },

    // --- crosshair ----------------------------------------------------------
    async applyCrosshairs(shape, assignments, _customRgba, color, _library, design) {
      crosshair = {
        id: "preview",
        shape,
        assignments,
        color: color ?? null,
        library: crosshair?.library,
        design: design ?? null,
      };
      return requireDetail();
    },
    async fetchCommunityCrosshair(file: string) {
      throw notInPreview(`Downloading ${file}`);
    },
    async fetchCommunityCrosshairPreviews() {
      // No network in preview: the picker shows name-only tiles.
      return {};
    },
    async getPackCrosshairPreviews() {
      // Decoded sprites need the user's own game files; the panes fall back to
      // their drawn geometry, which is exactly what preview should show.
      throw notInPreview("Pack crosshair previews");
    },
    async getStockCrosshairSprites() {
      throw notInPreview("Stock crosshair sprites");
    },
    async removeCrosshairs() {
      crosshair = null;
      return requireDetail();
    },

    // --- viewmodels ---------------------------------------------------------
    async buildViewmodelPack(hidden: string[], preload: boolean, hideMode = "full" as const) {
      viewmodel = {
        id: "preview",
        source: "compiled",
        preload,
        options: { hidden: hidden.join(","), mode: hideMode },
      };
      return requireDetail();
    },
    async importViewmodels(preload: boolean) {
      viewmodel = { id: "preview", source: "imported", preload, options: {} };
      return requireDetail();
    },
    async removeViewmodels() {
      viewmodel = null;
      return requireDetail();
    },
    async viewmodelPreviewImage(name: string) {
      throw notInPreview(`Fetching the ${name} preview`);
    },
    async viewmodelBuildAvailable() {
      return true;
    },
    async setViewmodelPreload(enabled: boolean) {
      if (viewmodel) {
        viewmodel = { ...viewmodel, preload: enabled };
      }
      return requireDetail();
    },

    // --- hit and kill sounds ------------------------------------------------
    async hitsoundBytes() {
      throw notInPreview("Auditioning sounds");
    },
    async comfigHitsoundIndex() {
      return [
        { name: "Quake 3 hit", hash: "a".repeat(128), kind: "hit" as const },
        { name: "Kill bell", hash: "b".repeat(128), kind: "kill" as const },
      ];
    },
    async listStockHitsounds() {
      // Every stock effect is "present" in preview; nothing can play anyway.
      const { STOCK_HITSOUND_EFFECTS } = await import("./hitsound-ui");
      return STOCK_HITSOUND_EFFECTS.flatMap((effect) => [effect.hit, effect.kill]);
    },
    async pickHitsoundFile() {
      throw notInPreview("Picking a sound file");
    },
    async applyHitsounds(hit: HitsoundSlotChange, kill: HitsoundSlotChange) {
      const next: HitsoundRecord = { ...(hitsound ?? {}) };
      const apply = (slot: "hit" | "kill", change: HitsoundSlotChange) => {
        if (change.change === "clear") {
          next[slot] = null;
        } else if (change.change === "install") {
          const pick = change.pick;
          const boost = change.boost;
          next[slot] =
            pick.kind === "community"
              ? { name: pick.name, source: "community", boost }
              : pick.kind === "file"
                ? { name: pick.name, source: "file", boost }
                : pick.kind === "comfig"
                  ? { name: pick.name, source: "comfig", boost }
                  : next[slot]
                    ? { ...next[slot], boost }
                    : null;
        }
      };
      apply("hit", hit);
      apply("kill", kill);
      hitsound = next.hit || next.kill ? next : null;
      return requireDetail();
    },
    async removeHitsounds() {
      hitsound = null;
      return requireDetail();
    },

    // --- links (already browser-safe in bridge.ts) ---------------------------
    openExternal,
    openEmbeddedPage,

    // --- your mods and GameBanana -------------------------------------------
    async importModArchive() {
      throw notInPreview("Importing a mod archive");
    },
    async importModFolder() {
      throw notInPreview("Importing a mod folder");
    },
    async removeMod(id: string) {
      mods = mods.filter((mod) => mod.id !== id);
      modsPayload = {
        ...modsPayload,
        status: {
          ...modsPayload.status,
          profileParticleMods: (modsPayload.status.profileParticleMods ?? []).filter((modId) =>
            mods.some((mod) => mod.id === modId),
          ),
        },
        profileParticleSources: particleSources(),
      };
      return requireDetail();
    },
    async searchGameBananaMods(
      query: string,
      sort,
      category: number | null,
      page: number,
      includeMature = false,
    ) {
      const needle = query.trim().toLowerCase();
      const matching = PREVIEW_GAMEBANANA_RECORDS.filter((record) => {
        const hitsQuery =
          needle === "" ||
          record.name.toLowerCase().includes(needle) ||
          record.author.toLowerCase().includes(needle);
        return hitsQuery && (category === null || record.categoryId === category);
      });
      // A small page so the preview exercises the pager, not one long grid.
      const perPage = 3;
      const start = (page - 1) * perPage;
      const slice = sortGameBananaMods(matching, sort).slice(start, start + perPage);
      return {
        // Flagged records are dropped from the page, not from the run: the
        // count and the pager still describe every listing, like the real one.
        records: includeMature ? slice : slice.filter((record) => !record.mature),
        total: matching.length,
        perPage,
        complete: start + slice.length >= matching.length,
      };
    },
    async gameBananaModCategories() {
      return PREVIEW_GAMEBANANA_CATEGORIES;
    },
    async installGameBananaMod(id: number) {
      const listing = PREVIEW_GAMEBANANA_RECORDS.find((record) => record.id === id);
      if (!listing) {
        throw notInPreview(`Installing mod ${id}`);
      }
      if (!mods.some((mod) => mod.source.kind === "gamebanana" && mod.source.id === id)) {
        mods = [
          ...mods,
          {
            id: `gb-${id}`,
            name: listing.name,
            source: { kind: "gamebanana", id, url: listing.url },
            pack: `${listing.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.vpk`,
            files: 12,
            bytes: 4_200_000,
            installedAt: new Date().toISOString(),
          },
        ];
        modsPayload = { ...modsPayload, profileParticleSources: particleSources() };
      }
      return requireDetail();
    },

    // --- preloader ----------------------------------------------------------
    async getPreloaderStatus() {
      return { ...modsPayload, profileParticleSources: particleSources() };
    },
    async getDefaultMods() {
      return { cached: true, catalog: PREVIEW_MODS_CATALOG };
    },
    async downloadDefaultMods() {
      modsPayload = { ...modsPayload, modsCached: true };
      return { cached: true, catalog: PREVIEW_MODS_CATALOG };
    },
    async applyPreloaderMods(
      addons: string[],
      particleMods: string[],
      profileParticleMods: string[] = [],
    ) {
      modsPayload = {
        ...modsPayload,
        status: {
          ...modsPayload.status,
          addons,
          particleMods,
          profileParticleMods,
          stale: false,
        },
      };
      return {
        patchedFiles: modsPayload.status.patchedFiles,
        skipped: [],
        addonsInstalled: addons,
        particleModsInstalled: particleMods,
        customVpkWritten: true,
        gameinfoBypassed: modsPayload.status.gameinfoBypassed,
        baselineReset: false,
        synthesizedVmts: 0,
        relocatedModelMaterials: 0,
      };
    },
    async setGameinfoBypass(enabled: boolean) {
      modsPayload = {
        ...modsPayload,
        status: { ...modsPayload.status, gameinfoBypassed: enabled },
      };
      return modsPayload;
    },
    async setProfilePreload(enabled: boolean) {
      modsPayload = { ...modsPayload, profilePreload: enabled };
      if (viewmodel) {
        viewmodel = { ...viewmodel, preload: enabled };
      }
      return modsPayload;
    },
    async launchTf2() {
      // Steam is not reachable from the preview; the button is a no-op here.
    },
    async repairGameFiles() {
      modsPayload = {
        ...modsPayload,
        status: { ...modsPayload.status, untrackedModified: [] },
      };
    },
    async revertPreloader() {
      modsPayload = {
        ...modsPayload,
        status: {
          ...modsPayload.status,
          gameinfoBypassed: false,
          addons: [],
          particleMods: [],
          profileParticleMods: [],
          patchedFiles: [],
          customVpkPresent: false,
          stale: false,
          untrackedModified: [],
        },
      };
      return {
        restoredFiles: [],
        failures: [],
        gameinfoRestored: true,
        customVpkRemoved: true,
      };
    },

    // --- updater ------------------------------------------------------------
    async getAppVersion() {
      const { PREVIEW_APP_VERSION } = await import("./updater-ui");
      return PREVIEW_APP_VERSION;
    },
    async getDiagnostics() {
      const { PREVIEW_APP_VERSION } = await import("./updater-ui");
      return `execs ${PREVIEW_APP_VERSION}\nOS: preview\nTF2: ${BROWSED.path}\nProfiles: 1 (active: Main)\npanic.log: none\n`;
    },
    async checkAppUpdate() {
      return previewUpdate(state);
    },
    async installAppUpdate(onProgress) {
      onProgress("downloading");
      onProgress("installing");
      onProgress("restarting");
    },
  };

  return api;
}
