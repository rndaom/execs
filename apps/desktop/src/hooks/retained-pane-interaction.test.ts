import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BindsPane } from "../BindsPane";
import { Modal } from "../components/ui/Modal";
import type { Api } from "../lib/api";
import { AutosaveActivity } from "./useAutosave";
import { type SoundPlayer, useSoundPlayer } from "./useSoundPlayer";

vi.mock("./useAppStatus", () => ({ useAppStatus: () => ({ running: false, busy: false }) }));

let dom: JSDOM;
let root: Root;
beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='root'></div>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("retained pane interactions", () => {
  it("cancels bind recording when hidden and leaves subsequent keys alone", async () => {
    const save = vi.fn();
    const render = (active: boolean) =>
      root.render(
        createElement(
          AutosaveActivity.Provider,
          { value: active },
          createElement(BindsPane, {
            layer: "comfig",
            effectiveBinds: {},
            managedText: "",
            onSave: save,
          }),
        ),
      );
    await act(async () => render(true));
    const record = document.querySelector<HTMLButtonElement>('[data-testid="bind-record-jump"]');
    expect(record).not.toBeNull();
    await act(async () => record?.click());
    expect(
      document.querySelector('[data-testid="bind-row-jump"]')?.getAttribute("data-recording"),
    ).toBe("true");
    await act(async () => render(false));
    const key = new dom.window.KeyboardEvent("keydown", {
      key: "x",
      code: "KeyX",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => dom.window.dispatchEvent(key));
    expect(key.defaultPrevented).toBe(false);
    expect(save).not.toHaveBeenCalled();
    await act(async () => render(true));
    expect(
      document.querySelector('[data-testid="bind-row-jump"]')?.getAttribute("data-recording"),
    ).toBe("false");
    await act(async () => record?.click());
    await act(async () =>
      dom.window.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "x",
          code: "KeyX",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toContain("bind x +jump");
  });

  it("removes a hidden modal's Escape and focus trap listeners", async () => {
    const close = vi.fn();
    const render = (active: boolean) =>
      root.render(
        createElement(
          AutosaveActivity.Provider,
          { value: active },
          createElement(Modal, { open: true, title: "Review", onClose: close }),
        ),
      );
    await act(async () => render(true));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => render(false));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const escapeKey = new dom.window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => document.dispatchEvent(escapeKey));
    expect(escapeKey.defaultPrevented).toBe(false);
    expect(close).not.toHaveBeenCalled();
    await act(async () => render(true));
    await act(async () =>
      document.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("stops audition audio and prevents delayed bytes from playing after navigation", async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    class AudioDouble {
      play = play;
      pause = pause;
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
    }
    vi.stubGlobal("Audio", AudioDouble);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    let bytes!: (value: Uint8Array) => void;
    const api = {
      hitsoundBytes: vi.fn(
        () =>
          new Promise<Uint8Array>((resolve) => {
            bytes = resolve;
          }),
      ),
    } as unknown as Api;
    let player!: SoundPlayer;
    function Pane() {
      player = useSoundPlayer(api);
      return null;
    }
    const render = (active: boolean) =>
      root.render(createElement(AutosaveActivity.Provider, { value: active }, createElement(Pane)));
    await act(async () => render(true));
    await act(async () => player.play({ kind: "stock", stem: "retained-pane-test" }, 50));
    await act(async () => render(false));
    expect(pause).toHaveBeenCalled();
    await act(async () => bytes(new Uint8Array([1, 2])));
    expect(play).not.toHaveBeenCalled();
    await act(async () => render(true));
    await act(async () => player.play({ kind: "stock", stem: "retained-pane-test" }, 50));
    expect(play).toHaveBeenCalledTimes(1);
    pause.mockClear();
    await act(async () => render(false));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(player.playing).toBeNull();
  });
});
