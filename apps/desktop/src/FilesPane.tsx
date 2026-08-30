import { useMemo, useState } from "react";
import { canSaveCfg, cfgFiles, findingTierClass, lintBundle } from "./lib/files-ui";

export function FilesPane({
  running,
  busy,
  files,
  onSave,
}: {
  running: boolean;
  busy: boolean;
  files: { path: string; text: string }[];
  onSave: (path: string, text: string) => void;
}) {
  const listed = useMemo(() => cfgFiles(files), [files]);
  const [picked, setPicked] = useState<string | null>(null);
  const selected =
    picked !== null && listed.some((file) => file.path === picked)
      ? picked
      : (listed[0]?.path ?? null);
  const source = files.find((file) => file.path === selected)?.text ?? "";
  const [draft, setDraft] = useState(source);
  const [draftPath, setDraftPath] = useState(selected);

  if (selected !== draftPath) {
    setDraftPath(selected);
    setDraft(source);
  }

  const dirty = selected !== null && draft !== source;
  const bundle = useMemo(
    () =>
      listed.map((file) => {
        const live = files.find((item) => item.path === file.path)?.text ?? "";
        return { path: file.path, text: file.path === selected ? draft : live };
      }),
    [listed, files, selected, draft],
  );
  const lint = useMemo(() => lintBundle(bundle), [bundle]);
  const canSave = selected !== null && canSaveCfg(lint.ok, running, busy, dirty);

  function handleSave() {
    if (!selected || !canSaveCfg(lint.ok, running, busy, dirty)) {
      return;
    }
    onSave(selected, draft);
  }

  return (
    <section data-testid="settings-files" className="flex flex-col gap-4 text-left">
      <p className="font-display text-sm tracking-wide text-ink-muted">Raw cfg</p>
      <p className="text-sm text-ink-muted">
        Edit owned <code className="text-ink">.cfg</code> files. Block-tier commands are refused,
        not stripped.
      </p>

      <div className="flex flex-col gap-4 md:flex-row">
        <ul data-testid="files-list" className="flex flex-col gap-1 md:w-56 md:shrink-0">
          {listed.length === 0 ? (
            <li className="text-sm text-ink-muted">No .cfg files in this profile.</li>
          ) : (
            listed.map((file) => {
              const active = file.path === selected;
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    data-testid="files-item"
                    data-path={file.path}
                    data-active={active ? "true" : "false"}
                    onClick={() => setPicked(file.path)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-xs break-all transition ${
                      active
                        ? "border-brand bg-panel-raised text-ink"
                        : "border-edge bg-bg text-ink hover:border-ink-faint"
                    }`}
                  >
                    {file.path}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {selected ? (
            <>
              <label className="sr-only" htmlFor="files-editor">
                {selected}
              </label>
              <textarea
                id="files-editor"
                data-testid="files-editor"
                value={draft}
                readOnly={running}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
                className="min-h-48 w-full resize-y rounded-lg border border-edge bg-bg px-3 py-2 font-mono text-sm text-ink focus:border-brand focus:outline-none"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-testid="files-save"
                  disabled={!canSave}
                  onClick={handleSave}
                  className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
                >
                  Save
                </button>
                {running ? (
                  <p className="text-sm text-ink-muted">Read-only while TF2 is running.</p>
                ) : null}
              </div>
              {lint.ok ? null : (
                <p data-testid="files-blocked" className="text-sm text-team-red">
                  Block-tier findings must be fixed before this file can be saved. Commands are not
                  stripped.
                </p>
              )}
              {lint.findings.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {lint.findings.map((finding) => (
                    <li
                      key={`${finding.ruleId}-${finding.file}-${finding.line}-${finding.message}`}
                      data-testid="files-finding"
                      data-tier={finding.tier}
                      className="flex items-start gap-2 text-sm text-ink"
                    >
                      <span
                        className={`mt-0.5 rounded-pill px-2 py-0.5 text-xs ${findingTierClass(finding.tier)}`}
                      >
                        {finding.tier}
                      </span>
                      <span>
                        <code className="text-xs text-ink-faint">{finding.ruleId}</code>{" "}
                        {finding.message}{" "}
                        <code className="text-xs text-ink-faint">
                          {finding.file}:{finding.line}
                        </code>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-health">No findings.</p>
              )}
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
