export function FirstRunExisting({
  path,
  draftName,
  reasons,
  running,
  busy,
  error,
  onDraftName,
  onSave,
  onChange,
}: {
  path: string;
  draftName: string;
  reasons: string[];
  running: boolean;
  busy: boolean;
  error: string | null;
  onDraftName: (name: string) => void;
  onSave: () => void;
  onChange: () => void;
}) {
  const canSave = !running && !busy && draftName.trim().length > 0;

  return (
    <section className="flex w-full flex-col items-center text-center">
      <h1 className="font-display text-6xl text-brand">execs</h1>
      <p className="mt-6 font-display text-sm tracking-wide text-ink-muted">TF2 install</p>
      <p className="mt-2 max-w-lg break-all text-sm text-ink">{path}</p>
      <p className="mt-4 max-w-lg text-sm text-ink">
        This install already has customization. Save it as a profile before changing anything.
      </p>

      <div
        data-testid="first-run-existing"
        className="mt-8 w-full rounded-xl border border-edge bg-panel p-4 text-left"
      >
        {reasons.length > 0 ? (
          <ul data-testid="first-run-reasons" className="mb-4 flex flex-col gap-1 text-sm text-ink-muted">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}

        {running ? (
          <p className="text-sm text-ink-muted">Read-only while TF2 is running.</p>
        ) : (
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-center"
            onSubmit={(event) => {
              event.preventDefault();
              onSave();
            }}
          >
            <label className="sr-only" htmlFor="first-run-profile-name">
              Profile name
            </label>
            <input
              id="first-run-profile-name"
              value={draftName}
              onChange={(event) => onDraftName(event.target.value)}
              placeholder="Name this profile"
              disabled={busy}
              className="min-w-0 flex-1 rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
            />
            <button
              type="submit"
              disabled={!canSave}
              className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
            >
              Save current as…
            </button>
          </form>
        )}
      </div>

      {error ? <p className="mt-4 text-sm text-team-red">{error}</p> : null}

      <button
        type="button"
        onClick={onChange}
        className="mt-6 rounded-pill border border-edge px-5 py-2 text-sm text-ink hover:bg-panel-raised"
      >
        Change
      </button>
    </section>
  );
}
