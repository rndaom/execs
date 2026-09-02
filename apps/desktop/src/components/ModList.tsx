import { ArrowSquareOut, FolderOpen, UploadSimple } from "@phosphor-icons/react";
import { useState } from "react";
import type { ModRecord } from "../lib/bridge";
import { openExternal } from "../lib/bridge";
import {
  formatModBytes,
  modDomId,
  modMetaLine,
  modNeedsRemoveConfirm,
  modSourceUrl,
} from "../lib/mods-ui";
import { Modal } from "./ui/Modal";
import { PaneSection } from "./ui/PaneSection";

/**
 * The packs the user brought in themselves, and the two ways to add another.
 * Hairline rows, one ghost Remove each; only a big pack asks before it goes,
 * because that is the one that costs a download to get back.
 */
export function ModList({
  mods,
  locked,
  running,
  onImportArchive,
  onImportFolder,
  onRemove,
}: {
  mods: ModRecord[];
  /** TF2 is running or a write is in flight. */
  locked: boolean;
  running: boolean;
  onImportArchive: () => void;
  onImportFolder: () => void;
  onRemove: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState<ModRecord | null>(null);

  function remove(mod: ModRecord) {
    if (modNeedsRemoveConfirm(mod)) {
      setConfirming(mod);
      return;
    }
    onRemove(mod.id);
  }

  return (
    <PaneSection
      title="Your mods"
      id="mods-yours"
      meta={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="mods-import-archive"
            className="btn btn-ghost"
            disabled={locked}
            onClick={onImportArchive}
          >
            <UploadSimple size={14} />
            Add mods…
          </button>
          <button
            type="button"
            data-testid="mods-import-folder"
            className="btn btn-ghost"
            disabled={locked}
            onClick={onImportFolder}
          >
            <FolderOpen size={14} />
            Add folder…
          </button>
        </div>
      }
    >
      {locked ? (
        <p className="t-meta mt-3">
          {running ? "Close TF2 to add mods." : "Finish the current task first."}
        </p>
      ) : null}

      {mods.length === 0 ? (
        <p data-testid="mods-yours-empty" className="t-meta mt-4">
          No mods yet.
        </p>
      ) : (
        <ul data-testid="mods-yours-list" className="mt-2 list-none p-0">
          {mods.map((mod) => {
            const url = modSourceUrl(mod.source);
            return (
              <li
                key={mod.id}
                data-testid={`mods-row-${modDomId(mod.id)}`}
                className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-edge py-3 last:border-b-0"
              >
                <span className="min-w-48 flex-1">
                  <span className="t-row block truncate">{mod.name}</span>
                  <span className="t-meta mt-0.5 block">{modMetaLine(mod)}</span>
                </span>
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
                  disabled={locked}
                  onClick={() => remove(mod)}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {confirming ? (
        <Modal
          open
          role="alertdialog"
          testId="mods-remove-confirm"
          title={`Remove ${confirming.name}?`}
          description={`${formatModBytes(confirming.bytes)} — adding it back means downloading it again.`}
          className="fixed top-24 left-1/2 z-50 w-[min(390px,calc(100vw-2.5rem))] -translate-x-1/2"
          onClose={() => setConfirming(null)}
          onDefaultAction={() => {
            onRemove(confirming.id);
            setConfirming(null);
          }}
        >
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              data-testid="mods-remove-confirm-yes"
              className="btn btn-primary"
              disabled={locked}
              onClick={() => {
                onRemove(confirming.id);
                setConfirming(null);
              }}
            >
              Remove mod
            </button>
            <button
              type="button"
              data-testid="mods-remove-confirm-no"
              className="btn btn-ghost"
              onClick={() => setConfirming(null)}
            >
              Keep mod
            </button>
          </div>
        </Modal>
      ) : null}
    </PaneSection>
  );
}
