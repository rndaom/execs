import { describe, expect, it } from "vitest";
import { createPreviewApi } from "./preview-bridge";

describe("GameBanana preview bridge", () => {
  it("uses production-sized pages and truthful all-category metadata", async () => {
    const api = createPreviewApi("settings-mods");
    const first = await api.searchGameBananaMods("", "new", null, 1, false);
    const second = await api.searchGameBananaMods("", "new", null, 2, false);
    expect(first.records).toHaveLength(20);
    expect(first.total).toEqual({ kind: "estimated", value: 24 });
    expect(first.complete).toBe(false);
    expect(first.filters.installability).toBe("page");
    expect(second.records).toHaveLength(4);
    expect(second.complete).toBe(true);
  });

  it("applies name, category and content filters globally before pagination", async () => {
    const api = createPreviewApi("settings-mods");
    const found = await api.searchGameBananaMods("rocket", "downloads", 1090, 1, false, true);
    expect(found.records.map((record) => record.name)).toEqual(["Clean Rocket Trails"]);
    expect(found.total).toEqual({ kind: "exact", value: 1 });
    expect(found.filters).toEqual({
      query: "global",
      category: "global",
      contentRating: "global",
      installability: "global",
    });
    expect(found.cache.freshForMs).toBe(600_000);
  });

  it("keeps absent source values absent while simulating server ordering", async () => {
    const api = createPreviewApi("settings-mods");
    const first = await api.searchGameBananaMods("", "downloads", null, 1, true);
    const second = await api.searchGameBananaMods("", "downloads", null, 2, true);
    const records = [...first.records, ...second.records];
    expect(records.some((record) => record.downloads === null)).toBe(true);
    const known = records.flatMap((record) =>
      record.downloads === null ? [] : [record.downloads],
    );
    expect(known).toEqual([...known].sort((a, b) => b - a));
  });
});
