import { Copy } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
import type { Api } from "../lib/api";
import { invokeErrorMessage } from "../lib/bridge";
import { copyButtonLabel } from "../lib/copy-ui";
import {
  casualChangesCopy,
  casualChangesInstalled,
  debRemoveCommand,
  type UninstallInfo,
  uninstallActionLabel,
} from "../lib/uninstall-ui";
import { Modal } from "./ui/Modal";
import { Loading } from "./ui/Spinner";
import { Switch } from "./ui/Switch";

/**
 * Leaving TF2 as it is stays the default. Restoring Casual changes and
 * deleting execs data are separate, explicit choices.
 */
export function UninstallSection({
  api,
  blockedReason,
  onUninstall,
}: {
  api: Pick<Api, "getUninstallInfo" | "revertPreloader">;
  /** Why uninstalling is unavailable right now (TF2 running, busy, drafts). */
  blockedReason: string | null;
  /**
   * Resolves pending drafts first, then asks native code to uninstall; execs
   * closes on success and reports any failure through `onError`.
   */
  onUninstall: (deleteData: boolean, onError: (message: string) => void) => void;
}) {
  const [info, setInfo] = useState<UninstallInfo | null>(null);
  const [deleteData, setDeleteData] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState<"restore" | "uninstall" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const command = useCopyFeedback();

  const load = useCallback(async () => {
    try {
      setInfo(await api.getUninstallInfo());
    } catch (err) {
      setError(invokeErrorMessage(err));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!info)
    return error ? (
      <p role="alert" className="t-meta text-error">
        {error}
      </p>
    ) : (
      <p className="t-meta">
        <Loading>Checking how execs was installed…</Loading>
      </p>
    );

  const casualInstalled = casualChangesInstalled(info);
  const casualCopy = casualChangesCopy(info);
  const effectiveDelete = deleteData && !casualInstalled;
  const action = uninstallActionLabel(info.install, effectiveDelete);
  const debCommand = debRemoveCommand(info.install);

  async function restoreStock() {
    setWorking("restore");
    setError(null);
    try {
      const report = await api.revertPreloader();
      setNotice(
        report.failures.length > 0
          ? `Some files could not be restored: ${report.failures.join(", ")}.`
          : "TF2's stock files are back.",
      );
      await load();
    } catch (err) {
      setError(invokeErrorMessage(err));
    } finally {
      setWorking(null);
    }
  }

  function uninstall() {
    setConfirming(false);
    setWorking("uninstall");
    setError(null);
    onUninstall(effectiveDelete, (message) => {
      setError(message);
      setWorking(null);
      void load();
    });
  }

  return (
    <div data-testid="uninstall">
      <p className="t-body text-ink-muted">
        Your current TF2 setup stays installed: its cfg files, HUD and custom files remain in TF2
        after execs is gone.
      </p>

      {casualCopy ? (
        <div className="mt-3" data-testid="uninstall-casual">
          <p className="t-meta">
            {casualCopy} Restore stock files puts those back. It does not reset the rest of your
            setup.
          </p>
          <button
            type="button"
            className="btn btn-ghost mt-2"
            disabled={working !== null || blockedReason !== null || info.casual === null}
            onClick={() => void restoreStock()}
          >
            {working === "restore" ? <Loading>Restoring…</Loading> : "Restore stock files"}
          </button>
        </div>
      ) : null}

      <div className="mt-4 flex min-h-8 items-center justify-between gap-4">
        <span className="t-row">Also delete execs data</span>
        <Switch
          label="Also delete execs data"
          checked={effectiveDelete}
          disabled={casualInstalled || working !== null}
          testId="uninstall-delete-data"
          onChange={setDeleteData}
        />
      </div>
      <p className="t-meta mt-1">
        {casualInstalled
          ? "Available after Restore stock files, because execs keeps the original game files it needs in its data."
          : `Profiles, restore points, downloads and settings in ${info.dataDirectory}. Export profiles you want to keep first.`}
      </p>

      {debCommand ? (
        <div className="mt-4">
          <p className="t-meta">
            execs was installed as a system package. Remove it with your package manager:
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="t-meta rounded bg-panel-raised px-2 py-1 text-ink">{debCommand}</code>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void command.copy(debCommand)}
            >
              <Copy size={15} aria-hidden="true" />
              <span aria-live="polite">{copyButtonLabel(command.feedback, "Copy command")}</span>
            </button>
          </div>
        </div>
      ) : null}

      {info.install.kind === "unmanaged" ? (
        <p className="t-meta mt-4" data-testid="uninstall-unmanaged">
          This copy of execs was not installed by an execs installer, so there is nothing to
          uninstall here.
        </p>
      ) : action ? (
        <button
          type="button"
          className="btn btn-ghost mt-4"
          data-testid="uninstall-start"
          disabled={working !== null || blockedReason !== null}
          onClick={() => setConfirming(true)}
        >
          {working === "uninstall" ? <Loading>Uninstalling…</Loading> : action}
        </button>
      ) : null}
      {blockedReason ? <p className="t-meta mt-2">{blockedReason}</p> : null}
      {notice ? (
        <p className="t-meta mt-2" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="t-meta mt-2 text-error">
          {error}
        </p>
      ) : null}

      <Modal
        open={confirming}
        title={effectiveDelete ? "Delete execs data and uninstall?" : "Uninstall execs?"}
        testId="uninstall-review"
        onClose={() => setConfirming(false)}
      >
        <ul className="t-body mt-2 list-disc space-y-1 pl-5 text-ink-muted">
          <li>Your TF2 setup stays as it is now.</li>
          <li>
            {effectiveDelete
              ? "Profiles, restore points, downloads and settings are deleted. This cannot be undone."
              : "Profiles and settings stay on this computer if you install execs again."}
          </li>
          <li>
            {info.install.kind === "windowsInstaller"
              ? "execs closes and the Windows uninstaller opens."
              : info.install.kind === "appImage"
                ? "This AppImage file is deleted and execs closes."
                : "execs closes. Run the package manager command to remove it."}
          </li>
        </ul>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button
            type="button"
            className={effectiveDelete ? "btn btn-danger" : "btn btn-primary"}
            data-testid="uninstall-confirm"
            onClick={uninstall}
          >
            {action?.replace(/…$/, "")}
          </button>
        </div>
      </Modal>
    </div>
  );
}
