import { ArrowClockwise, ArrowSquareOut, Image, Plus } from "@phosphor-icons/react";
import { useState } from "react";
import type { GameBananaMod } from "../lib/bridge";
import { Loading } from "./ui/Spinner";

export type GameBananaInstallState = "idle" | "loading" | "installing" | "failed";

export function GameBananaCard({
  mod,
  meta,
  installed,
  locked,
  running,
  installState,
  onView,
  onInstall,
  onRoute,
}: {
  mod: GameBananaMod;
  meta: string;
  installed: boolean;
  locked: boolean;
  running: boolean;
  installState: GameBananaInstallState;
  onView: () => void;
  onInstall: () => void;
  onRoute: () => void;
}) {
  const titleId = `mods-gb-title-${mod.id}`;
  const failureId = `mods-gb-failure-${mod.id}`;
  const failed = installState === "failed";
  const installing = installState === "installing";
  const loading = installState === "loading";
  const installLabel = installed
    ? "Installed"
    : installing
      ? "Installing…"
      : loading
        ? "Loading files…"
        : failed
          ? "Retry"
          : running
            ? "Close TF2 to install"
            : "Install";

  return (
    <article
      data-testid={`mods-gb-card-${mod.id}`}
      aria-labelledby={titleId}
      className="surface media-card group flex min-w-0 flex-col overflow-hidden text-left"
    >
      <div className="relative">
        <button
          type="button"
          className="block w-full cursor-pointer text-left"
          aria-label={`View preview and details for ${mod.name} on GameBanana`}
          onClick={onView}
        >
          <GameBananaThumbnail mod={mod} />
        </button>
        <span className="badge pointer-events-none absolute bottom-2 left-2 bg-panel">
          {mod.subCategory ? `${mod.category} · ${mod.subCategory}` : mod.category}
        </span>
        {mod.route !== "mod" ? (
          <button
            type="button"
            data-testid={`mods-gb-route-${mod.id}`}
            className="btn btn-ghost absolute top-2 right-2 min-h-8 bg-panel px-2"
            disabled={mod.route === "manual" && locked}
            onClick={onRoute}
          >
            {mod.route === "hud" ? "Open HUD" : "Import mod"}
          </button>
        ) : installed ? (
          <span className="badge pointer-events-none absolute top-2 right-2 bg-panel">
            Installed
          </span>
        ) : (
          <button
            type="button"
            data-testid={`mods-gb-install-${mod.id}`}
            className={`btn ${failed ? "btn-primary" : "btn-ghost bg-panel"} absolute top-2 right-2 min-h-8 gap-1.5 p-1.5`}
            aria-label={`${installLabel} ${mod.name}`}
            title={`${installLabel} ${mod.name}`}
            aria-describedby={failed ? failureId : undefined}
            disabled={loading || installing || locked}
            onClick={onInstall}
          >
            {installing || loading ? (
              <Loading>{installing ? "Installing…" : "Loading files…"}</Loading>
            ) : failed ? (
              <>
                <ArrowClockwise size={16} /> Retry
              </>
            ) : (
              <Plus size={18} />
            )}
          </button>
        )}
        {mod.mature ? (
          <span className="badge pointer-events-none absolute top-2 left-2 bg-panel">Mature</span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <h3 id={titleId} className="t-row break-words leading-5">
            <button
              type="button"
              className="inline cursor-pointer text-left hover:underline"
              aria-label={`View ${mod.name} on GameBanana`}
              onClick={onView}
            >
              {mod.name}
              <ArrowSquareOut size={12} className="ml-1.5 inline text-ink-muted" />
            </button>
          </h3>
          <p className="t-meta mt-0.5 break-words">by {mod.author} · GameBanana</p>
        </div>
        <p className="t-meta tnum">{meta}</p>
        {mod.route === "hud" ? (
          <p className="t-meta">
            Review the author’s files, then import the chosen archive in HUD.
          </p>
        ) : mod.route === "manual" ? (
          <p className="t-meta">Follow the author’s instructions, then import the intended file.</p>
        ) : null}
        {failed ? (
          <p id={failureId} role="alert" className="t-meta text-error">
            Install failed. Retry this mod.
          </p>
        ) : null}
      </div>
    </article>
  );
}

function GameBananaThumbnail({ mod }: { mod: GameBananaMod }) {
  // A failed image should not leave a browser icon or collapse the card.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const broken = mod.thumb !== null && brokenUrl === mod.thumb;
  const image =
    mod.thumb && !broken ? (
      <img
        src={mod.thumb}
        alt=""
        loading="lazy"
        className="h-full w-full bg-bg object-cover"
        onError={() => setBrokenUrl(mod.thumb)}
      />
    ) : null;
  return (
    <span className="relative block aspect-[2/1] shrink-0 overflow-hidden border-b border-edge bg-bg">
      {image ?? (
        <span className="media-empty absolute inset-0 flex flex-col items-center justify-center gap-2 text-[12px] text-ink-muted">
          <Image size={25} aria-hidden="true" />
          No preview
        </span>
      )}
    </span>
  );
}
