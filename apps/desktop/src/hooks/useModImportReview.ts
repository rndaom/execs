import { useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import type { ModImportReview } from "../lib/bridge";

/** The one installable choice when nothing needs the player's decision. */
export function onlyModImportChoice(review: ModImportReview): string | null {
  const [only] = review.choices;
  return review.choices.length === 1 && !only.disabledReason ? only.id : null;
}

export type ChosenModImport = { token: string; ids: string[] };

/**
 * Holds the chooser for a prepared native mod review. Preparing (download,
 * extraction) and installing run as settings writes; choosing sits between
 * them, so the header never says "Installing" while the player reads the
 * author's instructions and other saves are not held behind the dialog.
 * Cancellation releases the native snapshot and never reaches the write command.
 */
export function useModImportReview(
  api: Api,
  profileId: string | null | undefined,
  active: boolean,
) {
  const [review, setReview] = useState<ModImportReview | null>(null);
  const pending = useRef<{
    review: ModImportReview;
    resolve: (ids: string[] | null) => void;
  } | null>(null);
  const generation = useRef(0);
  const context = useRef({ profileId, active });
  context.current = { profileId, active };

  function close(ids: string[] | null) {
    const current = pending.current;
    pending.current = null;
    setReview(null);
    if (!current) return;
    if (ids === null) void api.cancelModImport(current.review.token).catch(() => {});
    current.resolve(ids);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: each pane/profile lifetime invalidates pending native reviews.
  useEffect(() => {
    return () => {
      generation.current += 1;
      const current = pending.current;
      pending.current = null;
      if (current) {
        void api.cancelModImport(current.review.token).catch(() => {});
        current.resolve(null);
      }
      setReview(null);
    };
  }, [api, profileId, active]);

  /** Snapshot the pane/profile a preparation starts in. */
  function begin() {
    return { expected: context.current, epoch: generation.current };
  }

  /**
   * Ask the player which prepared packs to install. A review with a single
   * installable choice installs it directly, as before the chooser existed.
   * `null` means cancelled or superseded by a pane or profile change.
   */
  async function choose(
    next: ModImportReview,
    started: ReturnType<typeof begin>,
  ): Promise<ChosenModImport | null> {
    if (
      generation.current !== started.epoch ||
      context.current.profileId !== started.expected.profileId ||
      !context.current.active
    ) {
      await api.cancelModImport(next.token).catch(() => {});
      return null;
    }
    const only = onlyModImportChoice(next);
    if (only !== null) return { token: next.token, ids: [only] };
    close(null);
    const ids = await new Promise<string[] | null>((resolve) => {
      pending.current = { review: next, resolve };
      setReview(next);
    });
    return ids ? { token: next.token, ids } : null;
  }

  return {
    review,
    begin,
    choose,
    cancel: () => close(null),
    confirm: (ids: string[]) => close(ids),
  };
}
