import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import { invokeErrorMessage, type ProfileLibrary } from "../lib/bridge";
import { formatModBytes } from "../lib/mods-ui";
import {
  groupRestorePoints,
  KEEP_OPTIONS,
  type RestorePoint,
  type RestorePointList,
  restoredProfileName,
  restorePointTime,
  restorePointTitle,
} from "../lib/restore-points-ui";
import type { ProfileComparison } from "../lib/switch-compare-ui";
import { ComparisonTable } from "./ComparisonTable";
import { Modal } from "./ui/Modal";
import { Segmented } from "./ui/Segmented";
import { Loading } from "./ui/Spinner";

type RestoreApi = Pick<
  Api,
  | "listRestorePoints"
  | "createRestorePoint"
  | "deleteRestorePoint"
  | "setRestorePointRetention"
  | "compareRestorePoint"
  | "restoreRestorePoint"
>;

type Expanded =
  | { id: string; kind: "compare"; comparison: ProfileComparison | null }
  | { id: string; kind: "restore"; name: string }
  | { id: string; kind: "delete" };

/**
 * Save and restore local restore points. Restoring always creates a new,
 * inactive profile; nothing in TF2 changes until the player switches to it.
 */
export function RestorePointsDialog({
  api,
  profileId,
  library,
  running,
  busy,
  onRestored,
  onClose,
}: {
  api: RestoreApi;
  /** Opening profile; its points are listed first. Null closes the dialog. */
  profileId: string | null;
  library: ProfileLibrary | null;
  running: boolean;
  busy: boolean;
  onRestored: (library: ProfileLibrary) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<RestorePointList | null>(null);
  const [label, setLabel] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Expanded | null>(null);
  const compareRequest = useRef(0);

  const load = useCallback(async () => {
    try {
      setList(await api.listRestorePoints());
      setError(null);
    } catch (err) {
      setError(invokeErrorMessage(err));
    }
  }, [api]);

  useEffect(() => {
    if (!profileId) return;
    setLabel("");
    setNotice(null);
    setExpanded(null);
    void load();
  }, [profileId, load]);

  async function run<T>(key: string, work: () => Promise<T>): Promise<T | null> {
    setWorking(key);
    setError(null);
    try {
      return await work();
    } catch (err) {
      setError(invokeErrorMessage(err));
      return null;
    } finally {
      setWorking(null);
    }
  }

  async function save() {
    if (!profileId) return;
    const point = await run("save", () =>
      api.createRestorePoint(profileId, label.trim() ? label.trim() : null),
    );
    if (point) {
      setLabel("");
      setNotice(point.label ? `Saved ${point.label}.` : "Restore point saved.");
      await load();
    }
  }

  function compare(point: RestorePoint) {
    if (expanded?.id === point.id && expanded.kind === "compare") {
      setExpanded(null);
      return;
    }
    const request = ++compareRequest.current;
    setExpanded({ id: point.id, kind: "compare", comparison: null });
    api
      .compareRestorePoint(point.id)
      .then((comparison) => {
        if (request === compareRequest.current)
          setExpanded({ id: point.id, kind: "compare", comparison });
      })
      .catch((err: unknown) => {
        if (request === compareRequest.current) {
          setExpanded(null);
          setError(invokeErrorMessage(err));
        }
      });
  }

  async function restore(point: RestorePoint, name: string) {
    const next = await run(`restore:${point.id}`, () =>
      api.restoreRestorePoint(point.id, name.trim()),
    );
    if (next) {
      setExpanded(null);
      setNotice(`Restored as ${name.trim()}. Switch to it when you're ready.`);
      onRestored(next);
    }
  }

  async function remove(point: RestorePoint) {
    const next = await run(`delete:${point.id}`, () => api.deleteRestorePoint(point.id));
    if (next) {
      setExpanded(null);
      setList(next);
    }
  }

  async function setKeep(keep: number) {
    const next = await run("keep", () => api.setRestorePointRetention(keep));
    if (next) setList(next);
  }

  const profiles = library?.profiles ?? [];
  const selected = profiles.find((profile) => profile.id === profileId);
  const groups = list ? groupRestorePoints(list.points, profiles, profileId) : [];
  const locked = working !== null || busy;

  return (
    <Modal
      open={profileId !== null}
      title="Restore points"
      testId="restore-points"
      className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto sm:p-6"
      onClose={onClose}
    >
      <p className="t-meta mt-1">
        A restore point keeps a copy of a saved profile on this computer. Restoring adds it as a new
        profile; nothing in TF2 changes until you switch to it.
      </p>

      {selected ? (
        <form
          className="mt-4 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="sr-only" htmlFor="restore-point-label">
            Restore point name
          </label>
          <input
            id="restore-point-label"
            value={label}
            maxLength={80}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Name (optional)"
            className="field min-w-0 flex-1 px-3 py-2 text-[13.5px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <button
            type="submit"
            className="btn btn-primary"
            data-testid="restore-point-save"
            disabled={locked}
          >
            {working === "save" ? (
              <Loading>Saving…</Loading>
            ) : (
              `Save restore point of ${selected.name}`
            )}
          </button>
        </form>
      ) : null}

      {notice ? (
        <p className="t-meta mt-2" aria-live="polite" data-testid="restore-points-notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="t-body mt-2 text-error">
          {error}
        </p>
      ) : null}

      {list ? (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <span className="t-row">Keep per profile</span>
            <Segmented
              label="Restore points kept per profile"
              options={[...KEEP_OPTIONS]}
              value={
                (KEEP_OPTIONS.find((option) => Number(option.id) === list.keepPerProfile)?.id ??
                  "5") as (typeof KEEP_OPTIONS)[number]["id"]
              }
              disabled={locked}
              testIdPrefix="restore-points-keep"
              onChange={(id) => void setKeep(Number(id))}
            />
          </div>
          <p className="t-meta mt-1">
            The oldest restore point is removed when a new one is saved.
          </p>
          {groups.every((group) => group.points.length === 0) ? (
            <p className="t-body mt-4 text-ink-muted">No restore points yet.</p>
          ) : null}
          {groups
            .filter((group) => group.points.length > 0)
            .map((group) => (
              <section key={group.profileId} className="mt-5">
                <h3 className="eyebrow mb-1">
                  {group.profileName}
                  {group.deleted ? " (deleted)" : ""}
                </h3>
                <ul className="divide-y divide-edge">
                  {group.points.map((point) => {
                    const open = expanded?.id === point.id ? expanded : null;
                    return (
                      <li key={point.id} className="py-2" data-testid={`restore-point-${point.id}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0">
                            <span className="t-row block truncate">{restorePointTitle(point)}</span>
                            <span className="t-meta">
                              {point.label ? `${restorePointTime(point)} · ` : ""}
                              {formatModBytes(point.bytes)}
                            </span>
                          </span>
                          <span className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              className="btn btn-ghost"
                              aria-expanded={open?.kind === "compare"}
                              onClick={() => compare(point)}
                            >
                              Compare
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={locked || running}
                              title={running ? "Close TF2 before restoring." : undefined}
                              onClick={() =>
                                setExpanded({
                                  id: point.id,
                                  kind: "restore",
                                  name: restoredProfileName(point),
                                })
                              }
                            >
                              Restore…
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={locked}
                              onClick={() => setExpanded({ id: point.id, kind: "delete" })}
                            >
                              Delete…
                            </button>
                          </span>
                        </div>
                        {open?.kind === "compare" ? (
                          open.comparison ? (
                            <div data-testid="restore-point-compare">
                              <ComparisonTable
                                comparison={{
                                  ...open.comparison,
                                  fromName: group.deleted
                                    ? open.comparison.fromName
                                    : `${group.profileName} now`,
                                  toName: "Restore point",
                                }}
                                testIdPrefix="restore-point-compare"
                                sameText="The profile is the same as this restore point."
                              />
                            </div>
                          ) : (
                            <p className="t-meta mt-2">
                              <Loading>Comparing…</Loading>
                            </p>
                          )
                        ) : null}
                        {open?.kind === "restore" ? (
                          <form
                            className="mt-2 flex flex-wrap gap-2"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void restore(point, open.name);
                            }}
                          >
                            <label className="sr-only" htmlFor={`restore-name-${point.id}`}>
                              New profile name
                            </label>
                            <input
                              id={`restore-name-${point.id}`}
                              value={open.name}
                              maxLength={80}
                              onChange={(event) =>
                                setExpanded({ ...open, name: event.target.value })
                              }
                              className="field min-w-0 flex-1 px-3 py-2 text-[13.5px] text-ink focus:outline-none"
                            />
                            <button
                              type="submit"
                              className="btn btn-primary"
                              data-testid="restore-point-confirm"
                              disabled={locked || running || !open.name.trim()}
                            >
                              {working === `restore:${point.id}` ? (
                                <Loading>Restoring…</Loading>
                              ) : (
                                "Add as new profile"
                              )}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => setExpanded(null)}
                            >
                              Cancel
                            </button>
                          </form>
                        ) : null}
                        {open?.kind === "delete" ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="t-meta">This restore point will be removed.</span>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              data-testid="restore-point-delete"
                              disabled={locked}
                              onClick={() => void remove(point)}
                            >
                              Delete restore point
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              onClick={() => setExpanded(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
        </>
      ) : error ? null : (
        <p className="t-meta mt-4">
          <Loading>Reading restore points…</Loading>
        </p>
      )}

      <div className="mt-6 flex justify-end">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
