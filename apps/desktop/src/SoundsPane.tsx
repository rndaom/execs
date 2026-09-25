import {
  ArrowClockwise,
  ArrowLeft,
  ArrowRight,
  MagnifyingGlass,
  Play,
  Stop,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Disclosure } from "./components/ui/Disclosure";
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
  type ContentIndex,
  type HitsoundKind,
  type HitsoundRecord,
  type HitsoundSlotChange,
  isTauri,
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
  HITSOUND_CASUAL_COPY,
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
import {
  filterSoundLibrary,
  ownEntry,
  pageSoundLibrary,
  parseSoundPageJump,
  SOUND_LIBRARY_PAGE_SIZE,
  SOUND_SORTS,
  SOUND_SOURCE_LABELS,
  type SoundLibraryEntry,
  type SoundSort,
  type SoundSourceId,
  soundAccessibleNames,
  soundPageLinks,
  stockEntries,
} from "./lib/sound-library";

const SLOT_TITLES: Record<HitsoundKind, string> = {
  hit: "Hit sound",
  kill: "Kill sound",
};

const SOURCE_FILTERS: { id: SoundSourceId | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "stock", label: "Stock" },
  { id: "own", label: "Yours" },
];

/**
 * The Sounds pane: a hit sound and a kill sound, each an on/off, the chosen
 * sound with a play button, and a volume; pitch-by-damage and the repeat
 * delay fold under Advanced. Below sits the library of built-in effects and
 * user-picked WAVs. Files go into the profile's sound pack; the cvars ride the
 * same managed gameplay cfg the Crosshair pane writes.
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

  // Library state.
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SoundSort>("name-asc");
  const [source, setSource] = useState<SoundSourceId | "all">("all");
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<PickedHitsound | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [stockStems, setStockStems] = useState<string[] | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [sources, setSources] = useState<ContentIndex | null>(null);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [libraryLoading, setLibraryLoading] = useState(true);
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
    void stockRead.then(() => {
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

  const library = useMemo<SoundLibraryEntry[]>(
    () => [...(picked ? [ownEntry(picked)] : []), ...stockEntries()],
    [picked],
  );
  const rows = useMemo(
    () => filterSoundLibrary(library, query, sort, source === "all" ? null : new Set([source])),
    [library, query, sort, source],
  );
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
  const hasSavedCatalogSound = [record?.hit, record?.kill].some(
    (entry) => entry?.source === "community" || entry?.source === "comfig",
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
        if (picked) {
          forgetSoundUrl({ kind: "file", token: picked.token, name: picked.name });
        }
        setPicked(next);
        setSource("all");
        setQuery("");
        setPage(0);
      }
    } catch (err) {
      setPickError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setPicking(false);
    }
  }

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
      <PaneHeader title="Sounds" />

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
            onBrowse={() => {
              searchRef.current?.focus();
              searchRef.current?.scrollIntoView({ block: "center" });
            }}
          />
        ))}
      </div>

      {dormantSounds.length ? (
        <section data-testid="sounds-saved-inactive" className="pane-note mt-4">
          <p>
            Saved custom sound files stay in this profile while built-in effects play. Assigning
            your own WAV replaces one; Remove sound files deletes both saved files.
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
          This profile has a sound from a catalog execs no longer offers. Its saved WAV remains in
          the profile and can still play. To change its baked boost, choose a WAV you provide.
          Assigning your own WAV replaces it; choosing Default ding or Remove sound files deletes
          it.
        </section>
      ) : null}

      {record?.sourceChanged ? (
        <section data-testid="sounds-source-changed" role="alert" className="surface mt-4 p-3">
          <h2 className="t-row">Saved sound source changed</h2>
          <p className="t-meta mt-1">
            A managed WAV changed outside execs. Its saved name and source may no longer describe
            the installed audio. Reselect both sounds from the library below, or use Remove sound
            files to return to TF2&apos;s default paths.
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
              These packs also provide TF2&apos;s canonical sound paths. A saved sound in execs
              describes its managed file; the in-game source depends on TF2&apos;s mount order and
              has not been verified here.
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
              <p>
                Some installed packs could not be inspected, so this source list may be incomplete.
              </p>
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

      <section className="mt-4">
        <Disclosure
          profileId={profileId}
          storageKey="sounds-advanced"
          summary="Pitch and repeat timing"
          testId="sounds-advanced"
        >
          <div className="pane-split mt-3 gap-y-4">
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
              title={canAudition ? undefined : "Needs the desktop app."}
              onClick={() => void chooseFile()}
              className="btn btn-ghost"
            >
              {picking ? <Spinner size={14} /> : <UploadSimple size={14} />}
              {picking ? "Reading…" : "Add a WAV…"}
            </button>
            {record ? (
              <button
                type="button"
                data-testid="sounds-remove"
                disabled={removeLocked}
                onClick={onRemove}
                className="btn btn-ghost"
              >
                <Trash size={14} /> Remove sound files
              </button>
            ) : null}
          </div>
        </div>
        {pickError ? (
          <p data-testid="sounds-pick-error" className="t-meta mt-2 text-warn">
            {pickError}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Segmented
            label="Source"
            size="sm"
            testIdPrefix="sounds-source"
            options={SOURCE_FILTERS}
            value={source}
            onChange={(next) => {
              setSource(next);
              setPage(0);
            }}
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
          <Segmented
            label="Sort"
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

        <p className="t-meta mt-2">Built-in effects come from your TF2 install.</p>
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
            const hitChoice = entry.choiceFor("hit");
            const killChoice = entry.choiceFor("kill");
            const hitPick = entry.pickFor("hit");
            const playable = canAudition && stockAvailable(entry, "hit");
            const isHit = sameChoice(draft.hit.choice, hitChoice);
            const isKill = sameChoice(draft.kill.choice, killChoice);
            const clipName = accessibleNames.get(entry.id) ?? entry.label;
            return (
              <li
                key={entry.id}
                data-testid={`sounds-row-${entry.id}`}
                className="row min-h-11 gap-3 border-b border-edge px-1 py-1.5 last:border-b-0"
              >
                <PlayButton
                  clipName={clipName}
                  playing={player.playing === soundKey(hitPick)}
                  disabled={!playable}
                  onClick={() => toggle("hit", hitChoice)}
                />
                <span className="flex min-w-0 flex-1 items-baseline gap-3">
                  <span className="max-w-[60%] shrink-0 truncate text-[13px] font-medium text-ink">
                    {entry.label}
                  </span>
                  <span className="t-meta truncate">
                    {SOUND_SOURCE_LABELS[entry.source]}
                    {entry.meta ? ` · ${entry.meta}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <AssignButton
                    label="Hit"
                    accessibleLabel={`Assign ${clipName} as hit sound`}
                    active={isHit}
                    disabled={locked}
                    testId={`sounds-assign-hit-${entry.id}`}
                    onClick={() => assign("hit", entry)}
                  />
                  <AssignButton
                    label="Kill"
                    accessibleLabel={`Assign ${clipName} as kill sound`}
                    active={isKill}
                    disabled={locked}
                    testId={`sounds-assign-kill-${entry.id}`}
                    onClick={() => assign("kill", entry)}
                  />
                </span>
              </li>
            );
          })}
          {rows.length === 0 ? (
            <li className="py-8 text-center">
              <p className="t-row">
                {source === "own" && !picked ? "Add a WAV to make it yours." : "No sounds match."}
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
        {stockError ? (
          <div className="pane-toolbar mt-3 rounded-md border border-edge bg-panel p-3">
            <div className="min-w-0">
              {stockError ? (
                <p data-testid="sounds-stock-error" className="t-meta">
                  Built-in sounds unavailable: {stockError}
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
        {HITSOUND_CASUAL_COPY} Built-in effects are previewed from your own copy of the game. Add a
        WAV you have permission to use for a custom sound.
      </p>
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
}: {
  kind: HitsoundKind;
  slot: SlotDraft;
  locked: boolean;
  canAudition: boolean;
  playing: string | null;
  onPlay: (choice: SoundChoice) => void;
  onChange: (update: Partial<SlotDraft>) => void;
  onBrowse: () => void;
}) {
  const title = SLOT_TITLES[kind];
  const key = soundKey(pickForChoice(kind, slot.choice));
  const isPlaying = playing === key;
  const retiredBoost = slot.choice.kind === "installed" && slot.choice.entry.source !== "file";
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
          onClick={onBrowse}
          aria-label={`Browse ${title.toLowerCase()}s`}
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
              ? "Choose your own WAV to boost it."
              : retiredBoost
                ? "This saved catalog sound keeps its current boost. Choose your own WAV to change it."
                : "Makes the custom file itself louder."}
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
    </section>
  );
}

function PlayButton({
  clipName,
  playing,
  disabled = false,
  testId,
  onClick,
}: {
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
      aria-label={`${playing ? "Stop" : "Play"} ${clipName}`}
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
  accessibleLabel,
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
  accessibleLabel?: string;
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
      <div className="grid min-h-8 grid-cols-[minmax(5rem,auto)_minmax(0,1fr)_3rem] items-center gap-3">
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
