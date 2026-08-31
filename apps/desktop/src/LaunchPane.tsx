import { Check, CheckCircle, Copy, FloppyDisk } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import {
  COPY_FEEDBACK_MS,
  type CopyFeedback,
  copyButtonLabel,
  copyToClipboard,
} from "./lib/copy-ui";
import { canEditLaunch, type SteamWriteStatus, steamWriteCopy } from "./lib/launch-ui";

export function LaunchPane({
  running,
  busy,
  value,
  steamWrite,
  onChange,
  onSave,
}: {
  running: boolean;
  busy: boolean;
  value: string;
  steamWrite?: SteamWriteStatus | null;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const canEdit = canEditLaunch(running, busy);
  const status = steamWrite ? steamWriteCopy(steamWrite) : "";
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>("idle");
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) {
        window.clearTimeout(copyTimer.current);
      }
    };
  }, []);

  async function onCopy() {
    const feedback = await copyToClipboard(value);
    setCopyFeedback(feedback);
    if (copyTimer.current !== null) {
      window.clearTimeout(copyTimer.current);
    }
    copyTimer.current = window.setTimeout(() => {
      setCopyFeedback("idle");
      copyTimer.current = null;
    }, COPY_FEEDBACK_MS);
  }

  return (
    <div data-testid="settings-launch" className="min-w-0 text-left">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section>
          <div className="flex items-center justify-between gap-4">
            <label className="text-sm font-semibold text-ink" htmlFor="launch-options">
              Profile launch string
            </label>
            <span className="text-[11px] text-ink-faint">Stored with this profile</span>
          </div>
          <textarea
            id="launch-options"
            data-testid="launch-options"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={!canEdit}
            rows={8}
            spellCheck={false}
            className="surface mt-3 min-h-48 w-full resize-y bg-bg px-5 py-4 font-mono text-sm leading-7 text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none disabled:opacity-40"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p
              data-testid="launch-steam-status"
              aria-live="polite"
              className="flex items-center gap-2 text-xs text-ink-muted"
            >
              {status ? <CheckCircle size={15} className="text-health" weight="fill" /> : null}
              {status || "Save after editing, then copy the same string into Steam if needed."}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="launch-copy"
                onClick={() => void onCopy()}
                className={`btn btn-ghost ${copyFeedback === "copied" ? "border-health/60 text-health" : ""}`}
              >
                {copyFeedback === "copied" ? <Check size={15} weight="bold" /> : <Copy size={15} />}
                <span aria-live="polite">{copyButtonLabel(copyFeedback)}</span>
              </button>
              <button
                type="button"
                data-testid="launch-save"
                disabled={!canEdit}
                onClick={onSave}
                className="btn btn-primary"
              >
                <FloppyDisk size={15} weight="bold" />
                Save
              </button>
            </div>
          </div>
        </section>

        <aside className="h-fit lg:border-l lg:border-edge/60 lg:pl-8">
          <h2 className="text-sm font-semibold text-ink">How it applies</h2>
          <p className="mt-2 text-[13px] leading-6 text-ink-muted">
            execs keeps this string with the active profile. Steam is updated only while Steam is
            already closed; otherwise the string stays ready to copy.
          </p>
          <p className="mt-3 text-xs leading-5 text-ink-faint">
            Temporary reset flags such as <code className="text-ink-muted">-autoconfig</code>,{" "}
            <code className="text-ink-muted">-default</code>, and{" "}
            <code className="text-ink-muted">+quit</code> are never stored on a profile.
          </p>
        </aside>
      </div>
    </div>
  );
}
