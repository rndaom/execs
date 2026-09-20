import { lookupCommand } from "@execs/cfglint";
import { useId, useState } from "react";
import { CFG_SNIPPETS, REFERENCE_REVIEWED, searchCfgGuides } from "../lib/files-reference";

type FilesReferenceProps = {
  command: string | null;
  selectedPath: string | null;
  editable: boolean;
  /** Parent previews the actual destination and inserts through editor undo history. */
  onInsert: (text: string) => void;
};

export function FilesReference({ command, selectedPath, editable, onInsert }: FilesReferenceProps) {
  const [query, setQuery] = useState("");
  const queryId = useId();
  const entry = command ? lookupCommand(command) : undefined;
  const guides = searchCfgGuides(query);
  return (
    <section aria-label="Offline cfg reference" className="space-y-4">
      <div>
        <h3 className="t-section">Command reference</h3>
        {!command ? (
          <p className="t-meta">Place the cursor on a command to inspect its bundled reference.</p>
        ) : !entry ? (
          <p className="t-meta">
            No bundled entry for this command. It may be a local alias or newer command.
          </p>
        ) : (
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="t-meta">Command</dt>
              <dd>
                <code>{entry.name}</code> · {entry.kind}
              </dd>
            </div>
            <div>
              <dt className="t-meta">Purpose</dt>
              <dd>{entry.help || "Not documented in this snapshot."}</dd>
            </div>
            <div>
              <dt className="t-meta">Syntax</dt>
              <dd>
                <code>{entry.syntax || "No verified syntax in this snapshot."}</code>
              </dd>
            </div>
            <div>
              <dt className="t-meta">Parameters</dt>
              <dd>
                {entry.arguments?.length
                  ? entry.arguments
                      .map(
                        (argument) =>
                          `${argument.name}${argument.optional ? " (optional)" : ""}${argument.type ? `: ${argument.type}` : ""}${argument.values ? ` — ${argument.values.join(", ")}` : ""}${argument.min === undefined ? "" : `; minimum ${argument.min}`}${argument.max === undefined ? "" : `; maximum ${argument.max}`}`,
                      )
                      .join("; ")
                  : "No verified parameter details in this snapshot."}
              </dd>
            </div>
            {entry.value && (
              <div>
                <dt className="t-meta">Verified value constraints</dt>
                <dd>
                  {entry.value.type ?? "Value"}
                  {entry.value.min === undefined ? "" : `; minimum ${entry.value.min}`}
                  {entry.value.max === undefined ? "" : `; maximum ${entry.value.max}`}
                  {entry.value.values ? `; one of ${entry.value.values.join(", ")}` : ""}
                </dd>
              </div>
            )}
            <div>
              <dt className="t-meta">Documented default</dt>
              <dd>
                {entry.defaultValue === undefined ? (
                  "Not documented / not applicable"
                ) : (
                  <code>{entry.defaultValue || '""'}</code>
                )}
                . This is not your draft or current runtime value.
              </dd>
            </div>
            <div>
              <dt className="t-meta">Restrictions</dt>
              <dd>
                {entry.flags.length
                  ? `Source flags: ${entry.flags.join(", ")}. `
                  : "No flags recorded. "}
                {entry.applicability} Server permissions and your installed build still apply.
              </dd>
            </div>
            <div>
              <dt className="t-meta">Source snapshot</dt>
              <dd>
                {entry.sources.map((source) => (
                  <p key={`${source.url}-${source.revision}`} className="break-words">
                    {source.description} · reviewed {source.date} · revision {source.revision}
                  </p>
                ))}
              </dd>
            </div>
          </dl>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="t-section">Quick guides</h3>
        <label htmlFor={queryId} className="t-meta">
          Search offline guides
        </label>
        <input
          id={queryId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full"
          placeholder="Try autoexec, class or alias"
        />
        <p className="t-meta" role="status">
          {guides.length} guides
        </p>
        {guides.map((guide) => (
          <details key={guide.id}>
            <summary className="cursor-pointer py-2 text-sm">{guide.title}</summary>
            <p className="pb-3 text-sm">{guide.text}</p>
          </details>
        ))}
      </div>
      <div className="space-y-2">
        <h3 className="t-section">Draft snippets</h3>
        <p className="t-meta">
          Preview the text and effect before adding it. Insertion changes only the unsaved draft and
          can be undone.
        </p>
        {CFG_SNIPPETS.map((snippet) => (
          <details key={snippet.id}>
            <summary className="cursor-pointer py-2 text-sm">{snippet.title}</summary>
            <p className="text-sm">{snippet.effect}</p>
            <p className="t-meta break-words">
              Destination: {selectedPath ?? "Select an editable cfg first"}
            </p>
            <pre className="whitespace-pre-wrap break-words py-3 text-sm">{snippet.text}</pre>
            <button
              type="button"
              className="btn-ghost"
              disabled={!editable || !selectedPath}
              onClick={() => onInsert(snippet.text)}
            >
              Review insertion
            </button>
          </details>
        ))}
      </div>
      <p className="t-meta">
        Bundled offline prose reviewed {REFERENCE_REVIEWED}. Command snapshots may be older than
        your installed TF2. Guides: mastercomfig Custom Configs and Valve Source SDK 2013. No
        runtime values are read.
      </p>
    </section>
  );
}
