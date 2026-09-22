import { ArrowSquareOut, DownloadSimple, Eye, EyeSlash, Trash } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { ClassTabs } from "./components/ui/ClassTabs";
import { Disclosure } from "./components/ui/Disclosure";
import { PaneHeader } from "./components/ui/PaneHeader";
import { Segmented } from "./components/ui/Segmented";
import { useAppStatus, useCanWrite } from "./hooks/useAppStatus";
import { useExplicitDraft } from "./hooks/useExplicitDraft";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import { prefetchViewmodelPreviews, useViewmodelPreview } from "./hooks/useViewmodelPreview";
import type { Api } from "./lib/api";
import { isTauri, openExternal, type ViewmodelHideMode, type ViewmodelRecord } from "./lib/bridge";
import { type ViewmodelGroupInfo, viewmodelGroupsForClass } from "./lib/viewmodel-groups";
import {
  VIEWMODEL_PREVIEW_CREDIT,
  VIEWMODEL_SLOT_LABELS,
  VIEWMODEL_SLOTS,
  type ViewmodelSlot,
  viewmodelBlankStem,
  viewmodelGroupPreview,
  viewmodelPreviewUrl,
  viewmodelStemForGroup,
} from "./lib/viewmodel-previews";
import {
  type ClassVisibility,
  SOLDIER_ORIGINAL_NOTE,
  seedViewmodelDraft,
  serializeHiddenGroups,
  setClassVisibility,
  toggleHiddenGroup,
  VIEWMODEL_CASUAL_COPY,
  VIEWMODEL_CLASSES,
  type ViewmodelClass,
  type ViewmodelDraft,
} from "./lib/viewmodel-ui";

const CLASS_TAB_PREFIX = "viewmodel-class-tab";
const GROUPS_PANEL_ID = "viewmodel-groups-panel";
const SOLDIER_NOTE_ID = "viewmodel-soldier-original-note";

function serializeViewmodelDraft(draft: ViewmodelDraft): string {
  return JSON.stringify([serializeHiddenGroups(draft.hidden), draft.hideMode, draft.preload]);
}

