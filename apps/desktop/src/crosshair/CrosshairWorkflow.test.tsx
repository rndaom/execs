// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrosshairPane } from "../CrosshairPane";
import { AppStatusProvider } from "../hooks/useAppStatus";
import { AutosaveActivity, AutosavePending } from "../hooks/useAutosave";
import type { ContentIndex, CrosshairRecord, CrosshairSourceStatus } from "../lib/bridge";
import { ColorPicker } from "./ColorPicker";
import { CrosshairDesigner, type CrosshairDesignerDraft } from "./CrosshairDesigner";
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
let gameResolution: { width: number; height: number; windowed?: boolean } | null;
let launchOptions: string;
let profileId: string;
const save = vi.fn(async (_text: string) => undefined);
const build = vi.fn(async (..._args: unknown[]) => true);
const deactivate = vi.fn(async (_stock?: { file: string; scale: number }) => true);
const remove = vi.fn();
const pending = vi.fn();
const openHud = vi.fn();
const openMods = vi.fn();
const previewVtf = vi.fn(async (_bytes: number[]) => ({
  width: 32,
  height: 32,
  rgba: Array(32 * 32 * 4).fill(255),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  try {
    window.localStorage.clear();
  } catch {
    // jsdom without storage
  }
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
  gameResolution = { width: 1920, height: 1080, windowed: false };
  launchOptions = "";
  profileId = "A";
  managed =
    'cl_crosshair_file ""\ncl_crosshair_scale 32\ncl_crosshair_red 17\ncl_crosshair_green 123\ncl_crosshair_blue 241\n';
  for (const mock of [save, build, deactivate, remove, pending, openHud, openMods, previewVtf]) {
    mock.mockClear();
  }
  build.mockImplementation(async () => true);
  deactivate.mockImplementation(async () => true);
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
              profileId={profileId}
              layer="vanilla"
              effective={{}}
              managedText={managed}
              record={record}
              onSaveStock={save}
              onApply={build}
              onDeactivate={deactivate}
              onRemove={remove}
              hudOverlayState={hudOverlayState}
              hudName="Example HUD"
              onOpenHud={openHud}
              stockArtSources={stockArtSources}
              sourceStatus={sourceStatus}
              onOpenMods={openMods}
              gameResolution={gameResolution}
              launchOptions={launchOptions}
              onPreviewVtf={previewVtf}
            />
          </AutosaveActivity.Provider>
        </AutosavePending.Provider>
      </AppStatusProvider>,
    ),
  );
}
function element<T extends HTMLElement>(selector: string): T {
  const found = box.querySelector<T>(selector) ?? document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}
