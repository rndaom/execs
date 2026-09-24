import { describe, expect, it } from "vitest";
import { legacyViewmodelSelectionCount, previewViewmodelRecord } from "./viewmodel-ui";

describe("saved viewmodel builder choice compatibility", () => {
  it("counts saved legacy IDs without interpreting or changing them", () => {
    const record = previewViewmodelRecord("compiled");
    record.options.hidden = "legacy/one,legacy/two,legacy/one";
    expect(legacyViewmodelSelectionCount(record)).toBe(2);
    expect(record.options.hidden).toBe("legacy/one,legacy/two,legacy/one");
  });

  it("does not mistake an imported pack for a builder selection", () => {
    const record = previewViewmodelRecord("imported");
    expect(legacyViewmodelSelectionCount(record)).toBe(0);
    expect(legacyViewmodelSelectionCount(null)).toBe(0);
  });
});
