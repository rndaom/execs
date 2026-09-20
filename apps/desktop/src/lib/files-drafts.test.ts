import { describe, expect, it } from "vitest";
import type { FilesSource } from "./bridge";
import { createFilesDraftStore } from "./files-drafts";

const token = (hash: string | null, root = "G:/TF2"): FilesSource => ({
  profileId: "a",
  root,
  layer: "vanilla",
  sha256: hash,
  librarySha256: hash,
});

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

describe("source-bound retained documents", () => {
  it("removes clean missing documents but retains edited missing documents", () => {
    const store = createFilesDraftStore();
    store.read("a", "clean.cfg", "original", token("one"));
    store.read("a", "dirty.cfg", "original", token("two"));
    store.edit("a", "dirty.cfg", "keep this");
    store.markMissing("a", new Set());
    expect(store.state("a", "clean.cfg")).toBeNull();
    expect(store.documents("a").map((file) => file.path)).toEqual(["dirty.cfg"]);
    expect(store.state("a", "dirty.cfg")).toMatchObject({
      text: "keep this",
      missing: true,
      conflict: true,
    });
  });
  it("requires a verified live absence and explicit review to restore a retained draft", () => {
    const store = createFilesDraftStore();
    store.read("a", "cfg", "original", token("one"));
    store.edit("a", "cfg", "keep this");
    const absent = { ...token(null), librarySha256: "one" };
    store.read("a", "cfg", "", absent);
    expect(store.state("a", "cfg")).toMatchObject({
      missing: true,
      conflict: true,
      expected: token("one"),
    });
    expect(store.reviewCurrent("a", "cfg")).toBe(true);
    expect(store.state("a", "cfg")).toMatchObject({
      text: "keep this",
      expected: absent,
      missingReviewed: true,
      dirty: true,
      conflict: false,
    });
    store.read("a", "cfg", "external replacement", token("replacement"));
    expect(store.state("a", "cfg")).toMatchObject({
      missingReviewed: false,
      conflict: true,
      expected: absent,
    });
  });
  it("keeps document selection and edits isolated by profile", () => {
    const store = createFilesDraftStore();
    store.read("a", "same.cfg", "first");
    store.read("b", "same.cfg", "second");
    store.select("a", "same.cfg");
    store.select("b", "other.cfg");
    store.edit("a", "same.cfg", "draft");
    expect(store.read("b", "same.cfg", "second")).toBe("second");
    expect(store.selected("a")).toBe("same.cfg");
    expect(store.selected("b")).toBe("other.cfg");
    expect(store.dirty()).toEqual([expect.objectContaining({ profile: "a", text: "draft" })]);
  });
  it("does not replace an existing creation draft or advance revisions for no-op edits", () => {
    const store = createFilesDraftStore();
    store.create("a", "new.cfg", token(null), "first");
    store.edit("a", "new.cfg", "first");
    store.create("a", "new.cfg", token("other"), "replacement");
    expect(store.state("a", "new.cfg")).toMatchObject({
      text: "first",
      revision: 0,
      expected: token(null),
      created: true,
    });
    store.edit("a", "new.cfg", "second");
    expect(store.state("a", "new.cfg")?.revision).toBe(1);
  });
  it("holds the original token through external drift until an explicit review", () => {
    const store = createFilesDraftStore();
    store.read("a", "cfg", "original", token("one"));
    store.edit("a", "cfg", "mine");
    store.read("a", "cfg", "external", token("two"));
    expect(store.state("a", "cfg")).toMatchObject({
      text: "mine",
      baseline: "original",
      source: "external",
      expected: token("one"),
      currentExpected: token("two"),
      dirty: true,
      conflict: true,
    });
    expect(store.reviewCurrent("a", "cfg")).toBe(true);
    expect(store.state("a", "cfg")).toMatchObject({
      text: "mine",
      baseline: "external",
      expected: token("two"),
      dirty: true,
      conflict: false,
    });
  });
  it("treats changed source identity as conflict even when the text is identical", () => {
    const store = createFilesDraftStore();
    store.read("a", "cfg", "original", token("one"));
    store.edit("a", "cfg", "mine");
    store.read("a", "cfg", "original", token("one", "H:/OtherTF2"));
    expect(store.state("a", "cfg")).toMatchObject({ conflict: true, expected: token("one") });
  });
  it("retains missing dirty sources and refuses review until a source returns", () => {
    const store = createFilesDraftStore();
    store.read("a", "cfg", "original", token("one"));
    store.edit("a", "cfg", "mine");
    store.markMissing("a", new Set());
    expect(store.state("a", "cfg")).toMatchObject({ text: "mine", missing: true, conflict: true });
    expect(store.reviewCurrent("a", "cfg")).toBe(false);
    store.read("a", "cfg", "returned", token("two"));
    expect(store.state("a", "cfg")).toMatchObject({ missing: false, conflict: true, text: "mine" });
  });
  it("retains empty creation drafts and never marks them missing", () => {
    const store = createFilesDraftStore();
    store.create("a", "new.cfg", token(null));
    store.markMissing("a", new Set());
    expect(store.dirty()).toEqual([
      expect.objectContaining({ profile: "a", path: "new.cfg", text: "", expected: token(null) }),
    ]);
    expect(store.state("a", "new.cfg")).toMatchObject({
      created: true,
      missing: false,
      dirty: true,
    });
    store.discard("a", "new.cfg");
    expect(store.state("a", "new.cfg")).toBeNull();
  });
  it("acknowledges the committed token without acquiring a later external token", () => {
    const store = createFilesDraftStore();
    store.read("a", "cfg", "original", token("one"));
    store.edit("a", "cfg", "submitted");
    store.edit("a", "cfg", "newer edit");
    store.read("a", "cfg", "external", token("external"));
    store.acknowledge("a", "cfg", "submitted", token("committed"));
    expect(store.state("a", "cfg")).toMatchObject({
      text: "newer edit",
      baseline: "submitted",
      expected: token("committed"),
      currentExpected: token("external"),
      dirty: true,
      conflict: true,
    });
    expect(store.dirty()[0].expected?.sha256).not.toBe("external");
  });
  it("captures all profile documents and revisions independently of later edits", () => {
    const store = createFilesDraftStore();
    store.read("a", "one", "old", token("one"));
    store.read("a", "two", "clean", token("two"));
    store.read("b", "other", "private");
    store.edit("a", "one", "submitted");
    const snapshot = store.dirty()[0];
    store.edit("a", "two", "changed after click");
    expect(snapshot).toMatchObject({
      text: "submitted",
      revision: 1,
      documents: [
        { path: "one", text: "submitted", revision: 1 },
        { path: "two", text: "clean", revision: 0 },
      ],
    });
    expect(snapshot.documents).not.toEqual(store.documents("a"));
    expect(snapshot.documents?.some((document) => document.path === "other")).toBe(false);
  });
  it("discards to current source and removes missing or newly created drafts", () => {
    const store = createFilesDraftStore();
    store.read("a", "changed", "old", token("one"));
    store.edit("a", "changed", "mine");
    store.read("a", "changed", "current", token("two"));
    store.read("a", "missing", "old");
    store.edit("a", "missing", "mine");
    store.create("a", "created", token(null));
    store.markMissing("a", new Set(["changed"]));
    store.discardAll();
    expect(store.state("a", "changed")).toMatchObject({
      text: "current",
      expected: token("two"),
      dirty: false,
    });
    expect(store.state("a", "missing")).toBeNull();
    expect(store.state("a", "created")).toBeNull();
    expect(store.dirty()).toEqual([]);
  });
});
