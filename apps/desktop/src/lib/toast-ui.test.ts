import { describe, expect, it } from "vitest";
import {
  DEFERRED_MESSAGE,
  failureMessage,
  SAVED_MESSAGE,
  SAVING_MESSAGE,
  TOAST_DEFERRED_MS,
  TOAST_SAVED_MS,
  type Toast,
  toastDismissible,
  toastInitial,
  toastLingerMs,
  toastStep,
} from "./toast-ui";

const SAVING: Toast = { kind: "saving", message: SAVING_MESSAGE };
const ERROR: Toast = { kind: "error", message: "Could not save — TF2 is running" };

describe("toastStep", () => {
  it("shows the saving pill only once a save is judged slow", () => {
    expect(toastStep(toastInitial(), { type: "slow" }).toast).toEqual(SAVING);
  });

  it("replaces the pill with Saved when the write lands", () => {
    expect(toastStep({ ...toastInitial(), toast: SAVING }, { type: "done" }).toast).toEqual({
      kind: "saved",
      message: SAVED_MESSAGE,
    });
  });

  it("carries a pane's own completion wording", () => {
    expect(toastStep(toastInitial(), { type: "done", message: "Pack built" }).toast).toEqual({
      kind: "saved",
      message: "Pack built",
    });
  });

  it("keeps a failure on screen while the next attempt runs", () => {
    const failed = toastStep(toastInitial(), { type: "fail", message: ERROR.message });
    expect(toastStep(failed, { type: "slow" }).toast).toBe(failed.toast);
    expect(toastStep(failed, { type: "defer" }).toast).toBe(failed.toast);
  });

  it("clears a failure only on that source's next successful save", () => {
    const failed = toastStep(toastInitial(), {
      type: "fail",
      source: "hud",
      message: ERROR.message,
    });
    expect(toastStep(failed, { type: "done", source: "sounds" }).toast).toBe(failed.toast);
    expect(toastStep(failed, { type: "done", source: "hud" }).toast).toMatchObject({
      kind: "saved",
      message: SAVED_MESSAGE,
    });
  });

  it("clears a failure when the user dismisses it", () => {
    const failed = toastStep(toastInitial(), { type: "fail", message: ERROR.message });
    expect(toastStep(failed, { type: "hide" }).toast).toBeNull();
  });

  it("says the draft is kept once, not on every keystroke", () => {
    const first = toastStep(toastInitial(), { type: "defer" });
    expect(first.toast).toEqual({ kind: "deferred", message: DEFERRED_MESSAGE });
    // Same object: React re-renders nothing on the next keystroke.
    expect(toastStep(first, { type: "defer" })).toBe(first);
    const hidden = toastStep(first, { type: "hide", expected: first.toast ?? undefined });
    expect(hidden.toast).toBeNull();
    expect(hidden.deferred).toEqual(["default"]);
    expect(toastStep(hidden, { type: "defer" })).toBe(hidden);
  });

  it("does not revive a faded draft notice after an unrelated save", () => {
    const deferred = toastStep(toastInitial(), { type: "defer", source: "gameplay" });
    const hidden = toastStep(deferred, { type: "hide", expected: deferred.toast ?? undefined });
    const saved = toastStep(hidden, { type: "done", source: "sounds" });
    expect(toastStep(saved, { type: "hide", expected: saved.toast ?? undefined }).toast).toBeNull();
    expect(saved.deferred).toEqual(["gameplay"]);
  });

  it("replaces the draft notice with Saved once the lock lifts", () => {
    const deferred = toastStep(toastInitial(), { type: "defer" });
    expect(toastStep(deferred, { type: "done" }).toast).toEqual({
      kind: "saved",
      message: SAVED_MESSAGE,
    });
  });

  it("lets a later failure replace the saving pill", () => {
    expect(
      toastStep(
        { ...toastInitial(), toast: SAVING },
        { type: "fail", message: "Could not save — disk full" },
      ).toast,
    ).toEqual({
      kind: "error",
      message: "Could not save — disk full",
      source: "default",
    });
  });

  it("cannot hide newer feedback with a timeout captured for an older success", () => {
    const first = toastStep(toastInitial(), { type: "done" });
    const latest = toastStep(first, { type: "fail", message: "HUD options failed" });
    expect(toastStep(latest, { type: "hide", expected: first.toast ?? undefined })).toBe(latest);
  });

  it("retains other failed sources when resolving or dismissing one failure", () => {
    const first = toastStep(toastInitial(), { type: "fail", source: "hud", message: "HUD failed" });
    const second = toastStep(first, { type: "fail", source: "sounds", message: "Sounds failed" });
    expect(toastStep(second, { type: "hide" }).toast).toBe(first.toast);
    expect(toastStep(second, { type: "clear-source", source: "sounds" }).toast).toBe(first.toast);
  });

  it("tracks deferred drafts after the brief notice fades", () => {
    const first = toastStep(toastInitial(), { type: "defer", source: "hud" });
    const second = toastStep(first, { type: "defer", source: "sounds" });
    const hidden = toastStep(second, { type: "hide", expected: second.toast ?? undefined });
    const oneLeft = toastStep(hidden, { type: "resolve-draft", source: "hud" });
    expect(oneLeft.deferred).toEqual(["sounds"]);
    const resolved = toastStep(oneLeft, { type: "resolve-draft", source: "sounds" });
    expect(resolved.deferred).toEqual([]);
    expect(resolved.toast).toBeNull();
  });
});

describe("toastLingerMs", () => {
  it("fades Saved on its own", () => {
    expect(toastLingerMs({ kind: "saved", message: SAVED_MESSAGE })).toBe(TOAST_SAVED_MS);
    expect(toastLingerMs({ kind: "deferred", message: DEFERRED_MESSAGE })).toBe(TOAST_DEFERRED_MS);
  });

  it("leaves saving and failures waiting for an event", () => {
    expect(toastLingerMs(null)).toBeNull();
    expect(toastLingerMs(SAVING)).toBeNull();
    expect(toastLingerMs(ERROR)).toBeNull();
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
