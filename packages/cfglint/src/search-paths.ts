import { normalizeCfgPath } from "./lint-options.ts";

/** Known loose Source search paths. A cfg-looking directory deeper in a pack is not a mount. */
export function createCfgResolver(paths: readonly string[], bundleRelativeExec = false) {
  const available = new Set(paths.map(normalizeCfgPath));
  const customNames = new Set<string>();
  const spelling = new Map<string, string>();
  let problem: { file: string; message: string } | null = null;
  const profile = paths.some((path) => normalizeCfgPath(path).startsWith("tf/"));

  function remember(key: string, original: string, file: string) {
    const previous = spelling.get(key);
    if (previous !== undefined && previous !== original) {
      problem ??= {
        file,
        message: "Cfg paths collide without case sensitivity; mount order is unknown",
      };
    }
    spelling.set(key, original);
  }

  for (const path of paths) {
    const original = path.replaceAll("\\", "/").replace(/^\.\//, "");
    const normalized = normalizeCfgPath(path);
    if (normalized.startsWith("tf/cfg/")) remember(normalized, original, path);
    const custom = /^tf\/custom\/([^/]+)\/cfg\/(.+)$/.exec(normalized);
    if (!custom || custom[1].startsWith(".")) continue;
    const root = `tf/custom/${custom[1]}/cfg/`;
    const originalRoot = original.slice(0, root.length);
    remember(root, originalRoot, path);
    remember(normalized, original, path);
    if (/[^\x20-\x7e]/.test(custom[1])) {
      problem ??= { file: path, message: "This custom cfg root has an unsupported mount ordering" };
    }
    customNames.add(custom[1]);
  }
  // Valve SortStricmp, then PATH_ADD_TO_TAIL. Locale collation would reorder
  // punctuation such as the meaningful leading dash in -alpha versus alpha.
  const roots = [...customNames]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => `tf/custom/${name}/cfg/`);
  roots.push(profile ? "tf/cfg/" : "cfg/");
  const cache = new Map<string, string | null>();

  function resolve(target: string): string | null {
    let name = normalizeCfgPath(target);
    if (!name.endsWith(".cfg")) name += ".cfg";
    // Do not guess how platform-specific or escaping paths are interpreted.
    if (name.split("/").some((part) => !part || part === "." || part === "..")) return null;
    if (cache.has(name)) return cache.get(name) ?? null;
    const path =
      (bundleRelativeExec && available.has(name) ? name : null) ??
      roots.map((root) => `${root}${name}`).find((candidate) => available.has(candidate)) ??
      null;
    cache.set(name, path);
    return path;
  }

  function startup(target: string): string | null {
    const resolved = resolve(target);
    if (resolved || profile) return resolved;
    const name = normalizeCfgPath(target.endsWith(".cfg") ? target : `${target}.cfg`);
    return available.has(name) ? name : null;
  }

  return { resolve, startup, problem };
}
