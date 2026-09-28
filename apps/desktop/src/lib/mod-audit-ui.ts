import type { ModRecord, PackContent, PreloaderStatusPayload } from "./bridge";

/** Content expectations only: a static path scan cannot verify in-game results. */
export function packCasualNote(
  pack: PackContent | undefined,
  mod: ModRecord | undefined,
  payload: PreloaderStatusPayload | null,
): string {
  if (!pack || !payload?.contentAudit) return "Casual: content check unavailable.";
  const notes: string[] = [];
  if (payload.contentAudit.incomplete.length) notes.push("Incomplete content check.");
  if (pack.restrictedSounds || pack.soundScripts.length) {
    const what = [
      pack.restrictedSounds ? "sounds" : "",
      pack.soundScripts.length ? "sound scripts" : "",
    ]
      .filter(Boolean)
      .join(" and ");
    notes.push(
      `Expected Casual restriction: custom ${what}. Community servers may allow them; server exceptions are not inspected.`,
    );
  }
  if (pack.exemptHitSounds)
    notes.push("Hit and kill sound paths are exempt from the sound restriction.");
  if (pack.modelsMaterials) {
    notes.push(
      payload.profilePreload && payload.preloadLaunchInSteam && payload.status.gameinfoBypassed
        ? "Models/materials have preload enabled; retail Casual behavior is unverified."
        : "Models/materials need Preload on launch, its Steam option and Material bypass; retail Casual behavior is unverified.",
    );
  }
  if (pack.particles) {
    const source = mod && payload.profileParticleSources?.find((value) => value.modId === mod.id);
    if (source?.unavailableReason) notes.push(`Particles: ${source.unavailableReason}`);
    else if (source && payload.status.profileParticleMods?.includes(source.modId))
      notes.push("Particles are selected for Casual; check the Apply result for skipped files.");
    else
      notes.push(
        "Particles need a supported stock carrier and an applied selection in Casual setup.",
      );
  }
  if (pack.other) notes.push("Other content is not classified for Casual.");
  if (!notes.length) notes.push("Casual: no classified content was found.");
  return notes.join(" ");
}

export function packAuditNotes(
  mods: ModRecord[],
  payload: PreloaderStatusPayload | null,
): Record<string, string> {
  return Object.fromEntries(
    mods.map((mod) => [
      mod.id,
      packCasualNote(
        payload?.contentAudit?.packs.find((pack) => pack.pack === mod.pack),
        mod,
        payload,
      ),
    ]),
  );
}
