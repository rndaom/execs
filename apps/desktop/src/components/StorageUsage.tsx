import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import {
  type ClearReport,
  clearResultCopy,
  formatStorageBytes,
  STORAGE_GROUP_COPY,
  type StorageReport,
  visibleStorageGroups,
} from "../lib/app-settings-ui";
import { invokeErrorMessage } from "../lib/bridge";
import { Modal } from "./ui/Modal";
import { Loading } from "./ui/Spinner";

/** Sizes the data directory and offers the one cleanup that never loses setup data. */
export function StorageUsage({
  api,
  ready = true,
}: {
  api: Pick<Api, "getStorageUsage" | "clearDownloadCaches">;
  /** Clearing waits for the native close listener, like other app-data writes. */
  ready?: boolean;
}) {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [result, setResult] = useState<ClearReport | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const next = await api.getStorageUsage();
      if (id !== request.current) return;
      setReport(next);
      setError(null);
    } catch (err) {
      if (id !== request.current) return;
      setError(invokeErrorMessage(err));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);

  async function clear() {
    setConfirming(false);
    setClearing(true);
    try {
      setResult(await api.clearDownloadCaches());
      setError(null);
    } catch (err) {
      setError(invokeErrorMessage(err));
    } finally {
      setClearing(false);
      void load();
    }
  }

  const clearable = report?.clearableBytes ?? 0;
  return (
    <div className="mt-4" data-testid="storage-usage" aria-busy={loading || clearing}>
      {report ? (
        <>
          <ul className="divide-y divide-edge">
            {visibleStorageGroups(report).map((group) => (
              <li
                key={group.id}
                data-testid={`storage-${group.id}`}
                className="flex min-w-0 items-baseline justify-between gap-4 py-2"
              >
                <span className="min-w-0">
                  <span className="t-row block">{STORAGE_GROUP_COPY[group.id].label}</span>
                  <span className="t-meta block">
                    {STORAGE_GROUP_COPY[group.id].detail}
                    {group.unreadable > 0
                      ? ` ${group.unreadable} ${group.unreadable === 1 ? "item" : "items"} could not be read.`
                      : ""}
                  </span>
                </span>
                <span className="t-row shrink-0 tabular-nums">
                  {group.unreadable > 0 ? "At least " : ""}
                  {formatStorageBytes(group.bytes)}
                </span>
              </li>
            ))}
          </ul>
          {report.partial ? (
            <p className="t-meta mt-2">
              Some sizes are incomplete because files could not be read.
            </p>
          ) : null}
        </>
      ) : loading ? (
        <p className="t-meta">
          <Loading>Measuring app data…</Loading>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="t-meta mt-2 text-error">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost"
          data-testid="storage-clear"
          disabled={!ready || clearing || loading || clearable === 0}
          onClick={() => setConfirming(true)}
        >
          {clearing ? (
            <Loading>Clearing downloads…</Loading>
          ) : clearable > 0 ? (
            `Clear downloads (${formatStorageBytes(clearable)})`
          ) : (
            "Clear downloads"
          )}
        </button>
        {error && !report ? (
          <button type="button" className="btn btn-ghost" onClick={() => void load()}>
            Retry
          </button>
        ) : null}
      </div>
      {result ? (
        <p className="t-meta mt-2" aria-live="polite" data-testid="storage-clear-result">
          {clearResultCopy(result)}
        </p>
      ) : null}
      <Modal
        open={confirming}
        title="Clear downloads?"
        testId="storage-clear-review"
        onClose={() => setConfirming(false)}
      >
        <p className="t-body text-ink-muted">
          This frees {formatStorageBytes(clearable)}. It removes the HUD catalog, HUD option
          schemas, Casual setup downloads and files from retired features.
        </p>
        <p className="t-body mt-3 text-ink-muted">
          Profiles, recovery data, sounds you added and the saved Casual library stay. HUD options
          and Casual setup choices need a connection the next time they load.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="storage-clear-confirm"
            onClick={() => void clear()}
          >
            Clear downloads
          </button>
        </div>
      </Modal>
    </div>
  );
}
