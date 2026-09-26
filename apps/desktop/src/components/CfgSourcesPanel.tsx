import { CFG_ORIGIN_LABELS, type CfgProvenance } from "../lib/cfg-provenance";
import { Disclosure } from "./ui/Disclosure";

function SourceLink({
  path,
  line,
  onOpen,
}: {
  path: string;
  line: number;
  onOpen?: (path: string, line: number) => void;
}) {
  const label = `${path}:${line}`;
  if (!onOpen) return <span className="break-all">{label}</span>;
  return (
    <button
      type="button"
      className="break-all text-left underline underline-offset-2"
      aria-label={`Open ${label} in Files`}
      onClick={() => onOpen(path, line)}
    >
      {label}
    </button>
  );
}

type PanelProps = {
  provenance: CfgProvenance;
  onOpen?: (path: string, line: number) => void;
};

/** Later startup lines that make a pane's saved value unreachable in game. */
export function CfgOverridesAlert({ provenance, onOpen }: PanelProps) {
  const { overrides } = provenance;
  if (overrides.length === 0) return null;
  return (
    <div
      role="alert"
      data-testid="cfg-overrides"
      className="mb-5 rounded-lg border border-warn/50 bg-warn/10 px-4 py-3 text-ink"
    >
      <p>
        {overrides.length === 1 ? "A later startup line sets" : "Later startup lines set"} this
        again after execs saves it, so a change here does not reach the game until that line
        changes.
      </p>
      <ul className="t-meta mt-2 space-y-1">
        {overrides.map((override) => (
          <li key={override.cvar}>
            {override.cvar} —{" "}
            <SourceLink path={override.path} line={override.line} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Read-only evidence for the values a settings pane shows; editing stays in Files. */
export function CfgSourcesDetails({
  profileId,
  tab,
  provenance,
  onOpen,
}: PanelProps & { profileId: string | null; tab: string }) {
  const { sources, unset } = provenance;
  if (sources.length === 0) return null;
  return (
    <Disclosure
      profileId={profileId}
      storageKey={`cfg-sources-${tab}`}
      testId="cfg-sources"
      className="mt-8"
      summary={<span className="t-row">Where these values come from</span>}
    >
      <ul className="t-meta mt-2 space-y-2">
        {sources.map((source) => (
          <li key={source.cvar} data-testid={`cfg-source-${source.cvar}`}>
            <span className="text-ink">{source.cvar}</span> {source.value} ·{" "}
            {CFG_ORIGIN_LABELS[source.origin]} ·{" "}
            <SourceLink path={source.path} line={source.line} onOpen={onOpen} />
            {source.classes.length > 0 ? (
              <span className="block">
                Set again for{" "}
                {source.classes.map((entry, index) => (
                  <span key={entry.path}>
                    {index > 0 ? ", " : ""}
                    {onOpen ? (
                      <button
                        type="button"
                        className="underline underline-offset-2"
                        aria-label={`Open ${entry.path}:${entry.line} in Files`}
                        onClick={() => onOpen(entry.path, entry.line)}
                      >
                        {entry.name}
                      </button>
                    ) : (
                      entry.name
                    )}
                  </span>
                ))}{" "}
                when you play that class.
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {unset.length > 0 ? (
        <p className="t-meta mt-2">Not set by a startup cfg: {unset.join(", ")}.</p>
      ) : null}
    </Disclosure>
  );
}
