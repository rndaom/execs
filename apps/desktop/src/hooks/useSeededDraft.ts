import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { shouldReseedDraft } from "../lib/files-ui";

/** Neither a profile id nor any record name can contain it. */
const SEPARATOR = "\u0000";

/**
 * The record a pane's draft belongs to.
 *
 * Every pane's key starts with the active profile id, so a switch discards the
 * drafts on screen even when the two profiles happen to hold identical bytes.
 * The remaining parts name the record within the profile (a file path, a HUD,
 * a crosshair record).
 */
export function draftRecordKey(profileId: string | null, ...parts: (string | null)[]): string {
  return [profileId ?? "", ...parts.map((part) => part ?? "")].join(SEPARATOR);
}

/** Whether an incoming seed replaces the draft currently on screen. */
export function shouldReseedFor(
  lastSeeded: string | null,
  next: string,
  dirty: boolean,
  keyChanged: boolean,
): boolean {
  return keyChanged || shouldReseedDraft(lastSeeded, next, dirty);
}

/**
 * A pane draft seeded from incoming props.
 *
 * `reload()` hands every pane brand-new object identities even when the bytes
 * are identical, so identity is no evidence of a change: the draft is reseeded
 * only when the *serialized* incoming value differs, and never over unsaved
 * edits. `recordKey` is the exception — a different key means a different
 * record (profile, file, HUD) is on screen, and the draft belongs to the old
 * one.
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
    if (!shouldReseedFor(lastSeeded.current, next, dirty, keyChanged)) {
      // An acknowledged save advances the baseline even while newer edits
      // remain on screen. Later external changes can then refresh a clean draft.
      lastSeeded.current = next;
      return;
    }
    lastKey.current = recordKey;
    lastSeeded.current = next;
    setDraft(seed);
  }, [seed, recordKey]);

  return [draft, setDraft];
}
