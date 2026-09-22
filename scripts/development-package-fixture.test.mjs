import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  assertDevelopmentPackageCheckpoint,
  assertDevelopmentPackageImported,
  assertDevelopmentPackagePreserved,
  assertDevelopmentPackageSwitched,
  developmentPackageEnvironment,
  inspectDevelopmentPackageExport,
  seedDevelopmentPackageFixture,
} from "./development-package-fixture.mjs";
import { linuxSteamCandidates, publicProfileFixture } from "./package-smoke-fixture.mjs";

const python =
  process.env.EXECS_TEST_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const importedId = "f20d0001-0000-4000-8000-000000000001";
const putJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

function withFixture(callback) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "execs-development-package-test-")));
  try {
    callback(seedDevelopmentPackageFixture(parent, "0.1.8"), parent);
  } finally {
    assert.equal(dirname(parent), realpathSync(tmpdir()));
    assert.ok(basename(parent).startsWith("execs-development-package-test-"));
    assert.equal(realpathSync(parent), parent);
    rmSync(parent, { recursive: true, force: true });
  }
}

function editJson(path, edit) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  edit(value);
  putJson(path, value);
}

// Data-only modeled ZIP, never attributed to a native exporter or product API.
function modelExport(fixture, edit = () => {}) {
  const entries = [
    {
      name: "execs-profile.json",
      base64: Buffer.from(`${JSON.stringify(fixture.portableManifest, null, 2)}\n`).toString(
        "base64",
      ),
    },
  ];
  for (const file of fixture.portableManifest.files)
    entries.push({
      name: file.storage === "shared" ? `blobs/${file.sha256}` : `files/${file.path}`,
      base64: publicProfileFixture.payloads[file.sha256],
    });
  edit(entries);
  const result = spawnSync(
    python,
    [
      "-I",
      "-c",
      `
import base64, json, stat, sys, zipfile
entries = json.load(sys.stdin)
with zipfile.ZipFile(sys.argv[1], "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for entry in entries:
        info = zipfile.ZipInfo(entry["name"])
        info.compress_type = zipfile.ZIP_DEFLATED
        if entry.get("symlink"):
            info.create_system = 3
            info.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(info, base64.b64decode(entry["base64"]))
`,
      fixture.exportPath,
    ],
    {
      input: JSON.stringify(entries),
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 128 * 1024,
      windowsHide: true,
    },
  );
  assert.equal(
    result.status,
    0,
    `Model ZIP setup failed: ${result.error?.message ?? result.stderr}`,
  );
}

function modelImported(fixture) {
  const portable = fixture.portableManifest;
  const manifest = {
    schema: 1,
    id: importedId,
    name: portable.name,
    tf2Root: fixture.tf2Root,
    launchOptions: portable.launchOptions,
    launchSyncPending: true,
    files: portable.files,
    hudRoots: [],
    mods: portable.mods,
    preloader: { addons: [], particleMods: [], profileParticleMods: [] },
  };
  const path = join(fixture.library, importedId);
  mkdirSync(path);
  putJson(join(path, "manifest.json"), manifest);
  for (const file of portable.files.filter((file) => file.storage === "exclusive")) {
    const destination = join(path, "files", file.path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, Buffer.from(publicProfileFixture.payloads[file.sha256], "base64"));
  }
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  editJson(join(fixture.library, "index.json"), (index) => {
    index.profiles.push({ id: importedId, name: portable.name, createdAt: now, updatedAt: now });
  });
  return manifest;
}

function modelSwitch(fixture) {
  editJson(join(fixture.library, "index.json"), (index) => {
    index.activeProfileId = importedId;
  });
}

function preparedImport(fixture) {
  modelExport(fixture);
  const proof = inspectDevelopmentPackageExport(fixture, { python });
  modelImported(fixture);
  return { proof, checkpoint: assertDevelopmentPackageImported(fixture, proof, "modeled-import") };
}

