import { Check } from "@phosphor-icons/react";
import type { ProfileLibraryState } from "../hooks/useProfileLibrary";
import { Modal } from "./ui/Modal";

const STAGES = ["Read ZIP", "Review files", "Save profile"];

export function ProfileImportDialog({
  profiles,
  running,
}: {
  profiles: Pick<
    ProfileLibraryState,
    | "importStage"
    | "importReview"
    | "importedProfile"
    | "dismissImport"
    | "cancelImport"
    | "confirmImport"
    | "switchProfile"
  >;
  running: boolean;
}) {
  const { importStage: stage, importReview: review, importedProfile } = profiles;
  if (!stage || stage === "selecting") return null;
  const complete = stage === "done";
  const working = stage === "reading" || stage === "saving";
  const index = stage === "reading" ? 0 : stage === "review" ? 1 : 2;
  const title = complete
    ? "Profile imported"
    : stage === "review"
      ? "Review profile import"
      : "Importing profile";
  const close = () => {
    if (complete) profiles.dismissImport();
    else if (!working) void profiles.cancelImport();
  };

  return (
    <Modal
      key={stage}
      open
      title={title}
      testId="profile-import-dialog"
      description={
        complete
          ? `${importedProfile?.name ?? review?.name} is ready to use.`
          : "Create a profile from a ZIP."
      }
      className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto sm:p-6"
      onClose={close}
    >
      <div role="status" aria-live="polite" aria-busy={working} className="mt-5">
        <p className="t-meta text-ink">
          {stage === "reading"
            ? "Reading files and checking the archive…"
            : stage === "saving"
              ? "Verifying the ZIP and saving your new profile…"
              : complete
                ? "All steps done"
                : "Ready for your review"}
        </p>
        <div
          role="progressbar"
          aria-label="Profile import stages"
          aria-valuemin={0}
          aria-valuemax={3}
          aria-valuenow={stage === "reading" ? undefined : complete ? 3 : index}
          aria-valuetext={complete ? "Profile saved" : STAGES[index]}
          className="mt-3 h-1 overflow-hidden rounded-pill bg-bg"
        >
          <div
            className={`h-full rounded-pill bg-ink-muted transition-[width] duration-200 motion-reduce:transition-none ${stage === "reading" ? "animate-pulse motion-reduce:animate-none" : ""}`}
            style={{
              width: stage === "reading" ? "25%" : `${((complete ? 3 : index) / 3) * 100}%`,
            }}
          />
        </div>
        <ol className="mt-3 flex justify-between gap-3">
          {STAGES.map((label, i) => (
            <li
              key={label}
              aria-current={!complete && i === index ? "step" : undefined}
              className={`t-meta flex items-center gap-2 ${complete || i <= index ? "text-ink" : "text-ink-faint"}`}
            >
              <span
                aria-hidden="true"
                className="flex size-4 shrink-0 items-center justify-center rounded-full border border-edge text-[10px]"
              >
                {complete || i < index ? <Check size={10} /> : i + 1}
              </span>
              {label}
            </li>
          ))}
        </ol>
      </div>

      {stage === "review" && review ? (
        <>
          <div className="mt-5 border-t border-edge pt-5">
            <p className="t-row break-words">{review.name}</p>
            <p className="t-meta mt-1">
              {review.files} files to import
              {review.skippedFiles > 0 ? ` · ${review.skippedFiles} left out` : ""}
            </p>
            <p className="t-body mt-3 text-ink-muted">
              Your current profile stays active until you switch.
            </p>
          </div>
          {review.creator ? (
            <p className="t-body mt-4 text-ink-muted">
              Import only if you trust this creator. Their cfg commands run when TF2 loads them.
              Saved server credentials are kept too; profiles containing them cannot be exported.
            </p>
          ) : null}
          {review.creator || review.notes.length > 0 || review.warnings.length > 0 ? (
            <details className="mt-4 border-t border-edge pt-4">
              <summary className="t-body cursor-pointer text-ink">
                {review.warnings.length > 0
                  ? `Config checks flagged ${review.warnings.length} ${review.warnings.length === 1 ? "file" : "files"}`
                  : "Import details"}
              </summary>
              <div className="t-meta mt-3 space-y-3 break-words">
                {review.creator ? (
                  <p>
                    Launch options are left empty. Optional mod variants, nested archives,
                    instructions and unsupported files remain in the source ZIP.
                  </p>
                ) : null}
                {review.notes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
                {review.warnings.length > 0 ? (
                  <p>First finding per file. These commands will be kept unchanged:</p>
                ) : null}
                {review.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            </details>
          ) : null}
        </>
      ) : null}

      {running && !complete ? (
        <p role="status" className="t-meta mt-4">
          Close TF2 to import this profile.
        </p>
      ) : null}
      {!working ? (
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-edge pt-4">
          <button type="button" className="btn btn-ghost" onClick={close}>
            {complete ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={running || (complete && !importedProfile)}
            onClick={() => {
              if (complete && importedProfile) {
                profiles.dismissImport();
                void profiles.switchProfile(importedProfile.id);
              } else void profiles.confirmImport();
            }}
          >
            {complete
              ? "Switch to profile"
              : review?.creator
                ? "Trust and import"
                : "Import profile"}
          </button>
        </div>
      ) : null}
    </Modal>
  );
}
