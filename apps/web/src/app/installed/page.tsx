"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { readManifest, uninstallConfig } from "@/install/installer";
import { forgetTf2Dir, getStoredTf2Dir, pickTf2Dir, supportsDirectInstall } from "@/install/tf2dir";
import type { DirHandle, InstallManifest } from "@/install/types";

export default function InstalledPage() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [root, setRoot] = useState<DirHandle | null>(null);
  const [manifest, setManifest] = useState<InstallManifest | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setSupported(supportsDirectInstall());
  }, []);

  const refresh = useCallback(async (dir: DirHandle) => {
    setManifest(await readManifest(dir));
  }, []);

  async function connect(prompt: boolean) {
    setMessage(null);
    try {
      let dir = await getStoredTf2Dir({ request: true });
      if (!dir && prompt) dir = await pickTf2Dir();
      if (!dir) return;
      setRoot(dir);
      await refresh(dir);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setMessage(e instanceof Error ? e.message : "could not open TF2 folder");
    }
  }

  async function remove(configId: string, name: string) {
    if (!root) return;
    const result = await uninstallConfig(root, configId);
    let note = `Removed “${name}” (${result.removed.length} file${result.removed.length === 1 ? "" : "s"}).`;
    if (result.keptModified.length > 0) {
      note += ` Kept ${result.keptModified.length} file(s) you had modified: ${result.keptModified.join(", ")}`;
    }
    setMessage(note);
    await refresh(root);
  }

  if (supported === null) return null;
  if (!supported) {
    return (
      <div className="mx-auto max-w-md pt-16 text-center">
        <h1 className="font-display text-3xl">Installed configs</h1>
        <p className="mt-3 text-ink-muted">
          Managing installed configs needs Chrome or Edge (the browser file-system access API).
          Manual installs can be removed by deleting the files from{" "}
          <code>tf/cfg/overrides</code> and <code>tf/custom/execs-custom</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl">Installed configs</h1>
      {!root ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-ink-muted">
            Connect your TF2 folder to see and manage configs installed through execs.
          </p>
          <Button onClick={() => connect(true)}>Connect TF2 folder</Button>
        </div>
      ) : (
        <>
          {manifest && manifest.installed.length === 0 && (
            <p className="text-ink-faint">
              Nothing installed through execs yet.{" "}
              <Link href="/" className="underline">
                Browse configs
              </Link>{" "}
              to get started.
            </p>
          )}
          {manifest && manifest.installed.length > 0 && (
            <ul className="flex flex-col gap-3">
              {manifest.installed.map((entry) => (
                <li
                  key={entry.configId}
                  className="flex flex-col gap-2 rounded-lg border border-edge bg-panel p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{entry.name}</span>
                    <Button variant="destructive" size="sm" onClick={() => remove(entry.configId, entry.name)}>
                      Uninstall
                    </Button>
                  </div>
                  <p className="text-xs text-ink-faint">
                    installed {new Date(entry.installedAt).toLocaleDateString()} ·{" "}
                    {entry.files.length} file{entry.files.length === 1 ? "" : "s"}
                  </p>
                  <details className="text-xs text-ink-muted">
                    <summary className="cursor-pointer">files</summary>
                    <ul className="mt-1">
                      {entry.files.map((f) => (
                        <li key={f}>
                          <code>{f}</code>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="self-start text-xs text-ink-faint underline"
            onClick={async () => {
              await forgetTf2Dir();
              setRoot(null);
              setManifest(null);
            }}
          >
            Disconnect TF2 folder
          </button>
        </>
      )}
      {message && <p className="text-sm text-ink-muted">{message}</p>}
    </div>
  );
}
