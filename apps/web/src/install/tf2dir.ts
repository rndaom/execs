"use client";

// Browser-only: TF2 folder picking, validation, and handle persistence.
// Pattern follows comfig.app: IndexedDB-persisted FileSystemDirectoryHandle,
// re-armed with queryPermission/requestPermission on return visits.

import { del, get, set } from "idb-keyval";
import type { DirHandle } from "./types";

const IDB_KEY = "tf2DirHandle";

type RealHandle = FileSystemDirectoryHandle & {
  queryPermission?: (opts: { mode: string }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: string }) => Promise<PermissionState>;
};

export function supportsDirectInstall(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export class Tf2DirError extends Error {}

/** Validates that the handle is the TF2 root (contains tf/gameinfo.txt). */
async function validate(handle: FileSystemDirectoryHandle): Promise<void> {
  // Common mispicks first, so we can give targeted guidance.
  try {
    await handle.getFileHandle("gameinfo.txt");
    throw new Tf2DirError(
      'That looks like the "tf" folder — pick its parent, the "Team Fortress 2" folder.',
    );
  } catch (e) {
    if (e instanceof Tf2DirError) throw e;
  }
  try {
    const tf = await handle.getDirectoryHandle("tf");
    await tf.getFileHandle("gameinfo.txt");
  } catch {
    throw new Tf2DirError(
      'That folder doesn\'t look like a TF2 install. Pick the "Team Fortress 2" folder (it contains "tf" and "hl2").' +
        " Usually: Steam/steamapps/common/Team Fortress 2",
    );
  }
}

export async function pickTf2Dir(): Promise<DirHandle> {
  const picker = (
    window as unknown as {
      showDirectoryPicker: (opts?: unknown) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  const handle = await picker({ id: "tf2-root", mode: "readwrite" });
  await validate(handle);
  await set(IDB_KEY, handle);
  return handle as unknown as DirHandle;
}

/** Returns the stored handle with permission re-armed, or null. */
export async function getStoredTf2Dir(opts: { request: boolean }): Promise<DirHandle | null> {
  const handle = (await get<RealHandle>(IDB_KEY)) ?? null;
  if (!handle) return null;
  try {
    let state = (await handle.queryPermission?.({ mode: "readwrite" })) ?? "granted";
    if (state === "prompt" && opts.request) {
      state = (await handle.requestPermission?.({ mode: "readwrite" })) ?? "denied";
    }
    if (state !== "granted") return null;
    await validate(handle);
    return handle as unknown as DirHandle;
  } catch {
    await del(IDB_KEY);
    return null;
  }
}

export async function forgetTf2Dir(): Promise<void> {
  await del(IDB_KEY);
}
