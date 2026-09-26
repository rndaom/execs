import type { FilesSource } from "./bridge";

export type DraftDocument = { path: string; text: string; revision: number };
type FileDraft = {
  text: string;
  baseline: string;
  source: string;
  expected?: FilesSource;
  currentExpected?: FilesSource;
  revision: number;
  created: boolean;
  missing: boolean;
  missingReviewed?: boolean;
};
export type DirtyFileDraft = {
  profile: string | null;
  path: string;
  text: string;
  expected?: FilesSource;
  revision?: number;
  documents?: DraftDocument[];
};

/** Original baselines remain fixed until save or an explicit changed-source review. */
export function createFilesDraftStore() {
  const drafts = new Map<string, FileDraft>();
  const selections = new Map<string, string>();
  const key = (profile: string | null, path: string) => JSON.stringify([profile, path]);
  const isDirty = (entry: FileDraft) =>
    entry.created ||
    entry.missingReviewed === true ||
    entry.text !== entry.baseline ||
    entry.source !== entry.baseline;
  // Which profiles have unsaved Files work, for the sidebar's change dot.
  // Notify after the current task: drafts are also read during render.
  const listeners = new Set<() => void>();
  let dirtySignature = "";
  let version = 0;
  let pending = false;
  const signature = () =>
    [...drafts]
      .filter(([, entry]) => isDirty(entry))
      .map(([id]) => id)
      .sort()
      .join("\n");
  const changed = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      const next = signature();
      if (next === dirtySignature) return;
      dirtySignature = next;
      version += 1;
      for (const listener of listeners) listener();
    });
  };
  const documents = (profile: string | null): DraftDocument[] =>
    [...drafts].flatMap(([id, entry]) => {
      const [owner, path] = JSON.parse(id) as [string | null, string];
      return owner === profile ? [{ path, text: entry.text, revision: entry.revision }] : [];
    });
  return {
    documents,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Changes whenever the set of files with unsaved edits changes. */
    getVersion: () => version,
    hasDirty(profile: string | null) {
      return [...drafts].some(
        ([id, entry]) =>
          (JSON.parse(id) as [string | null, string])[0] === profile && isDirty(entry),
      );
    },
    dirty(): DirtyFileDraft[] {
      return [...drafts]
        .filter(([, entry]) => isDirty(entry))
        .map(([id, entry]) => {
          const [profile, path] = JSON.parse(id) as [string | null, string];
          return {
            profile,
            path,
            text: entry.text,
            expected: entry.expected,
            revision: entry.revision,
            documents: documents(profile),
          };
        });
    },
    discardAll() {
      changed();
      for (const [id, entry] of drafts) {
        if (entry.created || entry.missing) drafts.delete(id);
        else {
          entry.text = entry.source;
          entry.baseline = entry.source;
          entry.expected = entry.currentExpected;
          entry.revision++;
        }
      }
    },
    read(profile: string | null, path: string, source: string, expected?: FilesSource): string {
      changed();
      const id = key(profile, path);
      const entry = drafts.get(id);
      if (!entry) {
        drafts.set(id, {
          text: source,
          baseline: source,
          source,
          expected,
          currentExpected: expected,
          revision: 0,
          created: false,
          missing: false,
        });
        return source;
      }
      const dirty = isDirty(entry);
      if (
        entry.source !== source ||
        JSON.stringify(entry.currentExpected) !== JSON.stringify(expected)
      ) {
        entry.missingReviewed = false;
        if (!dirty) {
          entry.text = source;
          entry.baseline = source;
          entry.expected = expected;
          entry.revision++;
        }
        entry.source = source;
        entry.currentExpected = expected;
      }
      entry.missing = expected?.sha256 === null && expected.librarySha256 !== null;
      return entry.text;
    },
    markMissing(profile: string | null, paths: Set<string>) {
      changed();
      for (const [id, entry] of drafts) {
        const [owner, path] = JSON.parse(id) as [string | null, string];
        if (owner === profile && !entry.created && !paths.has(path)) {
          if (isDirty(entry)) entry.missing = true;
          else drafts.delete(id);
        }
      }
    },
    create(profile: string | null, path: string, expected: FilesSource, text = "") {
      changed();
      if (drafts.has(key(profile, path))) return;
      drafts.set(key(profile, path), {
        text,
        baseline: "",
        source: "",
        expected,
        currentExpected: expected,
        revision: 0,
        created: true,
        missing: false,
      });
    },
    state(profile: string | null, path: string) {
      const entry = drafts.get(key(profile, path));
      return entry
        ? {
            ...entry,
            dirty: isDirty(entry),
            conflict:
              (entry.missing && !entry.missingReviewed) ||
              (isDirty(entry) &&
                (entry.source !== entry.baseline ||
                  JSON.stringify(entry.expected) !== JSON.stringify(entry.currentExpected))),
          }
        : null;
    },
    edit(profile: string | null, path: string, text: string) {
      changed();
      const entry = drafts.get(key(profile, path));
      if (entry && entry.text !== text) {
        entry.text = text;
        entry.revision++;
      }
    },
    acknowledge(profile: string | null, path: string, submitted: string, expected?: FilesSource) {
      changed();
      const entry = drafts.get(key(profile, path));
      if (entry) {
        entry.baseline = submitted;
        entry.source = submitted;
        entry.created = false;
        entry.missing = false;
        entry.missingReviewed = false;
        if (expected) {
          entry.expected = expected;
        } else if (!entry.expected) {
          entry.source = submitted;
        }
      }
    },
    /** The caller first shows current source and draft. Native still checks the reviewed source. */
    reviewCurrent(profile: string | null, path: string) {
      changed();
      const entry = drafts.get(key(profile, path));
      if (!entry || (entry.missing && entry.currentExpected?.sha256 !== null)) return false;
      entry.missingReviewed = entry.missing;
      entry.baseline = entry.source;
      entry.expected = entry.currentExpected;
      entry.created = false;
      return true;
    },
    discard(profile: string | null, path: string, source?: string) {
      changed();
      const entry = drafts.get(key(profile, path));
      if (entry?.created || entry?.missing) {
        drafts.delete(key(profile, path));
        return;
      }
      const text = source ?? entry?.source ?? "";
      drafts.set(key(profile, path), {
        text,
        baseline: text,
        source: text,
        expected: entry?.currentExpected,
        currentExpected: entry?.currentExpected,
        revision: (entry?.revision ?? 0) + 1,
        created: false,
        missing: false,
      });
    },
    selected(profile: string | null) {
      return selections.get(profile ?? "") ?? null;
    },
    select(profile: string | null, path: string) {
      selections.set(profile ?? "", path);
    },
  };
}
export type FilesDraftStore = ReturnType<typeof createFilesDraftStore>;
