import { useState } from "react";
import type { TidyReport } from "../lib/bridge";
import { tidyDetails, tidySummary } from "../lib/tidy-up-ui";
import { Modal } from "./ui/Modal";

/** Longer lists (30 sound caches, say) are summarized after this many names. */
const DETAIL_ITEMS = 8;

/**
 * The one quiet notice after execs tidied up leftovers from earlier versions.
 * Details lists every change; a missing Valve cfg offers Steam's verify.
 */
export function TidyUpNotice({
  report,
  running,
  onVerify,
  onDismiss,
}: {
  report: TidyReport;
  running: boolean;
  /** Ask Steam to verify TF2 when Valve's cfgs are missing from it. */
  onVerify: () => void;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const sections = tidyDetails(report);
  return (
    <div
      role="status"
      data-testid="tidy-up-notice"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b border-edge bg-panel px-5 py-2"
    >
      <p className="t-body min-w-0 flex-1 text-ink-muted">{tidySummary(report)}</p>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        Details
      </button>
      <button type="button" className="btn btn-quiet" onClick={onDismiss}>
        Dismiss
      </button>
      <Modal
        open={open}
        title="Tidied up after the update"
        description="Only files older versions of execs left behind. Packs, your own files and hand edits were not touched."
        onClose={() => setOpen(false)}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        {report.valveCfgsMissing > 0 ? (
          <div className="mt-4 rounded border border-warn/50 bg-warn/10 p-3">
            <p className="t-meta text-ink">
              {report.valveCfgsMissing === 1
                ? "One of Valve's own cfgs is"
                : `${report.valveCfgsMissing} of Valve's own cfgs are`}{" "}
              missing from TF2's cfg folder. Verifying TF2 in Steam puts them back.
            </p>
            <button
              type="button"
              className="btn btn-ghost mt-2"
              disabled={running}
              title={running ? "Close TF2 first." : undefined}
              onClick={() => {
                setOpen(false);
                onVerify();
              }}
            >
              Verify TF2 in Steam
            </button>
          </div>
        ) : null}
        {sections.map((section) => (
          <section key={section.title} className="mt-4">
            <h3 className="t-meta text-ink">{section.title}</h3>
            <ul className="t-meta mt-1 list-disc space-y-0.5 pl-5 text-ink-muted">
              {section.items.slice(0, DETAIL_ITEMS).map((item) => (
                <li key={item} className="break-all">
                  {item}
                </li>
              ))}
              {section.items.length > DETAIL_ITEMS ? (
                <li>and {section.items.length - DETAIL_ITEMS} more</li>
              ) : null}
            </ul>
          </section>
        ))}
        <div className="mt-6 flex justify-end">
          <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      </Modal>
    </div>
  );
}
