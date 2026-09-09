// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrosshairPane } from "../CrosshairPane";
import { AppStatusProvider } from "../hooks/useAppStatus";
import { AutosavePending } from "../hooks/useAutosave";
import type { CrosshairRecord } from "../lib/bridge";
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
const save = vi.fn(async (_text: string) => undefined);
const build = vi.fn(async (..._args: unknown[]) => undefined);
const deactivate = vi.fn(async () => undefined);
const pending = vi.fn();

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
  managed =
    'cl_crosshair_file ""\ncl_crosshair_scale 32\ncl_crosshair_red 17\ncl_crosshair_green 123\ncl_crosshair_blue 241\n';
  save.mockReset();
  build.mockReset();
  deactivate.mockReset();
  pending.mockReset();
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
          />
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
