import { JSDOM } from "jsdom";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HudPane } from "./HudPane";
import { AppStatusProvider } from "./hooks/useAppStatus";
import type { Api } from "./lib/api";
import {
  emptyHudState,
  PREVIEW_HUD_CATALOG,
  PREVIEW_HUD_SCHEMA,
  previewInstalledState,
} from "./lib/hud-ui";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLButtonElement: dom.window.HTMLButtonElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLAnchorElement: dom.window.HTMLAnchorElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  Element: dom.window.Element,
  IS_REACT_ACT_ENVIRONMENT: true,
});

type Props = ComponentProps<typeof HudPane>;
const nextHud = { ...PREVIEW_HUD_CATALOG[0], id: "budhud", name: "budhud", author: "bud" };
let root: Root;
let container: HTMLDivElement;
let props: Props;
let running: boolean;

function element(testId: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!node) throw new Error(`Missing ${testId}: ${container.textContent}`);
  return node;
}

async function click(testId: string) {
  await act(async () => element(testId).click());
}

async function surface(id: "browse" | "installed") {
  await act(async () => document.getElementById(`hud-surface-${id}`)?.click());
}

function selectedSurface(): string | null {
  return container.querySelector('[role="tab"][aria-selected="true"]')?.id ?? null;
}

