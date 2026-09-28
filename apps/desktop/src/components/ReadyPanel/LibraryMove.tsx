import { useEffect, useState } from "react";
import type { LibraryMoveReview } from "../../lib/bridge";
import { Loading } from "../ui/Spinner";

/**
 * Shown when the saved profiles belong to another TF2 folder. After Steam
 * moves TF2 to another drive or library, the old folder is gone and the
 * profiles can be pointed at this install instead of disappearing.
 */
export function LibraryMove({
  running,
  busy,
  onReview,
  onMove,
  onChangeInstall,
}: {
  running: boolean;
  busy: boolean;
  onReview: () => Promise<LibraryMoveReview | null>;
  onMove: () => Promise<void>;
  onChangeInstall: () => void;
}) {
  const [review, setReview] = useState<LibraryMoveReview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    onReview()
      .then((next) => {
        if (!cancelled) setReview(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [onReview]);

  const count = review?.profileCount ?? 0;
  const profiles = count === 1 ? "1 profile" : `${count} profiles`;
  return (
    <div data-testid="library-move" className="max-w-lg">
      <p className="eyebrow">Profile library</p>
      <h1 className="t-pane mt-3">Your profiles are saved for another TF2 folder</h1>
      {failed ? (
        <p className="t-body mt-3 text-ink-muted">
          Profiles belong to another TF2 install. Choose that folder with Change install.
        </p>
      ) : !review ? (
        <p className="t-body mt-3 text-ink-muted">
          <Loading>Checking your profiles…</Loading>
        </p>
      ) : (
        <>
          <p className="t-body mt-3 text-ink-muted">
            {profiles} {count === 1 ? "was" : "were"} saved for TF2 at{" "}
            <span className="break-all text-ink">{review.libraryRoot}</span>.
          </p>
          <p className="t-body mt-2 text-ink-muted">
            {review.blockedReason ??
              "That folder no longer has TF2. If Steam moved TF2 here, move your profiles to this install. Their files stay the same and nothing in TF2 changes."}
          </p>
        </>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {review && !review.blockedReason ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || running}
            title={running ? "Close TF2 before moving your profiles." : undefined}
            onClick={() => void onMove()}
          >
            Move profiles here
          </button>
        ) : null}
        <button type="button" onClick={onChangeInstall} disabled={busy} className="btn btn-ghost">
          Change install
        </button>
      </div>
    </div>
  );
}
