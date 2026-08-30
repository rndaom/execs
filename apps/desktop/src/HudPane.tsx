import { useEffect, useMemo, useState } from "react";
import type { HudCatalogEntry, HudSchemaView, HudUiState } from "./lib/bridge";
import {
  canInstallHud,
  filterHudCatalog,
  formatHudRgba,
  hexToRgb,
  hudOptionsDirty,
  hudUpdateAvailable,
  installedHudLabel,
  isHudCheckboxOn,
  parseHudRgba,
  rgbToHex,
  seedHudOptions,
} from "./lib/hud-ui";
import { canWriteSettings } from "./lib/settings-ui";

export function HudPane({
  running,
  busy,
  catalog,
  state,
  schema,
  onRefresh,
  onInstall,
  onUpdate,
  onMatch,
  onApplyOptions,
}: {
  running: boolean;
  busy: boolean;
  catalog: HudCatalogEntry[];
  state: HudUiState;
  schema: HudSchemaView | null;
  onRefresh: () => void;
  onInstall: (id: string) => void;
  onUpdate: () => void;
  onMatch: (id: string) => void;
  onApplyOptions: (options: Record<string, string>) => void;
}) {
  const locked = !canWriteSettings(running, busy);
  const [query, setQuery] = useState("");
  const seeded = useMemo(() => seedHudOptions(schema, state.installed), [schema, state.installed]);
  const [draft, setDraft] = useState(seeded);
  const visible = filterHudCatalog(catalog, query);
  const dirty = hudOptionsDirty(draft, seeded);
  const installedId = state.installed?.id ?? null;
  const installedLabel = installedHudLabel(state);
  const updateAvailable = hudUpdateAvailable(state);

  useEffect(() => {
    setDraft(seeded);
  }, [seeded]);

  return (
    <section data-testid="settings-hud" className="flex flex-col gap-5 text-left">
      <p className="text-sm text-ink-muted">
        HUD layout, scheme, and animations generally work on Valve Casual. Custom materials, models,
        and particles usually do not.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm text-ink" htmlFor="hud-search">
          Search catalog
          <input
            id="hud-search"
            data-testid="hud-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or author"
            className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none"
          />
        </label>
        <button
          type="button"
          data-testid="hud-refresh"
          disabled={busy}
          onClick={onRefresh}
          className="rounded-pill border border-edge px-4 py-2 text-sm text-ink hover:bg-panel-raised disabled:opacity-40"
        >
          Refresh catalog
        </button>
      </div>

      {installedId ? (
        <div
          data-testid="hud-installed"
          className="rounded-xl border border-edge bg-panel-raised/40 px-3 py-3"
        >
          <p className="font-display text-sm tracking-wide text-ink">
            {installedLabel}: {installedId}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {state.inferred
              ? "This profile already has a HUD folder. Match it to hud-db to enable updates."
              : "One HUD folder is mounted. Installing another replaces it."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {state.inferred ? (
              <button
                type="button"
                data-testid="hud-match"
                disabled={locked}
                onClick={() => onMatch(installedId)}
                className="rounded-pill bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
              >
                Match to catalog…
              </button>
            ) : null}
            {updateAvailable ? (
              <button
                type="button"
                data-testid="hud-update"
                disabled={locked}
                onClick={onUpdate}
                className="rounded-pill bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
              >
                {running ? "Close TF2 to update" : "Update HUD"}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">No HUD installed on this profile yet.</p>
      )}

      <div data-testid="hud-catalog" className="flex flex-col gap-3">
        {visible.length === 0 ? (
          <p className="text-sm text-ink-muted">No HUDs match that search.</p>
        ) : (
          visible.map((entry) => {
            const current = installedId?.toLowerCase() === entry.id.toLowerCase();
            const installable = canInstallHud(entry);
            return (
              <article
                key={entry.id}
                data-testid={`hud-card-${entry.id}`}
                data-github={entry.github ? "true" : "false"}
                className="rounded-xl border border-edge px-3 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-display text-lg text-ink">{entry.name}</p>
                    <p className="text-xs text-ink-muted">
                      {entry.author}
                      {entry.flags.length > 0 ? ` · ${entry.flags.join(", ")}` : ""}
                    </p>
                  </div>
                  {current ? (
                    <span className="rounded-pill bg-q-strange/20 px-3 py-1 text-xs text-q-strange">
                      Active
                    </span>
                  ) : null}
                </div>
                {!installable ? (
                  <p className="mt-2 text-xs text-ink-muted">
                    Not a pinned GitHub zip. Open the author’s page to install it yourself.
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid={`hud-install-${entry.id}`}
                    disabled={locked || !installable || current}
                    onClick={() => onInstall(entry.id)}
                    className="rounded-pill bg-brand px-4 py-1.5 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
                  >
                    {current
                      ? "Installed"
                      : !installable
                        ? "Install"
                        : running
                          ? "Close TF2 to install"
                          : "Install"}
                  </button>
                  <a
                    href={entry.comfigUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-pill border border-edge px-4 py-1.5 text-sm text-ink hover:bg-panel-raised"
                  >
                    comfig.app
                  </a>
                  <a
                    href={entry.tf2hudsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-pill border border-edge px-4 py-1.5 text-sm text-ink hover:bg-panel-raised"
                  >
                    tf2huds.dev
                  </a>
                </div>
              </article>
            );
          })
        )}
      </div>

      {state.installed && schema?.supported ? (
        <form
          data-testid="hud-options"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (locked || !dirty) {
              return;
            }
            onApplyOptions(draft);
          }}
        >
          <p className="font-display text-sm tracking-wide text-ink-muted">
            Options{schema.author ? ` · ${schema.author}` : ""}
          </p>
          {schema.sections.map((section) => (
            <fieldset key={section.name} className="flex flex-col gap-3">
              <legend className="font-display text-sm tracking-wide text-ink">{section.name}</legend>
              {section.controls.map((control) => {
                const value = draft[control.name] ?? control.value;
                if (control.controlType === "checkbox") {
                  return (
                    <label
                      key={control.name}
                      className="flex items-center gap-2 text-sm text-ink"
                      htmlFor={`hud-opt-${control.name}`}
                    >
                      <input
                        id={`hud-opt-${control.name}`}
                        data-testid={`hud-opt-${control.name}`}
                        type="checkbox"
                        checked={isHudCheckboxOn(value)}
                        disabled={locked}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [control.name]: event.target.checked ? "true" : "false",
                          }))
                        }
                      />
                      {control.label}
                    </label>
                  );
                }
                if (control.controlType === "combo") {
                  return (
                    <label
                      key={control.name}
                      className="flex flex-col gap-1 text-sm text-ink"
                      htmlFor={`hud-opt-${control.name}`}
                    >
                      {control.label}
                      <select
                        id={`hud-opt-${control.name}`}
                        data-testid={`hud-opt-${control.name}`}
                        value={value}
                        disabled={locked}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [control.name]: event.target.value,
                          }))
                        }
                        className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none disabled:opacity-50"
                      >
                        {control.choices.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                }
                if (control.controlType === "number") {
                  return (
                    <label
                      key={control.name}
                      className="flex flex-col gap-1 text-sm text-ink"
                      htmlFor={`hud-opt-${control.name}`}
                    >
                      {control.label}
                      <input
                        id={`hud-opt-${control.name}`}
                        data-testid={`hud-opt-${control.name}`}
                        type="number"
                        value={value}
                        min={control.minimum}
                        max={control.maximum}
                        disabled={locked}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [control.name]: event.target.value,
                          }))
                        }
                        className="rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink focus:border-brand focus:outline-none disabled:opacity-50"
                      />
                    </label>
                  );
                }
                const rgba = parseHudRgba(value);
                return (
                  <div key={control.name} className="flex flex-col gap-1">
                    <label className="text-sm text-ink" htmlFor={`hud-opt-${control.name}`}>
                      {control.label}
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        id={`hud-opt-${control.name}`}
                        data-testid={`hud-opt-${control.name}`}
                        type="color"
                        value={rgbToHex(rgba.r, rgba.g, rgba.b)}
                        disabled={locked}
                        onChange={(event) => {
                          const rgb = hexToRgb(event.target.value);
                          if (!rgb) {
                            return;
                          }
                          setDraft((current) => ({
                            ...current,
                            [control.name]: formatHudRgba(rgb.r, rgb.g, rgb.b, rgba.a),
                          }));
                        }}
                        className="h-8 w-12 cursor-pointer rounded border border-edge bg-bg disabled:opacity-50"
                      />
                      <label className="flex items-center gap-2 text-xs text-ink-muted">
                        Opacity
                        <input
                          data-testid={`hud-opt-${control.name}-alpha`}
                          type="range"
                          min={0}
                          max={255}
                          value={rgba.a}
                          disabled={locked}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [control.name]: formatHudRgba(
                                rgba.r,
                                rgba.g,
                                rgba.b,
                                Number(event.target.value),
                              ),
                            }))
                          }
                          className="accent-brand disabled:opacity-50"
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </fieldset>
          ))}
          <div>
            <button
              type="submit"
              data-testid="hud-apply"
              disabled={locked || !dirty}
              className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
            >
              {running ? "Close TF2 to apply" : "Apply"}
            </button>
          </div>
        </form>
      ) : state.installed && !state.schemaSupported ? (
        <p data-testid="hud-options-notes" className="text-sm text-ink-muted">
          This HUD has no in-app options. Open the author’s customization notes on comfig.app or
          GitHub.
        </p>
      ) : null}

      <p className="text-xs text-ink-muted">
        Catalog from{" "}
        <a
          href="https://github.com/mastercomfig/hud-db"
          target="_blank"
          rel="noreferrer"
          className="text-brand underline decoration-brand/40 underline-offset-2"
        >
          mastercomfig hud-db
        </a>{" "}
        (MIT) and{" "}
        <a
          href="https://comfig.app/huds"
          target="_blank"
          rel="noreferrer"
          className="text-brand underline decoration-brand/40 underline-offset-2"
        >
          comfig.app
        </a>
        . Option schemas from{" "}
        <a
          href="https://github.com/CriticalFlaw/TF2HUD.Editor"
          target="_blank"
          rel="noreferrer"
          className="text-brand underline decoration-brand/40 underline-offset-2"
        >
          TF2HUD.Editor
        </a>{" "}
        (MIT) — first-party apply, not their editor. Credit each HUD’s author. Not affiliated with
        Valve or Steam.
      </p>
    </section>
  );
}
