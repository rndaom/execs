import { useState } from "react";
import type { AbsorbDelta, PackAction, PackDecision } from "../../lib/bridge";
import { packConsequence, packDecisions } from "../../lib/pack-prompt-ui";
import { Modal } from "../ui/Modal";
import { Segmented } from "../ui/Segmented";

export function PackPrompt({
  delta,
  profileName,
  busy,
  onChoice,
  onDefer,
  onRefresh,
}: {
  delta: AbsorbDelta | null;
  profileName: string;
  busy: boolean;
  onChoice: (choices: PackDecision[]) => void;
  onDefer: () => void;
  onRefresh: () => void;
}) {
  // Reset the local choices for each complete native snapshot, even when its
  // pack names happen to match a previous profile or deferred review.
  const [draft, setDraft] = useState<{ delta: AbsorbDelta | null; decisions: PackDecision[] }>({
    delta,
    decisions: delta ? packDecisions(delta) : [],
  });
  if (draft.delta !== delta) {
    setDraft({ delta, decisions: delta ? packDecisions(delta) : [] });
  }
  const decisions = draft.delta === delta ? draft.decisions : delta ? packDecisions(delta) : [];
  const apply = () => {
    if (!busy && delta) onChoice(decisions);
  };
  return (
    <Modal
      open={delta !== null}
      testId="absorb-pack-prompt"
      title="Custom files changed"
      description={
        <>
          Choose what to save in <strong className="break-words">{profileName}</strong>.
        </>
      }
      onClose={() => {
        if (!busy) onDefer();
      }}
      onDefaultAction={apply}
    >
      <div className="mt-4 max-h-[50dvh] space-y-4 overflow-y-auto pr-1">
        {decisions.map(({ pack, choice }, index) => {
          const added = delta?.packsAdded.includes(pack) ?? false;
          return (
            <div key={pack} className="space-y-2 border-b border-edge pb-4 last:border-0">
              <p className="t-row break-words">{pack}</p>
              <p className="t-meta text-ink-faint">{added ? "Added to TF2" : "Missing from TF2"}</p>
              <Segmented<PackAction>
                label={`What to do with ${pack}`}
                size="sm"
                value={choice}
                disabled={busy}
                testIdPrefix={`pack-choice-${index}`}
                options={
                  added
                    ? [
                        { id: "add", label: "Add to profile" },
                        { id: "keep", label: "Leave in TF2" },
                      ]
                    : [
                        { id: "remove", label: "Remove from profile" },
                        { id: "restore", label: "Restore" },
                        { id: "keep", label: "Keep saved" },
                      ]
                }
                onChange={(next) =>
                  setDraft({
                    delta,
                    decisions: decisions.map((decision) =>
                      decision.pack === pack ? { pack, choice: next } : decision,
                    ),
                  })
                }
              />
              <p className="t-meta text-ink-faint">{packConsequence(choice, added)}</p>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="absorb-pack-update"
          disabled={busy}
          onClick={apply}
          className="btn btn-primary"
        >
          Apply choices
        </button>
        <button type="button" disabled={busy} onClick={onDefer} className="btn btn-ghost">
          Decide later
        </button>
        <button type="button" disabled={busy} onClick={onRefresh} className="btn btn-ghost">
          Refresh review
        </button>
      </div>
      <p className="mt-3 t-meta text-ink-faint">
        Decide later or Escape defers these choices until the next TF2 session or profile switch.
      </p>
    </Modal>
  );
}
