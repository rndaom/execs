import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BindsPane } from "./BindsPane";
import { BIND_ACTIONS, MANAGED_BINDS_HEADER } from "./lib/binds-ui";

const status = vi.hoisted(() => ({ running: false, busy: false }));
vi.mock("./hooks/useAppStatus", () => ({ useAppStatus: () => status }));

let dom: JSDOM;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  status.running = false;
  status.busy = false;
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function pressKey(key: string, code: string) {
  await act(async () => {
    dom.window.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true }),
    );
  });
}

/** Key caps shown for an action, as the player reads them. */
function caps(actionId: string): string[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-testid^="bind-cap-${actionId}-"]`)].map(
    (cap) => cap.textContent ?? "",
  );
}

function capSource(actionId: string, key: string): string {
  return (
    document.querySelector(`[data-testid="bind-cap-${actionId}-${key}"]`)?.getAttribute("title") ??
    ""
  );
}

describe("BindsPane autosave", () => {
  it("lists two startup keys with their sources, then adds and removes only an execs key", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    const managedText = `${MANAGED_BINDS_HEADER}\nbind x +jump\n`;
    const startupFiles = [
      { path: "tf/cfg/config.cfg", text: "bind space +jump\n" },
      { path: "tf/cfg/autoexec.cfg", text: "exec execs_binds\n" },
      { path: "tf/cfg/execs_binds.cfg", text: managedText },
    ];
    await act(async () =>
      root.render(
        createElement(BindsPane, {
          profileId: "profile-a",
          layer: "vanilla",
          effectiveBinds: { space: "+jump", x: "+jump" },
          startupFiles,
          managedText,
          onSave: save,
        }),
      ),
    );
    expect(caps("jump")).toEqual(["Space", "X"]);
    expect(capSource("jump", "space")).toBe("Set in tf/cfg/config.cfg, line 1");
    expect(capSource("jump", "x")).toBe("Added in execs (tf/cfg/execs_binds.cfg, line 2)");
    expect(document.querySelector('[data-testid="bind-remove-jump-space"]')).toBeNull();

    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="bind-record-jump"]')?.click(),
    );
    await pressKey("y", "KeyY");
    expect(caps("jump")).toEqual(["Space", "X", "Y"]);
    expect(capSource("jump", "y")).toBe("Added in execs (tf/cfg/execs_binds.cfg, line 3)");
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="bind-remove-jump-x"]')?.click(),
    );
    expect(caps("jump")).toEqual(["Space", "Y"]);
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(save.mock.calls.at(-1)?.[0]).toContain("bind y +jump");
    expect(save.mock.calls.at(-1)?.[0]).not.toContain("bind x +jump");
  });

  it("reviews a conflicting startup key before overriding its command", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    const startupFiles = [
      { path: "tf/cfg/config.cfg", text: "bind r +reload\n" },
      { path: "tf/cfg/autoexec.cfg", text: "exec execs_binds\n" },
      { path: "tf/cfg/execs_binds.cfg", text: "" },
    ];
    await act(async () =>
      root.render(
        createElement(BindsPane, {
          profileId: "profile-a",
          layer: "vanilla",
          effectiveBinds: { r: "+reload" },
          startupFiles,
          managedText: "",
          onSave: save,
        }),
      ),
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="bind-record-jump"]')?.click(),
    );
    await pressKey("r", "KeyR");
    const conflict = document.querySelector('[data-testid="bind-conflict-jump"]');
    expect(conflict?.textContent).toContain("R is bound to Reload.");
    expect(conflict?.querySelector("p")?.getAttribute("title")).toBe("Set in tf/cfg/config.cfg:1");
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(save).not.toHaveBeenCalled();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[data-testid="bind-conflict-jump"] button')
        ?.click(),
    );
    expect(startupFiles[0].text).toBe("bind r +reload\n");
    expect(caps("jump")).toEqual(["R"]);
    expect(capSource("jump", "r")).toBe("Added in execs (tf/cfg/execs_binds.cfg, line 2)");
  });

  it("drops an unfinished key conflict when the profile changes", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    const render = (profileId: string) =>
      root.render(
        createElement(BindsPane, {
          profileId,
          layer: "vanilla",
          effectiveBinds: { r: "+reload" },
          startupFiles: [
            { path: "tf/cfg/config.cfg", text: "bind r +reload\n" },
            { path: "tf/cfg/autoexec.cfg", text: "exec execs_binds\n" },
            { path: "tf/cfg/execs_binds.cfg", text: "" },
          ],
          managedText: "",
          onSave: save,
        }),
      );
    await act(async () => render("profile-a"));
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="bind-record-jump"]')?.click(),
    );
    await pressKey("r", "KeyR");
    expect(document.querySelector('[data-testid="bind-conflict-jump"]')).not.toBeNull();
    await act(async () => render("profile-b"));
    expect(document.querySelector('[data-testid="bind-conflict-jump"]')).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("makes every bind action reachable through categories without writing", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    await act(async () =>
      root.render(
        createElement(BindsPane, {
          profileId: "profile-a",
          layer: "vanilla",
          effectiveBinds: {},
          managedText: "",
          onSave: save,
        }),
      ),
    );
    const reachable = new Set<string>();
    for (const tab of document.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      await act(async () => tab.click());
      for (const row of document.querySelectorAll<HTMLElement>('[data-testid^="bind-row-"]')) {
        reachable.add(row.dataset.testid?.replace("bind-row-", "") ?? "");
      }
    }
    expect([...reachable].sort()).toEqual(BIND_ACTIONS.map((action) => action.id).sort());
    expect(save).not.toHaveBeenCalled();
  });

  it("cancels recording when a category is clicked instead of binding mouse1", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    await act(async () =>
      root.render(
        createElement(BindsPane, {
          profileId: "profile-a",
          layer: "vanilla",
          effectiveBinds: { space: "+jump" },
          managedText: "",
          onSave: save,
        }),
      ),
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="bind-record-jump"]')?.click(),
    );
    await act(async () => vi.advanceTimersByTimeAsync(1));
    const combat = document.getElementById("bind-category-combat") as HTMLButtonElement;
    await act(async () => {
      combat.dispatchEvent(
        new dom.window.MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true }),
      );
      combat.click();
    });
    await act(async () => document.getElementById("bind-category-movement")?.click());
    expect(caps("jump")).toEqual(["Space"]);
    expect(
      document.querySelector('[data-testid="bind-row-jump"]')?.getAttribute("data-recording"),
    ).toBe("false");
    await act(async () => vi.runAllTimersAsync());
    expect(save).not.toHaveBeenCalled();
  });

  it("lets a remove button cancel capture before its click", async () => {
    const managedText = `${MANAGED_BINDS_HEADER}\nbind x +jump\n`;
    const save = vi.fn(async (_text: string) => undefined);
    await act(async () =>
      root.render(
        createElement(BindsPane, {
          profileId: "profile-a",
          layer: "vanilla",
          effectiveBinds: { x: "+jump" },
          managedText,
          onSave: save,
        }),
      ),
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="bind-record-jump"]')?.click(),
    );
    await act(async () => vi.advanceTimersByTimeAsync(1));
    const remove = document.querySelector<HTMLButtonElement>('[data-testid="bind-remove-jump-x"]');
    await act(async () => {
      remove?.dispatchEvent(
        new dom.window.MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true }),
      );
      remove?.click();
    });
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(save.mock.calls.at(-1)?.[0]).not.toContain("bind mouse1 +jump");
    expect(save.mock.calls.at(-1)?.[0]).not.toContain("bind x +jump");
  });

  it("keeps the recording notice beside its action and Escape leaves the binding intact", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    await act(async () =>
      root.render(
        createElement(BindsPane, {
          profileId: "profile-a",
          layer: "vanilla",
          effectiveBinds: { space: "+jump" },
          managedText: "",
          onSave: save,
        }),
      ),
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="bind-record-jump"]')?.click(),
    );
    await pressKey("F13", "F13");
    const notice = document.querySelector('[data-testid="bind-recorder-notice"]');
    expect(notice?.closest('[data-testid="bind-row-jump"]')).not.toBeNull();
    expect(notice?.textContent).toContain("can't be bound");
    await pressKey("Escape", "Escape");
    expect(caps("jump")).toEqual(["Space"]);
    expect(save).not.toHaveBeenCalled();
  });

  it("records while TF2 runs, writes nothing, then saves the draft on unlock", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    const render = () =>
      root.render(
        createElement(BindsPane, {
          profileId: "profile-a",
          layer: "comfig",
          effectiveBinds: {},
          managedText: "",
          onSave: save,
        }),
      );

    status.running = true;
    await act(async () => render());
    const record = document.querySelector<HTMLButtonElement>('[data-testid="bind-record-jump"]');
    expect(record?.disabled).toBe(false);
    await act(async () => record?.click());
    await pressKey("x", "KeyX");
    expect(caps("jump")).toEqual(["X"]);
    await act(async () => vi.runAllTimersAsync());
    expect(save).not.toHaveBeenCalled();

    status.running = false;
    await act(async () => render());
    await act(async () => Promise.resolve());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toContain("bind x +jump");
  });

  it("keeps busy safety even though the write lock alone permits drafts", async () => {
    status.running = true;
    status.busy = true;
    await act(async () =>
      root.render(
        createElement(BindsPane, {
          profileId: "profile-a",
          layer: "vanilla",
          effectiveBinds: {},
          managedText: "",
          onSave: async () => undefined,
        }),
      ),
    );

    expect(
      document.querySelector<HTMLButtonElement>('[data-testid="bind-record-jump"]')?.disabled,
    ).toBe(true);
    expect(document.body.textContent).not.toContain("Close TF2 to change binds");
  });

  it("accepts another key immediately while the previous bind is saving", async () => {
    let finishFirstSave: (() => void) | undefined;
    const firstSave = new Promise<void>((resolve) => {
      finishFirstSave = resolve;
    });
    const save = vi
      .fn<(text: string) => Promise<void>>()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue(undefined);
    const render = () =>
      root.render(
        createElement(BindsPane, {
          profileId: "profile-a",
          layer: "vanilla",
          effectiveBinds: {},
          managedText: "",
          blocked: false,
          onSave: save,
        }),
      );

    await act(async () => render());
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="bind-record-jump"]')?.click(),
    );
    await pressKey("x", "KeyX");
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(save).toHaveBeenCalledTimes(1);

    status.busy = true;
    await act(async () => render());
    expect(document.body.textContent).not.toContain("Finish the current task first");
    await act(async () => document.getElementById("bind-category-combat")?.click());
    const reload = document.querySelector<HTMLButtonElement>('[data-testid="bind-record-reload"]');
    expect(reload?.disabled).toBe(false);
    await act(async () => reload?.click());
    await pressKey("r", "KeyR");
    expect(caps("reload")).toEqual(["R"]);
    await act(async () => vi.advanceTimersByTimeAsync(700));
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => finishFirstSave?.());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toContain("bind r +reload");
  });

  it("discards one profile's draft when the profile key changes", async () => {
    const save = vi.fn(async (_text: string) => undefined);
    const render = (profileId: string, managedText: string) =>
      root.render(
        createElement(BindsPane, {
          profileId,
          layer: "vanilla",
          effectiveBinds: {},
          managedText,
          onSave: save,
        }),
      );

    status.running = true;
    await act(async () => render("profile-a", ""));
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-testid="bind-record-jump"]')?.click(),
    );
    await pressKey("x", "KeyX");
    expect(caps("jump")).toEqual(["X"]);

    await act(async () => render("profile-b", "bind space +jump\n"));
    expect(caps("jump")).toEqual(["Space"]);
    expect(save).not.toHaveBeenCalled();
  });
});
