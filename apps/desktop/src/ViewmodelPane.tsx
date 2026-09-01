import { ArrowSquareOut, DownloadSimple, Hammer, Trash } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import {
  isTauri,
  openExternal,
  type ViewmodelHideMode,
  type ViewmodelRecord,
  viewmodelBuildAvailable,
} from "./lib/bridge";
import { canWriteSettings } from "./lib/settings-ui";
import { viewmodelGroupsForClass } from "./lib/viewmodel-groups";
import {
  previewSlotHidden,
  VIEWMODEL_PREVIEW_CREDIT,
  VIEWMODEL_PREVIEW_SLOTS,
  VIEWMODEL_PREVIEW_WEAPONS,
  type ViewmodelPreviewSlot,
  viewmodelPreviewSrc,
} from "./lib/viewmodel-previews";
import {
  HIDE_MODE_LABELS,
  HIDE_MODE_NOTES,
  seedViewmodelDraft,
  serializeHiddenGroups,
  toggleHiddenGroup,
  VIEWMODEL_CASUAL_COPY,
  VIEWMODEL_CLASSES,
  type ViewmodelClass,
} from "./lib/viewmodel-ui";

export function ViewmodelPane({
  running,
  busy,
  record,
  onBuild,
  onImport,
  onRemove,
  onTogglePreload,
}: {
  running: boolean;
  busy: boolean;
  record: ViewmodelRecord | null;
  onBuild: (hidden: string[], preload: boolean, hideMode: ViewmodelHideMode) => void;
  onImport: (preload: boolean) => void;
  onRemove: () => void;
  onTogglePreload: (enabled: boolean) => void;
}) {
  const locked = !canWriteSettings(running, busy);
  const recordKey = JSON.stringify(record ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: recordKey covers record by value.
  const seeded = useMemo(() => seedViewmodelDraft(record), [recordKey]);
  const [draft, setDraft] = useState(seeded);
  const [classId, setClassId] = useState<ViewmodelClass>("scout");
  const [slot, setSlot] = useState<ViewmodelPreviewSlot>("primary");
  // Building needs TF2's own studiomdl, which only the Windows depot ships.
  // Assume yes until the probe says otherwise, so the button never flickers
  // disabled on a machine that can build.
  const [canBuild, setCanBuild] = useState(true);

  useEffect(() => {
    setDraft(seeded);
  }, [seeded]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }
    let cancelled = false;
    viewmodelBuildAvailable()
      .then((available) => {
        if (!cancelled) {
          setCanBuild(available);
        }
      })
      .catch(() => {
        // A failed probe is not evidence the machine cannot build.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const slotsForClass = VIEWMODEL_PREVIEW_SLOTS.filter(
    (item) => VIEWMODEL_PREVIEW_WEAPONS[classId][item] !== undefined,
  );
  const activeSlot = slotsForClass.includes(slot) ? slot : slotsForClass[0];
  const previewSrc = viewmodelPreviewSrc(classId, activeSlot);
  const previewWeapon = VIEWMODEL_PREVIEW_WEAPONS[classId][activeSlot];
  const groups = viewmodelGroupsForClass(classId);
  const hiddenSet = new Set(draft.hidden);
  const previewHidden = previewSlotHidden(classId, activeSlot, hiddenSet);
  const dirty =
    serializeHiddenGroups(draft.hidden) !== serializeHiddenGroups(seeded.hidden) ||
    draft.hideMode !== seeded.hideMode;
  const builtPack = record?.source === "compiled";

  function hiddenCountFor(cls: ViewmodelClass): number {
    return viewmodelGroupsForClass(cls).filter((group) => hiddenSet.has(group.id)).length;
  }

  return (
    <section data-testid="settings-viewmodels" className="min-w-0 text-left">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-[13px] leading-6 text-ink-muted">
          Hide the weapon groups you don't want on screen — Yttrium-style — and execs compiles a
          first-party animation pack with TF2's own tools. Hide-all, min viewmodels, and viewmodel
          FOV are simple cvars and live on the Gameplay pane.
        </p>
        <span
          data-testid="viewmodel-pack-status"
          className={`badge ${
            record
              ? "border border-health/50 bg-health/10 text-health"
              : "border border-edge text-ink-faint"
          }`}
        >
          {record ? (builtPack ? "Built pack" : "Imported pack") : "No pack installed"}
        </span>
      </div>

      <section className="section">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Hide viewmodels</h2>
            <p className="mt-0.5 max-w-2xl text-xs leading-5 text-ink-muted">
              Pick a class, tick the animation groups to hide, then build. Hiding uses Yttrium's
              competitive-viewmodels animations, fetched from the original project.
            </p>
          </div>
          <span className="text-xs tabular-nums text-ink-faint">
            {draft.hidden.length} hidden {draft.hidden.length === 1 ? "group" : "groups"}
          </span>
        </div>

        <div
          className="mt-3 flex flex-wrap gap-1 rounded-xl bg-panel p-1"
          role="tablist"
          aria-label="TF2 class"
        >
          {VIEWMODEL_CLASSES.map((id, classIndex) => {
            const count = hiddenCountFor(id);
            return (
              <button
                key={id}
                id={`viewmodel-class-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={classId === id}
                aria-controls="viewmodel-groups-panel"
                tabIndex={classId === id ? 0 : -1}
                data-testid={`viewmodel-class-${id}`}
                data-active={classId === id ? "true" : "false"}
                onClick={() => setClassId(id)}
                onKeyDown={(event) => {
                  let nextIndex: number | null = null;
                  if (event.key === "ArrowRight") {
                    nextIndex = (classIndex + 1) % VIEWMODEL_CLASSES.length;
                  } else if (event.key === "ArrowLeft") {
                    nextIndex =
                      (classIndex - 1 + VIEWMODEL_CLASSES.length) % VIEWMODEL_CLASSES.length;
                  } else if (event.key === "Home") {
                    nextIndex = 0;
                  } else if (event.key === "End") {
                    nextIndex = VIEWMODEL_CLASSES.length - 1;
                  }
                  if (nextIndex === null) {
                    return;
                  }
                  event.preventDefault();
                  const nextClass = VIEWMODEL_CLASSES[nextIndex];
                  setClassId(nextClass);
                  requestAnimationFrame(() => {
                    document.getElementById(`viewmodel-class-tab-${nextClass}`)?.focus();
                  });
                }}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium capitalize outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand ${
                  classId === id
                    ? "bg-brand text-on-brand"
                    : "text-ink-muted hover:bg-panel-raised hover:text-ink"
                }`}
              >
                {id}
                {count > 0 ? (
                  <span
                    className={`rounded-pill px-1.5 text-[10px] tabular-nums ${
                      classId === id ? "bg-on-brand/20" : "bg-brand/20 text-brand"
                    }`}
                  >
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div
          id="viewmodel-groups-panel"
          role="tabpanel"
          aria-labelledby={`viewmodel-class-tab-${classId}`}
          className="mt-3 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]"
        >
          <div>
            <figure className="surface relative aspect-video w-full bg-[radial-gradient(125%_120%_at_50%_0%,#4a4740_0%,#26241f_45%,#111010_100%)]">
              {previewSrc ? (
                <img
                  data-testid="viewmodel-preview-image"
                  data-hidden={previewHidden ? "true" : "false"}
                  src={previewSrc}
                  alt={`${previewWeapon ?? activeSlot} first-person view for ${classId}`}
                  className={`absolute inset-0 size-full object-contain object-[80%_100%] p-5 drop-shadow-[0_12px_28px_rgba(0,0,0,0.6)] transition-opacity ${
                    previewHidden ? "opacity-0" : "opacity-100"
                  }`}
                />
              ) : (
                <p className="absolute inset-0 grid place-items-center text-xs text-ink-muted">
                  No reference image for this slot.
                </p>
              )}
              {previewHidden ? (
                <p
                  data-testid="viewmodel-preview-hidden"
                  className="absolute inset-0 grid place-items-center px-6 text-center text-xs text-ink-muted"
                >
                  {draft.hideMode === "weapon"
                    ? "Weapon hidden — your hands keep animating."
                    : "Weapon and hands hidden."}
                </p>
              ) : null}
              <figcaption className="absolute bottom-2.5 left-3 text-[11px] text-ink-muted">
                <span className="capitalize">{classId}</span> · {previewWeapon ?? activeSlot}
              </figcaption>
            </figure>
            <div className="mt-2 flex gap-1">
              {slotsForClass.map((item) => (
                <button
                  key={item}
                  type="button"
                  data-testid={`viewmodel-slot-${item}`}
                  data-active={activeSlot === item ? "true" : "false"}
                  onClick={() => setSlot(item)}
                  className={`rounded-lg px-3 py-1.5 text-xs capitalize transition-colors ${
                    activeSlot === item
                      ? "bg-panel-raised text-ink"
                      : "text-ink-muted hover:bg-panel hover:text-ink"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-ink-faint">
              Reference imagery only — groups on the right map to animation sets, not single
              weapons.
            </p>
          </div>

          <div className="min-w-0">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] font-medium capitalize text-ink">{classId} groups</p>
              <button
                type="button"
                data-testid="viewmodel-hide-all-class"
                disabled={locked}
                onClick={() => {
                  const allHidden = groups.every((group) => hiddenSet.has(group.id));
                  let hidden = draft.hidden;
                  for (const group of groups) {
                    const has = hidden.includes(group.id);
                    if (allHidden ? has : !has) {
                      hidden = toggleHiddenGroup(hidden, group.id);
                    }
                  }
                  setDraft({ ...draft, hidden });
                }}
                className="text-[11px] text-ink-muted underline decoration-edge underline-offset-2 hover:text-ink disabled:opacity-40"
              >
                {groups.every((group) => hiddenSet.has(group.id)) ? "Show all" : "Hide all"}
              </button>
            </div>
            <ul className="mt-1">
              {groups.map((group) => {
                const hidden = hiddenSet.has(group.id);
                return (
                  <li key={group.id} className="border-b border-edge/60">
                    <label
                      className="flex cursor-pointer items-center justify-between gap-3 py-2.5"
                      htmlFor={`viewmodel-group-${group.id}`}
                    >
                      <span className="text-[13px] text-ink">{group.label}</span>
                      <input
                        id={`viewmodel-group-${group.id}`}
                        data-testid={`viewmodel-group-${group.id}`}
                        type="checkbox"
                        checked={hidden}
                        disabled={locked}
                        onChange={() =>
                          setDraft({ ...draft, hidden: toggleHiddenGroup(draft.hidden, group.id) })
                        }
                        className="peer sr-only"
                      />
                      <span
                        className={`badge border peer-focus-visible:ring-2 peer-focus-visible:ring-brand ${
                          hidden
                            ? "border-brand bg-brand/15 text-brand"
                            : "border-edge-strong text-ink-faint"
                        }`}
                      >
                        {hidden ? "Hidden" : "Shown"}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {classId === "soldier" && groups.some((group) => hiddenSet.has(group.id)) ? (
              <p className="mt-2 text-[11px] leading-4 text-ink-faint">
                Hiding any Soldier group also hides the Original's animations (leaving them stock
                glitches in game).
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 border-t border-edge/60 pt-4">
          <h3 className="eyebrow">What a hidden group removes</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["full", "weapon"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                data-testid={`viewmodel-mode-${mode}`}
                aria-pressed={draft.hideMode === mode}
                disabled={locked}
                onClick={() => setDraft({ ...draft, hideMode: mode })}
                className={`btn ${draft.hideMode === mode ? "btn-primary" : ""}`}
              >
                {HIDE_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
          <p className="mt-2 min-h-8 max-w-2xl text-[11px] leading-4 text-ink-faint">
            {HIDE_MODE_NOTES[draft.hideMode]}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-edge/60 pt-4">
          <p className="min-w-0 flex-1 text-xs text-ink-muted" aria-live="polite">
            {!canBuild
              ? "Building packs needs TF2's studiomdl (Windows only for now)."
              : running
                ? "Close TF2 to build."
                : draft.hidden.length === 0 && record
                  ? "Nothing ticked — use Remove pack below to restore stock viewmodels."
                  : draft.hidden.length === 0
                    ? "Nothing hidden yet — tick groups above, then build."
                    : dirty || !builtPack
                      ? "Build compiles with TF2's own studiomdl in an isolated staging folder (Windows)."
                      : "The installed pack matches these choices."}
          </p>
          <button
            type="button"
            data-testid="viewmodel-build"
            title={
              canBuild ? undefined : "Building packs needs TF2's studiomdl (Windows only for now)."
            }
            disabled={!canBuild || locked || draft.hidden.length === 0 || (!dirty && builtPack)}
            onClick={() => onBuild(draft.hidden, draft.preload, draft.hideMode)}
            className="btn btn-primary"
          >
            <Hammer size={15} weight="bold" />
            {running ? "Close TF2 to build" : builtPack ? "Rebuild pack" : "Build & install pack"}
          </button>
        </div>
      </section>

      <section className="section">
        <h2 className="text-sm font-semibold text-ink">Pack &amp; preload</h2>
        <p className="mt-0.5 max-w-2xl text-xs leading-5 text-ink-muted">
          Prefer a ready-made pack? Import any prebuilt viewmodel VPK instead of building.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="viewmodel-import"
            disabled={locked}
            onClick={() => onImport(draft.preload)}
            className="btn btn-ghost"
          >
            <DownloadSimple size={15} />
            {record ? "Replace with a VPK…" : "Import prebuilt VPK…"}
          </button>
          {record ? (
            <button
              type="button"
              data-testid="viewmodel-remove"
              disabled={locked}
              onClick={onRemove}
              className="btn btn-ghost"
            >
              <Trash size={14} />
              Remove pack
            </button>
          ) : null}
        </div>

        <label
          htmlFor="viewmodel-preload"
          className="mt-5 flex max-w-xl cursor-pointer items-start justify-between gap-4"
        >
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-ink">Casual preload</span>
            <span className="mt-0.5 block text-xs leading-5 text-ink-muted">
              Precache on itemtest before joining Valve Casual so the pack applies there. Community
              and listen servers work without it.
            </span>
          </span>
          <input
            id="viewmodel-preload"
            data-testid="viewmodel-preload"
            type="checkbox"
            checked={draft.preload}
            disabled={locked}
            onChange={(event) => {
              // Without a pack this only sets the preference the next
              // build/import uses; with one it applies immediately.
              setDraft({ ...draft, preload: event.target.checked });
              if (record) {
                onTogglePreload(event.target.checked);
              }
            }}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="relative mt-0.5 h-6 w-11 shrink-0 rounded-pill border border-edge-strong bg-bg transition-colors after:absolute after:left-1 after:top-1 after:size-3.5 after:rounded-full after:bg-ink-muted after:transition-transform peer-checked:border-brand peer-checked:bg-brand peer-checked:after:translate-x-5 peer-checked:after:bg-on-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bg peer-disabled:opacity-40"
          />
        </label>
      </section>

      <p className="section text-[11px] leading-relaxed text-ink-faint">
        {VIEWMODEL_CASUAL_COPY} Hidden-viewmodel animations from{" "}
        <button
          type="button"
          onClick={() => void openExternal("https://github.com/Yttrium-tYcLief/CompVMInstaller")}
          className="inline-flex items-center gap-0.5 text-brand underline decoration-brand/40 underline-offset-2"
        >
          Yttrium's Competitive Viewmodels
          <ArrowSquareOut size={11} />
        </button>{" "}
        (©2018 yttrium), fetched from the original project and rebuilt locally.{" "}
        {VIEWMODEL_PREVIEW_CREDIT}
      </p>
    </section>
  );
}
