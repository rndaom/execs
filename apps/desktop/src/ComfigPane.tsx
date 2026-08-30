import { useEffect, useMemo, useState } from "react";
import type { ComfigPreset, OfficialAddon, ProfileDetail } from "./lib/bridge";
import { COMFIG_MODULE_GROUPS } from "./lib/comfig-catalog";
import {
  hasBaseVpk,
  hasComfigCustom,
  type PreviewComfigState,
  resolveComfigState,
  setModuleLevel,
} from "./lib/comfig-ui";
import { COMFIG_PRESETS, OFFICIAL_ADDONS } from "./lib/first-run-ui";
import { canWriteSettings } from "./lib/settings-ui";

export function ComfigPane({
  running,
  busy,
  detail,
  preview = false,
  previewState,
  onApplyPreset,
  onApplyModules,
  onToggleAddon,
  onUpdatePackages,
  onOpenExtras,
  onImportCustom,
}: {
  running: boolean;
  busy: boolean;
  detail: ProfileDetail | null;
  preview?: boolean;
  previewState?: PreviewComfigState;
  onApplyPreset: (preset: ComfigPreset) => void;
  onApplyModules: (modules: Record<string, string>) => void;
  onToggleAddon: (id: OfficialAddon) => void;
  onUpdatePackages: () => void;
  onOpenExtras: () => void;
  onImportCustom: () => void;
}) {
  const incoming = useMemo(
    () => resolveComfigState(preview, previewState, detail),
    [preview, previewState, detail],
  );
  const [draft, setDraft] = useState<PreviewComfigState>(incoming);
  useEffect(() => {
    setDraft(incoming);
  }, [incoming]);

  const locked = !canWriteSettings(running, busy);
  const paths = detail?.files.map((file) => file.path) ?? [];
  const packagesInstalled = preview
    ? Boolean(draft.versionLabel) || draft.addons.length > 0
    : hasBaseVpk(paths);
  const customImported = preview ? false : hasComfigCustom(paths);

  return (
    <section data-testid="settings-comfig" className="text-left">
      <p className="font-display text-sm tracking-wide text-ink-muted">Preset</p>
      <div data-testid="comfig-preset" className="mt-2 flex flex-col gap-1.5">
        {COMFIG_PRESETS.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="comfig-preset"
              value={item.id}
              checked={draft.preset === item.id}
              disabled={locked}
              onChange={() => {
                setDraft({ ...draft, preset: item.id });
                onApplyPreset(item.id);
              }}
            />
            {item.label}
          </label>
        ))}
      </div>

      {COMFIG_MODULE_GROUPS.map((group) => (
        <div key={group.id} className="mt-5">
          <p className="font-display text-sm tracking-wide text-ink-muted">{group.label}</p>
          <div className="mt-2 flex flex-col gap-2">
            {group.modules.map((module) => (
              <label
                key={module.id}
                className="flex items-center justify-between gap-3 text-sm text-ink"
              >
                <span>{module.label}</span>
                <select
                  data-testid={`comfig-module-${module.id}`}
                  value={draft.modules[module.id] ?? ""}
                  disabled={locked}
                  onChange={(event) => {
                    const modules = setModuleLevel(draft.modules, module.id, event.target.value);
                    setDraft({ ...draft, modules });
                    onApplyModules(modules);
                  }}
                  className="rounded-lg border border-edge bg-bg px-2 py-1 text-sm text-ink focus:border-brand focus:outline-none disabled:opacity-40"
                >
                  <option value="">Preset default</option>
                  {module.levels.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      ))}

      <p className="mt-5 font-display text-sm tracking-wide text-ink-muted">Official addons</p>
      <div className="mt-2 flex flex-col gap-1.5">
        {OFFICIAL_ADDONS.map((item) => (
          <label key={item.id} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              data-testid={`comfig-addon-${item.id}`}
              checked={draft.addons.includes(item.id)}
              disabled={locked}
              onChange={() => {
                const addons = draft.addons.includes(item.id)
                  ? draft.addons.filter((addon) => addon !== item.id)
                  : [...draft.addons, item.id];
                setDraft({ ...draft, addons });
                onToggleAddon(item.id);
              }}
            />
            {item.label}
          </label>
        ))}
      </div>

      <div className="mt-5 flex flex-col gap-2">
        {draft.versionLabel ? (
          <p className="text-xs text-ink-muted">{draft.versionLabel}</p>
        ) : null}
        {!packagesInstalled ? (
          <p className="text-xs text-ink-muted">
            No official packages in this profile yet. Update packages fetches them from GitHub.
          </p>
        ) : null}
        {customImported ? (
          <p className="text-xs text-ink-muted">This profile includes a comfig-custom folder.</p>
        ) : null}
        <button
          type="button"
          data-testid="comfig-update"
          disabled={running || busy}
          onClick={onUpdatePackages}
          className="w-fit rounded-pill bg-brand px-5 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
        >
          Update packages
        </button>
      </div>

      <p className="mt-5 text-xs text-ink-muted">
        Uses official mastercomfig packages. Not affiliated with{" "}
        <a
          href="https://comfig.app"
          target="_blank"
          rel="noreferrer"
          className="text-brand underline decoration-brand/40 underline-offset-2"
        >
          comfig.app
        </a>
        .{" "}
        <a
          href="https://comfig.app"
          target="_blank"
          rel="noreferrer"
          className="text-brand underline decoration-brand/40 underline-offset-2"
        >
          Support / donate
        </a>
        .
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          data-testid="comfig-extras"
          href="https://comfig.app/app"
          target="_blank"
          rel="noreferrer"
          onClick={onOpenExtras}
          className="rounded-pill border border-edge px-5 py-2 text-sm text-ink hover:bg-panel-raised"
        >
          Open comfig.app extras
        </a>
        <button
          type="button"
          data-testid="comfig-import"
          disabled={locked}
          onClick={onImportCustom}
          className="rounded-pill border border-edge px-5 py-2 text-sm text-ink hover:bg-panel-raised disabled:opacity-40"
        >
          Import comfig-custom…
        </button>
      </div>
    </section>
  );
}
