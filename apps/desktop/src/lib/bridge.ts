import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppPreferences, AppSettingsPayload } from "./app-settings-ui";
import { editorPathFits, editorTextBytes, FILES_EDITOR_MAX_FILE_BYTES } from "./files-limits";
import type { InstallHealth } from "./health-ui";

export type InventoryItem = {
  id: string;
  definition: number;
  position: number;
  quality: number;
  level: number;
  customName: string | null;
};
export type InventoryDefinition = {
  name: string;
  kind: string;
  classes: string[];
  icon: string | null;
};
export type InventorySnapshot = {
  steamId: string;
  personaName?: string | null;
  avatar?: string | null;
  capacity: number;
  items: InventoryItem[];
  definitions: Record<string, InventoryDefinition>;
  itemDescriptions?: Record<
    string,
    InventoryDefinition & {
      details: string[];
      targetIcon?: string | null;
      patternIcon?: string | null;
    }
  >;
  qualityColors?: Record<string, string>;
  warning: string | null;
};
export function getInventory(): Promise<InventorySnapshot> {
  return call("get_inventory");
}
export function getInventoryIcons(
  paths: string[],
): Promise<Record<string, { width: number; height: number; rgba: number[] }>> {
  return call("get_inventory_icons", { paths });
}

export type Tf2Install = {
  path: string;
};

export type WriteLock = {
  running: boolean;
};

export type LifecycleStatus = {
  launchingTf2: boolean;
  steamVerification: boolean;
  installingUpdate: boolean;
};

export type ProfileSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  unsafeCustomFolders?: string[];
};

