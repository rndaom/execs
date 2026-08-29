import { useEffect, useState } from "react";
import {
  browseTf2Root,
  confirmTf2Root,
  getProfileLibrary,
  getTf2Root,
  getTf2WriteLock,
  initProfileLibrary,
  isTauri,
  onTf2Running,
  type ProfileLibrary,
  saveCurrentAs,
  scanTf2Installs,
  type Tf2Install,
} from "./lib/bridge";
import { confirmEnabled, formatInstallLabel } from "./lib/finder-ui";
import { canSaveCurrent, libraryStatusCopy, previewSavedProfile } from "./lib/library-ui";
import {
  type PreviewState,
  previewConfirmed,
  previewInstalls,
  previewLibrary,
  previewLocked,
  previewStateFromSearch,
} from "./lib/preview";

type Screen = "finder" | "ready";

function initialPreview(): PreviewState {
  if (typeof window === "undefined") {
    return "empty";
  }
  return previewStateFromSearch(window.location.search) ?? "empty";
}

export function App() {
  const tauri = isTauri();
  const [preview] = useState<PreviewState>(initialPreview);
  const [screen, setScreen] = useState<Screen>(() =>
    !tauri &&
    (preview === "confirmed" ||
      preview === "locked" ||
      preview === "library" ||
      preview === "saved")
      ? "ready"
      : "finder",
  );
  const [scanning, setScanning] = useState(tauri);
  const [installs, setInstalls] = useState<Tf2Install[]>(() =>
    tauri ? [] : previewInstalls(preview),
  );
  const [selected, setSelected] = useState<string | null>(() => {
    if (tauri) {
      return null;
    }
    const list = previewInstalls(preview);
    return list.length === 1 ? list[0].path : null;
  });
  const [confirmed, setConfirmed] = useState<Tf2Install | null>(() =>
    tauri ? null : previewConfirmed(preview),
  );
  const [library, setLibrary] = useState<ProfileLibrary | null>(() =>
    tauri ? null : previewLibrary(preview),
  );
  const [draftName, setDraftName] = useState("");
  const [running, setRunning] = useState(() => !tauri && previewLocked(preview));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tauri) {
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    async function boot() {
      try {
        const [stored, lock] = await Promise.all([getTf2Root(), getTf2WriteLock()]);
        if (cancelled) {
          return;
        }
        setRunning(lock.running);
        if (stored) {
          setConfirmed(stored);
          setSelected(stored.path);
          setScreen("ready");
          const current = await getProfileLibrary();
          if (!cancelled) {
            setLibrary(current);
          }
        }
        const found = await scanTf2Installs();
        if (cancelled) {
          return;
        }
        setInstalls(found);
        if (!stored && found.length === 1) {
          setSelected(found[0].path);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not scan for TF2.");
        }
      } finally {
        if (!cancelled) {
          setScanning(false);
        }
      }
    }

    boot();
    onTf2Running(setRunning)
      .then((stop) => {
        unlisten = stop;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [tauri]);

  useEffect(() => {
    if (!tauri || !confirmed || running || !library) {
      return;
    }
    if (library.initialized || library.rootMismatch || !library.usable) {
      return;
    }

    let cancelled = false;
    initProfileLibrary()
      .then((next) => {
        if (!cancelled) {
          setLibrary(next);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not create the profile library.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tauri, confirmed, running, library]);

  async function onBrowse() {
    setError(null);
    if (!tauri) {
      const [demo] = previewInstalls("one");
      setInstalls((current) =>
        current.some((item) => item.path === demo.path) ? current : [...current, demo],
      );
      setSelected(demo.path);
      return;
    }
    setBusy(true);
    try {
      const picked = await browseTf2Root();
      if (!picked) {
        return;
      }
      setInstalls((current) =>
        current.some((item) => item.path === picked.path) ? current : [...current, picked],
      );
      setSelected(picked.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That folder is not a TF2 install.");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    if (!selected) {
      return;
    }
    setError(null);
    if (!tauri) {
      setConfirmed({ path: selected });
      setLibrary(previewLibrary("library"));
      setScreen("ready");
      return;
    }
    setBusy(true);
    try {
      const stored = await confirmTf2Root(selected);
      setConfirmed(stored);
      setScreen("ready");
      setLibrary(await getProfileLibrary());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remember that install.");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveCurrent() {
    if (!library || !canSaveCurrent(library, running, draftName)) {
      return;
    }
    setError(null);
    if (!tauri) {
      const next = previewSavedProfile(draftName, library.profiles.length + 1);
      setLibrary({
        ...library,
        initialized: true,
        usable: true,
        activeProfileId: library.activeProfileId ?? next.id,
        profiles: [...library.profiles, next],
      });
      setDraftName("");
      return;
    }
    setBusy(true);
    try {
      setLibrary(await saveCurrentAs(draftName));
      setDraftName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that profile.");
    } finally {
      setBusy(false);
    }
  }

  function onChange() {
    setError(null);
    setScreen("finder");
    if (confirmed && installs.some((item) => item.path === confirmed.path)) {
      setSelected(confirmed.path);
    } else if (installs.length === 1) {
      setSelected(installs[0].path);
    }
  }

  const canConfirm = confirmEnabled(selected, scanning || busy);

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      {running ? (
        <div
          role="status"
          data-testid="tf2-write-lock"
          className="border-b border-team-red bg-team-red/20 px-4 py-2 text-center text-sm text-ink"
        >
          TF2 is running — execs is read-only until the game quits.
        </div>
      ) : null}

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-10">
        {screen === "ready" && confirmed ? (
          <ReadyPanel
            path={confirmed.path}
            library={library}
            draftName={draftName}
            running={running}
            busy={busy}
            error={error}
            onDraftName={setDraftName}
            onSave={onSaveCurrent}
            onChange={onChange}
          />
        ) : (
          <FinderPanel
            scanning={scanning}
            installs={installs}
            selected={selected}
            error={error}
            canConfirm={canConfirm}
            busy={busy}
            onSelect={setSelected}
            onBrowse={onBrowse}
            onConfirm={onConfirm}
          />
        )}

        <p className="mt-10 max-w-md text-center text-sm text-ink-muted">
          execs is a fan project and is not affiliated with Valve Corporation or Steam. Team
          Fortress and Steam are trademarks of Valve Corporation.
        </p>
      </main>
    </div>
  );
}

function FinderPanel({
  scanning,
  installs,
  selected,
  error,
  canConfirm,
  busy,
  onSelect,
  onBrowse,
  onConfirm,
}: {
  scanning: boolean;
  installs: Tf2Install[];
  selected: string | null;
  error: string | null;
  canConfirm: boolean;
  busy: boolean;
  onSelect: (path: string) => void;
  onBrowse: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className="flex w-full flex-col items-center text-center">
      <h1 className="font-display text-5xl text-brand">Find TF2</h1>
      <p className="mt-3 max-w-md text-sm text-ink-muted">
        Scan Steam libraries and confirm this is Team Fortress 2 before any write. Profiles will be
        tied to this folder.
      </p>

      <div className="mt-8 w-full rounded-xl border border-edge bg-panel p-4 text-left">
        {scanning ? (
          <p className="text-sm text-ink-muted">Scanning Steam libraries…</p>
        ) : installs.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No Team Fortress 2 install found. Use Browse to pick the Team Fortress 2 folder.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {installs.map((install) => {
              const active = install.path === selected;
              return (
                <li key={install.path}>
                  <button
                    type="button"
                    onClick={() => onSelect(install.path)}
                    data-selected={active ? "true" : "false"}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition ${
                      active
                        ? "border-brand bg-panel-raised"
                        : "border-edge bg-bg hover:border-ink-faint"
                    }`}
                  >
                    <div className="font-display text-lg text-ink">
                      {formatInstallLabel(install.path)}
                    </div>
                    <div className="mt-1 break-all text-xs text-ink-faint">{install.path}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error ? <p className="mt-4 text-sm text-team-red">{error}</p> : null}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onBrowse}
          disabled={busy}
          className="rounded-pill border border-edge px-5 py-2 text-sm text-ink hover:bg-panel-raised disabled:opacity-50"
        >
          Browse
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!canConfirm}
          className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
        >
          Confirm
        </button>
      </div>
    </section>
  );
}

function ReadyPanel({
  path,
  library,
  draftName,
  running,
  busy,
  error,
  onDraftName,
  onSave,
  onChange,
}: {
  path: string;
  library: ProfileLibrary | null;
  draftName: string;
  running: boolean;
  busy: boolean;
  error: string | null;
  onDraftName: (name: string) => void;
  onSave: () => void;
  onChange: () => void;
}) {
  const canSave = library ? canSaveCurrent(library, running, draftName) && !busy : false;

  return (
    <section className="flex w-full flex-col items-center text-center">
      <h1 className="font-display text-6xl text-brand">execs</h1>
      <p className="mt-6 font-display text-sm tracking-wide text-ink-muted">TF2 install</p>
      <p className="mt-2 max-w-lg break-all text-sm text-ink">{path}</p>

      <div
        data-testid="profile-library"
        className="mt-8 w-full rounded-xl border border-edge bg-panel p-4 text-left"
      >
        <p className="font-display text-sm tracking-wide text-ink-muted">Profiles</p>
        <p data-testid="profile-library-status" className="mt-2 text-sm text-ink">
          {library ? libraryStatusCopy(library) : "Loading profiles…"}
        </p>
        {library && library.profiles.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {library.profiles.map((profile) => (
              <li
                key={profile.id}
                data-testid="profile-name"
                className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-bg px-4 py-2 text-sm text-ink"
              >
                <span>{profile.name}</span>
                {library.activeProfileId === profile.id ? (
                  <span
                    data-testid="profile-active"
                    className="rounded-pill border border-brand px-2 py-0.5 text-xs text-brand"
                  >
                    Active
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {library && !library.rootMismatch && !running ? (
          <form
            className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center"
            onSubmit={(event) => {
              event.preventDefault();
              onSave();
            }}
          >
            <label className="sr-only" htmlFor="profile-name">
              Profile name
            </label>
            <input
              id="profile-name"
              value={draftName}
              onChange={(event) => onDraftName(event.target.value)}
              placeholder="Name this profile"
              disabled={busy}
              className="min-w-0 flex-1 rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
            />
            <button
              type="submit"
              disabled={!canSave}
              className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
            >
              Save current as…
            </button>
          </form>
        ) : null}
        {library && running ? (
          <p className="mt-3 text-sm text-ink-muted">Read-only while TF2 is running.</p>
        ) : null}
      </div>

      {error ? <p className="mt-4 text-sm text-team-red">{error}</p> : null}

      <button
        type="button"
        onClick={onChange}
        className="mt-6 rounded-pill border border-edge px-5 py-2 text-sm text-ink hover:bg-panel-raised"
      >
        Change
      </button>
    </section>
  );
}
