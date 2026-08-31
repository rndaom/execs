import { describe, expect, it } from "vitest";
import {
  idleSwitchProgress,
  type SwitchProgressPresenterAction,
  type SwitchProgressPresenterState,
  switchProgressFraction,
  switchProgressNeedsAdvance,
  switchProgressPresenterReducer,
} from "./switch-progress-ui";

function run(actions: SwitchProgressPresenterAction[]): SwitchProgressPresenterState {
  return actions.reduce(switchProgressPresenterReducer, idleSwitchProgress());
}

describe("switch progress presenter", () => {
  it("shows the first reported stage immediately and queues the rest", () => {
    const state = run([
      { type: "start" },
      { type: "report", step: "closed" },
      { type: "report", step: "pack" },
      { type: "report", step: "write" },
    ]);
    expect(state.visibleStep).toBe("closed");
    expect(state.queue).toEqual(["pack", "write"]);
    expect(state.active).toBe(true);
    expect(switchProgressNeedsAdvance(state)).toBe(true);
  });

  it("advance reveals exactly one queued stage per tick", () => {
    let state = run([
      { type: "start" },
      { type: "report", step: "closed" },
      { type: "report", step: "pack" },
      { type: "report", step: "write" },
    ]);
    state = switchProgressPresenterReducer(state, { type: "advance" });
    expect(state.visibleStep).toBe("pack");
    expect(state.queue).toEqual(["write"]);
    state = switchProgressPresenterReducer(state, { type: "advance" });
    expect(state.visibleStep).toBe("write");
    expect(state.queue).toEqual([]);
  });

  it("ignores out-of-order and duplicate backend events against the queue frontier", () => {
    const state = run([
      { type: "start" },
      { type: "report", step: "closed" },
      { type: "report", step: "write" },
      { type: "report", step: "pack" },
      { type: "report", step: "write" },
    ]);
    expect(state.visibleStep).toBe("closed");
    expect(state.queue).toEqual(["write"]);
  });

  it("completion does not short-circuit an undrained queue", () => {
    let state = run([
      { type: "start" },
      { type: "report", step: "closed" },
      { type: "report", step: "cloud" },
      { type: "complete" },
    ]);
    expect(state.active).toBe(true);
    expect(state.visibleStep).toBe("closed");

    state = switchProgressPresenterReducer(state, { type: "advance" });
    expect(state.visibleStep).toBe("cloud");
    expect(state.active).toBe(true);

    state = switchProgressPresenterReducer(state, { type: "advance" });
    expect(state).toMatchObject({ active: false, visible: true, visibleStep: "done" });
    expect(switchProgressNeedsAdvance(state)).toBe(false);
  });

  it("a reported done step never terminates the checklist by itself", () => {
    const state = run([
      { type: "start" },
      { type: "report", step: "cloud" },
      { type: "report", step: "done" },
    ]);
    expect(state.visibleStep).toBe("cloud");
    expect(state.queue).toEqual([]);
    expect(state.active).toBe(true);
  });

  it("cannot regress or reactivate after the drain finishes", () => {
    let state = run([
      { type: "start" },
      { type: "report", step: "write" },
      { type: "complete" },
      { type: "advance" },
    ]);
    expect(state.visibleStep).toBe("done");
    state = switchProgressPresenterReducer(state, { type: "report", step: "cloud" });
    state = switchProgressPresenterReducer(state, { type: "advance" });
    expect(state).toMatchObject({ active: false, visible: true, visibleStep: "done" });
  });

  it("cancel resets immediately, dropping any queued stages", () => {
    let state = run([
      { type: "start" },
      { type: "report", step: "closed" },
      { type: "report", step: "pack" },
      { type: "cancel" },
    ]);
    expect(state).toEqual(idleSwitchProgress());
    state = switchProgressPresenterReducer(state, { type: "report", step: "pack" });
    expect(state).toEqual(idleSwitchProgress());
  });

  it("dismiss clears the completion summary", () => {
    const state = run([
      { type: "start" },
      { type: "report", step: "closed" },
      { type: "complete" },
      { type: "advance" },
      { type: "dismiss" },
    ]);
    expect(state).toEqual(idleSwitchProgress());
  });

  it("fraction follows revealed stages, not reported ones", () => {
    let state = run([
      { type: "start" },
      { type: "report", step: "closed" },
      { type: "report", step: "cloud" },
    ]);
    expect(switchProgressFraction(state)).toBeCloseTo(1 / 6);
    state = switchProgressPresenterReducer(state, { type: "advance" });
    expect(switchProgressFraction(state)).toBeCloseTo(5 / 6);
    state = switchProgressPresenterReducer(state, { type: "complete" });
    state = switchProgressPresenterReducer(state, { type: "advance" });
    expect(switchProgressFraction(state)).toBe(1);
  });
});
