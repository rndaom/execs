import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  buildBundleZip,
  defaultInstallPath,
  expandUpload,
  MAX_FILES,
  sanitizeEntryName,
  slugify,
  UploadError,
} from "./upload";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("sanitizeEntryName", () => {
  it("accepts normal relative paths", () => {
    expect(sanitizeEntryName("cfg/autoexec.cfg")).toBe("cfg/autoexec.cfg");
    expect(sanitizeEntryName("./binds.cfg")).toBe("binds.cfg");
  });

  it.each(["../evil.cfg", "a/../../evil.cfg", "/abs.cfg", "C:/win.cfg", "a\\b.cfg", "a//b.cfg"])(
    "rejects %s",
    (name) => {
      expect(() => sanitizeEntryName(name)).toThrow(UploadError);
    },
  );
});

describe("expandUpload", () => {
  it("passes loose cfg files through", () => {
    const out = expandUpload([{ name: "autoexec.cfg", bytes: bytes("fov_desired 90") }]);
    expect(out).toHaveLength(1);
  });

  it("expands a zip and rejects nested zips", () => {
    const zip = zipSync({ "autoexec.cfg": bytes("fov_desired 90"), "sub/binds.cfg": bytes("x 1") });
    const out = expandUpload([{ name: "bundle.zip", bytes: zip }]);
    expect(out.map((f) => f.name).sort()).toEqual(["autoexec.cfg", "sub/binds.cfg"]);

    const nested = zipSync({ "inner.zip": zipSync({ "a.cfg": bytes("x") }) });
    expect(() => expandUpload([{ name: "outer.zip", bytes: nested }])).toThrow(/nested/);
  });

  it("rejects disallowed extensions", () => {
    expect(() => expandUpload([{ name: "mod.vpk", bytes: bytes("x") }])).toThrow(/not allowed/);
    expect(() => expandUpload([{ name: "run.exe", bytes: bytes("x") }])).toThrow(/not allowed/);
  });

  it("rejects zip-slip entries inside archives", () => {
    const zip = zipSync({ "../escape.cfg": bytes("x") });
    expect(() => expandUpload([{ name: "b.zip", bytes: zip }])).toThrow(UploadError);
  });

  it("enforces file count and duplicate caps", () => {
    const many = Array.from({ length: MAX_FILES + 1 }, (_, i) => ({
      name: `f${i}.cfg`,
      bytes: bytes("x"),
    }));
    expect(() => expandUpload(many)).toThrow(/too many/);
    expect(() =>
      expandUpload([
        { name: "a.cfg", bytes: bytes("x") },
        { name: "A.CFG", bytes: bytes("y") },
      ]),
    ).toThrow(/duplicate/);
  });

  it("rejects empty uploads", () => {
    expect(() => expandUpload([])).toThrow(/no files/);
  });
});

describe("defaultInstallPath", () => {
  it("routes known override names to tf/cfg/overrides", () => {
    expect(defaultInstallPath("autoexec.cfg")).toBe("tf/cfg/overrides/autoexec.cfg");
    expect(defaultInstallPath("sub/HeavyWeapons.CFG")).toBe("tf/cfg/overrides/heavyweapons.cfg");
  });

  it("routes everything else into the managed namespace", () => {
    expect(defaultInstallPath("mybinds.cfg")).toBe("tf/custom/execs-custom/cfg/mybinds.cfg");
    expect(defaultInstallPath("extra/net.cfg")).toBe("tf/custom/execs-custom/cfg/extra/net.cfg");
  });
});

describe("buildBundleZip", () => {
  it("produces a zip keyed by install path", () => {
    const zip = buildBundleZip([
      { installPath: "tf/cfg/overrides/autoexec.cfg", bytes: bytes("fov_desired 90") },
    ]);
    expect(zip.length).toBeGreaterThan(0);
  });
});

describe("slugify", () => {
  it("kebab-cases and trims", () => {
    expect(slugify("Silky Smooth FPS Config!")).toBe("silky-smooth-fps-config");
    expect(slugify("---")).toBe("config");
  });
});
