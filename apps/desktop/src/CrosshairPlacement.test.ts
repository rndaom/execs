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
        onSave: async () => undefined,
      }),
    ),
  );
}

function renderCrosshair(running = false, managedText?: string, custom = false) {
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
        record: custom ? { id: "execs-crosshairs", shape: "cross", assignments: {} } : null,
        onSaveStock: async () => undefined,
        onApply: async () => true,
        onRemove: () => undefined,
      }),
    ),
  );
}

describe("crosshair settings placement", () => {
  it("keeps default crosshair and viewmodel controls out of Gameplay", () => {
    const markup = renderGameplay();

    expect(markup).toContain('data-testid="settings-gameplay"');
    expect(markup).not.toContain("stock-crosshair-settings");
    expect(markup).not.toContain("gameplay-crosshair-file");
    expect(markup).not.toContain('data-testid="gameplay-transparent-viewmodels"');
    // Gameplay saves as you change it: no bar, no button, no lock message.
    expect(markup).not.toContain('data-testid="gameplay-apply"');
    expect(markup).not.toContain("Save gameplay");
    expect(markup).not.toMatch(/data-testid="gameplay-fov"[^>]*disabled=""/);
  });

  it("offers every crosshair as a picture with one size and color owner", () => {
    const markup = renderCrosshair();
    expect(markup).toContain('data-testid="crosshair-shape-tf-default"');
    expect(markup).toContain('data-testid="crosshair-shape-tf-crosshair7"');
    expect(markup).toContain('data-testid="crosshair-shape-shape-gap-dot"');
    // Retired execs shapes stay out of the gallery unless a profile uses one.
    expect(markup).not.toContain('data-testid="crosshair-shape-execs-chevron"');
    expect(markup).not.toContain("<select");
    expect(markup.match(/ id="stock-crosshair-scale"/g)).toHaveLength(1);
    expect(markup.match(/Hex color/g)).toHaveLength(1);
    // No mode switch: TF2's own sprites and custom ones are one choice.
    expect(markup).not.toContain("crosshair-mode-");
  });

  it("selects and previews TF2's live crosshair when no pack runs", () => {
    const markup = renderCrosshair();
    expect(markup).toMatch(/data-testid="crosshair-shape-tf-crosshair3"[^>]*checked/);
    expect(markup).toContain('data-testid="crosshair-stage-label">Open circle<');
    // cl_crosshair_file draws 2 × scale pixels: scale 40 is 80 px.
    expect(markup).toContain("80 × 80 px");
    const solid = renderCrosshair(false, "cl_crosshair_file crosshair7\n");
    expect(solid).toContain('data-testid="crosshair-stage-label">Solid plus<');
  });

  it("lays per-weapon crosshairs out on the page with class tabs", () => {
    const markup = renderCrosshair(false, undefined, true);
    expect(markup).toContain('id="crosshair-class-tab-all"');
    expect(markup).toContain('id="crosshair-class-tab-scout"');
    expect(markup).toContain('data-testid="crosshair-slot-primary"');
    expect(markup).toContain('data-testid="crosshair-slot-melee"');
    expect(markup).toContain("Every weapon uses the main crosshair.");
    // Choices are pictures beside the list, not a menu.
    expect(markup).toContain('data-testid="crosshair-weapon-option-main"');
  });

  it("shows no build or apply action while nothing needs writing", () => {
    for (const custom of [false, true]) {
      const markup = renderCrosshair(false, undefined, custom);
      expect(markup).not.toContain('data-testid="crosshair-build"');
      expect(markup).not.toContain('data-testid="crosshair-use-tf2"');
      expect(markup).not.toContain("Install pack");
      expect(markup).not.toContain("Save crosshair");
    }
    expect(renderCrosshair(false, 'cl_crosshair_file ""\n', true)).toContain("On in TF2.");
  });

  it("keeps the controls live while TF2 is running so a draft can be made", () => {
    // The write lock defers the save (and the toast says so); it no longer
    // takes the pictures and sliders away.
    const markup = renderCrosshair(true);

    expect(markup).toContain('data-testid="crosshair-shape-tf-default"');
    expect(markup).not.toMatch(/data-testid="crosshair-shape-tf-default"[^>]*disabled=""/);
    expect(markup).not.toMatch(/data-testid="crosshair-shape-shape-dot"[^>]*disabled=""/);
    expect(markup).not.toMatch(/data-testid="stock-crosshair-scale"[^>]*disabled=""/);
  });
});
