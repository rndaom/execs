import { CaretRight, WarningCircle } from "@phosphor-icons/react";
import { DotEmblem } from "./components/DotEmblem";
import { Disclosure } from "./components/ui/Disclosure";
import { SETTINGS_TAB_ICONS } from "./components/ui/tabIcons";
import type { OverviewRow } from "./lib/home-ui";
import type { SettingsTab } from "./lib/settings-ui";

export type HomeNotice = {
  id: string;
  message: string;
  action: string;
  onAction: () => void;
};

/**
 * Where execs opens: the active profile's name over the TF2 emblem in dots,
 * one line of what matters most, anything that needs attention, and the full
 * setup one fold away. Nothing here edits anything.
 */
export function HomePane({
  profileId,
  profileName,
  highlights,
  rows,
  notices,
  active,
  onOpen,
}: {
  profileId: string | null;
  profileName: string | null;
  highlights: string;
  rows: OverviewRow[];
  notices: HomeNotice[];
  /** Home is the visible pane; arriving replays the emblem's entrance. */
  active: boolean;
  onOpen: (tab: SettingsTab) => void;
}) {
  return (
    <section data-testid="settings-home" className="home">
      <div className="home-hero">
        <DotEmblem active={active} />
        <h1 className="home-name" data-pane-heading tabIndex={-1}>
          <span aria-hidden="true" className="home-dot" />
          {profileName ?? "Home"}
        </h1>
        {highlights ? <p className="t-meta mt-1.5">{highlights}</p> : null}
      </div>

      {notices.length > 0 ? (
        <ul aria-label="Needs attention" className="home-column mt-8 space-y-2">
          {notices.map((notice) => (
            <li key={notice.id} className="home-notice">
              <WarningCircle size={16} className="shrink-0 text-warn" aria-hidden="true" />
              <span className="min-w-0 flex-1">{notice.message}</span>
              <button type="button" className="btn btn-ghost" onClick={notice.onAction}>
                {notice.action}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Disclosure
        profileId={profileId}
        storageKey="home-details"
        testId="home-details"
        className="home-column mt-8"
        summary={<span className="t-row">Profile details</span>}
      >
        <ul aria-label="Profile setup" className="home-list mt-2">
          {rows.map((row) => {
            const Icon = SETTINGS_TAB_ICONS[row.tab];
            return (
              <li key={row.tab}>
                <button
                  type="button"
                  data-testid={`home-${row.tab}`}
                  className="home-row"
                  onClick={() => onOpen(row.tab)}
                >
                  <span aria-hidden="true" className="home-row-icon">
                    <Icon size={16} />
                  </span>
                  <span className="home-row-label">{row.label}</span>
                  <span className="home-row-value">{row.value}</span>
                  <CaretRight size={14} aria-hidden="true" className="home-row-caret" />
                </button>
              </li>
            );
          })}
        </ul>
      </Disclosure>
    </section>
  );
}
