import { BookmarkSimple, X } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
import { Segmented } from "./components/ui/Segmented";
import type { InventorySnapshot } from "./lib/bridge";
import {
  INVENTORY_PREFERENCES_LIMITS,
  type InventoryOperation,
  type InventoryPreferences,
  type InventorySearch,
  type PreferenceStorage,
  readInventoryPreferences,
  restoreInventoryLayout,
  saveNamedInventoryEntry,
  setInventoryFlags,
  validInventoryPreferences,
  writeInventoryPreferences,
} from "./lib/inventory-preferences";
import { type InventorySort, QUALITY_NAMES } from "./lib/inventory-ui";

function localStorageOrNull(): PreferenceStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function useInventoryPreferences(account: string | undefined) {
  const key = account ?? "";
  const loaded = useMemo(() => readInventoryPreferences(localStorageOrNull(), key), [key]);
  const [edited, setEdited] = useState<{
    account: string;
    preferences: InventoryPreferences;
    error: string | null;
  } | null>(null);
  const preferences = edited?.account === key ? edited.preferences : loaded.preferences;
  const storageError = edited?.account === key ? edited.error : loaded.error;
  const latest = useRef({ account: key, preferences });
  latest.current = { account: key, preferences };

  function update(change: (previous: InventoryPreferences) => InventoryPreferences) {
    if (!key || latest.current.account !== key) return;
    const next = change(latest.current.preferences);
    if (!validInventoryPreferences(next, key))
      throw Error("Inventory preferences exceed their limits or contain invalid values.");
    // Never overwrite unreadable stored protections with an empty replacement.
    const error = loaded.error ?? writeInventoryPreferences(localStorageOrNull(), next);
    latest.current = { account: key, preferences: next };
    setEdited({ account: key, preferences: next, error });
  }
  return {
    preferences,
    storageError,
    protectedIds: useMemo(
      () => new Set([...preferences.protectedIds, ...preferences.favoriteIds]),
      [preferences.protectedIds, preferences.favoriteIds],
    ),
    favoriteIds: useMemo(() => new Set(preferences.favoriteIds), [preferences.favoriteIds]),
    setProtected: (ids: readonly string[], value: boolean) =>
      update((previous) => ({
        ...previous,
        protectedIds: setInventoryFlags(previous.protectedIds, ids, value),
      })),
    setFavorite: (ids: readonly string[], value: boolean) =>
      update((previous) => ({
        ...previous,
        favoriteIds: setInventoryFlags(previous.favoriteIds, ids, value),
      })),
    saveSearch: (name: string, search: InventorySearch) =>
      update((previous) => ({
        ...previous,
        searches: saveNamedInventoryEntry(
          previous.searches,
          { ...search, name },
          INVENTORY_PREFERENCES_LIMITS.searches,
        ),
      })),
    removeSearch: (name: string) =>
      update((previous) => ({
        ...previous,
        searches: previous.searches.filter((search) => search.name !== name),
      })),
    saveLayout: (name: string, positions: Readonly<Record<string, number>>, capacity: number) =>
      update((previous) => ({
        ...previous,
        layouts: saveNamedInventoryEntry(
          previous.layouts,
          { name, positions: { ...positions }, capacity },
          INVENTORY_PREFERENCES_LIMITS.layouts,
        ),
      })),
    removeLayout: (name: string) =>
      update((previous) => ({
        ...previous,
        layouts: previous.layouts.filter((layout) => layout.name !== name),
      })),
    recordOperation: (operation: InventoryOperation) =>
      update((previous) => ({
        ...previous,
        history: [
          {
            ...operation,
            summary: [...operation.summary]
              .map((character) =>
                character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? " " : character,
              )
              .join("")
              .slice(0, 240),
            itemIds: [...new Set(operation.itemIds)],
            at: Math.max(Date.now(), (previous.history[0]?.at ?? 0) + 1),
          },
          ...previous.history,
        ].slice(0, INVENTORY_PREFERENCES_LIMITS.history),
      })),
  };
}

