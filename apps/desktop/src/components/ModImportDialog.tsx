import { useState } from "react";
import type { ModImportReview } from "../lib/bridge";
import { formatModBytes } from "../lib/mods-ui";
import { Caret } from "./ui/Caret";
import { Modal } from "./ui/Modal";
import { SwitchRow } from "./ui/Switch";

/** Where the pack sits in the archive (when that adds anything), its size and content. */
export function modChoiceDescription(choice: ModImportReview["choices"][number]): string {
  const where = choice.path !== "." && choice.path !== choice.name ? [choice.path] : [];
  return [
    ...where,
    `${choice.files} ${choice.files === 1 ? "file" : "files"}`,
    formatModBytes(choice.bytes),
    ...(choice.contentRoots.length ? [choice.contentRoots.join(", ")] : []),
  ].join(" · ");
}

/**
 * Why a choice that ships TF2's hit or kill sound needs a second look: those
 * files compete with the ones Sounds manages.
 */
export function modChoiceSoundNote(choice: ModImportReview["choices"][number]): string | null {
  const slots = choice.soundSlots ?? [];
  if (slots.length === 0) return null;
  const what =
    slots.length === 2 ? "hit and kill sounds" : slots[0] === "hit" ? "hit sound" : "kill sound";
  return `Also replaces TF2's ${what}, which can override what you chose in Sounds. To use only those sounds, choose them in Sounds instead.`;
}

/** The native review owns the payload; this dialog returns only selected opaque IDs. */
export function ModImportDialog({
  review,
  onClose,
  onConfirm,
}: {
  review: ModImportReview;
  onClose: () => void;
  onConfirm: (choices: string[]) => void;
}) {
  // A lone choice starts selected, unless it would replace a Sounds file.
  const [selected, setSelected] = useState<string[]>(() => {
    const available = review.choices.filter((choice) => !choice.disabledReason);
    return available.length === 1 && !modChoiceSoundNote(available[0]) ? [available[0].id] : [];
  });
  return (
    <Modal
      open
      title="Choose mod files"
      description="Each part installs as its own pack. Pick only one of any alternatives."
      onClose={onClose}
      className="w-[min(60rem,calc(100vw-2rem))]"
    >
      <div className={review.readmes.length ? "grid gap-6 lg:grid-cols-2" : ""}>
        <div>
          {review.choices.map((choice) => (
            <SwitchRow
              key={choice.id}
              id={`mod-choice-${choice.id}`}
              label={choice.name}
              description={modChoiceDescription(choice)}
              note={choice.disabledReason ?? modChoiceSoundNote(choice) ?? undefined}
              disabled={!!choice.disabledReason}
              checked={selected.includes(choice.id)}
              onChange={(checked) =>
                setSelected((current) =>
                  checked ? [...current, choice.id] : current.filter((id) => id !== choice.id),
                )
              }
            />
          ))}
        </div>
        {review.readmes.length ? (
          <aside aria-label="Author's instructions" className="min-w-0">
            {review.readmes.map((readme, index) => (
              <details
                key={readme.path}
                open={index === 0}
                className="disclosure mb-3 rounded border border-edge p-3"
              >
                <summary className="t-row cursor-pointer break-words">
                  <Caret fold />
                  {readme.path}
                </summary>
                <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-sans text-[13px] leading-5 text-ink-muted">
                  {readme.text}
                </pre>
                {readme.truncated ? (
                  <p className="t-meta mt-2">Showing the first 16 KiB of this file.</p>
                ) : null}
              </details>
            ))}
          </aside>
        ) : null}
      </div>
      <div className="pane-actions mt-5 justify-end">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!selected.length}
          onClick={() => onConfirm(selected)}
        >
          Install selected
        </button>
      </div>
    </Modal>
  );
}
