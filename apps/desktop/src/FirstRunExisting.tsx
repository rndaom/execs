import { ArrowLeft, ShieldCheck } from "@phosphor-icons/react";
import { OnboardingFrame } from "./components/OnboardingFrame";
import { Alert } from "./components/ui/Alert";
import { PaneSection } from "./components/ui/PaneSection";
import { useAppStatus } from "./hooks/useAppStatus";
import { formatInstallLabel } from "./lib/finder-ui";

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
  const { running, busy, error } = useAppStatus();
  const canSave = !running && !busy && draftName.trim().length > 0;

  return (
    <OnboardingFrame
      eyebrow="Existing setup found"
      icon={<ShieldCheck aria-hidden="true" size={13} weight="bold" />}
      title="Keep what you already built"
      lede="This install already has customization. Save a snapshot of it before execs changes anything."
      testId="first-run-existing"
      footer={
        <div className="flex flex-col-reverse gap-3 border-t border-edge pt-6 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" onClick={onChange} className="btn btn-ghost w-full sm:w-auto">
            <ArrowLeft aria-hidden="true" size={15} weight="bold" />
            Change install
          </button>
          {running ? null : (
            <button
              type="submit"
              form="first-run-save-form"
              disabled={!canSave}
              className="btn btn-primary w-full sm:w-auto"
            >
              Save this setup
            </button>
          )}
        </div>
      }
    >
      <form
        id="first-run-save-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <label htmlFor="first-run-profile-name" className="t-row block">
          Profile name
        </label>
        <p className="t-meta mt-1">A name you will recognise in the switcher later.</p>
        <input
          id="first-run-profile-name"
          value={draftName}
          onChange={(event) => onDraftName(event.target.value)}
          placeholder="My current setup"
          disabled={busy || running}
          autoComplete="off"
          className="field mt-3 w-full px-4 py-3 text-ink placeholder:text-ink-faint focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
      </form>

      <PaneSection
        id="first-run-detail"
        title="What gets saved"
        description={
          running
            ? "TF2 is open, so nothing can be written yet. Close the game to save."
            : "Your cfg layer, config.cfg, everything in tf/custom, and the launch string. The live files are copied, not moved."
        }
        meta={
          <span className="font-mono" title={path}>
            {formatInstallLabel(path)}
          </span>
        }
      >
        {reasons.length > 0 ? (
          <ul data-testid="first-run-reasons" className="mt-4 grid gap-x-10 sm:grid-cols-2">
            {reasons.map((reason) => (
              <li key={reason} className="t-meta border-b border-edge py-2.5">
                {reason}
              </li>
            ))}
          </ul>
        ) : null}
      </PaneSection>

      {error ? (
        <Alert tone="error" className="mt-6">
          {error}
        </Alert>
      ) : null}
    </OnboardingFrame>
  );
}
