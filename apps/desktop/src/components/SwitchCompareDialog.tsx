import { useEffect, useRef, useState } from "react";
import { invokeErrorMessage } from "../lib/bridge";
import type { ProfileComparison } from "../lib/switch-compare-ui";
import { ComparisonTable } from "./ComparisonTable";
import { Modal } from "./ui/Modal";
import { Loading } from "./ui/Spinner";

/**
 * Read-only preview of what a switch replaces. Switch re-reads the comparison
 * first: if either profile changed since it opened, the new result is shown
 * for review instead of switching.
 */
export function SwitchCompareDialog({
  targetId,
  activeId,
  switchDisabled,
  onCompare,
  onSwitch,
  onClose,
}: {
  targetId: string | null;
  activeId: string | null;
  switchDisabled: boolean;
  onCompare: (id: string) => Promise<ProfileComparison>;
  onSwitch: (id: string) => void;
  onClose: () => void;
}) {
  const [comparison, setComparison] = useState<ProfileComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [stale, setStale] = useState(false);
  const request = useRef(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new target or active profile invalidates the preview.
  useEffect(() => {
    const id = ++request.current;
    setComparison(null);
    setError(null);
    setStale(false);
    if (!targetId) return;
    onCompare(targetId)
      .then((result) => {
        if (id === request.current) setComparison(result);
      })
      .catch((err: unknown) => {
        if (id === request.current) setError(invokeErrorMessage(err));
      });
  }, [targetId, activeId]);

  async function confirm() {
    if (!comparison) return;
    const id = ++request.current;
    setChecking(true);
    try {
      const fresh = await onCompare(comparison.toId);
      if (id !== request.current) return;
      if (fresh.revision !== comparison.revision || fresh.fromId !== comparison.fromId) {
        setComparison(fresh);
        setStale(true);
        return;
      }
      onClose();
      onSwitch(fresh.toId);
    } catch (err) {
      if (id === request.current) setError(invokeErrorMessage(err));
    } finally {
      if (id === request.current) setChecking(false);
    }
  }

  return (
    <Modal
      open={targetId !== null}
      title={
        comparison
          ? `${comparison.fromName} → ${comparison.toName}`
          : "Compare with current profile"
      }
      testId="switch-compare"
      className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto sm:p-6"
      onClose={onClose}
    >
      {!comparison && !error ? (
        <p className="t-body text-ink-muted">
          <Loading>Comparing profiles…</Loading>
        </p>
      ) : null}
      {stale ? (
        <p role="alert" className="t-body mt-2 text-warn" data-testid="switch-compare-stale">
          A profile changed since this opened. Review the differences again.
        </p>
      ) : null}
      {comparison ? (
        <>
          <p className="t-meta mt-1">
            Switching replaces your setup with {comparison.toName} exactly. This shows saved
            profiles; changes made in TF2 since the last save are picked up first.
          </p>
          <ComparisonTable
            comparison={comparison}
            testIdPrefix="switch-compare"
            sameText="These profiles have the same setup."
          />
          {comparison.blocked ? (
            <p role="alert" className="t-body mt-4 text-warn">
              Switching is not possible yet: {comparison.blocked}
            </p>
          ) : null}
        </>
      ) : null}
      {error ? (
        <p role="alert" className="t-body mt-2 text-error">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="switch-compare-confirm"
          disabled={!comparison || !!comparison.blocked || switchDisabled || checking}
          onClick={() => void confirm()}
        >
          {checking ? <Loading>Checking…</Loading> : `Switch to ${comparison?.toName ?? "profile"}`}
        </button>
      </div>
    </Modal>
  );
}
