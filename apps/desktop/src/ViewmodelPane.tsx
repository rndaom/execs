import { DownloadSimple, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { ClassTabs } from "./components/ui/ClassTabs";
import { PaneHeader } from "./components/ui/PaneHeader";
import { useAppStatus, useCanWrite } from "./hooks/useAppStatus";
import type { ViewmodelBuildRequest, ViewmodelRecord, ViewmodelSourceCatalog } from "./lib/bridge";
import { legacyViewmodelSelectionCount } from "./lib/viewmodel-ui";
import { ViewmodelBuilder } from "./ViewmodelBuilder";
import { ViewmodelSettings, type ViewmodelSettingsProps } from "./ViewmodelSettings";

type ViewmodelView = "game" | "weapons";

/**
 * Viewmodels in two views: the in-game settings, and the per-class weapon
 * choices with the profile's saved pack kept usable beside them.
 */
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
  const { running } = useAppStatus();
  const [barSlot, setBarSlot] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<ViewmodelView>("game");
  const previouslyBuilt = record?.source === "compiled";
  const locallyBuilt = record?.source === "stockBuilt";
  const legacyChoices = legacyViewmodelSelectionCount(record);
  const packLabel = previouslyBuilt
    ? legacyChoices > 0
      ? `Built with the previous builder · ${legacyChoices} ${legacyChoices === 1 ? "choice" : "choices"}`
      : "Built with the previous builder"
    : locallyBuilt
      ? "Built in execs from your TF2 files."
      : record
        ? "Your own VPK."
        : "None. TF2 shows its normal viewmodels.";

  const weapons = (
    <>
      <ViewmodelBuilder
        key={profileId ?? "no-profile"}
        active={active}
        profileId={profileId}
        profilePreload={profilePreload}
        savedRecipe={locallyBuilt ? record?.buildRecipe : undefined}
        locked={locked}
        running={running}
        barSlot={barSlot}
        loadCatalog={loadCatalog}
        onBuild={onBuild}
        onRemovePack={onRemove}
      />

      <section
        data-testid="viewmodel-saved-pack"
        aria-labelledby="viewmodel-pack-heading"
        className="flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-5"
      >
        <div className="min-w-0">
          <h2 id="viewmodel-pack-heading" className="t-section">
            Viewmodel pack
          </h2>
          <p className="t-meta mt-1" data-testid="viewmodel-pack-status">
            {packLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="viewmodel-import"
            disabled={locked || profilePreload === null}
            onClick={() => onImport(profilePreload ?? false)}
            className="btn btn-ghost"
            title="A model-only VPK. Packs with cfg, HUD or sound files belong in Mods."
          >
            <DownloadSimple size={15} aria-hidden="true" />
            {record ? "Replace with your own VPK…" : "Use your own VPK…"}
          </button>
          {record ? (
            <button
              type="button"
              data-testid="viewmodel-remove"
              disabled={locked}
              onClick={onRemove}
              className="btn btn-ghost"
            >
              <Trash size={14} aria-hidden="true" /> Remove pack
            </button>
          ) : null}
        </div>
      </section>
    </>
  );

  return (
    <section data-testid="settings-viewmodels" className="min-w-0 text-left">
      <PaneHeader title="Viewmodels" compact={Boolean(settings)} />
      {record?.sourceChanged ? (
        <p data-testid="viewmodel-source-changed" role="alert" className="t-meta mb-4 text-warn">
          This pack was changed outside execs. Replace or remove it.
        </p>
      ) : null}
      {settings ? (
        <div className="pane-views">
          <ClassTabs
            tabs={[
              { id: "game", label: "In game" },
              { id: "weapons", label: "Per weapon" },
            ]}
            selected={view}
            label="Viewmodels"
            idPrefix="viewmodel-view"
            panelId="viewmodel-view-panel"
            onSelect={setView}
          />
        </div>
      ) : null}

      {settings ? (
        <div id="viewmodel-view-panel" role="tabpanel" aria-labelledby={`viewmodel-view-${view}`}>
          <div hidden={view !== "game"} className="pt-5" data-testid="viewmodel-view-game">
            <ViewmodelSettings
              key={profileId ?? "no-profile"}
              profileId={profileId}
              {...settings}
            />
          </div>
          <div hidden={view !== "weapons"} className="pt-5" data-testid="viewmodel-view-weapons">
            {weapons}
          </div>
        </div>
      ) : (
        weapons
      )}
      {/* The apply bar sits at the end of the pane so it stays in view in both views. */}
      <div ref={setBarSlot} className="contents" />
    </section>
  );
}
