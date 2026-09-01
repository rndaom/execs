import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { shouldReseedDraft } from "../lib/files-ui";

/**
 * A pane draft seeded from incoming props.
 *
 * `reload()` hands every pane brand-new object identities even when the bytes
 * are identical, so reseeding on identity alone silently discards whatever the
 * user was typing. This reseeds only when the *serialized* incoming value
 * really changed, and never over unsaved edits — unless `recordKey` changes,
 * which means a different record (profile, file, HUD) is now on screen and the
 * old draft no longer applies.
 */
export function useSeededDraft<T>(
  seed: T,
  serialize: (value: T) => string,
  recordKey?: string | null,
): [T, Dispatch<SetStateAction<T>>] {
  const [draft, setDraft] = useState<T>(seed);
  const lastSeeded = useRef<string | null>(null);
  const lastKey = useRef<string | null | undefined>(recordKey);

  // `draft` is read to decide whether there are unsaved edits, never depended
  // on: a reseed must be driven by incoming content, not by the user typing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  useEffect(() => {
    const next = serialize(seed);
    const keyChanged = lastKey.current !== recordKey;
    const dirty = lastSeeded.current !== null && serialize(draft) !== lastSeeded.current;
    if (!keyChanged && !shouldReseedDraft(lastSeeded.current, next, dirty)) {
      return;
    }
    lastKey.current = recordKey;
    lastSeeded.current = next;
    setDraft(seed);
  }, [seed, recordKey]);

  return [draft, setDraft];
}
