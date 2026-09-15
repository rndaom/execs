import type { ProfileLibraryState } from "../../hooks/useProfileLibrary";
import { Modal } from "../ui/Modal";

export function FolderRepair({
  review,
  busy,
  error,
  onRepair,
  onCancel,
}: {
  review: ProfileLibraryState["folderRepair"];
  busy: boolean;
  error: string | null;
  onRepair: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={review !== null}
      title="Repair folder names"
      description="TF2 reserves these folder names."
      onClose={() => {
        if (!busy) onCancel();
      }}
      testId="folder-repair-review"
      className="fixed top-1/2 left-1/2 z-50 w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 p-6"
    >
      <p className="t-body mt-3 text-ink-muted">
        In {review?.name}, rename these outer custom folders. The files inside keep their names and
        contents. Current folders are backed up before an active profile changes.
      </p>
      <ul className="mt-4 divide-y divide-edge">
        {review?.plan.map((rename) => (
          <li key={rename.from} className="flex flex-wrap justify-between gap-3 py-2">
            <code>{rename.from}</code>
            <span aria-hidden="true">→</span>
            <code>{rename.to}</code>
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="t-meta mt-3 text-error">
          {error}
        </p>
      ) : null}
      <div className="mt-5 flex gap-2">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onRepair}>
          Repair folder names
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
