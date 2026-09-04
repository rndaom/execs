import type { ReactNode } from "react";
import { useAppStatus } from "../../hooks/useAppStatus";
import type { ProfileLibraryState } from "../../hooks/useProfileLibrary";
import type { SwitchProgressController } from "../../hooks/useSwitchProgress";
import { libraryStatusCopy } from "../../lib/library-ui";
import { SwitchProgressList } from "../SwitchProgressList";
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
  settings,
  onDraftName,
  onSave,
  onCreateNew,
  onChangeInstall,
  onLaunch,
  onCancelLaunch,
}: {
  path: string;
  profiles: ProfileLibraryState;
  progress: SwitchProgressController;
  draftName: string;
  launching: boolean;
  recoveryTargetId: string | null;
  settings?: ReactNode;
  onDraftName: (name: string) => void;
  onSave: () => void;
  onCreateNew: () => void;
  onChangeInstall: () => void;
  onLaunch: () => void;
  onCancelLaunch: () => void;
}) {
  const { error, busy, running } = useAppStatus();
  const controlsBusy = busy || progress.state.active;
  const { library } = profiles;
  const recoveryTarget = library?.profiles.find((profile) => profile.id === recoveryTargetId);

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ReadyHeader
        path={path}
        running={running}
        launching={launching}
        disabled={controlsBusy || recoveryTargetId !== null}
        onLaunch={onLaunch}
        onCancelLaunch={onCancelLaunch}
        menu={
          <ProfileMenu
            library={library}
            draftName={draftName}
            running={running}
            controlsBusy={controlsBusy}
            recoveryTargetId={recoveryTargetId}
            onDraftName={onDraftName}
            onSave={onSave}
            onSwitch={(id) => void profiles.switchProfile(id)}
            onExport={(id) => void profiles.exportProfile(id)}
            onImport={() => void profiles.importProfile()}
            onCreateNew={onCreateNew}
            onChangeInstall={onChangeInstall}
          />
        }
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

      {error ? (
        <div
          role="alert"
          className="t-body shrink-0 border-b border-error/50 bg-error/10 px-5 py-2 text-ink"
        >
          {error}
        </div>
      ) : null}

      <PackPrompt
        delta={running || profiles.packPromptDeferred ? null : profiles.packPrompt}
        busy={busy}
        onChoice={(choice) => void profiles.answerPackPrompt(choice)}
        onDefer={profiles.deferPackPrompt}
      />

      {settings ?? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
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
