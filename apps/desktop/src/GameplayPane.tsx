import { useEffect, useMemo, useState } from "react";
import { CopySettings, type CopySettingsSource } from "./components/CopySettings";
import { PaneHeader } from "./components/ui/PaneHeader";
import { PaneSection } from "./components/ui/PaneSection";
import { SliderRow } from "./components/ui/SliderRow";
import { SwitchRow } from "./components/ui/Switch";
import { useAppStatus } from "./hooks/useAppStatus";
import { useAutosave } from "./hooks/useAutosave";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import {
  clampGameplay,
  clampInt,
  FOV_MAX,
  FOV_MIN,
  formatCvarNumber,
  type GameplayLayer,
  type GameplaySettings,
  gameplayPath,
  parseSensitivityInput,
  seedGameplay,
  serializeGameplay,
  serializeGameplayScope,
} from "./lib/gameplay-ui";
import { copySettingsBlocked } from "./lib/settings-ui";

export type GameplayPaneProps = {
  /** The profile this draft belongs to; a switch discards it. */
  profileId: string | null;
  layer: GameplayLayer;
  effective: Record<string, string>;
  managedText: string;
  /** Viewmodel FOV, visibility and transparency live in the Viewmodels pane. */
  onOpenViewmodels?: () => void;
  /** Resolves when the write settles; the toast reports it. */
  onSave: (gameplayText: string) => Promise<unknown>;
  /** Copy the saved Gameplay settings to other profiles; offered only when provided. */
  copySettings?: CopySettingsSource;
};

