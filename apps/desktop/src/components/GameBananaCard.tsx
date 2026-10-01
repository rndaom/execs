import { ArrowClockwise, ArrowSquareOut, Check, Image } from "@phosphor-icons/react";
import { useState } from "react";
import type { GameBananaMod } from "../lib/bridge";
import { gameBananaSoundSlot } from "../lib/gamebanana-browser-ui";
import { GAMEBANANA_MAP_NOTE, GAMEBANANA_MAPS_CATEGORY } from "../lib/mods-ui";
import { Spinner } from "./ui/Spinner";

export type GameBananaInstallState =
  | "idle"
  | "loading"
  | "installing"
  | "failed"
  /** The author's file list could not be read; nothing was installed. */
  | "load-failed";

/**
 * One GameBanana listing, laid out like a HUD catalog card: the preview, what
 * it is, and one labelled action. Work in progress covers the preview so the
 * card being installed is unmistakable.
 */
export function GameBananaCard({
  mod,
  meta,
  installed,
  locked,
  running,
  installState,
  failureReason,
  onView,
  onInstall,
  onOpenHud,
  onManage,
}: {
  mod: GameBananaMod;
  meta: string;
  installed: boolean;
  locked: boolean;
  running: boolean;
  installState: GameBananaInstallState;
  /** Why the last install failed, kept on the card after the notice fades. */
  failureReason?: string;
  onView: () => void;
  onInstall: () => void;
  onOpenHud: () => void;
  /** Opens Custom packs for a listing that is already installed. */
  onManage?: () => void;
}) {
  const titleId = `mods-gb-title-${mod.id}`;
  const failureId = `mods-gb-failure-${mod.id}`;
  const failed = installState === "failed" || installState === "load-failed";
  const installing = installState === "installing";
  const loading = installState === "loading";
  const working = installing || loading;
  // Hit and kill sounds are chosen in Sounds; preparing them writes nothing to
  // TF2, so a running game does not block it.
  const soundSlot = gameBananaSoundSlot(mod);
  const installLabel = installing
    ? soundSlot
      ? "Preparing…"
      : "Installing…"
    : loading
      ? "Loading files…"
      : failed
        ? "Retry"
        : soundSlot
          ? "Use in Sounds"
          : running
            ? "Close TF2 to install"
            : "Install";
  const category = mod.subCategory ? `${mod.category} · ${mod.subCategory}` : mod.category;

  return (
    <article
      data-testid={`mods-gb-card-${mod.id}`}
      data-installed={installed ? "true" : undefined}
      aria-labelledby={titleId}
      aria-busy={working || undefined}
      className={`surface group flex min-w-0 flex-col overflow-hidden text-left transition-colors duration-150 ${
        installed || working ? "ring-2 ring-brand" : "hover:border-edge-strong"
      }`}
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
        {installed && !working ? (
          <span
            data-testid={`mods-gb-installed-${mod.id}`}
            className="pointer-events-none absolute top-2.5 left-2.5 inline-flex items-center gap-1.5 rounded-md bg-brand px-2.5 py-1.5 font-semibold text-[13px] text-on-brand leading-none"
          >
            <Check size={14} weight="bold" aria-hidden="true" />
            Installed
          </span>
        ) : null}
        {mod.mature ? (
          <span className="badge pointer-events-none absolute top-2 right-2 bg-panel">Mature</span>
        ) : null}
        <span className="badge pointer-events-none absolute bottom-2 left-2 bg-panel">
          {category}
        </span>
        {working ? (
          <div
            data-testid={`mods-gb-working-${mod.id}`}
            className="enter-fade absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg/80 px-4 text-center"
          >
            <Spinner size={22} />
            <span className="t-row">
              {installing ? (soundSlot ? "Preparing sounds" : "Installing") : "Loading files"}
            </span>
          </div>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-3 pt-2.5">
        <div className="min-w-0">
          <h3 id={titleId} className="t-row break-words leading-5">
            <button
              type="button"
              className="inline cursor-pointer text-left hover:underline"
              aria-label={`View ${mod.name} on GameBanana`}
              onClick={onView}
            >
              {mod.name}
            </button>
          </h3>
          <p className="t-meta mt-0.5 break-words">by {mod.author} · GameBanana</p>
        </div>
        <p className="t-meta tnum">{meta}</p>
        {mod.section === "mod" && mod.categoryId === GAMEBANANA_MAPS_CATEGORY ? (
          <p className="t-meta">{GAMEBANANA_MAP_NOTE}</p>
        ) : null}
        {failed ? (
          <p id={failureId} role="alert" className="t-meta text-error">
            {installState === "load-failed"
              ? "Could not read the author's files. Retry, or open it on GameBanana."
              : failureReason
                ? `${soundSlot ? "Could not prepare it" : "Install failed"}: ${failureReason}`
                : `${soundSlot ? "Could not prepare it" : "Install failed"}. Retry, or open it on GameBanana.`}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-1 px-2 pt-2 pb-2">
        <button
          type="button"
          onClick={onView}
          aria-label={`${mod.name} on GameBanana`}
          title="Open on GameBanana"
          className="btn btn-quiet p-2"
        >
          <ArrowSquareOut size={15} />
        </button>
        {mod.route === "hud" ? (
          <button
            type="button"
            data-testid={`mods-gb-route-${mod.id}`}
            className="btn btn-ghost ml-auto"
            onClick={onOpenHud}
          >
            Open HUD
          </button>
        ) : installed ? (
          <button
            type="button"
            data-testid={`mods-gb-manage-${mod.id}`}
            className="btn btn-ghost ml-auto"
            onClick={onManage}
          >
            Manage
          </button>
        ) : (
          <button
            type="button"
            data-testid={`mods-gb-install-${mod.id}`}
            className={`btn ${failed ? "btn-primary" : "btn-ghost"} ml-auto gap-1.5`}
            aria-label={`${installLabel} ${mod.name}`}
            aria-describedby={failed ? failureId : undefined}
            disabled={working || (locked && !soundSlot)}
            onClick={onInstall}
          >
            {failed ? <ArrowClockwise size={15} /> : null}
            {installLabel}
          </button>
        )}
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
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[12px] text-ink-muted">
          <Image size={25} aria-hidden="true" />
          No preview
        </span>
      )}
    </span>
  );
}
