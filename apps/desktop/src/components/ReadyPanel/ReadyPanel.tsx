import { type ReactNode, useRef, useState } from "react";
import { useAppStatus } from "../../hooks/useAppStatus";
import type { ProfileLibraryState } from "../../hooks/useProfileLibrary";
import type { SwitchProgressController } from "../../hooks/useSwitchProgress";
import type { ProfileExportReview } from "../../lib/bridge";
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
  onInspectExport: (id: string) => Promise<ProfileExportReview>;
}) {
  const { error, dismissError, busy, running } = useAppStatus();
  const [profileMenuRequest, setProfileMenuRequest] = useState(0);
  const [exportTargetId, setExportTargetId] = useState<string | null>(null);
  const [exportReview, setExportReview] = useState<ProfileExportReview | null>(null);
  const [exportReviewError, setExportReviewError] = useState<string | null>(null);
  const exportReviewVersion = useRef(0);
  const closeExport = () => {
    exportReviewVersion.current += 1;
    setExportTargetId(null);
  };
  const reviewExport = (id: string) => {
    const version = ++exportReviewVersion.current;
    setExportTargetId(id);
    setExportReview(null);
    setExportReviewError(null);
    void onInspectExport(id)
      .then((review) => {
        if (version === exportReviewVersion.current) setExportReview(review);
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
  const visibleExportPacks = exportReview?.customPacks.slice(0, 50) ?? [];
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
        <p className="t-body mt-3 text-ink-muted">
          The ZIP also copies the custom packs listed below. Export does not verify permission to
          share their contents. Check the creators’ terms and Valve’s TF2 mod guidance before
          sending the ZIP to someone else.
        </p>
        {exportReview === null && !exportReviewError ? (
          <p className="t-meta mt-4" role="status">
            Checking this profile’s files…
          </p>
        ) : null}
        {exportReviewError ? (
          <p className="t-meta mt-4 text-error" role="alert">
            {exportReviewError}
          </p>
        ) : null}
        {exportReview && exportReview.credentialLocations.length > 0 ? (
          <div className="mt-4 rounded border border-warn/50 bg-warn/10 p-3">
            <p className="t-meta text-ink">Possible saved credentials:</p>
            <ul className="t-meta mt-2 list-disc space-y-1 pl-5 text-ink-muted">
              {exportReview.credentialLocations.map((location) => (
                <li key={location} className="break-all">
                  {location}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {exportReview ? (
          <div className="mt-4 rounded border border-edge p-3">
            <p className="t-meta text-ink">
              Custom packs in this ZIP: {exportReview.customPacks.length}
            </p>
            {visibleExportPacks.length > 0 ? (
              <ul className="t-meta mt-2 list-disc space-y-2 pl-5 text-ink-muted">
                {visibleExportPacks.map((pack) => (
                  <li key={pack.path}>
                    <span className="break-all text-ink">{pack.path}</span> ({pack.fileCount}{" "}
                    {pack.fileCount === 1 ? "file" : "files"})
                    {pack.kind === "crosshairScripts" ? (
                      <span className="block">
                        Weapon scripts in this pack may be modified copies of installed TF2 files.
                      </span>
                    ) : null}
                    {pack.kind === "viewmodels" ? (
                      <span className="block">
                        This pack may contain TF2-derived models and another creator’s animations.
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="t-meta mt-2 text-ink-muted">No custom packs are included.</p>
            )}
            {exportReview.customPacks.length > visibleExportPacks.length ? (
              <p className="t-meta mt-2 text-ink-muted">
                {exportReview.customPacks.length - visibleExportPacks.length} more packs are
                included but omitted from this list. Review the full ZIP before sharing it.
              </p>
            ) : null}
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
            disabled={exportReview === null}
            onClick={() => {
              const id = exportTargetId;
              closeExport();
              if (id && exportReview) void profiles.exportProfile(id, exportReview.revision);
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
          profiles.switchHandoff !== null ||
          profiles.packPromptDeferred
            ? null
            : profiles.packPrompt
        }
        busy={busy}
        onChoice={(choice) => void profiles.answerPackPrompt(choice)}
        onDefer={profiles.deferPackPrompt}
      />

      <Modal
        open={profiles.switchHandoff !== null}
        role="alertdialog"
        testId="switch-handoff-prompt"
        title={
          profiles.switchHandoff?.kind === "kept"
            ? "Capture kept packs before switching"
            : "Save the retained setup before switching"
        }
        description={profiles.switchHandoff?.message ?? ""}
        onClose={profiles.dismissSwitchHandoff}
      >
        <p className="t-body text-ink-muted">
          {profiles.switchHandoff?.kind === "kept"
            ? "Capture copies these installed packs into the current profile. Choose the target profile again after the copy finishes."
            : "The deleted profile no longer owns the installed files. Save current as… in Profiles to keep a copy, then choose the target profile."}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {profiles.switchHandoff?.kind === "kept" ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || running}
              onClick={() => void profiles.captureKeptPacks()}
            >
              Capture kept packs
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                profiles.dismissSwitchHandoff();
                setProfileMenuRequest((request) => request + 1);
              }}
            >
              Open profiles
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={profiles.dismissSwitchHandoff}>
            Cancel
          </button>
        </div>
      </Modal>

      <Modal
        open={profiles.retiredCasualReview !== null}
        role="alertdialog"
        testId="retired-casual-review"
        title="Review saved Casual choices"
        description={`${profiles.retiredCasualReview?.name ?? "This profile"} uses a mod library that is no longer downloaded because its asset rights are unresolved.`}
        onClose={() => {
          if (!profiles.retiredCasualInFlight) profiles.cancelRetiredCasualReview();
        }}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        {profiles.retiredCasualInFlight ? (
          <p className="t-body text-ink-muted" role="status">
            Removing the reviewed choices from this profile. Please wait for the switch result.
          </p>
        ) : (
          <p className="t-body text-ink-muted">
            The verified library cache is unavailable on this device. Removing the choices below
            changes this profile’s saved selection; Cancel keeps it exactly as it is. You can also
            restore the original cache and choose the profile again.
          </p>
        )}
        {profiles.retiredCasualReview?.addonsToRemove.length ? (
          <div className="mt-4">
            <p className="t-row">Addons to remove</p>
            <ul className="t-meta mt-2 list-disc pl-5">
              {profiles.retiredCasualReview.addonsToRemove.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {profiles.retiredCasualReview?.particleModsToRemove.length ? (
          <div className="mt-4">
            <p className="t-row">Particle collections to remove</p>
            <ul className="t-meta mt-2 list-disc pl-5">
              {profiles.retiredCasualReview.particleModsToRemove.map((name) => (
                <li key={name}>{name.replace(/_/g, " ")}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="t-meta mt-4">
          Direct-author addons ({profiles.retiredCasualReview?.directAddonsKept.length ?? 0}),
          particles from this profile’s installed mods (
          {profiles.retiredCasualReview?.profileParticleModsKept.length ?? 0}), and the profile’s
          other files stay saved. After this library-only change, execs will try switching to the
          profile again.
        </p>
        {profiles.retiredCasualReview?.error ? (
          <p className="t-meta mt-3 text-error" role="alert">
            {profiles.retiredCasualReview.error}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={profiles.retiredCasualInFlight}
            onClick={profiles.cancelRetiredCasualReview}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={controlsBusy || running || profiles.retiredCasualInFlight}
            onClick={() => void profiles.confirmRetiredCasualReview()}
          >
            {profiles.retiredCasualInFlight
              ? "Removing saved choices…"
              : "Remove saved choices and switch"}
          </button>
        </div>
      </Modal>

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