test("development fixture retains tagged payloads and adds a fully private Linux environment", () => {
  const home = process.env.HOME;
  withFixture((fixture, parent) => {
    assert.equal(fixture.root, fixture.scratch);
    assert.equal(dirname(fixture.scratch), parent);
    assert.equal(fixture.exportPath, join(fixture.scratch, "exports/previous-ui-export.zip"));
    assert.equal(fixture.activeProfileName, "Package smoke - active");
    assert.equal(
      fixture.expectedConfigText,
      "unbindall\nbind w +forward\nsensitivity 2.5\ncon_enable 1\n",
    );
    assert.equal(fixture.provenance.exporterRevision, "85aaf6bc0dd28f43351d4cb5cdb62502737688d5");
    assert.equal(fixture.settings.preferences.checkForUpdatesOnStartup, false);
    const checkpoint = assertDevelopmentPackagePreserved(fixture, "original");
    assert.equal(
      Object.keys(checkpoint.dataHashes).length + Object.keys(checkpoint.liveHashes).length,
      21,
    );
    assertDevelopmentPackageCheckpoint(fixture, checkpoint, "old-read-only");
    const env = developmentPackageEnvironment(fixture, {
      PATH: "/usr/bin",
      DISPLAY: ":99",
      HOME: "/unowned",
      GH_TOKEN: "secret",
      LD_PRELOAD: "unowned.so",
      WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: "1",
    });
    assert.equal(env.HOME, fixture.childEnv.HOME);
    assert.equal(env.TMPDIR, join(fixture.scratch, "tmp"));
    assert.equal(env.DISPLAY, ":99");
    for (const key of ["GH_TOKEN", "LD_PRELOAD", "WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS"])
      assert.equal(Object.hasOwn(env, key), false);
    assert.throws(() => seedDevelopmentPackageFixture("relative", "0.1.8"), /absolute/);
    assert.throws(() => seedDevelopmentPackageFixture(parent, "0.1.9"), /previous public/);
  });
  assert.equal(process.env.HOME, home);
});

test("export proof validates the exact portable metadata and all four bounded payloads", () => {
  withFixture((fixture) => {
    modelExport(fixture);
    const proof = inspectDevelopmentPackageExport(fixture, { python });
    assert.equal(proof.payloadsVerified, 4);
    assert.equal(proof.members.length, 5);
    assert.equal(proof.sha256, digest(readFileSync(fixture.exportPath)));
    assert.equal(Object.hasOwn(proof.manifest, "tf2Root"), false);
    assert.equal(Object.hasOwn(proof.manifest, "id"), false);
    assert.match(proof.provenance, /separately by the runner/);
    const checkpoint = assertDevelopmentPackagePreserved(fixture, "old-export-complete", proof);
    assertDevelopmentPackageCheckpoint(fixture, checkpoint, "candidate-installed-before-import");
    assert.throws(
      () => assertDevelopmentPackagePreserved(fixture, "unproved-export"),
      /Unexpected export/,
    );
  });
});

test("inspector reads the unchanged actual v0.1.8 exporter archive", () => {
  withFixture((fixture) => {
    const archive = new URL(
      "../docs/design/2026-09-22-overhaul/implementation/profile-management/compatibility-v018/no-hud/exported-by-v0.1.8.zip",
      import.meta.url,
    );
    const expectedHash = "3299cf62cb18da34785c309803ed2d8abad427eab9b95918ea72b1bf9259ac38";
    const source = publicProfileFixture.sources.find((entry) => entry.case === "no-hud");
    assert.equal(publicProfileFixture.exporterTag, "v0.1.8");
    assert.equal(publicProfileFixture.exporterRevision, "85aaf6bc0dd28f43351d4cb5cdb62502737688d5");
    assert.equal(source.archiveSha256, expectedHash);
    const bytes = readFileSync(archive);
    assert.equal(digest(bytes), expectedHash);
    writeFileSync(fixture.exportPath, bytes, { flag: "wx" });

    // The retained exporter run named its profile differently from the newly
    // authored package case. Only the expected name changes; ZIP bytes do not.
    const portableManifest = { ...fixture.portableManifest, name: source.manifest.name };
    assert.deepEqual(portableManifest, source.manifest);
    assert.throws(() => inspectDevelopmentPackageExport(fixture, { python }), /metadata differs/);
    const proof = inspectDevelopmentPackageExport({ ...fixture, portableManifest }, { python });
    assert.equal(proof.sha256, expectedHash);
    assert.equal(proof.payloadsVerified, 4);
    assert.equal(proof.members.length, 5);
    assert.ok(proof.members.some(({ name }) => name === "execs-profile.json"));
    assert.ok(proof.members.every(({ name }) => name !== "manifest.json"));
    assert.equal(digest(readFileSync(archive)), expectedHash);
    assert.equal(digest(readFileSync(fixture.exportPath)), expectedHash);
  });
});

