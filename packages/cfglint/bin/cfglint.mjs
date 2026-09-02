#!/usr/bin/env node
// CLI harness: node bin/cfglint.mjs [--self] [--flat] <file-or-dir> [...more]
// Prints a lint report for local cfg files. Dev tool only.
//
// This file imports ../src/index.ts directly, so it needs Node's type
// stripping — that, and nothing else, is why the package pins
// `engines.node` to >= 22.6.
//
//   --self  lint as the player's own config (hostile-config rules advise
//           instead of blocking)
//   --flat  also resolve `exec <target>` against a bundle path equal to
//           <target>; for loose directories with no cfg/ folder
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { lint } from "../src/index.ts";

const argv = process.argv.slice(2);
const opts = {
  trust: argv.includes("--self") ? "self" : "provided",
  bundleRelativeExec: argv.includes("--flat"),
};
const args = argv.filter((a) => !a.startsWith("--"));
if (args.length === 0) {
  console.error("usage: cfglint [--self] [--flat] <file-or-dir> [...]");
  process.exit(2);
}

async function collect(root) {
  const st = await stat(root);
  if (st.isFile()) return [{ base: resolve(root, ".."), abs: resolve(root) }];
  const out = [];
  for (const entry of await readdir(root, { recursive: true })) {
    if (entry.toLowerCase().endsWith(".cfg"))
      out.push({ base: resolve(root), abs: join(resolve(root), entry) });
  }
  return out;
}

const files = [];
for (const arg of args) {
  for (const { base, abs } of await collect(arg)) {
    files.push({
      path: relative(base, abs).replaceAll("\\", "/"),
      text: await readFile(abs, "utf8"),
    });
  }
}

const result = lint(files, opts);
const icons = { block: "✖", warn: "▲", info: "·" };
for (const f of result.findings) {
  const via = f.via ? ` (via ${f.via})` : "";
  console.log(`${icons[f.tier]} [${f.tier}] ${f.file}:${f.line} ${f.message}${via} (${f.ruleId})`);
}
console.log(
  `\n${files.length} file(s), ${result.findings.length} finding(s) — ${result.ok ? "OK" : "BLOCKED"}`,
);
if (result.classesTouched.length) console.log(`classes: ${result.classesTouched.join(", ")}`);
if (Object.keys(result.moduleLevels).length)
  console.log(`modules: ${JSON.stringify(result.moduleLevels)}`);
for (const section of result.summary) {
  console.log(`\n${section.label}:`);
  for (const e of section.entries.slice(0, 12)) {
    console.log(
      `  ${e.cvar} = ${e.value}${e.defaultValue !== undefined ? ` (default ${e.defaultValue})` : ""}`,
    );
  }
}
process.exit(result.ok ? 0 : 1);
