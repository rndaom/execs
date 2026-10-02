import type { ModRecord, PreloaderStatusPayload } from "../lib/bridge";
import { packCasualNote } from "../lib/mod-audit-ui";
import { Alert } from "./ui/Alert";
import { PaneSection } from "./ui/PaneSection";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * What the installed packs' files mean in game, on the page: shared files and
 * mixed models under Custom packs, and each pack's Casual note under Casual
 * setup.
 */
export function ModContentAudit({
  payload,
  mods,
  casual = false,
}: {
  payload: PreloaderStatusPayload | null;
  mods: ModRecord[];
  casual?: boolean;
}) {
  const audit = payload?.contentAudit;
  if (!audit) return <p className="t-meta mt-4">The installed files could not be checked.</p>;
  if (casual && audit.packs.length === 0) return null;
  const scriptPacks = audit.packs.filter((pack) => pack.soundScripts.length > 0);
  const findings = audit.overlaps.length + audit.splitModels.length + scriptPacks.length;
  return (
    <PaneSection
      id={casual ? "mods-casual-packs" : "mods-file-check"}
      title={casual ? "Your packs on Casual" : "File check"}
      meta={
        casual || findings === 0 ? undefined : (
          <span className="tnum">
            {plural(audit.overlaps.length, "shared file", "shared files")} ·{" "}
            {plural(audit.splitModels.length, "mixed model", "mixed models")}
          </span>
        )
      }
    >
      <div className="mt-3" data-testid="mod-content-audit">
        {audit.incomplete.length > 0 ? (
          <Alert tone="warn" className="mb-3">
            <p>
              Some files could not be checked, so there may be more shared files or Casual limits
              than shown here.
            </p>
            <ul className="mt-2 list-disc pl-5">
              {[...new Set(audit.incomplete)].map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {casual ? (
          <ul className="list-none p-0">
            {audit.packs.map((pack) => {
              const mod = mods.find((item) => item.pack === pack.pack);
              return (
                <li key={pack.pack} className="border-b border-edge py-2.5 last:border-b-0">
                  <p className="t-row break-words">{mod?.name ?? pack.pack}</p>
                  <p className="t-meta">{packCasualNote(pack, mod, payload)}</p>
                </li>
              );
            })}
          </ul>
        ) : findings === 0 ? (
          <p className="t-meta">
            {audit.incomplete.length
              ? "No shared files among the files that could be checked."
              : "No two packs share a file."}
          </p>
        ) : (
          <div className="space-y-4">
            {audit.overlaps.length > 0 ? (
              <div>
                <p className="t-meta">
                  When packs share a file, TF2 uses the one first alphabetically.
                </p>
                <ul className="mt-2 list-none space-y-3 p-0">
                  {audit.overlaps.map((overlap) => (
                    <li key={overlap.path}>
                      <p className="t-row break-all">{overlap.path}</p>
                      <p className="t-meta break-words">
                        {overlap.winner
                          ? `TF2 uses ${overlap.winner}. Not used: ${overlap.packs.filter((pack) => pack !== overlap.winner).join(", ")}.`
                          : `Can't tell which one TF2 uses: ${overlap.packs.join(", ")}.`}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {audit.splitModels.map((model) => (
              <div key={model.model}>
                <p className="t-row break-all">Model parts from different packs: {model.model}</p>
                <p className="t-meta">These parts may not fit together.</p>
                <ul className="mt-1 space-y-1">
                  {model.components.map((component) => (
                    <li className="t-meta break-all" key={component.path}>
                      {component.path}:{" "}
                      {component.winner ?? `unclear (${component.packs.join(", ")})`}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {scriptPacks.map((pack) => (
              <div key={pack.pack}>
                <p className="t-row break-words">{pack.pack} replaces TF2's sound scripts</p>
                <p className="t-meta break-words">
                  {pack.soundScripts.join(", ")}. An old copy can silence newer weapons after a TF2
                  update.
                </p>
              </div>
            ))}
          </div>
        )}
        {audit.omittedDetails > 0 ? (
          <p className="t-meta mt-3">{audit.omittedDetails} more results are not shown.</p>
        ) : null}
      </div>
    </PaneSection>
  );
}
