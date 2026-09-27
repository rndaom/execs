import { describe, expect, it } from "vitest";
import { sameChoice } from "./hitsound-ui";
import { repairReadyForConfirmation } from "./mods-ui";
import {
  comfigEntries,
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
  const library = [OWN, ...stockEntries()];

  it("searches by name across stock and user sources, case-insensitively", () => {
    const rows = filterSoundLibrary(library, "percussion", "name-asc");
    expect(rows.map((row) => row.label)).toEqual(["Percussion"]);
    expect(filterSoundLibrary(library, "DING", "name-asc").map((row) => row.label)).toEqual([
      "Default ding",
      "My Ding.wav",
    ]);
  });

  it("sorts by name both ways and suggests by source order", () => {
    const asc = filterSoundLibrary(library, "", "name-asc").map((row) => row.label);
    expect(asc).toEqual(
      [...asc].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
      ),
    );
    const desc = filterSoundLibrary(library, "", "name-desc").map((row) => row.label);
    expect(desc).toEqual([...asc].reverse());
    const bySource = filterSoundLibrary(library, "", "suggested").map((row) => row.source);
    const firstIndexOf = (source: (typeof bySource)[number]) => bySource.indexOf(source);
    expect(firstIndexOf("own")).toBeLessThan(firstIndexOf("stock"));
    expect(new Set(bySource)).toEqual(new Set(["own", "stock"]));
  });

  it("filters by source and favorites, keeping your own file at hand", () => {
    const stockOnly = filterSoundLibrary(library, "", "name-asc", { filter: "stock" });
    expect(stockOnly).toHaveLength(10);
    expect(stockOnly).toContain(OWN);
    const favorites = new Set([OWN.id]);
    expect(filterSoundLibrary(library, "", "name-asc", { filter: "favorites", favorites })).toEqual(
      [OWN],
    );
    expect(filterSoundLibrary(library, "", "name-asc", { filter: "favorites" })).toEqual([]);
  });

  it("suggests comfig.app uploads made for the slot being chosen first, in comfig order", () => {
    const comfig = comfigEntries([
      { name: "Zed kill", hash: "c".repeat(128), kind: "kill", order: 0 },
      { name: "Beta hit", hash: "b".repeat(128), kind: "hit", order: 1 },
      { name: "Alpha hit", hash: "a".repeat(128), kind: "hit", order: 2 },
    ]);
    const all = [...comfig, ...library];
    const forHits = filterSoundLibrary(all, "", "suggested", { target: "hit" });
    expect(forHits[0]).toBe(OWN);
    expect(forHits.slice(-3).map((row) => row.label)).toEqual([
      "Beta hit",
      "Alpha hit",
      "Zed kill",
    ]);
    const forKills = filterSoundLibrary(all, "", "suggested", { target: "kill" });
    expect(forKills.slice(-3).map((row) => row.label)).toEqual([
      "Zed kill",
      "Beta hit",
      "Alpha hit",
    ]);
    expect(
      filterSoundLibrary(all, "", "name-asc", { filter: "comfig" }).map((r) => r.label),
    ).toEqual(["Alpha hit", "Beta hit", "My Ding.wav", "Zed kill"]);
    expect(comfig[0].pickFor("hit")).toEqual({
      kind: "comfig",
      hash: "c".repeat(128),
      name: "Zed kill",
    });
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
  });

  it("matches a picked user WAV to the same installed source token", () => {
    const installedFile = {
      kind: "installed" as const,
      entry: { name: "My Ding.wav", source: "file" as const, token: "a".repeat(32) },
    };
    expect(sameChoice(OWN.choiceFor("hit"), installedFile)).toBe(true);
    expect(sameChoice(installedFile, OWN.choiceFor("kill"))).toBe(true);
    expect(sameChoice({ kind: "stock", effect: 0 }, installedFile)).toBe(false);
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
