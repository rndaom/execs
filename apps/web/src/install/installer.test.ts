import { beforeEach, describe, expect, it } from "vitest";
import {
  detectConflicts,
  installVersion,
  MANIFEST_DIR,
  MANIFEST_NAME,
  readManifest,
  uninstallConfig,
} from "./installer";
import type { DirHandle, FileHandleLike, VersionManifest, WritableLike } from "./types";

// ---- in-memory fake of the File System Access API ---------------------------

class FakeDir implements DirHandle {
  dirs = new Map<string, FakeDir>();
  files = new Map<string, Uint8Array>();

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<DirHandle> {
    let dir = this.dirs.get(name);
    if (!dir) {
      if (!opts?.create) throw new DOMException("not found", "NotFoundError");
      dir = new FakeDir();
      this.dirs.set(name, dir);
    }
    return dir;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike> {
    if (!this.files.has(name)) {
      if (!opts?.create) throw new DOMException("not found", "NotFoundError");
      this.files.set(name, new Uint8Array());
    }
    const files = this.files;
    return {
      async getFile() {
        const bytes = files.get(name) ?? new Uint8Array();
        return {
          arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
          text: async () => new TextDecoder().decode(bytes),
        };
      },
      async createWritable(): Promise<WritableLike> {
        let buffer = new Uint8Array();
        return {
          async write(data) {
            buffer =
              typeof data === "string"
                ? new TextEncoder().encode(data)
                : new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer);
          },
          async close() {
            files.set(name, buffer);
          },
        };
      },
    };
  }

  async removeEntry(name: string): Promise<void> {
    if (this.files.delete(name) || this.dirs.delete(name)) return;
    throw new DOMException("not found", "NotFoundError");
  }

  /** test helper */
  readText(path: string): string | null {
    const parts = path.split("/");
    let dir: FakeDir = this;
    for (const part of parts.slice(0, -1)) {
      const next = dir.dirs.get(part);
      if (!next) return null;
      dir = next;
    }
    const bytes = dir.files.get(parts[parts.length - 1]);
    return bytes ? new TextDecoder().decode(bytes) : null;
  }

  writeText(path: string, text: string): void {
    const parts = path.split("/");
    let dir: FakeDir = this;
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part);
      if (!next) {
        next = new FakeDir();
        dir.dirs.set(part, next);
      }
      dir = next;
    }
    dir.files.set(parts[parts.length - 1], new TextEncoder().encode(text));
  }
}

async function sha(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const PAYLOADS: Record<string, string> = {
  "files/c1/v1/aaa": "fov_desired 90",
  "files/c1/v1/bbb": "bind f1 join_class_scout",
  "files/c1/v2/ccc": "fov_desired 100",
  "files/c2/v1/ddd": "cl_interp 0.033",
};
const fetchFile = async (key: string) =>
  new TextEncoder().encode(PAYLOADS[key]).buffer as ArrayBuffer;

async function makeVersion(
  configId: string,
  versionId: string,
  files: Array<[string, string]>,
): Promise<VersionManifest> {
  return {
    configId,
    versionId,
    name: `Config ${configId}`,
    versionLabel: "1.0",
    files: await Promise.all(
      files.map(async ([installPath, r2Key]) => ({
        installPath,
        r2Key,
        sha256: await sha(PAYLOADS[r2Key]),
      })),
    ),
  };
}

describe("installer", () => {
  let root: FakeDir;
  let v1: VersionManifest;

  beforeEach(async () => {
    root = new FakeDir();
    v1 = await makeVersion("c1", "v1", [
      ["tf/cfg/overrides/autoexec.cfg", "files/c1/v1/aaa"],
      ["tf/custom/execs-custom/cfg/binds.cfg", "files/c1/v1/bbb"],
    ]);
  });

  it("installs files and writes the manifest", async () => {
    await installVersion(root, v1, fetchFile);
    expect(root.readText("tf/cfg/overrides/autoexec.cfg")).toBe("fov_desired 90");
    expect(root.readText("tf/custom/execs-custom/cfg/binds.cfg")).toBe("bind f1 join_class_scout");
    const manifest = await readManifest(root);
    expect(manifest.installed).toHaveLength(1);
    expect(manifest.installed[0].files).toHaveLength(2);
  });

  it("reinstalling is idempotent", async () => {
    await installVersion(root, v1, fetchFile);
    await installVersion(root, v1, fetchFile);
    const manifest = await readManifest(root);
    expect(manifest.installed).toHaveLength(1);
    expect(root.readText("tf/cfg/overrides/autoexec.cfg")).toBe("fov_desired 90");
  });

  it("upgrading removes files the new version no longer ships", async () => {
    await installVersion(root, v1, fetchFile);
    const v2 = await makeVersion("c1", "v2", [
      ["tf/cfg/overrides/autoexec.cfg", "files/c1/v2/ccc"],
    ]);
    await installVersion(root, v2, fetchFile);
    expect(root.readText("tf/cfg/overrides/autoexec.cfg")).toBe("fov_desired 100");
    expect(root.readText("tf/custom/execs-custom/cfg/binds.cfg")).toBeNull();
    const manifest = await readManifest(root);
    expect(manifest.installed[0].versionId).toBe("v2");
  });

  it("detects conflicts with another installed config", async () => {
    await installVersion(root, v1, fetchFile);
    const other = await makeVersion("c2", "v1", [
      ["tf/cfg/overrides/autoexec.cfg", "files/c2/v1/ddd"],
    ]);
    const conflicts = await detectConflicts(root, other);
    expect(conflicts).toEqual([
      { path: "tf/cfg/overrides/autoexec.cfg", ownedBy: "Config c1" },
    ]);
  });

  it("flags pre-existing user files as user-owned conflicts", async () => {
    root.writeText("tf/cfg/overrides/autoexec.cfg", "// my precious settings");
    const conflicts = await detectConflicts(root, v1);
    expect(conflicts).toEqual([{ path: "tf/cfg/overrides/autoexec.cfg", ownedBy: null }]);
  });

  it("reports no conflicts when reinstalling the same config", async () => {
    await installVersion(root, v1, fetchFile);
    expect(await detectConflicts(root, v1)).toEqual([]);
  });

  it("uninstalls exactly the manifest-listed files", async () => {
    await installVersion(root, v1, fetchFile);
    root.writeText("tf/cfg/overrides/scout.cfg", "// user file, not ours");
    const result = await uninstallConfig(root, "c1");
    expect(result.removed.sort()).toEqual([
      "tf/cfg/overrides/autoexec.cfg",
      "tf/custom/execs-custom/cfg/binds.cfg",
    ]);
    expect(root.readText("tf/cfg/overrides/scout.cfg")).toBe("// user file, not ours");
    expect((await readManifest(root)).installed).toEqual([]);
  });

  it("keeps files the user modified after install", async () => {
    await installVersion(root, v1, fetchFile);
    root.writeText("tf/cfg/overrides/autoexec.cfg", "fov_desired 90 // tweaked!");
    const result = await uninstallConfig(root, "c1");
    expect(result.keptModified).toEqual(["tf/cfg/overrides/autoexec.cfg"]);
    expect(root.readText("tf/cfg/overrides/autoexec.cfg")).toBe("fov_desired 90 // tweaked!");
  });

  it("recovers from a corrupted manifest", async () => {
    root.writeText(`${MANIFEST_DIR}/${MANIFEST_NAME}`, "{not json![");
    const manifest = await readManifest(root);
    expect(manifest).toEqual({ schema: 1, installed: [] });
    await installVersion(root, v1, fetchFile);
    expect((await readManifest(root)).installed).toHaveLength(1);
  });
});
