/**
 * The `?preview=` adapter: the same command surface as `bridge.ts`, backed by
 * fixtures instead of Tauri IPC.
 *
 * This module is only ever reached through the `import.meta.env.DEV`-guarded
 * dynamic import in `api.ts`, so none of these fixtures ship in a production
 * bundle. Nothing here may import `@tauri-apps/*`.
 */
import type { Api } from "./api";
import { ensureAutoexecExecLine } from "./binds-ui";
import {
  type AbsorbDelta,
  BridgeError,
  type ComfigState,
  type FilesSource,
  type GameBananaDownloadVariant,
  type GameBananaMod,
  type GameBananaSort,
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
import { isNewCfgPath } from "./files-create";
import { editorPathFits, editorTextBytes } from "./files-limits";
import { defaultGameplay, parseCvarMap } from "./gameplay-ui";
import { PREVIEW_HUD_BROWSER_CATALOG, PREVIEW_HUD_BROWSER_STATS } from "./hud-browser-preview";
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

/** Preview-only simulation of GameBanana's global server order. Production
 * records are already ordered and must never pass through this helper. */
function previewGameBananaOrder(records: GameBananaMod[], sort: GameBananaSort): GameBananaMod[] {
  const value = (record: GameBananaMod): number | null => {
    switch (sort) {
      case "downloads":
        return record.downloads;
      case "likes":
        return record.likes;
      case "views":
        return record.views;
      case "updated":
        return record.updatedAt;
      case "new":
        return record.addedAt;
    }
  };
  return records
    .map((record, index) => ({ record, index, value: value(record) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      return b.value - a.value || a.index - b.index;
    })
    .map(({ record }) => record);
}

const PREVIEW_FILES: { path: string; text: string }[] = [
  {
    path: "tf/cfg/overrides/autoexec.cfg",
    text: "exec overrides/execs_binds // execs:managed\nexec overrides/execs_gameplay // execs:managed\nhost_writeconfig\n",
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
  let appPreferences = { checkForUpdatesOnStartup: true, motion: "system" as "system" | "reduce" };
  let failNextAppPreferenceSave = state === "settings-app-failure";
  const hudCatalog =
    state === "settings-hud-browser" ? PREVIEW_HUD_BROWSER_CATALOG : PREVIEW_HUD_CATALOG;
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
    state === "settings-hud-installed" || state === "hud-ownership"
      ? previewInstalledState()
      : emptyHudState();
  let hudOwnershipPending = state === "hud-ownership";
  let mods: ModRecord[] =
    state === "settings-mods" ? PREVIEW_PROFILE_MODS.map((m) => ({ ...m })) : [];
  let modsPayload: PreloaderStatusPayload = PREVIEW_MODS_STATUS;
  const crosshairPixels: Record<string, { width: number; height: number; rgba: number[] }> = {};
  let crosshair = state === "settings-crosshair" ? previewCrosshairRecord() : null;
  let viewmodel = state === "settings-viewmodels" ? previewViewmodelRecord() : null;
  let hitsound: HitsoundRecord | null =
    state === "settings-sounds" ? { hit: { name: "quack", source: "community" } } : null;
  let importReadingHandler: (() => void) | null = null;
  let progressHandler: ((progress: SwitchProgress) => void) | null = null;
  let lifecycle = {
    launchingTf2: false,
    steamVerification: false,
    installingUpdate: false,
  };

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
        sha256: sourceHash(files.find((file) => file.path === path)?.text ?? ""),
        storage: "exclusive" as const,
      })),
      hud: hudState.installed,
      hudRoots: hudState.installed ? [hudState.installed.id] : [],
      selectedHudRoot: hudState.installed?.id ?? null,
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

  function filesContext() {
    const current = requireDetail();
    return {
      profileId: current.id,
      root: previewConfirmed(state)?.path ?? BROWSED.path,
      layer: current.layer,
    };
  }

  // Preview-only deterministic source identity. Native uses SHA-256 of bytes.
  function sourceHash(text: string): string {
    return `preview:${text}`;
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
    async getInventory() {
      return {
        steamId: "Preview data",
        personaName: "Preview player",
        avatar: null,
        capacity: 300,
        warning: "Preview data · These are fixture items, not a Steam inventory.",
        items: [
          { id: "preview-1", definition: 13, position: 1, quality: 6, level: 1, customName: null },
          {
            id: "preview-paint",
            definition: 17286,
            position: 2,
            quality: 15,
            level: 1,
            customName: null,
          },
          {
            id: "preview-kit",
            definition: 6526,
            position: 3,
            quality: 6,
            level: 1,
            customName: null,
          },
          {
            id: "preview-2",
            definition: 13,
            position: 51,
            quality: 11,
            level: 10,
            customName: "A familiar scattergun",
          },
          {
            id: "preview-3",
            definition: 5002,
            position: 0,
            quality: 6,
            level: 1,
            customName: null,
          },
        ],
        definitions: {
          "13": { name: "Scattergun", kind: "Scattergun", classes: ["scout"], icon: null },
          "5002": { name: "Refined Metal", kind: "Crafting Item", classes: [], icon: null },
          "17286": { name: "War Paint", kind: "War Paint", classes: [], icon: null },
          "6526": { name: "Killstreak Kit", kind: "Tool", classes: [], icon: null },
        },
        itemDescriptions: {
          "preview-paint": {
            name: "Skull Cracked War Paint",
            kind: "War Paint",
            classes: [],
            icon: null,
            details: ["Minimal Wear", "Pattern preview unavailable"],
          },
          "preview-kit": {
            name: "Professional Killstreak Kit · Rocket Launcher",
            kind: "Tool",
            classes: [],
            icon: null,
            details: ["Sheen: Team Shine", "Killstreaker: Fire Horns"],
          },
        },
      };
    },
    async getInventoryIcons() {
      return {};
    },
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
    async getLifecycleStatus() {
      return lifecycle;
    },
    async onTf2Running() {
      // The preview never changes lock state; the seed from `getTf2WriteLock`
      // is the whole story.
      return () => {};
    },
    async onTf2LockUnavailable() {
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
    async deleteProfile(id, keepInstalled) {
      if (previewLocked(state))
        throw new BridgeError("Close TF2 before deleting a profile.", "GameRunning");
      if (!library?.profiles.some((profile) => profile.id === id)) {
        throw new BridgeError("This profile is no longer in the library.", "ProfileMissing");
      }
      if (library.activeProfileId === id && !keepInstalled) {
        throw new BridgeError(
          "Switch to another profile or keep the installed setup before deleting this profile.",
          "ActiveProfile",
        );
      }
      library = {
        ...library,
        activeProfileId: library.activeProfileId === id ? null : library.activeProfileId,
        profiles: library.profiles.filter((profile) => profile.id !== id),
      };
      return library;
    },
    async getAppSettings() {
      return { preferences: { ...appPreferences }, dataDirectory: "/home/user/.local/share/execs" };
    },
    async getHudOwnership(profileId) {
      const folder = hudState.installed?.id ?? null;
      if (hudOwnershipPending)
        return {
          profileId,
          selectedHud: "rayshud",
          candidates: [
            { folder: "rayshud", source: "profile" as const, files: 120 },
            { folder: "toonhud", source: "live" as const, files: 184 },
          ],
          fingerprint: `preview:${profileId}:review`,
          reviewRequired: true,
          managedOptionFiles: ["tf/cfg/overrides/execs_hud_crosshair.cfg"],
          resetOptions: false,
        };
      return {
        profileId,
        selectedHud: folder,
        candidates: folder ? [{ folder, source: "profile" as const, files: 42 }] : [],
        fingerprint: `preview:${profileId}:${folder ?? "none"}`,
        reviewRequired: false,
        managedOptionFiles: [],
        resetOptions: false,
      };
    },
    async selectProfileHud(profileId, hudFolder, expectedFingerprint) {
      if (previewLocked(state))
        throw new BridgeError("Close TF2 before changing the selected HUD.", "GameRunning");
      if (hudOwnershipPending) {
        if (
          expectedFingerprint !== `preview:${profileId}:review` ||
          !["rayshud", "toonhud"].includes(hudFolder)
        )
          throw new BridgeError("The HUD files changed. Review them again.", "HudReviewStale");
        hudOwnershipPending = false;
        hudState = { ...hudState, installed: { id: hudFolder, source: "local", options: {} } };
        return { ...requireDetail(), id: profileId };
      }
      const folder = hudState.installed?.id ?? null;
      if (
        expectedFingerprint !== `preview:${profileId}:${folder ?? "none"}` ||
        hudFolder !== folder
      )
        throw new BridgeError("The HUD files changed. Review them again.", "HudReviewStale");
      return { ...requireDetail(), id: profileId };
    },
    async setAppPreferences(preferences) {
      if (failNextAppPreferenceSave) {
        failNextAppPreferenceSave = false;
        throw new BridgeError(
          "Could not save app settings (preview failure). Retry to try again.",
          "PreviewOnly",
        );
      }
      appPreferences = { ...preferences };
      return { preferences: { ...appPreferences }, dataDirectory: "/home/user/.local/share/execs" };
    },
    async absorbOwned() {
      if (hudOwnershipPending)
        throw new BridgeError(
          "More than one HUD needs review. Choose which HUD this profile should use.",
          "HudLiveReviewRequired",
        );
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
    async reviewRetiredCasualProfile() {
      throw new BridgeError(
        "No unavailable saved library choices in preview data.",
        "NoLegacyCasualChoices",
      );
    },
    async clearRetiredCasualProfile() {
      throw new BridgeError(
        "No unavailable saved library choices in preview data.",
        "NoLegacyCasualChoices",
      );
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
    async inspectProfileExport() {
      return {
        revision: "preview-export-review",
        credentialLocations: ["tf/cfg/config.cfg:8"],
        customPacks: [{ path: "tf/custom/example.vpk", fileCount: 1, kind: "other" }],
      };
    },
    async onProfileImportReading(handler) {
      importReadingHandler = handler;
      return () => {
        importReadingHandler = null;
      };
    },
    async importProfile() {
      importReadingHandler?.();
      await new Promise((resolve) => setTimeout(resolve, 900));
      return {
        token: "preview-import",
        name: "bunstiecfgcustom",
        files: 236,
        skippedFiles: 16,
        creator: true,
        notes: [],
        huds: state === "profile-import-huds" ? ["rayshud", "toonhud"] : [],
        selectedHud: state === "profile-import-huds" ? "rayshud" : null,
        warnings: [
          "tf/cfg/config.cfg:8 may contain a saved password or remote-console setting. Review it before sharing this profile.",
          "tf/custom/low.vpk/cfg/comfig/comfig.cfg contains 'alias kill'.",
          "tf/cfg/overrides/autoexec.cfg contains 'sv_cheats'.",
        ],
      };
    },
    async confirmProfileImport() {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      return addProfile("bunstiecfgcustom", false);
    },
    async cancelProfileImport() {},
    async planCustomFolderRepair(id) {
      return (
        library?.profiles.find((profile) => profile.id === id)?.unsafeCustomFolders ?? []
      ).map((from) => ({ from, to: `custom-${from.toLowerCase()}` }));
    },
    async repairCustomFolders(id) {
      library = {
        ...(library ?? emptyLibrary(BROWSED.path, true)),
        profiles: (library?.profiles ?? []).map((profile) =>
          profile.id === id ? { ...profile, unsafeCustomFolders: [] } : profile,
        ),
      };
      return library;
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
    async getFilesContext() {
      return filesContext();
    },
    async readProfileFile(path: string) {
      if (!editorPathFits(path)) {
        throw new BridgeError("That profile file path is too long for the editor.", "InvalidPath");
      }
      const found = files.find((file) => file.path === path);
      if (!found) {
        throw notInPreview(`Reading ${path}`);
      }
      if (editorTextBytes(found.text) === null) {
        throw new BridgeError("That cfg is larger than the 1 MiB editor limit.", "FileTooLarge");
      }
      const hash = sourceHash(found.text);
      return {
        path,
        text: found.text,
        sha256: hash,
        binary: false,
        source: { ...filesContext(), sha256: hash, librarySha256: hash },
      };
    },
    async writeOwnedFile(path: string, text: string, expected: FilesSource) {
      if (previewLocked(state)) throw new BridgeError("Close TF2 before saving.", "GameRunning");
      const context = filesContext();
      if (context.profileId !== expected.profileId)
        throw new BridgeError("The active profile changed.", "ProfileChanged");
      if (context.root !== expected.root)
        throw new BridgeError("The TF2 folder changed.", "RootChanged");
      if (context.layer !== expected.layer)
        throw new BridgeError("The cfg loader changed.", "CfgLayerChanged");
      if (!editorPathFits(path)) {
        throw new BridgeError("That profile file path is too long for the editor.", "InvalidPath");
      }
      if (editorTextBytes(text) === null) {
        throw new BridgeError("That cfg is larger than the 1 MiB editor limit.", "FileTooLarge");
      }
      const current = files.find((file) => file.path === path);
      const hash = current ? sourceHash(current.text) : null;
      if (
        hash !== expected.sha256 ||
        hash !== expected.librarySha256 ||
        files.some((file) => file.path.toLowerCase() === path.toLowerCase() && file.path !== path)
      ) {
        throw new BridgeError(
          "This cfg changed outside your draft. Review the current file before saving.",
          "FileConflict",
        );
      }
      if (
        !path.startsWith("tf/cfg/") ||
        !path.endsWith(".cfg") ||
        path
          .split("/")
          .some(
            (part) => !part || part === "." || part === ".." || part.toLowerCase() === "user",
          ) ||
        (!current && !isNewCfgPath(path, context.layer))
      ) {
        throw new BridgeError("That cfg destination is not allowed.", "ForbiddenPath");
      }
      upsert(path, text);
      return requireDetail();
    },

    async writeManagedCfg(path, text, expectedProfileId, scope) {
      const current = requireDetail();
      if (current.id !== expectedProfileId) {
        throw new BridgeError(
          "The active profile changed before saving. Try again.",
          "ProfileChanged",
        );
      }
      const prefix = current.layer === "comfig" ? "tf/cfg/overrides/" : "tf/cfg/";
      const stems = ["execs_binds", "execs_gameplay"] as const;
      if (!stems.some((stem) => path === `${prefix}${stem}.cfg`)) {
        throw new BridgeError("That managed cfg path is not allowed.", "ForbiddenPath");
      }
      if (editorTextBytes(text) === null) {
        throw new BridgeError("That cfg is larger than the 1 MiB editor limit.", "FileTooLarge");
      }
      const autoPath = `${prefix}autoexec.cfg`;
      let auto = files.find((file) => file.path === autoPath)?.text ?? "";
      for (const stem of stems) {
        const sibling = `${prefix}${stem}.cfg`;
        if (sibling === path || files.some((file) => file.path === sibling)) {
          auto = ensureAutoexecExecLine(auto, stem, current.layer);
        }
      }
      if (scope) {
        if (path !== `${prefix}execs_gameplay.cfg`) {
          throw new BridgeError("That managed cfg scope is not allowed.", "InvalidPath");
        }
        const latest = files.find((file) => file.path === path)?.text ?? "";
        const values = Object.entries(parseCvarMap(text)).filter(([name]) => {
          if (!(name in defaultGameplay())) return false;
          if (scope === "crosshair") return name.startsWith("cl_crosshair_");
          if (scope === "sounds") return name.startsWith("tf_dingaling");
          return !name.startsWith("cl_crosshair_") && !name.startsWith("tf_dingaling");
        });
        text = `${latest}\n${values.map(([name, value]) => `${name} ${JSON.stringify(value)}`).join("\n")}\n`;
      }
      upsert(path, text);
      upsert(autoPath, auto);
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
    async importComfigCustom(): Promise<ProfileDetail | null> {
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
    async getLaunchSyncStatus() {
      // Preview data: Steam still has the options from before the last switch.
      const steamOptions = "-novid";
      return {
        profileOptions: launchOptions,
        steamOptions,
        inSync: launchOptions === steamOptions,
        steamRunning: true,
      };
    },
    async setProfileLaunchOptions(options: string) {
      launchOptions = options;
      return { launchOptions: options, steamWrite: "steam_open" as const };
    },

    // --- HUD ----------------------------------------------------------------
    async getHudCatalog() {
      return { entries: hudCatalog, warning: null };
    },
    async getHudState() {
      return { ...hudState, profileId: requireDetail().id };
    },
    async getHudAlbum(_id, _refresh = false) {
      return [];
    },
    async getHudStats() {
      if (state === "settings-hud-browser")
        return { stats: PREVIEW_HUD_BROWSER_STATS, warning: null };
      return {
        stats: {
          rayshud: { updated: "2026-01-11", downloads: 398380, views: 1168295 },
          toonhud: { updated: "2024-03-02" },
        },
        warning: null,
      };
    },
    async installHud(id: string) {
      const entry = hudCatalog.find((item) => item.id === id);
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
    async getHudSchema(expectedProfileId, expectedHudId) {
      if (requireDetail().id !== expectedProfileId || hudState.installed?.id !== expectedHudId) {
        throw new Error("The installed HUD changed. Reload HUD options.");
      }
      return hudState.schemaSupported ? PREVIEW_HUD_SCHEMA : null;
    },
    async applyHudOptions(options, expectedProfileId, expectedHudId) {
      if (requireDetail().id !== expectedProfileId || hudState.installed?.id !== expectedHudId) {
        throw new Error("The installed HUD changed. Reload HUD options.");
      }
      if (hudState.installed) {
        hudState = { ...hudState, installed: { ...hudState.installed, options } };
      }
      return requireDetail();
    },

    // --- crosshair ----------------------------------------------------------
    async applyCrosshairs(shape, assignments, customRgba, color, library, design, settings) {
      const names = settings?.libraryNames ?? [
        ...new Set([...Object.keys(crosshair?.library ?? {}), ...Object.keys(library ?? {})]),
      ];
      crosshair = {
        id: "preview",
        inactive: false,
        scale: settings?.scale,
        stock: settings?.stock,
        shape,
        assignments,
        color: color ?? null,
        library: Object.fromEntries(
          names.map((name) => [
            name,
            library?.[name]?.format ?? crosshair?.library?.[name] ?? "rgba",
          ]),
        ),
        design: design ?? null,
      };
      for (const [name, asset] of Object.entries(library ?? {})) {
        if (asset.format === "rgba")
          crosshairPixels[name] = { width: 64, height: 64, rgba: asset.bytes };
      }
      if (customRgba) crosshairPixels.custom = { width: 64, height: 64, rgba: customRgba };
      const detail = requireDetail();
      const path =
        detail.layer === "comfig"
          ? "tf/cfg/overrides/execs_gameplay.cfg"
          : "tf/cfg/execs_gameplay.cfg";
      const latest = files.find((file) => file.path === path)?.text ?? "";
      const rgb = color
        ? `cl_crosshair_red ${color[0]}\ncl_crosshair_green ${color[1]}\ncl_crosshair_blue ${color[2]}\n`
        : "";
      upsert(
        path,
        `${latest}\ncl_crosshair_file ""\ncl_crosshair_scale ${settings?.scale ?? 32}\n${rgb}`,
      );
      return requireDetail();
    },
    async getPackCrosshairPreviews() {
      return crosshairPixels;
    },
    async getStockCrosshairSprites() {
      throw notInPreview("Stock crosshair sprites");
    },
    async getCrosshairContentSources() {
      return { hits: {}, incomplete: [] };
    },
    async getCrosshairSourceStatus() {
      return { state: crosshair ? ("unverified" as const) : ("none" as const) };
    },
    async removeCrosshairs() {
      crosshair = null;
      return requireDetail();
    },
    async deactivateCrosshairs() {
      if (crosshair) {
        crosshair = { ...crosshair, inactive: true };
        const path =
          requireDetail().layer === "comfig"
            ? "tf/cfg/overrides/execs_gameplay.cfg"
            : "tf/cfg/execs_gameplay.cfg";
        const latest = files.find((file) => file.path === path)?.text ?? "";
        upsert(
          path,
          `${latest}\ncl_crosshair_file "${crosshair.stock?.file ?? ""}"\ncl_crosshair_scale ${crosshair.stock?.scale ?? 32}\n`,
        );
      }
      return requireDetail();
    },

    // --- viewmodels ---------------------------------------------------------
    async getViewmodelSourceCatalog() {
      const { PREVIEW_VIEWMODEL_CATALOG } = await import("./preview-viewmodels");
      return PREVIEW_VIEWMODEL_CATALOG;
    },
    async buildSelectedViewmodelPack() {
      throw notInPreview("Building a Viewmodels pack from installed TF2 sources");
    },
    async importViewmodels(preload: boolean): Promise<ProfileDetail | null> {
      viewmodel = { id: "preview", source: "imported", preload, options: {} };
      return requireDetail();
    },
    async removeViewmodels() {
      viewmodel = null;
      return requireDetail();
    },
    // --- hit and kill sounds ------------------------------------------------
    async hitsoundBytes() {
      throw notInPreview("Auditioning sounds");
    },
    async listStockHitsounds() {
      // Every stock effect is "present" in preview; nothing can play anyway.
      const { STOCK_HITSOUND_EFFECTS } = await import("./hitsound-ui");
      return STOCK_HITSOUND_EFFECTS.flatMap((effect) => [effect.hit, effect.kill]);
    },
    async getHitsoundSources() {
      return { hits: {}, incomplete: [] };
    },
    async pickHitsoundFile() {
      throw notInPreview("Picking a sound file");
    },
    async applyHitsounds(hit: HitsoundSlotChange, kill: HitsoundSlotChange) {
      const next: HitsoundRecord = { ...(hitsound ?? {}) };
      const apply = (slot: "hit" | "kill", change: HitsoundSlotChange) => {
        if (change.change === "install" && ["community", "comfig"].includes(change.pick.kind)) {
          throw new BridgeError("This sound catalog is no longer offered.", "SourceUnavailable");
        }
        if (
          change.change === "install" &&
          change.pick.kind === "installed" &&
          next[change.pick.slot]?.source !== "file"
        ) {
          throw new BridgeError(
            "This saved catalog sound cannot be re-encoded from its original source.",
            "SourceUnavailable",
          );
        }
        if (change.change === "clear") {
          next[slot] = null;
        } else if (change.change === "install") {
          const pick = change.pick;
          const boost = change.boost;
          next[slot] =
            pick.kind === "file"
              ? { name: pick.name, source: "file", boost }
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
    async applyHitsoundsWithSettings(path, text, expectedProfileId, hit, kill) {
      await api.writeManagedCfg(path, text, expectedProfileId, "sounds");
      return api.applyHitsounds(hit, kill);
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
      _refresh = false,
    ) {
      const needle = query.trim().toLowerCase();
      const matching = PREVIEW_GAMEBANANA_RECORDS.filter((record) => {
        const hitsQuery = needle === "" || record.name.toLowerCase().includes(needle);
        return (
          hitsQuery &&
          (category === null || record.categoryId === category) &&
          (includeMature || !record.mature)
        );
      });
      const perPage = 20;
      const start = (page - 1) * perPage;
      const slice = previewGameBananaOrder(matching, sort).slice(start, start + perPage);
      return {
        records: slice,
        total:
          category === null
            ? ({ kind: "estimated", value: matching.length } as const)
            : ({ kind: "exact", value: matching.length } as const),
        perPage,
        complete: start + slice.length >= matching.length,
        ordering: "server" as const,
        filters: {
          query: "global" as const,
          category: "global" as const,
          contentRating: "global" as const,
          installability: category === null ? ("page" as const) : ("global" as const),
        },
        cache: { source: "network" as const, freshForMs: 10 * 60_000 },
      };
    },
    async gameBananaModCategories() {
      return PREVIEW_GAMEBANANA_CATEGORIES;
    },
    async gameBananaDownloadVariants(id: number): Promise<GameBananaDownloadVariant[]> {
      const listing = PREVIEW_GAMEBANANA_RECORDS.find((record) => record.id === id);
      if (listing?.route !== "mod") {
        throw notInPreview(`GameBanana files for ${id}`);
      }
      const files: GameBananaDownloadVariant[] = [
        {
          id: id * 10 + 1,
          fileName: `${listing.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.zip`,
          description: "Main version from the author",
          sizeBytes: 4_200_000,
          addedAt: listing.addedAt,
          supported: true,
        },
      ];
      if (id === 700_000) {
        files.push({
          id: id * 10 + 2,
          fileName: "alternate-layout.7z",
          description: "Alternate layout from the author",
          sizeBytes: 3_100_000,
          addedAt: listing.addedAt,
          supported: true,
        });
      }
      return files;
    },
    async installGameBananaMod(id: number, fileId: number) {
      const listing = PREVIEW_GAMEBANANA_RECORDS.find((record) => record.id === id);
      const variants = await this.gameBananaDownloadVariants(id);
      if (listing?.route !== "mod" || !variants.some((file) => file.id === fileId)) {
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
    async recoverPreloader() {
      modsPayload = { ...modsPayload, recoveryRequired: false };
      return { ...modsPayload, profileParticleSources: particleSources() };
    },
    async getDefaultMods() {
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
    async launchTf2(_syncSteam?: boolean) {
      // Steam is not reachable from the preview; the button is a no-op here.
    },
    async cancelTf2Launch() {
      lifecycle = { ...lifecycle, launchingTf2: false };
      return true;
    },
    async repairGameFiles() {
      lifecycle = { ...lifecycle, steamVerification: true };
      modsPayload = {
        ...modsPayload,
        repairInProgress: true,
        status: { ...modsPayload.status, untrackedModified: [] },
      };
    },
    async completeGameFileRepair() {
      lifecycle = { ...lifecycle, steamVerification: false };
      modsPayload = { ...modsPayload, repairInProgress: false };
      return true;
    },
    async cancelGameFileRepair() {
      lifecycle = { ...lifecycle, steamVerification: false };
      modsPayload = { ...modsPayload, repairInProgress: false };
      return true;
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
      lifecycle = { ...lifecycle, installingUpdate: true };
      onProgress("downloading");
      onProgress("installing");
      onProgress("restarting");
    },
  };

  return api;
}
