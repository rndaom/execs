import { ArrowSquareOut, MagnifyingGlass, Play, Stop, UploadSimple } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { ApplyBar } from "./components/ui/ApplyBar";
import { Disclosure } from "./components/ui/Disclosure";
import { PaneHeader } from "./components/ui/PaneHeader";
import { Segmented } from "./components/ui/Segmented";
import { Switch } from "./components/ui/Switch";
import { useAppStatus, useCanWrite } from "./hooks/useAppStatus";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import { forgetSoundUrl, soundKey, useSoundPlayer } from "./hooks/useSoundPlayer";
import type { Api } from "./lib/api";
import {
  type ComfigHitsound,
  type HitsoundKind,
  type HitsoundRecord,
  type HitsoundSlotChange,
  isTauri,
  openExternal,
  type PickedHitsound,
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
  sameChoice,
  seedSoundsDraft,
  serializeSoundsDraft,
  slotChange,
  soundsToCvars,
} from "./lib/hitsound-ui";
import {
  comfigEntries,
  communityEntries,
  filterSoundLibrary,
  ownEntry,
  SOUND_SORTS,
  SOUND_SOURCE_LABELS,
  type SoundLibraryEntry,
  type SoundSort,
  type SoundSourceId,
  stockEntries,
} from "./lib/sound-library";

const SLOT_TITLES: Record<HitsoundKind, string> = {
  hit: "Hit sound",
  kill: "Kill sound",
};

const SOURCE_FILTERS: { id: SoundSourceId | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "stock", label: "Built in" },
  { id: "community", label: "Community" },
  { id: "comfig", label: "comfig.app" },
];

/**
 * The Sounds pane: a hit sound and a kill sound, each an on/off, the chosen
 * sound with a play button, and a volume; pitch-by-damage and the repeat
 * delay fold under Advanced. Below sits the library — every sound from every
 * source in one searchable, sortable list, each row playable and assignable
 * to either slot. Files go into the profile's sound pack; the cvars ride the
 * same managed gameplay cfg the Crosshair pane writes.
 */
