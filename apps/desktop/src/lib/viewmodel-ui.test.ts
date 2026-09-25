import { describe, expect, it } from "vitest";
import type { ViewmodelSourceCatalog } from "./bridge";
import {
  conflictingViewmodelGroupIds,
  legacyViewmodelSelectionCount,
  previewViewmodelRecord,
  selectedViewmodelChoices,
  viewmodelCatalogRevision,
  viewmodelClasses,
  viewmodelDraftBuildRequest,
  viewmodelGroupsForClass,
} from "./viewmodel-ui";

const catalog: ViewmodelSourceCatalog = {
  status: "provisional",
  catalog: { patchVersion: "1", catalogSha256: "catalog" },
  sourceFingerprints: [{ id: "source", sha256: "one" }],
  groups: [
    {
      id: "scout/one",
      class: "scout",
      items: [{ id: 13, schemaName: "Scattergun" }],
      animations: ["a"],
      overlaps: ["scout/two"],
      teamVariantsDiffer: false,
    },
    {
      id: "scout/two",
      class: "scout",
      items: [{ id: 14, schemaName: "Shortstop" }],
      animations: ["a", "b"],
      overlaps: ["scout/one"],
      teamVariantsDiffer: false,
    },
    {
      id: "soldier/one",
      class: "soldier",
      items: [{ id: 18, schemaName: "Rocket Launcher" }],
      animations: ["c"],
      overlaps: [],
      teamVariantsDiffer: false,
    },
  ],
  unresolvedItems: [],
  unresolvedRoleCount: 0,
  candidateRoleCount: 0,
};

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

describe("installed Viewmodels catalog planning", () => {
  it("orders classes and searches installed item names and IDs", () => {
    expect(viewmodelClasses(catalog)).toEqual(["scout", "soldier"]);
    expect(viewmodelGroupsForClass(catalog, "scout", "short").map((group) => group.id)).toEqual([
      "scout/two",
    ]);
    expect(viewmodelGroupsForClass(catalog, "scout", "13").map((group) => group.id)).toEqual([
      "scout/one",
    ]);
  });

  it("clears a draft on a source fingerprint change even if group membership is unchanged", () => {
    expect(viewmodelCatalogRevision(catalog)).not.toBe(
      viewmodelCatalogRevision({
        ...catalog,
        sourceFingerprints: [{ id: "source", sha256: "two" }],
      }),
    );
  });

  it("reports different modes on shared animations and sorts request choices", () => {
    expect(
      [
        ...conflictingViewmodelGroupIds(catalog, {
          "scout/one": "full",
          "scout/two": "weapon",
        }),
      ].sort(),
    ).toEqual(["scout/one", "scout/two"]);
    expect(conflictingViewmodelGroupIds(catalog, { "scout/one": "full" }).size).toBe(0);
    expect(selectedViewmodelChoices({ "scout/two": "weapon", "scout/one": "full" })).toEqual([
      { groupId: "scout/one", mode: "full" },
      { groupId: "scout/two", mode: "weapon" },
    ]);
    expect(viewmodelDraftBuildRequest(catalog, { "scout/two": "weapon" }, false)).toEqual({
      catalog: catalog.catalog,
      sourceFingerprints: catalog.sourceFingerprints,
      choices: [{ groupId: "scout/two", mode: "weapon" }],
      preload: false,
    });
  });
});