async function render(changes: Partial<Props> = {}) {
  props = { ...props, ...changes };
  await act(async () =>
    root.render(
      <AppStatusProvider value={{ error: null, setError: vi.fn(), busy: false, running }}>
        <HudPane {...props} />
      </AppStatusProvider>,
    ),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  running = false;
  props = {
    api: {} as Api,
    profileId: "profile-a",
    catalogLoading: false,
    catalogError: null,
    catalog: [...PREVIEW_HUD_CATALOG, nextHud],
    stats: {},
    state: previewInstalledState(),
    schema: PREVIEW_HUD_SCHEMA,
    onRefresh: vi.fn(),
    onRetryLocal: vi.fn(),
    onInstall: vi.fn(async () => true),
    onUpdate: vi.fn(),
    onMatch: vi.fn(),
    onApplyOptions: vi.fn(async () => true),
    onImportArchive: vi.fn(async () => true),
    onImportFolder: vi.fn(async () => true),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("HUD workspace interactions", () => {
  it("starts with catalog results and opens installed options from the current HUD card", async () => {
    await render();
    expect(selectedSurface()).toBe("hud-surface-browse");
    expect(element("hud-installed").closest("[hidden]")).not.toBeNull();
    expect(element("hud-catalog").closest("[hidden]")).toBeNull();

    await click("hud-install-rayshud");
    expect(selectedSurface()).toBe("hud-surface-installed");
    expect(element("hud-installed").closest("[hidden]")).toBeNull();
    expect(element("hud-options-disclosure").hasAttribute("open")).toBe(true);
    expect(props.onInstall).not.toHaveBeenCalled();
  });

  it("retains catalog paging while the installed workspace is open", async () => {
    const catalog = Array.from({ length: 14 }, (_, index) => ({
      ...nextHud,
      id: `hud-${index}`,
      name: `HUD ${index}`,
    }));
    await render({ catalog });
    await click("hud-page-next-top");
    expect(element("hud-card-hud-6")).toBeDefined();
    await surface("installed");
    await surface("browse");
    expect(element("hud-card-hud-6")).toBeDefined();
    expect(container.querySelector('[data-testid="hud-card-hud-0"]')).toBeNull();
  });

  it("reviews a replacement before writing, starts on Keep current HUD, and cancels without a write", async () => {
    await render();
    await click("hud-install-budhud");
    expect(element("hud-replace-dialog").textContent).toContain("Replace rayshud?");
    expect(element("hud-replace-dialog").textContent).toContain("budhud");
    expect(document.activeElement?.textContent).toBe("Keep current HUD");
    expect(props.onInstall).not.toHaveBeenCalled();
    await act(async () => (document.activeElement as HTMLButtonElement).click());
    expect(container.querySelector('[data-testid="hud-replace-dialog"]')).toBeNull();
    expect(props.onInstall).not.toHaveBeenCalled();
  });

  it("opens Installed only after the replacement succeeds", async () => {
    let complete!: (success: boolean) => void;
    const onInstall = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          complete = resolve;
        }),
    );
    await render({ onInstall });
    await click("hud-install-budhud");
    await click("hud-replace-confirm");
    expect(onInstall).toHaveBeenCalledWith("budhud");
    expect(selectedSurface()).toBe("hud-surface-browse");
    await act(async () => complete(true));
    expect(selectedSurface()).toBe("hud-surface-installed");
  });

  it.each([false, null, undefined])(
    "keeps Browse after a failed or cancelled import (%s)",
    async (outcome) => {
      await render({ onImportArchive: vi.fn(async () => outcome) });
      await click("hud-import");
      await click("hud-import-archive");
      expect(props.onImportArchive).toHaveBeenCalledOnce();
      expect(selectedSurface()).toBe("hud-surface-browse");
    },
  );

  it("opens Installed after a successful archive import", async () => {
    await render();
    await click("hud-import");
    await click("hud-import-archive");
    expect(selectedSurface()).toBe("hud-surface-installed");
  });

  it("does not carry a replacement review into another profile", async () => {
    await render();
    await click("hud-install-budhud");
    await render({ profileId: "profile-b" });
    expect(container.querySelector('[data-testid="hud-replace-dialog"]')).toBeNull();
    await render({ profileId: "profile-a" });
    expect(container.querySelector('[data-testid="hud-replace-dialog"]')).toBeNull();
    expect(props.onInstall).not.toHaveBeenCalled();
  });

  it("does not navigate a different profile when an old install completes", async () => {
    let complete!: (success: boolean) => void;
    await render({
      state: emptyHudState(),
      schema: null,
      onInstall: () =>
        new Promise<boolean>((resolve) => {
          complete = resolve;
        }),
    });
    await click("hud-install-budhud");
    await render({ profileId: "profile-b" });
    await act(async () => complete(true));
    expect(selectedSurface()).toBe("hud-surface-browse");
  });

  it("rechecks the game lock while replacement is under review", async () => {
    await render();
    await click("hud-install-budhud");
    running = true;
    await render();
    expect((element("hud-replace-confirm") as HTMLButtonElement).disabled).toBe(true);
    await click("hud-replace-confirm");
    expect(props.onInstall).not.toHaveBeenCalled();
  });

  it("keeps heavy mutations disabled when the existing HUD identity cannot be read", async () => {
    await render({ stateError: "Profile could not be read." });
    expect(element("hud-state-error").closest("[hidden]")).toBeNull();
    expect((element("hud-import") as HTMLButtonElement).disabled).toBe(true);
    expect((element("hud-install-budhud") as HTMLButtonElement).disabled).toBe(true);
    expect((element("hud-install-toonhud") as HTMLButtonElement).disabled).toBe(false);
    await click("hud-install-rayshud");
    expect(selectedSurface()).toBe("hud-surface-installed");
  });

  it("retains editable options across workspace changes and prevents replacing their pending draft", async () => {
    vi.useFakeTimers();
    running = true;
    await render();
    await surface("installed");
    await click("hud-opt-minmode");
    await surface("browse");
    await surface("installed");
    expect(element("hud-opt-minmode").getAttribute("aria-checked")).toBe("true");
    expect((element("hud-import") as HTMLButtonElement).disabled).toBe(true);
    expect(props.onApplyOptions).not.toHaveBeenCalled();
    running = false;
    await render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(props.onApplyOptions).toHaveBeenCalledWith(expect.objectContaining({ minmode: "true" }));
  });

  it("replaces broken catalog images with an honest unavailable state", async () => {
    await render();
    const image = element("hud-card-rayshud").querySelector("img");
    expect(image).not.toBeNull();
    await act(async () => image?.dispatchEvent(new window.Event("error")));
    expect(element("hud-card-rayshud").textContent).toContain("Preview unavailable");
  });
});
