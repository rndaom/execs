// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useReleaseNotes } from "./useReleaseNotes";

it("keeps startup working when the localStorage getter throws", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const denied = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("Storage is disabled", "SecurityError");
  });
  const box = document.createElement("div");
  const root = createRoot(box);
  function Harness() {
    const { release } = useReleaseNotes({
      version: "0.1.3",
      installResolved: true,
      existingInstall: true,
    });
    return createElement("p", null, release ? release.version : "Ready");
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(box.textContent).toBe("Ready");
  } finally {
    await act(async () => root.unmount());
    denied.mockRestore();
  }
});
