import { Component, createRef, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { DotBackdrop } from "./components/DotBackdrop";
import { SETTINGS_TAB_ICONS } from "./components/ui/tabIcons";
import { SETTINGS_TAB_GROUPS, SETTINGS_TAB_LABELS, type SettingsTab } from "./lib/settings-ui";

type WorkspaceTab = SettingsTab | "app";

function workspaceLabel(tab: WorkspaceTab) {
  return tab === "app" ? "App settings" : SETTINGS_TAB_LABELS[tab];
}

type ScrollRegionProps = {
  tab: WorkspaceTab;
  scrollIdentity: string | null;
  children?: ReactNode;
};

/**
 * A snapshot captures scroll before React hides the previous retained pane.
 * An effect cleanup is too late: the shorter next pane can already have
 * clamped scrollTop. The children stay mounted, including their draft stores.
 */
class PaneScrollRegion extends Component<ScrollRegionProps> {
  private viewport = createRef<HTMLElement>();
  private content = createRef<HTMLDivElement>();
  private pane = createRef<HTMLDivElement>();
  private positions = new Map<WorkspaceTab, number>();
  private pendingRestore: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private transitionPhase = 0;

  componentDidMount() {
    if (typeof ResizeObserver === "undefined" || !this.content.current) return;
    this.resizeObserver = new ResizeObserver(() => this.restorePending());
    this.resizeObserver.observe(this.content.current);
  }

  getSnapshotBeforeUpdate(previous: ScrollRegionProps) {
    if (previous.tab === this.props.tab && previous.scrollIdentity === this.props.scrollIdentity) {
      return null;
    }
    return this.pendingRestore ?? this.viewport.current?.scrollTop ?? 0;
  }

  componentDidUpdate(previous: ScrollRegionProps, _state: unknown, snapshot: number | null) {
    if (snapshot === null) return;
    if (previous.scrollIdentity !== this.props.scrollIdentity) {
      // Inventory is account-owned; App settings is global. Profile/install
      // changes only reset customization-pane positions.
      for (const tab of this.positions.keys()) {
        if (tab !== "inventory" && tab !== "app") this.positions.delete(tab);
      }
      if (previous.tab === "inventory" || previous.tab === "app") {
        this.positions.set(previous.tab, snapshot);
      }
    } else {
      this.positions.set(previous.tab, snapshot);
    }
    this.pendingRestore = this.positions.get(this.props.tab) ?? 0;
    this.restorePending();
    if (previous.tab !== this.props.tab) {
      // Alternate identical animations so a rapid second tab switch starts a
      // fresh entrance without remounting the pane or losing its drafts.
      this.transitionPhase += 1;
      this.pane.current?.setAttribute(
        "data-switch",
        this.transitionPhase % 2 === 1 ? "odd" : "even",
      );
    }
  }

  componentWillUnmount() {
    this.resizeObserver?.disconnect();
  }

  private restorePending = () => {
    const viewport = this.viewport.current;
    if (!viewport || this.pendingRestore === null) return;
    viewport.scrollTop = this.pendingRestore;
    if (Math.abs(viewport.scrollTop - this.pendingRestore) < 1) {
      this.pendingRestore = null;
    }
  };

  private takeScrollControl = () => {
    // A deliberate input wins over a delayed image/read finishing its layout.
    this.pendingRestore = null;
  };

  render() {
    const { tab, children } = this.props;
    return (
      <section
        ref={this.viewport}
        data-testid="settings-scroll"
        className="settings-scroll"
        aria-label={`${workspaceLabel(tab)} workspace`}
        onScroll={(event) => {
          if (this.pendingRestore === null) {
            this.positions.set(tab, event.currentTarget.scrollTop);
          }
        }}
        onWheel={this.takeScrollControl}
        onTouchStart={this.takeScrollControl}
        onPointerDown={this.takeScrollControl}
        onKeyDownCapture={this.takeScrollControl}
      >
        <div ref={this.content} className="settings-content" data-pane={tab}>
          <div ref={this.pane} data-testid={`settings-pane-${tab}`} className="settings-pane">
            {children ?? <p className="t-meta">{workspaceLabel(tab)}</p>}
          </div>
        </div>
      </section>
    );
  }
}

/** Grouped navigation and a task-sized workspace. The top banner owns locks. */
export function SettingsLayout({
  tab,
  children,
  onTab,
  scrollIdentity = null,
  utility,
  page = null,
  changed,
}: {
  tab: SettingsTab;
  children?: ReactNode;
  onTab: (tab: SettingsTab) => void;
  /** Confirmed install + profile identity. A change resets profile-pane scroll. */
  scrollIdentity?: string | null;
  /** Global actions, such as App settings, remain reachable below the nav. */
  utility?: ReactNode;
  /** A global page can share the shell without becoming a profile pane. */
  page?: "app" | null;
  /** Panes with changes that have not reached the profile yet. */
  changed?: ReadonlySet<SettingsTab>;
}) {
  const nav = useRef<HTMLElement | null>(null);
  const activeTab = page === null ? tab : null;
  const [indicator, setIndicator] = useState<{
    top: number;
    height: number;
    ready: boolean;
  } | null>(null);

  // One highlight travels to the active item; the first placement snaps.
  useLayoutEffect(() => {
    const root = nav.current;
    if (!root) return;
    const place = () => {
      const item = activeTab
        ? root.querySelector<HTMLElement>(`[data-testid="settings-tab-${activeTab}"]`)
        : null;
      if (!item) {
        setIndicator(null);
        return;
      }
      setIndicator((current) => ({
        top: item.offsetTop,
        height: item.offsetHeight,
        ready: current !== null,
      }));
    };
    place();
    // Item heights only change with the window's breakpoints.
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [activeTab]);

  return (
    <div data-testid="settings-panes" className="settings-shell">
      <aside className="settings-sidebar">
        <nav
          ref={nav}
          className="settings-nav"
          aria-label="Settings"
          data-indicator={indicator ? "true" : undefined}
        >
          {indicator ? (
            <span
              aria-hidden="true"
              className="settings-nav-indicator"
              data-ready={indicator.ready ? "true" : "false"}
              style={{ transform: `translateY(${indicator.top}px)`, height: indicator.height }}
            />
          ) : null}
          {SETTINGS_TAB_GROUPS.map((group) => (
            <div key={group.label} className="settings-nav-group">
              {group.label ? (
                <p className="eyebrow settings-nav-heading" aria-hidden="true">
                  {group.label}
                </p>
              ) : null}
              {group.tabs.map((item) => {
                const active = page === null && item === tab;
                const Icon = SETTINGS_TAB_ICONS[item];
                return (
                  <button
                    key={item}
                    type="button"
                    data-testid={`settings-tab-${item}`}
                    data-active={active ? "true" : "false"}
                    aria-current={active ? "page" : undefined}
                    title={SETTINGS_TAB_LABELS[item]}
                    onClick={() => onTab(item)}
                    className="settings-nav-item"
                  >
                    <span aria-hidden="true" className="shrink-0">
                      <Icon size={16} weight="regular" />
                    </span>
                    <span className="settings-nav-label">{SETTINGS_TAB_LABELS[item]}</span>
                    {changed?.has(item) ? (
                      <span
                        data-testid={`settings-tab-${item}-changed`}
                        className="settings-nav-change"
                      >
                        <span className="sr-only">, has unsaved changes</span>
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        {utility ? <div className="settings-utility">{utility}</div> : null}
      </aside>
      <div className="settings-workspace">
        <DotBackdrop />
        <PaneScrollRegion tab={page ?? tab} scrollIdentity={scrollIdentity}>
          {children}
        </PaneScrollRegion>
      </div>
    </div>
  );
}
