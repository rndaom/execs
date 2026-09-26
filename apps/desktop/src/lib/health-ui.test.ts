import { describe, expect, it } from "vitest";
import { healthItems, type InstallHealth } from "./health-ui";

function health(patch: Partial<InstallHealth> = {}): InstallHealth {
  return {
    tf2Root: "C:/Steam/steamapps/common/Team Fortress 2",
    libraryUsable: true,
    rootMismatch: false,
    activeLayer: "comfig",
    profiles: [
      {
        id: "a",
        name: "Main",
        active: true,
        trackedFiles: 10,
        missingFiles: 0,
        missingExamples: [],
        uncachedDownloads: [],
        needsLegacyLibrary: false,
      },
    ],
    recovery: { pendingSwitch: null, profileUpdate: false, casual: false, unknown: false },
    steamAccountFound: true,
    cloudConfigPresent: true,
    hudCatalogAgeSeconds: 2 * 86_400 + 5,
    legacyLibraryPresent: false,
    gameRunning: false,
    ...patch,
  };
}

const byId = (items: ReturnType<typeof healthItems>, id: string) => {
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new Error(`missing ${id}`);
  return item;
};

describe("installation health", () => {
  it("reports a healthy setup without claiming a Cloud upload", () => {
    const items = healthItems(health());
    expect(items.every((item) => item.status === "ok")).toBe(true);
    expect(byId(items, "profiles").lines).toEqual(["Main has every saved file."]);
    expect(byId(items, "cloud").lines).toContain(
      "Steam uploads that copy when it syncs; execs cannot confirm the upload.",
    );
    expect(byId(items, "offline").lines).toEqual([
      "Switching profiles works offline.",
      "Browsing HUDs works offline from a list saved 2 days ago.",
      "Installing HUDs and mods, mastercomfig updates and app updates need a connection.",
    ]);
  });

  it("flags interrupted work, missing files and a missing legacy library", () => {
    const items = healthItems(
      health({
        recovery: { pendingSwitch: "Casual", profileUpdate: false, casual: true, unknown: false },
        profiles: [
          {
            id: "a",
            name: "Main",
            active: true,
            trackedFiles: 10,
            missingFiles: 12,
            missingExamples: ["tf/cfg/a.cfg"],
            uncachedDownloads: ["Flat Textures v1"],
            needsLegacyLibrary: true,
          },
        ],
      }),
    );
    expect(byId(items, "recovery")).toMatchObject({
      status: "attention",
      lines: [
        "Switching to Casual was interrupted. Switch to it again to finish.",
        "A Casual setup change was interrupted. Open Mods, Casual setup to recover it.",
      ],
    });
    const profiles = byId(items, "profiles");
    expect(profiles.status).toBe("attention");
    expect(profiles.lines[0]).toContain("missing 12 saved files (tf/cfg/a.cfg, …)");
    expect(profiles.lines[1]).toContain("cannot be downloaded again");
    expect(byId(items, "offline").lines[0]).toBe(
      "Switching to Main needs a connection to download Flat Textures v1.",
    );
  });

  it("reports unavailable evidence as unknown", () => {
    const items = healthItems(
      health({
        tf2Root: null,
        libraryUsable: false,
        activeLayer: null,
        profiles: [],
        steamAccountFound: false,
        cloudConfigPresent: null,
        hudCatalogAgeSeconds: null,
      }),
    );
    expect(byId(items, "install").status).toBe("attention");
    expect(byId(items, "loader").status).toBe("unknown");
    expect(byId(items, "recovery").status).toBe("unknown");
    expect(byId(items, "profiles").status).toBe("unknown");
    expect(byId(items, "cloud").status).toBe("unknown");
    expect(byId(items, "offline").lines).toContain("Browsing HUDs needs a connection.");
  });

  it("mentions a running game and a library from another install", () => {
    const install = byId(healthItems(health({ gameRunning: true, rootMismatch: true })), "install");
    expect(install.status).toBe("attention");
    expect(install.lines.join(" ")).toContain("TF2 is running");
    expect(install.lines.join(" ")).toContain("different TF2 folder");
  });
});