test("modeled import remains inactive, switch selects its UUID, restart preserves every byte", () => {
  withFixture((fixture) => {
    const { checkpoint } = preparedImport(fixture);
    assert.equal(checkpoint.activeProfileId, fixture.activeProfileId);
    assert.equal(checkpoint.importedProfileId, importedId);
    assert.equal(checkpoint.importedProfileName, fixture.activeProfileName);
    assert.equal(checkpoint.manifest.launchSyncPending, true);
    assert.deepEqual(checkpoint.manifest.preloader, {
      addons: [],
      particleMods: [],
      profileParticleMods: [],
    });
    assertDevelopmentPackageCheckpoint(fixture, checkpoint, "import-done-still-inactive");
    modelSwitch(fixture);
    const switched = assertDevelopmentPackageSwitched(fixture, checkpoint, "native-switch-modeled");
    assert.equal(switched.activeProfileId, importedId);
    assertDevelopmentPackageCheckpoint(fixture, switched, "normal-restart-modeled");
    assert.throws(() =>
      assertDevelopmentPackageCheckpoint(fixture, checkpoint, "old-active-checkpoint"),
    );
  });
});

test("original profile metadata, settings, live bytes and shared blobs are never normalized away", () => {
  for (const target of ["manifest", "settings", "live", "shared"]) {
    withFixture((fixture) => {
      const { proof } = preparedImport(fixture);
      const shared = fixture.portableManifest.files.find((file) => file.storage === "shared");
      const paths = {
        manifest: join(fixture.library, fixture.activeProfileId, "manifest.json"),
        settings: join(fixture.data, "settings.json"),
        live: join(fixture.tf2Root, "tf/cfg/config.cfg"),
        shared: join(fixture.library, "blobs/sha256", shared.sha256.slice(0, 2), shared.sha256),
      };
      writeFileSync(paths[target], `${readFileSync(paths[target])}\n`);
      assert.throws(() => assertDevelopmentPackageImported(fixture, proof, target));
    });
  }
});

test("import rejects auto-activation, extra profiles and inherited HUD/preloader/cloud state", () => {
  for (const target of [
    "active",
    "extra",
    "hud",
    "preloader",
    "cloud",
    "launch",
    "options",
    "payload",
  ]) {
    withFixture((fixture) => {
      const { proof } = preparedImport(fixture);
      if (target === "active") modelSwitch(fixture);
      else if (target === "extra")
        editJson(join(fixture.library, "index.json"), (index) => {
          index.profiles.push(index.profiles[2]);
        });
      else if (target === "payload")
        writeFileSync(join(fixture.library, importedId, "files/tf/cfg/config.cfg"), "changed\n");
      else
        editJson(join(fixture.library, importedId, "manifest.json"), (manifest) => {
          if (target === "hud") manifest.hudRoots = ["fixturehud"];
          if (target === "preloader") manifest.preloader.addons = ["unexpected"];
          if (target === "cloud") manifest.cloudSyncPending = true;
          if (target === "launch") manifest.launchSyncPending = false;
          if (target === "options") manifest.launchOptions = "-autoconfig";
        });
      assert.throws(() => assertDevelopmentPackageImported(fixture, proof, target));
    });
  }
});

test("switch rejects changed library bytes and restart rejects even semantic-only metadata rewrites", () => {
  withFixture((fixture) => {
    const { checkpoint } = preparedImport(fixture);
    modelSwitch(fixture);
    const manifest = join(fixture.library, importedId, "manifest.json");
    writeFileSync(manifest, `${readFileSync(manifest, "utf8")}\n`);
    assert.throws(
      () => assertDevelopmentPackageSwitched(fixture, checkpoint, "retouched-manifest"),
      /rewrote/,
    );
  });
  withFixture((fixture) => {
    const { checkpoint } = preparedImport(fixture);
    modelSwitch(fixture);
    const switched = assertDevelopmentPackageSwitched(fixture, checkpoint, "switch");
    const index = join(fixture.library, "index.json");
    writeFileSync(index, `${readFileSync(index, "utf8")}\n`);
    assert.throws(
      () => assertDevelopmentPackageCheckpoint(fixture, switched, "retouched-restart"),
      /changed after checkpoint/,
    );
  });
});

