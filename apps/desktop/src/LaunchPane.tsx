import { Check, CheckCircle, Copy, WarningCircle } from "@phosphor-icons/react";
import { Alert } from "./components/ui/Alert";
import { PaneHeader } from "./components/ui/PaneHeader";
import { useAppStatus } from "./hooks/useAppStatus";
import { useAutosave } from "./hooks/useAutosave";
import { useCopyFeedback } from "./hooks/useCopyFeedback";
import { copyButtonLabel } from "./lib/copy-ui";
import {
  forbiddenLaunchNotice,
  forbiddenLaunchTokens,
  type SteamWriteStatus,
  steamWriteCopy,
  strippedLaunchNotice,
  strippedLaunchTokens,
} from "./lib/launch-ui";

export function LaunchPane({
  value,
  saved,
  steamWrite,
  lastSave,
  onChange,
  onSave,
}: {
  value: string;
  /** What the profile holds; the field is a draft of it. */
  saved: string;
  steamWrite?: SteamWriteStatus | null;
  /** What was sent to the backend last save and what came back. */
  lastSave?: { sent: string; saved: string } | null;
  onChange: (value: string) => void;
  /** Resolves when the write settles; the toast reports it. */
  onSave: () => Promise<unknown>;
}) {
  const { running } = useAppStatus();
  const status = steamWrite ? steamWriteCopy(steamWrite) : "";
  const { feedback, copy } = useCopyFeedback();
  // Typing is a draft: the lock defers the write, it does not lock the field.
  const { flush } = useAutosave({
    dirty: value !== saved,
    locked: running,
    token: value,
    save: onSave,
  });

  // The backend strips these on save; flagging them as you type means the
  // textarea never silently changes under the user.
  const forbidden = forbiddenLaunchTokens(value);
  const stripped = lastSave ? strippedLaunchTokens(lastSave.sent, lastSave.saved) : [];

  return (
    <div data-testid="settings-launch" className="min-w-0 text-left">
      <PaneHeader
        title="Launch options"
        lede="Stored with this profile; Steam updates only while closed."
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <section>
          <label className="t-row block" htmlFor="launch-options">
            Launch string
          </label>
          <textarea
            id="launch-options"
            data-testid="launch-options"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onBlur={flush}
            aria-describedby={forbidden.length > 0 ? "launch-forbidden" : undefined}
            rows={8}
            spellCheck={false}
            className={`surface mt-3 min-h-48 w-full resize-y bg-bg px-5 py-4 font-mono text-[13.5px] leading-7 text-ink placeholder:text-ink-faint focus:outline-none ${
              forbidden.length > 0 ? "border-warn/70" : ""
            }`}
          />

          {forbidden.length > 0 ? (
            <Alert tone="warn" testId="launch-forbidden" className="mt-3">
              <span className="flex items-start gap-2">
                <WarningCircle
                  aria-hidden="true"
                  size={16}
                  weight="fill"
                  className="mt-0.5 shrink-0"
                />
                <span id="launch-forbidden">{forbiddenLaunchNotice(forbidden)}</span>
              </span>
            </Alert>
          ) : null}

          {stripped.length > 0 ? (
            <Alert tone="info" testId="launch-stripped" className="mt-3">
              {strippedLaunchNotice(stripped)}
            </Alert>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p
              data-testid="launch-steam-status"
              aria-live="polite"
              className="t-meta flex items-center gap-2"
            >
              {status ? <CheckCircle size={15} className="text-ok" weight="fill" /> : null}
              {status || "Copy into Steam if it is open while you edit this."}
            </p>
            <button
              type="button"
              data-testid="launch-copy"
              onClick={() => void copy(value)}
              className={`btn btn-ghost ${feedback === "copied" ? "border-ok/60 text-ok" : ""}`}
            >
              {feedback === "copied" ? <Check size={15} weight="bold" /> : <Copy size={15} />}
              <span aria-live="polite">{copyButtonLabel(feedback)}</span>
            </button>
          </div>
        </section>

        <aside className="h-fit lg:border-l lg:border-edge lg:pl-8">
          <h2 className="t-section">Never stored</h2>
          <p className="t-meta mt-2">
            Reset and wrapper flags: <code className="text-ink-muted">-autoconfig</code>,{" "}
            <code className="text-ink-muted">-default</code>,{" "}
            <code className="text-ink-muted">-dxlevel</code>,{" "}
            <code className="text-ink-muted">+quit</code>,{" "}
            <code className="text-ink-muted">gamemoderun %command%</code>.
          </p>
        </aside>
      </div>
    </div>
  );
}
