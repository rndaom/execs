import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import {
  assertLinuxNativeActiveCheckpoint,
  assertLinuxNativeActiveFixture,
  DISCARD_APPEND,
  expectedActiveText,
  seedLinuxNativeActiveFixture,
  sha256,
} from "./linux-native-active-fixture.mjs";
import { linuxSteamCandidates } from "./package-smoke-fixture.mjs";

function withFixture(callback) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "execs-linux-active-test-")));
  try {
    callback(seedLinuxNativeActiveFixture(parent), parent);
  } finally {
    // Only this freshly created, verified direct child is removed on Windows too.
    assert.equal(dirname(parent), realpathSync(tmpdir()));
    assert.ok(basename(parent).startsWith("execs-linux-active-test-"));
    assert.equal(realpathSync(parent), parent);
    rmSync(parent, { recursive: true, force: true });
  }
}

function editJson(path, change) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  change(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

// Models permitted product output in owned temporary files to test the validator.
// These writes are not native UI/IPC evidence and never invoke product code.
function modelSave(fixture, phase = "explicit-saved") {
  const text = expectedActiveText(fixture, phase);
  writeFileSync(join(fixture.library, fixture.profileId, "files", fixture.helperPath), text);
  writeFileSync(join(fixture.tf2Root, fixture.helperPath), text);
  editJson(join(fixture.library, fixture.profileId, "manifest.json"), (manifest) => {
    manifest.files.find((file) => file.path === fixture.helperPath).sha256 = sha256(text);
  });
  editJson(join(fixture.library, "index.json"), (index) => {
    index.profiles[0].updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  });
}

test("active seed has twelve exact protected files, distinct vanilla profiles and a long helper", () => {
  const originalHome = process.env.HOME;
  const originalXdg = process.env.XDG_DATA_HOME;
  withFixture((fixture, parent) => {
    assert.equal(dirname(fixture.scratch), parent);
    assert.notEqual(seedLinuxNativeActiveFixture(parent).scratch, fixture.scratch);
    assert.equal(fixture.metadata["index.json"].activeProfileId, fixture.profileId);
    assert.notEqual(fixture.profileId, fixture.otherProfileId);
    assert.notEqual(fixture.initialText, fixture.otherText);
    const longLine = fixture.initialText.split("\n")[fixture.selectionLine - 1];
    assert.ok(longLine.includes(fixture.selectionText) && longLine.length > 260);
    assert.ok(fixture.initialText.split("\n").length > 128);
    assert.ok(
      fixture.initialText
        .trimEnd()
        .split("\n")
        .every((line) => line.startsWith("// ")),
    );
    assert.equal(fixture.initialText.includes("\r"), false);
    const checkpoint = assertLinuxNativeActiveFixture(fixture, "original", "original");
    assert.equal(checkpoint.protectedFiles, 12);
    assert.equal(checkpoint.activeProfileId, fixture.profileId);
    assert.equal(checkpoint.profiles, 2);
    assert.equal(checkpoint.steamDirectoriesAbsent, true);
    assert.equal(
      assertLinuxNativeActiveCheckpoint(fixture, checkpoint, "idle").exactCheckpointPreserved,
      true,
    );
    assert.throws(() => seedLinuxNativeActiveFixture("relative"), /must be absolute/);
    assert.throws(
      () => expectedActiveText(fixture, "discarded-saved"),
      /Unknown active fixture phase/,
    );
  });
  assert.equal(process.env.HOME, originalHome);
  assert.equal(process.env.XDG_DATA_HOME, originalXdg);
});

test("only the explicit and close-save payload phases can change helper bytes and metadata", () => {
  withFixture((fixture) => {
    modelSave(fixture);
    const explicit = assertLinuxNativeActiveFixture(fixture, "explicit-saved", "explicit");
    assert.equal(explicit.helperSha256, sha256(expectedActiveText(fixture, "explicit-saved")));
    assert.throws(() => assertLinuxNativeActiveFixture(fixture, "original", "wrong-phase"));
    assertLinuxNativeActiveCheckpoint(fixture, explicit, "cancel-and-discard-preserved");
    modelSave(fixture, "close-saved");
    const closed = assertLinuxNativeActiveFixture(fixture, "close-saved", "close-save");
    assert.notEqual(explicit.helperSha256, closed.helperSha256);
    assertLinuxNativeActiveCheckpoint(fixture, closed, "reopened");
    assert.throws(() => assertLinuxNativeActiveCheckpoint(fixture, explicit, "stale-checkpoint"));
  });
});

test("checkpoint checks bytes as well as semantic metadata and cannot cross fixtures", () => {
  withFixture((fixture, parent) => {
    modelSave(fixture);
    const checkpoint = assertLinuxNativeActiveFixture(fixture, "explicit-saved", "saved");
    const indexPath = join(fixture.library, "index.json");
    writeFileSync(indexPath, `${readFileSync(indexPath, "utf8")}\n`);
    assertLinuxNativeActiveFixture(fixture, "explicit-saved", "same-values");
    assert.throws(
      () => assertLinuxNativeActiveCheckpoint(fixture, checkpoint, "no-op-retouched-index"),
      /product bytes changed since checkpoint/,
    );
    assert.throws(
      () =>
        assertLinuxNativeActiveCheckpoint(
          seedLinuxNativeActiveFixture(parent),
          checkpoint,
          "wrong-case",
        ),
      /another fixture/,
    );
  });
});

test("partial publication, arbitrary edits and Discard text cannot pass a saved phase", () => {
  for (const scope of ["live-only", "library-only", "discard", "arbitrary"]) {
    withFixture((fixture) => {
      if (scope === "live-only" || scope === "library-only") {
        const path =
          scope === "live-only"
            ? join(fixture.tf2Root, fixture.helperPath)
            : join(fixture.library, fixture.profileId, "files", fixture.helperPath);
        writeFileSync(path, expectedActiveText(fixture, "explicit-saved"));
      } else {
        modelSave(fixture);
        const text =
          expectedActiveText(fixture, "explicit-saved") +
          (scope === "discard" ? DISCARD_APPEND : "// unapproved\n");
        writeFileSync(join(fixture.tf2Root, fixture.helperPath), text);
      }
      assert.throws(() => assertLinuxNativeActiveFixture(fixture, "explicit-saved", scope));
    });
  }
});

test("live engine config, protected install files and the inactive control stay exact", () => {
  for (const target of [
    "config",
    "steam.inf",
    "default",
    "other-helper",
    "other-manifest",
    "settings",
  ]) {
    withFixture((fixture) => {
      modelSave(fixture);
      const paths = {
        config: join(fixture.tf2Root, fixture.configPath),
        "steam.inf": join(fixture.tf2Root, "tf/steam.inf"),
        default: join(fixture.tf2Root, "tf/cfg/config_default.cfg"),
        "other-helper": join(fixture.library, fixture.otherProfileId, "files", fixture.helperPath),
        "other-manifest": join(fixture.library, fixture.otherProfileId, "manifest.json"),
        settings: join(fixture.data, "settings.json"),
      };
      writeFileSync(paths[target], "unexpected\n");
      assert.throws(() => assertLinuxNativeActiveFixture(fixture, "explicit-saved", target));
    });
  }
});

test("metadata checks refuse activation changes, lost profiles and unrelated pending state", () => {
  const changes = [
    [
      "index",
      (value, fixture) => {
        value.activeProfileId = fixture.otherProfileId;
      },
    ],
    [
      "index",
      (value) => {
        value.profiles.pop();
      },
    ],
    [
      "index",
      (value) => {
        value.pendingSwitch = { targetProfileId: "unexpected" };
      },
    ],
    [
      "index",
      (value) => {
        value.profiles[1].updatedAt = value.profiles[0].updatedAt;
      },
    ],
    [
      "manifest",
      (value) => {
        value.cloudSyncPending = true;
      },
    ],
    [
      "manifest",
      (value) => {
        value.launchSyncPending = true;
      },
    ],
    [
      "manifest",
      (value) => {
        value.hudRoots = ["unexpected-hud"];
      },
    ],
    [
      "manifest",
      (value) => {
        value.preloader.addons.push("unexpected");
      },
    ],
    [
      "manifest",
      (value) => {
        value.unexpectedField = true;
      },
    ],
  ];
  for (const [target, change] of changes) {
    withFixture((fixture) => {
      modelSave(fixture);
      const path = target === "index" ? "index.json" : `${fixture.profileId}/manifest.json`;
      editJson(join(fixture.library, path), (value) => change(value, fixture));
      assert.throws(() => assertLinuxNativeActiveFixture(fixture, "explicit-saved", target));
    });
  }
});

test("updatedAt must be current native-format UTC, not a stale or future timestamp", () => {
  for (const value of [
    "invalid",
    "2020-01-01T00:00:00Z",
    "9999-01-01T00:00:00Z",
    new Date().toISOString(),
  ]) {
    withFixture((fixture) => {
      modelSave(fixture);
      editJson(join(fixture.library, "index.json"), (index) => {
        index.profiles[0].updatedAt = value;
      });
      assert.throws(
        () => assertLinuxNativeActiveFixture(fixture, "explicit-saved", "invalid-date"),
        /updatedAt/,
      );
    });
  }
});

test("only an exactly empty ordinary mutation container is permitted after Save", () => {
  withFixture((fixture) => {
    const path = join(fixture.library, fixture.profileId, ".mutation-data");
    mkdirSync(path);
    assert.throws(() =>
      assertLinuxNativeActiveFixture(fixture, "original", "unrequested-container"),
    );
    modelSave(fixture);
    const checkpoint = assertLinuxNativeActiveFixture(fixture, "explicit-saved", "empty-container");
    assert.equal(checkpoint.emptyMutationContainer, true);
    rmdirSync(path);
    assertLinuxNativeActiveCheckpoint(fixture, checkpoint, "swept-empty-container");
    mkdirSync(join(path, "unexpected-child"), { recursive: true });
    assert.throws(() =>
      assertLinuxNativeActiveFixture(fixture, "explicit-saved", "nonempty-container"),
    );
  });
  withFixture((fixture) => {
    modelSave(fixture);
    writeFileSync(join(fixture.library, fixture.profileId, ".mutation-data"), "not a directory");
    assert.throws(() =>
      assertLinuxNativeActiveFixture(fixture, "explicit-saved", "file-container"),
    );
  });
});

test("unknown product files, recovery journals and empty preloader directories are refused", () => {
  for (const path of [
    "profiles/.delete-journal.json",
    "profiles/index.json.execs-part",
    "unexpected.json",
    "preloader/originals/",
  ]) {
    withFixture((fixture) => {
      modelSave(fixture);
      if (path.endsWith("/")) mkdirSync(join(fixture.data, path), { recursive: true });
      else writeFileSync(join(fixture.data, path), "unexpected\n");
      assert.throws(() => assertLinuxNativeActiveFixture(fixture, "explicit-saved", path));
    });
  }
});

test("all eight Steam candidates are absent and any new candidate refuses validation", () => {
  withFixture((fixture) => assert.equal(linuxSteamCandidates(fixture.childEnv).length, 8));
  for (let index = 0; index < 8; index += 1) {
    withFixture((fixture) => {
      mkdirSync(linuxSteamCandidates(fixture.childEnv)[index], { recursive: true });
      assert.throws(
        () => assertLinuxNativeActiveFixture(fixture, "original", "steam-created"),
        /Steam directory/,
      );
    });
  }
});

test("linked fixture payloads and dangling Steam ancestors are refused without traversal", () => {
  withFixture((fixture, parent) => {
    const target = join(parent, "owned-link-target");
    mkdirSync(target);
    symlinkSync(
      target,
      join(fixture.library, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(
      () => assertLinuxNativeActiveFixture(fixture, "original", "linked"),
      /contains a link/,
    );
  });
  withFixture((fixture, parent) => {
    symlinkSync(
      join(parent, "absent-owned-target"),
      join(fixture.childEnv.HOME, ".steam"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(
      () => assertLinuxNativeActiveFixture(fixture, "original", "dangling-steam"),
      /Steam discovery path/,
    );
  });
});
