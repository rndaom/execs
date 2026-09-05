import { describe, expect, it } from "vitest";
import { createFilesDraftStore } from "./files-drafts";

describe("retained file baselines", () => {
  it("does not mistake an old source value for a clean draft after external drift", () => {
    const store = createFilesDraftStore();
    store.read("a", "cfg", "90");
    store.edit("a", "cfg", "75");
    expect(store.read("a", "cfg", "80")).toBe("75");
    store.edit("a", "cfg", "90");
    expect(store.read("a", "cfg", "85")).toBe("90");
  });

  it("accepts external changes after an acknowledged save", () => {
    const store = createFilesDraftStore();
    store.read("a", "cfg", "90");
    store.edit("a", "cfg", "75");
    store.acknowledge("a", "cfg", "75");
    expect(store.read("a", "cfg", "75")).toBe("75");
    expect(store.read("a", "cfg", "80")).toBe("80");
  });

  it("preserves newer unsaved bytes through acknowledgement and external drift", () => {
    const store = createFilesDraftStore();
    store.read("a", "cfg", "90");
    store.edit("a", "cfg", "75");
    store.edit("a", "cfg", "85");
    store.acknowledge("a", "cfg", "75");
    expect(store.read("a", "cfg", "75")).toBe("85");
    expect(store.read("a", "cfg", "80")).toBe("85");
    store.discard("a", "cfg", "80");
    expect(store.read("a", "cfg", "80")).toBe("80");
  });
});
