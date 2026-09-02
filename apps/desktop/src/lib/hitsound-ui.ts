import type {
  HitsoundEntry,
  HitsoundKind,
  HitsoundPick,
  HitsoundRecord,
  HitsoundSlotChange,
  PickedHitsound,
} from "./bridge";
import { communityHitsoundLabel } from "./community-hitsounds";
import type { GameplaySettings } from "./gameplay-ui";

/**
 * The nine built-in effects `tf_dingalingaling_effect` and
 * `tf_dingalingaling_last_effect` index into. Index 0 is the one that reads
 * the customizable file; the others are fixed engine sounds. The stems are
 * the first file each effect plays, for auditioning from the user's VPK.
 */
export const STOCK_HITSOUND_EFFECTS: { index: number; label: string; hit: string; kill: string }[] =
  [
    { index: 0, label: "Default ding", hit: "hitsound", kill: "killsound" },
    { index: 1, label: "Electro", hit: "hitsound_electro1", kill: "killsound_electro" },
    { index: 2, label: "Notes", hit: "hitsound_menu_note1", kill: "killsound_note" },
    { index: 3, label: "Percussion", hit: "hitsound_percussion1", kill: "killsound_percussion" },
    { index: 4, label: "Retro", hit: "hitsound_retro1", kill: "killsound_retro" },
    { index: 5, label: "Space", hit: "hitsound_space", kill: "killsound_space" },
    { index: 6, label: "Beepo", hit: "hitsound_beepo", kill: "killsound_beepo" },
    { index: 7, label: "Vortex", hit: "hitsound_vortex1", kill: "killsound_vortex" },
    { index: 8, label: "Squasher", hit: "hitsound_squasher", kill: "killsound_squasher" },
  ];

export const HITSOUND_CASUAL_COPY =
  "Custom files play on Valve Casual too — TF2 exempts sound/ui/hitsound.wav and killsound.wav from sv_pure by name.";

/** What one slot should sound like after the next apply. */
export type SoundChoice =
  | { kind: "stock"; effect: number }
  | { kind: "community"; id: string }
  | { kind: "file"; picked: PickedHitsound }
  /** The custom file already installed in this slot — nothing to re-send. */
  | { kind: "installed"; entry: HitsoundEntry };

export type SlotDraft = {
  enabled: boolean;
  choice: SoundChoice;
  /** 0–100, the cvar's 0–1 scaled. */
  volume: number;
  pitchMin: number;
  pitchMax: number;
};

export type SoundsDraft = {
  hit: SlotDraft;
  kill: SlotDraft;
  /** Seconds between hit sounds; 0 plays every damage instance. */
  repeatDelay: number;
};

function stockEffect(index: number): number {
  return Number.isFinite(index) ? Math.min(8, Math.max(0, Math.round(index))) : 0;
}

/**
 * Seed the pane from the installed record plus the managed cvars. A custom
 * file only plays while the effect index is 0, so an installed file with a
 * non-zero effect reads as that effect (the file is dormant).
 */
export function seedSoundsDraft(
  record: HitsoundRecord | null | undefined,
  cvars: GameplaySettings,
): SoundsDraft {
  const slot = (kind: HitsoundKind): SlotDraft => {
    const entry = kind === "hit" ? (record?.hit ?? null) : (record?.kill ?? null);
    const effect = stockEffect(
      kind === "hit" ? cvars.tf_dingalingaling_effect : cvars.tf_dingalingaling_last_effect,
    );
    const choice: SoundChoice =
      entry && effect === 0 ? { kind: "installed", entry } : { kind: "stock", effect };
    return {
      enabled: (kind === "hit" ? cvars.tf_dingalingaling : cvars.tf_dingalingaling_lasthit) === 1,
      choice,
      volume: Math.round(
        (kind === "hit" ? cvars.tf_dingaling_volume : cvars.tf_dingaling_lasthit_volume) * 100,
      ),
      pitchMin:
        kind === "hit" ? cvars.tf_dingaling_pitchmindmg : cvars.tf_dingaling_lasthit_pitchmindmg,
      pitchMax:
        kind === "hit" ? cvars.tf_dingaling_pitchmaxdmg : cvars.tf_dingaling_lasthit_pitchmaxdmg,
    };
  };
  return {
    hit: slot("hit"),
    kill: slot("kill"),
    repeatDelay: cvars.tf_dingalingaling_repeat_delay,
  };
}

