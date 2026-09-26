import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

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
 * Shared by the Comfig module groups and the per-class crosshair and viewmodel
 * strips — they are the same widget.
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
  const strip = useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState<{
    x: number;
    width: number;
    y: number;
    ready: boolean;
  } | null>(null);
  const selectedIndex = tabs.findIndex((tab) => tab.id === selected);

  // One underline glides to the selected tab; the first placement snaps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tab labels re-measure when they change.
  useLayoutEffect(() => {
    const root = strip.current;
    if (!root) return;
    const place = () => {
      const target = root.querySelectorAll<HTMLElement>(".class-tab")[selectedIndex];
      if (!target || target.offsetWidth === 0) {
        setIndicator(null);
        return;
      }
      setIndicator((current) => ({
        x: target.offsetLeft,
        width: target.offsetWidth,
        y: target.offsetTop + target.offsetHeight - root.clientHeight,
        ready: current !== null,
      }));
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => observer.disconnect();
  }, [selectedIndex, tabs.length, tabs.map((tab) => tab.id).join("|")]);

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
    <div
      ref={strip}
      className="class-tabs"
      role="tablist"
      aria-label={label}
      data-indicator={indicator ? "true" : undefined}
    >
      {indicator ? (
        <span
          aria-hidden="true"
          className="class-tabs-indicator"
          data-ready={indicator.ready ? "true" : "false"}
          style={{
            transform: `translate(${indicator.x}px, ${indicator.y}px)`,
            width: indicator.width,
          }}
        />
      ) : null}
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
            className="class-tab"
          >
            {tab.label}
            {tab.meta !== undefined ? (
              <span className="tnum ml-1.5 text-[11px] text-ink-faint"> {tab.meta}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
