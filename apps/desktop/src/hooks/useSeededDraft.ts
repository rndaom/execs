import { type Dispatch, type SetStateAction, useCallback, useState } from "react";
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
  const next = serialize(seed);
  const [state, setState] = useState(() => ({ draft: seed, seeded: next, recordKey }));
  let current = state;

  // Reconcile before effects can observe the draft. A reload can publish new
  // settings and lift the write lock together: effect-based reseeding exposed
  // the old draft against the new seed, and autosave immediately wrote it back.
  // State (rather than render-time ref mutation) also keeps discarded renders
  // from advancing the baseline.
  if (state.seeded !== next || state.recordKey !== recordKey) {
    const dirty = serialize(state.draft) !== state.seeded;
    const reseed = shouldReseedFor(state.seeded, next, dirty, state.recordKey !== recordKey);
    current = {
      draft: reseed ? seed : state.draft,
      // An acknowledged save advances the baseline while newer edits remain.
      seeded: next,
      recordKey,
    };
    setState(current);
  }

  const setDraft = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    setState((previous) => {
      const draft =
        typeof update === "function" ? (update as (value: T) => T)(previous.draft) : update;
      return Object.is(draft, previous.draft) ? previous : { ...previous, draft };
    });
  }, []);

  return [current.draft, setDraft];
}
