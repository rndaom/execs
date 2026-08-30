import { useEffect, useMemo, useState } from "react";
import type { ViewmodelRecord } from "./lib/bridge";
import { canWriteSettings } from "./lib/settings-ui";
import {
  compileAvailable,
  emptyWeaponDraft,
  seedViewmodelDraft,
  VIEWMODEL_CASUAL_COPY,
  VIEWMODEL_CLASSES,
  type ViewmodelClass,
  type ViewmodelWeaponDraft,
} from "./lib/viewmodel-ui";

const DEFAULT_WEAPONS: Record<ViewmodelClass, string[]> = {
  scout: ["scattergun", "pistol", "bat"],
  soldier: ["rocketlauncher", "shotgun", "shovel"],
  pyro: ["flamethrower", "shotgun", "fireaxe"],
  demoman: ["grenadelauncher", "stickybomb", "bottle"],
  heavy: ["minigun", "shotgun", "fists"],
  engineer: ["shotgun", "pistol", "wrench"],
  medic: ["syringegun", "medigun", "bonesaw"],
  sniper: ["sniperrifle", "smg", "kukri"],
  spy: ["revolver", "knife", "invis"],
};

function NumberField({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm text-ink" htmlFor={id}>
      {label}
      <input
        id={id}
        data-testid={id}
        type="number"
        step="0.5"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="rounded-lg border border-edge bg-bg px-2 py-1 text-sm text-ink"
      />
    </label>
  );
}

