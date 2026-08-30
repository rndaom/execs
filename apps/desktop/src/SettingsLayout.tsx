import type { ReactNode } from "react";
import {
  SETTINGS_TAB_LABELS,
  SETTINGS_TABS,
  type SettingsTab,
} from "./lib/settings-ui";

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
    <aside
      data-testid="settings-panes"
      className="w-full rounded-xl border border-edge bg-panel p-4 text-left"
    >
      <p className="font-display text-sm tracking-wide text-ink-muted">Settings</p>
      <nav className="mt-3 flex flex-wrap gap-2" aria-label="Settings">
        {SETTINGS_TABS.map((item) => {
          const active = item === tab;
          return (
            <button
              key={item}
              type="button"
              data-testid={`settings-tab-${item}`}
              data-active={active ? "true" : "false"}
              onClick={() => onTab(item)}
              className={`rounded-pill px-3 py-1 text-xs ${
                active
                  ? "bg-brand text-on-brand"
                  : "border border-edge text-ink hover:bg-panel-raised"
              }`}
            >
              {SETTINGS_TAB_LABELS[item]}
            </button>
          );
        })}
      </nav>
      {running ? (
        <p className="mt-3 text-sm text-ink-muted">Read-only while TF2 is running.</p>
      ) : null}
      <div data-testid={`settings-pane-${tab}`} className="mt-4">
        {children ?? (
          <p className="text-sm text-ink-muted">{SETTINGS_TAB_LABELS[tab]} settings</p>
        )}
      </div>
    </aside>
  );
}
