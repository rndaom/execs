import { useEffect, useMemo, useRef, useState } from "react";
import { GameBananaBrowser } from "./components/GameBananaBrowser";
import { ModList } from "./components/ModList";
import { Alert } from "./components/ui/Alert";
import { ApplyBar } from "./components/ui/ApplyBar";
import { Disclosure } from "./components/ui/Disclosure";
import { PaneHeader } from "./components/ui/PaneHeader";
import { PaneSection } from "./components/ui/PaneSection";
import { Switch, SwitchRow } from "./components/ui/Switch";
import { useAppStatus, useCanWrite } from "./hooks/useAppStatus";
import { useSeededDraft } from "./hooks/useSeededDraft";
import type { Api } from "./lib/api";
import type {
  CatalogAddon,
  CatalogParticleMod,
  ModRecord,
  ModsCatalog,
  ParticleSource,
  PreloaderReport,
  PreloaderStatusPayload,
} from "./lib/bridge";
import {
  formatModBytes,
  installedModSelection,
  type ModSelection,
  modDomId,
  modsApplyEnabled,
  modsStatusLine,
  PRELOADER_CREDIT,
  PRELOADER_EXPLAINER,
  REPAIR_POLL_MS,
  REPAIR_TIMEOUT_MS,
  repairComplete,
  serializeModSelection,
  summarizeReport,
  toggleName,
  visibleModSelection,
} from "./lib/mods-ui";

export type ModsPaneProps = {
  api: Api;
  /** Active profile; disclosure state is remembered per profile. */
  profileId: string | null;
  payload: PreloaderStatusPayload | null;
  catalog: ModsCatalog | null;
  /** The active profile's own packs; absent on an older backend. */
  mods: ModRecord[];
  loading: boolean;
  report: PreloaderReport | null;
  onDownloadLibrary: () => void;
  onApply: (addons: string[], particleMods: string[], profileParticleMods: string[]) => void;
  onToggleBypass: (enabled: boolean) => void;
  onTogglePreload: (enabled: boolean) => void;
  onRevert: () => void;
  /** Start Steam's verify; the pane polls `onRefreshStatus` until it finishes. */
  onRepair: () => Promise<void>;
  onRefreshStatus: () => Promise<void>;
  onOpenRepo: () => void;
  onImportArchive: () => void;
  onImportFolder: () => void;
  onRemoveMod: (id: string) => void;
  /** Resolves once the install and the profile reload behind it finished. */
  onInstallGameBananaMod: (id: number) => Promise<void>;
};

