import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  isSchemaFileName,
  pinIsBehind,
  pinnedCommit,
  SCHEMA_INDEX_FILE,
  schemaFolderReport,
  schemaHuds,
  schemaIndex,
  schemaIndexText,
  sharedHuds,
  stripJsonComments,
} from "./pinned-sources.mjs";

test("reads both pinned commits from the fetch modules", () => {
  for (const [file, constant] of [
    ["../apps/desktop/src-tauri/src/hitsound_fetch.rs", "COMFIG_INDEX_COMMIT"],
    ["../apps/desktop/src-tauri/src/hud_fetch.rs", "SCHEMA_COMMIT"],
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(pinnedCommit(source, constant), /^[0-9a-f]{40}$/);
  }
  assert.throws(() => pinnedCommit('const SCHEMA_COMMIT: &str = "main";', "SCHEMA_COMMIT"));
});

test("the comfig index URL uses the same commit as its constant", () => {
  const source = readFileSync(
    new URL("../apps/desktop/src-tauri/src/hitsound_fetch.rs", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes(`comfig-app/${pinnedCommit(source, "COMFIG_INDEX_COMMIT")}/`));
});

test("a pin is behind only when the path changed after it", () => {
  assert.equal(pinIsBehind("ahead"), true);
  assert.equal(pinIsBehind("diverged"), true);
  assert.equal(pinIsBehind("identical"), false);
  assert.equal(pinIsBehind("behind"), false);
});

test("a schema folder listing names the HUDs, not the shared files or folders", () => {
  const listing = [
    { name: "Schema", type: "dir" },
    { name: "rayshud.json", type: "file" },
    { name: "middle-mann.json", type: "file" },
    { name: "common.json", type: "file" },
    { name: "shared-hud.json", type: "file" },
    { name: "notes.md", type: "file" },
  ];
  assert.deepEqual(schemaHuds(listing), ["middle-mann", "rayshud"]);
  assert.deepEqual(sharedHuds('[{"Name":"7HUD"},{"Name":"ahud-cc"},{"Author":"x"}]'), [
    "7HUD",
    "ahud-cc",
  ]);
  assert.deepEqual(sharedHuds("not json"), []);
});

test("the report names every HUD a pin bump would add or drop", () => {
  const pinned = { huds: ["budhud", "rayshud", "zeeshud"], shared: ["7HUD", "omphud"] };
  assert.deepEqual(
    schemaFolderReport(pinned, {
      huds: ["budhud", "newhud", "otherhud", "rayshud"],
      shared: ["7HUD", "PeachHUD"],
    }),
    [
      "New HUD schemas upstream: newhud, otherhud",
      "HUD schemas removed upstream: zeeshud",
      "HUDs added to the shared options list: PeachHUD",
      "HUDs removed from the shared options list: omphud",
    ],
  );
  assert.deepEqual(schemaFolderReport(pinned, pinned), [
    "The same HUDs have schemas; only their contents changed.",
  ]);
});

test("the built-in schema index was generated for the pinned commit", () => {
  // `node scripts/pinned-sources.mjs --write-index` regenerates it, and a
  // plain run compares it with the folder upstream.
  const fetch = readFileSync(
    new URL("../apps/desktop/src-tauri/src/hud_fetch.rs", import.meta.url),
    "utf8",
  );
  const text = readFileSync(new URL(`../${SCHEMA_INDEX_FILE}`, import.meta.url), "utf8");
  const index = JSON.parse(text);
  assert.equal(index.commit, pinnedCommit(fetch, "SCHEMA_COMMIT"));
  assert.equal(schemaIndexText(index), text);
  assert.ok(index.schemas.length > 0);
  for (const schema of index.schemas) assert.ok(isSchemaFileName(schema.file), schema.file);
});

test("the schema index records what each file in the folder says", () => {
  const index = schemaIndex("abc", {
    "newhud.json": `{ // a comment with a "quote
      "Links": {"GitHub": "https://github.com/someone/NewHUD"}, /* block */ "Controls": {}}`,
    "named.json": '{"Name":"Named // HUD","Controls":{}}',
    "common.json": '[{"Name":"Plain Hud","Links":{"GitHub":"https://github.com/other/plain"}},{}]',
    "shared-hud.json": '{"Controls":{}}',
    "not-a-schema.json": "[1, 2",
    "list.json": "[1, 2]",
    "../escape.json": "{}",
    "README.md": "{}",
  });
  assert.deepEqual(index, {
    commit: "abc",
    schemas: [
      { file: "named.json", name: "Named // HUD", github: null },
      { file: "newhud.json", name: null, github: "https://github.com/someone/NewHUD" },
    ],
    shared: [{ name: "Plain Hud", github: "https://github.com/other/plain" }],
  });
  // Without the shared schema the list offers nothing.
  assert.deepEqual(schemaIndex("abc", { "common.json": '[{"Name":"Plain Hud"}]' }).shared, []);
  assert.equal(stripJsonComments('{"a":"\\\\"} // x'), '{"a":"\\\\"} ');
});
