type FileDraft = { text: string; baseline: string; source: string };
export type DirtyFileDraft = { profile: string | null; path: string; text: string };

/** Session-owned drafts never cross profile identities or write themselves to disk. */
export function createFilesDraftStore() {
  const drafts = new Map<string, FileDraft>();
  const selections = new Map<string, string>();
  const key = (profile: string | null, path: string) => JSON.stringify([profile, path]);
  return {
    dirty(): DirtyFileDraft[] {
      return [...drafts]
        .filter(([, entry]) => entry.text !== entry.baseline)
        .map(([id, entry]) => {
          const [profile, path] = JSON.parse(id) as [string | null, string];
          return { profile, path, text: entry.text };
        });
    },
    discardAll() {
      for (const entry of drafts.values()) entry.text = entry.baseline;
    },
    read(profile: string | null, path: string, source: string): string {
      const id = key(profile, path);
      const entry = drafts.get(id);
      if (!entry) {
        drafts.set(id, { text: source, baseline: source, source });
        return source;
      }
      if (entry.source !== source) {
        if (entry.text === entry.baseline) entry.text = source;
        entry.baseline = source;
        entry.source = source;
      }
      return entry.text;
    },
    edit(profile: string | null, path: string, text: string) {
      const entry = drafts.get(key(profile, path));
      if (entry) entry.text = text;
    },
    acknowledge(profile: string | null, path: string, submitted: string) {
      const entry = drafts.get(key(profile, path));
      if (entry) entry.baseline = submitted;
    },
    discard(profile: string | null, path: string, source: string) {
      drafts.set(key(profile, path), { text: source, baseline: source, source });
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
