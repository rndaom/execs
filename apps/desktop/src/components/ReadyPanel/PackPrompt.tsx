import type { AbsorbDelta } from "../../lib/bridge";
import { Modal } from "../ui/Modal";

/**
 * "Custom files changed" — the mechanism for adopting pack changes after a
 * TF2 session (RND-150). Update is the default action, on Enter as well as on
 * click; dismissing only defers it, so the question is re-offered later.
 */
export function PackPrompt({
  delta,
  busy,
  onChoice,
  onDefer,
}: {
  delta: AbsorbDelta | null;
  busy: boolean;
  onChoice: (choice: "update" | "keep") => void;
  onDefer: () => void;
}) {
  return (
    <Modal
      open={delta !== null}
      role="alertdialog"
      testId="absorb-pack-prompt"
      title="Custom files changed"
      description="TF2 changed packs in custom. Update the active profile?"
      className="fixed top-20 right-5 z-50 w-[min(390px,calc(100vw-2.5rem))]"
      onClose={onDefer}
      onDefaultAction={() => onChoice("update")}
    >
      {delta && delta.packsAdded.length > 0 ? (
        <p className="t-meta mt-2">Added: {delta.packsAdded.join(", ")}</p>
      ) : null}
      {delta && delta.packsRemoved.length > 0 ? (
        <p className="t-meta mt-1">Removed: {delta.packsRemoved.join(", ")}</p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          data-testid="absorb-pack-update"
          disabled={busy}
          onClick={() => onChoice("update")}
          className="btn btn-primary"
        >
          Update profile
        </button>
        <button
          type="button"
          data-testid="absorb-pack-keep"
          disabled={busy}
          onClick={() => onChoice("keep")}
          className="btn btn-ghost"
        >
          Keep profile
        </button>
      </div>
      <p className="mt-3 text-[12px] text-ink-faint">
        Escape defers this — execs asks again rather than deciding for you.
      </p>
    </Modal>
  );
}
