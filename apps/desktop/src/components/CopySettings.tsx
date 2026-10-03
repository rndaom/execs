import { Copy } from "@phosphor-icons/react";
import { useState } from "react";
import type { SettingsCopyScope, SettingsCopyTarget } from "../lib/bridge";
import { Modal } from "./ui/Modal";
import { Loading } from "./ui/Spinner";
import { SwitchRow } from "./ui/Switch";

/** How a pane copies its saved settings; supplied by the settings host. */
export type CopySettingsSource = {
  review: () => Promise<SettingsCopyTarget[]>;
  /** Runs as a settings write; true when the copy finished. */
  copy: (targets: string[]) => Promise<boolean>;
};

const COPY: Record<SettingsCopyScope, { title: string; description: string }> = {
  binds: {
    title: "Copy binds to other profiles",
    description:
      "Replaces the binds saved in execs in each profile you choose. Binds you set only in TF2's own options stay in their profile.",
  },
  gameplay: {
    title: "Copy Gameplay settings to other profiles",
    description:
      "Replaces FOV, tracers, mouse, weapon and combat-feedback settings in each profile you choose. Viewmodels, crosshair and sounds stay.",
  },
  sounds: {
    title: "Copy sounds to other profiles",
    description: "Replaces the hit and kill sounds and their settings in each profile you choose.",
  },
};

/**
 * "Copy to other profiles…" for a settings pane. It copies the active profile's
 * saved settings, so it waits for unsaved changes, TF2 and other writes.
 */
export function CopySettings({
  scope,
  source,
  blockedReason,
}: {
  scope: SettingsCopyScope;
  source: CopySettingsSource;
  /** Why copying is unavailable right now, such as unsaved changes. */
  blockedReason: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<SettingsCopyTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [copying, setCopying] = useState(false);

  function start() {
    setOpen(true);
    setTargets(null);
    setError(null);
    setSelected([]);
    source
      .review()
      .then((next) => {
        setTargets(next);
        setSelected(next.filter((target) => target.changes).map((target) => target.id));
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Could not read your profiles."),
      );
  }

  async function confirm() {
    setCopying(true);
    try {
      if (await source.copy(selected)) setOpen(false);
    } finally {
      setCopying(false);
    }
  }

  const copy = COPY[scope];
  const count = selected.length;
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        data-testid={`copy-settings-${scope}`}
        disabled={blockedReason !== null}
        title={blockedReason ?? copy.title}
        onClick={start}
      >
        <Copy size={15} aria-hidden="true" />
        Copy to other profiles…
      </button>
      <Modal
        open={open}
        title={copy.title}
        description={copy.description}
        onClose={() => {
          if (!copying) setOpen(false);
        }}
      >
        {error ? (
          <p role="alert" className="t-meta mt-4 text-error">
            {error}
          </p>
        ) : targets === null ? (
          <p className="t-meta mt-4">
            <Loading>Reading your profiles…</Loading>
          </p>
        ) : targets.length === 0 ? (
          <p className="t-meta mt-4">There are no other profiles to copy to yet.</p>
        ) : (
          <div data-testid="copy-settings-targets" className="mt-2">
            {targets.map((target) => (
              <SwitchRow
                key={target.id}
                id={`copy-settings-${target.id}`}
                label={target.name}
                description={
                  target.problem ?? (target.changes ? undefined : "Already has these settings.")
                }
                disabled={!target.changes || Boolean(target.problem) || copying}
                checked={selected.includes(target.id)}
                onChange={(checked) =>
                  setSelected((current) =>
                    checked ? [...current, target.id] : current.filter((id) => id !== target.id),
                  )
                }
              />
            ))}
          </div>
        )}
        <div className="pane-actions mt-5 justify-end">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={copying}
            onClick={() => setOpen(false)}
          >
            {targets?.length === 0 || error ? "Close" : "Cancel"}
          </button>
          {targets?.length === 0 || error ? null : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={count === 0 || copying}
              onClick={() => void confirm()}
            >
              {copying ? (
                <Loading>Copying…</Loading>
              ) : count === 1 ? (
                "Copy to 1 profile"
              ) : (
                `Copy to ${count} profiles`
              )}
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}
