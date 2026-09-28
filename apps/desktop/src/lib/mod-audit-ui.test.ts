import { describe, expect, it } from "vitest";
import type { PackContent, PreloaderStatusPayload } from "./bridge";
import { packCasualNote } from "./mod-audit-ui";
import { PREVIEW_MODS_STATUS, PREVIEW_PROFILE_MODS } from "./mods-ui";

const pack: PackContent = {
  pack: "test.vpk",
  files: 2,
  restrictedSounds: false,
  soundScripts: [],
  exemptHitSounds: false,
  modelsMaterials: false,
  particles: false,
  other: false,
};
const payload: PreloaderStatusPayload = {
  ...PREVIEW_MODS_STATUS,
  contentAudit: { packs: [pack], overlaps: [], splitModels: [], incomplete: [], omittedDetails: 0 },
};

describe("installed pack Casual notes", () => {
  it("exempts hit and kill sounds while identifying restricted sounds and scripts", () => {
    const note = packCasualNote({ ...pack, exemptHitSounds: true }, undefined, payload);
    expect(note).toContain("Hit and kill sounds still work");
    expect(note).not.toContain("won't load");
    expect(
      packCasualNote(
        { ...pack, restrictedSounds: true, soundScripts: ["scripts/game_sounds_weapons.txt"] },
        undefined,
        payload,
      ),
    ).toContain("Its custom sounds and sound scripts won't load on Valve's Casual servers");
  });
  it("does not turn enabled preloading or an incomplete scan into a works claim", () => {
    const model = { ...pack, modelsMaterials: true };
    expect(packCasualNote(model, undefined, payload)).toContain(
      "isn't confirmed in a real match yet",
    );
    expect(packCasualNote(model, undefined, { ...payload, profilePreload: false })).toContain(
      "need Preload",
    );
    expect(
      packCasualNote(model, undefined, {
        ...payload,
        contentAudit: {
          packs: [pack],
          overlaps: [],
          splitModels: [],
          omittedDetails: 0,
          incomplete: ["unreadable"],
        },
      }),
    ).toContain("Some files could not be checked");
    expect(packCasualNote(undefined, undefined, payload)).toContain("unavailable");
  });
  it("explains unavailable particles even when they remain selected", () => {
    const mod = PREVIEW_PROFILE_MODS[0];
    expect(
      packCasualNote({ ...pack, particles: true }, mod, {
        ...payload,
        status: { ...payload.status, profileParticleMods: [mod.id] },
        profileParticleSources: [
          {
            modId: mod.id,
            name: mod.name,
            pcfFiles: ["new.pcf"],
            unavailableReason: "No stock carrier",
          },
        ],
      }),
    ).toContain("No stock carrier");
  });
});
