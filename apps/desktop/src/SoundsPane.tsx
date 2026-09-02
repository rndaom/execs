import { ArrowSquareOut, Play, Stop, SwapIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { ApplyBar } from "./components/ui/ApplyBar";
import { Disclosure } from "./components/ui/Disclosure";
import { PaneHeader } from "./components/ui/PaneHeader";
import { Switch } from "./components/ui/Switch";
import { useAppStatus, useCanWrite } from "./hooks/useAppStatus";
import { useSeededDraft } from "./hooks/useSeededDraft";
import { soundKey, useSoundPlayer } from "./hooks/useSoundPlayer";
import type { Api } from "./lib/api";
import {
  type HitsoundKind,
  type HitsoundRecord,
  type HitsoundSlotChange,
  isTauri,
  openExternal,
} from "./lib/bridge";
import { COMMUNITY_HITSOUND_CREDIT, COMMUNITY_HITSOUND_REPO } from "./lib/community-hitsounds";
import {
  clampGameplay,
  type GameplayLayer,
  gameplayPath,
  PITCH_MAX,
  PITCH_MIN,
  seedGameplay,
  serializeGameplay,
} from "./lib/gameplay-ui";
import {
  choiceLabel,
  choiceSourceLabel,
  HITSOUND_CASUAL_COPY,
  packChangeNeeded,
  pickForChoice,
  type SlotDraft,
  type SoundChoice,
  seedSoundsDraft,
  serializeSoundsDraft,
  slotChange,
  soundsToCvars,
} from "./lib/hitsound-ui";
import { SoundPicker } from "./sounds/SoundPicker";

const SLOT_COPY: Record<HitsoundKind, { title: string; lede: string }> = {
  hit: { title: "Hit sound", lede: "Plays every time you damage an enemy." },
  kill: { title: "Kill sound", lede: "Plays on the hit that finishes them." },
};

/**
 * The Sounds pane: a hit sound and a kill sound, each an on/off, one chosen
 * sound with a play button, and a volume. Pitch-by-damage and the repeat
 * delay fold under Advanced. Files go into the profile's sound pack; the
 * cvars ride the same managed gameplay cfg the Crosshair pane writes.
 */
export function SoundsPane({
  api,
  record,
  layer,
  effective,
  managedText,
  onSaveCvars,
  onApply,
  onRemove,
}: {
  api: Api;
  record: HitsoundRecord | null;
  layer: GameplayLayer;
  effective: Record<string, string>;
  managedText: string;
  onSaveCvars: (gameplayText: string) => void;
  onApply: (hit: HitsoundSlotChange, kill: HitsoundSlotChange) => void;
  onRemove: () => void;
}) {
  const { running } = useAppStatus();
  const locked = !useCanWrite();
  const cvars = useMemo(() => seedGameplay(managedText, effective), [managedText, effective]);
  const recordKey = JSON.stringify(record ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: recordKey covers record by value.
  const seeded = useMemo(() => seedSoundsDraft(record, cvars), [recordKey, cvars]);
  const [draft, setDraft] = useSeededDraft(seeded, serializeSoundsDraft, recordKey);
  const [picking, setPicking] = useState<HitsoundKind | null>(null);
  const player = useSoundPlayer(api);
  const canAudition = isTauri();

  // Leaving the pane must not leave a sound looping in the background.
  useEffect(() => () => player.stop(), [player.stop]);

  const dirty = serializeSoundsDraft(draft) !== serializeSoundsDraft(seeded);
  const needsPack = packChangeNeeded(draft, record);

  function patchSlot(kind: HitsoundKind, update: Partial<SlotDraft>) {
    setDraft((current) => ({ ...current, [kind]: { ...current[kind], ...update } }));
  }

  function apply() {
    if (locked || !dirty) {
      return;
    }
    const next = clampGameplay(soundsToCvars(draft, cvars));
    onSaveCvars(serializeGameplay(next));
    if (needsPack) {
      onApply(
        slotChange(draft.hit, record?.hit ?? null),
        slotChange(draft.kill, record?.kill ?? null),
      );
    }
  }

  const status = running
    ? "TF2 is open — your choices are safe, but nothing can be written yet."
    : dirty
      ? needsPack
        ? "Saves the settings and writes the sound files into this profile."
        : "Saves the settings to this profile."
      : "Saved";

  return (
    <section data-testid="settings-sounds" className="min-w-0 text-left">
      <PaneHeader
        title="Sounds"
        lede="A ding when you land a hit and another when you get the kill. Pick a sound, set the volume, and it follows this profile."
        actions={<p className="t-meta font-mono text-ink-faint">{gameplayPath(layer)}</p>}
      />

      <div className="grid gap-x-12 gap-y-10 lg:grid-cols-2">
        {(["hit", "kill"] as const).map((kind) => (
          <SoundSlot
            key={kind}
            kind={kind}
            slot={draft[kind]}
            locked={locked}
            canAudition={canAudition}
            playing={player.playing}
            onPlay={(choice) => {
              const pick = pickForChoice(kind, choice);
              if (player.playing === soundKey(pick)) {
                player.stop();
              } else {
                player.play(pick, draft[kind].volume);
              }
            }}
            onChange={(update) => patchSlot(kind, update)}
            onPick={() => setPicking(kind)}
          />
        ))}
      </div>

      {player.error ? (
        <p data-testid="sounds-play-error" className="t-meta mt-4 text-warn">
          {player.error}
        </p>
      ) : null}

      <section className="section">
        <Disclosure storageKey="sounds-advanced" summary="Advanced" testId="sounds-advanced">
          <div className="grid gap-x-12 gap-y-6 lg:grid-cols-2">
            {(["hit", "kill"] as const).map((kind) => (
              <fieldset key={kind} className="min-w-0">
                <legend className="eyebrow mb-3">{SLOT_COPY[kind].title} pitch</legend>
                <Slider
                  id={`sounds-${kind}-pitch-min`}
                  label="Pitch at 10 damage"
                  hint="100 is unchanged; lower is deeper."
                  value={draft[kind].pitchMin}
                  min={PITCH_MIN}
                  max={PITCH_MAX}
                  disabled={locked}
                  onChange={(pitchMin) => patchSlot(kind, { pitchMin })}
                />
                <Slider
                  id={`sounds-${kind}-pitch-max`}
                  label="Pitch at 150 damage"
                  hint="Rises with damage when set above the 10-damage pitch."
                  value={draft[kind].pitchMax}
                  min={PITCH_MIN}
                  max={PITCH_MAX}
                  disabled={locked}
                  onChange={(pitchMax) => patchSlot(kind, { pitchMax })}
                />
              </fieldset>
            ))}
            <div className="min-w-0">
              <Slider
                id="sounds-repeat-delay"
                label="Hit sound repeat delay"
                hint="Seconds between hit sounds. 0 plays one per damage tick; flamethrowers and miniguns get loud."
                value={Math.round(draft.repeatDelay * 100)}
                min={0}
                max={100}
                disabled={locked}
                format={(value) => `${(value / 100).toFixed(2)} s`}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, repeatDelay: value / 100 }))
                }
              />
            </div>
          </div>
        </Disclosure>
      </section>

      <p className="t-meta mt-12 text-ink-faint">
        {HITSOUND_CASUAL_COPY} {COMMUNITY_HITSOUND_CREDIT}{" "}
        <button
          type="button"
          onClick={() => void openExternal(COMMUNITY_HITSOUND_REPO)}
          className="inline-flex items-center gap-0.5 text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
        >
          TF2Hitsounds on GitHub
          <ArrowSquareOut size={11} />
        </button>
        . Built-in effects are previewed from your own copy of the game.
      </p>

      <ApplyBar
        status={status}
        actionLabel="Save sounds"
        lockedLabel="Close TF2 to save"
        running={running}
        locked={locked}
        dirty={dirty}
        testId="sounds-apply"
        extra={
          record ? (
            <button
              type="button"
              data-testid="sounds-remove"
              disabled={locked}
              onClick={onRemove}
              className="btn btn-ghost"
            >
              Remove sound files
            </button>
          ) : null
        }
        onApply={apply}
      />

      {picking ? (
        <SoundPicker
          api={api}
          kind={picking}
          current={draft[picking].choice}
          volume={draft[picking].volume}
          player={player}
          onChoose={(choice) => {
            patchSlot(picking, { choice, enabled: true });
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </section>
  );
}

function SoundSlot({
  kind,
  slot,
  locked,
  canAudition,
  playing,
  onPlay,
  onChange,
  onPick,
}: {
  kind: HitsoundKind;
  slot: SlotDraft;
  locked: boolean;
  canAudition: boolean;
  playing: string | null;
  onPlay: (choice: SoundChoice) => void;
  onChange: (update: Partial<SlotDraft>) => void;
  onPick: () => void;
}) {
  const copy = SLOT_COPY[kind];
  const key = soundKey(pickForChoice(kind, slot.choice));
  const isPlaying = playing === key;
  return (
    <section data-testid={`sounds-${kind}`} className="min-w-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="t-section">{copy.title}</h2>
          <p className="t-meta mt-1">{copy.lede}</p>
        </div>
        <Switch
          checked={slot.enabled}
          disabled={locked}
          label={`${copy.title} on`}
          testId={`sounds-${kind}-enabled`}
          onChange={(enabled) => onChange({ enabled })}
        />
      </div>

      <div
        className={`surface mt-5 flex items-center gap-3 p-3 transition-opacity duration-150 ${
          slot.enabled ? "" : "opacity-50"
        }`}
      >
        <button
          type="button"
          data-testid={`sounds-${kind}-play`}
          aria-label={isPlaying ? `Stop ${copy.title}` : `Play ${copy.title}`}
          aria-pressed={isPlaying}
          disabled={!canAudition}
          title={canAudition ? undefined : "Auditioning needs the desktop app."}
          onClick={() => onPlay(slot.choice)}
          className={`play-button ${isPlaying ? "play-button-active" : ""}`}
        >
          {isPlaying ? <Stop size={16} weight="fill" /> : <Play size={16} weight="fill" />}
        </button>
        <div className="min-w-0 flex-1">
          <p data-testid={`sounds-${kind}-name`} className="t-row truncate">
            {choiceLabel(slot.choice)}
          </p>
          <p className="t-meta truncate">{choiceSourceLabel(slot.choice)}</p>
        </div>
        <button
          type="button"
          data-testid={`sounds-${kind}-change`}
          disabled={locked}
          onClick={onPick}
          className="btn btn-ghost shrink-0"
        >
          <SwapIcon size={14} />
          Change
        </button>
      </div>

      <div className="mt-5">
        <Slider
          id={`sounds-${kind}-volume`}
          label="Volume"
          value={slot.volume}
          min={0}
          max={100}
          disabled={locked}
          format={(value) => `${value}%`}
          onChange={(volume) => onChange({ volume })}
        />
      </div>
    </section>
  );
}

function Slider({
  id,
  label,
  hint,
  value,
  min,
  max,
  disabled,
  format,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="min-w-0 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="t-row">
          {label}
        </label>
        <output htmlFor={id} className="tnum text-[14px] text-ink-muted">
          {format ? format(value) : value}
        </output>
      </div>
      {hint ? <p className="t-meta mt-0.5">{hint}</p> : null}
      <input
        id={id}
        data-testid={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="range mt-3 w-full"
      />
    </div>
  );
}
