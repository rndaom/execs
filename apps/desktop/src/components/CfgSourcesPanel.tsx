import type { CfgProvenance } from "../lib/cfg-provenance";

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
