import { describe, expect, it } from "vitest";
import { buildCorpus, mergeEntry, parseDump } from "../tools/build-corpus.mjs";

describe("catalog generation guards", () => {
  const dump =
    '```c\n--------------\n+attack : cmd : :\npath : https://example.test/a : , "a" : Help\n';
  it("parses leading signs and embedded colons reproducibly", () => {
    expect([...parseDump(dump, 2)]).toEqual([...parseDump(dump, 2)]);
    expect(parseDump(dump, 2).get("path").d).toBe("https://example.test/a");
    expect(parseDump(dump, 2).get("+attack").c).toBe(1);
  });
  it("rejects missing, malformed and implausibly incomplete inputs", () => {
    expect(() => buildCorpus([])).toThrow("Missing source");
    expect(() => parseDump("unavailable", 1)).toThrow("structure");
    expect(() => parseDump(dump, 10)).toThrow("coverage");
    expect(() => parseDump(`${dump}broken : x : invalid : help`, 2)).toThrow("flags");
    expect(() => parseDump(`${dump}broken : x`, 2)).toThrow("Malformed");
  });
  it("refuses kind conflicts and retains both provenance sources without guessing defaults", () => {
    const corpus = { test: { c: 0, d: "1", s: [0], a: "Windows" } };
    expect(() => mergeEntry(corpus, "test", { c: 1, s: [1] })).toThrow("Conflicting c");
    mergeEntry(corpus, "test", { c: 0, d: "2", s: [1], a: "Hidden" });
    expect(corpus.test.d).toBeUndefined();
    expect(corpus.test.s).toEqual([0, 1]);
    expect(corpus.test.a).toContain("defaults differ");
  });
});
