import { CaretRight, WarningCircle } from "@phosphor-icons/react";
import { PaneHeader } from "./components/ui/PaneHeader";
import { SETTINGS_TAB_ICONS } from "./components/ui/tabIcons";
import type { OverviewRow } from "./lib/overview-ui";
import type { SettingsTab } from "./lib/settings-ui";

export type OverviewNotice = {
  id: string;
  message: string;
  action: string;
  onAction: () => void;
};

/**
 * Where execs opens: the active profile's setup, one line per area, each
 * leading to the pane that changes it. Nothing here edits anything.
 */
export function OverviewPane({
  rows,
  notices,
  onOpen,
}: {
  rows: OverviewRow[];
  notices: OverviewNotice[];
  onOpen: (tab: SettingsTab) => void;
}) {
  return (
    <section data-testid="settings-overview">
      <PaneHeader title="Overview" />

      {notices.length > 0 ? (
        <ul aria-label="Needs attention" className="mb-6 space-y-2">
          {notices.map((notice) => (
            <li key={notice.id} className="overview-notice">
              <WarningCircle size={16} className="shrink-0 text-warn" aria-hidden="true" />
              <span className="min-w-0 flex-1">{notice.message}</span>
              <button type="button" className="btn btn-ghost" onClick={notice.onAction}>
                {notice.action}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <ul aria-label="Profile setup" className="overview-list">
        {rows.map((row) => {
          const Icon = SETTINGS_TAB_ICONS[row.tab];
          return (
            <li key={row.tab}>
              <button
                type="button"
                data-testid={`overview-${row.tab}`}
                className="overview-row"
                onClick={() => onOpen(row.tab)}
              >
                <span aria-hidden="true" className="overview-icon">
                  <Icon size={16} />
                </span>
                <span className="overview-label">{row.label}</span>
                <span className="overview-value">{row.value}</span>
                <CaretRight size={14} aria-hidden="true" className="shrink-0 text-ink-faint" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
