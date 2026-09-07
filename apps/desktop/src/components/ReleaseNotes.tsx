import { ArrowSquareOut } from "@phosphor-icons/react";
import type { Api } from "../lib/api";
import { githubReleaseUrl, releaseNotesSections } from "../lib/release-notes-ui";
import type { AppUpdateInfo } from "../lib/updater-ui";
import { Modal } from "./ui/Modal";

export function ReleaseNotes({
  api,
  release,
  onClose,
  onError,
}: {
  api: Api;
  release: AppUpdateInfo | null;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const sections = releaseNotesSections(release?.notes ?? null);
  return (
    <Modal
      open={release !== null}
      testId="release-notes"
      title={release ? `What's new in execs ${release.version}` : "What's new"}
      description="Your update is installed and ready."
      className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-3rem)] w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6"
      onClose={onClose}
      onDefaultAction={onClose}
    >
      <div className="mt-6 space-y-5">
        {sections.length > 0 ? (
          sections.map((section) => (
            <section key={`${section.title ?? "notes"}:${section.items.join("|")}`}>
              {section.title ? <p className="t-row mb-2">{section.title}</p> : null}
              <ul className="space-y-2.5 text-[13.5px] leading-5 text-ink-muted">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-[8px] size-1 shrink-0 rounded-full bg-ink-faint"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <p className="t-body text-ink-muted">
            This release is installed. View the complete notes on GitHub.
          </p>
        )}
      </div>
      <div className="mt-7 flex justify-end gap-2 border-t border-edge pt-4">
        <button
          type="button"
          className="btn btn-ghost inline-flex items-center gap-1.5"
          onClick={() => {
            if (!release) return;
            void api
              .openExternal(githubReleaseUrl(release.version))
              .catch(() => onError("Could not open the release page."));
          }}
        >
          View on GitHub
          <ArrowSquareOut size={13} aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
