import type { AppUpdateState } from "../hooks/useAppUpdate";
import { appVersionCopy, CHECK_LABEL } from "../lib/updater-ui";

const LONG_DISCLAIMER =
  "execs is a fan project and is not affiliated with Valve Corporation or Steam. Team Fortress and Steam are trademarks of Valve Corporation.";
const SHORT_DISCLAIMER = "Fan project — not affiliated with Valve or Steam.";

/** Version line, Check for updates, and the not-affiliated disclaimer. */
export function AppFooter({ update, pinned }: { update: AppUpdateState; pinned: boolean }) {
  return (
    <div
      className={
        pinned
          ? // Pinned, not min-height: this bar sits next to a flex-1 sibling
            // and must never take height from the pane above it.
            "flex h-7 shrink-0 grow-0 items-center justify-between gap-4 overflow-hidden border-t border-edge bg-panel px-4 py-1 text-[10px] text-ink-muted"
          : "mt-10 flex max-w-md flex-col items-center gap-2 text-center"
      }
    >
      {/* A failed get_app_version must not cost the user their only way to
          check for updates (RND-159) — only the version string is optional. */}
      <p className={pinned ? "text-[10px] text-ink-muted" : "text-sm text-ink-muted"}>
        {update.version ? (
          <>
            <span data-testid="app-version">{appVersionCopy(update.version)}</span>
            {" · "}
          </>
        ) : null}
        <button
          type="button"
          data-testid="app-update-check"
          onClick={() => void update.check()}
          disabled={update.progress !== null}
          className="text-ink underline decoration-edge underline-offset-2 hover:text-ink disabled:opacity-40"
        >
          {CHECK_LABEL}
        </button>
      </p>
      {update.checkMessage ? (
        <p data-testid="app-update-check-message" className="text-sm text-ink-muted">
          {update.checkMessage}
        </p>
      ) : null}
      <p
        className={
          pinned ? "min-w-0 truncate text-[10px] text-ink-faint" : "text-sm text-ink-muted"
        }
      >
        {pinned ? SHORT_DISCLAIMER : LONG_DISCLAIMER}
      </p>
    </div>
  );
}
