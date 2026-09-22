import { lookupCommand } from "@execs/cfglint";
import { CaretRight } from "@phosphor-icons/react";
import { useEffect, useId, useState } from "react";
import {
  CFG_SNIPPETS,
  REFERENCE_REVIEWED,
  searchCfgCommands,
  searchCfgGuides,
} from "../lib/files-reference";

type FilesReferenceProps = {
  command: string | null;
  selectedPath: string | null;
  editable: boolean;
  /** Parent previews the actual destination and inserts through editor undo history. */
  onInsert: (text: string) => void;
};

type HelpSection = "details" | "guides" | "snippets";

export function FilesReference({ command, selectedPath, editable, onInsert }: FilesReferenceProps) {
  const [query, setQuery] = useState("");
  const [commandQuery, setCommandQuery] = useState("");
  const [chosenCommand, setChosenCommand] = useState<{
    name: string;
    cursor: string | null;
  } | null>(null);
  const [section, setSection] = useState<HelpSection | null>(null);
  const queryId = useId();
  const commandQueryId = useId();
  useEffect(() => {
    setChosenCommand((chosen) => (chosen?.cursor === command ? chosen : null));
  }, [command]);
  const entry =
    chosenCommand || command ? lookupCommand(chosenCommand?.name ?? command ?? "") : undefined;
  const commands = searchCfgCommands(commandQuery);
  const guides = searchCfgGuides(query);
  const toggle = (next: HelpSection) => setSection((current) => (current === next ? null : next));

  return (
    <section aria-label="Offline cfg reference" className="grid gap-2">
      <label htmlFor={commandQueryId} className="sr-only">
        Search commands
      </label>
      <input
        id={commandQueryId}
        type="search"
        value={commandQuery}
        onChange={(event) => setCommandQuery(event.target.value)}
        className="input w-full"
        placeholder="Search commands"
      />
      {commandQuery.trim() && (
        <div className="max-h-40 overflow-y-auto rounded-lg border border-edge bg-panel-raised p-1">
          {commands.length ? (
            commands.map((match) => (
              <button
                key={match.name}
                type="button"
                className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-bg"
                onClick={() => {
                  setChosenCommand({ name: match.name, cursor: command });
                  setSection("details");
                  setCommandQuery("");
                }}
              >
                <code>{match.name}</code>
                {match.help && <span className="ml-2 text-ink-muted">{match.help}</span>}
              </button>
            ))
          ) : (
            <p className="p-2 text-sm text-ink-muted">No match in the offline catalog.</p>
          )}
        </div>
      )}
      {!chosenCommand && !command ? (
        <p className="rounded-lg border border-edge bg-panel-raised p-3 text-sm">
          Place the cursor on a command to see help.
        </p>
      ) : !entry ? (
        <p className="rounded-lg border border-edge bg-panel-raised p-3 text-sm">
          No offline help is available for this command.
        </p>
      ) : (
        <article className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge bg-panel-raised px-3 py-2.5">
          <div className="flex min-w-0 items-baseline gap-3">
            <code className="shrink-0 text-sm font-semibold text-ink">{entry.name}</code>
            <span className="truncate text-sm">
              {entry.help || "No description in this snapshot."}
            </span>
          </div>
          <code className="shrink-0 rounded-md bg-bg px-3 py-1.5 text-xs text-ink-muted">
            {entry.syntax || "Syntax not documented"}
          </code>
        </article>
      )}

      <div className="grid grid-cols-3 gap-1 rounded-lg border border-edge bg-panel-raised p-1">
        {(
          [
            ["details", "Details", !entry],
            ["guides", "Guides", false],
            ["snippets", "Snippets", false],
          ] as const
        ).map(([id, label, disabled]) => (
          <button
            key={id}
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline ${
              section === id ? "bg-bg text-ink" : "text-ink-muted hover:bg-bg/60 hover:text-ink"
            }`}
            aria-pressed={section === id}
            disabled={disabled}
            onClick={() => toggle(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {section === "details" && entry && (
        <section
          aria-label="Command details"
          className="rounded-lg border border-edge bg-panel-raised p-3"
        >
          <dl className="grid gap-3 text-sm min-[980px]:grid-cols-2">
            <div>
              <dt className="t-meta">Parameters</dt>
              <dd className="mt-1">
                {entry.arguments?.length
                  ? entry.arguments
                      .map(
                        (argument) =>
                          `${argument.name}${argument.optional ? " (optional)" : ""}${argument.type ? `: ${argument.type}` : ""}${argument.values ? ` — ${argument.values.join(", ")}` : ""}${argument.min === undefined ? "" : `; minimum ${argument.min}`}${argument.max === undefined ? "" : `; maximum ${argument.max}`}`,
                      )
                      .join("; ")
                  : "Not documented."}
              </dd>
            </div>
            {entry.value && (
              <div>
                <dt className="t-meta">Value</dt>
                <dd className="mt-1">
                  {entry.value.type ?? "Value"}
                  {entry.value.min === undefined ? "" : `; minimum ${entry.value.min}`}
                  {entry.value.max === undefined ? "" : `; maximum ${entry.value.max}`}
                  {entry.value.values ? `; one of ${entry.value.values.join(", ")}` : ""}
                </dd>
              </div>
            )}
            <div>
              <dt className="t-meta">Default</dt>
              <dd className="mt-1">
                {entry.defaultValue === undefined ? (
                  "Not documented"
                ) : (
                  <code>{entry.defaultValue || '""'}</code>
                )}
              </dd>
            </div>
            <div>
              <dt className="t-meta">Restrictions</dt>
              <dd className="mt-1">
                {entry.flags.length ? `Flags: ${entry.flags.join(", ")}. ` : ""}
                {entry.applicability}
              </dd>
            </div>
            <div className="min-[980px]:col-span-2">
              <dt className="t-meta">Sources</dt>
              <dd className="mt-1">
                {entry.sources.map((source) => (
                  <p key={`${source.url}-${source.revision}`} className="break-words">
                    {source.description} · {source.date} · {source.revision}
                  </p>
                ))}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {section === "guides" && (
        <section
          aria-label="Guides"
          className="rounded-lg border border-edge bg-panel-raised px-3 py-2"
        >
          <label htmlFor={queryId} className="sr-only">
            Search offline guides
          </label>
          <input
            id={queryId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="input w-full"
            placeholder="Search guides"
          />
          <p className="sr-only" role="status">
            {guides.length} {guides.length === 1 ? "guide" : "guides"}
          </p>
          <div className="mt-2">
            {guides.map((guide) => (
              <details key={guide.id} className="group border-edge border-t first:border-t-0">
                <summary className="flex cursor-pointer list-none items-center gap-2 py-2 text-sm">
                  <CaretRight
                    size={13}
                    className="shrink-0 transition-transform duration-150 group-open:rotate-90"
                    aria-hidden="true"
                  />
                  {guide.title}
                </summary>
                <p className="pb-2 pl-5 text-sm leading-5 text-ink-muted">{guide.text}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {section === "snippets" && (
        <section
          aria-label="Snippets"
          className="rounded-lg border border-edge bg-panel-raised px-3 py-2"
        >
          {CFG_SNIPPETS.map((snippet) => (
            <details key={snippet.id} className="group border-edge border-t first:border-t-0">
              <summary className="flex cursor-pointer list-none items-center gap-2 py-2 text-sm">
                <CaretRight
                  size={13}
                  className="shrink-0 transition-transform duration-150 group-open:rotate-90"
                  aria-hidden="true"
                />
                {snippet.title}
              </summary>
              <div className="pb-2 pl-5">
                <p className="text-sm text-ink-muted">{snippet.effect}</p>
                <pre className="my-2 whitespace-pre-wrap break-words rounded-md bg-bg p-2 text-sm">
                  {snippet.text}
                </pre>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!editable || !selectedPath}
                  onClick={() => onInsert(snippet.text)}
                >
                  Review insertion
                </button>
              </div>
            </details>
          ))}
        </section>
      )}

      <p className="sr-only">Offline reference reviewed {REFERENCE_REVIEWED}</p>
    </section>
  );
}
