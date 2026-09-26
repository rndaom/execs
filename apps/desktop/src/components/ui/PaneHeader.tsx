import { type ReactNode, useContext } from "react";
import { PANE_ICONS, PaneIdentity } from "./paneIdentity";

/**
 * The top of every settings pane: the workspace icon, one title, optional
 * context that explains behavior, and an optional right-hand action. The
 * shell carries no per-tab chrome, so each pane owns its own header.
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
  const pane = useContext(PaneIdentity);
  const Icon = pane ? PANE_ICONS[pane] : null;
  return (
    <header className={`pane-header${compact ? " pane-header-compact" : ""}`}>
      <div className="pane-title-row min-w-0">
        {Icon ? (
          <span aria-hidden="true" className="pane-glyph">
            <Icon size={21} weight="duotone" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h1 className="t-pane" data-pane-heading tabIndex={-1}>
            {title}
          </h1>
          {lede ? <p className="t-meta mt-0.5 max-w-[62ch]">{lede}</p> : null}
        </div>
      </div>
      {actions ? <div className="pane-actions">{actions}</div> : null}
    </header>
  );
}
