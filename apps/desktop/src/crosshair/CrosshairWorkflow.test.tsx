// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrosshairPane } from "../CrosshairPane";
import { AppStatusProvider } from "../hooks/useAppStatus";
import { AutosaveActivity, AutosavePending } from "../hooks/useAutosave";
import type { ContentIndex, CrosshairRecord, CrosshairSourceStatus } from "../lib/bridge";
import { defaultCrosshairDesign, renderCrosshairDesign } from "../lib/crosshair-designer";
import { ColorPicker } from "./ColorPicker";
import { CrosshairDesigner } from "./CrosshairDesigner";
import { CrosshairPreview } from "./CrosshairPreview";
import { type CrosshairDraftApi, useCrosshairDraft } from "./useCrosshairDraft";

let root: Root;
let box: HTMLDivElement;
let record: CrosshairRecord | null;
let running: boolean;
let managed: string;
let active: boolean;
let hudOverlayState: "enabled" | "disabled" | "possible" | "none";
let stockArtSources: ContentIndex | null;
let sourceStatus: CrosshairSourceStatus | null;
const save = vi.fn(async (_text: string) => undefined);
const build = vi.fn(async (..._args: unknown[]) => true);
const deactivate = vi.fn(async () => undefined);
const pending = vi.fn();
const openHud = vi.fn();
const openMods = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
  record = {
    id: "execs-crosshairs",
    shape: "cross",
    assignments: {},
    scale: 32,
    stock: { file: "crosshair3", scale: 24 },
  };
  running = false;
  active = true;
  hudOverlayState = "none";
  stockArtSources = null;
  sourceStatus = null;
  managed =
    'cl_crosshair_file ""\ncl_crosshair_scale 32\ncl_crosshair_red 17\ncl_crosshair_green 123\ncl_crosshair_blue 241\n';
  save.mockReset();
  build.mockReset();
  deactivate.mockReset();
  pending.mockReset();
  openHud.mockReset();
  openMods.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () =>
    root.render(
      <AppStatusProvider value={{ running, busy: false, error: null, setError: () => {} }}>
        <AutosavePending.Provider value={pending}>
          <AutosaveActivity.Provider value={active}>
            <CrosshairPane
              profileId="A"
              layer="vanilla"
              effective={{}}
              managedText={managed}
              record={record}
              onSaveStock={save}
              onApply={build}
              onDeactivate={deactivate}
              onRemove={() => {}}
              hudOverlayState={hudOverlayState}
              hudName="Example HUD"
              onOpenHud={openHud}
              stockArtSources={stockArtSources}
              sourceStatus={sourceStatus}
              onOpenMods={openMods}
            />
          </AutosaveActivity.Provider>
        </AutosavePending.Provider>
      </AppStatusProvider>,
    ),
  );
}
function element<T extends HTMLElement>(selector: string): T {
  const found = box.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}
