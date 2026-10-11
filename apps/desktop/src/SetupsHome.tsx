import { Play, Plus } from "@phosphor-icons/react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Loading } from "./components/ui/Spinner";
import { useAppStatus } from "./hooks/useAppStatus";
import type { Api } from "./lib/api";
import type { HudCatalogEntry, ProfileLibrary, SetupOverview } from "./lib/bridge";
import {
  changeSummary,
  differingFacts,
  factValue,
  hudLabel,
  hudPicture,
  libraryKey,
  playBlockedReason,
  resolveSelection,
  SETUP_FACTS,
  stepSelection,
  switchBlockedReason,
} from "./lib/setups-ui";

/** A HUD picture that falls back to a flat block when it is missing or will not load. */
function Picture({
  src,
  alt,
  className,
  lazy = false,
  children,
}: {
  src: string | null;
  alt: string;
  className: string;
  lazy?: boolean;
  children?: ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const shown = src !== null && failed !== src;
  return (
    <div className={className} data-empty={shown ? undefined : "true"}>
      {shown ? (
        <img
          src={src}
          alt={alt}
          loading={lazy ? "lazy" : undefined}
          decoding="async"
          onError={() => setFailed(src)}
        />
      ) : (
        children
      )}
    </div>
  );
}

/**
 * The first page: every setup beside the one chosen, with its HUD picture, key
 * details and the actions that matter. Everything here is read from the library;
 * switching and playing go through the same paths as the header.
 */
export function SetupsHome({
  api,
  library,
  launching,
  launchBlockReason,
  recoveryTargetId,
  onSwitch,
  onSwitchAndPlay,
  onPlay,
  onEdit,
  onCreateNew,
  onCompare,
}: {
  api: Api;
  library: ProfileLibrary | null;
  /** The game is starting; the launch wait can be released from the header. */
  launching: boolean;
  /** Why the game cannot start right now, if it cannot. */
  launchBlockReason: string | null;
  /** The setup an interrupted switch must still finish on. */
  recoveryTargetId: string | null;
  onSwitch: (id: string) => void;
  onSwitchAndPlay: (id: string) => void;
  onPlay: () => void;
  /** Opens the panes of the setup in the game. */
  onEdit: () => void;
  onCreateNew: () => void;
  /** Opens the switch preview for a setup. */
  onCompare?: (id: string) => void;
}) {
  const { running, busy } = useAppStatus();
  const profiles = library?.profiles ?? [];
  const activeId = library?.activeProfileId ?? null;
  const [chosen, setChosen] = useState<string | null>(activeId);
  const [moved, setMoved] = useState(false);
  const selectedId = resolveSelection(library, chosen);
  const selected = profiles.find((profile) => profile.id === selectedId) ?? null;
  const active = profiles.find((profile) => profile.id === activeId) ?? null;

  const [catalog, setCatalog] = useState<HudCatalogEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    // Names and pictures are a nicety: without the catalog the raw HUD id shows.
    api
      .getHudCatalog(false)
      .then((result) => {
        if (!cancelled) setCatalog(result.entries);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api]);

  const key = libraryKey(library);
  const [overviews, setOverviews] = useState<Map<string, SetupOverview> | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .getSetupOverviews()
      .then((list) => {
        if (cancelled) return;
        setOverviews(new Map(list.map((overview) => [overview.id, overview])));
        setFailedKey(null);
      })
      .catch(() => {
        if (!cancelled) setFailedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [api, key]);
  const failed = failedKey === key && overviews === null;
  const overview = selectedId ? (overviews?.get(selectedId) ?? null) : null;
  const activeOverview = activeId ? (overviews?.get(activeId) ?? null) : null;

  // One highlight slides to the chosen setup; the first placement snaps.
  const list = useRef<HTMLDivElement>(null);
  const [mark, setMark] = useState<{ top: number; height: number; ready: boolean } | null>(null);
  const idKey = profiles.map((profile) => profile.id).join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: adding or removing a setup moves every item below it.
  useLayoutEffect(() => {
    const place = () => {
      const item = Array.from(
        list.current?.querySelectorAll<HTMLElement>("[data-setup-id]") ?? [],
      ).find((element) => element.dataset.setupId === selectedId);
      if (!item) {
        setMark(null);
        return;
      }
      setMark((current) => ({
        top: item.offsetTop,
        height: item.offsetHeight,
        ready: current !== null,
      }));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [selectedId, idKey]);

  function choose(id: string) {
    setMoved(true);
    setChosen(id);
  }
  function onItemKey(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const next = stepSelection(
      profiles.map((profile) => profile.id),
      id,
      event.key === "ArrowUp" ? -1 : 1,
    );
    if (next === null) return;
    choose(next);
    Array.from(list.current?.querySelectorAll<HTMLElement>("[data-setup-id]") ?? [])
      .find((element) => element.dataset.setupId === next)
      ?.focus();
  }

  const recoveryPending = recoveryTargetId !== null;
  const isActive = selected !== null && selected.id === activeId;
  const unsafeFolders = (selected?.unsafeCustomFolders?.length ?? 0) > 0;
  const switchReason = selected
    ? switchBlockedReason({
        running,
        busy,
        recoveryPending,
        isRecoveryTarget: recoveryTargetId === selected.id,
        unsafeFolders,
      })
    : null;
  const playReason = playBlockedReason({
    launchBlockReason,
    // Starting the game is its own state, shown on the button.
    busy: busy && !launching,
    recoveryPending,
    unsafeFolders: (active?.unsafeCustomFolders?.length ?? 0) > 0,
  });
  const differing =
    selected && !isActive && overview && activeOverview
      ? differingFacts(overview, activeOverview)
      : null;
  const hud = overview ? hudLabel(overview.hud, catalog) : null;
  const picture = overview ? hudPicture(overview.hud, catalog) : null;
  const reason = isActive ? (running ? null : playReason) : switchReason;
  const canCreate = !busy && !running && !recoveryPending;

  if (!library || !selected) return null;

  return (
    <div className="setups" data-testid="setups-home">
      <div className="setups-lib">
        <div className="setups-col">
          <div className="setups-head">
            <h1 className="setups-title">Setups</h1>
            <span className="setups-count">{profiles.length}</span>
          </div>
          <div ref={list} className="setups-list">
            {mark ? (
              <span
                aria-hidden="true"
                className="setups-hl"
                data-ready={mark.ready ? "true" : "false"}
                style={{ transform: `translateY(${mark.top}px)`, height: mark.height }}
              />
            ) : null}
            {profiles.map((profile) => {
              const own = overviews?.get(profile.id) ?? null;
              const current = profile.id === activeId;
              const on = profile.id === selected.id;
              return (
                <button
                  key={profile.id}
                  type="button"
                  data-setup-id={profile.id}
                  data-testid={`setup-item-${profile.id}`}
                  data-selected={on ? "true" : "false"}
                  aria-current={on ? "true" : undefined}
                  className="setups-item"
                  onClick={() => choose(profile.id)}
                  onKeyDown={(event) => onItemKey(event, profile.id)}
                >
                  <Picture
                    src={own ? hudPicture(own.hud, catalog) : null}
                    alt=""
                    lazy
                    className="setups-thumb"
                  />
                  <span className="setups-item-text">
                    <b>{profile.name}</b>
                    <small>
                      {current ? (
                        <>
                          <span className="setups-dot setups-dot-ok" aria-hidden="true" />
                          In the game
                        </>
                      ) : own ? (
                        hudLabel(own.hud, catalog)
                      ) : (
                        " "
                      )}
                    </small>
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              data-testid="setups-new"
              className="setups-item setups-item-new"
              disabled={!canCreate}
              onClick={onCreateNew}
            >
              <span className="setups-thumb" data-empty="true">
                <Plus size={16} aria-hidden="true" />
              </span>
              <span className="setups-item-text">
                <b>New setup</b>
              </span>
            </button>
          </div>
        </div>

        <section
          key={selected.id}
          className="setups-show"
          data-testid="setups-show"
          data-enter={moved ? "true" : undefined}
          aria-label={selected.name}
        >
          <div className="setups-stage">
            <Picture src={picture} alt={hud ? `${hud} screenshot` : ""} className="setups-shot">
              {overview ? (
                <span className="setups-shot-label">
                  {overview.hud === null ? "TF2's own HUD" : hud}
                </span>
              ) : null}
            </Picture>
            {isActive ? (
              <p className="setups-chip">
                <span className="setups-dot setups-dot-ok" aria-hidden="true" />
                In the game now
              </p>
            ) : null}
          </div>

          <div className="setups-bar">
            <div className="setups-who">
              <h2 className="setups-name">{selected.name}</h2>
              <div className="setups-sub" data-testid="setups-sub">
                {differing && active && onCompare ? (
                  <button
                    type="button"
                    data-testid="setups-compare"
                    className="text-link setups-changes"
                    disabled={busy || recoveryPending}
                    onClick={() => onCompare(selected.id)}
                  >
                    {differing.length > 0 ? (
                      <span className="setups-dot" aria-hidden="true" />
                    ) : null}
                    {changeSummary(differing.length, active.name)}
                  </button>
                ) : failed ? (
                  <span>Could not read the details.</span>
                ) : !overview ? (
                  <Loading size={12}>Loading</Loading>
                ) : null}
              </div>
            </div>

            <div className="setups-actions">
              {isActive ? (
                <>
                  <button
                    type="button"
                    data-testid="setups-edit"
                    className="btn btn-ghost setups-btn"
                    onClick={onEdit}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    data-testid="setups-play"
                    data-state={running ? "running" : launching ? "starting" : undefined}
                    className="btn btn-primary setups-btn setups-play"
                    disabled={running || launching || playReason !== null}
                    onClick={onPlay}
                  >
                    {running ? (
                      "TF2 is running"
                    ) : launching ? (
                      <Loading size={14}>Starting TF2</Loading>
                    ) : (
                      <>
                        <Play size={14} weight="fill" aria-hidden="true" />
                        Play
                      </>
                    )}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    data-testid="setups-switch"
                    className="btn btn-ghost setups-btn"
                    disabled={switchReason !== null}
                    onClick={() => onSwitch(selected.id)}
                  >
                    Switch
                  </button>
                  <button
                    type="button"
                    data-testid="setups-switch-play"
                    className="btn btn-primary setups-btn setups-play"
                    disabled={switchReason !== null}
                    onClick={() => onSwitchAndPlay(selected.id)}
                  >
                    <Play size={14} weight="fill" aria-hidden="true" />
                    Switch and play
                  </button>
                </>
              )}
            </div>
          </div>
          {reason ? (
            <p className="setups-reason t-meta" role="status" data-testid="setups-reason">
              {reason}
            </p>
          ) : null}

          <dl className="setups-facts" data-testid="setups-facts" aria-busy={!overview}>
            {SETUP_FACTS.map((fact) => {
              const same = differing !== null && !differing.includes(fact.key);
              return (
                <div
                  key={fact.key}
                  className="setups-fact"
                  data-testid={`setups-fact-${fact.key}`}
                  data-same={same ? "true" : undefined}
                >
                  <dt>{fact.label}</dt>
                  <dd title={overview ? factValue(fact.key, overview, catalog) : undefined}>
                    {overview ? factValue(fact.key, overview, catalog) : " "}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      </div>
    </div>
  );
}
