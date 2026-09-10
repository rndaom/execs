import type { DirtyFileDraft, FilesDraftStore } from "./files-drafts";

/** Acknowledging only submitted bytes keeps edits made during a save pending. */
export async function saveFileDrafts(
  store: FilesDraftStore,
  save: (draft: DirtyFileDraft) => Promise<boolean>,
): Promise<boolean> {
  for (const draft of store.dirty()) {
    if (!(await save(draft))) return false;
    store.acknowledge(draft.profile, draft.path, draft.text);
  }
  return store.dirty().length === 0;
}
