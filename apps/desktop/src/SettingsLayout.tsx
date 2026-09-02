import {
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
import type { ComponentType, ReactNode } from "react";
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
};

/**
 * The settings shell: a grouped sidebar and one 880px content column.
 *
 * The lock state is shown in exactly one place, the top banner; the disabled
 * controls carry the rest of the message.
 */
export function SettingsLayout({
  tab,
  children,
  onTab,
}: {
  tab: SettingsTab;
  children?: ReactNode;
  onTab: (tab: SettingsTab) => void;
}) {
  return (
    <div
      data-testid="settings-panes"
      className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-edge bg-bg lg:flex-row"
    >
      <aside className="shrink-0 border-b border-edge bg-panel lg:w-(--sidebar-width) lg:border-r lg:border-b-0">
        <nav
          className="flex gap-0.5 overflow-x-auto px-3 py-3 lg:flex-col lg:gap-0 lg:px-0 lg:py-6"
          aria-label="Settings"
        >
          {SETTINGS_TAB_GROUPS.map((group, index) => (
            <div key={group.label} className="contents lg:block">
              <p
                className={`eyebrow hidden px-6 lg:block ${index === 0 ? "" : "mt-7"} mb-2`}
                aria-hidden="true"
              >
                {group.label}
              </p>
              {group.tabs.map((item) => {
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
                    className={`group relative flex shrink-0 items-center gap-3 rounded-lg px-4 py-2 text-left text-[13.5px] transition-colors duration-150 lg:w-full lg:rounded-none lg:px-6 lg:py-2 ${
                      active
                        ? "font-medium text-ink"
                        : "text-ink-muted hover:text-ink lg:hover:bg-panel-raised"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute inset-y-1 left-0 hidden w-[2px] lg:block ${
                        active ? "bg-brand" : "bg-transparent"
                      }`}
                    />
                    <Icon size={16} weight="regular" />
                    <span>{SETTINGS_TAB_LABELS[item]}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="content-col py-10">
          <div data-testid={`settings-pane-${tab}`} className="min-w-0 pb-8">
            {children ?? <p className="t-meta">{SETTINGS_TAB_LABELS[tab]} settings</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
