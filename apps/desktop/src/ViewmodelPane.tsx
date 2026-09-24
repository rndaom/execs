import { DownloadSimple, Trash } from "@phosphor-icons/react";
import { PaneHeader } from "./components/ui/PaneHeader";
import { useCanWrite } from "./hooks/useAppStatus";
import type { ViewmodelRecord } from "./lib/bridge";
import { legacyViewmodelSelectionCount, VIEWMODEL_CASUAL_COPY } from "./lib/viewmodel-ui";

/** Saved packs remain usable while the replacement builder is completed. */
export function ViewmodelPane({
  record,
  globalViewmodelsShown,
  profilePreload,
  onOpenGameplay,
  onOpenCasualSetup,
  onImport,
  onRemove,
}: {
  record: ViewmodelRecord | null;
  globalViewmodelsShown: boolean | null;
  profilePreload: boolean | null;
  onOpenGameplay: () => void;
  onOpenCasualSetup: () => void;
  onImport: (preload: boolean) => void;
  onRemove: () => void;
}) {
  const locked = !useCanWrite();
  const previouslyBuilt = record?.source === "compiled";
  const savedChoices = legacyViewmodelSelectionCount(record);

  return (
    <section data-testid="settings-viewmodels" className="min-w-0 text-left">
      <PaneHeader
        title="Viewmodels"
        actions={
          record ? (
            <span data-testid="viewmodel-pack-status" className="badge">
              {previouslyBuilt ? "Previously built pack" : "Imported pack"}
            </span>
          ) : null
        }
      />
      <div role="note" className="surface mb-4 px-4 py-3">
        <p className="t-meta">
          The Viewmodels builder and previews are being rebuilt for 0.2.0. Building is temporarily
          unavailable in this development build. Saved packs can still be imported, switched,
          exported with a profile, or removed.
        </p>
      </div>
      {record?.sourceChanged ? (
        <div
          data-testid="viewmodel-source-changed"
          role="alert"
          className="surface mb-4 px-4 py-3 text-warn"
        >
          The saved viewmodel VPK changed outside execs. Its recorded source details may no longer
          describe the installed models. Replace the model-only VPK or remove it to restore a
          verified state.
        </div>
      ) : null}
      <div
        data-testid="viewmodel-global-status"
        role="status"
        className="surface mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3"
      >
        <p className="t-meta">
          Global Draw viewmodel:{" "}
          {globalViewmodelsShown === null ? "Unknown" : globalViewmodelsShown ? "On" : "Off"}.
          {globalViewmodelsShown === false
            ? " Gameplay hides all first-person viewmodels, including any saved pack."
            : " Managed in Gameplay."}
        </p>
        <button type="button" className="btn btn-ghost" onClick={onOpenGameplay}>
          Open Gameplay
        </button>
      </div>
      <div
        data-testid="viewmodel-preload-status"
        className="surface mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3"
      >
        <p className="t-meta">
          Casual preload: {profilePreload === null ? "Checking…" : profilePreload ? "On" : "Off"}.
          Managed in Mods → Casual setup.
        </p>
        <button type="button" className="btn btn-ghost" onClick={onOpenCasualSetup}>
          Open Casual setup
        </button>
      </div>

      <div className="surface p-5">
        <h2 className="t-row">Saved viewmodel pack</h2>
        {record ? (
          <>
            <p className="t-meta mt-2">
              {previouslyBuilt
                ? savedChoices > 0
                  ? `This pack and its ${savedChoices} recorded ${savedChoices === 1 ? "choice" : "choices"} remain in the profile. Switching profiles uses the saved VPK bytes.`
                  : "This previously built pack remains in the profile. Its original choices are not available as editable metadata; switching profiles uses the saved VPK bytes."
                : "This imported model-only VPK remains in the profile and can be switched with it."}
            </p>
            {previouslyBuilt ? (
              <p className="pane-note mt-3">
                Recorded choices are preserved while the replacement builder is completed. They are
                temporarily read only. Replacing this VPK does not modify other profiles.
              </p>
            ) : null}
          </>
        ) : (
          <p className="t-meta mt-2">
            Import a model-only VPK to use a viewmodel pack with this profile.
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="viewmodel-import"
            disabled={locked || profilePreload === null}
            onClick={() => onImport(profilePreload ?? false)}
            className="btn btn-primary"
          >
            <DownloadSimple size={15} />
            {record ? "Replace VPK…" : "Import VPK…"}
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
      <p className="pane-note mt-4">{VIEWMODEL_CASUAL_COPY}</p>
      <p className="pane-note mt-2">
        Import a model-only VPK here. Use Mods for a pack that also contains CFG, HUD, sound,
        scripts or materials. No in-game viewmodel preview is available in this pane.
      </p>
    </section>
  );
}
