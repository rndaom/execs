import { lookupCommand } from "@execs/cfglint";
import { useEffect, useId, useState } from "react";
import { REFERENCE_REVIEWED, searchCfgCommands } from "../lib/files-reference";

type FilesReferenceProps = {
  command: string | null;
};

function argumentDetail(argument: {
  name: string;
  type?: string;
  optional?: boolean;
  rest?: boolean;
  values?: readonly string[];
  min?: number;
  max?: number;
}) {
  return [
    argument.type,
    argument.optional ? "optional" : null,
    argument.rest ? "accepts more than one value" : null,
    argument.values ? `choices: ${argument.values.join(", ")}` : null,
    argument.min === undefined ? null : `minimum ${argument.min}`,
    argument.max === undefined ? null : `maximum ${argument.max}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function FilesReference({ command }: FilesReferenceProps) {
  const [commandQuery, setCommandQuery] = useState("");
  const [chosenCommand, setChosenCommand] = useState<{
    name: string;
    cursor: string | null;
  } | null>(null);
  const commandQueryId = useId();
  useEffect(() => {
    setChosenCommand((chosen) => (chosen?.cursor === command ? chosen : null));
  }, [command]);
  const name = chosenCommand?.name ?? command;
  const entry = name ? lookupCommand(name) : undefined;
  const commands = searchCfgCommands(commandQuery);

  return (
    <section aria-label="Offline cfg reference" className="grid gap-3">
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
                  setCommandQuery("");
                }}
              >
                <code>{match.name}</code>
                {match.help && <span className="ml-2 text-ink-muted">{match.help}</span>}
              </button>
            ))
          ) : (
            <p className="p-2 text-sm text-ink-muted">No match in the offline reference.</p>
          )}
        </div>
      )}
      {!name ? (
        <p className="rounded-lg border border-edge bg-panel-raised p-3 text-sm">
          Place the cursor on a command or search above to see its details.
        </p>
      ) : !entry ? (
        <p className="rounded-lg border border-edge bg-panel-raised p-3 text-sm">
          No offline details are available for <code>{name}</code>. It may be a custom alias or a
          command from a plugin or a newer game build.
        </p>
      ) : (
        <article
          aria-label="Command details"
          className="rounded-lg border border-edge bg-panel-raised p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="min-w-0 break-all font-semibold text-ink">
              <code>{entry.name}</code>
            </h4>
            <span className="rounded bg-bg px-2 py-0.5 text-xs text-ink-muted">
              {entry.kind === "cvar" ? "Setting" : entry.kind === "alias" ? "Alias" : "Command"}
            </span>
          </div>
          <p className="mt-2 text-sm leading-5 text-ink-muted">
            {entry.help || "No description is documented in this reference."}
          </p>
          <dl className="mt-4 grid gap-3 border-edge border-t pt-4 text-sm min-[980px]:grid-cols-2">
            <div className="min-[980px]:col-span-2">
              <dt className="t-meta">Syntax</dt>
              <dd className="mt-1 break-words">
                {entry.syntax ? <code>{entry.syntax}</code> : "Not documented"}
              </dd>
            </div>
            <div className="min-[980px]:col-span-2">
              <dt className="t-meta">Parameters</dt>
              <dd className="mt-1">
                {entry.arguments?.length ? (
                  <ul className="grid gap-1">
                    {entry.arguments.map((argument) => (
                      <li key={argument.name}>
                        <code>{argument.name}</code>
                        {argumentDetail(argument) && (
                          <span className="text-ink-muted"> — {argumentDetail(argument)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  "Not documented"
                )}
              </dd>
            </div>
            {entry.value && (
              <div>
                <dt className="t-meta">Value</dt>
                <dd className="mt-1">{argumentDetail(entry.value) || "Value"}</dd>
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
            <div className="min-[980px]:col-span-2">
              <dt className="t-meta">Availability and restrictions</dt>
              <dd className="mt-1">
                {entry.applicability}
                {entry.flags.length > 0 && (
                  <p className="mt-1 text-ink-muted">Flags: {entry.flags.join(", ")}</p>
                )}
              </dd>
            </div>
            <div className="min-[980px]:col-span-2">
              <dt className="t-meta">Reference sources</dt>
              <dd className="mt-1 grid gap-1">
                {entry.sources.map((source) => (
                  <p
                    key={`${source.url}-${source.revision}`}
                    className="break-words text-ink-muted"
                  >
                    {source.description} · {source.revision} · {source.date}
                  </p>
                ))}
              </dd>
            </div>
          </dl>
        </article>
      )}
      <p className="t-meta">
        Offline reference reviewed {REFERENCE_REVIEWED}. Your game may differ.
      </p>
    </section>
  );
}
