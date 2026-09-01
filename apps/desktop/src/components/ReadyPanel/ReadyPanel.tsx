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
  inheritBinds,
  settings,
  onDraftName,
  onSave,
  onCreateNew,
  onToggleInherit,
  onChangeInstall,
}: {
  path: string;
  profiles: ProfileLibraryState;
  progress: SwitchProgressController;
  draftName: string;
  inheritBinds: boolean;
  settings?: ReactNode;
  onDraftName: (name: string) => void;
  onSave: () => void;
  onCreateNew: () => void;
  onToggleInherit: (next: boolean) => void;
  onChangeInstall: () => void;
}) {
  const { error, busy, running } = useAppStatus();
  const controlsBusy = busy || progress.state.active;
  const { library } = profiles;

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ReadyHeader
        path={path}
        running={running}
        menu={
          <ProfileMenu
            library={library}
            draftName={draftName}
            running={running}
            controlsBusy={controlsBusy}
            inheritBinds={inheritBinds}
            onDraftName={onDraftName}
            onSave={onSave}
            onSwitch={(id) => void profiles.switchProfile(id)}
            onExport={(id) => void profiles.exportProfile(id)}
            onImport={() => void profiles.importProfile()}
            onCreateNew={onCreateNew}
            onToggleInherit={onToggleInherit}
            onChangeInstall={onChangeInstall}
          />
        }
      />

      {error ? (
        <div
          role="alert"
          className="shrink-0 border-b border-team-red/50 bg-team-red/10 px-5 py-2 text-sm text-ink"
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
          <p className="mt-2 max-w-md text-sm text-ink-muted">
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
      />
    </section>
  );
}
