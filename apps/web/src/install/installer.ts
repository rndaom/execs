// Core install/uninstall logic against the DirHandle interface.
// The real FileSystemDirectoryHandle satisfies DirHandle structurally.

import type {
  DirHandle,
  InstallConflict,
  InstallManifest,
  ManifestEntry,
  VersionManifest,
} from "./types";

export const MANIFEST_DIR = "tf/custom/execs-custom";
export const MANIFEST_NAME = "execs-manifest.json";

async function dirAt(root: DirHandle, path: string, create: boolean): Promise<DirHandle> {
  let dir = root;
  for (const part of path.split("/")) {
    dir = await dir.getDirectoryHandle(part, { create });
  }
  return dir;
}

async function fileExists(root: DirHandle, path: string): Promise<boolean> {
  try {
    const idx = path.lastIndexOf("/");
    const dir = await dirAt(root, path.slice(0, idx), false);
    await dir.getFileHandle(path.slice(idx + 1));
    return true;
  } catch {
    return false;
  }
}

async function readFileText(root: DirHandle, path: string): Promise<string | null> {
  try {
    const idx = path.lastIndexOf("/");
    const dir = await dirAt(root, path.slice(0, idx), false);
    const handle = await dir.getFileHandle(path.slice(idx + 1));
    return await (await handle.getFile()).text();
  } catch {
    return null;
  }
}

async function writeFileBytes(root: DirHandle, path: string, data: ArrayBuffer | string) {
  const idx = path.lastIndexOf("/");
  const dir = await dirAt(root, path.slice(0, idx), true);
  const name = path.slice(idx + 1);
  // Delete-before-write keeps installs idempotent even if a previous write
  // left a partial file.
  try {
    await dir.removeEntry(name);
  } catch {
    // didn't exist
  }
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function deleteFile(root: DirHandle, path: string): Promise<void> {
  try {
    const idx = path.lastIndexOf("/");
    const dir = await dirAt(root, path.slice(0, idx), false);
    await dir.removeEntry(path.slice(idx + 1));
  } catch {
    // already gone
  }
}

export async function sha256HexBrowser(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function readManifest(root: DirHandle): Promise<InstallManifest> {
  const text = await readFileText(root, `${MANIFEST_DIR}/${MANIFEST_NAME}`);
  if (!text) return { schema: 1, installed: [] };
  try {
    const parsed = JSON.parse(text) as InstallManifest;
    if (parsed.schema !== 1 || !Array.isArray(parsed.installed)) throw new Error("bad schema");
    return parsed;
  } catch {
    // Corrupted manifest: start fresh rather than dying. Existing files become
    // "user-owned" and installs over them will prompt.
    return { schema: 1, installed: [] };
  }
}

async function writeManifest(root: DirHandle, manifest: InstallManifest): Promise<void> {
  await writeFileBytes(root, `${MANIFEST_DIR}/${MANIFEST_NAME}`, JSON.stringify(manifest, null, 2));
}

/**
 * Detects conflicts before an install: paths claimed by another installed
 * config, or existing files the manifest doesn't know about (user-owned).
 */
export async function detectConflicts(
  root: DirHandle,
  version: VersionManifest,
): Promise<InstallConflict[]> {
  const manifest = await readManifest(root);
  const conflicts: InstallConflict[] = [];
  for (const file of version.files) {
    const owner = manifest.installed.find(
      (entry) => entry.configId !== version.configId && entry.files.includes(file.installPath),
    );
    if (owner) {
      conflicts.push({ path: file.installPath, ownedBy: owner.name });
      continue;
    }
    const ownedBySelf = manifest.installed.some(
      (entry) => entry.configId === version.configId && entry.files.includes(file.installPath),
    );
    if (!ownedBySelf && (await fileExists(root, file.installPath))) {
      conflicts.push({ path: file.installPath, ownedBy: null });
    }
  }
  return conflicts;
}

/**
 * Installs a version: fetches payloads, writes files, updates the manifest.
 * Call detectConflicts first and get user confirmation when it's non-empty.
 * Replaces any previous install of the same config (removing files the new
 * version no longer ships).
 */
export async function installVersion(
  root: DirHandle,
  version: VersionManifest,
  fetchFile: (r2Key: string) => Promise<ArrayBuffer>,
): Promise<void> {
  const manifest = await readManifest(root);
  const previous = manifest.installed.find((e) => e.configId === version.configId);

  const payloads = await Promise.all(
    version.files.map(async (f) => ({ ...f, bytes: await fetchFile(f.r2Key) })),
  );

  if (previous) {
    const newPaths = new Set(version.files.map((f) => f.installPath));
    for (const stale of previous.files.filter((p) => !newPaths.has(p))) {
      await deleteFile(root, stale);
    }
  }

  for (const payload of payloads) {
    await writeFileBytes(root, payload.installPath, payload.bytes);
  }

  const entry: ManifestEntry = {
    configId: version.configId,
    versionId: version.versionId,
    name: version.name,
    installedAt: Date.now(),
    files: version.files.map((f) => f.installPath),
    sha256: Object.fromEntries(version.files.map((f) => [f.installPath, f.sha256])),
  };
  const next: InstallManifest = {
    schema: 1,
    installed: [
      ...manifest.installed.filter((e) => e.configId !== version.configId),
      entry,
    ],
  };
  await writeManifest(root, next);
}

export interface UninstallResult {
  removed: string[];
  /** Files left in place because their content no longer matches the manifest. */
  keptModified: string[];
}

export async function uninstallConfig(
  root: DirHandle,
  configId: string,
  opts: { removeModified?: boolean } = {},
): Promise<UninstallResult> {
  const manifest = await readManifest(root);
  const entry = manifest.installed.find((e) => e.configId === configId);
  if (!entry) return { removed: [], keptModified: [] };

  const removed: string[] = [];
  const keptModified: string[] = [];
  for (const path of entry.files) {
    const text = await readFileText(root, path);
    if (text === null) continue; // already gone
    const hash = await sha256HexBrowser(new TextEncoder().encode(text).buffer as ArrayBuffer);
    if (hash !== entry.sha256[path] && !opts.removeModified) {
      keptModified.push(path);
      continue;
    }
    await deleteFile(root, path);
    removed.push(path);
  }

  const next: InstallManifest = {
    schema: 1,
    installed: manifest.installed.filter((e) => e.configId !== configId),
  };
  await writeManifest(root, next);
  return { removed, keptModified };
}
