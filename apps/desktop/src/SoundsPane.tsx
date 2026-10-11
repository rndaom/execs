import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  MagnifyingGlass,
  Play,
  SpeakerHigh,
  SpeakerLow,
  SpeakerSlash,
  Star,
  Stop,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CopySettings, type CopySettingsSource } from "./components/CopySettings";
import { PaneHeader } from "./components/ui/PaneHeader";
import { Segmented } from "./components/ui/Segmented";
import { Loading, Spinner } from "./components/ui/Spinner";
import { Switch } from "./components/ui/Switch";
import { useAppStatus } from "./hooks/useAppStatus";
import { useAutosave } from "./hooks/useAutosave";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import { forgetSoundUrl, soundKey, useSoundPlayer } from "./hooks/useSoundPlayer";
import type { Api } from "./lib/api";
import {
  type ComfigHitsound,
  type ContentIndex,
  type HitsoundKind,
  type HitsoundRecord,
  type HitsoundSlotChange,
  isTauri,
  openExternal,
  type PickedHitsound,
  type ProfileFile,
} from "./lib/bridge";
import {
  clampGameplay,
  type GameplayLayer,
  PITCH_MAX,
  PITCH_MIN,
  seedGameplay,
  serializeGameplay,
} from "./lib/gameplay-ui";
import {
  BOOST_STEPS,
  type BoostDb,
  boostOf,
  choiceLabel,
  choiceSourceLabel,
  packChangeNeeded,
  pickForChoice,
  type SlotDraft,
  type SoundChoice,
  STOCK_HITSOUND_EFFECTS,
  sameChoice,
  seedSoundsDraft,
  serializeSoundsDraft,
  slotChange,
  soundsToCvars,
} from "./lib/hitsound-ui";
import { copySettingsBlocked } from "./lib/settings-ui";
import {
  comfigEntries,
  filterSoundLibrary,
  gameBananaAddedNote,
  type IncomingSounds,
  ownEntry,
  pageSoundLibrary,
  parseSoundPageJump,
  readSoundFavorites,
  readSoundPreviewLevel,
  SOUND_FILTERS,
  SOUND_LIBRARY_PAGE_SIZE,
  SOUND_SORTS,
  type SoundFilter,
  type SoundLibraryEntry,
  type SoundSort,
  soundAccessibleNames,
  soundPageLinks,
  soundSourceLabel,
  stockEntries,
  writeSoundFavorites,
  writeSoundPreviewLevel,
} from "./lib/sound-library";

const SLOT_TITLES: Record<HitsoundKind, string> = {
  hit: "Hit sound",
  kill: "Kill sound",
};

const TARGET_OPTIONS: { id: HitsoundKind; label: string }[] = [
  { id: "hit", label: "Hit sound" },
  { id: "kill", label: "Kill sound" },
];

/** Plural nouns for accessible names: "Use Electro for hits". */
const ROLE_NOUNS: Record<HitsoundKind, string> = { hit: "hits", kill: "kills" };

/**
 * The Sounds pane: a hit sound and a kill sound side by side, each with an
 * on/off, the chosen sound with a play button, volume, boost and pitch by
 * damage (the hit sound also its repeat delay). Below sits the library of
 * built-in effects and user-picked WAVs, always choosing for one slot at a
 * time. Files go into the profile's sound pack; the cvars ride the same
 * managed gameplay cfg the Crosshair pane writes.
 */
