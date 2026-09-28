import type { ModRecord, PreloaderStatusPayload } from "../lib/bridge";
import { packCasualNote } from "../lib/mod-audit-ui";
import { Alert } from "./ui/Alert";
import { Disclosure } from "./ui/Disclosure";

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
  if (!audit) return <p className="t-meta mt-4">Installed content check unavailable.</p>;
  const scriptPacks = audit.packs.filter((pack) => pack.soundScripts.length > 0);
  return (
    <div className="mt-4" data-testid="mod-content-audit">
      {audit.incomplete.length > 0 ? (
        <Alert tone="warn" className="mb-3">
          <p>
            Content check incomplete. More overlaps or restrictions may be present; file winners are
            unknown.
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
            ? "Installed packs: Casual restrictions and requirements"
            : `File check: ${audit.overlaps.length} overlaps, ${audit.splitModels.length} possible split model sets${audit.omittedDetails ? " (limited results)" : ""}`
        }
      >
        <div className="space-y-4 pt-3">
          <p className="t-meta">
            Read-only check of installed custom packs. Expected winners use TF2’s standard
            alphabetical custom mount order. Server rules, map content and preloading can change
            what is used in game.
          </p>
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
                    ? "No overlaps found in the inspected files."
                    : "No overlapping files found."}
                </p>
              ) : (
                <ul className="space-y-3">
                  {audit.overlaps.map((overlap) => (
                    <li key={overlap.path}>
                      <p className="t-row break-all">{overlap.path}</p>
                      <p className="t-meta break-words">
                        {overlap.winner
                          ? `Expected first: ${overlap.winner}. Hides: ${overlap.packs.filter((pack) => pack !== overlap.winner).join(", ")}.`
                          : `Winner unknown. Candidates: ${overlap.packs.join(", ")}.`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {audit.splitModels.map((model) => (
                <div key={model.model}>
                  <p className="t-row break-all">Possible mixed model set: {model.model}</p>
                  <p className="t-meta">
                    Parts supplied by different packs may have incompatible skeletons or geometry.
                  </p>
                  <ul className="mt-1 space-y-1">
                    {model.components.map((component) => (
                      <li className="t-meta break-all" key={component.path}>
                        {component.path}:{" "}
                        {component.winner ?? `unknown (${component.packs.join(", ")})`}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
          {scriptPacks.map((pack) => (
            <div key={pack.pack}>
              <p className="t-row break-words">{pack.pack} replaces whole sound scripts</p>
              <p className="t-meta break-words">
                {pack.soundScripts.join(", ")}. A stale copy after a TF2 update can omit newer
                sounds. This check cannot determine whether the script is current.
              </p>
            </div>
          ))}
          {audit.omittedDetails > 0 ? (
            <p className="t-meta">
              {audit.omittedDetails} additional overlap or model details omitted to keep this report
              bounded.
            </p>
          ) : null}
        </div>
      </Disclosure>
    </div>
  );
}
