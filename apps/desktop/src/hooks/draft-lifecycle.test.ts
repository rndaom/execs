import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultGameplay, type GameplaySettings, serializeGameplayScope } from "../lib/gameplay-ui";
import { AutosaveActivity, AutosaveDiscard, useAutosave } from "./useAutosave";
import { useSeededDraft } from "./useSeededDraft";

vi.mock("../components/ui/Toast", () => {
  const toast = { deferDraft: vi.fn() };
  return { useToast: () => toast };
});

let dom: JSDOM;
let root: Root;
beforeEach(() => {
  dom = new JSDOM("<!doctype html><div id='root'></div>");
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(dom.window.document.getElementById("root") as HTMLElement);
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  vi.unstubAllGlobals();
});

describe("draft lifecycle", () => {
  it("saves two deferred pane scopes without losing either edit or leaving either dirty", async () => {
    type Scope = "gameplay" | "sounds";
    const edits = new Map<Scope, (value: number) => void>();
    const dirtyPanes = new Map<Scope, boolean>();
    const writes: Scope[] = [];
    let current = defaultGameplay();
    function Pane({
      scope,
      seed,
      locked,
      save,
    }: {
      scope: Scope;
      seed: GameplaySettings;
      locked: boolean;
      save: (scope: Scope, draft: GameplaySettings) => Promise<boolean>;
    }) {
      const serialize = (value: GameplaySettings) => serializeGameplayScope(value, scope);
      const [draft, setDraft] = useSeededDraft(seed, serialize, `a-${scope}`);
      const dirty = serialize(draft) !== serialize(seed);
      dirtyPanes.set(scope, dirty);
      edits.set(scope, (value) =>
        setDraft((old) => ({
          ...old,
          ...(scope === "gameplay" ? { fov_desired: value } : { tf_dingaling_volume: value }),
        })),
      );
      useAutosave({ dirty, token: serialize(draft), locked, save: () => save(scope, draft) });
      return null;
    }
    function Host({ locked }: { locked: boolean }) {
      const [seed, setSeed] = useState(defaultGameplay);
      current = seed;
      const save = async (scope: Scope, draft: GameplaySettings) => {
        writes.push(scope);
        setSeed((old) => ({
          ...old,
          ...(scope === "gameplay"
            ? { fov_desired: draft.fov_desired }
            : { tf_dingaling_volume: draft.tf_dingaling_volume }),
        }));
        return true;
      };
      return createElement(
        "div",
        null,
        ...(["gameplay", "sounds"] as const).map((scope) =>
          createElement(Pane, { key: scope, scope, seed, locked, save }),
        ),
      );
    }
    await act(async () => root.render(createElement(Host, { locked: true })));
    await act(async () => {
      edits.get("gameplay")?.(75);
      edits.get("sounds")?.(0.4);
    });
    expect(writes).toEqual([]);
    await act(async () => root.render(createElement(Host, { locked: false })));
    expect(writes).toEqual(["gameplay", "sounds"]);
    expect(current.fov_desired).toBe(75);
    expect(current.tf_dingaling_volume).toBe(0.4);
    expect([...dirtyPanes.values()]).toEqual([false, false]);
    await act(async () => root.render(createElement(Host, { locked: false })));
    expect(writes).toHaveLength(2);
  });

  it("does not flush an explicitly discarded draft after an in-flight save", async () => {
    const discard = { current: false };
    let finish!: (value: boolean) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(true);
    function Pane({ token }: { token: string }) {
      useAutosave({ dirty: true, token, locked: false, save: () => save(token), delay: 100000 });
      return null;
    }
    const render = (token: string) =>
      root.render(
        createElement(AutosaveDiscard.Provider, { value: discard }, createElement(Pane, { token })),
      );
    await act(async () => render("first"));
    await act(async () => render("discard me"));
    discard.current = true;
    await act(async () => root.render(null));
    discard.current = false;
    await act(async () => finish(true));
    expect(save.mock.calls).toEqual([["first"]]);
  });

  it("advances an acknowledged seed and accepts a later external update", async () => {
    let value = "";
    let edit!: (value: string) => void;
    function Pane({ seed }: { seed: string }) {
      const [draft, setDraft] = useSeededDraft(seed, String, "profile-a");
      value = draft;
      edit = setDraft;
      return null;
    }
    await act(async () => root.render(createElement(Pane, { seed: "90" })));
    await act(async () => edit("75"));
    await act(async () => root.render(createElement(Pane, { seed: "75" })));
    await act(async () => root.render(createElement(Pane, { seed: "80" })));
    expect(value).toBe("80");
  });

  it("keeps newer edits when an older submitted draft is acknowledged", async () => {
    let value = "";
    let edit!: (value: string) => void;
    function Pane({ seed, profile }: { seed: string; profile: string }) {
      const [draft, setDraft] = useSeededDraft(seed, String, profile);
      value = draft;
      edit = setDraft;
      return null;
    }
    const render = (seed: string, profile = "a") =>
      root.render(createElement(Pane, { seed, profile }));
    await act(async () => render("90"));
    await act(async () => edit("75"));
    await act(async () => edit("70"));
    await act(async () => render("75"));
    expect(value).toBe("70");
    await act(async () => render("70"));
    await act(async () => render("80"));
    expect(value).toBe("80");
    await act(async () => edit("65"));
    await act(async () => render("90", "b"));
    expect(value).toBe("90");
  });

  it.each([false, "reject"])("retries a failed autosave after unlock (%s)", async (failure) => {
    const save = vi
      .fn()
      .mockImplementationOnce(() =>
        failure === "reject" ? Promise.reject(new Error("locked")) : Promise.resolve(false),
      )
      .mockResolvedValue(true);
    let flush!: () => void;
    function Pane({ locked }: { locked: boolean }) {
      flush = useAutosave({ dirty: true, token: "edit", locked, save, delay: 100000 }).flush;
      return null;
    }
    await act(async () => root.render(createElement(Pane, { locked: false })));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => root.render(createElement(Pane, { locked: true })));
    await act(async () => root.render(createElement(Pane, { locked: false })));
    expect(save).toHaveBeenCalledTimes(2);
    await act(async () => flush());
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("flushes newer edits after an in-flight save when the pane unmounts", async () => {
    let finish!: (value: boolean) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(true);
    function Pane({ token }: { token: string }) {
      useAutosave({ dirty: true, token, locked: false, save: () => save(token), delay: 100000 });
      return null;
    }
    await act(async () => root.render(createElement(Pane, { token: "first" })));
    await act(async () => root.render(createElement(Pane, { token: "second" })));
    await act(async () => root.render(null));
    await act(async () => finish(true));
    expect(save.mock.calls).toEqual([["first"], ["second"]]);
  });

  it("keeps a hidden locked pane draft and saves it when TF2 closes", async () => {
    const save = vi.fn().mockResolvedValue(true);
    let edit!: (value: string) => void;
    function Pane({ locked }: { locked: boolean }) {
      const [draft, setDraft] = useSeededDraft<string>("90", String, "a");
      edit = setDraft;
      useAutosave({ dirty: draft !== "90", token: draft, locked, save: () => save(draft) });
      return null;
    }
    const render = (active: boolean, locked: boolean) =>
      root.render(
        createElement(
          AutosaveActivity.Provider,
          { value: active },
          createElement(Pane, { locked }),
        ),
      );
    await act(async () => render(true, true));
    await act(async () => edit("75"));
    await act(async () => render(false, true));
    expect(save).not.toHaveBeenCalled();
    await act(async () => render(false, false));
    expect(save.mock.calls).toEqual([["75"]]);
  });
});
