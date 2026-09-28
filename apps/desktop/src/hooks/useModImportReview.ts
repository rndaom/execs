import { useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import type { ModImportReview } from "../lib/bridge";

/** Cancellation releases the native snapshot and never reaches the write command. */
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

  async function prepare(request: () => Promise<ModImportReview | null>) {
    const expected = context.current;
    const epoch = generation.current;
    const next = await request();
    if (!next) return null;
    if (
      generation.current !== epoch ||
      context.current.profileId !== expected.profileId ||
      !context.current.active
    ) {
      await api.cancelModImport(next.token);
      return null;
    }
    close(null);
    const ids = await new Promise<string[] | null>((resolve) => {
      pending.current = { review: next, resolve };
      setReview(next);
    });
    if (!ids) return null;
    await api.confirmModImport(next.token, ids);
    return true;
  }

  return { review, prepare, cancel: () => close(null), confirm: (ids: string[]) => close(ids) };
}
