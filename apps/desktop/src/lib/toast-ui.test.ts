import { describe, expect, it } from "vitest";
import {
  DEFERRED_MESSAGE,
  failureMessage,
  SAVED_MESSAGE,
  SAVING_MESSAGE,
  TOAST_SAVED_MS,
  type Toast,
  toastDismissible,
  toastLingerMs,
  toastStep,
} from "./toast-ui";

const SAVING: Toast = { kind: "saving", message: SAVING_MESSAGE };
const ERROR: Toast = { kind: "error", message: "Could not save — TF2 is running" };

describe("toastStep", () => {
  it("shows the saving pill only once a save is judged slow", () => {
    expect(toastStep(null, { type: "slow" })).toEqual(SAVING);
  });

  it("replaces the pill with Saved when the write lands", () => {
    expect(toastStep(SAVING, { type: "done" })).toEqual({ kind: "saved", message: SAVED_MESSAGE });
  });

  it("carries a pane's own completion wording", () => {
    expect(toastStep(null, { type: "done", message: "Pack built" })).toEqual({
      kind: "saved",
      message: "Pack built",
    });
  });

  it("keeps a failure on screen while the next attempt runs", () => {
    expect(toastStep(ERROR, { type: "slow" })).toBe(ERROR);
    expect(toastStep(ERROR, { type: "defer" })).toBe(ERROR);
  });

  it("clears a failure on the next successful save", () => {
    expect(toastStep(ERROR, { type: "done" })).toEqual({ kind: "saved", message: SAVED_MESSAGE });
  });

  it("clears a failure when the user dismisses it", () => {
    expect(toastStep(ERROR, { type: "hide" })).toBeNull();
  });

  it("says the draft is kept once, not on every keystroke", () => {
    const first = toastStep(null, { type: "defer" });
    expect(first).toEqual({ kind: "deferred", message: DEFERRED_MESSAGE });
    // Same object: React re-renders nothing on the next keystroke.
    expect(toastStep(first, { type: "defer" })).toBe(first);
  });

  it("replaces the draft notice with Saved once the lock lifts", () => {
    const deferred = toastStep(null, { type: "defer" });
    expect(toastStep(deferred, { type: "done" })).toEqual({
      kind: "saved",
      message: SAVED_MESSAGE,
    });
  });

  it("lets a later failure replace the saving pill", () => {
    expect(toastStep(SAVING, { type: "fail", message: "Could not save — disk full" })).toEqual({
      kind: "error",
      message: "Could not save — disk full",
    });
  });
});

describe("toastLingerMs", () => {
  it("fades Saved on its own", () => {
    expect(toastLingerMs({ kind: "saved", message: SAVED_MESSAGE })).toBe(TOAST_SAVED_MS);
  });

  it("leaves every other state waiting for an event", () => {
    expect(toastLingerMs(null)).toBeNull();
    expect(toastLingerMs(SAVING)).toBeNull();
    expect(toastLingerMs(ERROR)).toBeNull();
    expect(toastLingerMs({ kind: "deferred", message: DEFERRED_MESSAGE })).toBeNull();
  });
});

describe("toastDismissible", () => {
  it("only offers a dismissal for a failure", () => {
    expect(toastDismissible(ERROR)).toBe(true);
    expect(toastDismissible(SAVING)).toBe(false);
    expect(toastDismissible(null)).toBe(false);
  });
});

describe("failureMessage", () => {
  it("uses the backend's own reason", () => {
    expect(failureMessage(new Error("TF2 is running."))).toBe("Could not save — TF2 is running");
  });

  it("takes a plain string reason", () => {
    expect(failureMessage("Another change is still saving")).toBe(
      "Could not save — Another change is still saving",
    );
  });

  it("falls back to the bare line when there is no reason", () => {
    expect(failureMessage(null)).toBe("Could not save.");
    expect(failureMessage(new Error("  "))).toBe("Could not save.");
  });

  it("carries a pane's own verb", () => {
    expect(failureMessage(new Error("no network"), "Could not apply")).toBe(
      "Could not apply — no network",
    );
  });
});