test("empty incoming container is allowed only post-import; staged contents and journals fail", () => {
  withFixture((fixture) => {
    const incoming = join(fixture.library, "blobs/sha256/.incoming");
    mkdirSync(incoming);
    assert.throws(() => assertDevelopmentPackagePreserved(fixture, "early-incoming"));
  });
  for (const extra of [null, "file", "directory", "journal"]) {
    withFixture((fixture) => {
      const { proof } = preparedImport(fixture);
      const incoming = join(fixture.library, "blobs/sha256/.incoming");
      mkdirSync(incoming);
      if (extra === "file") writeFileSync(join(incoming, "leftover"), "staged");
      if (extra === "directory") mkdirSync(join(incoming, "leftover"));
      if (extra === "journal")
        writeFileSync(join(fixture.library, importedId, ".mutation-journal.json"), "{}");
      if (extra) assert.throws(() => assertDevelopmentPackageImported(fixture, proof, extra));
      else assertDevelopmentPackageImported(fixture, proof, "empty-incoming");
    });
  }
});

test("archive inspection refuses changed metadata/payload, traversal, duplicate and oversized members", () => {
  const mutations = [
    (entries) => {
      entries[0].base64 = Buffer.from('{"schema":1,"name":"changed"}').toString("base64");
    },
    (entries) => {
      entries[1].base64 = Buffer.from("altered config\n").toString("base64");
    },
    (entries) => {
      entries.push({ name: "../escape", base64: "eA==" });
    },
    (entries) => {
      entries.push(entries[1]);
    },
    (entries) => {
      entries[1].base64 = Buffer.alloc(1024 * 1024 + 1).toString("base64");
    },
    (entries) => {
      entries[1].symlink = true;
    },
  ];
  for (const mutate of mutations)
    withFixture((fixture) => {
      modelExport(fixture, mutate);
      assert.throws(() => inspectDevelopmentPackageExport(fixture, { python }));
    });
});

test("archive replacement, alternate Save destination and proof from another case are refused", () => {
  withFixture((fixture, parent) => {
    modelExport(fixture);
    const proof = inspectDevelopmentPackageExport(fixture, { python });
    writeFileSync(join(fixture.exports, "default-name.zip"), readFileSync(fixture.exportPath));
    assert.throws(() => assertDevelopmentPackagePreserved(fixture, "unexpected-extra-zip", proof));
    rmSync(join(fixture.exports, "default-name.zip"));
    writeFileSync(
      fixture.exportPath,
      Buffer.concat([readFileSync(fixture.exportPath), Buffer.from("extra")]),
    );
    assert.throws(() => assertDevelopmentPackagePreserved(fixture, "changed-export", proof));
    const other = seedDevelopmentPackageFixture(parent, "0.1.8");
    assert.throws(
      () => assertDevelopmentPackagePreserved(other, "foreign-proof", proof),
      /another case/,
    );
  });
});

test("all Steam candidates, dangling discovery ancestors and linked library paths are refused", () => {
  for (let index = 0; index < 8; index += 1)
    withFixture((fixture) => {
      mkdirSync(linuxSteamCandidates(fixture.childEnv)[index], { recursive: true });
      assert.throws(() => assertDevelopmentPackagePreserved(fixture, "steam"), /Steam directory/);
    });
  withFixture((fixture, parent) => {
    symlinkSync(
      join(parent, "absent-owned-target"),
      join(fixture.childEnv.HOME, ".steam"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(
      () => assertDevelopmentPackagePreserved(fixture, "dangling-steam"),
      /Steam discovery/,
    );
  });
  withFixture((fixture, parent) => {
    const target = join(parent, "owned-link-target");
    mkdirSync(target);
    symlinkSync(
      target,
      join(fixture.library, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    assert.throws(
      () => assertDevelopmentPackagePreserved(fixture, "linked-library"),
      /Linked fixture path/,
    );
  });
});
