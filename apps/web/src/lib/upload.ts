import { unzipSync, zipSync } from "fflate";

// Upload constraints (AGENTS.md: .cfg/.txt/.md only, no VPK in v1).
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const MAX_FILES = 64;
export const ALLOWED_EXTENSIONS = [".cfg", ".txt", ".md"];

/** mastercomfig-recognized override files that belong in tf/cfg/overrides/. */
export const OVERRIDE_NAMES = new Set([
  "autoexec.cfg",
  "scout.cfg",
  "soldier.cfg",
  "pyro.cfg",
  "demoman.cfg",
  "heavyweapons.cfg",
  "engineer.cfg",
  "medic.cfg",
  "sniper.cfg",
  "spy.cfg",
  "game_overrides.cfg",
  "modules.cfg",
  "pre_init.cfg",
  "setup_hook.cfg",
  "listenserver.cfg",
]);

export const MANAGED_PREFIX = "tf/custom/execs-custom/cfg";
export const OVERRIDES_PREFIX = "tf/cfg/overrides";

export interface UploadedFile {
  /** Bundle-relative name, forward slashes. */
  name: string;
  bytes: Uint8Array;
}

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx === -1 ? "" : name.slice(idx).toLowerCase();
}

/** Rejects traversal/absolute/backslash zip-entry tricks; returns normalized name. */
export function sanitizeEntryName(raw: string): string {
  if (raw.includes("\\")) throw new UploadError(`invalid path (backslash): ${raw}`);
  const name = raw.replace(/^\.\//, "");
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) {
    throw new UploadError(`invalid path (absolute): ${raw}`);
  }
  const parts = name.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) {
    throw new UploadError(`invalid path: ${raw}`);
  }
  return parts.join("/");
}

/**
 * Expands an upload (loose files and/or one zip) into a flat validated list.
 * Enforces extension allowlist and size caps.
 */
export function expandUpload(inputs: UploadedFile[]): UploadedFile[] {
  const out: UploadedFile[] = [];
  for (const input of inputs) {
    if (extensionOf(input.name) === ".zip") {
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(input.bytes);
      } catch {
        throw new UploadError(`could not read zip ${input.name}`);
      }
      for (const [entryName, bytes] of Object.entries(entries)) {
        if (entryName.endsWith("/")) continue; // directory marker
        if (extensionOf(entryName) === ".zip") {
          throw new UploadError("nested zips are not allowed");
        }
        out.push({ name: sanitizeEntryName(entryName), bytes });
      }
    } else {
      out.push({ name: sanitizeEntryName(input.name), bytes: input.bytes });
    }
  }

  if (out.length === 0) throw new UploadError("no files in upload");
  if (out.length > MAX_FILES) throw new UploadError(`too many files (max ${MAX_FILES})`);
  let total = 0;
  const seen = new Set<string>();
  for (const file of out) {
    const ext = extensionOf(file.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new UploadError(`file type not allowed: ${file.name} (only .cfg/.txt/.md)`);
    }
    if (file.bytes.length > MAX_FILE_BYTES) {
      throw new UploadError(`${file.name} exceeds ${MAX_FILE_BYTES / 1024}KB`);
    }
    const lower = file.name.toLowerCase();
    if (seen.has(lower)) throw new UploadError(`duplicate file name: ${file.name}`);
    seen.add(lower);
    total += file.bytes.length;
  }
  if (total > MAX_TOTAL_BYTES) {
    throw new UploadError(`upload exceeds ${MAX_TOTAL_BYTES / 1024 / 1024}MB total`);
  }
  return out;
}

/**
 * Maps a bundle-relative file name to its TF2 install path.
 * Known override names go to tf/cfg/overrides; everything else lives in the
 * managed execs namespace. Never the deprecated tf/cfg/user.
 */
export function defaultInstallPath(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1).toLowerCase();
  if (OVERRIDE_NAMES.has(base)) return `${OVERRIDES_PREFIX}/${base}`;
  return `${MANAGED_PREFIX}/${name.toLowerCase()}`;
}

/** Builds the ready-to-merge tf/ tree zip served as the download bundle. */
export function buildBundleZip(
  entries: Array<{ installPath: string; bytes: Uint8Array }>,
): Uint8Array {
  const tree: Record<string, Uint8Array> = {};
  for (const { installPath, bytes } of entries) {
    tree[installPath] = bytes;
  }
  return zipSync(tree, { level: 6 });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "config"
  );
}
