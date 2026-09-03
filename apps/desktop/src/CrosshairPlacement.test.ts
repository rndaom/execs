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
        profileId: "profile-a",
        layer: "comfig",
        effective: {},
        managedText: 'cl_crosshair_file ""\ncl_crosshair_scale 32\n',
        transparentViewmodels: false,
        canUseComfigAddons: true,
        onToggleTransparentViewmodels: () => undefined,
        onSave: async () => undefined,
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
        profileId: "profile-a",
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
        onSaveStock: async () => undefined,
        onApply: async () => undefined,
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
    // Gameplay saves as you change it: no bar, no button, no lock message.
    expect(markup).not.toContain('data-testid="gameplay-apply"');
    expect(markup).not.toContain("Save gameplay");
    expect(markup).not.toMatch(/data-testid="gameplay-fov"[^>]*disabled=""/);
  });

  it("places default crosshair controls before the custom crosshair builder", () => {
    const markup = renderCrosshair();
    const stockStart = markup.indexOf('data-testid="stock-crosshair-settings"');
    const builderStart = markup.indexOf("Custom crosshairs");

    expect(stockStart).toBeGreaterThanOrEqual(0);
    expect(builderStart).toBeGreaterThan(stockStart);
    expect(markup).toContain('data-testid="stock-crosshair-file"');
    // Every stock file is a picture, not a dropdown line.
    expect(markup).toContain('data-testid="stock-crosshair-file-crosshair7"');
    expect(markup).not.toContain("<select");
    expect(markup).toContain('data-testid="crosshair-preview"');
    expect(markup).toContain('data-testid="crosshair-color"');
  });

  it("renders the selected stock crosshair shape in the live preview", () => {
    // The picker grid draws every file, so judge the hero preview alone.
    const hero = (markup: string) => {
      const start = markup.indexOf('data-testid="stock-crosshair-preview"');
      const end = markup.indexOf("Live preview", start);
      return markup.slice(start, end);
    };
    const markup = hero(renderCrosshair());
    // cl_crosshair_file crosshair3 = open circle: the SVG carries the file id
    // and circle geometry, not a hardcoded plus.
    expect(markup).toContain('data-testid="stock-crosshair-shape"');
    expect(markup).toContain('data-file="crosshair3"');
    expect(markup).toContain("<circle");
    const crosshair7 = hero(renderCrosshair(false, "cl_crosshair_file crosshair7\n"));
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

  it("saves by itself, with no Apply button on either half", () => {
    const markup = renderCrosshair();

    expect(markup).not.toContain('data-testid="crosshair-apply"');
    expect(markup).not.toContain('data-testid="stock-crosshair-apply"');
    expect(markup).not.toContain("Install pack");
    expect(markup).not.toContain("Save crosshair");
  });

  it("keeps the controls live while TF2 is running so a draft can be made", () => {
    // The write lock defers the save (and the toast says so); it no longer
    // takes the pictures and sliders away.
    const markup = renderCrosshair(true);

    expect(markup).toContain('data-testid="stock-crosshair-file-default"');
    expect(markup).not.toMatch(/data-testid="stock-crosshair-file-default"[^>]*disabled=""/);
    expect(markup).not.toMatch(/data-testid="stock-crosshair-file-crosshair3"[^>]*disabled=""/);
    expect(markup).not.toMatch(/data-testid="stock-crosshair-scale"[^>]*disabled=""/);
    expect(markup).not.toMatch(/data-testid="crosshair-color"[^>]*disabled=""/);
  });
});
