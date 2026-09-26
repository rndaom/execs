import { DownloadSimple, Trash } from "@phosphor-icons/react";
import { PaneHeader } from "./components/ui/PaneHeader";
import { useCanWrite } from "./hooks/useAppStatus";
import type { ViewmodelBuildRequest, ViewmodelRecord, ViewmodelSourceCatalog } from "./lib/bridge";
import { legacyViewmodelSelectionCount } from "./lib/viewmodel-ui";
import { ViewmodelBuilder } from "./ViewmodelBuilder";
import { ViewmodelSettings, type ViewmodelSettingsProps } from "./ViewmodelSettings";

/** Per-class viewmodel choices, with the profile's saved pack kept usable. */
export function ViewmodelPane({
  active,
  profileId,
  record,
  settings,
  profilePreload,
  loadCatalog,
  onImport,
  onBuild,
  onRemove,
}: {
  active: boolean;
  profileId: string | null;
  record: ViewmodelRecord | null;
  /** The in-game cvar controls; omitted where no cfg state exists. */
  settings?: Omit<ViewmodelSettingsProps, "profileId">;
  profilePreload: boolean | null;
  loadCatalog: () => Promise<ViewmodelSourceCatalog>;
  onImport: (preload: boolean) => void;
  onBuild: (request: ViewmodelBuildRequest) => Promise<boolean>;
  onRemove: () => void;
}) {
  const locked = !useCanWrite();
  const previouslyBuilt = record?.source === "compiled";
  const locallyBuilt = record?.source === "stockBuilt";
  const legacyChoices = legacyViewmodelSelectionCount(record);
  const packLabel = previouslyBuilt
    ? legacyChoices > 0
      ? `Built with the previous builder · ${legacyChoices} ${legacyChoices === 1 ? "choice" : "choices"}`
      : "Built with the previous builder"
    : locallyBuilt
      ? "Built in execs"
      : record
        ? "Imported VPK"
        : "No pack";

  return (
    <section data-testid="settings-viewmodels" className="min-w-0 text-left">
      <PaneHeader
        title="Viewmodels"
        actions={
          record ? (
            <span data-testid="viewmodel-pack-status" className="badge">
              {previouslyBuilt ? "Previous build" : locallyBuilt ? "Built" : "Imported"}
            </span>
          ) : null
        }
      />
      {record?.sourceChanged ? (
        <p data-testid="viewmodel-source-changed" role="alert" className="t-meta mb-4 text-warn">
          The saved viewmodel pack was changed outside execs. Replace or remove it to get back to a
          known state.
        </p>
      ) : null}
      {settings ? (
        <div className="mb-8">
          <ViewmodelSettings key={profileId ?? "no-profile"} profileId={profileId} {...settings} />
        </div>
      ) : null}
      {settings ? (
        <h2 id="viewmodel-per-weapon" className="t-section section mb-3">
          Per weapon
        </h2>
      ) : null}

      <ViewmodelBuilder
        key={profileId ?? "no-profile"}
        active={active}
        profilePreload={profilePreload}
        savedRecipe={locallyBuilt ? record?.buildRecipe : undefined}
        locked={locked}
        loadCatalog={loadCatalog}
        onBuild={onBuild}
      />

      <div
        data-testid="viewmodel-saved-pack"
        className="flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-4"
      >
        <div className="min-w-0">
          <h2 className="eyebrow">Saved pack</h2>
          <p className="t-meta mt-1">{packLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="viewmodel-import"
            disabled={locked || profilePreload === null}
            onClick={() => onImport(profilePreload ?? false)}
            className="btn btn-ghost"
            title="Use a model-only VPK. Packs with cfg, HUD or sound files belong in Mods."
          >
            <DownloadSimple size={15} />
            {record ? "Replace with VPK…" : "Import VPK…"}
          </button>
          {record ? (
            <button
              type="button"
              data-testid="viewmodel-remove"
              disabled={locked}
              onClick={onRemove}
              className="btn btn-quiet"
            >
              <Trash size={14} /> Remove pack
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
