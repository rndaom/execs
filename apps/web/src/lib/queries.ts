import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import {
  type Category,
  type Config,
  configClasses,
  configs,
  configVersions,
  files,
  media,
  users,
} from "@/db/schema";
import { getDb } from "./cf";

export type SortKey = "new" | "top";

export interface BrowseParams {
  q?: string;
  category?: Category;
  tfClass?: string;
  sort?: SortKey;
  /** keyset cursor: `${createdAt}_${id}` for new, `${downloadCount}_${id}` for top */
  cursor?: string;
  limit?: number;
}

export interface BrowseResult {
  items: Array<Config & { ownerName: string }>;
  nextCursor: string | null;
}

const PAGE_SIZE = 24;

export async function browseConfigs(params: BrowseParams): Promise<BrowseResult> {
  const db = await getDb();
  const limit = params.limit ?? PAGE_SIZE;

  const conditions = [eq(configs.status, "published")];

  if (params.category) conditions.push(eq(configs.category, params.category));

  if (params.tfClass) {
    const rows = await db
      .select({ configId: configClasses.configId })
      .from(configClasses)
      .where(eq(configClasses.class, params.tfClass))
      .all();
    const ids = rows.map((r) => r.configId);
    if (ids.length === 0) return { items: [], nextCursor: null };
    conditions.push(inArray(configs.id, ids));
  }

  if (params.q?.trim()) {
    // FTS5 prefix match; quote each term to neutralize FTS syntax.
    const ftsQuery = params.q
      .trim()
      .split(/\s+/)
      .slice(0, 6)
      .map((t) => `"${t.replace(/"/g, "")}"*`)
      .join(" ");
    const matches = await db.all<{ id: string }>(
      sql`select c.id as id from configs_fts f join configs c on c.rowid = f.rowid where configs_fts match ${ftsQuery} order by bm25(configs_fts) limit 200`,
    );
    const ids = matches.map((m) => m.id);
    if (ids.length === 0) return { items: [], nextCursor: null };
    conditions.push(inArray(configs.id, ids));
  }

  const sort = params.sort ?? "new";
  if (params.cursor) {
    const [rawValue, id] = params.cursor.split("_");
    const value = Number(rawValue);
    if (Number.isFinite(value) && id) {
      const col = sort === "top" ? configs.downloadCount : configs.createdAt;
      conditions.push(or(lt(col, value), and(eq(col, value), lt(configs.id, id)))!);
    }
  }

  const orderBy =
    sort === "top"
      ? [desc(configs.downloadCount), desc(configs.id)]
      : [desc(configs.createdAt), desc(configs.id)];

  const rows = await db
    .select({ config: configs, ownerName: users.personaName })
    .from(configs)
    .innerJoin(users, eq(users.id, configs.ownerId))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(limit + 1)
    .all();

  const items = rows.slice(0, limit).map((r) => ({ ...r.config, ownerName: r.ownerName }));
  let nextCursor: string | null = null;
  if (rows.length > limit) {
    const last = items[items.length - 1];
    nextCursor = `${sort === "top" ? last.downloadCount : last.createdAt}_${last.id}`;
  }
  return { items, nextCursor };
}

export async function getConfigPage(slug: string) {
  const db = await getDb();
  const row = await db
    .select({ config: configs, ownerName: users.personaName, ownerSteamId: users.steamId })
    .from(configs)
    .innerJoin(users, eq(users.id, configs.ownerId))
    .where(eq(configs.slug, slug))
    .get();
  if (!row) return null;

  const versions = await db
    .select()
    .from(configVersions)
    .where(eq(configVersions.configId, row.config.id))
    .orderBy(desc(configVersions.createdAt))
    .all();
  const latest = versions.find((v) => v.id === row.config.latestVersionId) ?? versions[0];
  const versionFiles = latest
    ? await db.select().from(files).where(eq(files.versionId, latest.id)).all()
    : [];
  const mediaRows = await db
    .select()
    .from(media)
    .where(eq(media.configId, row.config.id))
    .orderBy(media.sortOrder)
    .all();

  return {
    ...row.config,
    ownerName: row.ownerName,
    ownerSteamId: row.ownerSteamId,
    versions,
    latest,
    files: versionFiles,
    media: mediaRows,
  };
}

export async function getUserProfile(steamId: string) {
  const db = await getDb();
  const user = await db.select().from(users).where(eq(users.steamId, steamId)).get();
  if (!user) return null;
  const uploads = await db
    .select()
    .from(configs)
    .where(and(eq(configs.ownerId, user.id), eq(configs.status, "published")))
    .orderBy(desc(configs.createdAt))
    .all();
  return { user, uploads };
}
