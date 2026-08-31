import { useEffect, useMemo, useState } from "react";
import type {
  CatalogAddon,
  CatalogParticleMod,
  ModsCatalog,
  PreloaderReport,
  PreloaderStatusPayload,
} from "./lib/bridge";
import {
  formatModBytes,
  PRELOADER_CREDIT,
  PRELOADER_EXPLAINER,
  selectionDirty,
  summarizeReport,
  toggleName,
} from "./lib/mods-ui";

export type ModsPaneProps = {
  running: boolean;
  busy: boolean;
  payload: PreloaderStatusPayload | null;
  catalog: ModsCatalog | null;
  loading: boolean;
  report: PreloaderReport | null;
  onDownloadLibrary: () => void;
  onApply: (addons: string[], particleMods: string[]) => void;
  onToggleBypass: (enabled: boolean) => void;
  onRevert: () => void;
  onOpenRepo: () => void;
};

export function ModsPane({
  running,
  busy,
  payload,
  catalog,
  loading,
  report,
  onDownloadLibrary,
  onApply,
  onToggleBypass,
  onRevert,
  onOpenRepo,
}: ModsPaneProps) {
  const status = payload?.status ?? null;
  const installedKey = useMemo(
    () => JSON.stringify([status?.addons ?? [], status?.particleMods ?? []]),
    [status],
  );
  const [addons, setAddons] = useState<string[]>(status?.addons ?? []);
  const [particleMods, setParticleMods] = useState<string[]>(status?.particleMods ?? []);

  // Reseed the selection whenever the installed state changes underneath us.
  // biome-ignore lint/correctness/useExhaustiveDependencies: installedKey stands in for the two arrays it serializes.
  useEffect(() => {
    setAddons(status?.addons ?? []);
    setParticleMods(status?.particleMods ?? []);
  }, [installedKey]);

  const locked = running || busy;
  const dirty = selectionDirty(payload, addons, particleMods);
  const anythingInstalled =
    (status?.patchedFiles.length ?? 0) > 0 ||
    (status?.addons.length ?? 0) > 0 ||
    status?.customVpkPresent === true ||
    status?.gameinfoBypassed === true;

  return (
    <div data-testid="settings-mods" className="min-w-0 text-left">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] leading-6 text-ink-muted">{PRELOADER_EXPLAINER}</p>
        {status ? (
          <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <Stat label="Bypass" value={status.gameinfoBypassed ? "On" : "Off"} />
            <Stat label="Patched" value={String(status.patchedFiles.length)} />
            <Stat label="Addon pack" value={status.customVpkPresent ? "Installed" : "None"} />
          </dl>
        ) : null}
      </div>

      {status?.stale ? (
        <p
          role="status"
          className="mt-4 rounded-card border border-edge-strong bg-panel-raised px-4 py-3 text-xs leading-5 text-ink"
        >
          TF2 updated since the last install. The old patches are gone with the update — apply your
          selection again to re-install it on the fresh files.
        </p>
      ) : null}
      {status && !status.gameinfoFound ? (
        <p
          role="alert"
          className="mt-4 rounded-card border border-edge-strong bg-panel-raised px-4 py-3 text-xs leading-5 text-ink"
        >
          gameinfo.txt was not found — check the TF2 folder on the launcher screen.
        </p>
      ) : null}

      <section className="section">
        <h2 className="text-sm font-semibold text-ink">Casual preload bypass</h2>
        <p className="mt-0.5 max-w-2xl text-xs leading-5 text-ink-muted">
          Comments out one line in gameinfo.txt (
          <code className="font-mono">type multiplayer_only</code>) so preloaded materials, models,
          and particles stay live on sv_pure servers. The pristine file is backed up first and the
          change reverses cleanly.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="mods-bypass-toggle"
            className="btn"
            disabled={locked || !status?.gameinfoFound}
            onClick={() => onToggleBypass(!(status?.gameinfoBypassed ?? false))}
          >
            {status?.gameinfoBypassed ? "Disable bypass" : "Enable bypass"}
          </button>
          <button
            type="button"
            data-testid="mods-revert"
            className="btn btn-ghost"
            disabled={locked || !anythingInstalled}
            onClick={onRevert}
          >
            Restore stock files
          </button>
          <p className="text-[11px] leading-4 text-ink-faint">
            Restore puts every patched byte back, un-comments gameinfo.txt, and removes the addon
            pack.
          </p>
        </div>
        <p className="mt-3 text-[11px] leading-4 text-ink-faint">
          Mods load on Valve servers after the preload runs — keep “Preload on launch” enabled on
          the Viewmodels pane (it shares the same itemtest preload).
        </p>
      </section>

      <section className="section">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Default mod library</h2>
            <p className="mt-0.5 max-w-2xl text-xs leading-5 text-ink-muted">
              The curated set the original preloader ships: texture addons packed into tf/custom,
              and particle mods patched into the game archives.
            </p>
          </div>
          {payload && !payload.modsCached ? (
            <button
              type="button"
              data-testid="mods-download"
              className="btn btn-primary"
              disabled={busy || loading}
              onClick={onDownloadLibrary}
            >
              {loading
                ? "Downloading…"
                : `Download library (${formatModBytes(payload.modsSizeBytes)})`}
            </button>
          ) : null}
        </div>

        {payload && !payload.modsCached && !loading ? (
          <p className="mt-3 text-xs leading-5 text-ink-muted">
            One-time download from the pinned casual-pre-loader release; verified and cached for
            offline installs.
          </p>
        ) : null}
        {loading && !catalog ? (
          <p className="mt-3 text-xs text-ink-muted" role="status">
            Loading the mod library…
          </p>
        ) : null}

        {catalog ? (
          <div className="mt-4 grid gap-8 lg:grid-cols-2">
            <div>
              <h3 className="eyebrow">Addons</h3>
              <p className="mt-1 text-[11px] leading-4 text-ink-faint">
                Packed into a single execs-preloader.vpk in tf/custom.
              </p>
              <ul className="mt-2 list-none p-0">
                {catalog.addons.map((addon) => (
                  <AddonRow
                    key={addon.id}
                    addon={addon}
                    checked={addons.includes(addon.id)}
                    disabled={locked}
                    onToggle={() => setAddons((current) => toggleName(current, addon.id))}
                  />
                ))}
              </ul>
            </div>
            <div>
              <h3 className="eyebrow">Particle mods</h3>
              <p className="mt-1 text-[11px] leading-4 text-ink-faint">
                Shrunk and patched into tf2_misc in place; later picks win contested files.
              </p>
              <ul className="mt-2 list-none p-0">
                {catalog.particleMods.map((mod) => (
                  <ParticleRow
                    key={mod.name}
                    mod={mod}
                    checked={particleMods.includes(mod.name)}
                    disabled={locked}
                    onToggle={() => setParticleMods((current) => toggleName(current, mod.name))}
                  />
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </section>

      {report ? (
        <section className="section" data-testid="mods-report">
          <h2 className="text-sm font-semibold text-ink">Last install</h2>
          <p className="mt-0.5 text-xs leading-5 text-ink-muted" aria-live="polite">
            {summarizeReport(report)}
          </p>
          {report.skipped.length > 0 ? (
            <ul className="mt-2 list-none p-0 font-mono text-[11px] leading-5 text-ink-faint">
              {report.skipped.map((notice) => (
                <li key={`${notice.modName}-${notice.file}-${notice.reason}`}>
                  {notice.file}
                  {notice.modName ? ` (${notice.modName})` : ""} — {notice.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : status && status.skipped.length > 0 ? (
        <section className="section">
          <h2 className="text-sm font-semibold text-ink">Skipped last time</h2>
          <ul className="mt-2 list-none p-0 font-mono text-[11px] leading-5 text-ink-faint">
            {status.skipped.map((notice) => (
              <li key={`${notice.modName}-${notice.file}-${notice.reason}`}>
                {notice.file}
                {notice.modName ? ` (${notice.modName})` : ""} — {notice.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-6 text-[11px] leading-5 text-ink-faint">
        {PRELOADER_CREDIT}{" "}
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-brand underline-offset-2 hover:underline"
          onClick={onOpenRepo}
        >
          casual-pre-loader on GitHub
        </button>
      </p>

      <div className="sticky bottom-0 z-10 mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-edge bg-bg/95 py-3 backdrop-blur">
        <p className="text-xs text-ink-muted" aria-live="polite">
          {running
            ? "TF2 is open — game files cannot be patched while it runs."
            : dirty
              ? "Selection differs from what's installed"
              : "Installed mods match your selection"}
        </p>
        <button
          type="button"
          data-testid="mods-apply"
          className="btn btn-primary"
          disabled={locked || !dirty || !payload?.modsCached}
          onClick={() => onApply(addons, particleMods)}
        >
          {running ? "Close TF2 to apply" : "Apply mod selection"}
        </button>
      </div>
    </div>
  );
}

function AddonRow({
  addon,
  checked,
  disabled,
  onToggle,
}: {
  addon: CatalogAddon;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const id = `mods-addon-${addon.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  return (
    <li className="border-b border-edge/60 py-3">
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <input
          id={id}
          data-testid={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          className="mt-1 size-3.5 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed"
        />
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="text-[13px] font-medium text-ink">{addon.name}</span>
            <span className="badge">{addon.kind}</span>
            <span className="font-mono text-[10px] text-ink-faint">
              {formatModBytes(addon.bytes)}
            </span>
          </span>
          {addon.description ? (
            <span className="mt-0.5 block text-xs leading-5 text-ink-muted">
              {addon.description}
            </span>
          ) : null}
          {addon.hasSound ? (
            <span className="mt-0.5 block text-[11px] leading-4 text-ink-faint">
              Includes sounds — sound replacements are best-effort on sv_pure servers.
            </span>
          ) : null}
        </span>
      </label>
    </li>
  );
}

function ParticleRow({
  mod,
  checked,
  disabled,
  onToggle,
}: {
  mod: CatalogParticleMod;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const id = `mods-particle-${mod.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const preview = mod.pcfFiles.slice(0, 3).map((file) => file.replace(/\.pcf$/, ""));
  const more = mod.pcfFiles.length - preview.length;
  return (
    <li className="border-b border-edge/60 py-3">
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <input
          id={id}
          data-testid={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          className="mt-1 size-3.5 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed"
        />
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="text-[13px] font-medium text-ink">{mod.name.replace(/_/g, " ")}</span>
            <span className="font-mono text-[10px] text-ink-faint">
              {mod.pcfFiles.length} particle {mod.pcfFiles.length === 1 ? "file" : "files"} ·{" "}
              {formatModBytes(mod.bytes)}
            </span>
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-ink-muted">
            {preview.join(", ")}
            {more > 0 ? ` and ${more} more` : ""}
          </span>
        </span>
      </label>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="eyebrow">{label}</dt>
      <dd className="m-0 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}
