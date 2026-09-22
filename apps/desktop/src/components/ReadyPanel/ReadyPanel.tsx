import { type ReactNode, useRef, useState } from "react";
import { useAppStatus } from "../../hooks/useAppStatus";
import type { ProfileLibraryState } from "../../hooks/useProfileLibrary";
import type { SwitchProgressController } from "../../hooks/useSwitchProgress";
import { libraryStatusCopy } from "../../lib/library-ui";
import { ProfileDeleteDialog } from "../ProfileDeleteDialog";
import { ProfileImportDialog } from "../ProfileImportDialog";
import { SwitchProgressList } from "../SwitchProgressList";
import { Modal } from "../ui/Modal";
import { OperationError } from "../ui/OperationError";
import { FolderRepair } from "./FolderRepair";
import { PackPrompt } from "./PackPrompt";
import { ProfileMenu } from "./ProfileMenu";
import { ReadyHeader } from "./ReadyHeader";

/** The main surface once a profile exists: chrome, prompts and the settings host. */
export function ReadyPanel({
  path,
  profiles,
  progress,
  draftName,
  launching,
  recoveryTargetId,
  launchBlockReason,
  launchBlockAction,
  onLaunchBlocked,
  settings,
  onDraftName,
  onSave,
  onCreateNew,
  onChangeInstall,
  onLaunch,
  onCancelLaunch,
  onReviewFiles,
  onInspectExport,
}: {
  path: string;
  profiles: ProfileLibraryState;
  progress: SwitchProgressController;
  draftName: string;
  launching: boolean;
  recoveryTargetId: string | null;
  launchBlockReason?: string | null;
  launchBlockAction?: string;
  onLaunchBlocked?: () => void;
  settings?: ReactNode;
  onDraftName: (name: string) => void;
  onSave: () => void;
  onCreateNew: () => void;
  onChangeInstall: () => void;
  onLaunch: () => void;
  onCancelLaunch: () => void;
  onReviewFiles: () => void;
  onInspectExport: (id: string) => Promise<string[]>;
}) {
  const { error, dismissError, busy, running } = useAppStatus();
  const [profileMenuRequest, setProfileMenuRequest] = useState(0);
  const [exportTargetId, setExportTargetId] = useState<string | null>(null);
  const [exportLocations, setExportLocations] = useState<string[] | null>(null);
  const [exportReviewError, setExportReviewError] = useState<string | null>(null);
  const exportReviewVersion = useRef(0);
  const closeExport = () => {
    exportReviewVersion.current += 1;
    setExportTargetId(null);
  };
  const reviewExport = (id: string) => {
    const version = ++exportReviewVersion.current;
    setExportTargetId(id);
    setExportLocations(null);
    setExportReviewError(null);
    void onInspectExport(id)
      .then((locations) => {
        if (version === exportReviewVersion.current) setExportLocations(locations);
      })
      .catch((error: unknown) => {
        if (version === exportReviewVersion.current) {
          setExportReviewError(
            error instanceof Error ? error.message : "Could not review this profile.",
          );
        }
      });
  };
  const controlsBusy = busy || progress.state.active;
  const { library } = profiles;
  const hasInactiveLibrary =
    library?.initialized &&
    library.usable &&
    !library.rootMismatch &&
    !library.activeProfileId &&
    !library.pendingSwitchProfileId &&
    recoveryTargetId === null &&
    library.profiles.length > 0;
  const recoveryTarget = library?.profiles.find((profile) => profile.id === recoveryTargetId);
  const unsafeActive = library?.profiles.find(
    (profile) =>
      profile.id === library.activeProfileId && (profile.unsafeCustomFolders?.length ?? 0) > 0,
  );

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ReadyHeader
        path={path}
        running={running}
        launching={launching}
        disabled={
          controlsBusy ||
          !!launchBlockReason ||
          recoveryTargetId !== null ||
          unsafeActive !== undefined
        }
        blockedReason={
          launchBlockReason ??
          (controlsBusy
            ? "Wait for the current operation to finish."
            : recoveryTargetId
              ? "Finish the interrupted profile switch before launching TF2."
              : unsafeActive
                ? "Repair this profile's custom folder names before launching TF2."
                : undefined)
        }
        blockedAction={launchBlockAction}
        onBlocked={onLaunchBlocked}
        onLaunch={onLaunch}
        onCancelLaunch={onCancelLaunch}
        menu={
          <ProfileMenu
            library={library}
            draftName={draftName}
            running={running}
            controlsBusy={controlsBusy}
            openRequest={profileMenuRequest}
            recoveryTargetId={recoveryTargetId}
            onDraftName={onDraftName}
            onSave={onSave}
            onSwitch={(id) => void profiles.switchProfile(id)}
            onExport={reviewExport}
            onDelete={profiles.reviewDelete}
            onImport={() => void profiles.importProfile()}
            onRepair={(id) => void profiles.reviewFolderRepair(id)}
            onCreateNew={onCreateNew}
            onChangeInstall={onChangeInstall}
          />
        }
      />

      {unsafeActive ? (
        <div
          role="alert"
          className="t-body flex items-center justify-between gap-4 border-b border-warn/50 bg-warn/10 px-5 py-2 text-ink"
        >
          <span>
            TF2 cannot mount this profile’s custom folders:{" "}
            {unsafeActive.unsafeCustomFolders?.join(", ")}.
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={controlsBusy || running || recoveryTargetId !== null}
            onClick={() => void profiles.reviewFolderRepair(unsafeActive.id)}
          >
            Repair folder names
          </button>
        </div>
      ) : null}
      <FolderRepair
        review={profiles.folderRepair}
        busy={controlsBusy || running}
        error={profiles.folderRepair?.error ?? null}
        onRepair={() => void profiles.repairFolders()}
        onCancel={profiles.cancelFolderRepair}
      />

      {recoveryTargetId ? (
        <div
          role="alert"
          data-testid="switch-recovery-pending"
          className="t-body shrink-0 border-b border-warn/50 bg-warn/10 px-5 py-2 text-ink"
        >
          A profile switch was interrupted. Switch to{" "}
          {recoveryTarget?.name ?? "the pending profile"} to finish recovery.
        </div>
      ) : null}

      <OperationError message={error} onDismiss={dismissError} />

      {profiles.importError ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-3 border-b border-error/50 bg-error/10 px-5 py-2 text-ink"
        >
          <p className="t-body flex-1">{profiles.importError}</p>
          <button type="button" className="btn btn-ghost" onClick={profiles.dismissImport}>
            Dismiss
          </button>
        </div>
      ) : null}

      <ProfileImportDialog profiles={profiles} running={running} />
      <ProfileDeleteDialog
        profiles={{
          ...profiles,
          exportProfile: async (id) => reviewExport(id),
        }}
        running={running}
        busy={controlsBusy}
      />

      <Modal
        open={exportTargetId !== null}
        title="Export profile"
        description="Review this profile before choosing a ZIP destination."
        onClose={closeExport}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <p className="t-body text-ink-muted">
          The ZIP includes this profile’s cfg files and launch options exactly as saved. These may
          contain server passwords or remote-console settings. Review them before sharing the ZIP.
        </p>
        {exportLocations === null && !exportReviewError ? (
          <p className="t-meta mt-4" role="status">
            Checking this profile’s cfg files…
          </p>
        ) : null}
        {exportReviewError ? (
          <p className="t-meta mt-4 text-error" role="alert">
            {exportReviewError}
          </p>
        ) : null}
        {exportLocations && exportLocations.length > 0 ? (
          <div className="mt-4 rounded border border-warn/50 bg-warn/10 p-3">
            <p className="t-meta text-ink">Possible saved credentials:</p>
            <ul className="t-meta mt-2 list-disc space-y-1 pl-5 text-ink-muted">
              {exportLocations.map((location) => (
                <li key={location} className="break-all">
                  {location}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={closeExport}>
            Cancel
          </button>
          {library?.activeProfileId === exportTargetId ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                closeExport();
                if (profiles.deleteTarget) profiles.cancelDelete();
                onReviewFiles();
              }}
            >
              Review Files
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-primary"
            disabled={exportLocations === null}
            onClick={() => {
              const id = exportTargetId;
              closeExport();
              if (id) void profiles.exportProfile(id);
            }}
          >
            Export ZIP…
          </button>
        </div>
      </Modal>

      <PackPrompt
        delta={
          running ||
          profiles.importing ||
          profiles.importStage === "done" ||
          profiles.packPromptDeferred
            ? null
            : profiles.packPrompt
        }
        busy={busy}
        onChoice={(choice) => void profiles.answerPackPrompt(choice)}
        onDefer={profiles.deferPackPrompt}
      />

      {settings ?? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          {hasInactiveLibrary ? (
            <>
              <p className="eyebrow">No active profile</p>
              <h1 className="t-pane mt-3">Choose a profile</h1>
              <p className="t-body mt-3 max-w-md text-ink-muted">
                {running
                  ? "Close TF2 before switching to a saved profile."
                  : "Switching profiles replaces your installed TF2 setup."}
              </p>
              <button
                type="button"
                onClick={() => setProfileMenuRequest((request) => request + 1)}
                disabled={controlsBusy}
                className="btn btn-primary mt-6"
              >
                Choose profile
              </button>
            </>
          ) : (
            <>
              <p className="eyebrow">Profile library</p>
              <p className="t-body mt-3 max-w-md text-ink-muted">
                {library ? libraryStatusCopy(library) : "Loading profiles…"}
              </p>
              <button
                type="button"
                onClick={onChangeInstall}
                disabled={controlsBusy}
                className="btn btn-ghost mt-5"
              >
                Change install
              </button>
            </>
          )}
        </div>
      )}

      <SwitchProgressList
        switchStep={progress.state.visibleStep}
        active={progress.state.active}
        visible={progress.state.visible}
        detail={progress.state.completionDetail}
      />
    </section>
  );
}
