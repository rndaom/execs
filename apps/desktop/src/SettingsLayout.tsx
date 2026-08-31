import {
  Crosshair,
  FolderOpen,
  GameController,
  Keyboard,
  LockSimple,
  Monitor,
  Play,
  SlidersHorizontal,
  UserFocus,
} from "@phosphor-icons/react";
import type { ComponentType, ReactNode } from "react";
import { SETTINGS_TAB_LABELS, SETTINGS_TABS, type SettingsTab } from "./lib/settings-ui";

type NavIcon = ComponentType<{ size?: number; weight?: "regular" | "bold" }>;

const SETTINGS_TAB_ICONS: Record<SettingsTab, NavIcon> = {
  comfig: SlidersHorizontal,
  binds: Keyboard,
  gameplay: GameController,
  hud: Monitor,
  crosshair: Crosshair,
  viewmodels: UserFocus,
  files: FolderOpen,
  launch: Play,
};

const SETTINGS_TAB_DESCRIPTIONS: Record<SettingsTab, string> = {
  comfig: "Performance, visuals, networking, and official packages.",
  binds: "Record the controls you use most without editing cfg by hand.",
  gameplay: "Tune field of view, viewmodels, and clear gameplay preferences.",
  hud: "Find, install, update, and personalize one HUD for this profile.",
  crosshair: "Configure the stock crosshair or install custom crosshairs.",
  viewmodels: "Manage animation packs and the first-party Casual preloader.",
  files: "Inspect and safely edit the cfg files owned by this profile.",
  launch: "Review the launch string stored with this profile.",
};

export function SettingsLayout({
  tab,
  running,
  children,
  onTab,
}: {
  tab: SettingsTab;
  running: boolean;
  children?: ReactNode;
  onTab: (tab: SettingsTab) => void;
}) {
  return (
    <div
      data-testid="settings-panes"
      className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-edge bg-bg lg:flex-row"
    >
      <aside className="shrink-0 border-b border-edge bg-panel lg:w-[212px] lg:border-r lg:border-b-0">
        <nav
          className="flex gap-0.5 overflow-x-auto px-3 py-3 lg:flex-col lg:px-0 lg:py-5"
          aria-label="Settings"
        >
          {SETTINGS_TABS.map((item) => {
            const active = item === tab;
            const Icon = SETTINGS_TAB_ICONS[item];
            return (
              <button
                key={item}
                type="button"
                data-testid={`settings-tab-${item}`}
                data-active={active ? "true" : "false"}
                aria-current={active ? "page" : undefined}
                onClick={() => onTab(item)}
                className={`group relative flex shrink-0 items-center gap-3 rounded-lg px-4 py-2 text-left text-[13px] transition-colors lg:w-full lg:rounded-none lg:px-6 lg:py-2.5 ${
                  active
                    ? "font-medium text-ink lg:bg-panel-raised/50"
                    : "text-ink-muted hover:text-ink lg:hover:bg-panel-raised/30"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-1.5 left-0 hidden w-[2px] rounded-r-full transition-colors lg:block ${
                    active ? "bg-brand" : "bg-transparent"
                  }`}
                />
                <Icon size={17} weight={active ? "bold" : "regular"} />
                <span>{SETTINGS_TAB_LABELS[item]}</span>
              </button>
            );
          })}
        </nav>

        {running ? (
          <div className="mx-4 mb-4 hidden items-start gap-2 rounded-lg border border-team-red/40 bg-team-red/10 px-3 py-2.5 text-xs text-ink-muted lg:flex">
            <LockSimple size={15} weight="bold" />
            <span>Read-only until TF2 closes.</span>
          </div>
        ) : null}
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1180px] px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
          {tab === "comfig" ? null : (
            <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-ink">
                  {SETTINGS_TAB_LABELS[tab]}
                </h1>
                <p className="mt-1 max-w-2xl text-[13px] text-ink-muted">
                  {SETTINGS_TAB_DESCRIPTIONS[tab]}
                </p>
              </div>
              {running ? (
                <div className="flex items-center gap-2 rounded-pill border border-team-red/40 bg-team-red/10 px-3 py-1.5 text-xs text-ink lg:hidden">
                  <LockSimple size={14} weight="bold" />
                  Read-only
                </div>
              ) : null}
            </header>
          )}

          <div data-testid={`settings-pane-${tab}`} className="min-w-0 pb-8">
            {children ?? (
              <p className="text-sm text-ink-muted">{SETTINGS_TAB_LABELS[tab]} settings</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
