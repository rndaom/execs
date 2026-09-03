import { Check, Copy, Play } from "@phosphor-icons/react";
import type { ReactNode } from "react";
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
  menu,
  onLaunch,
}: {
  path: string;
  running: boolean;
  menu: ReactNode;
  onLaunch: () => void;
}) {
  const { feedback, copy } = useCopyFeedback();

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
        <button
          type="button"
          data-testid="launch-tf2"
          onClick={onLaunch}
          className="btn btn-ghost ml-auto shrink-0 gap-1.5 text-[13px]"
        >
          <Play size={13} weight="fill" />
          Launch TF2
        </button>
      )}
    </header>
  );
}
