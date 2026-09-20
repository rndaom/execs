// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "../lib/api";
import type { GameBananaMod, GameBananaPage } from "../lib/bridge";
import { GameBananaBrowser } from "./GameBananaBrowser";

const records: GameBananaMod[] = [
  {
    id: 11,
    name: "A very descriptive rocket trail",
    author: "Rocket Author",
    category: "Effects",
    categoryId: 1090,
    likes: 42,
    views: 3_200,
    downloads: 800,
    addedAt: 1_700_000_000,
    updatedAt: null,
    modifiedAt: 1_700_000_000,
    thumb: "https://images.gamebanana.com/broken.jpg",
    url: "https://gamebanana.com/mods/11",
    mature: false,
  },
  {
    id: 12,
    name: "Second page skin",
    author: "Skin Author",
    category: "Skins",
    categoryId: 7951,
    likes: null,
    views: null,
    downloads: null,
    addedAt: null,
    updatedAt: null,
    modifiedAt: null,
    thumb: null,
    url: "https://gamebanana.com/mods/12",
    mature: false,
  },
];

function page(number: number): GameBananaPage {
  return {
    records: [records[number - 1]],
    total: { kind: "exact", value: 2 },
    perPage: 1,
    complete: number === 2,
    ordering: "server",
    filters: {
      query: "global",
      category: "global",
      contentRating: "global",
      installability: "global",
    },
    cache: { source: "network", freshForMs: 600_000 },
  };
}

let root: Root;
let box: HTMLDivElement;
let search: ReturnType<typeof vi.fn<Api["searchGameBananaMods"]>>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  search = vi.fn(async (_query, _sort, _category, number) => page(number));
});

afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function api(): Api {
  return {
    searchGameBananaMods: search,
    gameBananaModCategories: vi.fn(async () => []),
  } as unknown as Api;
}

async function render(onInstall = vi.fn(async () => true), locked = false) {
  await act(async () => {
    root.render(
      <GameBananaBrowser
        api={api()}
        active
        installed={[]}
        locked={locked}
        running={false}
        onInstall={onInstall}
      />,
    );
  });
  await act(async () => Promise.resolve());
}

describe("GameBananaBrowser presentation", () => {
  it("shows explicit card facts and keeps browsing available under the write lock", async () => {
    await render(
      vi.fn(async () => true),
      true,
    );

    expect(box.textContent).toContain("Effects");
    expect(box.textContent).toContain("Rocket Author · GameBanana");
    expect(box.textContent).toContain("800 downloads");
    expect(
      box.querySelector('button[aria-label="View A very descriptive rocket trail on GameBanana"]'),
    ).not.toBeNull();
    expect(box.querySelector<HTMLInputElement>('[data-testid="mods-gb-search"]')?.disabled).toBe(
      false,
    );
    expect(
      box.querySelector<HTMLButtonElement>('[data-testid="mods-gb-install-11"]')?.disabled,
    ).toBe(true);

    const image = box.querySelector<HTMLImageElement>("img");
    expect(image).not.toBeNull();
    await act(async () => image?.dispatchEvent(new Event("error")));
    expect(box.textContent).toContain("No preview");
  });

  it("keeps a failed install on its card with a mod-specific retry", async () => {
    const onInstall = vi.fn(async () => false);
    await render(onInstall);
    const install = box.querySelector<HTMLButtonElement>('[data-testid="mods-gb-install-11"]');
    await act(async () => install?.click());
    await act(async () => Promise.resolve());

    expect(onInstall).toHaveBeenCalledWith(11);
    expect(box.querySelector('[role="alert"]')?.textContent).toContain("Install failed");
    expect(install?.getAttribute("aria-label")).toBe("Retry A very descriptive rocket trail");
  });

  it("paginates above and below, then focuses results without stealing search focus", async () => {
    await render();
    expect(box.querySelector('[data-testid="mods-gb-page-next-top"]')).not.toBeNull();
    expect(box.querySelector('[data-testid="mods-gb-page-next"]')).not.toBeNull();
    expect(
      box.querySelector('[data-testid="mods-gb-page-label-top"]')?.getAttribute("aria-live"),
    ).toBe("polite");

    await act(async () => {
      box.querySelector<HTMLButtonElement>('[data-testid="mods-gb-page-next-top"]')?.click();
    });
    await act(async () => Promise.resolve());
    const results = box.querySelector<HTMLElement>('[data-testid="mods-gb-results-heading"]');
    expect(box.textContent).toContain("Second page skin");
    expect(document.activeElement).toBe(results);

    const input = box.querySelector<HTMLInputElement>('[data-testid="mods-gb-search"]');
    input?.focus();
    await act(async () => {
      box.querySelector<HTMLButtonElement>('[data-testid="mods-gb-refresh"]')?.click();
    });
    await act(async () => Promise.resolve());
    expect(document.activeElement).toBe(input);
  });
});
