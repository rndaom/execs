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
