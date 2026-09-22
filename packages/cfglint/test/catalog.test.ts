import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  enumerateCatalog,
  lookupCommand,
  suggestCvarByRemovingOneCharacter,
} from "../src/catalog.ts";
import { lookupCvar } from "../src/corpus.ts";

describe("offline command catalog", () => {
  it("covers every app-generated bind action and both button edges", () => {
    const binds = readFileSync(
      new URL("../../../apps/desktop/src/lib/binds-ui.ts", import.meta.url),
      "utf8",
    );
    const actions = [...binds.matchAll(/command: "([^"]+)"/g)].map(
      (match) => match[1].split(" ")[0],
    );
    expect(actions.length).toBeGreaterThan(10);
    for (const name of [...actions, "exec", "alias", "bind", "unbind", "+attack", "-attack"]) {
      expect(lookupCommand(name), name).toBeDefined();
      expect(lookupCvar(name), name).toBeDefined();
      if (name.startsWith("+")) expect(lookupCommand(`-${name.slice(1)}`)).toBeDefined();
    }
  });
  it("is sorted, case insensitive, immutable and has per-entry pinned provenance", () => {
    const entries = enumerateCatalog();
    expect(entries.length).toBeGreaterThan(4000);
    expect(entries.map((entry) => entry.name)).toEqual(entries.map((entry) => entry.name).sort());
    expect(lookupCommand("VoIcEmEnU")).toBe(lookupCommand("voicemenu"));
    expect(Object.isFrozen(entries)).toBe(true);
    for (const entry of entries) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(entry.applicability).not.toBe("");
      expect(entry.sources.length).toBeGreaterThan(0);
      for (const source of entry.sources) {
        expect(source.revision).toMatch(/^[a-f0-9]{40}$/);
        expect(source.url).toContain(source.revision);
        expect(source.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
  it("reports only verified metadata and distinguishes mastercomfig aliases", () => {
    expect(lookupCommand("voicemenu")?.arguments).toEqual([
      { name: "menu", type: "integer" },
      { name: "item", type: "integer" },
    ]);
    expect(lookupCommand("sensitivity")?.value).toBeUndefined();
    expect(lookupCommand("sensitivity")?.applicability).toContain("Windows");
    expect(lookupCommand("fov_desired")?.value).toEqual({
      name: "value",
      type: "number",
      min: 20,
      max: 90,
    });
    expect(lookupCommand("resetclass")?.kind).toBe("alias");
    expect(lookupCommand("resetclass")?.applicability).toContain("mastercomfig");
    expect(lookupCommand("texture_quality=low")?.kind).toBe("alias");
    for (const name of ["r_lightmap_bicubic_set", "m_rawinput_onetime_reset"]) {
      const supplement = lookupCommand(name);
      expect(supplement?.kind).toBe("cvar");
      expect(supplement?.defaultValue).toBeUndefined();
      expect(supplement?.applicability).toContain("current retail availability");
      expect(supplement?.sources[0]?.url).toContain("mastercomfig");
    }
    expect(lookupCommand("exec")?.syntax).toBe("exec <cfg path>");
    expect(lookupCommand("exec")?.arguments).toBeUndefined();
    expect(lookupCommand("not_a_known_command")).toBeUndefined();
    expect(lookupCvar("__proto__")).toBeUndefined();
    expect(lookupCvar("constructor")).toBeUndefined();
  });
  it("keeps colon-containing string defaults and discloses conflicting defaults", () => {
    expect(lookupCommand("cl_streams_image_sfurl")?.defaultValue).toBe("img://loadjpeg:(320x200):");
    expect(lookupCommand("sv_backspeed")?.defaultValue).toBeUndefined();
    expect(lookupCommand("sv_backspeed")?.applicability).toContain("defaults differ");
    expect(lookupCommand("sv_backspeed")?.sources).toHaveLength(2);
  });
  it("suggests only an unambiguous catalogued cvar for an extra character", () => {
    expect(suggestCvarByRemovingOneCharacter("viewwmodel_fov")).toBe("viewmodel_fov");
    expect(suggestCvarByRemovingOneCharacter("plugin_setting")).toBeNull();
  });
});
