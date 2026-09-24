import type { Api } from "./api";
import { bindsFilePath, configBindsFromFiles, syncTrackedBindsFromConfig } from "./binds-ui";
import type { FilesContext, FilesSource, ProfileDetail } from "./bridge";
import { addEditorTextToBudget, editorCfgCandidates } from "./files-limits";

export type CfgText = { path: string; text: string; source?: FilesSource };

type SettingsLoadSnapshot = {
  detail: ProfileDetail | null;
  context: FilesContext | null;
  files: CfgText[];
  inspectedFiles: CfgText[];
  missing: string[];
  incomplete: boolean;
  incompleteReason: string | null;
  comfigState: Awaited<ReturnType<Api["getComfigState"]>>;
  launchOptions: string;
};

/** Read and verify one profile snapshot before the host publishes any pane seeds. */
export async function readSettingsSnapshot(
  api: Api,
  { isStale, syncBinds }: { isStale: () => boolean; syncBinds: boolean },
): Promise<SettingsLoadSnapshot | undefined> {
  const detail = await api.getActiveProfileDetail();
  if (isStale()) return;
  const context = detail ? await api.getFilesContext() : null;
  if (isStale()) return;
  if (context && context.profileId !== detail?.id)
    throw new Error("The profile changed while loading Files.");

  const candidates = editorCfgCandidates(detail?.files ?? []);
  const inspectedFiles: CfgText[] = [];
  let totalBytes = 0;
  const missing: string[] = [];
  let wasLimited = candidates.limited;
  for (const file of candidates.files) {
    try {
      const content = await api.readProfileFile(file.path);
      if (isStale()) return;
      if (
        content.source &&
        context &&
        (content.source.profileId !== context.profileId ||
          content.source.root !== context.root ||
          content.source.layer !== context.layer)
      )
        throw new Error("The Files source identity changed during loading.");
      if (content.text === null) {
        if (content.source?.sha256 === null && content.source.librarySha256 !== null) {
          inspectedFiles.push({ path: content.path, text: "", source: content.source });
        }
        missing.push(file.path);
        continue;
      }
      const nextTotal = addEditorTextToBudget(totalBytes, content.text);
      if (nextTotal === null) {
        wasLimited = true;
        break;
      }
      totalBytes = nextTotal;
      inspectedFiles.push({ path: content.path, text: content.text, source: content.source });
    } catch {
      if (isStale()) return;
      missing.push(file.path);
    }
  }

  const incomplete = wasLimited || missing.length > 0;
  const incompleteReason = !incomplete
    ? null
    : missing.length > 0
      ? `Could not read settings: ${missing.join(", ")}. Retry before saving CFG settings.`
      : "Some cfg files exceed the editor limits. CFG settings cannot be saved from an incomplete load.";
  const comfigState = await api.getComfigState();
  if (isStale()) return;
  const launchOptions = detail?.launchOptions ?? (await api.getProfileLaunchOptions());
  if (isStale()) return;
  const verified = await api.getActiveProfileDetail();
  if (isStale()) return;
  if (verified?.id !== detail?.id)
    throw new Error("The active profile changed. Retry loading settings.");

  let files = inspectedFiles;
  if (syncBinds && !incomplete) {
    const bindsPath = bindsFilePath(detail?.layer ?? "comfig");
    const managed = files.find((file) => file.path === bindsPath)?.text ?? "";
    const synced = syncTrackedBindsFromConfig(managed, configBindsFromFiles(files));
    if (synced !== managed) {
      const expected = files.find((file) => file.path === bindsPath)?.source;
      if (!expected)
        throw new Error("The Binds source identity is unavailable. Retry loading settings.");
      await api.writeOwnedFile(bindsPath, synced, expected);
      if (isStale()) return;
      const refreshed = await api.readProfileFile(bindsPath);
      if (isStale()) return;
      files = files.map((file) =>
        file.path === bindsPath
          ? { path: bindsPath, text: refreshed.text ?? synced, source: refreshed.source }
          : file,
      );
    }
  }

  return {
    detail,
    context,
    files,
    inspectedFiles,
    missing,
    incomplete,
    incompleteReason,
    comfigState,
    launchOptions,
  };
}
