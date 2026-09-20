import { describe, expect, it } from "vitest";
import type { GameBananaMod, GameBananaPage } from "./bridge";
import {
  GAMEBANANA_PAGE_CACHE_MAX_ENTRIES,
  GAMEBANANA_PAGE_CACHE_STALE_GRACE_MS,
  gameBananaMetaLine,
  gameBananaPager,
  gameBananaPageScopeNote,
  gameBananaQueryError,
  gameBananaRequestKey,
  gameBananaTotalLabel,
  normalizeGameBananaQuery,
  readGameBananaPageCache,
  relativeDate,
  writeGameBananaPageCache,
} from "./gamebanana-browser-ui";

const mod = (over: Partial<GameBananaMod> = {}): GameBananaMod => ({
  id: 1,
  name: "A mod",
  author: "Author",
  category: "Skins",
  categoryId: 7951,
  likes: null,
  views: null,
  downloads: null,
  addedAt: null,
  updatedAt: null,
  modifiedAt: null,
  thumb: null,
  url: "https://gamebanana.com/mods/1",
  mature: false,
  ...over,
});

const page = (over: Partial<GameBananaPage> = {}): GameBananaPage => ({
  records: [mod()],
  total: { kind: "exact", value: 1 },
  perPage: 20,
  complete: true,
  ordering: "server",
  filters: {
    query: "global",
    category: "global",
    contentRating: "global",
    installability: "global",
  },
  cache: { source: "network", freshForMs: 10 * 60_000 },
  ...over,
});

describe("GameBanana browser UI model", () => {
  it("keys every effective request field and normalizes harmless query whitespace", () => {
    const base = {
      query: "  rocket   trail ",
      sort: "new" as const,
      category: null,
      page: 1,
      includeMature: false,
    };
    expect(normalizeGameBananaQuery(base.query)).toBe("rocket trail");
    expect(gameBananaRequestKey(base)).toBe(
      gameBananaRequestKey({ ...base, query: "Rocket Trail" }),
    );
    for (const changed of [
      { ...base, sort: "likes" as const },
      { ...base, category: 7951 },
      { ...base, page: 2 },
      { ...base, includeMature: true },
    ]) {
      expect(gameBananaRequestKey(changed)).not.toBe(gameBananaRequestKey(base));
    }
  });

  it("rejects ambiguous or oversized name filters before a request", () => {
    expect(gameBananaQueryError("rocket, trail")).toBe("Search terms cannot contain commas.");
    expect(gameBananaQueryError("💥".repeat(128))).toBeNull();
    expect(gameBananaQueryError("💥".repeat(129))).toContain("128");
  });

  it("uses exact totals only for page counts and trusts upstream completion", () => {
    expect(gameBananaPager(3, { kind: "exact", value: 240 }, 20, false)).toEqual({
      label: "Page 3 of 12",
      pageCount: 12,
      hasPrevious: true,
      hasNext: true,
    });
    expect(gameBananaPager(12, { kind: "exact", value: 240 }, 20, false).hasNext).toBe(true);
    expect(gameBananaPager(3, { kind: "capped", value: 1_000 }, 20, false)).toEqual({
      label: "Page 3",
      pageCount: null,
      hasPrevious: true,
      hasNext: true,
    });
    expect(gameBananaPager(3, { kind: "unknown" }, 20, true).hasNext).toBe(false);
  });

  it("labels exact, estimated, capped and unknown totals without false precision", () => {
    expect(gameBananaTotalLabel({ kind: "exact", value: 1 })).toBe("1 result");
    expect(gameBananaTotalLabel({ kind: "exact", value: 232 })).toBe("232 results");
    expect(gameBananaTotalLabel({ kind: "estimated", value: 400 })).toBe("About 400 results");
    expect(gameBananaTotalLabel({ kind: "capped", value: 1_000 })).toBe("1,000+ results");
    expect(gameBananaTotalLabel({ kind: "unknown" })).toBeNull();
  });

  it("discloses page-local safety filtering", () => {
    expect(gameBananaPageScopeNote(page())).toBeNull();
    expect(
      gameBananaPageScopeNote(page({ filters: { ...page().filters, installability: "page" } })),
    ).toContain("each GameBanana page");
  });

  it("uses the date belonging to the selected mode and never invents missing facts", () => {
    const now = Date.UTC(2026, 8, 20);
    const days = (count: number) => now / 1_000 - count * 86_400;
    const fresh = mod({
      likes: 12,
      downloads: null,
      addedAt: days(2),
      updatedAt: days(8),
      modifiedAt: days(1),
    });
    expect(gameBananaMetaLine(fresh, "new", now)).toBe("Added 2 days ago · ▲ 12");
    expect(gameBananaMetaLine(fresh, "updated", now)).toBe("Updated a week ago · ▲ 12");
    expect(gameBananaMetaLine(mod(), "new", now)).toBe("Details unavailable");

    const authorUpdated = { ...fresh, addedAt: days(20), updatedAt: days(1) };
    expect(gameBananaMetaLine(authorUpdated, "new", now)).toContain("Added 2 weeks ago");
    expect(gameBananaMetaLine(mod({ downloads: 0 }), "downloads", now)).toBe("0 downloads");
    expect(gameBananaMetaLine(mod({ views: 1_500 }), "views", now)).toBe("1.5k views");
    expect(relativeDate(days(-2), now)).toBe("today");
  });

  it("expires, briefly retains, and finally drops a cached page", () => {
    const cache = new Map();
    writeGameBananaPageCache(
      cache,
      "a",
      page({ cache: { source: "network", freshForMs: 1_000 } }),
      10_000,
    );
    expect(readGameBananaPageCache(cache, "a", 10_999)?.freshness).toBe("fresh");
    expect(readGameBananaPageCache(cache, "a", 11_000)?.freshness).toBe("stale");
    expect(
      readGameBananaPageCache(cache, "a", 11_000 + GAMEBANANA_PAGE_CACHE_STALE_GRACE_MS),
    ).toBeNull();
  });

  it("evicts least-recent pages at the entry bound", () => {
    const cache = new Map();
    for (let index = 0; index < GAMEBANANA_PAGE_CACHE_MAX_ENTRIES; index += 1) {
      writeGameBananaPageCache(cache, String(index), page(), index);
    }
    // Touch zero, so one becomes the least-recent page.
    expect(readGameBananaPageCache(cache, "0", 10_000)).not.toBeNull();
    writeGameBananaPageCache(cache, "new", page(), 10_001);
    expect(cache).toHaveLength(GAMEBANANA_PAGE_CACHE_MAX_ENTRIES);
    expect(cache.has("0")).toBe(true);
    expect(cache.has("1")).toBe(false);
  });
});
