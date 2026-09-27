// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AutosaveActivity } from "../hooks/useAutosave";
import { PngImportField } from "./PngImportField";

it("cancels an in-flight PNG decode when its pane is hidden", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const images: { onload: (() => void) | null; onerror: (() => void) | null; src: string }[] = [];
  vi.stubGlobal(
    "Image",
    class {
      onload = null;
      onerror = null;
      src = "";
      constructor() {
        images.push(this);
      }
    },
  );
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL() {
        return "blob:test-png";
      }
      static revokeObjectURL = revoke;
    },
  );
  const box = document.createElement("div");
  document.body.append(box);
  const root = createRoot(box);
  const imported = vi.fn();
  const render = async (active: boolean) =>
    act(async () =>
      root.render(
        <AutosaveActivity.Provider value={active}>
          <PngImportField locked={false} onImport={imported} />
        </AutosaveActivity.Provider>,
      ),
    );
  try {
    await render(true);
    const field = box.querySelector("input");
    if (!field) throw new Error("Missing PNG input");
    const file = {
      size: 8,
      slice: () => ({
        arrayBuffer: async () =>
          new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer,
      }),
    };
    Object.defineProperty(field, "files", { value: [file] });
    await act(async () => field.dispatchEvent(new Event("change", { bubbles: true })));
    expect(images).toHaveLength(1);
    expect(images[0].onload).not.toBeNull();
    await render(false);
    expect(images[0].onload).toBeNull();
    expect(images[0].onerror).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:test-png");
    expect(imported).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    box.remove();
    vi.unstubAllGlobals();
  }
});
