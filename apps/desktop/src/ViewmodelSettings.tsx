import { useMemo } from "react";
import { PaneSection } from "./components/ui/PaneSection";
import { SliderRow } from "./components/ui/SliderRow";
import { SwitchRow } from "./components/ui/Switch";
import { useAppStatus } from "./hooks/useAppStatus";
import { useAutosave } from "./hooks/useAutosave";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import { OFFICIAL_ADDON_DETAILS } from "./lib/comfig-ui";
import {
  clampGameplay,
  clampInt,
  FLIP_VIEWMODELS_NOTE,
  type GameplaySettings,
  seedGameplay,
  serializeGameplay,
  serializeGameplayScope,
} from "./lib/gameplay-ui";

export type ViewmodelSettingsProps = {
  profileId: string | null;
  effective: Record<string, string>;
  /** The shared managed Gameplay cfg; this section writes only its viewmodel lines. */
  managedText: string;
  /** Startup cfg values are known; otherwise the controls wait for a retry. */
  cfgReady: boolean;
  /** The mastercomfig transparent-viewmodels addon state (mirrors the Comfig pane). */
  transparentViewmodels: boolean;
  /** Official addon belongs to a Comfig profile. */
  canUseComfigAddons: boolean;
  onToggleTransparentViewmodels: () => void;
  onOpenComfig?: () => void;
  /** Resolves when the write settles. */
  onSave: (gameplayText: string) => Promise<unknown>;
};

/** Viewmodel FOV, visibility, handedness and transparency: the cvar side of Viewmodels. */
export function ViewmodelSettings({
  profileId,
  effective,
  managedText,
  cfgReady,
  transparentViewmodels,
  canUseComfigAddons,
  onToggleTransparentViewmodels,
  onOpenComfig,
  onSave,
}: ViewmodelSettingsProps) {
  const { running, busy } = useAppStatus();
  const seeded = useMemo(() => seedGameplay(managedText, effective), [managedText, effective]);
  const [draft, setDraft] = useSeededDraft(
    seeded,
    (value) => serializeGameplayScope(value, "viewmodels"),
    draftRecordKey(profileId, "viewmodel-settings"),
  );
  const token = serializeGameplayScope(draft, "viewmodels");
  const dirty = cfgReady && token !== serializeGameplayScope(seeded, "viewmodels");
  const text = serializeGameplay(clampGameplay(draft));
  useAutosave({ dirty, locked: running, token, save: () => onSave(text) });
  // The addon is a Comfig package write, not part of this cfg draft.
  const addonLocked = running || busy;

  function patch(update: Partial<GameplaySettings>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  return (
    <PaneSection
      id="viewmodel-settings"
      title="In game"
      description={cfgReady ? undefined : "Startup settings are still loading or need a retry."}
      as="fieldset"
      first
    >
      <div className="pane-split mt-3">
        <div className="min-w-0">
          {/* The readout keeps an imported fraction until the slider moves. */}
          <SliderRow
            id="viewmodel-fov"
            testId="viewmodel-fov"
            label="Viewmodel FOV"
            description="Weapon perspective, independent of your world view."
            value={draft.viewmodel_fov}
            inputValue={clampInt(draft.viewmodel_fov, 1, 179)}
            min={1}
            max={179}
            suffix="°"
            disabled={!cfgReady}
            onChange={(viewmodel_fov) => patch({ viewmodel_fov })}
          />
          <div className="mt-4">
            <SwitchRow
              id="viewmodel-draw"
              testId="viewmodel-draw"
              label="Draw viewmodel"
              checked={draft.r_drawviewmodel === 1}
              disabled={!cfgReady}
              note={
                draft.r_drawviewmodel === 1
                  ? undefined
                  : "Every viewmodel is hidden in game, whatever you choose per weapon below."
              }
              onChange={(next) => patch({ r_drawviewmodel: next ? 1 : 0 })}
            />
            <SwitchRow
              id="viewmodel-min"
              testId="viewmodel-min"
              label="Min viewmodels"
              description="Compact weapon placement."
              checked={draft.tf_use_min_viewmodels === 1}
              disabled={!cfgReady}
              onChange={(next) => patch({ tf_use_min_viewmodels: next ? 1 : 0 })}
            />
          </div>
        </div>
        <div className="min-w-0">
          <SwitchRow
            id="viewmodel-flip"
            testId="viewmodel-flip"
            label="Left-handed viewmodels"
            checked={draft.cl_flipviewmodels === 1}
            disabled={!cfgReady}
            note={FLIP_VIEWMODELS_NOTE}
            onChange={(next) => patch({ cl_flipviewmodels: next ? 1 : 0 })}
          />
          <SwitchRow
            id="viewmodel-transparent"
            testId="viewmodel-transparent"
            label="Transparent viewmodels"
            description={OFFICIAL_ADDON_DETAILS["transparent-viewmodels"]}
            checked={transparentViewmodels}
            disabled={addonLocked || !canUseComfigAddons}
            note={
              canUseComfigAddons
                ? "A mastercomfig addon, also shown in Comfig. Applies when you select it."
                : "Available with a Comfig profile."
            }
            onChange={() => onToggleTransparentViewmodels()}
          />
          {onOpenComfig ? (
            <button type="button" className="btn btn-ghost mt-2" onClick={onOpenComfig}>
              Open Comfig addons
            </button>
          ) : null}
        </div>
      </div>
    </PaneSection>
  );
}
