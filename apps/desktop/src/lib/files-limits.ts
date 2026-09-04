/**
 * The Files pane is a text editor, not a bulk profile browser. Keep these in
 * sync with the Tauri command boundary. The aggregate limit also bounds the
 * bundle handed to cfglint, where parsing can cost more than the source text.
 */
export const FILES_EDITOR_MAX_FILES = 256;
export const FILES_EDITOR_MAX_FILE_BYTES = 1024 * 1024;
export const FILES_EDITOR_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const FILES_EDITOR_MAX_PATH_BYTES = 1024;

/**
 * Measure UTF-8 without allocating the encoded copy that this check exists to
 * avoid. Lone UTF-16 surrogates encode as U+FFFD, which is three bytes.
 */
export function utf8ByteLengthAtMost(value: string, maximum: number): number | null {
  let bytes = 0;
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes > maximum) {
      return null;
    }
  }
  return bytes;
}

export function editorPathFits(path: string): boolean {
  return path.length > 0 && utf8ByteLengthAtMost(path, FILES_EDITOR_MAX_PATH_BYTES) !== null;
}

export function editorTextBytes(text: string): number | null {
  return utf8ByteLengthAtMost(text, FILES_EDITOR_MAX_FILE_BYTES);
}

export function addEditorTextToBudget(totalBytes: number, text: string): number | null {
  const remaining = FILES_EDITOR_MAX_TOTAL_BYTES - totalBytes;
  if (remaining < 0) {
    return null;
  }
  const bytes = utf8ByteLengthAtMost(text, Math.min(FILES_EDITOR_MAX_FILE_BYTES, remaining));
  return bytes === null ? null : totalBytes + bytes;
}

const SETTINGS_CFG_NAMES = new Set([
  "autoexec.cfg",
  "config.cfg",
  "execs_binds.cfg",
  "execs_gameplay.cfg",
  "execs_preload.cfg",
  "modules.cfg",
  "setup_hook.cfg",
]);

function editorCfgPriority(path: string): number {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (normalized.startsWith("tf/cfg/") && SETTINGS_CFG_NAMES.has(name)) {
    return 0;
  }
  return normalized.startsWith("tf/cfg/") ? 1 : 2;
}

function hasCfgExtension(path: string): boolean {
  return path.length >= 4 && path.slice(-4).toLowerCase() === ".cfg";
}

export function editorCfgCandidates<T extends { path: string }>(
  files: T[],
): {
  files: T[];
  limited: boolean;
} {
  const candidates: T[] = [];
  let limited = false;
  // Critical cfgs feed the Binds/Gameplay panes too. Select those first even
  // when a malicious manifest puts hundreds of provided HUD cfgs before them.
  for (let priority = 0; priority <= 2; priority += 1) {
    for (const file of files) {
      if (!hasCfgExtension(file.path)) {
        continue;
      }
      if (!editorPathFits(file.path)) {
        limited = true;
        continue;
      }
      if (editorCfgPriority(file.path) !== priority) {
        continue;
      }
      if (candidates.length === FILES_EDITOR_MAX_FILES) {
        return { files: candidates, limited: true };
      }
      candidates.push(file);
    }
  }
  return { files: candidates, limited };
}
