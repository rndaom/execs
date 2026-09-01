import { useMemo } from "react";
import { ApplyBar } from "./components/ui/ApplyBar";
import { PaneSection } from "./components/ui/PaneSection";
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] leading-6 text-ink-muted">
          Tune what you see without changing competitive game logic. Every option is stored in your
          active profile.
        </p>
        <p className="font-mono text-[11px] text-ink-faint">{gameplayPath(layer)}</p>
      </div>

      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
        <SummaryStat label="World FOV" value={`${draft.fov_desired}°`} />
        <SummaryStat label="Weapon FOV" value={`${draft.viewmodel_fov}°`} />
        <SummaryStat label="Weapon side" value={draft.cl_flipviewmodels === 1 ? "Left" : "Right"} />
        <SummaryStat label="Viewmodel" value={draft.r_drawviewmodel === 1 ? "Visible" : "Hidden"} />
      </dl>

      <PaneSection
        id="gameplay-framing"
        title="Framing"
        description="World FOV changes peripheral vision. Viewmodel FOV only changes the weapon framing."
      >
        <div className="mt-4 grid gap-x-10 gap-y-5 md:grid-cols-2">
          <SliderRow
            id="gameplay-fov"
            testId="gameplay-fov"
            label="World FOV"
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
            value={draft.viewmodel_fov}
            min={FOV_MIN}
            max={FOV_MAX}
            disabled={locked}
            suffix="°"
            onChange={(viewmodel_fov) => patch({ viewmodel_fov })}
          />
        </div>
      </PaneSection>

      <PaneSection
        id="gameplay-viewmodels"
        as="fieldset"
        title="Viewmodel details"
        description="Compact positioning, visibility, and tracer preferences."
      >
        <div className="mt-2 grid md:grid-cols-2 md:gap-x-10">
          <SwitchRow
            id="gameplay-min-viewmodels"
            testId="gameplay-min-viewmodels"
            label="Min viewmodels"
            description="Use TF2's compact weapon placement."
            checked={draft.tf_use_min_viewmodels === 1}
            disabled={locked}
            onChange={(next) => patch({ tf_use_min_viewmodels: next ? 1 : 0 })}
          />
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
            id="gameplay-tracers-fp"
            testId="gameplay-tracers-fp"
            label="First-person tracers"
            description="Show tracers from your own weapon."
            checked={draft.r_drawtracers_firstperson === 1}
            disabled={locked}
            onChange={(next) => patch({ r_drawtracers_firstperson: next ? 1 : 0 })}
          />
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
            description="Make your weapon translucent (mastercomfig addon, applies immediately)."
            checked={transparentViewmodels}
            disabled={locked || !canUseComfigAddons}
            note={
              canUseComfigAddons
                ? "Needs a HUD with transparent-viewmodel support and DirectX 9. mastercomfig turns post-processing and anti-aliasing off while this is on."
                : "Requires mastercomfig — install official packages on the Comfig pane first."
            }
            onChange={() => onToggleTransparentViewmodels()}
          />
        </div>

        {/* The engine refuses r_drawtracers on any live server, so it is not an
            "obvious toggle" — it lives behind a disclosure with its note. */}
        <details data-testid="gameplay-advanced" className="group mt-4">
          <summary className="flex cursor-pointer items-center gap-2 py-2 text-xs font-medium text-ink-muted hover:text-ink">
            <span className="text-ink-faint transition-transform group-open:rotate-90">›</span>
            Advanced
          </summary>
          <div className="md:max-w-md">
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
          </div>
        </details>
      </PaneSection>

      <ApplyBar
        submit
        testId="gameplay-apply"
        running={running}
        locked={locked}
        dirty={dirty}
        actionLabel="Apply gameplay"
        lockedLabel="Close TF2 to apply"
        status={
          running
            ? "TF2 is open — your draft is safe, but it cannot be written yet."
            : dirty
              ? "Unsaved gameplay changes"
              : "Gameplay settings are up to date"
        }
      />
    </form>
  );
}

function SliderRow({
  id,
  testId,
  label,
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
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-xs text-ink-muted">
          {value}
          {suffix}
        </output>
      </div>
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
        className="mt-3 w-full cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-faint">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="eyebrow">{label}</dt>
      <dd className="m-0 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}
