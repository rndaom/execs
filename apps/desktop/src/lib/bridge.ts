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

/** Fallback code for a backend that still rejects with a bare string. */
export const UNKNOWN_ERROR_CODE = "Unknown";

/**
 * A rejected command. The Rust side returns `{code, message}`; older commands
 * (and the Tauri plugins) still reject with a bare string, so both shapes are
 * accepted and `code` falls back to `Unknown`.
 */
export class BridgeError extends Error {
  readonly code: string;

  constructor(message: string, code: string = UNKNOWN_ERROR_CODE) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

/** Structured parse of whatever a rejected `invoke` handed back. */
export function parseInvokeError(error: unknown): { code: string; message: string } {
  if (error instanceof BridgeError) {
    return { code: error.code, message: error.message };
  }
  if (typeof error === "string") {
    return { code: UNKNOWN_ERROR_CODE, message: error };
  }
  if (error && typeof error === "object") {
    const record = error as { code?: unknown; message?: unknown };
    const message = typeof record.message === "string" ? record.message : null;
    const code = typeof record.code === "string" ? record.code : UNKNOWN_ERROR_CODE;
    if (message !== null) {
      return { code, message };
    }
  }
  return { code: UNKNOWN_ERROR_CODE, message: "Something went wrong." };
}

export function invokeErrorMessage(error: unknown): string {
  return parseInvokeError(error).message;
}

/**
 * The one command wrapper. Every exported function below goes through this, so
 * no command can ship an unwrapped raw-string rejection, and there is exactly
 * one place where a structured backend error becomes a `BridgeError`.
 */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (error) {
    const { code, message } = parseInvokeError(error);
    throw new BridgeError(message, code);
  }
}

export async function scanTf2Installs(): Promise<Tf2Install[]> {
  return call<Tf2Install[]>("scan_tf2_installs");
}

export async function browseTf2Root(): Promise<Tf2Install | null> {
  return call<Tf2Install | null>("browse_tf2_root");
}

export async function confirmTf2Root(path: string): Promise<Tf2Install> {
  return call<Tf2Install>("confirm_tf2_root", { path });
}

export async function getTf2Root(): Promise<Tf2Install | null> {
  return call<Tf2Install | null>("get_tf2_root");
}

export async function getTf2WriteLock(): Promise<WriteLock> {
  return call<WriteLock>("tf2_write_lock");
}

export async function onTf2Running(handler: (running: boolean) => void): Promise<UnlistenFn> {
  return listen<boolean>("tf2-running", (event) => {
    handler(event.payload);
  });
}

export async function getProfileLibrary(): Promise<ProfileLibrary> {
  return call<ProfileLibrary>("get_profile_library");
}

export async function initProfileLibrary(): Promise<ProfileLibrary> {
  return call<ProfileLibrary>("init_profile_library");
}

export async function saveCurrentAs(name: string): Promise<ProfileLibrary> {
  return call<ProfileLibrary>("save_current_as", { name });
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
  /** Packs rewritten from the library after an interrupted write. */
  repaired?: string[];
};

/** Update adopts the live packs, Keep leaves the profile alone, Restore puts
 * the removed packs back from the library. */
export type PackChoice = "update" | "keep" | "restore";

export async function absorbOwned(): Promise<AbsorbOwnedResult> {
  return call<AbsorbOwnedResult>("absorb_owned");
}

export async function absorbPacks(choice: PackChoice): Promise<ProfileLibrary> {
  return call<ProfileLibrary>("absorb_packs", { choice });
}

export type SwitchStep = "closed" | "pack" | "remove" | "write" | "cloud" | "done";

export type SwitchProgress = {
  step: SwitchStep;
  detail: string | null;
};

export async function switchProfile(id: string): Promise<ProfileLibrary> {
  return call<ProfileLibrary>("switch_profile", { id });
}

export async function onSwitchProgress(
  handler: (progress: SwitchProgress) => void,
): Promise<UnlistenFn> {
  return listen<SwitchProgress>("profile-switch-progress", (event) => {
    handler(event.payload);
  });
}

