import {
  BookOpenText,
  DotsThree,
  FileCode,
  FilePlus,
  FolderOpen,
  MagnifyingGlass,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FilesEditor } from "./components/FilesEditor";
import { FilesReference } from "./components/FilesReference";
import {
  ContextMenu,
  ContextMenuItem,
  type ContextMenuPosition,
  ContextMenuSeparator,
} from "./components/ui/ContextMenu";
import { Segmented } from "./components/ui/Segmented";
import { Loading } from "./components/ui/Spinner";
import { useAppStatus } from "./hooks/useAppStatus";
import { AutosaveActivity } from "./hooks/useAutosave";
import { useFilesAnalysis } from "./hooks/useFilesAnalysis";
import type { FilesContext, FilesSource } from "./lib/bridge";
import { copyToClipboard } from "./lib/copy-ui";
import {
  type CfgDestination,
  cfgDestinations,
  cfgLayerRoot,
  cfgPathCollision,
  newCfgPathIn,
} from "./lib/files-create";
import type { DirtyFileDraft, FilesDraftStore } from "./lib/files-drafts";
import { editorTextBytes } from "./lib/files-limits";
import { CLASS_CFG_NAMES } from "./lib/files-reference";
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
  reviewTarget?: { id: number; path: string; line: number } | null;
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
  reviewTarget,
  draftStore,
  closeReady = true,
  onSave,
}: FilesPaneProps) {
  const active = useContext(AutosaveActivity);
  const { running: statusRunning, busy, setError } = useAppStatus();
  const running = gameRunning ?? statusRunning;
  const [revision, refresh] = useState(0);
  const [picked, setPicked] = useState<string | null>(() => draftStore.selected(profileId));
  const [panel, setPanel] = useState<"problems" | "reference" | "new" | "saveAs" | null>(null);
  const [fileMenu, setFileMenu] = useState<(ContextMenuPosition & { path: string }) | null>(null);
  const [scope, setScope] = useState<"current" | "all">("current");
  const [findingType, setFindingType] = useState<"issues" | "catalog">("issues");
  const [query, setQuery] = useState("");
  const [newKind, setNewKind] = useState<"startup" | "class" | "helper">("startup");
  const [newName, setNewName] = useState("autoexec");
  const normalizedNewName = newName.replace(/\.cfg$/i, "");
  const [newFolder, setNewFolder] = useState("");
  const [newCustomFolder, setNewCustomFolder] = useState("");
  const [saveAsName, setSaveAsName] = useState("");
  const [saveAsFolder, setSaveAsFolder] = useState("");
  const [saveAsCustomFolder, setSaveAsCustomFolder] = useState("");
  const [command, setCommand] = useState<string | null>(null);
  const [target, setTarget] = useState<{
    id: number;
    line?: number;
    from?: number;
    to?: number;
    focusOnly?: boolean;
  }>();
  const [reviewConflict, setReviewConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const identity = useRef(0);
  const actionId = useRef(0);
  const reviewedTarget = useRef<number | null>(null);
  const newCfgName = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (panel !== "new" || newKind !== "helper" || !active) return;
    const frame = requestAnimationFrame(() => {
      newCfgName.current?.focus({ preventScroll: true });
      newCfgName.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [panel, active, newKind]);
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
      layer: context?.layer ?? "vanilla",
      files: draftStore.documents(profileId).map(({ path, text }) => ({ path, text })),
      identity: `${profileId}:${++identity.current}`,
    }),
    [profileId, files, hudId, context?.layer, revision, draftStore],
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
  const typedFindings = findings.filter((finding) =>
    import.meta.env.DEV && findingType === "catalog"
      ? finding.tier === "info"
      : finding.tier !== "info",
  );
  const shownFindings = typedFindings.filter((finding) =>
    scope === "all" ? true : finding.file === selected,
  );
  const currentFindingCount = findings.filter(
    (finding) => finding.file === selected && finding.tier !== "info",
  ).length;
  const filtered = listed.filter(
    (file) => !query || file.path.toLowerCase().includes(query.toLowerCase()),
  );
  const layer = context?.layer ?? "vanilla";
  const destinationOptions = withHelpersDestination(
    cfgDestinations(
      listed.filter((file) => file.editable).map((file) => file.path),
      layer,
    ),
    layer,
  );
  const creation = newCfgPathIn(
    newName,
    newKind === "helper" ? chosenFolder(newFolder, newCustomFolder) : "",
    layer,
  );
  const creationCollision = creation.path
    ? cfgPathCollision(
        creation.path,
        listed.map((file) => file.path),
      )
    : null;
  const saveAsTarget = newCfgPathIn(
    saveAsName,
    chosenFolder(saveAsFolder, saveAsCustomFolder),
    layer,
  );
  const saveAsCollision = saveAsTarget.path
    ? cfgPathCollision(
        saveAsTarget.path,
        listed.map((file) => file.path),
      )
    : null;
  const canOpenSaveAs =
    !!selected && !!context && context.profileId === profileId && !saving && closeReady;
  const canSaveAs = canOpenSaveAs && !running && !busy;
  const canSaveShortcut =
    !!selected &&
    editable &&
    !!state?.dirty &&
    !state.conflict &&
    !saving &&
    !running &&
    (!busy || recovering) &&
    closeReady;
  const basenameCounts = listed.reduce((counts, file) => {
    const name = file.path.split("/").pop()?.toLowerCase() ?? file.path.toLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const groups = (["Your files", "Created by execs", "Read-only"] as const).map((group) => ({
    group,
    files: filtered.filter((file) =>
      group === "Read-only"
        ? !file.editable
        : group === "Created by execs"
          ? file.origin === "app"
          : file.editable && file.origin !== "app",
    ),
  }));
  const visiblePaths = groups.flatMap((group) => group.files.map((file) => file.path));
  const menuFile = fileMenu ? listed.find((file) => file.path === fileMenu.path) : null;
  const menuState = menuFile ? draftStore.state(profileId, menuFile.path) : null;
  const menuOwner = menuFile?.origin === "app" ? owningPane(menuFile.path) : null;
  const menuLinks = fileMenu
    ? links.flatMap((link) => [
        ...(link.file === fileMenu.path
          ? [
              {
                link,
                incoming: false,
                path: link.target,
                line: link.targetLine ?? 1,
              },
            ]
          : []),
        ...(link.target === fileMenu.path
          ? [{ link, incoming: true, path: link.file, line: link.line }]
          : []),
      ])
    : [];
  function pick(path: string, line?: number, from?: number, to?: number) {
    draftStore.select(profileId, path);
    setPicked(path);
    setReviewConflict(false);
    setTarget({ id: ++actionId.current, line, from, to });
  }
  useEffect(() => {
    if (!active || !reviewTarget || reviewedTarget.current === reviewTarget.id) return;
    const file = listed.find(
      (candidate) => candidate.path.toLowerCase() === reviewTarget.path.toLowerCase(),
    );
    if (!file) return;
    reviewedTarget.current = reviewTarget.id;
    draftStore.select(profileId, file.path);
    setPicked(file.path);
    setReviewConflict(false);
    setTarget({ id: ++actionId.current, line: reviewTarget.line });
    setScope("current");
    setFindingType("issues");
    setPanel("problems");
  }, [active, reviewTarget, listed, draftStore, profileId]);
  function openFileMenu(event: ReactMouseEvent<HTMLButtonElement>, path: string) {
    event.preventDefault();
    setFileMenu({ path, x: event.clientX, y: event.clientY });
  }
  function openFileMenuFromButton(event: ReactMouseEvent<HTMLButtonElement>, path: string) {
    const bounds = event.currentTarget.getBoundingClientRect();
    setFileMenu({ path, x: bounds.right, y: bounds.bottom + 4 });
  }
  function openNewCfg() {
    setPanel("new");
  }
  function openSaveAs(path = selected) {
    if (!path) return;
    const source = draftStore.state(profileId, path);
    if (!source) return;
    const base =
      path
        .split("/")
        .pop()
        ?.replace(/\.cfg$/i, "") || "config";
    const folder = cfgFolderWithinLayer(path, layer);
    const known = destinationOptions.some((destination) => destination.id === folder);
    const preferredFolder = known ? folder : "__custom__";
    const preferredCustom = known ? "" : folder;
    let copyBase = `${base}_copy`;
    if (!newCfgPathIn(copyBase, folder, layer).path) {
      copyBase = `copy_${base.replace(/^\.+/, "") || "config"}`;
    }
    let candidate = copyBase;
    let attempt = 1;
    while (
      cfgPathCollision(
        newCfgPathIn(candidate, folder, layer).path ?? "",
        listed.map((file) => file.path),
      )
    ) {
      attempt += 1;
      candidate = `${copyBase}_${attempt}`;
    }
    pick(path);
    setSaveAsName(candidate);
    setSaveAsFolder(preferredFolder);
    setSaveAsCustomFolder(preferredCustom);
    setPanel("saveAs");
    setFileMenu(null);
  }
  function moveFileFocus(event: ReactKeyboardEvent<HTMLButtonElement>, path: string) {
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      setFileMenu({ path, x: bounds.left + 24, y: bounds.top + 24 });
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = visiblePaths.indexOf(path);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? visiblePaths.length - 1
          : event.key === "ArrowDown"
            ? Math.min(current + 1, visiblePaths.length - 1)
            : Math.max(current - 1, 0);
    const nextPath = visiblePaths[next];
    if (!nextPath) return;
    pick(nextPath);
    requestAnimationFrame(() => {
      [...document.querySelectorAll<HTMLButtonElement>("[data-testid=files-item]")]
        .find((button) => button.dataset.path === nextPath)
        ?.focus({ preventScroll: true });
    });
  }
  async function copyPath(path: string) {
    if ((await copyToClipboard(path)) === "failed") setError("Could not copy the file path.");
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
  async function save(all = false, requestedPath = selected) {
    const requestedState = requestedPath ? draftStore.state(profileId, requestedPath) : null;
    const requestedMeta = requestedPath ? cfgFileMeta(requestedPath, hudId) : null;
    const requestedRecovering =
      requestedState?.missingReviewed === true && recoveryAvailable === true;
    if (
      savingRef.current ||
      running ||
      (busy && !requestedRecovering) ||
      !closeReady ||
      (!all && (!requestedMeta?.editable || !requestedState?.dirty || requestedState.conflict)) ||
      (analysis.result && hitAnalysisLimit(analysis.result))
    )
      return;
    const submissions = draftStore
      .dirty()
      .filter((doc) => doc.profile === profileId && (all || doc.path === requestedPath));
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
  async function saveAs() {
    if (
      !canSaveAs ||
      savingRef.current ||
      !selected ||
      !context ||
      !saveAsTarget.path ||
      saveAsCollision
    )
      return;
    const sourcePath = selected;
    const sourceState = draftStore.state(profileId, sourcePath);
    if (!sourceState) return;
    const submittedText = sourceState.text;
    const sourceRevision = sourceState.revision;
    const destinationPath = saveAsTarget.path;
    draftStore.create(
      profileId,
      destinationPath,
      { ...context, sha256: null, librarySha256: null },
      submittedText,
    );
    const submission = draftStore
      .dirty()
      .find((document) => document.profile === profileId && document.path === destinationPath);
    if (!submission) return;
    savingRef.current = true;
    setSaving(true);
    try {
      if (!(await onSave(destinationPath, submittedText, submission))) {
        draftStore.discard(profileId, destinationPath);
        return;
      }
      draftStore.acknowledge(profileId, destinationPath, submittedText);
      const latestSource = draftStore.state(profileId, sourcePath);
      const newerText =
        latestSource && latestSource.revision !== sourceRevision ? latestSource.text : null;
      if (sourceState.dirty) draftStore.discard(profileId, sourcePath);
      if (newerText !== null && newerText !== submittedText) {
        draftStore.edit(profileId, destinationPath, newerText);
      }
      pick(destinationPath);
      setPanel(null);
    } catch (error) {
      draftStore.discard(profileId, destinationPath);
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
      refresh((value) => value + 1);
    }
  }
  function create() {
    if (!context || !creation.path || context.profileId !== profileId || !closeReady) return;
    const existing = creationCollision;
    if (existing) pick(existing);
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
    ? "TF2 running · Save locked"
    : !editable
      ? "Read-only"
      : state?.conflict
        ? "Changed outside execs"
        : analysis.error
          ? "Analysis unavailable"
          : !analysis.result
            ? "Checking…"
            : blocking.length
              ? `${blocking.length} blocking ${blocking.length === 1 ? "issue" : "issues"}`
              : limited
                ? "Files incomplete"
                : !analysis.result.safetyComplete
                  ? "Safety check incomplete"
                  : !analysis.result.executionComplete
                    ? "Execution unresolved"
                    : "No blocking issues";
  return (
    <section data-testid="settings-files" className="flex min-h-0 min-w-0 flex-col gap-3 text-left">
      <header className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <div className="pane-title-row">
          <span aria-hidden="true" className="pane-glyph pane-glyph-sm">
            <FolderOpen size={18} weight="duotone" />
          </span>
          <h1 className="t-pane">Files</h1>
        </div>
        {dirtyDocuments.length > 1 && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={
              running || busy || saving || !analysis.result || hitAnalysisLimit(analysis.result)
            }
            onClick={() => void save(true)}
          >
            Save all {dirtyDocuments.length}
          </button>
        )}
      </header>

      <div className="surface grid min-w-0 overflow-hidden min-[720px]:grid-cols-[200px_minmax(0,1fr)]">
        <aside
          aria-label="Profile files"
          className="min-w-0 border-edge border-b min-[720px]:border-r min-[720px]:border-b-0"
        >
          <div className="flex items-center gap-1.5 border-edge border-b p-2">
            <label className="sr-only" htmlFor="files-search">
              Filter files by path
            </label>
            <div className="relative min-w-0 flex-1">
              <MagnifyingGlass
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-muted"
              />
              <input
                id="files-search"
                type="search"
                className="input w-full py-1.5 pr-2 pl-7"
                placeholder="Filter files"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setQuery("");
                }}
              />
            </div>
            <button
              type="button"
              data-testid="files-new"
              className={`flex shrink-0 items-center gap-1 rounded px-2 py-1.5 text-xs transition-colors duration-150 hover:bg-panel-raised hover:text-ink focus-visible:outline ${
                panel === "new" ? "bg-panel-raised text-ink" : "text-ink-muted"
              }`}
              aria-label="New cfg"
              aria-expanded={panel === "new"}
              title="New cfg (Ctrl+N)"
              onClick={() => setPanel(panel === "new" ? null : "new")}
            >
              <FilePlus size={15} aria-hidden="true" />
              <span>New cfg</span>
            </button>
          </div>

          {panel === "new" ? (
            <section className="p-3" aria-label="New cfg">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="t-row">New cfg</h3>
                <button
                  type="button"
                  className="rounded p-1.5 text-ink-muted hover:bg-panel-raised hover:text-ink focus-visible:outline"
                  aria-label="Close new cfg"
                  onClick={() => setPanel(null)}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <fieldset className="m-0 flex min-w-0 gap-1 border-0 p-0">
                <legend className="sr-only">When this cfg runs</legend>
                {[
                  ["startup", "Startup"],
                  ["class", "Class"],
                  ["helper", "Helper"],
                ].map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    className="btn btn-ghost min-w-0 flex-1 px-1 py-1 text-xs"
                    aria-pressed={newKind === kind}
                    onClick={() => {
                      setNewKind(kind as "startup" | "class" | "helper");
                      setNewName(
                        kind === "startup" ? "autoexec" : kind === "class" ? "scout" : "my_config",
                      );
                    }}
                  >
                    {label}
                  </button>
                ))}
              </fieldset>
              {newKind === "class" && (
                <fieldset className="m-0 mt-3 flex min-w-0 flex-wrap gap-1 border-0 p-0">
                  <legend className="sr-only">TF2 class</legend>
                  {CLASS_CFG_NAMES.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="btn btn-ghost px-2 py-1 capitalize"
                      aria-pressed={normalizedNewName === name}
                      onClick={() => {
                        setNewKind("class");
                        setNewName(name);
                      }}
                    >
                      {name === "heavyweapons" ? "Heavy" : name}
                    </button>
                  ))}
                </fieldset>
              )}
              {newKind === "helper" ? (
                <CfgTargetFields
                  id="new-cfg"
                  name={newName}
                  inputRef={newCfgName}
                  onName={setNewName}
                  folder={newFolder}
                  onFolder={setNewFolder}
                  customFolder={newCustomFolder}
                  onCustomFolder={setNewCustomFolder}
                  destinations={destinationOptions}
                />
              ) : (
                <div className="mt-3">
                  <span className="t-meta">Location</span>
                  <div
                    className="mt-1 truncate rounded-md border border-edge px-2 py-1.5 text-xs"
                    title={cfgLayerRoot(layer)}
                  >
                    {layer === "comfig" ? "Overrides root" : "CFG root"}
                  </div>
                </div>
              )}
              <p
                className={`t-meta mt-3 break-all ${creation.error ? "text-danger" : ""}`}
                title={creation.path ?? undefined}
              >
                {!context
                  ? "Waiting for profile…"
                  : creation.error
                    ? creation.error
                    : creationCollision
                      ? `Already exists: ${creationCollision}`
                      : creation.path}
              </p>
              {!creation.error && !creationCollision && newKind !== "helper" && (
                <p className="t-meta mt-1">
                  {newKind === "startup"
                    ? "Runs when TF2 starts."
                    : `Runs when you play ${normalizedNewName === "heavyweapons" ? "Heavy" : normalizedNewName}.`}
                </p>
              )}
              {!creation.error && !creationCollision && newKind === "helper" && (
                <p className="t-meta mt-1">Runs when another cfg calls it.</p>
              )}
              <button
                type="button"
                className="btn btn-primary mt-3 w-full"
                disabled={!context || !!creation.error || !closeReady}
                onClick={create}
              >
                {creationCollision ? `Open ${creationCollision.split("/").pop()}` : "Start editing"}
              </button>
            </section>
          ) : panel === "saveAs" ? (
            <section className="p-3" aria-label="Save as new cfg">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="t-row">Save as new cfg</h3>
                <button
                  type="button"
                  className="rounded p-1.5 text-ink-muted hover:bg-panel-raised hover:text-ink focus-visible:outline"
                  aria-label="Close Save as"
                  onClick={() => setPanel(null)}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
              <CfgTargetFields
                id="save-as"
                name={saveAsName}
                onName={setSaveAsName}
                folder={saveAsFolder}
                onFolder={setSaveAsFolder}
                customFolder={saveAsCustomFolder}
                onCustomFolder={setSaveAsCustomFolder}
                destinations={destinationOptions}
              />
              <p
                className={`t-meta mt-3 break-all ${saveAsTarget.error || saveAsCollision ? "text-danger" : ""}`}
                title={saveAsTarget.path ?? undefined}
              >
                {!context
                  ? "Waiting for profile…"
                  : saveAsTarget.error
                    ? saveAsTarget.error
                    : saveAsCollision
                      ? `Already exists: ${saveAsCollision}`
                      : saveAsTarget.path}
              </p>
              {running && <p className="t-meta mt-1">Close TF2 to save this copy.</p>}
              {saveAsCollision ? (
                <button
                  type="button"
                  className="btn btn-ghost mt-3 w-full"
                  onClick={() => {
                    pick(saveAsCollision);
                    setPanel(null);
                  }}
                >
                  Open existing
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="files-save-as-confirm"
                  className="btn btn-primary mt-3 w-full"
                  disabled={!canSaveAs || !!saveAsTarget.error}
                  onClick={() => void saveAs()}
                >
                  {saving ? "Saving…" : "Save new cfg"}
                </button>
              )}
            </section>
          ) : (
            <>
              {limited && (
                <p className="t-meta border-edge border-b px-3 py-2">
                  Some files could not be loaded.
                </p>
              )}
              <div data-testid="files-list" className="py-2">
                {groups.map(({ group, files: groupFiles }) => {
                  if (groupFiles.length === 0) return null;
                  return (
                    <div key={group} className="mb-2 last:mb-0">
                      <h3 className="px-3 py-1 text-[11px] font-medium text-ink-muted">{group}</h3>
                      {groupFiles.map((file) => {
                        const dirty = draftStore.state(profileId, file.path)?.dirty;
                        const name = file.path.split("/").pop();
                        return (
                          <button
                            type="button"
                            key={file.path}
                            data-testid="files-item"
                            data-path={file.path}
                            data-origin={file.origin}
                            data-active={selected === file.path}
                            className={`flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 hover:bg-panel-raised ${
                              selected === file.path ? "bg-panel-raised text-ink" : "text-ink-muted"
                            }`}
                            aria-label={`${name}${dirty ? ", unsaved" : ""}${file.editable ? "" : ", read-only"}. ${file.path}`}
                            aria-current={selected === file.path ? "true" : undefined}
                            tabIndex={
                              selected === file.path ||
                              (!visiblePaths.includes(selected ?? "") &&
                                visiblePaths[0] === file.path)
                                ? 0
                                : -1
                            }
                            title={file.path}
                            onClick={() => pick(file.path)}
                            onContextMenu={(event) => openFileMenu(event, file.path)}
                            onKeyDown={(event) => moveFileFocus(event, file.path)}
                          >
                            <FileCode size={15} className="shrink-0" aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate text-sm text-ink">
                              {name}
                              {dirty ? (
                                <>
                                  <span aria-hidden="true"> •</span>
                                  <span className="sr-only"> Unsaved</span>
                                </>
                              ) : null}
                            </span>
                            {(basenameCounts.get(name?.toLowerCase() ?? "") ?? 0) > 1 && (
                              <span className="max-w-16 truncate text-[11px] text-ink-faint">
                                {fileParentLabel(file.path)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <p className="t-meta px-3 py-2">No matching cfg files.</p>
                )}
              </div>
            </>
          )}
        </aside>

        <div className="min-w-0">
          <div className="flex min-h-11 min-w-0 items-center gap-2 border-edge border-b bg-bg px-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
              <FileCode size={15} className="shrink-0 text-ink-muted" aria-hidden="true" />
              <span className="truncate">{selected?.split("/").pop() ?? "No file open"}</span>
              {state?.dirty ? (
                <>
                  <span className="text-ink-muted" aria-hidden="true">
                    •
                  </span>
                  <span className="sr-only">Unsaved</span>
                </>
              ) : null}
              {!editable && selected ? <span className="t-meta shrink-0">Read-only</span> : null}
            </div>
            {selected && (
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  data-testid="files-actions"
                  className="btn btn-ghost px-2"
                  aria-label="File actions"
                  title="File actions"
                  onClick={(event) => openFileMenuFromButton(event, selected)}
                >
                  <DotsThree size={17} weight="bold" aria-hidden="true" />
                </button>
                {editable && (
                  <>
                    {state?.dirty && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        aria-label="Discard file"
                        disabled={saving}
                        onClick={() => {
                          if (selected) draftStore.discard(profileId, selected);
                          refresh((value) => value + 1);
                        }}
                      >
                        Discard
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="files-save"
                      className="btn btn-primary"
                      disabled={!canSave}
                      onClick={() => void save()}
                    >
                      {saving ? "Saving…" : state?.missingReviewed ? "Restore file" : "Save"}
                    </button>
                  </>
                )}
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
              compact={panel === "problems" || panel === "reference"}
              onChange={update}
              onSave={() => void save()}
              onSaveAs={() => openSaveAs()}
              onNewCfg={openNewCfg}
              canSave={canSave}
              canSaveShortcut={canSaveShortcut}
              canSaveAs={canOpenSaveAs}
              onShowProblems={() => {
                setScope("current");
                setPanel("problems");
              }}
              onShowHelp={() => setPanel("reference")}
              files={snapshot.files}
              target={target}
              onCommandChange={setCommand}
              statusStart={
                <div className="flex min-w-0 items-center gap-1">
                  <button
                    type="button"
                    className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors duration-150 hover:bg-panel-raised hover:text-ink focus-visible:outline ${
                      panel === "problems" ? "bg-panel-raised text-ink" : "text-ink-muted"
                    }`}
                    aria-pressed={panel === "problems"}
                    onClick={() => setPanel(panel === "problems" ? null : "problems")}
                  >
                    <WarningCircle size={14} aria-hidden="true" />
                    <span>Problems{currentFindingCount ? ` ${currentFindingCount}` : ""}</span>
                  </button>
                  <button
                    type="button"
                    className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors duration-150 hover:bg-panel-raised hover:text-ink focus-visible:outline ${
                      panel === "reference" ? "bg-panel-raised text-ink" : "text-ink-muted"
                    }`}
                    aria-pressed={panel === "reference"}
                    onClick={() => setPanel(panel === "reference" ? null : "reference")}
                  >
                    <BookOpenText size={14} aria-hidden="true" />
                    <span>Help</span>
                  </button>
                  <span
                    role="status"
                    data-testid="files-lint-badge"
                    className={
                      status === "No blocking issues" ? "sr-only" : "truncate px-1 text-ink-muted"
                    }
                  >
                    {status}
                  </span>
                </div>
              }
            />
          ) : (
            <p className="t-meta min-h-80 p-4">No cfg files in this profile.</p>
          )}

          {analysis.error && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 border-edge border-t px-3 py-2"
            >
              <p className="t-meta">{analysis.error}</p>
              <button type="button" className="btn btn-ghost shrink-0" onClick={analysis.retry}>
                Retry analysis
              </button>
            </div>
          )}

          {state?.conflict && (
            <div role="alert" className="border-edge border-t p-3">
              <p className="t-row">
                {state.missing ? "This source was removed." : "This source changed outside execs."}
              </p>
              <p className="t-meta mt-1">Your draft is still here. Compare before saving.</p>
              <button
                type="button"
                className="btn btn-ghost mt-2"
                onClick={() => setReviewConflict(!reviewConflict)}
              >
                Compare current source
              </button>
              {reviewConflict && (
                <>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <h4 className="t-row">Current source</h4>
                      <pre className="mt-1 whitespace-pre-wrap break-all text-sm">
                        {state.missing ? "Source no longer exists" : state.source}
                      </pre>
                    </div>
                    <div>
                      <h4 className="t-row">Your draft</h4>
                      <pre className="mt-1 whitespace-pre-wrap break-all text-sm">{draft}</pre>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
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
                      {state.missing ? "Review draft for restoration" : "Keep draft"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        if (selected) draftStore.discard(profileId, selected);
                        refresh((value) => value + 1);
                      }}
                    >
                      Use current source
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {(panel === "problems" || panel === "reference") && (
            <section
              aria-label={panel === "problems" ? "Problems" : "Help"}
              className="border-edge border-t bg-panel"
            >
              <header className="flex h-9 items-center justify-between border-edge border-b px-3">
                <h3 className="flex items-center gap-2 t-row">
                  {panel === "problems" ? (
                    <WarningCircle size={15} aria-hidden="true" />
                  ) : (
                    <BookOpenText size={15} aria-hidden="true" />
                  )}
                  {panel === "problems" ? "Problems" : "Help"}
                </h3>
                <button
                  type="button"
                  className="rounded p-1 text-ink-muted hover:bg-panel-raised hover:text-ink focus-visible:outline"
                  aria-label={`Close ${panel === "problems" ? "Problems" : "Help"}`}
                  onClick={() => setPanel(null)}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </header>
              <div className="p-3">
                {panel === "problems" && (
                  <>
                    <Segmented
                      label="Problem scope"
                      size="sm"
                      value={scope}
                      onChange={setScope}
                      options={[
                        {
                          id: "current",
                          label: (
                            <span className="flex items-center gap-1.5">
                              This file
                              <span className="tabular-nums text-ink-muted">
                                {
                                  typedFindings.filter((finding) => finding.file === selected)
                                    .length
                                }
                              </span>
                            </span>
                          ),
                        },
                        {
                          id: "all",
                          label: (
                            <span className="flex items-center gap-1.5">
                              All files
                              <span className="tabular-nums text-ink-muted">
                                {typedFindings.length}
                              </span>
                            </span>
                          ),
                        },
                      ]}
                    />
                    {import.meta.env.DEV && (
                      <>
                        <Segmented
                          label="Finding type"
                          size="sm"
                          value={findingType}
                          onChange={setFindingType}
                          options={[
                            { id: "issues", label: "Issues" },
                            { id: "catalog", label: "Catalog gaps" },
                          ]}
                        />
                        {findingType === "catalog" && (
                          <p className="t-meta mt-2">
                            These commands are absent from the offline reference. That does not mean
                            the cfg is invalid.
                          </p>
                        )}
                      </>
                    )}
                    {!analysis.result ? (
                      <p className="t-meta mt-3">
                        {analysis.error ?? <Loading>Checking…</Loading>}
                      </p>
                    ) : shownFindings.length === 0 ? (
                      <p className="mt-3 rounded-lg border border-edge bg-panel-raised p-3 text-sm">
                        {findingType === "catalog" ? "No catalog gaps here." : "No issues here."}
                      </p>
                    ) : (
                      <ul className="mt-3 grid gap-2">
                        {shownFindings.map((finding) => (
                          <FindingRow
                            key={findingKey(finding)}
                            finding={finding}
                            selected={selected}
                            onOpen={() =>
                              pick(finding.file, finding.line, finding.from, finding.to)
                            }
                          />
                        ))}
                      </ul>
                    )}
                  </>
                )}

                {panel === "reference" && <FilesReference command={command} />}
              </div>
            </section>
          )}
        </div>
      </div>
      {fileMenu && menuFile && (
        <ContextMenu
          label={`${menuFile.path.split("/").pop()} actions`}
          position={fileMenu}
          onClose={() => setFileMenu(null)}
        >
          <ContextMenuItem
            onSelect={() => {
              pick(menuFile.path);
              setFileMenu(null);
            }}
          >
            {menuFile.path === selected ? "Focus editor" : "Open"}
          </ContextMenuItem>
          {menuFile.editable && (
            <ContextMenuItem
              detail="Ctrl+S"
              disabled={
                !menuState?.dirty ||
                menuState.conflict ||
                saving ||
                running ||
                busy ||
                !analysis.result ||
                hitAnalysisLimit(analysis.result) ||
                blockingFindingsForFile(findings, menuFile.path).length > 0
              }
              onSelect={() => {
                void save(false, menuFile.path);
                setFileMenu(null);
              }}
            >
              Save
            </ContextMenuItem>
          )}
          <ContextMenuItem
            detail="Ctrl+Shift+S"
            disabled={!canOpenSaveAs}
            onSelect={() => openSaveAs(menuFile.path)}
          >
            Save as new cfg…
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              pick(menuFile.path);
              setScope("current");
              setPanel("problems");
              setFileMenu(null);
            }}
          >
            Show problems
          </ContextMenuItem>
          {menuLinks.length > 0 && <ContextMenuSeparator />}
          {menuLinks.map(({ link, incoming, path, line }) => (
            <ContextMenuItem
              key={`${incoming}:${link.file}:${link.line}:${link.kind}:${link.target}:${link.targetLine}:${link.deferred}`}
              data-testid="files-source-link"
              data-direction={incoming ? "incoming" : "outgoing"}
              data-deferred={link.deferred}
              disabled={!path}
              detail={link.deferred ? "Deferred" : undefined}
              title={path ? `${path}:${line}` : "Unresolved"}
              onSelect={() => {
                if (path) pick(path, line);
                setFileMenu(null);
              }}
            >
              {incoming ? "Referenced by" : link.label}: {path ? `${path}:${line}` : "Unresolved"}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => {
              void copyPath(menuFile.path);
              setFileMenu(null);
            }}
          >
            Copy path
          </ContextMenuItem>
          {menuOwner && onNavigate && (
            <ContextMenuItem
              onSelect={() => {
                onNavigate(menuOwner.tab);
                setFileMenu(null);
              }}
            >
              {menuOwner.label}
            </ContextMenuItem>
          )}
          {menuState?.dirty && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                disabled={saving}
                onSelect={() => {
                  draftStore.discard(profileId, menuFile.path);
                  refresh((value) => value + 1);
                  setFileMenu(null);
                }}
              >
                Discard changes
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => {
              openNewCfg();
              setFileMenu(null);
            }}
            detail="Ctrl+N"
          >
            New cfg…
          </ContextMenuItem>
        </ContextMenu>
      )}
    </section>
  );
}

function CfgTargetFields({
  id,
  name,
  inputRef,
  onName,
  folder,
  onFolder,
  customFolder,
  onCustomFolder,
  destinations,
}: {
  id: string;
  name: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onName: (value: string) => void;
  folder: string;
  onFolder: (value: string) => void;
  customFolder: string;
  onCustomFolder: (value: string) => void;
  destinations: readonly CfgDestination[];
}) {
  const choices = destinations.slice(0, 6);
  return (
    <div className="mt-3 grid gap-3">
      <label className="block t-meta" htmlFor={`${id}-name`}>
        File name
        <input
          ref={inputRef}
          id={`${id}-name`}
          className="input mt-1 w-full"
          value={name}
          onChange={(event) => onName(event.target.value)}
        />
      </label>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="t-meta">Location</legend>
        <div className="mt-1 flex flex-wrap gap-1">
          {choices.map((destination) => (
            <button
              key={destination.id}
              type="button"
              className={`rounded-md border px-2 py-1 text-xs transition-colors duration-150 focus-visible:outline ${
                folder === destination.id
                  ? "border-brand bg-brand/6 text-ink"
                  : "border-edge text-ink-muted hover:border-edge-strong hover:text-ink"
              }`}
              aria-pressed={folder === destination.id}
              title={destination.path}
              onClick={() => onFolder(destination.id)}
            >
              {destination.id ? destination.label : "Root"}
            </button>
          ))}
          <button
            type="button"
            className={`rounded-md border px-2 py-1 text-xs transition-colors duration-150 focus-visible:outline ${
              folder === "__custom__"
                ? "border-brand bg-brand/6 text-ink"
                : "border-edge text-ink-muted hover:border-edge-strong hover:text-ink"
            }`}
            aria-pressed={folder === "__custom__"}
            onClick={() => onFolder("__custom__")}
          >
            Custom
          </button>
        </div>
        {folder === "__custom__" && (
          <label className="mt-2 block t-meta" htmlFor={`${id}-folder`}>
            Folder
            <input
              id={`${id}-folder`}
              className="input mt-1 w-full"
              placeholder="practice/server"
              value={customFolder}
              onChange={(event) => onCustomFolder(event.target.value)}
            />
          </label>
        )}
      </fieldset>
    </div>
  );
}

function chosenFolder(folder: string, customFolder: string) {
  return folder === "__custom__" ? customFolder : folder;
}

function withHelpersDestination(destinations: CfgDestination[], layer: "vanilla" | "comfig") {
  if (destinations.some((destination) => destination.id.toLowerCase() === "helpers")) {
    return destinations;
  }
  return [
    destinations[0],
    {
      id: "helpers",
      label: "helpers",
      path: `${cfgLayerRoot(layer)}/helpers`,
    },
    ...destinations.slice(1),
  ].filter((destination): destination is CfgDestination => !!destination);
}

function cfgFolderWithinLayer(path: string, layer: "vanilla" | "comfig") {
  const normalized = path.replaceAll("\\", "/");
  const root = cfgLayerRoot(layer);
  const prefix = `${root}/`;
  if (!normalized.toLowerCase().startsWith(prefix.toLowerCase())) return "";
  const relative = normalized.slice(prefix.length);
  return relative.split("/").slice(0, -1).join("/");
}

function fileParentLabel(path: string) {
  const normalized = path.replaceAll("\\", "/");
  const parent = normalized.split("/").slice(0, -1).join("/");
  if (parent.toLowerCase() === "tf/cfg") return "CFG";
  if (parent.toLowerCase() === "tf/cfg/overrides") return "Overrides";
  const relative = parent.replace(/^tf\/cfg\/overrides\//i, "").replace(/^tf\/cfg\//i, "");
  return relative || parent.split("/").slice(-2).join("/");
}

function owningPane(path: string): { tab: SettingsTab; label: string } {
  if (path.includes("execs_binds")) return { tab: "binds", label: "Open Binds" };
  if (path.includes("execs_gameplay")) return { tab: "gameplay", label: "Open Gameplay" };
  if (path.includes("execs_preload")) return { tab: "mods", label: "Open Mods" };
  return { tab: "comfig", label: "Open Comfig" };
}

function FindingRow({
  finding,
  selected,
  onOpen,
}: {
  finding: CfgFinding;
  selected: string | null;
  onOpen: () => void;
}) {
  const location =
    finding.file === selected
      ? `Line ${finding.line}, column ${finding.col}`
      : `${finding.file.split("/").pop()}:${finding.line}:${finding.col}`;
  return (
    <li
      data-testid="files-finding"
      data-tier={finding.tier}
      data-advisory={finding.advisory}
      className="rounded-lg border border-edge bg-panel-raised p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <WarningCircle size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
        <button
          type="button"
          className="text-left text-sm font-medium hover:underline hover:underline-offset-4"
          onClick={onOpen}
        >
          {location}
        </button>
        <span className={`badge ${findingTierClass(finding.tier)}`}>
          {finding.advisory
            ? "Advisory"
            : finding.tier === "block"
              ? "Save restriction"
              : finding.tier === "info"
                ? "Catalog gap"
                : "Warning"}
        </span>
      </div>
      <p className="mt-2 text-sm leading-5">{findingMessage(finding.message)}</p>
      {finding.via && <p className="t-meta mt-1">Via {finding.via}</p>}
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
