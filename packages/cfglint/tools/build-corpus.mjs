import { spawnSync } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REF = "c7b52734b252bb521cd22e8243bca6f81dd3ab41";
const SDK_REF = "b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474";
const master = (path, description) => ({
  url: `https://raw.githubusercontent.com/mastercomfig/mastercomfig/${REF}/${path}`,
  revision: REF,
  date: "2026-09-20",
  description,
});
export const SOURCES = [
  master("docs/tf2/cvarlist_win.md", "Windows TF2 cvarlist dump; MIT mastercomfig contributors"),
  master("docs/tf2/hiddencvars.md", "Hidden TF2 cvar dump; MIT mastercomfig contributors"),
  {
    url: `https://raw.githubusercontent.com/ValveSoftware/source-sdk-2013/${SDK_REF}/src/game/shared/multiplay_gamerules.cpp`,
    revision: SDK_REF,
    date: "2026-09-20",
    description:
      "Valve Source SDK 2013 shared ClientCommand handler; metadata only, no SDK code copied",
  },
  master(
    "config/mastercomfig/cfg/comfig/comfig.cfg",
    "mastercomfig alias declarations; MIT mastercomfig contributors",
  ),
  master(
    "config/mastercomfig/cfg/comfig/define_presets.cfg",
    "mastercomfig preset aliases; MIT mastercomfig contributors",
  ),
  {
    url: `https://raw.githubusercontent.com/ValveSoftware/source-sdk-2013/${SDK_REF}/src/game/client/tf/clientmode_tf.cpp`,
    revision: SDK_REF,
    date: "2026-09-20",
    description: "Valve SDK fov_desired declaration; metadata only",
  },
  {
    url: `https://raw.githubusercontent.com/ValveSoftware/source-sdk-2013/${SDK_REF}/src/game/shared/shareddefs.h`,
    revision: SDK_REF,
    date: "2026-09-20",
    description: "Valve SDK MAX_FOV declaration; metadata only",
  },
];
const LINE_RE = /^([+-]?[A-Za-z_][\w-]*)\s+:\s(.*?)\s+:\s*(.*?)\s*:\s?(.*)$/;
export function parseDump(text, minimum) {
  const entries = new Map();
  if (!text.includes("```c") || !text.includes("--------------"))
    throw new Error("Missing dump structure");
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const match = line.match(LINE_RE);
    if (!match) {
      if (/^\S+\s+:/.test(line)) throw new Error(`Malformed dump entry: ${line}`);
      continue;
    }
    const [, rawName, def, flagsRaw, help] = match;
    if (flagsRaw.replace(/"[^"\r\n]+"|[,\s]/g, "")) throw new Error(`Malformed flags: ${rawName}`);
    const name = rawName.toLowerCase();
    const flags = [...flagsRaw.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const isCommand = def.trim() === "cmd";
    const entry = {
      c: isCommand ? 1 : 0,
      ...(!isCommand ? { d: def.trim() } : {}),
      ...(flags.length ? { f: flags } : {}),
      ...(help.trim() ? { h: help.trim() } : {}),
    };
    const prior = entries.get(name);
    if (prior && (prior.c !== entry.c || prior.d !== entry.d))
      throw new Error(`Conflicting duplicate dump entry: ${name}`);
    entries.set(
      name,
      prior
        ? {
            ...entry,
            f: [...new Set([...(prior.f ?? []), ...(entry.f ?? [])])],
            h: [...new Set([prior.h, entry.h].filter(Boolean))].join(" / ") || undefined,
          }
        : entry,
    );
  }
  if (entries.size < minimum)
    throw new Error(`Implausible dump coverage: ${entries.size} < ${minimum}`);
  return entries;
}
export function mergeEntry(corpus, name, entry) {
  const old = corpus[name];
  if (!old) {
    corpus[name] = entry;
    return;
  }
  // Conflicting facts need a deliberate source review, never last-source-wins.
  for (const key of ["c", "k"]) {
    if (old[key] !== undefined && entry[key] !== undefined && old[key] !== entry[key])
      throw new Error(`Conflicting ${key} for ${name}`);
  }
  corpus[name] = {
    ...entry,
    ...old,
    f: [...new Set([...(old.f ?? []), ...(entry.f ?? [])])],
    h: [...new Set([old.h, entry.h].filter(Boolean))].join(" / ") || undefined,
    s: [...new Set([...old.s, ...entry.s])],
  };
  if (old.d !== entry.d) {
    delete corpus[name].d;
    corpus[name].a += "; source defaults differ, so no default is claimed";
  }
}
export function buildCorpus(texts) {
  if (
    texts.length !== SOURCES.length ||
    texts.some((text) => typeof text !== "string" || !text.trim())
  )
    throw new Error("Missing source");
  const corpus = Object.create(null);
  for (let source = 0; source < 2; source++) {
    for (const [name, entry] of parseDump(texts[source], source ? 300 : 3500))
      mergeEntry(corpus, name, {
        ...entry,
        s: [source],
        a: source
          ? "Pinned hidden-command dump; platform and current retail availability unverified"
          : "Pinned Windows TF2 dump; Linux and current retail availability unverified",
      });
  }
  if (
    !/FStrEq\( pcmd, "voicemenu" \)/.test(texts[2]) ||
    !texts[2].includes("int iMenu = atoi( args[1] )") ||
    !texts[2].includes("int iItem = atoi( args[2] )")
  )
    throw new Error("Missing verified voicemenu handler");
  mergeEntry(corpus, "voicemenu", {
    c: 1,
    s: [2],
    a: "Shared TF2 Source SDK handler; current retail availability unverified",
    syntax: "voicemenu <menu> <item>",
    arguments: [
      { name: "menu", type: "integer" },
      { name: "item", type: "integer" },
    ],
    h: "Request a voice menu item. Menu and item availability depends on game data.",
  });
  for (let source = 3; source < 5; source++) {
    const names = [...texts[source].matchAll(/^alias\s+([+-]?[A-Za-z_][\w=-]*)(?=["\s])/gm)].map(
      (m) => m[1].toLowerCase(),
    );
    if (names.length < 5) throw new Error("Implausible mastercomfig alias coverage");
    for (const name of new Set(names)) {
      // Engine facts remain authoritative when a config defines an alias of the same name.
      if (corpus[name] && corpus[name].k !== "alias") continue;
      mergeEntry(corpus, name, {
        c: 1,
        k: "alias",
        s: [source],
        a: "Requires the pinned mastercomfig configuration; not a built-in engine command",
      });
    }
  }
  // Observed forms are useful help, but do not establish exhaustive engine arity.
  corpus.exec.syntax = "exec <cfg path>";
  corpus.alias.syntax = "alias <name> [command …]";
  for (const name of ["exec", "alias"]) {
    corpus[name].s.push(3);
    corpus[name].a +=
      "; syntax observed in pinned mastercomfig, engine query/argument limits unverified";
  }
  if (!texts[5].includes("true, 20.0, true, MAX_FOV") || !/#define MAX_FOV\s+90/.test(texts[6]))
    throw new Error("Missing verified FOV range");
  corpus.fov_desired.value = { name: "value", type: "number", min: 20, max: 90 };
  corpus.fov_desired.s.push(5, 6);
  corpus.fov_desired.a += "; range from shared SDK source, not runtime introspection";
  for (const name of [
    "+forward",
    "-forward",
    "+attack",
    "-attack",
    "+back",
    "+moveleft",
    "+moveright",
    "+jump",
    "+duck",
    "+use",
    "+voicerecord",
    "load_itempreset",
    "voicemenu",
    "exec",
    "alias",
    "bind",
    "unbind",
    "toggle",
  ])
    if (!corpus[name]) throw new Error(`Missing required command ${name}`);
  return Object.fromEntries(
    Object.entries(corpus).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
export async function generate() {
  const texts = await Promise.all(
    SOURCES.map(async ({ url }) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Source fetch failed: ${res.status} ${url}`);
      return res.text();
    }),
  );
  const corpus = buildCorpus(texts);
  const header =
    "// Generated by tools/build-corpus.mjs. Pinned sources; do not edit.\n// Dump and alias metadata: Copyright mastercomfig contributors, MIT.\n// Valve SDK: independently described handler metadata only; no SDK implementation copied.\n";
  const source = `${header}export const sources = ${JSON.stringify(SOURCES)};\nexport default ${JSON.stringify(corpus)} as Record<string, { c: 0 | 1; d?: string; f?: string[]; h?: string; k?: "alias"; a: string; s: number[]; syntax?: string; arguments?: {name:string;type?:"integer"|"number"|"string"}[]; value?: {name:string;type:"number";min:number;max:number} }>;\n`;
  const here = dirname(fileURLToPath(import.meta.url));
  const bin = createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");
  const run = spawnSync(process.execPath, [bin, "format", "--stdin-file-path=cvars.gen.ts"], {
    cwd: here,
    input: source,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0 || !run.stdout) throw new Error(`Formatting failed: ${run.stderr}`);
  const out = join(here, "..", "src", "cvars.gen.ts");
  await mkdir(dirname(out), { recursive: true });
  await writeFile(`${out}.tmp`, run.stdout.replace(/\r\n/g, "\n"));
  await rename(`${out}.tmp`, out);
  console.log(`wrote ${Object.keys(corpus).length} catalog entries`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await generate();