export function ModsPane({
  api,
  profileId,
  payload,
  catalog,
  mods,
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
  onImportArchive,
  onImportFolder,
  onRemoveMod,
  onInstallGameBananaMod,
}: ModsPaneProps) {
  const { running, busy } = useAppStatus();
  const status = payload?.status ?? null;
  const installed = useMemo<ModSelection>(() => installedModSelection(payload), [payload]);
  const [draft, setSelection] = useSeededDraft(installed, serializeModSelection);
  const particleSources = payload?.profileParticleSources ?? [];
  // Removing a pack takes its rows with it; a pick left behind would keep Apply
  // lit over something nothing on screen can switch off.
  const selection = visibleModSelection(draft, particleSources, installed.profileParticleMods);
  const { addons, particleMods, profileParticleMods } = selection;
  const [browsing, setBrowsing] = useState(false);

  const locked = !useCanWrite();
  const canApply = modsApplyEnabled(payload, selection);
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
      const want = repairSelection.current;
      if (
        want.addons.length > 0 ||
        want.particleMods.length > 0 ||
        want.profileParticleMods.length > 0
      ) {
        onApply(want.addons, want.particleMods, want.profileParticleMods);
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

  // Steam can finish after the wait gave up. Once the status reports nothing
  // left to repair the section goes away rather than counting zero files.
  useEffect(() => {
    if (repair === "timeout" && untracked.length === 0) {
      setRepair("idle");
    }
  }, [repair, untracked.length]);

  async function startRepair() {
    repairStarted.current = Date.now();
    repairSelection.current = selection;
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
            Valve Casual runs sv_pure — content only survives if it is precached first.
          </p>
          <div className="mt-3 max-w-xl">
            <SwitchRow
              id="mods-profile-preload"
              testId="mods-profile-preload"
              label="Preload on launch"
              description="Loads itemtest briefly at startup; community servers work without it."
              checked={payload?.profilePreload ?? false}
              disabled={locked || !payload}
              onChange={onTogglePreload}
            />
            <SwitchRow
              id="mods-bypass-toggle"
              testId="mods-bypass-toggle"
              label="Material bypass"
              description="Keeps preloaded materials live on sv_pure; edits one line in gameinfo.txt, backed up first."
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
            Restore puts back every patched byte, un-comments gameinfo.txt and removes the addon
            pack. Building a pack or applying mods turns Preload on by itself.
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
          TF2 updated — the old patches are gone. Apply again to re-install them.
        </Alert>
      ) : null}
      {payload && anythingInstalled && payload.profilePreload && !payload.preloadLaunchInSteam ? (
        <Alert tone="warn" testId="mods-launch-warning" className="mt-6">
          Steam was open, so the preload never reached your launch options. Close Steam fully and
          press Apply again. Without it, mods stay invisible on Valve servers.
        </Alert>
      ) : null}
      {untracked.length > 0 || repair === "waiting" ? (
        <section data-testid="mods-repair" className="section">
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
            <div className="min-w-0 max-w-[62ch]">
              <h2 className="t-section">
                {repair === "waiting"
                  ? "Waiting for Steam to verify"
                  : `${untracked.length} particle ${untracked.length === 1 ? "file needs" : "files need"} a repair`}
              </h2>
              <p className="t-meta mt-1">
                {repair === "waiting"
                  ? "Keep the game closed; your selection re-applies when Steam finishes."
                  : repair === "timeout"
                    ? "Steam has not finished. Press Repair again once it is done."
                    : "Patched by an earlier install with no snapshot to restore. Repair asks Steam to verify TF2, then re-applies your selection."}
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
          gameinfo.txt not found — check the TF2 folder.
        </Alert>
      ) : null}

      <ModList
        mods={mods}
        locked={locked}
        running={running}
        onImportArchive={onImportArchive}
        onImportFolder={onImportFolder}
        onRemove={onRemoveMod}
      />

      <PaneSection title="Browse GameBanana" id="mods-gamebanana">
        <Disclosure
          profileId={profileId}
          storageKey="mods-gamebanana"
          summary="Search and install"
          testId="mods-gamebanana-disclosure"
          onOpenChange={setBrowsing}
        >
          <GameBananaBrowser
            api={api}
            active={browsing}
            installed={mods}
            locked={locked}
            running={running}
            onInstall={onInstallGameBananaMod}
          />
        </Disclosure>
      </PaneSection>

      <PaneSection
        title="Default mod library"
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
          <p className="t-meta mt-4">One-time download, verified and cached.</p>
        ) : null}
        {loading && !catalog ? (
          <p className="t-meta mt-4" role="status">
            Loading library…
          </p>
        ) : null}

        {catalog ? (
          <div className="mt-4 grid gap-8 lg:grid-cols-2">
            <div>
              <h3 className="eyebrow">Addons</h3>
              <p className="mt-1 text-[12px] leading-5 text-ink-faint">
                Packed into execs-preloader.vpk in tf/custom.
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
                Patched into tf2_misc in place; later picks win contested files.
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

        {/* Particles the user's own packs bring: same patching, same Apply. */}
        {particleSources.length > 0 ? (
          <div data-testid="mods-profile-particles" className="mt-8">
            <h3 className="eyebrow">From your mods</h3>
            <ul className="mt-3 list-none p-0">
              {particleSources.map((source) => (
                <ProfileParticleRow
                  key={source.modId}
                  source={source}
                  checked={profileParticleMods.includes(source.modId)}
                  disabled={locked}
                  onToggle={() =>
                    setSelection((current) => ({
                      ...current,
                      profileParticleMods: toggleName(current.profileParticleMods, source.modId),
                    }))
                  }
                />
              ))}
            </ul>
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
        status={modsStatusLine(payload, selection, running)}
        actionLabel="Apply mods"
        lockedLabel="Close TF2 to apply"
        running={running}
        locked={locked}
        // Not `selectionDirty`: a TF2 update wipes the patches without touching
        // the recorded selection, so gating on it would disable Apply exactly
        // when the stale notice tells the user to press it.
        dirty={canApply}
        testId="mods-apply"
        onApply={() => onApply(addons, particleMods, profileParticleMods)}
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
              Includes sounds — best-effort on sv_pure.
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

function ProfileParticleRow({
  source,
  checked,
  disabled,
  onToggle,
}: {
  source: ParticleSource;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const count = source.pcfFiles.length;
  return (
    <li className="border-b border-edge py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="t-row block truncate">{source.name}</span>
          <span className="t-meta mt-0.5 block">
            {count} particle {count === 1 ? "file" : "files"}
          </span>
        </span>
        <Switch
          checked={checked}
          disabled={disabled}
          label={source.name}
          testId={`mods-profile-particle-${modDomId(source.modId)}`}
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
