// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPreviewApi } from "../lib/preview-bridge";
import { ReleaseNotes } from "./ReleaseNotes";

let box: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});
afterEach(async () => {
  await act(async () => root.unmount());
  box.remove();
});

it("renders readable notes, opens the matching release and supports Close and Escape", async () => {
  const api = createPreviewApi("release-notes");
  const open = vi.spyOn(api, "openExternal").mockResolvedValue(undefined);
  const close = vi.fn();
  await act(async () =>
    root.render(
      createElement(ReleaseNotes, {
        api,
        release: {
          version: "0.1.3",
          notes: "### Fixed\n- Mouse binds work\n  while the game runs.",
        },
        onClose: close,
        onError: vi.fn(),
      }),
    ),
  );
  expect(box.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
  expect(box.querySelectorAll("li")).toHaveLength(1);
  expect(box.querySelector("li")?.textContent).toBe("Mouse binds work while the game runs.");
  const buttons = [...box.querySelectorAll("button")];
  await act(async () =>
    buttons.find((button) => button.textContent?.includes("View on GitHub"))?.click(),
  );
  expect(open).toHaveBeenCalledWith("https://github.com/rndaom/execs/releases/tag/v0.1.3");
  await act(async () => buttons.find((button) => button.textContent === "Close")?.click());
  expect(close).toHaveBeenCalledTimes(1);
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(close).toHaveBeenCalledTimes(2);
});

it("reports a failed release link and provides a fallback when notes are absent", async () => {
  const api = createPreviewApi("release-notes");
  vi.spyOn(api, "openExternal").mockRejectedValue(Error("offline"));
  const onError = vi.fn();
  await act(async () =>
    root.render(
      createElement(ReleaseNotes, {
        api,
        release: { version: "0.1.3", notes: null },
        onClose: vi.fn(),
        onError,
      }),
    ),
  );
  expect(box.textContent).toContain("View the complete notes on GitHub.");
  await act(async () => box.querySelector("button")?.click());
  expect(onError).toHaveBeenCalledWith("Could not open the release page.");
});
