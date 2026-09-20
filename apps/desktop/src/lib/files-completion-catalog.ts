import { enumerateCatalog } from "@execs/cfglint";
import { sourceKeyFromCode } from "./binds-ui";
import type { CompletionCatalog, CompletionEntry } from "./files-completion";

const keyCodes = [
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`),
  ...Array.from({ length: 5 }, (_, i) => `Mouse${i}`),
  "Space",
  "ShiftLeft",
  "ControlLeft",
  "AltLeft",
  "Tab",
  "Enter",
  "NumpadEnter",
  "Escape",
  "Backspace",
  "Semicolon",
  "Comma",
  "Period",
  "Slash",
  "Backslash",
  "Quote",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backquote",
  "CapsLock",
  "Insert",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "NumpadDecimal",
  "NumpadDivide",
  "NumpadMultiply",
  "NumpadSubtract",
  "NumpadAdd",
];
let cached: CompletionCatalog | undefined;
export function filesCompletionCatalog(): CompletionCatalog {
  if (cached) return cached;
  const entries = enumerateCatalog();
  const positionalArguments: Record<string, CompletionEntry[][]> = {};
  const args: Record<string, CompletionEntry[]> = {};
  const commands = entries.map((entry): CompletionEntry => {
    // Completion is announced on each keyboard move. Keep its source readable;
    // complete URLs, revisions and dates remain in the offline Reference panel.
    const provenance = [...new Set(entry.sources.map((source) => source.description))].join("; ");
    const info = `${entry.help ?? "No description in the bundled source."}\n${entry.applicability}\nSource: ${provenance}. Full provenance is available in Reference.`;
    const values = (items: readonly string[] | undefined): CompletionEntry[] =>
      (items ?? []).map((label) => ({
        label,
        type: "constant",
        detail: "Verified argument",
        info,
      }));
    args[entry.name] = values(entry.value?.values ?? entry.arguments?.[0]?.values);
    positionalArguments[entry.name] = entry.arguments?.map((argument) =>
      values(argument.values),
    ) ?? [args[entry.name]];
    return {
      label: entry.name,
      type: entry.kind === "cvar" ? "variable" : "function",
      detail: ` · ${entry.kind}`,
      info,
    };
  });
  const keys = [
    ...new Set([
      ...keyCodes.flatMap((code) => sourceKeyFromCode(code) ?? []),
      "mwheelup",
      "mwheeldown",
    ]),
  ].map((label) => ({
    label,
    type: "constant",
    detail: "Source key",
    info: "Source key name from execs’ Binds mapping. Key identity follows the game, not the current keyboard layout.",
  }));
  cached = { commands, keys, arguments: args, positionalArguments };
  return cached;
}
