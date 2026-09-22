import { describe, expect, it } from "vitest";
import { sameChoice } from "./hitsound-ui";
import { repairReadyForConfirmation } from "./mods-ui";
import {
  comfigEntries,
  communityEntries,
  filterSoundLibrary,
  ownEntry,
  pageSoundLibrary,
  parseSoundPageJump,
  SOUND_LIBRARY_PAGE_SIZE,
  soundPageLinks,
  stockEntries,
} from "./sound-library";

const OWN = ownEntry({
  token: "a".repeat(32),
  name: "My Ding.wav",
  info: {
    formatTag: 1,
    channels: 2,
    sampleRate: 44100,
    bitsPerSample: 16,
    dataBytes: 4410,
    durationMs: 25,
  },
  converted: true,
});

describe("sound library", () => {
  const library = [
    OWN,
    ...stockEntries(),
    ...communityEntries(),
    ...comfigEntries([
      { name: "Quake 3 hit", hash: "f".repeat(128), kind: "hit" },
      { name: "Anime wow", hash: "e".repeat(128), kind: "kill" },
    ]),
  ];

  it("searches by name across every source, case-insensitively", () => {
    const rows = filterSoundLibrary(library, "quake", "name-asc", null);
    expect(rows.map((row) => row.label)).toEqual(["Quake 3 hit"]);
    expect(filterSoundLibrary(library, "DING", "name-asc", null).map((row) => row.label)).toEqual([
      "Default ding",
      "My Ding.wav",
    ]);
  });

  it("sorts by name both ways and by source order", () => {
    const asc = filterSoundLibrary(library, "", "name-asc", null).map((row) => row.label);
    expect(asc).toEqual(
      [...asc].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
      ),
    );
    const desc = filterSoundLibrary(library, "", "name-desc", null).map((row) => row.label);
    expect(desc).toEqual([...asc].reverse());
    const bySource = filterSoundLibrary(library, "", "source", null).map((row) => row.source);
    const firstIndexOf = (source: (typeof bySource)[number]) => bySource.indexOf(source);
    expect(firstIndexOf("own")).toBeLessThan(firstIndexOf("stock"));
    expect(firstIndexOf("stock")).toBeLessThan(firstIndexOf("community"));
    expect(firstIndexOf("community")).toBeLessThan(firstIndexOf("comfig"));
  });

  it("filters to one source and keeps the upstream hit/kill hint", () => {
    const rows = filterSoundLibrary(library, "", "name-asc", new Set(["comfig"]));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.label === "Anime wow")?.suggested).toBe("kill");
    expect(filterSoundLibrary(library, "", "name-asc", new Set(["stock"]))).toHaveLength(9);
  });

  it("gives every slot a choice and a pick per row", () => {
    const stock = stockEntries()[3];
    expect(stock.choiceFor("hit")).toEqual({ kind: "stock", effect: 3 });
    expect(stock.pickFor("kill")).toEqual({ kind: "stock", stem: "killsound_percussion" });
    expect(OWN.pickFor("hit")).toEqual({
      kind: "file",
      token: "a".repeat(32),
      name: "My Ding.wav",
    });
    const comfig = comfigEntries([{ name: "X", hash: "1".repeat(64), kind: "hit" }])[0];
    expect(comfig.choiceFor("kill")).toEqual({ kind: "comfig", hash: "1".repeat(64), name: "X" });
  });

  it("treats an installed slot as the same choice as its library row", () => {
    const installedCommunity = {
      kind: "installed" as const,
      entry: { name: "quack", source: "community" as const },
    };
    expect(sameChoice({ kind: "community", id: "quack" }, installedCommunity)).toBe(true);
    expect(sameChoice(installedCommunity, { kind: "community", id: "quack" })).toBe(true);
    expect(sameChoice({ kind: "community", id: "pop" }, installedCommunity)).toBe(false);
    expect(sameChoice({ kind: "stock", effect: 0 }, installedCommunity)).toBe(false);
  });

  it("pages filtered sounds and clamps a stale page after the result count changes", () => {
    const entries = Array.from({ length: SOUND_LIBRARY_PAGE_SIZE * 2 + 1 }, (_, index) => ({
      ...OWN,
      id: `own:${index}`,
    }));
    expect(pageSoundLibrary(entries, 0)).toMatchObject({
      page: 0,
      pageCount: 3,
      first: 1,
      last: SOUND_LIBRARY_PAGE_SIZE,
    });
    expect(pageSoundLibrary(entries, 2)).toMatchObject({
      page: 2,
      first: SOUND_LIBRARY_PAGE_SIZE * 2 + 1,
      last: entries.length,
      entries: [entries.at(-1)],
    });
    expect(pageSoundLibrary(entries.slice(0, 2), 2)).toMatchObject({
      page: 0,
      pageCount: 1,
      first: 1,
      last: 2,
    });
    expect(pageSoundLibrary([], 2)).toMatchObject({
      page: 0,
      pageCount: 0,
      first: 0,
      last: 0,
      entries: [],
    });
  });

  it("keeps distant pages reachable and rejects invalid page jumps", () => {
    expect(soundPageLinks(0, 25)).toEqual([1, 2, "gap-end", 25]);
    expect(soundPageLinks(12, 25)).toEqual([1, "gap-start", 12, 13, 14, "gap-end", 25]);
    expect(parseSoundPageJump("25", 25)).toBe(24);
    expect(parseSoundPageJump("0", 25)).toBeNull();
    expect(parseSoundPageJump("26", 25)).toBeNull();
    expect(parseSoundPageJump("1.5", 25)).toBeNull();
  });
});

describe("repair flow", () => {
  it("offers explicit confirmation only when no untracked particle files remain", () => {
    expect(repairReadyForConfirmation(null)).toBe(false);
    const base = {
      modsCached: true,
      modsSizeBytes: 1,
      preloadLaunchInSteam: true,
      profilePreload: true,
      status: {
        gameinfoFound: true,
        gameinfoBypassed: false,
        patchedFiles: [],
        addons: [],
        particleMods: [],
        skipped: [],
        stale: false,
        customVpkPresent: false,
        untrackedModified: ["particles/muzzle_flash.pcf"],
      },
    };
    expect(repairReadyForConfirmation(base)).toBe(false);
    expect(
      repairReadyForConfirmation({ ...base, status: { ...base.status, untrackedModified: [] } }),
    ).toBe(true);
  });
});
