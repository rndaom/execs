import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "./components/ui/Alert";
import { ApplyBar } from "./components/ui/ApplyBar";
import { PaneHeader } from "./components/ui/PaneHeader";
import { PaneSection } from "./components/ui/PaneSection";
import { Switch, SwitchRow } from "./components/ui/Switch";
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
  REPAIR_POLL_MS,
  REPAIR_TIMEOUT_MS,
  repairComplete,
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
  onTogglePreload: (enabled: boolean) => void;
  onRevert: () => void;
  /** Start Steam's verify; the pane polls `onRefreshStatus` until it finishes. */
  onRepair: () => Promise<void>;
  onRefreshStatus: () => Promise<void>;
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
  onTogglePreload,
  onRevert,
  onRepair,
  onRefreshStatus,
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
  const untracked = status?.untrackedModified ?? [];
  // Steam's verify runs outside the app; while it does, poll the status and,
  // once every stale file reads as stock again, put the selection back.
  const [repair, setRepair] = useState<"idle" | "waiting" | "timeout" | "done">("idle");
  const repairStarted = useRef(0);
  const repairSelection = useRef<ModSelection>(installed);
  useEffect(() => {
    if (repair !== "waiting") {
      return;
    }
    if (repairComplete(payload)) {
      setRepair("done");
      const { addons: wantAddons, particleMods: wantParticles } = repairSelection.current;
      if (wantAddons.length > 0 || wantParticles.length > 0) {
        onApply(wantAddons, wantParticles);
      }
      return;
    }
    if (Date.now() - repairStarted.current > REPAIR_TIMEOUT_MS) {
      setRepair("timeout");
      return;
    }
    const timer = window.setTimeout(() => {
      void onRefreshStatus().catch(() => {});
    }, REPAIR_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [repair, payload, onApply, onRefreshStatus]);

  async function startRepair() {
    repairStarted.current = Date.now();
    repairSelection.current = { addons, particleMods };
    setRepair("waiting");
    try {
      await onRepair();
    } catch {
      setRepair("idle");
    }
  }
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
      {/* Casual preload lives here and only here: the profile's preload on
          launch (what viewmodel packs and mods both need) and the gameinfo
          bypass that keeps preloaded content live on Valve servers. */}
      <div className="hero-row">
        <div className="min-w-0">
          <h2 className="t-section">Casual preload</h2>
          <p className="t-meta mt-1 max-w-[62ch]">
            Valve Casual runs sv_pure, so custom animations, materials and particles only survive
            when the game precaches them before you join. Two parts, both for this profile.
          </p>
          <div className="mt-3 max-w-xl">
            <SwitchRow
              id="mods-profile-preload"
              testId="mods-profile-preload"
              label="Preload on launch"
              description="Loads itemtest for a moment at startup so viewmodel packs and mods are cached before you join a server. Community and listen servers work without it."
              checked={payload?.profilePreload ?? false}
              disabled={locked || !payload}
              onChange={onTogglePreload}
            />
            <SwitchRow
              id="mods-bypass-toggle"
              testId="mods-bypass-toggle"
              label="Material bypass"
              description="Comments out one line in gameinfo.txt so preloaded materials, models and particles stay live on sv_pure servers. The pristine file is backed up first."
              checked={status?.gameinfoBypassed ?? false}
              disabled={locked || !status?.gameinfoFound}
              onChange={onToggleBypass}
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
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
          <p className="mt-3 max-w-[62ch] text-[12.5px] leading-5 text-ink-faint">
            Restore puts every patched byte back, un-comments gameinfo.txt and removes the addon
            pack. Building a viewmodel pack or applying mods turns Preload on launch on by itself.
          </p>
        </div>

        {status ? (
          <dl className="hero-preview surface m-0 self-start p-5">
            <Stat label="Preload" value={payload?.profilePreload ? "On" : "Off"} />
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
      {payload && anythingInstalled && payload.profilePreload && !payload.preloadLaunchInSteam ? (
        <Alert tone="warn" testId="mods-launch-warning" className="mt-6">
          The preload is not in your Steam launch options yet (Steam was open when they were saved).
          Close Steam fully, then press Apply here again — or re-apply from the Launch pane — so{" "}
          <code className="font-mono">+exec</code> reaches Steam. Without it, mods stay invisible on
          Valve servers.
        </Alert>
      ) : null}
      {untracked.length > 0 || repair === "waiting" || repair === "timeout" ? (
        <section data-testid="mods-repair" className="section">
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
            <div className="min-w-0 max-w-[62ch]">
              <h2 className="t-section">
                {repair === "waiting"
                  ? "Waiting for Steam to verify the game files"
                  : `${untracked.length} particle ${untracked.length === 1 ? "file needs" : "files need"} a repair`}
              </h2>
              <p className="t-meta mt-1">
                {repair === "waiting"
                  ? "Steam is checking TF2 now. When it puts the stock files back, execs re-applies the mods you have selected. This can take a few minutes; keep the game closed."
                  : repair === "timeout"
                    ? "Steam has not finished yet. Leave it running and press Repair again once it is done, or press Apply to re-install your selection."
                    : "These were patched by an earlier install whose tracking was lost, so execs has no stock copy to put back and they can reference materials that are no longer shipped — the sprite-renderer console flood. Only Steam holds the stock bytes: Repair asks Steam to verify TF2's files, then execs re-applies your selection on top."}
              </p>
            </div>
            <button
              type="button"
              data-testid="mods-repair-button"
              className="btn btn-primary"
              disabled={locked || repair === "waiting"}
              onClick={() => void startRepair()}
            >
              {repair === "waiting" ? "Verifying…" : "Repair with Steam"}
            </button>
          </div>
        </section>
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
      <div className="flex items-start justify-between gap-3">
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
        <Switch
          checked={checked}
          disabled={disabled}
          label={addon.name}
          testId={id}
          onChange={onToggle}
        />
      </div>
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
      <div className="flex items-start justify-between gap-3">
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
        <Switch
          checked={checked}
          disabled={disabled}
          label={mod.name.replace(/_/g, " ")}
          testId={id}
          onChange={onToggle}
        />
      </div>
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
