import { useEffect, useMemo, useState } from "react";
import {
  type CfgFinding,
  canSaveCfg,
  cfgFileMeta,
  cfgFiles,
  findingTierClass,
  lintBundle,
} from "./lib/files-ui";

export function FilesPane({
  running,
  busy,
  files,
  hudId,
  onSave,
}: {
  running: boolean;
  busy: boolean;
  files: { path: string; text: string }[];
  hudId: string | null;
  onSave: (path: string, text: string) => void;
}) {
  const listed = useMemo(() => cfgFiles(files, hudId), [files, hudId]);
  const [picked, setPicked] = useState<string | null>(null);
  const selected =
    picked !== null && listed.some((file) => file.path === picked)
      ? picked
      : (listed[0]?.path ?? null);
  const selectedMeta = selected !== null ? cfgFileMeta(selected, hudId) : null;
  const source = files.find((file) => file.path === selected)?.text ?? "";
  const draftSource = useMemo(() => ({ path: selected, text: source }), [selected, source]);
  const [draft, setDraft] = useState(source);

  useEffect(() => {
    setDraft(draftSource.text);
  }, [draftSource]);

  const editable = selectedMeta?.editable ?? false;
  const dirty = selected !== null && editable && draft !== source;
  const bundle = useMemo(
    () =>
      listed.map((file) => {
        const live = files.find((item) => item.path === file.path)?.text ?? "";
        return { path: file.path, text: file.path === selected && editable ? draft : live };
      }),
    [listed, files, selected, draft, editable],
  );
  const lint = useMemo(() => lintBundle(bundle, hudId), [bundle, hudId]);
  const strictFindings = lint.findings.filter((finding) => !finding.advisory);
  const advisoryFindings = lint.findings.filter((finding) => finding.advisory);
  const canSave = selected !== null && canSaveCfg(lint.ok, running, busy, dirty, editable);

  function handleSave() {
    if (!selected || !canSaveCfg(lint.ok, running, busy, dirty, editable)) {
      return;
    }
    onSave(selected, draft);
  }

  return (
    <section data-testid="settings-files" className="flex min-w-0 flex-col gap-4 text-left">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-[13px] leading-6 text-ink-muted">
          Edit the <code className="text-ink">.cfg</code> files you own. Files shipped by TF2, your
          HUD, or other packs are shown read-only — their contents never block your saves.
        </p>
        <span className="text-xs text-ink-faint">
          {listed.length} {listed.length === 1 ? "file" : "files"}
        </span>
      </div>

      <div className="grid min-w-0 items-stretch gap-3 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_19rem]">
        <aside className="surface min-w-0 lg:min-h-[31rem]">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2.5">
            <h3 className="text-[13px] font-medium text-ink">Profile files</h3>
            <span className="font-mono text-[10px] text-ink-faint">CFG</span>
          </div>
          <ul
            data-testid="files-list"
            className="flex max-h-60 flex-col overflow-y-auto p-1.5 lg:max-h-[27.5rem]"
          >
            {listed.length === 0 ? (
              <li className="px-2 py-3 text-xs leading-5 text-ink-muted">
                No .cfg files in this profile.
              </li>
            ) : (
              listed.map((file) => {
                const active = file.path === selected;
                return (
                  <li key={file.path}>
                    <button
                      type="button"
                      data-testid="files-item"
                      data-path={file.path}
                      data-origin={file.origin}
                      data-active={active ? "true" : "false"}
                      aria-current={active ? "true" : undefined}
                      onClick={() => setPicked(file.path)}
                      className={`flex w-full items-center justify-between gap-2 overflow-hidden rounded-md px-2.5 py-2 text-left font-mono text-[11px] leading-4 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand ${
                        active
                          ? "bg-brand/10 text-ink"
                          : "text-ink-muted hover:bg-panel-raised/50 hover:text-ink"
                      }`}
                    >
                      <span className="block truncate" title={file.path}>
                        {file.path}
                      </span>
                      {file.badge ? (
                        <span className="badge shrink-0 border border-edge font-sans text-ink-faint">
                          {file.badge}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </aside>

        <div className="surface flex min-w-0 flex-col lg:min-h-[31rem]">
          <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-edge px-3 py-2">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">Editor</p>
              {selected ? (
                <p className="truncate font-mono text-[10px] text-ink-muted">{selected}</p>
              ) : (
                <p className="text-[11px] text-ink-faint">No file selected</p>
              )}
            </div>
            {selected && !editable ? (
              <span
                data-testid="files-read-only"
                className="badge border border-edge text-ink-faint"
              >
                Read-only
              </span>
            ) : dirty ? (
              <span className="badge border border-brand/50 bg-brand/10 text-brand">Unsaved</span>
            ) : null}
          </div>

          {selected ? (
            <>
              <label className="sr-only" htmlFor="files-editor">
                {selected}
              </label>
              <textarea
                id="files-editor"
                data-testid="files-editor"
                value={editable ? draft : source}
                readOnly={running || !editable}
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
                className="min-h-72 flex-1 resize-y border-0 bg-bg px-4 py-3 font-mono text-xs leading-5 text-ink outline-none transition-shadow focus:shadow-[inset_2px_0_0_#cf6a32] read-only:cursor-not-allowed read-only:text-ink-muted xl:min-h-[25rem]"
              />
              <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-t border-edge px-3 py-2.5">
                <p className="text-[11px] text-ink-muted">
                  {running
                    ? "Read-only while TF2 is running."
                    : !editable
                      ? `Provided by ${originLabel(selectedMeta?.origin)} — read-only.`
                      : dirty
                        ? "Changes have not been saved."
                        : "No unsaved changes."}
                </p>
                {editable ? (
                  <button
                    type="button"
                    data-testid="files-save"
                    disabled={!canSave}
                    onClick={handleSave}
                    className="btn btn-primary px-4 py-1.5 text-xs"
                  >
                    Save file
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="grid min-h-72 flex-1 place-items-center bg-bg px-6 text-center text-xs text-ink-muted">
              Choose a cfg file to begin editing.
            </div>
          )}
        </div>

        <aside className="surface min-w-0 md:min-h-56 lg:col-span-2 xl:col-span-1 xl:min-h-[31rem]">
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-edge px-3 py-2">
            <div>
              <h3 className="text-[13px] font-medium text-ink">Validation</h3>
              <p className="text-[10px] text-ink-faint">Live cfg lint</p>
            </div>
            <span
              className={`badge border ${
                lint.ok
                  ? "border-health/50 bg-health/10 text-health"
                  : "border-team-red/50 bg-team-red/10 text-team-red"
              }`}
            >
              {lint.ok ? "Ready" : "Blocked"}
            </span>
          </div>

          <div className="flex max-h-[27.5rem] flex-col gap-3 overflow-y-auto p-3">
            {lint.ok ? null : (
              <p
                data-testid="files-blocked"
                className="rounded-lg border border-team-red/40 bg-team-red/10 px-3 py-2 text-xs leading-5 text-ink"
              >
                Block-tier findings must be fixed before this file can be saved. Commands are not
                stripped.
              </p>
            )}

            {strictFindings.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {strictFindings.map((finding) => (
                  <FindingRow key={findingKey(finding)} finding={finding} />
                ))}
              </ul>
            ) : (
              <div className="px-1 py-2">
                <p className="text-[13px] font-medium text-health">No findings in your files</p>
                <p className="mt-1 text-[11px] leading-5 text-ink-muted">
                  Everything you can edit passes the current safety checks.
                </p>
              </div>
            )}

            {advisoryFindings.length > 0 ? (
              <details data-testid="files-advisory" className="group">
                <summary className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-1 py-2 text-[11px] font-medium text-ink-muted hover:text-ink">
                  <span>Advisory — provided files ({advisoryFindings.length})</span>
                  <span className="text-ink-faint transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>
                <p className="px-1 pb-2 text-[11px] leading-4 text-ink-faint">
                  Findings in TF2-, HUD-, or pack-provided cfg. They are how those files work and
                  never block your saves.
                </p>
                <ul className="flex flex-col gap-2">
                  {advisoryFindings.map((finding) => (
                    <FindingRow key={findingKey(finding)} finding={finding} advisory />
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </aside>
      </div>
    </section>
  );
}

function findingKey(finding: CfgFinding): string {
  return `${finding.ruleId}-${finding.file}-${finding.line}-${finding.col}-${finding.via ?? ""}`;
}

function originLabel(origin: string | undefined): string {
  switch (origin) {
    case "hud":
      return "your HUD";
    case "pack":
      return "a custom pack";
    case "comfigImport":
      return "comfig-custom";
    case "engine":
      return "TF2";
    default:
      return "the game";
  }
}

function FindingRow({ finding, advisory = false }: { finding: CfgFinding; advisory?: boolean }) {
  return (
    <li
      data-testid="files-finding"
      data-tier={finding.tier}
      data-advisory={advisory ? "true" : "false"}
      className={`rounded-lg border border-edge p-2.5 text-xs text-ink ${advisory ? "opacity-80" : "bg-bg/60"}`}
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className={`badge ${findingTierClass(finding.tier)}`}>{finding.tier}</span>
        <code className="text-[10px] text-ink-faint">{finding.ruleId}</code>
      </div>
      <p className="leading-5 text-ink-muted">{finding.message}</p>
      <code className="mt-1.5 block break-all text-[10px] leading-4 text-ink-faint">
        {finding.file}:{finding.line}
      </code>
    </li>
  );
}
