import { describe, expect, it, vi } from "vitest";
import { createFilesDraftStore, type DirtyFileDraft } from "./files-drafts";
import { saveFileDrafts } from "./files-exit";

function dirty() {
  const store = createFilesDraftStore();
  for (const [profile, path] of [
    ["a", "one"],
    ["a", "two"],
    ["b", "one"],
  ]) {
    store.read(profile, path, "old");
    store.edit(profile, path, "new");
  }
  return store;
}
describe("Files exit save transaction", () => {
  it("awaits every profile/path acknowledgement", async () => {
    const store = dirty();
    const save = vi.fn(async () => true);
    expect(await saveFileDrafts(store, save)).toBe(true);
    expect(save).toHaveBeenCalledTimes(3);
    expect(store.dirty()).toEqual([]);
  });
  it("retains failed and remaining drafts after a partial save", async () => {
    const store = dirty();
    const save = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await saveFileDrafts(store, save)).toBe(false);
    expect(store.dirty()).toHaveLength(2);
  });
  it("retains rejected writes", async () => {
    const store = dirty();
    await expect(
      saveFileDrafts(store, async () => {
        throw Error("disk");
      }),
    ).rejects.toThrow("disk");
    expect(store.dirty()).toHaveLength(3);
  });
  it("does not permit exit after newer bytes arrive during save", async () => {
    const store = dirty();
    expect(
      await saveFileDrafts(store, async (d) => {
        if (d.path === "one" && d.profile === "a") store.edit("a", "one", "newer");
        return true;
      }),
    ).toBe(false);
    expect(store.dirty()).toEqual([
      expect.objectContaining({ profile: "a", path: "one", text: "newer" }),
    ]);
  });
  it("keeps one immutable click-time document set across a partial save-all", async () => {
    const store = dirty();
    const save = vi.fn(async (draft: DirtyFileDraft) => {
      expect(draft.documents).toEqual([
        { path: "one", text: "new", revision: 1 },
        { path: "two", text: "new", revision: 1 },
      ]);
      if (draft.path === "one") {
        store.edit("a", "two", "changed during first write");
        return true;
      }
      return false;
    });
    expect(await saveFileDrafts(store, save)).toBe(false);
    expect(save).toHaveBeenCalledTimes(2);
    expect(store.dirty()).toEqual([
      expect.objectContaining({ profile: "a", path: "two", text: "changed during first write" }),
      expect.objectContaining({ profile: "b", path: "one", text: "new" }),
    ]);
  });
});
