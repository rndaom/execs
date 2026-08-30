import { canEditLaunch, steamWriteCopy, type SteamWriteStatus } from "./lib/launch-ui";

export function LaunchPane({
  running,
  busy,
  value,
  steamWrite,
  onChange,
  onSave,
}: {
  running: boolean;
  busy: boolean;
  value: string;
  steamWrite?: SteamWriteStatus | null;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const canEdit = canEditLaunch(running, busy);
  const status = steamWrite ? steamWriteCopy(steamWrite) : "";

  return (
    <div data-testid="settings-launch" className="flex flex-col gap-3 text-left">
      <label className="text-sm text-ink-muted" htmlFor="launch-options">
        Launch options
      </label>
      <textarea
        id="launch-options"
        data-testid="launch-options"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={!canEdit}
        rows={3}
        spellCheck={false}
        className="w-full resize-y rounded-lg border border-edge bg-bg px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none disabled:opacity-40"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="launch-copy"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
          }}
          className="rounded-pill border border-edge px-4 py-1.5 text-sm text-ink hover:bg-panel-raised"
        >
          Copy
        </button>
        <button
          type="button"
          data-testid="launch-save"
          disabled={!canEdit}
          onClick={onSave}
          className="rounded-pill bg-brand px-4 py-1.5 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
        >
          Save
        </button>
      </div>
      <p data-testid="launch-steam-status" className="text-sm text-ink-muted">
        {status}
      </p>
    </div>
  );
}
