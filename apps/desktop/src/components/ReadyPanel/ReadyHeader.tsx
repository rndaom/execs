import { Check, Copy, Play } from "@phosphor-icons/react";
import { type ReactNode, useId } from "react";
import { useCopyFeedback } from "../../hooks/useCopyFeedback";
import { formatInstallLabel } from "../../lib/finder-ui";

/**
 * The app chrome: wordmark, profile switcher, install folder, and either a
 * Launch TF2 button or the game-running dot.
 *
 * The path collapses to its folder name — the full path stays in the `title`
 * and in the copy button — so the chrome stops being a wall of monospace.
 */
export function ReadyHeader({
  path,
  running,
  launching,
  disabled,
  blockedReason,
  blockedAction,
  onBlocked,
  menu,
  onLaunch,
  onCancelLaunch,
}: {
  path: string;
  running: boolean;
  launching: boolean;
  disabled: boolean;
  blockedReason?: string | null;
  blockedAction?: string;
  onBlocked?: () => void;
  menu: ReactNode;
  onLaunch: () => void;
  onCancelLaunch: () => void;
}) {
  const { feedback, copy } = useCopyFeedback();
  const reasonId = useId();

  return (
    <header className="relative z-40 flex min-h-14 shrink-0 items-center gap-4 border-b border-edge bg-panel px-4 sm:px-6">
      <div className="mr-1 flex shrink-0 items-center gap-2">
        <span aria-hidden="true" className="size-2 rounded-sm bg-brand" />
        <span className="text-[15px] font-semibold tracking-tight text-ink">execs</span>
      </div>

      {menu}

      <div className="mx-1 hidden h-7 w-px bg-edge md:block" />

      <div className="hidden min-w-0 items-center gap-1.5 md:flex">
        <span className="t-meta truncate" title={path}>
          {formatInstallLabel(path)}
        </span>
        <button
          type="button"
          data-testid="install-path-copy"
          title={feedback === "copied" ? "Copied" : `Copy install path — ${path}`}
          aria-label={feedback === "copied" ? "Copied install path" : "Copy install path"}
          onClick={() => void copy(path)}
          className={`flex shrink-0 items-center gap-1.5 rounded-md p-1.5 transition-colors duration-150 ${
            feedback === "copied"
              ? "text-ok"
              : "text-ink-faint hover:bg-panel-raised hover:text-ink"
          }`}
        >
          {feedback === "copied" ? <Check size={14} weight="bold" /> : <Copy size={14} />}
          <span aria-live="polite" className={feedback === "idle" ? "sr-only" : "text-[11px]"}>
            {feedback === "copied" ? "Copied" : feedback === "failed" ? "Copy failed" : ""}
          </span>
        </button>
      </div>

      {running ? (
        <div className="t-meta ml-auto flex shrink-0 items-center gap-2">
          <span className="size-2 rounded-full bg-warn" aria-hidden="true" />
          <span className="hidden sm:inline">Game running</span>
        </div>
      ) : (
        <div className="ml-auto flex max-w-md flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            data-testid="launch-tf2"
            onClick={launching ? onCancelLaunch : onLaunch}
            disabled={launching ? false : disabled}
            aria-describedby={!launching && disabled && blockedReason ? reasonId : undefined}
            className="btn btn-ghost shrink-0 gap-1.5 text-[13px]"
            title={
              launching
                ? "Cancel only after cancelling the launch and closing Steam"
                : (blockedReason ?? undefined)
            }
          >
            <Play size={13} weight="fill" />
            {launching ? "Cancel launch wait" : "Launch TF2"}
          </button>
          {!launching && disabled && blockedReason ? (
            <>
              {onBlocked && blockedAction ? (
                <button type="button" className="btn btn-ghost" onClick={onBlocked}>
                  {blockedAction}
                </button>
              ) : null}
              <p id={reasonId} role="status" className="t-meta w-full pb-1 text-right">
                {blockedReason}
              </p>
            </>
          ) : null}
        </div>
      )}
    </header>
  );
}
