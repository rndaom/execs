import { describe, expect, it } from "vitest";
import {
  casualChangesCopy,
  casualChangesInstalled,
  debRemoveCommand,
  type UninstallInfo,
  uninstallActionLabel,
} from "./uninstall-ui";

const info = (casual: UninstallInfo["casual"]): UninstallInfo => ({
  install: { kind: "windowsInstaller", uninstaller: "C:/execs/uninstall.exe" },
  dataDirectory: "C:/Users/me/AppData/Roaming/execs",
  casual,
});

describe("uninstall", () => {
  it("treats unknown or installed Casual changes as blocking data deletion", () => {
    expect(casualChangesInstalled(info({ patchedFiles: 0, gameinfoBypassed: false }))).toBe(false);
    expect(casualChangesInstalled(info({ patchedFiles: 2, gameinfoBypassed: false }))).toBe(true);
    expect(casualChangesInstalled(info(null))).toBe(true);
    expect(casualChangesCopy(info({ patchedFiles: 2, gameinfoBypassed: true }))).toBe(
      "Casual setup changed TF2's own files: 2 particle files and gameinfo.txt.",
    );
    expect(casualChangesCopy(info({ patchedFiles: 0, gameinfoBypassed: false }))).toBeNull();
  });

  it("labels the action for each install kind", () => {
    expect(uninstallActionLabel({ kind: "windowsInstaller", uninstaller: "x" }, false)).toBe(
      "Uninstall execs…",
    );
    expect(uninstallActionLabel({ kind: "appImage", path: "/a" }, true)).toBe(
      "Delete data and this AppImage…",
    );
    expect(uninstallActionLabel({ kind: "deb", package: "execs" }, false)).toBeNull();
    expect(uninstallActionLabel({ kind: "unmanaged" }, true)).toBeNull();
    expect(debRemoveCommand({ kind: "deb", package: "execs" })).toBe("sudo apt remove execs");
  });
});