/** The original 64 Yttrium groups, with the draft, preview and build kept together. */
export function ViewmodelPane({
  api,
  profileId,
  record,
  onBuild,
  onImport,
  onRemove,
}: {
  api: Api;
  profileId: string | null;
  record: ViewmodelRecord | null;
  onBuild: (hidden: string[], preload: boolean, hideMode: ViewmodelHideMode) => void;
  onImport: (preload: boolean) => void;
  onRemove: () => void;
}) {
  const { running } = useAppStatus();
  const locked = !useCanWrite();
  const seeded = useMemo(() => seedViewmodelDraft(record), [record]);
  // A completed build acknowledges its snapshot without replacing newer edits.
  const [draft, setDraft] = useSeededDraft(
    seeded,
    serializeViewmodelDraft,
    draftRecordKey(profileId, "viewmodels"),
  );
  const [classId, setClassId] = useState<ViewmodelClass>("scout");
  const [focusGroup, setFocusGroup] = useState("scout/scatterguns");
  const [canBuild, setCanBuild] = useState(true);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const native = isTauri();

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    api
      .viewmodelBuildAvailable()
      .then((available) => {
        if (!cancelled) setCanBuild(available);
      })
      .catch(() => {
        // A failed probe is not evidence that the installed compiler is absent.
      });
    return () => {
      cancelled = true;
    };
  }, [api, native]);

  const groups = viewmodelGroupsForClass(classId);
  const hiddenSet = new Set(draft.hidden);
  const focus = groups.find((group) => group.id === focusGroup) ?? groups[0];
  const focusHidden = hiddenSet.has(focus.id);
  // Upstream has stock and fully hidden screenshots, but no weapon-only image.
  // Keep the stock frame as a reference and identify what the built pack changes.
  const weaponOnlyReference = focusHidden && draft.hideMode === "weapon";
  const stem = viewmodelStemForGroup(classId, focus.id, focusHidden && !weaponOnlyReference);
  const preview = useViewmodelPreview(api, native ? stem : null);
  const stageSrc = native ? preview.src : viewmodelPreviewUrl(stem);
  const focusInfo = viewmodelGroupPreview(focus.id);

  useEffect(() => {
    if (!native) return;
    prefetchViewmodelPreviews(api, [
      viewmodelBlankStem(classId),
      ...viewmodelGroupsForClass(classId).map(
        (group) => viewmodelGroupPreview(group.id)?.image ?? viewmodelBlankStem(classId),
      ),
    ]);
  }, [api, classId, native]);

  const dirty = serializeViewmodelDraft(draft) !== serializeViewmodelDraft(seeded);
  useExplicitDraft(dirty);

  const builtPack = record?.source === "compiled";
  const classHiddenCount = groups.filter((group) => hiddenSet.has(group.id)).length;
  const visibility =
    classHiddenCount === 0
      ? "shown"
      : classHiddenCount === groups.length
        ? draft.hideMode
        : "mixed";

  function hiddenCountFor(cls: ViewmodelClass): number {
    return viewmodelGroupsForClass(cls).filter((group) => hiddenSet.has(group.id)).length;
  }

  function selectClass(next: ViewmodelClass) {
    setClassId(next);
    setFocusGroup(viewmodelGroupsForClass(next)[0].id);
  }

  function toggle(group: ViewmodelGroupInfo) {
    setFocusGroup(group.id);
    setDraft((current) => ({ ...current, hidden: toggleHiddenGroup(current.hidden, group.id) }));
  }

  const buildStatus = !canBuild
    ? "Building requires TF2's compiler on Windows. Import a VPK on Linux."
    : draft.hidden.length === 0 && record
      ? "Remove the pack to restore every group."
      : draft.hidden.length === 0
        ? "Choose a group to hide, then build your pack."
        : dirty || !builtPack
          ? `${draft.hidden.length} ${draft.hidden.length === 1 ? "group" : "groups"} ready to build.`
          : `${draft.hidden.length} ${draft.hidden.length === 1 ? "group" : "groups"} hidden in this profile.`;
  const canApply = canBuild && !locked && draft.hidden.length > 0 && (dirty || !builtPack);
  const stageCaption = `${capitalize(classId)} · ${focus.label}`;

  return (
    <section data-testid="settings-viewmodels" className="min-w-0 text-left">
      <PaneHeader
        title="Viewmodels"
        actions={
          record ? (
            <span data-testid="viewmodel-pack-status" className="badge">
              {builtPack ? "Built pack" : "Imported pack"}
            </span>
          ) : null
        }
      />
      <ClassTabs
        tabs={VIEWMODEL_CLASSES.map((id) => ({
          id,
          label: <span className="capitalize">{id}</span>,
          meta: hiddenCountFor(id) || undefined,
        }))}
        selected={classId}
        label="TF2 class"
        idPrefix={CLASS_TAB_PREFIX}
        panelId={GROUPS_PANEL_ID}
        onSelect={selectClass}
      />

      <div
        id={GROUPS_PANEL_ID}
        role="tabpanel"
        aria-labelledby={`${CLASS_TAB_PREFIX}-${classId}`}
        className="pane-split mt-5 items-start"
      >
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="t-row">Class visibility</h2>
            <span className="t-meta tnum">
              {classHiddenCount} of {groups.length} hidden
            </span>
          </div>
          <Segmented<ClassVisibility | "mixed">
            label={`${capitalize(classId)} visibility`}
            testIdPrefix="viewmodel-visibility"
            value={visibility}
            options={[
              { id: "shown", label: "Show" },
              { id: "weapon", label: "Hide weapon" },
              { id: "full", label: "Hide all" },
            ]}
            onChange={(next) => {
              if (next !== "mixed")
                setDraft((current) => setClassVisibility(current, classId, next));
            }}
          />
          <p className="t-meta mt-2">Hide mode applies to every hidden group in the pack.</p>
          <div className="mt-5 border-t border-edge">
            {VIEWMODEL_SLOTS.map((slot) => {
              const inSlot = groups.filter(
                (group) => (viewmodelGroupPreview(group.id)?.slot ?? "primary") === slot,
              );
              return inSlot.length > 0 ? (
                <SlotGroup
                  key={`${classId}-${slot}`}
                  profileId={profileId}
                  classId={classId}
                  slot={slot}
                  groups={inSlot}
                  hiddenSet={hiddenSet}
                  focusGroup={focus.id}
                  describedBy={classId === "soldier" ? SOLDIER_NOTE_ID : undefined}
                  onFocus={setFocusGroup}
                  onToggle={toggle}
                />
              ) : null;
            })}
          </div>
          {classId === "soldier" ? (
            <p id={SOLDIER_NOTE_ID} className="pane-note mt-3">
              {SOLDIER_ORIGINAL_NOTE}
            </p>
          ) : null}
        </div>

        <div className="min-w-0 self-start">
          <figure
            data-testid="viewmodel-stage"
            data-stem={stem}
            data-hidden={focusHidden ? "true" : "false"}
            data-reference={weaponOnlyReference ? "true" : "false"}
            className="surface vm-stage relative m-0 aspect-video w-full overflow-hidden"
          >
            {stageSrc && stageSrc !== failedSrc ? (
              <img
                key={stageSrc}
                data-testid="viewmodel-preview-image"
                src={stageSrc}
                alt={stageCaption}
                onError={() => setFailedSrc(stageSrc)}
                className="absolute inset-0 size-full object-cover enter-fade"
              />
            ) : (
              <div className="absolute inset-0 grid place-content-center gap-2 px-6 text-center">
                <Eye size={24} className="mx-auto text-ink-muted" />
                <p className="t-row">
                  {preview.loading ? "Loading preview…" : "Preview unavailable"}
                </p>
              </div>
            )}
            {weaponOnlyReference ? (
              <div className="absolute left-3 top-3 rounded-md bg-bg/90 px-3 py-2 text-[12px] leading-snug text-ink">
                <span className="block font-semibold">Weapon hidden · hands visible</span>
                <span className="text-ink-muted">Stock image shown for reference</span>
              </div>
            ) : null}
            <figcaption className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-bg/90 px-3 py-2 text-[12px] text-ink">
              <span>{preview.loading ? "Loading preview…" : stageCaption}</span>
              <span className="text-ink-muted">
                {weaponOnlyReference
                  ? "Reference image"
                  : focusHidden
                    ? "Weapon and hands hidden"
                    : "Weapon and hands shown"}
              </span>
            </figcaption>
          </figure>
          {focusInfo?.weapons ? <p className="t-meta mt-3">{focusInfo.weapons}</p> : null}
          <div className="action-panel mt-4 block">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="viewmodel-build"
                disabled={!canApply}
                onClick={() => onBuild(draft.hidden, draft.preload, draft.hideMode)}
                className="btn btn-primary"
              >
                {builtPack ? "Rebuild pack" : "Build pack"}
              </button>
              <button
                type="button"
                data-testid="viewmodel-import"
                disabled={locked}
                onClick={() => onImport(draft.preload)}
                className="btn btn-ghost"
              >
                <DownloadSimple size={15} />
                {record ? "Replace VPK…" : "Import VPK…"}
              </button>
              {dirty ? (
                <button
                  type="button"
                  disabled={locked && !running}
                  onClick={() => setDraft(seeded)}
                  className="btn btn-quiet"
                >
                  Discard edits
                </button>
              ) : null}
            </div>
            <p className="t-meta mt-3" aria-live="polite">
              {buildStatus}
            </p>
          </div>
          {record ? (
            <button
              type="button"
              data-testid="viewmodel-remove"
              disabled={locked}
              onClick={onRemove}
              className="btn btn-quiet mt-3"
            >
              <Trash size={14} /> Remove pack
            </button>
          ) : null}
        </div>
      </div>

      <section className="section">
        <Disclosure
          profileId={profileId}
          storageKey="viewmodel-pack"
          summary="About viewmodel packs"
          testId="viewmodel-pack-disclosure"
        >
          <p className="pane-note mt-3">{VIEWMODEL_CASUAL_COPY}</p>
          <p className="pane-note mt-3">
            Hidden-viewmodel animations from{" "}
            <button
              type="button"
              onClick={() =>
                void openExternal("https://github.com/Yttrium-tYcLief/CompVMInstaller")
              }
              className="inline-flex items-center gap-1 text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
            >
              Yttrium's Competitive Viewmodels <ArrowSquareOut size={12} />
            </button>{" "}
            (©2018 yttrium), fetched from the original project and rebuilt locally.{" "}
            {VIEWMODEL_PREVIEW_CREDIT}
          </p>
        </Disclosure>
      </section>
    </section>
  );
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function SlotGroup({
  profileId,
  classId,
  slot,
  groups,
  hiddenSet,
  focusGroup,
  describedBy,
  onFocus,
  onToggle,
}: {
  profileId: string | null;
  classId: ViewmodelClass;
  slot: ViewmodelSlot;
  groups: ViewmodelGroupInfo[];
  hiddenSet: Set<string>;
  focusGroup: string;
  describedBy?: string;
  onFocus: (id: string) => void;
  onToggle: (group: ViewmodelGroupInfo) => void;
}) {
  const hiddenCount = groups.filter((group) => hiddenSet.has(group.id)).length;
  return (
    <Disclosure
      profileId={profileId}
      storageKey={`viewmodel-${classId}-${slot}`}
      defaultOpen={slot === "primary"}
      className="border-b border-edge"
      summary={
        <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>{VIEWMODEL_SLOT_LABELS[slot]}</span>
          <span className="t-meta tnum">{hiddenCount ? `${hiddenCount} hidden` : "Shown"}</span>
        </span>
      }
    >
      <ul className="mb-2 list-none p-0">
        {groups.map((group) => {
          const hidden = hiddenSet.has(group.id);
          return (
            <li key={group.id}>
              <button
                type="button"
                role="switch"
                aria-label={`Hide ${group.label}`}
                aria-checked={hidden}
                aria-describedby={describedBy}
                data-testid={`viewmodel-group-${group.id}`}
                data-hidden={hidden ? "true" : "false"}
                onMouseEnter={() => onFocus(group.id)}
                onFocus={() => onFocus(group.id)}
                onClick={() => onToggle(group)}
                className={`row min-h-10 w-full min-w-0 justify-start gap-3 rounded-md px-2 text-left transition-colors duration-150 hover:bg-panel ${focusGroup === group.id ? "bg-panel" : ""}`}
              >
                <span
                  aria-hidden="true"
                  className="flex size-6 shrink-0 items-center justify-center text-ink-muted"
                >
                  {hidden ? <EyeSlash size={16} /> : <Eye size={16} />}
                </span>
                <span className="min-w-0 flex-1 text-[13px] text-ink">{group.label}</span>
                <span className="shrink-0 text-[12px] text-ink-muted">
                  {hidden ? "Hidden" : "Shown"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Disclosure>
  );
}