/** The managed cvars this draft implies, merged over the rest of the file. */
export function soundsToCvars(draft: SoundsDraft, base: GameplaySettings): GameplaySettings {
  const effectOf = (slot: SlotDraft) => (slot.choice.kind === "stock" ? slot.choice.effect : 0);
  return {
    ...base,
    tf_dingalingaling: draft.hit.enabled ? 1 : 0,
    tf_dingaling_volume: draft.hit.volume / 100,
    tf_dingaling_pitchmindmg: draft.hit.pitchMin,
    tf_dingaling_pitchmaxdmg: draft.hit.pitchMax,
    tf_dingalingaling_effect: effectOf(draft.hit),
    tf_dingalingaling_repeat_delay: draft.repeatDelay,
    tf_dingalingaling_lasthit: draft.kill.enabled ? 1 : 0,
    tf_dingaling_lasthit_volume: draft.kill.volume / 100,
    tf_dingaling_lasthit_pitchmindmg: draft.kill.pitchMin,
    tf_dingaling_lasthit_pitchmaxdmg: draft.kill.pitchMax,
    tf_dingalingaling_last_effect: effectOf(draft.kill),
  };
}

/** What Apply has to do to the pack for one slot. */
export function slotChange(slot: SlotDraft, installed: HitsoundEntry | null): HitsoundSlotChange {
  switch (slot.choice.kind) {
    case "community":
      return { change: "install", pick: { kind: "community", name: slot.choice.id } };
    case "file":
      return {
        change: "install",
        pick: { kind: "file", token: slot.choice.picked.token, name: slot.choice.picked.name },
      };
    case "installed":
      return { change: "keep" };
    default:
      // A stock effect: the file is dormant either way, and dropping it keeps
      // the pack honest about what plays.
      return installed ? { change: "clear" } : { change: "keep" };
  }
}

/** Whether the pack needs touching at all (cvars are saved regardless). */
export function packChangeNeeded(draft: SoundsDraft, record: HitsoundRecord | null): boolean {
  const hit = slotChange(draft.hit, record?.hit ?? null);
  const kill = slotChange(draft.kill, record?.kill ?? null);
  return hit.change !== "keep" || kill.change !== "keep";
}

/** The pick to audition for a slot's current choice. */
export function pickForChoice(kind: HitsoundKind, choice: SoundChoice): HitsoundPick {
  switch (choice.kind) {
    case "stock": {
      const effect = STOCK_HITSOUND_EFFECTS[stockEffect(choice.effect)];
      return { kind: "stock", stem: kind === "hit" ? effect.hit : effect.kill };
    }
    case "community":
      return { kind: "community", name: choice.id };
    case "file":
      return { kind: "file", token: choice.picked.token, name: choice.picked.name };
    default:
      return { kind: "installed", slot: kind };
  }
}

/** A short, human name for what a slot will play. */
export function choiceLabel(choice: SoundChoice): string {
  switch (choice.kind) {
    case "stock":
      return STOCK_HITSOUND_EFFECTS[stockEffect(choice.effect)].label;
    case "community":
      return communityHitsoundLabel(choice.id);
    case "file":
      return choice.picked.name;
    default:
      return choice.entry.source === "community"
        ? communityHitsoundLabel(choice.entry.name)
        : choice.entry.name;
  }
}

/** Where the slot's sound comes from, for the meta line. */
export function choiceSourceLabel(choice: SoundChoice): string {
  switch (choice.kind) {
    case "stock":
      return "Built into TF2";
    case "community":
      return "Community pack";
    case "file":
      return choice.picked.converted ? "Your file · converted to 16-bit 44.1 kHz" : "Your file";
    default:
      return choice.entry.source === "community"
        ? "Community pack · installed"
        : "Your file · installed";
  }
}

/** Two choices mean the same audible thing. */
export function sameChoice(a: SoundChoice, b: SoundChoice): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case "stock":
      return a.effect === (b as typeof a).effect;
    case "community":
      return a.id === (b as typeof a).id;
    case "file":
      return a.picked.token === (b as typeof a).picked.token;
    default:
      return (
        a.entry.name === (b as typeof a).entry.name &&
        a.entry.source === (b as typeof a).entry.source
      );
  }
}

export function serializeSoundsDraft(draft: SoundsDraft): string {
  const slot = (value: SlotDraft) =>
    JSON.stringify([
      value.enabled,
      value.choice.kind,
      value.choice.kind === "stock"
        ? value.choice.effect
        : value.choice.kind === "community"
          ? value.choice.id
          : value.choice.kind === "file"
            ? value.choice.picked.token
            : `${value.choice.entry.source}:${value.choice.entry.name}`,
      value.volume,
      value.pitchMin,
      value.pitchMax,
    ]);
  return JSON.stringify([slot(draft.hit), slot(draft.kill), draft.repeatDelay]);
}

export function formatWavInfo(info: PickedHitsound["info"]): string {
  const seconds = (info.durationMs / 1000).toFixed(2);
  const channels =
    info.channels === 1 ? "mono" : info.channels === 2 ? "stereo" : `${info.channels} ch`;
  return `${seconds} s · ${(info.sampleRate / 1000).toFixed(1)} kHz ${channels}`;
}
