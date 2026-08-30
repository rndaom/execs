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

export type ProfileDetail = {
  id: string;
  name: string;
  launchOptions: string;
  layer: CfgLayer;
  files: ProfileFile[];
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
