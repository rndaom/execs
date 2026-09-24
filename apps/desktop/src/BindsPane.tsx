import { type CfgFile, parseCommands } from "@execs/cfglint";
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
  BIND_ACTIONS,
  type BindActionId,
  type BindSourceMap,
  type BindsLayer,
  bindActionById,
  bindsFilePath,
  ensureAutoexecExecLine,
  normalizeBindCommand,
  recorderOutcomeForKey,
  removeOwnedManagedBind,
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

const BIND_GROUPS: Array<{
  id: string;
  title: string;
  ids: BindActionId[];
}> = [
  {
    id: "movement",
    title: "Movement",
    ids: ["forward", "back", "moveleft", "moveright", "jump", "duck"],
  },
  {
    id: "combat",
    title: "Combat",
    ids: ["attack", "attack2", "attack3", "reload", "inspect", "taunt"],
  },
  {
    id: "weapons",
    title: "Weapons",
    ids: ["invprev", "invnext", "lastinv", "slot1", "slot2", "slot3", "slot4", "slot5", "slot6"],
  },
  {
    id: "communication",
    title: "Communication",
    ids: [
      "medic",
      "voice",
      "chat",
      "teamchat",
      "partychat",
      "voicemenu1",
      "voicemenu2",
      "voicemenu3",
    ],
  },
  {
    id: "gameplay",
    title: "Gameplay",
    ids: ["use", "actionslot", "dropitem", "showscores", "spray", "ready", "lastdisguise"],
  },
  {
    id: "menus",
    title: "Menus",
    ids: ["changeclass", "changeteam", "character", "backpack", "mapinfo", "contracts", "console"],
  },
  {
    id: "loadouts",
    title: "Loadouts",
    ids: ["loadout0", "loadout1", "loadout2", "loadout3"],
  },
];

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
  const [groupSelection, setGroupSelection] = useState({ id: "movement", phase: 0 });
  const activeGroupId = groupSelection.id;
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

  const activeGroup = BIND_GROUPS.find((group) => group.id === activeGroupId) ?? BIND_GROUPS[0];

  return (
    <section data-testid="settings-binds" className="min-w-0 text-left">
      <PaneHeader title="Binds" />

      <div data-bind-navigation>
        <ClassTabs
          tabs={BIND_GROUPS.map((group) => ({ id: group.id, label: group.title }))}
          selected={activeGroupId}
          label="Bind categories"
          idPrefix="bind-category"
          panelId="bind-category-panel"
          onSelect={(id) => {
            setRecordingId(null);
            setRecorderNotice(null);
            setPendingKey(null);
            setGroupSelection((current) =>
              current.id === id ? current : { id, phase: current.phase + 1 },
            );
          }}
        />
      </div>

      <div
        id="bind-category-panel"
        role="tabpanel"
        aria-labelledby={`bind-category-${activeGroup.id}`}
        className="mt-5"
        data-switch={
          groupSelection.phase === 0 ? undefined : groupSelection.phase % 2 === 1 ? "odd" : "even"
        }
      >
        <div className="pane-toolbar mb-2">
          <h2 className="t-section">{activeGroup.title}</h2>
          <p className="t-meta">Select an action to record a binding.</p>
        </div>
        <ul className="pane-split gap-y-0">
          {activeGroup.ids.map((actionId) => {
            const action = BIND_ACTIONS.find((item) => item.id === actionId);
            if (!action) {
              return null;
            }
            const listening = recordingId === action.id;
            const keys = actionBindings(preview.binds, preview.sources, draft, path, action.id);
            const bound = keys.map((binding) => binding.key).join(", ");
            const pending = pendingKey?.actionId === action.id ? pendingKey : null;
            return (
              <li
                key={action.id}
                data-testid={`bind-row-${action.id}`}
                data-recording={listening ? "true" : "false"}
                className="group border-b border-edge"
              >
                <button
                  type="button"
                  data-bind-navigation
                  data-testid={`bind-record-${action.id}`}
                  disabled={!canRecord}
                  aria-label={`Add a key for ${action.label}. Known startup keys ${bound || "unbound"}`}
                  aria-pressed={listening}
                  aria-describedby={`bind-hint-${action.id}`}
                  onClick={() => onRow(action.id)}
                  className="flex min-h-16 w-full min-w-0 items-center gap-3 rounded-md py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="t-row block">{action.label}</span>
                    <span
                      id={`bind-hint-${action.id}`}
                      data-testid={listening && recorderNotice ? "bind-recorder-notice" : undefined}
                      aria-live="polite"
                      className="t-meta block min-h-5 text-ink-faint"
                    >
                      {listening ? (recorderNotice ?? "Esc cancels") : "\u00a0"}
                    </span>
                  </span>
                  <span
                    data-testid={`bind-key-${action.id}`}
                    className={`min-w-20 shrink-0 rounded-md border px-3 py-2 text-center text-[13px] font-medium uppercase tracking-wide transition-colors duration-150 ${
                      listening
                        ? "border-brand bg-brand/5 text-ink ring-1 ring-brand"
                        : "border-edge-strong bg-bg text-ink group-hover:border-ink-faint"
                    }`}
                  >
                    {listening ? "Press a key" : bound || "—"}
                  </span>
                </button>
                {keys.length > 0 ? (
                  <ul data-testid={`bind-keys-${action.id}`} className="mb-3 space-y-1">
                    {keys.map((binding) => (
                      <li
                        key={binding.key}
                        className="flex items-center gap-2 text-xs text-ink-faint"
                      >
                        <span className="font-medium uppercase text-ink">{binding.key}</span>{" "}
                        <span>
                          {binding.source
                            ? `${binding.source.file}:${binding.source.line}`
                            : "Startup CFG (source unavailable)"}
                        </span>
                        {binding.owned ? (
                          <button
                            type="button"
                            data-bind-navigation
                            data-testid={`bind-remove-${action.id}-${binding.key}`}
                            disabled={!canRecord}
                            onClick={() =>
                              setDraft(removeOwnedManagedBind(draft, action.id, binding.key))
                            }
                            className="ml-auto text-ink underline underline-offset-2 disabled:opacity-50"
                          >
                            Remove execs key
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {pending ? (
                  <div
                    data-testid={`bind-conflict-${action.id}`}
                    className="mb-3 text-xs text-ink-faint"
                  >
                    <p>
                      {pending.key} currently runs {pending.command} from {pending.source}. Assign
                      it to
                      {` ${action.label}`} instead?
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(applyRecordedBind(draft, pending.actionId, pending.key));
                        setPendingKey(null);
                      }}
                      className="mr-3 text-ink underline underline-offset-2"
                    >
                      Assign {pending.key}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingKey(null)}
                      className="text-ink underline underline-offset-2"
                    >
                      Keep current
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>

      {!canRecord ? <p className="t-meta mt-8">Finish the current task first.</p> : null}
      <p className="pane-note mt-6">
        Add a key without changing an action’s other keys. Only execs keys can be removed here.
        Sources describe inspected startup CFGs; class and in-game commands can change them. Saved
        to
        {` ${path}`}.
      </p>
    </section>
  );
}
