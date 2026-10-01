// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { welcomeStepAfter, welcomeSteps } from "../lib/welcome-tour";
import { WelcomeTour } from "./WelcomeTour";

let node: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const title = () => document.querySelector(".welcome-title")?.textContent;

async function show(patch: Partial<Parameters<typeof WelcomeTour>[0]> = {}) {
  const props = {
    open: true,
    profileName: "Laptop current",
    origin: "saved" as const,
    offerComfig: true,
    onClose: vi.fn(),
    onTryComfig: vi.fn(),
    ...patch,
  };
  await act(async () => root.render(<WelcomeTour {...props} />));
  return props;
}

describe("welcome tour copy", () => {
  it("names the saved profile and never runs past either end", () => {
    const steps = welcomeSteps("Laptop current", "saved");
    expect(steps.map((step) => step.id)).toEqual(["saved", "sidebar", "profiles", "closed"]);
    expect(steps[0].body).toContain("“Laptop current”");
    expect(steps[0].body).toContain("Nothing in TF2 changed");
    expect(welcomeSteps(null, "created")[0].title).toBe("Your profile is ready");
    expect(welcomeStepAfter(0, -1, 4)).toBe(0);
    expect(welcomeStepAfter(3, 1, 4)).toBe(3);
  });
});

describe("WelcomeTour", () => {
  it("walks forward and back, then gets started", async () => {
    const props = await show();
    expect(title()).toBe("Your setup is saved");
    expect(q("welcome-back")).toBeNull();
    await act(async () => q("welcome-next")?.click());
    expect(title()).toBe("Change things from the sidebar");
    await act(async () => q("welcome-back")?.click());
    expect(title()).toBe("Your setup is saved");
    for (let step = 0; step < 3; step += 1) await act(async () => q("welcome-next")?.click());
    expect(title()).toBe("Change things while TF2 is closed");
    expect(q("welcome-skip")).toBeNull();
    await act(async () => q("welcome-done")?.click());
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("can be skipped from the first step", async () => {
    const props = await show();
    await act(async () => q("welcome-skip")?.click());
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("closes with Escape", async () => {
    const onClose = vi.fn();
    await show({ onClose });
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("pages with the arrow keys", async () => {
    await show();
    const body = document.querySelector(".welcome-body");
    await act(async () =>
      body?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(title()).toBe("Change things from the sidebar");
    await act(async () =>
      body?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
    );
    expect(title()).toBe("Your setup is saved");
  });

  it("offers mastercomfig only when the profile does not use it", async () => {
    const props = await show();
    for (let step = 0; step < 3; step += 1) await act(async () => q("welcome-next")?.click());
    await act(async () => q("welcome-try-comfig")?.click());
    expect(props.onTryComfig).toHaveBeenCalledOnce();

    await act(async () => root.render(<></>));
    await show({ offerComfig: false });
    for (let step = 0; step < 3; step += 1) await act(async () => q("welcome-next")?.click());
    expect(q("welcome-try-comfig")).toBeNull();
  });
});
