import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HudPane } from "./HudPane";
import { AppStatusProvider } from "./hooks/useAppStatus";
import { emptyHudState, PREVIEW_HUD_CATALOG } from "./lib/hud-ui";

const noop = () => undefined;

function renderHudPane(catalogLoading: boolean, catalogError: string | null): string {
  return renderToStaticMarkup(
    createElement(
      AppStatusProvider,
      { value: { error: null, setError: () => undefined, busy: false, running: false } },
      createElement(HudPane, {
        catalogLoading,
        catalogError,
        catalog: PREVIEW_HUD_CATALOG,
        state: emptyHudState(),
        schema: null,
        onRefresh: noop,
        onInstall: noop,
        onUpdate: noop,
        onMatch: noop,
        onApplyOptions: noop,
      }),
    ),
  );
}

describe("HudPane catalog status", () => {
  it("keeps cached catalog actions available while refresh reports progress", () => {
    const markup = renderHudPane(true, null);

    expect(markup).toContain("Checking for catalog updates");
    expect(markup).toContain('data-testid="hud-refresh" disabled=""');
    expect(markup).not.toContain('data-testid="hud-install-rayshud" disabled=""');
  });

  it("shows an inline refresh error without discarding cached entries", () => {
    const markup = renderHudPane(false, "The request timed out.");

    expect(markup).toContain("Could not refresh the HUD catalog.");
    expect(markup).toContain("The request timed out.");
    expect(markup).toContain('data-testid="hud-card-rayshud"');
  });
});