export async function exportProfile(id: string): Promise<string | null> {
  return call<string | null>("export_profile", { id });
}

export async function importProfile(): Promise<ProfileLibrary> {
  return call<ProfileLibrary>("import_profile");
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

/**
 * What a new profile's `tf/cfg/config.cfg` starts from (user decision,
 * `current` copies the active profile's `config.cfg` verbatim
 * (binds, audio, `con_enable`, advanced options and the "tutorial already
 * shown" flags); `fresh` is Valve's `config_default.cfg`.
 */
export type StartFrom = "current" | "fresh";

export async function classifyFirstRun(): Promise<FirstRunClass> {
  return call<FirstRunClass>("classify_first_run");
}

export async function applyUnusedWizard(spec: WizardSpec): Promise<ProfileLibrary> {
  return call<ProfileLibrary>("apply_unused_wizard", { spec });
}

export async function createFreshProfile(
  spec: WizardSpec,
  startFrom: StartFrom,
): Promise<ProfileLibrary> {
  return call<ProfileLibrary>("create_fresh_profile", { spec, startFrom });
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
  /** Pack tint carried by `cl_crosshair_red/green/blue`; null/undefined = white. */
  color?: [number, number, number] | null;
  /** Installed non-builtin crosshairs: name -> "vtf" | "rgba". */
  library?: Record<string, string>;
  /** Serialized designer parameters for the "designed" entry. */
  design?: string | null;
};

/** Where a pack in the profile came from. */
export type ModSource = { kind: "local" } | { kind: "gamebanana"; id: number; url: string };

/** One pack the user brought into the active profile's `tf/custom`. */
export type ModRecord = {
  id: string;
  name: string;
  source: ModSource;
  /** The pack's file name under `tf/custom`. */
  pack: string;
  files: number;
  bytes: number;
  /** ISO timestamp of the install. */
  installedAt: string;
};

export type ViewmodelSource = "compiled" | "imported";

export type ViewmodelRecord = {
  id: string;
  source: ViewmodelSource;
  preload: boolean;
  options: Record<string, string>;
};

/**
 * How the app can fetch a HUD's files, derived from its hud-db `repo` host:
 * a pinned GitHub zip, a direct (Dropbox) archive, a GameBanana listing, a
 * forum thread that links an archive, or nothing mechanical at all.
 */
export type HudInstallKind = "github" | "direct" | "gamebanana" | "thread" | "none";

export type HudCatalogEntry = {
  id: string;
  name: string;
  author: string;
  repo: string;
  hash: string;
  github: boolean;
  install: HudInstallKind;
  flags: string[];
  banner: string | null;
  /** Full-size hud-db screenshot URLs (video links are filtered out). */
  screenshots: string[];
  /** Optional external album page (e.g. Imgur). */
  album: string | null;
  comfigUrl: string;
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
  hitsound?: HitsoundRecord | null;
  /** Packs the user brought in. Absent on payloads from an older backend. */
  mods?: ModRecord[];
};

export type ProfileFileContent = {
  path: string;
  text: string | null;
  sha256: string;
  binary: boolean;
};

export async function getActiveProfileDetail(): Promise<ProfileDetail | null> {
  return call<ProfileDetail | null>("get_active_profile_detail");
}

export async function readProfileFile(path: string, id?: string): Promise<ProfileFileContent> {
  return call<ProfileFileContent>("read_profile_file", { path, id: id ?? null });
}

export async function writeOwnedFile(
  path: string,
  text: string,
  id?: string,
): Promise<ProfileDetail> {
  return call<ProfileDetail>("write_owned_file", { path, text, id: id ?? null });
}

export type ComfigState = {
  preset: ComfigPreset;
  modules: Record<string, string>;
  addons: OfficialAddon[];
  hasBaseVpk: boolean;
  hasComfigCustom: boolean;
};

export async function getComfigState(id?: string): Promise<ComfigState | null> {
  return call<ComfigState | null>("get_comfig_state", { id: id ?? null });
}

export async function setComfigPreset(preset: ComfigPreset, id?: string): Promise<ProfileDetail> {
  return call<ProfileDetail>("set_comfig_preset", { preset, id: id ?? null });
}

export async function setComfigModules(
  modules: Record<string, string>,
  id?: string,
): Promise<ProfileDetail> {
  return call<ProfileDetail>("set_comfig_modules", { modules, id: id ?? null });
}

export async function setComfigAddons(
  addons: OfficialAddon[],
  id?: string,
): Promise<ProfileDetail> {
  return call<ProfileDetail>("set_comfig_addons", { addons, id: id ?? null });
}

export async function updateComfigVpks(id?: string): Promise<ProfileDetail> {
  return call<ProfileDetail>("update_comfig_vpks", { id: id ?? null });
}

export async function importComfigCustom(id?: string): Promise<ProfileDetail> {
  return call<ProfileDetail>("import_comfig_custom", { id: id ?? null });
}

export type SteamWriteStatus = "written" | "steam_open" | "no_account";

export type SetLaunchResult = {
  launchOptions: string;
  steamWrite: SteamWriteStatus;
};

export async function recommendedLaunchOptions(): Promise<string> {
  return call<string>("recommended_launch_options");
}

export async function getProfileLaunchOptions(id?: string): Promise<string> {
  return call<string>("get_profile_launch_options", { id: id ?? null });
}

export async function setProfileLaunchOptions(
  options: string,
  id?: string,
): Promise<SetLaunchResult> {
  return call<SetLaunchResult>("set_profile_launch_options", { options, id: id ?? null });
}

export async function getHudCatalog(refresh = false): Promise<HudCatalogEntry[]> {
  return call<HudCatalogEntry[]>("get_hud_catalog", { refresh });
}

export async function getHudState(): Promise<HudUiState> {
  return call<HudUiState>("get_hud_state");
}

/** One picture from a HUD's external album, resolved to a direct image URL. */
export type HudAlbumImage = {
  url: string;
  thumb: string | null;
  width: number;
  height: number;
};

/** What the two sites that publish numbers know about one HUD. */
export type HudStat = {
  /** ISO date of comfig.app's "Last updated". */
  updated?: string | null;
  downloads?: number | null;
  views?: number | null;
};

/** Per-HUD popularity and recency, keyed by hud-db id; cached for a day. */
export async function getHudStats(refresh = false): Promise<Record<string, HudStat>> {
  return call<Record<string, HudStat>>("get_hud_stats", { refresh });
}

/** The pictures behind a HUD's Imgur album or GitHub showcase page. */
export async function getHudAlbum(id: string): Promise<HudAlbumImage[]> {
  return call<HudAlbumImage[]>("get_hud_album", { id });
}

export async function installHud(id: string): Promise<ProfileDetail> {
  return call<ProfileDetail>("install_hud", { id });
}

/** Pick a zip/7z on disk and install it as this profile's HUD. Null = cancelled. */
export async function importHudArchive(): Promise<ProfileDetail | null> {
  return call<ProfileDetail | null>("import_hud_archive");
}

/** Pick a folder on disk and install it as this profile's HUD. Null = cancelled. */
export async function importHudFolder(): Promise<ProfileDetail | null> {
  return call<ProfileDetail | null>("import_hud_folder");
}

export async function matchHudCatalog(id: string): Promise<ProfileDetail> {
  return call<ProfileDetail>("match_hud_catalog", { id });
}

export async function updateHud(): Promise<ProfileDetail> {
  return call<ProfileDetail>("update_hud");
}

export async function getHudSchema(): Promise<HudSchemaView | null> {
  return call<HudSchemaView | null>("get_hud_schema");
}

export async function applyHudOptions(options: Record<string, string>): Promise<ProfileDetail> {
  return call<ProfileDetail>("apply_hud_options", { options });
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
  // Tauri v2 matches invoke keys in camelCase only — a snake_case key here
  // deserializes the Option as permanently-None.
  return call<ProfileDetail>("apply_crosshairs", {
    shape,
    assignments,
    customRgba: customRgba ?? null,
    color: color ?? null,
    library: library ?? null,
    design: design ?? null,
  });
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
  return call<CommunityCrosshair>("fetch_community_crosshair", { file });
}

/**
 * Thumbnails for the community picker: every requested upstream file stem,
 * fetched (with cache) and decoded. Missing keys failed to download or decode.
 */
export async function fetchCommunityCrosshairPreviews(
  files: string[],
): Promise<Record<string, StockCrosshairSprite>> {
  return call<Record<string, StockCrosshairSprite>>("fetch_community_crosshair_previews", {
    files,
  });
}

/** Decoded previews of the installed pack's library crosshairs. */
export async function getPackCrosshairPreviews(): Promise<Record<string, StockCrosshairSprite>> {
  return call<Record<string, StockCrosshairSprite>>("get_pack_crosshair_previews");
}

export type StockCrosshairSprite = {
  width: number;
  height: number;
  /** Frame 0 as unpremultiplied RGBA. */
  rgba: number[];
};

/** Valve's stock crosshair sprites decoded from the user's own game files. */
export async function getStockCrosshairSprites(): Promise<Record<string, StockCrosshairSprite>> {
  return call<Record<string, StockCrosshairSprite>>("get_stock_crosshair_sprites");
}

export async function removeCrosshairs(): Promise<ProfileDetail> {
  return call<ProfileDetail>("remove_crosshairs");
}

/** "full" hides the weapon and the arms; "weapon" keeps the hands animating. */
export type ViewmodelHideMode = "full" | "weapon";

/** Build a Yttrium-style pack from hidden animation groups and install it. */
export async function buildViewmodelPack(
  hidden: string[],
  preload: boolean,
  hideMode: ViewmodelHideMode = "full",
): Promise<ProfileDetail> {
  // camelCase: Tauri v2 lower-camels command args, and a snake_case key
  // would silently arrive as None.
  return call<ProfileDetail>("build_viewmodel_pack", { hidden, preload, hideMode });
}

export async function importViewmodels(preload: boolean): Promise<ProfileDetail> {
  return call<ProfileDetail>("import_viewmodels", { preload });
}

export async function removeViewmodels(): Promise<ProfileDetail> {
  return call<ProfileDetail>("remove_viewmodels");
}

/**
 * Whether this machine can compile a viewmodel pack (TF2's own studiomdl,
 * Windows only for now). False disables Build rather than sending a Linux
 * user into a dead end with a `.exe` in the error.
 */
export async function viewmodelBuildAvailable(): Promise<boolean> {
  return call<boolean>("viewmodel_build_available");
}

/**
 * One of CompVMInstaller's preview screenshots (JPEG bytes) by its upstream
 * resource stem, e.g. `scout_scattergun`. Raw bytes cross the bridge as an
 * ArrayBuffer, not a JSON array.
 */
export async function viewmodelPreviewImage(name: string): Promise<ArrayBuffer> {
  return call<ArrayBuffer>("viewmodel_preview_image", { name });
}

export async function setViewmodelPreload(enabled: boolean): Promise<ProfileDetail> {
  return call<ProfileDetail>("set_viewmodel_preload", { enabled });
}

// ---------------------------------------------------------------------------
// Hit and kill sounds
// ---------------------------------------------------------------------------

export type HitsoundKind = "hit" | "kill";

export type HitsoundSource = "community" | "file" | "comfig";

export type HitsoundEntry = {
  name: string;
  source: HitsoundSource;
  /** Gain baked into the file: 0, 6 or 12 dB. */
  boost?: number;
};

/** What the profile's sound pack holds; a missing slot plays the engine's own sound. */
export type HitsoundRecord = {
  hit?: HitsoundEntry | null;
  kill?: HitsoundEntry | null;
};

/** One sound the pane can audition or install. */
export type HitsoundPick =
  | { kind: "community"; name: string }
  | { kind: "file"; token: string; name: string }
  | { kind: "installed"; slot: HitsoundKind }
  | { kind: "stock"; stem: string }
  | { kind: "comfig"; hash: string; name: string };

export type HitsoundSlotChange =
  | { change: "keep" }
  | { change: "clear" }
  | { change: "install"; pick: HitsoundPick; boost: number };

export type WavInfo = {
  formatTag: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataBytes: number;
  durationMs: number;
};

export type PickedHitsound = {
  token: string;
  name: string;
  info: WavInfo;
  /** True when the file was re-encoded to something the engine plays. */
  converted: boolean;
};

/** Raw WAV bytes for auditioning one pick in an audio element. */
export async function hitsoundBytes(pick: HitsoundPick): Promise<ArrayBuffer> {
  return call<ArrayBuffer>("hitsound_bytes", { pick });
}

/** One comfig.app hits-library entry from the pinned index. */
export type ComfigHitsound = {
  name: string;
  hash: string;
  kind: HitsoundKind;
};

/** comfig.app's hits library (pinned index, cached). */
export async function comfigHitsoundIndex(): Promise<ComfigHitsound[]> {
  return call<ComfigHitsound[]>("comfig_hitsound_index");
}

/** Stems of the stock hit/kill sounds found in the user's own sound VPK. */
export async function listStockHitsounds(): Promise<string[]> {
  return call<string[]>("list_stock_hitsounds");
}

/** Open the file dialog for a WAV, prepare it for the engine, and stash it. */
export async function pickHitsoundFile(): Promise<PickedHitsound | null> {
  return call<PickedHitsound | null>("pick_hitsound_file");
}

export async function applyHitsounds(
  hit: HitsoundSlotChange,
  kill: HitsoundSlotChange,
): Promise<ProfileDetail> {
  return call<ProfileDetail>("apply_hitsounds", { hit, kill });
}

export async function removeHitsounds(): Promise<ProfileDetail> {
  return call<ProfileDetail>("remove_hitsounds");
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
    const { code, message } = parseInvokeError(error);
    throw new BridgeError(message, code);
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
  await call<void>("open_embedded_page", { page });
}

// ---------------------------------------------------------------------------
// Your mods (bring your own) and the GameBanana browser
// ---------------------------------------------------------------------------

/** One listing from GameBanana's TF2 section. */
export type GameBananaMod = {
  id: number;
  name: string;
  author: string;
  category: string;
  categoryId: number;
  likes: number;
  views: number;
  /** GameBanana withholds this on some listings. */
  downloads: number | null;
  /** Unix seconds. */
  updatedAt: number;
  addedAt: number;
  thumb: string | null;
  url: string;
  /** Flagged on GameBanana as mature content. */
  mature: boolean;
};

export type GameBananaPage = {
  records: GameBananaMod[];
  total: number;
  perPage: number;
  /** No further pages to load. */
  complete: boolean;
};

export type GameBananaCategory = {
  id: number;
  name: string;
};

export type GameBananaSort = "downloads" | "likes" | "views" | "updated" | "new";

/** Pick an archive or vpk and install it into the active profile. Null = cancelled. */
export async function importModArchive(): Promise<ProfileDetail | null> {
  return call<ProfileDetail | null>("import_mod_archive");
}

/** Pick a folder and install it into the active profile. Null = cancelled. */
export async function importModFolder(): Promise<ProfileDetail | null> {
  return call<ProfileDetail | null>("import_mod_folder");
}

export async function removeMod(id: string): Promise<ProfileDetail> {
  return call<ProfileDetail>("remove_mod", { id });
}

/**
 * One page of GameBanana listings. `page` is 1-based. A search query cannot be
 * ordered server-side, so the caller sorts what it has loaded.
 *
 * With `includeMature` false, flagged records are dropped from the page by our
 * own client, so a page can hold fewer than `perPage` records; `total` and
 * `perPage` still describe the unfiltered run, and the pager rides those.
 */
export async function searchGameBananaMods(
  query: string,
  sort: GameBananaSort,
  category: number | null,
  page: number,
  includeMature = false,
): Promise<GameBananaPage> {
  return call<GameBananaPage>("search_gamebanana_mods", {
    query,
    sort,
    category,
    page,
    includeMature,
  });
}

export async function gameBananaModCategories(): Promise<GameBananaCategory[]> {
  return call<GameBananaCategory[]>("gamebanana_mod_categories");
}

export async function installGameBananaMod(id: number): Promise<ProfileDetail> {
  return call<ProfileDetail>("install_gamebanana_mod", { id });
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
  /** Particle files modified in the official VPK that execs holds no snapshot for. */
  untrackedModified: string[];
  /** Ids of the profile's own mods whose particles are patched in. */
  profileParticleMods?: string[];
};

/** Particles a pack in the profile can contribute to the preloader. */
export type ParticleSource = {
  modId: string;
  name: string;
  pcfFiles: string[];
};

export type PreloaderStatusPayload = {
  status: PreloaderStatus;
  modsCached: boolean;
  modsSizeBytes: number;
  /** Steam's stored TF2 launch options carry the preload exec. */
  preloadLaunchInSteam: boolean;
  /** The active profile carries the shared preload cfg (Casual preload on). */
  profilePreload: boolean;
  /** Particle sources found in the profile's own mods. Absent on older payloads. */
  profileParticleSources?: ParticleSource[];
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
  return call<PreloaderStatusPayload>("get_preloader_status");
}

export async function getDefaultMods(): Promise<DefaultModsPayload> {
  return call<DefaultModsPayload>("get_default_mods");
}

export async function downloadDefaultMods(): Promise<DefaultModsPayload> {
  return call<DefaultModsPayload>("download_default_mods");
}

export async function applyPreloaderMods(
  addons: string[],
  particleMods: string[],
  profileParticleMods: string[] = [],
): Promise<PreloaderReport> {
  return call<PreloaderReport>("apply_preloader_mods", {
    addons,
    particleMods,
    profileParticleMods,
  });
}

export async function setGameinfoBypass(enabled: boolean): Promise<PreloaderStatusPayload> {
  return call<PreloaderStatusPayload>("set_gameinfo_bypass", { enabled });
}

export async function revertPreloader(): Promise<PreloaderRevertReport> {
  return call<PreloaderRevertReport>("revert_preloader");
}

/** The one Casual-preload switch for the active profile. */
export async function setProfilePreload(enabled: boolean): Promise<PreloaderStatusPayload> {
  return call<PreloaderStatusPayload>("set_profile_preload", { enabled });
}

/** Ask Steam to verify TF2's files (`steam://validate/440`). */
export async function repairGameFiles(): Promise<void> {
  return call<void>("repair_game_files");
}

// ---------------------------------------------------------------------------
// App updater
// ---------------------------------------------------------------------------

export type AppUpdateStep = "downloading" | "installing" | "restarting";

/**
 * The handle `checkAppUpdate` found, kept so `installAppUpdate` installs the
 * exact release the banner advertised instead of re-checking and installing
 * whatever the feed says a moment later.
 */
let pendingUpdate: Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>> | null =
  null;

export async function getAppVersion(): Promise<string> {
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

/** Version, OS, TF2 folder, active profile and the crash-log tail, as text for a bug report. */
export function getDiagnostics(): Promise<string> {
  return call<string>("get_diagnostics");
}

export async function checkAppUpdate(): Promise<{ version: string; notes: string | null } | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  pendingUpdate = update;
  if (!update) {
    return null;
  }
  return { version: update.version, notes: update.body ?? null };
}

export async function installAppUpdate(onProgress: (step: AppUpdateStep) => void): Promise<void> {
  const update = pendingUpdate;
  if (!update) {
    throw new BridgeError("No update available.", "NoUpdate");
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
  // Windows (NSIS `installMode: passive`) hands off to the installer, which
  // terminates and restarts the app itself — calling relaunch() here races it.
  // The AppImage path on Linux does need the explicit restart.
  if (typeof navigator !== "undefined" && navigator.userAgent.includes("Linux")) {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  }
}