function saved(): CrosshairRecord {
  if (!record) throw new Error("Expected a saved crosshair pack");
  return record;
}
function maybe(selector: string) {
  return box.querySelector(selector);
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
async function pickFile(name: string, bytes: number[]) {
  await act(async () => {
    const field = element<HTMLInputElement>('[data-testid="crosshair-import-file"]');
    Object.defineProperty(field, "files", {
      configurable: true,
      value: [new File([new Uint8Array(bytes)], name)],
    });
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // File reads resolve over a few microtasks.
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}
async function elapsed() {
  await act(async () => vi.advanceTimersByTimeAsync(701));
}
function checked(name: string) {
  return element<HTMLInputElement>(`[data-testid="crosshair-shape-${name}"]`).checked;
}
function text(selector: string) {
  return element(selector).textContent ?? "";
}

describe("crosshair choice and what applying it takes", () => {
  it("shows TF2's sprites, execs shapes and the player's own crosshairs in one gallery", async () => {
    record = { ...saved(), library: { "design-mine": "rgba" } };
    await render();
    for (const name of [
      "tf-default",
      "tf-crosshair1",
      "tf-crosshair7",
      "shape-dot",
      "design-mine",
    ]) {
      expect(maybe(`[data-testid="crosshair-shape-${name}"]`), name).not.toBeNull();
    }
    expect(maybe('[data-testid="crosshair-new-design"]')).not.toBeNull();
    expect(maybe('[data-testid="crosshair-import"]')).not.toBeNull();
    expect(box.querySelector("select")).toBeNull();
    expect(maybe('[data-testid="crosshair-build"]')).toBeNull();
    expect(text('[data-testid="crosshair-live-state"]')).toBe("Custom pack on");
  });

  it("lets TF2 draw its own sprite with no pack: the choice autosaves like size and colour", async () => {
    record = null;
    managed = "cl_crosshair_file crosshair3\ncl_crosshair_scale 24\n";
    await render();
    expect(checked("tf-crosshair3")).toBe(true);
    await click('[data-testid="crosshair-shape-tf-crosshair5"]');
    expect(maybe('[data-testid="crosshair-build"]')).toBeNull();
    await elapsed();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toContain("cl_crosshair_file crosshair5");
    expect(build).not.toHaveBeenCalled();
  });

  it("asks for an explicit build for a custom crosshair and holds size until then", async () => {
    record = null;
    managed = "cl_crosshair_file crosshair3\ncl_crosshair_scale 24\n";
    await render();
    await click('[data-testid="crosshair-shape-shape-dot"]');
    expect(pending).toHaveBeenLastCalledWith(expect.any(String), true);
    expect(text('[data-testid="crosshair-pending"]')).toContain("Nothing changes in TF2");
    await input("#stock-crosshair-scale", "40");
    await elapsed();
    expect(save).not.toHaveBeenCalled();
    await click('[data-testid="crosshair-build"]');
    expect(build).toHaveBeenCalledWith(
      "shape-dot",
      {},
      undefined,
      [200, 200, 200],
      { "shape-dot": { format: "rgba", bytes: expect.any(Array) } },
      null,
      expect.objectContaining({
        scale: 40,
        stock: { file: "crosshair3", scale: 40 },
        libraryNames: ["shape-dot"],
      }),
    );
    const sent = build.mock.calls[0][4] as Record<string, { bytes: number[] }>;
    expect(sent["shape-dot"].bytes).toHaveLength(64 * 64 * 4);
  });

  it("switches back to TF2's crosshair in one action that carries the sprite and size", async () => {
    await render();
    await click('[data-testid="crosshair-shape-tf-crosshair5"]');
    expect(text('[data-testid="crosshair-pending"]')).toContain("TF2 will draw its own crosshair");
    await elapsed();
    expect(save).not.toHaveBeenCalled();
    await click('[data-testid="crosshair-use-tf2"]');
    expect(deactivate).toHaveBeenCalledWith({ file: "crosshair5", scale: 32 });
    expect(build).not.toHaveBeenCalled();
  });

  it("builds a TF2 sprite with per-weapon exceptions as a pack", async () => {
    await render();
    await click('[data-testid="crosshair-shape-tf-crosshair5"]');
    await click("#crosshair-class-tab-scout");
    await click('[data-testid="crosshair-weapon-tf_weapon_scattergun"]');
    expect(text('[data-testid="crosshair-editor-target"]')).toBe("Scattergun");
    await click('[data-testid="crosshair-weapon-option-shape-dot"]');
    expect(text('[data-testid="crosshair-weapon-count"]')).toContain("1 weapon uses");
    await click('[data-testid="crosshair-build"]');
    expect(build.mock.calls[0][0]).toBe("tf-crosshair5");
    expect(build.mock.calls[0][1]).toEqual({ tf_weapon_scattergun: "shape-dot" });
    expect((build.mock.calls[0][6] as { stock: { file: string } }).stock.file).toBe("crosshair5");
  });

  it("discards pending choices without writing", async () => {
    await render();
    await click('[data-testid="crosshair-shape-shape-circle"]');
    await click('[data-testid="crosshair-discard"]');
    expect(checked("cross")).toBe(true);
    expect(maybe('[data-testid="crosshair-build"]')).toBeNull();
    expect(pending).toHaveBeenLastCalledWith(expect.any(String), false);
    expect(build).not.toHaveBeenCalled();
  });

  it("keeps the choice and the bar after a rejected build", async () => {
    build.mockRejectedValueOnce(new Error("disk refused"));
    await render();
    await click('[data-testid="crosshair-shape-shape-circle"]');
    await click('[data-testid="crosshair-build"]');
    expect(checked("shape-circle")).toBe(true);
    expect(text('[data-testid="crosshair-pending"]')).toContain("not in TF2 yet");
  });

  it("defers size edits while the game runs and keeps the pack builder locked", async () => {
    running = true;
    await render();
    await click('[data-testid="crosshair-shape-shape-dot"]');
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

  it("retains an unbuilt shape through a colour autosave", async () => {
    await render();
    await click('[data-testid="crosshair-shape-shape-dot"]');
    await input("input[aria-invalid]", "#137bfa");
    await elapsed();
    expect(save).toHaveBeenCalledTimes(1);
    expect(build).not.toHaveBeenCalled();
    record = { ...saved(), color: [19, 123, 250] };
    managed += "cl_crosshair_red 19\ncl_crosshair_blue 250\n";
    await render();
    expect(checked("shape-dot")).toBe(true);
    await click('[data-testid="crosshair-build"]');
    expect(build).toHaveBeenCalledWith(
      "shape-dot",
      {},
      undefined,
      [19, 123, 250],
      expect.objectContaining({ "shape-dot": expect.any(Object) }),
      null,
      expect.objectContaining({ scale: 32 }),
    );
  });

  it("applies a colour swatch exactly", async () => {
    await render();
    await click('[data-testid="crosshair-swatch-green"]');
    await elapsed();
    expect(save.mock.calls[0][0]).toContain("cl_crosshair_red 0");
    expect(save.mock.calls[0][0]).toContain("cl_crosshair_green 255");
  });
});

describe("a confirmed build reads as saved", () => {
  // Field bug: Build crosshair pack succeeded, yet "These changes are not in
  // TF2 yet" stayed however often it was pressed.
  it("clears once the native record returns sorted and without an unused execs shape", async () => {
    record = { ...saved(), shape: "shape-cross", library: { "shape-cross": "rgba" } };
    await render();
    for (const name of ["Zeta", "Alpha"]) {
      await click('[data-testid="crosshair-new-design"]');
      await input('input[aria-label="Design name"]', name);
      await click('[data-testid="crosshair-designer-save"]');
    }
    expect(checked("design-alpha")).toBe(true);
    await click('[data-testid="crosshair-build"]');
    const [shape, assignments, , color, , design, settings] = build.mock.calls[0] as [
      string,
      Record<string, string>,
      unknown,
      [number, number, number],
      unknown,
      string,
      { libraryNames: string[] },
    ];
    // The native build drops the unused shape and keeps names sorted.
    expect(settings.libraryNames).toEqual(["design-zeta", "design-alpha"]);
    record = {
      ...saved(),
      shape,
      assignments,
      color,
      library: { "design-alpha": "rgba", "design-zeta": "rgba" },
      design,
    };
    managed =
      'cl_crosshair_file ""\ncl_crosshair_scale 32\ncl_crosshair_red 17\ncl_crosshair_green 123\ncl_crosshair_blue 241\n';
    await render();
    expect(maybe('[data-testid="crosshair-build"]')).toBeNull();
    expect(pending).toHaveBeenLastCalledWith(expect.any(String), false);
    // Later edits still count, and a later reload still applies.
    await click('[data-testid="crosshair-shape-shape-dot"]');
    expect(maybe('[data-testid="crosshair-build"]')).not.toBeNull();
  });
});

describe("designs and imports", () => {
  it("retains an open design across pane visits and saves it without building", async () => {
    await render();
    await click('[data-testid="crosshair-new-design"]');
    await input('input[aria-label="Design name"]', "Retained design");
    await input("#designer-size", "19");
    expect(pending).toHaveBeenLastCalledWith(expect.any(String), true);
    expect(maybe('[data-testid="crosshair-build"]')).toBeNull();
    active = false;
    await render();
    active = true;
    await render();
    expect(element<HTMLInputElement>('input[aria-label="Design name"]').value).toBe(
      "Retained design",
    );
    expect(element<HTMLInputElement>("#designer-size").value).toBe("19");
    await click('[data-testid="crosshair-designer-save"]');
    await elapsed();
    expect(save).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(checked("design-retained-design")).toBe(true);
    await click('[data-testid="crosshair-build"]');
    expect(build).toHaveBeenCalledWith(
      "design-retained-design",
      {},
      undefined,
      [17, 123, 241],
      expect.objectContaining({ "design-retained-design": expect.any(Object) }),
      expect.stringContaining("Retained design"),
      expect.any(Object),
    );
  });

  it("starts a new design from the selected execs shape and keeps the shape", async () => {
    await render();
    await click('[data-testid="crosshair-shape-shape-circle"]');
    await click('[data-testid="crosshair-new-design"]');
    expect(
      element<HTMLInputElement>('[data-testid="crosshair-designer-style-circle"]').checked,
    ).toBe(true);
    expect(element<HTMLInputElement>("#designer-size").value).toBe("7");
    await input('input[aria-label="Design name"]', "My circle");
    await click('[data-testid="crosshair-designer-save"]');
    expect(checked("design-my-circle")).toBe(true);
    expect(maybe('[data-testid="crosshair-shape-shape-circle"]')).not.toBeNull();
  });

  it("edits a saved design in place without moving the main crosshair", async () => {
    record = {
      ...saved(),
      shape: "cross",
      assignments: { tf_weapon_bat: "design-bat" },
      library: { "design-bat": "rgba" },
      design: JSON.stringify({
        "design-bat": JSON.stringify({ style: "circle", size: 8, label: "Bat ring" }),
      }),
    };
    await render();
    expect(text('label[for="crosshair-choice-design-bat"]')).toContain("Bat ring");
    await click('[data-testid="crosshair-actions-design-bat"]');
    await click('[data-testid="crosshair-menu-edit"]');
    expect(element<HTMLInputElement>('input[aria-label="Design name"]').value).toBe("Bat ring");
    await input("#designer-rotation", "45");
    await click('[data-testid="crosshair-designer-save"]');
    expect(checked("cross")).toBe(true);
    expect(maybe('[data-testid="crosshair-shape-design-bat-ring"]')).toBeNull();
    await click('[data-testid="crosshair-build"]');
    const library = build.mock.calls[0][4] as Record<string, { bytes: number[] }>;
    expect(Object.keys(library)).toEqual(["design-bat"]);
    expect(build.mock.calls[0][5]).toContain('\\"rotation\\":45');
  });

  it("pastes a shared design code into the editor", async () => {
    await render();
    await click('[data-testid="crosshair-new-design"]');
    await click('[data-testid="crosshair-designer-paste-code"]');
    await input('input[aria-label="Design code"]', "nonsense");
    expect(text('[data-testid="crosshair-designer"]')).toContain("not an execs design code");
    const { designCode } = await import("../lib/crosshair-designer");
    const code = designCode(
      {
        style: "triangle",
        size: 10,
        thickness: 2,
        gap: 0,
        dot: true,
        dotSize: 1,
        outline: 0,
        shadow: false,
        opacity: 255,
      },
      "Shared",
    );
    await input('input[aria-label="Design code"]', code);
    await act(async () => {
      element<HTMLFormElement>('input[aria-label="Design code"]').closest("form")?.requestSubmit();
    });
    expect(element<HTMLInputElement>('input[aria-label="Design name"]').value).toBe("Shared");
    expect(
      element<HTMLInputElement>('[data-testid="crosshair-designer-style-triangle"]').checked,
    ).toBe(true);
  });

  it("imports a VTF under its file name after the native reader accepts it", async () => {
    await render();
    await pickFile("Bomo Reticle.vtf", [0x56, 0x54, 0x46, 0, 1, 2, 3]);
    expect(previewVtf).toHaveBeenCalledWith([0x56, 0x54, 0x46, 0, 1, 2, 3]);
    expect(checked("vtf-bomo-reticle")).toBe(true);
    await click('[data-testid="crosshair-build"]');
    expect(
      (build.mock.calls[0][4] as Record<string, { format: string }>)["vtf-bomo-reticle"],
    ).toEqual({
      format: "vtf",
      bytes: [0x56, 0x54, 0x46, 0, 1, 2, 3],
    });
  });

  it("refuses a file that is neither PNG nor VTF", async () => {
    await render();
    await pickFile("notes.png", [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(text('[data-testid="crosshair-import-error"]')).toContain("Choose a PNG or VTF");
    expect(previewVtf).not.toHaveBeenCalled();
  });

  it("removes a library crosshair with its assignments", async () => {
    record = {
      ...saved(),
      shape: "design-old",
      assignments: { tf_weapon_bat: "design-old" },
      library: { "design-old": "rgba" },
    };
    await render();
    await click('[data-testid="crosshair-actions-design-old"]');
    await click('[data-testid="crosshair-menu-remove"]');
    expect(maybe('[data-testid="crosshair-shape-design-old"]')).toBeNull();
    await click('[data-testid="crosshair-build"]');
    expect(build.mock.calls[0][0]).toBe("shape-cross");
    expect(build.mock.calls[0][1]).toEqual({});
    expect((build.mock.calls[0][6] as { libraryNames: string[] }).libraryNames).toEqual([
      "shape-cross",
    ]);
  });
});

describe("older packs and notices", () => {
  it("previews a legacy imported community shape under its migrated name", async () => {
    const legacy: CrosshairRecord = {
      ...saved(),
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
    record = {
      ...saved(),
      shape: "venom_circle",
      assignments: { tf_weapon_scattergun: "venom_dot" },
      library: { venom_circle: "vtf", venom_dot: "vtf" },
    };
    await render();
    expect(box.textContent).toContain("New Venom downloads are no longer offered");
    expect(checked("venom_circle")).toBe(true);
    expect(maybe('[data-testid="crosshair-shape-venom_dot"]')).not.toBeNull();
    await click('[data-testid="crosshair-shape-shape-dot"]');
    await click('[data-testid="crosshair-shape-venom_circle"]');
    // Back to the saved state: nothing to build.
    expect(maybe('[data-testid="crosshair-build"]')).toBeNull();
    await click('[data-testid="crosshair-shape-shape-circle"]');
    await click('[data-testid="crosshair-build"]');
    expect(build).toHaveBeenCalledWith(
      "shape-circle",
      { tf_weapon_scattergun: "venom_dot" },
      undefined,
      [17, 123, 241],
      expect.objectContaining({ "shape-circle": expect.any(Object) }),
      null,
      expect.objectContaining({ libraryNames: ["venom_circle", "venom_dot", "shape-circle"] }),
    );
  });

  it("keeps a non-prefixed legacy VTF selected", async () => {
    record = { ...saved(), shape: "bomo1", library: { bomo1: "vtf" } };
    await render();
    expect(checked("bomo1")).toBe(true);
  });

  it("restores per-weapon choices kept with a switched-off pack only when asked", async () => {
    record = {
      ...saved(),
      inactive: true,
      assignments: { tf_weapon_scattergun: "dot" },
    };
    managed = "cl_crosshair_file crosshair3\ncl_crosshair_scale 32\n";
    await render();
    expect(checked("tf-crosshair3")).toBe(true);
    expect(text('[data-testid="crosshair-live-state"]')).toBe("TF2 draws its own crosshair");
    expect(maybe('[data-testid="crosshair-build"]')).toBeNull();
    await act(async () =>
      [...box.querySelectorAll("button")].find((b) => b.textContent === "Restore them")?.click(),
    );
    expect(text('[data-testid="crosshair-weapon-count"]')).toContain("1 weapon uses");
    expect(maybe('[data-testid="crosshair-build"]')).not.toBeNull();
  });

  it("keeps an external material for every weapon and preserves it through size edits", async () => {
    record = null;
    managed = "cl_crosshair_file myreticle\ncl_crosshair_scale 32\n";
    await render();
    expect(checked("tf-external")).toBe(true);
    expect(text('[data-testid="crosshair-stage"]')).toContain("cannot be previewed");
    expect(element<HTMLButtonElement>('[data-testid="crosshair-slot-primary"]').disabled).toBe(
      true,
    );
    await input("#stock-crosshair-scale", "40");
    await elapsed();
    expect(save.mock.calls[0][0]).toContain("cl_crosshair_file myreticle");
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
    expect(maybe('[data-testid="crosshair-stock-art-notice"]')).toBeNull();
    await click('[data-testid="crosshair-shape-tf-crosshair3"]');
    expect(box.textContent).toContain("Alternate.vpk also supplies");
    expect(box.textContent).toContain("preview uses Valve's original sprite");
    await click('[data-testid="crosshair-stock-art-notice"] button');
    expect(openMods).toHaveBeenCalledTimes(1);
  });

  it("warns about outside edits and rebuilds on request", async () => {
    record = { ...saved(), sourceChanged: true };
    await render();
    expect(box.textContent).toContain("changed outside execs");
    await click('[data-testid="crosshair-source-changed"] button');
    expect(build.mock.calls[0][0]).toBe("cross");
  });

  it("warns when TF2 updates the scripts used to build a live pack", async () => {
    sourceStatus = { state: "changed" };
    await render();
    expect(box.textContent).toContain("TF2's weapon scripts changed since this pack was built");
    sourceStatus = { state: "unverified" };
    await render();
    expect(box.textContent).toContain("no recorded TF2 weapon-script version");
    record = { ...saved(), inactive: true };
    await render();
    expect(maybe('[data-testid="crosshair-script-source-status"]')).toBeNull();
  });

  it("removes the pack only after confirming", async () => {
    await render();
    await click('[data-testid="crosshair-more"]');
    await click('[data-testid="crosshair-remove-pack"]');
    expect(remove).not.toHaveBeenCalled();
    await click('[data-testid="crosshair-remove-confirm"]');
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("true-size preview", () => {
  it("reports the in-game pixels for the size and the resolution it assumes", async () => {
    managed = 'cl_crosshair_file ""\ncl_crosshair_scale 48\n';
    gameResolution = { width: 2560, height: 1440, windowed: false };
    await render();
    expect(text('[data-testid="crosshair-sprite-size"]')).toContain("96 × 96 px sprite");
    // The thin cross covers 8..55 of its 64 px sprite: 72 of the 96 drawn pixels.
    expect(text('[data-testid="crosshair-drawn-size"]')).toBe("72 × 72 px");
    expect(text('[data-testid="crosshair-display"]')).toContain("2560 × 1440");
    expect(text('[data-testid="crosshair-display-source"]')).toContain("TF2's video settings");
  });

  it("lets launch options win over the saved resolution", async () => {
    launchOptions = "-novid -w 1280 -h 720 -windowed";
    await render();
    expect(text('[data-testid="crosshair-display"]')).toContain("1280 × 720");
    expect(text('[data-testid="crosshair-display"]')).toContain("Windowed");
    expect(text('[data-testid="crosshair-display-source"]')).toContain("launch options");
  });

  it("explains weapon default instead of drawing a guess", async () => {
    record = null;
    managed = 'cl_crosshair_file ""\n';
    await render();
    expect(checked("tf-default")).toBe(true);
    expect(text('[data-testid="crosshair-stage"]')).toContain("Each weapon draws its own");
  });

  it("edits one weapon on the page and resets it to the main crosshair", async () => {
    record = { ...saved(), assignments: { tf_weapon_scattergun: "dot" } };
    await render();
    // Every class starts on the slot rows; a class tab lists its weapons.
    expect(text('[data-testid="crosshair-editor-target"]')).toBe("Every primary weapon");
    await click("#crosshair-class-tab-scout");
    await click('[data-testid="crosshair-weapon-tf_weapon_scattergun"]');
    expect(text('[data-testid="crosshair-editor-target"]')).toBe("Scattergun");
    expect(
      element('[data-testid="crosshair-weapon-tf_weapon_scattergun"]').getAttribute("aria-pressed"),
    ).toBe("true");
    await click('[data-testid="crosshair-weapon-option-main"]');
    expect(text('[data-testid="crosshair-weapon-count"]')).toContain("Every weapon uses");
    await click("#crosshair-class-tab-all");
    await click('[data-testid="crosshair-slot-melee"]');
    await click('[data-testid="crosshair-weapon-option-tf-default"]');
    expect(text('[data-testid="crosshair-weapon-count"]')).toMatch(/\d+ weapons use/);
    await click('[data-testid="crosshair-weapons-reset"]');
    expect(text('[data-testid="crosshair-weapon-count"]')).toContain("Every weapon uses");
  });
});

describe("pieces", () => {
  it("lets a legacy dot shrink below its hidden geometry floor", async () => {
    let value: CrosshairDesignerDraft = {
      name: "",
      design: {
        style: "dot",
        size: 24,
        thickness: 2,
        gap: 3,
        dot: false,
        dotSize: 8,
        outline: 1,
        shadow: false,
        opacity: 255,
      },
    };
    function Harness() {
      return (
        <CrosshairDesigner
          value={value}
          color={[255, 255, 255]}
          editing={null}
          onChange={(next) => {
            value = next;
          }}
          onClose={() => {}}
        />
      );
    }
    await act(async () => root.render(<Harness />));
    expect(maybe("#designer-size")).toBeNull();
    await input("#designer-dot-radius", "1");
    expect(value.design.dotSize).toBe(1);
    expect(value.design.size).toBe(4);
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

  it("discards edited pixels and never carries a preview into another profile", async () => {
    let api: CrosshairDraftApi | undefined;
    function Probe({ id, width }: { id: string; width: number }) {
      api = useCrosshairDraft(
        id,
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
    const { defaultCrosshairDesign } = await import("../lib/crosshair-designer");
    await act(async () => root.render(<Probe id="A" width={1} />));
    await act(async () => {
      api?.saveDesign(defaultCrosshairDesign(), "kept", "design-kept");
    });
    expect(api?.previewFor("design-kept")?.width).toBe(64);
    await act(async () => api?.discard());
    expect(api?.previewFor("design-kept")?.width).toBe(1);
    await act(async () => {
      api?.saveDesign(defaultCrosshairDesign(), "kept", "design-kept");
    });
    await act(async () => root.render(<Probe id="B" width={2} />));
    expect(api?.previewFor("design-kept")?.width).toBe(2);
  });
});
