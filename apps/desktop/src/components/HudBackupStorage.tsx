import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import { formatStorageBytes } from "../lib/app-settings-ui";
import { type HudBackup, type HudBackupReport, invokeErrorMessage } from "../lib/bridge";
import { ContextMenu, ContextMenuItem, type ContextMenuPosition } from "./ui/ContextMenu";
import { Modal } from "./ui/Modal";
import { Loading } from "./ui/Spinner";

export type HudBackupApi = Pick<Api, "getHudBackups" | "restoreHudBackup" | "deleteHudBackup">;

export function HudBackupStorage({
  api,
  ready,
  onChanged,
}: {
  api: HudBackupApi;
  ready: boolean;
  onChanged: () => void;
}) {
  const [report, setReport] = useState<HudBackupReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [menu, setMenu] = useState<(ContextMenuPosition & { backup: HudBackup }) | null>(null);
  const [review, setReview] = useState<{ backup: HudBackup; action: "restore" | "delete" } | null>(
    null,
  );
  const request = useRef(0);
  const load = useCallback(async () => {
    const revision = ++request.current;
    setLoading(true);
    try {
      const next = await api.getHudBackups();
      if (request.current !== revision) return;
      setReport(next);
      setError(null);
    } catch (error) {
      if (request.current === revision) setError(invokeErrorMessage(error));
    } finally {
      if (request.current === revision) setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  async function perform() {
    if (!review || !ready || busy) return;
    const { backup, action } = review;
    setReview(null);
    setBusy(true);
    setResult(null);
    try {
      if (action === "delete") {
        await api.deleteHudBackup(backup.id, backup.revision);
        setResult(`Deleted the ${backup.name} backup.`);
        await load();
        onChanged();
      } else {
        const path = await api.restoreHudBackup(backup.id, backup.revision);
        if (path !== null) setResult(`Recovered files to ${path}. The backup was kept.`);
      }
      setError(null);
    } catch (error) {
      // A held file can leave a partly cleared backup. Re-read the remaining
      // bytes before offering another revision-bound action.
      if (action === "delete") {
        await load();
        onChanged();
      }
      setError(invokeErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mt-5 border-t border-edge pt-4"
      aria-busy={busy || loading}
      data-testid="hud-backup-storage"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="t-row">HUD backups</h3>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || loading}
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>
      <p className="t-meta mt-1">Older HUD files execs kept as backups.</p>
      {loading ? (
        <p className="t-meta mt-2">
          <Loading>Reading HUD backups…</Loading>
        </p>
      ) : null}
      {report ? (
        <>
          <ul className="mt-2 divide-y divide-edge">
            {report.backups.map((backup) => (
              <li
                key={backup.id}
                className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3"
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu({ x: event.clientX, y: event.clientY, backup });
                }}
              >
                <div className="min-w-0 flex-1">
                  <p className="t-row break-words">{backup.name}</p>
                  <p className="t-meta">
                    {backup.location} ·{" "}
                    {backup.modifiedAt === null
                      ? "Date unavailable"
                      : new Date(backup.modifiedAt * 1000).toLocaleDateString()}{" "}
                    · {formatStorageBytes(backup.bytes)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!ready || busy || loading}
                    onClick={() => setReview({ backup, action: "restore" })}
                    aria-label={`Restore ${backup.name} files`}
                  >
                    Restore files…
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={!ready || busy || loading}
                    onClick={() => setReview({ backup, action: "delete" })}
                    aria-label={`Delete ${backup.name} backup`}
                  >
                    Delete…
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {!loading && report.backups.length === 0 ? (
            <p className="t-meta mt-2">No HUD backups.</p>
          ) : null}
          {report.unreadable.length ? (
            <p className="t-meta mt-2 text-error">
              Some backups could not be read and were kept: {report.unreadable.join(", ")}. Refresh
              after resolving access to those folders.
            </p>
          ) : null}
        </>
      ) : null}
      {error ? (
        <p role="alert" className="t-meta mt-2 text-error">
          {error}
        </p>
      ) : null}
      {result ? (
        <p className="t-meta mt-2 break-words" role="status">
          {result}
        </p>
      ) : null}
      {menu ? (
        <ContextMenu
          label={`${menu.backup.name} backup actions`}
          position={menu}
          onClose={() => setMenu(null)}
        >
          <ContextMenuItem
            disabled={!ready || busy || loading}
            onSelect={() => {
              setReview({ backup: menu.backup, action: "restore" });
              setMenu(null);
            }}
          >
            Restore files…
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!ready || busy || loading}
            onSelect={() => {
              setReview({ backup: menu.backup, action: "delete" });
              setMenu(null);
            }}
          >
            Delete…
          </ContextMenuItem>
        </ContextMenu>
      ) : null}
      <Modal
        open={review !== null}
        title={review?.action === "delete" ? "Delete HUD backup?" : "Restore HUD files?"}
        onClose={() => setReview(null)}
        testId="hud-backup-review"
      >
        <p className="t-body text-ink-muted">
          {review?.action === "delete"
            ? `Permanently delete the ${review.backup.name} backup (${formatStorageBytes(review.backup.bytes)})? This cannot be undone. Your installed HUD and saved profiles stay unchanged.`
            : `Copy every file from ${review?.backup.name ?? "this backup"} to a new folder in a location you choose. The backup stays. To use the recovered HUD, import its HUD folder from the HUD pane.`}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setReview(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!ready || busy}
            onClick={() => void perform()}
            data-testid="hud-backup-confirm"
          >
            {review?.action === "delete" ? "Delete backup" : "Choose recovery folder"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