export function SoundsPane({
  api,
  profileId,
  record,
  effective,
  managedText,
  sourceFiles,
  sourceRefreshKey,
  onSave,
  onRemove,
  copySettings,
  incoming,
  onIncomingHandled,
}: {
  api: Api;
  /** The profile this draft belongs to; a switch discards it. */
  profileId: string | null;
  record: HitsoundRecord | null;
  layer: GameplayLayer;
  effective: Record<string, string>;
  managedText: string;
  /** A changed custom file snapshot calls for a fresh mounted-path scan. */
  sourceFiles?: ProfileFile[];
  sourceRefreshKey?: string | number;
  /**
   * The cvars and, when the files changed, the sound pack — one write, so one
   * toast. Resolves when it settles.
   */
  onSave: (
    gameplayText: string,
    pack: { hit: HitsoundSlotChange; kill: HitsoundSlotChange } | null,
  ) => Promise<unknown>;
  onRemove: () => void;
  /** Copy the saved sounds to other profiles; offered only when provided. */
  copySettings?: CopySettingsSource;
  /**
   * Sounds prepared from a GameBanana hit or kill sound upload. They join the
   * library like an added file; nothing is installed until Use.
   */
  incoming?: IncomingSounds | null;
  /** Called once the incoming sounds are in the library. */
  onIncomingHandled?: (key: number) => void;
}) {
  const { running, busy } = useAppStatus();
  // Picking a sound is a draft; only removing the installed files waits on the
  // lock and the queue.
  const locked = false;
  const removeLocked = running || busy;
  const cvars = useMemo(() => seedGameplay(managedText, effective), [managedText, effective]);
  const seeded = useMemo(() => seedSoundsDraft(record, cvars), [record, cvars]);
  // A boost changes the installed bytes, not the owner of this draft. The
  // seed acknowledges saved content while later volume, pitch or source edits
  // remain queued by useAutosave's submitted-version token.
  const [draft, setDraft] = useSeededDraft(
    seeded,
    serializeSoundsDraft,
    draftRecordKey(profileId, "sounds"),
  );
  const player = useSoundPlayer(api, JSON.stringify([profileId, record]));
  const canAudition = isTauri();

  // Library state. The library always chooses for one slot.
  const [target, setTarget] = useState<HitsoundKind>("hit");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  // Your added file, or every sound from one GameBanana upload.
  const [picked, setPicked] = useState<{ files: PickedHitsound[]; from?: string }>({ files: [] });
  const [added, setAdded] = useState<IncomingSounds | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [stockStems, setStockStems] = useState<string[] | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [sources, setSources] = useState<ContentIndex | null>(null);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [comfigIndex, setComfigIndex] = useState<ComfigHitsound[] | null>(null);
  const [comfigError, setComfigError] = useState<string | null>(null);
  const [sort, setSort] = useState<SoundSort>("suggested");
  const [filter, setFilter] = useState<SoundFilter>("all");
  const [favorites, setFavorites] = useState<Set<string>>(readSoundFavorites);
  const [previewLevel, setPreviewLevel] = useState(readSoundPreviewLevel);
  const searchRef = useRef<HTMLInputElement>(null);
  const customFilesKey = useMemo(
    () =>
      sourceFiles
        ?.filter((file) => file.path.startsWith("tf/custom/"))
        .map((file) => `${file.path}:${file.sha256}`)
        .join("\n") ?? "",
    [sourceFiles],
  );

  useEffect(() => {
    void reloadKey;
    let cancelled = false;
    setLibraryLoading(true);
    setStockError(null);
    const stockRead = api
      .listStockHitsounds()
      .then((stems) => {
        if (!cancelled) {
          setStockStems(stems);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setStockError(err instanceof Error ? err.message : "Built-in sounds are unavailable.");
          setStockStems((current) => current ?? []);
        }
      });
    setComfigError(null);
    const comfigRead = api
      .comfigHitsoundIndex()
      .then((index) => {
        if (!cancelled) setComfigIndex(index);
      })
      .catch((err) => {
        if (!cancelled)
          setComfigError(
            err instanceof Error ? err.message : "The comfig.app library is unavailable.",
          );
      });
    void Promise.all([stockRead, comfigRead]).then(() => {
      if (!cancelled) setLibraryLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [api, reloadKey]);

  useEffect(() => {
    // Re-scan retained panes after a custom pack change or install refresh.
    void customFilesKey;
    void sourceRefreshKey;
    if (!profileId) {
      setSources(null);
      setSourcesError(null);
      return;
    }
    let cancelled = false;
    setSources(null);
    setSourcesError(null);
    api
      .getHitsoundSources()
      .then((index) => {
        if (!cancelled) setSources(index);
      })
      .catch((err) => {
        if (!cancelled) {
          setSourcesError(
            err instanceof Error ? err.message : "Sound paths could not be inspected.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, profileId, customFilesKey, sourceRefreshKey]);

  // Leaving the pane must not leave a sound playing in the background.
  useEffect(() => () => player.stop(), [player.stop]);
  const { setPreviewVolume } = player;
  useEffect(() => {
    setPreviewVolume(previewLevel.muted ? 0 : previewLevel.volume);
  }, [setPreviewVolume, previewLevel]);
  function changePreviewLevel(next: { volume?: number; muted?: boolean }) {
    setPreviewLevel((current) => {
      const level = { ...current, ...next };
      writeSoundPreviewLevel(level);
      return level;
    });
  }
  const previewAudible = previewLevel.muted ? 0 : previewLevel.volume;

  const library = useMemo<SoundLibraryEntry[]>(
    () => [
      ...picked.files.map((file) => ownEntry(file, picked.from)),
      ...stockEntries(),
      ...comfigEntries(comfigIndex ?? []),
    ],
    [picked, comfigIndex],
  );
  const rows = useMemo(
    () => filterSoundLibrary(library, query, sort, { filter, favorites, target }),
    [library, query, sort, filter, favorites, target],
  );
  function toggleFavorite(id: string) {
    setFavorites((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      writeSoundFavorites(next);
      return next;
    });
  }
  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(rows.length / SOUND_LIBRARY_PAGE_SIZE) - 1);
    setPage((current) => Math.min(current, lastPage));
  }, [rows.length]);
  const paged = useMemo(() => pageSoundLibrary(rows, page), [rows, page]);
  const accessibleNames = useMemo(() => soundAccessibleNames(library), [library]);

  const dirty = serializeSoundsDraft(draft) !== serializeSoundsDraft(seeded);
  const needsPack = packChangeNeeded(draft, record);
  const dormantSounds = (["hit", "kill"] as const).flatMap((kind) => {
    const entry = record?.[kind];
    const choice = draft[kind].choice;
    return entry && choice.kind === "stock" && choice.effect > 0
      ? [{ kind, entry, effect: choice.effect }]
      : [];
  });
  // Only the TF2Hitsounds collection is retired; comfig.app sounds are offered again.
  const hasSavedCatalogSound = [record?.hit, record?.kill].some(
    (entry) => entry?.source === "community",
  );
  const hitSources = sources?.hits["sound/ui/hitsound.wav"] ?? [];
  const killSources = sources?.hits["sound/ui/killsound.wav"] ?? [];
  const sourceIssues = [
    ...new Set([...(sources?.incomplete ?? []), ...(sourcesError ? [sourcesError] : [])]),
  ];
  const sourcesLoading = Boolean(profileId && !sources && !sourcesError);

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
        replacePicked({ files: [next] });
        setAdded(null);
        setQuery("");
        setPage(0);
      }
    } catch (err) {
      setPickError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setPicking(false);
    }
  }

  function replacePicked(next: { files: PickedHitsound[]; from?: string }) {
    for (const file of picked.files) {
      forgetSoundUrl({ kind: "file", token: file.token, name: file.name });
    }
    setPicked(next);
  }

  // A GameBanana hit or kill sound arrives once: it replaces the added files,
  // aims the library at its slot and shows only those sounds' source.
  const handledIncoming = useRef<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per handoff key; replacePicked reads the files it replaces at that moment.
  useEffect(() => {
    if (!incoming || handledIncoming.current === incoming.key) return;
    handledIncoming.current = incoming.key;
    replacePicked({ files: incoming.sounds, from: "GameBanana" });
    setAdded(incoming);
    setTarget(incoming.slot);
    setFilter("all");
    setSort("suggested");
    setQuery("");
    setPage(0);
    onIncomingHandled?.(incoming.key);
    document
      .getElementById("sound-library")
      ?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [incoming, onIncomingHandled]);

  function save() {
    const next = clampGameplay(soundsToCvars(draft, cvars));
    return onSave(
      serializeGameplay(next),
      needsPack
        ? {
            hit: slotChange("hit", draft.hit, record?.hit ?? null),
            kill: slotChange("kill", draft.kill, record?.kill ?? null),
          }
        : null,
    );
  }

  useAutosave({ dirty, locked: running, token: serializeSoundsDraft(draft), save });

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
        actions={
          copySettings ? (
            <CopySettings
              scope="sounds"
              source={copySettings}
              blockedReason={copySettingsBlocked(running, busy, dirty)}
            />
          ) : undefined
        }
      />

      <section data-testid="sounds-volume" aria-labelledby="sounds-volume-title" className="mb-6">
        <h2 id="sounds-volume-title" className="eyebrow mb-1">
          Game audio
        </h2>
        <div className="pane-split gap-y-0">
          <Slider
            id="sounds-game-volume"
            label="Game volume"
            value={Math.round(draft.gameVolume * 100)}
            min={0}
            max={100}
            disabled={locked}
            format={(value) => `${value}%`}
            onChange={(value) => setDraft((current) => ({ ...current, gameVolume: value / 100 }))}
          />
          <Slider
            id="sounds-music-volume"
            label="Music volume"
            value={Math.round(draft.musicVolume * 100)}
            min={0}
            max={100}
            disabled={locked}
            format={(value) => `${value}%`}
            onChange={(value) => setDraft((current) => ({ ...current, musicVolume: value / 100 }))}
          />
        </div>
      </section>

      <div className="pane-split gap-y-6">
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
            repeatDelay={kind === "hit" ? draft.repeatDelay : undefined}
            onRepeatDelay={(repeatDelay) => setDraft((current) => ({ ...current, repeatDelay }))}
            onBrowse={() => {
              setTarget(kind);
              searchRef.current?.focus();
              searchRef.current?.scrollIntoView?.({ block: "center" });
            }}
          />
        ))}
      </div>

      {record ? (
        <div
          data-testid="sounds-files"
          className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-4"
        >
          <p className="t-meta min-w-0">Your own sound files are saved in this profile.</p>
          <button
            type="button"
            data-testid="sounds-remove"
            disabled={removeLocked}
            onClick={onRemove}
            className="btn btn-ghost"
          >
            <Trash size={14} aria-hidden="true" /> Remove sound files
          </button>
        </div>
      ) : null}

      {dormantSounds.length ? (
        <section data-testid="sounds-saved-inactive" className="pane-note mt-4">
          <p>
            Saved custom sound files stay in this profile while built-in effects play. Assigning
            your own sound file replaces one; Remove sound files deletes both saved files.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {dormantSounds.map(({ kind, entry, effect }) => (
              <button
                key={kind}
                type="button"
                data-testid={`sounds-use-saved-${kind}`}
                className="btn btn-ghost"
                onClick={() =>
                  patchSlot(kind, {
                    choice: { kind: "installed", entry },
                    boost: boostOf(entry),
                  })
                }
              >
                Use saved {kind} sound instead of{" "}
                {STOCK_HITSOUND_EFFECTS[effect]?.label ?? "effect"}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {hasSavedCatalogSound ? (
        <section data-testid="sounds-retired-source" className="pane-note mt-4">
          A sound here is from a retired catalog. It still plays.
        </section>
      ) : null}

      {record?.sourceChanged ? (
        <section data-testid="sounds-source-changed" role="alert" className="surface mt-4 p-3">
          <h2 className="t-row">Saved sound source changed</h2>
          <p className="t-meta mt-1">
            A sound file changed outside execs. Pick both sounds again, or use Remove sound files.
          </p>
        </section>
      ) : null}

      {hitSources.length || killSources.length || sourceIssues.length || sourcesLoading ? (
        <section data-testid="sounds-source-conflicts" className="surface mt-4 p-3">
          <h2 className="t-row">Sound file sources</h2>
          {sourcesLoading ? (
            <p className="t-meta mt-1">
              <Loading>Checking other installed sound files…</Loading>
            </p>
          ) : null}
          {hitSources.length || killSources.length ? (
            <p className="t-meta mt-1">
              These packs also replace TF2&apos;s hit or kill sound, so TF2 may play theirs.
            </p>
          ) : null}
          {(
            [
              ["Hit sound", hitSources],
              ["Kill sound", killSources],
            ] as const
          ).map(([label, candidates]) =>
            candidates.length ? (
              <div key={label} className="mt-2">
                <p className="t-meta">{label} path also appears in:</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[12.5px] text-ink-muted">
                  {candidates.map((candidate) => (
                    <li key={`${candidate.pack}:${candidate.member}:${candidate.kind}`}>
                      <code>
                        tf/custom/{candidate.pack}
                        {candidate.kind === "loose" ? "/" : " → "}
                        {candidate.member}
                      </code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
          {sourceIssues.length ? (
            <div data-testid="sounds-source-incomplete" className="t-meta mt-2 text-warn">
              <p>Some packs couldn&apos;t be checked.</p>
              <ul className="mt-1 list-disc pl-5">
                {sourceIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {player.error ? (
        <p data-testid="sounds-play-error" className="t-meta mt-4 text-warn">
          {player.error}
        </p>
      ) : null}

      <section
        id="sound-library"
        className="mt-5 scroll-mt-4 border-t border-edge pt-3"
        aria-label="Sound library"
      >
        <div className="pane-toolbar">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
            <h2 className="t-section">Sound library</h2>
            <p className="t-meta mt-1" aria-live="polite">
              {libraryLoading ? (
                <Loading>Loading sources…</Loading>
              ) : (
                `${rows.length} of ${library.length} sounds`
              )}
            </p>
          </div>
          <div className="pane-actions">
            <button
              type="button"
              data-testid="sounds-choose-file"
              disabled={picking || !canAudition}
              title={
                canAudition ? "WAV, MP3 or Ogg Vorbis, up to 30 seconds." : "Needs the desktop app."
              }
              onClick={() => void chooseFile()}
              className="btn btn-ghost"
            >
              {picking ? <Spinner size={14} /> : <UploadSimple size={14} />}
              {picking ? "Reading…" : "Add a sound file…"}
            </button>
          </div>
        </div>
        {pickError ? (
          <p data-testid="sounds-pick-error" className="t-meta mt-2 text-warn">
            {pickError}
          </p>
        ) : null}
        {added ? (
          <p data-testid="sounds-gamebanana-added" role="status" className="t-meta mt-2">
            {gameBananaAddedNote(added)}{" "}
            <button type="button" className="underline" onClick={() => setAdded(null)}>
              Dismiss
            </button>
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Segmented
            label="Choosing for"
            size="sm"
            testIdPrefix="sounds-target"
            options={TARGET_OPTIONS}
            value={target}
            onChange={setTarget}
          />
          <label className="relative block min-w-40 flex-1">
            <span className="sr-only">Search sounds</span>
            <MagnifyingGlass
              size={14}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
            />
            <input
              ref={searchRef}
              type="search"
              data-testid="sounds-search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder="Search by name…"
              className="field w-full py-2 pr-3 pl-8 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Show"
            size="sm"
            testIdPrefix="sounds-filter"
            options={SOUND_FILTERS.map((option) =>
              option.id === "favorites" && favorites.size
                ? { ...option, label: `Favorites ${favorites.size}` }
                : option,
            )}
            value={filter}
            onChange={(next) => {
              setFilter(next);
              setPage(0);
            }}
          />
          <Segmented
            label="Sort sounds"
            size="sm"
            testIdPrefix="sounds-sort"
            options={SOUND_SORTS}
            value={sort}
            onChange={(next) => {
              setSort(next);
              setPage(0);
            }}
          />
        </div>
        {comfigIndex === null && !comfigError ? (
          <p className="t-meta mt-2">
            <Loading>Loading comfig.app sounds…</Loading>
          </p>
        ) : null}

        {paged.pageCount > 1 ? (
          <SoundPagination
            position="top"
            page={paged.page}
            pageCount={paged.pageCount}
            first={paged.first}
            last={paged.last}
            total={rows.length}
            onPage={setPage}
          />
        ) : null}

        <ul data-testid="sounds-library" className="mt-2 list-none p-0">
          {paged.entries.map((entry) => {
            const choice = entry.choiceFor(target);
            const pick = entry.pickFor(target);
            const playable = canAudition && stockAvailable(entry, target);
            const selected = sameChoice(draft[target].choice, choice);
            const otherKind = target === "hit" ? "kill" : "hit";
            const inOther = sameChoice(draft[otherKind].choice, entry.choiceFor(otherKind));
            const clipName = accessibleNames.get(entry.id) ?? entry.label;
            return (
              <li
                key={entry.id}
                data-testid={`sounds-row-${entry.id}`}
                className="row min-h-11 gap-3 border-b border-edge px-1 py-1.5 last:border-b-0"
              >
                <PlayButton
                  verb="Preview"
                  clipName={clipName}
                  playing={player.playing === soundKey(pick)}
                  disabled={!playable}
                  onClick={() => toggle(target, choice)}
                />
                <span className="flex min-w-0 flex-1 items-baseline gap-3">
                  <span className="max-w-[60%] shrink-0 truncate text-[13px] font-medium text-ink">
                    {entry.label}
                  </span>
                  <span className="t-meta truncate">
                    {soundSourceLabel(entry)}
                    {entry.meta ? ` · ${entry.meta}` : ""}
                    {entry.madeFor && entry.madeFor !== target
                      ? ` · uploaded as a ${entry.madeFor} sound`
                      : ""}
                    {inOther ? ` · ${SLOT_TITLES[otherKind]}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  className="sound-icon-button"
                  data-testid={`sounds-favorite-${entry.id}`}
                  aria-pressed={favorites.has(entry.id)}
                  aria-label={`Favorite ${clipName}`}
                  title={favorites.has(entry.id) ? "Remove from favorites" : "Add to favorites"}
                  onClick={() => toggleFavorite(entry.id)}
                >
                  <Star
                    size={14}
                    weight={favorites.has(entry.id) ? "fill" : "regular"}
                    aria-hidden="true"
                  />
                </button>
                <AssignButton
                  label={selected ? "Selected" : "Use"}
                  accessibleLabel={`Use ${clipName} for ${ROLE_NOUNS[target]}`}
                  active={selected}
                  disabled={locked}
                  testId={`sounds-assign-${target}-${entry.id}`}
                  onClick={() => assign(target, entry)}
                />
              </li>
            );
          })}
          {rows.length === 0 ? (
            <li className="py-8 text-center">
              <p className="t-row">
                {query.trim()
                  ? `No sounds match “${query.trim()}”.`
                  : filter === "favorites"
                    ? "Star a sound to keep it here."
                    : "No sounds here yet."}
              </p>
            </li>
          ) : null}
        </ul>
        {paged.pageCount > 1 ? (
          <SoundPagination
            position="bottom"
            page={paged.page}
            pageCount={paged.pageCount}
            first={paged.first}
            last={paged.last}
            total={rows.length}
            onPage={(next) => {
              setPage(next);
              document.getElementById("sound-library")?.scrollIntoView?.({ block: "start" });
            }}
          />
        ) : null}
        {stockError || comfigError ? (
          <div className="pane-toolbar mt-3 rounded-md border border-edge bg-panel p-3">
            <div className="min-w-0">
              {stockError ? (
                <p data-testid="sounds-stock-error" className="t-meta">
                  Built-in sounds unavailable: {stockError}
                </p>
              ) : null}
              {comfigError ? (
                <p data-testid="sounds-comfig-error" className="t-meta">
                  comfig.app sounds unavailable: {comfigError}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={libraryLoading}
              onClick={() => setReloadKey((current) => current + 1)}
              className="btn btn-ghost"
            >
              <ArrowClockwise size={14} /> Retry sources
            </button>
          </div>
        ) : null}
      </section>

      <p className="pane-note mt-6">
        <button
          type="button"
          onClick={() => void openExternal("https://comfig.app/hits/")}
          className="underline decoration-edge-strong underline-offset-2 hover:text-ink"
        >
          comfig.app
        </button>{" "}
        sounds belong to their creators.
      </p>

      {/* Stays in reach at any scroll position: previews are often loud. */}
      <fieldset className="sound-preview-dock" title="Preview volume only">
        <legend className="sr-only">Sound previews</legend>
        <button
          type="button"
          className="sound-icon-button"
          data-testid="sounds-preview-mute"
          aria-pressed={previewLevel.muted}
          aria-label="Mute previews"
          onClick={() => changePreviewLevel({ muted: !previewLevel.muted })}
        >
          {previewAudible === 0 ? (
            <SpeakerSlash size={16} aria-hidden="true" />
          ) : previewAudible < 50 ? (
            <SpeakerLow size={16} aria-hidden="true" />
          ) : (
            <SpeakerHigh size={16} aria-hidden="true" />
          )}
        </button>
        <label htmlFor="sounds-preview-volume" className="t-meta shrink-0">
          Preview volume
        </label>
        <input
          id="sounds-preview-volume"
          data-testid="sounds-preview-volume"
          type="range"
          min={0}
          max={100}
          step={1}
          value={previewLevel.volume}
          onChange={(event) =>
            changePreviewLevel({ volume: Number(event.target.value), muted: false })
          }
          className="range w-40"
        />
        <output htmlFor="sounds-preview-volume" className="tnum w-10 text-[13px] text-ink-muted">
          {previewAudible}%
        </output>
        <span aria-hidden="true" className="h-5 w-px bg-edge" />
        <button
          type="button"
          className="btn btn-quiet"
          data-testid="sounds-preview-stop"
          disabled={!player.playing}
          onClick={player.stop}
        >
          <Stop size={14} aria-hidden="true" /> Stop
        </button>
      </fieldset>
    </section>
  );
}

function SoundPagination({
  position,
  page,
  pageCount,
  first,
  last,
  total,
  onPage,
}: {
  position: "top" | "bottom";
  page: number;
  pageCount: number;
  first: number;
  last: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const [jump, setJump] = useState(String(page + 1));
  useEffect(() => setJump(String(page + 1)), [page]);
  const jumpPage = parseSoundPageJump(jump, pageCount);
  return (
    <nav
      aria-label={`Sound library pages, ${position}`}
      data-testid={`sounds-pagination-${position}`}
      className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2"
    >
      <p className="t-meta tnum" aria-live={position === "top" ? "polite" : "off"}>
        {first}–{last} of {total}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          data-testid={`sounds-page-prev-${position}`}
          aria-label="Previous sound page"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          className="btn btn-quiet p-2"
        >
          <ArrowLeft size={14} />
        </button>
        {soundPageLinks(page, pageCount).map((link) =>
          typeof link === "number" ? (
            <button
              key={link}
              type="button"
              aria-label={`Sound page ${link}`}
              aria-current={link === page + 1 ? "page" : undefined}
              onClick={() => onPage(link - 1)}
              className={`btn btn-quiet tnum min-w-8 px-2 py-1.5 ${
                link === page + 1 ? "bg-brand/6 ring-1 ring-brand" : ""
              }`}
            >
              {link}
            </button>
          ) : (
            <span key={link} className="t-meta px-0.5" aria-hidden="true">
              …
            </span>
          ),
        )}
        <button
          type="button"
          data-testid={`sounds-page-next-${position}`}
          aria-label="Next sound page"
          disabled={page >= pageCount - 1}
          onClick={() => onPage(page + 1)}
          className="btn btn-quiet p-2"
        >
          <ArrowRight size={14} />
        </button>
      </div>
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (jumpPage !== null) onPage(jumpPage);
        }}
      >
        <label htmlFor={`sounds-page-jump-${position}`} className="t-meta">
          Page
        </label>
        <input
          id={`sounds-page-jump-${position}`}
          data-testid={`sounds-page-jump-${position}`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]+"
          value={jump}
          onChange={(event) => setJump(event.target.value)}
          aria-label={`Sound page number, 1 to ${pageCount}`}
          aria-invalid={jump !== "" && jumpPage === null ? true : undefined}
          className="field tnum w-12 px-2 py-1.5 text-center text-[13px] text-ink focus:outline-none"
        />
        <span className="t-meta tnum">/ {pageCount}</span>
        <button
          type="submit"
          disabled={jumpPage === null || jumpPage === page}
          className="btn btn-quiet px-2 py-1.5"
        >
          Go
        </button>
      </form>
    </nav>
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
  onBrowse,
  repeatDelay,
  onRepeatDelay,
}: {
  kind: HitsoundKind;
  slot: SlotDraft;
  locked: boolean;
  canAudition: boolean;
  playing: string | null;
  onPlay: (choice: SoundChoice) => void;
  onChange: (update: Partial<SlotDraft>) => void;
  onBrowse: () => void;
  /** Hit sounds only: seconds before the next hit can play the sound again. */
  repeatDelay?: number;
  onRepeatDelay: (seconds: number) => void;
}) {
  const title = SLOT_TITLES[kind];
  const key = soundKey(pickForChoice(kind, slot.choice));
  const isPlaying = playing === key;
  const retiredBoost = slot.choice.kind === "installed" && slot.choice.entry.source === "community";
  return (
    <section data-testid={`sounds-${kind}`} className="min-w-0">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="t-row">{title}</h2>
        </div>
        <Switch
          checked={slot.enabled}
          disabled={locked}
          label={`${title} on`}
          testId={`sounds-${kind}-enabled`}
          onChange={(enabled) => onChange({ enabled })}
        />
      </div>

      <div className="surface mt-3 flex items-center gap-3 p-2.5">
        <PlayButton
          clipName={`${choiceLabel(slot.choice)} (${title.toLowerCase()}, ${choiceSourceLabel(slot.choice)})`}
          playing={isPlaying}
          disabled={!canAudition}
          testId={`sounds-${kind}-play`}
          onClick={() => onPlay(slot.choice)}
        />
        <div className="min-w-0 flex-1">
          <p data-testid={`sounds-${kind}-name`} className="t-row truncate">
            {choiceLabel(slot.choice)}
          </p>
          <p className="t-meta truncate">
            {slot.enabled ? "" : "Off · "}
            {choiceSourceLabel(slot.choice)}
          </p>
        </div>
        <button
          type="button"
          data-testid={`sounds-${kind}-browse`}
          onClick={onBrowse}
          aria-label={`Browse sounds for ${ROLE_NOUNS[kind]}`}
          className="btn btn-ghost shrink-0 text-[12.5px]"
        >
          Browse
        </button>
      </div>

      <div className="mt-3">
        <Slider
          id={`sounds-${kind}-volume`}
          label="Volume"
          accessibleLabel={`${title} volume`}
          wideLabel
          value={slot.volume}
          min={0}
          max={100}
          disabled={locked}
          format={(value) => `${value}%`}
          onChange={(volume) => onChange({ volume })}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="t-row">Boost</p>
          <p className="t-meta">
            {slot.choice.kind === "stock"
              ? "Needs your own file."
              : retiredBoost
                ? "This sound's boost can't change."
                : null}
          </p>
        </div>
        <Segmented
          label={`${title} boost`}
          size="sm"
          disabled={locked || slot.choice.kind === "stock" || retiredBoost}
          testIdPrefix={`sounds-${kind}-boost`}
          options={BOOST_STEPS.map((db) => ({
            id: String(db) as "0" | "6" | "12",
            label: db === 0 ? "Off" : `+${db} dB`,
          }))}
          value={slot.choice.kind === "stock" ? "0" : (String(slot.boost) as "0" | "6" | "12")}
          onChange={(id) => onChange({ boost: Number(id) as BoostDb })}
        />
      </div>
      <div className="mt-2 border-t border-edge pt-1">
        <Slider
          id={`sounds-${kind}-pitch-min`}
          label="Pitch at 10 damage"
          accessibleLabel={`${title} pitch at 10 damage`}
          hint="100 is normal."
          wideLabel
          value={slot.pitchMin}
          min={PITCH_MIN}
          max={PITCH_MAX}
          disabled={locked}
          onChange={(pitchMin) => onChange({ pitchMin })}
        />
        <Slider
          id={`sounds-${kind}-pitch-max`}
          label="Pitch at 150 damage"
          accessibleLabel={`${title} pitch at 150 damage`}
          wideLabel
          value={slot.pitchMax}
          min={PITCH_MIN}
          max={PITCH_MAX}
          disabled={locked}
          onChange={(pitchMax) => onChange({ pitchMax })}
        />
        {repeatDelay === undefined ? null : (
          <Slider
            id="sounds-repeat-delay"
            label="Repeat delay"
            accessibleLabel="Hit sound repeat delay"
            hint="0 plays every hit."
            wideLabel
            value={Math.round(repeatDelay * 100)}
            min={0}
            max={100}
            disabled={locked}
            format={(value) => `${(value / 100).toFixed(2)} s`}
            onChange={(value) => onRepeatDelay(value / 100)}
          />
        )}
      </div>
    </section>
  );
}

function PlayButton({
  verb = "Play",
  clipName,
  playing,
  disabled = false,
  testId,
  onClick,
}: {
  verb?: string;
  clipName: string;
  playing: boolean;
  disabled?: boolean;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={`${playing ? "Stop" : verb} ${clipName}`}
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
  accessibleLabel,
  active,
  disabled,
  testId,
  onClick,
}: {
  label: string;
  accessibleLabel: string;
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
      aria-label={accessibleLabel}
      aria-pressed={active}
      disabled={disabled}
      onClick={() => {
        if (!active) onClick();
      }}
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
  accessibleLabel,
  hint,
  value,
  min,
  max,
  disabled,
  format,
  wideLabel = false,
  onChange,
}: {
  id: string;
  label: string;
  accessibleLabel?: string;
  hint?: string;
  /** Lines the track up under longer labels in the same column. */
  wideLabel?: boolean;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="min-w-0 py-2">
      <div
        className={`grid min-h-8 items-center gap-3 ${
          wideLabel
            ? "grid-cols-[8.75rem_minmax(0,1fr)_3.5rem]"
            : "grid-cols-[minmax(5rem,auto)_minmax(0,1fr)_3rem]"
        }`}
      >
        <label htmlFor={id} className="t-row">
          {label}
        </label>
        <input
          id={id}
          data-testid={id}
          type="range"
          aria-label={accessibleLabel}
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className="range w-full"
        />
        <output htmlFor={id} className="tnum text-right text-[13px] text-ink-muted">
          {format ? format(value) : value}
        </output>
      </div>
      {hint ? <p className="t-meta mt-1">{hint}</p> : null}
    </div>
  );
}
