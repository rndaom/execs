// The corpus is built by tools/build-corpus.mjs from mastercomfig's pinned
// `docs/tf2/cvarlist_win.md` and `docs/tf2/hiddencvars.md` (MIT, Copyright (c)
// mastercomfig contributors), which are dumps of Valve's own `cvarlist`.
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
  return corpus[name.toLowerCase()];
}
