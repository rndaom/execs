import { JSDOM } from "jsdom";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "../lib/api";
import type { GameBananaPage } from "../lib/bridge";
import { type GameBananaBrowserModel, useGameBananaBrowser } from "./useGameBananaBrowser";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function result(id: number, name = `Mod ${id}`, freshForMs = 600_000): GameBananaPage {
  return {
    records: [
      {
        id,
        name,
        author: "Author",
        category: "Skins",
        categoryId: 7951,
        likes: null,
        views: null,
        downloads: null,
        addedAt: 100,
        updatedAt: null,
        modifiedAt: 100,
        thumb: null,
        url: `https://gamebanana.com/mods/${id}`,
        mature: false,
      },
    ],
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
    cache: { source: "network", freshForMs },
  };
}

let dom: JSDOM;
let root: Root;
let latest: GameBananaBrowserModel;
let active = true;
let clock = 10_000;

function Harness({ api }: { api: Api }) {
  latest = useGameBananaBrowser({ api, active, now: () => clock });
  return <div data-status={latest.loading ? "loading" : latest.error ? "error" : "ready"} />;
}

beforeEach(() => {
  vi.useFakeTimers();
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://preview.test" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root") as HTMLElement);
  active = true;
  clock = 10_000;
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function apiWith(
  search: Api["searchGameBananaMods"],
  categories: Api["gameBananaModCategories"] = vi.fn(async () => []),
): Api {
  return { searchGameBananaMods: search, gameBananaModCategories: categories } as unknown as Api;
}

async function render(api: Api) {
  await act(async () => root.render(<Harness api={api} />));
}

describe("useGameBananaBrowser", () => {
  it("recovers category loading after React replays its mount effects", async () => {
    const categories = vi.fn(async () => [{ id: 7951, name: "Skins" }]);
    const api = apiWith(
      vi.fn(async () => result(1)),
      categories,
    );
    await act(async () =>
      root.render(
        <StrictMode>
          <Harness api={api} />
        </StrictMode>,
      ),
    );
    await act(async () => Promise.resolve());
    expect(latest.categories).toEqual({ status: "ready", records: [{ id: 7951, name: "Skins" }] });
  });
  it("keeps a successful category response that finishes while hidden", async () => {
    const pending = deferred<{ id: number; name: string }[]>();
    const categories = vi.fn(() => pending.promise);
    const api = apiWith(
      vi.fn(async () => result(1)),
      categories,
    );
    await render(api);
    expect(categories).toHaveBeenCalledTimes(1);

    active = false;
    await render(api);
    await act(async () => pending.resolve([{ id: 7951, name: "Skins" }]));
    expect(latest.categories).toEqual({
      status: "ready",
      records: [{ id: 7951, name: "Skins" }],
    });

    active = true;
    await render(api);
    expect(categories).toHaveBeenCalledTimes(1);
  });

  it("retries a category failure on reopen and ignores an older response", async () => {
    const old = deferred<{ id: number; name: string }[]>();
    const categories = vi
      .fn<Api["gameBananaModCategories"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce([{ id: 1090, name: "Effects" }]);
    const api = apiWith(
      vi.fn(async () => result(1)),
      categories,
    );
    await render(api);
    await act(async () => Promise.resolve());
    expect(latest.categories.status).toBe("error");

    active = false;
    await render(api);
    active = true;
    await render(api);
    expect(categories).toHaveBeenCalledTimes(2);
    await act(async () => latest.retryCategories());
    expect(categories).toHaveBeenCalledTimes(3);
    await act(async () => old.resolve([{ id: 7951, name: "Skins" }]));
    expect(latest.categories).toEqual({
      status: "ready",
      records: [{ id: 1090, name: "Effects" }],
    });
  });

  it("keeps the newest request and never renders a previous filter as the new one", async () => {
    const first = deferred<GameBananaPage>();
    const second = deferred<GameBananaPage>();
    const search = vi
      .fn<Api["searchGameBananaMods"]>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const api = apiWith(search);
    await render(api);

    await act(async () => latest.setSort("likes"));
    expect(latest.page).toBeNull();
    expect(latest.loading).toBe(true);
    await act(async () => second.resolve(result(2, "Newest")));
    expect(latest.page?.records[0].id).toBe(2);
    await act(async () => first.resolve(result(1, "Obsolete")));
    expect(latest.page?.records[0].id).toBe(2);
  });

  it("refreshes through both cache layers and labels a failed cached fallback", async () => {
    const search = vi
      .fn<Api["searchGameBananaMods"]>()
      .mockResolvedValueOnce(result(1, "Cached"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(result(2, "Recovered"));
    const api = apiWith(search);
    await render(api);
    await act(async () => Promise.resolve());
    expect(latest.page?.records[0].id).toBe(1);

    await act(async () => latest.refresh());
    expect(search.mock.calls[1][5]).toBe(true);
    expect(latest.page?.records[0].id).toBe(1);
    expect(latest.stale).toBe(true);
    expect(latest.error).toContain("Showing saved results");

    await act(async () => latest.retry());
    expect(search.mock.calls[2][5]).toBe(true);
    expect(latest.page?.records[0].id).toBe(2);
    expect(latest.stale).toBe(false);
  });

  it("retries an unchanged query and validates name filters without a request", async () => {
    const search = vi
      .fn<Api["searchGameBananaMods"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(result(2));
    const api = apiWith(search);
    await render(api);
    await act(async () => Promise.resolve());
    expect(latest.error).toBe("offline");
    await act(async () => latest.submitSearch());
    expect(search).toHaveBeenCalledTimes(2);
    expect(latest.page?.records[0].id).toBe(2);

    await act(async () => latest.setQuery("rocket, trail"));
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(latest.error).toContain("commas");
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("revalidates an expired page and keeps it only as a labeled same-key fallback", async () => {
    const search = vi
      .fn<Api["searchGameBananaMods"]>()
      .mockResolvedValueOnce(result(1, "Saved", 1_000))
      .mockRejectedValueOnce(new Error("offline"));
    const api = apiWith(search);
    await render(api);
    await act(async () => Promise.resolve());
    clock += 1_001;

    active = false;
    await render(api);
    active = true;
    await render(api);
    await act(async () => Promise.resolve());
    expect(search).toHaveBeenCalledTimes(2);
    expect(latest.page?.records[0].name).toBe("Saved");
    expect(latest.stale).toBe(true);
  });
});
