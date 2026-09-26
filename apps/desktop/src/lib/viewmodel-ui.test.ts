import { describe, expect, it } from "vitest";
import type { ViewmodelSourceCatalog } from "./bridge";
import {
  conflictingViewmodelGroupIds,
  legacyViewmodelSelectionCount,
  previewViewmodelRecord,
  selectedViewmodelChoices,
  viewmodelCatalogRevision,
  viewmodelChoiceChanges,
  viewmodelClasses,
  viewmodelDraftBuildRequest,
  viewmodelGroupItemNames,
  viewmodelGroupLabel,
  viewmodelGroupsForClass,
  viewmodelItemName,
  viewmodelPresetChoices,
  viewmodelRowItemNames,
  viewmodelRowLabel,
  viewmodelRowsForClass,
  viewmodelSectionsForClass,
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

describe("loadout sections and readable names", () => {
  type Group = ViewmodelSourceCatalog["groups"][number];
  const group = (id: string, cls: string, items: Group["items"], inspect = false): Group => ({
    id,
    class: cls,
    items,
    animations: [id],
    inspect,
    overlaps: [],
    teamVariantsDiffer: false,
  });
  const sectioned: ViewmodelSourceCatalog = {
    ...catalog,
    groups: [
      group("scout/bat", "scout", [
        { id: 190, schemaName: "Upgradeable TF_WEAPON_BAT", slot: "melee" },
        { id: 44, schemaName: "The Sandman", slot: "melee" },
        { id: 0, schemaName: "TF_WEAPON_BAT", slot: "melee" },
      ]),
      group("scout/milk", "scout", [
        { id: 222, schemaName: "Mad Milk", slot: "secondary" },
        { id: 46, schemaName: "Bonk! Atomic Punch", slot: "secondary" },
      ]),
      group("scout/scattergun", "scout", [
        { id: 13, schemaName: "TF_WEAPON_SCATTERGUN", slot: "primary" },
        { id: 15000, schemaName: "concealedkiller_scattergun_nightterror", slot: "primary" },
        { id: 669, schemaName: "Festive Scattergun 2011", slot: "primary" },
        { id: 1152, schemaName: "TF_WEAPON_GRAPPLINGHOOK", slot: "action" },
        { id: 1153, schemaName: "TF_WEAPON_GRAPPLINGHOOK", slot: "action" },
      ]),
      group(
        "scout/scattergun-inspect",
        "scout",
        [{ id: 13, schemaName: "TF_WEAPON_SCATTERGUN", slot: "primary" }],
        true,
      ),
      group("spy/revolver", "spy", [
        { id: 24, schemaName: "TF_WEAPON_REVOLVER", slot: "secondary" },
      ]),
      group("spy/sapper", "spy", [
        { id: 810, schemaName: "The Red-Tape Recorder", slot: "building" },
      ]),
      group("engineer/pda", "engineer", [
        { id: 25, schemaName: "TF_WEAPON_PDA_ENGINEER_BUILD", slot: "pda" },
      ]),
    ],
  };

  it("names stock schema identifiers and skips cosmetic or internal copies", () => {
    expect(viewmodelItemName("TF_WEAPON_PIPEBOMBLAUNCHER")).toBe("Stickybomb Launcher");
    expect(viewmodelItemName("Upgradeable TF_WEAPON_SHOTGUN_HWG")).toBe("Shotgun");
    expect(viewmodelItemName("TF_WEAPON_SOMETHING_NEW")).toBe("Something New");
    expect(viewmodelItemName("The Shortstop")).toBe("Shortstop");
    const bat = sectioned.groups[0];
    expect(viewmodelGroupLabel(bat)).toBe("Bat");
    expect(viewmodelGroupItemNames(bat)).toEqual(["Bat", "Sandman"]);
    const scattergun = sectioned.groups[2];
    expect(viewmodelGroupItemNames(scattergun)).toEqual(["Scattergun", "Grappling Hook"]);
    expect(viewmodelGroupLabel(sectioned.groups[3])).toBe("Scattergun inspect");
  });

  it("orders sections like the loadout, with shared action items not deciding a slot", () => {
    const scout = viewmodelSectionsForClass(sectioned, "scout", "");
    expect(scout.map((section) => [section.id, section.rows.map((row) => row.id)])).toEqual([
      ["primary", ["scout/scattergun"]],
      ["secondary", ["scout/milk"]],
      ["melee", ["scout/bat"]],
      ["inspect", ["scout/scattergun-inspect"]],
    ]);
    expect(
      viewmodelSectionsForClass(sectioned, "spy", "").map((section) => [
        section.id,
        section.rows.length,
      ]),
    ).toEqual([
      ["primary", 1],
      ["secondary", 1],
    ]);
    expect(viewmodelSectionsForClass(sectioned, "engineer", "")[0].label).toBe("PDA and buildings");
  });

  it("searches readable names as well as schema identifiers", () => {
    expect(viewmodelGroupsForClass(sectioned, "scout", "sandman").map((g) => g.id)).toEqual([
      "scout/bat",
    ]);
    expect(viewmodelGroupsForClass(sectioned, "scout", "bonk").map((g) => g.id)).toEqual([
      "scout/milk",
    ]);
  });

  it("folds a bread reskin into its base weapon's row, including inspect", () => {
    const bread: ViewmodelSourceCatalog = {
      ...catalog,
      groups: [
        {
          ...group("scout/drink", "scout", [
            {
              id: 46,
              schemaName: "Bonk! Atomic Punch",
              itemClass: "tf_weapon_lunchbox_drink",
              slot: "secondary",
            },
            { id: 222, schemaName: "Mad Milk", itemClass: "tf_weapon_jar_milk", slot: "secondary" },
          ]),
          animations: ["@ed_draw"],
        },
        {
          ...group("scout/bm", "scout", [
            {
              id: 1121,
              schemaName: "Mutated Milk",
              itemClass: "tf_weapon_jar_milk",
              slot: "secondary",
            },
          ]),
          animations: ["@bm_draw", "@melee_allclass_swing"],
        },
        {
          ...group(
            "scout/drink-inspect",
            "scout",
            [
              {
                id: 46,
                schemaName: "Bonk! Atomic Punch",
                itemClass: "tf_weapon_lunchbox_drink",
                slot: "secondary",
              },
              {
                id: 222,
                schemaName: "Mad Milk",
                itemClass: "tf_weapon_jar_milk",
                slot: "secondary",
              },
            ],
            true,
          ),
          animations: ["@item1_inspect_start"],
        },
        {
          ...group(
            "scout/bm-inspect",
            "scout",
            [
              {
                id: 1121,
                schemaName: "Mutated Milk",
                itemClass: "tf_weapon_jar_milk",
                slot: "secondary",
              },
            ],
            true,
          ),
          animations: ["@breadmonster_inspect_start"],
        },
        {
          ...group("scout/cleaver", "scout", [
            {
              id: 812,
              schemaName: "The Flying Guillotine",
              itemClass: "tf_weapon_cleaver",
              slot: "secondary",
            },
          ]),
          animations: ["@cleave_draw"],
        },
      ],
    };
    const rows = viewmodelRowsForClass(bread, "scout");
    // Inspect rows sort with their weapon; sections separate them for display.
    expect(rows.map((row) => [row.id, row.groups.map((member) => member.id)])).toEqual([
      ["scout/drink", ["scout/drink", "scout/bm"]],
      ["scout/drink-inspect", ["scout/drink-inspect", "scout/bm-inspect"]],
      ["scout/cleaver", ["scout/cleaver"]],
    ]);
    expect(viewmodelRowLabel(rows[0])).toBe("Bonk! Atomic Punch");
    expect(viewmodelRowItemNames(rows[0])).toEqual([
      "Bonk! Atomic Punch",
      "Mad Milk",
      "Mutated Milk",
    ]);
    expect(viewmodelRowLabel(rows[1])).toBe("Bonk! Atomic Punch inspect");
  });
});

describe("whole-profile viewmodel presets", () => {
  const withMelee: ViewmodelSourceCatalog = {
    ...catalog,
    groups: [
      ...catalog.groups,
      {
        id: "scout/bat",
        class: "scout",
        items: [{ id: 0, schemaName: "Bat", slot: "melee" }],
        animations: ["m"],
        overlaps: [],
        teamVariantsDiffer: false,
      },
      {
        id: "scout/bat-inspect",
        class: "scout",
        items: [{ id: 0, schemaName: "Bat", slot: "melee" }],
        animations: ["mi"],
        overlaps: [],
        teamVariantsDiffer: false,
        inspect: true,
      },
    ],
  };

  it("hides every row in every class, or all but melee, in the chosen mode", () => {
    expect(viewmodelPresetChoices(withMelee, "show-all", "full")).toEqual({});
    expect(viewmodelPresetChoices(withMelee, "hide-all", "weapon")).toEqual({
      "scout/one": "weapon",
      "scout/two": "weapon",
      "scout/bat": "weapon",
      "scout/bat-inspect": "weapon",
      "soldier/one": "weapon",
    });
    expect(viewmodelPresetChoices(withMelee, "keep-melee", "full")).toEqual({
      "scout/one": "full",
      "scout/two": "full",
      "soldier/one": "full",
    });
  });

  it("lists exactly the rows that change, in class and loadout order", () => {
    const before = { "scout/one": "weapon" as const, "scout/bat": "full" as const };
    const after = viewmodelPresetChoices(withMelee, "keep-melee", "full");
    const changes = viewmodelChoiceChanges(withMelee, before, after).map((change) => [
      change.row.id,
      change.from,
      change.to,
    ]);
    // The fixture's other weapons have no slot, so they sort after Melee.
    expect(changes).toEqual([
      ["scout/bat", "full", "shown"],
      ["scout/one", "weapon", "full"],
      ["scout/two", "shown", "full"],
      ["soldier/one", "shown", "full"],
    ]);
    expect(viewmodelChoiceChanges(withMelee, after, after)).toEqual([]);
  });
});
