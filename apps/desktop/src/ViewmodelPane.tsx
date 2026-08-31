import { DownloadSimple, Trash } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { ViewmodelCompileCapability, ViewmodelRecord } from "./lib/bridge";
import { canWriteSettings } from "./lib/settings-ui";
import {
  VIEWMODEL_PREVIEW_CREDIT,
  VIEWMODEL_PREVIEW_SLOTS,
  VIEWMODEL_PREVIEW_WEAPONS,
  type ViewmodelPreviewSlot,
  viewmodelPreviewSrc,
} from "./lib/viewmodel-previews";
import {
  emptyWeaponDraft,
  seedViewmodelDraft,
  serializeWeaponOption,
  VIEWMODEL_CASUAL_COPY,
  VIEWMODEL_CLASSES,
  type ViewmodelClass,
} from "./lib/viewmodel-ui";

export function ViewmodelPane({
  running,
  busy,
  record,
  compileCapability,
  onCompile,
  onImport,
  onRemove,
  onTogglePreload,
}: {
  running: boolean;
  busy: boolean;
  record: ViewmodelRecord | null;
  compileCapability: ViewmodelCompileCapability;
  onCompile: (options: Record<string, string>, preload: boolean) => void;
  onImport: (preload: boolean) => void;
  onRemove: () => void;
  onTogglePreload: (enabled: boolean) => void;
}) {
  const locked = !canWriteSettings(running, busy);
  const seeded = useMemo(() => seedViewmodelDraft(record), [record]);
  const [draft, setDraft] = useState(seeded);
  const [classId, setClassId] = useState<ViewmodelClass>("scout");
  const [slot, setSlot] = useState<ViewmodelPreviewSlot>("primary");
  const canCompile = compileCapability.available;

  useEffect(() => {
    setDraft(seeded);
  }, [seeded]);

  const slotsForClass = VIEWMODEL_PREVIEW_SLOTS.filter(
    (item) => VIEWMODEL_PREVIEW_WEAPONS[classId][item] !== undefined,
  );
  const activeSlot = slotsForClass.includes(slot) ? slot : slotsForClass[0];
  const previewSrc = viewmodelPreviewSrc(classId, activeSlot);
  const previewWeapon = VIEWMODEL_PREVIEW_WEAPONS[classId][activeSlot];
  const hiddenKey = `${classId}/${activeSlot}`;
  const slotHidden = draft.weapons[hiddenKey]?.hide === true;

  function toggleSlotHidden() {
    const existing = draft.weapons[hiddenKey] ?? emptyWeaponDraft();
    setDraft({
      ...draft,
      weapons: {
        ...draft.weapons,
        [hiddenKey]: { ...existing, hide: !existing.hide },
      },
    });
  }

  function compileOptions(): Record<string, string> {
    const options: Record<string, string> = {};
    for (const [key, weapon] of Object.entries(draft.weapons)) {
      options[key] = serializeWeaponOption(weapon);
    }
    return options;
  }

  return (
    <section data-testid="settings-viewmodels" className="min-w-0 text-left">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-[13px] leading-6 text-ink-muted">
          Viewmodel animation packs replace how your weapon is held and moved. Hide-all, min
          viewmodels, and viewmodel FOV are simple cvars and live on the Gameplay pane.
        </p>
        <span
          data-testid="viewmodel-pack-status"
          className={`badge ${
            record
              ? "border border-health/50 bg-health/10 text-health"
              : "border border-edge text-ink-faint"
          }`}
        >
          {record
            ? record.source === "imported"
              ? "Imported pack"
              : "Compiled pack"
            : "No pack installed"}
        </span>
      </div>

      <section className="section">
        <h2 className="text-sm font-semibold text-ink">Your animation pack</h2>
        <p className="mt-0.5 max-w-2xl text-xs leading-5 text-ink-muted">
          Import a prebuilt viewmodel VPK (Yttrium-style packs work) and execs stores it with this
          profile, file-safe.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="viewmodel-import"
            disabled={locked}
            onClick={() => onImport(draft.preload)}
            className="btn btn-primary"
          >
            <DownloadSimple size={15} />
            {record ? "Replace with another VPK…" : "Import prebuilt VPK…"}
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
              // Without a pack this only sets the preference the next import
              // will use; with one it applies immediately.
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

        {!canCompile ? (
          <p
            data-testid="viewmodel-compile-reason"
            className="mt-4 max-w-xl text-[11px] leading-4 text-ink-faint"
          >
            {compileCapability.reason}
          </p>
        ) : null}
      </section>

      <section className="section">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">First-person reference</h2>
            <p className="mt-0.5 max-w-2xl text-xs leading-5 text-ink-muted">
              Real in-game viewmodels per class and slot — what each weapon looks like before a pack
              changes it{canCompile ? ", and which slots your compile will hide" : ""}.
            </p>
          </div>
        </div>

        <div
          className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-panel p-1 sm:grid-cols-5 lg:grid-cols-9"
          role="tablist"
          aria-label="TF2 class"
        >
          {VIEWMODEL_CLASSES.map((id, classIndex) => (
            <button
              key={id}
              id={`viewmodel-class-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={classId === id}
              aria-controls="viewmodel-preview-panel"
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
              className={`rounded-lg px-2 py-1.5 text-xs font-medium capitalize outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand ${
                classId === id
                  ? "bg-brand text-on-brand"
                  : "text-ink-muted hover:bg-panel-raised hover:text-ink"
              }`}
            >
              {id}
            </button>
          ))}
        </div>

        <div
          id="viewmodel-preview-panel"
          role="tabpanel"
          aria-labelledby={`viewmodel-class-tab-${classId}`}
          className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_14rem]"
        >
          <figure className="surface relative grid min-h-64 place-items-center bg-[#0d0d0d] p-4">
            {previewSrc ? (
              <img
                data-testid="viewmodel-preview-image"
                src={previewSrc}
                alt={`${previewWeapon ?? activeSlot} first-person view for ${classId}`}
                className={`max-h-72 w-auto max-w-full object-contain transition-opacity ${
                  canCompile && slotHidden ? "opacity-20" : ""
                }`}
              />
            ) : (
              <p className="text-xs text-ink-muted">No reference image for this slot.</p>
            )}
            {canCompile && slotHidden ? (
              <span className="badge absolute top-3 right-3 border border-brand bg-brand/15 text-brand">
                Hidden in game
              </span>
            ) : null}
            <figcaption className="absolute bottom-2.5 left-3 text-[11px] text-ink-muted">
              <span className="capitalize">{classId}</span> · {previewWeapon ?? activeSlot}
            </figcaption>
          </figure>

          <div className="flex flex-col gap-1">
            {slotsForClass.map((item) => {
              const weaponName = VIEWMODEL_PREVIEW_WEAPONS[classId][item];
              const key = `${classId}/${item}`;
              const hidden = draft.weapons[key]?.hide === true;
              return (
                <button
                  key={item}
                  type="button"
                  data-testid={`viewmodel-slot-${item}`}
                  data-active={activeSlot === item ? "true" : "false"}
                  onClick={() => setSlot(item)}
                  className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] transition-colors ${
                    activeSlot === item
                      ? "bg-panel-raised text-ink"
                      : "text-ink-muted hover:bg-panel hover:text-ink"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block capitalize">{item}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                      {weaponName}
                    </span>
                  </span>
                  {canCompile && hidden ? (
                    <span className="badge border border-brand text-brand">Hidden</span>
                  ) : null}
                </button>
              );
            })}

            {canCompile ? (
              <button
                type="button"
                data-testid="viewmodel-toggle-hide"
                disabled={locked}
                onClick={toggleSlotHidden}
                className="btn btn-ghost mt-2"
              >
                {slotHidden ? "Show this slot" : "Hide this slot"}
              </button>
            ) : null}
          </div>
        </div>

        {canCompile ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-edge/60 pt-4">
            <p className="text-xs text-ink-muted">
              Compiling builds a first-party pack from your slot choices in an isolated staging
              root.
            </p>
            <button
              type="button"
              data-testid="viewmodel-compile"
              disabled={locked}
              onClick={() => onCompile(compileOptions(), draft.preload)}
              className="btn btn-primary"
            >
              {running ? "Close TF2 to compile" : "Compile viewmodels"}
            </button>
          </div>
        ) : null}
      </section>

      <p className="section text-[11px] leading-relaxed text-ink-faint">
        {VIEWMODEL_CASUAL_COPY} {VIEWMODEL_PREVIEW_CREDIT}
      </p>
    </section>
  );
}
