import { useMemo } from "react";
import { ColorPicker } from "./crosshair/ColorPicker";
import { useAppStatus } from "./hooks/useAppStatus";
import { useAutosave } from "./hooks/useAutosave";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import type { CrosshairColor } from "./lib/crosshair-ui";
import {
  CROSSHAIR_SCALE_MAX,
  CROSSHAIR_SCALE_MIN,
  clampGameplay,
  type GameplaySettings,
  seedGameplay,
  serializeGameplay,
  serializeGameplayScope,
} from "./lib/gameplay-ui";

/** TF2's default `cl_crosshair_scale`: sprites draw at their own size. */
export const DEFAULT_CROSSHAIR_SCALE = 32;

/**
 * Size and colour on their own, for a profile without the Crosshair pane's
 * pack builder (and for tests of the autosave contract).
 */
export function StockCrosshairSettings({
  profileId,
  effective,
  managedText,
  onSave,
}: {
  /** The profile this draft belongs to; a switch discards it. */
  profileId: string | null;
  effective: Record<string, string>;
  managedText: string;
  /** Resolves when the write settles; the toast reports it. */
  onSave: (gameplayText: string) => Promise<unknown>;
}) {
  const controls = useCrosshairControls(profileId, effective, managedText, onSave);
  return <CrosshairLook draft={controls.draft} patch={controls.patch} />;
}

/**
 * The crosshair cvars in the managed gameplay cfg: `cl_crosshair_file`,
 * `cl_crosshair_scale` and the colour. They autosave; `enabled` holds the
 * save while a pending pack build will write them itself.
 */
export function useCrosshairControls(
  profileId: string | null,
  effective: Record<string, string>,
  managedText: string,
  onSave: (text: string) => Promise<unknown>,
  enabled = true,
) {
  const { running } = useAppStatus();
  const seeded = useMemo(() => seedGameplay(managedText, effective), [managedText, effective]);
  // Applying the crosshair pack rewrites cl_crosshair_red/green/blue in this
  // same managed file. Reseeding on every incoming change wiped whatever the
  // user was mid-edit here; `useSeededDraft` keeps a dirty draft instead.
  const [draft, setDraft] = useSeededDraft(
    seeded,
    (value) => serializeGameplayScope(value, "crosshair"),
    draftRecordKey(profileId, "stock-crosshair"),
  );
  const token = serializeGameplayScope(draft, "crosshair");
  const dirty = token !== serializeGameplayScope(seeded, "crosshair");
  // Nothing here is disabled: these are drafts of one managed cfg, and the
  // write lock defers the save rather than taking the controls away.
  const text = serializeGameplay(clampGameplay(draft));
  const { flush } = useAutosave({
    dirty: dirty && enabled,
    locked: running,
    token,
    save: () => onSave(text),
  });

  function patch(update: Partial<GameplaySettings>) {
    setDraft((current) => clampGameplay({ ...current, ...update }));
  }

  return { draft, patch, setDraft, dirty, flush, reset: () => setDraft(seeded) };
}

/** Size and colour: the two crosshair settings every crosshair shares. */
export function CrosshairLook({
  draft,
  patch,
}: {
  draft: GameplaySettings;
  patch: (update: Partial<GameplaySettings>) => void;
}) {
  const color: CrosshairColor = [
    draft.cl_crosshair_red,
    draft.cl_crosshair_green,
    draft.cl_crosshair_blue,
  ];
  const scale = draft.cl_crosshair_scale;
  return (
    <div data-testid="stock-crosshair-settings" className="grid gap-6">
      <div>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="stock-crosshair-scale" className="t-row">
            Size
          </label>
          <span className="flex items-center gap-1">
            {scale !== DEFAULT_CROSSHAIR_SCALE ? (
              <button
                type="button"
                className="btn btn-quiet min-h-0 py-0 text-[12px]"
                data-testid="stock-crosshair-scale-reset"
                onClick={() => patch({ cl_crosshair_scale: DEFAULT_CROSSHAIR_SCALE })}
              >
                Reset
              </button>
            ) : null}
            <output htmlFor="stock-crosshair-scale" className="tnum text-[14px] text-ink-muted">
              {scale}
            </output>
          </span>
        </div>
        <input
          id="stock-crosshair-scale"
          data-testid="stock-crosshair-scale"
          type="range"
          min={CROSSHAIR_SCALE_MIN}
          max={CROSSHAIR_SCALE_MAX}
          step={1}
          value={scale}
          onChange={(event) => patch({ cl_crosshair_scale: Number(event.target.value) })}
          className="range mt-2 w-full"
        />
        <div className="tnum mt-0.5 flex justify-between text-[11px] text-ink-faint">
          <span>{CROSSHAIR_SCALE_MIN}</span>
          <span>32 · sprite's own size</span>
          <span>{CROSSHAIR_SCALE_MAX}</span>
        </div>
      </div>
      <ColorPicker
        compact
        color={color}
        onChange={([cl_crosshair_red, cl_crosshair_green, cl_crosshair_blue]) =>
          patch({ cl_crosshair_red, cl_crosshair_green, cl_crosshair_blue })
        }
      />
    </div>
  );
}
