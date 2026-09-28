import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { pinIsBehind, pinnedCommit } from "./pinned-sources.mjs";

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
