import { describe, expect, it } from "vitest";
import { mapsFromFiles } from "./cfg-state";
import { editorCfgCandidates } from "./files-limits";
import { createPreviewApi } from "./preview-bridge";

describe("profile startup settings", () => {
  it("uses the mastercomfig hook order and its override autoexec", () => {
    const files = [
      { path: "tf/cfg/overrides/autoexec.cfg", text: "apply\n" },
      { path: "tf/cfg/overrides/setup_hook.cfg", text: 'alias apply "viewmodel_fov 100"' },
      { path: "tf/cfg/overrides/pre_init.cfg", text: 'alias apply "viewmodel_fov 45"' },
      { path: "tf/cfg/config.cfg", text: "viewmodel_fov 54" },
      { path: "tf/cfg/autoexec.cfg", text: "viewmodel_fov 90" },
      { path: "tf/cfg/overrides/medic.cfg", text: "viewmodel_fov 120" },
    ];
    expect(mapsFromFiles(files, "comfig")).toMatchObject({
      complete: true,
      effective: { viewmodel_fov: "100" },
    });
    expect(mapsFromFiles(files, "vanilla")).toMatchObject({
      complete: true,
      effective: { viewmodel_fov: "90" },
    });
  });

  it("does not use a stray vanilla autoexec in the comfig layer", () => {
    const files = [
      { path: "tf/cfg/config.cfg", text: "viewmodel_fov 54" },
      { path: "tf/cfg/autoexec.cfg", text: "viewmodel_fov 90" },
    ];
    expect(mapsFromFiles(files, "comfig").effective.viewmodel_fov).toBe("54");
  });

  it("derives complete settings from the standard locked preview through its profile API", async () => {
    const api = createPreviewApi("settings-locked");
    const detail = await api.getActiveProfileDetail();
    if (!detail) throw new Error("Preview profile missing");
    const candidates = editorCfgCandidates(detail.files);
    expect(candidates.limited).toBe(false);
    const files = await Promise.all(
      candidates.files.map(async ({ path }) => {
        const content = await api.readProfileFile(path);
        if (content.text === null) throw new Error(`Preview cfg unreadable: ${path}`);
        return { path: content.path, text: content.text };
      }),
    );
    expect(mapsFromFiles(files, detail.layer)).toMatchObject({
      complete: true,
      effective: { fov_desired: "90", viewmodel_fov: "70" },
      binds: { w: "+forward", ctrl: "+duck" },
    });
  });

  it("resolves a startup exec into a loose custom cfg without executing another pack file", () => {
    const files = [
      { path: "tf/cfg/autoexec.cfg", text: "exec hud_settings" },
      { path: "tf/custom/hud/cfg/hud_settings.cfg", text: "viewmodel_fov 120" },
      { path: "tf/custom/other/cfg/optional.cfg", text: "viewmodel_fov 45" },
    ];
    expect(mapsFromFiles(files, "vanilla")).toMatchObject({
      complete: true,
      effective: { viewmodel_fov: "120" },
    });
  });

  it("keeps known pane settings when one personal bind is malformed", () => {
    const files = [
      {
        path: "tf/cfg/config.cfg",
        text: 'viewmodel_fov "70"',
      },
      {
        path: "tf/cfg/overrides/autoexec.cfg",
        text: "exec overrides/binds\nviewmodel_fov 90",
      },
      {
        path: "tf/cfg/overrides/binds.cfg",
        text: 'bind p ""show_quest_log"\nbind w +forward',
      },
    ];
    expect(mapsFromFiles(files, "comfig")).toMatchObject({
      complete: true,
      effective: { viewmodel_fov: "90" },
      binds: { w: "+forward" },
    });
  });

  it("points to a likely startup typo without guessing its effect", () => {
    const files = [
      { path: "tf/cfg/config.cfg", text: "viewmodel_fov 70" },
      { path: "tf/cfg/overrides/autoexec.cfg", text: "viewwmodel_fov 90" },
    ];
    expect(mapsFromFiles(files, "comfig")).toMatchObject({
      complete: false,
      effective: {},
      reason: expect.stringContaining(
        "Cannot derive startup settings after `viewwmodel_fov` at tf/cfg/overrides/autoexec.cfg:1. Did you mean `viewmodel_fov`?",
      ),
      issue: { path: "tf/cfg/overrides/autoexec.cfg", line: 1 },
    });
  });

  it.each(["config_default", "undo360controller", "pack_only"])(
    "keeps unavailable startup cfg %s incomplete",
    (target) => {
      const files = [
        { path: "tf/cfg/config.cfg", text: "viewmodel_fov 70" },
        { path: "tf/cfg/autoexec.cfg", text: `exec ${target}` },
      ];
      expect(mapsFromFiles(files, "vanilla")).toMatchObject({
        complete: false,
        effective: {},
        binds: {},
      });
    },
  );

  it("keeps Source mount priority independent of editor file priority", () => {
    const files = [
      { path: "tf/cfg/config.cfg", text: "viewmodel_fov 54" },
      { path: "tf/cfg/autoexec.cfg", text: "exec personal/settings" },
      { path: "tf/cfg/personal/settings.cfg", text: "viewmodel_fov 45" },
      { path: "tf/custom/-alpha/cfg/personal/settings.cfg", text: "viewmodel_fov 100" },
    ];
    expect(mapsFromFiles(editorCfgCandidates(files).files, "vanilla")).toMatchObject({
      complete: true,
      effective: { viewmodel_fov: "100" },
    });
  });

  it.each(["autoexec", "execs_binds", "execs_gameplay"])(
    "refuses a shadowed managed write route: %s",
    (stem) => {
      const files = [
        { path: "tf/cfg/autoexec.cfg", text: "viewmodel_fov 45" },
        { path: `tf/custom/-alpha/cfg/${stem}.cfg`, text: "viewmodel_fov 100" },
      ];
      expect(mapsFromFiles(files, "vanilla")).toMatchObject({
        complete: false,
        effective: {},
        reason: expect.stringContaining("custom pack overrides"),
      });
    },
  );
});
