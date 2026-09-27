import { useEffect, useMemo, useRef, useState } from "react";
import type { Api } from "../lib/api";
import type { InventorySnapshot, SteamItems } from "../lib/bridge";

export type SteamImageSize = 192 | 360;
export type SteamImageRequest = { image: string; size: SteamImageSize };
type SteamApi = Partial<Pick<Api, "getInventorySteamItems" | "getInventorySteamImage">>;

export type SteamArt = {
  status: SteamItems["status"] | "loading" | "off";
  message: string | null;
  items: SteamItems["items"];
  /** An object URL for Valve's rendered image, once loaded. */
  image: (name: string, size: SteamImageSize) => string | undefined;
};

const IMAGE_WORKERS = 4;
/** Steam's inventory can trail a new craft or trade; look again this often. */
const MISSING_RETRY_MS = 60_000;
const MISSING_RETRIES = 5;

/**
 * Valve's own descriptions and item renders for the player's public inventory.
 * Presentation only: the snapshot stays authoritative, and every failure falls
 * back to the installed-files art the pane already shows.
 */
export function useSteamItemArt(
  api: SteamApi,
  snapshot: InventorySnapshot | null | undefined,
  active: boolean,
  wanted: readonly SteamImageRequest[],
): SteamArt {
  const steamId = snapshot?.steamId;
  const ids = useMemo(() => snapshot?.items.map((item) => item.id).sort() ?? [], [snapshot]);
  const idsKey = ids.join(",");
  const [descriptions, setDescriptions] = useState<{
    account: string | undefined;
    result: SteamItems | null;
  }>({ account: undefined, result: null });
  const [attempt, setAttempt] = useState(0);
  const retries = useRef({ account: steamId, count: 0 });

  useEffect(() => {
    if (!active || !steamId || !idsKey || !api.getInventorySteamItems) return;
    let cancelled = false;
    const assetIds = idsKey.split(",");
    // A retry for items Steam had not listed yet asks it to read again.
    api
      .getInventorySteamItems(steamId, assetIds, attempt > 0)
      .then((result) => {
        if (!cancelled) setDescriptions({ account: steamId, result });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setDescriptions((current) => ({
            account: steamId,
            result: {
              status: "unavailable",
              message: error instanceof Error ? error.message : String(error),
              items: current.account === steamId ? (current.result?.items ?? {}) : {},
            },
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [api, steamId, idsKey, active, attempt]);

  // New items (a craft, a trade) can take a while to appear on Steam.
  const current = descriptions.account === steamId ? descriptions.result : null;
  useEffect(() => {
    if (retries.current.account !== steamId) retries.current = { account: steamId, count: 0 };
    const result = descriptions.account === steamId ? descriptions.result : null;
    const missing =
      result?.status === "ready" && idsKey.split(",").some((id) => id && !result.items[id]);
    if (!missing || !active || retries.current.count >= MISSING_RETRIES) return;
    const timer = setTimeout(() => {
      retries.current.count += 1;
      setAttempt((value) => value + 1);
    }, MISSING_RETRY_MS);
    return () => clearTimeout(timer);
  }, [descriptions, steamId, idsKey, active]);

  const urls = useRef(new Map<string, string>());
  const failed = useRef(new Set<string>());
  const [, setRevision] = useState(0);
  useEffect(
    () => () => {
      for (const url of urls.current.values()) URL.revokeObjectURL(url);
      urls.current.clear();
    },
    [],
  );
  const wantedKey = [...new Set(wanted.map((entry) => `${entry.size}:${entry.image}`))].join("|");
  useEffect(() => {
    if (!active || !wantedKey || !api.getInventorySteamImage) return;
    const load = api.getInventorySteamImage;
    const queue = wantedKey
      .split("|")
      .filter((key) => !urls.current.has(key) && !failed.current.has(key));
    if (!queue.length) return;
    let cancelled = false;
    async function worker() {
      while (!cancelled && queue.length) {
        const key = queue.shift() as string;
        const split = key.indexOf(":");
        const size = Number(key.slice(0, split)) as SteamImageSize;
        try {
          const bytes = await load(key.slice(split + 1), size);
          if (cancelled || urls.current.has(key)) continue;
          urls.current.set(key, URL.createObjectURL(new Blob([bytes], { type: "image/png" })));
          setRevision((value) => value + 1);
        } catch {
          failed.current.add(key);
        }
      }
    }
    for (let index = 0; index < IMAGE_WORKERS; index++) void worker();
    return () => {
      cancelled = true;
    };
  }, [api, wantedKey, active]);

  return {
    status: !api.getInventorySteamItems ? "off" : (current?.status ?? "loading"),
    message: current?.message ?? null,
    items: current?.items ?? {},
    image: (name, size) => urls.current.get(`${size}:${name}`),
  };
}
