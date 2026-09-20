// Compatibility API over the sourced catalog. See CATALOG.md for provenance,
// platform scope and deliberately missing metadata.
import corpus from "./cvars.gen.ts";

export interface CorpusEntry {
  /** 1 = console command, 0 = cvar */
  c: 0 | 1;
  /** default value (cvars only) */
  d?: string;
  /** flags, e.g. ["cl", "cheat", "a"] */
  f?: string[];
  /** help text */
  h?: string;
}

export function lookupCvar(name: string): CorpusEntry | undefined {
  const key = name.toLowerCase();
  return Object.hasOwn(corpus, key) ? corpus[key] : undefined;
}