export function GameplayPane({
  profileId,
  layer,
  effective,
  managedText,
  onOpenViewmodels,
  onSave,
  copySettings,
}: GameplayPaneProps) {
  const { running, busy } = useAppStatus();
  const seeded = useMemo(() => seedGameplay(managedText, effective), [managedText, effective]);
  const [draft, setDraft] = useSeededDraft(
    seeded,
    (value) => serializeGameplayScope(value, "gameplay"),
    draftRecordKey(profileId, gameplayPath(layer)),
  );
  const token = serializeGameplayScope(draft, "gameplay");
  const dirty = token !== serializeGameplayScope(seeded, "gameplay");
  // Everything here is a draft of one managed cfg, so nothing is disabled: the
  // write lock defers the save, it does not take the sliders away.
  const text = serializeGameplay(clampGameplay(draft));
  useAutosave({ dirty, locked: running, token, save: () => onSave(text) });

  function patch(update: Partial<GameplaySettings>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  return (
    <section data-testid="settings-gameplay" className="min-w-0 text-left">
      <div className="hero-row gameplay-workspace">
        <div>
          <PaneHeader
            title="Gameplay"
            actions={
              copySettings ? (
                <CopySettings
                  scope="gameplay"
                  source={copySettings}
                  blockedReason={copySettingsBlocked(running, busy, dirty)}
                />
              ) : undefined
            }
          />
          <div className="grid gap-6">
            <SliderRow
              id="gameplay-fov"
              testId="gameplay-fov"
              label="World FOV"
              description={
                draft.fov_desired < FOV_MIN || draft.fov_desired > FOV_MAX
                  ? `Your cfg sets ${draft.fov_desired}°, so TF2 uses ${clampInt(draft.fov_desired, FOV_MIN, FOV_MAX)}°.`
                  : undefined
              }
              value={clampInt(draft.fov_desired, FOV_MIN, FOV_MAX)}
              min={FOV_MIN}
              max={FOV_MAX}
              suffix="°"
              onChange={(fov_desired) => patch({ fov_desired })}
            />
          </div>
        </div>
        <aside
          className="surface hero-preview mt-8 self-start p-5"
          aria-label="Field of view values"
        >
          <h2 className="t-section">Field of view</h2>
          <dl className="mt-4 grid gap-3">
            <div className="flex items-baseline justify-between gap-3 border-b border-edge pb-3">
              <dt className="t-meta">World</dt>
              <dd className="tnum t-row">{draft.fov_desired}°</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="t-meta">Weapon</dt>
              <dd className="tnum t-row">{draft.viewmodel_fov}°</dd>
            </div>
          </dl>
        </aside>
      </div>

      <PaneSection id="gameplay-mouse" title="Mouse" as="fieldset">
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <NumberField
            id="gameplay-sensitivity"
            testId="gameplay-sensitivity"
            label="Sensitivity"
            value={draft.sensitivity}
            resetKey={profileId}
            onChange={(sensitivity) => patch({ sensitivity })}
          />
          <NumberField
            id="gameplay-zoom-sensitivity"
            testId="gameplay-zoom-sensitivity"
            label="Zoomed sensitivity ratio"
            value={draft.zoom_sensitivity_ratio}
            resetKey={profileId}
            onChange={(zoom_sensitivity_ratio) => patch({ zoom_sensitivity_ratio })}
          />
        </div>
      </PaneSection>

      <div className="section pane-split">
        <PaneSection id="gameplay-weapons" title="Weapons" as="fieldset" first>
          <SwitchRow
            id="gameplay-autoreload"
            testId="gameplay-autoreload"
            label="Auto reload"
            checked={draft.cl_autoreload === 1}
            onChange={(next) => patch({ cl_autoreload: next ? 1 : 0 })}
          />
          <SwitchRow
            id="gameplay-fastswitch"
            testId="gameplay-fastswitch"
            label="Fast weapon switch"
            checked={draft.hud_fastswitch !== 0}
            note={
              draft.hud_fastswitch !== 0 && draft.hud_fastswitch !== 1
                ? `Your cfg uses mode ${draft.hud_fastswitch}; kept until you change this.`
                : undefined
            }
            onChange={(next) => patch({ hud_fastswitch: next ? 1 : 0 })}
          />
          <SwitchRow
            id="gameplay-medigun-autoheal"
            testId="gameplay-medigun-autoheal"
            label="Medigun auto-heal"
            checked={draft.tf_medigun_autoheal === 1}
            onChange={(next) => patch({ tf_medigun_autoheal: next ? 1 : 0 })}
          />
          {/* TF2 refuses the cheat-only r_drawtracers from startup cfgs, so it has no control. */}
          <SwitchRow
            id="gameplay-tracers-fp"
            testId="gameplay-tracers-fp"
            label="First-person tracers"
            checked={draft.r_drawtracers_firstperson === 1}
            onChange={(next) => patch({ r_drawtracers_firstperson: next ? 1 : 0 })}
          />
        </PaneSection>

        <PaneSection id="gameplay-combat-feedback" title="Combat feedback" as="fieldset" first>
          <SwitchRow
            id="gameplay-combattext"
            testId="gameplay-combattext"
            label="Damage numbers"
            checked={draft.hud_combattext === 1}
            onChange={(next) => patch({ hud_combattext: next ? 1 : 0 })}
          />
          <SwitchRow
            id="gameplay-combattext-batching"
            testId="gameplay-combattext-batching"
            label="Combine damage numbers"
            checked={draft.hud_combattext_batching === 1}
            note={draft.hud_combattext === 1 ? undefined : "Needs damage numbers."}
            onChange={(next) => patch({ hud_combattext_batching: next ? 1 : 0 })}
          />
          <SwitchRow
            id="gameplay-combattext-healing"
            testId="gameplay-combattext-healing"
            label="Healing numbers"
            checked={draft.hud_combattext_healing === 1}
            onChange={(next) => patch({ hud_combattext_healing: next ? 1 : 0 })}
          />
        </PaneSection>
      </div>

      <div className="section pane-split">
        <PaneSection id="gameplay-viewmodels" title="Viewmodels" first>
          {onOpenViewmodels ? (
            <button
              type="button"
              data-testid="gameplay-open-viewmodels"
              className="btn btn-ghost mt-3"
              onClick={onOpenViewmodels}
            >
              Open Viewmodels
            </button>
          ) : null}
        </PaneSection>
      </div>
    </section>
  );
}

/**
 * Exact decimal entry. The text the player types is kept while it is being
 * edited; only a valid number reaches the draft, so nothing is rounded.
 */
function NumberField({
  id,
  testId,
  label,
  description,
  value,
  resetKey,
  onChange,
}: {
  id: string;
  testId: string;
  label: string;
  description?: string;
  value: number;
  /** A different profile replaces whatever was typed. */
  resetKey: string | null;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(() => formatCvarNumber(value));
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new profile or an outside value change replaces typed text.
  useEffect(() => {
    setText((current) => {
      const parsed = parseSensitivityInput(current);
      return parsed.value === value ? current : formatCvarNumber(value);
    });
  }, [value, resetKey]);
  const parsed = parseSensitivityInput(text);
  const describedBy = [
    description ? `${id}-description` : null,
    parsed.problem ? `${id}-problem` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="t-row block">
        {label}
      </label>
      {description ? (
        <p id={`${id}-description`} className="t-meta mt-1">
          {description}
        </p>
      ) : null}
      <input
        id={id}
        data-testid={testId}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={text}
        aria-invalid={parsed.problem ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={(event) => {
          setText(event.target.value);
          const next = parseSensitivityInput(event.target.value);
          if (next.value !== null) onChange(next.value);
        }}
        onBlur={() => {
          if (parsed.value !== null) setText(formatCvarNumber(parsed.value));
        }}
        className={`field tnum mt-2 block w-40 px-3 py-2 text-[15px] text-ink focus:outline-none ${
          parsed.problem ? "border-warn/70" : ""
        }`}
      />
      {parsed.problem ? (
        <p id={`${id}-problem`} role="alert" className="t-meta mt-1.5 text-warn">
          {parsed.problem} The saved value stays {formatCvarNumber(value)}.
        </p>
      ) : null}
    </div>
  );
}
