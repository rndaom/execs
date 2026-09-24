import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameplayPane, type GameplayPaneProps } from "./GameplayPane";
import { OFFICIAL_ADDON_DETAILS } from "./lib/comfig-ui";

const status = vi.hoisted(() => ({ running: false, busy: false }));
vi.mock("./hooks/useAppStatus", () => ({ useAppStatus: () => status }));

let dom: JSDOM;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  status.running = false;
  status.busy = false;
  dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "http://localhost" });
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.getElementById("root") as HTMLElement);
});

afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(overrides: Partial<GameplayPaneProps> = {}) {
  root.render(
    createElement(GameplayPane, {
      profileId: "profile-a",
      layer: "comfig",
      effective: {},
      managedText: "",
      transparentViewmodels: false,
      canUseComfigAddons: true,
      onToggleTransparentViewmodels: () => undefined,
      onSave: async () => undefined,
      ...overrides,
    }),
  );
}

function control(testId: string) {
  return document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
}

describe("GameplayPane weapon controls", () => {
  it("keeps weapon drafts live while TF2 runs and preserves alternate modes on unlock", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    const props = {
      effective: { hud_fastswitch: "2", cl_autoreload: "0", viewmodel_fov: "54.12345" },
      onSave: save,
    };
    status.running = true;
    await act(async () => render(props));
    expect(control("gameplay-autoreload")?.disabled).toBe(false);
    expect(control("gameplay-fastswitch")?.getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain("weapon selection mode 2");
    expect(
      document.querySelector<HTMLInputElement>('[data-testid="gameplay-viewmodel-fov"]')?.value,
    ).toBe("54");
    expect(document.body.textContent).toContain("54.12345°");
    await act(async () => control("gameplay-autoreload")?.click());
    expect(control("gameplay-autoreload")?.getAttribute("aria-checked")).toBe("true");
    await act(async () => vi.runAllTimersAsync());
    expect(save).not.toHaveBeenCalled();

    status.running = false;
    await act(async () => render(props));
    await act(async () => Promise.resolve());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toContain("cl_autoreload 1\n");
    expect(save.mock.calls[0][0]).toContain("hud_fastswitch 2\n");
    expect(save.mock.calls[0][0]).toContain("viewmodel_fov 54.12345\n");
  });

  it("uses standard fast switching only when the player explicitly enables it", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    await act(async () => render({ effective: { hud_fastswitch: "2" }, onSave: save }));
    await act(async () => control("gameplay-fastswitch")?.click());
    expect(control("gameplay-fastswitch")?.getAttribute("aria-checked")).toBe("false");
    await act(async () => control("gameplay-fastswitch")?.click());
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toContain("hud_fastswitch 1\n");
  });

  it("keeps immediate addon writes locked while draft controls and advanced options stay available", async () => {
    status.running = true;
    const toggleAddon = vi.fn();
    await act(async () => render({ onToggleTransparentViewmodels: toggleAddon }));
    expect(control("gameplay-transparent-viewmodels")?.disabled).toBe(true);
    expect(control("gameplay-tracers")?.disabled).toBe(false);
    expect(control("gameplay-flip")?.disabled).toBe(false);
    expect(
      document.querySelector<HTMLDetailsElement>('[data-testid="gameplay-advanced"]')?.open,
    ).toBe(true);
    await act(async () => control("gameplay-transparent-viewmodels")?.click());
    expect(toggleAddon).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("not a live FOV preview");
  });

  it("shares transparent addon guidance and routes to its Comfig owner", async () => {
    const onOpenComfig = vi.fn();
    await act(async () => render({ onOpenComfig }));
    expect(document.body.textContent).toContain(OFFICIAL_ADDON_DETAILS["transparent-viewmodels"]);
    const link = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Open Comfig addons",
    );
    await act(async () => link?.click());
    expect(onOpenComfig).toHaveBeenCalledOnce();
  });
});