export function ViewmodelPane({
  running,
  busy,
  record,
  platform,
  onCompile,
  onImport,
  onRemove,
  onTogglePreload,
}: {
  running: boolean;
  busy: boolean;
  record: ViewmodelRecord | null;
  platform: string;
  onCompile: (options: Record<string, string>, preload: boolean) => void;
  onImport: () => void;
  onRemove: () => void;
  onTogglePreload: (enabled: boolean) => void;
}) {
  const locked = !canWriteSettings(running, busy);
  const seeded = useMemo(() => seedViewmodelDraft(record), [record]);
  const [draft, setDraft] = useState(seeded);
  const [weapon, setWeapon] = useState(DEFAULT_WEAPONS.scout[0]);
  const canCompile = compileAvailable(platform);

  useEffect(() => {
    setDraft(seeded);
  }, [seeded]);

  const weapons = DEFAULT_WEAPONS[draft.classId];
  const current = draft.weapons[weapon] ?? emptyWeaponDraft();

  function patchWeapon(next: Partial<ViewmodelWeaponDraft>) {
    setDraft({
      ...draft,
      weapons: {
        ...draft.weapons,
        [weapon]: { ...current, ...next },
      },
    });
  }

  function optionsPayload(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(draft.weapons)) {
      out[key] = JSON.stringify(value);
    }
    return out;
  }

  return (
    <section data-testid="settings-viewmodels" className="flex flex-col gap-5 text-left">
      <p className="text-sm text-ink-muted">{VIEWMODEL_CASUAL_COPY}</p>

      <div className="flex flex-wrap gap-2">
        {VIEWMODEL_CLASSES.map((id) => (
          <button
            key={id}
            type="button"
            data-testid={`viewmodel-class-${id}`}
            data-active={draft.classId === id ? "true" : "false"}
            onClick={() => {
              setDraft({ ...draft, classId: id });
              setWeapon(DEFAULT_WEAPONS[id][0]);
            }}
            className={`rounded-pill px-3 py-1 text-xs ${
              draft.classId === id
                ? "bg-brand text-on-brand"
                : "border border-edge text-ink hover:bg-panel-raised"
            }`}
          >
            {id}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-sm text-ink" htmlFor="viewmodel-weapon">
        Weapon
        <select
          id="viewmodel-weapon"
          data-testid="viewmodel-weapon"
          value={weapon}
          onChange={(event) => setWeapon(event.target.value)}
          className="rounded-lg border border-edge bg-bg px-2 py-1 text-sm text-ink"
        >
          {weapons.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-3 gap-2">
        <NumberField
          id="viewmodel-origin-x"
          label="Origin X"
          value={current.originX}
          disabled={locked}
          onChange={(originX) => patchWeapon({ originX })}
        />
        <NumberField
          id="viewmodel-origin-y"
          label="Origin Y"
          value={current.originY}
          disabled={locked}
          onChange={(originY) => patchWeapon({ originY })}
        />
        <NumberField
          id="viewmodel-origin-z"
          label="Origin Z"
          value={current.originZ}
          disabled={locked}
          onChange={(originZ) => patchWeapon({ originZ })}
        />
        <NumberField
          id="viewmodel-rotate-x"
          label="Rotate X"
          value={current.rotateX}
          disabled={locked}
          onChange={(rotateX) => patchWeapon({ rotateX })}
        />
        <NumberField
          id="viewmodel-rotate-y"
          label="Rotate Y"
          value={current.rotateY}
          disabled={locked}
          onChange={(rotateY) => patchWeapon({ rotateY })}
        />
        <NumberField
          id="viewmodel-rotate-z"
          label="Rotate Z"
          value={current.rotateZ}
          disabled={locked}
          onChange={(rotateZ) => patchWeapon({ rotateZ })}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          data-testid="viewmodel-hide"
          checked={current.hide}
          disabled={locked}
          onChange={(event) => patchWeapon({ hide: event.target.checked })}
        />
        Hide
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          data-testid="viewmodel-left-arm"
          checked={current.removeLeftArm}
          disabled={locked}
          onChange={(event) => patchWeapon({ removeLeftArm: event.target.checked })}
        />
        Remove left arm
      </label>
      <fieldset className="grid grid-cols-2 gap-2 text-sm text-ink">
        <legend className="font-display text-sm tracking-wide">Keep visible if hidden</legend>
        {(
          [
            ["draw", "Draw"],
            ["reload", "Reload"],
            ["attack", "Attack"],
            ["altAttack", "Alt attack"],
            ["idle", "Idle"],
            ["special", "Special"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              data-testid={`viewmodel-keep-${key}`}
              checked={current.keep[key]}
              disabled={locked}
              onChange={(event) =>
                patchWeapon({ keep: { ...current.keep, [key]: event.target.checked } })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <fieldset className="grid grid-cols-2 gap-2 text-sm text-ink">
        <legend className="font-display text-sm tracking-wide">Static</legend>
        {(
          [
            ["draw", "Draw"],
            ["reload", "Reload"],
            ["attack", "Attack"],
            ["idle", "Idle"],
            ["moreStaticIdle", "More static idle"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              data-testid={`viewmodel-static-${key}`}
              checked={current.stat[key]}
              disabled={locked}
              onChange={(event) =>
                patchWeapon({ stat: { ...current.stat, [key]: event.target.checked } })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <fieldset className="grid grid-cols-2 gap-2 text-sm text-ink">
        <legend className="font-display text-sm tracking-wide">Weapon extras</legend>
        {(
          [
            ["keepBeamVisible", "Medigun beam"],
            ["keepFlamesVisible", "Flamethrower flames"],
            ["keepBackstabDetectionVisible", "Knife backstab detection"],
            ["keepBackstabVisible", "Knife backstab"],
            ["instantBackstabDetection", "Instant backstab detection"],
            ["replaceBackstabWithNormalAttack", "Replace backstab with attack"],
            ["staticBackstabDetection", "Static backstab detection"],
            ["staticBackstab", "Static backstab"],
            ["removeShells", "Remove shells"],
            ["keepTracersVisible", "Tracers"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              data-testid={`viewmodel-extra-${key}`}
              checked={current.extra[key]}
              disabled={locked}
              onChange={(event) =>
                patchWeapon({ extra: { ...current.extra, [key]: event.target.checked } })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          data-testid="viewmodel-preload"
          checked={draft.preload}
          disabled={locked}
          onChange={(event) => {
            const preload = event.target.checked;
            setDraft({ ...draft, preload });
            onTogglePreload(preload);
          }}
        />
        Casual preload
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="viewmodel-compile"
          disabled={locked || !canCompile}
          onClick={() => onCompile(optionsPayload(), draft.preload)}
          className="rounded-pill bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
        >
          {running
            ? "Close TF2 to compile"
            : canCompile
              ? "Compile viewmodels"
              : "Compile is Windows-only"}
        </button>
        <button
          type="button"
          data-testid="viewmodel-import"
          disabled={locked}
          onClick={onImport}
          className="rounded-pill border border-edge px-4 py-2 text-sm text-ink hover:bg-panel-raised disabled:opacity-40"
        >
          Import prebuilt VPK
        </button>
        {record ? (
          <button
            type="button"
            data-testid="viewmodel-remove"
            disabled={locked}
            onClick={onRemove}
            className="rounded-pill border border-edge px-4 py-2 text-sm text-ink hover:bg-panel-raised disabled:opacity-40"
          >
            Remove pack
          </button>
        ) : null}
      </div>
    </section>
  );
}
