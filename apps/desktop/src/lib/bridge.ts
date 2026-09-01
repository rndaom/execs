import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Tf2Install = {
  path: string;
};

export type WriteLock = {
  running: boolean;
};

export type ProfileSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type ProfileLibrary = {
  initialized: boolean;
  usable: boolean;
  rootMismatch: boolean;
  tf2Root: string | null;
  confirmedRoot: string | null;
  activeProfileId: string | null;
  profiles: ProfileSummary[];
};

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function invokeErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return "Something went wrong.";
}

export async function scanTf2Installs(): Promise<Tf2Install[]> {
  return invoke<Tf2Install[]>("scan_tf2_installs");
}

export async function validateTf2Root(path: string): Promise<Tf2Install> {
  try {
    return await invoke<Tf2Install>("validate_tf2_root", { path });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function browseTf2Root(): Promise<Tf2Install | null> {
  try {
    return await invoke<Tf2Install | null>("browse_tf2_root");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function confirmTf2Root(path: string): Promise<Tf2Install> {
  try {
    return await invoke<Tf2Install>("confirm_tf2_root", { path });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function getTf2Root(): Promise<Tf2Install | null> {
  return invoke<Tf2Install | null>("get_tf2_root");
}

export async function getTf2WriteLock(): Promise<WriteLock> {
  return invoke<WriteLock>("tf2_write_lock");
}

export async function onTf2Running(handler: (running: boolean) => void): Promise<UnlistenFn> {
  return listen<boolean>("tf2-running", (event) => {
    handler(event.payload);
  });
}

export async function getProfileLibrary(): Promise<ProfileLibrary> {
  try {
    return await invoke<ProfileLibrary>("get_profile_library");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function initProfileLibrary(): Promise<ProfileLibrary> {
  try {
    return await invoke<ProfileLibrary>("init_profile_library");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function createProfileRecord(name: string): Promise<ProfileLibrary> {
  try {
    return await invoke<ProfileLibrary>("create_profile_record", { name });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function saveCurrentAs(name: string): Promise<ProfileLibrary> {
  try {
    return await invoke<ProfileLibrary>("save_current_as", { name });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export type AbsorbDelta = {
  ownedChanged: string[];
  ownedMissing: string[];
  packsAdded: string[];
  packsRemoved: string[];
  configCfg: boolean;
};

export type AbsorbOwnedResult = {
  library: ProfileLibrary;
  delta: AbsorbDelta;
  configCfgAbsorbed: boolean;
};

export type PackChoice = "update" | "keep";

export async function scanAbsorbDelta(): Promise<AbsorbDelta> {
  try {
    return await invoke<AbsorbDelta>("scan_absorb_delta");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function absorbOwned(): Promise<AbsorbOwnedResult> {
  try {
    return await invoke<AbsorbOwnedResult>("absorb_owned");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function absorbPacks(choice: PackChoice): Promise<ProfileLibrary> {
  try {
    return await invoke<ProfileLibrary>("absorb_packs", { choice });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export type SwitchStep = "closed" | "pack" | "remove" | "write" | "cloud" | "done";

export type SwitchProgress = {
  step: SwitchStep;
  detail: string | null;
};

export async function switchProfile(id: string): Promise<ProfileLibrary> {
  try {
    return await invoke<ProfileLibrary>("switch_profile", { id });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function onSwitchProgress(
  handler: (progress: SwitchProgress) => void,
): Promise<UnlistenFn> {
  return listen<SwitchProgress>("profile-switch-progress", (event) => {
    handler(event.payload);
  });
}

export async function exportProfile(id: string): Promise<string | null> {
  try {
    return await invoke<string | null>("export_profile", { id });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function importProfile(): Promise<ProfileLibrary> {
  try {
    return await invoke<ProfileLibrary>("import_profile");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export type FirstRunKind = "unused" | "existing";

export type FirstRunClass = {
  kind: FirstRunKind;
  reasons: string[];
};

export type ComfigPreset =
  | "ultra"
  | "high"
  | "medium_high"
  | "medium"
  | "medium_low"
  | "low"
  | "very_low"
  | "none";

export type OfficialAddon =
  | "no-footsteps"
  | "no-pyroland"
  | "no-soundscapes"
  | "no-tutorial"
  | "lowmem"
  | "null-canceling-movement"
  | "flat-mouse"
  | "transparent-viewmodels";

export type WizardSpec = {
  name: string;
  preset: ComfigPreset;
  addons: OfficialAddon[];
};

export async function classifyFirstRun(): Promise<FirstRunClass> {
  try {
    return await invoke<FirstRunClass>("classify_first_run");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function applyUnusedWizard(spec: WizardSpec): Promise<ProfileLibrary> {
  try {
    return await invoke<ProfileLibrary>("apply_unused_wizard", { spec });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function getInheritBinds(): Promise<boolean> {
  return invoke<boolean>("get_inherit_binds");
}

export async function setInheritBinds(inherit: boolean): Promise<boolean> {
  try {
    return await invoke<boolean>("set_inherit_binds", { inherit });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function createFreshProfile(spec: WizardSpec): Promise<ProfileLibrary> {
  try {
    return await invoke<ProfileLibrary>("create_fresh_profile", { spec });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export type CfgLayer = "comfig" | "vanilla";

export type ProfileFile = {
  path: string;
  sha256: string;
  storage: "exclusive" | "shared";
};

export type HudSource = "hudDb" | "local";

export type HudRecord = {
  id: string;
  hash?: string | null;
  source: HudSource;
  options: Record<string, string>;
};

export type CrosshairRecord = {
  id: string;
  shape: string;
  assignments: Record<string, string>;
  /** Baked RGB tint for the first-party shapes; null/undefined = white. */
  color?: [number, number, number] | null;
  /** Installed non-builtin crosshairs: name -> "vtf" | "rgba". */
  library?: Record<string, string>;
  /** Serialized designer parameters for the "designed" entry. */
  design?: string | null;
};

export type ViewmodelSource = "compiled" | "imported";

export type ViewmodelRecord = {
  id: string;
  source: ViewmodelSource;
  preload: boolean;
  options: Record<string, string>;
};

export type HudCatalogEntry = {
  id: string;
  name: string;
  author: string;
  repo: string;
  hash: string;
  github: boolean;
  flags: string[];
  banner: string | null;
  /** Full-size hud-db screenshot URLs (video links are filtered out). */
  screenshots: string[];
  /** Optional external album page (e.g. Imgur). */
  album: string | null;
  comfigUrl: string;
  tf2hudsUrl: string;
};

export type HudUiState = {
  installed: HudRecord | null;
  inferred: boolean;
  schemaSupported: boolean;
  catalogHash: string | null;
  updateAvailable: boolean;
};

export type HudSchemaChoice = {
  label: string;
  value: string;
};

export type HudSchemaControl = {
  name: string;
  label: string;
  controlType: string;
  value: string;
  choices: HudSchemaChoice[];
  minimum?: string;
  maximum?: string;
};

export type HudSchemaSection = {
  name: string;
  controls: HudSchemaControl[];
};

export type HudSchemaView = {
  author: string;
  supported: boolean;
  sections: HudSchemaSection[];
};

export type ProfileDetail = {
  id: string;
  name: string;
  launchOptions: string;
  layer: CfgLayer;
  files: ProfileFile[];
  hud?: HudRecord | null;
  crosshair?: CrosshairRecord | null;
  viewmodel?: ViewmodelRecord | null;
};

export type ProfileFileContent = {
  path: string;
  text: string | null;
  sha256: string;
  binary: boolean;
};

export async function getActiveProfileDetail(): Promise<ProfileDetail | null> {
  try {
    return await invoke<ProfileDetail | null>("get_active_profile_detail");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function listProfileFiles(id?: string): Promise<ProfileFile[]> {
  try {
    return await invoke<ProfileFile[]>("list_profile_files", { id: id ?? null });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function readProfileFile(path: string, id?: string): Promise<ProfileFileContent> {
  try {
    return await invoke<ProfileFileContent>("read_profile_file", { path, id: id ?? null });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function writeOwnedFile(
  path: string,
  text: string,
  id?: string,
): Promise<ProfileDetail> {
  try {
    return await invoke<ProfileDetail>("write_owned_file", { path, text, id: id ?? null });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export type ComfigState = {
  preset: ComfigPreset;
  modules: Record<string, string>;
  addons: OfficialAddon[];
  hasBaseVpk: boolean;
  hasComfigCustom: boolean;
};

export async function getComfigState(id?: string): Promise<ComfigState | null> {
  try {
    return await invoke<ComfigState | null>("get_comfig_state", { id: id ?? null });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function setComfigPreset(preset: ComfigPreset, id?: string): Promise<ProfileDetail> {
  try {
    return await invoke<ProfileDetail>("set_comfig_preset", { preset, id: id ?? null });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function setComfigModules(
  modules: Record<string, string>,
  id?: string,
): Promise<ProfileDetail> {
  try {
    return await invoke<ProfileDetail>("set_comfig_modules", { modules, id: id ?? null });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function setComfigAddons(
  addons: OfficialAddon[],
  id?: string,
): Promise<ProfileDetail> {
  try {
    return await invoke<ProfileDetail>("set_comfig_addons", { addons, id: id ?? null });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function updateComfigVpks(id?: string): Promise<ProfileDetail> {
  try {
    return await invoke<ProfileDetail>("update_comfig_vpks", { id: id ?? null });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function importComfigCustom(id?: string): Promise<ProfileDetail> {
  try {
    return await invoke<ProfileDetail>("import_comfig_custom", { id: id ?? null });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export type SteamWriteStatus = "written" | "steam_open" | "no_account";

export type SetLaunchResult = {
  launchOptions: string;
  steamWrite: SteamWriteStatus;
};

export async function recommendedLaunchOptions(): Promise<string> {
  return invoke<string>("recommended_launch_options");
}

export async function getProfileLaunchOptions(id?: string): Promise<string> {
  try {
    return await invoke<string>("get_profile_launch_options", { id: id ?? null });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function setProfileLaunchOptions(
  options: string,
  id?: string,
): Promise<SetLaunchResult> {
  try {
    return await invoke<SetLaunchResult>("set_profile_launch_options", {
      options,
      id: id ?? null,
    });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function getHudCatalog(refresh = false): Promise<HudCatalogEntry[]> {
  try {
    return await invoke<HudCatalogEntry[]>("get_hud_catalog", { refresh });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function getHudState(): Promise<HudUiState> {
  try {
    return await invoke<HudUiState>("get_hud_state");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function installHud(id: string): Promise<ProfileDetail> {
  try {
    return await invoke<ProfileDetail>("install_hud", { id });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function matchHudCatalog(id: string): Promise<ProfileDetail> {
  try {
    return await invoke<ProfileDetail>("match_hud_catalog", { id });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function updateHud(): Promise<ProfileDetail> {
  try {
    return await invoke<ProfileDetail>("update_hud");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function getHudSchema(): Promise<HudSchemaView | null> {
  try {
    return await invoke<HudSchemaView | null>("get_hud_schema");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function applyHudOptions(options: Record<string, string>): Promise<ProfileDetail> {
  try {
    return await invoke<ProfileDetail>("apply_hud_options", { options });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export type CrosshairAssetPayload = {
  format: "vtf" | "rgba";
  bytes: number[];
};

export async function applyCrosshairs(
  shape: string,
  assignments: Record<string, string>,
  customRgba?: number[],
  color?: [number, number, number] | null,
  library?: Record<string, CrosshairAssetPayload>,
  design?: string | null,
): Promise<ProfileDetail> {
  try {
    // Tauri v2 matches invoke keys in camelCase only — a snake_case key here
    // deserializes the Option as permanently-None.
    return await invoke<ProfileDetail>("apply_crosshairs", {
      shape,
      assignments,
      customRgba: customRgba ?? null,
      color: color ?? null,
      library: library ?? null,
      design: design ?? null,
    });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export type CommunityCrosshair = {
  file: string;
  width: number;
  height: number;
  rgba: number[];
  bytes: number[];
};

/** Download (with cache) one community crosshair and its decoded preview. */
export async function fetchCommunityCrosshair(file: string): Promise<CommunityCrosshair> {
  try {
    return await invoke<CommunityCrosshair>("fetch_community_crosshair", { file });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

/** Decoded previews of the installed pack's library crosshairs. */
export async function getPackCrosshairPreviews(): Promise<Record<string, StockCrosshairSprite>> {
  try {
    return await invoke<Record<string, StockCrosshairSprite>>("get_pack_crosshair_previews");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export type StockCrosshairSprite = {
  width: number;
  height: number;
  /** Frame 0 as unpremultiplied RGBA. */
  rgba: number[];
};

/** Valve's stock crosshair sprites decoded from the user's own game files. */
export async function getStockCrosshairSprites(): Promise<Record<string, StockCrosshairSprite>> {
  try {
    return await invoke<Record<string, StockCrosshairSprite>>("get_stock_crosshair_sprites");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function removeCrosshairs(): Promise<ProfileDetail> {
  try {
    return await invoke<ProfileDetail>("remove_crosshairs");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

/** Build a Yttrium-style pack from hidden animation groups and install it. */
/** "full" hides the weapon and the arms; "weapon" keeps the hands animating. */
export type ViewmodelHideMode = "full" | "weapon";

export async function buildViewmodelPack(
  hidden: string[],
  preload: boolean,
  hideMode: ViewmodelHideMode = "full",
): Promise<ProfileDetail> {
  try {
    // camelCase: Tauri v2 lower-camels command args, and a snake_case key
    // would silently arrive as None.
    return await invoke<ProfileDetail>("build_viewmodel_pack", { hidden, preload, hideMode });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function importViewmodels(preload: boolean): Promise<ProfileDetail> {
  try {
    return await invoke<ProfileDetail>("import_viewmodels", { preload });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function removeViewmodels(): Promise<ProfileDetail> {
  try {
    return await invoke<ProfileDetail>("remove_viewmodels");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

/**
 * Whether this machine can compile a viewmodel pack (TF2's own studiomdl,
 * Windows only for now). False disables Build rather than sending a Linux
 * user into a dead end with a `.exe` in the error.
 */
export async function viewmodelBuildAvailable(): Promise<boolean> {
  try {
    return await invoke<boolean>("viewmodel_build_available");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function setViewmodelPreload(enabled: boolean): Promise<ProfileDetail> {
  try {
    return await invoke<ProfileDetail>("set_viewmodel_preload", { enabled });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

/** Open an external link in the system browser (plain anchors are inert in the packaged webview). */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank", "noreferrer");
    return;
  }
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export type EmbeddedPage = "comfig-extras" | "comfig-docs";

const EMBEDDED_PAGE_URLS: Record<EmbeddedPage, string> = {
  "comfig-extras": "https://comfig.app/app/",
  "comfig-docs": "https://docs.comfig.app/latest/",
};

/** Open a mastercomfig web surface in an in-app window (browser preview falls back to a tab). */
export async function openEmbeddedPage(page: EmbeddedPage): Promise<void> {
  if (!isTauri()) {
    window.open(EMBEDDED_PAGE_URLS[page], "_blank", "noreferrer");
    return;
  }
  try {
    await invoke("open_embedded_page", { page });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

// ---------------------------------------------------------------------------
// Preloader (gameinfo bypass + default mod library)
// ---------------------------------------------------------------------------

export type PreloaderSkipNotice = {
  file: string;
  modName: string;
  reason: string;
};

export type PreloaderStatus = {
  gameinfoFound: boolean;
  gameinfoBypassed: boolean;
  patchedFiles: string[];
  addons: string[];
  particleMods: string[];
  skipped: PreloaderSkipNotice[];
  stale: boolean;
  customVpkPresent: boolean;
};

export type PreloaderStatusPayload = {
  status: PreloaderStatus;
  modsCached: boolean;
  modsSizeBytes: number;
  /** Steam's stored TF2 launch options carry the preload exec. */
  preloadLaunchInSteam: boolean;
};

export type CatalogAddon = {
  id: string;
  name: string;
  kind: string;
  description: string;
  fileCount: number;
  bytes: number;
  hasSound: boolean;
};

export type CatalogParticleMod = {
  name: string;
  pcfFiles: string[];
  fileCount: number;
  bytes: number;
};

export type ModsCatalog = {
  addons: CatalogAddon[];
  particleMods: CatalogParticleMod[];
};

export type DefaultModsPayload = {
  cached: boolean;
  catalog: ModsCatalog | null;
};

export type PreloaderReport = {
  patchedFiles: string[];
  skipped: PreloaderSkipNotice[];
  addonsInstalled: string[];
  particleModsInstalled: string[];
  customVpkWritten: boolean;
  gameinfoBypassed: boolean;
  baselineReset: boolean;
  /** Materials generated for textures a mod shipped without one. */
  synthesizedVmts: number;
  /** Model materials moved under console/ so Casual serves them. */
  relocatedModelMaterials: number;
};

export type PreloaderRevertReport = {
  restoredFiles: string[];
  failures: string[];
  gameinfoRestored: boolean;
  customVpkRemoved: boolean;
};

export async function getPreloaderStatus(): Promise<PreloaderStatusPayload> {
  try {
    return await invoke<PreloaderStatusPayload>("get_preloader_status");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function getDefaultMods(): Promise<DefaultModsPayload> {
  try {
    return await invoke<DefaultModsPayload>("get_default_mods");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function downloadDefaultMods(): Promise<DefaultModsPayload> {
  try {
    return await invoke<DefaultModsPayload>("download_default_mods");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function applyPreloaderMods(
  addons: string[],
  particleMods: string[],
): Promise<PreloaderReport> {
  try {
    return await invoke<PreloaderReport>("apply_preloader_mods", { addons, particleMods });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function setGameinfoBypass(enabled: boolean): Promise<PreloaderStatusPayload> {
  try {
    return await invoke<PreloaderStatusPayload>("set_gameinfo_bypass", { enabled });
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function revertPreloader(): Promise<PreloaderRevertReport> {
  try {
    return await invoke<PreloaderRevertReport>("revert_preloader");
  } catch (error) {
    throw new Error(invokeErrorMessage(error));
  }
}

export async function getAppVersion(): Promise<string> {
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

export async function checkAppUpdate(): Promise<{ version: string; notes: string | null } | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) {
    return null;
  }
  return { version: update.version, notes: update.body ?? null };
}

export async function installAppUpdate(
  onProgress: (step: "downloading" | "installing" | "restarting") => void,
): Promise<void> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const { relaunch } = await import("@tauri-apps/plugin-process");
  const update = await check();
  if (!update) {
    throw new Error("No update available.");
  }
  onProgress("downloading");
  await update.downloadAndInstall((event) => {
    if (event.event === "Finished") {
      onProgress("installing");
    } else {
      onProgress("downloading");
    }
  });
  onProgress("restarting");
  await relaunch();
}
