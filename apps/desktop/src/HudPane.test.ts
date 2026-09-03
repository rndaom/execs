import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HudPane } from "./HudPane";
import { AppStatusProvider } from "./hooks/useAppStatus";
import type { Api } from "./lib/api";
import { emptyHudState, PREVIEW_HUD_CATALOG } from "./lib/hud-ui";

const noop = () => undefined;

function renderHudPane(catalogLoading: boolean, catalogError: string | null): string {
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
        catalog: PREVIEW_HUD_CATALOG,
        stats: {},
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
});