export type InventoryPreferencesController = ReturnType<typeof useInventoryPreferences>;
export type InventoryPolishTab = "searches" | "layouts" | "history";
export type InventoryPolishProps = {
  snapshot: InventorySnapshot;
  query: string;
  quality: number | null;
  sort: InventorySort;
  positions: Readonly<Record<string, number>>;
  preferences: InventoryPreferencesController;
  onSearch: (search: InventorySearch) => void;
  onRestoreLayout: (positions: Record<string, number>) => void;
  disabled?: boolean;
  initialTab?: InventoryPolishTab;
};

export function InventoryPolish(props: InventoryPolishProps) {
  // Account changes also discard unsaved names and feedback, not just saved records.
  return <AccountInventoryPolish key={props.snapshot.steamId} {...props} />;
}

const OUTCOMES: Record<InventoryOperation["outcome"], string> = {
  simulated: "Simulated · Steam unchanged",
  confirmed: "Confirmed",
  partial: "Partially confirmed",
  unknown: "Unknown outcome",
  refused: "Refused",
};
const KINDS: Record<InventoryOperation["kind"], string> = {
  move: "Move",
  craft: "Craft",
  delete: "Delete",
};

function AccountInventoryPolish({
  snapshot,
  query,
  quality,
  sort,
  positions,
  preferences: controller,
  onSearch,
  onRestoreLayout,
  disabled = false,
  initialTab = "searches",
}: InventoryPolishProps) {
  const [tab, setTab] = useState<InventoryPolishTab>(initialTab);
  const [searchName, setSearchName] = useState("");
  const [layoutName, setLayoutName] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const { preferences, protectedIds, storageError } = controller;
  const currentSearch = [
    query.trim() ? `“${query.trim()}”` : "",
    quality === null ? "" : (QUALITY_NAMES[quality] ?? `Quality ${quality}`),
  ]
    .filter(Boolean)
    .join(" · ");
  function act(action: () => void, message: string) {
    try {
      action();
      setFeedback({ text: message, error: false });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "Could not update inventory preferences.",
        error: true,
      });
    }
  }
  return (
    <section aria-label="Inventory tools" className="mt-4">
      <Segmented
        label="Inventory tools"
        size="sm"
        value={tab}
        options={[
          { id: "searches", label: `Searches · ${preferences.searches.length}` },
          { id: "layouts", label: `Layouts · ${preferences.layouts.length}` },
          { id: "history", label: `History · ${preferences.history.length}` },
        ]}
        onChange={(next) => {
          setTab(next);
          setFeedback(null);
        }}
      />
      {storageError ? (
        <p role="alert" className="t-meta mt-3 text-warn">
          {storageError}
        </p>
      ) : null}
      <div className="mt-4 min-h-44">
        {tab === "searches" ? (
          <>
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (disabled) return;
                act(() => {
                  controller.saveSearch(searchName, { query, quality, sort });
                  setSearchName("");
                }, "Saved the current search.");
              }}
            >
              <label className="min-w-0 flex-1">
                <span className="sr-only">Search name</span>
                <input
                  className="input w-full"
                  value={searchName}
                  maxLength={60}
                  onChange={(event) => setSearchName(event.target.value)}
                  placeholder={
                    currentSearch ? `Name ${currentSearch}` : "Search the backpack first"
                  }
                />
              </label>
              <button
                type="submit"
                className="btn btn-ghost"
                disabled={disabled || !searchName.trim()}
              >
                <BookmarkSimple size={14} aria-hidden="true" /> Save search
              </button>
            </form>
            {preferences.searches.length ? (
              <ul className="inventory-saved-list" aria-label="Saved searches">
                {preferences.searches.map((search) => (
                  <li key={search.name}>
                    <button
                      type="button"
                      className="inventory-saved-open"
                      disabled={disabled}
                      onClick={() => onSearch(search)}
                    >
                      {search.name}
                    </button>
                    <button
                      type="button"
                      className="inventory-icon-button"
                      disabled={disabled}
                      aria-label={`Remove saved search ${search.name}`}
                      title="Remove"
                      onClick={() =>
                        act(() => controller.removeSearch(search.name), "Removed saved search.")
                      }
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="t-meta mt-3 text-ink-faint">No saved searches.</p>
            )}
          </>
        ) : tab === "layouts" ? (
          <>
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (disabled) return;
                act(() => {
                  controller.saveLayout(layoutName, positions, snapshot.capacity);
                  setLayoutName("");
                }, "Saved the current draft positions.");
              }}
            >
              <label className="min-w-0 flex-1">
                <span className="sr-only">Layout name</span>
                <input
                  className="input w-full"
                  value={layoutName}
                  maxLength={60}
                  onChange={(event) => setLayoutName(event.target.value)}
                  placeholder="Name the current layout"
                />
              </label>
              <button
                type="submit"
                className="btn btn-ghost"
                disabled={disabled || !layoutName.trim()}
              >
                Save layout
              </button>
            </form>
            {preferences.layouts.length ? (
              <ul className="inventory-saved-list" aria-label="Saved layouts">
                {preferences.layouts.map((layout) => (
                  <li key={layout.name}>
                    <span className="min-w-0 flex-1 truncate">{layout.name}</span>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      disabled={disabled}
                      aria-label={`Restore ${layout.name} as draft`}
                      onClick={() => {
                        try {
                          const result = restoreInventoryLayout(
                            layout,
                            snapshot,
                            positions,
                            protectedIds,
                          );
                          onRestoreLayout(result.positions);
                          setFeedback({
                            text: `Restored as a draft. ${result.missing} missing items skipped; ${result.retained} items kept their current positions. Review before Apply.`,
                            error: false,
                          });
                        } catch (error) {
                          setFeedback({
                            text:
                              error instanceof Error ? error.message : "Could not restore layout.",
                            error: true,
                          });
                        }
                      }}
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      className="inventory-icon-button"
                      disabled={disabled}
                      aria-label={`Remove saved layout ${layout.name}`}
                      title="Remove"
                      onClick={() =>
                        act(() => controller.removeLayout(layout.name), "Removed saved layout.")
                      }
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="t-meta mt-3 text-ink-faint">
                Restoring a layout only changes the draft. New and protected items keep their place.
              </p>
            )}
          </>
        ) : preferences.history.length ? (
          <ol className="inventory-history" aria-label="Operation history">
            {preferences.history.map((operation) => (
              <li key={operation.at}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="t-row">
                    {KINDS[operation.kind]}{" "}
                    <span
                      className={
                        operation.outcome === "unknown" || operation.outcome === "partial"
                          ? "font-normal text-warn"
                          : "font-normal text-ink-muted"
                      }
                    >
                      · {OUTCOMES[operation.outcome]}
                    </span>
                  </span>
                  <time
                    className="t-meta tnum shrink-0"
                    dateTime={new Date(operation.at).toISOString()}
                  >
                    {new Date(operation.at).toLocaleString()}
                  </time>
                </div>
                <p className="t-meta break-words">{operation.summary}</p>
                <details className="t-meta">
                  <summary className="cursor-pointer text-ink-faint hover:text-ink">
                    {operation.itemIds.length} item identities
                  </summary>
                  <p className="mt-1 break-all">{operation.itemIds.join(", ") || "None"}</p>
                </details>
              </li>
            ))}
          </ol>
        ) : (
          <p className="t-meta text-ink-faint">
            Outcomes on this device appear here. This is not Steam's transaction history.
          </p>
        )}
      </div>
      {feedback ? (
        <p
          className={`t-meta mt-3 ${feedback.error ? "text-warn" : ""}`}
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.text}
        </p>
      ) : null}
    </section>
  );
}
