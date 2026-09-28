import { ArrowSquareOut, Package } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { ModRecord, ModUpdateStatus, ProfileSummary } from "../lib/bridge";
import { openExternal } from "../lib/bridge";
import { formatModBytes, modDomId, modMetaLine, modSourceUrl } from "../lib/mods-ui";
import { ModImport } from "./ModImport";
import { Modal } from "./ui/Modal";
import { PaneSection } from "./ui/PaneSection";
import { Switch } from "./ui/Switch";

/**
 * The packs the user brought in themselves, and the two ways to add another.
 * Removal always reviews the named pack. A selected particle source must be
 * changed and applied in Casual setup before its underlying pack can go.
 */
export function ModList({
  mods,
  locked,
  running,
  active = true,
  first = false,
  showImport = true,
  selectedParticleMods = [],
  onManageParticles,
  onBrowse,
  onImportArchive,
  onImportFolder,
  onRemove,
  casualNotes,
  onSetEnabled,
  onCopy,
  profiles = [],
  updates = [],
  checking = false,
  managementError,
  onCheckUpdates,
}: {
  mods: ModRecord[];
  /** TF2 is running or a write is in flight. */
  locked: boolean;
  running: boolean;
  active?: boolean;
  first?: boolean;
  showImport?: boolean;
  selectedParticleMods?: string[];
  onManageParticles?: () => void;
  onBrowse?: () => void;
  onImportArchive: () => void;
  onImportFolder: () => void;
  onRemove: (id: string) => void;
  casualNotes?: Record<string, string>;
  onSetEnabled?: (id: string, enabled: boolean) => void;
  onCopy?: (id: string, targetProfileId: string) => Promise<boolean>;
  profiles?: ProfileSummary[];
  updates?: ModUpdateStatus[];
  checking?: boolean;
  managementError?: string | null;
  onCheckUpdates?: () => void;
}) {
  const [confirming, setConfirming] = useState<ModRecord | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  useEffect(() => {
    if (!active) {
      setConfirming(null);
      setCopying(null);
    }
  }, [active]);
  const copyMod = mods.find((mod) => mod.id === copying);
  // A status refresh may protect or remove a pack while its dialog is open.
  const current = confirming ? mods.find((mod) => mod.id === confirming.id) : undefined;
  const removalBlocked = locked || !current || selectedParticleMods.includes(current.id);

  return (
    <PaneSection
      // Under the Custom packs tab the tab already names the list.
      title={showImport ? "Custom packs" : <span className="sr-only">Custom packs</span>}
      description={
        showImport
          ? "The packs in this profile’s custom folder."
          : `${mods.length} ${mods.length === 1 ? "pack" : "packs"} in this profile’s custom folder.`
      }
      id="mods-yours"
      first={first}
      meta={
        showImport ? (
          <ModImport
            active={active}
            locked={locked}
            onImportArchive={onImportArchive}
            onImportFolder={onImportFolder}
          />
        ) : undefined
      }
    >
      {onCheckUpdates ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="t-meta" role="status">
            {managementError ??
              (checking
                ? "Checking GameBanana…"
                : "Turn a pack off to keep it saved without loading it in TF2.")}
          </p>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={checking}
            onClick={onCheckUpdates}
          >
            Check for updates
          </button>
        </div>
      ) : null}
      {locked ? (
        <p className="t-meta mt-3">
          {running ? "Close TF2 to add mods." : "Finish the current task first."}
        </p>
      ) : null}

      {mods.length === 0 ? (
        <div
          data-testid="mods-yours-empty"
          className="mt-5 flex items-start gap-4 border-y border-edge py-8"
        >
          <Package size={28} className="shrink-0 text-ink-muted" />
          <div>
            <h3 className="t-row">Make this profile yours</h3>
            <p className="t-meta mt-1">Browse GameBanana or import a mod you already have.</p>
            {onBrowse ? (
              <button type="button" className="btn btn-ghost mt-4" onClick={onBrowse}>
                Browse mods
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <ul data-testid="mods-yours-list" className="mt-2 list-none p-0">
          {mods.map((mod) => {
            const url = modSourceUrl(mod.source);
            const selected = selectedParticleMods.includes(mod.id);
            const update = updates.find((entry) => entry.id === mod.id);
            return (
              <li
                key={mod.id}
                data-testid={`mods-row-${modDomId(mod.id)}`}
                className="flex min-h-20 flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge py-4 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-edge bg-panel text-ink-muted"
                >
                  <Package size={22} />
                </span>
                <span className="min-w-48 flex-1">
                  <span className="t-row block break-words">{mod.name}</span>
                  <span className="t-meta mt-0.5 block">{modMetaLine(mod)}</span>
                  {mod.inactivePack ? (
                    <span className="t-meta mt-1 block">Off · saved in this profile</span>
                  ) : null}
                  {update?.updateAvailable ? (
                    <span className="t-meta mt-1 block text-accent">
                      Update available on GameBanana
                    </span>
                  ) : null}
                  {update?.error ? (
                    <span className="t-meta mt-1 block">
                      Update check unavailable: {update.error}
                    </span>
                  ) : null}
                  {!mod.inactivePack && casualNotes?.[mod.id] ? (
                    <span className="t-meta mt-1 block">{casualNotes[mod.id]}</span>
                  ) : null}
                  {selected ? (
                    <span id={`mods-protected-${modDomId(mod.id)}`} className="t-meta mt-1 block">
                      Used by Casual setup. Change the particle selection before turning off or
                      removing.
                    </span>
                  ) : null}
                </span>
                {onSetEnabled ? (
                  <Switch
                    label={`Enable ${mod.name}`}
                    checked={!mod.inactivePack}
                    disabled={locked || selected}
                    onChange={(enabled) => onSetEnabled(mod.id, enabled)}
                  />
                ) : null}
                {onCopy ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={locked}
                    aria-label={`Add ${mod.name} to another profile`}
                    onClick={() => setCopying(mod.id)}
                  >
                    Add to another profile…
                  </button>
                ) : null}
                {selected && onManageParticles ? (
                  <button type="button" className="btn btn-ghost" onClick={onManageParticles}>
                    Change selection
                  </button>
                ) : null}
                {url ? (
                  <button
                    type="button"
                    data-testid={`mods-link-${modDomId(mod.id)}`}
                    className="btn btn-quiet p-2"
                    aria-label={`${mod.name} on GameBanana`}
                    title="Open on GameBanana"
                    onClick={() => void openExternal(url)}
                  >
                    <ArrowSquareOut size={15} />
                  </button>
                ) : null}
                <button
                  type="button"
                  data-testid={`mods-remove-${modDomId(mod.id)}`}
                  className="btn btn-ghost"
                  aria-label={`Remove ${mod.name}`}
                  disabled={locked || selected}
                  aria-describedby={selected ? `mods-protected-${modDomId(mod.id)}` : undefined}
                  onClick={() => setConfirming(mod)}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {copyMod && active && onCopy ? (
        <Modal
          open
          title={`Add ${copyMod.name} to another profile`}
          description="Copies the saved pack without downloading it again. Its on/off setting is kept. The current TF2 setup stays as it is."
          onClose={() => {
            if (!copyBusy) setCopying(null);
          }}
        >
          <div className="mt-4 max-h-64 overflow-auto">
            {profiles.length === 0 ? (
              <p className="t-meta">
                {checking ? "Loading profiles…" : "Create another profile first, then try again."}
              </p>
            ) : (
              profiles.map((profile) => (
                <div
                  key={profile.id}
                  className="flex items-center justify-between gap-3 border-b border-edge py-3"
                >
                  <span className="t-row min-w-0 break-words">{profile.name}</span>
                  <button
                    type="button"
                    className="btn btn-primary shrink-0"
                    disabled={locked || copyBusy}
                    aria-label={`Add to ${profile.name}`}
                    onClick={async () => {
                      setCopyBusy(true);
                      try {
                        if (await onCopy(copyMod.id, profile.id)) setCopying(null);
                      } finally {
                        setCopyBusy(false);
                      }
                    }}
                  >
                    Add pack
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="mt-5 flex justify-end border-t border-edge pt-4">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={copyBusy}
              onClick={() => setCopying(null)}
            >
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}

      {confirming && active ? (
        <Modal
          open
          role="alertdialog"
          testId="mods-remove-confirm"
          title={`Remove ${confirming.name}?`}
          description={`${formatModBytes(confirming.bytes)} will be removed from this profile and its active TF2 setup. ${confirming.source.kind === "gamebanana" ? "You can download it again from GameBanana." : "Keep the original file if you want to import it again."}`}
          onClose={() => setConfirming(null)}
        >
          {current && selectedParticleMods.includes(current.id) ? (
            <p className="t-meta mt-3">
              This pack is now selected in Casual setup. Change and apply that selection first.
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2 border-t border-edge pt-4">
            <button
              type="button"
              data-testid="mods-remove-confirm-no"
              className="btn btn-ghost"
              onClick={() => setConfirming(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="mods-remove-confirm-yes"
              className="btn btn-danger"
              disabled={removalBlocked}
              onClick={() => {
                if (removalBlocked) return;
                onRemove(confirming.id);
                setConfirming(null);
              }}
            >
              Remove mod
            </button>
          </div>
        </Modal>
      ) : null}
    </PaneSection>
  );
}
