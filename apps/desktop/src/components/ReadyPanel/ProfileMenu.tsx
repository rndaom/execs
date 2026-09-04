import { CaretDown, DownloadSimple, FolderOpen, Plus, UploadSimple } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import type { ProfileLibrary } from "../../lib/bridge";
import {
  canCreateNew,
  canExportProfile,
  canImportProfile,
  canSaveCurrent,
  libraryStatusCopy,
} from "../../lib/library-ui";
/**
 * The profile popover: switch, save current, import and change install. Escape
 * and an outside click close it, and focus returns to the summary — a
 * `<details>` menu gives none of that for free.
 */
export function ProfileMenu({
  library,
  draftName,
  running,
  controlsBusy,
  recoveryTargetId,
  onDraftName,
  onSave,
  onSwitch,
  onExport,
  onImport,
  onCreateNew,
  onChangeInstall,
}: {
  library: ProfileLibrary | null;
  draftName: string;
  running: boolean;
  controlsBusy: boolean;
  recoveryTargetId: string | null;
  onDraftName: (name: string) => void;
  onSave: () => void;
  onSwitch: (id: string) => void;
  onExport: (id: string) => void;
  onImport: () => void;
  onCreateNew: () => void;
  onChangeInstall: () => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const summaryRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function close(restoreFocus: boolean) {
      const node = detailsRef.current;
      if (!node?.open) {
        return;
      }
      node.open = false;
      if (restoreFocus) {
        summaryRef.current?.focus();
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close(true);
      }
    }
    function onPointerDown(event: PointerEvent) {
      const node = detailsRef.current;
      if (node?.open && event.target instanceof Node && !node.contains(event.target)) {
        close(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  const recoveryPending = recoveryTargetId !== null;
  const canSave = library
    ? canSaveCurrent(library, running, draftName) && !controlsBusy && !recoveryPending
    : false;
  const showExport = library ? canExportProfile(library, running) : false;
  const canImport = library
    ? canImportProfile(library, running) && !controlsBusy && !recoveryPending
    : false;
  const showCreate = library ? canCreateNew(library) : false;
  const activeProfile = library?.profiles.find((profile) => profile.id === library.activeProfileId);

  return (
    <details ref={detailsRef} data-testid="profile-library" className="group relative">
      <summary
        ref={summaryRef}
        className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink hover:bg-panel [&::-webkit-details-marker]:hidden"
      >
        <span className="hidden text-ink-faint sm:inline">Profile</span>
        <strong className="max-w-40 truncate font-medium text-ink">
          {activeProfile?.name ?? "Profiles"}
        </strong>
        <CaretDown size={13} className="text-ink-faint" />
        {activeProfile ? (
          <span data-testid="profile-active" className="badge hidden md:inline-flex">
            Active
          </span>
        ) : null}
      </summary>

      <div className="overlay absolute top-[calc(100%+10px)] left-0 z-50 w-[min(430px,calc(100vw-2rem))] p-4 text-left">
        <div className="flex items-start justify-between gap-4 border-b border-edge pb-3">
          <div>
            <p className="t-row">Profiles</p>
            <p data-testid="profile-library-status" className="t-meta mt-1">
              {library ? libraryStatusCopy(library) : "Loading profiles…"}
            </p>
          </div>
          {showCreate ? (
            // A new profile is a write: offering the wizard while TF2 runs only
            // ends in a permanently disabled Apply.
            <button
              type="button"
              data-testid="create-new"
              onClick={onCreateNew}
              disabled={controlsBusy || running || recoveryPending}
              title={running ? "Close TF2 to create a profile." : undefined}
              className="btn btn-primary"
            >
              <Plus size={14} weight="bold" />
              New profile
            </button>
          ) : null}
        </div>
        {showCreate && running ? (
          <p data-testid="create-new-locked" className="mt-2 text-[12px] text-ink-faint">
            Close TF2 to create a profile.
          </p>
        ) : null}

        {library && library.profiles.length > 0 ? (
          <ul className="mt-2 max-h-52 overflow-y-auto">
            {library.profiles.map((profile) => {
              const active = library.activeProfileId === profile.id;
              const canSwitch =
                !active &&
                !running &&
                !controlsBusy &&
                (!recoveryPending || profile.id === recoveryTargetId);
              return (
                <li
                  key={profile.id}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[13.5px] transition-colors duration-150 ${
                    active ? "" : "hover:bg-panel"
                  }`}
                >
                  <button
                    type="button"
                    data-testid="profile-name"
                    disabled={!canSwitch}
                    onClick={() => onSwitch(profile.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                  >
                    <span
                      className={`size-2 shrink-0 rounded-full ${
                        active ? "bg-brand" : "bg-edge-strong"
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate text-ink">{profile.name}</span>
                    <span className="text-[12px] text-ink-faint">
                      {active ? "Current" : "Switch"}
                    </span>
                  </button>
                  {showExport ? (
                    <button
                      type="button"
                      data-testid="profile-export"
                      title={`Export ${profile.name}`}
                      aria-label={`Export ${profile.name}`}
                      onClick={() => onExport(profile.id)}
                      disabled={controlsBusy || recoveryPending}
                      className="rounded-md p-1.5 text-ink-muted hover:bg-panel-raised hover:text-ink disabled:opacity-40"
                    >
                      <DownloadSimple size={16} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {library && !library.rootMismatch && !running ? (
          <form
            className="mt-3 flex gap-2 border-t border-edge pt-3"
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
              placeholder="Save current as…"
              disabled={controlsBusy || recoveryPending}
              className="field min-w-0 flex-1 px-3 py-2 text-[13.5px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <button type="submit" disabled={!canSave} className="btn btn-ghost">
              Save
            </button>
          </form>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2 border-t border-edge pt-3">
          <button
            type="button"
            data-testid="profile-import"
            onClick={onImport}
            disabled={!canImport}
            className="btn btn-ghost"
          >
            <UploadSimple size={15} />
            Import
          </button>
          <button
            type="button"
            onClick={onChangeInstall}
            disabled={controlsBusy || recoveryPending}
            className="btn btn-ghost"
          >
            <FolderOpen size={15} />
            Change install
          </button>
        </div>
      </div>
    </details>
  );
}
