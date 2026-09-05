import { useRef, useState } from "react";
import { Modal } from "../components/ui/Modal";
import type { DirtyFileDraft, FilesDraftStore } from "../lib/files-drafts";
import { saveFileDrafts } from "../lib/files-exit";
import { useNativeCloseGuard } from "./useNativeCloseGuard";

export function useFilesExitGuard(store: FilesDraftStore, running: boolean, busy = false) {
  const saver = useRef<((draft: DirtyFileDraft) => Promise<boolean>) | null>(null);
  const action = useRef<(() => void | Promise<void>) | null>(null);
  const saving = useRef(false);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function request(next: () => void | Promise<void>) {
    if (action.current || saving.current) return;
    if (store.dirty().length === 0 && !busy) {
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
  }
  function cancel() {
    if (saving.current) return;
    action.current = null;
    setOpen(false);
  }
  async function finish(save: boolean) {
    if (saving.current || busy) return;
    saving.current = true;
    setWorking(true);
    try {
      if (save) {
        if (
          running ||
          !saver.current ||
          !(await saveFileDrafts(
            store,
            (draft) => saver.current?.(draft) ?? Promise.resolve(false),
          ))
        ) {
          setError("Drafts kept. Close TF2 and resolve any save errors before continuing.");
          return;
        }
      } else store.discardAll();
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
  const closeGuard = useNativeCloseGuard(store, request, busy);
  return {
    saver,
    request,
    ready: closeGuard.ready,
    error: closeGuard.error ?? (!open ? error : null),
    modal: (
      <Modal
        open={open}
        title="Save Files drafts?"
        description="Save your edited files before continuing, or discard them."
        onClose={cancel}
        testId="files-exit-guard"
      >
        <ul className="t-meta text-ink-muted">
          {store.dirty().map((draft) => (
            <li key={JSON.stringify([draft.profile, draft.path])}>{draft.path}</li>
          ))}
        </ul>
        {error ? (
          <p role="alert" className="t-body mt-3">
            {error}
          </p>
        ) : null}
        {busy && !working ? (
          <p className="t-body mt-3">Wait for the current operation to finish before continuing.</p>
        ) : null}
        {running ? <p className="t-body mt-3">Close TF2 to save. Your drafts are kept.</p> : null}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            className="btn btn-primary"
            disabled={working || running || busy}
            onClick={() => void finish(true)}
          >
            {working ? "Saving…" : "Save and continue"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={working || busy}
            onClick={() => void finish(false)}
          >
            Discard and continue
          </button>
          <button type="button" className="btn btn-ghost" disabled={working} onClick={cancel}>
            Cancel
          </button>
        </div>
      </Modal>
    ),
  };
}
