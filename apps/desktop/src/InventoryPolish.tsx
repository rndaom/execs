import { BookmarkSimple, ShieldCheck, Star } from "@phosphor-icons/react";
import { useMemo, useRef, useState } from "react";
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
import { type InventorySort, itemName } from "./lib/inventory-ui";

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
export type InventoryPolishProps = {
  snapshot: InventorySnapshot;
  selectedIds: readonly string[] | ReadonlySet<string>;
  query: string;
  quality: number | null;
  sort: InventorySort;
  positions: Readonly<Record<string, number>>;
  preferences: InventoryPreferencesController;
  onSearch: (search: InventorySearch) => void;
  onRestoreLayout: (positions: Record<string, number>) => void;
  onSelectIds: (ids: string[]) => void;
  disabled?: boolean;
};

export function InventoryPolish(props: InventoryPolishProps) {
  // Account changes also discard unsaved names and feedback, not just saved records.
  return <AccountInventoryPolish key={props.snapshot.steamId} {...props} />;
}
function AccountInventoryPolish({
  snapshot,
  selectedIds,
  query,
  quality,
  sort,
  positions,
  preferences: controller,
  onSearch,
  onRestoreLayout,
  onSelectIds,
  disabled = false,
}: InventoryPolishProps) {
  const [searchName, setSearchName] = useState("");
  const [layoutName, setLayoutName] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const { preferences, protectedIds, favoriteIds, storageError } = controller;
  const present = new Set(snapshot.items.map((item) => item.id));
  const selected = [...selectedIds].filter((id) => present.has(id));
  const favorites = snapshot.items.filter((item) => favoriteIds.has(item.id));
  const protectedItems = snapshot.items.filter((item) => protectedIds.has(item.id));
  const unplaced = snapshot.items.filter((item) => (positions[item.id] ?? item.position) === 0);
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
    <section aria-label="Inventory tools" className="my-4 border-y border-edge py-3">
      {storageError ? (
        <p role="alert" className="t-meta mb-3 text-warn">
          {storageError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={disabled || unplaced.length === 0}
          onClick={() => onSelectIds(unplaced.map((item) => item.id))}
        >
          Select unplaced ({unplaced.length})
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={disabled || favorites.length === 0}
          onClick={() => onSelectIds(favorites.map((item) => item.id))}
        >
          <Star size={14} aria-hidden="true" /> Favorites ({favorites.length})
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={disabled || protectedItems.length === 0}
          onClick={() => onSelectIds(protectedItems.map((item) => item.id))}
        >
          <ShieldCheck size={14} aria-hidden="true" /> Protected ({protectedItems.length})
        </button>
      </div>
      <details className="mt-3">
        <summary className="t-meta cursor-pointer hover:text-ink">
          Favorites and protection · {selected.length} selected
        </summary>
        <p className="t-meta mt-2">
          Favorites are protected too. Protected items stay out of crafting and arrangement changes.
          These choices belong to this Steam account on this device.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={disabled || selected.length === 0}
            onClick={() =>
              act(
                () => controller.setFavorite(selected, true),
                `Favorited ${selected.length} selected items.`,
              )
            }
          >
            Favorite selected
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={disabled || !selected.some((id) => favoriteIds.has(id))}
            onClick={() =>
              act(
                () => controller.setFavorite(selected, false),
                "Removed favorites. Explicit protections remain.",
              )
            }
          >
            Remove favorite
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={disabled || selected.length === 0}
            onClick={() =>
              act(
                () => controller.setProtected(selected, true),
                `Protected ${selected.length} selected items.`,
              )
            }
          >
            Protect selected
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={disabled || !selected.some((id) => preferences.protectedIds.includes(id))}
            onClick={() =>
              act(
                () => controller.setProtected(selected, false),
                "Removed explicit protection. Favorites remain protected.",
              )
            }
          >
            Remove protection
          </button>
        </div>
        {selected.length > 0 ? (
          <p className="t-meta mt-2 break-words">
            Selected:{" "}
            {selected
              .slice(0, 5)
              .map((id) => {
                const item = snapshot.items.find((entry) => entry.id === id);
                return item ? itemName(snapshot, item) : id;
              })
              .join(", ")}
            {selected.length > 5 ? ` and ${selected.length - 5} more` : ""}.
          </p>
        ) : null}
      </details>
      <details className="mt-3">
        <summary className="t-meta cursor-pointer hover:text-ink">
          Saved searches ({preferences.searches.length}) and layouts ({preferences.layouts.length})
        </summary>
        <div className="mt-3 space-y-4">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (disabled) return;
              act(() => {
                controller.saveSearch(searchName, { query, quality, sort });
                setSearchName("");
              }, "Saved the current search, quality filter and view order.");
            }}
          >
            <label className="t-meta flex min-w-0 flex-1 flex-col gap-1">
              Search name
              <input
                className="input w-full"
                value={searchName}
                maxLength={60}
                onChange={(event) => setSearchName(event.target.value)}
                placeholder="e.g. Scout weapons"
              />
            </label>
            <button
              type="submit"
              className="btn btn-ghost"
              disabled={disabled || !searchName.trim()}
            >
              <BookmarkSimple size={14} aria-hidden="true" /> Save current search
            </button>
          </form>
          {preferences.searches.length > 0 ? (
            <ul className="space-y-2" aria-label="Saved searches">
              {preferences.searches.map((search) => (
                <li className="flex flex-wrap items-center gap-2" key={search.name}>
                  <button
                    type="button"
                    className="btn btn-ghost max-w-full break-words"
                    disabled={disabled}
                    onClick={() => onSearch(search)}
                  >
                    {search.name}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={disabled}
                    aria-label={`Remove saved search ${search.name}`}
                    onClick={() =>
                      act(() => controller.removeSearch(search.name), "Removed saved search.")
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="t-meta">
            Save the current draft positions. Restoring a layout changes the draft only; review and
            Apply separately. Items acquired since saving and protected items keep their current
            draft positions. Missing items are skipped; conflicts refuse the restore.
          </p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (disabled) return;
              act(() => {
                controller.saveLayout(layoutName, positions, snapshot.capacity);
                setLayoutName("");
              }, "Saved current draft positions for this account.");
            }}
          >
            <label className="t-meta flex min-w-0 flex-1 flex-col gap-1">
              Layout name
              <input
                className="input w-full"
                value={layoutName}
                maxLength={60}
                onChange={(event) => setLayoutName(event.target.value)}
                placeholder="e.g. Class pages"
              />
            </label>
            <button
              type="submit"
              className="btn btn-ghost"
              disabled={disabled || !layoutName.trim()}
            >
              Save current layout
            </button>
          </form>
          {preferences.layouts.length > 0 ? (
            <ul className="space-y-2" aria-label="Saved layouts">
              {preferences.layouts.map((layout) => (
                <li className="flex flex-wrap items-center gap-2" key={layout.name}>
                  <span className="t-meta min-w-0 flex-1 break-words">{layout.name}</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
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
                    Restore as draft
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={disabled}
                    aria-label={`Remove saved layout ${layout.name}`}
                    onClick={() =>
                      act(() => controller.removeLayout(layout.name), "Removed saved layout.")
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </details>
      <details className="mt-3">
        <summary className="t-meta cursor-pointer hover:text-ink">
          Local operation history ({preferences.history.length})
        </summary>
        <p className="t-meta mt-2">
          The last 50 reported outcomes on this device. This is not Steam's transaction history.
          Simulations do not change Steam; unknown outcomes require a fresh check before retrying.
        </p>
        {preferences.history.length === 0 ? (
          <p className="t-meta mt-2">No operations recorded.</p>
        ) : (
          <ol className="mt-2 space-y-3">
            {preferences.history.map((operation) => (
              <li key={operation.at} className="t-meta break-words">
                <strong className="text-ink">
                  {operation.outcome === "simulated"
                    ? "Simulated · Steam unchanged"
                    : operation.outcome === "confirmed"
                      ? "Confirmed"
                      : operation.outcome === "partial"
                        ? "Partially confirmed"
                        : operation.outcome === "unknown"
                          ? "Unknown outcome"
                          : "Refused"}
                </strong>{" "}
                ·{" "}
                {operation.kind === "craft"
                  ? "Craft"
                  : operation.kind === "delete"
                    ? "Delete"
                    : "Move"}{" "}
                ·{" "}
                <time dateTime={new Date(operation.at).toISOString()}>
                  {new Date(operation.at).toLocaleString()}
                </time>
                <p>{operation.summary}</p>
                <details>
                  <summary className="cursor-pointer">
                    {operation.itemIds.length} item identities
                  </summary>
                  <p className="mt-1 break-all">{operation.itemIds.join(", ") || "None"}</p>
                </details>
              </li>
            ))}
          </ol>
        )}
      </details>
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
