import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import {
  ACTIVITY_LOG,
  acceptWindowPlacement,
  assertActivityLog,
  assertTidyMarker,
  setAsideAppMaintenance,
  settingsDifferOnlyByWindow,
  TIDY_MARKER,
} from "./app-maintenance-fixture.mjs";

const LOG = "2026-09-28T13:40:22Z tidy: Tidy-up: 0 sound caches removed\n";
const MARKER = '{"version":1,"incompleteRuns":0}';

function withData(callback) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "execs-app-maintenance-test-")));
  try {
    callback(root);
  } finally {
    assert.equal(dirname(root), realpathSync(tmpdir()));
    assert.ok(basename(root).startsWith("execs-app-maintenance-test-"));
    rmSync(root, { recursive: true, force: true });
  }
}

function put(root, path, text) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

test("the activity log and tidy-up record are set aside with their new folders", () => {
  withData((root) => {
    put(root, ACTIVITY_LOG, LOG);
    put(root, TIDY_MARKER, MARKER);
    const observed = {
      files: { [ACTIVITY_LOG]: "a", [TIDY_MARKER]: "b", "profiles/index.json": "c" },
      directories: ["logs", "maintenance", "profiles"],
    };
    assert.deepEqual(setAsideAppMaintenance(root, observed, ["profiles"], "boot"), [
      ACTIVITY_LOG,
      TIDY_MARKER,
    ]);
    assert.deepEqual(observed, {
      files: { "profiles/index.json": "c" },
      directories: ["profiles"],
    });
  });
});

test("other files keep their folders compared, and baseline folders stay", () => {
  withData((root) => {
    put(root, ACTIVITY_LOG, LOG);
    const observed = {
      files: { [ACTIVITY_LOG]: "a", "logs/panic.log": "p" },
      directories: ["logs", "maintenance"],
    };
    setAsideAppMaintenance(root, observed, ["maintenance"], "boot");
    assert.deepEqual(observed, {
      files: { "logs/panic.log": "p" },
      directories: ["logs", "maintenance"],
    });
  });
});

test("malformed diagnostics and tidy-up records are refused", () => {
  withData((root) => {
    for (const text of ["", "no timestamp\n", `${LOG}second line without newline`]) {
      put(root, ACTIVITY_LOG, text);
      assert.throws(() => assertActivityLog(join(root, ACTIVITY_LOG), "bad"), /activity log/);
    }
    put(root, ACTIVITY_LOG, `2026-09-28T13:40:22Z ${"k".repeat(33)}: too long a kind\n`);
    assert.throws(() => assertActivityLog(join(root, ACTIVITY_LOG), "bad"), /activity log/);
    for (const text of [
      "{}",
      '{"version":0,"incompleteRuns":0}',
      '{"version":1,"incompleteRuns":4}',
      '{"version":1,"incompleteRuns":0,"extra":true}',
    ]) {
      put(root, TIDY_MARKER, text);
      assert.throws(() => assertTidyMarker(join(root, TIDY_MARKER), "bad"), /tidy-up record/);
    }
    mkdirSync(join(root, "maintenance", "nested"), { recursive: true });
    assert.throws(() => assertTidyMarker(join(root, "maintenance", "nested"), "bad"));
  });
});

test("settings may gain only a valid saved window placement", () => {
  withData((root) => {
    const baseline = { schema: 1, tf2Root: "/tf2", preferences: { motion: "system" } };
    const window = { x: 10, y: -20, width: 1200, height: 800, maximized: false };
    const path = join(root, "settings.json");
    put(root, "settings.json", JSON.stringify(baseline));
    assert.equal(settingsDifferOnlyByWindow(path, baseline, "same"), false);
    put(root, "settings.json", JSON.stringify({ ...baseline, window }));
    assert.equal(settingsDifferOnlyByWindow(path, baseline, "placed"), true);
    const observed = { files: { "settings.json": "changed" }, directories: [] };
    assert.equal(acceptWindowPlacement(root, observed, baseline, "base", "placed"), true);
    assert.equal(observed.files["settings.json"], "base");
    put(root, "settings.json", JSON.stringify({ ...baseline, window, preferences: {} }));
    assert.throws(() => settingsDifferOnlyByWindow(path, baseline, "other"), /beyond the window/);
    for (const bad of [
      { ...window, width: 0 },
      { ...window, extra: 1 },
      { ...window, x: 1.5 },
    ]) {
      put(root, "settings.json", JSON.stringify({ ...baseline, window: bad }));
      assert.throws(() => settingsDifferOnlyByWindow(path, baseline, "bad"), /window placement/);
    }
  });
});
