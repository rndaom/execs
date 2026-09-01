import { useMemo } from "react";
import { ApplyBar } from "./components/ui/ApplyBar";
import { Disclosure } from "./components/ui/Disclosure";
import { PaneHeader } from "./components/ui/PaneHeader";
import { SwitchRow } from "./components/ui/Switch";
import { useAppStatus } from "./hooks/useAppStatus";
import { useSeededDraft } from "./hooks/useSeededDraft";
import {
  ALL_TRACERS_NOTE,
  canApplyGameplay,
  clampGameplay,
  FLIP_VIEWMODELS_NOTE,
  FOV_MAX,
  FOV_MIN,
  type GameplayLayer,
  type GameplaySettings,
  gameplayDirty,
  gameplayPath,
  seedGameplay,
  serializeGameplay,
} from "./lib/gameplay-ui";

export type GameplayPaneProps = {
  layer: GameplayLayer;
  effective: Record<string, string>;
  managedText: string;
  /** The mastercomfig transparent-viewmodels addon state (mirrors the Comfig pane). */
  transparentViewmodels: boolean;
  /** Comfig-layer profile with official packages installed. */
  canUseComfigAddons: boolean;
  onToggleTransparentViewmodels: () => void;
  onSave: (gameplayText: string) => void;
};

export function GameplayPane({
  layer,
  effective,
  managedText,
  transparentViewmodels,
  canUseComfigAddons,
  onToggleTransparentViewmodels,
  onSave,
}: GameplayPaneProps) {
  const { running, busy } = useAppStatus();
  const seeded = useMemo(() => seedGameplay(managedText, effective), [managedText, effective]);
  const locked = !canApplyGameplay(running, busy);
  const [draft, setDraft] = useSeededDraft(seeded, serializeGameplay, gameplayPath(layer));
  const dirty = gameplayDirty(draft, seeded);

  function patch(update: Partial<GameplaySettings>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function onApply() {
    if (locked) {
      return;
    }
    const next = clampGameplay(draft);
    setDraft(next);
    onSave(serializeGameplay(next));
  }

  return (
    <form
      data-testid="settings-gameplay"
      className="min-w-0 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <PaneHeader
        title="Gameplay"
        lede="Field of view and viewmodels, stored in your active profile."
        actions={<p className="t-meta font-mono text-ink-faint">{gameplayPath(layer)}</p>}
      />

      {/* The four things people actually came here to change. */}
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
        <SliderRow
          id="gameplay-fov"
          testId="gameplay-fov"
          label="World FOV"
          hint="How much of the map you see."
          value={draft.fov_desired}
          min={FOV_MIN}
          max={FOV_MAX}
          disabled={locked}
          suffix="°"
          onChange={(fov_desired) => patch({ fov_desired })}
        />
        <SliderRow
          id="gameplay-viewmodel-fov"
          testId="gameplay-viewmodel-fov"
          label="Viewmodel FOV"
          hint="How much of the screen your weapon covers."
          value={draft.viewmodel_fov}
          min={FOV_MIN}
          max={FOV_MAX}
          disabled={locked}
          suffix="°"
          onChange={(viewmodel_fov) => patch({ viewmodel_fov })}
        />
      </div>

      <fieldset className="mt-8 min-w-0 border-t border-edge">
        <legend className="sr-only">Viewmodel visibility</legend>
        <SwitchRow
          id="gameplay-draw-viewmodel"
          testId="gameplay-draw-viewmodel"
          label="Draw viewmodel"
          description="Show your equipped weapon in first person."
          checked={draft.r_drawviewmodel === 1}
          disabled={locked}
          onChange={(next) => patch({ r_drawviewmodel: next ? 1 : 0 })}
        />
        <SwitchRow
          id="gameplay-min-viewmodels"
          testId="gameplay-min-viewmodels"
          label="Min viewmodels"
          description="Use TF2's compact weapon placement."
          checked={draft.tf_use_min_viewmodels === 1}
          disabled={locked}
          onChange={(next) => patch({ tf_use_min_viewmodels: next ? 1 : 0 })}
        />
      </fieldset>

      <section className="section">
        {/* The engine refuses r_drawtracers on any live server, so it is not an
            "obvious toggle" — it and its neighbours live behind a disclosure. */}
        <Disclosure storageKey="gameplay-advanced" summary="Advanced" testId="gameplay-advanced">
          <fieldset className="min-w-0 md:max-w-xl">
            <legend className="sr-only">Advanced gameplay options</legend>
            <SwitchRow
              id="gameplay-flip"
              testId="gameplay-flip"
              label="Left-handed viewmodels"
              description="Mirror the first-person weapon to the left."
              checked={draft.cl_flipviewmodels === 1}
              disabled={locked}
              note={FLIP_VIEWMODELS_NOTE}
              onChange={(next) => patch({ cl_flipviewmodels: next ? 1 : 0 })}
            />
            <SwitchRow
              id="gameplay-transparent-viewmodels"
              testId="gameplay-transparent-viewmodels"
              label="Transparent viewmodels"
              description="Make your weapon translucent. Applies immediately."
              checked={transparentViewmodels}
              disabled={locked || !canUseComfigAddons}
              note={
                canUseComfigAddons
                  ? "Needs a HUD with transparent-viewmodel support and DirectX 9. mastercomfig turns post-processing and anti-aliasing off while this is on."
                  : "Requires mastercomfig — install official packages on the Comfig pane first."
              }
              onChange={() => onToggleTransparentViewmodels()}
            />
            <SwitchRow
              id="gameplay-tracers-fp"
              testId="gameplay-tracers-fp"
              label="First-person tracers"
              description="Show tracers from your own weapon."
              checked={draft.r_drawtracers_firstperson === 1}
              disabled={locked}
              onChange={(next) => patch({ r_drawtracers_firstperson: next ? 1 : 0 })}
            />
            <SwitchRow
              id="gameplay-tracers"
              testId="gameplay-tracers"
              label="All tracers"
              description="Render tracer effects in the world."
              checked={draft.r_drawtracers === 1}
              disabled={locked}
              note={ALL_TRACERS_NOTE}
              onChange={(next) => patch({ r_drawtracers: next ? 1 : 0 })}
            />
          </fieldset>
        </Disclosure>
      </section>

      <ApplyBar
        submit
        testId="gameplay-apply"
        running={running}
        locked={locked}
        dirty={dirty}
        actionLabel="Save gameplay"
        lockedLabel="Close TF2 to apply"
        status={
          running
            ? "TF2 is open — your draft is safe, but it cannot be written yet."
            : dirty
              ? "Unsaved changes"
              : "Saved"
        }
      />
    </form>
  );
}

function SliderRow({
  id,
  testId,
  label,
  hint,
  value,
  min,
  max,
  disabled,
  suffix = "",
  onChange,
}: {
  id: string;
  testId: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="t-row">
          {label}
        </label>
        <output htmlFor={id} className="tnum text-[15px] font-medium text-ink">
          {value}
          {suffix}
        </output>
      </div>
      {hint ? <p className="t-meta mt-0.5">{hint}</p> : null}
      <input
        id={id}
        data-testid={testId}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-4 w-full cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="tnum mt-1 flex justify-between text-[11px] text-ink-faint">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
