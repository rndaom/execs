import { Check, Copy } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useCopyFeedback } from "../../hooks/useCopyFeedback";

/** The app chrome: wordmark, profile menu, install path, game-running dot. */
export function ReadyHeader({
  path,
  running,
  menu,
}: {
  path: string;
  running: boolean;
  menu: ReactNode;
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

      <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
        <span className="shrink-0 text-xs text-ink-muted">Install path</span>
        <span className="truncate font-mono text-xs text-ink-muted" title={path}>
          {path}
        </span>
        <button
          type="button"
          data-testid="install-path-copy"
          title={feedback === "copied" ? "Copied" : "Copy install path"}
          aria-label={feedback === "copied" ? "Copied install path" : "Copy install path"}
          onClick={() => void copy(path)}
          className={`flex shrink-0 items-center gap-1.5 rounded-md p-1.5 transition-colors ${
            feedback === "copied"
              ? "text-health"
              : "text-ink-muted hover:bg-panel-raised hover:text-ink"
          }`}
        >
          {feedback === "copied" ? <Check size={15} weight="bold" /> : <Copy size={15} />}
          <span aria-live="polite" className={feedback === "idle" ? "sr-only" : "text-[11px]"}>
            {feedback === "copied" ? "Copied" : feedback === "failed" ? "Copy failed" : ""}
          </span>
        </button>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-ink-muted">
        <span
          className={`size-2 rounded-full ${running ? "bg-team-red" : "bg-ink-faint"}`}
          aria-hidden="true"
        />
        <span className="hidden sm:inline">{running ? "Game running" : "Game closed"}</span>
      </div>
    </header>
  );
}
