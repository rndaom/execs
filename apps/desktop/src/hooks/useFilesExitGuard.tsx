import { useRef, useState, useSyncExternalStore } from "react";
import { Modal } from "../components/ui/Modal";
import type { DirtyFileDraft, FilesDraftStore } from "../lib/files-drafts";
import { saveFileDrafts } from "../lib/files-exit";
import { createSettingsDraftStore, type SettingsDraftStore } from "../lib/settings-drafts";
import { SETTINGS_TAB_LABELS, type SettingsTab } from "../lib/settings-ui";
import { useNativeCloseGuard } from "./useNativeCloseGuard";

export function useFilesExitGuard(
  store: FilesDraftStore,
  running: boolean,
  busy = false,
  suppliedSettings?: SettingsDraftStore,
  onOpenPane?: (tab: SettingsTab) => void,
) {
  const [localSettings] = useState(createSettingsDraftStore);
  const settings = suppliedSettings ?? localSettings;
  const settingsDrafts = useSyncExternalStore(settings.subscribe, settings.getSnapshot);
  const operationBusy = busy || settings.isWriting();
  const latest = useRef({ running, busy });
  latest.current = { running, busy };
  const saver = useRef<((draft: DirtyFileDraft) => Promise<boolean>) | null>(null);
  const action = useRef<(() => void | Promise<void>) | null>(null);
  const saving = useRef(false);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function request(next: () => void | Promise<void>, native = false) {
    if (action.current || saving.current) return;
    if (store.dirty().length === 0 && settings.getSnapshot().length === 0 && !operationBusy) {
      void Promise.resolve()
        .then(next)
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
        });
      return;
    }
    action.current = next;
    setError(null);
    setOpen(true);
    // Native close saves ordinary unlocked autosaves immediately. Files retain
    // their explicit Save / Discard / Cancel decision.
    if (
      native &&
      store.dirty().length === 0 &&
      !running &&
      !busy &&
      settings.getSnapshot().length > 0 &&
      settings.getSnapshot().every((entry) => entry.save && !entry.save.locked)
    ) {
      void finish(true, true);
    }
  }
  function cancel() {
    if (saving.current) return;
    action.current = null;
    setOpen(false);
  }
  async function finish(save: boolean, awaitSettings = false) {
    if (saving.current || latest.current.busy || (settings.isWriting() && !awaitSettings)) return;
    saving.current = true;
    setWorking(true);
    setError(null);
    try {
      if (save && settings.getSnapshot().length > 0) {
        if (latest.current.running || !(await settings.flush())) {
          setError(
            "Settings drafts kept. Retry the save, open the responsible pane, or discard the edits.",
          );
          return;
        }
      }
      if (save && store.dirty().length > 0) {
        if (
          latest.current.running ||
          !saver.current ||
          !(await saveFileDrafts(
            store,
            (draft) => saver.current?.(draft) ?? Promise.resolve(false),
          ))
        ) {
          setError("Drafts kept. Close TF2 and resolve any save errors before continuing.");
          return;
        }
      } else if (!save) {
        if (!settings.discard()) {
          setError("Wait for settings writes to finish before discarding drafts.");
          return;
        }
        store.discardAll();
      }
      if (
        store.dirty().length > 0 ||
        settings.getSnapshot().length > 0 ||
        latest.current.busy ||
        settings.isWriting()
      ) {
        setError("Changes are still pending. Review them before continuing.");
        return;
      }
      const next = action.current;
      await next?.();
      action.current = null;
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      saving.current = false;
      setWorking(false);
    }
  }
  const closeGuard = useNativeCloseGuard(
    store,
    (next) => request(next, true),
    operationBusy,
    settings,
  );
  const drafts = store.dirty();
  const hasSettings = settingsDrafts.length > 0;
  const hasDrafts = drafts.length > 0 || hasSettings;
  const panes = [...new Set(settingsDrafts.map((entry) => entry.tab))];
  return {
    saver,
    request,
    ready: closeGuard.ready,
    error: closeGuard.error ?? (!open ? error : null),
    modal: (
      <Modal
        open={open}
        title={
          hasSettings
            ? "Resolve pending changes?"
            : hasDrafts
              ? "Save Files drafts?"
              : "Finish current operation?"
        }
        description={
          hasDrafts
            ? "Save your edits before continuing, or explicitly discard them."
            : "Continue once the current operation has finished."
        }
        onClose={cancel}
        testId="files-exit-guard"
        className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto"
      >
        <ul className="t-meta text-ink-muted">
          {drafts.map((draft) => (
            <li key={JSON.stringify([draft.profile, draft.path])}>{draft.path}</li>
          ))}
          {panes.map((tab) => {
            const entries = settingsDrafts.filter((entry) => entry.tab === tab);
            const status = entries.some((entry) => entry.save?.saving)
              ? "Saving…"
              : entries.some((entry) => entry.save?.failed)
                ? "Save failed — draft kept"
                : entries.some((entry) => !entry.save)
                  ? "Apply from this pane"
                  : entries.some((entry) => entry.save?.locked)
                    ? "Waiting for TF2 or settings to unlock"
                    : "Unsaved changes";
            return (
              <li key={tab} className="mt-3 flex flex-wrap items-center gap-2">
                <span>
                  {SETTINGS_TAB_LABELS[tab]}: {status}
                </span>
                {onOpenPane ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={working}
                    onClick={() => {
                      cancel();
                      onOpenPane(tab);
                    }}
                  >
                    Open {SETTINGS_TAB_LABELS[tab]}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
        {error ? (
          <p role="alert" className="t-body mt-3">
            {error}
          </p>
        ) : null}
        {operationBusy && !working ? (
          <p className="t-body mt-3">Wait for the current operation to finish before continuing.</p>
        ) : null}
        {running && hasDrafts ? (
          <p className="t-body mt-3">Close TF2 to save. Your drafts are kept.</p>
        ) : null}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            className="btn btn-primary"
            disabled={working || (running && hasDrafts) || operationBusy}
            onClick={() => void finish(true)}
          >
            {working ? "Continuing…" : hasDrafts ? "Save and continue" : "Continue"}
          </button>
          {hasDrafts ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={working || operationBusy}
              onClick={() => void finish(false)}
            >
              Discard and continue
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost" disabled={working} onClick={cancel}>
            Cancel
          </button>
        </div>
      </Modal>
    ),
  };
}
