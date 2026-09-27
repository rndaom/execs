import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import {
  assertNoSteamDirectories,
  assertPackageFixturePreserved,
  createSmokeScratch,
  linuxSteamCandidates,
  publicProfileFixture,
  seedPackageFixture,
} from "./package-smoke-fixture.mjs";

function withFixture(callback, windows = process.platform === "win32") {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "execs-package-fixture-test-")));
  try {
    const scratch = createSmokeScratch(parent);
    const fixture = seedPackageFixture(scratch, windows, "0.1.8");
    callback(fixture, scratch, parent);
  } finally {
    // Verify the exact disposable target before recursive removal on Windows.
    assert.equal(dirname(parent), realpathSync(tmpdir()));
    assert.ok(basename(parent).startsWith("execs-package-fixture-test-"));
    rmSync(parent, { recursive: true, force: true });
  }
}

const activeId = "f20a0001-8d01-4000-8000-000000000001";
const savedId = "f20a0001-8d01-4000-8000-000000000002";
function editJson(path, change) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  change(value);
  writeFileSync(path, JSON.stringify(value));
}

test("package fixture retains tagged v0.1.8 cfg and valid Source VPK bytes with provenance", () => {
  assert.equal(publicProfileFixture.exporterRevision, "85aaf6bc0dd28f43351d4cb5cdb62502737688d5");
  assert.deepEqual(
    publicProfileFixture.sources.map((source) => source.archiveSha256),
    [
      "3299cf62cb18da34785c309803ed2d8abad427eab9b95918ea72b1bf9259ac38",
      "4b46fb3144b5c9fcd334505672fc8513fa3f9d629f821fbb4ab53b9da4667ec9",
    ],
  );
  const bytes = (hash) => Buffer.from(publicProfileFixture.payloads[hash], "base64");
  assert.equal(
    bytes("53c7675e94164580863502aa86b63fa40f97c3311e2b8865a1c8eeaa9352ee42").toString(),
    "unbindall\nbind w +forward\nsensitivity 2.5\ncon_enable 1\n",
  );
  for (const [hash, base64] of Object.entries(publicProfileFixture.payloads)) {
    assert.equal(createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex"), hash);
  }
  for (const hash of [
    "351bc47c2d89705e0ef6b4bdef6c568722d8abd3230c97d3ef636698b461f145",
    "ec5533edf34c665da9ff4be240472c1e0eb30532f15d55f304037a9173a74fb7",
  ]) {
    assert.equal(bytes(hash).readUInt32LE(0), 0x55aa1234);
    assert.equal(bytes(hash).readUInt32LE(4), 2);
  }
  withFixture((fixture) => {
    assert.equal(
      JSON.parse(readFileSync(join(fixture.library, `${savedId}/manifest.json`))).hud.options
        .compact,
      "1",
    );
    const report = assertPackageFixturePreserved(fixture, "untouched");
    assert.equal(report.profiles, 2);
    assert.equal(report.manifestPayloadReferences, 12);
    assert.equal(report.storedPayloads, 11);
  });
});

test("package fixture covers Windows and Linux data roots without inheriting host settings", () => {
  for (const windows of [true, false]) {
    withFixture((fixture, scratch) => {
      assert.equal(fixture.data, join(scratch, windows ? "roaming" : "data", "execs"));
      assert.equal(fixture.settings.tf2Root, join(scratch, "fixture-tf2"));
      assertPackageFixturePreserved(fixture, windows ? "windows-layout" : "linux-layout");
    }, windows);
  }
});

test("package fixture refuses scratch reuse and a stale previous-public baseline", () => {
  withFixture((_fixture, scratch, parent) => {
    assert.throws(() => createSmokeScratch(parent), /EEXIST/);
    assert.throws(() => createSmokeScratch("relative-runner"), /must be absolute/);
    assert.throws(() => seedPackageFixture(scratch, true, "0.1.9"), /immediately previous public/);
  });
});

test("preservation fails on independent corruption of active, inactive, and shared payloads", () => {
  const targets = [
    `${activeId}/files/tf/cfg/config.cfg`,
    `${savedId}/files/tf/custom/fixturehud/resource/ui/layout.res`,
    "blobs/sha256/ec/ec5533edf34c665da9ff4be240472c1e0eb30532f15d55f304037a9173a74fb7",
  ];
  for (const path of targets) {
    withFixture((fixture) => {
      writeFileSync(join(fixture.library, path), "unexpected replacement\n");
      assert.throws(() => assertPackageFixturePreserved(fixture, "corrupt"), /payload changed/);
    });
  }
});

test("preservation fails on deletion, new files, and unfinished recovery journals", () => {
  for (const action of [
    (fixture) => rmSync(join(fixture.library, `${savedId}/files/tf/custom/fixturehud/info.vdf`)),
    (fixture) => writeFileSync(join(fixture.library, `${activeId}/files/new.cfg`), "new bytes"),
    (fixture) => writeFileSync(join(fixture.library, "pending-switch.json"), "{}"),
  ]) {
    withFixture((fixture) => {
      action(fixture);
      assert.throws(
        () => assertPackageFixturePreserved(fixture, "changed-tree"),
        /added or removed/,
      );
    });
  }
});

test("preservation fails on lost active identity, deleted profiles, launch options or HUD options", () => {
  for (const [path, change] of [
    [
      "index.json",
      (value) => {
        value.activeProfileId = savedId;
      },
    ],
    [
      "index.json",
      (value) => {
        value.profiles.pop();
      },
    ],
    [
      "index.json",
      (value) => {
        value.pendingSwitch = { targetProfileId: savedId };
      },
    ],
    [
      `${activeId}/manifest.json`,
      (value) => {
        value.launchOptions = "-autoconfig";
      },
    ],
    [
      `${savedId}/manifest.json`,
      (value) => {
        value.hud.options.compact = "0";
      },
    ],
    [
      `${activeId}/manifest.json`,
      (value) => {
        value.mods = [];
      },
    ],
  ]) {
    withFixture((fixture) => {
      editJson(join(fixture.library, path), change);
      assert.throws(() => assertPackageFixturePreserved(fixture, "changed-record"));
    });
  }
});

test("preservation tolerates only documented additive defaults and harmless JSON formatting", () => {
  withFixture((fixture) => {
    editJson(join(fixture.data, "settings.json"), (value) => {
      value.preferences = { checkForUpdatesOnStartup: true, motion: "system" };
    });
    editJson(join(fixture.library, "index.json"), (value) => {
      value.pendingSwitch = null;
      value.profiles[0].unsafeCustomFolders = [];
    });
    editJson(join(fixture.library, `${savedId}/manifest.json`), (value) => {
      value.launchSyncPending = true;
      value.preloader = { addons: [], particleMods: [], profileParticleMods: [] };
      value.hudRoots = ["fixturehud"];
      value.hudSelectedRoot = "fixturehud";
      value.hudReviewPending = false;
    });
    const result = assertPackageFixturePreserved(fixture, "expected-metadata");
    assert.equal(result.allowedAdditiveMetadataObserved.length, 8);
  });
});

test("preservation does not accept new preloader selections, arbitrary metadata or false sync success", () => {
  for (const change of [
    (value) => {
      value.preloader = { addons: ["unrequested"], particleMods: [], profileParticleMods: [] };
    },
    (value) => {
      value.launchSyncPending = false;
    },
    (value) => {
      value.hudReviewPending = true;
    },
    (value) => {
      value.unreviewedMigration = "not automatically trusted";
    },
  ]) {
    withFixture((fixture) => {
      editJson(join(fixture.library, `${activeId}/manifest.json`), change);
      assert.throws(() => assertPackageFixturePreserved(fixture, "unsafe-metadata"));
    });
  }
});

test("preservation rejects changed confirmed root and changes to the synthetic live install", () => {
  for (const action of [
    (fixture) =>
      editJson(join(fixture.data, "settings.json"), (value) => {
        value.tf2Root = "another install";
      }),
    (fixture) =>
      writeFileSync(join(fixture.tf2Root, "tf/cfg/config.cfg"), "overwritten bind table\n"),
    (fixture) => writeFileSync(join(fixture.tf2Root, "tf/custom/extra.vpk"), "unrequested payload"),
  ]) {
    withFixture((fixture) => {
      action(fixture);
      assert.throws(() => assertPackageFixturePreserved(fixture, "wrong-root-or-live-data"));
    });
  }
});

test("preservation refuses linked library directories rather than following them", () => {
  withFixture((fixture, scratch) => {
    const target = join(scratch, "linked-payload");
    mkdirSync(target);
    symlinkSync(
      target,
      join(fixture.library, "unexpected-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(() => assertPackageFixturePreserved(fixture, "linked-tree"), /contains a link/);
  });
});

test("Steam isolation guards cover native, Flatpak, Snap and XDG discovery paths", () => {
  withFixture((_fixture, scratch) => {
    const env = { HOME: join(scratch, "account-home"), XDG_DATA_HOME: join(scratch, "steam-xdg") };
    const candidates = linuxSteamCandidates(env);
    assert.equal(candidates.length, 8);
    assert.ok(candidates.includes(join(env.HOME, ".var/app/com.valvesoftware.Steam/data/Steam")));
    assert.ok(candidates.includes(join(env.HOME, "snap/steam/common/.local/share/Steam")));
    assertNoSteamDirectories(candidates);
    mkdirSync(candidates[0], { recursive: true });
    assert.throws(() => assertNoSteamDirectories(candidates), /discoverable Steam directory/);
    assert.throws(() => assertNoSteamDirectories(["relative-steam"]), /relative path/);
  });
});
