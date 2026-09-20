import { useState } from "react";
import type { GameBananaMod } from "../lib/bridge";

export type GameBananaInstallState = "idle" | "installing" | "failed";

export function GameBananaCard({
  mod,
  meta,
  installed,
  locked,
  running,
  installState,
  onView,
  onInstall,
}: {
  mod: GameBananaMod;
  meta: string;
  installed: boolean;
  locked: boolean;
  running: boolean;
  installState: GameBananaInstallState;
  onView: () => void;
  onInstall: () => void;
}) {
  const titleId = `mods-gb-title-${mod.id}`;
  const failureId = `mods-gb-failure-${mod.id}`;
  const failed = installState === "failed";
  const installing = installState === "installing";
  const installLabel = installed
    ? "Installed"
    : installing
      ? "Installing…"
      : failed
        ? "Retry"
        : running
          ? "Close TF2 to install"
          : "Install";

  return (
    <article
      data-testid={`mods-gb-card-${mod.id}`}
      aria-labelledby={titleId}
      className="surface flex min-w-0 flex-col overflow-hidden text-left"
    >
      <GameBananaThumbnail mod={mod} />
      <div className="flex min-h-40 flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="badge">{mod.category}</span>
          {mod.mature ? <span className="badge">Mature</span> : null}
        </div>
        <div className="min-w-0">
          <h3 id={titleId} className="t-row break-words">
            {mod.name}
          </h3>
          <p className="t-meta mt-0.5 break-words">by {mod.author} · GameBanana</p>
        </div>
        <p className="t-meta tnum">{meta}</p>
        {failed ? (
          <p id={failureId} role="alert" className="t-meta text-error">
            Install failed. Retry this mod.
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            className="btn btn-ghost flex-1"
            aria-label={`View ${mod.name} on GameBanana`}
            onClick={onView}
          >
            View
          </button>
          <button
            type="button"
            data-testid={`mods-gb-install-${mod.id}`}
            className="btn btn-ghost flex-1"
            aria-label={`${installLabel} ${mod.name}`}
            aria-describedby={failed ? failureId : undefined}
            disabled={installed || installing || locked}
            onClick={onInstall}
          >
            {installLabel}
          </button>
        </div>
      </div>
    </article>
  );
}

function GameBananaThumbnail({ mod }: { mod: GameBananaMod }) {
  // A failed image should not leave a browser icon or collapse the card.
  const [broken, setBroken] = useState(false);
  const image =
    mod.thumb && !broken ? (
      <img
        src={mod.thumb}
        alt=""
        loading="lazy"
        className="h-24 w-full bg-bg object-cover"
        onError={() => setBroken(true)}
      />
    ) : null;
  return (
    <div className="relative h-24 shrink-0 overflow-hidden border-b border-edge bg-bg">
      {image}
      <span
        hidden={mod.thumb !== null && !broken}
        className="absolute inset-0 grid place-items-center text-[11px] text-ink-faint"
      >
        No preview
      </span>
    </div>
  );
}
