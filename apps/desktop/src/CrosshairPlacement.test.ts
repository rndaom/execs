import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CrosshairPane } from "./CrosshairPane";
import { GameplayPane } from "./GameplayPane";
import { AppStatusProvider } from "./hooks/useAppStatus";

const STATUS = { error: null, setError: () => undefined, busy: false, running: false };

function renderGameplay() {
  return renderToStaticMarkup(
    createElement(
      AppStatusProvider,
      { value: STATUS },
      createElement(GameplayPane, {
        layer: "comfig",
        effective: {},
        managedText: 'cl_crosshair_file ""\ncl_crosshair_scale 32\n',
        transparentViewmodels: false,
        canUseComfigAddons: true,
        onToggleTransparentViewmodels: () => undefined,
        onSave: () => undefined,
      }),
    ),
  );
}

function renderCrosshair(running = false, managedText?: string) {
  return renderToStaticMarkup(
    createElement(
      AppStatusProvider,
      { value: { ...STATUS, running } },
      createElement(CrosshairPane, {
        layer: "comfig",
        effective: {},
        managedText:
          managedText ??
          [
            "fov_desired 90",
            "viewmodel_fov 70",
            "cl_crosshair_file crosshair3",
            "cl_crosshair_scale 40",
            "cl_crosshair_red 10",
            "cl_crosshair_green 20",
            "cl_crosshair_blue 30",
          ].join("\n"),
        record: null,
        onSaveStock: () => undefined,
        onApply: () => undefined,
        onRemove: () => undefined,
      }),
    ),
  );
}

describe("crosshair settings placement", () => {
  it("keeps default crosshair controls out of Gameplay but offers transparent viewmodels", () => {
    const markup = renderGameplay();

    expect(markup).toContain('data-testid="settings-gameplay"');
    expect(markup).not.toContain("stock-crosshair-settings");
    expect(markup).not.toContain("gameplay-crosshair-file");
    expect(markup).toContain('data-testid="gameplay-transparent-viewmodels"');
  });

  it("places default crosshair controls before the custom crosshair builder", () => {
    const markup = renderCrosshair();
    const stockStart = markup.indexOf('data-testid="stock-crosshair-settings"');
    const builderStart = markup.indexOf("Custom crosshairs");

    expect(stockStart).toBeGreaterThanOrEqual(0);
    expect(builderStart).toBeGreaterThan(stockStart);
    expect(markup).toContain('data-testid="stock-crosshair-file"');
    expect(markup).toContain('data-testid="crosshair-preview"');
    expect(markup).toContain('data-testid="crosshair-apply"');
    expect(markup).toContain('data-testid="crosshair-color"');
  });

  it("renders the selected stock crosshair shape in the live preview", () => {
    const markup = renderCrosshair();
    // cl_crosshair_file crosshair3 = open circle: the SVG carries the file id
    // and circle geometry, not a hardcoded plus.
    expect(markup).toContain('data-testid="stock-crosshair-shape"');
    expect(markup).toContain('data-file="crosshair3"');
    expect(markup).toContain("<circle");
    const crosshair7 = renderCrosshair(false, "cl_crosshair_file crosshair7\n");
    expect(crosshair7).toContain('data-file="crosshair7"');
    expect(crosshair7).toContain("<rect");
    expect(crosshair7).not.toContain("<circle");
  });

  it("offers an all-classes tab with per-slot assignment", () => {
    const markup = renderCrosshair();
    expect(markup).toContain('id="crosshair-class-tab-all"');
    expect(markup).toContain('data-testid="crosshair-all-classes"');
    expect(markup).toContain('data-testid="crosshair-slot-primary"');
    expect(markup).toContain('data-testid="crosshair-slot-melee"');
  });

  it("locks both stock and custom controls while TF2 is running", () => {
    const markup = renderCrosshair(true);

    expect(markup).toMatch(/data-testid="stock-crosshair-file"[^>]*disabled=""/);
    expect(markup).toMatch(/data-testid="stock-crosshair-apply"[^>]*disabled=""/);
    expect(markup).toMatch(/data-testid="crosshair-apply"[^>]*disabled=""/);
  });
});
