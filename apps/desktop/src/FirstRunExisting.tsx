import { FolderOpen } from "@phosphor-icons/react";
import { OnboardingFrame } from "./components/OnboardingFrame";
import { OperationError } from "./components/ui/OperationError";
import { useAppStatus } from "./hooks/useAppStatus";

/**
 * First launch on an install that already has customization: Save current as…
 * only — no Import, no comfig install. Shares the onboarding frame
 * with the finder and the wizard.
 */
export function FirstRunExisting({
  path,
  draftName,
  reasons,
  onDraftName,
  onSave,
  onChange,
}: {
  path: string;
  draftName: string;
  reasons: string[];
  onDraftName: (name: string) => void;
  onSave: () => void;
  onChange: () => void;
}) {
  const { running, busy, error, dismissError } = useAppStatus();
  const canSave = !running && !busy && draftName.trim().length > 0;

  return (
    <OnboardingFrame
      title="Keep your current setup"
      width="wide"
      testId="first-run-existing"
      steps={[
        { label: "Find TF2", state: "complete" },
        { label: "Confirm folder", state: "complete" },
        { label: "Save current", state: "current" },
      ]}
    >
      <form
        id="first-run-save-form"
        className="surface px-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) onSave();
        }}
      >
        <div className="grid items-center gap-3 border-b border-edge py-4 sm:grid-cols-[160px_minmax(0,1fr)]">
          <p className="t-row">Team Fortress 2 location</p>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <p className="t-meta min-w-0 flex-1 break-all">{path}</p>
            <button
              type="button"
              onClick={onChange}
              disabled={busy}
              className="btn btn-ghost shrink-0"
            >
              <FolderOpen aria-hidden="true" size={15} />
              Change install
            </button>
          </div>
        </div>

        <div className="grid gap-3 border-b border-edge py-4 sm:grid-cols-[160px_minmax(0,1fr)]">
          <p className="t-row">Existing customization</p>
          <div className="min-w-0">
            {reasons.length > 0 ? (
              <ul
                data-testid="first-run-reasons"
                className="t-meta grid gap-x-6 gap-y-1 sm:grid-cols-2"
              >
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
            <p className={`t-meta ${reasons.length > 0 ? "mt-2" : ""}`}>
              Your cfg layer, config.cfg, custom content and launch options are copied, not moved.
            </p>
          </div>
        </div>

        <div className="grid items-start gap-3 py-4 sm:grid-cols-[160px_minmax(0,1fr)]">
          <label htmlFor="first-run-profile-name" className="t-row sm:pt-2.5">
            Profile name
          </label>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <input
                id="first-run-profile-name"
                value={draftName}
                onChange={(event) => onDraftName(event.target.value)}
                placeholder="My current setup"
                disabled={busy || running}
                autoComplete="off"
                className="input min-w-[160px] flex-1"
              />
              <button type="submit" disabled={!canSave} className="btn btn-primary">
                Save current setup
              </button>
            </div>
            <p className="t-meta mt-2">
              {running
                ? "Close TF2 to save your current setup."
                : "The saved profile keeps these files as they are."}
            </p>
          </div>
        </div>
      </form>
      <OperationError message={error} onDismiss={dismissError} className="mt-4" />
    </OnboardingFrame>
  );
}
