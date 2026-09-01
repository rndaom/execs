import { useMemo } from "react";
import { Alert } from "./components/ui/Alert";
import { ApplyBar } from "./components/ui/ApplyBar";
import { PaneHeader } from "./components/ui/PaneHeader";
import { PaneSection } from "./components/ui/PaneSection";
import { useAppStatus, useCanWrite } from "./hooks/useAppStatus";
import { useSeededDraft } from "./hooks/useSeededDraft";
import type {
  CatalogAddon,
  CatalogParticleMod,
  ModsCatalog,
  PreloaderReport,
  PreloaderStatusPayload,
} from "./lib/bridge";
import {
  formatModBytes,
  modsApplyEnabled,
  modsStatusLine,
  PRELOADER_CREDIT,
  PRELOADER_EXPLAINER,
  summarizeReport,
  toggleName,
} from "./lib/mods-ui";

export type ModsPaneProps = {
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

type ModSelection = { addons: string[]; particleMods: string[] };

export function ModsPane({
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
  const { running, busy } = useAppStatus();
  const status = payload?.status ?? null;
  const installed = useMemo<ModSelection>(
    () => ({ addons: status?.addons ?? [], particleMods: status?.particleMods ?? [] }),
    [status],
  );
  const [selection, setSelection] = useSeededDraft(installed, (value) =>
    JSON.stringify([[...value.addons].sort(), [...value.particleMods].sort()]),
  );
  const { addons, particleMods } = selection;

  const locked = !useCanWrite();
  const canApply = modsApplyEnabled(payload, addons, particleMods);
  const anythingInstalled =
    (status?.patchedFiles.length ?? 0) > 0 ||
    (status?.addons.length ?? 0) > 0 ||
    status?.customVpkPresent === true ||
    status?.gameinfoBypassed === true;

  return (
    <div data-testid="settings-mods" className="min-w-0 text-left">
      <PaneHeader title="Mods" lede={PRELOADER_EXPLAINER} />

      {/* The status hero: the three facts, then the two actions that change
          them. Everything the library offers sits below. */}
      <div className="hero-row">
        <div className="min-w-0">
          <h2 className="t-section">Casual preload bypass</h2>
          <p className="t-meta mt-1 max-w-[62ch]">
            Comments out one line in gameinfo.txt so preloaded materials, models and particles stay
            live on sv_pure servers. The pristine file is backed up first and the change reverses
            cleanly.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="mods-bypass-toggle"
              className="btn btn-primary"
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
          </div>
          <p className="mt-4 max-w-[62ch] text-[12.5px] leading-5 text-ink-faint">
            Restore puts every patched byte back, un-comments gameinfo.txt and removes the addon
            pack. Mods load on Valve servers only after the preload runs — keep Casual preload on
            for this profile.
          </p>
        </div>

        {status ? (
          <dl className="hero-preview surface m-0 self-start p-5">
            <Stat label="Bypass" value={status.gameinfoBypassed ? "On" : "Off"} />
            <Stat label="Patched files" value={String(status.patchedFiles.length)} />
            <Stat label="Addon pack" value={status.customVpkPresent ? "Installed" : "None"} />
          </dl>
        ) : null}
      </div>

      {status?.stale ? (
        <Alert tone="warn" testId="mods-stale" className="mt-6">
          TF2 updated since the last install. The old patches are gone with the update — apply your
          selection again to re-install it on the fresh files.
        </Alert>
      ) : null}
      {payload && anythingInstalled && !payload.preloadLaunchInSteam ? (
        <Alert tone="warn" testId="mods-launch-warning" className="mt-6">
          The preload is not in your Steam launch options yet (Steam was open when they were saved).
          Close Steam fully, then press Apply here again — or re-apply from the Launch pane — so{" "}
          <code className="font-mono">+exec</code> reaches Steam. Without it, mods stay invisible on
          Valve servers.
        </Alert>
      ) : null}
      {status && !status.gameinfoFound ? (
        <Alert tone="error" testId="mods-no-gameinfo" className="mt-6">
          gameinfo.txt was not found — check the TF2 folder on the launcher screen.
        </Alert>
      ) : null}

      <PaneSection
        title="Default mod library"
        description="The curated set the original preloader ships: texture addons packed into tf/custom, and particle mods patched into the game archives."
        meta={
          payload && !payload.modsCached ? (
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
          ) : null
        }
      >
        {payload && !payload.modsCached && !loading ? (
          <p className="t-meta mt-4">
            One-time download from the pinned casual-pre-loader release; verified and cached for
            offline installs.
          </p>
        ) : null}
        {loading && !catalog ? (
          <p className="t-meta mt-4" role="status">
            Loading the mod library…
          </p>
        ) : null}

        {catalog ? (
          <div className="mt-4 grid gap-8 lg:grid-cols-2">
            <div>
              <h3 className="eyebrow">Addons</h3>
              <p className="mt-1 text-[12px] leading-5 text-ink-faint">
                Packed into a single execs-preloader.vpk in tf/custom.
              </p>
              <ul className="mt-3 list-none p-0">
                {catalog.addons.map((addon) => (
                  <AddonRow
                    key={addon.id}
                    addon={addon}
                    checked={addons.includes(addon.id)}
                    disabled={locked}
                    onToggle={() =>
                      setSelection((current) => ({
                        ...current,
                        addons: toggleName(current.addons, addon.id),
                      }))
                    }
                  />
                ))}
              </ul>
            </div>
            <div>
              <h3 className="eyebrow">Particle mods</h3>
              <p className="mt-1 text-[12px] leading-5 text-ink-faint">
                Shrunk and patched into tf2_misc in place; later picks win contested files.
              </p>
              <ul className="mt-3 list-none p-0">
                {catalog.particleMods.map((mod) => (
                  <ParticleRow
                    key={mod.name}
                    mod={mod}
                    checked={particleMods.includes(mod.name)}
                    disabled={locked}
                    onToggle={() =>
                      setSelection((current) => ({
                        ...current,
                        particleMods: toggleName(current.particleMods, mod.name),
                      }))
                    }
                  />
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </PaneSection>

      {report ? (
        <section className="section" data-testid="mods-report">
          <h2 className="t-section">Last install</h2>
          <p className="t-meta mt-1" aria-live="polite">
            {summarizeReport(report)}
          </p>
          {report.skipped.length > 0 ? (
            <ul className="mt-3 list-none p-0 font-mono text-[12px] leading-5 text-ink-faint">
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
          <h2 className="t-section">Skipped last time</h2>
          <ul className="mt-3 list-none p-0 font-mono text-[12px] leading-5 text-ink-faint">
            {status.skipped.map((notice) => (
              <li key={`${notice.modName}-${notice.file}-${notice.reason}`}>
                {notice.file}
                {notice.modName ? ` (${notice.modName})` : ""} — {notice.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="t-meta mt-12 text-ink-faint">
        {PRELOADER_CREDIT}{" "}
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
          onClick={onOpenRepo}
        >
          casual-pre-loader on GitHub
        </button>
      </p>

      <ApplyBar
        status={modsStatusLine(payload, addons, particleMods, running)}
        actionLabel="Apply mods"
        lockedLabel="Close TF2 to apply"
        running={running}
        locked={locked}
        // Not `selectionDirty`: a TF2 update wipes the patches without touching
        // the recorded selection, so Apply used to be disabled exactly when the
        // stale notice told the user to press it.
        dirty={canApply}
        testId="mods-apply"
        onApply={() => onApply(addons, particleMods)}
      />
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
    <li className="border-b border-edge py-3">
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
            <span className="t-row">{addon.name}</span>
            <span className="badge">{addon.kind}</span>
            <span className="tnum text-[12px] text-ink-faint">{formatModBytes(addon.bytes)}</span>
          </span>
          {addon.description ? (
            <span className="t-meta mt-0.5 block">{addon.description}</span>
          ) : null}
          {addon.hasSound ? (
            <span className="mt-0.5 block text-[12px] leading-5 text-ink-faint">
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
    <li className="border-b border-edge py-3">
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
            <span className="t-row">{mod.name.replace(/_/g, " ")}</span>
            <span className="tnum text-[12px] text-ink-faint">
              {mod.pcfFiles.length} particle {mod.pcfFiles.length === 1 ? "file" : "files"} ·{" "}
              {formatModBytes(mod.bytes)}
            </span>
          </span>
          <span className="t-meta mt-0.5 block">
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
    <div className="row">
      <dt className="t-meta">{label}</dt>
      <dd className="tnum m-0 text-[15px] font-medium text-ink">{value}</dd>
    </div>
  );
}
