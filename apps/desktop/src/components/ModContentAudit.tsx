import type { ModRecord, PreloaderStatusPayload } from "../lib/bridge";
import { packCasualNote } from "../lib/mod-audit-ui";
import { Alert } from "./ui/Alert";
import { Disclosure } from "./ui/Disclosure";

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function ModContentAudit({
  payload,
  mods,
  profileId,
  casual = false,
}: {
  payload: PreloaderStatusPayload | null;
  mods: ModRecord[];
  profileId: string | null;
  casual?: boolean;
}) {
  const audit = payload?.contentAudit;
  if (!audit) return <p className="t-meta mt-4">The installed files could not be checked.</p>;
  const scriptPacks = audit.packs.filter((pack) => pack.soundScripts.length > 0);
  return (
    <div className="mt-4" data-testid="mod-content-audit">
      {audit.incomplete.length > 0 ? (
        <Alert tone="warn" className="mb-3">
          <p>
            Some files could not be checked, so there may be more shared files or Casual limits than
            shown here.
          </p>
          <ul className="mt-2 list-disc pl-5">
            {[...new Set(audit.incomplete)].map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <Disclosure
        profileId={profileId}
        storageKey={casual ? "mods-casual-content" : "mods-content-audit"}
        summary={
          casual
            ? "What your packs can do on Casual servers"
            : `File check: ${plural(audit.overlaps.length, "shared file", "shared files")}, ${plural(audit.splitModels.length, "mixed model", "mixed models")}${audit.omittedDetails ? " (some not shown)" : ""}`
        }
      >
        <div className="space-y-4 pt-3">
          {casual ? null : (
            <p className="t-meta">
              When packs share a file, TF2 uses the one first alphabetically.
            </p>
          )}
          {casual ? (
            <ul className="space-y-3">
              {audit.packs.map((pack) => {
                const mod = mods.find((item) => item.pack === pack.pack);
                return (
                  <li key={pack.pack}>
                    <p className="t-row break-words">{mod?.name ?? pack.pack}</p>
                    <p className="t-meta">{packCasualNote(pack, mod, payload)}</p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <>
              {audit.overlaps.length === 0 ? (
                <p className="t-meta">
                  {audit.incomplete.length
                    ? "No shared files among the files that could be checked."
                    : "No two packs share a file."}
                </p>
              ) : (
                <ul className="space-y-3">
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
              )}
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
            </>
          )}
          {scriptPacks.map((pack) => (
            <div key={pack.pack}>
              <p className="t-row break-words">{pack.pack} replaces TF2's sound scripts</p>
              <p className="t-meta break-words">
                {pack.soundScripts.join(", ")}. An old copy can silence newer weapons after a TF2
                update.
              </p>
            </div>
          ))}
          {audit.omittedDetails > 0 ? (
            <p className="t-meta">{audit.omittedDetails} more results are not shown.</p>
          ) : null}
        </div>
      </Disclosure>
    </div>
  );
}
