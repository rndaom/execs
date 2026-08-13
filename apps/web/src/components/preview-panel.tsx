"use client";

import {
  matrix,
  moduleImageKey,
  type PreviewMatch,
  tierImageKey,
} from "@execs/preview-matrix";
import { useId, useState } from "react";

const SCENE = "s1";

function mediaUrl(key: string): string {
  return `/media/${key}`;
}

/**
 * Interactive visual preview: before/after slider (stock vs matched tier) plus
 * module chips that swap in per-module isolated captures. Falls back to a
 * text panel until the capture matrix has been uploaded.
 */
export function PreviewPanel({ match }: { match: PreviewMatch }) {
  const [sliderPos, setSliderPos] = useState(55);
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const sliderId = useId();

  const resolvedModules = matrix.modules.filter(
    (m) => match.moduleLevels[m.id] !== null && match.moduleLevels[m.id] !== undefined,
  );
  const matchedCount = resolvedModules.length;
  const approximate = match.confidence < 0.4;

  if (!matrix.capturesAvailable) {
    return (
      <section className="flex flex-col gap-3 rounded-lg border border-edge bg-panel p-4">
        <h2 className="font-display text-xl">Visual preview</h2>
        <p className="text-sm">
          Closest visual tier: <strong className="text-brand">{match.tierLabel}</strong>{" "}
          <span className="text-ink-faint">
            (matched {matchedCount}/{matrix.modules.length} modules)
          </span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {resolvedModules.map((m) => (
            <span
              key={m.id}
              className="rounded-pill border border-q-vintage px-3 py-1 text-xs text-q-vintage"
            >
              {m.label}: {match.moduleLevels[m.id]}
            </span>
          ))}
        </div>
        <p className="text-xs text-ink-faint">
          Side-by-side screenshots for every tier are on the way — the capture session for the
          reference scene hasn't run yet.
        </p>
      </section>
    );
  }

  const activeLevel = activeModule ? match.moduleLevels[activeModule] : null;
  const mainImage =
    activeModule && activeLevel
      ? mediaUrl(moduleImageKey(SCENE, activeModule, activeLevel, 1600))
      : mediaUrl(tierImageKey(SCENE, match.tier, 1600));
  const stockImage = mediaUrl(tierImageKey(SCENE, "stock", 1600));

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-edge bg-panel p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-xl">Visual preview</h2>
        <p className="text-xs text-ink-faint">
          Closest tier: <span className="text-brand">{match.tierLabel}</span> · matched{" "}
          {matchedCount}/{matrix.modules.length} modules
          {approximate && " · approximate"}
        </p>
      </div>

      {activeModule === null ? (
        <div className="relative aspect-video select-none overflow-hidden rounded-md border border-edge">
          {/* biome-ignore lint/performance/noImgElement: R2-served matrix images */}
          <img src={stockImage} alt="Stock settings" className="absolute inset-0 h-full w-full object-cover" />
          {/* biome-ignore lint/performance/noImgElement: R2-served matrix images */}
          <img
            src={mainImage}
            alt={`This config (${match.tierLabel})`}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}
          />
          <div
            className="absolute inset-y-0 w-0.5 bg-brand"
            style={{ left: `${sliderPos}%` }}
          />
          <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs">stock</span>
          <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs">
            this config
          </span>
          <label htmlFor={sliderId} className="sr-only">
            Comparison slider
          </label>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={100}
            value={sliderPos}
            onChange={(e) => setSliderPos(Number(e.target.value))}
            className="absolute inset-x-0 bottom-0 h-full w-full cursor-ew-resize opacity-0"
          />
        </div>
      ) : (
        <div className="relative aspect-video overflow-hidden rounded-md border border-edge">
          {/* biome-ignore lint/performance/noImgElement: R2-served matrix images */}
          <img src={mainImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs">
            {matrix.modules.find((m) => m.id === activeModule)?.label}: {activeLevel}
          </span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setActiveModule(null)}
          className={`rounded-pill border px-3 py-1 text-xs ${
            activeModule === null
              ? "border-brand bg-brand text-on-brand"
              : "border-edge text-ink-muted hover:border-ink-muted"
          }`}
        >
          before / after
        </button>
        {matrix.modules.map((m) => {
          const level = match.moduleLevels[m.id];
          const disabled = level === null || level === undefined;
          return (
            <button
              key={m.id}
              type="button"
              disabled={disabled}
              onClick={() => setActiveModule(m.id)}
              title={disabled ? "config doesn't set this" : undefined}
              className={`rounded-pill border px-3 py-1 text-xs ${
                disabled
                  ? "cursor-not-allowed border-edge text-ink-faint opacity-50"
                  : activeModule === m.id
                    ? "border-brand bg-brand text-on-brand"
                    : "border-edge text-ink-muted hover:border-ink-muted"
              }`}
            >
              {m.label}
              {level ? `: ${level}` : ""}
            </button>
          );
        })}
      </div>
    </section>
  );
}
