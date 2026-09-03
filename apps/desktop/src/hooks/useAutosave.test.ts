import { describe, expect, it } from "vitest";
import {
  type AutosaveEffect,
  type AutosaveEvent,
  type AutosaveState,
  autosaveInitial,
  autosaveStep,
} from "./useAutosave";

/** Replays a run of events and collects what the hook would have done. */
function run(
  events: AutosaveEvent[],
  from: AutosaveState = autosaveInitial(),
): { state: AutosaveState; effects: AutosaveEffect[] } {
  let state = from;
  const effects: AutosaveEffect[] = [];
  for (const event of events) {
    const step = autosaveStep(state, event);
    state = step.state;
    effects.push(step.effect);
  }
  return { state, effects };
}

const OPEN = { locked: false } as const;
const LOCKED = { locked: true } as const;

describe("autosave debounce", () => {
  it("re-arms on every edit and saves once the user stops", () => {
    const { effects, state } = run([
      { type: "change", ...OPEN },
      { type: "change", ...OPEN },
      { type: "change", ...OPEN },
      { type: "elapsed", ...OPEN },
    ]);

    expect(effects).toEqual(["arm", "arm", "arm", "save"]);
    expect(state.saving).toBe(true);
    expect(state.dirty).toBe(false);
  });

  it("does nothing when the timer fires with no pending edit", () => {
    expect(run([{ type: "elapsed", ...OPEN }]).effects).toEqual(["none"]);
  });

  it("does not start a second save while one is in flight", () => {
    const { effects, state } = run([
      { type: "change", ...OPEN },
      { type: "elapsed", ...OPEN },
      { type: "change", ...OPEN },
      { type: "elapsed", ...OPEN },
    ]);

    expect(effects).toEqual(["arm", "save", "arm", "none"]);
    expect(state.due).toBe(true);
    expect(state.dirty).toBe(true);
  });
});

describe("autosave coalescing", () => {
  it("collapses everything typed during a save into one follow-up", () => {
    const { effects, state } = run([
      { type: "change", ...OPEN },
      { type: "elapsed", ...OPEN },
      { type: "change", ...OPEN },
      { type: "change", ...OPEN },
      { type: "elapsed", ...OPEN },
      { type: "settled", ...OPEN },
    ]);

    expect(effects.filter((effect) => effect === "save")).toHaveLength(2);
    expect(effects.at(-1)).toBe("save");
    expect(state.due).toBe(false);
    expect(state.dirty).toBe(false);
  });

  it("stops after the save when nothing changed during it", () => {
    const { effects } = run([
      { type: "change", ...OPEN },
      { type: "elapsed", ...OPEN },
      { type: "settled", ...OPEN },
    ]);

    expect(effects).toEqual(["arm", "save", "none"]);
  });

  it("waits for the debounce again when the follow-up edit is still fresh", () => {
    // The timer had not fired again by the time the save settled, so the edit
    // keeps its own full delay rather than going out immediately.
    const { effects, state } = run([
      { type: "change", ...OPEN },
      { type: "elapsed", ...OPEN },
      { type: "change", ...OPEN },
      { type: "settled", ...OPEN },
    ]);

    expect(effects).toEqual(["arm", "save", "arm", "none"]);
    expect(state.dirty).toBe(true);
    expect(state.saving).toBe(false);
  });
});

describe("autosave write lock", () => {
  it("writes nothing while TF2 runs and says so once", () => {
    const { effects, state } = run([
      { type: "change", ...LOCKED },
      { type: "change", ...LOCKED },
      { type: "change", ...LOCKED },
    ]);

    expect(effects).toEqual(["defer", "none", "none"]);
    expect(state.dirty).toBe(true);
  });

  it("says it the moment the game starts on top of unsaved edits", () => {
    const { effects } = run([
      { type: "change", ...OPEN },
      { type: "locked" },
      { type: "change", ...LOCKED },
    ]);

    expect(effects).toEqual(["arm", "defer", "none"]);
  });

  it("runs the pending save the moment the lock lifts", () => {
    const { effects, state } = run([{ type: "change", ...LOCKED }, { type: "unlocked" }]);

    expect(effects).toEqual(["defer", "save"]);
    expect(state.dirty).toBe(false);
  });

  it("has nothing to run when the lock lifts over a clean draft", () => {
    expect(run([{ type: "unlocked" }]).effects).toEqual(["none"]);
  });

  it("owes the notice again on the next locked stretch", () => {
    const { effects } = run([
      { type: "change", ...LOCKED },
      { type: "unlocked" },
      { type: "settled", ...OPEN },
      { type: "change", ...OPEN },
      { type: "locked" },
    ]);

    expect(effects).toEqual(["defer", "save", "none", "arm", "defer"]);
  });

  it("keeps a save that landed mid-lock from going out again", () => {
    const { effects } = run([
      { type: "change", ...OPEN },
      { type: "elapsed", ...OPEN },
      { type: "change", ...OPEN },
      { type: "elapsed", ...OPEN },
      { type: "locked" },
      { type: "settled", ...LOCKED },
    ]);

    expect(effects.at(-1)).toBe("none");
    expect(effects.filter((effect) => effect === "save")).toHaveLength(1);
  });
});

describe("autosave flush", () => {
  it("saves a debounced edit rather than losing it on a pane switch", () => {
    const { effects, state } = run([
      { type: "change", ...OPEN },
      { type: "flush", ...OPEN },
    ]);

    expect(effects).toEqual(["arm", "save"]);
    expect(state.dirty).toBe(false);
  });

  it("keeps the draft instead of flushing while TF2 runs", () => {
    const { effects, state } = run([
      { type: "change", ...LOCKED },
      { type: "flush", ...LOCKED },
    ]);

    expect(effects).toEqual(["defer", "none"]);
    expect(state.dirty).toBe(true);
  });

  it("does not double up on a save already in flight", () => {
    const { effects } = run([
      { type: "change", ...OPEN },
      { type: "elapsed", ...OPEN },
      { type: "flush", ...OPEN },
    ]);

    expect(effects).toEqual(["arm", "save", "none"]);
  });

  it("has nothing to flush with no unsaved edit", () => {
    expect(run([{ type: "flush", ...OPEN }]).effects).toEqual(["none"]);
  });
});
