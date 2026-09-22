import {
  Backpack,
  Crosshair,
  FolderOpen,
  GameController,
  Keyboard,
  Monitor,
  Package,
  Play,
  SlidersHorizontal,
  SpeakerHigh,
  UserFocus,
} from "@phosphor-icons/react";
import { Component, type ComponentType, createRef, type ReactNode } from "react";
import { SETTINGS_TAB_GROUPS, SETTINGS_TAB_LABELS, type SettingsTab } from "./lib/settings-ui";

type NavIcon = ComponentType<{ size?: number; weight?: "regular" | "bold" }>;

const SETTINGS_TAB_ICONS: Record<SettingsTab, NavIcon> = {
  comfig: SlidersHorizontal,
  binds: Keyboard,
  gameplay: GameController,
  hud: Monitor,
  crosshair: Crosshair,
  viewmodels: UserFocus,
  sounds: SpeakerHigh,
  mods: Package,
  files: FolderOpen,
  launch: Play,
  inventory: Backpack,
};

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
  private positions = new Map<WorkspaceTab, number>();
  private pendingRestore: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

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
          <div data-testid={`settings-pane-${tab}`} className="settings-pane">
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
}) {
  return (
    <div data-testid="settings-panes" className="settings-shell">
      <aside className="settings-sidebar">
        <nav className="settings-nav" aria-label="Settings">
          {SETTINGS_TAB_GROUPS.map((group) => (
            <div key={group.label} className="settings-nav-group">
              <p className="eyebrow settings-nav-heading" aria-hidden="true">
                {group.label}
              </p>
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
                    {active ? <span aria-hidden="true" className="settings-nav-marker" /> : null}
                    <span aria-hidden="true" className="shrink-0">
                      <Icon size={16} weight="regular" />
                    </span>
                    <span className="settings-nav-label">{SETTINGS_TAB_LABELS[item]}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        {utility ? <div className="settings-utility">{utility}</div> : null}
      </aside>
      <PaneScrollRegion tab={page ?? tab} scrollIdentity={scrollIdentity}>
        {children}
      </PaneScrollRegion>
    </div>
  );
}
