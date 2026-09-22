import { FolderOpen, UploadSimple } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "./ui/Modal";

/** One import entry point, shared by discovery and the installed library. */
export function ModImport({
  active = true,
  locked,
  onImportArchive,
  onImportFolder,
}: {
  active?: boolean;
  locked: boolean;
  onImportArchive: () => void;
  onImportFolder: () => void;
}) {
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);

  return (
    <>
      <button
        type="button"
        data-testid="mods-import"
        className="btn btn-ghost"
        disabled={locked}
        onClick={() => setOpen(true)}
      >
        <UploadSimple size={16} />
        Import mod…
      </button>
      <Modal
        open={open && active}
        testId="mods-import-modal"
        title="Import a mod"
        description="Choose one archive, VPK, or extracted mod folder."
        className="fixed top-24 left-1/2 z-50 w-[min(460px,calc(100vw-2.5rem))] -translate-x-1/2"
        onClose={() => setOpen(false)}
        initialFocusRef={cancelRef}
      >
        <div className="mt-5 grid gap-2">
          <button
            type="button"
            data-testid="mods-import-archive"
            className="btn btn-ghost justify-start gap-3 py-3 text-left"
            disabled={locked}
            onClick={() => {
              setOpen(false);
              onImportArchive();
            }}
          >
            <UploadSimple size={20} />
            <span>
              <span className="block">Choose archive or VPK</span>
              <span className="t-meta mt-0.5 block font-normal">VPK, ZIP or 7z</span>
            </span>
          </button>
          <button
            type="button"
            data-testid="mods-import-folder"
            className="btn btn-ghost justify-start gap-3 py-3 text-left"
            disabled={locked}
            onClick={() => {
              setOpen(false);
              onImportFolder();
            }}
          >
            <FolderOpen size={20} />
            <span>
              <span className="block">Choose extracted folder</span>
              <span className="t-meta mt-0.5 block font-normal">
                One mod, with its original contents
              </span>
            </span>
          </button>
        </div>
        <p className="t-meta mt-4">
          Packs with several variants need the author’s installation instructions. RAR and
          multi-part VPKs are not supported.
        </p>
        <div className="mt-5 flex justify-end border-t border-edge pt-4">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-ghost"
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
        </div>
      </Modal>
    </>
  );
}
