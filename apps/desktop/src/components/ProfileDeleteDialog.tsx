import { ArrowRight, DownloadSimple, Info } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import type { ProfileLibraryState } from "../hooks/useProfileLibrary";
import { Modal } from "./ui/Modal";
import { OptionTile } from "./ui/OptionTile";

type Props = {
  profiles: Pick<
    ProfileLibraryState,
    "library" | "deleteTarget" | "deleting" | "deleteError" | "confirmDelete" | "cancelDelete"
  > & { exportProfile: (id: string) => Promise<void> };
  running: boolean;
  busy: boolean;
};

export function ProfileDeleteDialog(props: Props) {
  if (!props.profiles.deleteTarget) return null;
  return <DeleteReview key={props.profiles.deleteTarget.id} {...props} />;
}

function DeleteReview({ profiles, running, busy }: Props) {
  const [choice, setChoice] = useState<"switch" | "keep" | null>(null);
  const [replacement, setReplacement] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const target = profiles.deleteTarget;
  if (!target) return null;
  const active = profiles.library?.activeProfileId === target.id;
  const alternatives =
    profiles.library?.profiles.filter((profile) => profile.id !== target.id) ?? [];
  const replacementProfile = alternatives.find((profile) => profile.id === replacement);
  const recovery = Boolean(profiles.library?.pendingSwitchProfileId);
  const working = profiles.deleting;
  const disabled = running || busy || working || recovery;
  const valid = !active || choice === "keep" || (choice === "switch" && replacementProfile);
  const close = () => {
    if (!working) profiles.cancelDelete();
  };

  return (
    <Modal
      open
      role="alertdialog"
      title={`Delete ${target.name}?`}
      description="Remove this saved profile from your library."
      testId="profile-delete-dialog"
      className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(540px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto sm:p-6"
      onClose={close}
      initialFocusRef={cancelRef}
    >
      <p className="t-meta mt-4">
        Saved cfgs, HUD, sounds, mods and profile settings will be removed.
      </p>

      {active ? (
        <fieldset className="mt-5 space-y-2" disabled={disabled}>
          <legend className="t-row mb-3">This profile is installed in TF2</legend>
          {alternatives.length > 0 ? (
            <OptionTile
              id="delete-switch"
              name="profile-delete-choice"
              title="Switch to another profile first"
              description="Your chosen profile replaces the current TF2 setup."
              selected={choice === "switch"}
              disabled={disabled}
              onSelect={() => setChoice("switch")}
            />
          ) : null}
          {choice === "switch" ? (
            <fieldset
              className="space-y-1 border-l border-edge-strong pl-3"
              aria-label="Switch to profile"
            >
              {alternatives.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  disabled={disabled || Boolean(profile.unsafeCustomFolders?.length)}
                  aria-pressed={replacement === profile.id}
                  onClick={() => setReplacement(profile.id)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${replacement === profile.id ? "border-brand bg-brand/5 text-ink" : "border-edge text-ink-muted hover:bg-panel"}`}
                >
                  <span>{profile.name}</span>
                  {profile.unsafeCustomFolders?.length ? (
                    <span className="t-meta">Needs repair</span>
                  ) : (
                    <ArrowRight size={16} />
                  )}
                </button>
              ))}
            </fieldset>
          ) : null}
          <OptionTile
            id="delete-keep"
            name="profile-delete-choice"
            title="Keep the installed TF2 files"
            description="Leave TF2 as it is and stop tracking this setup."
            selected={choice === "keep"}
            disabled={disabled}
            onSelect={() => setChoice("keep")}
          />
        </fieldset>
      ) : (
        <p className="t-meta mt-4 flex items-start gap-2">
          <Info size={17} className="mt-0.5 shrink-0" />
          <span>Your installed TF2 setup and other saved profiles stay in place.</span>
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-y border-edge py-3">
        <p className="t-meta">Want to keep a copy?</p>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={disabled}
          onClick={() => void profiles.exportProfile(target.id)}
        >
          <DownloadSimple size={16} />
          Export profile first
        </button>
      </div>
      {profiles.deleteError ? (
        <p className="t-meta mt-4 text-error" role="alert">
          {profiles.deleteError}
        </p>
      ) : null}
      {running || recovery ? (
        <p className="t-meta mt-4" role="status">
          {running
            ? "Close TF2 before deleting a profile."
            : "Finish the interrupted profile switch before deleting."}
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2" aria-busy={working}>
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
          className="btn btn-danger"
          disabled={disabled || !valid}
          onClick={() =>
            void profiles.confirmDelete(
              active && choice === "keep",
              choice === "switch" ? (replacement ?? undefined) : undefined,
            )
          }
        >
          {working
            ? "Deleting profile…"
            : active && choice === "switch"
              ? "Switch and delete profile"
              : "Delete profile"}
        </button>
      </div>
    </Modal>
  );
}
