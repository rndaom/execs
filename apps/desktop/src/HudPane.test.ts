import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HudPane } from "./HudPane";
import { AppStatusProvider } from "./hooks/useAppStatus";
import type { Api } from "./lib/api";
import { emptyHudState, HUD_CATALOG_PAGE_SIZE, PREVIEW_HUD_CATALOG } from "./lib/hud-ui";

const noop = () => undefined;

function renderHudPane(
  catalogLoading: boolean,
  catalogError: string | null,
  catalog = PREVIEW_HUD_CATALOG,
  status: { statsLoading?: boolean; statsError?: string | null; previewData?: boolean } = {},
): string {
  return renderToStaticMarkup(
    createElement(
      AppStatusProvider,
      { value: { error: null, setError: () => undefined, busy: false, running: false } },
      createElement(HudPane, {
        // The lightbox is the only consumer, and it is closed in every case here.
        api: {} as Api,
        profileId: "profile-a",
        catalogLoading,
        catalogError,
        catalog,
        stats: {},
        ...status,
        state: emptyHudState(),
        schema: null,
        onRefresh: noop,
        onInstall: noop,
        onUpdate: noop,
        onMatch: noop,
        onApplyOptions: async () => undefined,
        onImportArchive: noop,
        onImportFolder: noop,
      }),
    ),
  );
}

describe("HudPane catalog status", () => {
  it("keeps cached catalog actions available while refresh reports progress", () => {
    const markup = renderHudPane(true, null);

    expect(markup).toContain("Refreshing… showing 2 cached HUDs.");
    expect(markup).toContain('data-testid="hud-refresh" disabled=""');
    expect(markup).not.toContain('data-testid="hud-install-rayshud" disabled=""');
  });

  it("shows an inline refresh error without discarding cached entries", () => {
    const markup = renderHudPane(false, "The request timed out.");

    expect(markup).toContain("Could not refresh the catalog.");
    expect(markup).toContain("The request timed out.");
    expect(markup).toContain('data-testid="hud-card-rayshud"');
  });

  it("limits a long catalog and makes page selection available above and below the results", () => {
    const catalog = Array.from({ length: 45 }, (_, index) => ({
      ...PREVIEW_HUD_CATALOG[0],
      id: `hud-${index}`,
      name: `HUD ${index}`,
    }));
    const markup = renderHudPane(false, null, catalog);

    expect(markup.match(/data-testid="hud-card-/g)).toHaveLength(HUD_CATALOG_PAGE_SIZE);
    expect(markup).toContain('aria-label="HUD catalog pages, top"');
    expect(markup).toContain('aria-label="HUD catalog pages, bottom"');
    expect(markup).toContain('aria-label="Page 8"');
    expect(markup).toContain('data-testid="hud-page-jump-top"');
    expect(markup).toContain('data-testid="hud-page-jump-bottom"');
  });

  it("starts with one import entry point", () => {
    const markup = renderHudPane(false, null);

    expect(markup).toContain('data-testid="hud-import"');
    expect(markup).not.toContain('data-testid="hud-import-archive"');
    expect(markup).not.toContain('data-testid="hud-import-folder"');
  });

  it("reports stats loading and failure independently of a usable catalog", () => {
    const loading = renderHudPane(false, null, PREVIEW_HUD_CATALOG, { statsLoading: true });
    expect(loading).toContain("Loading dates and popularity…");
    expect(loading).not.toContain("Loading catalog…");
    expect(loading).toContain('data-testid="hud-card-rayshud"');

    const failed = renderHudPane(false, null, PREVIEW_HUD_CATALOG, {
      statsError: "The source timed out.",
    });
    expect(failed).toContain("Could not refresh dates and popularity.");
    expect(failed).toContain("The source timed out.");
    expect(failed).toContain('data-testid="hud-card-rayshud"');
    expect(failed).not.toContain('data-testid="hud-catalog-error"');
  });
});
