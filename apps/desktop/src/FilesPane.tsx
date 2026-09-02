import { useDeferredValue, useMemo, useState } from "react";
import { PaneHeader } from "./components/ui/PaneHeader";
import { useAppStatus } from "./hooks/useAppStatus";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import {
  blockingFindingsForFile,
  type CfgFinding,
  canSaveCfg,
  cfgFileMeta,
  cfgFiles,
  findingTierClass,
  lintBundle,
} from "./lib/files-ui";

export function FilesPane({
  profileId,
  files,
  hudId,
  onSave,
}: {
  /** The profile this draft belongs to; a switch discards it. */
  profileId: string | null;
  files: { path: string; text: string }[];
  hudId: string | null;
  onSave: (path: string, text: string) => void;
}) {
  const { running, busy } = useAppStatus();
  const listed = useMemo(() => cfgFiles(files, hudId), [files, hudId]);
  const [picked, setPicked] = useState<string | null>(null);
  const selected =
    picked !== null && listed.some((file) => file.path === picked)
      ? picked
      : (listed[0]?.path ?? null);
  const selectedMeta = selected !== null ? cfgFileMeta(selected, hudId) : null;
  const source = files.find((file) => file.path === selected)?.text ?? "";
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  const editable = selectedMeta?.editable ?? false;
  // A reload hands this pane a brand-new `files` array even when the bytes are
  // identical; the shared hook reseeds on real content change or a file switch,
  // never over unsaved edits.
  const [draft, setDraft] = useSeededDraft(
    source,
    (text) => text,
    draftRecordKey(profileId, selected),
  );
  const dirty = selected !== null && editable && draft !== source;

  // Alias expansion in cfglint is expensive and the bundle can be dozens of
  // files: lint the settled text, not every keystroke.
  const deferredDraft = useDeferredValue(draft);
  const bundle = useMemo(
    () =>
      listed.map((file) => {
        const live = files.find((item) => item.path === file.path)?.text ?? "";
        return {
          path: file.path,
          text: file.path === selected && editable ? deferredDraft : live,
        };
      }),
    [listed, files, selected, deferredDraft, editable],
  );
  const lint = useMemo(() => lintBundle(bundle, hudId), [bundle, hudId]);
  const strictFindings = lint.findings.filter((finding) => !finding.advisory);
  const advisoryFindings = lint.findings.filter((finding) => finding.advisory);
  // The refusal is scoped to the file being saved: a block finding in another
  // cfg is still shown, but it is that file's problem, not this one's.
  const blockingHere = useMemo(
    () => blockingFindingsForFile(lint.findings, selected),
    [lint.findings, selected],
  );
  const blockingElsewhere = strictFindings.filter(
    (finding) => finding.tier === "block" && !blockingHere.includes(finding),
  ).length;
  const canSave = selected !== null && canSaveCfg(blockingHere, running, busy, dirty, editable);

  function handleSave() {
    if (!selected || !canSaveCfg(blockingHere, running, busy, dirty, editable)) {
      return;
    }
    onSave(selected, draft);
  }

  function requestPick(path: string) {
    if (path === selected) {
      return;
    }
    if (dirty) {
      // Never drop an edit on a list click — make the choice explicit.
      setPendingPath(path);
      return;
    }
    setPicked(path);
  }

  function discardAndSwitch() {
    if (pendingPath === null) {
      return;
    }
    setDraft(source);
    setPicked(pendingPath);
    setPendingPath(null);
  }

  function saveAndSwitch() {
    if (pendingPath === null) {
      return;
    }
    handleSave();
    if (canSave) {
      setPicked(pendingPath);
    }
    setPendingPath(null);
  }

  return (
    <section data-testid="settings-files" className="flex min-w-0 flex-col gap-4 text-left">
      <PaneHeader
        title="Files"
        lede="Files from TF2, your HUD or packs are read-only."
        actions={
          <span className="tnum t-meta text-ink-faint">
            {listed.length} {listed.length === 1 ? "file" : "files"}
          </span>
        }
      />

      <div className="grid min-w-0 items-stretch gap-3 lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_19rem]">
        <aside className="surface min-w-0 lg:min-h-[31rem]">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2.5">
            <h3 className="t-row">Profile files</h3>
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
                      onClick={() => requestPick(file.path)}
                      className={`flex w-full items-center justify-between gap-2 overflow-hidden rounded-md px-2.5 py-2 text-left font-mono text-[11px] leading-4 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand ${
                        active
                          ? "bg-panel-raised text-ink"
                          : "text-ink-muted hover:bg-panel-raised/50 hover:text-ink"
                      }`}
                    >
                      <span className="block truncate" title={file.path}>
                        {file.path}
                      </span>
                      {file.badge ? (
                        <span className="badge shrink-0 font-sans">{file.badge}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {pendingPath !== null ? (
            <div
              data-testid="files-switch-guard"
              className="border-t border-edge px-3 py-2.5 text-[12.5px] leading-5 text-ink"
            >
              <p>
                Save or discard before opening{" "}
                <span className="font-mono text-ink-muted">{pendingPath}</span>.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="files-switch-save"
                  disabled={!canSave}
                  onClick={saveAndSwitch}
                  className="btn btn-primary"
                >
                  Save
                </button>
                <button
                  type="button"
                  data-testid="files-switch-discard"
                  onClick={discardAndSwitch}
                  className="btn btn-ghost"
                >
                  Discard
                </button>
                <button
                  type="button"
                  data-testid="files-switch-cancel"
                  onClick={() => setPendingPath(null)}
                  className="btn btn-ghost"
                >
                  Keep editing
                </button>
              </div>
            </div>
          ) : null}
        </aside>

        <div className="surface flex min-w-0 flex-col lg:min-h-[31rem]">
          <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-edge px-3 py-2">
            <div className="min-w-0">
              <p className="t-row">Editor</p>
              {selected ? (
                <p className="truncate font-mono text-[12px] text-ink-muted">{selected}</p>
              ) : (
                <p className="text-[12px] text-ink-faint">No file selected</p>
              )}
            </div>
            {selected && !editable ? (
              <span data-testid="files-read-only" className="badge">
                Read-only
              </span>
            ) : dirty ? (
              <span className="badge badge-warn">Unsaved</span>
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
                className="min-h-72 flex-1 resize-y border-0 bg-bg px-4 py-3 font-mono text-[13px] leading-6 text-ink outline-none transition-shadow focus:shadow-[inset_2px_0_0_var(--color-brand)] read-only:cursor-not-allowed read-only:text-ink-muted xl:min-h-[25rem]"
              />
              <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-t border-edge px-3 py-2.5">
                <p className="t-meta">
                  {running
                    ? "Read-only while TF2 is running."
                    : !editable
                      ? `Provided by ${originLabel(selectedMeta?.origin)} — read-only.`
                      : dirty
                        ? "Unsaved changes"
                        : "Saved"}
                </p>
                {editable ? (
                  <button
                    type="button"
                    data-testid="files-save"
                    disabled={!canSave}
                    onClick={handleSave}
                    className="btn btn-primary"
                  >
                    Save file
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="t-meta grid min-h-72 flex-1 place-items-center bg-bg px-6 text-center">
              No file open.
            </div>
          )}
        </div>

        <aside className="surface min-w-0 md:min-h-56 lg:col-span-2 xl:col-span-1 xl:min-h-[31rem]">
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-edge px-3 py-2">
            <div>
              <h3 className="t-row">Validation</h3>
            </div>
            <span
              data-testid="files-lint-badge"
              className={`badge ${blockingHere.length === 0 ? "badge-ok" : "badge-error"}`}
            >
              {blockingHere.length === 0 ? "Ready" : "Blocked"}
            </span>
          </div>

          <div className="flex max-h-[27.5rem] flex-col gap-3 overflow-y-auto p-3">
            {blockingHere.length > 0 ? (
              <p
                data-testid="files-blocked"
                className="t-meta rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-ink"
              >
                Fix the block findings to save this file; nothing is stripped.
              </p>
            ) : null}

            {blockingElsewhere > 0 ? (
              <p
                data-testid="files-blocked-elsewhere"
                className="t-meta rounded-lg border border-edge px-3 py-2"
              >
                {blockingElsewhere} block {blockingElsewhere === 1 ? "issue" : "issues"} in other
                files; they do not block this save.
              </p>
            ) : null}

            {strictFindings.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {strictFindings.map((finding) => (
                  <FindingRow key={findingKey(finding)} finding={finding} />
                ))}
              </ul>
            ) : (
              <div className="px-1 py-2">
                <p className="t-row text-ok">No findings in your files</p>
              </div>
            )}

            {advisoryFindings.length > 0 ? (
              <details data-testid="files-advisory" className="group">
                <summary className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-1 py-2 text-[13px] font-medium text-ink-muted hover:text-ink">
                  <span>Advisory — provided files ({advisoryFindings.length})</span>
                  <span className="text-ink-faint transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>
                <p className="px-1 pb-2 text-[12px] leading-5 text-ink-faint">
                  How those files work; never blocks your saves.
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
      className={`rounded-lg border border-edge p-2.5 text-[13px] text-ink ${advisory ? "opacity-70" : ""}`}
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className={`badge ${findingTierClass(finding.tier)}`}>{finding.tier}</span>
        <code className="text-[12px] text-ink-faint">{finding.ruleId}</code>
      </div>
      <p className="leading-6 text-ink-muted">{finding.message}</p>
      <code className="mt-1.5 block break-all text-[12px] leading-5 text-ink-faint">
        {finding.file}:{finding.line}
      </code>
    </li>
  );
}
