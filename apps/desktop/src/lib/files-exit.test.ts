import { describe, expect, it, vi } from "vitest";
import { createFilesDraftStore } from "./files-drafts";
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
    expect(store.dirty()).toEqual([{ profile: "a", path: "one", text: "newer" }]);
  });
});
