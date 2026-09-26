import { ArrowSquareOut, Package } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { ModRecord } from "../lib/bridge";
import { openExternal } from "../lib/bridge";
import { formatModBytes, modDomId, modMetaLine, modSourceUrl } from "../lib/mods-ui";
import { ModImport } from "./ModImport";
import { Modal } from "./ui/Modal";
import { PaneSection } from "./ui/PaneSection";

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
}) {
  const [confirming, setConfirming] = useState<ModRecord | null>(null);
  useEffect(() => {
    if (!active) setConfirming(null);
  }, [active]);
  // A status refresh may protect or remove a pack while its dialog is open.
  const current = confirming ? mods.find((mod) => mod.id === confirming.id) : undefined;
  const removalBlocked = locked || !current || selectedParticleMods.includes(current.id);

  return (
    <PaneSection
      title="Custom packs"
      description="The packs in this profile’s custom folder."
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
        ) : (
          <span className="t-meta tnum">
            {mods.length} {mods.length === 1 ? "pack" : "packs"}
          </span>
        )
      }
    >
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
                  {selected ? (
                    <span id={`mods-protected-${modDomId(mod.id)}`} className="t-meta mt-1 block">
                      Used by Casual setup. Change the particle selection before removing.
                    </span>
                  ) : null}
                </span>
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

      {confirming && active ? (
        <Modal
          open
          role="alertdialog"
          testId="mods-remove-confirm"
          title={`Remove ${confirming.name}?`}
          description={`${formatModBytes(confirming.bytes)} will be removed from this profile and its active TF2 setup. ${confirming.source.kind === "gamebanana" ? "You can download it again from GameBanana." : "Keep the original file if you want to import it again."}`}
          className="fixed top-24 left-1/2 z-50 w-[min(460px,calc(100vw-2.5rem))] -translate-x-1/2"
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
              className="btn btn-primary"
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
