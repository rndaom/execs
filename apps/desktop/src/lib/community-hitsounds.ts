/**
 * Archival display names for TF2Hitsounds WAVs already installed by older
 * execs versions. The app no longer offers this remote catalog. `levelup`
 * was never installed because its 32 728 Hz WAV cannot play in TF2.
 */
export type CommunityHitsound = {
  /** Upstream file stem retained in older profile records. */
  id: string;
  /** Display name. */
  label: string;
};

export const COMMUNITY_HITSOUNDS: CommunityHitsound[] = [
  { id: "bababa", label: "Bababa" },
  { id: "banana", label: "Banana" },
  { id: "bling", label: "Bling" },
  { id: "blinghit", label: "Bling hit" },
  { id: "blublublub", label: "Blub" },
  { id: "bottlecap", label: "Bottle cap" },
  { id: "bowlingpin", label: "Bowling pin" },
  { id: "bubble", label: "Bubble" },
  { id: "bwing", label: "Bwing" },
  { id: "checkpoint", label: "Checkpoint" },
  { id: "cherrybomb", label: "Cherry bomb" },
  { id: "cowbell", label: "Cowbell" },
  { id: "exoselect", label: "Exo select" },
  { id: "hammer", label: "Hammer" },
  { id: "horn", label: "Horn" },
  { id: "icehit", label: "Ice hit" },
  { id: "kaching", label: "Ka-ching" },
  { id: "katamari", label: "Katamari" },
  { id: "lego", label: "Lego" },
  { id: "m1garand", label: "M1 Garand ping" },
  { id: "metalhit", label: "Metal hit" },
  { id: "mothron", label: "Mothron" },
  { id: "orbheal", label: "Orb heal" },
  { id: "peggle", label: "Peggle" },
  { id: "pop", label: "Pop" },
  { id: "quack", label: "Quack" },
  { id: "radar", label: "Radar" },
  { id: "scutlix", label: "Scutlix" },
  { id: "squeak", label: "Squeak" },
  { id: "steeldrum", label: "Steel drum" },
  { id: "switch", label: "Switch" },
  { id: "vanquish", label: "Vanquish" },
];

export function communityHitsoundLabel(id: string): string {
  return COMMUNITY_HITSOUNDS.find((entry) => entry.id === id)?.label ?? id;
}
