// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFICIAL_ADDON_DETAILS } from "./lib/comfig-ui";
import { ViewmodelSettings, type ViewmodelSettingsProps } from "./ViewmodelSettings";

const status = vi.hoisted(() => ({ running: false, busy: false }));
vi.mock("./hooks/useAppStatus", () => ({ useAppStatus: () => status }));

let root: Root;
let box: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  status.running = false;
  status.busy = false;
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});

afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render(overrides: Partial<ViewmodelSettingsProps> = {}) {
  await act(async () =>
    root.render(
      <ViewmodelSettings
        profileId="profile-a"
        effective={{}}
        managedText=""
        cfgReady
        transparentViewmodels={false}
        canUseComfigAddons
        onToggleTransparentViewmodels={() => undefined}
        onSave={async () => undefined}
        {...overrides}
      />,
    ),
  );
}

function control(testId: string) {
  const found = box.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!found) throw new Error(`Missing ${testId}`);
  return found;
}

describe("Viewmodels in-game settings", () => {
  it("shows the profile's values and autosaves a change to the shared managed cfg", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    await render({
      effective: { viewmodel_fov: "54.12345", tf_use_min_viewmodels: "1" },
      onSave: save,
    });
    expect((control("viewmodel-fov") as unknown as HTMLInputElement).value).toBe("54");
    expect(box.textContent).toContain("54.12345°");
    expect(control("viewmodel-min").getAttribute("aria-checked")).toBe("true");

    await act(async () => control("viewmodel-flip").click());
    await act(async () => vi.advanceTimersByTimeAsync(701));
    expect(save).toHaveBeenCalledTimes(1);
    const text = save.mock.calls[0][0];
    expect(text).toContain("\ncl_flipviewmodels 1\n");
    expect(text).toContain("\nviewmodel_fov 54.12345\n");
    expect(text).toContain("\ntf_use_min_viewmodels 1\n");
  });

  it("explains that Draw viewmodel off hides every per-weapon choice", async () => {
    await render({ managedText: "r_drawviewmodel 0\n" });
    expect(control("viewmodel-draw").getAttribute("aria-checked")).toBe("false");
    expect(box.textContent).toContain("Every viewmodel is hidden in game");
    await act(async () => control("viewmodel-draw").click());
    expect(box.textContent).not.toContain("Every viewmodel is hidden in game");
  });

  it("defers cvar saves while TF2 runs but keeps the addon write locked", async () => {
    status.running = true;
    const save = vi.fn(async (_text: string) => undefined);
    const toggle = vi.fn();
    await render({ onSave: save, onToggleTransparentViewmodels: toggle });
    expect(control("viewmodel-min").disabled).toBe(false);
    expect(control("viewmodel-transparent").disabled).toBe(true);
    await act(async () => control("viewmodel-transparent").click());
    expect(toggle).not.toHaveBeenCalled();
    await act(async () => control("viewmodel-min").click());
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(save).not.toHaveBeenCalled();
  });

  it("reuses the Comfig addon with its real prerequisites and a route to Comfig", async () => {
    const toggle = vi.fn();
    const onOpenComfig = vi.fn();
    await render({
      transparentViewmodels: true,
      onToggleTransparentViewmodels: toggle,
      onOpenComfig,
    });
    expect(control("viewmodel-transparent").getAttribute("aria-checked")).toBe("true");
    expect(box.textContent).toContain(OFFICIAL_ADDON_DETAILS["transparent-viewmodels"]);
    await act(async () => control("viewmodel-transparent").click());
    expect(toggle).toHaveBeenCalledOnce();
    const open = [...box.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Open Comfig addons",
    );
    await act(async () => open?.click());
    expect(onOpenComfig).toHaveBeenCalledOnce();
  });

  it("offers the addon only to Comfig profiles and waits for a complete cfg read", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    await render({ canUseComfigAddons: false, cfgReady: false, onSave: save });
    expect(control("viewmodel-transparent").disabled).toBe(true);
    expect(box.textContent).toContain("Available with a Comfig profile.");
    expect(control("viewmodel-min").disabled).toBe(true);
    expect((control("viewmodel-fov") as unknown as HTMLInputElement).disabled).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(save).not.toHaveBeenCalled();
  });
});
