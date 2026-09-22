// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStatusProvider } from "./hooks/useAppStatus";
import { AutosaveActivity, AutosaveDiscard, AutosavePending } from "./hooks/useAutosave";
import { LaunchPane } from "./LaunchPane";
import type { SteamWriteStatus } from "./lib/launch-ui";

let root: Root;
let box: HTMLDivElement;
let draft: string;
let saved: string;
let profileId: string;
let running: boolean;
let active: boolean;
let status: SteamWriteStatus | null;
let discard: { current: boolean };
const pending = new Map<string, boolean>();
const reportPending = (id: string, value: boolean) => {
  pending.set(id, value);
};
const save = vi.fn<() => Promise<boolean>>();
const clipboard = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { clipboard: { writeText: clipboard } });
  clipboard.mockReset().mockResolvedValue(undefined);
  save.mockReset().mockResolvedValue(true);
  draft = '-novid +exec "my config.cfg" -particles 1';
  saved = draft;
  profileId = "profile-a";
  running = false;
  active = true;
  status = null;
  discard = { current: false };
  pending.clear();
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});

afterEach(async () => {
  discard.current = true;
  await act(async () => root.unmount());
  box.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderPane() {
  root.render(
    <AppStatusProvider value={{ running, busy: false, error: null, setError: () => {} }}>
      <AutosaveDiscard.Provider value={discard}>
        <AutosaveActivity.Provider value={active}>
          <AutosavePending.Provider value={reportPending}>
            <LaunchPane
              profileId={profileId}
              value={draft}
              saved={saved}
              steamWrite={status}
              onChange={(next) => {
                draft = next;
                renderPane();
              }}
              onSave={save}
            />
          </AutosavePending.Provider>
        </AutosaveActivity.Provider>
      </AutosaveDiscard.Provider>
    </AppStatusProvider>,
  );
}
async function render() {
  await act(async () => renderPane());
}
function element<T extends HTMLElement>(selector: string): T {
  const value = box.querySelector<T>(selector);
  if (!value) throw new Error(`Missing ${selector}`);
  return value;
}
async function click(selector: string) {
  await act(async () => element(selector).click());
}
async function input(selector: string, value: string) {
  await act(async () => {
    const target = element<HTMLInputElement | HTMLTextAreaElement>(selector);
    const prototype =
      target instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function debounce() {
  await act(async () => vi.advanceTimersByTimeAsync(701));
}

describe("Launch workspace", () => {
  it("removes an option with its quoted value, retains neighbors, and preserves keyboard focus", async () => {
    await render();
    await click("button[aria-label='Remove +exec \"my config.cfg\"']");
    expect(draft).toBe("-novid -particles 1");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Remove -particles 1");
    expect(save).not.toHaveBeenCalled();
    await debounce();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("retains a guided value while hidden and only autosaves after Add", async () => {
    await render();
    await click('[data-testid="launch-add-open"]');
    expect(document.activeElement).toBe(element('[data-testid="launch-preset-nojoy"]'));
    await click('[data-testid="launch-preset-freq"]');
    await input('[data-testid="launch-value-refresh"]', "144");
    expect(element<HTMLButtonElement>('[data-testid="launch-steam-retry"]').disabled).toBe(true);
    await debounce();
    expect(save).not.toHaveBeenCalled();
    expect([...pending.values()].some(Boolean)).toBe(true);
    active = false;
    await render();
    active = true;
    await render();
    expect(element<HTMLInputElement>('[data-testid="launch-value-refresh"]').value).toBe("144");
    await click('[data-testid="launch-add-submit"]');
    expect(draft).toBe('-novid +exec "my config.cfg" -particles 1 -freq 144');
    expect(document.activeElement).toBe(element('[data-testid="launch-add-open"]'));
    await debounce();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("cancels an addition with Escape and never carries it into another profile", async () => {
    await render();
    await click('[data-testid="launch-add-open"]');
    await click('[data-testid="launch-preset-console"]');
    await act(async () =>
      element('[data-testid="launch-preset-console"]').dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(box.querySelector('[data-testid="launch-preset-console"]')).toBeNull();
    expect(document.activeElement).toBe(element('[data-testid="launch-add-open"]'));
    expect([...pending.values()].some(Boolean)).toBe(false);
    await click('[data-testid="launch-add-open"]');
    await click('[data-testid="launch-preset-console"]');
    profileId = "profile-b";
    await render();
    expect(box.querySelector('[data-testid="launch-preset-console"]')).toBeNull();
    expect(draft).toBe(saved);
    expect([...pending.values()].some(Boolean)).toBe(false);
  });

  it("keeps raw editing and chip edits live while TF2 runs, then saves the retained draft on unlock", async () => {
    running = true;
    await render();
    await input("textarea", '-novid +exec "my config.cfg" -console');
    await click('button[aria-label="Remove -novid"]');
    expect(element<HTMLTextAreaElement>("textarea").disabled).toBe(false);
    expect(element<HTMLButtonElement>('[data-testid="launch-steam-retry"]').disabled).toBe(true);
    await debounce();
    expect(save).not.toHaveBeenCalled();
    expect(draft).toBe('+exec "my config.cfg" -console');
    running = false;
    await render();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("awaits retry, handles false outcomes, and uses the same save path without duplicate requests", async () => {
    let settle: ((outcome: boolean) => void) | undefined;
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    status = "written";
    await render();
    await click('[data-testid="launch-steam-retry"]');
    expect(save).toHaveBeenCalledTimes(1);
    expect(element<HTMLButtonElement>('[data-testid="launch-steam-retry"]').disabled).toBe(true);
    expect(element('[data-testid="launch-steam-status"]').textContent).toContain("Checking");
    await click('[data-testid="launch-steam-retry"]');
    await debounce();
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => settle?.(false));
    expect(element('[data-testid="launch-steam-status"]').textContent).toContain(
      "Could not confirm",
    );
    expect(box.querySelector('[role="alert"]')).toBeNull();
    status = "steam_open";
    await render();
    await click('[data-testid="launch-steam-retry"]');
    expect(save).toHaveBeenCalledTimes(2);
    expect(element('[data-testid="launch-steam-status"]').textContent).toContain("Steam is open");
  });

  it("copies the exact raw sequence and leaves ambiguous commands to raw editing", async () => {
    draft = '+exec "cfg;name.cfg"; +echo "-an argument"';
    saved = draft;
    await render();
    expect(box.querySelector("[data-launch-token]")).toBeNull();
    expect(element<HTMLButtonElement>('[data-testid="launch-add-open"]').disabled).toBe(true);
    await click('[data-testid="launch-copy"]');
    expect(clipboard).toHaveBeenCalledWith(draft);
    expect(element('[data-testid="launch-copy"]').textContent).toContain("Copied");
    expect(save).not.toHaveBeenCalled();
  });

  it("shows manual Steam steps only when its write did not complete", async () => {
    await render();
    expect(box.querySelector("#launch-steam-guide")).toBeNull();
    status = "steam_open";
    await render();
    expect(element("#launch-steam-guide").textContent).toBe("Apply through Steam");
    status = "written";
    await render();
    expect(box.querySelector("#launch-steam-guide")).toBeNull();
  });

  it("adds width and height together and prevents duplicate guided options", async () => {
    await render();
    await click('[data-testid="launch-add-open"]');
    expect(element<HTMLButtonElement>('[data-testid="launch-preset-novid"]').disabled).toBe(true);
    await click('nav[aria-label="Launch option pages"] button:last-child');
    await click('[data-testid="launch-preset-resolution"]');
    await input('[data-testid="launch-value-width"]', "1920");
    await input('[data-testid="launch-value-height"]', "1080");
    await click('[data-testid="launch-add-submit"]');
    expect(draft).toBe('-novid +exec "my config.cfg" -particles 1 -w 1920 -h 1080');
    await click('[data-testid="launch-add-open"]');
    expect(element<HTMLButtonElement>('[data-testid="launch-preset-resolution"]').disabled).toBe(
      true,
    );
  });

  it("pages the catalog, searches by documented purpose, and guards conflicting display modes", async () => {
    await render();
    await click('[data-testid="launch-add-open"]');
    expect(element('nav[aria-label="Launch option pages"]').textContent).toContain("Page 1 of 3");
    expect(box.querySelector('[data-testid="launch-preset-displayindex"]')).toBeNull();
    await input("#launch-catalog-search", "display index");
    expect(element('[data-testid="launch-preset-displayindex"]').textContent).toContain("Linux");
    expect(box.querySelector('nav[aria-label="Launch option pages"]')).toBeNull();
    await click('[data-testid="launch-preset-displayindex"]');
    await input('[data-testid="launch-value-displayindex"]', "0");
    await click('[data-testid="launch-add-submit"]');
    expect(draft).toContain("-displayindex 0");

    draft = `${draft} -windowed`;
    saved = draft;
    await render();
    await click('[data-testid="launch-add-open"]');
    await input("#launch-catalog-search", "fullscreen");
    expect(element<HTMLButtonElement>('[data-testid="launch-preset-fullscreen"]').disabled).toBe(
      true,
    );
    expect(element('[data-testid="launch-preset-fullscreen"]').textContent).toContain(
      "Remove -windowed first",
    );
  });
});
