import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { FilesEditor } from "./components/FilesEditor";
import { FilesReference } from "./components/FilesReference";
import { useAppStatus } from "./hooks/useAppStatus";
import { AutosaveActivity } from "./hooks/useAutosave";
import { useFilesAnalysis } from "./hooks/useFilesAnalysis";
import type { FilesContext, FilesSource } from "./lib/bridge";
import { newCfgPath } from "./lib/files-create";
import type { DirtyFileDraft, FilesDraftStore } from "./lib/files-drafts";
import { editorTextBytes } from "./lib/files-limits";
import { CLASS_CFG_NAMES, cfgExecutionRole, maskCfgPreview } from "./lib/files-reference";
import {
  blockingFindingsForFile,
  type CfgFinding,
  cfgFileMeta,
  cfgFiles,
  findingTierClass,
  hitAnalysisLimit,
} from "./lib/files-ui";
import type { SettingsTab } from "./lib/settings-ui";

type FilesPaneProps = {
  profileId: string | null;
  files: { path: string; text: string; source?: FilesSource }[];
  context?: FilesContext | null;
  onNavigate?: (tab: SettingsTab) => void;
  gameRunning?: boolean;
  recoveryAvailable?: boolean;
  limited?: boolean;
  hudId: string | null;
  draftStore: FilesDraftStore;
  closeReady?: boolean;
  onSave: (path: string, text: string, submission?: DirtyFileDraft) => Promise<boolean>;
};
export function FilesPane(props: FilesPaneProps) {
  return <ProfileFilesPane key={props.profileId} {...props} />;
}
function ProfileFilesPane({
  profileId,
  files,
  context,
  onNavigate,
  gameRunning,
  recoveryAvailable,
  limited,
  hudId,
  draftStore,
  closeReady = true,
  onSave,
}: FilesPaneProps) {
  const active = useContext(AutosaveActivity);
  const { running: statusRunning, busy, setError } = useAppStatus();
  const running = gameRunning ?? statusRunning;
  const [revision, refresh] = useState(0);
  const [picked, setPicked] = useState<string | null>(() => draftStore.selected(profileId));
  const [panel, setPanel] = useState<"explorer" | "problems" | "reference" | "new" | null>(null);
  const [scope, setScope] = useState("current");
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("autoexec");
  const [command, setCommand] = useState<string | null>(null);
  const [target, setTarget] = useState<{
    id: number;
    line?: number;
    from?: number;
    to?: number;
    focusOnly?: boolean;
  }>();
  const [insertion, setInsertion] = useState<{ id: number; text: string }>();
  const [snippet, setSnippet] = useState<string | null>(null);
  const [reviewConflict, setReviewConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const identity = useRef(0);
  const actionId = useRef(0);
  const auxiliary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!panel || !active) return;
    const frame = requestAnimationFrame(() => {
      auxiliary.current?.scrollIntoView?.({ block: "start" });
      const field = auxiliary.current?.querySelector<HTMLInputElement>("input");
      if (field) field.focus({ preventScroll: true });
      else auxiliary.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [panel, active]);
  for (const file of files) draftStore.read(profileId, file.path, file.text, file.source);
  draftStore.markMissing(profileId, new Set(files.map((file) => file.path)));
  const documents = draftStore.documents(profileId);
  const listed = cfgFiles(documents, hudId);
  const selected =
    picked && listed.some((file) => file.path === picked)
      ? picked
      : (listed.find((file) => file.editable && /(?:^|\/)autoexec\.cfg$/i.test(file.path))?.path ??
        listed.find((file) => file.editable)?.path ??
        listed[0]?.path ??
        null);
  const meta = selected ? cfgFileMeta(selected, hudId) : null;
  const state = selected ? draftStore.state(profileId, selected) : null;
  const draft = state?.text ?? "";
  const recovering = state?.missingReviewed === true && recoveryAvailable === true;
  const editable = meta?.editable === true;
  const dirtyDocuments = draftStore.dirty().filter((doc) => doc.profile === profileId);
  // Capture every document once. A change in any source or draft invalidates all prior ranges.
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision represents mutations in the session store.
  const snapshot = useMemo(
    () => ({
      profile: profileId,
      hudId,
      files: draftStore.documents(profileId).map(({ path, text }) => ({ path, text })),
      identity: `${profileId}:${++identity.current}`,
    }),
    [profileId, files, hudId, revision, draftStore],
  );
  const analysis = useFilesAnalysis(snapshot, active);
  const findings = [
    ...new Map(
      (analysis.result?.findings ?? []).map((finding) => [findingKey(finding), finding]),
    ).values(),
  ];
  const blocking = blockingFindingsForFile(findings, selected);
  const canSave =
    !!selected &&
    editable &&
    state?.dirty &&
    !state.conflict &&
    !saving &&
    !running &&
    (!busy || recovering) &&
    !!analysis.result &&
    !hitAnalysisLimit(analysis.result) &&
    blocking.length === 0 &&
    closeReady;
  const links = analysis.links;
  const shownFindings = findings.filter((finding) =>
    scope === "provided"
      ? finding.advisory
      : scope === "editable"
        ? !finding.advisory
        : finding.file === selected,
  );
  const filtered = listed.filter(
    (file) =>
      !query ||
      file.path.toLowerCase().includes(query.toLowerCase()) ||
      maskCfgPreview(documents.find((doc) => doc.path === file.path)?.text ?? "")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const creation = newCfgPath(newName, context?.layer ?? "vanilla");
  function pick(path: string, line?: number, from?: number, to?: number) {
    draftStore.select(profileId, path);
    setPicked(path);
    setReviewConflict(false);
    setTarget({ id: ++actionId.current, line, from, to });
  }
  function update(text: string) {
    if (!selected || !editable || !closeReady) return;
    if (editorTextBytes(text) === null) {
      setError("This cfg exceeds the 1 MiB editing limit. The previous draft is retained.");
      return;
    }
    draftStore.edit(profileId, selected, text);
    refresh((value) => value + 1);
  }
  async function save(all = false) {
    if (
      savingRef.current ||
      running ||
      (busy && !recovering) ||
      !closeReady ||
      (!all && (!editable || !state?.dirty || state.conflict)) ||
      (analysis.result && hitAnalysisLimit(analysis.result))
    )
      return;
    const submissions = draftStore
      .dirty()
      .filter((doc) => doc.profile === profileId && (all || doc.path === selected));
    savingRef.current = true;
    setSaving(true);
    try {
      for (const submission of submissions) {
        if (
          analysis.result &&
          blockingFindingsForFile(analysis.result.findings, submission.path).length
        ) {
          pick(submission.path);
          setPanel("problems");
          break;
        }
        if (draftStore.state(profileId, submission.path)?.conflict) {
          pick(submission.path);
          setReviewConflict(true);
          break;
        }
        if (!(await onSave(submission.path, submission.text, submission))) break;
        draftStore.acknowledge(profileId, submission.path, submission.text);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
      refresh((value) => value + 1);
    }
  }
  function create() {
    if (!context || !creation.path || context.profileId !== profileId || !closeReady) return;
    const existing = listed.find(
      (file) => file.path.toLowerCase() === creation.path?.toLowerCase(),
    );
    if (existing) pick(existing.path);
    else {
      draftStore.create(profileId, creation.path, {
        ...context,
        sha256: null,
        librarySha256: null,
      });
      pick(creation.path);
      refresh((value) => value + 1);
    }
    setPanel(null);
  }
  const status = running
    ? "Writes locked · explicit Save after TF2 closes"
    : !editable
      ? "Provided source · read-only"
      : state?.conflict
        ? "Source changed · review required"
        : analysis.error
          ? "Analysis unavailable"
          : !analysis.result
            ? "Checking current drafts…"
            : blocking.length
              ? `${blocking.length} save restrictions`
              : limited
                ? "Incomplete inventory"
                : !analysis.result.safetyComplete
                  ? "Safety analysis incomplete"
                  : !analysis.result.executionComplete
                    ? "Current checks · execution unresolved"
                    : "Current draft checked";
  return (
    <section data-testid="settings-files" className="flex min-w-0 flex-col gap-2 text-left">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="t-section">Files</h2>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["explorer", "Open file"],
              ["problems", `Problems (${findings.length})`],
              ["reference", "Reference"],
              ["new", "New cfg"],
            ] as const
          ).map(([name, label]) => (
            <button
              type="button"
              className="btn btn-ghost"
              key={name}
              aria-expanded={panel === name}
              onClick={() => setPanel(panel === name ? null : name)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setPanel(null);
              setSnippet(null);
              setTarget({ id: ++actionId.current, focusOnly: true });
            }}
            aria-label="Focus editor"
          >
            Focus
          </button>
        </div>
      </header>
      <div className="surface min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-3 py-2">
          <div className="min-w-0 flex-1">
            <h3 className="t-row truncate">
              {selected?.split("/").pop() ?? "No file open"}
              {state?.dirty ? " · Unsaved" : ""}
            </h3>
            <p className="t-meta break-all select-text">
              {selected ?? "Create a cfg or open a provided source."}
            </p>
          </div>
          {editable && (
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!state?.dirty || saving}
                onClick={() => {
                  if (selected) draftStore.discard(profileId, selected);
                  refresh((value) => value + 1);
                }}
              >
                Discard file
              </button>
              <button
                type="button"
                data-testid="files-save"
                className="btn btn-primary"
                disabled={!canSave}
                onClick={() => void save()}
              >
                {saving ? "Saving…" : state?.missingReviewed ? "Restore file" : "Save file"}
              </button>
            </div>
          )}
        </div>
        {selected ? (
          <FilesEditor
            profileId={profileId}
            path={selected}
            value={draft}
            readOnly={!editable || !closeReady}
            active={active}
            onChange={update}
            onSave={() => void save()}
            files={snapshot.files}
            target={target}
            insertion={insertion}
            onCommandChange={setCommand}
          />
        ) : (
          <p className="t-meta min-h-60 p-4">
            No .cfg files in this profile. New cfg creates an unsaved draft.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge px-3 py-2">
          <p role="status" data-testid="files-lint-badge" className="t-meta">
            {status}
          </p>
          {dirtyDocuments.length > 1 && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={
                running || busy || saving || !analysis.result || hitAnalysisLimit(analysis.result)
              }
              onClick={() => void save(true)}
            >
              Save all {dirtyDocuments.length} drafts
            </button>
          )}
        </div>
      </div>
      {analysis.error && (
        <p role="alert" className="t-meta">
          {analysis.error}{" "}
          <button type="button" className="btn btn-ghost" onClick={analysis.retry}>
            Retry analysis
          </button>
        </p>
      )}
      {state?.conflict && (
        <div role="alert" className="surface p-3">
          <p className="t-row">
            {state.missing ? "This source was removed." : "This source changed outside your draft."}
          </p>
          <p className="t-meta">
            Your draft is retained. Compare it with the current source before saving.
          </p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setReviewConflict(!reviewConflict)}
          >
            Compare current source
          </button>
          {reviewConflict && (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <h4 className="t-row">Current source</h4>
                  <pre className="whitespace-pre-wrap break-all text-sm">
                    {state.missing ? "Source no longer exists" : state.source}
                  </pre>
                </div>
                <div>
                  <h4 className="t-row">Your draft</h4>
                  <pre className="whitespace-pre-wrap break-all text-sm">{draft}</pre>
                </div>
              </div>
              <p className="t-meta">
                Review differences above. Keeping the draft uses this displayed source as its new
                baseline; Save still rechecks it.
              </p>
              <button
                type="button"
                disabled={state.missing && state.currentExpected?.sha256 !== null}
                className="btn btn-ghost"
                onClick={() => {
                  if (selected) draftStore.reviewCurrent(profileId, selected);
                  setReviewConflict(false);
                  refresh((value) => value + 1);
                }}
              >
                {state.missing ? "Review draft for restoration" : "Keep reviewed draft"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  if (selected) draftStore.discard(profileId, selected);
                  refresh((value) => value + 1);
                }}
              >
                Discard draft and use current source
              </button>
            </>
          )}
        </div>
      )}
      <div ref={auxiliary} tabIndex={-1} className="outline-none">
        {panel === "explorer" && (
          <section className="surface p-3" aria-label="Profile files">
            <label className="t-row" htmlFor="files-search">
              Search filenames, paths and draft content
            </label>
            <input
              id="files-search"
              className="input mt-2 w-full"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <p className="t-meta my-2">
              {listed.length} loaded cfg documents, including unsaved drafts.{" "}
              {limited ? "Inventory is incomplete." : "VPK and unscanned sources are not searched."}{" "}
              Credential values are masked in search.
            </p>
            <div data-testid="files-list">
              {["Your cfgs", "Managed by execs", "Provided"].map((group) => (
                <div key={group}>
                  <h3 className="eyebrow my-2">{group}</h3>
                  {filtered
                    .filter((file) =>
                      group === "Provided"
                        ? !file.editable
                        : group === "Managed by execs"
                          ? file.origin === "app"
                          : file.editable && file.origin !== "app",
                    )
                    .map((file) => (
                      <button
                        type="button"
                        key={file.path}
                        data-testid="files-item"
                        data-path={file.path}
                        data-origin={file.origin}
                        data-active={selected === file.path}
                        className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-edge py-2 text-left"
                        aria-current={selected === file.path ? "true" : undefined}
                        onClick={() => {
                          pick(file.path);
                          setPanel(null);
                        }}
                      >
                        <span>
                          <strong className="t-row">{file.path.split("/").pop()}</strong>
                          <span className="t-meta block break-all">{file.path}</span>
                        </span>
                        <span className="t-meta">
                          {draftStore.state(profileId, file.path)?.dirty ? "Unsaved · " : ""}
                          {file.badge}
                        </span>
                      </button>
                    ))}
                </div>
              ))}
            </div>
          </section>
        )}
        {panel === "problems" && (
          <section className="surface p-3" aria-label="Problems">
            <div className="flex flex-wrap gap-2">
              {[
                ["current", "This document"],
                ["editable", "All editable"],
                ["provided", "Provided advisories"],
              ].map(([value, label]) => (
                <button
                  type="button"
                  className="btn btn-ghost"
                  key={value}
                  aria-pressed={scope === value}
                  onClick={() => setScope(value)}
                >
                  {label} (
                  {
                    findings.filter((f) =>
                      value === "current"
                        ? f.file === selected
                        : value === "provided"
                          ? f.advisory
                          : !f.advisory,
                    ).length
                  }
                  )
                </button>
              ))}
            </div>
            <p className="t-meta my-2">
              Static analysis covers loaded cfg text and retained drafts. Unresolved execs, mount
              order and server behavior can limit execution knowledge.
            </p>
            {!analysis.result ? (
              <p className="t-meta">{analysis.error ?? "Checking current drafts…"}</p>
            ) : shownFindings.length === 0 ? (
              <p className="t-meta">
                No findings in this scope. This does not prove runtime behavior.
              </p>
            ) : (
              <ul>
                {shownFindings.map((finding) => (
                  <FindingRow
                    key={findingKey(finding)}
                    finding={finding}
                    onOpen={() => {
                      pick(finding.file, finding.line, finding.from, finding.to);
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        )}
        {panel === "reference" && (
          <section className="surface p-3">
            <FilesReference
              command={command}
              selectedPath={selected}
              editable={editable}
              onInsert={setSnippet}
            />
          </section>
        )}
        {snippet !== null && (
          <section className="surface p-3" aria-label="Snippet preview">
            <h3 className="t-row">Insert into {selected}</h3>
            <p className="t-meta">
              Replaces the selected text in this unsaved draft. Undo restores it. Nothing executes
              or saves.
            </p>
            <pre className="my-2 whitespace-pre-wrap">{snippet}</pre>
            <button
              type="button"
              disabled={!editable || !closeReady}
              className="btn btn-primary"
              onClick={() => {
                setInsertion({ id: ++actionId.current, text: snippet });
                setSnippet(null);
              }}
            >
              Insert into draft
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setSnippet(null)}>
              Cancel
            </button>
          </section>
        )}
        {panel === "new" && (
          <section className="surface p-3" aria-label="New cfg">
            <h3 className="t-row">New user cfg</h3>
            <div className="my-2 flex flex-wrap gap-1">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setNewName("autoexec")}
              >
                Autoexec
              </button>
              {CLASS_CFG_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setNewName(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            <label className="t-meta" htmlFor="new-cfg-name">
              Name or relative helper path
            </label>
            <input
              id="new-cfg-name"
              className="input mt-1 w-full"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <p className="t-meta my-2">
              {!context
                ? "Waiting for verified profile and cfg layer."
                : (creation.error ?? creation.path)}
            </p>
            <p className="t-meta">
              {newName.replace(/\.cfg$/i, "") === "autoexec"
                ? "Runs at startup in the detected cfg layer."
                : (CLASS_CFG_NAMES as readonly string[]).includes(newName.replace(/\.cfg$/i, ""))
                  ? "Runs when this class is selected."
                  : "Manual helper: creating it does not add a startup exec."}
            </p>
            <button
              type="button"
              className="btn btn-primary mt-2"
              disabled={!context || !!creation.error || !closeReady}
              onClick={create}
            >
              Open unsaved draft
            </button>
          </section>
        )}
      </div>
      {selected && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-muted">File ownership and execution</summary>
          <p className="t-meta mt-2">
            {selected.toLowerCase() === "tf/cfg/config.cfg"
              ? "Engine-managed, editable here. TF2 can serialize settings and binds over this file."
              : meta?.origin === "app"
                ? "Managed by execs. Its settings pane may rewrite these commands after a manual edit."
                : editable
                  ? "Your profile cfg. Save updates its allowed live projection while TF2 is closed."
                  : "Provided engine, HUD or pack source. Read-only here; findings are advisory."}
          </p>
          {meta?.origin === "app" && onNavigate && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                onNavigate(
                  selected.includes("execs_binds")
                    ? "binds"
                    : selected.includes("execs_gameplay")
                      ? "gameplay"
                      : selected.includes("execs_preload")
                        ? "mods"
                        : "comfig",
                )
              }
            >
              Open owning settings pane
            </button>
          )}
          <p className="t-meta">
            {cfgExecutionRole(selected, snapshot.files, context?.layer === "comfig")}
          </p>
          {links
            .filter((link) => link.file === selected || link.target === selected)
            .map((link) => (
              <button
                key={`${link.file}:${link.line}:${link.kind}:${link.target}:${link.targetLine}:${link.deferred}`}
                type="button"
                className="btn btn-ghost"
                disabled={!link.target}
                onClick={() => {
                  if (link.target) pick(link.target, link.targetLine);
                }}
              >
                {link.label}: {link.target ?? "Unresolved in loaded cfgs"}
              </button>
            ))}
        </details>
      )}
    </section>
  );
}
function FindingRow({ finding, onOpen }: { finding: CfgFinding; onOpen: () => void }) {
  return (
    <li
      data-testid="files-finding"
      data-tier={finding.tier}
      data-advisory={finding.advisory}
      className="border-t border-edge py-3"
    >
      <button
        type="button"
        className="text-left text-sm underline underline-offset-4"
        onClick={onOpen}
      >
        {finding.file}:{finding.line}:{finding.col}
      </button>
      <span className={`badge ml-2 ${findingTierClass(finding.tier)}`}>
        {finding.advisory
          ? "Advisory"
          : finding.tier === "block"
            ? "Save restriction"
            : finding.tier}
      </span>
      <p className="mt-1 text-sm leading-6">{findingMessage(finding.message)}</p>
      {finding.via && <p className="t-meta">Trace: {finding.via}</p>}
      <p className="t-meta">
        {finding.advisory
          ? "Read-only source; this does not block your saves."
          : finding.tier === "block"
            ? "Review this command at its source before saving. Nothing is stripped."
            : "Review the command and its Reference entry; this finding does not block saving."}
      </p>
    </li>
  );
}

function findingKey(finding: CfgFinding) {
  return `${finding.file}:${finding.line}:${finding.col}:${finding.ruleId}:${finding.via ?? ""}`;
}
function findingMessage(message: string) {
  let offset = 0;
  const parts = [];
  for (const match of message.matchAll(/`([^`]*)`/g)) {
    parts.push(message.slice(offset, match.index));
    parts.push(<code key={`code:${match.index}`}>{match[1]}</code>);
    offset = match.index + match[0].length;
  }
  parts.push(message.slice(offset));
  return parts;
}
