import type { AppUpdateState } from "../hooks/useAppUpdate";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
import type { Api } from "../lib/api";
import { openExternal } from "../lib/bridge";
import { copyButtonLabel } from "../lib/copy-ui";
import { appVersionCopy, updateCheckButtonLabel } from "../lib/updater-ui";

const ISSUES_URL = "https://github.com/rndaom/execs/issues/new/choose";

const LONG_DISCLAIMER =
  "execs is a fan project and is not affiliated with Valve Corporation or Steam. Team Fortress and Steam are trademarks of Valve Corporation.";
const SHORT_DISCLAIMER = "Fan project — not affiliated with Valve or Steam.";

const LINK_CLASS = "text-ink underline decoration-edge underline-offset-2 hover:text-ink";

/** Version line, Check for updates, Report a bug, Copy diagnostics, and the
 * not-affiliated disclaimer. */
export function AppFooter({
  api,
  update,
  pinned,
}: {
  api: Api;
  update: AppUpdateState;
  pinned: boolean;
}) {
  const diagnostics = useCopyFeedback();

  async function copyDiagnostics() {
    let text: string;
    try {
      text = await api.getDiagnostics();
    } catch {
      text = `execs ${update.version || "unknown"}\n(diagnostics could not be read)\n`;
    }
    await diagnostics.copy(text);
  }

  return (
    <div
      className={
        pinned
          ? // Pinned, not min-height: this bar sits next to a flex-1 sibling
            // and must never take height from the pane above it.
            "flex h-7 shrink-0 grow-0 items-center justify-between gap-4 overflow-hidden border-t border-edge bg-panel px-4 py-1 text-[10px] text-ink-muted"
          : "mt-12 flex max-w-md flex-col items-center gap-2 text-center"
      }
    >
      {/* A failed get_app_version must not cost the user their only way to
          check for updates — only the version string is optional. */}
      <p className={pinned ? "shrink-0 text-[10px] text-ink-faint" : "t-meta"}>
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
          className={`${LINK_CLASS} disabled:opacity-40`}
        >
          {updateCheckButtonLabel(update.checkMessage)}
        </button>
        {" · "}
        <button
          type="button"
          data-testid="app-report-bug"
          onClick={() => void openExternal(ISSUES_URL)}
          className={LINK_CLASS}
        >
          Report a bug
        </button>
        {" · "}
        <button
          type="button"
          data-testid="app-copy-diagnostics"
          onClick={() => void copyDiagnostics()}
          className={LINK_CLASS}
        >
          {copyButtonLabel(diagnostics.feedback, "Copy diagnostics")}
        </button>
      </p>
      <p className={pinned ? "min-w-0 truncate text-[10px] text-ink-faint" : "t-meta"}>
        {pinned ? SHORT_DISCLAIMER : LONG_DISCLAIMER}
      </p>
    </div>
  );
}
