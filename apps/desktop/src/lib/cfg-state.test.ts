import { describe, expect, it } from "vitest";
import { mapsFromFiles } from "./cfg-state";

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
});
