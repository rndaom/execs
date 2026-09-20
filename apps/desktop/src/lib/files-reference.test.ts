import { describe, expect, it } from "vitest";
import {
  CFG_GUIDES,
  CFG_SNIPPETS,
  CLASS_CFG_NAMES,
  cfgExecutionRole,
  cfgHudFolder,
  cfgSourceLinks,
  maskCfgPreview,
  searchCfgGuides,
} from "./files-reference";

describe("offline cfg guides", () => {
  it("finds instructions without a network or game connection", () => {
    expect(searchCfgGuides("heavyweapons").some((guide) => guide.id === "classes")).toBe(true);
    expect(searchCfgGuides("exec paths").some((guide) => guide.id === "exec")).toBe(true);
    expect(searchCfgGuides(" ")).toHaveLength(CFG_GUIDES.length);
    expect(CLASS_CFG_NAMES).toHaveLength(9);
  });
  it("keeps snippets harmless and independent of install paths", () => {
    for (const snippet of CFG_SNIPPETS) {
      expect(snippet.text).not.toMatch(/host_writeconfig|unbindall|password|sv_cheats/i);
      expect(snippet.effect.length).toBeGreaterThan(10);
    }
  });
});

describe("cfg source context", () => {
  const files = [
    {
      path: "tf/cfg/autoexec.cfg",
      text: 'exec helper\nbind F9 "exec absent"\nalias hello "echo hi"\nhello\n',
    },
    { path: "tf/cfg/helper.cfg", text: "" },
    { path: "tf/custom/pack/cfg/helper.cfg", text: "" },
    { path: "tf/cfg/deep/autoexec.cfg", text: "" },
  ];
  it("resolves mount shadowing and records deferred and unresolved links honestly", () => {
    const links = cfgSourceLinks(files);
    expect(links[0].target).toBe("tf/custom/pack/cfg/helper.cfg");
    expect(links[1]).toMatchObject({ target: null, deferred: true, line: 2 });
    expect(links[2]).toMatchObject({ target: "tf/cfg/autoexec.cfg", targetLine: 3, kind: "alias" });
  });
  it("does not infer startup from basenames or overrides without mastercomfig", () => {
    expect(cfgExecutionRole(files[0].path, files, false)).toContain("Startup");
    expect(cfgExecutionRole(files[3].path, files, false)).toContain("unknown");
    expect(cfgExecutionRole("tf/cfg/overrides/scout.cfg", files, false)).toContain("unknown");
    expect(cfgExecutionRole("tf/cfg/overrides/scout.cfg", files, true)).toContain("class hook");
  });
  it("masks whole secret-containing lines including nested payloads and comments", () => {
    const original =
      'echo safe\nbind F9 "password secret"\n// rcon_password another\n"sv_password" "hidden"';
    const masked = maskCfgPreview(original);
    expect(masked).toContain("echo safe");
    expect(masked).not.toMatch(/secret|another|"hidden"/);
    expect(
      cfgSourceLinks([{ path: "tf/cfg/autoexec.cfg", text: 'exec "password secret"' }])[0].label,
    ).toBe("Exec target");
  });
  it("preserves original path spelling for navigation and refuses ambiguous mounts", () => {
    expect(
      cfgSourceLinks([
        { path: "tf/cfg/Autoexec.cfg", text: "exec HELPER" },
        { path: "tf/cfg/Helper.cfg", text: "" },
      ])[0].target,
    ).toBe("tf/cfg/Helper.cfg");
    expect(
      cfgSourceLinks([...files, { path: "tf/cfg/Helper.cfg", text: "" }])[0].target,
    ).toBeNull();
  });
  it("resolves the actual recorded HUD using full manifest markers without dashed guesses", () => {
    const manifest = [
      { path: "tf/custom/imported/info.vdf" },
      { path: "tf/custom/-rayshud/cfg/x.cfg" },
    ];
    expect(cfgHudFolder(manifest, { id: "rayshud" })).toBe("imported");
    expect(cfgHudFolder(manifest, null)).toBeNull();
    expect(
      cfgHudFolder([...manifest, { path: "tf/custom/other/resource/ui/hud.res" }], {
        id: "rayshud",
      }),
    ).toBeNull();
    expect(
      cfgHudFolder([...manifest, { path: "tf/custom/rayshud/cfg/x.cfg" }], { id: "rayshud" }),
    ).toBe("rayshud");
  });
});
