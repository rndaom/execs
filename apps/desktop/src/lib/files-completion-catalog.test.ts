import { lookupCommand } from "@execs/cfglint";
import { describe, expect, it } from "vitest";
import { filesCompletionCatalog } from "./files-completion-catalog";

describe("spoken completion reference", () => {
  it("separates kind from the name and leaves URLs and revisions to Reference", () => {
    const completion = filesCompletionCatalog().commands.find(
      (entry) => entry.label === "sensitivity",
    );
    const reference = lookupCommand("sensitivity");
    expect(completion?.detail).toBe(" · cvar");
    expect(completion?.info).toContain("Source:");
    expect(completion?.info).toContain("Reference");
    expect(completion?.info).not.toMatch(/https?:\/\/|[a-f0-9]{40}/);
    expect(reference?.sources.some((source) => /^https?:/.test(source.url))).toBe(true);
    expect(reference?.sources.some((source) => source.revision.length > 0)).toBe(true);
  });
});
