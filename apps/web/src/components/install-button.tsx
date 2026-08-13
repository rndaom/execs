"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { detectConflicts, installVersion } from "@/install/installer";
import { getStoredTf2Dir, pickTf2Dir, supportsDirectInstall, Tf2DirError } from "@/install/tf2dir";
import type { InstallConflict, VersionManifest } from "@/install/types";

type Phase =
  | "idle"
  | "picking"
  | "confirm-conflicts"
  | "installing"
  | "done"
  | "error";

export function InstallButton({
  versionId,
  versionLabel,
}: {
  versionId: string;
  versionLabel: string;
}) {
  const [supported, setSupported] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [conflicts, setConflicts] = useState<InstallConflict[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(supportsDirectInstall());
  }, []);

  async function run(confirmedConflicts: boolean) {
    setError(null);
    setPhase("picking");
    try {
      let root = await getStoredTf2Dir({ request: true });
      if (!root) root = await pickTf2Dir();

      const manifestRes = await fetch(`/api/versions/${versionId}/manifest`);
      if (!manifestRes.ok) throw new Error("could not load file manifest");
      const manifest = (await manifestRes.json()) as VersionManifest;

      if (!confirmedConflicts) {
        const found = await detectConflicts(root, manifest);
        if (found.length > 0) {
          setConflicts(found);
          setPhase("confirm-conflicts");
          return;
        }
      }

      setPhase("installing");
      await installVersion(root, manifest, async (r2Key) => {
        const res = await fetch(`/files/${r2Key}`);
        if (!res.ok) throw new Error(`failed to fetch ${r2Key}`);
        return res.arrayBuffer();
      });
      fetch(`/api/installs/${versionId}`, { method: "POST" }).catch(() => {});
      setPhase("done");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setPhase("idle"); // user cancelled the picker
        return;
      }
      setError(e instanceof Tf2DirError ? e.message : e instanceof Error ? e.message : "install failed");
      setPhase("error");
    }
  }

  if (!supported) {
    return (
      <p className="text-xs text-ink-faint">
        One-click install needs Chrome or Edge — on this browser, grab the zip and merge its{" "}
        <code>tf</code> folder into your TF2 install.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {phase === "confirm-conflicts" ? (
        <div className="flex flex-col gap-2 rounded-md border border-q-strange p-3 text-sm">
          <p className="font-semibold">This install would overwrite:</p>
          <ul className="flex flex-col gap-1">
            {conflicts.map((c) => (
              <li key={c.path}>
                <code className="text-xs">{c.path}</code>{" "}
                {c.ownedBy ? (
                  <span className="text-ink-muted">(installed by “{c.ownedBy}”)</span>
                ) : (
                  <span className="text-q-strange">(your own file — not managed by execs)</span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => run(true)}>
              Overwrite and install
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setPhase("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => run(false)}
          disabled={phase === "picking" || phase === "installing"}
          className="rounded-pill"
        >
          {phase === "installing"
            ? "Installing…"
            : phase === "picking"
              ? "Waiting for folder…"
              : phase === "done"
                ? "✓ Installed — restart TF2"
                : `Install to TF2 · v${versionLabel}`}
        </Button>
      )}
      {phase === "done" && (
        <p className="text-xs text-ink-faint">
          Files are in place. Manage or remove them any time from the{" "}
          <a href="/installed" className="underline">
            Installed
          </a>{" "}
          page.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
