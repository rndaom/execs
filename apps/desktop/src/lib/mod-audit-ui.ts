import type { ModRecord, PackContent, PreloaderStatusPayload } from "./bridge";

/** Content expectations only: a static path scan cannot verify in-game results. */
export function packCasualNote(
  pack: PackContent | undefined,
  mod: ModRecord | undefined,
  payload: PreloaderStatusPayload | null,
): string {
  if (!pack || !payload?.contentAudit) return "Casual check unavailable.";
  const notes: string[] = [];
  if (payload.contentAudit.incomplete.length) notes.push("Some files could not be checked.");
  if (pack.restrictedSounds || pack.soundScripts.length) {
    const what = [
      pack.restrictedSounds ? "sounds" : "",
      pack.soundScripts.length ? "sound scripts" : "",
    ]
      .filter(Boolean)
      .join(" and ");
    notes.push(
      `Its custom ${what} won't load on Valve's Casual servers. Community servers may allow them.`,
    );
  }
  if (pack.exemptHitSounds) notes.push("Hit and kill sounds still work on Casual.");
  if (pack.modelsMaterials) {
    notes.push(
      payload.profilePreload && payload.preloadLaunchInSteam && payload.status.gameinfoBypassed
        ? "Models and textures should load on Casual through Preload on launch. This isn't confirmed in a real match yet."
        : "Models and textures need Preload on launch, its Steam launch option and Material bypass to load on Casual.",
    );
  }
  if (pack.particles) {
    const source = mod && payload.profileParticleSources?.find((value) => value.modId === mod.id);
    if (source?.unavailableReason) notes.push(`Particles: ${source.unavailableReason}`);
    else if (source && payload.status.profileParticleMods?.includes(source.modId))
      notes.push(
        "Its particles are selected in Casual setup. After Apply, check for skipped files.",
      );
    else
      notes.push(
        "Its particles load on Casual only if they replace TF2's own particle files and you select this pack in Casual setup.",
      );
  }
  if (pack.other) notes.push("Some of its files aren't covered by this check.");
  if (!notes.length) notes.push("Nothing in this pack is affected by Casual's rules.");
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
