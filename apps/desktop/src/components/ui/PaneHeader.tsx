import type { ReactNode } from "react";

/**
 * The top of every settings pane: one 28px title, one line of lede, and an
 * optional right-hand action. The shell carries no per-tab chrome, so each
 * pane owns its own header.
 */
export function PaneHeader({
  title,
  lede,
  actions,
}: {
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="t-pane">{title}</h1>
        {lede ? <p className="t-meta mt-2 max-w-[62ch]">{lede}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
