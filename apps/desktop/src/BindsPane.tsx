import { useEffect, useState } from "react";
import {
  applyRecordedBind,
  BIND_ACTIONS,
  type BindActionId,
  type BindsLayer,
  bindsFilePath,
  canRecordBinds,
  keyForAction,
  parseManagedBinds,
  sourceKeyFromCode,
  sourceKeyFromMouseButton,
  sourceKeyFromWheelDelta,
} from "./lib/binds-ui";

export type BindsPaneProps = {
  running: boolean;
  busy: boolean;
  layer: BindsLayer;
  effectiveBinds: Record<string, string>;
  managedText: string;
  onSave: (bindsText: string, autoexecPatch?: { path: string; text: string }) => void;
};

export function BindsPane({
  running,
  busy,
  layer,
  effectiveBinds,
  managedText,
  onSave,
}: BindsPaneProps) {
  const [recordingId, setRecordingId] = useState<BindActionId | null>(null);
  const canRecord = canRecordBinds(running, busy);
  const managedKeys = parseManagedBinds(managedText);

  useEffect(() => {
    if (recordingId === null || !canRecord) {
      return;
    }

    let armed = false;
    const armTimer = window.setTimeout(() => {
      armed = true;
    }, 0);

    function finish(key: string | null) {
      if (!key) {
        return;
      }
      if (key === "escape" || !recordingId) {
        setRecordingId(null);
        return;
      }
      const next = applyRecordedBind(managedText, recordingId, key);
      setRecordingId(null);
      if (next !== managedText) {
        onSave(next);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      finish(sourceKeyFromCode(event.code));
    }

    function onMouseDown(event: MouseEvent) {
      if (!armed) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      finish(sourceKeyFromMouseButton(event.button));
    }

    function onWheel(event: WheelEvent) {
      if (!armed) {
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
  }, [recordingId, canRecord, managedText, onSave]);

  useEffect(() => {
    if (!canRecord) {
      setRecordingId(null);
    }
  }, [canRecord]);

  function onRow(actionId: BindActionId) {
    if (!canRecord) {
      return;
    }
    setRecordingId((current) => (current === actionId ? null : actionId));
  }

  return (
    <section data-testid="settings-binds" className="flex flex-col gap-4 text-left">
      <p className="font-display text-sm tracking-wide text-ink-muted">Usual actions</p>
      <p className="text-sm text-ink-muted">
        Click a row, then press a key or mouse button. Writes{" "}
        <span className="text-ink">{bindsFilePath(layer)}</span>.
      </p>

      <ul className="flex flex-col gap-2">
        {BIND_ACTIONS.map((action) => {
          const listening = recordingId === action.id;
          const bound =
            keyForAction(effectiveBinds, action.id) ?? managedKeys[action.id] ?? null;
          return (
            <li
              key={action.id}
              data-testid={`bind-row-${action.id}`}
              data-recording={listening ? "true" : "false"}
              className={`flex items-center gap-3 rounded-lg border bg-bg px-4 py-2 ${
                listening ? "border-brand" : "border-edge"
              }`}
            >
              <button
                type="button"
                disabled={!canRecord}
                onClick={() => onRow(action.id)}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left disabled:opacity-50"
              >
                <span className="text-sm text-ink">{action.label}</span>
                <span
                  data-testid={`bind-key-${action.id}`}
                  className={`rounded-pill border px-2 py-0.5 text-xs ${
                    listening
                      ? "border-brand text-brand"
                      : "border-edge text-ink-muted"
                  }`}
                >
                  {listening ? "Press a key…" : (bound ?? "—")}
                </span>
              </button>
              <button
                type="button"
                data-testid={`bind-record-${action.id}`}
                disabled={!canRecord}
                onClick={() => onRow(action.id)}
                className={`shrink-0 rounded-pill px-3 py-1 text-xs ${
                  listening
                    ? "bg-brand text-on-brand"
                    : "border border-edge text-ink hover:bg-panel-raised"
                } disabled:opacity-40`}
              >
                {listening ? "Listening" : "Record"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
