import { Folder, Info } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { useHudOwnershipReview } from "../hooks/useHudOwnershipReview";
import type { Api } from "../lib/api";
import { invokeErrorMessage, type ProfileDetail } from "../lib/bridge";
import { Alert } from "./ui/Alert";
import { Disclosure } from "./ui/Disclosure";
import { Modal } from "./ui/Modal";
import { OptionTile } from "./ui/OptionTile";
import { useToast } from "./ui/Toast";

export type HudOwnershipDialogProps = {
  api: Api;
  profile: { id: string; name: string } | null;
  running: boolean;
  busy: boolean;
  onClose: () => void;
  onApplied: (detail: ProfileDetail) => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
};

export function HudOwnershipDialog(props: HudOwnershipDialogProps) {
  if (!props.profile) return null;
  return <HudOwnershipReview key={props.profile.id} {...props} profile={props.profile} />;
}

function HudOwnershipReview({
  api,
  profile,
  running,
  busy,
  onClose,
  onApplied,
  onBusyChange,
}: HudOwnershipDialogProps & { profile: { id: string; name: string } }) {
  const ownership = useHudOwnershipReview(api, profile.id, { running, busy });
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const toast = useToast();
  const instance = useId();
  const working = ownership.applying || refreshing;
  const source = `hud:ownership:${profile.id}`;
  const candidates = ownership.review?.candidates ?? [];
  const managedOptionFiles = ownership.review?.managedOptionFiles ?? [];
  const resetsOptions =
    ownership.review?.resetOptions ||
    (ownership.selectedFolder !== null &&
      ownership.selectedFolder !== ownership.review?.selectedHud &&
      managedOptionFiles.length > 0);

  useEffect(() => {
    onBusyChange?.(working);
    return () => onBusyChange?.(false);
  }, [working, onBusyChange]);

  function close() {
    if (!working) onClose();
  }

  async function confirm() {
    if (working || running || busy) return;
    let detail = ownership.applied;
    if (!detail) {
      toast.startSave(source);
      try {
        detail = await ownership.apply();
        if (!detail) {
          toast.cancelSave(source);
          return;
        }
        toast.finishSave("Profile HUD selected", source);
      } catch (err) {
        toast.failSave(err, "Could not select the profile HUD", source);
        return;
      }
    }
    setRefreshing(true);
    setRefreshError(null);
    try {
      await onApplied(detail);
      onClose();
    } catch (err) {
      // The native selection is already committed. Retry only the parent
      // refresh; never repeat the file operation because a follow-up read failed.
      setRefreshError(
        `The HUD was selected, but the profile view could not refresh. ${invokeErrorMessage(err)}`,
      );
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Modal
      open
      title="Choose this profile’s HUD"
      description={`${profile.name} will use one HUD.`}
      testId="hud-ownership-dialog"
      onClose={close}
      initialFocusRef={cancelRef}
      className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(580px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden sm:p-6"
    >
      <div className="min-h-0 overflow-y-auto" data-testid="hud-ownership-body">
        {ownership.loading ? (
          <p role="status" className="t-body mt-5 text-ink-muted">
            Reading HUD folders…
          </p>
        ) : null}
        {ownership.error ? (
          <Alert className="mt-5" testId="hud-ownership-error">
            <span className="block">{ownership.error}</span>
            <button
              type="button"
              className="btn btn-ghost mt-3"
              disabled={working}
              onClick={() => void ownership.reload()}
            >
              Read HUD folders again
            </button>
          </Alert>
        ) : null}
        {ownership.review && candidates.length === 0 ? (
          <p className="t-body mt-5 text-ink-muted">No HUD folders were found for this profile.</p>
        ) : null}
        {candidates.length > 0 ? (
          <fieldset className="mt-5 space-y-2" disabled={working || ownership.applied !== null}>
            <legend className="t-row mb-3">HUD to keep active</legend>
            {candidates.map((candidate, index) => (
              <OptionTile
                key={`${candidate.source}:${candidate.folder}`}
                id={`hud-ownership-${instance}-${index}`}
                name={`hud-ownership-${instance}`}
                value={candidate.folder}
                testId={`hud-ownership-choice-${index}`}
                title={
                  <span className="flex min-w-0 items-start gap-2">
                    <Folder size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
                    <span className="break-all">{candidate.folder}</span>
                  </span>
                }
                description={`${candidate.source === "live" ? "Installed in TF2" : "Saved in profile"} · ${candidate.files.toLocaleString()} ${candidate.files === 1 ? "file" : "files"}${candidate.folder === ownership.review?.selectedHud ? " · Current selection" : ""}`}
                selected={ownership.selectedFolder === candidate.folder}
                disabled={working || ownership.applied !== null}
                onSelect={() => ownership.select(candidate.folder)}
              />
            ))}
          </fieldset>
        ) : null}

        {resetsOptions ? (
          <Alert tone="info" className="mt-4" testId="hud-ownership-option-reset">
            Reset{" "}
            <span className="break-all font-medium text-ink">
              {managedOptionFiles.length ? managedOptionFiles.join(", ") : "saved HUD options"}
            </span>{" "}
            and {managedOptionFiles.length === 1 ? "its" : "their"} startup lines for the chosen
            HUD. Original files are kept in recovery copies.
          </Alert>
        ) : null}

        <div className="mt-5 flex items-start gap-2 border-t border-edge pt-4">
          <Info size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-muted" />
          <p className="t-meta">Original HUD copies are kept for recovery.</p>
        </div>
        <Disclosure
          profileId={profile.id}
          storageKey="hud-ownership-originals"
          summary="What happens to the other HUDs"
          className="mt-3"
        >
          <p className="t-meta mt-3">
            The chosen HUD keeps its contents. Other HUDs move out of the active setup and are kept
            as original copies for manual recovery; they will not stay selectable inside this
            profile.
          </p>
        </Disclosure>

        {running ? (
          <p className="t-meta mt-4" role="status">
            Close TF2 before selecting this profile’s HUD.
          </p>
        ) : busy && !working ? (
          <p className="t-meta mt-4" role="status">
            Wait for the current operation to finish.
          </p>
        ) : null}
        {refreshError ? <Alert className="mt-4">{refreshError}</Alert> : null}
      </div>
      <div
        className="mt-5 flex shrink-0 flex-wrap justify-end gap-2 border-t border-edge pt-4"
        aria-busy={working}
      >
        <button
          ref={cancelRef}
          type="button"
          className="btn btn-ghost"
          disabled={working}
          onClick={close}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="hud-ownership-confirm"
          disabled={working || running || busy || (!ownership.applied && !ownership.canApply)}
          onClick={() => void confirm()}
        >
          {ownership.applying
            ? "Selecting HUD…"
            : refreshing
              ? "Refreshing profile…"
              : ownership.applied
                ? "Refresh profile view"
                : "Use selected HUD"}
        </button>
      </div>
    </Modal>
  );
}
