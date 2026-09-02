import { MagnifyingGlass, Play, Stop, UploadSimple, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Alert } from "../components/ui/Alert";
import { Modal } from "../components/ui/Modal";
import { forgetSoundUrl, type SoundPlayer, soundKey } from "../hooks/useSoundPlayer";
import type { Api } from "../lib/api";
import type { HitsoundKind, HitsoundPick, PickedHitsound } from "../lib/bridge";
import { searchCommunityHitsounds } from "../lib/community-hitsounds";
import {
  formatWavInfo,
  pickForChoice,
  type SoundChoice,
  STOCK_HITSOUND_EFFECTS,
  sameChoice,
} from "../lib/hitsound-ui";

/**
 * Pick a sound for one slot: the engine's own effects, the community pack,
 * or a WAV of your own. Every row has a play button; choosing one closes
 * the picker and the pane's Save writes it.
 */
export function SoundPicker({
  api,
  kind,
  current,
  volume,
  player,
  onChoose,
  onClose,
}: {
  api: Api;
  kind: HitsoundKind;
  current: SoundChoice;
  volume: number;
  player: SoundPlayer;
  onChoose: (choice: SoundChoice) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [stockStems, setStockStems] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<PickedHitsound | null>(
    current.kind === "file" ? current.picked : null,
  );
  const [pickError, setPickError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const matches = searchCommunityHitsounds(query);

  useEffect(() => {
    let cancelled = false;
    api
      .listStockHitsounds()
      .then((stems) => {
        if (!cancelled) {
          setStockStems(stems);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStockStems([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Closing stops whatever was auditioning; the pane's row keeps its own state.
  useEffect(() => () => player.stop(), [player.stop]);

  function toggle(pick: HitsoundPick) {
    if (player.playing === soundKey(pick)) {
      player.stop();
    } else {
      player.play(pick, volume);
    }
  }

  async function chooseFile() {
    if (busy) {
      return;
    }
    setBusy(true);
    setPickError(null);
    try {
      const next = await api.pickHitsoundFile();
      if (next) {
        if (picked) {
          forgetSoundUrl({ kind: "file", token: picked.token, name: picked.name });
        }
        setPicked(next);
      }
    } catch (err) {
      setPickError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  }

  const stockAvailable = (stem: string) => stockStems === null || stockStems.includes(stem);

  return (
    <Modal
      open
      testId="sound-picker"
      title={kind === "hit" ? "Choose a hit sound" : "Choose a kill sound"}
      description="Press play to hear one, then pick it. Built-in effects come from your own game files."
      className="fixed inset-4 z-50 flex flex-col sm:inset-x-[max(1rem,calc(50vw-24rem))] sm:inset-y-8"
      onClose={onClose}
    >
      <button
        type="button"
        data-testid="sound-picker-close"
        onClick={onClose}
        aria-label="Close sound picker"
        className="btn btn-ghost absolute top-3 right-3 p-2"
      >
        <X size={16} />
      </button>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        <p className="eyebrow">Your own</p>
        <div className="surface mt-2 flex flex-wrap items-center gap-3 p-3">
          {picked ? (
            <>
              <PlayButton
                playing={
                  player.playing ===
                  soundKey({ kind: "file", token: picked.token, name: picked.name })
                }
                onClick={() => toggle({ kind: "file", token: picked.token, name: picked.name })}
              />
              <div className="min-w-0 flex-1">
                <p className="t-row truncate">{picked.name}</p>
                <p className="t-meta">
                  {formatWavInfo(picked.info)}
                  {picked.converted ? " · converted for TF2" : ""}
                </p>
              </div>
              <button
                type="button"
                data-testid="sound-picker-use-file"
                onClick={() => onChoose({ kind: "file", picked })}
                className="btn btn-primary"
              >
                Use this file
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void chooseFile()}
                className="btn btn-ghost"
              >
                Choose another…
              </button>
            </>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                <p className="t-row">A WAV from your computer</p>
                <p className="t-meta">
                  PCM or ADPCM at 11, 22 or 44.1 kHz plays as-is; other PCM WAVs are converted. MP3
                  does not work in TF2.
                </p>
              </div>
              <button
                type="button"
                data-testid="sound-picker-choose-file"
                disabled={busy}
                onClick={() => void chooseFile()}
                className="btn btn-ghost"
              >
                <UploadSimple size={14} />
                {busy ? "Reading…" : "Choose a WAV…"}
              </button>
            </>
          )}
        </div>
        {pickError ? (
          <Alert tone="error" testId="sound-picker-error" className="mt-2 px-3 py-2 text-[13px]">
            {pickError}
          </Alert>
        ) : null}

        <p className="eyebrow mt-7">Built into TF2</p>
        <ul className="mt-1 list-none p-0">
          {STOCK_HITSOUND_EFFECTS.map((effect) => {
            const choice: SoundChoice = { kind: "stock", effect: effect.index };
            const pick = pickForChoice(kind, choice);
            const stem = kind === "hit" ? effect.hit : effect.kill;
            const available = stockAvailable(stem);
            return (
              <SoundRow
                key={effect.index}
                testId={`sound-picker-stock-${effect.index}`}
                label={effect.label}
                meta={
                  effect.index === 0
                    ? "The plain ding — also what a custom file replaces."
                    : available
                      ? undefined
                      : "Not found in your game files."
                }
                selected={sameChoice(current, choice)}
                playing={player.playing === soundKey(pick)}
                canPlay={available}
                onPlay={() => toggle(pick)}
                onChoose={() => onChoose(choice)}
              />
            );
          })}
        </ul>

        <div className="mt-7 flex items-end justify-between gap-3">
          <p className="eyebrow">Community pack</p>
          <label className="relative block w-56">
            <span className="sr-only">Search community sounds</span>
            <MagnifyingGlass
              size={14}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
            />
            <input
              type="search"
              data-testid="sound-picker-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search…"
              className="field w-full py-1.5 pr-3 pl-8 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
          </label>
        </div>
        <ul className="mt-1 list-none p-0">
          {matches.map((entry) => {
            const choice: SoundChoice = { kind: "community", id: entry.id };
            const pick = pickForChoice(kind, choice);
            return (
              <SoundRow
                key={entry.id}
                testId={`sound-picker-community-${entry.id}`}
                label={entry.label}
                selected={
                  sameChoice(current, choice) ||
                  (current.kind === "installed" &&
                    current.entry.source === "community" &&
                    current.entry.name === entry.id)
                }
                playing={player.playing === soundKey(pick)}
                canPlay
                onPlay={() => toggle(pick)}
                onChoose={() => onChoose(choice)}
              />
            );
          })}
          {matches.length === 0 ? (
            <li className="t-meta py-6 text-center">No sounds match.</li>
          ) : null}
        </ul>
        {player.error ? (
          <p className="t-meta mt-3 text-warn" data-testid="sound-picker-play-error">
            {player.error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function PlayButton({
  playing,
  onClick,
  disabled = false,
}: {
  playing: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={playing ? "Stop" : "Play"}
      aria-pressed={playing}
      disabled={disabled}
      onClick={onClick}
      className={`play-button ${playing ? "play-button-active" : ""}`}
    >
      {playing ? <Stop size={15} weight="fill" /> : <Play size={15} weight="fill" />}
    </button>
  );
}

function SoundRow({
  testId,
  label,
  meta,
  selected,
  playing,
  canPlay,
  onPlay,
  onChoose,
}: {
  testId: string;
  label: string;
  meta?: string;
  selected: boolean;
  playing: boolean;
  canPlay: boolean;
  onPlay: () => void;
  onChoose: () => void;
}) {
  return (
    <li className="border-b border-edge last:border-b-0">
      <div className="row min-h-12 gap-3">
        <PlayButton playing={playing} disabled={!canPlay} onClick={onPlay} />
        <button
          type="button"
          data-testid={testId}
          data-selected={selected ? "true" : "false"}
          onClick={onChoose}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md py-1 text-left"
        >
          <span className="min-w-0">
            <span className={`block truncate text-[14px] ${selected ? "text-ink" : "text-ink"}`}>
              {label}
            </span>
            {meta ? <span className="t-meta block truncate">{meta}</span> : null}
          </span>
          <span className={`shrink-0 text-[12px] ${selected ? "text-brand" : "text-ink-faint"}`}>
            {selected ? "Selected" : "Use"}
          </span>
        </button>
      </div>
    </li>
  );
}
