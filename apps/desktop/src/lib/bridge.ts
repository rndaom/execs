import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Tf2Install = {
  path: string;
};

export type WriteLock = {
  running: boolean;
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
