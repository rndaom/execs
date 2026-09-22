import type { ReactNode } from "react";

/**
 * The top of every settings pane: one title, optional context that explains
 * behavior, and an optional right-hand action. The shell carries no per-tab chrome, so each
 * pane owns its own header.
 */
export function PaneHeader({
  title,
  lede,
  actions,
  compact = false,
}: {
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
  /** Catalog/task strips can sit directly beneath a more compact heading. */
  compact?: boolean;
}) {
  return (
    <header className={`pane-header${compact ? " pane-header-compact" : ""}`}>
      <div className="min-w-0">
        <h1 className="t-pane" data-pane-heading tabIndex={-1}>
          {title}
        </h1>
        {lede ? <p className="t-meta mt-1.5 max-w-[62ch]">{lede}</p> : null}
      </div>
      {actions ? <div className="pane-actions">{actions}</div> : null}
    </header>
  );
}
