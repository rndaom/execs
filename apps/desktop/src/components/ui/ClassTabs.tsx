import type { ReactNode } from "react";

export type TabItem<Id extends string> = {
  id: Id;
  label: ReactNode;
  /** Small count/badge shown after the label. */
  meta?: ReactNode;
};

/**
 * Underlined tab strip with a roving tabindex (only the selected tab is in the
 * tab order; Arrow/Home/End move between them), per the WAI-ARIA tabs pattern.
 *
 * Exported for the content panes to adopt — the Comfig module groups and the
 * per-class crosshair/viewmodel strips are the same widget.
 */
export function ClassTabs<Id extends string>({
  tabs,
  selected,
  label,
  idPrefix,
  panelId,
  onSelect,
}: {
  tabs: TabItem<Id>[];
  selected: Id;
  label: string;
  idPrefix: string;
  panelId?: string;
  onSelect: (id: Id) => void;
}) {
  function move(from: number, key: string) {
    let next: number | null = null;
    if (key === "ArrowRight" || key === "ArrowDown") {
      next = (from + 1) % tabs.length;
    } else if (key === "ArrowLeft" || key === "ArrowUp") {
      next = (from - 1 + tabs.length) % tabs.length;
    } else if (key === "Home") {
      next = 0;
    } else if (key === "End") {
      next = tabs.length - 1;
    }
    if (next === null) {
      return false;
    }
    const target = tabs[next];
    onSelect(target.id);
    requestAnimationFrame(() => {
      document.getElementById(`${idPrefix}-${target.id}`)?.focus();
    });
    return true;
  }

  return (
    <div className="flex flex-wrap" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const active = tab.id === selected;
        return (
          <button
            key={tab.id}
            id={`${idPrefix}-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={panelId}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => {
              if (move(index, event.key)) {
                event.preventDefault();
              }
            }}
            className={`border-b-2 px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
              active
                ? "border-brand text-brand"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {tab.label}
            {tab.meta !== undefined ? (
              <span className="ml-1.5 text-[10px] text-ink-faint">{tab.meta}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
