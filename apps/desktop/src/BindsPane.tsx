import { type CfgFile, parseCommands } from "@execs/cfglint";
import { MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { useContext, useEffect, useMemo, useState } from "react";
import { ClassTabs } from "./components/ui/ClassTabs";
import { PaneHeader } from "./components/ui/PaneHeader";
import { useAppStatus } from "./hooks/useAppStatus";
import { AutosaveActivity, useAutosave } from "./hooks/useAutosave";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import {
  actionBindings,
  applyRecordedBind,
  autoexecFilePath,
  BIND_GROUPS,
  type BindActionId,
  type BindSourceMap,
  type BindsLayer,
  bindActionById,
  bindActionForCommand,
  bindKeyLabel,
  bindsFilePath,
  ensureAutoexecExecLine,
  normalizeBindCommand,
  recorderOutcomeForKey,
  removeOwnedManagedBind,
  searchBindActions,
  sourceKeyFromKeyboardEvent,
  sourceKeyFromMouseButton,
  sourceKeyFromWheelDelta,
  UNBINDABLE_KEY_NOTICE_MS,
} from "./lib/binds-ui";
import { mapsFromFiles } from "./lib/cfg-state";

export type BindsPaneProps = {
  /** The profile this draft belongs to; a switch must never reuse it. */
  profileId: string | null;
  layer: BindsLayer;
  effectiveBinds: Record<string, string>;
  bindSources?: BindSourceMap;
  startupFiles?: CfgFile[];
  startupInventory?: readonly { path: string }[];
  hudProjection?: { hudRoots?: readonly string[]; selectedHudRoot?: string | null };
  managedText: string;
  /** Blocks capture for other operations, excluding this pane's own save. */
  blocked?: boolean;
  /** Resolves when the managed cfg write settles. */
  onSave: (bindsText: string) => Promise<unknown>;
};

export function BindsPane({
  profileId,
  layer,
  effectiveBinds,
  bindSources = {},
  startupFiles,
  startupInventory,
  hudProjection,
  managedText,
  blocked,
  onSave,
}: BindsPaneProps) {
  const active = useContext(AutosaveActivity);
  const { running, busy } = useAppStatus();
  const [recordingId, setRecordingId] = useState<BindActionId | null>(null);
  const [recorderNotice, setRecorderNotice] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<{
    actionId: BindActionId;
    key: string;
    command: string;
    source: string;
  } | null>(null);
  const [groupSelection, setGroupSelection] = useState({ id: "all", phase: 0 });
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;
  const activeGroupId = searching ? "all" : groupSelection.id;
  const path = bindsFilePath(layer);
  const [draft, setDraft] = useSeededDraft(
    managedText,
    (text) => text,
    draftRecordKey(profileId, path),
  );
  const dirty = draft !== managedText;
  useAutosave({ dirty, locked: running, token: draft, save: () => onSave(draft) });

  // The draft changes immediately, even while its previous save is in flight.
  // SettingsHost still blocks profile operations and incomplete loads.
  const canRecord = active && !(blocked ?? busy);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A profile or layer change invalidates an unfinished key review.
  useEffect(() => {
    setRecordingId(null);
    setRecorderNotice(null);
    setPendingKey(null);
  }, [profileId, path]);
  const preview = useMemo(() => {
    if (startupFiles) {
      const found = startupFiles.some((file) => file.path === path);
      const revised = startupFiles.map((file) =>
        file.path === path ? { ...file, text: draft } : file,
      );
      if (!found) revised.push({ path, text: draft });
      const autoexecPath = autoexecFilePath(layer);
      const autoexec = revised.find((file) => file.path === autoexecPath);
      const autoexecText = ensureAutoexecExecLine(autoexec?.text ?? "", "execs_binds", layer);
      if (autoexec) {
        const index = revised.indexOf(autoexec);
        revised[index] = { ...autoexec, text: autoexecText };
      } else revised.push({ path: autoexecPath, text: autoexecText });
      const inferred = mapsFromFiles(revised, layer, startupInventory ?? revised, hudProjection);
      if (inferred.complete) return { binds: inferred.binds, sources: inferred.bindSources };
    }
    // The standalone preview uses the supplied startup map and replays this
    // file. The app supplies all files above so removed keys can reveal an
    // earlier config.cfg assignment accurately.
    const binds = { ...effectiveBinds };
    const sources = { ...bindSources };
    for (const command of parseCommands(managedText, path)) {
      if (command.name === "bind" && command.args[0]) {
        delete binds[command.args[0].toLowerCase()];
        delete sources[command.args[0].toLowerCase()];
      }
    }
    for (const command of parseCommands(draft, path)) {
      const key = command.args[0]?.toLowerCase();
      if (command.name === "bind" && key && command.args.length >= 2) {
        binds[key] = command.args.slice(1).join(" ");
        sources[key] = { file: path, line: command.line };
      } else if (command.name === "unbind" && key) {
        delete binds[key];
        delete sources[key];
      }
    }
    return { binds, sources };
  }, [
    startupFiles,
    startupInventory,
    hudProjection,
    path,
    draft,
    layer,
    effectiveBinds,
    bindSources,
    managedText,
  ]);

  useEffect(() => {
    if (recordingId === null || !canRecord) {
      return;
    }

    let armed = false;
    const armTimer = window.setTimeout(() => {
      armed = true;
    }, 0);

    function finish(key: string | null) {
      const outcome = recorderOutcomeForKey(key);
      if (outcome.kind === "unbindable") {
        // Keep listening: the recorder must not sit open with no explanation
        // just because the key is outside TF2's table.
        setRecorderNotice(outcome.message);
        return;
      }
      if (outcome.kind === "cancel" || !recordingId) {
        setRecordingId(null);
        return;
      }
      const currentCommand = preview.binds[outcome.key];
      const action = bindActionById(recordingId);
      if (
        currentCommand &&
        action &&
        normalizeBindCommand(currentCommand) !== normalizeBindCommand(action.command)
      ) {
        const origin = preview.sources[outcome.key];
        setPendingKey({
          actionId: recordingId,
          key: outcome.key,
          command: currentCommand,
          source: origin ? `${origin.file}:${origin.line}` : "another startup CFG",
        });
        setRecordingId(null);
        return;
      }
      const next = applyRecordedBind(draft, recordingId, outcome.key);
      setRecordingId(null);
      if (next !== draft) {
        setDraft(next);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      finish(sourceKeyFromKeyboardEvent(event));
    }

    function onMouseDown(event: MouseEvent) {
      if (!armed) {
        return;
      }
      // Category navigation ends capture; its click must not become mouse1.
      if (event.target instanceof HTMLElement && event.target.closest("[data-bind-navigation]")) {
        setRecordingId(null);
        setRecorderNotice(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      finish(sourceKeyFromMouseButton(event.button));
    }

    function onWheel(event: WheelEvent) {
      if (!armed || event.deltaY === 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      finish(sourceKeyFromWheelDelta(event.deltaY));
    }

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      window.clearTimeout(armTimer);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("wheel", onWheel, true);
    };
  }, [recordingId, canRecord, draft, setDraft, preview]);

  useEffect(() => {
    if (!canRecord) {
      setRecordingId(null);
    }
  }, [canRecord]);

  // The notice is transient: it explains one rejected key, then gets out of the
  // way so the recorder line reads true again.
  useEffect(() => {
    if (recorderNotice === null) {
      return;
    }
    const timer = window.setTimeout(() => setRecorderNotice(null), UNBINDABLE_KEY_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [recorderNotice]);

  function onRow(actionId: BindActionId) {
    if (!canRecord) {
      return;
    }
    setRecorderNotice(null);
    setPendingKey(null);
    setRecordingId((current) => (current === actionId ? null : actionId));
  }

  function cancelCapture() {
    setRecordingId(null);
    setRecorderNotice(null);
    setPendingKey(null);
  }

  const bindingsFor = (id: BindActionId) =>
    actionBindings(preview.binds, preview.sources, draft, path, id);
  const matches = searching
    ? searchBindActions(query, (id) => bindingsFor(id).map((binding) => binding.key))
    : null;
  const visibleGroups = BIND_GROUPS.filter(
    (group) => activeGroupId === "all" || group.id === activeGroupId,
  )
    .map((group) => ({ ...group, ids: group.ids.filter((id) => !matches || matches.has(id)) }))
    .filter((group) => group.ids.length > 0);

  return (
    <section data-testid="settings-binds" className="min-w-0 max-w-[980px] text-left">
      <PaneHeader
        title="Binds"
        actions={
          <label className="field relative flex w-64 items-center" data-bind-navigation>
            <MagnifyingGlass
              size={15}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 text-ink-faint"
            />
            <span className="sr-only">Search actions or keys</span>
            <input
              type="search"
              data-testid="bind-search"
              value={query}
              onChange={(event) => {
                cancelCapture();
                setQuery(event.target.value);
              }}
              placeholder="Search actions or keys"
              className="w-full bg-transparent py-2 pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ink-faint"
            />
          </label>
        }
      />

      <div data-bind-navigation className={searching ? "opacity-50" : undefined}>
        <ClassTabs
          tabs={[
            { id: "all", label: "All" },
            ...BIND_GROUPS.map((group) => ({ id: group.id, label: group.title })),
          ]}
          selected={activeGroupId}
          label="Bind categories"
          idPrefix="bind-category"
          panelId="bind-category-panel"
          onSelect={(id) => {
            cancelCapture();
            setQuery("");
            setGroupSelection((current) =>
              current.id === id ? current : { id, phase: current.phase + 1 },
            );
          }}
        />
      </div>

      <div
        id="bind-category-panel"
        role="tabpanel"
        aria-labelledby={`bind-category-${activeGroupId}`}
        className="mt-5"
        data-switch={
          groupSelection.phase === 0 ? undefined : groupSelection.phase % 2 === 1 ? "odd" : "even"
        }
      >
        {visibleGroups.length === 0 ? (
          <p data-testid="bind-search-empty" className="t-meta py-8">
            No actions match “{query.trim()}”.
          </p>
        ) : null}
        {visibleGroups.map((group) => (
          <section
            key={group.id}
            aria-labelledby={`bind-group-${group.id}`}
            className="mt-6 first:mt-0"
          >
            <h2
              id={`bind-group-${group.id}`}
              className={activeGroupId === "all" ? "eyebrow mb-1 px-2" : "sr-only"}
            >
              {group.title}
            </h2>
            <ul className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
              {group.ids.map((actionId) => {
                const action = bindActionById(actionId);
                if (!action) return null;
                const pending = pendingKey?.actionId === action.id ? pendingKey : null;
                return (
                  <BindRow
                    key={action.id}
                    id={action.id}
                    label={action.label}
                    keys={bindingsFor(action.id)}
                    listening={recordingId === action.id}
                    notice={recordingId === action.id ? recorderNotice : null}
                    canRecord={canRecord}
                    onRecord={() => onRow(action.id)}
                    onRemove={(key) => setDraft(removeOwnedManagedBind(draft, action.id, key))}
                    conflict={
                      pending
                        ? {
                            ...pending,
                            onAssign: () => {
                              setDraft(applyRecordedBind(draft, pending.actionId, pending.key));
                              setPendingKey(null);
                            },
                            onKeep: () => setPendingKey(null),
                          }
                        : null
                    }
                  />
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <p className="t-meta mt-8 px-2 text-ink-faint">
        {canRecord
          ? "Click an action, then press a key or mouse button. "
          : "Finish the current task first. "}
        Keys you add save to <span className="text-ink-muted">{path}</span>.
      </p>
    </section>
  );
}

type RowBinding = ReturnType<typeof actionBindings>[number];

function BindRow({
  id,
  label,
  keys,
  listening,
  notice,
  canRecord,
  onRecord,
  onRemove,
  conflict,
}: {
  id: BindActionId;
  label: string;
  keys: RowBinding[];
  listening: boolean;
  notice: string | null;
  canRecord: boolean;
  onRecord: () => void;
  onRemove: (key: string) => void;
  conflict: {
    key: string;
    command: string;
    source: string;
    onAssign: () => void;
    onKeep: () => void;
  } | null;
}) {
  const spoken = keys.map((binding) => bindKeyLabel(binding.key)).join(", ");
  return (
    <li
      data-testid={`bind-row-${id}`}
      data-recording={listening ? "true" : "false"}
      className="group border-b border-edge"
    >
      <div
        className={`relative flex min-h-12 items-center gap-3 rounded-md px-2 transition-colors duration-150 ${
          listening ? "bg-brand/5 ring-1 ring-brand" : canRecord ? "hover:bg-panel" : ""
        }`}
      >
        {/* The whole row records. Key caps sit above it; only their remove buttons take clicks. */}
        <button
          type="button"
          data-bind-navigation
          data-testid={`bind-record-${id}`}
          disabled={!canRecord}
          aria-label={`${listening ? "Stop recording" : "Add a key"} for ${label}. Keys: ${spoken || "none"}`}
          aria-pressed={listening}
          aria-describedby={`bind-hint-${id}`}
          onClick={onRecord}
          className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed"
        />
        <span className="t-row pointer-events-none relative min-w-0 flex-1 truncate">{label}</span>
        <span
          id={`bind-hint-${id}`}
          data-testid={listening && notice ? "bind-recorder-notice" : undefined}
          aria-live="polite"
          className={`t-meta pointer-events-none relative shrink-0 ${listening ? "" : "sr-only"}`}
        >
          {listening ? (notice ?? "Esc cancels") : ""}
        </span>
        <span
          data-testid={`bind-key-${id}`}
          className="pointer-events-none relative flex shrink-0 flex-wrap items-center justify-end gap-1.5"
        >
          <span data-testid={`bind-keys-${id}`} className="contents">
            {keys.map((binding) => (
              <KeyCap
                key={binding.key}
                actionId={id}
                actionLabel={label}
                binding={binding}
                canRemove={canRecord}
                onRemove={onRemove}
              />
            ))}
          </span>
          {listening ? (
            <span className="inline-flex h-7 items-center rounded border border-brand px-2 text-xs font-medium text-ink">
              Press a key
            </span>
          ) : keys.length === 0 ? (
            <span className="px-1 text-xs text-ink-faint group-hover:hidden">Not bound</span>
          ) : null}
          {!listening && canRecord ? (
            <span
              aria-hidden="true"
              className="hidden h-7 items-center gap-1 rounded border border-dashed border-edge-strong px-2 text-xs text-ink-muted group-hover:inline-flex"
            >
              <Plus size={11} /> Add
            </span>
          ) : null}
        </span>
      </div>
      {conflict ? (
        <div data-testid={`bind-conflict-${id}`} className="px-2 pt-2 pb-3">
          <p className="t-meta" title={`Set in ${conflict.source}`}>
            <span className="font-medium text-ink">{bindKeyLabel(conflict.key)}</span>{" "}
            {bindActionForCommand(conflict.command) ? (
              <>is bound to {bindActionForCommand(conflict.command)?.label}.</>
            ) : (
              <>
                already runs <code className="text-ink-muted">{conflict.command}</code>.
              </>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={conflict.onAssign}>
              Use for {label}
            </button>
            <button type="button" className="btn btn-quiet" onClick={conflict.onKeep}>
              Keep current
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function KeyCap({
  actionId,
  actionLabel,
  binding,
  canRemove,
  onRemove,
}: {
  actionId: BindActionId;
  actionLabel: string;
  binding: RowBinding;
  canRemove: boolean;
  onRemove: (key: string) => void;
}) {
  const name = bindKeyLabel(binding.key);
  const origin = binding.source
    ? `${binding.source.file}, line ${binding.source.line}`
    : "a startup cfg";
  return (
    <span
      data-testid={`bind-cap-${actionId}-${binding.key}`}
      title={binding.owned ? `Added in execs (${origin})` : `Set in ${origin}`}
      className="pointer-events-auto relative inline-flex h-7 min-w-8 items-center justify-center rounded border border-edge-strong bg-panel-raised px-2 text-xs font-medium text-ink shadow-[inset_0_-1px_0_rgb(0_0_0/0.35)]"
    >
      {name}
      {binding.owned ? (
        <button
          type="button"
          data-bind-navigation
          data-testid={`bind-remove-${actionId}-${binding.key}`}
          disabled={!canRemove}
          aria-label={`Remove ${name} from ${actionLabel}`}
          onClick={() => onRemove(binding.key)}
          className="absolute -top-2 -right-2 flex size-4 items-center justify-center rounded-full border border-edge-strong bg-panel text-ink-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:hidden"
        >
          <X size={9} weight="bold" aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
