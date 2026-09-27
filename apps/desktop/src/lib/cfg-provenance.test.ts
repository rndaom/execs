import { describe, expect, it } from "vitest";
import { cfgProvenance } from "./cfg-provenance";
import { mapsFromFiles } from "./cfg-state";

function provenance(
  files: { path: string; text: string }[],
  tab: string,
  layer: "vanilla" | "comfig" = "vanilla",
  hudId: string | null = null,
) {
  const maps = mapsFromFiles(files, layer);
  return cfgProvenance({
    files,
    layer,
    tab,
    managedPath:
      layer === "comfig" ? "tf/cfg/overrides/execs_gameplay.cfg" : "tf/cfg/execs_gameplay.cfg",
    effective: maps.effective,
    effectiveSources: maps.effectiveSources,
    complete: maps.complete,
    hudId,
  });
}

describe("settings CFG provenance", () => {
  it("names the file and line that set each startup value and its origin", () => {
    const result = provenance(
      [
        { path: "tf/cfg/config.cfg", text: "sensitivity 3\nfov_desired 75\n" },
        { path: "tf/cfg/autoexec.cfg", text: "exec execs_gameplay\n" },
        { path: "tf/cfg/execs_gameplay.cfg", text: "fov_desired 90\n" },
      ],
      "gameplay",
    );
    expect(result.sources).toContainEqual({
      cvar: "fov_desired",
      value: "90",
      path: "tf/cfg/execs_gameplay.cfg",
      line: 1,
      origin: "managed",
      classes: [],
    });
    expect(result.sources).toContainEqual(
      expect.objectContaining({ cvar: "sensitivity", value: "3", origin: "config", line: 1 }),
    );
    expect(result.unset).toContain("hud_fastswitch");
    expect(result.overrides).toEqual([]);
  });

  it("reports a later startup line that overrides the execs file", () => {
    const result = provenance(
      [
        {
          path: "tf/cfg/autoexec.cfg",
          text: "exec execs_gameplay\nfov_desired 80\nexec personal\n",
        },
        { path: "tf/cfg/execs_gameplay.cfg", text: "fov_desired 90\n" },
        { path: "tf/cfg/personal.cfg", text: "sensitivity 2.5\n" },
      ],
      "gameplay",
    );
    expect(result.sources).toContainEqual(
      expect.objectContaining({ cvar: "fov_desired", value: "80", origin: "user", line: 2 }),
    );
    // A cvar the execs file does not set yet is still unreachable from this pane.
    expect(result.overrides).toEqual([
      { cvar: "fov_desired", path: "tf/cfg/autoexec.cfg", line: 2 },
      { cvar: "sensitivity", path: "tf/cfg/personal.cfg", line: 1 },
    ]);
  });

  it("claims no overrides when the execs file is not executed", () => {
    const result = provenance(
      [
        { path: "tf/cfg/autoexec.cfg", text: "fov_desired 80\n" },
        { path: "tf/cfg/execs_gameplay.cfg", text: "fov_desired 90\n" },
      ],
      "gameplay",
    );
    expect(result.overrides).toEqual([]);
    expect(result.sources).toContainEqual(
      expect.objectContaining({ cvar: "fov_desired", value: "80" }),
    );
  });

  it("uses the mastercomfig override layer and labels provided files", () => {
    const result = provenance(
      [
        {
          path: "tf/cfg/overrides/autoexec.cfg",
          text: "exec overrides/execs_gameplay\n",
        },
        { path: "tf/cfg/overrides/execs_gameplay.cfg", text: "viewmodel_fov 70\n" },
        { path: "tf/custom/myhud/cfg/scout.cfg", text: "viewmodel_fov 54\nr_drawviewmodel 0\n" },
        { path: "tf/cfg/overrides/medic.cfg", text: "viewmodel_fov 60\n" },
      ],
      "viewmodels",
      "comfig",
      "myhud",
    );
    expect(result.sources).toEqual([
      {
        cvar: "viewmodel_fov",
        value: "70",
        path: "tf/cfg/overrides/execs_gameplay.cfg",
        line: 1,
        origin: "managed",
        classes: [
          { name: "Scout", path: "tf/custom/myhud/cfg/scout.cfg", line: 1 },
          { name: "Medic", path: "tf/cfg/overrides/medic.cfg", line: 1 },
        ],
      },
    ]);
    expect(result.overrides).toEqual([]);
  });

  it("says nothing when the startup resolver is incomplete or the pane has no cvars", () => {
    const incomplete = provenance(
      [{ path: "tf/cfg/autoexec.cfg", text: "exec missing\nfov_desired 80\n" }],
      "gameplay",
    );
    expect(incomplete).toEqual({ sources: [], unset: [], overrides: [] });
    expect(provenance([{ path: "tf/cfg/autoexec.cfg", text: "fov_desired 80\n" }], "hud")).toEqual({
      sources: [],
      unset: [],
      overrides: [],
    });
  });

  it("never reports credential values", () => {
    const result = provenance(
      [{ path: "tf/cfg/autoexec.cfg", text: 'password "hunter2"\nrcon_password secret\n' }],
      "gameplay",
    );
    expect(JSON.stringify(result)).not.toMatch(/hunter2|secret/);
  });
});