export type ProfileLibrary = {
  initialized: boolean;
  usable: boolean;
  rootMismatch: boolean;
  tf2Root: string | null;
  confirmedRoot: string | null;
  activeProfileId: string | null;
  /** Durable target awaiting a retry after an interrupted live switch. */
  pendingSwitchProfileId?: string | null;
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

export async function getLifecycleStatus(): Promise<LifecycleStatus> {
  return call<LifecycleStatus>("get_lifecycle_status");
}

export async function onTf2Running(handler: (running: boolean) => void): Promise<UnlistenFn> {
  return listen<boolean>("tf2-running", (event) => {
    handler(event.payload);
  });
}

/** The backend process poller failed, so the UI must fail closed until it recovers. */
export async function onTf2LockUnavailable(handler: () => void): Promise<UnlistenFn> {
  return listen("tf2-lock-unavailable", handler);
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

/** Changes only the display name; files, records and active tracking stay put. */
export async function renameProfile(id: string, name: string): Promise<ProfileLibrary> {
  return call<ProfileLibrary>("rename_profile", { id, name });
}

/** Copies a saved profile into a new inactive one; TF2 is not touched. */
export async function duplicateProfile(id: string, name: string): Promise<ProfileLibrary> {
  return call<ProfileLibrary>("duplicate_profile", { id, name });
}

export function deleteProfile(id: string, keepInstalled: boolean): Promise<ProfileLibrary> {
  return call("delete_profile", { id, keepInstalled });
}

export function getAppSettings(): Promise<AppSettingsPayload> {
  return call("get_app_settings");
}

export function setAppPreferences(preferences: AppPreferences): Promise<AppSettingsPayload> {
  return call("set_app_preferences", { preferences });
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
export type PackChoice = "update" | "keep" | "restore" | "captureKept";

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

export type RetiredCasualReview = {
  profileId: string;
  revision: string;
  addonsToRemove: string[];
  particleModsToRemove: string[];
  directAddonsKept: string[];
  profileParticleModsKept: string[];
};

export async function reviewRetiredCasualProfile(id: string): Promise<RetiredCasualReview> {
  return call<RetiredCasualReview>("review_retired_casual_profile", { id });
}

export async function clearRetiredCasualProfile(
  id: string,
  expectedRevision: string,
): Promise<ProfileLibrary> {
  return call<ProfileLibrary>("clear_retired_casual_profile", { id, expectedRevision });
}

export async function onSwitchProgress(
  handler: (progress: SwitchProgress) => void,
): Promise<UnlistenFn> {
  return listen<SwitchProgress>("profile-switch-progress", (event) => {
    handler(event.payload);
  });
}

export async function exportProfile(
  id: string,
  expectedReviewRevision: string,
): Promise<string | null> {
  return call<string | null>("export_profile", { id, expectedReviewRevision });
}

export type ProfileExportReview = {
  revision: string;
  credentialLocations: string[];
  customPacks: {
    path: string;
    fileCount: number;
    kind: "other" | "crosshairScripts" | "viewmodels";
  }[];
};

export async function inspectProfileExport(id: string): Promise<ProfileExportReview> {
  return call<ProfileExportReview>("inspect_profile_export", { id });
}

export type ProfileImportReview = {
  token: string;
  name: string;
  files: number;
  skippedFiles: number;
  creator: boolean;
  warnings: string[];
  notes: string[];
  /** Present on current native reviews; omitted by earlier saved fixtures. */
  huds?: string[];
  selectedHud?: string | null;
};

export async function importProfile(): Promise<ProfileImportReview | null> {
  return call<ProfileImportReview | null>("import_profile");
}

export async function confirmProfileImport(
  token: string,
  selectedHud?: string,
): Promise<ProfileLibrary> {
  return call<ProfileLibrary>("confirm_profile_import", { token, selectedHud });
}

export async function cancelProfileImport(token: string): Promise<void> {
  return call<void>("cancel_profile_import", { token });
}

export async function onProfileImportReading(handler: () => void): Promise<UnlistenFn> {
  return listen("profile-import-reading", handler);
}

export type CustomFolderRepair = { from: string; to: string };

export async function planCustomFolderRepair(id: string): Promise<CustomFolderRepair[]> {
  return call<CustomFolderRepair[]>("plan_custom_folder_repair", { id });
}

export async function repairCustomFolders(
  id: string,
  reviewed: CustomFolderRepair[],
): Promise<ProfileLibrary> {
  return call<ProfileLibrary>("repair_custom_folders", { id, reviewed });
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
  /** Accepted external pack changes mean the saved design/source is unverified. */
  sourceChanged?: boolean;
  sourceScriptsSha256?: string | null;
  inactive?: boolean;
  scale?: number;
  stock?: { file: string; scale: number };
  shape: string;
  assignments: Record<string, string>;
  /** Pack tint carried by `cl_crosshair_red/green/blue`; null/undefined = white. */
  color?: [number, number, number] | null;
  /** Installed non-builtin crosshairs: name -> "vtf" | "rgba". */
  library?: Record<string, string>;
  /** Serialized designer parameters for the "designed" entry. */
  design?: string | null;
};

export type CrosshairSourceStatus = {
  state: "none" | "current" | "changed" | "unverified" | "unavailable";
  reason?: string;
};

/** Where a pack in the profile came from. */
export type ModSource =
  | { kind: "local" }
  | { kind: "external" }
  | { kind: "gamebanana"; id: number; url: string };

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

export type ViewmodelSource = "compiled" | "imported" | "stockBuilt";

export type ViewmodelBuildRecipe = {
  schema: number;
  catalog: { patchVersion: string; catalogSha256: string };
  choices: { groupId: string; mode: "full" | "weapon" }[];
  sourceFingerprints: { id: string; sha256: string }[];
};

export type ViewmodelRecord = {
  id: string;
  sourceChanged?: boolean;
  source: ViewmodelSource;
  preload: boolean;
  options: Record<string, string>;
  buildRecipe?: ViewmodelBuildRecipe;
};

export type ViewmodelSourceCatalog = {
  /** Installed-source candidates; their retail behavior is not verified yet. */
  status: "provisional";
  catalog: { patchVersion: string; catalogSha256: string };
  /** Sorted canonical source IDs and digests, as in a stock-build recipe. */
  sourceFingerprints: { id: string; sha256: string }[];
  groups: {
    id: string;
    class: string;
    /** `slot` is the item's loadout slot for this group's class, when the schema names one. */
    items: { id: number; schemaName: string; itemClass?: string; slot?: string | null }[];
    animations: string[];
    /** Inspect animations are grouped separately from the weapon's ordinary actions. */
    inspect?: boolean;
    overlaps: string[];
    teamVariantsDiffer: boolean;
  }[];
  unresolvedItems: { class: string; itemId: number }[];
  /** Roles without an exact installed script mapping. */
  unresolvedRoleCount: number;
  /** Class-specific script candidates awaiting retail equip-path verification. */
  candidateRoleCount: number;
};

/** Bind Build to the exact provisional catalog and installed source bytes. */
export type ViewmodelBuildRequest = {
  catalog: ViewmodelSourceCatalog["catalog"];
  sourceFingerprints: ViewmodelSourceCatalog["sourceFingerprints"];
  choices: { groupId: string; mode: "full" | "weapon" }[];
  preload: boolean;
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
  /** hud-db lists prior creators or maintainers here; not the active author. */
  contributors?: string[];
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
  /** The backend could not verify catalog-backed update state. */
  catalogUnavailable?: boolean;
};

export type HudOwnershipReview = {
  profileId: string;
  selectedHud: string | null;
  candidates: { folder: string; source: "profile" | "live"; files: number }[];
  fingerprint: string;
  reviewRequired: boolean;
  managedOptionFiles: string[];
  resetOptions: boolean;
};

export function getHudOwnership(profileId: string): Promise<HudOwnershipReview> {
  return call("get_hud_ownership", { profileId });
}

export function selectProfileHud(
  profileId: string,
  hudFolder: string,
  expectedFingerprint: string,
): Promise<ProfileDetail> {
  return call("select_profile_hud", { profileId, hudFolder, expectedFingerprint });
}

export type HudSchemaChoice = {
  label: string;
  value: string;
};

export type HudSchemaControl = {
  unavailableReason?: string;
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
  sections: HudSchemaSection[];
};

export type ProfileDetail = {
  id: string;
  name: string;
  launchOptions: string;
  layer: CfgLayer;
  files: ProfileFile[];
  /** Retained HUD roots, including roots excluded from the live projection. */
  hudRoots?: string[];
  /** The exact root projected into TF2, when native can resolve one. */
  selectedHudRoot?: string | null;
  hud?: HudRecord | null;
  crosshair?: CrosshairRecord | null;
  viewmodel?: ViewmodelRecord | null;
  hitsound?: HitsoundRecord | null;
  /** Packs the user brought in. Absent on payloads from an older backend. */
  mods?: ModRecord[];
};

export type FilesContext = { profileId: string; root: string; layer: CfgLayer };
export type FilesSource = FilesContext & { sha256: string | null; librarySha256: string | null };

export type ProfileFileContent = {
  path: string;
  text: string | null;
  sha256: string;
  binary: boolean;
  source: FilesSource;
};

export async function getFilesContext(): Promise<FilesContext> {
  return call<FilesContext>("get_files_context");
}

export async function getActiveProfileDetail(): Promise<ProfileDetail | null> {
  return call<ProfileDetail | null>("get_active_profile_detail");
}

export async function readProfileFile(path: string, id?: string): Promise<ProfileFileContent> {
  if (!editorPathFits(path)) {
    throw new BridgeError("That profile file path is too long for the editor.", "InvalidPath");
  }
  return call<ProfileFileContent>("read_profile_file", { path, id: id ?? null });
}

export async function writeOwnedFile(
  path: string,
  text: string,
  expected: FilesSource,
): Promise<ProfileDetail> {
  if (!editorPathFits(path)) {
    throw new BridgeError("That profile file path is too long for the editor.", "InvalidPath");
  }
  if (editorTextBytes(text) === null) {
    throw new BridgeError(
      `That cfg is larger than the ${FILES_EDITOR_MAX_FILE_BYTES / (1024 * 1024)} MiB editor limit.`,
      "FileTooLarge",
    );
  }
  return call<ProfileDetail>("write_owned_file", { path, text, expected });
}

export async function writeManagedCfg(
  path: string,
  text: string,
  expectedProfileId: string,
  scope?: "gameplay" | "crosshair" | "sounds" | "viewmodels",
): Promise<ProfileDetail> {
  if (!editorPathFits(path)) {
    throw new BridgeError("That profile file path is too long for the editor.", "InvalidPath");
  }
  if (editorTextBytes(text) === null) {
    throw new BridgeError("That cfg is larger than the 1 MiB editor limit.", "FileTooLarge");
  }
  return call<ProfileDetail>("write_managed_cfg", {
    path,
    text,
    expectedProfileId,
    scope: scope ?? null,
  });
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

export async function importComfigCustom(id?: string): Promise<ProfileDetail | null> {
  return call<ProfileDetail | null>("import_comfig_custom", { id: id ?? null });
}

export type SteamWriteStatus = "written" | "steam_open" | "no_account" | "write_failed";

export type SetLaunchResult = {
  launchOptions: string;
  steamWrite: SteamWriteStatus;
};

/** How the active profile's launch options compare with Steam's saved copy. */
export type LaunchSyncStatus = {
  profileOptions: string;
  /** `null` when no Steam account was found, so there is nothing to sync. */
  steamOptions: string | null;
  inSync: boolean;
  steamRunning: boolean;
};

export async function getLaunchSyncStatus(): Promise<LaunchSyncStatus> {
  return call<LaunchSyncStatus>("get_launch_sync_status");
}

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

export type HudCatalogPayload = { entries: HudCatalogEntry[]; warning: string | null };
export type HudStatsPayload = { stats: Record<string, HudStat>; warning: string | null };
export type HudStatePayload = HudUiState & { profileId: string };

export async function getHudCatalog(refresh = false): Promise<HudCatalogPayload> {
  return call<HudCatalogPayload>("get_hud_catalog", { refresh });
}

export async function getHudState(): Promise<HudStatePayload> {
  return call<HudStatePayload>("get_hud_state");
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
export async function getHudStats(refresh = false): Promise<HudStatsPayload> {
  return call<HudStatsPayload>("get_hud_stats", { refresh });
}

/** The pictures behind a HUD's Imgur album or GitHub showcase page. */
export async function getHudAlbum(id: string, refresh = false): Promise<HudAlbumImage[]> {
  return call<HudAlbumImage[]>("get_hud_album", { id, refresh });
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

/** Removes the active profile's HUD, its option cfgs and exec lines. */
export async function returnToStockHud(): Promise<ProfileDetail> {
  return call<ProfileDetail>("return_to_stock_hud");
}

export async function updateHud(): Promise<ProfileDetail> {
  return call<ProfileDetail>("update_hud");
}

export async function getHudSchema(
  expectedProfileId: string,
  expectedHudId: string,
): Promise<HudSchemaView | null> {
  return call<HudSchemaView | null>("get_hud_schema", { expectedProfileId, expectedHudId });
}

export async function applyHudOptions(
  options: Record<string, string>,
  expectedProfileId: string,
  expectedHudId: string,
): Promise<ProfileDetail> {
  return call<ProfileDetail>("apply_hud_options", { options, expectedProfileId, expectedHudId });
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
  settings?: { scale: number; stock: { file: string; scale: number }; libraryNames?: string[] },
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
    settings: settings ?? null,
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

/** Installed custom-pack candidates that could replace Valve's stock art. */
export async function getCrosshairContentSources(): Promise<ContentIndex> {
  return call<ContentIndex>("get_crosshair_content_sources");
}

/** Whether the saved pack still matches TF2's current weapon scripts. */
export async function getCrosshairSourceStatus(): Promise<CrosshairSourceStatus> {
  return call<CrosshairSourceStatus>("get_crosshair_source_status");
}

export async function removeCrosshairs(): Promise<ProfileDetail> {
  return call<ProfileDetail>("remove_crosshairs");
}

export async function deactivateCrosshairs(): Promise<ProfileDetail> {
  return call<ProfileDetail>("deactivate_crosshairs");
}

export async function getViewmodelSourceCatalog(): Promise<ViewmodelSourceCatalog> {
  return call<ViewmodelSourceCatalog>("get_viewmodel_source_catalog");
}

export async function buildSelectedViewmodelPack(
  request: ViewmodelBuildRequest,
): Promise<ProfileDetail> {
  return call<ProfileDetail>("build_selected_viewmodel_pack", { request });
}

export async function importViewmodels(preload: boolean): Promise<ProfileDetail | null> {
  return call<ProfileDetail | null>("import_viewmodels", { preload });
}

export async function removeViewmodels(): Promise<ProfileDetail> {
  return call<ProfileDetail>("remove_viewmodels");
}

// ---------------------------------------------------------------------------
// Hit and kill sounds
// ---------------------------------------------------------------------------

export type HitsoundKind = "hit" | "kill";

export type HitsoundSource = "community" | "file" | "comfig";

export type HitsoundEntry = {
  name: string;
  source: HitsoundSource;
  /** Stable original source identity; older profiles may omit it. */
  token?: string | null;
  hash?: string | null;
  /** Gain baked into the file: 0, 6 or 12 dB. */
  boost?: number;
};

/** What the profile's sound pack holds; a missing slot plays the engine's own sound. */
export type HitsoundRecord = {
  sourceChanged?: boolean;
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

/** Stems of the stock hit/kill sounds found in the user's own sound VPK. */
export async function listStockHitsounds(): Promise<string[]> {
  return call<string[]>("list_stock_hitsounds");
}

/** Candidate virtual-path sources in tf/custom; an incomplete scan is explicit. */
export type ContentIndex = {
  hits: Record<string, { pack: string; member: string; kind: "loose" | "vpk" }[]>;
  incomplete: string[];
};

/** Other installed packs containing TF2's canonical hit or kill sound paths. */
export async function getHitsoundSources(): Promise<ContentIndex> {
  return call<ContentIndex>("get_hitsound_sources");
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

/** Commit the Sounds pane's scoped CFG and WAV changes as one profile write. */
export async function applyHitsoundsWithSettings(
  path: string,
  text: string,
  expectedProfileId: string,
  hit: HitsoundSlotChange,
  kill: HitsoundSlotChange,
): Promise<ProfileDetail> {
  if (!editorPathFits(path)) {
    throw new BridgeError("That profile file path is too long for the editor.", "InvalidPath");
  }
  if (editorTextBytes(text) === null) {
    throw new BridgeError("That cfg is larger than the 1 MiB editor limit.", "FileTooLarge");
  }
  return call<ProfileDetail>("apply_hitsounds_with_settings", {
    path,
    text,
    expectedProfileId,
    hit,
    kill,
  });
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
  subCategory: string | null;
  /** GUI listings route to HUD or manual import, never generic Mods install. */
  route: "mod" | "hud" | "manual";
  /** Listing metrics are absent on some index records. */
  likes: number | null;
  views: number | null;
  /** GameBanana withholds this on some listings. */
  downloads: number | null;
  /** Unix seconds. These are separate upstream events and never substitute for one another. */
  addedAt: number | null;
  updatedAt: number | null;
  modifiedAt: number | null;
  thumb: string | null;
  url: string;
  /** Flagged on GameBanana as mature content. */
  mature: boolean;
};

export type GameBananaTotal =
  | { kind: "exact"; value: number }
  | { kind: "estimated"; value: number }
  | { kind: "capped"; value: number }
  | { kind: "unknown" };

export type GameBananaFilterScope = "global" | "page";

export type GameBananaFilterScopes = {
  query: GameBananaFilterScope;
  category: GameBananaFilterScope;
  contentRating: GameBananaFilterScope;
  installability: GameBananaFilterScope;
};

export type GameBananaCacheInfo = {
  source: "network" | "memory";
  /** How much longer the native cache considers this response fresh. */
  freshForMs: number;
};

export type GameBananaPage = {
  /** Already ordered by GameBanana. Filtering must preserve this order. */
  records: GameBananaMod[];
  total: GameBananaTotal;
  perPage: number;
  /** No further pages to load. */
  complete: boolean;
  ordering: "server";
  filters: GameBananaFilterScopes;
  cache: GameBananaCacheInfo;
};

export type GameBananaCategory = {
  id: number;
  name: string;
};

export type GameBananaDownloadVariant = {
  id: number;
  fileName: string;
  description: string;
  sizeBytes: number | null;
  addedAt: number | null;
  supported: boolean;
  /** One piece of a split upload; never installable on its own. */
  splitPart: boolean;
};

export type GameBananaSort = "new" | "updated" | "downloads" | "likes" | "views";

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
 * One page of GameBanana listings. `page` is 1-based. Query, category, content
 * rating and ordering are sent to the index together. Safety filtering for the
 * aggregate "All" category remains page-local and is disclosed by `filters`.
 * `refresh` bypasses both the browser's page cache and the native memory cache.
 */
export async function searchGameBananaMods(
  query: string,
  sort: GameBananaSort,
  category: number | null,
  page: number,
  includeMature = false,
  refresh = false,
): Promise<GameBananaPage> {
  return call<GameBananaPage>("search_gamebanana_mods", {
    query,
    sort,
    category,
    page,
    includeMature,
    refresh,
  });
}

export async function gameBananaModCategories(refresh = false): Promise<GameBananaCategory[]> {
  return call<GameBananaCategory[]>("gamebanana_mod_categories", { refresh });
}

export async function gameBananaDownloadVariants(id: number): Promise<GameBananaDownloadVariant[]> {
  return call<GameBananaDownloadVariant[]>("gamebanana_download_variants", { id });
}

export async function installGameBananaMod(id: number, fileId: number): Promise<ProfileDetail> {
  return call<ProfileDetail>("install_gamebanana_mod", { id, fileId });
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
  /** Steam verification is active; all writes remain disabled until rechecked. */
  repairInProgress?: boolean;
  /** A durable preloader transaction is waiting for safe recovery. */
  recoveryRequired?: boolean;
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

/** Finish an interrupted preloader transaction without changing selection. */
export async function recoverPreloader(): Promise<PreloaderStatusPayload> {
  return call<PreloaderStatusPayload>("recover_preloader");
}

export async function getDefaultMods(): Promise<DefaultModsPayload> {
  return call<DefaultModsPayload>("get_default_mods");
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

/** Recheck Steam verification state and release the maintenance gate once stock is restored. */
export async function completeGameFileRepair(): Promise<boolean> {
  return call<boolean>("complete_game_file_repair", { steamReportsComplete: true });
}

/** Cancel a verification lease only after the backend sees Steam and TF2 closed. */
export async function cancelGameFileRepair(): Promise<boolean> {
  return call<boolean>("cancel_game_file_repair");
}

/**
 * Start TF2 through Steam (`steam://rungameid/440`). With `syncSteam`, the
 * player agreed to close Steam first so the profile's launch options can be
 * written; the launch then starts Steam again.
 */
export async function launchTf2(syncSteam = false): Promise<void> {
  return call<void>("launch_tf2", { syncSteam });
}

/** Release a pending launch after the user has cancelled it in Steam. */
export async function cancelTf2Launch(): Promise<boolean> {
  return call<boolean>("cancel_tf2_launch");
}

// ---------------------------------------------------------------------------
// App updater
// ---------------------------------------------------------------------------

export type AppUpdateStep = "downloading" | "installing" | "restarting";

/** Exact version the latest successful read-only check advertised. */
let pendingUpdateVersion: string | null = null;
let updateCheckGeneration = 0;

export async function getAppVersion(): Promise<string> {
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

/** Version, OS, TF2 folder, active profile and the crash-log tail, as text for a bug report. */
export function getDiagnostics(): Promise<string> {
  return call<string>("get_diagnostics");
}

export function getInstallHealth(): Promise<InstallHealth> {
  return call("get_install_health");
}

/** How long the update feed gets to answer before the footer says so; the
 * plugin has no default, so a stalled connection would hang the check. */
const UPDATE_CHECK_TIMEOUT_MS = 15_000;

export async function checkAppUpdate(): Promise<{ version: string; notes: string | null } | null> {
  const generation = ++updateCheckGeneration;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
  if (!update) {
    if (generation === updateCheckGeneration) pendingUpdateVersion = null;
    return null;
  }
  const info = { version: update.version, notes: update.body ?? null };
  // The install command re-checks in Rust. Do not retain a renderer-owned
  // resource handle whose mutating methods are intentionally denied by ACL.
  await update.close().catch(() => {});
  if (generation === updateCheckGeneration) pendingUpdateVersion = update.version;
  return info;
}

export async function installAppUpdate(onProgress: (step: AppUpdateStep) => void): Promise<void> {
  const expectedVersion = pendingUpdateVersion;
  if (!expectedVersion) {
    throw new BridgeError("No update available.", "NoUpdate");
  }
  onProgress("downloading");
  const unlisten = await listen<AppUpdateStep>("app-update-progress", (event) => {
    if (["downloading", "installing", "restarting"].includes(event.payload)) {
      onProgress(event.payload);
    }
  });
  try {
    await call<void>("install_app_update", { expectedVersion });
  } finally {
    unlisten();
  }
}
