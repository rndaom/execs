import { useState } from "react";
import type { ModImportReview } from "../lib/bridge";
import { formatModBytes } from "../lib/mods-ui";
import { ClassTabs } from "./ui/ClassTabs";
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
        {review.readmes.length ? <ModReadmes readmes={review.readmes} /> : null}
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

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** The author's readmes, one at a time: a tab per file when there are several. */
function ModReadmes({ readmes }: { readmes: ModImportReview["readmes"] }) {
  const [index, setIndex] = useState(0);
  const readme = readmes[Math.min(index, readmes.length - 1)];
  const names = readmes.map((item) => fileName(item.path));
  const labels = readmes.map((item, at) =>
    names.indexOf(names[at]) === names.lastIndexOf(names[at]) ? names[at] : item.path,
  );
  const shown = Math.min(index, readmes.length - 1);
  const body = (
    <>
      <p className="t-row break-words">{readme.path}</p>
      <pre className="surface mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 font-sans text-[13px] leading-5 text-ink-muted">
        {readme.text}
      </pre>
      {readme.truncated ? (
        <p className="t-meta mt-2">Showing the first 16 KiB of this file.</p>
      ) : null}
    </>
  );
  return (
    <aside aria-label="Author's instructions" className="min-w-0">
      {readmes.length > 1 ? (
        <>
          <ClassTabs
            tabs={readmes.map((_, at) => ({ id: String(at), label: labels[at] }))}
            selected={String(shown)}
            label="Author's files"
            idPrefix="mod-readme"
            panelId="mod-readme-panel"
            onSelect={(id) => setIndex(Number(id))}
          />
          <div
            id="mod-readme-panel"
            role="tabpanel"
            aria-labelledby={`mod-readme-${shown}`}
            className="pt-3"
          >
            {body}
          </div>
        </>
      ) : (
        body
      )}
    </aside>
  );
}
