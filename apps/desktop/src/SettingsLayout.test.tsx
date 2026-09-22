// @vitest-environment jsdom
import { act, useEffect, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsTab } from "./lib/settings-ui";
import { SettingsLayout } from "./SettingsLayout";

let box: HTMLDivElement;
let root: Root;
let scrollTop: number;
let maximum: number;
let resize: () => void;
let heights: Record<string, number>;
const disconnect = vi.fn();
const mounted = vi.fn();
const unmounted = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = () => callback([], this as unknown as ResizeObserver);
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  heights = { launch: 0 };
  scrollTop = 0;
  maximum = 2000;
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});

afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
  vi.unstubAllGlobals();
});

function Content({ tab }: { tab: string }) {
  useEffect(() => {
    mounted();
    return () => unmounted();
  }, []);
  useLayoutEffect(() => {
    // Model the browser clamping an outer scroll region when React hides a
    // tall pane and reveals a short one, before the parent's layout lifecycle.
    maximum = heights[tab] ?? 2000;
    scrollTop = Math.min(scrollTop, maximum);
  }, [tab]);
  return <input aria-label="Retained draft" defaultValue="original" />;
}

function viewport() {
  const element = box.querySelector<HTMLElement>('[data-testid="settings-scroll"]');
  if (!element) throw new Error("Missing scroll region");
  return element;
}

async function render(tab: SettingsTab, identity = "install:profile-a", page: "app" | null = null) {
  await act(async () => {
    root.render(
      <SettingsLayout
        tab={tab}
        page={page}
        scrollIdentity={identity}
        onTab={() => undefined}
        utility={<button type="button">App settings</button>}
      >
        <Content tab={page ?? tab} />
      </SettingsLayout>,
    );
  });
  if (!Object.hasOwn(viewport(), "scrollTop")) {
    Object.defineProperty(viewport(), "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(value, maximum));
      },
    });
  }
}

async function scroll(position: number) {
  await act(async () => {
    viewport().scrollTop = position;
    viewport().dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

describe("pane scroll retention", () => {
  it("restores separate pane positions after a shorter pane clamps the scroll region", async () => {
    await render("comfig");
    await scroll(840);
    await render("hud");
    expect(viewport().scrollTop).toBe(0);
    await scroll(320);
    await render("launch");
    expect(viewport().scrollTop).toBe(0);
    await render("comfig");
    expect(viewport().scrollTop).toBe(840);
    await render("hud");
    expect(viewport().scrollTop).toBe(320);
  });

  it("resets customization positions for a different profile or confirmed install", async () => {
    await render("comfig");
    await scroll(840);
    await render("hud");
    await scroll(320);
    await render("hud", "install:profile-b");
    expect(viewport().scrollTop).toBe(0);
    await render("comfig", "install:profile-b");
    expect(viewport().scrollTop).toBe(0);
    await scroll(270);
    await render("comfig", "other-install:profile-b");
    expect(viewport().scrollTop).toBe(0);
  });

  it("keeps account-owned Inventory and global App settings positions across profile changes", async () => {
    await render("inventory");
    await scroll(460);
    await render("comfig");
    await render("comfig", "install:profile-a", "app");
    await scroll(190);
    await render("comfig", "install:profile-b", "app");
    expect(viewport().scrollTop).toBe(190);
    expect(box.querySelectorAll('[aria-current="page"]')).toHaveLength(0);
    await render("inventory", "install:profile-b");
    expect(viewport().scrollTop).toBe(460);
    expect(
      box.querySelector('[data-testid="settings-tab-inventory"]')?.getAttribute("aria-current"),
    ).toBe("page");
  });

  it("finishes restoration when delayed content grows without remounting drafts", async () => {
    await render("hud");
    const draft = box.querySelector<HTMLInputElement>("input");
    if (!draft) throw new Error("Missing draft");
    draft.value = "unsaved";
    await scroll(920);
    await render("launch");
    heights.hud = 80;
    await render("hud");
    expect(viewport().scrollTop).toBe(80);
    maximum = 1500;
    resize();
    expect(viewport().scrollTop).toBe(920);
    expect(box.querySelector("input")).toBe(draft);
    expect(draft.value).toBe("unsaved");
    expect(mounted).toHaveBeenCalledOnce();
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("lets deliberate user input cancel a delayed scroll restoration", async () => {
    await render("hud");
    await scroll(920);
    await render("launch");
    heights.hud = 80;
    await render("hud");
    viewport().dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await scroll(40);
    maximum = 1500;
    resize();
    expect(viewport().scrollTop).toBe(40);
    await render("launch");
    await render("hud");
    expect(viewport().scrollTop).toBe(40);
  });

  it("releases its layout observer on unmount", async () => {
    await render("comfig");
    await act(async () => root.render(null));
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
