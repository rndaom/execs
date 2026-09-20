import type { CfgLayer } from "./bridge";
import { editorPathFits } from "./files-limits";

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const MANAGED = new Set([
  "config",
  "config_default",
  "execs_binds",
  "execs_gameplay",
  "execs_preload",
  "setup_hook",
  "modules",
  "mtp",
  "360controller",
  "360controller-linux",
  "undo360controller",
]);
export function newCfgPath(name: string, layer: CfgLayer): { path?: string; error?: string } {
  const stem = name.trim().replace(/\.cfg$/i, "");
  const parts = stem.split("/");
  if (
    !stem ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[\\<>:"|?*]/.test(part) ||
        [...part].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        /[. ]$/.test(part) ||
        RESERVED.test(part),
    )
  )
    return { error: "Use a relative cfg name with ordinary folder and filename characters." };
  if (
    parts.some((part) => ["tf", "cfg", "user", "overrides"].includes(part.toLowerCase())) ||
    MANAGED.has(parts[parts.length - 1].toLowerCase())
  )
    return { error: "Choose a user cfg name outside managed, engine and reserved folders." };
  const path = `tf/cfg/${layer === "comfig" ? "overrides/" : ""}${stem}.cfg`;
  if (!editorPathFits(path)) return { error: "The cfg path is too long." };
  return { path };
}