export function SoundsPane({
  api,
  profileId,
  record,
  layer,
  effective,
  managedText,
  onSaveCvars,
  onApply,
  onRemove,
}: {
  api: Api;
  /** The profile this draft belongs to; a switch discards it. */
  profileId: string | null;
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
  const recordKey = draftRecordKey(profileId, JSON.stringify(record ?? null));
  // biome-ignore lint/correctness/useExhaustiveDependencies: recordKey covers record by value.
  const seeded = useMemo(() => seedSoundsDraft(record, cvars), [recordKey, cvars]);
  const [draft, setDraft] = useSeededDraft(seeded, serializeSoundsDraft, recordKey);
  const player = useSoundPlayer(api);
  const canAudition = isTauri();

  // Library state.
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SoundSort>("name-asc");
  const [source, setSource] = useState<SoundSourceId | "all">("all");
  const [picked, setPicked] = useState<PickedHitsound | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [comfig, setComfig] = useState<ComfigHitsound[] | null>(null);
  const [comfigError, setComfigError] = useState<string | null>(null);
  const [stockStems, setStockStems] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listStockHitsounds()
      .then((stems) => {
        if (!cancelled) {
          setStockStems(stems);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStockStems([]);
        }
      });
    api
      .comfigHitsoundIndex()
      .then((index) => {
        if (!cancelled) {
          setComfig(index);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setComfig([]);
          setComfigError(err instanceof Error ? err.message : "comfig.app is unavailable.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Leaving the pane must not leave a sound playing in the background.
  useEffect(() => () => player.stop(), [player.stop]);

  const library = useMemo<SoundLibraryEntry[]>(
    () => [
      ...(picked ? [ownEntry(picked)] : []),
      ...stockEntries(),
      ...communityEntries(),
      ...comfigEntries(comfig ?? []),
    ],
    [picked, comfig],
  );
  const rows = useMemo(
    () => filterSoundLibrary(library, query, sort, source === "all" ? null : new Set([source])),
    [library, query, sort, source],
  );

  const dirty = serializeSoundsDraft(draft) !== serializeSoundsDraft(seeded);
  const needsPack = packChangeNeeded(draft, record);

  function patchSlot(kind: HitsoundKind, update: Partial<SlotDraft>) {
    setDraft((current) => ({ ...current, [kind]: { ...current[kind], ...update } }));
  }

  function assign(kind: HitsoundKind, entry: SoundLibraryEntry) {
    patchSlot(kind, { choice: entry.choiceFor(kind), enabled: true });
  }

  function toggle(kind: HitsoundKind, choice: SoundChoice) {
    const pick = pickForChoice(kind, choice);
    if (player.playing === soundKey(pick)) {
      player.stop();
    } else {
      player.play(pick, draft[kind].volume);
    }
  }

  async function chooseFile() {
    if (picking) {
      return;
    }
    setPicking(true);
    setPickError(null);
    try {
      const next = await api.pickHitsoundFile();
      if (next) {
        if (picked) {
          forgetSoundUrl({ kind: "file", token: picked.token, name: picked.name });
        }
        setPicked(next);
        setSource("all");
        setQuery("");
      }
    } catch (err) {
      setPickError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setPicking(false);
    }
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
    ? "Draft kept until TF2 closes"
    : dirty
      ? needsPack
        ? "Unsaved changes — writes sound files"
        : "Unsaved changes"
      : "Saved";

  const stockAvailable = (entry: SoundLibraryEntry, kind: HitsoundKind) => {
    if (entry.source !== "stock" || stockStems === null) {
      return true;
    }
    const pick = entry.pickFor(kind);
    return pick.kind === "stock" ? stockStems.includes(pick.stem) : true;
  };

  return (
    <section data-testid="settings-sounds" className="min-w-0 text-left">
      <PaneHeader
        title="Sounds"
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
            onPlay={(choice) => toggle(kind, choice)}
            onChange={(update) => patchSlot(kind, update)}
          />
        ))}
      </div>

      {player.error ? (
        <p data-testid="sounds-play-error" className="t-meta mt-4 text-warn">
          {player.error}
        </p>
      ) : null}

      <section id="sound-library" className="section scroll-mt-4" aria-label="Sound library">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h2 className="t-section">Library</h2>
            <p className="t-meta mt-1">
              {comfig === null ? "Loading…" : `${library.length} sounds`}
            </p>
          </div>
          <button
            type="button"
            data-testid="sounds-choose-file"
            disabled={picking || !canAudition}
            title={canAudition ? undefined : "Needs the desktop app."}
            onClick={() => void chooseFile()}
            className="btn btn-ghost"
          >
            <UploadSimple size={14} />
            {picking ? "Reading…" : "Add a WAV…"}
          </button>
        </div>
        {pickError ? (
          <p data-testid="sounds-pick-error" className="t-meta mt-2 text-warn">
            {pickError}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="relative block min-w-56 flex-1">
            <span className="sr-only">Search sounds</span>
            <MagnifyingGlass
              size={14}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
            />
            <input
              type="search"
              data-testid="sounds-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name…"
              className="field w-full py-2 pr-3 pl-8 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
          </label>
          <Segmented
            label="Source"
            size="sm"
            testIdPrefix="sounds-source"
            options={SOURCE_FILTERS}
            value={source}
            onChange={setSource}
          />
          <Segmented
            label="Sort"
            size="sm"
            testIdPrefix="sounds-sort"
            options={SOUND_SORTS}
            value={sort}
            onChange={setSort}
          />
        </div>

        <ul data-testid="sounds-library" className="mt-2 list-none p-0">
          {rows.map((entry) => {
            const hitChoice = entry.choiceFor("hit");
            const killChoice = entry.choiceFor("kill");
            const hitPick = entry.pickFor("hit");
            const playable = canAudition && stockAvailable(entry, "hit");
            const isHit = sameChoice(draft.hit.choice, hitChoice);
            const isKill = sameChoice(draft.kill.choice, killChoice);
            return (
              <li
                key={entry.id}
                data-testid={`sounds-row-${entry.id}`}
                className="row min-h-12 gap-3 border-b border-edge last:border-b-0"
              >
                <PlayButton
                  playing={player.playing === soundKey(hitPick)}
                  disabled={!playable}
                  onClick={() => toggle("hit", hitChoice)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink">{entry.label}</span>
                  <span className="t-meta block truncate">
                    {SOUND_SOURCE_LABELS[entry.source]}
                    {entry.suggested
                      ? ` · made for ${entry.suggested === "hit" ? "hits" : "kills"}`
                      : ""}
                    {entry.meta ? ` · ${entry.meta}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <AssignButton
                    label="Hit"
                    active={isHit}
                    disabled={locked}
                    testId={`sounds-assign-hit-${entry.id}`}
                    onClick={() => assign("hit", entry)}
                  />
                  <AssignButton
                    label="Kill"
                    active={isKill}
                    disabled={locked}
                    testId={`sounds-assign-kill-${entry.id}`}
                    onClick={() => assign("kill", entry)}
                  />
                </span>
              </li>
            );
          })}
          {rows.length === 0 ? <li className="t-meta py-8 text-center">No sounds match.</li> : null}
        </ul>
        {comfigError ? (
          <p data-testid="sounds-comfig-error" className="t-meta mt-3 text-ink-faint">
            comfig.app list unavailable: {comfigError}
          </p>
        ) : null}
      </section>

      <section className="section">
        <Disclosure storageKey="sounds-advanced" summary="Advanced" testId="sounds-advanced">
          <div className="grid gap-x-12 gap-y-6 lg:grid-cols-2">
            {(["hit", "kill"] as const).map((kind) => (
              <fieldset key={kind} className="min-w-0">
                <legend className="eyebrow mb-3">{SLOT_TITLES[kind]} pitch</legend>
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
                  hint="Rises with damage when above the 10-damage pitch."
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
                hint="0 plays one per damage tick; miniguns get loud."
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
        {HITSOUND_CASUAL_COPY} Built-in effects are previewed from your own copy of the game.{" "}
        {COMMUNITY_HITSOUND_CREDIT}{" "}
        <button
          type="button"
          onClick={() => void openExternal(COMMUNITY_HITSOUND_REPO)}
          className="inline-flex items-center gap-0.5 text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
        >
          TF2Hitsounds
          <ArrowSquareOut size={11} />
        </button>
        . comfig.app sounds are community uploads owned by their uploaders; browse them at{" "}
        <button
          type="button"
          onClick={() => void openExternal("https://comfig.app/app/?page=hits")}
          className="inline-flex items-center gap-0.5 text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
        >
          comfig.app
          <ArrowSquareOut size={11} />
        </button>
        . execs is not affiliated with either.
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
}: {
  kind: HitsoundKind;
  slot: SlotDraft;
  locked: boolean;
  canAudition: boolean;
  playing: string | null;
  onPlay: (choice: SoundChoice) => void;
  onChange: (update: Partial<SlotDraft>) => void;
}) {
  const title = SLOT_TITLES[kind];
  const key = soundKey(pickForChoice(kind, slot.choice));
  const isPlaying = playing === key;
  return (
    <section data-testid={`sounds-${kind}`} className="min-w-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="t-section">{title}</h2>
        </div>
        <Switch
          checked={slot.enabled}
          disabled={locked}
          label={`${title} on`}
          testId={`sounds-${kind}-enabled`}
          onChange={(enabled) => onChange({ enabled })}
        />
      </div>

      <div
        className={`surface mt-5 flex items-center gap-3 p-3 transition-opacity duration-150 ${
          slot.enabled ? "" : "opacity-50"
        }`}
      >
        <PlayButton
          playing={isPlaying}
          disabled={!canAudition}
          testId={`sounds-${kind}-play`}
          onClick={() => onPlay(slot.choice)}
        />
        <div className="min-w-0 flex-1">
          <p data-testid={`sounds-${kind}-name`} className="t-row truncate">
            {choiceLabel(slot.choice)}
          </p>
          <p className="t-meta truncate">{choiceSourceLabel(slot.choice)}</p>
        </div>
        <a href="#sound-library" className="btn btn-quiet shrink-0 text-[12.5px]">
          Browse
        </a>
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

function PlayButton({
  playing,
  disabled = false,
  testId,
  onClick,
}: {
  playing: boolean;
  disabled?: boolean;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={playing ? "Stop" : "Play"}
      aria-pressed={playing}
      disabled={disabled}
      title={disabled ? "Needs the desktop app." : undefined}
      onClick={onClick}
      className={`play-button ${playing ? "play-button-active" : ""}`}
    >
      {playing ? <Stop size={15} weight="fill" /> : <Play size={15} weight="fill" />}
    </button>
  );
}

function AssignButton({
  label,
  active,
  disabled,
  testId,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-active={active ? "true" : "false"}
      aria-pressed={active}
      disabled={disabled || active}
      onClick={onClick}
      className={`btn px-2.5 py-1 text-[12.5px] ${
        active
          ? "text-ink shadow-[inset_0_0_0_1.5px_var(--color-brand)]"
          : "btn-ghost text-ink-muted"
      }`}
    >
      {label}
    </button>
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
