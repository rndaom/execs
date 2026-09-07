import { describe, expect, it } from "vitest";
import {
  clearPendingRelease,
  githubReleaseUrl,
  installedReleaseForLaunch,
  releaseNotesSections,
  stagePendingRelease,
} from "./release-notes-ui";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("installed release notes", () => {
  it("shows the exact staged release after the updater restart", () => {
    const state = storage();
    stagePendingRelease(state, { version: "0.2.0", notes: "### Added\n\n- A useful thing" });
    expect(installedReleaseForLaunch(state, "0.2.0", true)).toEqual({
      version: "0.2.0",
      notes: "### Added\n\n- A useful thing",
    });
    clearPendingRelease(state, "0.2.0");
    expect(installedReleaseForLaunch(state, "0.2.0", true)).toBeNull();
  });

  it("does not show update notes on a fresh install", () => {
    const state = storage();
    expect(installedReleaseForLaunch(state, "0.1.3", false)).toBeNull();
  });

  it("bridges existing users upgrading from the marker-less 0.1.2 build", () => {
    const result = installedReleaseForLaunch(storage(), "0.1.3", true);
    expect(result?.version).toBe("0.1.3");
    expect(result?.notes).toContain("right and middle mouse buttons");
  });

  it("turns release Markdown into safe headings and list copy", () => {
    expect(
      releaseNotesSections("## 0.2.0\nIntro text\n### Fixed\n- **Binds:** fixed `mouse2`"),
    ).toEqual([
      { title: "0.2.0", items: ["Intro text"] },
      { title: "Fixed", items: ["Binds: fixed mouse2"] },
    ]);
    expect(githubReleaseUrl("0.2.0")).toBe("https://github.com/rndaom/execs/releases/tag/v0.2.0");
  });

  it("keeps wrapped changelog bullets together", () => {
    expect(
      releaseNotesSections(
        "### Fixed\n- Mods: install downloads\n  from cache hosts.\n- HUD: keep options.",
      ),
    ).toEqual([
      {
        title: "Fixed",
        items: ["Mods: install downloads from cache hosts.", "HUD: keep options."],
      },
    ]);
  });

  it("does not block startup or update staging when storage is unavailable", () => {
    expect(installedReleaseForLaunch(null, "0.1.3", true)).toBeNull();
    expect(() => stagePendingRelease(null, { version: "0.1.3", notes: null })).not.toThrow();
    expect(() => clearPendingRelease(null, "0.1.3")).not.toThrow();
    const state = storage();
    state.getItem = () => {
      throw Error("storage denied");
    };
    state.setItem = () => {
      throw Error("storage denied");
    };
    expect(() => installedReleaseForLaunch(state, "0.1.3", true)).not.toThrow();
  });
});