async function click(selector: string) {
  await act(async () => element(selector).click());
}
async function input(selector: string, value: string) {
  await act(async () => {
    const field = element<HTMLInputElement>(selector);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function elapsed() {
  await act(async () => vi.advanceTimersByTimeAsync(701));
}

describe("0.1.4 crosshair workflow", () => {
  it("previews a legacy imported community shape under its migrated name", async () => {
    if (!record) throw new Error("Expected a saved crosshair pack");
    const legacy: CrosshairRecord = {
      ...record,
      shape: "circle",
      assignments: { tf_weapon_scattergun: "dot" },
      library: { circle: "vtf", dot: "vtf" },
    };
    const previews = {
      circle: { width: 1, height: 1, rgba: [37, 38, 39, 255] },
      dot: { width: 1, height: 1, rgba: [40, 41, 42, 255] },
    };
    const captured: { draftApi?: CrosshairDraftApi } = {};
    function Harness() {
      captured.draftApi = useCrosshairDraft("A", legacy, previews);
      return null;
    }
    await act(async () => root.render(<Harness />));
    const draftApi = captured.draftApi;
    if (!draftApi) throw new Error("Expected a crosshair draft");
    expect(draftApi.draft.shape).toBe("venom_circle");
    expect(draftApi.draft.assignments.tf_weapon_scattergun).toBe("venom_dot");
    expect(draftApi.previewFor("venom_circle")).toEqual(previews.circle);
    expect(draftApi.previewFor("venom_dot")).toEqual(previews.dot);
  });

  it("keeps a retired catalog selection in the saved library without offering a download", async () => {
    if (!record) throw new Error("Expected a saved crosshair pack");
    record = {
      ...record,
      shape: "venom_circle",
      assignments: { tf_weapon_scattergun: "venom_dot" },
      library: { venom_circle: "vtf", venom_dot: "vtf" },
    };
    await render();
    expect(box.textContent).toContain("New Venom downloads are no longer offered");
    expect(box.textContent).toContain("Build pack reuses files already in the saved pack");
    expect(box.querySelector('[data-testid="crosshair-open-community"]')).toBeNull();
    await click('input[value="designs"]');
    expect(element<HTMLInputElement>('[data-testid="crosshair-shape-venom_circle"]').checked).toBe(
      true,
    );
    expect(box.querySelector('[data-testid="crosshair-shape-venom_dot"]')).not.toBeNull();
    await click('[data-testid="crosshair-build"]');
    expect(build).toHaveBeenCalledWith(
      "venom_circle",
      { tf_weapon_scattergun: "venom_dot" },
      undefined,
      [17, 123, 241],
      {},
      null,
      expect.objectContaining({ libraryNames: ["venom_circle", "venom_dot"] }),
    );
  });

  it("keeps a non-prefixed legacy VTF selected and selectable", async () => {
    if (!record) throw new Error("Expected a saved crosshair pack");
    record = { ...record, shape: "bomo1", library: { bomo1: "vtf" } };
    await render();
    await click('input[value="designs"]');
    expect(element<HTMLInputElement>('[data-testid="crosshair-shape-bomo1"]').checked).toBe(true);
    await click('[data-testid="crosshair-build"]');
    expect(build.mock.calls.at(-1)?.[0]).toBe("bomo1");
  });

  it("links to HUD controls when a HUD overlay can add another crosshair", async () => {
    hudOverlayState = "enabled";
    await render();
    expect(box.textContent).toContain("Example HUD has a crosshair overlay selected");
    await click('[data-testid="crosshair-hud-overlay-notice"] button');
    expect(openHud).toHaveBeenCalledTimes(1);
    hudOverlayState = "possible";
    await render();
    expect(box.textContent).toContain("in-game state cannot be confirmed");
  });

  it("identifies a modded stock sprite without treating Valve's preview as final", async () => {
    stockArtSources = {
      hits: {
        "materials/vgui/crosshairs/crosshair3.vtf": [
          {
            pack: "Alternate.vpk",
            member: "materials/vgui/crosshairs/crosshair3.vtf",
            kind: "vpk",
          },
        ],
      },
      incomplete: [],
    };
    await render();
    await click('[data-testid="crosshair-mode-stock"]');
    expect(box.textContent).toContain("Alternate.vpk also supplies");
    expect(box.textContent).toContain("preview uses Valve's original sprite");
    await click('[data-testid="crosshair-stock-art-notice"] button');
    expect(openMods).toHaveBeenCalledTimes(1);
  });

  it("warns when external edits make a saved pack's record unverified", async () => {
    if (!record) throw new Error("Expected a saved crosshair pack");
    record = { ...record, inactive: true, sourceChanged: true };
    await render();
    expect(box.textContent).toContain("saved crosshair pack changed outside execs");
    await click('[data-testid="crosshair-source-changed"] button');
    expect(box.querySelector('[data-testid="crosshair-build"]')).not.toBeNull();
  });

  it("warns when TF2 updates the scripts used to build a saved pack", async () => {
    sourceStatus = { state: "changed" };
    await render();
    expect(box.textContent).toContain("TF2's weapon scripts changed since this pack was built");
    sourceStatus = { state: "unverified" };
    await render();
    expect(box.textContent).toContain(
      "older crosshair pack has no recorded TF2 weapon-script version",
    );
  });

  it("retains an embedded design across pane visits and separates library save from pack build", async () => {
    await render();
    await click('input[value="designs"]');
    await click('[data-testid="crosshair-open-designer"]');
    await input('input[aria-label="Design name"]', "Retained design");
    await input("#designer-size", "19");
    expect(pending).toHaveBeenLastCalledWith(expect.any(String), true);
    expect(box.querySelector('[data-testid="crosshair-build"]')).toBeNull();
    active = false;
    await render();
    expect(box.querySelector('[data-testid="crosshair-designer"]')).toBeNull();
    active = true;
    await render();
    await click('[data-testid="crosshair-open-designer"]');
    expect(element<HTMLInputElement>('input[aria-label="Design name"]').value).toBe(
      "Retained design",
    );
    expect(element<HTMLInputElement>("#designer-size").value).toBe("19");
    await click('[data-testid="crosshair-designer-save"]');
    await elapsed();
    expect(save).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    await click('[data-testid="crosshair-build"]');
    expect(build).toHaveBeenCalledWith(
      "design-retained-design",
      {},
      undefined,
      [17, 123, 241],
      expect.objectContaining({ "design-retained-design": expect.any(Object) }),
      expect.any(String),
      expect.any(Object),
    );
  });
  it("customizes a fixed shape into a named design without replacing the preset", async () => {
    await render();
    await click('[data-testid="crosshair-shape-execs-diamond"]');
    expect(box.textContent).toContain("Customize shape");
    await click('[data-testid="crosshair-open-designer"]');
    expect(
      element<HTMLInputElement>('[data-testid="crosshair-designer-style-diamond"]').checked,
    ).toBe(true);
    await input('input[aria-label="Design name"]', "My diamond");
    await click('[data-testid="crosshair-designer-save"]');
    expect(
      element<HTMLInputElement>('[data-testid="crosshair-shape-design-my-diamond"]').checked,
    ).toBe(true);
    await click('[data-testid="crosshair-build"]');
    expect(build.mock.calls.at(-1)?.[0]).toBe("design-my-diamond");
    await click('input[value="builtin"]');
    expect(box.querySelector('[data-testid="crosshair-shape-execs-diamond"]')).not.toBeNull();
  });
  it("retains an unbuilt shape through a color autosave and forces an explicit build", async () => {
    await render();
    await click('[data-testid="crosshair-shape-dot"]');
    await input("input[aria-invalid]", "#137bfa");
    await elapsed();
    expect(save).toHaveBeenCalledTimes(1);
    expect(build).not.toHaveBeenCalled();
    if (!record) throw new Error("Expected a custom profile");
    record = { ...record, color: [19, 123, 250] };
    managed += "cl_crosshair_red 19\ncl_crosshair_blue 250\n";
    await render();
    expect(element<HTMLInputElement>('[data-testid="crosshair-shape-dot"]').checked).toBe(true);
    await click('[data-testid="crosshair-build"]');
    expect(build).toHaveBeenCalledWith(
      "dot",
      {},
      undefined,
      [19, 123, 250],
      {},
      null,
      expect.objectContaining({ scale: 32 }),
    );
    expect(box.textContent).not.toContain("Discard pending drafts");
  });
  it("defers size edits while the game runs and keeps the pack builder locked", async () => {
    running = true;
    await render();
    await input("#stock-crosshair-scale", "48");
    await elapsed();
    expect(save).not.toHaveBeenCalled();
    expect(element<HTMLButtonElement>('[data-testid="crosshair-build"]').disabled).toBe(true);
    running = false;
    await render();
    await elapsed();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toContain("cl_crosshair_scale 48");
  });
  it("changing mode does not write until its explicit action, and returning to Custom does not save a stock file", async () => {
    await render();
    await click('[data-testid="crosshair-mode-stock"]');
    await elapsed();
    expect(save).not.toHaveBeenCalled();
    expect(deactivate).not.toHaveBeenCalled();
    expect(element<HTMLInputElement>("#stock-crosshair-scale").value).toBe("24");
    await click('[data-testid="crosshair-mode-custom"]');
    await elapsed();
    expect(save).not.toHaveBeenCalled();
    expect(box.querySelector('[data-testid="stock-crosshair-file"]')).toBeNull();
    await click('[data-testid="crosshair-mode-stock"]');
    const button = [...box.querySelectorAll("button")].find(
      (b) => b.textContent === "Use in-game crosshair",
    );
    await act(async () => button?.click());
    expect(deactivate).toHaveBeenCalledTimes(1);
  });
  it("keeps unbuilt controls after a rejected build", async () => {
    build.mockRejectedValueOnce(new Error("disk refused"));
    await render();
    await click('[data-testid="crosshair-shape-execs-diamond"]');
    await click('[data-testid="crosshair-build"]');
    expect(element<HTMLInputElement>('[data-testid="crosshair-shape-execs-diamond"]').checked).toBe(
      true,
    );
    expect(box.textContent).toContain("not been built");
  });
  it("discards edited pixels and never carries a preview into another profile", async () => {
    let api: CrosshairDraftApi | undefined;
    function Probe({ profileId, width }: { profileId: string; width: number }) {
      api = useCrosshairDraft(
        profileId,
        {
          id: "execs-crosshairs",
          shape: "design-kept",
          assignments: {},
          library: { "design-kept": "rgba" },
        },
        { "design-kept": { width, height: 1, rgba: Array(width * 4).fill(255) } },
      );
      return null;
    }
    await act(async () => root.render(<Probe profileId="A" width={1} />));
    await act(async () => api?.saveDesign(defaultCrosshairDesign(), "kept"));
    expect(api?.previewFor("design-kept")?.width).toBe(64);
    await act(async () => api?.discard());
    expect(api?.previewFor("design-kept")?.width).toBe(1);
    await act(async () => api?.saveDesign(defaultCrosshairDesign(), "kept"));
    await act(async () => root.render(<Probe profileId="B" width={2} />));
    expect(api?.previewFor("design-kept")?.width).toBe(2);
  });
  it("lets a legacy dot shrink below its hidden geometry floor", async () => {
    const saved = vi.fn();
    const initial = { ...defaultCrosshairDesign(), style: "dot" as const, size: 24, dotSize: 8 };
    await act(async () =>
      root.render(
        <CrosshairDesigner open initial={initial} color={null} onSave={saved} onClose={() => {}} />,
      ),
    );
    expect(box.querySelector("#designer-size")).toBeNull();
    await input("#designer-dot-radius", "1");
    await click('[data-testid="crosshair-designer-save"]');
    const next = saved.mock.calls[0][0];
    expect(next.dotSize).toBe(1);
    expect(next.size).toBe(4);
    const visible = (pixels: Uint8ClampedArray) =>
      pixels.filter((_, i) => i % 4 === 3 && pixels[i] > 0).length;
    expect(visible(renderCrosshairDesign(next))).toBeLessThan(
      visible(renderCrosshairDesign(initial)),
    );
  });
  it("keeps the complete non-square sprite and scales each intrinsic dimension", async () => {
    await act(async () =>
      root.render(
        <CrosshairPreview
          shape="odd"
          customRgba={null}
          color={[17, 123, 241]}
          scale={64}
          preview={{ width: 31, height: 47, rgba: Array(31 * 47 * 4).fill(255) }}
        />,
      ),
    );
    const canvas = element<HTMLCanvasElement>("canvas");
    expect([canvas.width, canvas.height]).toEqual([31, 47]);
    expect(canvas.style.width).toBe(`${(62 / 1280) * 100}%`);
    expect(canvas.style.height).toBe("auto");
    const detail = element<HTMLCanvasElement>('[data-testid="crosshair-sprite-detail"]');
    expect([detail.width, detail.height]).toEqual([31, 47]);
    expect([detail.style.width, detail.style.height]).toEqual(["63px", "96px"]);
  });
  it("preserves invalid hex as an editable field without saving it and accepts pasted exact RGB", async () => {
    const change = vi.fn();
    await act(async () => root.render(<ColorPicker color={[17, 123, 241]} onChange={change} />));
    await input("input[aria-invalid]", "oops");
    expect(change).not.toHaveBeenCalled();
    expect(element("input[aria-invalid]").getAttribute("aria-invalid")).toBe("true");
    await input("input[aria-invalid]", "#117bf1");
    expect(change).toHaveBeenLastCalledWith([17, 123, 241]);
    expect(element("input[aria-invalid]").getAttribute("aria-invalid")).toBe("false");
  });
});
